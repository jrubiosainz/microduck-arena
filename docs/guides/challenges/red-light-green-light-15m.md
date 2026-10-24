# 15 m Red Light, Green Light

Walk 15 metres on flat ground, moving only while the light is green. The
lowest average time wins.

## The light

A giant Reachy Mini stands past the finish line with its back to the lanes.
When the light turns red it turns round, which takes **0.4 seconds**. From then
until the light turns green, a duck whose trunk moves more than **3 cm** from
where it stood is caught, and its attempt ends there.

The light keeps the same timetable on every start: green for 0.6 s, red for
1.6 s, green for 2.4 s, red for 2.0 s, and so on, green a little over half the
time. On red the Arena commands the policy to stand still, so a duck only has
to obey its command and keep its balance. A duck that crosses in about a
minute stops for some fifteen reds on the way, and the first comes a second
after the start: a duck that bolts off the line has to stop as hard as it
started.

## The lane

Nobody walks fifteen metres straight unaided. On green the Arena steers the
duck through its command: the turn rate aims it at the middle of the lane half
a metre ahead, at no more than **1 rad/s**. A walk that follows a turn command
holds its lane; one that ignores it drifts into a wall.

## Train

This challenge has no workshop template yet. Train a walk with the sprint's,
and make sure it holds still on a zero command and turns on a turn command:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m
```

## Scoring

The Arena scans forward commands from **0.20 to 1.20 m/s** in 0.05 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall, catch or timeout counts as **150 seconds**.

For example, four 65-second finishes and one catch score **82 seconds**.

[How the workshop works, and the shell path →](../train-a-policy.md)
