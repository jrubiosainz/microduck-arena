# Microduck Arena — design

A Hugging Face Space where anyone publishes a Microduck policy and races it, on a
verified clock, against every other policy published.

Date: 2026-09-03

## The idea

`pollen-robotics/microduck-simulator` is a sandbox: you open it, you drive a duck with the
arrow keys, real trained policies run in your tab. It is deliberately stateless — MuJoCo
compiled to WebAssembly, `onnxruntime-web` at 50 Hz, no server, nothing stored.

The Arena is the competitive half of that. You train a policy on your side, publish it, and
enter it in an event. The Arena runs it on a fixed course, times it, and puts it on a
leaderboard beside everyone else's — then replays the podium racing side by side.

One event ships first, a 2 m sprint. Events are data, so the roller race and the hill climb
that follow it are a manifest and a course, not a new program.

### What makes this possible

Every Microduck policy shares one interface. From `microduck/policies/README.md` and the
sandbox's own core:

- Observation, 61-D:
  `[base_ang_vel(3), projected_gravity(3), joint_pos(14), joint_vel(14), last_action(14), command(13)]`
- Action, 14-D: joint position targets
- Command, 13-D: `[vx, vy, wz, head(4), body(6)]` (`app/src/game/constants.js:40`,
  `app/src/game/game.js:392`)
- Loop: `TIMESTEP = 0.005`, `DECIMATION = 4` → policy at 50 Hz
- Reference speeds: `VEL_FWD = 0.25` m/s (legs), `RVEL_FWD = 0.6` m/s (rollers)

Because that interface is uniform, an entry can be a single `.onnx` file and the Arena can
run anybody's policy without knowing anything about how it was trained.

## Decisions

These were settled during design. Each one closed off alternatives worth recording.

| Decision | Why, and what it rules out |
| --- | --- |
| **Official runs execute server-side** | A time reported by a browser is a number in devtools. The backend runs the episode with one build, one seed list, one course, and computes the time itself. Rules out the cheap static-Space option, and buys a board that means something. |
| **Entries accept a repo id *or* an upload** | Pointing at a Hub model repo is the blessed path: attribution and versioning are free, weights stay the author's, the policy stays downloadable onto a real duck. Upload is the fallback for people without Hub habits. |
| **Hugging Face OAuth to submit** | Native to Spaces, no accounts of ours, real usernames on the board, and rate-limiting that means something. Anonymous visitors can watch and browse; submitting needs sign-in. **But OAuth only exists inside a Space**, so it cannot be the only identity path: running locally, an `ARENA_DEV_USER` environment variable stands in for a signed-in user, and OAuth is used only when the Space provides it. The submit path must therefore not assume an OAuth session exists. |
| **The harness owns the command** | No user code runs server-side: the rig builds the 13-D command itself, so an entry is exactly one `.onnx` and today's `alpha_walking` can race on day one. Rules out steering and obstacle courses in v1 — the events named so far are all straight lines. **Superseded in part:** the command's *shape* is still the harness's, but its forward speed is no longer one pinned number. See *The speed sweep*. |
| **The score is the best of a wide speed sweep** | A single pinned `vx` measures how faithfully a policy tracks THAT speed, which is not the same question as which policy is faster — and "which is faster" is what a race is. The event declares a range; the harness tries all of it and keeps each policy's best. Costs ~3 s of CPU per entry instead of ~0.7 s, which is what pushes a deployed Space towards a queue. See *The speed sweep*. |
| **The board is a mean over five seeds** | One run is a coin toss. Five perturbed starts, DNF counted at the time limit. Only affordable because a run is cheap; see *Timing probe*. |
| **A published policy is downloadable** | The board's value is that an entry can be checked. A time nobody can reproduce is a claim; a time whose weights you can download, race, and get the same number from is a result — and it makes the platform a place to learn from other people's policies rather than only to be beaten by them. So `submit` keeps the `.onnx`, content-addressed by the checksum the record already carries. **This changes what Publish means**, from "put a time on the board" to "put a time on the board and share the weights", so the page says so next to the button, and `try` remains the path that shares nothing. Rules out entering a policy you are not willing to hand over — deliberately: that is what the trial button is for. |
| **The dataset repo is the database** | Append-only, immutable, one file per run: no locking, no contention, durable because it is a git repo. Rules out SQLite on paid persistent storage (a restart can wipe a leaderboard) and a managed Postgres (a second system and a bill for hundreds of rows). |
| **Everything starts PRIVATE** | The Space and the dataset repo are both private until decided otherwise. An earlier draft of this spec argued for a public run log as an open-benchmark feature; that is deferred, not adopted. The reasoning is one-way: opening a private dataset later is a flag, while un-publishing one that people have already submitted to is not. Nothing about the design changes with visibility — the same append-only log, the same derived board. |
| **It must run locally** | The engine and the web layer both have to work on a developer machine with no Hugging Face account, no OAuth app and no network. Deployment is a later, separate step. This rules out any design where identity or storage is only reachable through a live Space. |
| **A new Space, not an evolution of the sandbox** | The sandbox has 356 likes and real traffic. It stays static and playable; an Arena backend bug can never break it. |
| **Events are declarative manifests** | Generality lands exactly where the four named events differ — course, command, rig, termination, metric — and nowhere else. |

