# 2 m Sprint

Walk 2 metres on flat ground. The lowest average time wins.

## Train

Start with `Mjlab-Velocity-Flat-MicroDuck` in Microduck RL.
Get a stable walk first, then increase speed. Practice small changes in starting
pose and heading; aim to finish all five attempts.

## Scoring

The Arena scans forward commands from **0.20 to 1.20 m/s** in 0.05 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall or timeout counts as **50 seconds**.

For example, four 10-second finishes and one fall score **18 seconds**.
Five 12-second finishes score **12 seconds** and rank higher.

[Setup, export and submission →](../train-a-policy.md)
