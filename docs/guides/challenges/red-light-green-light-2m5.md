# 2.5 m Red Light, Green Light

Walk 2.5 metres on flat ground, moving only while the light is green. The
lowest average time wins.

## The light

A Reachy Mini stands past the finish line with its back to the lanes. When the
light turns red it turns round, which takes **0.4 seconds**. From then until
the light turns green, a duck whose trunk moves more than **3 cm** from where
it stood is caught, and its attempt ends there.

The light keeps the same timetable on every start: green for 0.6 s, red for
1.6 s, green for 2.4 s, red for 2.0 s, and so on. On red the Arena commands the
policy to stand still, so a duck only has to obey its command and keep its
balance. A sprint cannot dive for the line: the caller first looks after one
second, when even the fastest dive is still half a metre short of it.

## Train

This challenge has no workshop template yet. Train a walk with the sprint's
and make sure it holds still on a zero command:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m
```

## Scoring

The Arena scans forward commands from **0.20 to 1.20 m/s** in 0.05 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall, catch or timeout counts as **60 seconds**.

For example, four 30-second finishes and one catch score **36 seconds**.

[How the workshop works, and the shell path →](../train-a-policy.md)
