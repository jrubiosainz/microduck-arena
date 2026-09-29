# MicroDuck Got a Talent

Create a distinctive walking style. Other players choose their favourite duck.

## Train

Open **Train my own robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py swag-contest
```

Then experiment with step rhythm, body motion or head movement. Keep the gait
reliable while adding personality.

Every entry receives a constant **0.25 m/s forward command**; all other commands
are zero. Your policy must produce its style without a custom command sequence.

## Judging

Finish the **2 m flat course within 50 seconds** on at least one of five starts
to qualify. The most votes over the **last seven days** wins; tied entries favour
the earlier publication. Speed does not decide the ranking.

Your **latest qualifying entry** represents you. Votes on an older entry do
not transfer to its replacement.

Ballots offer two to four anonymous performances, excluding your own, watched
one at a time on stage. You can cast
**20 votes per UTC day**. Each accepted vote earns **2 player points** until it
leaves the seven-day window.

[How the workshop works, and the shell path →](../train-a-policy.md)