## Architecture

One Docker Space, `pollen-robotics/microduck-arena`, plus one dataset repo.

```
browser                    Space (FastAPI)                 HF Hub
--------                   ---------------                 ------
event page  ──GET────────▶ leaderboard index
                             ▲ rebuilt at boot ────────────  dataset repo
replay      ──GET────────▶ trace bytes  ◀───────────────────  (runs, traces)
submit      ──POST───────▶ intake ─▶ queue ─▶ runner
                                              │
                                              └─ model fetch ◀ model repo
sign in     ──OAuth──────▶ HF OAuth
```

### Components

Each is a module with one job, usable and testable without the others.

| Component | Responsibility | Depends on |
| --- | --- | --- |
| `events/` | Event manifests (TOML) + loader/validator | — |
| `course.py` | Build an MJCF for a manifest's `[course]` (lane, walls, slope) | manifest |
| `runner.py` | Run one policy on one event at one seed → outcome + trace | manifest, course, mujoco, onnxruntime |
| `evaluate.py` | Run all seeds, apply the metric, produce a scored entry | runner |
| `intake.py` | Validate an entry: resolve source, check shape, enforce caps | huggingface_hub, onnxruntime |
| `store.py` | Append a run to the dataset repo; read runs back | huggingface_hub |
| `index.py` | In-memory leaderboard: rank, one-row-per-entrant, DNF handling | store |
| `api.py` | REST + OAuth + static frontend | all of the above |
| `app/` | Vite frontend: event page, leaderboard, replay viewer, submit | api |

The runner is the piece worth keeping ruthlessly narrow: *one policy, one event, one seed,
in, outcome out*. No queue, no storage, no HTTP. That is what makes the golden-run and
determinism tests possible.

## The event manifest

The runner never knows which event it is running.

```toml
id           = "sprint-2m"
title        = "2 m Sprint"
rig          = "legs"              # legs | rollers
time_limit_s = 50.0
metric       = "mean_finish_time"  # lower is better
seeds        = [1, 2, 3, 4, 5]

[course]
kind          = "lane"
length_m      = 2.0                # ~18.5 s at the walker's measured speed
width_m       = 0.8
wall_height_m = 0.15
slope_deg     = 0.0

[command]                          # pinned for the whole run, all 13 slots
vel  = [0.25, 0.0, 0.0]            # VEL_FWD, straight ahead
head = [0.0, 0.0, 0.0, 0.0]
body = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

[start]
keyframe     = "STAND"
settle_s     = 0.5                 # policy runs, clock stopped
perturbation = { joint_rad = 0.01, yaw_deg = 2.0 }

[termination]
fall_gravity_z = -0.5              # projected gravity; the sandbox's tipped criterion
fall_hold_s    = 0.3
```

