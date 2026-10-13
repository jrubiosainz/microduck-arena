"""The workshop's server: the open challenges of one checkout, on 127.0.0.1, never deployed.

Separate from arena/web — no OAuth, no store — and it only ever runs on the
machine that holds the checkout. The page (workshop.html) is built with the
site and served from the same folder, so the replay uses the site's viewer.
"""

import re
import shutil
import threading
import webbrowser
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..hub_fetch import FetchError
from ..manifest import load_event
from ..timeline import TimelineError, load_troupe
from ..web.routes_read import event_summary
from .challenges import (
    RECIPE,
    Challenge,
    ChallengeError,
    is_stage,
    read_challenge,
    read_timeline,
    save_timeline,
    timeline_file,
    write_values,
)
from .code import code_state, code_url, commit, push, use_fork
from .evaluations import evaluate_checkpoint, evaluate_forever, stored
from .hub import Hub, HubUnreachable
from .jobs import recorded_jobs, remember_job
from .login import BrowserLogin, LoginError
from .publishing import PublishError, exported, preview, publish, repo_for
from .runs import find_runs
from .shell import ShellError, commit_all, git
from .tickets import source, ticket, ticket_detail, ticket_state, tickets
from .training import Training
from .troupe import candidates, timeline_key
from .watch import watch_forever

NO_SITE = (
    "The workshop's page has not been built.\n\n"
    "    cd app && npm install && npm run build\n\n"
    "in the Arena's checkout (an installed Arena wheel carries it already).\n"
)

router = APIRouter(prefix="/api/workshop")


@dataclass
class Workshop:
    root: Path
    # By event id, in folder order, as read at start: /status and Train read each file again.
    challenges: dict[str, Challenge]
    arena: str
    hub: Hub
    open_browser: object
    login: BrowserLogin
    # The trainings this workshop launched and follows, by (task, run name): two challenges may each
    # have a run called "first".
    trainings: dict[tuple[str, str], Training] = field(default_factory=dict)
    # Serializes launch and stop: without it two launches ~250 ms apart could both pass the
    # one-local-training rule, and race `write_values`/`commit_all` over the same checkout.
    lock: threading.Lock = field(default_factory=threading.Lock)
    # One publish or preview at a time: two of one name race over ./publish-<name>/ and the Hub repo.
    publishing: threading.Lock = field(default_factory=threading.Lock)
    # Set when the app stops: the background workers end.
    stopping: threading.Event = field(default_factory=threading.Event)
    # The challenges the evaluator set aside, by event id, until when (time.time()): one whose troupe
    # names a Hub policy the Hub did not hand over. Only the evaluator's thread uses it.
    aside: dict[str, float] = field(default_factory=dict)


def has_gpu() -> bool:
    return shutil.which("nvidia-smi") is not None


def _challenge_or_404(ws: Workshop, event: str) -> Challenge:
    challenge = ws.challenges.get(event)
    if challenge is None:
        raise HTTPException(status_code=404, detail=f"{event} is not a challenge open here.")
    return challenge


def _as_it_reads(challenge: Challenge) -> Challenge:
    """`challenge` as its challenge.toml says now — the user edits the file by hand between two
    commits — or, while the file does not read, as it read at start: Train then says what is wrong."""
    try:
        return read_challenge(challenge.toml)
    except ChallengeError:
        return challenge


def _knob(knob) -> dict:
    # A knob named *_reward weighs a reward; any other (the hill's steepest slope) shapes the recipe.
    return {**asdict(knob), "group": "reward" if knob.name.endswith("_reward") else "recipe"}


def _workshop(request: Request) -> Workshop:
    return request.app.state.workshop


def _hub_user(ws: Workshop) -> str | None:
    try:
        account = ws.hub.whoami()
    except HubUnreachable as exc:
        raise HTTPException(status_code=503, detail=f"Hugging Face is unreachable: {exc}. "
                                                    "Check your connection, then try again.") from exc
    return account.name if account else None


