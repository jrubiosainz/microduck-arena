"""The FastAPI app.

One process serves the API and the built frontend, so `arena serve` is the only
command needed and the local setup is the same code path that will run in a
Space later.
"""

import hashlib
import random
import threading

from fastapi import FastAPI
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from ..broadcasts import BroadcastBook
from ..live import Programme, pool
from ..manifest import all_events
from .config import ArenaConfig
from .routes_auth import router as auth_router
from .routes_live import now_ms
from .routes_live import router as live_router
from .routes_read import router as read_router
from .routes_submit import router as submit_router
from .routes_unfurl import router as unfurl_router
from .routes_vote import BallotBook
from .routes_vote import router as vote_router
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
    app.state.ballots = config.build_ballots()
    app.state.ballot_book = BallotBook()
    app.state.sessions = Sessions()

    # Broadcasts live in their own directory, not the store: each is consumed
    # once and forgotten twenty airings later, and on the Space every store
    # write is a dataset commit — this many, this briefly needed, would be
    # wasteful there.
    app.state.broadcasts = BroadcastBook(config.broadcast_dir)

    # The programme reads the pool on every rebuild, never per request; the
    # build hash lets a page that has run for days reload after a deploy.
    app.state.programme = Programme(lambda: pool(app.state.store), now_ms, app.state.broadcasts)
    index = config.frontend_dir / "index.html" if config.frontend_dir else None
    app.state.build = hashlib.sha256(index.read_bytes()).hexdigest()[:12] if index else "dev"

    from .. import commentary
    from ..clips import ClipRenderer
    from ..commentary.lore import load

    # Why the booth is off, for the boot to say in one line, or None when it is
    # on. The bible is edited by hand and deployed without a test job, so a
    # malformed one costs the arena its booth, never its board.
    writer = None
    if not config.commentary_enabled:
        app.state.booth_off = "ARENA_COMMENTARY=0"
    elif not (token := commentary.hub_token(config)):
        app.state.booth_off = "no Hub token"
    else:
        try:
            lore = load()
        except (OSError, ValueError) as why:
            app.state.booth_off = f"the commentators' bible does not load: {why}"
        else:
            app.state.booth_off = None
            provider = commentary.router_provider(config.commentary_model, token)
            rng = random.Random()

            def writer(run_id: str) -> dict:
                return commentary.compose(
                    app.state.store, run_id, lore=lore, provider=provider,
                    model=config.commentary_model, book=app.state.broadcasts, rng=rng,
                )

    app.state.clips = ClipRenderer(
        app.state.store, config.origin, config.frontend_dir, config.clip_parallel,
        enabled=config.clips_enabled, backfill=config.clip_backfill,
        landed=lambda run_id: app.state.programme.landed(),
    )
    if config.clip_worker and app.state.clips.available:
        @app.on_event("startup")
        def _render_owed_clips() -> None:
            # A thread, as recovery is: a render is minutes of CPU and the
            # health check cannot wait for it.
            app.state.clips.start()

    from ..commentary.stock import CommentaryStock
    from ..commentary.tab import PlanTab
    from ..recorder import find_chrome

    # No Chrome or no built plan page is a supported setup — a developer
    # machine — not an error, the same as the clip renderer a few lines up:
    # the channel then plays replays with no booths. Without this, a machine
    # with no bundle would loop forever on a page with no window.plan.
    plan_page = config.frontend_dir and (config.frontend_dir / "plan.html").is_file()
    tab = PlanTab(config.origin) if writer and plan_page and find_chrome() else None
    app.state.commentary = CommentaryStock(
        app.state.broadcasts, tab, writer, lambda: pool(app.state.store),
        landed=lambda: app.state.programme.landed(),
    )
    if app.state.commentary.available:
        @app.on_event("startup")
        def _stock_the_booth() -> None:
            # A thread, daemon, one generation at a time: the health check
            # must never wait on a router call.
            app.state.commentary.start()

        @app.on_event("shutdown")
        def _close_the_booth() -> None:
            # The reserve's browser is killed rather than asked to leave, and
            # its profile directory goes with it: neither outlives the process
            # that opened them.
            app.state.commentary.stop()

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

    if config.recover_on_boot:
        @app.on_event("startup")
        def _recover_from_the_hub() -> None:
            """In a daemon thread, because a recovery races policies.

            Each one is a full sweep — seconds of CPU — and a Space that blocked
            its own startup on them would fail its health check before serving a
            single page. The board fills in as they land; it is never empty
            because of this, only incomplete for a moment.
            """
            from ..recover import recover

            def run() -> None:
                try:
                    restored = recover(
                        app.state.store, all_events(), on_event=lambda m: print(f"recover: {m}")
                    )
                    print(f"recover: {len(restored)} run(s) restored from the Hub")
                except Exception as exc:  # noqa: BLE001
                    # A failed recovery must never take the app down with it —
                    # the board simply stays as it was.
                    print(f"recover: aborted ({type(exc).__name__}: {exc})")

            threading.Thread(target=run, name="arena-recover", daemon=True).start()

    app.include_router(read_router)
    app.include_router(submit_router)
    app.include_router(auth_router)
    app.include_router(vote_router)
    app.include_router(unfurl_router)
    app.include_router(live_router)

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
