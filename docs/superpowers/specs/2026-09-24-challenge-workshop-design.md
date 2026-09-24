# The challenge workshop — design

Date: 2026-09-24. Status: approved in conversation, awaiting the owner's review of this document.

## Goal

A novice trains their first policy for a challenge, sees what it does, and
enters it on the Arena without learning what an ONNX manifest is. An advanced
user keeps every tool they have today and can do each step from a shell. Both
end up with the same thing on the Hub: a `policy.onnx` published with real
metadata — the same manifest the
[Policy Playground](https://huggingface.co/spaces/pollen-robotics/microduck-policy-playground)
reads — and a record of the code that trained it, complete enough to train it
again from scratch.

The Arena becomes the place to discover a challenge and to share a result. A
local workshop, opened by one command, becomes the place to train, watch and
publish. The Space alone measures: nothing computed on a user's machine is ever
recorded as a score.

## What exists today

Three things were found by reading, and they shape the whole design.

**The Arena already accepts a Hub repo.** `POST /api/events/{id}/submit` takes
a `repo_id` instead of a file, pins the revision, evaluates on the Space and
records a link (`arena/web/routes_submit.py`, `arena/hub_fetch.py`). It also
stores an optional `env_url` — a link to the training environment on GitHub,
GitLab or the Hub (`arena/envlink.py`) — and renders it on the board. The
Hub-repo entry path is most of "the Arena receives a repo, not a file".

**`microduck_rl` already publishes with real metadata.** `uv run publish`
writes `policy.onnx` with the normaliser baked in, a schema-2 `manifest.json`
(`kind`, `duration_s`, `slot`, `unwind_s`, `description`), a README, and a
`training` block with task, commit, branch, dirty flag, wandb run and
checkpoint. It validates the graph (`[1,61] -> [1,14]`), runs it on plausible
inputs and refuses NaNs or a constant output. The Arena's own
`arena/hub_publish.py` does the same job worse: `kind` is always `perpetual`,
there is no provenance and no description. That is the direct cause of the
request that opened this work.

**mjlab loads tasks from plugins.** `microduck_rl` declares
`[project.entry-points."mjlab.tasks"]`; mjlab imports every installed package
that does. A package that depends on `mjlab-microduck` and declares its own
entry point gets `uv run train <its task>` for free. `train` and `play` come
from mjlab; `export` and `publish` come from `mjlab-microduck`.

Three constraints were found the same way:

- `microduck_rl` trains on a CUDA GPU (MuJoCo Warp), Python 3.12, Linux x86 or
  ARM; without a GPU, any `train` command takes `--hf-jobs` and runs on
  Hugging Face Jobs. That is the compatibility floor: the workshop must not
  narrow it.
- The Arena pins mujoco 3.12.0, onnxruntime 1.29.0, numpy 2.5.2 and Python
  3.13 exactly, because recorded times are measurements made by those
  versions (`pyproject.toml`, `arena/golden.py`). `microduck_rl` locks mujoco
  3.10.0 (imposed by mujoco-warp 3.8.1), onnxruntime 1.24.4, numpy 2.4.1. The
  two cannot share a virtual environment as they are.
- The Arena's GitHub repo is private and the built site (`app/dist`) is not
  in git; the Dockerfile builds it. Robot meshes are in Git LFS. A plain git
  dependency on the Arena would fetch neither a site nor real meshes.

## Decisions

Made in conversation, recorded here with the reason.

1. **Guided local recipe**, not browser-side training. It is what people
   already do implicitly (they prepare their own ONNX); the workshop moves the
   UX to their machine instead of adding GPU hosting to the Space.
2. **One repo for all challenges**, `pollen-robotics/microduck-challenges`,
   outside the Arena repo. The Space must never install torch or mjlab; a
   novice forks something that holds only what they will touch; the scoring
   rules stay in the package the Space installs, never in a repo the user
   edits.
3. **`microduck_rl` is the common base**, used as a dependency. Every change
   to it is additive: current commands, flags and outputs keep their exact
   behaviour.
4. **The workshop lives in this repo**, as `arena workshop`, next to
   `arena serve` and `arena score`. It reuses the evaluator, the event rules
   and the replay viewer. The Space never runs it.
5. **Versions are aligned by moving the Arena** onto `microduck_rl`'s stack.
   The Arena is still work in progress; mjlab's pins are not ours to move.
6. **Distribution follows `microduck_rl`'s mode**: GitHub, no PyPI. The Arena
   is consumed as a wheel attached to a GitHub release; the challenges repo
   and `microduck_rl` are git dependencies. The Arena repo goes public later.
7. **Publishing means `uv run publish`**, in the workshop and in the shell.
   The Arena stops writing manifests and stops writing into anyone's Hub
   namespace. Entering a challenge requires a Hub repo; uploading a file
   remains possible for a trial only.
8. **The workshop registers an entry by opening the Space's challenge page**
   with the repo, revision and code link pre-filled; the user, signed in by
   OAuth as today, clicks Publish; the Space fetches, validates and evaluates
   by itself. No new authentication surface, and the official timing stays
   where it is seen.
9. **Code first, checkpoint second.** At publish time the workshop pushes the
   user to commit and push their fork and records its URL; the training
   checkpoint is uploaded next to the ONNX. The code is what allows training
   again from scratch; the checkpoint is what allows resuming.
10. **Every training run starts from a commit**, and the commit is captured
    when the run starts, not when it is published.

## Architecture

Three places, one direction of dependency:

```
microduck_rl                 the common base: robot, actuators, train/export/publish/infer, HF Jobs
    ▲
    │  git dependency, pinned by uv.lock
    │
microduck-challenges         one package, one folder per challenge: training env + challenge.toml
    │  also depends on
    ▼
microduck-arena (wheel)      the `arena` package: evaluator, event rules, replay viewer, `workshop`
```

The Space installs `arena` alone. A user's clone of `microduck-challenges`
installs all three in one virtual environment, which is what makes the local
test run the exact evaluator the Space runs.

The journey, end to end:

1. On the Space, a challenge page's **Train my robot** shows the hardware
   needed and one line to copy (see *The one line*).
2. The line clones `microduck-challenges` (or reuses the clone) and starts
   `uv run workshop <id>`, which opens the workshop page in the browser.
3. **Train**: the recipe and the exposed parameters are edited on the page;
   launching commits the change and runs `uv run train` as a subprocess.
   Progress is read from the run's TensorBoard files; checkpoints appear as
   they are saved.
4. **Test**: a checkpoint is exported to ONNX and scored by `arena.evaluate`
   with the event's rules; the replay plays in the site's viewer. The score
   is labelled indicative.
5. **Publish**: name, description, the state of the code (fork, commit,
   push), a preview of the Hub card, then `uv run publish --run <dir>`. The
   Hub repo gets `policy.onnx`, `manifest.json`, the checkpoint and a README
   with a *Reproduce* block.
6. The workshop opens the challenge page on the Space with `repo`, `revision`
   and `env` in the URL. The user clicks Publish. The Space downloads the
   repo at that revision, reads the manifest, evaluates and records.

An advanced user can do steps 3 to 6 from a shell and never open the
workshop: `uv run train`, `uv run publish --run`, then paste the repo on the
challenge page.

One assumption to own: **the agreement between a challenge's training
environment and the Arena's evaluation scene is the responsibility of the
challenge's author** (Pollen). Nothing checks it automatically. The Test
step, running the official evaluator locally, is the tool for noticing a
gap.

## Versions and distribution

**The Arena adopts `microduck_rl`'s stack**: Python 3.12, mujoco 3.10.0,
onnxruntime 1.24.4, numpy 2.4.1, kept as exact pins. Consequences, all
foreseen by existing code:

- `RUNNER_VERSION` becomes 3 and the golden run is re-measured in the same
  commit (`arena/golden.py`).
- Existing entries leave the board; `arena recover` re-races the ones on the
  Hub. Entries whose weights were stored only on the Space are not re-raced:
  they are few and the Arena is work in progress.
- When mjlab moves mujoco again, the Arena re-baselines. The challenges
  repo's `uv.lock` is the arbiter: it resolves both packages, and a version
  disagreement fails `uv lock` instead of passing silently.

**The Arena is consumed as a wheel.** The deploy workflow (`deploy-space.yml`)
gains a job that, on a `vX.Y` tag, builds the site, copies it and the real
mesh files into the package as `arena/frontend/`, builds the wheel and
attaches it to the GitHub release. The Dockerfile builds the Space from the
same wheel through the same script, so there is one build chain. The
challenges repo depends on the release URL:

```toml
dependencies = [
  "mjlab-microduck @ git+https://github.com/pollen-robotics/microduck_rl",
  "microduck-arena @ https://github.com/pollen-robotics/microduck-arena/releases/download/v0.2.0/microduck_arena-0.2.0-py3-none-any.whl",
]
```

`uv` locks the wheel's hash as it locks a commit. Nothing on PyPI, nothing
built on the user's machine, no build artefact committed on `main`.
`arena/web/config.py`'s frontend lookup points at `arena/frontend/` first,
`app/dist` second for a source checkout.

Until the Arena repo is public, the release asset is reachable only by
members, which is fine: the challenges repo is unusable by outsiders until
then anyway.

## Changes to `microduck_rl`

Nothing changes in the tasks, the robot, the actuators or `export`. Every
change below is additive; existing flags keep their exact behaviour and their
existing tests are left untouched, which is the guarantee.

| Where | Change | Why |
|---|---|---|
| `train`, in `MicroduckOnPolicyRunner.__init__` (already ours, has `log_dir`) | Writes `provenance.json` into the run's log directory at start: exact argv, seed, commit, branch, `dirty`, `origin` URL, `mjlab-microduck` version or commit (from `importlib.metadata` and its `direct_url.json`) | The commit *at launch* is captured for everyone, workshop or shell, without depending on the tool that launched |
| `publish` | New option `--run <log dir>`: reads `provenance.json`, picks the last checkpoint (or `--checkpoint N`), exports through `mjlab_microduck.export`, publishes | One argument for a local run. `--onnx` and `--wandb-run-path` are unchanged |
| `publish --run` | Uploads the chosen `.pt` as `checkpoint.pt` next to `policy.onnx` | Resuming later. Only on the `--run` path; the other paths upload what they upload today |
| `publish --run` | `training` in the manifest carries `repo` (the fork URL), `commit`, `branch`, `dirty`, `command`, `seed`, `checkpoint`, `base` (the `mjlab-microduck` version). The README ends with a *Reproduce* block: clone, checkout, `uv run train …` | The recipe travels with the weights, not only in the fork |
| `publish --run` | Refuses a run whose `provenance.json` says `dirty`; `--allow-dirty` overrides | The published recipe must be the one that trained. The other paths keep recording `dirty` without refusing, as today |
| `--hf-jobs` bootstrap | Launches the checkpoint uploader as `python -m mjlab_microduck.hf_uploader` instead of `scripts/hf/uploader.py`; `scripts/hf/uploader.py` becomes a shim | The tarball sent to the job is the challenges repo's, which has no such script |
| `infer_policy` | Moves into the package as `mjlab_microduck.infer` with a declared `infer` script; `scripts/infer_policy.py` becomes a shim like `export.py` | Available from a challenges checkout |
| new `mjlab_microduck.challenge` | `params(__file__)` reads `[params]` from the `challenge.toml` next to the calling `tasks.py` and returns each knob's `value` | A challenge env reads its exposed knobs from one place, and trains identically from the shell or the workshop: no environment variable, no argument |

`provenance.json`, written for every run:

```json
{
  "command": ["train", "Mjlab-Sprint2m-MicroDuck", "--env.scene.num-envs", "4096", "--agent.seed", "1", "--agent.logger", "tensorboard", "--agent.run-name", "first"],
  "seed": 1,
  "task": "Mjlab-Sprint2m-MicroDuck",
  "repo": "https://github.com/alice/microduck-challenges",
  "commit": "3f9c2d1",
  "branch": "main",
  "dirty": false,
  "base": "mjlab-microduck 0.1.0 @ 8a1b2c3",
  "started": "2026-09-24T14:02:11Z"
}
```

`repo`, `commit`, `branch` and `dirty` describe the git checkout that `train`
runs in (the current working directory's repository), not the installed
library: that is what changed from today's `git_provenance`, which looks at
the package's own path.

## The `microduck-challenges` repo

One public repo, one package, one `uv.lock`, one folder per challenge, made
from a `microduck-challenge-template` folder so all challenges share a shape:

```
microduck-challenges/
├── pyproject.toml           mjlab-microduck (git) + microduck-arena (wheel);
│                            one mjlab.tasks entry point for the whole package
├── uv.lock
├── src/microduck_challenges/
│   ├── __init__.py          registers every challenge's tasks
│   ├── sprint_2m/
│   │   ├── challenge.toml   event, task, kind, [recipe], [params]
│   │   └── tasks.py         the training env, twin of arena/events/sprint-2m.toml
│   ├── hill_climb_1m5/
│   └── …
└── README.md                the same one line as the challenge page
```

`challenge.toml`:

```toml
event = "sprint-2m"                  # the Arena event: rules, course, seeds
task  = "Mjlab-Sprint2m-MicroDuck"   # this folder's mjlab task
kind  = "perpetual"                  # what publish writes in the manifest

[recipe]                             # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]              # knobs the author exposes to novices
label = "Speed reward"
value = 2.0                          # what the page edits; the author's initial value
min   = 0.5
max   = 5.0
```

- `[recipe]` holds `train`'s arguments. The workshop shows them, the user
  changes them, the file is written and committed at launch.
- `[params]` are the knobs the challenge's author chooses to expose. The env
  reads them through `mjlab_microduck.challenge.params(__file__)`, so a
  novice tunes a reward without touching Python, and Python stays the door
  for advanced users.
- `uv run workshop` comes from the Arena wheel; the challenges repo declares
  nothing for it. `uv run workshop` alone lists the challenges; `uv run
  workshop sprint-2m` opens one.
- A challenge that is `planned` on the Arena has no folder until it opens.
  The workshop lists only the folders whose event is `open` in the installed
  Arena version.
- Forking: the user forks on GitHub; `origin` becomes their fork. No sync
  with Pollen's repo in this version; an opened challenge does not change.
- `logs/` and `.venv/` are ignored.

The event rules (`arena/events/<id>.toml`) stay in the `arena` package: the
local test uses the rules of the Arena version locked in `uv.lock`, the same
the Space applies when the versions coincide. Each event file gains a `kind`
field (`perpetual` for every current one) so the Space can check a manifest
against it.

## The workshop

**Shape.** A FastAPI server in `arena/workshop/`, separate from `arena/web`
(no OAuth, no store, never deployed). It serves `workshop.html`, built with
the site (same Vite build, same viewer modules), and opens it in the browser.
Everything that touches training runs as a subprocess, `uv run …` in the
challenges checkout; the `arena` package never imports mjlab, even though it
shares the environment.

**Startup.** `workshop [id]` finds the challenges checkout (the current
directory's git root), reads its `challenge.toml` files, keeps only those
whose event is `open`, and with no `id` shows a chooser. Every subprocess
it starts runs in that checkout, as a shell user's would.

**One page, four zones**, top to bottom:

1. **Preflight** — git, `uv`, an NVIDIA GPU (`nvidia-smi` on the PATH), a Hub
   login (`huggingface_hub.whoami()`). Each missing item shows the command
   that fixes it; a token field runs `login(token)` for people who prefer
   that to `hf auth login`. Nothing launches while a needed item is missing.
   Without a GPU the Train zone says so and points at the `--hf-jobs`
   command until milestone 2.
2. **Train** — `[recipe]` and `[params]` from `challenge.toml`, editable.
   *Launch* writes the file, commits if anything changed (`sprint-2m: run
   <name>`), then starts `uv run train <task> --env.scene.num-envs N
   --agent.max-iterations M --agent.seed S --agent.logger tensorboard
   --agent.run-name <name>`. While it runs: the reward curve read from the
   TensorBoard event files, the process output, a *Stop* button. Runs are
   discovered on disk — every `logs/…/<run>/` holding a `provenance.json` —
   not kept in a ledger of their own; restarting the workshop finds them all.
   A run's state is *running* (its process is alive in this workshop),
   *stopped* or *finished*.
3. **Test** — pick a run and a checkpoint; the workshop runs
   `mjlab_microduck.export` as a subprocess into the run's directory, then
   `arena.evaluate` in-process with the event's manifest, and shows the score
   with the replay in the viewer. Results are cached per checkpoint file.
   The label says *indicative — only the Space times an entry*, because even
   replays diverge between machines after a few seconds.
4. **Publish** — name and description; the *Your code* zone; a preview of
   the Hub card as `publish --dry-run` describes it; the *Publish* button
   runs `uv run publish --run <dir> --repo <user>/microduck-<slug> --kind
   <from challenge.toml> --description "…"`. On success the workshop opens
   `https://<space>/?repo=<repo>&revision=<sha>&env=<fork tree url>#/e/<event>`
   in the browser (the site routes on the hash, so the query goes first).

**Your code**, in the Publish zone, shows the real state of the checkout and
one button that fixes it:

| Detected | Shown | Button |
|---|---|---|
| `origin` is `pollen-robotics/…`, no fork | Your code is not shared yet | **Create my fork and push** — `gh repo fork --remote` when `gh` is logged in; otherwise opens GitHub's fork page and asks for the fork's URL, then sets `origin` to it |
| Fork present, uncommitted or unpushed changes | 3 changes not online yet | **Commit and push** |
| Fork up to date | Shared at github.com/you/… @ abc123 ✔ | none |

The code link is never required: a run can be published without it, the zone
shows an empty box, and the Arena entry has no code button. That is the
nudge; there is no gate. When the run's `provenance.json` says `dirty`, the
zone says the published code would not be what trained this model, and the
Publish button is disabled until *Commit and push* has run or the user ticks
*publish anyway* (`--allow-dirty`).

`env_url` sent to the Space is `https://github.com/<fork>/tree/<commit>`, the
commit from `provenance.json`: an address that names the exact state of the
code, not a branch that moves.

**Errors.** Every subprocess's output is shown, whole, in the zone that
launched it. The workshop interprets nothing and hides nothing.

**Routes** (`/api/workshop/…`): `status` (preflight, challenge, checkout
state), `runs` (list, with state and checkpoints), `runs` POST (launch),
`runs/{name}/stop`, `runs/{name}/log` (streamed), `runs/{name}/curve`,
`runs/{name}/test` POST (export + evaluate; returns score and trace),
`code` (fork/commit/push state), `code/fork` POST, `code/push` POST,
`publish` POST (dry-run preview and real).

## The Space

**Challenge page.** A **Train my robot** button opens a panel with the
hardware needed (an NVIDIA GPU, or HF Jobs) and the one line to copy. The
guide `docs/guides/challenges/<id>.md` keeps its Scoring and advice
sections; its Train section becomes the one line. `train-a-policy.md` is
rewritten around the workshop, with the shell path (`train`, `publish
--run`, submit a Hub repo) for advanced users.

**Submission.** The page reads `?repo=<user/name>&revision=<sha>&env=<url>`
and pre-fills the form; the user sees what will be submitted, signs in if
needed, clicks Publish. The server does what it does today for a `repo_id`:
downloads, validates, evaluates, records at the pinned revision. `submit`
gains an optional `revision` form field, honoured when present.

**Reading the manifest.** `hub_fetch` also downloads `manifest.json` when the
repo has one. A present manifest is checked: `obs_len` 61, `action_len` 14,
`robot.model` compatible with the event's rig (`RIG_MODEL`), `kind` equal to
the event's. A disagreement is refused with the offending field named. A repo
**without** a manifest stays accepted as today — not every existing
community repo has one, and the ONNX is validated regardless.

**End of Arena-side publishing.** `arena/hub_publish.py` is deleted: the
Space writes into nobody's namespace and fabricates no manifest. Publishing
requires a Hub repo; uploading a file stays possible for **Try** only. The
`submit` route refuses a file with a message that names the two ways to
publish (the workshop, `uv run publish`). Existing "weights kept on the
Space" records stay in the log; they leave the board with `RUNNER_VERSION`
3 regardless.

**Recovery.** `arena recover` read `arena.event` from manifests the Arena
wrote; new manifests do not carry it, and the existing fallback (every event
compatible with the rig) applies. Nothing to add.

**Board and run page.** The code link is already rendered from `env_url`.
Nothing else changes now; *start from this entry* is later work (see *Out
of scope*).

## The one line

```
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m
```

`uv` runs a remote Python script. `workshop.py` is served by the Space from
this repo (`app/public/workshop.py`, so it ships with the site). It has no
dependencies, so `uv` runs it without installing anything, and it does three
things: clone `microduck-challenges` into the current directory if it is not
there (otherwise reuse the clone as is, fork included), change into it, and
`exec` `uv run workshop <id>`. The real installation happens in the clone,
once. Running the same line the next day reopens the workshop on the same
work.

If `uv` is missing, the page shows Astral's official install line just
above. `curl … | sh` was not chosen: it could install `uv` itself, but it is
one of the few patterns novices are told not to copy, and native Windows is
outside `microduck_rl`'s scope anyway.

## What reproducibility means here

What is guaranteed: **same repo at the same commit, same `uv.lock`, same
command, same seed.** Together they name the recipe completely, and the
*Reproduce* block in the Hub README is exactly that recipe. What is not
guaranteed: bit-identical weights. GPU reinforcement learning is not
deterministic across machines, drivers or GPU models; training the recipe
again yields a comparable policy, not the same file. The spec, the Hub README
and the workshop's wording say "train it again", never "get the same
weights".

Three mechanisms make the recipe complete by construction:

- every run starts from a commit (the workshop commits at launch; a shell
  user who launches on a dirty tree gets `dirty: true` in `provenance.json`
  and is told at publish time);
- the novice's knobs live in a tracked file that the page edits, and the
  advanced user's changes are Python in the same repo — in both cases what
  trained the model is in git;
- `uv.lock` in the fork pins `mjlab-microduck` and everything below it.

## Testing

- **`microduck_rl`**: CPU-only unit tests like the existing ones.
  `provenance.json` (content, `dirty`, `origin`, checkout vs library);
  `publish --run` (reading a run, choosing the checkpoint, the `dirty`
  refusal and `--allow-dirty`, the manifest and README written through the
  fake `HfApi` used today, the checkpoint upload); the HF Jobs bootstrap
  calling the uploader as a module; `challenge.params(__file__)` against a
  `challenge.toml` fixture. The `--onnx` and `--wandb-run-path` paths keep their
  current tests, unchanged.
- **`microduck-challenges`**: one test per challenge instantiating the task
  config on CPU and checking that it registers, that `challenge.toml` names
  an `open` event of the installed Arena and that `kind` matches it.
- **Arena, package**: manifest reading and validation (accepted, refused
  with the field named, absent); the new `kind` field on events; the golden
  run re-measured for `RUNNER_VERSION` 3; the workshop with a fake `uv` on
  the PATH that writes TensorBoard files and checkpoints — run discovery,
  the commit at launch, export, local evaluation, the `publish` command
  built, the *Your code* states; `submit` with `revision`, and the refusal of
  a file for publishing.
- **Arena, site**: vitest like the other pages for the `?repo=` pre-fill,
  the *Train my robot* panel and the workshop page's four zones.
- **End to end, by hand, before closing**: on a machine with a GPU, the one
  line, a short training, Test, Publish, then the entry on the Space's board
  with its code link. It is the only test that proves the journey; the plan
  puts it last, with the owner.

## Milestones

1. **Foundations**: the Arena on `microduck_rl`'s stack, `RUNNER_VERSION` 3,
   the wheel with the frontend, the release job; `microduck_rl`'s additive
   changes; the `microduck-challenges` repo with the four open challenges.
2. **The workshop, local GPU**: preflight, Train, Test, Publish, *Your
   code*, the one line, the Space's page and submission changes, end of
   Arena-side publishing.
3. **The workshop, HF Jobs**: the same *Launch* button submits with
   `--hf-jobs`, the workshop follows the job's log and fetches the
   checkpoints the job pushes into `logs/` so Test and Publish are identical.

Milestone 3 is specified here so the first two leave room for it; it is
built after the GPU path works end to end.

## Out of scope

- **Start from someone's entry**: cloning a user's fork at the manifest's
  commit and resuming from `checkpoint.pt`. This design makes it possible
  (the fork URL, the commit and the checkpoint are all published); the
  button is a later brainstorm.
- Syncing a fork with Pollen's challenges repo after a challenge changes.
- Native Windows. Linux x86 and ARM with an NVIDIA GPU, or HF Jobs, is the
  floor `microduck_rl` sets; macOS can run the workshop's Test and Publish
  on a checkpoint trained elsewhere.
- Editing the training environment's Python from the page.

## Risks and open points

- **Re-baselining the golden run** on mujoco 3.10.0 may change the reference
  walker's behaviour beyond a bump in numbers; if the reference no longer
  walks, the pin question reopens with mjlab, not here.
- **`uv run <url>`** relies on `uv` fetching a remote script; the script must
  stay dependency-free and small, and the Space must serve it with a
  `text/x-python` type. Verified during milestone 2's first task.
- **HF Jobs from a challenges checkout** has never run: the tarball is the
  challenges repo, `uv sync` inside the job resolves git and URL
  dependencies, and the release wheel must be reachable from the job. This
  is exactly why milestone 3 is separate.
- **`gh` availability** for *Create my fork*: the fallback (open GitHub's
  fork page, paste the URL) must work without it.
