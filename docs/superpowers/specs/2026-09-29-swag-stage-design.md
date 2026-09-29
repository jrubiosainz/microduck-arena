# The swag stage — design

Date: 2026-09-29. Status: approved section by section in conversation on
2026-09-29, awaiting the owner's review of this document.

Amends `2026-09-15-voting-and-swag-contest-design.md`: the Swag Contest no longer
races the sprint's lane. Voting, ballots, the voted board and points stand as
written there.

## Goal

The Swag Contest becomes a **performance on a stage**. An author trains a policy,
writes a command timeline (when to sit, when to stand, where to look), and the
Arena plays that timeline for at most 20 seconds on an open floor. Voters judge
the performance. Nothing is timed, nothing has to be finished, a fall is part of
the show.

## Why the old swag is replaced

The swag was the race format reused: a 2 m lane at a constant 0.25 m/s command,
and an entry that did not finish never reached a ballot. A routine therefore had
to time itself. Ten training runs of a self-timed "Sit & stand" failed on
2026-09-28/29, for reasons that do not go away with more reward tuning:

- A policy cannot keep a periodic clock in its own joints: under PPO's action
  noise the phase diffuses by radians within seconds.
- Every deterministic policy found a standing equilibrium under the sit command.
  The sits and rises that training reported happened only with exploration noise.
  The one "rise" found was a lean-back at 57–58° with the feet in the air.
- Meanwhile, the published sitstand policies (`tfrere/microduck-move-base-sitstand`
  `policy.onnx`, `pollen-robotics/microduck-policies` `alpha_sitstand.onnx`; the
  sit flag is `twist.vx`, 1 = sit) sit in about 1 s and rise upright (≤ 7°) in
  under 0.5 s in the swag training env, with BAM and the 10/20 solver.

The robot can perform; it cannot also be its own conductor. So the Arena conducts:
the author's timeline gives the command at every step, and the policy only has to
follow it.

## Owner's rules

- Time does not matter. A performance lasts at most 20 s, on a stage.
- Start from a sit & stand configuration that works, and let authors make their
  own moves on top of it. Simplify the training env where that helps.
- The robot model (MJCF, masses, BAM actuators) is the same in every challenge.
  The collision set may differ per task.
- A challenge's training physics is the Arena's: solver 10/20, timestep 0.005 s,
  BAM. Every randomised range contains the value the Arena simulates.
- Intermediate checkpoints are judged on the Arena and in the training env, from
  standing and seated starts, not only on training curves. Always deterministic
  (ONNX): a policy can succeed only through its exploration noise.

## 1. The stage event

### The manifest

`arena/events/swag-contest.toml` keeps its identity, its `showcase` category and its
`[vote]` section. Its course, command and seeds change:

```toml
id           = "swag-contest"
order        = 15
title        = "Swag Contest"
category     = "showcase"
rig          = "legs"
time_limit_s = 20.0
metric       = "votes"
seeds        = [1]

[course]
kind = "stage"

# What an entry without a timeline plays for the whole 20 s: standing still.
[command]
vel  = [0.0, 0.0, 0.0]
head = [0.0, 0.0, 0.0, 0.0]
body = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

[start]
keyframe = "STAND"
settle_s = 0.5

[start.perturbation]
joint_rad = 0.01
yaw_deg   = 2.0

# On a stage this does not end the run. It is what the CLI's summary calls a fall.
[termination]
fall_gravity_z = -0.5
fall_hold_s    = 0.3

[vote]
ballot_min  = 2
ballot_max  = 4
window_days = 7
per_day     = 20
```

There is no `[sweep]`. `seeds = [1]` because a performance is played once.

### `arena/manifest.py`

- `COURSE_KINDS = ("lane", "stage")`.
- A lane's `[course]` is read as today, into `Course`. A stage's `[course]` holds
  `kind` and nothing else; any other key is refused. It is read into a new frozen
  dataclass `Stage` with that one field. `Manifest.course` is `Course | Stage`.
- `[sweep]` is required for a lane and refused for a stage. `Manifest.sweep` is
  `Sweep | None`.
