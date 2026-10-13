"""A performance's command timeline: what the Arena asks a policy for, and when.

A stage event (arena/manifest.py) plays an author's `timeline.json` instead of a
constant command: at every control step, the 13 command numbers the policy
reads come from the last keyframe at or before that time. The format is the
Arena's contract with authors, so it is checked strictly and every refusal says
where the file is wrong. What the numbers mean is the policy's business: the
Arena checks the format, never the choreography.

    {"timeline_version": 1, "duration_s": 20.0,
     "keyframes": [{"t": 0.0, "twist": [0, 0, 0], "head": [0, 0, 0, 0], "body": [0, 0, 0, 0, 0, 0]}]}

Every keyframe is the whole command: a group it leaves out is zeros, never the
previous keyframe's values.

A keyframe may also pull the real pad's two triggers, `"triggers": [rt, lt]`, each within [0, 1]:
in the replay they open the duck's beak and make it quack or wheee (app/src/duck-voice.js). The
policy never reads them — the command stays 13 numbers — and a keyframe that leaves them out
releases both, like any group.

Beside the keyframes, a performance may sing: `"song"` is a list of notes, each
`{"t", "note", "for", "dynamic", "vowel"}` (a scientific pitch name, C4 = middle C; a dynamic
ppp..ff, mf by default; a vowel ah eh ee oh oo mm, ah by default), one at a time. `"voice"` tunes
the duck's voice for the quack, the wheee and the song: five knobs, each within [0, 1]. Neither
is a policy input.
"""

import bisect
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

from .constants import CTRL_DT

TIMELINE_VERSION = 1
MAX_KEYFRAMES = 1000
MAX_VALUE = 10.0
# The command groups, in the order they fill the observation's command slot.
GROUPS = (("twist", 3), ("head", 4), ("body", 6))
# The pad's RT and LT, read beside the command and never by the policy.
TRIGGERS = 2
# The voice's knobs, each a position within [0, 1] over a trait of the robot's personality; the
# synth maps them (app/voice/src/lib.rs), and a knob left out keeps the stage duck's own trait.
VOICE_KNOBS = ("pitch", "brightness", "buzz", "vibrato", "breath")
MAX_NOTES = 1000
# The robot chorale's marks, copied from sounds::chorale at microduck e597877: a dynamic's level,
# and a vowel's beak opening, formant shift (in harmonics) and level scale.
DYNAMICS = {"ppp": 0.15, "pp": 0.25, "p": 0.40, "mp": 0.55, "mf": 0.70, "f": 0.85, "ff": 1.00}
VOWELS = {
    "ah": (0.90, 0.0, 1.0),
    "eh": (0.65, 1.0, 1.0),
    "ee": (0.45, 3.0, 1.0),
    "oh": (0.55, -1.0, 1.0),
    "oo": (0.35, -2.0, 1.0),
    "mm": (0.05, -2.0, 0.65),
}
# The notes a song may sing, as MIDI numbers: C2 to C7.
LOWEST_NOTE, HIGHEST_NOTE = 36, 96
_NOTE_KEYS = ("t", "note", "for", "dynamic", "vowel")
_NOTE_NAME = re.compile(r"([A-Ga-g])([#b]?)(-?\d{1,2})")
_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_TOP_KEYS = ("timeline_version", "duration_s", "keyframes")
# Keyframe times are decimal seconds; the runner asks for k * CTRL_DT, which
# binary floating point cannot always hold (15 * 0.02 < 0.3). A keyframe takes
# effect at the step that starts within this of its time.
_EPS_S = 1e-9


class TimelineError(Exception):
    """A timeline.json the Arena will not play, with the reason and the place."""


@dataclass(frozen=True)
class Note:
    """One note of a song: when it starts and how long it lasts, in seconds, its MIDI number, and
    the names of its dynamic and its vowel."""

    t: float
    length_s: float
    midi: int
    dynamic: str
    vowel: str


@dataclass(frozen=True)
class Timeline:
    duration_s: float
    times: tuple[float, ...]
    commands: tuple[tuple[float, ...], ...]
    # The pad's (RT, LT) at each keyframe; empty for a timeline made in code, which pulls nothing.
    triggers: tuple[tuple[float, float], ...] = ()
    # The voice's knobs the author wrote, and the song's notes in order.
    voice: dict = field(default_factory=dict)
    song: tuple[Note, ...] = ()

    def command_at(self, t: float) -> tuple[float, ...]:
        """The 13 command numbers at time t: the last keyframe with t_k <= t."""
        return self.commands[bisect.bisect_right(self.times, t + _EPS_S) - 1]


