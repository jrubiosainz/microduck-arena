"""Red light, green light: how the caller's schedule is declared, how it lies
over a run's control steps, and how it judges a duck."""

import dataclasses

import numpy as np
import pytest

from arena.constants import CTRL_DT
from arena.course import compile_course
from arena.manifest import Lights, ManifestError, all_events, load_event, load_manifest
from arena.policy import load_policy
from arena.runner import _LightSteps, run_once
from tests.test_manifest import GOOD, STAGE, write_manifest
from tests.test_runner import REFERENCE, STEADY_VX

EVENT = "red-light-green-light-2m5"

# A well-formed [lights] table, field by field. A test overrides one field (None
# leaves it out) to build a specific malformation.
FIELDS = {"green_s": "[0.6,1.0]", "red_s": "[1.6,1.4]", "turn_s": "0.4", "tolerance_m": "0.03"}


def lights_table(**overrides) -> str:
    fields = FIELDS | overrides
    return "[lights]\n" + "".join(f"{key}={value}\n" for key, value in fields.items() if value is not None)


def write_lights(tmp_path, **overrides):
    # GOOD's last section is the empty [clip], so the table goes there, after every other one.
    return write_manifest(tmp_path, clip=lights_table(**overrides))


@pytest.fixture(scope="module")
def rlgl():
    return load_event(EVENT)


@pytest.fixture(scope="module")
def walker():
    return load_policy(REFERENCE)


def test_the_event_is_played_to_lights_on_a_longer_lane(rlgl):
    assert rlgl.course.kind == "lane"
    assert rlgl.course.length_m == 2.5
    assert rlgl.lights == Lights(
        green_s=(0.6, 2.4, 1.6, 3.0, 2.0, 2.8),
        red_s=(1.6, 2.0, 1.4, 2.4, 1.8, 2.2),
        turn_s=0.4,
        tolerance_m=0.03,
    )
    # Still a frozen, hashable manifest: the schedule is tuples, not lists.
    assert len({rlgl, load_event(EVENT)}) == 1


def test_no_other_event_has_lights():
    assert [m.id for m in all_events() if m.lights is not None] == [EVENT]


def test_lights_load_and_serialise(tmp_path):
    m = load_manifest(write_lights(tmp_path))
    assert m.lights == Lights(green_s=(0.6, 1.0), red_s=(1.6, 1.4), turn_s=0.4, tolerance_m=0.03)
    assert m.lights.to_dict() == {"green_s": [0.6, 1.0], "red_s": [1.6, 1.4], "turn_s": 0.4, "tolerance_m": 0.03}
    # A turn of zero is a caller that looks the moment the light goes red.
    assert load_manifest(write_lights(tmp_path, turn_s="0")).lights.turn_s == 0.0


def test_a_stage_refuses_lights(tmp_path):
    with pytest.raises(ManifestError, match=r"takes no \[lights\]"):
        load_manifest(write_manifest(tmp_path, **STAGE, clip=lights_table()))


def test_lights_must_be_a_table(tmp_path):
    with pytest.raises(ManifestError, match=r"\[lights\] must be a table"):
        load_manifest(write_manifest(tmp_path, root=GOOD["root"] + "lights=3\n"))


@pytest.mark.parametrize(
    "overrides, complaint",
    [
        ({"green_s": "[]"}, r"green_s must be a non-empty list of positive seconds, got \[\]"),
        ({"green_s": "0.6"}, r"green_s must be a non-empty list of positive seconds, got 0\.6"),
        ({"red_s": "[1.6,-1.4]"}, r"red_s must be a non-empty list of positive seconds"),
        ({"red_s": "[1.6,0]"}, r"red_s must be a non-empty list of positive seconds"),
        ({"green_s": "[true,1.0]"}, r"green_s must be a non-empty list of positive seconds"),
        ({"green_s": '["0.6",1.0]'}, r"green_s must be a non-empty list of positive seconds"),
        ({"green_s": "[0.61,1.0]"}, r"every green_s must be a whole number of 0\.02 s control steps"),
        ({"red_s": "[1.6,1.41]"}, r"every red_s must be a whole number of 0\.02 s control steps"),
        ({"red_s": "[1.6]"}, r"green_s and red_s must have as many phases as each other"),
        ({"turn_s": "-0.02"}, r"turn_s must be zero or more, a whole number of 0\.02 s control steps, got -0\.02"),
        ({"turn_s": "0.41"}, r"turn_s must be zero or more, a whole number of 0\.02 s control steps, got 0\.41"),
        ({"turn_s": "true"}, r"turn_s must be zero or more"),
        ({"turn_s": "1.4"}, r"turn_s must be shorter than every red_s, or the caller never looks"),
        ({"tolerance_m": "0.0"}, r"tolerance_m must be a positive distance, got 0\.0"),
        ({"tolerance_m": "-0.03"}, r"tolerance_m must be a positive distance"),
        ({"tolerance_m": "true"}, r"tolerance_m must be a positive distance, got True"),
        ({"tolerance_m": None}, r"\[lights\]: missing 'tolerance_m'"),
        ({"green_s": None}, r"\[lights\]: missing 'green_s'"),
        ({"seed": "1"}, r"\[lights\]: unknown keys \['seed'\]"),
    ],
)
def test_malformed_lights_are_refused(tmp_path, overrides, complaint):
    with pytest.raises(ManifestError, match=complaint):
        load_manifest(write_lights(tmp_path, **overrides))