- A stage declares exactly one seed; more is refused.
- On a stage, `time_limit_s` is the longest performance: a timeline's `duration_s`
  may not exceed it.
- Lane events load exactly as before.

### `arena/course.py`

A stage compiles the same robot as every legs event (`robot_allcollisions.xml`,
BAM motors, implicitfast, 10/20, timestep 0.005 s) on the same static `course`
body, holding the floor plane only: no walls, no tilt. The STAND keyframe spawns
the trunk at `SPAWN_HEIGHT_M` on the flat floor. The lane's build is unchanged.

### `arena/runner.py`

A stage path, `run_stage(manifest, policy, timeline, seed, model=None) -> RunOutcome`,
beside the lane's `run_once`, which does not change.

- Reset, perturbation, servos and settle are the lane's, shared through one helper
  extracted from `run_once` without changing its arithmetic. The golden run and the
  determinism tests hold that.
- The untimed settle commands `timeline.command_at(0.0)`, the first keyframe.
- Then `round(timeline.duration_s / CTRL_DT)` control steps. Step `k` (from 0)
  observes `timeline.command_at(k * CTRL_DT)`.
- No finish line, no fall stop: a performance plays to the end, falls included.
- Only a non-finite `qpos` ends it early, as on a lane: status `"fall"`, `time_s`
  `None`. A solver explosion is not a performance, and a trace cannot hold it.
- Played to the end: status `"finish"`, `time_s` = the duration played,
  `progress_m` = `start_progress_m` = 0.0 (a stage has no line).

`RUNNER_VERSION` stays 4 and the golden run stays as it is: no lane measurement
changes. The swag's own records change meaning; what happens to the entries already
on the Space is decided at the phase B deploy (see *Phases*).

### `arena/evaluate.py`

`evaluate(manifest, policy, timeline=None)`:

- A lane is scored exactly as today. A timeline passed for a lane raises
  `ValueError`: races play the event's command.
- A stage plays `timeline`, or, when there is none, the event's `[command]` for
  `time_limit_s`. One run, at `manifest.seeds[0]`, no sweep.
- The stage's `Evaluation`: `per_seed` holds that one run; `seeds_finished` is 1
  when it played to the end; `score` is the duration played (through the existing
  `votes` metric, which is `mean_finish_time`). The score is informative: the board
  ranks on votes. `scan` is empty, `command_vx` is 0.0, the trace seed is the run's.
- `evaluate_at` (a trial at one pinned speed) stays lane-only.

Validity: none beyond playing. Every entry that plays to the end reaches voters.
The pool and the podium already require `seeds_finished > 0`
(`arena/votes.py`, `arena/points.py`); a played performance has it, so neither
file changes.

### The CLI

```
arena score policy.onnx --event swag-contest [--timeline timeline.json] [--store DIR]
```

On a stage it plays locally and prints a summary instead of the sweep's table:

```
stage: 20.00 s played, timeline.json (9 keyframes)
fell: no
seated 8.4 s · standing 10.9 s
```

- Without `--timeline`, the first line says the event's default command was played.
- `fell` applies the event's `[termination]` rule to the trace: `at 7.42 s` for the
  first time the trunk stays tipped past it for `fall_hold_s`, otherwise `no`.
- Seated: trunk height below 0.07 m. Standing: trunk height above 0.10 m and tilt
  at most 20°. Each is the time the trace spends in that state.
- `--timeline` on a lane event is refused. A malformed timeline prints the
  refusal and exits 1, as a malformed manifest does.
- `--store` records a stage run like any other.

### The event summary served to the page — an exception to "do not touch `arena/web`"

`GET /api/events` serialises every event through `event_summary`
(`arena/web/routes_read.py`), which reads the lane's `length_m`, `width_m`,
`slope_deg`, its walls and its sweep. With a stage swag it would fail for the whole
programme, and the read-route tests with it. Phase A therefore changes that one
function: a stage's summary leaves out the lane geometry and the sweep fields; a
lane's is unchanged. `routes_read.py` is not modified by plan 4's branch, so this
cannot conflict with it. Nothing else under `arena/web` changes.

