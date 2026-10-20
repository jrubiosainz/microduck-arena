"""A match between two entries: first to `bouts_to_win` bouts, sides swapped after each bout."""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .course import compile_tug
from .manifest import Manifest
from .tug import run_bout


def bout_seed(secret: str, match_id: str, k: int) -> int:
    """The seed of bout `k` of a match: a hash of the cup's secret, so no entrant can know it."""
    digest = hashlib.sha256(f"{secret}:{match_id}:{k}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


@dataclass(frozen=True)
class BoutResult:
    k: int
    seed: int
    a_side: str  # "west" in bouts 0, 2, 4; "east" in 1, 3
    winner: str | None  # "a" | "b" | None (a draw counts for nobody)
    how: str  # BoutOutcome.how: "pit" | "marker" | "draw"
    time_s: float

    def to_dict(self) -> dict:
        return {"k": self.k, "seed": self.seed, "a_side": self.a_side, "winner": self.winner,
                "how": self.how, "time_s": self.time_s}

    @classmethod
    def from_dict(cls, raw: dict) -> "BoutResult":
        return cls(raw["k"], raw["seed"], raw["a_side"], raw["winner"], raw["how"], raw["time_s"])


@dataclass(frozen=True)
class MatchOutcome:
    bouts: tuple[BoutResult, ...]
    traces: tuple[tuple[np.ndarray, np.ndarray], ...]  # (trace, settle) per bout, west first
    wins: tuple[int, int]  # (a, b)
    winner: str  # "a" | "b"
    decided_by: str  # "bouts" | "rating"


def play_match(manifest: Manifest, a, b, seeds: Sequence[int], ratings: tuple[float, float],
               model=None) -> MatchOutcome:
    """Play bouts until a side wins `bouts_to_win`; after `max_bouts` more wins, then the higher rating, then a."""
    rules = manifest.bout
    if len(seeds) != rules.max_bouts:
        raise ValueError(f"a match takes one seed per possible bout: {rules.max_bouts} (max_bouts), got {len(seeds)}")
    model = model if model is not None else compile_tug(manifest)
    bouts, traces, wins = [], [], [0, 0]
    for k, seed in enumerate(seeds):
        a_west = k % 2 == 0
        outcome = run_bout(manifest, *((a, b) if a_west else (b, a)), seed, model)
        winner = None if outcome.loser is None else ("a" if (outcome.loser == 1) == a_west else "b")
        bouts.append(BoutResult(k, seed, "west" if a_west else "east", winner, outcome.how, outcome.time_s))
        traces.append((outcome.trace, outcome.settle))
        if winner is not None:
            wins["ab".index(winner)] += 1
        if max(wins) >= rules.bouts_to_win:
            break
    if wins[0] != wins[1]:
        winner, decided_by = ("a" if wins[0] > wins[1] else "b"), "bouts"
    else:
        winner, decided_by = ("a" if ratings[0] >= ratings[1] else "b"), "rating"
    return MatchOutcome(tuple(bouts), tuple(traces), (wins[0], wins[1]), winner, decided_by)
