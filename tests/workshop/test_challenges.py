"""A checkout's challenges, as the workshop reads and edits them."""

import pytest

from arena.workshop.challenges import ChallengeError, open_challenges, read_challenge, write_values

SPRINT = """\
# The 2 m Sprint.
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
kind  = "perpetual"

[recipe]                  # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]
label = "Follow the speed order"
value = 2.0               # what the page edits
min   = 0.5
max   = 5.0
"""


def _folder(root, name, text):
    folder = root / "src" / "microduck_challenges" / name
    folder.mkdir(parents=True)
    (folder / "challenge.toml").write_text(text)
    return folder / "challenge.toml"


def test_a_challenge_reads_its_contract_recipe_and_knobs(tmp_path):
    challenge = read_challenge(_folder(tmp_path, "sprint_2m", SPRINT))
    assert (challenge.folder, challenge.event, challenge.task, challenge.kind) == (
        "sprint_2m", "sprint-2m", "Mjlab-Sprint2m-MicroDuck", "perpetual")
    assert challenge.recipe == {"num_envs": 4096, "max_iterations": 3000, "seed": 1}
    (knob,) = challenge.knobs
    assert (knob.name, knob.label, knob.value, knob.min, knob.max) == (
        "forward_reward", "Follow the speed order", 2.0, 0.5, 5.0)


def test_only_challenges_whose_event_is_open_here_are_offered(tmp_path):
    _folder(tmp_path, "sprint_2m", SPRINT)
    _folder(tmp_path, "jump", SPRINT.replace('"sprint-2m"', '"highest-jump"'))  # planned
    _folder(tmp_path, "gone", SPRINT.replace('"sprint-2m"', '"no-such-event"'))
    assert [c.event for c in open_challenges(tmp_path)] == ["sprint-2m"]


def test_a_challenge_without_a_recipe_is_refused_by_name(tmp_path):
    toml = _folder(tmp_path, "broken", SPRINT.split("[recipe]")[0])
    with pytest.raises(ChallengeError, match="broken"):
        read_challenge(toml)


def test_values_are_written_in_place_keeping_every_comment(tmp_path):
    toml = _folder(tmp_path, "sprint_2m", SPRINT)
    changed = write_values(read_challenge(toml), {"num_envs": 1024, "max_iterations": 500, "seed": 7},
                           {"forward_reward": 3.5})
    assert changed is True
    assert toml.read_text() == (
        SPRINT.replace("= 4096", "= 1024").replace("= 3000", "= 500").replace("seed           = 1", "seed           = 7")
        .replace("value = 2.0 ", "value = 3.5 ")
    )
    again = read_challenge(toml)
    assert again.recipe["num_envs"] == 1024 and again.knobs[0].value == 3.5


def test_writing_the_same_values_changes_nothing(tmp_path):
    toml = _folder(tmp_path, "sprint_2m", SPRINT)
    challenge = read_challenge(toml)
    assert write_values(challenge, challenge.recipe, {"forward_reward": 2.0}) is False
    assert toml.read_text() == SPRINT


@pytest.mark.parametrize(
    "recipe,params,complaint",
    [
        ({"num_envs": 0}, {}, "num_envs"),
        ({"seed": -1}, {}, "seed"),
        ({"batch": 4}, {}, "batch"),
        ({}, {"forward_reward": 9.0}, "between 0.5 and 5"),
        ({}, {"mystery": 1.0}, "mystery"),
    ],
)
def test_a_bad_value_is_refused_and_nothing_is_written(tmp_path, recipe, params, complaint):
    toml = _folder(tmp_path, "sprint_2m", SPRINT)
    with pytest.raises(ChallengeError, match=complaint):
        write_values(read_challenge(toml), recipe, params)
    assert toml.read_text() == SPRINT
