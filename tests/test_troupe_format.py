"""timeline.json version 2: a troupe of ducks on the stage, each with its policy, place, keyframes,
voice and song. A version 1 file is a troupe of one."""

import json

import pytest

from arena.manifest import load_event
from arena.timeline import (
    EDGE_MARGIN_M,
    MIN_SPACING_M,
    SELF,
    Duck,
    Note,
    Start,
    Timeline,
    TimelineError,
    Troupe,
    constant_timeline,
    load_troupe,
    solo,
    split_local,
    split_reference,
)

TALENT = load_event("got-a-talent")
COMMIT = "0123456789abcdef0123456789abcdef01234567"
REFERENCE = f"pollen-robotics/microduck-got-a-talent-reference@{COMMIT}"
WALKER = f"ann/microduck-walker@{'f' * 40}"
LOCAL = "local:got_a_talent/2026-10-13_10-00-00_first@1500"


def write(tmp_path, content):
    path = tmp_path / "timeline.json"
    path.write_text(json.dumps(content))
    return path


def duck(policy=SELF, **keys) -> dict:
    return {"policy": policy, "keyframes": [{"t": 0.0}]} | keys


def troupe(*ducks, **top) -> dict:
    return {"timeline_version": 2, "duration_s": 10.0, "ducks": list(ducks)} | top


def apart(x: float, y: float = 0.0) -> dict:
    """A start far enough from the centre's duck."""
    return {"x": x, "y": y}


def test_a_version_1_file_is_a_troupe_of_one_self_duck_at_the_centre(tmp_path):
    raw = {"timeline_version": 1, "duration_s": 10.0, "voice": {"pitch": 0.3},
           "song": [{"t": 1.0, "note": "A4", "for": 0.5}],
           "keyframes": [{"t": 0.0}, {"t": 2.0, "twist": [1, 0, 0], "triggers": [1, 0]}]}
    path = write(tmp_path, raw)
    loaded = load_troupe(path, TALENT)
    still, sit = (0.0,) * 13, (1.0,) + (0.0,) * 12
    alone = Timeline(10.0, (0.0, 2.0), (still, sit), ((0.0, 0.0), (1.0, 0.0)), {"pitch": 0.3},
                     (Note(1.0, 0.5, 69, "mf", "ah"),))
    assert loaded == Troupe(10.0, (Duck(SELF, Start(), alone),))
    assert loaded.references() == ()


def test_solo_is_one_self_duck_at_the_centre_facing_the_audience():
    timeline = constant_timeline((0.0,) * 13, 20.0)
    assert solo(timeline) == Troupe(20.0, (Duck(SELF, Start(0.0, 0.0, 0.0), timeline),))
    assert Start().to_dict() == {"x": 0.0, "y": 0.0, "yaw": 0.0}


def test_each_duck_brings_its_policy_place_keyframes_voice_and_song(tmp_path):
    raw = troupe(
        duck(start={"x": 0.0, "y": 0.0, "yaw": 0}, voice={"pitch": 0.2},
             song=[{"t": 2.0, "note": "C4", "for": 0.5}],
             keyframes=[{"t": 0.0, "twist": [1, 0, 0], "triggers": [0, 1]}]),
        duck(REFERENCE, start={"x": 0.4, "y": -0.6, "yaw": 90}),
        duck(SELF, start={"y": 1.2}, keyframes=[{"t": 0.0}, {"t": 5.0, "body": [0, 0, 0, 0, 0, 0.25]}]),
    )
    loaded = load_troupe(write(tmp_path, raw), TALENT)
    assert loaded.duration_s == 10.0
    star, guest, copy = loaded.ducks
    assert (star.policy, guest.policy, copy.policy) == (SELF, REFERENCE, SELF)
    assert (star.start, guest.start, copy.start) == (Start(), Start(0.4, -0.6, 90.0), Start(0.0, 1.2, 0.0))
    assert star.timeline.commands == ((1.0,) + (0.0,) * 12,)
    assert star.timeline.triggers == ((0.0, 1.0),)
    assert (star.timeline.voice, star.timeline.song) == ({"pitch": 0.2}, (Note(2.0, 0.5, 60, "mf", "ah"),))
    assert (guest.timeline.voice, guest.timeline.song) == ({}, ())
    assert copy.timeline.times == (0.0, 5.0)
    # The troupe's length is every duck's.
    assert {d.timeline.duration_s for d in loaded.ducks} == {10.0}