`rig` selects the MJCF and kinematics (`robot_allcollisions.xml` / `..._rollers.xml`),
vendored from the sandbox.

**Growth path, without runner changes:**

- Roller race: `rig = "rollers"`, `vel = [0.6, 0, 0]`
- Hill climb: `slope_deg = 8`
- High jump: needs a new `metric` and a different `[command]` shape. This is the event that
  tests whether the manifest is honest, and it is cheap to find out.

### Calibration: what the reference walker actually does

Measured on the built engine, not assumed. Course lengths and time limits are set from
these numbers, and anyone adding an event should re-measure rather than reason from the
commanded velocity.

| Commanded `vx` | Achieved speed | Ratio |
| --- | --- | --- |
| 0.10 | ~0 (1 mm in 20 s) | — |
| 0.15 | ~0 | — |
| 0.20 | ~0 (5 mm in 20 s) | — |
| 0.25 | 0.110 m/s | 0.44 |
| 0.35 | 0.151 m/s | 0.43 |
| 0.50 | falls at 6.5 s | — |

Two findings that shape every event:

**Velocity tracking is about 44%, not 100%.** `alpha_walking` commanded 0.25 m/s travels at
0.110 m/s. It walks dead straight while doing it (6 mm of lateral drift over 2.2 m) and
stays upright (trunk z 0.115–0.122 m), so this is the policy's honest behaviour, not a
harness artifact. The original 5 m course was sized from the commanded speed and would have
taken the reference 45.6 s — over its own 45 s limit, making the opening record a DNF.

**There is a deadband below roughly 0.2 m/s.** Commanded 0.10–0.20, the duck stands still
rather than walking slowly. **A pinned command below the deadband would score every entry a
DNF**, so an event's `[command]` must sit above it. This is the single most important
constraint on adding an event, and it is invisible from the policy's interface.

### The speed sweep

**Measured, and the reason the pinned command had to go.** `alpha_walking` on `sprint-2m`,
one seed per commanded speed:

| Commanded `vx` | Result |
| --- | --- |
| 0.25 (the event's original pin) | 18.46 s |
| 0.30 | 15.20 s |
| 0.35 | 13.24 s |
| **0.40** | **11.70 s** |
| 0.45 | stalls, DNF |
| 0.50 and above | falls |

The board was reporting 18.46 s for a policy capable of 11.70 s — 37% slow — and the shape
is a peak with a cliff just past it, at a location that differs per policy. A pinned command
therefore ranks *command-tracking fidelity at one arbitrary speed*, and a policy tuned for a
different speed loses to a worse one that happens to like 0.25. No amount of picking a better
pin fixes this, because there is no single pin that is right for every entry.

So the event declares the sweep and the harness runs it, in two stages:

1. **Scan** every declared speed on ONE seed. Cheap and broad: 21 speeds from 0.20 to
   1.20 m/s on `sprint-2m`, a ceiling well above anything measured, so a genuinely faster
   policy has room to show it. Failures terminate early, which is why a wide range is nearly
   free — most of the top half is a fall inside a second.
2. **Score** a shortlist of those speeds over EVERY seed, and keep the best mean. One seed is
   one coin toss, so no speed reaches the board on the strength of a single lucky run.

The shortlist is the scan's fastest finishers, **topped up with the speeds that got
furthest without finishing**. That top-up is not a nicety. Measured on `hill-climb-1m5`, the
reference walker finished exactly 1 of 18 scanned speeds, and that one was a fluke it
repeated on 1 seed in 5. A shortlist of finishers alone would have scored the entry on the
fluke and never tried the speeds that got nearly as far. The seed budget for those slots is
already paid for; leaving them empty buys nothing.

Consequences, stated plainly:

- **A recorded time changed meaning, so `RUNNER_VERSION` went to 2.** The index drops v1 runs
  rather than ranking them against v2 numbers. This is its first real use. Every run recorded
  before this change has left the board.
- **The declared `[command]` `vel[0]` is no longer what anything is scored at.** It survives
  as the event's nominal speed and as the `2 × nominal` floor for a sweep ceiling; the score
  comes from whatever speed the sweep found. The leaderboard shows that speed per row,
  because two rows with similar times did not necessarily do the same thing.
- **The *Timing probe* conclusion is revised.** 0.73 s per entry made synchronous submission
  obviously safe. An entry is now ~3.2 s of wall clock locally (33 runs, measured end-to-end
  over HTTP; `/api/health` stays at 3–6 ms throughout, so the threadpool offload still
  holds). That is fine locally and fine for one person, but on a 2-vCPU Space it is close
  enough to the edge that the deployment step should assume a queue rather than discover it.

**A time limit should stay well above the expected finish.** Scoring counts a DNF at
`time_limit_s`, so the limit sets how hard flakiness is punished. At 2 m the reference
finishes in ~18.5 s against a 50 s limit, making a DNF cost about 2.7× a clean run — the
proportional penalty the scoring design depends on. A limit close to the expected time would
quietly flatten that.

## The run

1. Compile the course MJCF for the manifest; load the policy into an onnxruntime session.
2. Reset to the `STAND` keyframe. Apply the seed's perturbation (±0.01 rad per joint,
   ±2° yaw), drawn from a generator seeded by `(event_id, seed)` so it is reproducible.
