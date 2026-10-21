import dataclasses
import math

import mujoco
import numpy as np
import pytest

from arena import runner, tug
from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT
from arena.course import compile_tug, string_offset, string_sites
from arena.manifest import BoutRules, load_event
from arena.policy import load_policy
from arena.runner import _Addresses, _record
from arena.tug import (
    SIDES,
    BoutOutcome,
    _verdict,
    bout_score_cm,
    bout_status,
    entry_side,
    in_pit,
    marker_x,
    reference_duck,
    run_bout,
    string_ends,
)
from tests.test_assets import REFERENCE_SHA256

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
    model = compile_tug(TUG)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    mujoco.mj_forward(model, data)
    trace = np.zeros((2, 1, 21))
    for k, prefix in enumerate(("", "duck1/")):
        _record(trace[k, 0], data, _Addresses.of(model, "STAND", prefix))
    for k, prefix in enumerate(("", "duck1/")):
        np.testing.assert_allclose(string_ends(trace, OFFSET)[k, 0], data.site_xpos[model.site(prefix + "string_end").id], atol=1e-9)

def test_a_trunk_below_the_drop_is_in_the_pit():
    assert in_pit(frame((0, 0, -0.051), WEST)) and not in_pit(frame((0, 0, -0.049), WEST))

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
    tipped = np.repeat(base, 15, axis=1); tipped[0, :, 3:7] = ON_ITS_SIDE     # 15 frames: 0.3 s on its side
    assert _verdict(tipped, OFFSET, final=False) is None                      # still in play
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

def _string_bout(manifest, west, east, seed):
    """run_bout's timed steps, read off the physics after each: the distance between the two ducks'
    string ends, and the larger of the two ties' errors (a duck's end to the string's own end)."""
    model = compile_tug(manifest)
    command = np.asarray(manifest.command, dtype=np.float64)
    sim, _ = runner._start(manifest, model, [west, east], [0.0, 180.0], seed, [command, command])
    ends = [model.site(name).id for name in ("string_end", "duck1/string_end")]
    tips = string_sites(model)[[0, -1]]
    gaps, ties = [], []
    for _ in range(round(manifest.bout.time_limit_s / CTRL_DT)):
        sim.step([command, command])
        assert not runner._reset_by_mujoco(sim.data)
        at = sim.data.site_xpos
        gaps.append(float(np.linalg.norm(at[ends[0]] - at[ends[1]])))
        ties.append(float(np.linalg.norm(at[ends] - at[tips], axis=1).max()))
    return gaps, ties

def test_a_bout_on_the_string_holds_together():
    """The reference against itself, 4 s of timed steps: no reset, ends never past 1.005 m, ties within 1 cm."""
    gaps, ties = _string_bout(SHORT, reference_duck(TUG), reference_duck(TUG), 1)   # _start + sim.step as run_bout, each step read off data
    assert max(gaps) <= 1.005 and max(ties) <= 0.01

def _explode_at(monkeypatch, bad_step):
    """MuJoCo resets the simulation on timed step `bad_step`, as the runner's own check would say."""
    calls = iter(range(1_000_000))
    monkeypatch.setattr(tug, "_reset_by_mujoco", lambda data: next(calls) == bad_step)

def test_a_solver_explosion_in_a_bout_is_a_draw_and_its_frame_is_left_out(monkeypatch):
    assert tug._reset_by_mujoco is runner._reset_by_mujoco   # the runner's own check, reused
    whole = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    _explode_at(monkeypatch, 10)
    out = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert (out.loser, out.how, out.trace.shape) == (None, "draw", (2, 10, 21)) and out.time_s == pytest.approx(11 * CTRL_DT)
    np.testing.assert_array_equal(out.trace, whole.trace[:, :10])


def bout_trace(x, pit=()):
    """One frame of a bout whose marker stands x m east of the centre line; the ducks in `pit` below the floor."""
    trace = np.array([[frame((-0.6 + x, 0, 0.1), WEST)], [frame((0.6 + x, 0, 0.1), EAST)]])
    for k in pit:
        trace[k, 0, 2] = -0.1
    return trace


def test_a_bout_scores_the_ground_the_entry_won_and_the_pit_either_way():
    out = lambda loser, how, x, pit=(): BoutOutcome(1, loser, how, 45.0, bout_trace(x, pit), np.zeros((2, 26, 21)))
    assert [bout_score_cm(out(1, "marker", -0.1), e, 100.0, OFFSET) for e in (0, 1)] == pytest.approx([10.0, -10.0])
    assert [bout_score_cm(out(1, "pit", -0.1, (1,)), e, 100.0, OFFSET) for e in (0, 1)] == pytest.approx([110.0, -110.0])
    assert bout_score_cm(out(1, "marker", -0.1, (0, 1)), 0, 100.0, OFFSET) == pytest.approx(10.0)   # both in: no bonus
    drawn = BoutOutcome(1, None, "draw", 0.02, np.zeros((2, 0, 21)), np.zeros((2, 26, 21)))        # reset before a frame
    assert bout_score_cm(drawn, 0, 100.0, OFFSET) == 0.0 and bout_status(drawn, 1) == "draw"
    assert [bout_status(out(1, "pit", 0.0, (1,)), e) for e in (0, 1)] == ["pit_won", "pit_lost"]
    assert [bout_status(out(0, "marker", 0.1), e) for e in (0, 1)] == ["lost", "won"]
    assert [entry_side(s) for s in (1, 2, 3, 4, 5)] == [0, 1, 0, 1, 0] and SIDES == ("west", "east")
    assert reference_duck(TUG).sha256 == REFERENCE_SHA256
