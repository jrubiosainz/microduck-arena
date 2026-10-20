import dataclasses
import math

import mujoco
import numpy as np
import pytest

from arena import runner, tug
from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT
from arena.course import compile_tug, string_offset
from arena.manifest import BoutRules, load_event
from arena.policy import load_policy
from arena.runner import _Addresses, _record
from arena.tug import (
    _verdict,
    bench_force,
    bench_profile,
    in_pit,
    marker_x,
    run_bench,
    run_bout,
    string_ends,
)

TUG, OFFSET = load_event("tug-of-war"), string_offset("legs")
SHORT = dataclasses.replace(TUG, bout=BoutRules(4.0, 2, 5))
WALKER = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
WEST, EAST = (1.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)
ON_ITS_SIDE = (math.cos(math.pi / 4), math.sin(math.pi / 4), 0.0, 0.0)   # 90° about x: gravity z 0 > -0.5

class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(14, dtype=np.float32)

def frame(pos, quat):
    f = np.zeros(21)
    f[0:3], f[3:7] = pos, quat
    return f

def test_a_string_end_turns_with_the_trunk_and_the_marker_is_their_middle():
    half = math.radians(30) / 2
    trace = np.array([[frame((-0.5, 0.1, 0.13), (math.cos(half), 0, 0, math.sin(half)))], [frame((0.6, 0.0145, 0.12), EAST)]])
    np.testing.assert_allclose(string_ends(trace, OFFSET)[:, 0], [[-0.4847333395016046, 0.12555736835487435, 0.1624215],
                                                                   [0.574, 0.0, 0.1524215]], atol=1e-12)
    assert marker_x(trace, OFFSET)[0] == pytest.approx(0.04463333024919769, abs=1e-12)

def test_string_ends_are_where_the_physics_puts_the_sites():
    model = compile_tug(TUG, 2)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    mujoco.mj_forward(model, data)
    trace = np.zeros((2, 1, 21))
    for k, prefix in enumerate(("", "duck1/")):
        _record(trace[k, 0], data, _Addresses.of(model, "STAND", prefix))
    for k, prefix in enumerate(("", "duck1/")):
        np.testing.assert_allclose(string_ends(trace, OFFSET)[k, 0], data.site_xpos[model.site(prefix + "string_end").id], atol=1e-9)

def test_the_pit_and_the_winch():
    assert in_pit(frame((0, 0, -0.051), WEST)) and not in_pit(frame((0, 0, -0.049), WEST))
    profile = bench_profile(TUG.bench, "tug-of-war", 1)
    assert profile == {"ramp_n_per_s": 0.25, "top_n": 7.0, "jerks": [[0.4, 0.7, pytest.approx(2.8020456591211773, abs=1e-12)],
                                                                    [0.4, 1.9, pytest.approx(2.137798647724724, abs=1e-12)]]}
    for t, newtons in ((0.0, 0.47062992744195403), (0.3, 0.0), (1.0, 0.9667824432317804), (12.0, 2.979120498892693), (29.5, 7.0)):
        assert bench_force(profile, t) == pytest.approx(newtons, abs=1e-12)

def test_a_duck_that_does_nothing_is_dragged_into_the_pit():
    """Only the pit decides (owner, 2026-10-20): a limp duck falls flat, stays in play and holds on
    body friction until the winch drags it in."""
    out = run_bench(TUG, _ZeroPolicy(), 1)
    frames = out.trace.shape[1]
    assert out.status == "pit" and 10.0 < out.time_s < 30.0 and 3.0 < out.force_n <= 7.0
    assert out.trace.shape == (1, frames, 21) and frames == round(out.time_s / CTRL_DT)
    assert in_pit(out.trace[0, -1]) and not in_pit(out.trace[0, -2])
    assert out.force_n == bench_force(out.profile, (frames - 1) * CTRL_DT)
    assert out.settle.shape == (1, 26, 21) and out.profile == bench_profile(TUG.bench, TUG.id, 1)
    np.testing.assert_array_equal(run_bench(TUG, _ZeroPolicy(), 1).trace, out.trace)

