# Arena help

General setup lives in `index.md` and `train-a-policy.md`.
Player points live in `points.md`, linked from profiles and publication results.

Each challenge owns its training and scoring copy in `challenges/<event-id>.md`,
served at `#/e/<event-id>/guide`. Link to it from that challenge only; do not
catalogue challenges or repeat their rules in general help. Planned challenges
link from their own card. Event status and return navigation use the event API.

Keep every page short: the objective, how to start, and how the result is judged.
Challenge guides may link to shared setup, but not to other challenge guides.

Facts were checked against the Arena manifests, evaluator, points and votes code
and the upstream Microduck RL registry/exporter on 2026-09-23. Training advice is
suggested practice, not a measured winning recipe. No GPU training was run.

The Markdown is bundled with the frontend. Recheck copy when the event rules,
points schedule or training CLI change.
