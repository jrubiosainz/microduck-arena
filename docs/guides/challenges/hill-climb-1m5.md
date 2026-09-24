# 1.5 m Hill Climb

Walk 1.5 metres up an **8° slope**. The lowest average time wins.

## Train

Start from `Mjlab-Velocity-Flat-MicroDuck`, then adapt its training terrain to
include inclines. Begin with gentle slopes and work up to 8°. Practice forward
progress without slipping or tipping backwards.

There is no ready-made Arena hill training preset. A flat-ground policy needs
testing on the actual slope.

## Scoring

The Arena scans forward commands from **0.15 to 1.00 m/s** in 0.05 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall or timeout counts as **60 seconds**. Distance is measured along the slope.

[Setup, export and submission →](../train-a-policy.md)