One known gap stays on the phase A branch: `_speed` in `routes_submit.py`, which
plan 4 rewrites, reads the sweep. A hand-made submission to the swag carrying a
speed would get a 500 there until phase B. No test and no page sends one.

## 2. `timeline.json`

### Where it lives

At the root of the entry's Hub repo, beside `policy.onnx` and `manifest.json`,
read at the same pinned revision. The robot daemon's `manifest.json` schema is not
touched. A race ignores the file.

### Format, version 1

```json
{
  "timeline_version": 1,
  "duration_s": 20.0,
  "keyframes": [
    {"t": 0.0, "twist": [0, 0, 0]},
    {"t": 2.0, "twist": [1, 0, 0], "head": [0, 0, 0.5, 0]},
    {"t": 4.5, "twist": [1, 0, 0], "head": [0, 0, -0.5, 0]}
  ]
}
```

- The top level has exactly `timeline_version`, `duration_s` and `keyframes`.
  Unknown keys are refused.
- `timeline_version` is 1.
- `duration_s` is a number, above 0 and at most the event's `time_limit_s` (20 s).
- `keyframes` holds 1 to 1000 keyframes. Each has `t` and, optionally, `twist`
  (3 numbers), `head` (4) and `body` (6). Unknown keys are refused.
- **Every keyframe is the whole command.** A missing group is zeros for that
  keyframe; nothing carries over from the previous one.
- `t` starts at 0.0, strictly increases, and stays below `duration_s`.
- Every number is a JSON number (not `true` or `false`) and finite; every
  command value is within ±10.
- The command is piecewise constant: at time `t`, the last keyframe with
  `t_k ≤ t` holds. No interpolation.
- The 13 numbers go into the observation's command slot in the order
  twist (3), head (4), body (6), the same 61-D contract as every policy.
- The untimed settle plays the first keyframe.

### `arena/timeline.py`

- `TimelineError`.
- `Timeline`, frozen: `duration_s`, `times`, `commands` (tuples), and
  `command_at(t)` returning the 13 numbers.
- `load_timeline(path, max_duration_s) -> Timeline`. Each refusal names the
  keyframe index and the field at fault. Callers pass the event's `time_limit_s`,
  so the event stays the one source of the 20 s.
- `constant_timeline(command, duration_s) -> Timeline`: one keyframe at 0, for an
  entry without a timeline.

### Arena tests

- Manifest: a stage loads; a stage refuses lane keys in `[course]`, a `[sweep]`,
  and more than one seed; a lane without `[sweep]` is refused; lane events load as
  before. The sweep-width test skips stages.
- Timeline: one test per refusal above, each naming its keyframe and field;
  `command_at` at, just before and just after a keyframe's `t`; a missing group is
  zeros even when the previous keyframe had values; `constant_timeline`.
- Course: the stage compiles with a floor and no walls, the robot and the solver
  options identical to a lane's.
- Runner: a stage records exactly `round(duration_s / CTRL_DT)` frames; a policy
  that falls still plays the whole duration; a recording fake policy sees
  `command_at(k * CTRL_DT)` at step `k` and the first keyframe during the settle;
  two runs with the same seed are identical. The golden run is unchanged.
- Evaluate: a stage makes one run, with `seeds_finished` 1, the duration as score,
  an empty scan and `command_vx` 0.0; no timeline plays the event's command; a
  timeline for a lane raises `ValueError`.
- CLI: the stage summary's three lines, with and without a timeline; `--timeline`
  refused on a lane; a malformed timeline exits 1 with its refusal.
- `GET /api/events`: a stage's summary has no lane geometry and no sweep; a lane's
  is unchanged.

### What the format does not do

- It carries the 13 command numbers and nothing else, because that is what a
  policy reads (the 61-D observation shared with the robot daemon).
- The Arena validates the format, not its meaning. An author may send a clock or
  a random walk; for a showcase, that is fine.
- The real robot replays a timeline only once the daemon reads `timeline.json`.
  That is outside this design.

## 3. The `swag_contest` challenge (microduck-challenges)

