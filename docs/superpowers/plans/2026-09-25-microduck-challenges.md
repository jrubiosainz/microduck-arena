# The `microduck-challenges` repo — implementation plan (plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new repo, `microduck-challenges`, holds one working training folder per open Arena challenge (sprint-2m, swag-contest, hill-climb-1m5, roller-sprint-2m); `uv run train <task>` trains each one locally or with `--hf-jobs`, and the same environment carries the Arena package for the workshop.

**Architecture:** One Python package, `microduck_challenges`, declares one `mjlab.tasks` entry point; its `__init__` imports each challenge's `tasks.py`, which registers the mjlab task and calls `mjlab_microduck.challenge.register(__file__)`. Each challenge folder is self-contained: `challenge.toml` (event, task, kind, recipe, knobs), `env.py` (a complete copy of the matching `microduck_rl` env config, adapted to the event, reading its knobs through `challenge.params(__file__)`), `tasks.py`. `mjlab-microduck` is a git dependency; `microduck-arena` sits in a non-default dependency group `workshop`, installed from a wheel on a **private** Hub repo until the Arena's GitHub repo goes public.

**Tech Stack:** Python 3.12, `uv` (lock with `--no-config`), `uv_build`, mjlab 1.3.0 through `mjlab-microduck`, pytest, `huggingface_hub`, `gh` (only to fetch the release wheel).

**Spec:** `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md`, sections *The `microduck-challenges` repo*, *Versions and distribution*, *Testing*. Plan 1 (`2026-09-25-microduck-rl-recipe-publishing.md`) built `mjlab_microduck.challenge`; plan 2 (`2026-09-25-arena-foundations.md`) built the Arena wheel.

## Where things are

- New repo: `~/Projects/HuggingFace/microduck-challenges` (created in Task 2, branch `main`). Execution happens there; every path below without a prefix is relative to it.
- Source of the env copies: `~/Projects/HuggingFace/microduck_rl` at commit `981a279` (branch `challenge-recipe-publishing`; same tree as the former `776b467`), files `src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py` (949 lines) and `src/mjlab_microduck/tasks/microduck_velocity_rollers_env_cfg.py` (669 lines). Line numbers below are for that commit.
- The Arena: `~/Projects/HuggingFace/microduck-arena`, version 0.2.0. Its open events: `sprint-2m` (rig legs, flat 2 m), `swag-contest` (legs, flat 2 m, votes), `hill-climb-1m5` (legs, 8° slope, 1.5 m), `roller-sprint-2m` (rig rollers, flat 2 m). `arena.manifest.load_event(id)` returns a `Manifest` with `.status` (`"open"` by default) and `.rig` (`"legs"` / `"rollers"`).

## Prerequisites (the owner's, before Task 2)

- **P1. Plan 1 is on GitHub** — done 2026-09-25 as the draft PR pollen-robotics/microduck_rl#57, branch `challenge-recipe-publishing` (head `981a279`, commit messages unsigned). Until it merges, this repo's source for `mjlab-microduck` is that branch; the lock pins the commit. The executor checks `git ls-remote https://github.com/pollen-robotics/microduck_rl challenge-recipe-publishing` prints `981a279…` (or a descendant) and stops if not.
- **P2. The Arena wheel exists.** Preferably the CI-built one: the owner has pushed `main` and `v0.2.0` of the Arena, and `gh release view v0.2.0 -R pollen-robotics/microduck-arena` lists `microduck_arena-0.2.0-py3-none-any.whl`. If not yet, Task 1 builds it locally (same script as CI).

## Global Constraints

