"""Read-only endpoints: what events exist, and who is winning them.

These shape engine objects into the JSON the page renders. No ranking, scoring
or selection logic lives here — `arena.index.leaderboard` owns all of it, so the
web layer and the CLI can never disagree about who is first.
"""

import re
from datetime import UTC, datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from .. import votes
from ..course import wall_boxes
from ..index import leaderboard
from ..manifest import Manifest, ManifestError, all_events, load_event
from ..points import boards_by_user, receipts, standings
from ..store import RunRecord
from ..trace import decode

router = APIRouter(prefix="/api")


def event_summary(manifest: Manifest) -> dict:
    return {
        "id": manifest.id,
        "title": manifest.title,
        "rig": manifest.rig,
        "status": manifest.status,
        # What kind of event this is, for the flyer's label and its shadow
        # colour. The board and the race page do not read it.
        "category": manifest.category,
        "metric": manifest.metric,
        # The whole vote configuration, or null. The page reads this to decide
        # whether the VOTE badge, the vote button and the #/v/ route exist.
        "vote": (
            {
                "ballot_min": manifest.vote.ballot_min,
                "ballot_max": manifest.vote.ballot_max,
                "window_days": manifest.vote.window_days,
                "per_day": manifest.vote.per_day,
            }
            if manifest.vote
            else None
        ),
        "order": manifest.order,
        "length_m": manifest.course.length_m,
        "width_m": manifest.course.width_m,
        "slope_deg": manifest.course.slope_deg,
        # The lane walls the PHYSICS uses, in MJCF coordinates, so the viewer can
        # draw exactly what the robot can hit rather than recomputing where the
        # walls ought to be. They are invisible unless you ask for them.
        "walls": [
            {"name": name, "pos": list(pos), "half": list(half)}
            for name, pos, half in wall_boxes(manifest.course)
        ],
        "time_limit_s": manifest.time_limit_s,
        "seeds": len(manifest.seeds),
        # The sweep, not a single command: the event no longer pins a speed,
        # it declares the range every entry is tried over.
        "sweep_lo": manifest.sweep.lo,
        "sweep_hi": manifest.sweep.hi,
        "sweep_step": manifest.sweep.step,
        "sweep_count": len(manifest.sweep.speeds()),
    }


def _event_or_404(event_id: str) -> Manifest:
    try:
        return load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _withdrawn(store) -> frozenset[str]:
    return frozenset(w.run_id for w in store.withdrawals())


def _voted() -> dict:
    """Every event that takes ballots, with its rules. The fold needs both."""
    return {m.id: m.vote for m in all_events() if m.vote is not None}


def _ballots(request: Request, rules: dict, now: datetime) -> list:
    """Every ballot inside the widest window any votable event declares.

    Takes `rules` and `now` rather than computing them itself, so a request
    that also needs them (every caller does) parses the event programme once.
    """
    if not rules:
        return []
    widest = max(v.window_days for v in rules.values())
    return request.app.state.ballots.since(votes.first_day(now, widest))


def _all_runs(store) -> list[RunRecord]:
    """Every event's log, because points and ladders are across the programme."""
    return [record for manifest in all_events() for record in store.runs(manifest.id)]


@router.get("/events")
def list_events() -> dict:
    # Sorted here, once, rather than in the page: the order is a property of
    # the programme, and every client should read it the same way.
    programme = sorted(all_events(), key=lambda m: (m.order, m.title))
    return {"events": [event_summary(m) for m in programme]}


def _board_row(row) -> dict:
    """The fields every board shows, timed or voted."""
    record = row.record
    return {
        "rank": row.rank,
        "user": record.user,
        "policy_name": record.policy_name,
        "livery": record.livery,
        "score": record.score,
        "command_vx": record.command_vx,
        # Whether this row offers a download. False for runs recorded
        # before policies were kept, so the page shows nothing rather
        # than a link that 404s.
        "model_stored": record.model_stored,
        "env_url": record.env_url,
        # The single rule the board renders from: `model_stored` or a
        # Hub-backed source. See RunRecord.offers_download.
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "run_id": record.run_id,
        "submitted_at": record.submitted_at,
    }


@router.get("/events/{event_id}/leaderboard")
def event_leaderboard(event_id: str, request: Request) -> dict:
    manifest = _event_or_404(event_id)
    config = request.app.state.config
    store = request.app.state.store
    withdrawn = _withdrawn(store)
    records = store.runs(manifest.id)

    if manifest.metric == "votes":
        # A separate function, not a parameterised leaderboard: index.sort_key
        # means "lower is better" and is correct for five live timed events.
        # Teaching it a second direction would put all of them at risk.
        now = datetime.now(UTC)
        days = manifest.vote.window_days
        ballots = request.app.state.ballots
        # Filtered to THIS event, like points.boards_by_user already does —
        # ballots.since() returns every votable event's ballots inside the
        # window, and without this an event's tally would read another
        # event's votes too. Correct today only because run ids are globally
        # unique, which made the leak invisible rather than absent.
        own = [b for b in ballots.since(votes.first_day(now, days)) if b.event_id == event_id]
        kept = votes.window(own, now, days)
        rows = votes.standings(votes.pool(records, withdrawn), kept)
        out = [_board_row(row) for row in rows]
        for shaped, row in zip(out, rows):
            shaped["votes"], shaped["shown"] = row.votes, row.shown
        return {"event": event_summary(manifest), "rows": out}

    rows = leaderboard(records, entrant=config.entrant, withdrawn=withdrawn)
    return {"event": event_summary(manifest), "rows": [_board_row(row) for row in rows]}


