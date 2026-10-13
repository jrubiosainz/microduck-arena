# The duck sings, in a voice its author tunes, on the Got a Talent stage — design

Date: 2026-10-13. Status: approved in brainstorm, section by section; awaiting written review.

## Goal

A MicroDuck Got a Talent performance can do two things it cannot do today:

- **sing a melody**: notes with a pitch, a length, a dynamic and a vowel, in the duck's own voice;
- **tune that voice**: pitch, brightness, buzz, vibrato and breath. The quack, the wheee and the
  song all use the tuned voice.

The author writes both in the performance's `timeline.json`, beside the keyframes. They are heard
(and the beak is seen singing) everywhere a performance is replayed: the run page, the anonymous
ballot, the workshop's training page, the clip and therefore the live channel.

**Success:** a performance whose timeline holds a `voice` and a `song` sings its notes at the
right instants and pitches, in the tuned voice, with the beak opening on each vowel, the same on
every page and in the clip. Every performance already published keeps its score, its trace, its
replay and its sound.

## What the real robot does (pollen-robotics/microduck @ e597877)

These rules are copied, not invented:

- `sounds/src/stream.rs`: `Stream` is the duck's voice held open, driven by live parameters:
  `set(hz, level, open)` and `set_formant_shift(harmonics)`, each slewed (pitch 45 ms, level
  30 ms, timbre 60 ms). The ToF theremin (`Stream::wheee`) and the chorale (`Stream::choral`) sing
  with it. `Stream::choral` tames vibrato, buzz, jitter and breath because "in a chord all three
  fight the tuning".
- `sounds/src/chorale/mod.rs`: notes are absolute (A4 = 440 Hz, equal temperament): a duck's
  `pitch_center_hz` does not move them. Note names are scientific (C4 = middle C = MIDI 60).
  Dynamics: `ppp` 0.15, `pp` 0.25, `p` 0.40, `mp` 0.55, `mf` 0.70, `f` 0.85, `ff` 1.00. Vowels
  (`Vowel::open` / `formant_shift` / `level_scale`): `ah` 0.90 / 0 / 1, `eh` 0.65 / +1 / 1,
  `ee` 0.45 / +3 / 1, `oh` 0.55 / −1 / 1, `oo` 0.35 / −2 / 1, `mm` 0.05 / −2 / 0.65.
- `sing` (chorale/mod.rs) and robotd's chorale writer (`robotd/src/sound.rs`): a note sounds for
  the first 92 % of its length and is released for the rest, so two notes in a row re-articulate.
  Between notes the voice is silent at the pitch it was on, with no glide. The level is
  `dynamic × level_scale`, `open` is the vowel's opening, and the formant is the vowel's shift.
- `robotd/src/main.rs`: while singing, the beak follows the vowel (its opening for 92 % of the
  note, ×0.2 in the release, closed between notes), slewed with `CHORALE_MOUTH_TAU_S` = 0.09 s.
- `robotd/src/sound.rs`: an instrument (theremin, chorale) holds the single speaker. A one-shot
  that arrives meanwhile is dropped, and the wheee does not start (`Ride::Theremin | Ride::Singing`
  → return). Once the speaker is free, a still-held LT starts its ride again.
- `sounds/src/personality.rs`: every trait is a public field with a documented range
  (`pitch_center_hz` 110–620 Hz, `tilt` 1.4–2.8, `brightness` 0.05–0.55, `quackiness` 0.2–1,
  `vibrato_depth` 0–0.7 st, `breath` 0–0.30). `voices::chirp` and `voices::wheee_segments` take a
  `&Personality`, so a tuned personality is a tuned quack and wheee.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **A melody is a top-level `song` list, beside the keyframes** | A note has a start and a length; writing it as keyframes would make every note a keyframe and force the author to repeat twist/head/body in each one while the duck dances. Rules out a `sing` group in keyframes, which the RT/LT spec's "one time axis" reasoning would have preferred. |
| **One `voice` block for the whole performance, plus per-note `dynamic` and `vowel`** | The owner chose both scales. Per-note settings are the ones the robot's chorale already writes per note. Rules out per-note timbre automation (vibrato swelling, timbre moving), which `Stream` does not expose without changing the crate. |
| **Knobs are 0..1 positions over the robot's trait ranges** | The same scale as the triggers. Five knobs a person can reason about instead of twenty traits. A knob left out keeps seed 28's own trait, so a timeline without `voice` sounds exactly as today. Replaces the 2026-10-12 decision of one fixed voice for every performer: the default is still that voice. |
| **Notes are absolute; `pitch` moves only the quack and the wheee** | The chorale's rule: the note belongs to the score and the duck keeps its timbre. A melody written in C sounds in C. |
| **The duck sings solo, with `Stream::new`, untamed** | `Stream::choral` tames modulation so that a chord does not sound sour. A solo has no chord, and the vibrato and buzz knobs must stay audible. |
| **One sound source at a time, as on the robot** | A note holds the speaker from its `t` to `t + for`: RT/LT still open the beak but make no sound, a call playing when a note starts is cut, and a still-held LT starts a new wheee when the note ends. Rules out mixing calls over the song. |
| **Not a policy input, not simulated** | As for the triggers: the 13 command numbers, the 61-D observation, the runner, the golden run and `RUNNER_VERSION` are untouched. Published policies keep their scores and traces, and nothing is re-raced. |
| **`timeline_version` stays 1** | A file without `song` or `voice` loads unchanged. An older Arena refuses one with them, saying `unknown keys ['song', 'voice']`, which names the problem. |
| **The record stores resolved numbers, not names** | The beak needs each vowel's opening in the page, and the synth needs the level and formant. If Python (which must know the names to validate them) resolves them once, the vowel and dynamic values live in one table, `arena/timeline.py`, copied from the crate at e597877 and cited there. Without this, the names and values would be held by Python, JS and Rust. This changes what section 3 of the brainstorm said ("names stored, the crate translates"). A stored performance also keeps sounding the same if the crate's tables ever change. |
| **The knob → trait mapping lives in the wasm** | It builds the `Personality`, so that is the one place where 0..1 becomes hertz and semitones. |
| **One `sound` object travels instead of the trigger track** | Board rows, ballots, workshop evaluations and clips carry one key holding the voice, the song and the triggers. Two runs recorded on 2026-10-12 (`01M4RC6KZRRAWP3PVD86NE`, `01M4RD5N7T8N050XKYWW51`) already carry `triggers` in an append-only log, so `RunRecord.from_dict` reads an old `triggers` key as `{"triggers": …}` and they keep their quacks. |

## 1. The format

```json
{"timeline_version": 1, "duration_s": 20.0,
 "voice": {"pitch": 0.3, "brightness": 0.8, "buzz": 0.2, "vibrato": 0.5, "breath": 0.1},
 "song": [
   {"t": 2.0, "note": "C5", "for": 0.5},
   {"t": 2.5, "note": "E5", "for": 0.5, "vowel": "oo"},
   {"t": 3.0, "note": "G5", "for": 1.0, "dynamic": "p"}
 ],
 "keyframes": [{"t": 0.0}]}
```

Here the duck sings C5, then E5 on "oo", then a soft G5 held for a second, in a voice brighter and
more vibrato-laden than the default.

**`voice`** is optional. Each key is optional and is a finite number in [0, 1]:

