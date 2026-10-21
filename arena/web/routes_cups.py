"""The weekly cup and its matches, as of now.

`cup_view` owns what a cup may say at a given moment; this module adds the same secrecy for a match: its clip's media
are served from `airs_at - PREFETCH`, everything else of it from `revealed_at`. The clip job's own app
(`reveal_all`) reads them all, since it renders clips before there is a running order.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from ..cup import (
    PREFETCH,
    Cup,
    MatchRecord,
    airs_at,
    closed_cups,
    cup_times,
    cup_view,
    iso,
    match_title,
    parse_match_id,
    revealed_at,
)
from ..cupworker import entrants_at, load_cup
from ..manifest import Manifest, ManifestError, load_event
from ..store import clip_version
from ..trace import decode, decode_settle
from .routes_read import clip_file_response, event_summary, frames_response

router = APIRouter(prefix="/api")
NO_STORE = {"Cache-Control": "no-store"}


def now() -> datetime:
    return datetime.now(UTC)


def _cups_event(event_id: str) -> Manifest:
    try:
        manifest = load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if manifest.cup is None:
        raise HTTPException(status_code=404, detail=f"{event_id} has no cup")
    return manifest


def _unsettled(store, manifest: Manifest, number: int, moment: datetime) -> Cup:
    """A cup that is open, or closed and not drawn yet: the field as it stands, or stood at the close."""
    close_at, premiere_at = cup_times(manifest.cup, number)
    moment = min(moment, close_at)
    withdrawn = frozenset(w.run_id for w in store.withdrawals() if w.withdrawn_at <= iso(moment))
    return Cup(manifest.id, number, iso(close_at), iso(premiere_at), "",
               tuple(entrants_at(store.runs(manifest.id), withdrawn, moment)), ())


def _cup(store, manifest: Manifest, number: int, moment: datetime) -> Cup:
    return load_cup(store, manifest.id, number) or _unsettled(store, manifest, number, moment)


@router.get("/events/{event_id}/cups")
def list_cups(event_id: str, request: Request) -> JSONResponse:
    store, manifest, moment = request.app.state.store, _cups_event(event_id), now()
    closed = closed_cups(manifest.cup, moment)
    cups = []
    for number in range(closed, 0, -1):
        cup = _cup(store, manifest, number, moment)
        view = cup_view(cup, moment)
        champion = view.get("champion")
        cups.append({"number": number, "premiere_at": cup.premiere_at, "starts_at": view["starts_at"],
                     "state": view["state"], "champion": None if champion is None else cup.entrants[champion].user})
    upcoming = cup_view(_unsettled(store, manifest, closed + 1, moment), moment)
    return JSONResponse({"next": {k: upcoming[k] for k in ("number", "close_at", "premiere_at", "entrants")}, "cups": cups},
                        headers=NO_STORE)


@router.get("/events/{event_id}/cups/{number}")
def get_cup(event_id: str, number: int, request: Request) -> JSONResponse:
    store, manifest, moment = request.app.state.store, _cups_event(event_id), now()
    open_number = closed_cups(manifest.cup, moment) + 1
    if not 1 <= number <= open_number:
        raise HTTPException(status_code=404, detail=f"{event_id} has no cup #{number}")
    return JSONResponse({"event": event_summary(manifest), "open": open_number, "min_entrants": manifest.cup.min_entrants,
                         **cup_view(_cup(store, manifest, number, moment), moment)}, headers=NO_STORE)


def _public_match(request: Request, match_id: str, media: bool = False) -> tuple[Manifest, Cup, MatchRecord]:
    """The match, or a 404 until it may be told: from its reveal, or from `airs_at - PREFETCH` for its clip's media.

    The live prepares a clip before its slot, so its media are fetchable from 30 s before airing: a determined viewer
    can learn a result one clip early, the price of a smooth live. Plan D serves its call by the same rule.
    """
    parsed = parse_match_id(match_id)
    if parsed is None:
        raise HTTPException(status_code=404, detail=f"no match {match_id!r}", headers=NO_STORE)
    event_id, number, index = parsed
    manifest = _cups_event(event_id)
    cup = load_cup(request.app.state.store, event_id, number)
    if cup is None or index >= len(cup.matches):
        raise HTTPException(status_code=404, detail=f"no match {match_id!r}", headers=NO_STORE)
    if not request.app.state.config.reveal_all:
        airs = airs_at(cup, match_id)  # None before there is a running order
        if airs is None or now() < (airs - PREFETCH if media else revealed_at(cup, match_id)):
            raise HTTPException(status_code=404, detail=f"no match {match_id!r}", headers=NO_STORE)
    return manifest, cup, cup.matches[index]


@router.get("/matches/{match_id}")
def get_match(match_id: str, request: Request) -> JSONResponse:
    manifest, cup, match = _public_match(request, match_id)
    state, written = request.app.state.store.clip_state(match_id)
    return JSONResponse({
        "match_id": match_id, "event": event_summary(manifest), "cup": cup.number, "round": match.round,
        "group": match.group, "title": match_title(cup, match), "a": cup.entrants[match.a].view(),
        "b": cup.entrants[match.b].view(), "bouts": [bout.to_dict() for bout in match.bouts],
        "wins": list(match.wins), "winner": "a" if match.winner == match.a else "b", "decided_by": match.decided_by,
        "clip": clip_version(written) if state == "ready" else None,
    }, headers=NO_STORE)


def _bout_file(request: Request, match_id: str, k: int) -> bytes:
    _, cup, match = _public_match(request, match_id)
    if not 0 <= k < len(match.bouts):
        raise HTTPException(status_code=404, detail=f"match {match_id} has no bout {k}")
    return request.app.state.store.cup_file(cup.event_id, cup.number, f"bouts/{match_id}-{k}.npz")


@router.get("/matches/{match_id}/bouts/{k}/trace")
def match_trace(match_id: str, k: int, request: Request) -> Response:
    return frames_response(decode(_bout_file(request, match_id, k)))


@router.get("/matches/{match_id}/bouts/{k}/settle")
def match_settle(match_id: str, k: int, request: Request) -> Response:
    return frames_response(decode_settle(_bout_file(request, match_id, k)))


@router.get("/matches/{match_id}/clip/{name}")
def match_clip_file(match_id: str, name: str, request: Request) -> FileResponse:
    _public_match(request, match_id, media=True)
    return clip_file_response(request.app.state.store, match_id, name)