def test_a_duck_still_in_at_the_end_scores_the_top_and_a_walker_is_still_rated():
    held = run_bench(dataclasses.replace(TUG, time_limit_s=2.0), _ZeroPolicy(), 1)
    assert (held.status, held.force_n, held.time_s, held.trace.shape) == ("held", 7.0, None, (1, 100, 21))
    walker = run_bench(TUG, load_policy(WALKER), 2)
    assert walker.status in ("pit", "held") and 0.0 <= walker.force_n <= 7.0

def test_the_judge_reads_the_pit_then_the_marker():
    base = np.array([[frame((-0.6, 0, 0.1), WEST)], [frame((0.6, 0, 0.1), EAST)]])
    assert _verdict(base, OFFSET, final=False) is None
    east_in = base.copy(); east_in[1, 0, 2] = -0.1
    assert _verdict(east_in, OFFSET, final=False) == (1, "pit")
    both = base.copy(); both[:, 0, 2] = -0.1; both[:, 0, 0] -= 0.1           # both in, the marker pulled west
    assert _verdict(both, OFFSET, final=False) == (1, "marker")
    east_side = base.copy(); east_side[:, 0, 0] += 0.1
    assert _verdict(east_side, OFFSET, final=True) == (0, "marker")
    assert _verdict(base, (0.0, 0.0, 0.0), final=True) == (None, "draw")      # exactly on the centre line
    hold = round(TUG.termination.fall_hold_s / CTRL_DT)                       # 15 control steps
    tipped = np.repeat(base, hold, axis=1); tipped[0, :, 3:7] = ON_ITS_SIDE
    assert _verdict(tipped, OFFSET, final=False) is None                      # on its side for the whole hold: still in play
    tipped[1, -1, 2] = -0.1                                                   # the duck on its feet drops in
    assert _verdict(tipped, OFFSET, final=False) == (1, "pit")

def test_two_ducks_that_do_nothing_are_decided_the_same_way_every_time():
    out = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert out.how in ("pit", "marker", "draw")
    assert out.trace.shape[1] == round(out.time_s / CTRL_DT) and out.settle.shape == (2, 26, 21)
    again = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    np.testing.assert_array_equal(again.trace, out.trace)
    assert (again.loser, again.how) == (out.loser, out.how)

def test_a_bout_nobody_goes_out_of_is_decided_by_the_marker_at_the_time_limit():
    out = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert out.trace.shape == (2, 200, 21) and out.time_s == pytest.approx(4.0)
    x = marker_x(out.trace[:, -1:], OFFSET)[0]
    assert (out.loser, out.how) == ((0, "marker") if x > 0 else (1, "marker") if x < 0 else (None, "draw"))

def test_the_string_never_stretches_past_its_length():
    walker = load_policy(WALKER)
    ends = string_ends(run_bout(TUG, walker, walker, 1).trace, OFFSET)
    length = np.linalg.norm(ends[0] - ends[1], axis=1)
    assert TUG.course.string_m - 0.01 <= length.max() <= TUG.course.string_m + 0.01   # taut, never longer

def _explode_at(monkeypatch, bad_step):
    """MuJoCo resets the simulation on timed step `bad_step`, as the runner's own check would say."""
    calls = iter(range(1_000_000))
    monkeypatch.setattr(tug, "_reset_by_mujoco", lambda data: next(calls) == bad_step)

def test_a_solver_explosion_on_the_bench_is_the_pit_at_that_steps_pull_and_its_frame_is_left_out(monkeypatch):
    assert tug._reset_by_mujoco is runner._reset_by_mujoco   # the runner's own check, reused
    short = dataclasses.replace(TUG, time_limit_s=2.0)
    held = run_bench(short, _ZeroPolicy(), 1)
    _explode_at(monkeypatch, 10)
    out = run_bench(short, _ZeroPolicy(), 1)
    assert (out.status, out.trace.shape) == ("pit", (1, 10, 21)) and out.time_s == pytest.approx(11 * CTRL_DT)
    assert out.force_n == bench_force(out.profile, 10 * CTRL_DT)
    np.testing.assert_array_equal(out.trace, held.trace[:, :10])

def test_a_solver_explosion_in_a_bout_is_a_draw_and_its_frame_is_left_out(monkeypatch):
    whole = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    _explode_at(monkeypatch, 10)
    out = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert (out.loser, out.how, out.trace.shape) == (None, "draw", (2, 10, 21)) and out.time_s == pytest.approx(11 * CTRL_DT)
    np.testing.assert_array_equal(out.trace, whole.trace[:, :10])
