import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, RUNNER_VERSION
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
