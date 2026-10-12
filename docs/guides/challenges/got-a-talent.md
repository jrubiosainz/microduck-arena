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
- The first keyframe is at 0, times go up, at most 1000 keyframes, every command number within ±10.

### Mouth and voice

A keyframe can also pull the real microduck pad's two triggers, `"triggers": [rt, lt]`, each from
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

Here the duck quacks at 4 s and wheees from 6 s to 8 s. The policy never reads the triggers: they
change what the audience sees and hears, not how the duck moves.

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
