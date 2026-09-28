# 2 m Roller Sprint

Skate 2 metres on flat ground. The lowest average time wins.

## Train

Open **Train my robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py roller-sprint-2m
```

Practice balance and forward propulsion, then increase speed without drifting
or spinning. The wheels are passive: your policy controls the 14 body joints.
Test several checkpoints: on this course some score well and their neighbours fall.

## Scoring

The Arena scans forward commands from **0.30 to 2.00 m/s** in 0.10 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall or timeout counts as **40 seconds**. Aim for five finishes before
chasing a faster time.

[How the workshop works, and the shell path →](../train-a-policy.md)
