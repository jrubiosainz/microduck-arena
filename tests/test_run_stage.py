import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, NUM_JOINTS
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once, run_stage
from arena.timeline import Timeline, constant_timeline

STILL = (0.0,) * 13


@pytest.fixture(scope="module")
def talent():
    return load_event("got-a-talent")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


class _RecordingPolicy:
    def __init__(self):
        self.observed = []

    def act(self, obs):
        self.observed.append(obs.copy())
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def test_a_stage_plays_exactly_its_duration(talent, walker):
    outcome = run_stage(talent, walker, constant_timeline(STILL, 3.0), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape[0] == round(3.0 / CTRL_DT)
    assert outcome.time_s == pytest.approx(3.0)
    assert outcome.progress_m == 0.0 and outcome.start_progress_m == 0.0


def test_a_fall_does_not_stop_a_performance(talent):
    """The same limp policy is a fall on a lane; on a stage it plays to the end."""
    assert run_once(load_event("sprint-2m"), _ZeroPolicy(), seed=1).status == "fall"
    outcome = run_stage(talent, _ZeroPolicy(), constant_timeline(STILL, 3.0), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape[0] == round(3.0 / CTRL_DT)


def test_each_step_observes_the_command_at_its_time(talent):
    """The settle plays the first keyframe; timed step k plays command_at(k * CTRL_DT).
    A keyframe at 0.3 s is first seen at step 15, although 15 * 0.02 < 0.3 in floating point."""
    first = (0.0,) * 13
    sit = (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6
    look = (0.0, 0.0, 0.0, -0.25, 0.0, 0.0, 0.0) + (0.0,) * 5 + (0.25,)
    timeline = Timeline(1.5, (0.0, 0.3, 1.0), (first, sit, look))
    policy = _RecordingPolicy()
    run_stage(talent, policy, timeline, seed=1)

    settle_steps = round(talent.start.settle_s / CTRL_DT)
    commands = [tuple(float(v) for v in obs[48:61]) for obs in policy.observed]
    assert len(commands) == settle_steps + round(1.5 / CTRL_DT)
    assert set(commands[:settle_steps]) == {first}
    timed = commands[settle_steps:]
    assert timed[14] == first and timed[15] == sit
    assert timed[49] == sit and timed[50] == look
    assert timed[-1] == look


def test_a_stage_run_is_deterministic(talent, walker):
    timeline = constant_timeline(STILL, 2.0)
    a = run_stage(talent, walker, timeline, seed=1)
    b = run_stage(talent, walker, timeline, seed=1)
    assert np.array_equal(a.trace, b.trace)
    assert np.array_equal(a.settle, b.settle)
