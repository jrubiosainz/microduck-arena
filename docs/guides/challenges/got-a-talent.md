# MicroDuck Got a Talent

Put on a 20-second performance on an open stage. The public votes for its favourite.

## Train

Open **Train my own robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py got-a-talent
```

The challenge trains a duck to sit and stand on command and to turn its head where it is told.
Your policy follows the commands; your performance gives them.

## Your performance

A performance is a `timeline.json` published beside your policy: when to sit, when to stand,
where to look. The Arena plays it once, on a flat open floor, for at most **20 seconds**. Nothing is
timed and nothing has to be finished; a fall is part of the performance.

```json
{"timeline_version": 1, "duration_s": 20.0, "keyframes": [
  {"t": 0.0},
  {"t": 2.0, "twist": [1, 0, 0], "head": [0, 0, 0.5, 0]},
  {"t": 7.0, "head": [0, 0.4, 0, 0]}
]}
```

- From each keyframe's `t`, in seconds, until the next one, the policy reads its 13 command
  numbers: `twist` (3), `head` (4), `body` (6). A group a keyframe leaves out is zeros.
- The challenge's policy reads `twist[0]` as the sit flag (1 sit, 0 stand), and `head` as neck
  pitch, head pitch, head yaw and head roll, in radians from its default pose.
- The first keyframe is at 0, times go up, at most 1000 keyframes, every command number within ±10.

### Mouth and voice

The duck can quack, wheee and sing, in a voice you tune. None of it is a policy input: the policy
never hears it, so it changes what the audience sees and hears, not how the duck moves. These are
the real microduck's own rules, played with its own synthesiser.

#### The pad's triggers

A keyframe can pull the real microduck pad's two triggers, `"triggers": [rt, lt]`, each from
0 (released) to 1 (pulled all the way):

- **RT** opens the beak and quacks once as it passes 0.3. To quack again, release it, then pull it again.
- **LT** opens the beak and goes "wheee" while it stays at 0.3 or more, and stops when it drops below.
- The beak opens as far as the harder-pulled trigger. Under 0.3 it opens without a sound.
- One sound at a time: a new quack cuts the last one, and a quack during a wheee is not heard.
- A keyframe that leaves `triggers` out releases both, like any group: repeat LT in each keyframe
  to keep the wheee going.

```json
{"t": 4.0, "twist": [1, 0, 0], "triggers": [1, 0]},
{"t": 4.3, "twist": [1, 0, 0]},
{"t": 6.0, "head": [0, 0.3, 0, 0], "triggers": [0, 1]},
{"t": 8.0}
```

Here the duck quacks at 4 s and wheees from 6 s to 8 s.

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
| `brightness` | a dark voice to a bright one | about 0.12 (leave it out to keep the duck's own exactly) |
| `buzz` | a pure tone to a buzzing quack | 0.54 |
| `vibrato` | steady to a vibrato of 0.7 semitone | 0.11 |
| `breath` | clean to breathy | 0.90 |

A whole timeline with a voice and a song beside the keyframes:

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

The workshop edits it on a training's page and plays it with the checkpoint you pick. From a
shell, `uv run --group workshop arena score policy.onnx --event got-a-talent --timeline timeline.json`
plays it on your machine, and `uv run publish … --timeline timeline.json --enter` enters it. An entry
without a timeline stands still for 20 s.

## Judging

Every performance played to the end goes to the ballots. The most votes over the **last seven
days** wins; tied entries favour the earlier publication.

Your **latest performance played to the end** represents you. Votes on an older entry do not transfer to its replacement.

Ballots offer two to four anonymous performances, excluding your own, watched one at a time on
stage. You can cast **20 votes per UTC day**. Each accepted vote earns **2 player points** until it
leaves the seven-day window.

[How the workshop works, and the shell path →](../train-a-policy.md)
