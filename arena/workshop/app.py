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
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..manifest import load_event
from ..policy import PolicyError
from ..web.routes_read import event_summary
from .challenges import RECIPE, Challenge, ChallengeError, read_challenge, write_values
from .code import code_state, code_url, fork, push
from .hub import Hub
from .jobs import find_job, recorded_jobs
from .publishing import PublishError, arena_link, preview, publish, repo_for
from .runs import curve, find_run, find_runs
from .shell import ShellError, commit_all, gh_ready, git
from .training import Training, ckpt_repo, fetch, train_command
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
    # One publish or preview at a time: two of one name race over ./publish-<name>/ and the Hub repo.
    publishing: threading.Lock = field(default_factory=threading.Lock)


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
        # A recorded job's run may not be fetched yet, and its name is also its checkpoint repo's.
        taken = ({r.name for r in find_runs(ws.root, ws.challenge.task)} | {j["name"] for j in recorded_jobs(ws.root)}
                 | ({ws.training.name} if ws.training else set()))
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
        except Exception as exc:
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


@router.get("/jobs")
def jobs(request: Request) -> dict:
    """Every HF job launched from this checkout, newest first — each still reachable after a restart."""
    return {"jobs": recorded_jobs(_workshop(request).root)}


def _job_or_404(ws: Workshop, name: str) -> dict:
    job = find_job(ws.root, name)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No Hugging Face job called {name} was launched from here.")
    return job


@router.post("/jobs/{name}/pull")
async def pull_job(name: str, request: Request) -> dict:
    ws = _workshop(request)
    job = _job_or_404(ws, name)
    done = await run_in_threadpool(fetch, ws.root, job["ckpt_repo"])
    output = done.stdout + done.stderr
    if done.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Could not fetch {job['ckpt_repo']}:\n{output}")
    return {**job, "output": output}


@router.post("/jobs/{name}/stop")
def stop_job(name: str, request: Request) -> dict:
    ws = _workshop(request)
    job = _job_or_404(ws, name)
    if not job["job_id"]:
        raise HTTPException(status_code=409, detail=f"{name} never printed a job id: there is no job to stop.")
    try:
        ws.hub.cancel_job(job["job_id"], job["namespace"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not cancel the Hugging Face job: {exc}") from exc
    return job


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


class ForkRequest(BaseModel):
    url: str | None = None


def _code(ws: Workshop, output: str = "") -> dict:
    return {**code_state(ws.root), "output": output}


@router.get("/code")
def code(request: Request) -> dict:
    return _code(_workshop(request))


@router.post("/code/fork")
def code_fork(body: ForkRequest, request: Request) -> dict:
    ws = _workshop(request)
    try:
        return _code(ws, fork(ws.root, body.url, f"{ws.challenge.event}: my changes"))
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/code/push")
def code_push(request: Request) -> dict:
    ws = _workshop(request)
    try:
        return _code(ws, push(ws.root, f"{ws.challenge.event}: my changes"))
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class PublishRequest(BaseModel):
    run: str
    checkpoint: int
    name: str
    description: str = ""
    allow_dirty: bool = False
    dry_run: bool = False


@router.post("/publish")
async def publish_route(body: PublishRequest, request: Request) -> dict:
    ws = _workshop(request)
    run = _run_or_404(ws, body.run)
    if body.checkpoint not in run.checkpoints:
        raise HTTPException(status_code=400, detail=f"{run.id} has no model_{body.checkpoint}.pt")
    if run.provenance.get("dirty") and not body.allow_dirty:
        raise HTTPException(
            status_code=400,
            detail="This run started from uncommitted changes, so the code it records is not what "
                   "trained it. Train again from the workshop (it commits first), or publish anyway.",
        )
    user = await run_in_threadpool(ws.hub.whoami)
    if not user:
        raise HTTPException(status_code=400, detail="Log in to Hugging Face first (Preflight).")
    event = load_event(ws.challenge.event)
    repo = repo_for(user, body.name)
    args = (ws.root, run, body.checkpoint, repo, body.name, body.description.strip() or event.title,
            ws.challenge.event, body.allow_dirty)
    if not ws.publishing.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A publish is already running.")
    try:
        if body.dry_run:
            return {"repo": repo, **await run_in_threadpool(preview, *args)}
        published = await run_in_threadpool(publish, *args)
    except PublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        ws.publishing.release()
    env = code_url(ws.root, run.provenance.get("commit"))
    link = arena_link(ws.arena, ws.challenge.event, repo, published["revision"], env)
    ws.open_browser(link)  # the Arena's page, pre-filled: the user clicks Publish there
    return {**published, "env": env, "arena_url": link}


def _only_its_own_page(app: FastAPI, port: int) -> None:
    """Every request must come to this workshop, by its own address, and every write from its own page.

    Listening on 127.0.0.1 keeps other machines out, not the pages this machine's browser has open.
    A page re-pointing its own name at 127.0.0.1 (DNS rebinding) could read and write the API as
    same-origin, but its requests carry its name in Host. Any page can POST here across origins
    without a CORS preflight (no body, or a text/plain one) — a git push, a stop — but the browser
    names that page in Origin.
    """
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    origins = {f"http://{host}" for host in hosts}

    @app.middleware("http")
    async def refuse_other_pages(request: Request, call_next):
        if request.headers.get("host") not in hosts:
            return JSONResponse({"detail": f"The workshop answers only at http://127.0.0.1:{port}/."}, status_code=403)
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD") and origin is not None and origin not in origins:
            return JSONResponse({"detail": "Only the workshop's own page can change anything here."}, status_code=403)
        return await call_next(request)


def create_workshop_app(
    root: Path,
    challenge: Challenge,
    arena: str,
    hub: Hub,
    port: int,
    frontend_dir: Path | None = None,
    open_browser=webbrowser.open,
) -> FastAPI:
    """`port` is the one the workshop serves on, on 127.0.0.1: requests must name it."""
    app = FastAPI(title="Microduck workshop", docs_url=None, redoc_url=None)
    app.state.workshop = Workshop(root, challenge, arena, hub, open_browser)
    _only_its_own_page(app, port)
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