def constant_timeline(command, duration_s: float) -> Timeline:
    """One command for the whole performance: what an entry without a timeline plays."""
    return Timeline(float(duration_s), (0.0,), (tuple(float(v) for v in command),))


def _number(value, where: str) -> float:
    # bool is an int in Python, and `true` would otherwise read as 1.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TimelineError(f"{where}: expected a number, got {value!r}")
    try:
        value = float(value)
    except OverflowError as exc:
        raise TimelineError(f"{where}: must be finite, got an integer too large for a float") from exc
    if not math.isfinite(value):
        raise TimelineError(f"{where}: must be finite, got {value!r}")
    return value


def _keyframe(raw, index: int, duration_s: float, previous_t: float | None):
    where = f"keyframes[{index}]"
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - {"t", "triggers", *(name for name, _ in GROUPS)})
    if unknown:
        raise TimelineError(f"{where}: unknown keys {unknown}")
    if "t" not in raw:
        raise TimelineError(f"{where}: missing 't'")
    t = _number(raw["t"], f"{where}.t")
    if previous_t is None and t != 0.0:
        raise TimelineError(f"{where}.t: the first keyframe starts at 0.0, got {t}")
    if previous_t is not None and t <= previous_t:
        raise TimelineError(f"{where}.t: {t} does not come after {previous_t}")
    if t >= duration_s:
        raise TimelineError(f"{where}.t: {t} is not before the end of the performance ({duration_s:g} s)")
    command = []
    for name, width in GROUPS:
        values = raw.get(name, [0.0] * width)
        if not isinstance(values, list) or len(values) != width:
            raise TimelineError(f"{where}.{name}: expected {width} numbers, got {values!r}")
        for i, value in enumerate(values):
            number = _number(value, f"{where}.{name}[{i}]")
            if abs(number) > MAX_VALUE:
                raise TimelineError(f"{where}.{name}[{i}]: {number} is outside ±{MAX_VALUE:g}")
            command.append(number)
    pulled = raw.get("triggers", [0.0] * TRIGGERS)
    if not isinstance(pulled, list) or len(pulled) != TRIGGERS:
        raise TimelineError(f"{where}.triggers: expected {TRIGGERS} numbers, got {pulled!r}")
    triggers = []
    for i, value in enumerate(pulled):
        number = _number(value, f"{where}.triggers[{i}]")
        if not 0.0 <= number <= 1.0:
            raise TimelineError(f"{where}.triggers[{i}]: {number} is outside [0, 1]")
        triggers.append(number)
    return t, tuple(command), tuple(triggers)


