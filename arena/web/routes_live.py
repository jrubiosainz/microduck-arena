"""The channel's grid and clock: what every screen reads to find its place."""

import json
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..cup import PREFETCH, parse_iso, revealed_at
from ..cupworker import load_cup
from .routes_cups import NO_STORE, _public_match

router = APIRouter(prefix="/api")


def now_ms() -> int:
    return int(time.time() * 1000)


@router.get("/live")
def live(request: Request) -> JSONResponse:
    programme = request.app.state.programme
    return JSONResponse(
        {"version": 1, "now_ms": now_ms(), "build": request.app.state.build,
         "origin_ms": programme.origin_ms, "slots": programme.slots()},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/live/broadcast/{broadcast_id}")
def broadcast(broadcast_id: str, request: Request) -> dict:
    """The dialogue a booth slot names, and the plan that plays it."""
    one = request.app.state.broadcasts.get(broadcast_id)
    if one is None:
        raise HTTPException(status_code=404, detail="no such broadcast")
    return {"dialogue": one.dialogue, "plan": one.plan}


def _written_show(request: Request, event_id: str, number: int) -> dict | None:
    """The cup's show.json, parsed once found (app.state.shows)."""
    shows = request.app.state.shows
    if (event_id, number) not in shows:
        stored = request.app.state.store.cup_file(event_id, number, "show.json")
        if stored is None:
            return None
        shows[(event_id, number)] = json.loads(stored)
    return shows[(event_id, number)]


@router.get("/live/show/{event_id}/{number}/{segment_id}")
def desk(event_id: str, number: int, segment_id: str, request: Request) -> JSONResponse:
    """A desk segment a desk slot names, from PREFETCH before the reveal it may mention: the end of the match it
    follows, or the show's start for the opening, which follows none."""
    cup = load_cup(request.app.state.store, event_id, number)
    show = None if cup is None or cup.order is None else _written_show(request, event_id, number)
    segment = None if show is None else show["desk"].get(segment_id)
    if segment is None:
        raise HTTPException(status_code=404, detail=f"no desk segment {segment_id!r}")
    after = segment["after"]
    opens = parse_iso(cup.order["starts_at"]) if after == -1 else revealed_at(cup, cup.matches[after].match_id)
    if now_ms() < (opens - PREFETCH).timestamp() * 1000:
        raise HTTPException(status_code=404, detail=f"no desk segment {segment_id!r}")
    return JSONResponse({key: segment[key] for key in ("dialogue", "plan", "screen")}, headers=NO_STORE)


@router.get("/live/call/{match_id}")
def call(match_id: str, request: Request) -> JSONResponse:
    """A called match's lines and their plan: they narrate the match, so they are served by its clip media's rule."""
    _, cup, _ = _public_match(request, match_id, media=True)
    show = _written_show(request, cup.event_id, cup.number)
    if show is None:
        raise HTTPException(status_code=404, detail=f"no call for {match_id!r}")
    return JSONResponse(show["calls"][match_id], headers=NO_STORE)
