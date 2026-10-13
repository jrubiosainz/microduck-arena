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
in the replay they open the duck's beak and make it quack or wheee (app/src/duck-voice.js reads
them from `sound_of`). The policy never reads them — the command stays 13 numbers — and a keyframe
that leaves them out releases both, like any group.

Beside the keyframes, a performance may sing: `"song"` is a list of notes, each
`{"t", "note", "for", "dynamic", "vowel"}` (a scientific pitch name, C4 = middle C; a dynamic
ppp..ff, mf by default; a vowel ah eh ee oh oo mm, ah by default), one at a time. `"voice"` tunes
the duck's voice for the quack, the wheee and the song: five knobs, each within [0, 1]. Neither
is a policy input.

Version 2 puts a troupe on the stage: up to the event's `max_ducks` ducks, each with its own
policy, place, keyframes, voice and song, sharing one `duration_s`.

    {"timeline_version": 2, "duration_s": 20.0,
     "ducks": [{"policy": "self", "start": {"x": 0.0, "y": 0.0, "yaw": 0}, "keyframes": [{"t": 0.0}]},
               {"policy": "owner/repo@<40-hex commit>", "start": {"x": 0.4, "y": -0.6, "yaw": 90},
                "keyframes": [{"t": 0.0}]}]}

The first duck is the entry's own policy, "self"; any other is "self" again or a Hub policy pinned
to a full commit, so a performance can be played again. A start is a pose in the stage's frame,
which is the simulation's world frame: from the stage's centre, x towards the audience, y to the
audience's right, yaw in degrees with 0 facing the audience. A version 1 file is a troupe of one:
the entry's own policy at the centre, with the file's keyframes, voice and song.
"""

import bisect
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

from .constants import CTRL_DT
from .manifest import Manifest

TIMELINE_VERSIONS = (1, 2)
# The entry's own policy, and the mark of a checkpoint still on the author's machine: the workshop
# plays one, an entry never does (nobody else could fetch it).
SELF = "self"
LOCAL = "local:"
# About the robot, not the stage: how far inside the stage's edge a duck starts, and how far
# apart two ducks start, centre to centre.
EDGE_MARGIN_M = 0.3
MIN_SPACING_M = 0.3
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
_TROUPE_KEYS = ("timeline_version", "duration_s", "ducks")
_DUCK_KEYS = ("policy", "start", "keyframes", "voice", "song")
_START_KEYS = ("x", "y", "yaw")
_REPO = r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
_REFERENCE = re.compile(rf"({_REPO})@([0-9a-f]{{40}})")
_UNPINNED = re.compile(rf"{_REPO}(@.*)?")
# A checkpoint number of nine digits at most: a longer one is refused here, never left to int().
_LOCAL = re.compile(rf"{LOCAL}([^/@]+)/([^/@]+)@([0-9]{{1,9}})")
# Keyframe times are decimal seconds; the runner asks for k * CTRL_DT, which
# binary floating point cannot always hold (15 * 0.02 < 0.3). A keyframe takes
# effect at the step that starts within this of its time.
_EPS_S = 1e-9
# Places are decimal metres too (1.9 - 0.3 < 1.6 in floating point): a start on the stage's
# margin, or exactly MIN_SPACING_M from another, is taken.
_EPS_M = 1e-9


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


@dataclass(frozen=True)
class Start:
    """Where a duck starts, in the stage's frame: metres from the centre along x (towards the
    audience) and y (to the audience's right), and its heading in degrees, 0 facing the audience.
    Not arena.manifest.Start, the event's start rules (keyframe, settle, perturbation)."""

    x: float = 0.0
    y: float = 0.0
    yaw_deg: float = 0.0

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "yaw": self.yaw_deg}


@dataclass(frozen=True)
class Duck:
    # SELF, "owner/repo@<40 hex>", or (the workshop's only) "local:<folder>/<run>@<checkpoint>".
    policy: str
    start: Start
    # Its own keyframes, triggers, voice and song; duration_s is the troupe's.
    timeline: Timeline


@dataclass(frozen=True)
class Troupe:
    duration_s: float
    ducks: tuple[Duck, ...]

    def references(self) -> tuple[str, ...]:
        """Every policy but the entry's own, once each, in the order the ducks first name them."""
        return tuple(dict.fromkeys(duck.policy for duck in self.ducks if duck.policy != SELF))


def constant_timeline(command, duration_s: float) -> Timeline:
    """One command for the whole performance: what an entry without a timeline plays."""
    return Timeline(float(duration_s), (0.0,), (tuple(float(v) for v in command),))


def solo(timeline: Timeline) -> Troupe:
    """A troupe of one: the entry's own policy at the centre, facing the audience."""
    return Troupe(timeline.duration_s, (Duck(SELF, Start(), timeline),))


def split_reference(policy: str) -> tuple[str, str]:
    """A checked Hub reference as (repo id, commit)."""
    return _REFERENCE.fullmatch(policy).groups()


def split_local(policy: str) -> tuple[str, str, int]:
    """A checked local checkpoint as (challenge folder, run, checkpoint)."""
    folder, run, checkpoint = _LOCAL.fullmatch(policy).groups()
    return folder, run, int(checkpoint)


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