| Knob | Trait (seed 28's own value when left out) | Mapping |
| --- | --- | --- |
| `pitch` | `pitch_center_hz` | 110 × (620/110)^k Hz, geometric |
| `brightness` | `tilt` and `brightness` together | tilt 2.8 − 1.4k, brightness 0.05 + 0.5k |
| `buzz` | `quackiness` | k |
| `vibrato` | `vibrato_depth` | 0.7k semitone |
| `breath` | `breath` | 0.30k |

Any other key is refused (`voice: unknown keys ['speed']`), as is an out-of-range value
(`voice.pitch: 1.5 is outside [0, 1]`). The guide lists seed 28's position on each knob. The
implementation computes those positions from the crate (for `brightness`, from `tilt`) and does
not guess them.

**`song`** is optional: a list of 1 to 1000 notes. Each note is an object with exactly these keys:

- `t`: start, in seconds, ≥ 0;
- `for`: length, in seconds, ≥ one control step (0.02 s);
- `note`: a scientific pitch name, letter A–G (either case), optional `#` or `b`, then an octave;
  C4 = MIDI 60; accepted from C2 (36) to C7 (96);
- `dynamic` (optional, default `mf`): one of `ppp pp p mp mf f ff`;
- `vowel` (optional, default `ah`): one of `ah eh ee oh oo mm`.

Notes come in order and do not overlap: a note's `t` is at or after the previous note's
`t + for`. The last note ends at or before `duration_s`. Each refusal names its place, in the
loader's existing style: `song[3].note: 'H4' is not a note name`, `song[2].t: 1.2 starts before
song[1] ends (1.5)`, `song[5]: ends at 20.4, after the end of the performance (20 s)`,
`song[0]: unknown keys ['level']`.

## 2. How the duck sings (the rules the page and the clip both follow)

- A note sounds at its pitch (A4 = 440 Hz) for the first 92 % of `for`, at level
  `dynamic × level_scale`, with the vowel's opening and formant shift. It is released for the last
  8 %. Between notes the voice is silent at the last pitch. Two notes in a row re-articulate and
  never glide.
- **The beak** is the larger of two openings, each eased like a servo: the triggers'
  (`max(rt, lt)`, 60 ms, unchanged) and the song's (the vowel's opening for 92 % of a note, ×0.2
  for the rest, 0 between notes, 90 ms).
- **With RT and LT**, a note holds the speaker from `t` to `t + for`:
  - a quack whose RT edge falls inside a note is dropped;
  - a wheee does not start inside a note;
  - a quack or wheee playing when a note starts is cut there;
  - when a note ends and LT is still at or over 0.3, a new wheee starts then, unless another note
    starts at that instant.
- Everything still sounding at the end of the performance, or when a cut-short trace stops, is cut.

## 3. The Arena (server)

- **`arena/timeline.py`.**
  - The loader accepts and checks `voice` and `song` as in section 1.
  - `Timeline` gains `voice: dict` (the knobs written) and `song: tuple[Note, ...]`.
    `command_at` is unchanged.
  - The note-name parser lives here, as do the dynamic and vowel tables, copied from the crate at
    e597877 with a comment citing it.
  - `trigger_track` is replaced by `sound_of(timeline)`. It returns
    `{"voice": {...}, "song": [[t, for, midi, level, open, formant], ...], "triggers": [[t, rt, lt], ...]}`,
    holding only the keys in use: `voice` only when it is written and something sounds, `song` only
    when there are notes, and `triggers` under today's rule (only when some trigger is pulled).
    `level` is already `dynamic × level_scale`. It returns `None` when the performance has no song
    and pulls no trigger.
- **`arena/store.py`.** `RunRecord.sound: dict | None = None` replaces `triggers`. `to_dict`
  writes `sound`. `from_dict` reads `sound`, or else turns an old `triggers` list into
  `{"triggers": …}` (with the comment naming the two runs of 2026-10-12 that need it).
- **The same places that carry `triggers` today carry `sound` instead:**
  - `routes_submit` (an entry);
  - `recover` (a re-race fetches the timeline again);
  - `cli.py` (`arena score`);
  - `routes_read._board_row` (every board row: event leaderboard and run page);
  - `routes_vote` (the ballot: one per lane in lane order, or `null`);
  - `arena/workshop/evaluations.py` (the checkpoint evaluation).

  An edit to `voice` or `song` changes the file's sha256, so the workshop plays the checkpoint
  again, as for any timeline edit.

## 4. The synth (`app/voice`)

The crate stays pinned at e597877. `app/voice/src/lib.rs`:

- **A tuned personality.** `Personality::from_seed(seed)`, then each knob that is not NaN
  overwrites its trait through the mapping in section 1. The five knobs are passed as five `f64`
  arguments, NaN meaning "keep the seed's".
- **`chirp(seed, variant, pitch, brightness, buzz, vibrato, breath)` and
  `wheee(seed, variant, segment, pitch, brightness, buzz, vibrato, breath)`** play the robot's
  calls in the tuned voice.
- **`notes(count) -> *mut f64`** makes room for `count × 6` numbers
  (t, for, midi, level, open, formant), which the page fills.
- **`song(seed, pitch, brightness, buzz, vibrato, breath, count, length_s) -> usize`** renders the
  whole melody from t = 0 into the samples buffer. It uses `Stream::new(&tuned, "song", 0)` with
  no speaker rolloff, and the chorale's loop: blocks of 128 samples, the note under the block
  found by time, `set_formant_shift` and `set(midi_hz(midi), level or 0 after 92 %, open)` inside
  a note, `set_level(0)` between notes. The buffer runs to `length_s`, which the page sets to the
  last note's end plus 0.2 s for the release to fade. The function returns the length in samples.
- `app/public/sound/microduck-voice.wasm` is rebuilt with the command in `app/voice/Cargo.toml`.
  The booth's `syllable` is untouched.

## 5. The site

- **`app/src/live/voice.js`.** `loadCalls` exposes `chirp`, `wheee` and `song`, each taking the
  `voice` knobs (an absent knob passed as NaN) and returning a copy of the samples.
- **`app/src/duck-voice.js`, pure.** It works from a `sound` object instead of a trigger track.
  - `mouthTrack(sound, frames, lead)`: the beak at every 50 Hz frame, by the rule in section 2.
  - `voiceEvents(sound, duration)`: the calls, under the RT/LT rules of today and the note rules of
    section 2.
  - `callSamples(calls, event, voice)`: a call's samples in the tuned voice.
  - `songSamples(calls, sound)`: the melody's buffer, or `null` without a song.
- **`app/src/stage-voice.js`.** Two sources on the replay's clock: the melody's buffer (started
  at the replay's time when it is inside it) and the calls, one at a time as today. A jump stops
  both and restarts each where the new time falls. The muting rule, the wait for a gesture and the
  "nothing waits on a sound" rule are unchanged, and no button is added.
- **The lanes.** `race.js`, `run.js`, `vote.js`, `viewer.js` and `workshop/job.js` hand the
  lane's `sound` where they handed `triggers`.
- **The clip.** `clip/score.js` adds the melody as one cue at the tape's start offset, beside the
  calls' cues, and `clip/soundtrack.js` takes it like a call's samples.

## 6. Docs, tests, verification, release

- **Docs (English).**
  - `docs/guides/challenges/got-a-talent.md` keeps "Mouth and voice" and gains two subsections:
    - **Voice**: the five knobs, what each changes, seed 28's positions;
    - **Song**: the note fields, the dynamics, the vowels, the rules with RT/LT, and the example
      above.
  - In microduck-challenges, `README.md` and `src/microduck_challenges/got_a_talent/AGENTS.md`
    point to it.
- **Tests.**
  - **pytest:**
    - the loader: accepted shapes, and each refusal named (note name, overlap, past the end,
      unknown dynamic or vowel, knob outside [0, 1], unknown key in `voice` or in a note, `for`
      under one step, a note outside C2–C7);
    - `sound_of`;
    - the `RunRecord` round trip, including an old record with `triggers`, which reads back as
      `{"triggers": …}`;
    - the entry, board row, ballot and workshop-evaluation payloads.
  - **vitest:**
    - `mouthTrack` with a song (the vowel opening, the release, closed between notes, the larger
      of the song and the triggers);
    - `voiceEvents` (a quack dropped inside a note, a call cut at a note's start, LT starting a
      wheee at a note's end, none when the next note follows at once);
    - the stage voice after a jump, with both sources;
    - the clip's cues.
  - **Node, on the rebuilt wasm:**
    - `song`, `chirp` and `wheee` return finite samples;
    - an A4 note sings near 440 Hz and an A5 near 880 Hz, by zero crossings;
    - `pitch` 0 and 1 move the quack's pitch down and up.
- **Seen and heard before it is called done.**
  - A local stage preview of a timeline that sings, quacks and wheees, with a headless capture of
    the beak open on an `ah`.
  - The clip's soundtrack rendered to a WAV the owner listens to.
  - An audition set with each knob at 0 and at 1, so the owner checks the ranges by ear before the
    release.
- **Release, each step on the owner's yes:**
  1. version 0.4.5;
  2. the wheel on pollen-robotics/microduck-arena-wheels, tag v0.4.5 (0.4.4's wheel was never
     released, so this one carries the triggers too);
  3. push main (the Space deploys);
  4. microduck-challenges relocked onto 0.4.5 and pushed straight after, with its local README
     commit 97a1edc, so a workshop accepts `song`, `voice` and the triggers.

## Out of scope

- A visual editor (sliders, piano roll) in the workshop.
- The real robot singing `song` (its daemon does not read `timeline.json`; the format uses its
  chorale's vocabulary, so it is ready for it).
- More than one voice at once (chords, a duet).
- Per-note settings other than `dynamic` and `vowel`; timbre that moves during a note.
- Tempo, beats, and MIDI or `.duckscore` import.
