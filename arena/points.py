"""Player points, folded from the run log like the board is.

A point is a receipt for an ACT — publishing, coming back, beating yourself,
holding a podium place — priced by a flat schedule. A score never converts
into points: the board ranks policies, the ladder ranks people, and the only
place the two meet is the podium bonus, which is read off the board.

Pure and I/O-free on purpose. Nothing here is stored; every request re-derives
the ladder from the same records the board is built from, with the same
filter, so a run either counts everywhere or nowhere.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime

from . import votes
from .constants import RUNNER_VERSION
from .index import by_user, leaderboard, sort_key
from .manifest import Vote
from .store import RunRecord

# Duck Jam's own numbers for the acts that transfer to an arena that never
# closes an event: the "top three at close" bonus becomes "while you hold it".
SCHEDULE = {
    "first_event": 100, "run": 10, "own_best": 25, "podium": (250, 150, 100), "ballot": 2,
}
RUNS_PER_DAY = 3
# The manifest's own number is what applies; this is the value events ship with.
# Enforced HERE as well as at the gate, because a cap only a gate holds is a cap
# that a row written another way walks around.
BALLOTS_PER_DAY = 20


@dataclass(frozen=True)
class Receipt:
    user: str
    act: str
    points: int
    event_id: str
    # A run id, or a ballot id: a receipt is proof of an ACT, and two kinds of
    # log record one now.
    source_id: str
    at: str


@dataclass(frozen=True)
class Card:
    rank: int
    user: str
    points: int


def boards_by_user(
    records,
    withdrawn: frozenset[str],
    ballots=(),
    voted: dict[str, Vote] | None = None,
    now: datetime | None = None,
    runner_version: int = RUNNER_VERSION,
) -> dict:
    """Each event's board with one row per PERSON, whatever the local board shows.

    The podium is a people's prize, so a player with three policies in the top
    three takes one place, not three.

    `voted` maps a votable event id to its rules. Those events are ranked on
    votes instead of on time, which is what makes the podium bonus follow the
    swag contest without a line of its own.
    """
    voted = voted or {}
    by_event: dict[str, list[RunRecord]] = defaultdict(list)
    for run in counting(records, withdrawn, runner_version):
        by_event[run.event_id].append(run)

    out = {}
    for event_id, runs in by_event.items():
        rules = voted.get(event_id)
        if rules is None:
            out[event_id] = leaderboard(
                runs, runner_version, entrant=by_user, withdrawn=withdrawn
            )
            continue
        # `now` is only ever None when there are no ballots to window.
        kept = (
            votes.window([b for b in ballots if b.event_id == event_id], now, rules.window_days)
            if now is not None
            else []
        )
        out[event_id] = votes.standings(
            votes.pool(runs, withdrawn, runner_version=runner_version), kept
        )
    return out


def counting(
    records, withdrawn: frozenset[str], runner_version: int = RUNNER_VERSION
) -> list[RunRecord]:
    """The runs that count, oldest first. Exactly the board's filter."""
    kept = [
        r for r in records
        if r.runner_version == runner_version and r.run_id not in withdrawn
    ]
    return sorted(kept, key=lambda r: (r.submitted_at, r.run_id))


def _receipt(record: RunRecord, act: str, points: int) -> Receipt:
    return Receipt(record.user, act, points, record.event_id, record.run_id, record.submitted_at)


def receipts(
    records,
    withdrawn: frozenset[str],
    ballots=(),
    voted: dict[str, Vote] | None = None,
    now: datetime | None = None,
    runner_version: int = RUNNER_VERSION,
) -> list[Receipt]:
    if ballots and now is None:
        raise ValueError("a sliding window needs a `now`; this module never reads a clock")
    voted = voted or {}
    runs = counting(records, withdrawn, runner_version)
    out: list[Receipt] = []
    per_day: Counter = Counter()
    best: dict[tuple[str, str], RunRecord] = {}
    improved: set[tuple[str, str]] = set()
    for run in runs:
        key = (run.user, run.event_id)
        if key not in best:
            out.append(_receipt(run, "first_event", SCHEDULE["first_event"]))
        day = (run.user, run.submitted_at[:10])
        per_day[day] += 1
        if per_day[day] <= RUNS_PER_DAY:
            out.append(_receipt(run, "run", SCHEDULE["run"]))
        previous = best.get(key)
        if previous is not None and sort_key(run) < sort_key(previous):
            if key not in improved:
                improved.add(key)
                out.append(_receipt(run, "own_best", SCHEDULE["own_best"]))
            best[key] = run
        elif previous is None:
            best[key] = run

    ballots_per_day: Counter = Counter()
    for ballot in sorted(ballots, key=lambda b: (b.cast_at, b.ballot_id)):
        rules = voted.get(ballot.event_id)
        if rules is None:
            continue
        spent = (ballot.voter, ballot.event_id, ballot.day)
        ballots_per_day[spent] += 1
        if ballots_per_day[spent] <= rules.per_day:
            out.append(
                Receipt(
                    ballot.voter,
                    "ballot",
                    SCHEDULE["ballot"],
                    ballot.event_id,
                    ballot.ballot_id,
                    ballot.cast_at,
                )
            )

    for rows in boards_by_user(runs, withdrawn, ballots, voted, now, runner_version).values():
        finishers = [row for row in rows if row.record.seeds_finished > 0]
        for row, points in zip(finishers, SCHEDULE["podium"]):
            out.append(_receipt(row.record, "podium", points))
    return out


def standings(receipts: list[Receipt]) -> list[Card]:
    """One card per player: the total, ranked. Ties go to who published first."""
    points: Counter = Counter()
    since: dict[str, str] = {}
    for receipt in receipts:
        points[receipt.user] += receipt.points
        since[receipt.user] = min(since.get(receipt.user, receipt.at), receipt.at)
    order = sorted(points, key=lambda user: (-points[user], since[user], user))
    return [Card(rank, user, points[user]) for rank, user in enumerate(order, 1)]
