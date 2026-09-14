"""The FastAPI app.

One process serves the API and the built frontend, so `arena serve` is the only
command needed and the local setup is the same code path that will run in a
Space later.
"""

from fastapi import FastAPI
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from ..manifest import all_events
from .config import ArenaConfig
from .routes_auth import router as auth_router
from .routes_read import router as read_router
from .routes_submit import router as submit_router
from .session import Sessions

NO_BUNDLE = (
    "The frontend has not been built yet.\n\n"
    "    cd app && npm install && npm run build\n\n"
    "The API is available meanwhile at /api/health.\n"
)


def create_app(config: ArenaConfig) -> FastAPI:
    app = FastAPI(title="Microduck Arena", docs_url="/api/docs")
    app.state.config = config
    app.state.store = config.build_store()
    app.state.sessions = Sessions()

    @app.get("/api/health")
    def health() -> dict:
        return {
            "ok": True,
            "user": config.dev_user,
            "events": len(all_events()),
            # Says whether this deployment's board survives a restart. Cheap to
            # expose and the first thing to check on a Space that lost its runs.
            "durable": bool(config.dataset_repo and config.hf_token),
        }

    app.include_router(read_router)
    app.include_router(submit_router)
    app.include_router(auth_router)

    if config.frontend_dir is None:
        @app.get("/")
        def no_frontend() -> PlainTextResponse:
            return PlainTextResponse(NO_BUNDLE, status_code=503)
    else:
        index = config.frontend_dir / "index.html"

        @app.get("/")
        def frontend_index() -> FileResponse:
            # index.html names the hashed bundle, so a cached copy pins the
            # browser to an old build and every change looks like no change.
            # The assets it points at stay cacheable; this one file must not be.
            return FileResponse(index, headers={"Cache-Control": "no-store"})

        # Mounted last so /api routes always win.
        app.mount("/", StaticFiles(directory=config.frontend_dir), name="frontend")

    return app