3. Settle for `settle_s` with the policy running and the clock stopped. Nobody is timed on
   standing up.
4. Step the loop: build the 61-D observation, run the policy, apply 14 position targets,
   step physics 4 × 0.005 s. Command held at the manifest's pinned value throughout.
5. Stop on one of:
   - **finish** — trunk x crosses `length_m`; time recorded
   - **fall** — projected gravity z rises above `fall_gravity_z` for `fall_hold_s`
     (upright is ≈ −1.0, so `−0.5` means "half tipped"; the sandbox uses the same signal at
     `game.js:941`)
   - **timeout** — `time_limit_s` elapsed

   **Fall is judged before finish.** Reaching the fall condition means the robot has already
   been tipped for the full `fall_hold_s`, so a step where both fire is a robot that was
   collapsing and slid across the line — not a winner. A sprinter who falls *past* the tape is
   unaffected: it has no accumulated tipped time at the moment it crosses.
6. Return the outcome and the pose trace.

The start line is `x = 0`, the duck's trunk x at the end of settling; the finish is
`x = length_m`. The clock starts at the first stepped frame after settling.

A finishing sprint is ~1000 policy steps (20 s at 50 Hz); the time limit caps a run at 2250.

### The walls do the refereeing

With `wz` pinned to 0, a policy that pulls to one side drifts into a wall and scrubs speed.
That is the penalty. No "left the lane" rule, no judgement call: straightness becomes part
of the time rather than a separate criterion, which is simpler and truer to a race.

### Scoring

Score = **mean finish time over the five seeds, each DNF counted as `time_limit_s`**.

A policy that is brilliant four times and falls once ranks below a steady one. Flakiness
costs proportionally instead of hiding behind a best-of. The board shows `time · 5/5
finished`; the row expands to per-seed times.

**Ties** break by seeds finished (more is better), then by earliest submission — so the
first policy to reach a time keeps the higher rank.

**How hard one DNF actually bites**, at five seeds and a 50 s limit against the reference's
18.216 s: a single DNF adds (50 − 18) / 5 ≈ 6.4 s to the mean, about a 35% penalty. So a
flaky policy has to be roughly 1.8× faster than the reference — finishing near 10 s — before
one failure in five is worth it. Fast-but-unreliable is punished without being disqualified,
which is the intended balance.

### Replay artifact

Per run, the trace of the **median-finishing seed**: trunk position (3) + quaternion (4) +
14 joint angles, float16 at 50 Hz. ~42 KB for a 20 s sprint (1000 frames × 21 × 2 bytes).

Median, not best — a lane shows typical behaviour, and every entry's replay is selected the
same way.

