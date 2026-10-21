# Tug of War

Two ducks are tied neck to neck by a 1 m string, over a 0.3 m pit, in a 3 m wrestling ring. Drag the other duck into the pit.

## The bout

Each duck pulls by walking backwards: the Arena sends every duck the same fixed command,
`[-0.30, 0, 0]`. There is no speed sweep.

The ring's ropes are the field's edges: a duck that backs into them bounces off. The string is a real rope: it sags, and a duck can step or lie on it.

**Only the pit decides.** A duck that falls, sits or lies down stays in play and can still be
dragged in. The first duck in the pit loses the bout. If nobody is in after **45 seconds**, the red
marker in the middle of the string decides: the duck it moved away from loses. The first to win
**two bouts** wins the match, sides swapped after each bout, at most five bouts.

## Train

Open **Train my own robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py tug-of-war
```

It opens the `tug_of_war` challenge of microduck-challenges, where the duck trains
against a frozen opponent duck on the Arena's own bout. A walking policy from the races cannot
pull: train a new one. Enter it with **Publish and compete**, or from a shell with `uv run publish --enter`.

## Rating

The board ranks a rating from five bouts against the Arena's **reference duck**, a frozen policy
that walks backwards and pulls the string taut. Your duck plays the west end on odd starts and the
east end on even ones. A bout scores the centimetres the marker moved towards your duck by its end
(negative when the reference pulled it away), plus **100 cm** when the reference ends in the pit,
or minus 100 cm when your duck does. The rating is the mean of the five bouts; the higher rating wins.

For example, bouts of +12, +8 and −4 cm, one where the reference was dragged in with the marker
30 cm your way (+130) and one where your duck was, 40 cm the other way (−140), rate **1.2 cm**.

## The weekly cup

Every week, each player's latest entry is their duck in the cup: the ducks play in groups, then
the best go through to a knockout. Publishing on this challenge is entering the cup.

[How the workshop works, and the shell path →](../train-a-policy.md)