# Green 0.6 s then red 1.6 s, green 1.0 s then red 1.4 s, a 0.4 s turn: in
# 0.02 s steps, green 30, red 80, green 50, red 70, and a turn of 20.
SCHEDULE = Lights(green_s=(0.6, 1.0), red_s=(1.6, 1.4), turn_s=0.4, tolerance_m=0.03)


def _spans(steps: int, *spans: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(steps, dtype=bool)
    for start, stop in spans:
        mask[start:stop] = True
    return mask


def test_the_schedule_cycles_its_phases_over_the_steps():
    steps = _LightSteps.of(SCHEDULE, 300)
    # The third red is the first phase again, cut short by the end of the run.
    np.testing.assert_array_equal(steps.red, _spans(300, (30, 110), (160, 230), (260, 300)))
    # Step i ends at (i + 1) * CTRL_DT: the caller has turned round once step
    # onset + 20 - 1 is over, and is watching from the step after it.
    assert np.flatnonzero(steps.mark).tolist() == [49, 179, 279]
    np.testing.assert_array_equal(steps.watch, _spans(300, (50, 110), (180, 230), (280, 300)))


def test_with_no_turn_the_mark_is_the_last_green_step_and_the_whole_red_is_watched():
    steps = _LightSteps.of(dataclasses.replace(SCHEDULE, turn_s=0.0), 300)
    assert np.flatnonzero(steps.mark).tolist() == [29, 159, 259]
    np.testing.assert_array_equal(steps.watch, steps.red)


def test_a_red_the_run_ends_inside_its_turn_is_never_watched():
    steps = _LightSteps.of(SCHEDULE, 40)
    np.testing.assert_array_equal(steps.red, _spans(40, (30, 40)))
    assert not steps.mark.any()
    assert not steps.watch.any()


class _Listener:
    """The reference walker, noting the twist it is asked for at every control step."""

    def __init__(self, policy):
        self.policy = policy
        self.twists = []

    def act(self, obs):
        self.twists.append(obs[48:51].copy())
        return self.policy.act(obs)


def _short(event, seconds: float, tolerance_m: float):
    """The event cut to its first green and red, judged at a tolerance of the test's choosing."""
    return dataclasses.replace(event, time_limit_s=seconds,
                               lights=dataclasses.replace(event.lights, tolerance_m=tolerance_m))


def test_the_duck_settles_standing_walks_on_green_and_is_asked_to_stand_on_red(rlgl, walker):
    # 3 s: a 0.6 s green, then the 1.6 s red, then the start of the next green. A
    # tolerance no duck strays from: this test is about what the duck is asked.
    event = _short(rlgl, 3.0, tolerance_m=100.0)
    listener = _Listener(walker)
    outcome = run_once(event, listener, seed=1, command=event.command_at(STEADY_VX))
    assert outcome.status == "timeout"

    settle = round(event.start.settle_s / CTRL_DT)
    red = _LightSteps.of(event.lights, round(event.time_limit_s / CTRL_DT)).red
    walk, stand = np.float32([STEADY_VX, 0.0, 0.0]), np.zeros(3, dtype=np.float32)
    expected = [stand] * settle + [stand if r else walk for r in red]
    assert len(listener.twists) == len(expected) == settle + len(outcome.trace)
    np.testing.assert_array_equal(np.array(listener.twists), np.array(expected))


def test_a_duck_that_moves_while_the_caller_looks_is_caught(rlgl, walker):
    # A tolerance nothing alive stays within: the first step the caller watches
    # catches the duck, and not one before it. It walked through the first 0.4 s
    # of the red, while the caller was turning round, and that did not count.
    event = _short(rlgl, 3.0, tolerance_m=1e-6)
    outcome = run_once(event, walker, seed=1, command=event.command_at(STEADY_VX))
    assert outcome.status == "caught"
    assert outcome.time_s is None
    first_look = round((event.lights.green_s[0] + event.lights.turn_s) / CTRL_DT)
    assert len(outcome.trace) == first_look + 1


def test_the_event_runs_end_to_end(rlgl, walker):
    """The shipped event, start to whatever end the walker meets. Not which end:
    two platforms' runs part ways within seconds (arena.golden), and 60 s is
    plenty of seconds."""
    model = compile_course(rlgl)
    assert model.nu == 14
    outcome = run_once(rlgl, walker, seed=1, model=model, command=rlgl.command_at(STEADY_VX))
    assert outcome.status in {"finish", "fall", "timeout", "caught"}
    assert 0 < len(outcome.trace) <= round(rlgl.time_limit_s / CTRL_DT)
    assert (outcome.time_s is not None) == (outcome.status == "finish")
