import json
from pathlib import Path

import pytest

from arena.constants import CTRL_DT
from arena.timeline import Note, Timeline, TimelineError, constant_timeline, load_timeline, sound_of

LIMIT_S = 20.0


def write(tmp_path, content) -> Path:
    path = tmp_path / "timeline.json"
    path.write_text(content if isinstance(content, str) else json.dumps(content))
    return path


def good(**overrides) -> dict:
    raw = {
        "timeline_version": 1,
        "duration_s": 10.0,
        "keyframes": [
            {"t": 0.0, "twist": [0, 0, 0]},
            {"t": 2.0, "twist": [1, 0, 0], "head": [0, 0, 0.5, 0]},
            {"t": 4.5, "body": [0, 0, 0, 0, 0, 0.25]},
        ],
    }
    return raw | overrides


def test_a_good_timeline_loads(tmp_path):
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert timeline.duration_s == 10.0
    assert timeline.times == (0.0, 2.0, 4.5)
    assert timeline.commands[1] == (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6


def test_a_missing_group_is_zeros_not_the_previous_keyframes(tmp_path):
    """keyframes[2] names only body: its twist and head are zeros, although
    keyframes[1] sat and looked left. Every keyframe is the whole command."""
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert timeline.commands[2] == (0.0,) * 12 + (0.25,)


def test_the_command_is_the_last_keyframe_at_or_before_t(tmp_path):
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert timeline.command_at(0.0) == timeline.commands[0]
    assert timeline.command_at(1.98) == timeline.commands[0]
    assert timeline.command_at(2.0) == timeline.commands[1]
    assert timeline.command_at(4.49) == timeline.commands[1]
    assert timeline.command_at(9.99) == timeline.commands[2]


@pytest.mark.parametrize("t", [0.3, 4.5, 7.0, 13.46])
def test_a_keyframe_on_the_control_grid_starts_at_its_own_step(tmp_path, t):
    """k * CTRL_DT is not exactly t in binary floating point (15 * 0.02 against
    0.3); the keyframe must still take effect at step round(t / CTRL_DT)."""
    raw = good(duration_s=20.0, keyframes=[{"t": 0.0}, {"t": t, "twist": [1, 0, 0]}])
    timeline = load_timeline(write(tmp_path, raw), LIMIT_S)
    k = round(t / CTRL_DT)
    assert timeline.command_at(k * CTRL_DT)[0] == 1.0
    assert timeline.command_at((k - 1) * CTRL_DT)[0] == 0.0


def test_constant_timeline_holds_one_command():
    command = (0.25,) + (0.0,) * 12
    timeline = constant_timeline(command, 20.0)
    assert timeline == Timeline(20.0, (0.0,), (command,))
    assert timeline.command_at(19.99) == command


def test_triggers_are_read_per_keyframe_and_released_when_left_out(tmp_path):
    raw = good(keyframes=[
        {"t": 0.0},
        {"t": 2.0, "twist": [1, 0, 0], "triggers": [1, 0]},
        {"t": 2.3, "twist": [1, 0, 0]},
        {"t": 4.0, "triggers": [0, 0.5]},
    ])
    timeline = load_timeline(write(tmp_path, raw), LIMIT_S)
    assert timeline.triggers == ((0.0, 0.0), (1.0, 0.0), (0.0, 0.0), (0.0, 0.5))
    # The policy never sees them: the command stays the 13 numbers.
    assert timeline.commands[1] == (1.0,) + (0.0,) * 12


def test_the_sound_keeps_the_trigger_changes_only(tmp_path):
    """RT held over two keyframes is one pull, not two: the replay quacks on a change."""
    raw = good(keyframes=[
        {"t": 0.0, "triggers": [1, 0]},
        {"t": 1.0, "twist": [1, 0, 0], "triggers": [1, 0]},
        {"t": 2.0},
        {"t": 3.0, "head": [0, 0, 0.3, 0]},
        {"t": 4.0, "triggers": [0, 1]},
    ])
    assert sound_of(load_timeline(write(tmp_path, raw), LIMIT_S)) == {
        "triggers": [[0.0, 1.0, 0.0], [2.0, 0.0, 0.0], [4.0, 0.0, 1.0]],
    }


def test_the_sound_carries_each_note_resolved_and_the_voice(tmp_path):
    raw = good(voice={"pitch": 0.3}, song=[
        {"t": 1.0, "note": "A4", "for": 0.5},
        {"t": 2.0, "note": "C5", "for": 1.0, "dynamic": "p", "vowel": "mm"},
    ])
    assert sound_of(load_timeline(write(tmp_path, raw), LIMIT_S)) == {
        "voice": {"pitch": 0.3},
        "song": [[1.0, 0.5, 69, 0.70, 0.90, 0.0], [2.0, 1.0, 72, pytest.approx(0.40 * 0.65), 0.05, -2.0]],
    }


def test_a_performance_that_sings_nothing_and_pulls_nothing_has_no_sound(tmp_path):
    assert sound_of(load_timeline(write(tmp_path, good()), LIMIT_S)) is None
    # A voice nobody hears is nothing to store.
    assert sound_of(load_timeline(write(tmp_path, good(voice={"pitch": 1})), LIMIT_S)) is None
    assert sound_of(constant_timeline((0.0,) * 13, 20.0)) is None


def test_a_song_and_a_voice_load_beside_the_keyframes(tmp_path):
    raw = good(voice={"pitch": 0.3, "breath": 0}, song=[
        {"t": 1.0, "note": "C5", "for": 0.5},
        {"t": 1.5, "note": "eb4", "for": 0.25, "dynamic": "p", "vowel": "oo"},
        {"t": 2.0, "note": "F#3", "for": 1.0},
    ])
    timeline = load_timeline(write(tmp_path, raw), LIMIT_S)
    assert timeline.voice == {"pitch": 0.3, "breath": 0.0}
    assert timeline.song == (
        Note(1.0, 0.5, 72, "mf", "ah"),
        Note(1.5, 0.25, 63, "p", "oo"),
        Note(2.0, 1.0, 54, "mf", "ah"),
    )
    # The policy never hears it: the command numbers are the keyframes' alone.
    assert timeline.commands == load_timeline(write(tmp_path, good()), LIMIT_S).commands


def test_a_timeline_without_a_song_or_a_voice_has_neither(tmp_path):
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert (timeline.voice, timeline.song) == ({}, ())


def test_notes_written_end_to_end_in_decimals_follow_each_other(tmp_path):
    """0.1 + 0.2 is 0.30000000000000004 in floating point: a note at 0.3 still follows one at 0.1 for 0.2,
    and a note ending exactly at duration_s fits."""
    raw = good(song=[{"t": 0.1, "note": "C4", "for": 0.2}, {"t": 0.3, "note": "D4", "for": 9.7}])
    assert len(load_timeline(write(tmp_path, raw), LIMIT_S).song) == 2


@pytest.mark.parametrize(
    "raw, said",
    [
        (good(extra=1), r"unknown keys \['extra'\]"),
        ({k: v for k, v in good().items() if k != "keyframes"}, "missing 'keyframes'"),
        (good(timeline_version=2), "timeline_version: this Arena plays version 1"),
        (good(timeline_version=True), "timeline_version: this Arena plays version 1"),
        (good(duration_s=0.0), "duration_s: must be at least one control step"),
        (good(duration_s=0.01), "duration_s: must be at least one control step"),
        (good(duration_s=20.5), "duration_s: 20.5 s is longer than this event's 20 s"),
        (good(duration_s="10"), "duration_s: expected a number"),
        (good(keyframes=[]), "keyframes: expected 1 to 1000"),
        (good(keyframes=[{"t": 0.01 * i} for i in range(1001)]), "keyframes: expected 1 to 1000"),
        (good(keyframes={"t": 0.0}), "keyframes: expected 1 to 1000"),
        (good(keyframes=[{"t": 0.5}]), r"keyframes\[0\]\.t: the first keyframe starts at 0.0"),
        (good(keyframes=[{"t": 0.0}, {"t": 0.0}]), r"keyframes\[1\]\.t: 0.0 does not come after 0.0"),
        (good(keyframes=[{"t": 0.0}, {"t": 3.0}, {"t": 2.0}]), r"keyframes\[2\]\.t"),
        (good(keyframes=[{"t": 0.0}, {"t": 10.0}]), r"keyframes\[1\]\.t: 10.0 is not before the end"),
        (good(keyframes=[{"twist": [0, 0, 0]}]), r"keyframes\[0\]: missing 't'"),
        (good(keyframes=[{"t": 0.0, "arms": [1]}]), r"keyframes\[0\]: unknown keys \['arms'\]"),
        (good(keyframes=[[0.0, 1, 0, 0]]), r"keyframes\[0\]: expected an object"),
        (good(keyframes=[{"t": 0.0, "twist": [0, 0]}]), r"keyframes\[0\]\.twist: expected 3 numbers"),
        (good(keyframes=[{"t": 0.0, "head": 0.5}]), r"keyframes\[0\]\.head: expected 4 numbers"),
        (good(keyframes=[{"t": 0.0, "twist": ["1", 0, 0]}]), r"keyframes\[0\]\.twist\[0\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "twist": [True, 0, 0]}]), r"keyframes\[0\]\.twist\[0\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "body": [0, 0, 0, 0, 0, 10.5]}]), r"keyframes\[0\]\.body\[5\]: 10.5 is outside ±10"),
        (good(keyframes=[{"t": 0.0, "triggers": [1]}]), r"keyframes\[0\]\.triggers: expected 2 numbers"),
        (good(keyframes=[{"t": 0.0, "triggers": 1}]), r"keyframes\[0\]\.triggers: expected 2 numbers"),
        (good(keyframes=[{"t": 0.0, "triggers": [0, "1"]}]), r"keyframes\[0\]\.triggers\[1\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "triggers": [0, True]}]), r"keyframes\[0\]\.triggers\[1\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "triggers": [1.5, 0]}]), r"keyframes\[0\]\.triggers\[0\]: 1.5 is outside \[0, 1\]"),
        (good(keyframes=[{"t": 0.0, "triggers": [0, -0.1]}]), r"keyframes\[0\]\.triggers\[1\]: -0.1 is outside \[0, 1\]"),
        (good(voice=[0.3]), r"voice: expected an object, got list"),
        (good(voice={"speed": 1}), r"voice: unknown keys \['speed'\]"),
        (good(voice={"pitch": 1.5}), r"voice\.pitch: 1\.5 is outside \[0, 1\]"),
        (good(voice={"buzz": "0.5"}), r"voice\.buzz: expected a number"),
        (good(song=[]), r"song: expected 1 to 1000 notes in a list, got 0"),
        (good(song={"t": 0}), r"song: expected 1 to 1000 notes in a list, got a dict"),
        (good(song=[{"t": 0.01 * i, "note": "C4", "for": 0.02} for i in range(1001)]), r"song: expected 1 to 1000 notes"),
        (good(song=["C4"]), r"song\[0\]: expected an object, got str"),
        (good(song=[{"t": 0, "note": "C4", "for": 1, "level": 1}]), r"song\[0\]: unknown keys \['level'\]"),
        (good(song=[{"t": 0, "for": 1}]), r"song\[0\]: missing 'note'"),
        (good(song=[{"t": -1, "note": "C4", "for": 1}]), r"song\[0\]\.t: -1\.0 is before the start of the performance"),
        (good(song=[{"t": 0, "note": "C4", "for": 0.01}]), r"song\[0\]\.for: must be at least one control step \(0\.02 s\), got 0\.01"),
        (good(song=[{"t": 0, "note": "C4", "for": 1.5}, {"t": 1.2, "note": "D4", "for": 1}]), r"song\[1\]\.t: 1\.2 starts before song\[0\] ends \(1\.5\)"),
        (good(song=[{"t": 9.5, "note": "C4", "for": 0.9}]), r"song\[0\]: ends at 10\.4, after the end of the performance \(10 s\)"),
        (good(song=[{"t": 0, "note": "H4", "for": 1}]), r"song\[0\]\.note: 'H4' is not a note name"),
        (good(song=[{"t": 0, "note": "C", "for": 1}]), r"song\[0\]\.note: 'C' is not a note name"),
        (good(song=[{"t": 0, "note": 60, "for": 1}]), r"song\[0\]\.note: 60 is not a note name"),
        (good(song=[{"t": 0, "note": "C8", "for": 1}]), r"song\[0\]\.note: 'C8' is outside C2 to C7"),
        (good(song=[{"t": 0, "note": "B1", "for": 1}]), r"song\[0\]\.note: 'B1' is outside C2 to C7"),
        (good(song=[{"t": 0, "note": "C4", "for": 1, "dynamic": "loud"}]), r"song\[0\]\.dynamic: 'loud' is not one of ppp pp p mp mf f ff"),
        (good(song=[{"t": 0, "note": "C4", "for": 1, "dynamic": ["f"]}]), r"song\[0\]\.dynamic: \['f'\] is not one of"),
        (good(song=[{"t": 0, "note": "C4", "for": 1, "vowel": "uh"}]), r"song\[0\]\.vowel: 'uh' is not one of ah eh ee oh oo mm"),
        (good(song=[{"t": 0, "note": "C4", "for": 1, "vowel": 3}]), r"song\[0\]\.vowel: 3 is not one of"),
        (good(song=[{"t": 0, "note": "C" + "1" * 5000, "for": 1}]), r"song\[0\]\.note: 'C1+' is not a note name"),
    ],
)
def test_a_malformed_timeline_is_refused_with_where(tmp_path, raw, said):
    with pytest.raises(TimelineError, match=said):
        load_timeline(write(tmp_path, raw), LIMIT_S)


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_jsons_non_finite_literals_are_refused(tmp_path, literal):
    """Python's json module reads NaN and Infinity as floats; a command must not hold one."""
    text = ('{"timeline_version": 1, "duration_s": 5.0, '
            '"keyframes": [{"t": 0.0, "head": [0, 0, %s, 0]}]}' % literal)
    with pytest.raises(TimelineError, match=r"keyframes\[0\]\.head\[2\]: must be finite"):
        load_timeline(write(tmp_path, text), LIMIT_S)