def _voice(raw) -> dict:
    if not isinstance(raw, dict):
        raise TimelineError(f"voice: expected an object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - set(VOICE_KNOBS))
    if unknown:
        raise TimelineError(f"voice: unknown keys {unknown}")
    voice = {}
    for name in VOICE_KNOBS:
        if name in raw:
            value = _number(raw[name], f"voice.{name}")
            if not 0.0 <= value <= 1.0:
                raise TimelineError(f"voice.{name}: {value} is outside [0, 1]")
            voice[name] = value
    return voice


def _midi(value, where: str) -> int:
    """A scientific pitch name as a MIDI number, as the robot's chorale reads it: C4 is 60."""
    match = _NOTE_NAME.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise TimelineError(f"{where}: {value!r} is not a note name")
    letter, accidental, octave = match.groups()
    midi = (int(octave) + 1) * 12 + _STEPS[letter.upper()] + {"#": 1, "b": -1, "": 0}[accidental]
    if not LOWEST_NOTE <= midi <= HIGHEST_NOTE:
        raise TimelineError(f"{where}: {value!r} is outside C2 to C7")
    return midi


def _mark(raw, key: str, marks: dict, default: str, where: str) -> str:
    value = raw.get(key, default)
    # isinstance first: a list is not hashable, and `in` on a dict would raise rather than refuse.
    if not isinstance(value, str) or value not in marks:
        raise TimelineError(f"{where}.{key}: {value!r} is not one of {' '.join(marks)}")
    return value


def _song(raw, duration_s: float) -> tuple[Note, ...]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_NOTES:
        got = len(raw) if isinstance(raw, list) else f"a {type(raw).__name__}"
        raise TimelineError(f"song: expected 1 to {MAX_NOTES} notes in a list, got {got}")
    notes: list[Note] = []
    for index, note in enumerate(raw):
        where = f"song[{index}]"
        if not isinstance(note, dict):
            raise TimelineError(f"{where}: expected an object, got {type(note).__name__}")
        unknown = sorted(set(note) - set(_NOTE_KEYS))
        if unknown:
            raise TimelineError(f"{where}: unknown keys {unknown}")
        for key in ("t", "note", "for"):
            if key not in note:
                raise TimelineError(f"{where}: missing {key!r}")
        t = _number(note["t"], f"{where}.t")
        if t < 0.0:
            raise TimelineError(f"{where}.t: {t} is before the start of the performance")
        length = _number(note["for"], f"{where}.for")
        if length < CTRL_DT - _EPS_S:
            raise TimelineError(f"{where}.for: must be at least one control step ({CTRL_DT:g} s), got {length}")
        if notes and t < notes[-1].t + notes[-1].length_s - _EPS_S:
            raise TimelineError(
                f"{where}.t: {t} starts before song[{index - 1}] ends ({notes[-1].t + notes[-1].length_s:g})"
            )
        if t + length > duration_s + _EPS_S:
            raise TimelineError(
                f"{where}: ends at {t + length:g}, after the end of the performance ({duration_s:g} s)"
            )
        midi = _midi(note["note"], f"{where}.note")
        notes.append(Note(t, length, midi, _mark(note, "dynamic", DYNAMICS, "mf", where),
                          _mark(note, "vowel", VOWELS, "ah", where)))
    return tuple(notes)


def load_timeline(path: Path, max_duration_s: float) -> Timeline:
    """Read and check a timeline.json. `max_duration_s` is the event's time limit,
    so the event stays the one place the 20 s is written."""
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise TimelineError(f"{path}: {exc.strerror or exc}") from exc
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise TimelineError(f"{path.name}: not a JSON file ({exc})") from exc
    if not isinstance(raw, dict):
        raise TimelineError(f"{path.name}: expected a JSON object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - set(_TOP_KEYS) - {"voice", "song"})
    if unknown:
        raise TimelineError(f"{path.name}: unknown keys {unknown}")
    for key in _TOP_KEYS:
        if key not in raw:
            raise TimelineError(f"{path.name}: missing {key!r}")

    version = raw["timeline_version"]
    if isinstance(version, bool) or version != TIMELINE_VERSION:
        raise TimelineError(f"timeline_version: this Arena plays version {TIMELINE_VERSION}, got {version!r}")
    duration_s = _number(raw["duration_s"], "duration_s")
    if duration_s < CTRL_DT:
        raise TimelineError(f"duration_s: must be at least one control step ({CTRL_DT:g} s), got {duration_s}")
    if duration_s > max_duration_s:
        raise TimelineError(f"duration_s: {duration_s:g} s is longer than this event's {max_duration_s:g} s")

    keyframes = raw["keyframes"]
    if not isinstance(keyframes, list) or not 1 <= len(keyframes) <= MAX_KEYFRAMES:
        got = len(keyframes) if isinstance(keyframes, list) else f"a {type(keyframes).__name__}"
        raise TimelineError(f"keyframes: expected 1 to {MAX_KEYFRAMES} keyframes in a list, got {got}")
    times, commands, triggers, previous = [], [], [], None
    for index, keyframe in enumerate(keyframes):
        previous, command, pulled = _keyframe(keyframe, index, duration_s, previous)
        times.append(previous)
        commands.append(command)
        triggers.append(pulled)
    voice = _voice(raw["voice"]) if "voice" in raw else {}
    song = _song(raw["song"], duration_s) if "song" in raw else ()
    return Timeline(duration_s, tuple(times), tuple(commands), tuple(triggers), voice, song)


def trigger_track(timeline: Timeline) -> list[list[float]] | None:
    """What the replay needs of the triggers: [t, rt, lt] where they change, from t = 0. None when
    both stay released throughout, so a performance that pulls nothing stores nothing."""
    track = []
    for t, (rt, lt) in zip(timeline.times, timeline.triggers):
        if not track or track[-1][1:] != [rt, lt]:
            track.append([t, rt, lt])
    return track if any(rt or lt for _, rt, lt in track) else None
