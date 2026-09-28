"""The workshop's server: one challenge, one checkout, on 127.0.0.1, never deployed.

Separate from arena/web — no OAuth, no store — and it only ever runs on the
machine that holds the checkout. The page (workshop.html) is built with the
site and served from the same folder, so the replay uses the site's viewer.
"""

import re
import shutil
import threading
import webbrowser
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..manifest import load_event
from ..policy import PolicyError
from ..web.routes_read import event_summary
from .challenges import RECIPE, Challenge, ChallengeError, read_challenge, write_values
from .hub import Hub
from .runs import curve, find_run, find_runs
from .shell import ShellError, commit_all, gh_ready, git
from .training import Training, ckpt_repo, train_command
from .trials import TrialError, tested, trial

NO_SITE = (
    "The workshop's page has not been built.\n\n"
    "    cd app && npm install && npm run build\n\n"
    "in the Arena's checkout (an installed Arena wheel carries it already).\n"
)

router = APIRouter(prefix="/api/workshop")


@dataclass
class Workshop:
    root: Path
    challenge: Challenge
    arena: str
    hub: Hub
    open_browser: object
    training: object = field(default=None)
    # Serializes launch and stop: without it, two POST /train ~250ms apart could both pass
    # `_running` before either sets `ws.training`, starting two processes (one an unreachable,
    # still-billed HF job) and racing `write_values`/`commit_all` over the same checkout.
    lock: threading.Lock = field(default_factory=threading.Lock)


def preflight(root: Path, hub: Hub) -> dict:
    has_git = shutil.which("git") is not None
    return {
        "git": has_git,
        # A commit needs a name: the workshop commits before every training.
        "identity": has_git and bool(git(root, "config", "user.email", check=False)),
        "uv": shutil.which("uv") is not None,
        "gpu": shutil.which("nvidia-smi") is not None,
        "gh": gh_ready(root),
        "user": hub.whoami(),
    }


def _workshop(request: Request) -> Workshop:
    return request.app.state.workshop


@router.get("/status")
def status(request: Request) -> dict:
    ws = _workshop(request)
    tools = preflight(ws.root, ws.hub)
    c = ws.challenge
    return {
        "challenge": {
            "folder": c.folder, "event": c.event, "task": c.task, "kind": c.kind,
            "recipe": c.recipe, "knobs": [asdict(k) for k in c.knobs],
        },
        "event": event_summary(load_event(c.event)),
        "arena": ws.arena,
        "preflight": tools,
        "mode": "local" if tools["gpu"] else "hf-jobs",
    }


class Token(BaseModel):
    token: str


@router.post("/login")
def login(body: Token, request: Request) -> dict:
    ws = _workshop(request)
    try:
        ws.hub.login(body.token.strip())
    except Exception as exc:  # the Hub's own sentence is the useful part
        raise HTTPException(status_code=400, detail=f"Hugging Face refused this token: {exc}") from exc
    return {"user": ws.hub.whoami()}


IN_PROGRESS = "A launch or a stop is already in progress."
# Also a Hub repo name: no leading, trailing or doubled dash.
RUN_NAME = re.compile(r"^(?=.{1,40}$)[a-z0-9]+(-[a-z0-9]+)*$")


class Launch(BaseModel):
    name: str
    recipe: dict[str, int]
    params: dict[str, float] = {}


def _running(ws: Workshop) -> bool:
    return ws.training is not None and ws.training.state == "running"


@router.post("/train")
def launch(body: Launch, request: Request) -> dict:
    ws = _workshop(request)
    if not ws.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=IN_PROGRESS)
    try:
        if _running(ws):
            raise HTTPException(status_code=409, detail="A training is already running: stop it first.")
        if not RUN_NAME.match(body.name):
            raise HTTPException(
                status_code=400,
                detail="A run name is lowercase letters and digits, joined by single dashes, up to 40 characters.",
            )
        taken = {r.name for r in find_runs(ws.root, ws.challenge.task)} | ({ws.training.name} if ws.training else set())
        if body.name in taken:
            raise HTTPException(status_code=409, detail=f"There is already a run called {body.name}.")
        if set(body.recipe) != set(RECIPE):
            raise HTTPException(status_code=400, detail=f"The recipe is {', '.join(RECIPE)}, all three.")
        tools = preflight(ws.root, ws.hub)
        hf_user = None if tools["gpu"] else tools["user"]
        if not tools["gpu"] and not hf_user:
            raise HTTPException(
                status_code=400,
                detail="Without an NVIDIA GPU, training runs on Hugging Face Jobs: log in to Hugging Face first.",
            )
        try:
            write_values(ws.challenge, body.recipe, body.params)
            # Every run starts from a commit, so the recipe a policy is published with is what trained it.
            commit_all(ws.root, f"{ws.challenge.event}: run {body.name}")
        except ChallengeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ShellError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        ws.challenge = read_challenge(ws.challenge.toml)
        ws.training = Training(
            ws.root, body.name, train_command(ws.challenge, body.name, body.recipe, hf_user),
            ckpt_repo=ckpt_repo(hf_user, ws.challenge, body.name) if hf_user else None, namespace=hf_user,
        )
        return ws.training.snapshot()
    finally:
        ws.lock.release()