@router.get("/standings")
def player_standings(request: Request) -> dict:
    """One ladder across every event: the sum of each player's receipts, ranked."""
    store = request.app.state.store
    rules, now = _voted(), datetime.now(UTC)
    cards = standings(
        receipts(
            _all_runs(store),
            _withdrawn(store),
            ballots=_ballots(request, rules, now),
            voted=rules,
            now=now,
        )
    )
    return {"rows": [{"rank": c.rank, "user": c.user, "points": c.points} for c in cards]}


@router.get("/players/{user}")
def player_page(user: str, request: Request) -> dict:
    """A player's total, rank, and best run on every event they entered."""
    store = request.app.state.store
    runs, withdrawn = _all_runs(store), _withdrawn(store)
    rules, now = _voted(), datetime.now(UTC)
    ballots = _ballots(request, rules, now)
    card = next(
        (
            c
            for c in standings(receipts(runs, withdrawn, ballots, rules, now))
            if c.user == user
        ),
        None,
    )
    if card is None:
        raise HTTPException(status_code=404, detail=f"{user!r} has not published yet")
    boards = boards_by_user(runs, withdrawn, ballots, rules, now)
    best = []
    for manifest in sorted(all_events(), key=lambda m: (m.order, m.title)):
        row = next((r for r in boards.get(manifest.id, []) if r.record.user == user), None)
        if row is None:
            continue
        best.append({
            "event_id": manifest.id,
            "event_title": manifest.title,
            "rank": row.rank,
            "score": row.record.score,
            "seeds_finished": row.record.seeds_finished,
            "seeds_total": len(row.record.per_seed),
            "policy_name": row.record.policy_name,
            "run_id": row.record.run_id,
            "submitted_at": row.record.submitted_at,
            # None off a timed board, a count off a voted one — so the page
            # can tell a reader what the rank next to it was EARNED by. A
            # bare "#1 · 18.46s" reads as a time on a board actually ranked
            # by votes.
            "votes": row.votes if manifest.metric == "votes" else None,
        })
    return {"user": user, "points": card.points, "rank": card.rank, "best": best}


def _find_run(store, run_id: str) -> RunRecord:
    """Scan every event for a run id.

    Run ids are globally unique, so the id alone addresses a run and the URL
    needs no event. With one small local store, scanning is cheaper than
    maintaining an index; the deployed version gets the in-memory index instead.
    """
    for manifest in all_events():
        for record in store.runs(manifest.id):
            if record.run_id == run_id:
                return record
    raise HTTPException(status_code=404, detail=f"no such run: {run_id!r}")


@router.get("/runs/{run_id}")
def run_detail(run_id: str, request: Request) -> dict:
    store = request.app.state.store
    record = _find_run(store, run_id)
    frames = decode(store.trace(run_id)).shape[0]
    return {
        "run_id": record.run_id,
        "event_id": record.event_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "score": record.score,
        "seeds_finished": record.seeds_finished,
        "per_seed": [
            {"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in record.per_seed
        ],
        "trace_seed": record.trace_seed,
        "submitted_at": record.submitted_at,
        "runner_version": record.runner_version,
        "frames": frames,
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
    }


# Same cap the intake enforces, so a download cannot be larger than an upload
# was allowed to be.
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_-]+")


def policy_filename(policy_name: str, user: str) -> str:
    """A filename a person can find again in their downloads folder.

    Derived from submitter-supplied text, so it is sanitised rather than
    trusted: a policy called `../../etc/passwd` or one with a quote in it must
    not be able to shape a Content-Disposition header or a path.

    Dots are dropped from the stem rather than kept, which costs `v1.2` its dot
    and removes the whole family of `..` and `policy.onnx.exe` confusions in
    exchange. The extension is appended here, so it is the only one.
    """
    # Collapsed, not just substituted: "../../etc" would otherwise become
    # "--etc" and read as a mangled filename rather than a clean one.
    stem = _SAFE_NAME.sub("-", f"{user}-{policy_name}")
    stem = re.sub(r"-{2,}", "-", stem).strip("-")[:60].strip("-")
    return f"{stem or 'policy'}.onnx"


@router.get("/runs/{run_id}/policy")
def run_policy(run_id: str, request: Request) -> Response:
    """The published .onnx itself, so anyone can race someone else's policy.

    This is what makes the board more than a scoreboard: a time you cannot
    reproduce is a claim, and a time whose weights you can download and run
    yourself is a result. Only published runs are here — a trial is evaluated
    and kept nowhere, which is the whole point of having a trial button.
    """
    store = request.app.state.store
    record = _find_run(store, run_id)
    source = record.source or {}
    if source.get("kind") == "hub" and source.get("url"):
        # The weights live with their author. Redirect rather than proxy: the
        # Hub serves them faster than this Space can, and a proxied download
        # would put every byte through a 2-vCPU container.
        return RedirectResponse(source["url"])
    if not record.model_stored:
        raise HTTPException(
            status_code=404,
            detail=f"run {run_id} was recorded before policies were kept, "
            "so its weights are not in the store",
        )
    return Response(
        content=store.model(record.model_sha256),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition":
                f'attachment; filename="{policy_filename(record.policy_name, record.user)}"',
            # The name is a hash of the contents, so the bytes behind this run
            # can never change. Worth caching hard.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Model-SHA256": record.model_sha256,
        },
    )


@router.get("/runs/{run_id}/trace")
def run_trace(run_id: str, request: Request) -> Response:
    """Raw little-endian float32, TRACE_WIDTH values per frame.

    The stored form is compressed float16 npz, which a browser cannot read. This
    decodes it server-side so the frontend is one `new Float32Array(buffer)` away
    from a replay — no numpy-in-JavaScript, no base64 bloat.
    """
    store = request.app.state.store
    _find_run(store, run_id)  # 404 before touching the trace file
    trace = decode(store.trace(run_id))
    payload = np.ascontiguousarray(trace, dtype="<f4").tobytes()
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )
