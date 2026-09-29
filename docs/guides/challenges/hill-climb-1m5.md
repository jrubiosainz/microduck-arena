# 1.5 m Hill Climb

Walk 1.5 metres up an **8° slope**. The lowest average time wins.

## Train

Open **Train my own robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py hill-climb-1m5
```

Its training already walks on generated slopes up to 8°. Practice forward
progress without slipping or tipping backwards.

## Scoring

The Arena scans forward commands from **0.15 to 1.00 m/s** in 0.05 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall or timeout counts as **60 seconds**. Distance is measured along the slope.

[How the workshop works, and the shell path →](../train-a-policy.md)