@router.get("/train")
def follow_training(request: Request, since: int = 0) -> dict:
    ws = _workshop(request)
    return ws.training.snapshot(since) if ws.training else {"state": None}


@router.post("/train/stop")
def stop(request: Request) -> dict:
    ws = _workshop(request)
    if not ws.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=IN_PROGRESS)
    try:
        if not _running(ws):
            raise HTTPException(status_code=409, detail="No training is running.")
        try:
            # Training.stop() only lets the Hub's own cancel_job() raise past it.
            ws.training.stop(ws.hub)
        except Exception as exc:  # noqa: BLE001
            # The job was NOT cancelled and is still billed: say so, keep following it.
            raise HTTPException(status_code=502, detail=f"Could not cancel the Hugging Face job: {exc}") from exc
        return ws.training.snapshot()
    finally:
        ws.lock.release()


@router.post("/train/pull")
async def pull(request: Request) -> dict:
    ws = _workshop(request)
    if ws.training is None or not ws.training.ckpt_repo:
        raise HTTPException(status_code=409, detail="Only a Hugging Face Jobs run has checkpoints to fetch.")
    await run_in_threadpool(ws.training.pull)
    return ws.training.snapshot()


def _run_summary(run) -> dict:
    return {
        "id": run.id, "name": run.name, "started": run.provenance.get("started"),
        "dirty": bool(run.provenance.get("dirty")), "checkpoints": list(run.checkpoints),
        "trials": {str(n): r for n, r in tested(run).items()},
    }


@router.get("/runs")
def runs(request: Request) -> dict:
    ws = _workshop(request)
    return {"runs": [_run_summary(r) for r in find_runs(ws.root, ws.challenge.task)]}


def _run_or_404(ws: Workshop, run_id: str):
    run = find_run(ws.root, ws.challenge.task, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id} in logs/rsl_rl/.")
    return run


@router.get("/runs/{run_id}/curve")
def run_curve(run_id: str, request: Request) -> dict:
    return {"points": curve(_run_or_404(_workshop(request), run_id))}


class TrialRequest(BaseModel):
    checkpoint: int


@router.post("/runs/{run_id}/trial")
async def run_trial(run_id: str, body: TrialRequest, request: Request) -> dict:
    ws = _workshop(request)
    run = _run_or_404(ws, run_id)
    try:
        # Seconds of export and simulation: off the event loop, which keeps the log flowing.
        return await run_in_threadpool(trial, ws.root, run, body.checkpoint, ws.challenge.event)
    except (TrialError, PolicyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def create_workshop_app(
    root: Path,
    challenge: Challenge,
    arena: str,
    hub: Hub,
    frontend_dir: Path | None = None,
    open_browser=webbrowser.open,
) -> FastAPI:
    app = FastAPI(title="Microduck workshop", docs_url=None, redoc_url=None)
    app.state.workshop = Workshop(root, challenge, arena, hub, open_browser)
    app.include_router(router)

    if frontend_dir is None:
        @app.get("/")
        def no_site() -> PlainTextResponse:
            return PlainTextResponse(NO_SITE, status_code=503)
    else:
        page = frontend_dir / "workshop.html"

        @app.get("/")
        def workshop_page() -> FileResponse:
            return FileResponse(page, headers={"Cache-Control": "no-store"})

        # Last, so /api/workshop wins: the bundle, the meshes, the design tokens.
        app.mount("/", StaticFiles(directory=frontend_dir), name="site")
    return app
