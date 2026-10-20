# Tug of War

Two ducks are tied neck to neck by a 1 m string, over a 0.3 m pit. Drag the other duck into the pit.

## The bout

Each duck pulls by walking backwards: the Arena sends every duck the same fixed command,
`[-0.30, 0, 0]`. There is no speed sweep.

**Only the pit decides.** A duck that falls, sits or lies down stays in play and can still be
dragged in. The first duck in the pit loses the bout. If nobody is in after **20 seconds**, the red
marker in the middle of the string decides: the duck it moved away from loses. The first to win
**two bouts** wins the match, sides swapped after each bout, at most five bouts.

## Train

Open **Train my own robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py tug-of-war
```

It opens the `tug_of_war` challenge of microduck-challenges, where the duck trains against the
bench's own winch. A walking policy from the races cannot pull: train a new one. Enter it with
**Publish and compete**, or from a shell with `uv run publish --enter`.

## Rating

The board ranks a rating from the pulling bench: one duck, its string running across the pit to a
winch. Over a 30-second run, the winch's pull ramps up by **0.25 N per second** to a top of
**7 N**, shaken by small jerks. A duck's score is the pull it was holding when it was dragged into
the pit; a duck still out at the end, standing or not, scores the top, 7 N. The rating is the mean
of five starts, in newtons. The higher rating wins.

For example, three starts held to the end and two dragged in at 4 N and 5 N rate **6.00 N**.

## The weekly cup

Every week, each player's latest entry is their duck in the cup: the ducks play in groups, then
the best go through to a knockout. Publishing on this challenge is entering the cup.

[How the workshop works, and the shell path →](../train-a-policy.md)
