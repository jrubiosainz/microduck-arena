"""A troupe becomes what the runner plays and what the run keeps: each duck its policy, its rig, its
place and its sound, a borrowed one credited to its author."""

import hashlib
from pathlib import Path

import pytest

from arena.assets import ASSET_ROOT
from arena.cast import borrowed_source, cast_of, load_borrowed
from arena.hub_fetch import FetchedPolicy
from arena.manifest import load_event
from arena.policy import PolicyError
from arena.timeline import SELF, Duck, Start, Timeline, Troupe, constant_timeline

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40
ROLLER = "bob/microduck-roller@" + "b" * 40
STILL = Timeline(2.0, (0.0,), ((0.0,) * 13,))
QUACK = Timeline(2.0, (0.0, 1.0), ((0.0,) * 13,) * 2, ((0.0, 0.0), (1.0, 0.0)))


class _Policy:
    """Stands in for a loaded ONNX: a cast only hands it to the runner, and credits its sha256."""

    def __init__(self, sha256):
        self.sha256 = sha256


def _fetched(repo_id, revision, rig=None, manifest=None, path=Path("/tmp/x.onnx")):
    return FetchedPolicy(repo_id=repo_id, filename="policy.onnx", revision=revision, path=path,
                         url=f"https://huggingface.co/{repo_id}/resolve/{revision}/policy.onnx",
                         manifest=manifest, rig=rig)


@pytest.fixture(scope="module")
def talent():
    return load_event("got-a-talent")


def test_each_duck_plays_its_policy_on_its_rig_from_its_place(talent):
    star, sitter, roller = _Policy("s" * 64), _Policy("t" * 64), _Policy("r" * 64)
    troupe = Troupe(2.0, (
        Duck(SELF, Start(), QUACK),
        Duck(ROLLER, Start(0.4, -0.6, 90.0), STILL),
        Duck(SELF, Start(0.0, 0.6, 0.0), STILL),
        Duck(SITTER, Start(-0.4, 0.0, 180.0), STILL),
    ))
    borrowed = {SITTER: (_fetched("pollen-robotics/microduck-sitter", "a" * 40), sitter),
                ROLLER: (_fetched("bob/microduck-roller", "b" * 40, rig="rollers"), roller)}
    performers = cast_of(talent, troupe, star, None, borrowed).performers
    assert [p.policy for p in performers] == [star, roller, star, sitter]
    # One policy per distinct file: both copies of the entry's own play the one loaded once.
    assert performers[0].policy is performers[2].policy
    # A manifest that names no robot stands on the event's rig.
    assert [p.rig for p in performers] == ["legs", "rollers", "legs", "legs"]
    assert [(p.start, p.timeline) for p in performers] == [(d.start, d.timeline) for d in troupe.ducks]


def test_the_entrys_own_ducks_stand_on_its_manifests_rig(talent):
    troupe = Troupe(2.0, (Duck(SELF, Start(), STILL), Duck(SELF, Start(0.0, 0.6, 0.0), STILL)))
    cast = cast_of(talent, troupe, _Policy("s" * 64), "rollers", {})
    assert [p.rig for p in cast.performers] == ["rollers", "rollers"]
    assert [d["rig"] for d in cast.record] == ["rollers", "rollers"]


def test_the_record_places_each_duck_says_how_it_sounds_and_credits_a_borrowed_one(talent):
    troupe = Troupe(2.0, (Duck(SELF, Start(), QUACK), Duck(SITTER, Start(0.0, 0.6, 90.0), STILL)))
    sitter = _fetched("pollen-robotics/microduck-sitter", "a" * 40, manifest={"name": "Sitter"})
    cast = cast_of(talent, troupe, _Policy("s" * 64), None, {SITTER: (sitter, _Policy("t" * 64))})
    assert cast.record == (
        {"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
         "sound": {"triggers": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}},
        {"policy": {"repo_id": "pollen-robotics/microduck-sitter", "filename": "policy.onnx",
                    "revision": "a" * 40,
                    "url": "https://huggingface.co/pollen-robotics/microduck-sitter/resolve/" + "a" * 40 + "/policy.onnx",
                    "model_sha256": "t" * 64, "user": "pollen-robotics", "policy_name": "Sitter"},
         "rig": "legs", "start": {"x": 0.0, "y": 0.6, "yaw": 90.0}, "sound": None},
    )


def test_a_borrowed_policy_without_a_name_goes_by_its_repos():
    assert borrowed_source(_fetched("bob/microduck-roller", "b" * 40), _Policy("r" * 64))["policy_name"] == "roller"


def test_a_stage_entry_without_a_timeline_is_its_own_duck_alone_on_the_events_command(talent):
    star = _Policy("s" * 64)
    cast = cast_of(talent, None, star, None, {})
    (performer,) = cast.performers
    assert (performer.policy, performer.rig, performer.start) == (star, "legs", Start())
    assert performer.timeline == constant_timeline(talent.command, talent.time_limit_s)
    assert cast.record == ({"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0}, "sound": None},)


def test_each_borrowed_policy_is_loaded_beside_the_repo_it_came_from():
    troupe = Troupe(2.0, (Duck(SELF, Start(), STILL), Duck(SITTER, Start(0.0, 0.6, 0.0), STILL)))
    sitter = _fetched("pollen-robotics/microduck-sitter", "a" * 40, path=REFERENCE)
    ((fetched, policy),) = load_borrowed(troupe, {SITTER: sitter}).values()
    assert fetched is sitter
    assert policy.sha256 == hashlib.sha256(REFERENCE.read_bytes()).hexdigest()


def test_a_borrowed_file_that_does_not_load_names_the_first_duck_that_plays_it(tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not a model")
    troupe = Troupe(2.0, (Duck(SELF, Start(), STILL), Duck(SITTER, Start(0.0, 0.6, 0.0), STILL),
                          Duck(SITTER, Start(0.0, -0.6, 0.0), STILL)))
    with pytest.raises(PolicyError, match=r"^ducks\[1\]: pollen-robotics/microduck-sitter: not a loadable ONNX model"):
        load_borrowed(troupe, {SITTER: _fetched("pollen-robotics/microduck-sitter", "a" * 40, path=junk)})
