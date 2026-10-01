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
timed and nothing has to be finished; a fall is part of the show.

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
- The first keyframe is at 0, times go up, at most 1000 keyframes, every number within ±10.

The workshop edits it on a training's page and plays it with the checkpoint you pick. From a
shell, `uv run --group workshop arena score policy.onnx --event got-a-talent --timeline timeline.json`
plays it on your machine, and `uv run publish … --timeline timeline.json --enter` enters it. An entry
without a timeline stands still for 20 s.

## Judging

Every performance played to the end goes to the ballots. The most votes over the **last seven
days** wins; tied entries favour the earlier publication.

Your **latest entry** represents you. Votes on an older entry do not transfer to its replacement.

Ballots offer two to four anonymous performances, excluding your own, watched one at a time on
stage. You can cast **20 votes per UTC day**. Each accepted vote earns **2 player points** until it
leaves the seven-day window.

[How the workshop works, and the shell path →](../train-a-policy.md)
