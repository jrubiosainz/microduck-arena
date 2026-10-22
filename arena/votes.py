"""Ballots, folded into a ranking. The third fold over the same logs.

A vote is a receipt like a run is: nothing here is stored, every request
re-derives the board from the ballots on disk. That is what lets a score MOVE —
the window slides, so an entry is never protected by its age, and last week's
votes leave the ranking on their own.

Pure and I/O-free on purpose, like points.py. `now` is a parameter; this module
never reads a clock, because a sliding window that reads its own clock cannot be
tested at its edges.
"""

import random
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta

from .constants import RUNNER_VERSION
from .store import Ballot, RunRecord

STAMP = "%Y-%m-%dT%H:%M:%SZ"

# Every entry starts the window as if it had already been on this many ballots and
# won the average share of them. Two lucky ballots then cannot outrank a week of
# judging, and an entry's own record outweighs this head start within a day or two.
HEAD_START = 20


@dataclass(frozen=True)
class VotedRow:
    """A row of a voted board.

    `rate` is what ranks it; `votes` and `shown` ride along because a rate only
    means something next to the ballots that produced it.
    """

    rank: int
    record: RunRecord
    votes: int
    shown: int
    rate: float


def first_day(now: datetime, days: int) -> str:
    """The earliest DAY the window can touch, as a shard name."""
    return (now - timedelta(days=days)).date().isoformat()


def window(ballots, now: datetime, days: int) -> list[Ballot]:
    """The ballots inside the sliding window, oldest first.

    Compared as STRINGS, which is safe because every stamp in the logs is
    written in the same fixed UTC format (see routes_submit.py) and misordering
    an offset is exactly the bug that format exists to prevent.
    """
    edge = (now - timedelta(days=days)).strftime(STAMP)
    return [b for b in ballots if b.cast_at >= edge]


def tally(ballots) -> Counter:
    """run id -> votes received."""
    return Counter(b.choice for b in ballots)


def impressions(ballots) -> Counter:
    """run id -> times SHOWN.

    The rate's denominator, so how often an entry was shown never decides its
    place, and per voter what the draw deals from. It costs nothing to know, because a ballot records every candidate
    and not only its winner.
    """
    return Counter(run_id for b in ballots for run_id in b.candidates)


def cast_today(ballots, voter: str, event_id: str, now: datetime) -> int:
    """How many of this voter's daily quota is spent on this event.

    Per event, not global: the cap lives in each manifest, so a second votable
    challenge grants its own twenty rather than sharing one pool.
    """
    today = now.date().isoformat()
    return sum(
        1 for b in ballots if b.voter == voter and b.event_id == event_id and b.day == today
    )


def pool(
    records,
    withdrawn: frozenset[str],
    exclude_user: str | None = None,
    runner_version: int = RUNNER_VERSION,
) -> list[RunRecord]:
    """The ducks that can appear on a ballot, oldest entry first.

    The board's own filter, plus three rules. A duck that never finished a seed
    makes a dead lane. One entry per person — their most recent — because the
    board holds one row per person. And never your own,
    which is `exclude_user`: a ballot you can recognise yourself in is not
    anonymous.
    """
    best: dict[str, RunRecord] = {}
    for record in records:
        if record.runner_version != runner_version or record.run_id in withdrawn:
            continue
        if record.seeds_finished <= 0:
            continue
        if exclude_user is not None and record.user == exclude_user:
            continue
        current = best.get(record.user)
        if current is None or (record.submitted_at, record.run_id) > (
            current.submitted_at,
            current.run_id,
        ):
            best[record.user] = record
    return sorted(best.values(), key=lambda r: (r.submitted_at, r.run_id))


def draw(
    candidates,
    mine: Counter,
    ballot_min: int,
    ballot_max: int,
    rng: random.Random,
) -> list[RunRecord] | None:
    """One ballot's field, in lane order. None when there are too few ducks.

    Shuffle, then sort by what THIS voter has been shown least (`mine`): a
    series of ballots walks a voter through every entry before any comes back,
    and the shuffle deals each round's ballots afresh, so an entry meets new
    rivals every round. Never by what everyone has been shown: entries drawn
    together gain a showing together, so that sort deals the same groups round
    after round — and on its own it handed every voter the day's newcomers on
    every ballot until they caught up with entries a week old. The rate does not
    need equal exposure. The second shuffle fixes lane order, which IS the
    colour assignment — the same duck comes out orange on one ballot and
    lavender on the next, and that is what keeps a ballot anonymous.
    """
    field = list(candidates)
    if len(field) < ballot_min:
        return None
    rng.shuffle(field)
    field.sort(key=lambda r: mine[r.run_id])
    picked = field[:ballot_max]
    rng.shuffle(picked)
    return picked


def standings(candidates, ballots) -> list[VotedRow]:
    """The voted board: best rate first, ties to whoever published first.

    A rate, votes per ballot shown on, and not a raw count: a count measures how
    often an entry was shown as much as how good it is.
    """
    votes, seen = tally(ballots), impressions(ballots)
    # The share of a ballot an entry wins on average: a quarter when every ballot has four lanes.
    average = len(ballots) / max(1, sum(seen.values()))
    rate = {
        r.run_id: (votes[r.run_id] + HEAD_START * average) / (seen[r.run_id] + HEAD_START)
        for r in candidates
    }
    ranked = sorted(candidates, key=lambda r: (-rate[r.run_id], r.submitted_at, r.run_id))
    return [
        VotedRow(rank=i, record=r, votes=votes[r.run_id], shown=seen[r.run_id], rate=rate[r.run_id])
        for i, r in enumerate(ranked, 1)
    ]


def placed(records, run_id: str, ballots, withdrawn: frozenset[str]) -> tuple[int, bool, list[VotedRow]]:
    """Where ONE run stands on the voted board, on it or not: `index.standing`'s rule, by rate.

    The board holds each person's latest finished entry (`pool`). This run takes its author's
    place at its rank by rate; `on_board` says whether it is the entry holding that place.
    """
    record = next(r for r in records if r.run_id == run_id)
    entries = pool(records, withdrawn)
    rows = standings([*(r for r in entries if r.user != record.user), record], ballots)
    rank = next(row.rank for row in rows if row.record.run_id == run_id)
    return rank, any(r.run_id == run_id for r in entries), rows