- **Every `uv` command in this repo runs with `--no-config`** (the owner's `~/.config/uv/uv.toml` sets an HF mirror and `exclude-newer`, which rewrite a lock). Re-lock with `uv lock --no-config`; install/run with `uv sync --no-config --frozen …` / `uv run --no-config --frozen …`. The committed lock must resolve from `https://pypi.org/simple` (no `pypi.registries.huggingface.tech` in `uv.lock`).
- **`HF_TOKEN` must be in the environment** for any `uv` command that touches the `workshop` group: `export HF_TOKEN=$(cat ~/.cache/huggingface/token)`. The Arena wheel sits on a private Hub repo; uv sends `HF_TOKEN` to `huggingface.co` and nothing else.
- The Arena wheel URL, exactly: `https://huggingface.co/pollen-robotics/microduck-arena-wheels/resolve/main/microduck_arena-0.2.0-py3-none-any.whl`. It is interim: when the Arena's GitHub repo goes public, it becomes `https://github.com/pollen-robotics/microduck-arena/releases/download/v0.2.0/microduck_arena-0.2.0-py3-none-any.whl` and the repo re-locks. Nothing else changes then.
- `microduck-arena` lives **only** in the dependency group `workshop`, which is **not** a default group (`default-groups = ["dev"]`). The HF job runs a plain `uv sync`, which installs default groups only.
- `[tool.uv]` `override-dependencies`, `[tool.uv.sources]` (`better-actuator-models` git branch `mjlab_frictionloss`, `torch` → `pytorch-cu129` on linux-aarch64) and `[[tool.uv.index]]` `pytorch-cu129` are copied **verbatim, comments included** from `microduck_rl`'s `pyproject.toml`; `torch==2.9.1` is a direct dependency for the same reason it is there (uv applies sources to direct dependencies only).
- Commit messages: one line, in English, never signed (no `Co-Authored-By` trailer, no tool attribution).
- `requires-python = ">=3.12, <3.13"` (bam, and the Arena's golden run, allow exactly that).
- Task ids: `Mjlab-Sprint2m-MicroDuck`, `Mjlab-SwagContest-MicroDuck`, `Mjlab-HillClimb1m5-MicroDuck`, `Mjlab-RollerSprint2m-MicroDuck`. Folders: `sprint_2m`, `swag_contest`, `hill_climb_1m5`, `roller_sprint_2m`. `kind = "perpetual"` for all four. `experiment_name` (the `logs/rsl_rl/<name>/` directory) = the folder name.
- `[recipe]` for all four, as the spec writes it: `num_envs = 4096`, `max_iterations = 3000`, `seed = 1`.
- A challenge folder imports from `mjlab_microduck` only the robot model (`mjlab_microduck.robot.microduck_constants`), the function library (`mjlab_microduck.tasks.mdp`, `mjlab_microduck.tasks.symmetry`), `mjlab_microduck.challenge`, and in `tasks.py` the runner `MicroduckOnPolicyRunner`. Never another task's env file.
- An `env.py` keeps every comment of its source that still describes the code, and drops code a challenge cannot reach (no `rough` flag where the event is flat, no flat branch where it is a slope). No dead code.
- Tests: `uv run --no-config --frozen --group workshop pytest` from the repo root, on the Mac (CPU). The spec's per-challenge test: the task registers, `challenge.toml` names an event of the installed Arena whose status is `open`, and the knobs reach the config. (Checking `kind` against the event's needs the `kind` field events gain in plan 4; plan 4 adds that assertion.)

## Review Focus

- A knob edited in `challenge.toml` must change what trains. A folder whose `env.py` still hard-codes `2.0` where the knob should go looks right and silently ignores the workshop. Pinned per challenge in `tests/test_challenges.py::test_knobs_reach_the_config`, which rewrites the TOML with an unusual value and rebuilds the config.
- The HF job's cold `uv sync` (uv 0.11.30, empty cache, no `--frozen`) downloads the `workshop` group's URL source even though it does not install it — measured 2026-09-25. With the wheel on a private Hub repo, that works only because uv sends the job's `HF_TOKEN` secret. Pinned in Task 1 Step 4 (toy project, uv 0.11.30, cold cache, with and without the token) and Task 7 Step 3 (the real lock).
- A challenge pointing at an event that is `planned`, or at a misspelled one, would train for nothing. Pinned by `test_the_event_is_open_on_the_installed_arena`.
- The roller challenge trained on the legs robot (or the reverse) would pass every other check and fail on the Arena, which races the event's rig. Pinned by `test_the_robot_matches_the_events_rig`.
- `train <task> --hf-jobs` from this checkout must be intercepted before any env builds and must snapshot *this* repo with its `uv.lock`, never `logs/` or `.venv/`. Pinned in Task 7 (dry run, and the tarball's file list).

---

### Task 1: Put the Arena wheel on a private Hub repo, and prove uv can fetch it

**Files:** none in any repo. Hub: `pollen-robotics/microduck-arena-wheels` (model repo, **private**).

**Interfaces:**
- Produces: the URL `https://huggingface.co/pollen-robotics/microduck-arena-wheels/resolve/main/microduck_arena-0.2.0-py3-none-any.whl`, reachable with `HF_TOKEN`, refused without.

- [ ] **Step 1: Get the wheel**

If P2 holds (the release exists):

```bash
W=/private/tmp/arena-wheel && rm -rf $W && mkdir -p $W
gh release download v0.2.0 -R pollen-robotics/microduck-arena -p 'microduck_arena-0.2.0-py3-none-any.whl' -D $W
```

Otherwise build it exactly as `.github/workflows/release.yml` does, from the Arena's local `main` (clean tree, LFS content present):

```bash
cd ~/Projects/HuggingFace/microduck-arena
git status --short            # must be empty
(cd app && npm ci && npm run build)
uv run --no-config --no-project python scripts/bundle_frontend.py
uv build --no-config --wheel -o /private/tmp/arena-wheel
```

Then, either way, run the release workflow's inspection on it:

```bash
python3 - <<'EOF'
import glob, zipfile
z = zipfile.ZipFile(glob.glob("/private/tmp/arena-wheel/microduck_arena-0.2.0-*.whl")[0])
names = z.namelist()
assert "arena/frontend/index.html" in names, "no site in the wheel"
pointers = [n for n in names if z.read(n)[:40].startswith(b"version https://git-lfs")]
assert not pointers, f"LFS pointers, not files: {pointers[:5]}"
print("wheel ok:", len(names), "files")
EOF
```

Expected: `wheel ok: <n> files`.

- [ ] **Step 2: Create the private repo and upload — ask the owner first**

Creating a repo in the `pollen-robotics` org is outward-facing: confirm with the owner before running.

```bash
hf repos create pollen-robotics/microduck-arena-wheels --private --exist-ok
hf upload pollen-robotics/microduck-arena-wheels /private/tmp/arena-wheel/microduck_arena-0.2.0-py3-none-any.whl microduck_arena-0.2.0-py3-none-any.whl
```

(If this `hf` has no `repos create`, use `hf repo create pollen-robotics/microduck-arena-wheels --private`.) Check it is private: `hf repos info pollen-robotics/microduck-arena-wheels` (or the web page) shows `private: true`.

- [ ] **Step 3: The URL is refused without a token and served with one**

```bash
U=https://huggingface.co/pollen-robotics/microduck-arena-wheels/resolve/main/microduck_arena-0.2.0-py3-none-any.whl
curl -s -o /dev/null -w "anon %{http_code}\n" -L "$U"
curl -s -o /dev/null -w "token %{http_code}\n" -L -H "Authorization: Bearer $(cat ~/.cache/huggingface/token)" "$U"
```

Expected: `anon 401` (or 404), `token 200`.

- [ ] **Step 4: uv fetches it with `HF_TOKEN`, locally (0.9.21) and as the job does (0.11.30, cold cache, plain `uv sync`)**

A throwaway project in the scratchpad, shaped like the challenges repo's dependency groups:

```bash
T=/private/tmp/uv-hf-auth && rm -rf $T && mkdir -p $T && cd $T
cat > pyproject.toml <<'EOF'
[project]
name = "probe"
version = "0.0.0"
requires-python = ">=3.12, <3.13"
dependencies = []

[dependency-groups]
workshop = ["microduck-arena"]

[tool.uv]
default-groups = []

[tool.uv.sources]
microduck-arena = { url = "https://huggingface.co/pollen-robotics/microduck-arena-wheels/resolve/main/microduck_arena-0.2.0-py3-none-any.whl" }
EOF
export HF_TOKEN=$(cat ~/.cache/huggingface/token)
uv lock --no-config && grep -c 'microduck-arena' uv.lock
UV_CACHE_DIR=$T/cold uvx --no-config --from uv==0.11.30 uv sync --no-config --no-progress; echo "job-shaped sync exit=$?"
rm -rf .venv; env -u HF_TOKEN UV_CACHE_DIR=$T/cold2 uvx --no-config --from uv==0.11.30 uv sync --no-config --no-progress; echo "no-token sync exit=$?"
```

Expected: the lock succeeds and names `microduck-arena`; `job-shaped sync exit=0`; `no-token sync exit=2` with a 401 on that URL (this is the proof that the token is what makes it work, and that a job without `HF_TOKEN` would fail loudly, not silently).

If `uv lock` fails with 401 even with `HF_TOKEN` exported: stop and report. The interim host decision rests on uv's Hub authentication; do not work around it.

- [ ] **Step 5: Nothing to commit.** Delete `/private/tmp/uv-hf-auth`. Report the three exit codes.

---

### Task 2: Scaffold the repo

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `README.md`, `src/microduck_challenges/__init__.py`, `tests/test_package.py`, `uv.lock`

**Interfaces:**
- Consumes: the wheel URL from Task 1.
- Produces: the package `microduck_challenges` with entry point `[project.entry-points."mjlab.tasks"] microduck_challenges = "microduck_challenges"`; the groups `dev` (default) and `workshop` (not default); `tests/test_challenges.py` does not exist yet (Task 3 creates it).

- [ ] **Step 1: Create the repo**

```bash
mkdir -p ~/Projects/HuggingFace/microduck-challenges && cd ~/Projects/HuggingFace/microduck-challenges
git init -b main
```

- [ ] **Step 2: Write `pyproject.toml`**

Copy the three `[tool.uv…]` tables from `~/Projects/HuggingFace/microduck_rl/pyproject.toml` **verbatim with their comments**: `[tool.uv]` (lines holding `override-dependencies`), `[tool.uv.sources]` (the `better-actuator-models` and `torch` entries and their comments), `[[tool.uv.index]]`. Then add `default-groups` to `[tool.uv]` and the two new sources. The result:

```toml
[build-system]
requires = ["uv_build>=0.8.19,<0.9.0"]
build-backend = "uv_build"

[project]
name = "microduck-challenges"
version = "0.1.0"
description = "One training folder per open Microduck Arena challenge"
readme = "README.md"
# bam and the Arena's golden run both allow exactly 3.12.
requires-python = ">=3.12, <3.13"
dependencies = [
    "mjlab-microduck",
    # Direct dep ONLY so [tool.uv.sources] can bind torch to the CUDA index on
    # aarch64, as in microduck_rl: uv applies sources to direct dependencies only.
    # The exact version microduck_rl locks.
    "torch==2.9.1",
]

# mjlab imports every package that declares this group; importing ours registers
# every challenge's task, so `uv run train <task>` works from this checkout.
[project.entry-points."mjlab.tasks"]
microduck_challenges = "microduck_challenges"

[dependency-groups]
dev = ["pytest>=8.0"]
# The Arena: the evaluator, the event rules and the workshop. Not a default
# group, so the HF job's plain `uv sync` never installs it (it only trains).
workshop = ["microduck-arena"]

[tool.uv]
default-groups = ["dev"]
override-dependencies = [
    # ← paste microduck_rl's three entries and their comments here, verbatim
]

[tool.uv.sources]
# Plan 1 of the workshop, in review as microduck_rl#57; `develop` once it merges.
mjlab-microduck = { git = "https://github.com/pollen-robotics/microduck_rl", branch = "challenge-recipe-publishing" }
# The Arena's wheel. Interim: a PRIVATE Hub repo, fetched with HF_TOKEN (uv sends
# it to huggingface.co; an HF job gets it as a secret), because a release asset
# on the Arena's private GitHub repo cannot be downloaded by uv even with a
# token. When that repo goes public this becomes
# https://github.com/pollen-robotics/microduck-arena/releases/download/v0.2.0/microduck_arena-0.2.0-py3-none-any.whl
microduck-arena = { url = "https://huggingface.co/pollen-robotics/microduck-arena-wheels/resolve/main/microduck_arena-0.2.0-py3-none-any.whl" }
# ← paste microduck_rl's better-actuator-models and torch entries and their comments here, verbatim

# ← paste microduck_rl's [[tool.uv.index]] table here, verbatim
```

The `# ← paste` lines are instructions to you, not content: the committed file holds the pasted text instead.

- [ ] **Step 3: `.gitignore`, the package, `README.md`**

`.gitignore`:

```
.venv/
logs/
__pycache__/
*.egg-info/
```

`src/microduck_challenges/__init__.py`:

```python
"""Every open Arena challenge, one folder each; importing this registers their mjlab tasks."""
```

`README.md`:

````markdown
# Microduck challenges

One folder per challenge open on the Microduck Arena. Each is a complete,
working training environment: train it unchanged and the robot competes.

| Folder | Arena event | Task |
|---|---|---|
| (filled in as challenges are added) | | |

## Train from a shell

Needs Python 3.12 and `uv`. Training needs an NVIDIA GPU, or Hugging Face Jobs:

```bash
git clone https://github.com/pollen-robotics/microduck-challenges && cd microduck-challenges
export HF_TOKEN=$(cat ~/.cache/huggingface/token)   # while the Arena wheel is private
uv sync --group workshop
uv run train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 3000 \
    --agent.seed 1 --agent.logger tensorboard --agent.run-name first
# no GPU: add --hf-jobs --no-wandb
```

A challenge's knobs are in its `challenge.toml` (`[params]`); its whole
environment is in `env.py`. Edit either, commit, train.

Then `uv run publish --run logs/rsl_rl/<folder>/<run> --repo <you>/<name>` and
paste the repo on the challenge's page on the Arena.
````

- [ ] **Step 4: The package test**

`tests/test_package.py`:

```python
from importlib.metadata import entry_points


def test_mjlab_finds_the_package():
    found = {ep.name: ep.value for ep in entry_points(group="mjlab.tasks")}
    assert found.get("microduck_challenges") == "microduck_challenges"


def test_the_arena_is_installed_from_the_workshop_group():
    from arena.manifest import load_event

    assert load_event("sprint-2m").id == "sprint-2m"
```

- [ ] **Step 5: Lock, install, run**

```bash
export HF_TOKEN=$(cat ~/.cache/huggingface/token)
uv lock --no-config
grep -c 'pypi.registries.huggingface.tech' uv.lock     # expect 0
grep -A2 'name = "mjlab-microduck"' uv.lock | head -3  # source = git … challenge-recipe-publishing#<sha>
uv sync --no-config --frozen --group workshop
uv run --no-config --frozen --group workshop pytest -q
```

Expected: `2 passed`. If `uv lock` fails on `mjlab-microduck`: the PR branch is not on GitHub (stop). If it fails on a version conflict between `mjlab-microduck` and `microduck-arena`: stop and report the conflict; the pins are the Arena's to move (spec, *Versions and distribution*).

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md pyproject.toml uv.lock src tests
git commit -m "A package for the Arena's challenges, with the Arena in a workshop group"
```

---

### Task 3: sprint-2m

**Files:**
- Create: `src/microduck_challenges/sprint_2m/__init__.py` (empty), `challenge.toml`, `env.py`, `tasks.py`
- Modify: `src/microduck_challenges/__init__.py`, `README.md` (table row)
- Create: `tests/test_challenges.py`

**Interfaces:**
- Consumes: `mjlab_microduck.challenge.register(tasks_file) -> Challenge`, `params(tasks_file) -> dict[str, float]` (reads `challenge.toml` beside the given file); `mjlab_microduck.tasks.MicroduckOnPolicyRunner`; `mjlab.tasks.registry.register_mjlab_task(task_id=, env_cfg=, play_env_cfg=, rl_cfg=, runner_cls=)`, `list_tasks()`.
- Produces: `microduck_challenges.sprint_2m.env.make_env_cfg(play: bool = False) -> ManagerBasedRlEnvCfg`, `microduck_challenges.sprint_2m.env.RL_CFG`; the test table `CHALLENGES` in `tests/test_challenges.py` that Tasks 4–6 extend by one row each.

- [ ] **Step 1: Write the failing tests**

`tests/test_challenges.py`:

```python
"""Every challenge folder: it registers, it trains for an open event, its knobs are live."""

import importlib
import math
from pathlib import Path

import pytest
from mjlab.tasks.registry import list_tasks

import microduck_challenges  # noqa: F401  (registers every task)
from arena.manifest import load_event
from mjlab_microduck import challenge
from mjlab_microduck.robot.microduck_constants import (
    MICRODUCK_WALK_ROBOT_CFG,
    MICRODUCK_WALK_ROLLERS_ROBOT_CFG,
)

# folder, and for each exposed knob: (reward term whose weight it sets, value to try).
CHALLENGES = {
    "sprint_2m": {
        "forward_reward": ("track_linear_velocity", 3.7),
        "upright_reward": ("upright", 1.3),
        "step_reward": ("air_time", 4.1),
    },
}

ROOT = Path(microduck_challenges.__file__).parent


def _contract(folder):
    return challenge.load(ROOT / folder / "tasks.py")


@pytest.mark.parametrize("folder", CHALLENGES)
def test_the_task_is_registered(folder):
    assert _contract(folder).task in list_tasks()


@pytest.mark.parametrize("folder", CHALLENGES)
def test_the_event_is_open_on_the_installed_arena(folder):
    event = load_event(_contract(folder).event)
    assert event.status == "open", f"{folder} trains for {event.id}, which is {event.status}"


@pytest.mark.parametrize("folder", CHALLENGES)
def test_the_robot_matches_the_events_rig(folder):
    env = importlib.import_module(f"microduck_challenges.{folder}.env")
    robot = env.make_env_cfg().scene.entities["robot"]
    expected = {"legs": MICRODUCK_WALK_ROBOT_CFG, "rollers": MICRODUCK_WALK_ROLLERS_ROBOT_CFG}
    assert robot is expected[load_event(_contract(folder).event).rig]


@pytest.mark.parametrize("folder", CHALLENGES)
def test_runs_log_under_the_folder_name(folder):
    env = importlib.import_module(f"microduck_challenges.{folder}.env")
    assert env.RL_CFG.experiment_name == folder


@pytest.mark.parametrize("folder", CHALLENGES)
def test_knobs_reach_the_config(folder, tmp_path, monkeypatch):
    """Rewrite the knobs to unusual values; the rebuilt config must carry them."""
    toml = ROOT / folder / "challenge.toml"
    text = toml.read_text()
    for knob, (_, value) in CHALLENGES[folder].items():
        text = _set_value(text, knob, value)
    copy = tmp_path / "challenge.toml"
    copy.write_text(text)
    real_params = challenge.params
    monkeypatch.setattr(challenge, "params", lambda f: real_params(copy))

    env = importlib.import_module(f"microduck_challenges.{folder}.env")
    cfg = env.make_env_cfg()
    for knob, (term, value) in CHALLENGES[folder].items():
        if term is None:
            continue
        assert math.isclose(cfg.rewards[term].weight, value), f"{knob} does not set {term}"


def _set_value(text: str, knob: str, value: float) -> str:
    head = f"[params.{knob}]"
    assert head in text, f"no {head}"
    before, after = text.split(head, 1)
    lines = after.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.split("=")[0].strip() == "value":
            lines[i] = f"value = {value}\n"
            return before + head + "".join(lines)
    raise AssertionError(f"{head} has no value")
```

`env.py` must call `challenge.params(__file__)` **through the module attribute** (`from mjlab_microduck import challenge` then `challenge.params(__file__)`), not `from mjlab_microduck.challenge import params`, so the monkeypatch reaches it. Knobs whose term is `None` (Task 5's slope) are checked by their own test.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --group workshop pytest tests/test_challenges.py -q`
Expected: FAIL (`FileNotFoundError: …/sprint_2m/challenge.toml`).

- [ ] **Step 3: `challenge.toml`**

`src/microduck_challenges/sprint_2m/challenge.toml`:

```toml
# The 2 m Sprint: walk a flat 2 m lane as fast as possible. The Arena races the
# policy at forward commands from 0.20 to 1.20 m/s and keeps its best.
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
kind  = "perpetual"

[recipe]                  # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]
label = "Speed reward"
value = 2.0
min   = 0.5
max   = 5.0

[params.upright_reward]
label = "Stay upright"
value = 2.0
min   = 0.5
max   = 5.0

[params.step_reward]
label = "Lift your feet"
value = 3.0
min   = 0.0
max   = 6.0
```

- [ ] **Step 4: `env.py` — copy, then adapt**

```bash
cp ~/Projects/HuggingFace/microduck_rl/src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py src/microduck_challenges/sprint_2m/env.py
```

Then edit `env.py` (line numbers are the source's):

1. **Docstring (lines 1–17).** Replace the first line with `"""The 2 m Sprint's training environment: Microduck walking on flat ground.` followed by a blank line and this paragraph, then keep the rest of the original docstring as is:

   ```
   A complete copy of microduck_rl's velocity task (microduck_velocity_env_cfg.py),
   made the sprint's own: flat ground only, and the three rewards a novice tunes
   read from challenge.toml ([params]). Everything here is yours to change; the
   robot (MICRODUCK_WALK_ROBOT_CFG) and the reward functions (microduck_mdp)
   come from mjlab_microduck and are not edited here.
   ```

2. **Rough terrain goes** — the sprint is flat. Delete: `import mujoco as _mujoco`, `import mjlab.terrains as terrain_gen`, `from mjlab.terrains.terrain_generator import TerrainGeneratorCfg` (lines 89–91); `MICRODUCK_ROUGH_TERRAINS_CFG` with its comment (lines 125–169); `_soften_terrain_contacts` (lines 172–190). In `make_microduck_velocity_env_cfg`, delete the `rough: bool = False,` parameter; replace the `# Terrain` block (`if not rough:` at line 748 through line 774, the `if play:` generator lines included) with:

   ```python
       # Terrain: the sprint's lane is flat.
       cfg.scene.terrain.terrain_type = "plane"
       cfg.scene.terrain.terrain_generator = None
   ```

   and replace (lines 888–889)

   ```python
       if not rough:
           del cfg.curriculum["terrain_levels"]
   ```

   with `    del cfg.curriculum["terrain_levels"]`. Afterwards `grep -n rough env.py` prints nothing.

3. **Names.** Rename `make_microduck_velocity_env_cfg` → `make_env_cfg`, its docstring to `"""The sprint's training environment."""`; rename `MicroduckRlCfg` → `RL_CFG` and set in it `experiment_name="sprint_2m",  # logs/rsl_rl/sprint_2m/` and `run_name="sprint_2m",`.

4. **Knobs.** Add `from mjlab_microduck import challenge` next to the other `mjlab_microduck` imports. First line of `make_env_cfg`'s body, before `std_standing`:

   ```python
       # The knobs a novice tunes, from challenge.toml beside this file.
       knobs = challenge.params(__file__)
   ```

   Then replace the three weights:
   - `cfg.rewards["upright"].weight = 2.0` → `cfg.rewards["upright"].weight = knobs["upright_reward"]`
   - `cfg.rewards["air_time"].weight = 3.0` → `cfg.rewards["air_time"].weight = knobs["step_reward"]`
   - `cfg.rewards["track_linear_velocity"].weight = 2.0` → `cfg.rewards["track_linear_velocity"].weight = knobs["forward_reward"]`

5. **Check** that `env.py` imports nothing from `mjlab_microduck.tasks.microduck_*` (`grep -n "tasks.microduck_" env.py` prints nothing).

- [ ] **Step 5: `tasks.py`, and the package imports it**

`src/microduck_challenges/sprint_2m/tasks.py`:

```python
"""Registers the sprint's task with mjlab, and its contract (challenge.toml) with publish."""

from mjlab.tasks.registry import register_mjlab_task

from mjlab_microduck import challenge
from mjlab_microduck.tasks import MicroduckOnPolicyRunner

from .env import RL_CFG, make_env_cfg

register_mjlab_task(
    task_id=challenge.register(__file__).task,
    env_cfg=make_env_cfg(),
    play_env_cfg=make_env_cfg(play=True),
    rl_cfg=RL_CFG,
    runner_cls=MicroduckOnPolicyRunner,
)
```

`src/microduck_challenges/__init__.py` gains, under the docstring:

```python
from .sprint_2m import tasks as _sprint_2m  # noqa: F401
```

`README.md` table: replace the placeholder row with `| sprint_2m | sprint-2m | Mjlab-Sprint2m-MicroDuck |`.

- [ ] **Step 6: Run the tests**

Run: `uv run --no-config --frozen --group workshop pytest -q`
Expected: all pass (2 package + 5 sprint).

- [ ] **Step 7: The task is visible to `train`**

Run: `uv run --no-config --frozen train --help 2>&1 | grep -o 'Mjlab-Sprint2m-MicroDuck' | head -1`
Expected: `Mjlab-Sprint2m-MicroDuck`. (If `train --help` lists tasks differently in mjlab 1.3.0, use `uv run --no-config --frozen python -c "import microduck_challenges; from mjlab.tasks.registry import list_tasks; print('Mjlab-Sprint2m-MicroDuck' in list_tasks())"` → `True`.)

- [ ] **Step 8: Commit**

```bash
git add src tests README.md
git commit -m "sprint-2m: the velocity task on flat ground, three rewards exposed"
```

---

### Task 4: swag-contest

**Files:**
- Create: `src/microduck_challenges/swag_contest/__init__.py` (empty), `challenge.toml`, `env.py`, `tasks.py`
- Modify: `src/microduck_challenges/__init__.py`, `README.md`, `tests/test_challenges.py` (one `CHALLENGES` row)

**Interfaces:**
- Consumes: as Task 3; the `CHALLENGES` table in `tests/test_challenges.py`.
- Produces: `microduck_challenges.swag_contest.env.make_env_cfg(play: bool = False)`, `RL_CFG`.

The swag contest runs the sprint's lane at a fixed 0.25 m/s and is judged by votes: style, not speed. The starting point is the same walking task; the knobs are the ones that change how the walk looks.

- [ ] **Step 1: Add the row and see it fail**

In `tests/test_challenges.py`, add to `CHALLENGES`:

```python
    "swag_contest": {
        "step_reward": ("air_time", 5.2),
        "upright_reward": ("upright", 0.9),
        "head_reward": ("head_pose_tracking", 2.6),
    },
```

Run: `uv run --no-config --frozen --group workshop pytest tests/test_challenges.py -q -k swag`
Expected: FAIL (`FileNotFoundError: …/swag_contest/challenge.toml`).

- [ ] **Step 2: `challenge.toml`**

Read the source's `head_pose_tracking` weight first: `sed -n 705,720p ~/Projects/HuggingFace/microduck_rl/src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py`. Use that weight as `head_reward`'s `value`, `min = 0.0`, `max` = twice the value (rounded up to a whole number).

```toml
# The Swag Contest: walk the 2 m lane at 0.25 m/s with style; visitors vote.
# Nothing is timed. Make the walk yours.
event = "swag-contest"
task  = "Mjlab-SwagContest-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.step_reward]
label = "Lift your feet"
value = 3.0
min   = 0.0
max   = 6.0

[params.upright_reward]
label = "Stay upright"
value = 2.0
min   = 0.5
max   = 5.0

[params.head_reward]
label = "Head follows its command"
value = <the source's head_pose_tracking weight>
min   = 0.0
max   = <twice that, rounded up>
```

- [ ] **Step 3: `env.py`**

Same copy and the same five edits as Task 3 Step 4, with these differences:
- Docstring first line `"""The Swag Contest's training environment: Microduck walking on flat ground.`; in the paragraph, "made the sprint's own" → "made the swag contest's own", "the three rewards a novice tunes" stays.
- `experiment_name="swag_contest",  # logs/rsl_rl/swag_contest/`, `run_name="swag_contest",`; `make_env_cfg`'s docstring `"""The swag contest's training environment."""`.
- Knobs: `upright` ← `knobs["upright_reward"]`, `air_time` ← `knobs["step_reward"]`, and in the `cfg.rewards["head_pose_tracking"] = RewardTermCfg(` block (source line 710) `weight=<number>` → `weight=knobs["head_reward"]`. `track_linear_velocity` keeps its `2.0`.

- [ ] **Step 4: `tasks.py`, package, README**

`src/microduck_challenges/swag_contest/tasks.py`: identical to sprint's `tasks.py` except its docstring says "the swag contest's task".

`src/microduck_challenges/__init__.py`: add `from .swag_contest import tasks as _swag_contest  # noqa: F401`.

README row: `| swag_contest | swag-contest | Mjlab-SwagContest-MicroDuck |`.

- [ ] **Step 5: Run the tests**

Run: `uv run --no-config --frozen --group workshop pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src tests README.md
git commit -m "swag-contest: the walking task with the style knobs exposed"
```

---

### Task 5: hill-climb-1m5

**Files:**
- Create: `src/microduck_challenges/hill_climb_1m5/__init__.py` (empty), `challenge.toml`, `env.py`, `tasks.py`
- Modify: `src/microduck_challenges/__init__.py`, `README.md`, `tests/test_challenges.py`

**Interfaces:**
- Consumes: as Task 3.
- Produces: `microduck_challenges.hill_climb_1m5.env.make_env_cfg(play: bool = False)`, `RL_CFG`, `HILL_TERRAIN_SLOPE_MIN = 0.03`.

The hill climb is a 1.5 m lane at 8°. The source's rough branch already trains on generated terrain with a soft contact fix and more solver iterations; the challenge keeps that branch only and swaps the generator for one made of slopes, up to a steepest slope the novice sets (default 10°: a margin over the course's 8°).

- [ ] **Step 1: Add the row and the slope test; see them fail**

In `tests/test_challenges.py`, add to `CHALLENGES`:

```python
    "hill_climb_1m5": {
        "forward_reward": ("track_linear_velocity", 3.7),
        "upright_reward": ("upright", 1.3),
        "step_reward": ("air_time", 4.1),
        "max_slope_deg": (None, 12.0),
    },
```

and at the end of the file:

```python
def test_the_hill_trains_on_slopes_up_to_the_knob(tmp_path, monkeypatch):
    toml = ROOT / "hill_climb_1m5" / "challenge.toml"
    copy = tmp_path / "challenge.toml"
    copy.write_text(_set_value(toml.read_text(), "max_slope_deg", 12.0))
    real_params = challenge.params
    monkeypatch.setattr(challenge, "params", lambda f: real_params(copy))
    from microduck_challenges.hill_climb_1m5.env import make_env_cfg

    terrain = make_env_cfg().scene.terrain
    assert terrain.terrain_type == "generator"
    slope = terrain.terrain_generator.sub_terrains["slope"]
    assert math.isclose(slope.slope_range[1], math.tan(math.radians(12.0)))
    assert slope.slope_range[1] > math.tan(math.radians(8.0)), "must cover the course's 8°"
```

Run: `uv run --no-config --frozen --group workshop pytest tests/test_challenges.py -q -k hill`
Expected: FAIL (no `hill_climb_1m5/challenge.toml`).

- [ ] **Step 2: `challenge.toml`**

```toml
# The 1.5 m Hill Climb: walk up an 8° lane as fast as possible. The Arena races
# the policy at forward commands from 0.15 to 1.00 m/s and keeps its best.
event = "hill-climb-1m5"
task  = "Mjlab-HillClimb1m5-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]
label = "Speed reward"
value = 2.0
min   = 0.5
max   = 5.0

[params.upright_reward]
label = "Stay upright"
value = 2.0
min   = 0.5
max   = 5.0

[params.step_reward]
label = "Lift your feet"
value = 3.0
min   = 0.0
max   = 6.0

[params.max_slope_deg]
label = "Steepest training slope (°)"
value = 10.0
min   = 8.0
max   = 15.0
```

- [ ] **Step 3: `env.py` — copy, keep the rough branch only, slopes instead of boxes**

```bash
cp ~/Projects/HuggingFace/microduck_rl/src/mjlab_microduck/tasks/microduck_velocity_env_cfg.py src/microduck_challenges/hill_climb_1m5/env.py
```

Edits (source line numbers):

1. **Docstring**: first line `"""The 1.5 m Hill Climb's training environment: Microduck walking up slopes.`, then the same paragraph as the sprint's with "made the sprint's own: flat ground only" → "made the hill climb's own: generated slopes only, as steep as a knob says". Keep the rest.
2. **Terrain generator.** Keep the three terrain imports (lines 89–91) and `_soften_terrain_contacts` (lines 172–190: the heightfield sits in the same `terrain` body, and the flat patches are boxes). Replace `MICRODUCK_ROUGH_TERRAINS_CFG` and its comment (lines 125–169) with:

   ```python
   # Gentlest slope of the generator (rise/run, ≈1.7°); the steepest comes from
   # challenge.toml. Heightfield pyramids with the platform on TOP: the robot spawns
   # on the flat platform and walks down/up/across the slope as commands resample.
   # vertical_scale=0.001 keeps quantization steps at 1 mm so a slope is smooth
   # instead of a staircase of 5 mm ledges.
   HILL_TERRAIN_SLOPE_MIN = 0.03


   def _hill_terrain(max_slope_deg: float) -> TerrainGeneratorCfg:
       return TerrainGeneratorCfg(
           size=(8.0, 8.0),
           border_width=20.0,
           num_rows=10,
           num_cols=20,
           sub_terrains={
               "flat": terrain_gen.BoxFlatTerrainCfg(proportion=0.2),
               "slope": terrain_gen.HfPyramidSlopedTerrainCfg(
                   proportion=0.8,
                   slope_range=(HILL_TERRAIN_SLOPE_MIN, math.tan(math.radians(max_slope_deg))),
                   platform_width=2.0,
                   vertical_scale=0.001,
               ),
           },
           add_lights=False,
       )
   ```

3. **Only the rough branch.** Delete the `rough` parameter. Replace the `# Terrain` block (lines 747–774) with the body of its `else:` branch dedented one level, with `MICRODUCK_ROUGH_TERRAINS_CFG` → `_hill_terrain(knobs["max_slope_deg"])` and the comment `# Terrain: generated slopes (the course is an 8° lane).` above it; keep its comments (soften contacts, `nconmax`, iterations) and the `if play:` lines. Replace lines 888–889 (`if not rough:` / `del cfg.curriculum["terrain_levels"]`) with nothing: the terrain-level curriculum stays, as in the source's rough task. `grep -n rough env.py` then shows only comments that describe rough box terrain in `_soften_terrain_contacts` (reword "[rough terrain]" in its print to "[hill terrain]").
4. **Names**: `make_env_cfg`, docstring `"""The hill climb's training environment."""`; `RL_CFG` with `experiment_name="hill_climb_1m5",  # logs/rsl_rl/hill_climb_1m5/`, `run_name="hill_climb_1m5",`.
5. **Knobs**: exactly as Task 3 Step 4 item 4 (`knobs = challenge.params(__file__)` first; `upright`, `air_time`, `track_linear_velocity`), plus `max_slope_deg` used in item 3.

- [ ] **Step 4: `tasks.py`, package, README**

`tasks.py` as sprint's, docstring "the hill climb's task". Package: `from .hill_climb_1m5 import tasks as _hill_climb_1m5  # noqa: F401`. README row: `| hill_climb_1m5 | hill-climb-1m5 | Mjlab-HillClimb1m5-MicroDuck |`.

- [ ] **Step 5: Run the tests**

Run: `uv run --no-config --frozen --group workshop pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src tests README.md
git commit -m "hill-climb-1m5: walking on generated slopes, the steepest one a knob"
```

---

### Task 6: roller-sprint-2m

**Files:**
- Create: `src/microduck_challenges/roller_sprint_2m/__init__.py` (empty), `challenge.toml`, `env.py`, `tasks.py`
- Modify: `src/microduck_challenges/__init__.py`, `README.md`, `tests/test_challenges.py`

**Interfaces:**
- Consumes: as Task 3.
- Produces: `microduck_challenges.roller_sprint_2m.env.make_env_cfg(play: bool = False)`, `RL_CFG`.

- [ ] **Step 1: Add the row; see it fail**

```python
    "roller_sprint_2m": {
        "speed_reward": ("wheel_speed", 13.5),
        "upright_reward": ("upright", 1.3),
    },
```

Run: `uv run --no-config --frozen --group workshop pytest tests/test_challenges.py -q -k roller`
Expected: FAIL (no `roller_sprint_2m/challenge.toml`).

- [ ] **Step 2: `challenge.toml`**

```toml
# The 2 m Roller Sprint: skate a flat 2 m lane on roller blades as fast as
# possible. The Arena races the policy at forward commands from 0.30 to 2.00
# and keeps its best.
event = "roller-sprint-2m"
task  = "Mjlab-RollerSprint2m-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.speed_reward]
label = "Wheel speed reward"
value = 10.0
min   = 2.0
max   = 20.0

[params.upright_reward]
label = "Stay upright"
value = 2.0
min   = 0.5
max   = 5.0
```

- [ ] **Step 3: `env.py`**

```bash
cp ~/Projects/HuggingFace/microduck_rl/src/mjlab_microduck/tasks/microduck_velocity_rollers_env_cfg.py src/microduck_challenges/roller_sprint_2m/env.py
```

Edits (source line numbers):

1. **Docstring** (lines 1–27): first line `"""The 2 m Roller Sprint's training environment: Microduck on roller skates.`, then a blank line and:

   ```
   A complete copy of microduck_rl's roller velocity task
   (microduck_velocity_rollers_env_cfg.py), made the roller sprint's own: the two
   rewards a novice tunes are read from challenge.toml ([params]). Everything here
   is yours to change; the robot (MICRODUCK_WALK_ROLLERS_ROBOT_CFG) and the reward
   functions (microduck_mdp) come from mjlab_microduck and are not edited here.
   ```

   then keep the source's docstring from its second paragraph on.
2. **No import from another task.** Delete `from mjlab_microduck.tasks.microduck_velocity_env_cfg import HEAD_BODY_NAMES` (line 81) and define it locally, after the module constants (before the `from mjlab…` imports block, next to `IMU_ORIENTATION_RANDOMIZATION_ANGLE`), with the walking env's comment (source `microduck_velocity_env_cfg.py` lines 60–72, minus the `HEAD_COM_RANDOMIZATION_RANGE` line):

   ```python
   # The head assembly's bodies, for the head CoM randomization. The head-roll
   # body is named bottom_head_shell in the walk model and jaw_soft in the
   # 2026-07 roller model, hence the alternation. NOTE: bearing_roll is NOT a
   # head body — in both models it is the right-hip-yaw link (child of
   # trunk_base); it has always been listed here by mistake and is kept only to
   # preserve existing DR behavior.
   HEAD_BODY_NAMES = (
       "neck",
       "neck_pitch",
       "yaw_roll_motion",
       "(bottom_head_shell|jaw_soft)",
       "bearing_roll",
   )
   ```
3. **Names**: `make_microduck_velocity_rollers_env_cfg` → `make_env_cfg` (docstring `"""The roller sprint's training environment."""`); `MicroduckRollersRlCfg` → `RL_CFG`, `experiment_name="roller_sprint_2m",  # logs/rsl_rl/roller_sprint_2m/`, `run_name="roller_sprint_2m",`.
4. **Knobs**: `from mjlab_microduck import challenge`; `knobs = challenge.params(__file__)` first in `make_env_cfg`; `cfg.rewards["upright"].weight = 2.0` (line 182) → `= knobs["upright_reward"]`; in the `cfg.rewards["wheel_speed"] = RewardTermCfg(` block (line 253) `weight=10.0,` → `weight=knobs["speed_reward"],`.
5. `grep -n "tasks.microduck_" env.py` prints nothing.

- [ ] **Step 4: `tasks.py`, package, README**

`tasks.py` as sprint's, docstring "the roller sprint's task". Package: `from .roller_sprint_2m import tasks as _roller_sprint_2m  # noqa: F401`. README row: `| roller_sprint_2m | roller-sprint-2m | Mjlab-RollerSprint2m-MicroDuck |`.

- [ ] **Step 5: Run the tests**

Run: `uv run --no-config --frozen --group workshop pytest -q`
Expected: all pass (`test_the_robot_matches_the_events_rig[roller_sprint_2m]` included).

- [ ] **Step 6: Commit**

```bash
git add src tests README.md
git commit -m "roller-sprint-2m: the roller velocity task, wheel speed and posture exposed"
```

---

### Task 7: The checkout is what an HF job needs

**Files:** none changed unless a check fails (then fix in the file the failure names, test first).

**Interfaces:**
- Consumes: everything above; `mjlab_microduck.hf_jobs._build_tarball(repo_root: Path, out_path: Path) -> str`.
- Produces: the evidence plan 4's Train panel builds on: `train <task> --hf-jobs` from this checkout is intercepted, and the job would receive this repo, its lock, and nothing ignored.

- [ ] **Step 1: The submission is intercepted and dry-runs**

```bash
export HF_TOKEN=$(cat ~/.cache/huggingface/token)
uv run --no-config --frozen train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 64 \
    --agent.max-iterations 2 --agent.logger tensorboard --agent.run-name probe \
    --hf-jobs --no-wandb --namespace "$(hf auth whoami | head -1 | awk '{print $NF}')" --dry-run
```

Expected: `[dry-run] would submit job:` with `TRAIN_ARGS` starting `Mjlab-Sprint2m-MicroDuck`, and a provenance `repo`/`commit` naming this checkout (not `microduck_rl`). No job is created. (If `hf auth whoami` prints differently, pass your username by hand.)

- [ ] **Step 2: The tarball holds the repo and its lock, never ignored files**

```bash
mkdir -p logs/rsl_rl/sprint_2m/fake && touch logs/rsl_rl/sprint_2m/fake/model_0.pt
uv run --no-config --frozen python - <<'EOF'
import tarfile, tempfile
from pathlib import Path
from mjlab_microduck.hf_jobs import _build_tarball
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "src.tar.gz"
    _build_tarball(Path.cwd(), out)
    names = tarfile.open(out).getnames()
for must in ("pyproject.toml", "uv.lock", "src/microduck_challenges/sprint_2m/challenge.toml"):
    assert any(n.endswith(must) for n in names), must
assert not [n for n in names if "logs/" in n or ".venv/" in n], "ignored files shipped"
print("tarball ok:", len(names), "files")
EOF
rm -rf logs
```

Expected: `tarball ok: <n> files`.

- [ ] **Step 3: The job's `uv sync`, reproduced on the real lock**

A cold cache, uv 0.11.30 (the job's), the tarball's content, no `--frozen`, default groups only:

```bash
J=/private/tmp/challenges-job && rm -rf $J && mkdir -p $J
git archive HEAD | tar -x -C $J
cd $J && UV_CACHE_DIR=$J/.cache uvx --no-config --from uv==0.11.30 uv lock --check --no-config; echo "lock-check exit=$?"
cd - && rm -rf $J
```

Expected: `lock-check exit=0` (the lock is current and every source, the private wheel included, resolves with `HF_TOKEN`). A full `uv sync` here would install the Mac's wheels, not the job's; the lock check is the part that fetches the `workshop` wheel's metadata, which Task 1 Step 4 proved is what a cold job sync does.

- [ ] **Step 4: A real job — only with the owner's go-ahead**

It costs HF Jobs credits (a few minutes on `l4x1`). Ask the owner. If yes:

```bash
uv run --no-config --frozen train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 512 \
    --agent.max-iterations 10 --agent.logger tensorboard --agent.run-name smoke \
    --hf-jobs --no-wandb --namespace <owner> --timeout 30m
```

Expected in the followed log: `[bootstrap] uv sync` passes, training prints iterations 0–9, `[bootstrap] uploaded exported/policy.onnx`. Record the job id and the checkpoint repo in the report: plan 4 reads that repo's layout.

- [ ] **Step 5: Commit if anything changed; report**

If Steps 1–4 needed a fix, it was committed with its test. Report: the four challenges, test count, the lock's `mjlab-microduck` commit, and Step 4's job id or "not run".

---

## After this plan (the owner's)

- When microduck_rl#57 merges: `mjlab-microduck`'s source → `branch = "develop"`, `uv lock --no-config`, commit.

- Create `pollen-robotics/microduck-challenges` on GitHub (**private** while the Arena is), `git remote add origin …`, `git push -u origin main`. The one line (plan 4) clones it.
- When the Arena's GitHub repo goes public: switch the `microduck-arena` source to the release URL (see the comment in `pyproject.toml`), `uv lock --no-config`, commit; make this repo public; delete `pollen-robotics/microduck-arena-wheels`.
- A new Arena version (plan 4 ships 0.3.0) means a new wheel on the Hub repo, the source's file name bumped, and a re-lock.
- **Working example**: before a challenge counts as open, Pollen trains its `env.py` unchanged with its `[recipe]` and enters the result (spec, *The `microduck-challenges` repo*). That is a training run per challenge, not code; the runbook schedules it.