@router.get("/status")
def status(request: Request) -> dict:
    """What the pages draw from, known without the network: the open challenges, the Arena, the GPU.
    Who is logged in to Hugging Face is asked apart (/hub)."""
    ws = _workshop(request)
    return {
        "challenges": [
            {
                "event": event_summary(load_event(c.event)), "folder": c.folder, "task": c.task,
                "recipe": c.recipe, "knobs": [_knob(k) for k in c.knobs],
                "running": sum(t["state"] in ("starting", "running") for t in tickets(ws, c)),
            }
            for c in map(_as_it_reads, ws.challenges.values())
        ],
        "arena": ws.arena,
        "gpu": has_gpu(),
    }


@router.get("/hub")
def hub_account(request: Request) -> dict:
    try:
        account = _workshop(request).hub.whoami()
    except HubUnreachable:
        return {"user": None, "reachable": False, "can_pay": False}
    return {"user": account.name if account else None, "reachable": True, "can_pay": bool(account and account.can_pay)}


@router.post("/login")
def login(request: Request) -> dict:
    """Start the browser login; the page then asks /hub until the account appears."""
    try:
        return _workshop(request).login.start()
    except LoginError as exc:
        raise HTTPException(status_code=502, detail=f"Could not start the Hugging Face login:\n{exc}") from exc


@router.get("/login")
def login_state(request: Request) -> dict:
    return _workshop(request).login.state()


IN_PROGRESS = "A launch or a stop is already in progress."
WHERE = ("local", "hf-jobs")
# Also a Hub repo name: no leading, trailing or doubled dash.
RUN_NAME = re.compile(r"^(?=.{1,40}$)[a-z0-9]+(-[a-z0-9]+)*$")


class Launch(BaseModel):
    name: str
    where: str
    recipe: dict[str, int]
    params: dict[str, float] = {}


@router.post("/challenges/{event}/train")
def launch(event: str, body: Launch, request: Request) -> dict:
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    if not ws.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=IN_PROGRESS)
    try:
        try:
            # As the file is now, edited by hand or not: its bounds are the ones checked, and what the
            # form did not change stays as the file says.
            challenge = read_challenge(challenge.toml)
        except ChallengeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if body.where not in WHERE:
            raise HTTPException(status_code=400, detail="A training runs on this machine or on Hugging Face Jobs.")
        if not RUN_NAME.match(body.name):
            raise HTTPException(
                status_code=400,
                detail="A run name is lowercase letters and digits, joined by single dashes, up to 40 characters.",
            )
        # A recorded job's run may not be fetched yet, and its name is also its checkpoint repo's.
        taken = ({r.name for r in find_runs(ws.root, challenge.task)}
                 | {j["name"] for j in recorded_jobs(ws.root, challenge.task)}
                 | {name for task, name in ws.trainings if task == challenge.task})
        if body.name in taken:
            raise HTTPException(status_code=409, detail=f"There is already a run called {body.name}.")
        if set(body.recipe) != set(RECIPE):
            raise HTTPException(status_code=400, detail=f"The recipe is {', '.join(RECIPE)}, all three.")
        if git(ws.root, "status", "--porcelain"):
            raise HTTPException(status_code=409, detail="Commit your changes first: every training starts from a commit.")
        hf_user = None
        if body.where == "local":
            if not has_gpu():
                raise HTTPException(status_code=400, detail="There is no NVIDIA GPU on this machine: train on Hugging Face Jobs.")
            if any(t.where == "local" and t.state == "running" for t in ws.trainings.values()):
                raise HTTPException(status_code=409, detail="A training already runs on this machine: stop it first.")
        else:
            hf_user = _hub_user(ws)
            if not hf_user:
                raise HTTPException(status_code=400, detail="Hugging Face Jobs need a Hugging Face login: log in first.")
        try:
            write_values(challenge, body.recipe, body.params)
            # Every run starts from a commit, so the recipe a policy is published with is what trained it.
            commit_all(ws.root, f"{challenge.event}: run {body.name}")
        except (ChallengeError, ShellError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        ws.trainings[(challenge.task, body.name)] = Training(
            ws.root, challenge, body.name, body.where, body.recipe, body.params, hf_user)
        return ticket(ws, challenge, body.name)
    finally:
        ws.lock.release()


@router.get("/challenges/{event}/jobs")
def jobs(event: str, request: Request) -> dict:
    ws = _workshop(request)
    return {"jobs": tickets(ws, _challenge_or_404(ws, event))}


@router.get("/challenges/{event}/jobs/{ticket_id}")
def job(event: str, ticket_id: str, request: Request, since: int = 0) -> dict:
    ws = _workshop(request)
    body = ticket_detail(ws, _challenge_or_404(ws, event), ticket_id, since)
    if body is None:
        raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
    return body


@router.post("/challenges/{event}/jobs/{ticket_id}/stop")
def stop(event: str, ticket_id: str, request: Request) -> dict:
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    if not ws.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=IN_PROGRESS)
    try:
        found = source(ws, challenge, ticket_id)
        if found is None:
            raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
        if ticket_state(found) not in ("starting", "running"):
            raise HTTPException(status_code=409, detail=f"{ticket_id} is not running.")
        _, live, record, _ = found
        # If any of this raises, the job may still run, billed: say so; the ticket still says running.
        # A Hub that did not answer in time may have cancelled it all the same.
        try:
            if live is not None and live.state == "running":
                live.stop(ws.hub)  # an HF job is cancelled on the Hub first; only that can raise
            else:  # an HF job no process of this workshop follows now
                ws.hub.cancel_job(record["job_id"], record["namespace"])
                remember_job(ws.root, challenge.task, record["name"], stage="CANCELED")
        except HubUnreachable as exc:
            raise HTTPException(status_code=503, detail=f"Hugging Face is unreachable: {exc}. The job may not have "
                                                        "been cancelled: check your connection, then try again.") from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not cancel the Hugging Face job: {exc}") from exc
        return ticket(ws, challenge, ticket_id)
    finally:
        ws.lock.release()


