# 2 m Roller Sprint

Skate 2 metres on flat ground. The lowest average time wins.

## Train

Use `Mjlab-Velocity-Flat-MicroDuck-Rollers` in Microduck RL.
Practice balance and forward propulsion, then increase speed without drifting
or spinning. The wheels are passive: your policy controls the 14 body joints.

## Scoring

The Arena scans forward commands from **0.30 to 2.00 m/s** in 0.10 steps.
It tests three shortlisted speeds over five starts and keeps the best average.
Each fall or timeout counts as **40 seconds**. Aim for five finishes before
chasing a faster time.

[Setup, export and submission →](../train-a-policy.md)
