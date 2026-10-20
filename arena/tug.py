"""A tug of war: a duck pulls on a string, against a winch (the pulling bench) or against
another duck (a bout).

The string is a tendon (`arena.course.compile_tug`). Between two ducks it is limited to its
length: a string, it pulls only when taut, goes slack and never pushes. On the bench it runs to
a winch whose pull rises with time, shaken by a few sines; how hard it pulls when the duck goes
out is the duck's score, and a duck that never goes out scores the top.

The judge, after every control step: a duck is out when its trunk is in the pit or it has
fallen by the Arena's own fall rule (a fall loses as the pit does). The first duck out loses
the bout; when both go out on one step, or nobody is out at the time limit, the marker (the
middle of the two string ends) decides: pulled to the west, east loses; to the east, west
loses; exactly on the centre line, a draw.

A trace frame is a runner frame: trunk position (0:3), trunk quaternion w, x, y, z (3:7), then
the joint angles.
"""

import math
import zlib
from dataclasses import dataclass

import numpy as np

from .constants import CTRL_DT, TRACE_WIDTH
from .course import WINCH, compile_tug, string_offset
from .manifest import Bench, Manifest, Termination
from .runner import _start
from .stage import fell_at

PIT_DROP_M = 0.05  # a trunk below z = -PIT_DROP_M is in the pit


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


def bench_profile(bench: Bench, event_id: str, seed: int) -> dict:
    """The winch's pull for one seed: the event's ramp and top, and each jerk's sine with its
    own phase, drawn from a stream that is the same in every process."""
    phases = np.random.default_rng([zlib.crc32(event_id.encode()), seed, 4]).uniform(
        0, 2 * np.pi, len(bench.jerk_hz)
    )
    return {
        "ramp_n_per_s": bench.ramp_n_per_s,
        "top_n": bench.top_n,
        "jerks": [[bench.jerk_n, hz, float(phase)] for hz, phase in zip(bench.jerk_hz, phases)],
    }


def bench_force(profile: dict, t_s: float) -> float:
    """The winch's pull in newtons at `t_s` into the timed run, never below 0, never above the
    top: a duck dragged in at the top never outscores one that held."""
    pull = profile["ramp_n_per_s"] * t_s + sum(
        amp * math.sin(2 * math.pi * hz * t_s + phase) for amp, hz, phase in profile["jerks"]
    )
    return min(profile["top_n"], max(0.0, pull))


def _out(duck: np.ndarray, termination: Termination) -> str | None:
    """How a duck's (frames, 21) trace so far has it out at its last frame: "pit", "fall" or None.

    The fall is the Arena's own rule, `stage.fell_at`, reused and never copied: over a window of
    exactly the hold it holds only when every frame of it is tipped, so it is timed at the step
    that completes the hold, as `runner.run_once` times it.
    """
    if in_pit(duck[-1]):
        return "pit"
    hold = round(termination.fall_hold_s / CTRL_DT)
    if fell_at(duck[-hold:], termination) is not None:
        return "fall"
    return None


def _verdict(
    trace: np.ndarray, offset, termination: Termination, final: bool
) -> tuple[int | None, str] | None:
    """The bout's verdict after the last frame of `trace`, (2, frames, 21): (loser, how), or None
    while it goes on."""
    outs = [_out(trace[k], termination) for k in (0, 1)]
    if outs.count(None) == 1:
        loser = 0 if outs[0] else 1
        return loser, outs[loser]
    if all(outs) or final:
        x = marker_x(trace[:, -1:], offset)[0]
        return (1, "marker") if x < 0 else (0, "marker") if x > 0 else (None, "draw")
    return None


@dataclass(frozen=True)
class BenchOutcome:
    seed: int
    status: str  # "pit" | "fall" | "held"
    force_n: float  # bench_force at the step it went out; top_n if it held to the end
    time_s: float | None  # when it went out (a fall: the step completing its hold); None if held
    trace: np.ndarray  # (1, frames, 21); stops at the step it went out
    settle: np.ndarray  # (1, settle + 1, 21)
    profile: dict


def run_bench(manifest: Manifest, policy, seed: int, model=None) -> BenchOutcome:
    """One duck against the winch for the event's timed length, after the runner's own opening.
    The winch is still through the settle; its pull is set before every timed control step."""
    model = model if model is not None else compile_tug(manifest, 1)
    command = np.asarray(manifest.command, dtype=np.float64)
    profile = bench_profile(manifest.bench, manifest.id, seed)
    winch = model.actuator(WINCH).id
    sim, settle = _start(manifest, model, [policy], [0.0], seed, [command])
    steps = round(manifest.time_limit_s / CTRL_DT)
    frames = np.empty((1, steps, TRACE_WIDTH), dtype=np.float32)
    for step in range(steps):
        force = bench_force(profile, step * CTRL_DT)
        sim.data.ctrl[winch] = force
        sim.step([command])
        sim.record(frames[:, step])
        how = _out(frames[0, : step + 1], manifest.termination)
        if how is not None:
            return BenchOutcome(
                seed,
                how,
                force,
                (step + 1) * CTRL_DT,
                frames[:, : step + 1].copy(),
                settle,
                profile,
            )
    return BenchOutcome(seed, "held", profile["top_n"], None, frames, settle, profile)


@dataclass(frozen=True)
class BoutOutcome:
    seed: int
    loser: int | None  # 0 west, 1 east, None undecided by the physics
    how: str  # "pit" | "fall" (the first duck out, how it went out),
    # "marker" (both out on one control step, or the time limit), "draw" (marker exactly 0)
    time_s: float  # when it was decided
    trace: np.ndarray  # (2, frames, 21), west first; stops at the deciding step
    settle: np.ndarray  # (2, settle + 1, 21)


def run_bout(manifest: Manifest, west, east, seed: int, model=None) -> BoutOutcome:
    """Two ducks tied neck to neck, west facing east and east facing west, both on the event's
    command, until the judge's first verdict: at the latest the bout's time limit, where the
    marker always gives one."""
    model = model if model is not None else compile_tug(manifest, 2)
    command = np.asarray(manifest.command, dtype=np.float64)
    offset = string_offset(manifest.rig)
    sim, settle = _start(manifest, model, [west, east], [0.0, 180.0], seed, [command, command])
    steps = round(manifest.bout.time_limit_s / CTRL_DT)
    frames = np.empty((2, steps, TRACE_WIDTH), dtype=np.float32)
    for step in range(steps):
        sim.step([command, command])
        sim.record(frames[:, step])
        verdict = _verdict(
            frames[:, : step + 1], offset, manifest.termination, final=step == steps - 1
        )
        if verdict is not None:
            loser, how = verdict
            return BoutOutcome(
                seed, loser, how, (step + 1) * CTRL_DT, frames[:, : step + 1].copy(), settle
            )