### Where it starts

From `main` (7a668f1). The local branch `swag-sit-stand` stays as an archive of
the abandoned self-timed routine and is not merged; two of its tests (collisions
and solver against the Arena) are carried over.

### `env.py`

A complete copy of the flat variant of microduck_rl's
`tasks/microduck_sitstand_env_cfg.py` (task `Mjlab-SitStand-Flat-MicroDuck`, the
config behind `alpha_sitstand`), adapted the way the other challenges adapt their
sources:

- **Robot**: `MICRODUCK_STANDUP_ROBOT_CFG`, imported from microduck_rl as the
  source does. It is the walk robot's MJCF, masses and BAM actuators with the
  `robot_groundcontact.xml` collision set, which is the Arena's: the trunk must
  rest on the floor when seated.
- **Commands**, as the source:
  - the sit flag in `twist.vx` (`SitStandCommand`: 1 = sit, 0 = stand, held
    3.5–6.5 s, `sit_prob` 0.5, 2 s ramp), `vy` and yaw rate 0;
  - `head_pose`: 4 deltas from the default pose for neck_pitch, head_pitch,
    head_yaw and head_roll, resampled every 2–5 s, widening by curriculum to
    ±1.10, ±1.10, ±1.40, ±0.31 rad at iteration 2000;
  - body: 6 zeros.
- **Solver**: 10 iterations / 20 line-search iterations, the Arena's. The source
  used 30/50, which it calls a contact-NaN fix; `alpha_sitstand` sits and rises at
  10/20 in the swag env. `nconmax = 200` stays: it sizes a buffer, it is not
  physics. Timestep 0.005 s and decimation 4, as the Arena.
- **Terminations**, as the source: no fall termination (the stage has none
  either), `nan_state`, time out. Episodes last 12 s.
- **Starts**, as the source: half seated, half standing
  (`set_random_ground_state`).
- **Rewards**: the source's stack unchanged, with three of its weights as knobs
  (below).
- **Randomisation**, as the source. Every randomised range contains the value the
  Arena simulates: supply voltage 6.5–8.2 V (Arena 7.35 V), sag gain 0–0.2 (0.1),
  command delay 3–6 substeps (the same draw), BAM friction ×0.9–1.1 (×1), foot
  friction 0.7–1.3 (1.0), mass, CoM, armature and inertia around their nominal
  values. Pushes and sensor noise stay, as in every other challenge: they are
  disturbances, not a different robot, and the checks below run without them.
- **RL config**: the source's `MicroduckSitStandRlCfg`, with
  `experiment_name = "swag_contest"`.

### `challenge.toml`

```toml
event = "swag-contest"
task  = "Mjlab-SwagContest-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.head_reward]       # head_pose_tracking
label = "Follow the head moves"
value = 0.75
min   = 0.0
max   = 2.0

[params.stillness_reward]  # posture_stillness
label = "Hold still between moves"
value = 2.0
min   = 0.0
max   = 4.0

[params.upright_reward]    # upright_linear
label = "Stay upright"
value = 2.5
min   = 0.5
max   = 5.0
```

3000 iterations: the source's curricula (head range, rise speed, pushes) finish by
2500. The task id stays, so `tasks.py` does not change.

### `timeline.json`: the reference choreography

Pollen's 20 s performance, in the challenge folder. It is what the reference is
validated on, and what an author starts from.

| t (s) | twist | head (neck_pitch, head_pitch, head_yaw, head_roll) | Move |
|---|---|---|---|
| 0.0 | [0, 0, 0] | 0, 0, 0, 0 | stand |
| 2.0 | [1, 0, 0] | 0, 0, 0.5, 0 | sit, look left |
| 4.5 | [1, 0, 0] | 0, 0, −0.5, 0 | seated, look right |
| 7.0 | [0, 0, 0] | 0, 0, 0, 0 | stand |
| 9.0 | [0, 0, 0] | 0, 0.4, 0, 0 | nod |
| 11.0 | [1, 0, 0] | 0, 0, 0, 0 | sit |
| 15.0 | [0, 0, 0] | 0, 0, 0.5, 0 | stand, look left |
| 17.0 | [0, 0, 0] | 0, 0, −0.5, 0 | look right |
| 19.0 | [0, 0, 0] | 0, 0, 0, 0 | face the audience |