Precisely: of the seeds that finished, take the one whose time is the lower median (for an
even count, the faster of the middle two). If no seed finished, store seed 1's trace, so
even a DNF entry is watchable and its failure visible.

## Submission

1. Sign in with Hugging Face.
2. Pick an event.
3. Give a repo id (`alice/microduck-sprinter`, optional filename) **or** upload an `.onnx`.
4. Name the entry.
5. It runs; the result and the replay come back.

### Intake validation

Before anything is queued, and worded the way `robotd` already words it at load — a policy
the Arena rejects would have been rejected by the robot, in the same sentence:

```
rejected: observation width is 51, expected 61
```

Checks: ≤ 4 MB; loads under onnxruntime; input `[1, 61]`; output `[1, 14]`; the repo exists
and is public, or the upload is a real ONNX file.

### Safety and abuse

- **Each eval runs in a subprocess with a hard wall-clock cap, killed on breach.**
  onnxruntime executes only its own kernels, so a submitted file is not a code-execution
  vector — but a pathological graph can burn CPU, and one bad entry must not wedge the web
  server. A breach is recorded as `invalid`.
- Signed-in only; 10 submissions per user per event per hour; small global concurrency cap.
- **The board ranks one run per entrant**, full history behind the row. Who counts as an
  entrant depends on who is looking, and both modes ship:

  | Mode | Entrant | Why |
  | --- | --- | --- |
  | `user` (public) | the person | Otherwise one determined competitor with 40 retrains owns the top ten. |
  | `policy` (local default) | the person *and* the policy name | Locally there is exactly one signed-in user, so ranking per person leaves a single row however many policies are tried — and the head-to-head replay, the whole reason to run it locally, has nothing to race. Retrying one policy still only improves its own row. |

  Selected by `ARENA_RANK_BY`, defaulting to `policy`; a deployed multi-user Space sets `user`.
  The ranking arithmetic is identical either way — only the deduplication key differs — so the
  two modes cannot disagree about the order of what they do show.

## Storage

Append-only. One immutable write per run, so simultaneous submissions never contend and no
locking is needed.

```
runs/<event_id>/<run_id>.json     entry, per-seed times, score, provenance
traces/<run_id>.npz               median-seed replay, float16 (no event_id: run_id is
                                  globally unique, and the route is /api/runs/{run_id}/trace)
models/<sha256>.onnx              uploads only; content-addressed, so a re-submitted
                                  identical file costs nothing
index/<event_id>.parquet          nightly compaction, keeps boot fast
```

`run_id` is globally unique across events (a ULID), so `GET /api/runs/{run_id}` needs no
event in its path; the index holds the `run_id → event_id` mapping.

The leaderboard is a **derived view**: scanned into memory at boot, kept warm, updated on
each new run. A restart costs a re-scan and nothing else.

## Frontend

An event page (leaderboard + head-to-head lanes) and a submit dialog.

**The head-to-head viewer** opens on the current podium racing side by side in lanes, top 3
by default, with a checkbox per leaderboard row to add or swap any entry in. After your own
submission finishes you land in a lane next to the record holder.

It reuses the sandbox's ghost rig, pointed at stored traces instead of live WebRTC peers.

**The bundle is much lighter than the sandbox's**: replaying a trace needs the three.js rig
built from `kinematics.json` and nothing else — **no MuJoCo WASM, no onnxruntime-web**.
Physics only ever runs server-side.

### REST API

| Route | Purpose |
| --- | --- |
| `GET /api/events` | List events with manifest summaries |
| `GET /api/events/{id}/leaderboard` | Ranked entries, one row per entrant |
| `GET /api/runs/{run_id}` | One run: per-seed detail, provenance |
| `GET /api/runs/{run_id}/trace` | Replay bytes |
| `POST /api/events/{id}/submit` | Validate, run, return result |
| `GET /api/me` | Signed-in user, or anonymous |

## Two rigs, one policy contract

The roller rig is not a repaint of the walker. It is a different kinematic tree — 19 bodies
against 15, the four extras being passive wheels — and it swaps feet and soles for blades,
rims and tires. It drives the SAME 14 actuated joints, which is why one policy contract
covers both and the physics side needed no change for any of this.

