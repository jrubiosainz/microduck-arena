"""Issuing a ballot, and recording what it decided.

The client never sees a run id. A ballot is an OPAQUE token: the run ids it
names live only in server memory, in `BallotBook`, the same shape and the same
documented trade as the session table two files away (`session.py`: "The
table is in memory on purpose... not worth a database"). A restart now costs a
ballot in flight, which is a 15-minute object rather than an 8-hour one.

An earlier version of this module sealed the run ids into a signed token
instead. Review caught it in implementation: `sign()` is an HMAC, and an HMAC
proves the server wrote a value — it does not hide it. The payload decoded in
plain base64 (`atob()` plus /api/runs/{id} named every author), which is
exactly the failure the lane-index API and the per-lane trace route exist to
prevent. See the superseded row in the design doc's Decisions table.

Its lanes' traces are served through the ballot rather than through the runs,
and a vote names a lane index. A ballot is single-use: the table marks it
`spent` the moment its vote is recorded, so a double-click — or the same
ballot replayed either side of UTC midnight, where the log's own day-sharding
cannot help — gets the same idempotent answer.
"""

import dataclasses
import random
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import votes
from ..manifest import Manifest, ManifestError, load_event
from ..points import SCHEDULE
from ..store import Ballot
from ..trace import decode
from .routes_auth import current_user

router = APIRouter(prefix="/api")

# Long enough to watch a replay and think, short enough that a ballot held back
# cannot vote for an entry withdrawn since.
BALLOT_TTL_S = 15 * 60


@dataclass(frozen=True)
class BallotEntry:
    """What one token stands for. Never serialised to the client."""

    event_id: str
    voter: str
    run_ids: tuple[str, ...]
    expires_at: float
    spent: bool = False


class BallotBook:
    """The ballot table: what a token stands for, held only in memory.

    Modelled on `Sessions` (session.py) — same shape, same lock — but NOT the
    same eviction path. A session id is looked up on every request, so
    `Sessions.get` sweeping the one row it was asked for is enough; a ballot
    token is looked up only if its voter goes on to vote or open a lane, so
    most entries are never touched again and would otherwise sit forever. So
    `issue()` also sweeps every expired entry, under the same lock, before
    adding the one it is about to mint.
    """

    def __init__(self) -> None:
        self._by_token: dict[str, BallotEntry] = {}
        self._lock = threading.Lock()

    def _sweep(self, now: float) -> None:
        """Drop every entry past its own TTL. Called only under `_lock`."""
        expired = [token for token, entry in self._by_token.items() if now > entry.expires_at]
        for token in expired:
            del self._by_token[token]

    def issue(
        self, event_id: str, voter: str, run_ids, ttl_s: float = BALLOT_TTL_S, now: float | None = None
    ) -> str:
        # token_urlsafe, not a fresh id scheme of our own: its alphabet is
        # exactly [A-Za-z0-9_-], which is what makes it safe to use as-is for
        # both a URL path segment and (below) the ballot log's own filename.
        token = secrets.token_urlsafe(32)
        moment = time.time() if now is None else now
        with self._lock:
            self._sweep(moment)
            self._by_token[token] = BallotEntry(event_id, voter, tuple(run_ids), moment + ttl_s)
        return token

    def get(self, token: str, now: float | None = None) -> BallotEntry | None:
        """The entry, or None. Never raises: this reads attacker-controlled input."""
        moment = time.time() if now is None else now
        with self._lock:
            entry = self._by_token.get(token)
            if entry is None:
                return None
            if moment > entry.expires_at:
                # Evicted, not just reported stale, so a long-lived process
                # does not accumulate dead ballots.
                del self._by_token[token]
                return None
            return entry

    def spend(self, token: str) -> None:
        """Mark a ballot cast. It stays in the table — just no longer usable."""
        with self._lock:
            entry = self._by_token.get(token)
            if entry is not None:
                self._by_token[token] = dataclasses.replace(entry, spent=True)


class VoteBody(BaseModel):
    ballot: str
    lane: int


# The quota's check and the ballot's write are one critical section. Reading
# cast_today scans a week of shards — real seconds that grow with the
# contest — and without a lock four concurrent votes against a cap of one
# each read the same "0 so far" and all four land. Per-process is the right
# scope: a Space is one container.
_vote_lock = threading.Lock()


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


def _window(request: Request, manifest: Manifest, now: datetime) -> list[Ballot]:
    days = manifest.vote.window_days
    ballots = request.app.state.ballots
    return votes.window(ballots.since(votes.first_day(now, days)), now, days)