def test_a_start_left_out_is_the_centre_and_a_coordinate_left_out_is_zero(tmp_path):
    raw = troupe(duck(), duck(SELF, start={"x": 0.5}), duck(SELF, start={"yaw": -180, "y": -0.5}))
    starts = [d.start for d in load_troupe(write(tmp_path, raw), TALENT).ducks]
    assert starts == [Start(), Start(0.5, 0.0, 0.0), Start(0.0, -0.5, -180.0)]


def test_the_references_are_every_borrowed_policy_once_in_order(tmp_path):
    raw = troupe(duck(), duck(WALKER, start=apart(0.5)), duck(REFERENCE, start=apart(-0.5)),
                 duck(SELF, start=apart(0.0, 0.5)))
    assert load_troupe(write(tmp_path, raw), TALENT).references() == (WALKER, REFERENCE)
    again = troupe(duck(), duck(WALKER, start=apart(0.5)), duck(WALKER, start=apart(-0.5)))
    assert load_troupe(write(tmp_path, again), TALENT).references() == (WALKER,)


def test_a_reference_and_a_local_checkpoint_split_into_their_parts():
    assert split_reference(REFERENCE) == ("pollen-robotics/microduck-got-a-talent-reference", COMMIT)
    assert split_local(LOCAL) == ("got_a_talent", "2026-10-13_10-00-00_first", 1500)


def test_a_local_checkpoint_plays_only_where_the_workshop_asks_for_it(tmp_path):
    path = write(tmp_path, troupe(duck(), duck(LOCAL, start=apart(0.5))))
    assert load_troupe(path, TALENT, allow_local=True).ducks[1].policy == LOCAL
    with pytest.raises(TimelineError, match=r"ducks\[1\]\.policy: 'local:got_a_talent/.*@1500' is a checkpoint on "
                                            r"your machine: publish it first"):
        load_troupe(path, TALENT)


def test_a_start_on_the_margin_or_exactly_the_spacing_apart_is_taken(tmp_path):
    """The stage is 2.6 x 3.8 m: a start may reach 1.0 m along x and 1.6 m along y, which 1.9 - 0.3 misses
    by one bit in floating point; 0.7 - 0.4 is under 0.3 by one bit too."""
    assert (TALENT.course.size_m[0] / 2 - EDGE_MARGIN_M, MIN_SPACING_M) == (1.0, 0.3)
    raw = troupe(duck(start={"x": 1.0, "y": 1.6}), duck(SELF, start={"x": -1.0, "y": -1.6}),
                 duck(SELF, start={"x": 0.4}), duck(SELF, start={"x": 0.7}))
    assert len(load_troupe(write(tmp_path, raw), TALENT).ducks) == 4