def _keyframe(raw, where: str, duration_s: float, previous_t: float | None):
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


def _voice(raw, where: str) -> dict:
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - set(VOICE_KNOBS))
    if unknown:
        raise TimelineError(f"{where}: unknown keys {unknown}")
    voice = {}
    for name in VOICE_KNOBS:
        if name in raw:
            value = _number(raw[name], f"{where}.{name}")
            if not 0.0 <= value <= 1.0:
                raise TimelineError(f"{where}.{name}: {value} is outside [0, 1]")
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


def _song(raw, duration_s: float, place: str) -> tuple[Note, ...]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_NOTES:
        got = len(raw) if isinstance(raw, list) else f"a {type(raw).__name__}"
        raise TimelineError(f"{place}: expected 1 to {MAX_NOTES} notes in a list, got {got}")
    notes: list[Note] = []
    for index, note in enumerate(raw):
        where = f"{place}[{index}]"
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
                f"{where}.t: {t} starts before {place}[{index - 1}] ends ({notes[-1].t + notes[-1].length_s:g})"
            )
        if t + length > duration_s + _EPS_S:
            raise TimelineError(
                f"{where}: ends at {t + length:g}, after the end of the performance ({duration_s:g} s)"
            )
        midi = _midi(note["note"], f"{where}.note")
        notes.append(Note(t, length, midi, _mark(note, "dynamic", DYNAMICS, "mf", where),
                          _mark(note, "vowel", VOWELS, "ah", where)))
    return tuple(notes)


def _read(path: Path) -> dict:
    """The file's JSON object, or a refusal that says what is wrong with the file itself."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise TimelineError(f"{path}: {exc.strerror or exc}") from exc
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise TimelineError(f"{path.name}: not a JSON file ({exc})") from exc
    if not isinstance(raw, dict):
        raise TimelineError(f"{path.name}: expected a JSON object, got {type(raw).__name__}")
    return raw


def _keys(raw: dict, allowed, required, where: str) -> None:
    unknown = sorted(set(raw) - set(allowed))
    if unknown:
        raise TimelineError(f"{where}: unknown keys {unknown}")
    for key in required:
        if key not in raw:
            raise TimelineError(f"{where}: missing {key!r}")


def _version(raw: dict, name: str) -> int:
    if "timeline_version" not in raw:
        raise TimelineError(f"{name}: missing 'timeline_version'")
    version = raw["timeline_version"]
    # bool first: True == 1 in Python, and would otherwise read as version 1.
    if isinstance(version, bool) or version not in TIMELINE_VERSIONS:
        plays = " or ".join(str(v) for v in TIMELINE_VERSIONS)
        raise TimelineError(f"timeline_version: this Arena plays version {plays}, got {version!r}")
    return version


def _duration(raw: dict, max_duration_s: float) -> float:
    duration_s = _number(raw["duration_s"], "duration_s")
    if duration_s < CTRL_DT:
        raise TimelineError(f"duration_s: must be at least one control step ({CTRL_DT:g} s), got {duration_s}")
    if duration_s > max_duration_s:
        raise TimelineError(f"duration_s: {duration_s:g} s is longer than this event's {max_duration_s:g} s")
    return duration_s


def _timeline(raw: dict, duration_s: float, prefix: str) -> Timeline:
    """One duck's performance: a version 1 file's keyframes, voice and song, or a troupe duck's.
    `prefix` puts the duck's place before every refusal ("" for a version 1 file)."""
    keyframes = raw["keyframes"]
    if not isinstance(keyframes, list) or not 1 <= len(keyframes) <= MAX_KEYFRAMES:
        got = len(keyframes) if isinstance(keyframes, list) else f"a {type(keyframes).__name__}"
        raise TimelineError(f"{prefix}keyframes: expected 1 to {MAX_KEYFRAMES} keyframes in a list, got {got}")
    times, commands, triggers, previous = [], [], [], None
    for index, keyframe in enumerate(keyframes):
        previous, command, pulled = _keyframe(keyframe, f"{prefix}keyframes[{index}]", duration_s, previous)
        times.append(previous)
        commands.append(command)
        triggers.append(pulled)
    voice = _voice(raw["voice"], f"{prefix}voice") if "voice" in raw else {}
    song = _song(raw["song"], duration_s, f"{prefix}song") if "song" in raw else ()
    return Timeline(duration_s, tuple(times), tuple(commands), tuple(triggers), voice, song)


def _v1(raw: dict, name: str, max_duration_s: float) -> Timeline:
    """A version 1 file: one performance, its keyframes, voice and song at the top level."""
    _keys(raw, (*_TOP_KEYS, "voice", "song"), _TOP_KEYS, name)
    return _timeline(raw, _duration(raw, max_duration_s), "")


