# The duck sings, in a voice its author tunes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Got a Talent `timeline.json` can hold a `song` (notes with a pitch, a length, a dynamic and a vowel) and a `voice` (five knobs). The duck sings the song and quacks and wheees in the tuned voice, with its beak following the vowels, on the run page, the event page, the ballot, the workshop and in the clip.

**Architecture:**
- **Arena server:** the loader checks `voice` and `song`. `sound_of(timeline)` replaces `trigger_track`: one object `{"voice", "song", "triggers"}` with each note resolved to numbers. It is stored as `RunRecord.sound` (an old `triggers` key reads back into it) and served wherever the trigger track was.
- **Synth:** the booth's wasm (the `sounds` crate at e597877) gains a tuned personality for `chirp` and `wheee`, and a `song` that renders the whole melody through `Stream`, with the chorale's loop.
- **Front-end:** `duck-voice.js` turns a `sound` into the beak per frame, the list of calls and the song's buffer. `stage-voice.js` plays the song and the calls on the replay's clock. The clip puts both in its soundtrack.

**Tech Stack:** Python 3.12, FastAPI, pytest; vanilla JS + three.js, vitest/jsdom, Web Audio; Rust → wasm32-unknown-unknown.

**Spec:** `docs/superpowers/specs/2026-10-13-talent-song-and-voice-design.md` (approved by the owner 2026-10-13).

## Global Constraints

- **Commits and GitHub:** English only. Never signed: no `Co-Authored-By`, no "Generated with Claude Code". This overrides any default attribution.
- **Nothing leaves this Mac without the owner's yes.** No push, no wheel upload, no Hub write, no Space dataset write, no HF Job.
- **Worktree:** `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/talent-song` on branch `talent-song`, made from local `main` (which holds the spec and this plan). Set it up once, from the main checkout:
  - `/usr/bin/git worktree add .claude/worktrees/talent-song -b talent-song main`
  - `cd .claude/worktrees/talent-song && uv sync --no-config --frozen --extra dev && (cd app && npm ci)`
- **git:** always `/usr/bin/git`. The RTK hook's `git` rewrite is refused inside a worktree.
- **uv:** always `uv run --no-config --frozen …`. Without `--no-config`, a global `exclude-newer` makes uv re-resolve and rewrite `uv.lock`. If `uv.lock` changes by accident, run `/usr/bin/git checkout -- uv.lock`.
- **Shell inside the worktree:** the hook refuses globs and shell variables inside git, uv and npm commands. Write paths out in full.
- **Tests always run in the FOREGROUND, as one Bash call with `timeout: 600000`.** Never `run_in_background`, never a monitor, never end a turn "waiting for" a run. The Python suite runs as two calls; record the pass counts of each at the start:
  1. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
  2. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests --ignore=tests/workshop` (about 6.5 min)
- **Front-end:** `cd app && npm test`. The only accepted failures are the 4 known ones in `src/brightness.test.js`. Single file: `cd app && npx vitest run src/<file>.test.js`.
- **Untouched:** `arena/runner.py`, the golden run, `RUNNER_VERSION`, the 13 command numbers, `timeline_version` (stays 1), the booth's `syllable`, and `Timeline.command_at`. Published policies keep their scores and traces; nothing is re-raced.
- **The rules are microduck's (pollen-robotics/microduck @ e597877), copied, not invented:**
  - notes are absolute (A4 = 440 Hz, `sounds::chorale::midi_hz`); C4 = middle C = MIDI 60;
  - dynamics `ppp` 0.15, `pp` 0.25, `p` 0.40, `mp` 0.55, `mf` 0.70, `f` 0.85, `ff` 1.00;
  - vowels (opening / formant shift / level scale): `ah` 0.90 / 0 / 1, `eh` 0.65 / +1 / 1, `ee` 0.45 / +3 / 1, `oh` 0.55 / −1 / 1, `oo` 0.35 / −2 / 1, `mm` 0.05 / −2 / 0.65;
  - a note sounds for its first 92 % (`SUSTAIN`) and is released for the rest; the voice is silent at the last pitch between notes;
  - the beak while singing: the vowel's opening, ×0.2 in the release, 0 between notes, eased with τ = 0.09 s (robotd's `CHORALE_MOUTH_TAU_S`);
  - a note holds the speaker from `t` to `t + for`: no call starts inside it, a call playing at its start is cut there, and a still-held LT starts a new wheee at its end;
  - the pad's rules from 0.4.4 are unchanged (PULL 0.3, quack on RT's rising edge, wheee while LT ≥ 0.3, one call at a time, the wheee decided before the quack).
- **The voice:** `DUCK_SEED = 28`. Knob mapping (the wasm is the one place that does it): `pitch` → `pitch_center_hz = 110 × (620/110)^k`; `brightness` → `tilt = 2.8 − 1.4k` and `brightness = 0.05 + 0.5k`; `buzz` → `quackiness = k`; `vibrato` → `vibrato_depth = 0.7k`; `breath` → `breath = 0.30k`. A knob left out keeps seed 28's trait. Seed 28 sits at pitch 0.49, brightness ≈ 0.12 (from its tilt 2.636), buzz 0.55, vibrato 0.11, breath 0.90.
- **Wording:** English everywhere on the site, in the docs and in comments. A stage run is a "performance", never a "show".
- **Scratchpad:** `SCRATCH=/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/a421d86f-29b7-4810-a6eb-6478622c9887/scratchpad`.

## Review Focus

1. **A `dynamic` or a `vowel` that is not a string** (`"dynamic": ["f"]`, `"vowel": 3`): refused with its place. It must not raise a 500, which a `value in dict` check does on an unhashable list. Pinned in Task 1.
2. **Notes written end to end in decimals** (a note at 0.1 for 0.2, then one at 0.3): accepted, because 0.1 + 0.2 ≠ 0.3 in floating point is not an overlap. Pinned in Task 1.
3. **A performance cut short before its song ends**, or a trace that stops before the song starts: the song stops where the trace stops, with a fade, and its buffer is never 0 samples (Web Audio throws on that). Pinned in Task 4 (`songSamples`) and Task 6 (the clip's song cue).
4. **A scrub past the song's end, then back into it**: the song stops, then restarts at the new offset. A replay that loops sings from the top again. Pinned in Task 5.
5. **The two runs recorded by 0.4.4 with `triggers` only**: they still quack on the board, the ballot and the clip. Pinned in Task 2 (`from_dict`) and Task 4 (`voiceEvents` and `mouthTrack` on `{"triggers": …}`).

## Not in this plan (reported to the owner instead)

- A visual editor, the real robot singing `song`, chords, per-note timbre, tempo/beats, MIDI import (the spec's "Out of scope").
- The touch-screen double tap before the stage voice starts (stage-voice.js listens to `pointerdown` and `keydown`; touch activation comes on `pointerup`). It was found on 2026-10-12 and is left as it is, unless the owner asks.
- **Owner's yes needed, each one:**
  1. merge `talent-song` into main, then push main (the Space deploys);
  2. the 0.4.5 wheel on pollen-robotics/microduck-arena-wheels, tag v0.4.5;
  3. microduck-challenges relocked onto 0.4.5 and pushed, with its local commits (97a1edc and Task 7's).

---

### Task 1: The timeline reads a voice and a song

**Files:**
- Modify: `arena/timeline.py`
- Test: `tests/test_timeline.py`

**Interfaces:**
- Produces:
  - `Note`, a frozen dataclass: `t: float`, `length_s: float`, `midi: int`, `dynamic: str`, `vowel: str`.
  - `Timeline.voice: dict` (the knobs written, in `VOICE_KNOBS` order, default `{}`) and `Timeline.song: tuple[Note, ...]` (default `()`). Both come after `triggers`, so positional `Timeline(...)` calls in tests keep working.
  - `VOICE_KNOBS = ("pitch", "brightness", "buzz", "vibrato", "breath")`, `DYNAMICS: dict[str, float]`, `VOWELS: dict[str, tuple[float, float, float]]` (opening, formant shift, level scale), `MAX_NOTES = 1000`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_timeline.py`, change the import to `from arena.timeline import Note, Timeline, TimelineError, constant_timeline, load_timeline, trigger_track` and add after `test_a_performance_that_pulls_nothing_has_no_track`:

```python
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
```

Add these rows to the `parametrize` list of `test_a_malformed_timeline_is_refused_with_where`, after the last `triggers` row:

```python
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py`
Expected: FAIL with `ImportError: cannot import name 'Note'`.

- [ ] **Step 3: Implement**

In `arena/timeline.py`:

1. Extend the module docstring's last paragraph. After "...releases both, like any group." add:

```
Beside the keyframes, a performance may sing: `"song"` is a list of notes, each
`{"t", "note", "for", "dynamic", "vowel"}` (a scientific pitch name, C4 = middle C; a dynamic
ppp..ff, mf by default; a vowel ah eh ee oh oo mm, ah by default), one at a time. `"voice"` tunes
the duck's voice for the quack, the wheee and the song: five knobs, each within [0, 1]. Neither
is a policy input.
```

2. Change the imports to:

```python
import bisect
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
```

3. After `TRIGGERS = 2`, add:

```python
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
_NOTE_NAME = re.compile(r"([A-Ga-g])([#b]?)(-?\d+)")
_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
```

4. Replace the `Timeline` dataclass with:

```python
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
```

5. After `_keyframe`, add:

```python
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
```

6. In `load_timeline`, replace the unknown-key check with:

```python
    unknown = sorted(set(raw) - set(_TOP_KEYS) - {"voice", "song"})
```

and replace its last line, `return Timeline(duration_s, tuple(times), tuple(commands), tuple(triggers))`, with:

```python
    voice = _voice(raw["voice"]) if "voice" in raw else {}
    song = _song(raw["song"], duration_s) if "song" in raw else ()
    return Timeline(duration_s, tuple(times), tuple(commands), tuple(triggers), voice, song)
```

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/timeline.py tests/test_timeline.py
/usr/bin/git commit -m "A timeline can hold a song and a voice: notes named as the robot's chorale names them, five knobs within [0, 1]"
```

---

### Task 2: A run keeps its sound, and every payload serves it

**Files:**
- Modify: `arena/timeline.py`, `arena/store.py`, `arena/web/routes_submit.py`, `arena/recover.py`, `arena/cli.py`, `arena/web/routes_read.py`, `arena/web/routes_vote.py`, `arena/workshop/evaluations.py`
- Test: `tests/test_timeline.py`, `tests/test_store.py`, `tests/test_cli.py`, `tests/test_recover.py`, `tests/test_routes_submit.py`, `tests/test_routes_read.py`, `tests/test_routes_vote.py`, `tests/workshop/test_performance.py`

**Interfaces:**
- Consumes: Task 1's `Timeline.voice`, `Timeline.song`, `Note`, `DYNAMICS`, `VOWELS`.
- Produces:
  - `sound_of(timeline: Timeline) -> dict | None` in `arena/timeline.py`, replacing `trigger_track`. It returns `{"voice": {...}, "song": [[t, for, midi, level, open, formant], ...], "triggers": [[t, rt, lt], ...]}` with only the keys in use. `voice` is there only when written and something sounds. `level = DYNAMICS[dynamic] × VOWELS[vowel][2]`, `open = VOWELS[vowel][0]`, `formant = VOWELS[vowel][1]`. It returns `None` without a song and without a pulled trigger.
  - `RunRecord.sound: dict | None = None`, replacing `RunRecord.triggers`.
  - JSON keys: every board row `"sound"`; the ballot `"sound"` (one per lane in lane order, or `null`); the workshop evaluation `"sound"`. The key `"triggers"` disappears from all three.

- [ ] **Step 1: Write the failing tests**

`tests/test_timeline.py`: change the import to `from arena.timeline import Note, Timeline, TimelineError, constant_timeline, load_timeline, sound_of`. Replace `test_the_trigger_track_keeps_the_changes_only` and `test_a_performance_that_pulls_nothing_has_no_track` with:

```python
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
```

`tests/test_store.py`: replace `test_a_record_keeps_its_triggers_and_an_older_one_has_none` with:

```python
def test_a_record_keeps_its_sound_and_an_older_one_has_none():
    sound = {
        "voice": {"pitch": 0.3},
        "song": [[1.0, 0.5, 69, 0.7, 0.9, 0.0]],
        "triggers": [[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]],
    }
    record = make_record(event_id="got-a-talent", sound=sound)
    assert RunRecord.from_dict(record.to_dict()) == record
    assert "triggers" not in record.to_dict()
    older = record.to_dict()
    del older["sound"]
    assert RunRecord.from_dict(older).sound is None


def test_a_run_recorded_by_0_4_4_keeps_its_triggers():
    """0.4.4 kept a performance's triggers under their own key, and the Space's log holds two such runs."""
    raw = make_record(event_id="got-a-talent").to_dict()
    del raw["sound"]
    raw["triggers"] = [[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]]
    assert RunRecord.from_dict(raw).sound == {"triggers": [[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]]}
    raw["triggers"] = None
    assert RunRecord.from_dict(raw).sound is None
```

`tests/test_cli.py`: rename `test_score_records_the_triggers_a_performance_pulls` to `test_score_records_how_a_performance_sounds`, and replace its last line with:

```python
    assert record.sound == {"triggers": [[0.0, 0.0, 0.0], [0.5, 0.0, 1.0]]}
```

`tests/test_recover.py`: in `test_recover_plays_a_stage_entry_with_its_timeline_at_the_listed_revision`, replace `assert record.triggers == [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]` with:

```python
    assert record.sound == {"triggers": [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]}
```

`tests/test_routes_submit.py`: rename the two trigger tests and replace their assertions:

```python
def test_a_stage_entry_keeps_the_sound_its_timeline_makes(api):
    stand = (0.0,) * 13
    pulled = Timeline(2.0, (0.0, 0.5, 1.0), (stand,) * 3, ((0.0, 0.0), (1.0, 0.0), (0.0, 0.0)))
    _TIMELINES["alice/best_alpha_walking"] = (pulled, "c" * 64)
    body = submit(api, event="got-a-talent").json()
    assert _stored(api, "got-a-talent", body["run_id"]).sound == {
        "triggers": [[0.0, 0.0, 0.0], [0.5, 1.0, 0.0], [1.0, 0.0, 0.0]],
    }


def test_a_race_and_a_still_performance_keep_no_sound(api):
    race = submit(api).json()
    assert _stored(api, "sprint-2m", race["run_id"]).sound is None
    _TIMELINES["alice/best_alpha_walking"] = (performance(1.0), "d" * 64)
    still = submit(api, event="got-a-talent").json()
    assert _stored(api, "got-a-talent", still["run_id"]).sound is None
```

`tests/test_routes_read.py`: in `test_a_board_row_says_how_its_duck_sounds_on_the_stage`, replace its body after `api, app = client` with:

```python
    sound = {"triggers": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}
    pulled = record_run(app, event_id="got-a-talent", user="ann", sound=sound)
    record_run(app, event_id="got-a-talent", user="bob")
    rows = {row["user"]: row for row in api.get("/api/events/got-a-talent/leaderboard").json()["rows"]}
    assert (rows["ann"]["sound"], rows["bob"]["sound"]) == (sound, None)
    assert "triggers" not in rows["ann"]
    detail = api.get(f"/api/runs/{pulled.run_id}").json()
    assert next(row for row in detail["board"] if row["you"])["sound"] == sound
```

`tests/test_routes_vote.py`: replace `test_a_ballot_says_how_each_lanes_duck_sounds`'s body after `api, app = client` with:

```python
    ann = enter(app, "ann", sound={"triggers": [[0.0, 1.0, 0.0]]})
    bob = enter(app, "bob")
    body = api.get("/api/events/got-a-talent/ballot").json()
    entry = app.state.ballot_book.get(body["ballot"])
    sounds = {ann.run_id: ann.sound, bob.run_id: None}
    assert body["sound"] == [sounds[run_id] for run_id in entry.run_ids]
```

`tests/workshop/test_performance.py`: after the `QUACKS` constant add:

```python
SINGS = ('{"timeline_version": 1, "duration_s": 2.0, "keyframes": [{"t": 0.0}], '
         '"song": [{"t": 0.5, "note": "A4", "for": 1.0}]}\n')
```

Replace `assert body["triggers"] is None` with `assert body["sound"] is None`. Replace `test_a_checkpoint_replays_with_the_triggers_its_timeline_pulls` with:

```python
def test_a_checkpoint_replays_with_the_sound_its_timeline_makes(stage, checkout):
    stage.timeline.write_text(QUACKS)
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    assert evaluated(stage, run)["sound"] == {"triggers": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}


def test_a_checkpoint_replays_with_the_song_its_timeline_sings(stage, checkout):
    stage.timeline.write_text(SINGS)
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    assert evaluated(stage, run)["sound"] == {"song": [[0.5, 1.0, 69, 0.7, 0.9, 0.0]]}
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py tests/test_store.py`
Expected: FAIL with `ImportError: cannot import name 'sound_of'`.

- [ ] **Step 3: Implement**

`arena/timeline.py`: replace `trigger_track` with:

```python
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
        sound["song"] = [
            [n.t, n.length_s, n.midi, DYNAMICS[n.dynamic] * VOWELS[n.vowel][2], VOWELS[n.vowel][0], VOWELS[n.vowel][1]]
            for n in timeline.song
        ]
    triggers = _trigger_track(timeline)
    if triggers:
        sound["triggers"] = triggers
    if sound and timeline.voice:
        sound = {"voice": dict(timeline.voice), **sound}
    return sound or None
```

Update the module docstring's triggers paragraph: replace "(app/src/duck-voice.js)" with "(app/src/duck-voice.js reads them from `sound_of`)".

`arena/store.py`: replace the `triggers` field and its comment with:

```python
    # How a stage entry is heard, as arena.timeline.sound_of gives it: its voice, its song and the
    # pad's triggers it pulls. None for a race and for a performance that makes no sound. Never
    # simulated: the replay opens the duck's beak and sings from it.
    sound: dict | None = None
```

In `to_dict`, replace `"triggers": self.triggers,` with `"sound": self.sound,`. In `from_dict`, replace the two `triggers` lines with:

```python
            # .get, not [..]: runs recorded before sounds existed have no such key. Two runs of
            # 2026-10-12, recorded by 0.4.4, kept their triggers alone under their own key, and an
            # append-only log never rewrites them.
            sound=raw.get("sound") or ({"triggers": raw["triggers"]} if raw.get("triggers") else None),
```

`arena/web/routes_submit.py`, `arena/recover.py`, `arena/cli.py`: change each `from ..timeline import trigger_track` / `from .timeline import trigger_track` (in `cli.py`, inside the `TimelineError, load_timeline, trigger_track` import) to `sound_of`. Replace each `triggers=trigger_track(X) if X else None,` with `sound=sound_of(X) if X else None,`, keeping the same `X` (`fetched.timeline` in routes_submit and recover, `timeline` in cli).

`arena/web/routes_read.py`: replace the last entry of the board row and its comment with:

```python
        # How the duck sounds on a stage (arena.timeline.sound_of), or None: a lane is a board row,
        # so the row carries what the replay opens the beak and sings from.
        "sound": record.sound,
```

`arena/web/routes_vote.py`: replace the `"triggers"` line with:

```python
        "sound": [r.sound for r in picked],
```

`arena/workshop/evaluations.py`: change the import to `from ..timeline import load_timeline, sound_of` and the body's line to `"sound": sound_of(timeline) if timeline else None,`.

Then check that nothing is left behind: `grep -rn "trigger_track\|\.triggers\b\|\"triggers\"" arena` must only list `arena/timeline.py` (the `Timeline.triggers` field, `_trigger_track`, and `sound["triggers"]`) and the `from_dict` compatibility line in `arena/store.py`.

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py tests/test_store.py tests/test_cli.py tests/test_recover.py tests/test_routes_submit.py tests/test_routes_read.py tests/test_routes_vote.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS, the count at least the start's + 1.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena tests
/usr/bin/git commit -m "A run keeps how its performance sounds, and boards, ballots and workshop evaluations serve it: the voice, the song and the triggers in one object"
```

---

### Task 3: The synth sings a song in a tuned voice

**Files:**
- Modify: `app/voice/src/lib.rs`, `app/public/sound/microduck-voice.wasm` (rebuilt), `app/src/live/voice.js`
- Test: `app/src/live/voice.test.js`

**Interfaces:**
- Produces (the wasm exports):
  - `chirp(seed: u32, variant: u32, pitch, brightness, buzz, vibrato, breath: f64) -> usize`;
  - `wheee(seed: u32, variant: u32, segment: u32, pitch, brightness, buzz, vibrato, breath: f64) -> usize`;
  - `notes(count: usize) -> *mut f64` (room for `count × 6` f64);
  - `song(seed: u32, pitch, brightness, buzz, vibrato, breath, seconds: f64) -> usize`.
  
  A NaN knob keeps the seed's trait.
- Produces (JS, `loadCalls(fetcher)` in `app/src/live/voice.js`):
  - `chirp(seed, variant, voice = {})`;
  - `wheee(seed, variant, segment, voice = {})`;
  - `song(seed, voice, notes, seconds)`, where `notes` is `[[t, for, midi, level, open, formant], ...]` and the result is exactly `max(1, round(seconds × 48000))` samples.
  
  Each returns a `Float32Array` copy. `voice` is an object of knobs (`{pitch, brightness, buzz, vibrato, breath}`, each optional).

- [ ] **Step 1: Write the failing tests**

In `app/src/live/voice.test.js`, add after the `loadCalls` describe:

```js
/** Goertzel: the power of `samples` at `hz`. */
function power(samples, hz) {
  const k = 2 * Math.cos((2 * Math.PI * hz) / 48000);
  let s1 = 0;
  let s2 = 0;
  for (const x of samples) {
    const s0 = x + k * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}
const crossings = (samples) => samples.reduce((n, x, i) => n + (i > 0 && (samples[i - 1] < 0) !== (x < 0) ? 1 : 0), 0);
const peak = (samples) => samples.reduce((top, x) => Math.max(top, Math.abs(x)), 0);

describe("loadCalls: the song and the tuned voice", () => {
  it("sings each note at its pitch, A4 at 440 Hz and A5 at 880 Hz, for exactly the length asked", async () => {
    const calls = await loadCalls(wasm);
    const sung = calls.song(28, {}, [[0, 0.5, 69, 1, 0.9, 0], [0.5, 0.5, 81, 1, 0.9, 0]], 1.2);
    expect(sung).toHaveLength(57600);
    const a4 = sung.subarray(0.1 * 48000, 0.4 * 48000);
    const a5 = sung.subarray(0.6 * 48000, 0.9 * 48000);
    expect(power(a4, 440)).toBeGreaterThan(10 * power(a4, 415.3));
    expect(power(a4, 440)).toBeGreaterThan(10 * power(a4, 466.2));
    expect(power(a5, 880)).toBeGreaterThan(10 * power(a5, 830.6));
    expect(power(a5, 880)).toBeGreaterThan(10 * power(a5, 932.3));
  });

  it("is silent before the first note and after the last one's release", async () => {
    const calls = await loadCalls(wasm);
    const sung = calls.song(28, {}, [[0.5, 0.5, 69, 1, 0.9, 0]], 1.5);
    expect(peak(sung.subarray(0, 0.45 * 48000))).toBeLessThan(1e-3);
    expect(peak(sung.subarray(0.6 * 48000, 0.9 * 48000))).toBeGreaterThan(0.1);
    expect(peak(sung.subarray(1.3 * 48000))).toBeLessThan(1e-3);
  });

  it("never returns an empty song", async () => {
    const calls = await loadCalls(wasm);
    expect(calls.song(28, {}, [[0, 1, 69, 1, 0.9, 0]], 0)).toHaveLength(1);
  });

  it("tunes the quack and the wheee: a low pitch is low, a high one high, an absent knob the seed's own", async () => {
    const calls = await loadCalls(wasm);
    // No breath in either: its noise crosses zero at any pitch and would blur the comparison.
    const low = calls.chirp(28, 0, { pitch: 0, breath: 0 });
    const high = calls.chirp(28, 0, { pitch: 1, breath: 0 });
    expect(crossings(high) / high.length).toBeGreaterThan(2 * (crossings(low) / low.length));
    expect(calls.chirp(28, 0, {})).toEqual(calls.chirp(28, 0));
    expect(calls.chirp(28, 0, { buzz: 0 })).not.toEqual(calls.chirp(28, 0));
    expect(calls.wheee(28, 0, 1, { vibrato: 1 })).not.toEqual(calls.wheee(28, 0, 1));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/live/voice.test.js`
Expected: FAIL with `calls.song is not a function`.

- [ ] **Step 3: Implement the synth**

In `app/voice/src/lib.rs`:

1. Replace the doc comment's last paragraph ("The quack and the wheee are the robot's own calls, unshaped: what its pad's RT and LT play.") with:

```rust
//! The quack and the wheee are the robot's own calls, unshaped: what its pad's RT and LT play.
//! The stage duck's song is the robot's singing voice, `Stream`, driven note by note as its
//! chorale drives it. All three sing in a voice the performance tunes: five knobs over the seed's
//! personality, each a position within [0, 1] on a trait's range.
```

2. Change the imports and thread-locals to:

```rust
use std::cell::RefCell;
use std::f64::consts::TAU;

use sounds::chorale::{Vowel, midi_hz};
use sounds::{Personality, SR, Stream, synth as s};

/// The chorale's control block: a note change lands within a few milliseconds, the stream's own
/// slews shape the rest.
const BLOCK: usize = 128;
/// How much of a note sounds before it lets go, so two notes in a row re-articulate.
const SUSTAIN: f64 = 0.92;

thread_local! {
    static CONTOUR: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static NOTES: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static SAMPLES: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}
```

3. Replace `chirp` and `wheee` with:

```rust
/// This seed's personality with the performance's knobs over it. Each knob is a position within
/// [0, 1] on its trait's range in `Personality`; NaN keeps the seed's own trait.
fn tuned(seed: u32, pitch: f64, brightness: f64, buzz: f64, vibrato: f64, breath: f64) -> Personality {
    let mut p = Personality::from_seed(seed);
    if !pitch.is_nan() {
        p.pitch_center_hz = 110.0 * (620.0f64 / 110.0).powf(pitch);
    }
    if !brightness.is_nan() {
        p.tilt = 2.8 - 1.4 * brightness;
        p.brightness = 0.05 + 0.5 * brightness;
    }
    if !buzz.is_nan() {
        p.quackiness = buzz;
    }
    if !vibrato.is_nan() {
        p.vibrato_depth = 0.7 * vibrato;
    }
    if !breath.is_nan() {
        p.breath = 0.30 * breath;
    }
    p
}

/// The quack the robot's RT plays, in the tuned voice: variant `variant` of `chirp`. Returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn chirp(
    seed: u32,
    variant: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
) -> usize {
    keep(sounds::voices::chirp(&tuned(seed, pitch, brightness, buzz, vibrato, breath), variant))
}

/// The wheee the robot's LT rides, in the tuned voice: segment 0 is its start, anything else its
/// loop, which plays over and over while the trigger is held. No end: a timeline releases its
/// trigger, which cuts the ride as the robot does. Returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn wheee(
    seed: u32,
    variant: u32,
    segment: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
) -> usize {
    let p = tuned(seed, pitch, brightness, buzz, vibrato, breath);
    let (start, ride, _) = sounds::voices::wheee_segments(&p, variant);
    keep(if segment == 0 { start } else { ride })
}

/// Room for `count` notes of six numbers each, which the page fills before calling [`song`]: start
/// and length in seconds, MIDI number, level, beak opening, formant shift (arena/timeline.py
/// sound_of resolves the dynamic and the vowel into the last three).
#[unsafe(no_mangle)]
pub extern "C" fn notes(count: usize) -> *mut f64 {
    NOTES.with_borrow_mut(|n| {
        n.resize(count * 6, 0.0);
        n.as_mut_ptr()
    })
}

/// The whole song, `seconds` long from the performance's t = 0, in the tuned voice: the robot's
/// `Stream`, untamed (a solo has no chord to sour), driven by the chorale's loop. A note sounds for
/// its first [`SUSTAIN`] and lets go; between notes the voice is silent at the last pitch. No
/// speaker rolloff: a page plays on full-range speakers. Returns the length, at least one sample.
#[unsafe(no_mangle)]
pub extern "C" fn song(
    seed: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
    seconds: f64,
) -> usize {
    let notes: Vec<[f64; 6]> = NOTES.with_borrow(|n| {
        n.chunks_exact(6)
            .map(|c| [c[0], c[1], c[2], c[3], c[4], c[5]])
            .collect()
    });
    let mut voice = Stream::new(&tuned(seed, pitch, brightness, buzz, vibrato, breath), "song", 0);
    let total = ((seconds * f64::from(SR)).round() as usize).max(1);
    let mut out = vec![0.0f32; total];
    // Held across rests, as the chorale holds it: the next note does not glide in from nowhere.
    let mut last_hz = notes.first().map_or(440.0, |note| midi_hz(note[2]));
    for start in (0..total).step_by(BLOCK) {
        let now = start as f64 / f64::from(SR);
        let (level, open, formant) = match notes
            .iter()
            .find(|note| now >= note[0] && now < note[0] + note[1])
        {
            Some(&[begin, length, midi, level, open, formant]) => {
                last_hz = midi_hz(midi);
                let sounding = now - begin < SUSTAIN * length;
                (if sounding { level } else { 0.0 }, open, formant)
            }
            // Before the first note, between two, after the last.
            None => (0.0, Vowel::default().open(), 0.0),
        };
        voice.set_formant_shift(formant);
        voice.set(last_hz, level, open);
        let end = (start + BLOCK).min(total);
        voice.block(&mut out[start..end]);
    }
    keep(out)
}
```

4. Rebuild, from `app/voice`:

```bash
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/microduck_voice.wasm ../public/sound/microduck-voice.wasm
```

Expected: the build succeeds without warnings, and the `.wasm` changes.

- [ ] **Step 4: Implement the page's side**

In `app/src/live/voice.js`, replace `loadCalls` and its doc comment with:

```js
/** The knobs a performance's voice may set, in the order the synth takes them; a knob left out is NaN, the seed's own. */
const KNOBS = ["pitch", "brightness", "buzz", "vibrato", "breath"];
const knobs = (voice = {}) => KNOBS.map((name) => voice[name] ?? NaN);

/** The stage duck's voice in the robot's synthesiser, tuned by a performance's `voice` knobs:
 * `chirp(seed, variant, voice)` is RT's quack, `wheee(seed, variant, segment, voice)` LT's ride
 * (0 its start, 1 its loop), and `song(seed, voice, notes, seconds)` the whole song from t = 0,
 * its notes as arena/timeline.py sound_of stores them. Each is a copy, kept however many calls follow. */
export async function loadCalls(fetcher = fetch) {
  const { memory, chirp, wheee, notes, song, samples } = await voiceExports(fetcher);
  const copy = (length) => new Float32Array(memory.buffer, samples(), length).slice();
  return {
    chirp: (seed, variant, voice) => copy(chirp(seed, variant, ...knobs(voice))),
    wheee: (seed, variant, segment, voice) => copy(wheee(seed, variant, segment, ...knobs(voice))),
    song(seed, voice, written, seconds) {
      // Asked for first: making room may grow the memory, which detaches older views of it.
      const room = notes(written.length);
      new Float64Array(memory.buffer, room, written.length * 6).set(written.flat());
      return copy(song(seed, ...knobs(voice), seconds));
    },
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npx vitest run src/live/voice.test.js`
Expected: PASS, the existing `loadCalls` test included (a call without a voice is the seed's own).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/voice/src/lib.rs app/public/sound/microduck-voice.wasm app/src/live/voice.js app/src/live/voice.test.js
/usr/bin/git commit -m "The voice module sings a whole song through the robot's Stream, and quacks and wheees in a voice five knobs tune"
```

---

### Task 4: The song's rules, and every page hands its lane the sound

**Files:**
- Modify: `app/src/duck-voice.js`, `app/src/viewer.js`, `app/src/clip/score.js`, `app/src/clip/main.js`, `app/src/race.js`, `app/src/run.js`, `app/src/vote.js`, `app/src/workshop/job.js`
- Test: `app/src/duck-voice.test.js`, `app/src/clip/score.test.js`, `app/src/vote.solo.test.js`

**Interfaces:**
- Consumes: the `sound` JSON object from Task 2 (`{voice?, song?, triggers?}`); Task 3's `loadCalls` methods.
- Produces (in `app/src/duck-voice.js`):
  - `mouthTrack(sound, frames, lead = 0) -> Float32Array | null`;
  - `voiceEvents(sound, duration) -> [{ tag, variant, start, end }]`;
  - `callSamples(calls, event, voice = {}) -> Float32Array`;
  - `songSamples(calls, sound, duration) -> Float32Array | null` (the song from t = 0, at least 1 sample, cut at `duration` with a fade);
  - constants `DUCK_SEED`, `PULL`, `MOUTH_TRAVEL`, `SUSTAIN = 0.92`.
- Produces: every viewer lane entry carries `sound` (from a board row, a ballot or a workshop evaluation) where it carried `triggers`. `clipScore({ run, plan, trace, sound })`.

- [ ] **Step 1: Write the failing tests**

Replace `app/src/duck-voice.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { CTRL_DT } from "./replay.js";
import { DUCK_SEED, callSamples, mouthTrack, songSamples, voiceEvents } from "./duck-voice.js";

const pulls = (triggers) => ({ triggers });
/** A note as arena/timeline.py sound_of stores it: [t, for, midi, level, open, formant]. */
const note = (t, length, open = 0.9) => [t, length, 69, 0.7, open, 0];

describe("voiceEvents", () => {
  it("quacks once per press of RT across 0.3, and a release does not cut the quack", () => {
    const track = [[0, 0, 0], [1, 0.2, 0], [2, 1, 0], [2.02, 0, 0], [3, 0.9, 0], [3.1, 0.5, 0]];
    expect(voiceEvents(pulls(track), 10)).toEqual([
      { tag: "chirp", variant: 0, start: 2, end: 3 },
      { tag: "chirp", variant: 1, start: 3, end: 10 },
    ]);
  });

  it("rides the wheee while LT holds at 0.3 or more, cut at its release", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [1, 0, 0.3], [1.5, 0, 1], [4, 0, 0.29]]), 10)).toEqual([
      { tag: "wheee", variant: 0, start: 1, end: 4 },
    ]);
  });

  it("drops a quack during a wheee, and plays one pulled as the wheee is released", () => {
    expect(voiceEvents(pulls([[0, 0, 1], [1, 1, 1], [2, 0, 1], [3, 1, 0]]), 10)).toEqual([
      { tag: "wheee", variant: 0, start: 0, end: 3 },
      { tag: "chirp", variant: 0, start: 3, end: 10 },
    ]);
  });

  it("decides the wheee before the quack when both are pulled at once", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [1, 1, 1]]), 5)).toEqual([{ tag: "wheee", variant: 0, start: 1, end: 5 }]);
  });

  it("cuts everything at the end of the performance and plays nothing past it", () => {
    expect(voiceEvents(pulls([[0, 0, 1], [6, 1, 0]]), 5)).toEqual([{ tag: "wheee", variant: 0, start: 0, end: 5 }]);
  });

  it("goes through the robot's variants in turn: 12 quacks, then the first again", () => {
    const track = [];
    for (let i = 0; i < 13; i++) track.push([2 * i, 1, 0], [2 * i + 1, 0, 0]);
    expect(voiceEvents(pulls(track), 100).map((sound) => sound.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
  });

  it("lets a wheee cut a quack still playing", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [1, 1, 0], [1.05, 0, 1]]), 5)).toEqual([
      { tag: "chirp", variant: 0, start: 1, end: 1.05 },
      { tag: "wheee", variant: 0, start: 1.05, end: 5 },
    ]);
  });

  it("ignores a change on the last step, which float error puts a hair before the end", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [0.7, 1, 0]]), 35 * CTRL_DT)).toEqual([]);
  });

  it("makes no sound without a sound, nor with a song alone", () => {
    expect(voiceEvents(null, 20)).toEqual([]);
    expect(voiceEvents({ song: [note(1, 1)] }, 20)).toEqual([]);
  });

  it("hears no call inside a note: a quack pulled there is dropped, and RT still held after it does not quack", () => {
    expect(voiceEvents({ song: [note(1, 1)], triggers: [[0, 0, 0], [1.5, 1, 0]] }, 5)).toEqual([]);
  });

  it("cuts a quack or a wheee where a note starts", () => {
    expect(voiceEvents({ song: [note(1, 0.5)], triggers: [[0, 0, 0], [0.9, 1, 0], [0.95, 0, 0]] }, 5)).toEqual([
      { tag: "chirp", variant: 0, start: 0.9, end: 1 },
    ]);
  });

  it("starts the wheee again where a note ends while LT is still held, not between two notes in a row", () => {
    expect(voiceEvents({ song: [note(1, 0.5), note(1.5, 0.5)], triggers: [[0, 0, 1]] }, 3)).toEqual([
      { tag: "wheee", variant: 0, start: 0, end: 1 },
      { tag: "wheee", variant: 1, start: 2, end: 3 },
    ]);
  });

  it("quacks between two notes, cut by the next one", () => {
    expect(voiceEvents({ song: [note(0, 1), note(2, 1)], triggers: [[0, 0, 0], [1.5, 1, 0], [1.6, 0, 0]] }, 5)).toEqual([
      { tag: "chirp", variant: 0, start: 1.5, end: 2 },
    ]);
  });
});

describe("mouthTrack", () => {
  it("opens to the harder-pulled trigger like a servo, and holds the start through a lead", () => {
    const open = mouthTrack(pulls([[0, 0.5, 0], [1, 0, 1], [2, 0, 0]]), 200, 25);
    expect(open[0]).toBeCloseTo(0.5);
    expect(open[24]).toBeCloseTo(0.5); // the lead holds t = 0
    expect(open[75]).toBeLessThan(0.7); // eased at the change, not snapped
    expect(open[90]).toBeGreaterThan(0.99); // and there 0.3 s later
    expect(open[199]).toBeLessThan(0.01);
  });

  it("opens to the harder-pulled trigger when both are pulled", () => {
    for (const value of mouthTrack(pulls([[0, 0.4, 0.7]]), 3)) expect(value).toBeCloseTo(0.7);
  });

  it("opens to the sung vowel, a fifth of it in the release, shut between notes, eased like the robot's jaw", () => {
    const open = mouthTrack({ song: [note(1, 5, 0.9)] }, 350);
    expect(open[45]).toBeLessThan(0.01); // 0.9 s, before the note
    expect(open[52]).toBeLessThan(0.7); // eased at the note's start, not snapped
    expect(open[100]).toBeCloseTo(0.9); // 2 s, singing
    expect(open[299]).toBeCloseTo(0.18, 1); // 5.98 s, in the release
    expect(open[349]).toBeLessThan(0.01); // 6.98 s, after it
  });

  it("opens to the larger of the song and the triggers", () => {
    for (const value of mouthTrack({ song: [note(0, 10, 0.35)], triggers: [[0, 0.8, 0]] }, 3)) expect(value).toBeCloseTo(0.8);
  });

  it("leaves the beak alone without a sound", () => {
    expect(mouthTrack(null, 10)).toBeNull();
  });
});

describe("callSamples", () => {
  const calls = {
    chirp: (seed, variant) => new Float32Array(4800).fill(variant + 1),
    wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000).fill(segment ? 2 : 1),
  };

  it("plays a quack whole unless the next sound cuts it, and fades the cut", () => {
    expect(callSamples(calls, { tag: "chirp", variant: 2, start: 1, end: 5 })).toEqual(new Float32Array(4800).fill(3));
    const cut = callSamples(calls, { tag: "chirp", variant: 2, start: 1, end: 1.05 });
    expect(cut).toHaveLength(2400);
    expect(cut[0]).toBe(3);
    expect(cut[2399]).toBe(0);
  });

  it("rides the wheee's start, then its loop over and over, to the release", () => {
    const ride = callSamples(calls, { tag: "wheee", variant: 0, start: 0, end: 1 });
    expect(ride).toHaveLength(48000);
    expect(ride[23999]).toBe(1);
    expect(ride[24000]).toBe(2);
    expect(ride[24000 + 2 * 9600]).toBe(2);
    expect(ride[47999]).toBe(0);
  });

  it("always gives a sound a sample, however short its stretch", () => {
    expect(callSamples(calls, { tag: "chirp", variant: 0, start: 1, end: 1 + 1e-6 })).toHaveLength(1);
  });

  it("sings in the stage duck's voice, tuned by the performance", () => {
    const asked = [];
    const record = (...args) => (asked.push(args), new Float32Array(1));
    const synth = { chirp: record, wheee: record };
    callSamples(synth, { tag: "chirp", variant: 0, start: 0, end: 1 }, { pitch: 1 });
    callSamples(synth, { tag: "wheee", variant: 3, start: 0, end: 1 }, { buzz: 0 });
    expect(asked).toEqual([
      [DUCK_SEED, 0, { pitch: 1 }],
      [DUCK_SEED, 3, 0, { buzz: 0 }],
      [DUCK_SEED, 3, 1, { buzz: 0 }],
    ]);
  });
});

describe("songSamples", () => {
  const synth = (asked) => ({
    song: (seed, voice, notes, seconds) => {
      asked.push([seed, voice, notes.length, seconds]);
      return new Float32Array(Math.max(1, Math.round(seconds * 48000))).fill(0.5);
    },
  });

  it("sings the whole song in the performer's voice, to its last release", () => {
    const asked = [];
    const sung = songSamples(synth(asked), { voice: { pitch: 1 }, song: [note(1, 1), note(2, 1)] }, 20);
    expect(asked).toEqual([[DUCK_SEED, { pitch: 1 }, 2, expect.closeTo(3.2)]]);
    expect(sung).toHaveLength(153600);
  });

  it("stops where a cut-short performance does, with a fade, and is never empty", () => {
    const sung = songSamples(synth([]), { song: [note(1, 3)] }, 2);
    expect(sung).toHaveLength(96000);
    expect(sung[0]).toBe(0.5);
    expect(sung.at(-1)).toBe(0);
    expect(songSamples(synth([]), { song: [note(1, 3)] }, 0)).toHaveLength(1);
  });

  it("is nothing without a song", () => {
    expect(songSamples(synth([]), pulls([[0, 1, 0]]), 20)).toBeNull();
    expect(songSamples(synth([]), null, 20)).toBeNull();
  });
});
```

In `app/src/clip/score.test.js`, in the two voice tests, replace `const triggers = [[0, 0, 0], [1, 1, 0], [1.2, 0, 0], [4, 0, 1]];` with `const sound = { triggers: [[0, 0, 0], [1, 1, 0], [1.2, 0, 0], [4, 0, 1]] };`, every `triggers` argument of `clipScore` with `sound` (the second test passes `sound: null`), and rename "a performance that pulls nothing adds no voice" to "a performance that makes no sound adds no voice".

In `app/src/vote.solo.test.js`, replace `triggers: [null, null, null]` with `sound: [null, null, null]`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/duck-voice.test.js src/clip/score.test.js`
Expected: FAIL (`songSamples` is not exported, and `voiceEvents` reads a sound object).

- [ ] **Step 3: Implement `duck-voice.js`**

Replace `app/src/duck-voice.js` with:

```js
// The duck's beak and voice on the stage, from a performance's `sound` (arena/timeline.py sound_of;
// a run, a board row, a ballot lane and a workshop evaluation carry it): the pad's two triggers as a
// track of [t, rt, lt] at each change, the song's notes as [t, for, midi, level, open, formant], and
// the knobs of its voice. The rules are microduck's own, at e597877. The pad (padd, robotd): the beak
// opens to the harder-pulled trigger; RT quacks as it crosses PULL on the way up; LT rides the wheee
// while at or over PULL and its release cuts it; one call at a time, a new quack cutting the last and
// a quack during a wheee dropped. The chorale (sounds::chorale, robotd): a note sounds for SUSTAIN of
// its length and the beak follows its vowel; a note holds the speaker, so no call starts inside one,
// a call playing when one starts is cut, and LT still held when it ends rides again. Pure: the
// viewer and the clip hear the same sounds from it.

import { SAMPLE_RATE } from "./live/score.js";
import { CTRL_DT } from "./replay.js";

/** The voice every performer sings in before its knobs: a seed of the robot's `sounds` crate. */
export const DUCK_SEED = 28;
/** Where a trigger counts as pulled: padd's SOUND_THRESHOLD. */
export const PULL = 0.3;
/** The beak's travel, closed to wide open: duck-control's −5° to +30°. */
export const MOUTH_TRAVEL = (35 * Math.PI) / 180;
/** How much of a note sounds before it lets go: the chorale's 92 %. */
export const SUSTAIN = 0.92;
/** How fast the beak follows its trigger: a servo's ease, not a snap. */
const MOUTH_TAU_S = 0.06;
/** How fast the beak follows a sung vowel: robotd's CHORALE_MOUTH_TAU_S. */
const SING_TAU_S = 0.09;
/** The beak in a note's release: a fifth of its vowel's opening, as robotd closes it. */
const RELEASE_OPEN = 0.2;
/** The song's take runs this far past its last note, for the release to fade. */
const TAIL_S = 0.2;
/** A cut sound fades out over this, so it stops without a click. */
const FADE_S = 0.005;
/** The variants of each call in the robot's bank (sounds::variant_count). */
const VARIANTS = { chirp: 12, wheee: 6 };

/** The change a track holds at `t`: its last at or before it. */
function pulledAt(track, t) {
  let held = track[0];
  for (const point of track) {
    if (point[0] > t + 1e-9) break;
    held = point;
  }
  return held;
}

/** The note a song sings at `t`, from its start to its end, release included. */
function noteAt(song, t) {
  return song?.find(([start, length]) => start <= t + 1e-9 && t < start + length - 1e-9);
}

/** The beak the triggers ask for at `t`. */
function pulledOpen(track, t) {
  return track ? Math.max(...pulledAt(track, t).slice(1)) : 0;
}

/** The beak the song asks for at `t`: its vowel's opening, a fifth of it in the release, shut between notes. */
function sungOpen(song, t) {
  const note = noteAt(song, t);
  if (!note) return 0;
  const [start, length, , , open] = note;
  return t - start < SUSTAIN * length ? open : open * RELEASE_OPEN;
}

/**
 * The beak's opening, 0 closed to 1 wide open, at each 50 Hz frame of a lane whose trace starts
 * `lead` frames before the performance (a clip's settle, which holds the opening at t = 0): the
 * larger of what the triggers and the song ask, each eased as the robot eases it. Null without a
 * sound, so the lane keeps its beak as the rig made it.
 */
export function mouthTrack(sound, frames, lead = 0) {
  if (!sound) return null;
  const out = new Float32Array(frames);
  const followPull = 1 - Math.exp(-CTRL_DT / MOUTH_TAU_S);
  const followSong = 1 - Math.exp(-CTRL_DT / SING_TAU_S);
  let pulled = pulledOpen(sound.triggers, 0);
  let sung = sungOpen(sound.song, 0);
  for (let f = 0; f < frames; f++) {
    const t = Math.max(0, f - lead) * CTRL_DT;
    pulled += (pulledOpen(sound.triggers, t) - pulled) * followPull;
    sung += (sungOpen(sound.song, t) - sung) * followSong;
    out[f] = Math.max(pulled, sung);
  }
  return out;
}

/**
 * Every call a sound makes before `duration` seconds, in order: { tag, variant, start, end }, `end`
 * being where it is cut — the next call, LT's release, a note, the end of the performance. A quack's
 * own recording may end sooner. The k-th quack plays variant k mod 12 and the k-th wheee k mod 6, so
 * a performance always sounds the same. The song is not in it: songSamples sings it whole.
 */
export function voiceEvents(sound, duration) {
  const track = sound?.triggers;
  if (!track) return [];
  const song = sound.song ?? [];
  const calls = [];
  const count = { chirp: 0, wheee: 0 };
  const cut = (at) => {
    const last = calls.at(-1);
    if (last && last.end > at) last.end = at;
  };
  const begin = (tag, start) => {
    cut(start);
    calls.push({ tag, variant: count[tag]++ % VARIANTS[tag], start, end: duration });
  };
  // Every instant something can change: a trigger moves, a note starts or ends.
  const instants = [...new Set([...track.map(([t]) => t), ...song.flatMap(([t, length]) => [t, t + length])])]
    .sort((a, b) => a - b);
  let rt = 0;
  let riding = false;
  for (const t of instants) {
    if (t >= duration - 1e-9) break;
    const [, pulledRt, pulledLt] = pulledAt(track, t);
    if (noteAt(song, t)) {
      // The note has the speaker: what plays stops here, and a pull now is not heard.
      cut(t);
      riding = false;
      rt = pulledRt;
      continue;
    }
    // robotd's order: the wheee first, then the one-shots, which see the ride this instant started.
    if (pulledLt >= PULL && !riding) begin("wheee", t);
    if (pulledLt < PULL && riding) calls.at(-1).end = t;
    riding = pulledLt >= PULL;
    if (pulledRt >= PULL && rt < PULL && !riding) begin("chirp", t);
    rt = pulledRt;
  }
  return calls;
}

/** The last `FADE_S` of `samples` faded out, so a cut ends without a click. */
function fadeOut(samples) {
  const fade = Math.min(samples.length, Math.round(FADE_S * SAMPLE_RATE));
  for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
  return samples;
}

/**
 * The samples a call plays, from the robot's synth (`calls`, live/voice.js loadCalls) in the voice
 * the performance tunes: the quack as recorded, the wheee's start then its loop over and over; cut
 * at its `end`, with a short fade.
 */
export function callSamples(calls, { tag, variant, start, end }, voice = {}) {
  const room = Math.max(1, Math.round((end - start) * SAMPLE_RATE));
  let whole = tag === "chirp" ? calls.chirp(DUCK_SEED, variant, voice) : calls.wheee(DUCK_SEED, variant, 0, voice);
  if (tag === "chirp" && whole.length <= room) return whole;
  if (tag === "wheee") {
    const ride = calls.wheee(DUCK_SEED, variant, 1, voice);
    const grown = new Float32Array(Math.max(room, whole.length));
    grown.set(whole);
    for (let at = whole.length; at < room; at += ride.length) grown.set(ride.subarray(0, room - at), at);
    whole = grown;
  }
  return fadeOut(whole.slice(0, room));
}

/**
 * The song as one take from the performance's t = 0, in the voice it tunes, to its last release —
 * or to `duration`, where a cut-short trace stops it, faded. Never empty; null without a song.
 */
export function songSamples(calls, sound, duration) {
  if (!sound?.song) return null;
  const [start, length] = sound.song.at(-1);
  const seconds = Math.max(1 / SAMPLE_RATE, Math.min(duration, start + length + TAIL_S));
  return fadeOut(calls.song(DUCK_SEED, sound.voice ?? {}, sound.song, seconds));
}
```

- [ ] **Step 4: Every page hands its lane the sound**

- `app/src/viewer.js`:
  - line 39: `import { MOUTH_TRAVEL, mouthTrack, voiceEvents } from "./duck-voice.js";` stays.
  - line 507–508:

    ```js
          // How the performance sounds (duck-voice.js): the beak follows its triggers and its song.
          const mouth = talent ? mouthTrack(entry.sound, frameCount(entry.trace), entry.lead) : null;
    ```
  - line 534: `voice?.set(performer ? voiceEvents(performer.sound, frameCount(performer.trace) * CTRL_DT) : []);`
- `app/src/clip/main.js`:
  - lines 90–91: `// The beak only: the clip's soundtrack plays the voice. Its lane starts with the settle.` then `sound: lane.sound,`
  - line 101: `const score = clipScore({ run, plan, trace: replays[0], sound: lanes[0].sound });`
- `app/src/clip/score.js`:
  - `export function clipScore({ run, plan, trace, sound }) {`
  - `const voice = voiceEvents(sound, (plan.steps - plan.settle) * CTRL_DT)`
- `app/src/race.js`:
  - line 219: `const sounds = new Map(); // run id -> how its performance sounds`
  - line 236: `sound: sounds.get(runId),`
  - line 250: `sounds.set(row.run_id, row.sound);`
- `app/src/run.js` line 263: `sound: byId.get(id).sound,`
- `app/src/vote.js` line 278: `sound: ballot.sound[lane],`
- `app/src/workshop/job.js` line 256: replace `triggers: body.triggers` with `sound: body.sound`.

Then: `grep -rn "triggers" app/src` must list only `duck-voice.js`, its test, and test fixtures that build a `{ triggers }` sound.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/src
/usr/bin/git commit -m "The beak follows the song's vowels as the robot's chorale moves it, a note holds the speaker, and every page hands its lane how the performance sounds"
```

---

### Task 5: The stage sings

**Files:**
- Modify: `app/src/stage-voice.js`, `app/src/viewer.js`
- Test: `app/src/stage-voice.test.js`

**Interfaces:**
- Consumes: Task 4's `voiceEvents`, `callSamples`, `songSamples`; Task 3's `loadCalls`.
- Produces: `createStageVoice(loadCalls, opts)` returns `{ set(sound, duration), follow(seconds), dispose() }`. `set` now takes the performer's `sound` (or null) and its trace's length in seconds, instead of a list of events.

- [ ] **Step 1: Write the failing tests**

Replace `app/src/stage-voice.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { createStageVoice } from "./stage-voice.js";

const calls = {
  chirp: () => new Float32Array(4800), // 0.1 s
  wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000),
  song: (seed, voice, notes, seconds) => new Float32Array(Math.max(1, Math.round(seconds * 48000))),
};
/** One A4 from 1 s to 2 s: its take is 2.2 s long, release included. */
const song = { song: [[1, 1, 69, 0.7, 0.9, 0]] };