@pytest.mark.parametrize(
    "raw, said",
    [
        (troupe(duck(), keyframes=[{"t": 0.0}]), r"timeline\.json: unknown keys \['keyframes'\]"),
        ({"timeline_version": 2, "duration_s": 10.0}, r"timeline\.json: missing 'ducks'"),
        (troupe(duck(), duration_s=20.5), r"duration_s: 20\.5 s is longer than this event's 20 s"),
        (troupe(), r"ducks: expected 1 to 4 ducks in a list, got 0"),
        (troupe() | {"ducks": {"policy": "self"}}, r"ducks: expected 1 to 4 ducks in a list, got a dict"),
        (troupe(*[duck(SELF, start=apart(0.5 * i - 1.0)) for i in range(5)]), r"ducks: 5 ducks, this event takes at most 4"),
        (troupe(duck(), "self"), r"ducks\[1\]: expected an object, got str"),
        (troupe(duck(), duck(SELF, start=apart(0.5), speed=1)), r"ducks\[1\]: unknown keys \['speed'\]"),
        (troupe(duck(), {"keyframes": [{"t": 0.0}]}), r"ducks\[1\]: missing 'policy'"),
        (troupe(duck(), {"policy": SELF}), r"ducks\[1\]: missing 'keyframes'"),
        (troupe(duck(f"a/b@{COMMIT}")), r"""ducks\[0\]\.policy: the first duck is the entry's own policy: "self", got 'a/b@0123"""),
        (troupe(duck(), duck(3, start=apart(0.5))), r'ducks\[1\]\.policy: expected "self" or owner/repo@<commit>, got 3'),
        (troupe(duck(), duck("a/b@main", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b@main' must pin a full 40-character commit"),
        (troupe(duck(), duck("a/b", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b' must pin a full 40-character commit"),
        (troupe(duck(), duck(f"a/b@{COMMIT.upper()}", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b@0123456789ABCDEF.*' must pin"),
        (troupe(duck(), duck(f"a/b@{COMMIT[:7]}", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b@0123456' must pin"),
        (troupe(duck(), duck("walker", start=apart(0.5))), r"""ducks\[1\]\.policy: 'walker' is neither "self" nor owner/repo@<commit>"""),
        (troupe(duck(), duck(SELF, start=[0.5, 0])), r"ducks\[1\]\.start: expected an object, got list"),
        (troupe(duck(), duck(SELF, start={"x": 0.5, "z": 0.1})), r"ducks\[1\]\.start: unknown keys \['z'\]"),
        (troupe(duck(), duck(SELF, start={"x": "0.5"})), r"ducks\[1\]\.start\.x: expected a number"),
        (troupe(duck(), duck(SELF, start={"x": 0.5, "yaw": True})), r"ducks\[1\]\.start\.yaw: expected a number"),
        (troupe(duck(), duck(SELF, start={"x": 0.5, "yaw": 200})), r"ducks\[1\]\.start\.yaw: 200 is outside ±180 degrees"),
        (troupe(duck(), duck(SELF, start={"x": 1.2})), r"ducks\[1\]\.start: x 1\.2 is off the stage \(\|x\| ≤ 1 m\)"),
        (troupe(duck(), duck(SELF, start={"y": -1.7})), r"ducks\[1\]\.start: y -1\.7 is off the stage \(\|y\| ≤ 1\.6 m\)"),
        (troupe(duck(start={"x": -1.01})), r"ducks\[0\]\.start: x -1\.01 is off the stage"),
        (troupe(duck(), duck(SELF)), r"ducks\[1\]\.start: 0\.00 m from ducks\[0\], closer than 0\.3 m"),
        (troupe(duck(), duck(SELF, start=apart(0.5)), duck(SELF, start=apart(0.5, 0.21))),
         r"ducks\[2\]\.start: 0\.21 m from ducks\[1\], closer than 0\.3 m"),
        (troupe(duck(), duck(SELF, start=apart(0.5), keyframes=[{"t": 0.5}])),
         r"ducks\[1\]\.keyframes\[0\]\.t: the first keyframe starts at 0\.0"),
        (troupe(duck(), duck(SELF, start=apart(0.5), keyframes=[])), r"ducks\[1\]\.keyframes: expected 1 to 1000"),
        (troupe(duck(), duck(SELF, start=apart(0.5), keyframes=[{"t": 0.0, "twist": [11, 0, 0]}])),
         r"ducks\[1\]\.keyframes\[0\]\.twist\[0\]: 11\.0 is outside ±10"),
        (troupe(duck(), duck(SELF, start=apart(0.5), voice={"pitch": 1.5})), r"ducks\[1\]\.voice\.pitch: 1\.5 is outside \[0, 1\]"),
        (troupe(duck(), duck(SELF, start=apart(0.5), voice=[0.5])), r"ducks\[1\]\.voice: expected an object, got list"),
        (troupe(duck(), duck(SELF, start=apart(0.5), song=[{"t": 0, "note": "H4", "for": 1}])),
         r"ducks\[1\]\.song\[0\]\.note: 'H4' is not a note name"),
        (troupe(duck(), duck(SELF, start=apart(0.5), song=[{"t": 0, "note": "C4", "for": 1.5}, {"t": 1.2, "note": "D4", "for": 1}])),
         r"ducks\[1\]\.song\[1\]\.t: 1\.2 starts before ducks\[1\]\.song\[0\] ends \(1\.5\)"),
        (troupe(duck(), duck(SELF, start=apart(0.5), song=[{"t": 9.5, "note": "C4", "for": 0.9}])),
         r"ducks\[1\]\.song\[0\]: ends at 10\.4, after the end of the performance \(10 s\)"),
    ],
)
def test_a_malformed_troupe_is_refused_with_where(tmp_path, raw, said):
    with pytest.raises(TimelineError, match=said):
        load_troupe(write(tmp_path, raw), TALENT, allow_local=True)


@pytest.mark.parametrize("policy", ["local:got_a_talent", "local:got_a_talent/first", "local:a/b@x", "local:/b@1"])
def test_a_local_checkpoint_names_its_challenge_its_run_and_its_number(tmp_path, policy):
    with pytest.raises(TimelineError, match=r"ducks\[1\]\.policy: .* is not local:<challenge folder>/<run>@<checkpoint>"):
        load_troupe(write(tmp_path, troupe(duck(), duck(policy, start=apart(0.5)))), TALENT, allow_local=True)