`duration_s` is 20.0. It stays inside what training saw: the flag is 0 or 1 and is
held at least 3.5 s after the first sit; head changes are at least 2 s apart; head
values stay within 40 % of the final curriculum range; `vy`, yaw rate and body are 0.

### `check.py`

`uv run --frozen --group workshop python -m microduck_challenges.swag_contest.check
policy.onnx [--timeline FILE]` plays the stage on the installed Arena
(`arena.evaluate` with the timeline, the folder's own by default) and applies the
acceptance rules. It prints one line per keyframe and exits 1 on any failure.

- No fall in the 20 s, by the event's `[termination]` rule.
- Each change of the flag to 1: trunk below 0.07 m within 1.5 s, and held until
  the flag changes again.
- The start, and each change of the flag to 0: trunk above 0.10 m and tilt at most
  20° within 1.5 s, and held until the flag changes again.
- Each head keyframe held 2 s or more: every head joint within 0.25 rad of the
  default pose plus the command, averaged over the last 0.5 s of the hold.

### Tests (`tests/test_challenges.py`)

- The `CHALLENGES` row for the swag maps `head_reward` → `head_pose_tracking`,
  `stillness_reward` → `posture_stillness`, `upright_reward` → `upright_linear`;
  the generic knob tests cover the rest.
- `test_the_robot_matches_the_events_rig` accepts the walk robot or the standup
  robot for a legs event. A new test shows the standup robot is the walk robot with
  other collisions: same bodies, masses, inertias, joints and actuator config.
- `test_the_swag_collides_like_the_arena`: the swag robot's collision geoms (names,
  types, sizes, friction, condim, contype/conaffinity) are the robot's geoms in the
  Arena's compiled swag stage.
- `test_the_swag_solves_contacts_like_the_arena`: iterations, line-search
  iterations and timestep equal the Arena's compiled swag stage.
- The swag does not end on a fall, as the stage does not.
- Command slots: the sit flag is `twist[0]`, `head_pose` has the 4 head deltas in
  the order above, body is zeros, the actor observation is 61 numbers.
- `timeline.json` loads with the Arena's `load_timeline` and the swag event's
  `time_limit_s` (the Arena from the `workshop` group).
- `timeline.json` stays inside the trained ranges, by the rules of the previous
  section.

### Training and acceptance

- Trained on HF Jobs: namespace Nico-robot, l4x1, 4096 envs, 3000 iterations,
  seed 1, `--hf-jobs --no-wandb --namespace Nico-robot`. The job uploads a snapshot
  of the local checkout, so nothing is pushed to train.
- Every checkpoint from 1000 on (one every 250 iterations) is exported to ONNX
  (`publish --run … --dry-run`) and judged **deterministically**, never through
  the training policy's noise:
  - on the Arena: `check.py` with the reference timeline, and a run without a
    timeline (standing still for 20 s, no fall);
  - in the training env, the same ONNX without pushes: 8 seated starts and 8
    standing starts, the flag toggled every 4 s. Each change is reached within
    1.5 s by the rules of `check.py`. This probe is a session tool, not shipped.
- Each checkpoint's results are recorded. The reference is the passing checkpoint
  with the smallest head error; if two tie, the earlier one.
- The reference is exported into the challenges checkout's `publish-swag-reference/`
  (gitignored) with `publish --run … --dry-run --slot sitstand --timeline
  src/microduck_challenges/swag_contest/timeline.json --twist-help '[sit flag: 1
  sit, 0 stand; unused; unused]'`. It is not published in phase A.

### `publish --timeline` (microduck_rl)

- A new `--timeline PATH` option: the file is staged as `timeline.json` beside
  `policy.onnx`, `manifest.json` and `README.md`. It is uploaded at the repo root
  in the same commit, or copied into `publish-<name>/` by `--dry-run`.