function fakeContext(log) {
  const listeners = [];
  return {
    state: "running",
    addEventListener: (type, listener) => listeners.push(listener),
    removeEventListener: (type, listener) => listeners.splice(listeners.indexOf(listener), 1),
    changeState(state) {
      this.state = state;
      for (const listener of [...listeners]) listener();
    },
    destination: {},
    resume: async () => log.push(["resume"]),
    close: async () => {},
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer: (channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource() {
      const node = {
        buffer: null,
        connect() {},
        start: (when, offset) => log.push(["start", node.buffer.length, offset]),
        stop: () => log.push(["stop"]),
      };
      return node;
    },
  };
}

async function voiceWith(sound, { duration = 5, muted = () => false, state = "running" } = {}) {
  const log = [];
  const context = fakeContext(log);
  context.state = state;
  const voice = createStageVoice(async () => calls, { makeContext: () => context, muted });
  voice.set(sound, duration);
  await new Promise((done) => setTimeout(done));
  return { voice, log, context };
}

describe("createStageVoice", () => {
  it("starts a quack as the clock crosses it, once, and lets it end", async () => {
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 0], [1, 1, 0]] });
    voice.follow(0.98);
    voice.follow(1.0);
    voice.follow(1.02);
    voice.follow(1.2);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
    expect(log[0][1]).toBe(4800);
    expect(log[0][2]).toBeCloseTo(0);
  });

  it("resumes a wheee from where a jump lands inside it", async () => {
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 0], [1, 0, 1], [3, 0, 0]] });
    voice.follow(0);
    voice.follow(2);
    expect(log).toEqual([["start", 96000, 1]]);
  });

  it("starts again from the top when the replay loops", async () => {
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 1], [2, 0, 0]] });
    voice.follow(0.5);
    voice.follow(0.52);
    voice.follow(0.02);
    expect(log.filter(([what]) => what === "start").map(([, , offset]) => offset)).toEqual([0.5, expect.closeTo(0.02)]);
  });

  it("stays silent when the Arena is muted, and stops when the replay pauses", async () => {
    const wheee = { triggers: [[0, 0, 1], [2, 0, 0]] };
    const muted = await voiceWith(wheee, { muted: () => true });
    muted.voice.follow(0.5);
    expect(muted.log).toEqual([]);
    const { voice, log } = await voiceWith(wheee);
    voice.follow(0.5);
    voice.follow(null);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
  });

  it("cuts a wheee the moment it is muted, and takes it up where the replay is once it is not", async () => {
    let quiet = false;
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 1], [2, 0, 0]] }, { muted: () => quiet });
    voice.follow(0.5);
    quiet = true;
    voice.follow(0.52);
    voice.follow(0.54);
    quiet = false;
    voice.follow(0.56);
    expect(log).toEqual([["start", 96000, 0.5], ["stop"], ["start", 96000, 0.56]]);
  });

  it("sings the song as one take on the replay's clock, with a quack between notes beside it", async () => {
    const { voice, log } = await voiceWith({ ...song, triggers: [[0, 0, 0], [2.1, 1, 0]] });
    for (let step = 0; step < 10; step++) voice.follow(2 + step * 0.02);
    expect(log).toEqual([["start", 105600, 2], ["start", 4800, expect.closeTo(0, 5)]]);
  });

  it("restarts the song where a jump lands, and lets it go past its end", async () => {
    const { voice, log } = await voiceWith(song);
    voice.follow(1.5);
    voice.follow(0.2); // the loop came round
    voice.follow(3); // scrubbed past the song
    expect(log).toEqual([["start", 105600, 1.5], ["stop"], ["start", 105600, 0.2], ["stop"]]);
  });

  it("never loads the synth for a performer who makes no sound", async () => {
    let loads = 0;
    const voice = createStageVoice(async () => (loads++, calls), { makeContext: () => fakeContext([]), muted: () => false });
    voice.set({ triggers: [[0, 0.2, 0]] }, 5); // the beak opens, nothing is heard
    voice.set(null, 0);
    await new Promise((done) => setTimeout(done));
    expect(loads).toBe(0);
  });

  describe("on a page the browser keeps silent until a gesture", () => {
    const suspended = async () => {
      const made = await voiceWith({ triggers: [[0, 1, 0]] }, { duration: 1, state: "suspended" });
      for (const at of [0.02, 0.04, 0.06]) made.voice.follow(at);
      return made;
    };

    it("never asks the context to resume from a frame", async () => {
      const { voice, log } = await suspended();
      expect(log).toEqual([]);
      voice.dispose();
    });

    it("resumes it inside the first gesture, once", async () => {
      const { voice, log } = await suspended();
      window.dispatchEvent(new Event("pointerdown"));
      expect(log).toEqual([["resume"]]);
      voice.dispose();
    });

    it("plays the sound that is due from its offset on the first frame after the context runs", async () => {
      const { voice, log, context } = await suspended();
      context.changeState("running");
      voice.follow(0.08);
      expect(log).toEqual([["start", 4800, 0.08]]);
      window.dispatchEvent(new Event("pointerdown"));
      expect(log).toHaveLength(1);
      voice.dispose();
    });

    it("stops listening for gestures once disposed", async () => {
      const { voice, log } = await suspended();
      voice.dispose();
      window.dispatchEvent(new Event("pointerdown"));
      window.dispatchEvent(new Event("keydown"));
      expect(log).toEqual([]);
    });
  });

  it("forgets the sounds of lanes that have left the stage", async () => {
    const log = [];
    let release;
    const slow = new Promise((done) => { release = done; });
    const voice = createStageVoice(() => slow, { makeContext: () => fakeContext(log), muted: () => false });
    voice.set({ ...song, triggers: [[0, 1, 0]] }, 1);
    voice.set(null, 0);
    release(calls);
    await new Promise((done) => setTimeout(done));
    voice.follow(0.02);
    expect(log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/stage-voice.test.js`
Expected: FAIL (`set` still takes a list of events, so a sound object plays nothing).

- [ ] **Step 3: Implement**

Replace `app/src/stage-voice.js` with:

```js
// The performer's voice on a live stage: its song as one take from t = 0 and its calls one at a time
// (duck-voice.js), played on the replay's own clock. A jump — the loop coming round, a scrub, new
// lanes — stops what plays and starts what the new time is inside, from where it is: a wheee resumes
// mid-ride, the song mid-phrase. Nothing waits on a sound: no Web Audio, a muted Arena or a context
// the browser keeps suspended until a gesture (the first click or key resumes it) leave the replay
// playing in silence.

import { callSamples, songSamples, voiceEvents } from "./duck-voice.js";
import { SAMPLE_RATE } from "./live/score.js";
import { isMuted } from "./sound.js";

/** A step longer than this between two frames is a jump, not playback. */
const JUMP_S = 0.25;
/** The voice under the replay, as the vote's cues sit (sound.js: 0.4–0.6). */
const GAIN = 0.6;

export function createStageVoice(loadCalls, { makeContext = () => new AudioContext(), muted = isMuted } = {}) {
  let loaded = null;
  let context = null;
  let output = null;
  let clips = [];
  let song = null;
  let version = 0;
  let last = 0;
  // Two parts, each playing one buffer at a time: the calls, and the song (its only clip is 0).
  const calling = { playing: -1, source: null };
  const singing = { playing: -1, source: null };

  // A suspended context only starts from a resume() asked inside a gesture.
  const gestures = ["pointerdown", "keydown"];
  function resume() {
    context.resume().catch(() => {});
  }
  function stopWaitingForGesture() {
    for (const type of gestures) window.removeEventListener(type, resume, true);
    context?.removeEventListener("statechange", onStateChange);
  }
  function onStateChange() {
    if (context.state === "running") stopWaitingForGesture();
  }

  function halt(part) {
    if (part.source) {
      try {
        part.source.stop();
      } catch {
        // Already ended: nothing to stop.
      }
    }
    part.source = null;
    part.playing = -1;
  }

  /** Has `part` play clip `index` (-1: nothing) from `offset` seconds into `buffer`, unless it already does and the clock did not jump. */
  function steer(part, index, jumped, buffer, offset) {
    if (index === part.playing && !jumped) return;
    halt(part);
    if (index < 0 || context.state !== "running") return;
    try {
      part.source = context.createBufferSource();
      part.source.buffer = buffer;
      part.source.connect(output);
      part.source.start(0, offset);
      part.playing = index;
    } catch {
      part.source = null;
    }
  }

  function bufferOf(samples) {
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  return {
    /** The performer now on the stage: how it sounds (duck-voice.js), or null, and how many seconds its trace performs. */
    set(sound, duration) {
      halt(calling);
      halt(singing);
      clips = [];
      song = null;
      const mine = ++version;
      const events = voiceEvents(sound, duration);
      if (!events.length && !sound?.song) return;
      loaded ??= loadCalls();
      loaded.then((calls) => {
        if (mine !== version) return;
        if (!context) {
          context = makeContext();
          output = context.createGain();
          output.gain.value = GAIN;
          output.connect(context.destination);
          if (context.state !== "running") {
            for (const type of gestures) window.addEventListener(type, resume, true);
            context.addEventListener("statechange", onStateChange);
          }
        }
        clips = events.map((event) => {
          const samples = callSamples(calls, event, sound.voice);
          return { start: event.start, end: event.start + samples.length / SAMPLE_RATE, buffer: bufferOf(samples) };
        });
        const sung = songSamples(calls, sound, duration);
        song = sung && { end: sung.length / SAMPLE_RATE, buffer: bufferOf(sung) };
      }).catch(() => {});
    },

    /** Called every frame with the replay's time, or null while it does not play. */
    follow(seconds) {
      const jumped = seconds === null || seconds < last || seconds - last > JUMP_S;
      if (seconds !== null) last = seconds;
      const live = seconds !== null && !muted();
      const call = live ? clips.findIndex((clip) => clip.start <= seconds && seconds < clip.end) : -1;
      steer(calling, call, jumped, clips[call]?.buffer, seconds - clips[call]?.start);
      steer(singing, live && song && seconds < song.end ? 0 : -1, jumped, song?.buffer, seconds);
    },

    dispose() {
      halt(calling);
      halt(singing);
      version++;
      stopWaitingForGesture();
      context?.close().catch(() => {});
    },
  };
}
```

In `app/src/viewer.js`:
- line 39 becomes `import { MOUTH_TRAVEL, mouthTrack } from "./duck-voice.js";`;
- line 534 becomes:

  ```js
      voice?.set(performer?.sound ?? null, performer ? frameCount(performer.trace) * CTRL_DT : 0);
  ```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/stage-voice.js app/src/stage-voice.test.js app/src/viewer.js
/usr/bin/git commit -m "The stage sings the song as one take on the replay's clock, beside the calls in the performer's voice"
```

---

### Task 6: The clip sings

**Files:**
- Modify: `app/src/clip/score.js`, `app/src/clip/soundtrack.js`
- Test: `app/src/clip/score.test.js`, `app/src/clip/soundtrack.test.js`

**Interfaces:**
- Consumes: Task 4's `voiceEvents`, `callSamples`, `songSamples`.
- Produces: in `clipScore(...).cues`, a call cue is `{ at, call, voice, gain }` and the song cue is `{ at, song: { sound, duration }, gain }`. `renderSoundtrack` renders both from the synth.

- [ ] **Step 1: Write the failing tests**

`app/src/clip/score.test.js`, add inside the describe:

```js
  it("puts the duck's song on the tape at the performance's start, and its calls in its voice", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const plan = clipPlan(250, 20, 26); // a 5 s performance after 26 frames of settle
    const sound = { voice: { pitch: 1 }, song: [[0.5, 1, 69, 0.7, 0.9, 0]], triggers: [[0, 0, 0], [2, 1, 0]] };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const cues = clipScore({ run, plan, trace: new Float32Array(21 * 276), sound }).cues;
    const sung = cues.find((cue) => cue.song);
    expect(sung.at).toBeCloseTo(3 + 0.52);
    expect(sung.song.sound).toBe(sound);
    expect(sung.song.duration).toBeCloseTo(5);
    expect(cues.find((cue) => cue.call).voice).toEqual({ pitch: 1 });
  });
```

`app/src/clip/soundtrack.test.js`, add inside the describe:

```js
  it("renders the song from the robot's synth at its instant, as long as the performance lets it", async () => {
    const log = [];
    const asked = [];
    const calls = {
      song: (seed, voice, notes, seconds) => (asked.push(seconds), new Float32Array(Math.round(seconds * 48000)).fill(0.25)),
    };
    const sound = { song: [[0.5, 1, 69, 0.7, 0.9, 0]] };
    const score = { crowd: null, cues: [{ at: 0.3, song: { sound, duration: 1 }, gain: 1 }] };
    await renderSoundtrack(score, 2, {
      Context: fakeContext(log),
      load: () => { throw new Error("a song cue fetched a file"); },
      calls: async () => calls,
    });
    expect(asked).toEqual([1]);
    expect(log).toHaveLength(1);
    expect(log[0].at).toBe(0.3);
    expect(log[0].buffer.data).toHaveLength(48000);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/clip/score.test.js src/clip/soundtrack.test.js`
Expected: FAIL (no song cue; a song cue tries to fetch a file).

- [ ] **Step 3: Implement**

`app/src/clip/score.js`, in `clipScore`, replace the lines from `// The performance starts on the tape after the settle; …` through the end of the `voice` constant with:

```js
  // The performance starts on the tape after the settle; its length is the author's trace, cut short or not.
  const performed = start + plan.settle * CTRL_DT;
  const length = (plan.steps - plan.settle) * CTRL_DT;
  const voice = [
    ...voiceEvents(sound, length).map((call) => ({ at: performed + call.start, call, voice: sound.voice, gain: GAINS.voice })),
    // The song is one take from the performance's start, as on the stage.
    ...(sound?.song ? [{ at: performed, song: { sound, duration: length }, gain: GAINS.voice }] : []),
  ];
```


`app/src/clip/soundtrack.js`:
- import: `import { callSamples, songSamples } from "../duck-voice.js";`
- replace the synth line and the `buffer:` expression with:

```js
  // The synth only for a clip whose duck makes a sound: every race and silent performance skips it.
  const synth = score.cues.some((cue) => cue.call || cue.song) ? await calls() : null;
  const cues = await Promise.all(
    score.cues.map(async (cue) => ({
      ...cue,
      buffer: cue.call
        ? synthBuffer(context, callSamples(synth, cue.call, cue.voice))
        : cue.song
          ? synthBuffer(context, songSamples(synth, cue.song.sound, cue.song.duration))
          : await context.decodeAudioData(await load(cue.file)),
    })),
  );
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/clip/score.js app/src/clip/score.test.js app/src/clip/soundtrack.js app/src/clip/soundtrack.test.js
/usr/bin/git commit -m "A performance's clip sings its song and quacks in the voice it tunes"
```

---

### Task 7: The guide says how to sing and tune the voice

**Files:**
- Modify: `docs/guides/challenges/got-a-talent.md`
- Modify (other repo, `~/Projects/HuggingFace/microduck-challenges`, local `main`): `README.md`, `src/microduck_challenges/got_a_talent/AGENTS.md`

- [ ] **Step 1: The Arena's guide**

In `docs/guides/challenges/got-a-talent.md`:

1. Replace the paragraph right under `### Mouth and voice` ("A keyframe can also pull the real microduck pad's two triggers, …") with:

```markdown
The duck can quack, wheee and sing, in a voice you tune. None of it is a policy input: the policy
never hears it, so it changes what the audience sees and hears, not how the duck moves. These are
the real microduck's own rules, played with its own synthesiser.

#### The pad's triggers

A keyframe can pull the real microduck pad's two triggers, `"triggers": [rt, lt]`, each from
0 (released) to 1 (pulled all the way):
```

2. Delete the paragraph "Here the duck quacks at 4 s and wheees from 6 s to 8 s. The policy never reads the triggers: they change what the audience sees and hears, not how the duck moves." and replace it with "Here the duck quacks at 4 s and wheees from 6 s to 8 s."

3. Right after that line, before "The workshop edits it on a training's page…", insert:

````markdown
#### Song

A performance can sing a melody, written as a `song` list beside the keyframes:

```json
"song": [
  {"t": 2.0, "note": "C5", "for": 0.5},
  {"t": 2.5, "note": "E5", "for": 0.5, "vowel": "oo"},
  {"t": 3.0, "note": "G5", "for": 1.0, "dynamic": "p"}
]
```

- `t` is when the note starts and `for` how long it lasts, in seconds (at least 0.02).
- `note` is a note name: a letter A to G, an optional `#` or `b`, and an octave. `C4` is middle C
  and `A4` is 440 Hz. From `C2` to `C7`.
- `dynamic` is how loud: `ppp`, `pp`, `p`, `mp`, `mf` (the default), `f` or `ff`.
- `vowel` is what the duck sings on, and how far its beak opens: `ah` (the default, wide open),
  `eh`, `ee`, `oh`, `oo`, or `mm` (a hum, beak closed).
- One voice: a note starts at or after the end of the one before, and the last one ends by
  `duration_s`. At most 1000 notes.
- A note sounds for most of its length and lets go just before its end, so two notes in a row are
  two notes, not a slide. Leave a gap between them for a rest.
- While a note sounds, the duck's voice is busy: RT and LT still open the beak but make no sound,
  a quack or a wheee playing when a note starts stops there, and LT still held when a note ends
  starts the wheee again.

#### Voice

A `voice` block tunes the duck's voice for the whole performance: the quack, the wheee and the song.

```json
"voice": {"pitch": 0.3, "brightness": 0.8, "buzz": 0.2, "vibrato": 0.5, "breath": 0.1}
```

Each knob goes from 0 to 1. A knob you leave out keeps the stage duck's own voice.

| Knob | From 0 to 1 | The stage duck's own |
| --- | --- | --- |
| `pitch` | a low duck (110 Hz) to a high one (620 Hz): the quack and the wheee, never the song's notes | 0.49 |
| `brightness` | a dark voice to a bright one | about 0.12 |
| `buzz` | a pure tone to a buzzing quack | 0.55 |
| `vibrato` | steady to a vibrato of 0.7 semitone | 0.11 |
| `breath` | clean to breathy | 0.90 |
````

- [ ] **Step 2: Check the page renders**

Run: `cd app && npx vitest run src/guides.test.js`
Expected: PASS. Then read the section back once: every code fence and the table are closed, and the headings go `###` → `####`.

- [ ] **Step 3: Commit the Arena's guide**

```bash
/usr/bin/git add docs/guides/challenges/got-a-talent.md
/usr/bin/git commit -m "The Got a Talent guide: a song of notes and a voice of five knobs, with the rules they follow on stage"
```

- [ ] **Step 4: The challenges' README and agent guide**

In `~/Projects/HuggingFace/microduck-challenges` (local `main`, which already holds the unpushed 97a1edc):

`README.md`: replace the two lines starting "A keyframe can also pull the pad's triggers" with:

```markdown
A performance can also make the duck heard: `"triggers": [rt, lt]` in a keyframe (RT quacks, LT
wheees), a `song` of notes beside the keyframes, and a `voice` that tunes it (the Arena's
[Got a Talent guide](https://pollen-robotics-microduck-arena.hf.space/#/e/got-a-talent/guide)).
```

`src/microduck_challenges/got_a_talent/AGENTS.md`: after the paragraph that ends "`duration_s` at most 20." insert:

```markdown
A performance can also make the duck heard, with nothing for the policy to learn: `triggers` in a
keyframe (RT quacks, LT wheees), a `song` of notes beside the keyframes, and a `voice` block that
tunes the duck's voice. The Arena's
[Got a Talent guide](https://pollen-robotics-microduck-arena.hf.space/#/e/got-a-talent/guide) has the
rules. Offer it to the user when the performance wants sound; never add it without asking.
```

```bash
cd ~/Projects/HuggingFace/microduck-challenges
/usr/bin/git add README.md src/microduck_challenges/got_a_talent/AGENTS.md
/usr/bin/git commit -m "Got a Talent: a performance can sing a song and tune its voice"
```

Do not push.

---

### Task 8: Seen and heard on this Mac

Nothing is committed in this task, and everything stays in the scratchpad. The aim is to observe the real thing before calling it done.

- [ ] **Step 1: A performance that sings, quacks and wheees, scored into a scratch store**

Write `$SCRATCH/song-check/timeline.json`:

```json
{"timeline_version": 1, "duration_s": 10.0,
 "voice": {"vibrato": 0.6, "brightness": 0.7},
 "song": [
   {"t": 1.0, "note": "C5", "for": 0.4},
   {"t": 1.5, "note": "E5", "for": 0.4},
   {"t": 2.0, "note": "G5", "for": 0.8, "vowel": "oo"},
   {"t": 3.0, "note": "C6", "for": 1.2, "dynamic": "ff"},
   {"t": 7.0, "note": "G4", "for": 1.5, "dynamic": "p", "vowel": "mm"}
 ],
 "keyframes": [
   {"t": 0.0},
   {"t": 2.0, "head": [0, 0.3, 0, 0]},
   {"t": 4.5, "triggers": [1, 0]},
   {"t": 4.8},
   {"t": 5.5, "triggers": [0, 1]},
   {"t": 9.5}
 ]}
```

Expected sounds:
- the notes C5, E5, G5 (on "oo") and C6 (loud) from 1.0 s to 4.2 s;
- a quack at 4.5 s;
- a wheee from 5.5 s, cut at 7.0 s by the hum;
- the G4 hum from 7.0 s to 8.5 s;
- the wheee again from 8.5 s to 9.5 s (LT still held).

From the worktree:

```bash
.venv/bin/arena score arena/assets/policies/BEST_alpha_walking.onnx --event got-a-talent \
  --timeline $SCRATCH/song-check/timeline.json --store $SCRATCH/song-check/store --user alice --name song-check
```

Expected: `recorded <run_id>`. Note the run id.

- [ ] **Step 2: Serve it**

- API: `.venv/bin/arena serve --store $SCRATCH/song-check/store --user alice --port 8001`. Run it with `run_in_background`, since it is a server and not a test.
- Front-end: write `$SCRATCH/song-check/vite.config.js`. It spreads the worktree's `app/vite.config.js`, sets `root` to the worktree's `app`, `server.port` to 5180 and proxies `/api` to `http://127.0.0.1:8001`. Run `npx vite --config $SCRATCH/song-check/vite.config.js` from the worktree's `app`, also in the background. Restart vite after any source edit.
- Open `http://localhost:5180`, not `127.0.0.1`.

- [ ] **Step 3: The beak, on the clip page**

Use Puppeteer from `/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer`, with a 1920×1080 viewport and `deviceScaleFactor: 1`. Open `http://localhost:5180/clip.html?run=<run_id>&layout=landscape`. Wait for `window.clip.ready`. Then, for each of t = 0.5 s (beak closed), 2.5 s (G5 on "oo", about a third open) and 3.5 s (C6 on "ah", wide open):
- compute `i = clip.plan.intro + Math.round((clip.plan.settle + t / 0.02) / clip.plan.stride)`;
- call `clip.draw(i)`;
- take a screenshot.

Crop around the duck if it is small. Expected: closed, a third open, wide open. (Not the hum at 7.5 s: LT is held then, and the beak opens to the larger of the song and the triggers.) Send the three captures to the owner.

- [ ] **Step 4: The song, in the clip's soundtrack**

On the same page, run `len = await clip.soundtrack()`. Read it back in 1 MiB slices with `clip.chunk(offset, size)` (base64) and write `$SCRATCH/song-check/soundtrack.f32`. Then:

```bash
ffmpeg -y -loglevel error -f f32le -ar 48000 -ac 2 -i $SCRATCH/song-check/soundtrack.f32 $SCRATCH/song-check/soundtrack.wav
```

Expected: the sounds of Step 1, each offset by the tape's start plus the settle. Send the WAV to the owner.

- [ ] **Step 5: The voice, live on the run page**

Launch Puppeteer with `--autoplay-policy=no-user-gesture-required`. Before any page script runs (`evaluateOnNewDocument`), wrap `AudioBufferSourceNode.prototype.start` so that it records `[performance.now(), buffer.length, offset]` in `window.__starts`. Open `http://localhost:5180/#/r/<run_id>` and wait 12 s.

Expected:
- `__starts` holds one song take (a buffer of about 8.7 s: last note end 8.5 s + 0.2 s, i.e. 417 600 samples);
- one quack (a buffer under 0.6 s);
- two wheees (about 1.5 s and 1.0 s);
- they arrive at the instants of Step 1, then again on the loop;
- there are no console errors.

- [ ] **Step 6: The audition: each knob at 0 and at 1**

Write `$SCRATCH/song-check/audition.mjs`:

```js
// node audition.mjs <worktree> <out dir>: for each knob at 0 and at 1, and the stage duck's own voice,
// a quack, a 1.5 s wheee and C5 E5 G5 C6, as one raw float32 file per setting.
import { readFileSync, writeFileSync } from "node:fs";

const [tree, out] = process.argv.slice(2);
const { loadCalls } = await import(`${tree}/app/src/live/voice.js`);
const calls = await loadCalls(async (url) => ({ ok: true, arrayBuffer: async () => readFileSync(`${tree}/app/public${url}`) }));
const RATE = 48000;
const gap = new Float32Array(0.3 * RATE);
const melody = [72, 76, 79, 84].map((midi, i) => [0.5 * i, 0.45, midi, 0.7, 0.9, 0]);
const settings = { own: {} };
for (const knob of ["pitch", "brightness", "buzz", "vibrato", "breath"]) {
  settings[`${knob}-0`] = { [knob]: 0 };
  settings[`${knob}-1`] = { [knob]: 1 };
}
for (const [name, voice] of Object.entries(settings)) {
  const start = calls.wheee(28, 0, 0, voice);
  const ride = calls.wheee(28, 0, 1, voice);
  const wheee = new Float32Array(1.5 * RATE);
  wheee.set(start.subarray(0, wheee.length));
  for (let at = start.length; at < wheee.length; at += ride.length) wheee.set(ride.subarray(0, wheee.length - at), at);
  const parts = [calls.chirp(28, 0, voice), gap, wheee, gap, calls.song(28, voice, melody, 2.2)];
  const all = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  writeFileSync(`${out}/${name}.f32`, Buffer.from(all.buffer));
}
```

Run `node $SCRATCH/song-check/audition.mjs <worktree> $SCRATCH/song-check`. Then, for each of the 11 `.f32` files:

```bash
ffmpeg -y -loglevel error -f f32le -ar 48000 -ac 1 -i $SCRATCH/song-check/<name>.f32 $SCRATCH/song-check/<name>.wav
```

Expected: each knob's 0 and 1 are clearly different, and none is broken (clipped, silent or noise only).

- [ ] **Step 7: Stop the servers, and report to the owner**

Kill both background servers. Report the captures, the soundtrack WAV, the start log and the 11 audition WAVs. Ask the owner to listen. If a knob's range sounds wrong to them, the fix is the mapping in `app/voice/src/lib.rs` `tuned` and the guide's table: change both, rebuild the wasm, and run Task 3's tests again.

---

### Task 9: Version 0.4.5

**Files:**
- Modify: `pyproject.toml` (`version`), `uv.lock` (the `microduck-arena` package's version line)

- [ ] **Step 1: Full suite**

Run the two Python calls and `cd app && npm test` from Global Constraints.
Expected: every pass count is at least the starting count plus the new tests; the 4 known brightness failures are the only failures.

- [ ] **Step 2: Bump**

In `pyproject.toml`, change `version = "0.4.4"` to `version = "0.4.5"`. In `uv.lock`, change the `version = "0.4.4"` line under `name = "microduck-arena"` to `"0.4.5"`. Check that nothing else moved with `/usr/bin/git diff --stat`, which should show 2 files and 2 lines.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add pyproject.toml uv.lock
/usr/bin/git commit -m "Version 0.4.5: a Got a Talent performance sings a song, in a voice its author tunes"
```

Stop here. The release steps (merge and push, the wheel, the challenges relock) each wait for the owner's yes. They are listed under "Not in this plan".
