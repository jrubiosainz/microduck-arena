"""Issuing a ballot, and recording what it decided.

The client never sees a run id. A ballot is a SEALED token, its traces are
served through the ballot rather than through the runs, and a vote names a lane
index. Without that, one look at devtools plus /api/runs/{id} would name the
author, and the anonymity the draw builds would be decorative.

Nothing is remembered between the two calls. The token is signed with the same
HMAC the session cookie uses, so there is no table to expire, no memory to grow,
and a Space restart does not fail a vote in flight.
"""

import base64
import json
import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .. import votes
from ..manifest import Manifest, ManifestError, load_event
from ..points import SCHEDULE
from ..store import Ballot
from ..trace import decode
from .routes_auth import current_user
from .session import sign, unsign

router = APIRouter(prefix="/api")

# Long enough to watch a replay and think, short enough that a ballot held back
# cannot vote for an entry withdrawn since.
BALLOT_TTL_S = 15 * 60

# Tests lower the daily cap rather than casting twenty ballots. None means "use
# the manifest's own number", which is every real deployment.
PER_DAY_OVERRIDE: int | None = None


@dataclass(frozen=True)
class Sealed:
    event_id: str
    voter: str
    run_ids: tuple[str, ...]


class VoteBody(BaseModel):
    ballot: str
    lane: int


def seal(event_id: str, voter: str, run_ids, issued_at: float, secret: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"e": event_id, "v": voter, "r": list(run_ids), "t": issued_at},
            separators=(",", ":"),
        ).encode()
    ).decode().rstrip("=")
    return sign(payload, secret)


def unseal(token: str, secret: str, now: float, ttl_s: float = BALLOT_TTL_S) -> Sealed | None:
    """The ballot, or None. Never raises: this reads attacker-controlled input."""
    payload = unsign(str(token or ""), secret)
    if payload is None:
        return None
    try:
        raw = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not isinstance(raw, dict) or now - float(raw["t"]) > ttl_s:
            return None
        return Sealed(str(raw["e"]), str(raw["v"]), tuple(str(r) for r in raw["r"]))
    except (KeyError, TypeError, ValueError):
        return None


def ballot_id(token: str) -> str:
    """The seal's own MAC.

    Not a fresh id, and that is the double-click guard: two POSTs of one ballot
    address the same file, and the log already refuses to overwrite a file.
    """
    return token.rpartition(".")[2]


def _votable(event_id: str) -> Manifest:
    try:
        manifest = load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if manifest.vote is None:
        raise HTTPException(status_code=404, detail=f"{event_id} does not take votes")
    return manifest


def _voter(request: Request) -> str:
    session = current_user(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Please sign in to vote.")
    return session.username


def _per_day(manifest: Manifest) -> int:
    return PER_DAY_OVERRIDE if PER_DAY_OVERRIDE is not None else manifest.vote.per_day


def _window(request: Request, manifest: Manifest, now: datetime) -> list[Ballot]:
    days = manifest.vote.window_days
    ballots = request.app.state.ballots
    return votes.window(ballots.since(votes.first_day(now, days)), now, days)


@router.get("/events/{event_id}/ballot")
def issue_ballot(event_id: str, request: Request) -> dict:
    """A field to judge, or the reason there is none.

    "Too few ducks" and "quota reached" answer 200 with a state, because neither
    is an error: they are states of a voting session, and the page draws each as
    a panel of its own.
    """
    manifest = _votable(event_id)
    voter = _voter(request)
    store = request.app.state.store
    now = datetime.now(UTC)
    kept = _window(request, manifest, now)

    per_day = _per_day(manifest)
    spent = votes.cast_today(kept, voter, event_id, now)
    if spent >= per_day:
        return {"state": "quota", "cast_today": spent, "per_day": per_day}

    field = votes.pool(
        store.runs(event_id),
        frozenset(w.run_id for w in store.withdrawals()),
        exclude_user=voter,
    )
    picked = votes.draw(
        field,
        votes.impressions(kept),
        manifest.vote.ballot_min,
        manifest.vote.ballot_max,
        random.Random(),
    )
    if picked is None:
        return {"state": "too-few", "have": len(field), "need": manifest.vote.ballot_min}

    return {
        "state": "ballot",
        "ballot": seal(
            event_id,
            voter,
            [r.run_id for r in picked],
            now.timestamp(),
            request.app.state.config.session_secret,
        ),
        # A COUNT, not a palette: lane i wears the frontend's own LANE_CSS[i],
        # and sending the hex codes would be a second copy of a list it has.
        "lanes": len(picked),
        "cast_today": spent,
        "per_day": per_day,
    }


def _open(token: str, request: Request, voter: str, lane: int) -> Sealed:
    sealed = unseal(token, request.app.state.config.session_secret, time.time())
    if sealed is None or sealed.voter != voter or not 0 <= lane < len(sealed.run_ids):
        raise HTTPException(
            status_code=400, detail="That ballot is not valid any more. Ask for a new one."
        )
    return sealed


@router.get("/ballots/{token}/lanes/{lane}/trace")
def ballot_trace(token: str, lane: int, request: Request) -> Response:
    """One lane's replay, addressed through the ballot so no run id is exposed."""
    sealed = _open(token, request, _voter(request), lane)
    trace = decode(request.app.state.store.trace(sealed.run_ids[lane]))
    return Response(
        content=np.ascontiguousarray(trace, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )


@router.post("/events/{event_id}/vote")
def cast_vote(event_id: str, body: VoteBody, request: Request) -> dict:
    manifest = _votable(event_id)
    voter = _voter(request)
    sealed = _open(body.ballot, request, voter, body.lane)
    if sealed.event_id != event_id:
        raise HTTPException(status_code=400, detail="That ballot belongs to another event.")

    now = datetime.now(UTC)
    kept = _window(request, manifest, now)
    per_day = _per_day(manifest)
    spent = votes.cast_today(kept, voter, event_id, now)
    if spent >= per_day:
        raise HTTPException(
            status_code=429, detail=f"That is your {per_day} votes for today. Come back tomorrow."
        )

    ballot = Ballot(
        ballot_id=ballot_id(body.ballot),
        event_id=event_id,
        voter=voter,
        cast_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        candidates=sealed.run_ids,
        choice=sealed.run_ids[body.lane],
    )
    try:
        request.app.state.ballots.cast(ballot)
    except FileExistsError:
        # A double-click, not an error. The id is the seal's MAC, so the second
        # POST addressed the file the first one wrote — nothing to say but so.
        return {"points": 0, "cast_today": spent}
    return {"points": SCHEDULE["ballot"], "cast_today": spent + 1}
