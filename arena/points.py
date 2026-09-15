"""Player points, folded from the run log like the board is.

A point is a receipt for an ACT — publishing, coming back, beating yourself,
holding a podium place — priced by a flat schedule. A score never converts
into points: the board ranks policies, the ladder ranks people, and the only
place the two meet is the podium bonus, which is read off the board.

Pure and I/O-free on purpose. Nothing here is stored; every request re-derives
the ladder from the same records the board is built from, with the same
filter, so a run either counts everywhere or nowhere.
"""

from collections import Counter
from dataclasses import dataclass

from .constants import RUNNER_VERSION
from .index import sort_key
from .store import RunRecord

# Duck Jam's own numbers for the acts that transfer to an arena that never
# closes an event: the "top three at close" bonus becomes "while you hold it".
SCHEDULE = {"first_event": 100, "run": 10, "own_best": 25, "podium": (250, 150, 100)}
RUNS_PER_DAY = 3


@dataclass(frozen=True)
class Receipt:
    user: str
    act: str
    points: int
    event_id: str
    run_id: str
    at: str


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
    records, withdrawn: frozenset[str], runner_version: int = RUNNER_VERSION
) -> list[Receipt]:
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
    return out
