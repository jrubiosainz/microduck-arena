"""A tug of war: a duck pulls on a string against another duck, the reference duck on a rating
seed (a bout).

The string is a tendon (`arena.course.compile_tug`), limited to its length: a string, it pulls
only when taut, goes slack and never pushes.

The judge, after every control step: only the pit decides. A duck is out when its trunk is in
the pit; knocked over, sitting or lying on the platform, it stays in play and can still be
dragged in. The first duck in the pit loses the bout; when both go in on one step, or nobody is
in at the time limit, the marker (the middle of the two string ends) decides: pulled to the
west, east loses; to the east, west loses; exactly on the centre line, a draw.

A trace frame is a runner frame: trunk position (0:3), trunk quaternion w, x, y, z (3:7), then
the joint angles.
"""

from dataclasses import dataclass

import numpy as np

from .assets import ASSET_ROOT
from .constants import CTRL_DT, TRACE_WIDTH
from .course import compile_tug, string_offset
from .manifest import Manifest
from .policy import load_policy
from .runner import _reset_by_mujoco, _start

PIT_DROP_M = 0.05  # a trunk below z = -PIT_DROP_M is in the pit
SIDES = ("west", "east")


def string_ends(trace: np.ndarray, offset) -> np.ndarray:
    """Where each duck's string is tied, (ducks, frames, 21) -> (ducks, frames, 3): the offset
    in the trunk's frame, turned by the trunk's quaternion and carried to its position."""
    trace = np.asarray(trace, dtype=np.float64)
    pos, w, u = trace[..., 0:3], trace[..., 3:4], trace[..., 4:7]
    v = np.broadcast_to(np.asarray(offset, dtype=np.float64), u.shape)
    t = 2.0 * np.cross(u, v)
    return pos + v + w * t + np.cross(u, t)


def marker_x(trace: np.ndarray, offset) -> np.ndarray:
    """The marker's x per frame, (2, frames, 21) -> (frames,): the middle of the two string ends."""
    ends = string_ends(trace, offset)
    return (ends[0, :, 0] + ends[1, :, 0]) / 2


def in_pit(frame: np.ndarray) -> bool:
    return bool(frame[2] < -PIT_DROP_M)


def _verdict(trace: np.ndarray, offset, final: bool) -> tuple[int | None, str] | None:
    """The bout's verdict after the last frame of `trace`, (2, frames, 21): (loser, how), or None
    while it goes on."""
    inside = [in_pit(trace[k, -1]) for k in (0, 1)]
    if inside.count(True) == 1:
        return inside.index(True), "pit"
    if all(inside) or final:
        x = marker_x(trace[:, -1:], offset)[0]
        return (1, "marker") if x < 0 else (0, "marker") if x > 0 else (None, "draw")
    return None


@dataclass(frozen=True)
class BoutOutcome:
    seed: int
    loser: int | None  # 0 west, 1 east, None undecided by the physics
    how: str  # "pit" (the first duck in the pit),
    # "marker" (both in on one control step, or the time limit),
    # "draw" (marker exactly 0, or a step MuJoCo had to reset)
    time_s: float  # when it was decided
    trace: np.ndarray  # (2, frames, 21), west first; stops at the deciding step
    settle: np.ndarray  # (2, settle + 1, 21)


def run_bout(manifest: Manifest, west, east, seed: int, model=None) -> BoutOutcome:
    """Two ducks tied neck to neck, west facing east and east facing west, both on the event's
    command, until the judge's first verdict: at the latest the bout's time limit, where the
    marker always gives one. A step MuJoCo had to reset ends the bout drawn, its frame left out:
    a solver explosion is not a result, and the reset pose stands the west duck over the pit."""
    model = model if model is not None else compile_tug(manifest)
    command = np.asarray(manifest.command, dtype=np.float64)
    offset = string_offset(manifest.rig)
    sim, settle = _start(manifest, model, [west, east], [0.0, 180.0], seed, [command, command])
    steps = round(manifest.bout.time_limit_s / CTRL_DT)
    frames = np.empty((2, steps, TRACE_WIDTH), dtype=np.float32)
    for step in range(steps):
        sim.step([command, command])
        if _reset_by_mujoco(sim.data):
            return BoutOutcome(
                seed, None, "draw", (step + 1) * CTRL_DT, frames[:, :step].copy(), settle
            )
        sim.record(frames[:, step])
        verdict = _verdict(frames[:, : step + 1], offset, final=step == steps - 1)
        if verdict is not None:
            loser, how = verdict
            return BoutOutcome(
                seed, loser, how, (step + 1) * CTRL_DT, frames[:, : step + 1].copy(), settle
            )


def reference_duck(manifest: Manifest):
    """The frozen duck every tug rating is bouts against."""
    return load_policy(ASSET_ROOT / "policies" / manifest.rating.reference)


def entry_side(seed: int) -> int:
    """The entry's side in a seed's bout: west (0) on odd seeds, east (1) on even."""
    return (seed - 1) % 2


def bout_status(outcome: BoutOutcome, entry: int) -> str:
    """A bout as the entry saw it: won, lost or draw, with a pit_ prefix when the pit decided."""
    if outcome.loser is None:
        return "draw"
    status = "lost" if outcome.loser == entry else "won"
    return f"pit_{status}" if outcome.how == "pit" else status


def bout_score_cm(outcome: BoutOutcome, entry: int, pit_bonus_cm: float, offset) -> float:
    """The entry's score for a bout: the centimetres of ground it won, the marker's distance from
    the centre line towards the entry's own side, plus the pit bonus when only the opponent is in
    the pit, minus it when only the entry is (nothing when both are)."""
    if outcome.how == "draw":  # the centre line exactly, or a step MuJoCo reset: nobody's ground
        return 0.0
    x = float(marker_x(outcome.trace[:, -1:], offset)[0])
    last = outcome.trace[:, -1]
    pits = int(in_pit(last[1 - entry])) - int(in_pit(last[entry]))
    return 100.0 * (-x if entry == 0 else x) + pit_bonus_cm * pits