The viewer did. It had one `kinematics.json` and one GLB, so the roller race drew a walking
robot. Now there is a tree per rig (`RIG_KINEMATICS`), the event's declared `rig` selects
it, and the GLB stays a single shared 1.3 MB download memoised across rigs.

**Five meshes the roller rig needs are not in the GLB** — `tire`, `rim`, `roller_blade` and
its two ankle brackets — exactly as in the simulator, which loads them from STL at runtime.
The viewer does the same, fetching only what the loaded tree references and the GLB lacks,
so a walking race still costs one request.

### No mergeVertices in the crease path

Worth recording because the reference has one and copying it was wrong. Measured on the
roller meshes, pre-welding at 1e-4 m:

- changes the output vertex count **not at all** — proving `toCreasedNormals` already welds
  internally, since it hashes vertices by position; and
- turns **0% dead normals into 9.6%** on the blade and ~5% on the ankle brackets, by
  collapsing vertices that were genuinely distinct and leaving degenerate faces whose
  normals cancel.

Dead normals render black, which is the very bug the crease path exists to fix. The
reference welds because it needs the welded geometry for a purpose this viewer does not
have: rebuilding binary STL to feed MuJoCo's WASM compiler. The weld came across without
its reason.

### Known gap: the wheels do not turn

The four wheels are hinge joints (`passive_LF_wheel` and friends) and the rig can pose
them, but **the trace does not record them**. A frame is 21 floats — trunk position, trunk
quaternion, 14 actuated joint angles — and the passive wheels are none of those. So a
roller replay glides with static wheels.

Two ways out, and they are not equivalent:

1. **Record them.** `TRACE_WIDTH` 21 -> 25. Correct, because a replay should be a
   recording. Costs a trace format migration: every stored trace is 21 wide and the decoder
   would have to handle both.
2. **Derive them in the viewer** from distance travelled over wheel radius. Free, no format
   change, looks right — but it puts motion on screen that was not measured, in a replay
   whose entire value is that it is faithful. It would also be wrong under wheel slip.

Not chosen here. It is a decision about what a replay is allowed to contain.

## Downloading a published policy

`GET /api/runs/{run_id}/policy` returns the `.onnx`, named
`{user}-{policy_name}.onnx`. Three properties worth stating:

- **Content-addressed storage.** Files live at `models/{sha256}.onnx`, so two people
  entering the same weights — or one person publishing them twice under different names —
  cost one copy. The filename being a checksum of the contents is also why this is the one
  write the append-only store does NOT refuse to repeat: an existing file has identical
  bytes by definition, and refusing would break the second person to publish a shared
  policy.
- **The checksum travels with the download**, as `X-Model-SHA256`, so a download can be
  verified against the record without trusting the store. The response is
  `immutable`-cacheable for the same reason.
- **The filename is sanitised, not trusted.** It is built from submitter-supplied text and
  lands in a `Content-Disposition` header and someone's filesystem, so `../../etc/passwd`,
  an embedded quote, and `evil.onnx.exe` all come out as plain names. Dots are dropped from
  the stem, which costs `v1.2` its dot and buys the whole family of double-extension and
  traversal confusions.

`model_stored` on each leaderboard row says whether a download exists. It is a recorded
flag rather than a filesystem probe, because rendering a board would otherwise cost one
existence check per row against a Hub snapshot. **Runs recorded before this existed have
no weights and never will** — the log is append-only, so those rows show no link rather
than a link that 404s.

## Running it locally

A first-class requirement, not a developer convenience: the way to try the Arena is to run
it, and that must not depend on a deployed Space.

```bash
uv run arena serve            # FastAPI + the built frontend on localhost
ARENA_DEV_USER=coralie uv run arena serve   # submissions attributed to that name
```

What this implies for the platform plan:

- **Storage defaults to local.** `LocalStore` under a configurable directory is the default
  backend; `HubStore` is opt-in via configuration. The two already share one interface, so
  this costs nothing.