- `publish` refuses a file that is not valid JSON. The format is the Arena's to
  check (in the workshop and at submission, phase B), because microduck_rl does not
  depend on the Arena.
- `manifest.json` is unchanged. Without `--timeline`, nothing changes.
- The branch starts from `develop` (981a279, the commit the challenges lock
  resolves through `challenge-recipe-publishing`).

## 4. Phases

### Phase A: now, outside plan 4

Three branches, none pushed:

| Repo | Branch, worktree | Content |
|---|---|---|
| microduck-arena | `swag-stage` from `main` (6900972), `.claude/worktrees/swag-stage` | Sections 1 and 2: stage kind, `timeline.py`, stage runner and evaluation, CLI, the new `swag-contest.toml`, the `event_summary` exception |
| microduck-challenges | `swag-stage` from `main` (7a668f1), `.claude/worktrees/swag-stage` | Section 3's folder and tests, the training, the acceptance |
| microduck_rl | `publish-timeline` from `develop` (981a279), `.claude/worktrees/publish-timeline` | `publish --timeline` |

- The Arena branch stays unmerged: pushing Arena `main` ships the Space, and the
  live site cannot draw a stage yet.
- Order: the Arena first, because the challenge's tests and `check.py` need
  `arena.timeline` and the stage. The challenges worktree's venv gets the Arena
  worktree installed in editable mode
  (`uv pip install --no-config --python .venv/bin/python --no-deps -e
  ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/swag-stage`):
  the locked 0.3.1 wheel has no stage. The training job does not need the Arena and
  can start as soon as `env.py` and its tests are done. `publish --timeline` is
  independent.
- Arena tests: the whole Python suite stays green on the branch, the golden run
  included (`main` on 2026-09-29: 735 passed, the one `network` test deselected).
- Phase A ends with the three branches, the reference checkpoint's export in
  `publish-swag-reference/`, its `check.py` report, and every judged checkpoint's
  results.

Each of these needs the owner's yes, and none is part of phase A: pushing any of the
three branches; a 0.4.0 Arena wheel on `pollen-robotics/microduck-arena-wheels` and
the challenges relock onto it and onto the pushed `publish --timeline`; publishing
the reference.

When plan 4 merges, the Arena branch is rebased onto it. Expected conflicts are
small: `manifest.py` (plan 4's policy `kind` next to `COURSE_KINDS`),
`swag-contest.toml` (plan 4's `kind = "perpetual"`), and the fixture at the top of
`tests/test_manifest.py`.

### Phase B: after plan 4 merges (its own plan)

- `hub_fetch` reads `timeline.json` at the entry's pinned revision when the event
  is a stage, and validates it with `load_timeline`: a malformed file is refused
  with 400 and the reason; a missing one means the event's default command. Submit
  and `recover` pass it to `evaluate`.
- The site draws the stage (an open floor, no walls) and replays the 20 s on the
  race page and on ballots. The trial-speed picker and `_speed` leave stage events.
  The clip and the commentary get a stage's framing and wording.
- The workshop edits the timeline, checks it with `load_timeline`, and publishes it
  with `publish --timeline`.
- The swag guide (`docs/guides/challenges/swag-contest.md`) is rewritten for the
  stage.
- The swag entries already on the Space, raced on the lane, are re-run as stages or
  cleared. The owner decides at the deploy.
- The reference is published to `pollen-robotics/microduck-swag-contest-reference`
  and entered, after the owner's yes.

## Out of scope

- The robot daemon reading `timeline.json`.
- Interpolated keyframes, performances longer than 20 s, music.
- Scoring a performance's quality. Voters do that.

## Risks

- **10/20 in training.** The source moved to 30/50 against contact NaNs. The
  `nan_state` terminations are watched in the job's log. On the Arena a non-finite
  state ends the stage early, which keeps the entry off the ballots.
- **Checkpoint dependence.** Sprint, hill and roller showed large swings between
  neighbouring checkpoints. That is why every checkpoint from 1000 is judged.
- **Noise-only behaviour.** The old swag reported sits that only exploration noise
  produced. Judging is deterministic, on ONNX, on the Arena and in the training env.
