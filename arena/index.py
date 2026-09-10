"""The leaderboard is derived, never stored.

Scanned from the append-only log, so a restart costs a re-scan and nothing else.

**One run per entrant** — but who counts as an entrant depends on who is
looking. On a public board the entrant is the PERSON, or one determined
competitor with forty retrains owns the whole top ten. On a local board there is
exactly one person, and collapsing to one row per person leaves a single line no
matter how many policies you try — so locally the entrant is the POLICY, and
`walker-v1` races `walker-v2`. Same ranking arithmetic either way; only the key
differs. `by_user` is the default so the public semantics are what you get
unless a caller deliberately asks otherwise.
"""

from dataclasses import dataclass

from .constants import RUNNER_VERSION
from .store import RunRecord


@dataclass(frozen=True)
class Row:
    rank: int
    record: RunRecord


def sort_key(record: RunRecord) -> tuple:
    """Lower is better: score, then more seeds finished, then who got there first."""
    return (record.score, -record.seeds_finished, record.submitted_at)


def by_user(record: RunRecord) -> str:
    """One row per person. The public board's rule."""
    return record.user


def by_policy(record: RunRecord) -> tuple[str, str]:
    """One row per policy a person entered. The local board's rule."""
    return (record.user, record.policy_name)


ENTRANTS = {"user": by_user, "policy": by_policy}


def leaderboard(records, runner_version: int = RUNNER_VERSION, entrant=by_user) -> list[Row]:
    best: dict = {}
    for record in records:
        if record.runner_version != runner_version:
            continue  # a different physics; never comparable
        key = entrant(record)
        current = best.get(key)
        if current is None or sort_key(record) < sort_key(current):
            best[key] = record

    ranked = sorted(best.values(), key=sort_key)
    return [Row(rank=i + 1, record=r) for i, r in enumerate(ranked)]