@router.get("/challenges/{event}/jobs/{ticket_id}/checkpoints/{n}")
def checkpoint(event: str, ticket_id: str, n: int, request: Request) -> dict:
    """A checkpoint's stored evaluation, its trace inline: the page replays it at once. On a stage, a
    checkpoint last played with another timeline is played again now, from its exported ONNX — a
    second or two — so an edit to the performance shows on the stage straight away."""
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    found = source(ws, challenge, ticket_id)
    run = found[3] if found else None
    if run is None or n not in run.checkpoints:
        raise HTTPException(status_code=404, detail=f"Checkpoint {n} is not evaluated yet.")
    body = stored(run, n, timeline_key(ws.root, challenge))
    if body is None and is_stage(challenge) and exported(run, n):
        try:
            body = evaluate_checkpoint(ws.root, run, n, challenge)
        except FetchError as exc:  # it names the duck whose policy the Hub did not hand over
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    if body is None:
        raise HTTPException(status_code=404, detail=f"Checkpoint {n} is not evaluated yet.")
    return {"checkpoint": n, "error": body["error"]} if "error" in body else body


class TimelineText(BaseModel):
    text: str


def _stage_or_409(ws: Workshop, event: str) -> Challenge:
    challenge = _challenge_or_404(ws, event)
    if not is_stage(challenge):
        raise HTTPException(status_code=409, detail=f"{event} is a race: it plays the event's command, with no timeline.")
    return challenge


@router.get("/challenges/{event}/timeline")
def get_timeline(event: str, request: Request) -> dict:
    return {"text": read_timeline(_stage_or_409(_workshop(request), event))}


@router.post("/challenges/{event}/timeline")
def post_timeline(event: str, body: TimelineText, request: Request) -> dict:
    """Save the performance the page typed; the Arena's own loader reads it first, and a refusal says where."""
    challenge = _stage_or_409(_workshop(request), event)
    try:
        save_timeline(challenge, body.text)
    except TimelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"text": body.text}


@router.get("/challenges/{event}/performers")
def performers(event: str, request: Request) -> dict:
    """What "+ duck" offers on a stage's plan: every checkpoint and every published policy of the checkout."""
    ws = _workshop(request)
    _stage_or_409(ws, event)
    return {"performers": candidates(ws.root)}


class CommitRequest(BaseModel):
    message: str


class ForkRequest(BaseModel):
    url: str