def test_an_integer_too_large_for_a_float_is_refused_as_a_command_value(tmp_path):
    """math.isfinite raises OverflowError on a 400-digit int rather than saying no."""
    raw = good(keyframes=[{"t": 0.0, "twist": [10**400, 0, 0]}])
    with pytest.raises(TimelineError, match=r"keyframes\[0\]\.twist\[0\]: must be finite"):
        load_timeline(write(tmp_path, raw), LIMIT_S)


def test_an_integer_too_large_for_a_float_is_refused_as_duration_s(tmp_path):
    with pytest.raises(TimelineError, match="duration_s: must be finite"):
        load_timeline(write(tmp_path, good(duration_s=10**400)), LIMIT_S)


def test_an_integer_over_pythons_string_conversion_limit_is_refused(tmp_path):
    """A 5000-digit integer literal makes json.loads raise a plain ValueError,
    not a JSONDecodeError, when it converts the digits to an int."""
    text = '{"timeline_version": 1, "duration_s": %s, "keyframes": [{"t": 0.0}]}' % ("1" * 5000)
    with pytest.raises(TimelineError, match="not a JSON file"):
        load_timeline(write(tmp_path, text), LIMIT_S)


def test_deeply_nested_json_is_refused(tmp_path):
    """100k nested '[' overflows json's recursive descent parser."""
    with pytest.raises(TimelineError, match="not a JSON file"):
        load_timeline(write(tmp_path, "[" * 100000), LIMIT_S)


def test_a_file_that_is_not_json_is_refused(tmp_path):
    with pytest.raises(TimelineError, match="timeline.json: not a JSON file"):
        load_timeline(write(tmp_path, "{nope"), LIMIT_S)


def test_a_file_that_is_not_utf8_is_refused(tmp_path):
    path = tmp_path / "timeline.json"
    path.write_bytes(b"\xff\xfe{}")
    with pytest.raises(TimelineError, match="timeline.json: not a JSON file"):
        load_timeline(path, LIMIT_S)


def test_a_top_level_that_is_not_an_object_is_refused(tmp_path):
    with pytest.raises(TimelineError, match="timeline.json: expected a JSON object, got list"):
        load_timeline(write(tmp_path, "[]"), LIMIT_S)


def test_a_missing_file_is_refused(tmp_path):
    with pytest.raises(TimelineError, match="missing.json"):
        load_timeline(tmp_path / "missing.json", LIMIT_S)