- **Identity has two paths.** `ARENA_DEV_USER` locally, OAuth in a Space, and the submit
  endpoint reads whichever is present. Neither path is a special case of the other.
- **The frontend is served by the same process.** One command to start, no separate dev
  server to keep in sync, and the same code path that will run in the Space.
- **Model intake works offline.** File upload needs no network. Repo-id submission does, so
  it degrades with a clear message rather than a stack trace when the Hub is unreachable.

## Deliberately not in v1

- **Client-side practice with your own ONNX before submitting.** The obvious next feature,
  and it drags the whole WASM stack back into the bundle. The sandbox already exists for
  playing; the Arena links to it. Revisit once people are submitting.
- **Steering, obstacle courses, multi-policy entries.** All need user code server-side,
  which is a sandboxing project of its own.
- **Scheduled grand-prix events.** Runs accumulate and a nightly job races the whole field.
  Good for a launch moment; needs a scheduler and a much heavier replay.
- **Head-to-head *simulation*.** Ducks are timed alone and raced as replays. Putting several
  policies in one physics scene means collisions, and collisions mean a time that depends on
  who you were drawn against.

## Build order

Each stage is useful on its own, and each one de-risks the next.

1. **Timing probe.** Vendor the MJCF and meshes, run `alpha_walking` headless on a lane,
   measure. Decides whether submission feedback is synchronous. Nothing else is built until
   this number exists.
2. **Runner + manifest, offline.** `evaluate.py` scores a local `.onnx` on `sprint-2m` from
   the command line. Golden-run, determinism and termination tests land here. At this point
   the competition works, with no web and no storage.
3. **Storage + index.** Append runs to the dataset repo, rebuild the leaderboard at boot.
4. **API + OAuth + intake.** The Space serves a real leaderboard and accepts submissions.
5. **Frontend.** Event page, leaderboard, replay viewer, submit dialog.
6. **Second event.** Roller race or hill climb, as a manifest only. This is the test of
   whether the platform claim is true.

## Verification

### Timing probe, first

The claim that a run is sub-second is load-bearing: it is what makes five seeds affordable
and submission feedback synchronous. 1500 policy steps of a 14-DoF MuJoCo model plus 1500
small-MLP forward passes should be well under a second, with the 800 KB model download
dominating wall clock.

**Measure this before building the submit UI.** If a run is really 20 s of CPU, five seeds
becomes a queue with polling and the frontend changes shape.

**Outcome, and its revision.** One run measured 0.15 s, an entry 0.73 s, so submission was
built synchronous. The speed sweep later multiplied the work by ~4.5 (33 runs per entry,
~3.2 s), which is still synchronous locally but no longer *obviously* safe on shared Space
hardware. The probe's method held; only its margin was spent.

### Tests

| Test | What it protects |
| --- | --- |
| **Golden run** — `alpha_walking` on `sprint-2m`, fixed seeds, time within tolerance | Any physics or harness regression that would silently invalidate every recorded time |
| **Determinism** — same model + seed twice → byte-identical trace | The premise that a server-side time is reproducible |
| **Intake** — 51-D rejected with that exact sentence; oversize, garbage, missing repo rejected | The newcomer's first experience is a precise message, not a silent failure |
| **Manifest** — every event's course compiles in MuJoCo; every declared metric exists | A broken event cannot reach production |
| **Index** — log → ranking, one-row-per-entrant in both modes, DNF-at-time-limit | The leaderboard's arithmetic |
| **Runner termination** — fall, timeout and finish each trigger on a crafted scenario | The three ways a run can end, which decide every score |

## Open questions

- **Exact `STAND` keyframe and MJCF provenance.** Vendored from the sandbox at a pinned
  commit; the vendoring step needs recording so a physics change is a visible, deliberate
  event rather than a drift.
- **Whether `metric` needs to be pluggable sooner.** The high jump will answer this. Until
  then, `mean_finish_time` is the only metric and it is a lookup, not a plugin system.