def _policy(value, index: int, allow_local: bool) -> str:
    where = f"ducks[{index}].policy"
    if not isinstance(value, str):
        raise TimelineError(f'{where}: expected "self" or owner/repo@<commit>, got {value!r}')
    if index == 0:
        if value != SELF:
            raise TimelineError(f'{where}: the first duck is the entry\'s own policy: "self", got {value!r}')
        return value
    if value == SELF or _REFERENCE.fullmatch(value):
        return value
    if value.startswith(LOCAL):
        if not allow_local:
            raise TimelineError(f"{where}: {value!r} is a checkpoint on your machine: publish it first")
        if _LOCAL.fullmatch(value) is None:
            raise TimelineError(f"{where}: {value!r} is not local:<challenge folder>/<run>@<checkpoint>")
        return value
    if _UNPINNED.fullmatch(value):
        raise TimelineError(f"{where}: {value!r} must pin a full 40-character commit")
    raise TimelineError(f'{where}: {value!r} is neither "self" nor owner/repo@<commit>')


def _start(raw, where: str, size_m: tuple[float, float]) -> Start:
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    _keys(raw, _START_KEYS, (), where)
    x, y, yaw = (_number(raw.get(key, 0.0), f"{where}.{key}") for key in _START_KEYS)
    if abs(yaw) > 180.0:
        raise TimelineError(f"{where}.yaw: {yaw:g} is outside ±180 degrees")
    for name, value, size in (("x", x, size_m[0]), ("y", y, size_m[1])):
        reach = size / 2 - EDGE_MARGIN_M
        if abs(value) > reach + _EPS_M:
            raise TimelineError(f"{where}: {name} {value:g} is off the stage (|{name}| ≤ {reach:g} m)")
    return Start(x, y, yaw)


def _duck(raw, index: int, duration_s: float, event: Manifest, allow_local: bool) -> Duck:
    where = f"ducks[{index}]"
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    _keys(raw, _DUCK_KEYS, ("policy", "keyframes"), where)
    policy = _policy(raw["policy"], index, allow_local)
    start = _start(raw["start"], f"{where}.start", event.course.size_m) if "start" in raw else Start()
    return Duck(policy, start, _timeline(raw, duration_s, f"{where}."))


def _troupe(raw: dict, name: str, event: Manifest, allow_local: bool) -> Troupe:
    _keys(raw, _TROUPE_KEYS, _TROUPE_KEYS, name)
    duration_s = _duration(raw, event.time_limit_s)
    listed, most = raw["ducks"], event.course.max_ducks
    if not isinstance(listed, list) or not listed:
        got = len(listed) if isinstance(listed, list) else f"a {type(listed).__name__}"
        raise TimelineError(f"ducks: expected 1 to {most} ducks in a list, got {got}")
    if len(listed) > most:
        raise TimelineError(f"ducks: {len(listed)} ducks, this event takes at most {most}")
    ducks: list[Duck] = []
    for index, entry in enumerate(listed):
        duck = _duck(entry, index, duration_s, event, allow_local)
        for other, placed in enumerate(ducks):
            apart = math.hypot(duck.start.x - placed.start.x, duck.start.y - placed.start.y)
            if apart < MIN_SPACING_M - _EPS_M:
                raise TimelineError(
                    f"ducks[{index}].start: {apart:.2f} m from ducks[{other}], closer than {MIN_SPACING_M:g} m"
                )
        ducks.append(duck)
    return Troupe(duration_s, tuple(ducks))


def load_troupe(path: Path, event: Manifest, *, allow_local: bool = False) -> Troupe:
    """Read and check a timeline.json of either version, as the troupe it puts on `event`'s stage.

    A version 1 file is a troupe of one (`solo`). `allow_local` lets a duck name a checkpoint on
    this machine, which only the workshop asks for, as it saves and plays the troupe it composes;
    an entry is refused one."""
    path = Path(path)
    raw = _read(path)
    if _version(raw, path.name) == 1:
        return solo(_v1(raw, path.name, event.time_limit_s))
    return _troupe(raw, path.name, event, allow_local)


def _trigger_track(timeline: Timeline) -> list[list[float]] | None:
    """The triggers as the replay needs them: [t, rt, lt] where they change, from t = 0. None when
    both stay released throughout."""
    track = []
    for t, (rt, lt) in zip(timeline.times, timeline.triggers):
        if not track or track[-1][1:] != [rt, lt]:
            track.append([t, rt, lt])
    return track if any(rt or lt for _, rt, lt in track) else None


def sound_of(timeline: Timeline) -> dict | None:
    """What the replay needs to make the duck heard and open its beak: the voice's knobs, the song
    with each note resolved to [t, for, midi, level, open, formant], and the trigger track. Only the
    keys in use; None when the performance sings nothing and pulls nothing, so it stores nothing."""
    sound = {}
    if timeline.song:
        sound["song"] = []
        for n in timeline.song:
            open_, formant, scale = VOWELS[n.vowel]
            sound["song"].append([n.t, n.length_s, n.midi, DYNAMICS[n.dynamic] * scale, open_, formant])
    triggers = _trigger_track(timeline)
    if triggers:
        sound["triggers"] = triggers
    if sound and timeline.voice:
        sound = {"voice": dict(timeline.voice), **sound}
    return sound or None
