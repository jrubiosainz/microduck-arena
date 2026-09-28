"""The workshop's server: one challenge, one checkout, on 127.0.0.1, never deployed.

Separate from arena/web — no OAuth, no store — and it only ever runs on the
machine that holds the checkout. The page (workshop.html) is built with the
site and served from the same folder, so the replay uses the site's viewer.
"""

import shutil
import webbrowser
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..manifest import load_event
from ..web.routes_read import event_summary
from .challenges import Challenge
from .hub import Hub
from .shell import gh_ready, git

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
    except Exception as exc:  # noqa: BLE001 — the Hub's own sentence is the useful part
        raise HTTPException(status_code=400, detail=f"Hugging Face refused this token: {exc}") from exc
    return {"user": ws.hub.whoami()}


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
