import dataclasses

import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, TRACE_WIDTH
from arena.course import compile_course, ramp_dir
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once, seed_rng

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"


@pytest.fixture(scope="module")
def sprint():
    return load_event("sprint-2m")


@pytest.fixture(scope="module")
def walker():
    return load_policy(REFERENCE)


def test_seed_rng_is_stable_across_processes(sprint):
    # Must NOT depend on hash(), which is salted per process.
    a = seed_rng("sprint-2m", 1).standard_normal(4)
    b = seed_rng("sprint-2m", 1).standard_normal(4)
    np.testing.assert_array_equal(a, b)


def test_seed_rng_differs_by_seed_and_by_event():
    same_event = seed_rng("sprint-2m", 1).standard_normal(4)
    other_seed = seed_rng("sprint-2m", 2).standard_normal(4)
    other_event = seed_rng("roller-sprint-2m", 1).standard_normal(4)
    assert not np.array_equal(same_event, other_seed)
    assert not np.array_equal(same_event, other_event)


def test_reference_policy_finishes_the_sprint(sprint, walker):
    outcome = run_once(sprint, walker, seed=1)
    assert outcome.status == "finish", f"walker did not finish: {outcome.status}"
    assert outcome.time_s is not None
    # The reference walker tracks about 44% of its commanded 0.25 m/s, so 2 m
    # takes it roughly 18.5 s. The band is wide enough not to be brittle and
    # tight enough that a broken observation layout cannot pass it.
    assert 10.0 < outcome.time_s < 30.0


def test_trace_shape_matches_the_clock(sprint, walker):
    outcome = run_once(sprint, walker, seed=1)
    assert outcome.trace.ndim == 2
    assert outcome.trace.shape[1] == TRACE_WIDTH
    assert outcome.trace.shape[0] == pytest.approx(outcome.time_s / CTRL_DT, abs=1)
    assert outcome.trace.dtype == np.float32


def test_the_run_is_deterministic(sprint, walker):
    first = run_once(sprint, walker, seed=3)
    second = run_once(sprint, walker, seed=3)
    assert first.status == second.status
    assert first.time_s == second.time_s
    np.testing.assert_array_equal(first.trace, second.trace)


def test_different_seeds_give_different_traces(sprint, walker):
    a = run_once(sprint, walker, seed=1)
    b = run_once(sprint, walker, seed=2)
    assert not np.array_equal(a.trace, b.trace), "perturbation had no effect"


def test_a_fall_beats_a_finish_on_the_same_step(sprint, walker):
    """A robot already collapsing does not get credited with the win.

    Crafted so both conditions are true on the very first clocked step, which is
    the only way to test the precedence deterministically: fall_gravity_z = -1.5
    sits above the upright value (about -1.0), so the robot counts as tipped from
    the first step; fall_hold_s = 0 removes the debounce; and length_m = 0 puts
    the finish line under its feet. The order of the two checks is then the only
    thing that decides the outcome — this test returns "finish" if they are
    swapped back.
    """
    both = dataclasses.replace(
        sprint,
        course=dataclasses.replace(sprint.course, length_m=0.0),
        termination=dataclasses.replace(
            sprint.termination, fall_gravity_z=-1.5, fall_hold_s=0.0
        ),
    )
    outcome = run_once(both, walker, seed=1)
    assert outcome.status == "fall"
    assert outcome.time_s is None


def test_a_limp_policy_falls(sprint):
    """A policy that commands the zero action collapses; that must be a fall."""
    outcome = run_once(sprint, _ZeroPolicy(), seed=1)
    assert outcome.status == "fall"
    assert outcome.time_s is None
    assert outcome.progress_m < sprint.course.length_m


def test_an_unreachable_finish_line_times_out(sprint, walker):
    long_course = dataclasses.replace(
        sprint,
        course=dataclasses.replace(sprint.course, length_m=500.0),
        time_limit_s=3.0,
    )
    outcome = run_once(long_course, walker, seed=1)
    assert outcome.status == "timeout"
    assert outcome.time_s is None
    assert outcome.trace.shape[0] == pytest.approx(3.0 / CTRL_DT, abs=1)


def test_the_settle_is_recorded_from_the_reset_pose(sprint, walker):
    """The untimed settle has its own frames, so a replay can start where the
    simulation did: frame 0 is the keyframe before any step, then one frame per
    settle step, the last one control step before the first clocked frame."""
    outcome = run_once(sprint, walker, seed=1)
    steps = round(sprint.start.settle_s / CTRL_DT)
    assert outcome.settle.shape == (steps + 1, TRACE_WIDTH)
    assert outcome.settle.dtype == np.float32
    key = compile_course(sprint).key(sprint.start.keyframe)
    np.testing.assert_allclose(outcome.settle[0, 0:3], key.qpos[0:3], atol=1e-6)
    assert np.linalg.norm(outcome.trace[0, 0:3] - outcome.settle[-1, 0:3]) < 0.02


def test_the_clock_starts_on_the_start_line(sprint, walker):
    """The first clocked frame sits on the start line.

    Note the duck is already moving by then: the pinned forward command runs
    during the settle, so it has walked ~10 cm before the clock starts. The start
    line is therefore defined where it *is* at that moment, not at the world
    origin — which is exactly what start_progress_m records.
    """
    outcome = run_once(sprint, walker, seed=1)
    direction = ramp_dir(sprint.course.slope_deg)
    first_frame = float(direction @ outcome.trace[0, :3])
    # One control step of travel at most, since the frame is recorded after a step.
    assert abs(first_frame - outcome.start_progress_m) < 0.02


def test_a_longer_settle_does_not_inflate_the_time(sprint, walker):
    """Settling is not timed, so extending it must not change the recorded time.

    Both runs enter the clocked phase already at walking speed from their own
    start line, so the times should agree closely. If settling were timed, the
    longer settle would add its extra 1.5 s to the clock.
    """
    long_settle = dataclasses.replace(
        sprint, start=dataclasses.replace(sprint.start, settle_s=2.0)
    )
    brief = run_once(sprint, walker, seed=1)
    extended = run_once(long_settle, walker, seed=1)
    assert brief.status == extended.status == "finish"
    assert extended.time_s == pytest.approx(brief.time_s, rel=0.25)


def test_model_can_be_supplied_to_avoid_recompiling(sprint, walker):
    model = compile_course(sprint)
    a = run_once(sprint, walker, seed=1, model=model)
    b = run_once(sprint, walker, seed=1)
    assert a.time_s == b.time_s


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(14, dtype=np.float32)
