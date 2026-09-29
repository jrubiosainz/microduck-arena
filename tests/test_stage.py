import numpy as np
import pytest

from arena.constants import CTRL_DT, NUM_JOINTS, TRACE_WIDTH
from arena.manifest import load_event
from arena.runner import run_once
from arena.stage import fell_at, seated, standing, tilt_deg


def frames(n, z=0.115, tilt=0.0):
    """n trace frames at trunk height z, rolled by `tilt` degrees about x."""
    trace = np.zeros((n, TRACE_WIDTH), dtype=np.float32)
    trace[:, 2] = z
    half = np.radians(tilt) / 2
    trace[:, 3] = np.cos(half)
    trace[:, 4] = np.sin(half)
    return trace


def test_tilt_is_read_from_the_quaternion():
    np.testing.assert_allclose(tilt_deg(frames(3, tilt=35.0)), 35.0, atol=1e-3)


def test_seated_and_standing_follow_height_and_tilt():
    trace = np.concatenate([frames(2, z=0.06), frames(2), frames(2, tilt=30.0), frames(2, z=0.085)])
    assert seated(trace).tolist() == [True] * 2 + [False] * 6
    assert standing(trace).tolist() == [False] * 2 + [True] * 2 + [False] * 4


def test_a_fall_is_timed_where_a_lane_would_have_stopped():
    """Tipped past 60 degrees for 0.3 s (15 steps) straight; a shorter tip resets the count."""
    term = load_event("swag-contest").termination
    trace = np.concatenate([frames(50), frames(14, tilt=80.0), frames(10), frames(20, tilt=80.0)])
    assert fell_at(trace, term) == pytest.approx((50 + 14 + 10 + 15) * CTRL_DT)


def test_leaning_short_of_the_rule_is_no_fall():
    assert fell_at(frames(100, tilt=55.0), load_event("swag-contest").termination) is None


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def test_the_rule_is_the_runners():
    """A lane stops a limp policy at its fall; read off the trace, the fall lands on its last frame."""
    sprint = load_event("sprint-2m")
    outcome = run_once(sprint, _ZeroPolicy(), seed=1)
    assert outcome.status == "fall"
    assert fell_at(outcome.trace, sprint.termination) == pytest.approx(outcome.trace.shape[0] * CTRL_DT)
