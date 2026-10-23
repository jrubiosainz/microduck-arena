"""`arena duel A B --watch`: a match, played, then shown in the Arena's stadium on 127.0.0.1.

Like the workshop's server, separate from arena/web — no OAuth, no store, never
deployed — and up only for as long as the command runs. The match is played
before it serves (arena.duel.record_match), so everything it answers is already
in memory: the duel and its bouts as JSON, each bout's frames as every trace is
served (routes_read.frames_response), and duel.html, which is built with the site
and plays them in the site's own viewer. It answers GETs of what it played and
nothing else, so there is nothing here for another page to change.
"""

from collections.abc import Sequence
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .constants import CTRL_DT
from .course import WALL_THICKNESS_M
from .duel import DECK_THICKNESS_M, Duel, Match, Recorded
from .web.routes_read import frames_response

NO_SITE = (
    "The duel's page has not been built.\n\n"
    "    cd app && npm install && npm run build\n\n"
    "in the Arena's checkout (an installed Arena wheel carries it already).\n"
)


def duel_summary(duel: Duel, names: Sequence[str], match: Match,
                 recorded: Sequence[Recorded]) -> dict:
    """What duel.html needs besides the frames: the course to build, and the bouts.

    A bout's winner is its deck (0 at -x), as arena.duel.Bout keeps it, and on_deck
    names who stood on each. Its trace's frame f is the bout at (f + 1) * ctrl_dt,
    so the frames past time_s are the tail (arena.duel.record_bout).
    """
    decks, rope = duel.decks, duel.rope
    return {
        "id": duel.id,
        "title": duel.title,
        "rig": duel.rig,
        "names": list(names),
        "ctrl_dt": CTRL_DT,
        "time_limit_s": duel.time_limit_s,
        "course": {
            "gap_m": decks.gap_m,
            "length_m": decks.length_m,
            "width_m": decks.width_m,
            "wall_height_m": decks.wall_height_m,
            "wall_thickness_m": WALL_THICKNESS_M,
            "deck_thickness_m": DECK_THICKNESS_M,
            "pit_depth_m": decks.pit_depth_m,
            "start_x_m": duel.start_x_m,
            "rope_length_m": 2 * duel.start_x_m + rope.slack_m,
            "harness_height_m": rope.harness_height_m,
            "drop_m": duel.referee.drop_m,
            "margin_m": duel.referee.margin_m,
            "fall_hold_s": duel.termination.fall_hold_s,
        },
        "points": list(match.points),
        "bouts": [
            {
                "seed": played.bout.seed,
                "on_deck": [names[0], names[1]] if played.deck0 == 0 else [names[1], names[0]],
                "winner": played.bout.winner,
                "end": played.bout.end,
                "time_s": played.bout.time_s,
                "rope_mid_m": played.bout.rope_mid_m,
                "settle_frames": int(each.settle.shape[1]),
                "frames": int(each.trace.shape[1]),
            }
            for played, each in zip(match.bouts, recorded, strict=True)
        ],
    }


def create_duel_app(duel: Duel, names: Sequence[str], match: Match, recorded: Sequence[Recorded],
                    frontend_dir: Path | None = None) -> FastAPI:
    """`recorded[k]` is match.bouts[k]'s frames (arena.duel.record_match's pair)."""
    app = FastAPI(title="Microduck duel", docs_url=None, redoc_url=None)
    summary = duel_summary(duel, names, match, recorded)

    def bout(k: int) -> Recorded:
        if not 0 <= k < len(recorded):
            raise HTTPException(404, f"the match has bouts 0 to {len(recorded) - 1}")
        return recorded[k]

    @app.get("/api/duel")
    def the_duel() -> dict:
        return summary

    @app.get("/api/duel/bouts/{k}/trace")
    def bout_trace(k: int) -> Response:
        return frames_response(bout(k).trace)

    @app.get("/api/duel/bouts/{k}/settle")
    def bout_settle(k: int) -> Response:
        return frames_response(bout(k).settle)

    if frontend_dir is None:
        @app.get("/")
        def no_site() -> PlainTextResponse:
            return PlainTextResponse(NO_SITE, status_code=503)
    else:
        page = frontend_dir / "duel.html"

        @app.get("/")
        def duel_page() -> FileResponse:
            return FileResponse(page, headers={"Cache-Control": "no-store"})

        # Last, so /api/duel wins: the bundle, the meshes, the design tokens.
        app.mount("/", StaticFiles(directory=frontend_dir), name="site")
    return app