def _code_step(ws: Workshop, step) -> dict:
    try:
        step()
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return code_state(ws.root)


@router.get("/code")
def code(request: Request) -> dict:
    return code_state(_workshop(request).root)


@router.post("/code/commit")
def code_commit(body: CommitRequest, request: Request) -> dict:
    ws = _workshop(request)
    return _code_step(ws, lambda: commit(ws.root, body.message))


@router.post("/code/fork")
def code_fork(body: ForkRequest, request: Request) -> dict:
    ws = _workshop(request)
    return _code_step(ws, lambda: use_fork(ws.root, body.url))


@router.post("/code/push")
def code_push(request: Request) -> dict:
    ws = _workshop(request)
    return _code_step(ws, lambda: push(ws.root))


class PublishRequest(BaseModel):
    checkpoint: int
    name: str
    description: str
    allow_dirty: bool = False
    dry_run: bool = False


@router.post("/challenges/{event}/jobs/{ticket_id}/publish")
async def publish_route(event: str, ticket_id: str, body: PublishRequest, request: Request) -> dict:
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    found = source(ws, challenge, ticket_id)
    if found is None:
        raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
    run = found[3]
    if run is None:
        raise HTTPException(status_code=409, detail=f"{ticket_id} has no checkpoint yet.")
    if body.checkpoint not in run.checkpoints:
        raise HTTPException(status_code=400, detail=f"{run.id} has no model_{body.checkpoint}.pt")
    if not body.name.strip() or not body.description.strip():
        raise HTTPException(status_code=400, detail="A name and a word for the commentators are both needed.")
    if run.provenance.get("dirty") and not body.allow_dirty:
        raise HTTPException(
            status_code=400,
            detail="This run started from uncommitted changes, so the code it records is not what "
                   "trained it. Train again from the workshop (it commits first), or publish anyway.",
        )
    # A stage publishes its performance beside the weights; one the Arena would refuse is never uploaded.
    timeline = timeline_file(challenge) if is_stage(challenge) and timeline_file(challenge).exists() else None
    if timeline is not None:
        try:
            load_troupe(timeline, load_event(challenge.event))
        except TimelineError as exc:
            raise HTTPException(status_code=400, detail=f"Your performance cannot be published: {exc}") from exc
    user = await run_in_threadpool(_hub_user, ws)
    if not user:
        raise HTTPException(status_code=400, detail="Log in to Hugging Face first.")
    repo = repo_for(user, body.name)
    args = (ws.root, run, body.checkpoint, repo, body.name, body.description.strip(), challenge.event, body.allow_dirty)
    env = code_url(ws.root, run.provenance.get("commit"))
    if not ws.publishing.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A publish is already running.")
    try:
        if body.dry_run:
            return {"repo": repo, **await run_in_threadpool(preview, *args, timeline=timeline)}
        entered = await run_in_threadpool(publish, *args, arena=ws.arena, code_url=env, timeline=timeline)
    except PublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        ws.publishing.release()
    ws.open_browser(entered["page_url"])  # the entry's page on the Arena, where its reveal plays
    return {**entered, "env": env}


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


@asynccontextmanager
async def _background(app: FastAPI):
    """The workers that keep the tickets up to date, for as long as the app serves."""
    ws = app.state.workshop
    for work, name in ((evaluate_forever, "workshop-evaluator"), (watch_forever, "workshop-watcher")):
        threading.Thread(target=work, args=(ws,), name=name, daemon=True).start()
    yield
    ws.stopping.set()


def create_workshop_app(
    root: Path,
    challenges: list[Challenge],
    arena: str,
    hub: Hub,
    port: int,
    frontend_dir: Path | None = None,
    open_browser=webbrowser.open,
) -> FastAPI:
    """`port` is the one the workshop serves on, on 127.0.0.1: requests must name it.
    `challenges`: the checkout's open ones."""
    app = FastAPI(title="Microduck workshop", docs_url=None, redoc_url=None, lifespan=_background)
    app.state.workshop = Workshop(root, {c.event: c for c in challenges}, arena, hub, open_browser,
                                  BrowserLogin(root, open_browser))
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
