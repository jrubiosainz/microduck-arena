"""Does the manifest abstraction actually hold?

These events were added as data only. If any of them needed a runner change, the
abstraction is wrong, and this is the cheapest possible moment to find out.
"""

import pytest

from arena.assets import ASSET_ROOT
from arena.course import compile_course
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once

SECOND_EVENTS = ["roller-sprint-2m", "hill-climb-1m5"]


@pytest.mark.parametrize("event_id", SECOND_EVENTS)
def test_the_event_loads_and_its_course_compiles(event_id):
    model = compile_course(load_event(event_id))
    assert model.nu == 14


@pytest.mark.parametrize("event_id", SECOND_EVENTS)
def test_a_run_completes_and_terminates_cleanly(event_id):
    """Any of the three outcomes is fine — a leg policy will not win a roller race.

    What matters is that the runner terminates on a declared rule rather than
    hanging or crashing on an event it has never seen.
    """
    manifest = load_event(event_id)
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    outcome = run_once(manifest, policy, seed=1)
    assert outcome.status in {"finish", "fall", "timeout"}
    assert outcome.trace.shape[0] > 0


def test_the_roller_rig_uses_its_own_top_speed():
    assert load_event("roller-sprint-2m").command[0] == 0.6


def test_the_hill_actually_slopes():
    assert load_event("hill-climb-1m5").course.slope_deg == 8.0
