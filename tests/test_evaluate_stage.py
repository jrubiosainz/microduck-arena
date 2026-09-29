import dataclasses

import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, NUM_JOINTS, RUNNER_VERSION
from arena.evaluate import evaluate
from arena.manifest import load_event
from arena.policy import load_policy
from arena.timeline import Timeline

STILL = (0.0,) * 13


@pytest.fixture(scope="module")
def swag():
    return load_event("swag-contest")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


def test_an_entry_without_a_timeline_plays_the_events_command_for_20_s(swag, walker):
    """Every swag entry reaching the Space today comes without a timeline; it must
    still play the whole performance and stay eligible for ballots."""
    result = evaluate(swag, walker)
    assert result.trace.shape[0] == round(20.0 / CTRL_DT)
    assert result.seeds_finished == 1
    assert result.score == pytest.approx(20.0)
    assert [(r.seed, r.status) for r in result.per_seed] == [(1, "finish")]
    assert result.scan == ()
    assert result.command_vx == 0.0
    assert result.trace_seed == 1
    assert result.runner_version == RUNNER_VERSION


def test_a_timeline_sets_the_performance_and_its_length(swag, walker):
    timeline = Timeline(2.0, (0.0, 1.0), (STILL, (1.0,) + (0.0,) * 12))
    result = evaluate(swag, walker, timeline)
    assert result.trace.shape[0] == 100
    assert result.score == pytest.approx(2.0)


def test_a_race_refuses_a_timeline(walker):
    with pytest.raises(ValueError, match="race"):
        evaluate(load_event("sprint-2m"), walker, Timeline(2.0, (0.0,), (STILL,)))


class _RecordingPolicy:
    def __init__(self):
        self.observed = []

    def act(self, obs):
        self.observed.append(obs.copy())
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def test_the_events_own_command_reaches_the_policy_without_a_timeline(swag):
    """With no timeline, evaluate() must still drive the policy on the event's
    own command for the whole time limit — not zeros, not something else."""
    command = (0.5,) + (0.0,) * 12
    manifest = dataclasses.replace(swag, command=command, time_limit_s=1.0)
    policy = _RecordingPolicy()
    result = evaluate(manifest, policy)
    commands = [tuple(float(v) for v in obs[48:61]) for obs in policy.observed]
    assert commands and set(commands) == {command}
    assert result.trace.shape[0] == 50