@router.get("/events/{event_id}/ballot")
def issue_ballot(event_id: str, request: Request, response: Response) -> dict:
    """A field to judge, or the reason there is none.

    "Too few ducks" and "quota reached" answer 200 with a state, because
    neither is an error: they are states of a voting session, and the page
    draws each as a panel of its own. The body is per-user (a fresh token,
    your own cast_today), so — like /api/me — it must never be cached and
    served to the next visitor.
    """
    response.headers["Cache-Control"] = "no-store"
    manifest = _votable(event_id)
    voter = _voter(request)
    store = request.app.state.store
    now = datetime.now(UTC)
    kept = _window(request, manifest, now)

    per_day = manifest.vote.per_day
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

    token = request.app.state.ballot_book.issue(event_id, voter, [r.run_id for r in picked])
    return {
        "state": "ballot",
        "ballot": token,
        # A COUNT, not a palette: lane i wears the frontend's own LANE_CSS[i],
        # and sending the hex codes would be a second copy of a list it has.
        "lanes": len(picked),
        # How each lane's duck sounds, in lane order: the performance itself, never who made it.
        "triggers": [r.triggers for r in picked],
        "cast_today": spent,
        "per_day": per_day,
    }


def _open(token: str, request: Request, voter: str, lane: int) -> BallotEntry:
    entry = request.app.state.ballot_book.get(token)
    if entry is None or entry.voter != voter or not 0 <= lane < len(entry.run_ids):
        raise HTTPException(
            status_code=400, detail="That ballot is not valid any more. Ask for a new one."
        )
    return entry


@router.get("/ballots/{token}/lanes/{lane}/trace")
def ballot_trace(token: str, lane: int, request: Request) -> Response:
    """One lane's replay, addressed through the ballot so no run id is exposed."""
    entry = _open(token, request, _voter(request), lane)
    try:
        trace = decode(request.app.state.store.trace(entry.run_ids[lane]))
    except FileNotFoundError as exc:
        # Mirrors routes_read.run_trace: 404 before ever assuming the bytes
        # are there, never a 500 surfaced from a missing file.
        raise HTTPException(status_code=404, detail="that lane has no replay") from exc
    return Response(
        content=np.ascontiguousarray(trace, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )


@router.post("/events/{event_id}/vote")
def cast_vote(event_id: str, body: VoteBody, request: Request) -> dict:
    manifest = _votable(event_id)
    voter = _voter(request)
    entry = _open(body.ballot, request, voter, body.lane)
    if entry.event_id != event_id:
        raise HTTPException(status_code=400, detail="That ballot belongs to another event.")

    book = request.app.state.ballot_book
    now = datetime.now(UTC)
    with _vote_lock:
        # Re-read under the lock: another request may have spent this very
        # token, or moved today's count, in the time since _open() above ran
        # outside it.
        #
        # The cliff this lock names: on a deployed Space it spans THREE Hub
        # round trips — the snapshot_download inside _window() below, then
        # file_exists and create_commit inside ballots.cast() further down —
        # so every voter on every votable event queues behind whoever is
        # mid-commit. Deliberate, not accidental: at twenty ballots a day per
        # person it costs nothing, and a per-voter lock table is machinery
        # this does not need yet. If it ever bites, this is where to look.
        fresh = book.get(body.ballot)
        spent = votes.cast_today(_window(request, manifest, now), voter, event_id, now)
        if fresh is None or fresh.spent:
            # A double-click, or this same ballot replayed either side of UTC
            # midnight — not an error. The ballot is single-use, so there is
            # nothing to say but so.
            return {"points": 0, "cast_today": spent}
        if spent >= manifest.vote.per_day:
            raise HTTPException(
                status_code=429,
                detail=f"That is your {manifest.vote.per_day} votes for today. "
                "Come back tomorrow.",
            )

        ballot = Ballot(
            ballot_id=body.ballot,
            event_id=event_id,
            voter=voter,
            cast_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            candidates=fresh.run_ids,
            choice=fresh.run_ids[body.lane],
        )
        try:
            request.app.state.ballots.cast(ballot)
        except FileExistsError:
            # Belt-and-braces only: `fresh.spent` above is what actually
            # guards this now, since the log's own day-sharding cannot.
            return {"points": 0, "cast_today": spent}
        book.spend(body.ballot)
        return {"points": SCHEDULE["ballot"], "cast_today": spent + 1}
