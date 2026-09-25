# `microduck_rl` recipe publishing — implementation plan (plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `microduck_rl` records what trained every run, publishes a run from its log directory with the checkpoint, the accessories, the challenge's event and a *Reproduce* block, exposes its tools as `microduck <command>`, and can be driven from another repo (the future `microduck-challenges`) without any of its current commands changing behaviour.

**Architecture:** Additive pieces in the `mjlab_microduck` package: `provenance.py` (written at train start by the runner subclass this repo already registers for every task, read by `publish --run`); `challenge.py` (a challenge registers its `challenge.toml` — event, task, kind, recipe, params — so `publish` needs only `--repo`); accessories read from the robot model's MjSpec (`roller_blade` mesh ⇒ rollers); `cli.py` (`microduck train | play | list-envs | export | publish | check | infer`, delegating to the existing entry points with `argv[0]` rewritten so the import-time hooks still fire); `publish/check.py` (what `publish` verifies, without the Hub); two script-to-module moves (`hf_uploader`, `infer`) with shims left in `scripts/`. The HF Jobs bootstrap calls modules, not repo scripts, and the job receives the submitter's checkout so a cloud run is as reproducible as a local one.

**Tech Stack:** Python 3.12, `uv`, tyro, mjlab 1.3.0 / rsl_rl, mujoco (MjSpec), huggingface_hub, pytest (CPU only, no GPU in any test).

**Spec:** `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md` in `microduck-arena`, sections *Changes to `microduck_rl`* and *What reproducibility means here*, plus the owner's additions of 2026-09-25 (unified CLI, accessories in the manifest, challenge registration). This plan is executed in a checkout of `pollen-robotics/microduck_rl` at `~/Projects/HuggingFace/microduck_rl` (clone it, branch `develop`), not in the arena repo.

## Global Constraints

- Every change is additive. `uv run train`, `uv run play`, `uv run publish --onnx …`, `uv run publish --task … --wandb-run-path …`, `uv run scripts/export.py`, `uv run scripts/infer_policy.py`, `uv run scripts/hf/train_hf.py` and `train … --hf-jobs` keep their exact behaviour, flags and outputs. New manifest keys are added; none is renamed or removed; `robot.model` stays `"microduck"`. Existing tests are not edited except where a file they load moves (Task 8), and then only the loading line.
- No new dependency. `tomllib`, `importlib.metadata`, `subprocess`, `json`, `os` are standard library; mujoco is already a dependency.
- Tests run on CPU without mjlab's registry, torch or a network: `uv run --with pytest pytest tests/<file> -v` from the repo root. Anything that would import torch or mjlab's registry is behind a function boundary that tests monkeypatch.
- `requires-python = ">=3.12, <3.13"` stays as is.
- The `training` block of a published manifest keeps every key it has today (`repo`, `commit`, `branch`, `dirty`, `task_id`, `run`, `checkpoint`, `source_file`, `exported`); new keys (`command`, `seed`, `base`, `started`) are added.
- The `--hf-jobs` and provenance hooks fire at import of `mjlab_microduck.tasks` and key on `Path(sys.argv[0]).name == "train"`; anything that runs the trainer under another name must rewrite `sys.argv[0]` **before** importing anything from `mjlab`.
- Commit messages: one imperative line, as in `git log` (e.g. `Record run provenance at train start`).

## Review Focus

- A `train` started outside a git checkout (an HF Jobs container extracts a tarball with no `.git`): `provenance.json` must still be written, from the submitter's checkout when the job carries it and without `repo`/`commit` otherwise, and `publish --run` must publish either with a README that has no *Reproduce* block rather than a half one. Pinned in Task 1 (`test_outside_git_records_no_checkout`, `test_a_job_falls_back_to_the_submitters_checkout`), Task 3 (`test_no_reproduce_block_without_a_commit`) and Task 7 (`test_submit_hands_the_job_its_checkout`).
- `play` (or `export`) constructing the runner on an existing run must never overwrite the run's `provenance.json`. Pinned in Task 1 (`test_written_once`) and Task 2 (`test_runner_records_only_when_invoked_as_train`).
- `microduck train …` must behave exactly like `uv run train …`, hooks included: `argv[0]` is rewritten to `train` before mjlab is imported. Pinned in Task 9 (`test_train_is_delegated_with_argv0_rewritten`, `test_the_hooks_see_train`).
- `publish --run --checkpoint 999` for an iteration the run never saved, and `publish --run` on a run that has not saved a checkpoint yet, must fail with the path named, before any export. Pinned in Task 6 (`test_missing_checkpoint_is_named`, `test_a_run_without_checkpoints_is_refused`).
- A manifest claiming an accessory the robot does not know (`["skis"]`) must be refused by `validate_manifest`, the way a wrong `obs_len` is; a legacy manifest without `robot.accessories` stays valid. Pinned in Task 5 (`test_an_unknown_accessory_is_refused`, `test_absence_of_accessories_is_not_evidence`).

---

### Task 1: `provenance.py` — what trained a run

**Files:**
- Create: `src/mjlab_microduck/provenance.py`
- Test: `tests/test_provenance.py`

**Interfaces:**
- Produces:
  - `FILE = "provenance.json"`, `JOB_ENV = "MICRODUCK_PROVENANCE"`
  - `checkout(cwd: Path | None = None) -> dict[str, Any]` — `{"repo", "commit", "branch", "dirty"}` of the git checkout at `cwd` (default: the process's working directory); `{}` outside git; `repo` absent when there is no `origin` remote.
  - `base() -> str` — `"mjlab-microduck <version>"`, plus `" @ <commit9>"` when the package was installed from git.
  - `record_run_start(log_dir: Path, *, argv: list[str], seed: int | None, cwd: Path | None = None) -> Path | None` — writes `log_dir/provenance.json` once; returns the path, or `None` when the file already exists. Outside git, falls back to the JSON in `$MICRODUCK_PROVENANCE` (what `hf_jobs.submit` hands a job, Task 7).
  - `read(log_dir: Path) -> dict[str, Any]` — the record; `FileNotFoundError` naming the path when absent.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_provenance.py
"""`provenance.json` is what turns "here is my model" into "here is how I got it".

Written once, at the start of a training run, from the checkout `train` runs in (the
working directory's repo — a challenges checkout, not this library), so the commit it
names is the code that trained, whatever is published later.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from mjlab_microduck import provenance


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A one-commit checkout with an `origin` pointing at a fork."""
    root = tmp_path / "challenges"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "t")
    (root / "challenge.toml").write_text("event = 'sprint-2m'\n")
    _git(root, "add", ".")
    _git(root, "commit", "-q", "-m", "first")
    _git(root, "remote", "add", "origin", "https://github.com/alice/microduck-challenges")
    return root


def test_checkout_names_the_fork_commit_and_cleanliness(repo):
    got = provenance.checkout(repo)
    assert got["repo"] == "https://github.com/alice/microduck-challenges"
    assert got["commit"] == _git(repo, "rev-parse", "--short=9", "HEAD")
    assert got["branch"] == "main"
    assert got["dirty"] is False


def test_a_modified_tracked_file_is_dirty(repo):
    (repo / "challenge.toml").write_text("event = 'hill-climb-1m5'\n")
    assert provenance.checkout(repo)["dirty"] is True


def test_no_origin_records_no_repo(repo):
    _git(repo, "remote", "remove", "origin")
    got = provenance.checkout(repo)
    assert "repo" not in got and got["commit"]


def test_outside_git_records_no_checkout(tmp_path, monkeypatch):
    monkeypatch.delenv(provenance.JOB_ENV, raising=False)
    assert provenance.checkout(tmp_path) == {}
    path = provenance.record_run_start(tmp_path / "run", argv=["train", "T"], seed=1, cwd=tmp_path)
    got = json.loads(path.read_text())
    assert "commit" not in got and got["command"] == ["train", "T"]


def test_a_job_falls_back_to_the_submitters_checkout(tmp_path, monkeypatch):
    """Inside an HF Job the tarball has no .git; submit() hands over the checkout it came from."""
    monkeypatch.setenv(provenance.JOB_ENV, json.dumps(
        {"repo": "https://github.com/alice/microduck-challenges", "commit": "abc123def", "branch": "main", "dirty": False}
    ))
    path = provenance.record_run_start(tmp_path / "run", argv=["train", "T"], seed=1, cwd=tmp_path)
    got = json.loads(path.read_text())
    assert got["commit"] == "abc123def" and got["repo"].endswith("microduck-challenges")


def test_base_names_this_package():
    assert provenance.base().startswith("mjlab-microduck ")


def test_record_run_start_writes_the_recipe(repo, tmp_path):
    log_dir = tmp_path / "logs" / "rsl_rl" / "velocity" / "2026-09-25_10-00-00_first"
    argv = ["/x/.venv/bin/train", "Mjlab-Velocity-Flat-MicroDuck", "--env.scene.num-envs", "4096"]
    path = provenance.record_run_start(log_dir, argv=argv, seed=7, cwd=repo)
    assert path == log_dir / provenance.FILE
    got = json.loads(path.read_text())
    assert got["command"] == ["train", "Mjlab-Velocity-Flat-MicroDuck", "--env.scene.num-envs", "4096"]
    assert got["task"] == "Mjlab-Velocity-Flat-MicroDuck"
    assert got["seed"] == 7
    assert got["repo"] == "https://github.com/alice/microduck-challenges"
    assert got["dirty"] is False
    assert got["base"].startswith("mjlab-microduck ")
    assert got["started"].endswith("Z")


def test_command_starts_with_bare_train(tmp_path):
    path = provenance.record_run_start(tmp_path / "run", argv=["/a/b/train-script.py", "T"], seed=1, cwd=tmp_path)
    assert json.loads(path.read_text())["command"][0] == "train"


def test_written_once(tmp_path):
    log_dir = tmp_path / "run"
    first = provenance.record_run_start(log_dir, argv=["train", "T"], seed=1, cwd=tmp_path)
    before = first.read_text()
    assert provenance.record_run_start(log_dir, argv=["train", "T", "--other"], seed=2, cwd=tmp_path) is None
    assert first.read_text() == before, "a second construction of the runner (play, export) must not rewrite it"


def test_read_names_the_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError, match="provenance.json"):
        provenance.read(tmp_path / "run")
    provenance.record_run_start(tmp_path / "run", argv=["train", "T"], seed=3, cwd=tmp_path)
    assert provenance.read(tmp_path / "run")["seed"] == 3
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_provenance.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mjlab_microduck.provenance'`

- [ ] **Step 3: Write the module**

```python
# src/mjlab_microduck/provenance.py
"""What trained a run, written when the run starts.

`train` writes `provenance.json` into the run's log directory the moment the runner is built
(tasks/__init__.py), from the git checkout it runs IN — the working directory's repo, which
is a challenges checkout when this package is a dependency — so the commit it names is the
code that trained, whatever the tree looks like when someone publishes weeks later.
`publish --run` reads it back and puts it in the manifest's `training` block.

Inside an HF Job there is no checkout: the tarball has no `.git`. `hf_jobs.submit` hands the
job the checkout it was built from, as JSON in `MICRODUCK_PROVENANCE`, and that is used then.

Standard library only: this runs inside `train`, and must cost nothing there.
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path
from typing import Any

FILE = "provenance.json"
JOB_ENV = "MICRODUCK_PROVENANCE"
_PACKAGE = "mjlab-microduck"


def _git(root: Path, *args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), *args], capture_output=True, text=True, check=True, timeout=10
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip()


def checkout(cwd: Path | None = None) -> dict[str, Any]:
    """`repo`, `commit`, `branch`, `dirty` of the checkout at `cwd`; `{}` outside git."""
    root = Path(cwd or Path.cwd())
    commit = _git(root, "rev-parse", "--short=9", "HEAD")
    if commit is None:
        return {}
    record: dict[str, Any] = {
        "commit": commit,
        "branch": _git(root, "rev-parse", "--abbrev-ref", "HEAD"),
        "dirty": bool(_git(root, "status", "--porcelain", "--untracked-files=no")),
    }
    remote = _git(root, "remote", "get-url", "origin")
    if remote:
        record["repo"] = remote
    return record


def _from_job() -> dict[str, Any]:
    raw = os.environ.get(JOB_ENV)
    return json.loads(raw) if raw else {}


def base() -> str:
    """This package's version, with its git commit when it was installed from git."""
    try:
        dist = distribution(_PACKAGE)
    except PackageNotFoundError:
        return f"{_PACKAGE} (not installed)"
    text = f"{_PACKAGE} {dist.version}"
    raw = dist.read_text("direct_url.json")
    commit = (json.loads(raw).get("vcs_info") or {}).get("commit_id") if raw else None
    return f"{text} @ {commit[:9]}" if commit else text


def record_run_start(
    log_dir: Path, *, argv: list[str], seed: int | None, cwd: Path | None = None
) -> Path | None:
    """Write the run's `provenance.json` once. Returns None when it already exists."""
    path = Path(log_dir) / FILE
    if path.exists():
        return None
    record: dict[str, Any] = {
        # argv[0] is the console script's absolute path; the recipe says `uv run train …`.
        "command": ["train", *argv[1:]],
        "task": argv[1] if len(argv) > 1 else None,
        "seed": seed,
        **(checkout(cwd) or _from_job()),
        "base": base(),
        "started": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2) + "\n")
    return path


def read(log_dir: Path) -> dict[str, Any]:
    path = Path(log_dir) / FILE
    if not path.exists():
        raise FileNotFoundError(f"{path}: no provenance; this run was not started by `train`")
    return json.loads(path.read_text())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_provenance.py -v`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add src/mjlab_microduck/provenance.py tests/test_provenance.py
git commit -m "Add run provenance: the checkout, command and seed that trained a run"
```

---

### Task 2: `train` records provenance when the runner is built

**Files:**
- Modify: `src/mjlab_microduck/tasks/__init__.py:1-25` (the `MicroduckOnPolicyRunner` class)
- Test: `tests/test_provenance.py` (append)

**Interfaces:**
- Consumes: `provenance.record_run_start` (Task 1); `train_hook._invoked_as_train()` (exists: true when `argv[0]` is the `train` script).
- Produces: every task registered with `runner_cls=MicroduckOnPolicyRunner` (all of this repo's, and a challenge's when it registers the same way) gets `logs/rsl_rl/<experiment>/<stamp>_<run>/provenance.json` at train start.

Context for the implementer: mjlab's `train` builds the runner as `runner_cls(env, agent_cfg_dict, str(log_dir), device)` with `log_dir = logs/rsl_rl/<experiment_name>/<YYYY-mm-dd_HH-MM-SS>[_<run_name>]`; `export.py` builds it as `runner_cls(env, asdict(agent_cfg), device=device)` with no `log_dir`; mjlab's `play` builds it with the loaded run's directory. Only the first must write. `train_cfg["seed"]` is `RslRlBaseRunnerCfg.seed`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_provenance.py`:

```python
def test_runner_records_only_when_invoked_as_train(tmp_path, monkeypatch):
    """The hook is a one-liner in the runner; check it by calling the same helper the runner does."""
    import sys

    from mjlab_microduck.tasks import _record_if_training

    log_dir = tmp_path / "run"
    monkeypatch.setattr(sys, "argv", ["/v/bin/play", "Mjlab-Velocity-Flat-MicroDuck"])
    _record_if_training(str(log_dir), {"seed": 4})
    assert not (log_dir / provenance.FILE).exists(), "play must not write a run's provenance"

    monkeypatch.setattr(sys, "argv", ["/v/bin/train", "Mjlab-Velocity-Flat-MicroDuck"])
    _record_if_training(None, {"seed": 4})
    assert not (log_dir / provenance.FILE).exists(), "export builds the runner with no log_dir"

    _record_if_training(str(log_dir), {"seed": 4})
    assert provenance.read(log_dir)["seed"] == 4


def test_the_runner_calls_the_hook():
    """`MicroduckOnPolicyRunner.__init__` is what every task registers; the hook must sit there."""
    import inspect

    from mjlab_microduck.tasks import MicroduckOnPolicyRunner

    assert "_record_if_training(log_dir, train_cfg)" in inspect.getsource(MicroduckOnPolicyRunner.__init__)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_provenance.py -v -k "runner or hook"`
Expected: FAIL — `ImportError: cannot import name '_record_if_training'`

(Importing `mjlab_microduck.tasks` imports mjlab and the task configs on CPU; the existing `tests/test_velstand_cfg.py` does the same, so this is within the current test budget.)

- [ ] **Step 3: Add the hook**

In `src/mjlab_microduck/tasks/__init__.py`, after the existing imports at the top of the file (`from mjlab.tasks.registry import register_mjlab_task` / `from mjlab.tasks.velocity.rl import VelocityOnPolicyRunner`) add:

```python
import sys
from pathlib import Path

from mjlab_microduck import provenance
from mjlab_microduck.train_hook import _invoked_as_train


def _record_if_training(log_dir, train_cfg: dict) -> None:
    """`train` gives the runner a log_dir; play and export do not, or are not `train`."""
    if log_dir is None or not _invoked_as_train():
        return
    provenance.record_run_start(Path(log_dir), argv=sys.argv, seed=train_cfg.get("seed"))
```

and as the last line of `MicroduckOnPolicyRunner.__init__` (after the `symmetry_cfg` copy):

```python
        _record_if_training(log_dir, train_cfg)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_provenance.py tests/test_hf_jobs_flag.py -v`
Expected: all passed (the hf-jobs tests prove the import-time interception still fires with the new imports in place).

- [ ] **Step 5: Commit**

```bash
git add src/mjlab_microduck/tasks/__init__.py tests/test_provenance.py
git commit -m "Record run provenance when train builds the runner"
```

---

### Task 3: The README's *Reproduce* block

**Files:**
- Modify: `src/mjlab_microduck/publish/manifest.py` (`render_readme`, ~line 330-370)
- Test: `tests/test_publish_manifest.py` (append)

**Interfaces:**
- Consumes: a `training` dict that may carry `command: list[str]`, `repo`, `commit`, `seed`, `base`, `started` (Task 6 fills them).
- Produces: `render_readme(manifest, repo_id)` appends `## Reproduce` when `training` has `command`, `repo` and `commit`; lists `seed`, `base`, `started` under `## Training` when present. Output for a manifest without those keys is byte-identical to today.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_publish_manifest.py`:

```python
def _manifest_with_training(training: dict) -> dict:
    return m.build_manifest(
        name="sprint", kind="perpetual", description="Walks fast.", slot="walk", training=training
    )


def test_the_readme_reproduces_a_recorded_run():
    readme = m.render_readme(_manifest_with_training({
        "task_id": "Mjlab-Sprint2m-MicroDuck",
        "repo": "https://github.com/alice/microduck-challenges",
        "commit": "3f9c2d1ab",
        "branch": "main",
        "dirty": False,
        "command": ["train", "Mjlab-Sprint2m-MicroDuck", "--env.scene.num-envs", "4096", "--agent.seed", "7"],
        "seed": 7,
        "base": "mjlab-microduck 0.1.0 @ 8a1b2c3d4",
        "started": "2026-09-25T10:00:00Z",
    }), "alice/microduck-sprint")
    assert "## Reproduce" in readme
    assert "git clone https://github.com/alice/microduck-challenges" in readme
    assert "cd microduck-challenges" in readme
    assert "git checkout 3f9c2d1ab" in readme
    assert "uv run train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 4096 --agent.seed 7" in readme
    assert "comparable policy, not the same weights" in readme
    assert "- **seed**: `7`" in readme
    assert "- **base**: `mjlab-microduck 0.1.0 @ 8a1b2c3d4`" in readme


def test_no_reproduce_block_without_a_commit():
    """A run trained outside git (an HF Jobs tarball) has a command but nothing to check out."""
    readme = m.render_readme(_manifest_with_training({
        "task_id": "T", "command": ["train", "T"], "seed": 1,
    }), "alice/microduck-sprint")
    assert "## Reproduce" not in readme
    assert "- **seed**: `1`" in readme


def test_a_readme_without_a_command_is_unchanged():
    """The existing publish paths never set `command`; their README must not grow a block."""
    readme = m.render_readme(_manifest_with_training({
        "task_id": "T", "repo": "pollen-robotics/microduck_rl", "commit": "abc", "branch": "develop", "dirty": False,
    }), "alice/microduck-sprint")
    assert "## Reproduce" not in readme
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v -k "reproduce or unchanged"`
Expected: `test_the_readme_reproduces_a_recorded_run` FAILS on `"## Reproduce" in readme`; the other two pass already (they pin the absence).

- [ ] **Step 3: Extend `render_readme`**

In `src/mjlab_microduck/publish/manifest.py`, add `import shlex` next to the other imports, then replace the tail of `render_readme` (from `if training:` to the `return`) with:

```python
    if training:
        lines += ["", "## Training", ""]
        for key in ("task_id", "repo", "branch", "commit", "run", "checkpoint", "seed", "base", "started", "exported"):
            if key in training:
                lines.append(f"- **{key}**: `{training[key]}`")
        if training.get("dirty"):
            lines.append("- exported from a checkout with uncommitted changes")
    if training.get("command") and training.get("repo") and training.get("commit"):
        # Same code, same lock file, same command, same seed: the recipe in full. What it does
        # not promise is the same weights — GPU RL is not bit-reproducible across machines.
        clone_dir = Path(training["repo"].rstrip("/")).name.removesuffix(".git")
        lines += [
            "",
            "## Reproduce",
            "",
            "Same code, same `uv.lock`, same command, same seed. Training it again yields a "
            "comparable policy, not the same weights: GPU reinforcement learning is not "
            "bit-reproducible across machines.",
            "",
            "```bash",
            f"git clone {training['repo']}",
            f"cd {clone_dir}",
            f"git checkout {training['commit']}",
            "uv sync",
            "uv run " + " ".join(shlex.quote(str(a)) for a in training["command"]),
            "```",
        ]
    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run the whole publish test file to verify nothing else moved**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v`
Expected: all passed, including the pre-existing `test_the_readme_tells_the_owner_how_to_run_it`.

- [ ] **Step 5: Commit**

```bash
git add src/mjlab_microduck/publish/manifest.py tests/test_publish_manifest.py
git commit -m "Add a Reproduce block to the model card of a recorded run"
```

---

### Task 4: `challenge.py` — a challenge registers its contract

**Files:**
- Create: `src/mjlab_microduck/challenge.py`
- Test: `tests/test_challenge.py`

**Interfaces:**
- Produces:
  - `FILE = "challenge.toml"`
  - `@dataclass(frozen=True) Challenge(folder: Path, event: str, task: str, kind: str, recipe: dict[str, Any])`
  - `load(tasks_file: str | Path) -> Challenge` — parses the `challenge.toml` beside `tasks_file`; `FileNotFoundError` naming the path; `ValueError` naming a missing key or an unknown `kind`.
  - `register(tasks_file) -> Challenge` — `load` plus an entry in the registry, keyed by task id. A challenge's `tasks.py` calls it at import, next to `register_mjlab_task`.
  - `for_task(task_id: str) -> Challenge | None`.
  - `params(tasks_file) -> dict[str, float]` — the `value` of each `[params.<name>]`; `ValueError` naming a knob without one. A challenge's `env.py` calls `params(__file__)`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_challenge.py
"""A challenge folder (in microduck-challenges) carries its contract in challenge.toml, beside
its tasks.py: the Arena event, the mjlab task, the kind publish writes, the first recipe, and the
knobs a novice may tune. tasks.py registers it; env.py reads the knobs. Neither the workshop nor
a shell user passes any of it on a command line."""

from pathlib import Path

import pytest

from mjlab_microduck import challenge as ch

TOML = """
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
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
value = 1
"""


@pytest.fixture(autouse=True)
def _clean_registry(monkeypatch):
    monkeypatch.setattr(ch, "_REGISTRY", {})


def _folder(tmp_path: Path, toml: str = TOML) -> Path:
    folder = tmp_path / "sprint_2m"
    folder.mkdir()
    (folder / "challenge.toml").write_text(toml)
    (folder / "tasks.py").write_text("")
    (folder / "env.py").write_text("")
    return folder


def test_load_reads_the_contract(tmp_path):
    folder = _folder(tmp_path)
    got = ch.load(folder / "tasks.py")
    assert got == ch.Challenge(
        folder=folder, event="sprint-2m", task="Mjlab-Sprint2m-MicroDuck", kind="perpetual",
        recipe={"num_envs": 4096, "max_iterations": 3000, "seed": 1},
    )


def test_register_makes_the_task_findable(tmp_path):
    folder = _folder(tmp_path)
    assert ch.for_task("Mjlab-Sprint2m-MicroDuck") is None
    ch.register(folder / "tasks.py")
    assert ch.for_task("Mjlab-Sprint2m-MicroDuck").event == "sprint-2m"
    assert ch.for_task("Mjlab-Velocity-Flat-MicroDuck") is None, "a library task belongs to no challenge"


def test_params_reads_each_knobs_value_as_a_float(tmp_path):
    assert ch.params(_folder(tmp_path) / "env.py") == {"forward_reward": 2.0, "upright_reward": 1.0}


def test_a_challenge_without_knobs_or_recipe_has_none(tmp_path):
    folder = _folder(tmp_path, 'event = "sprint-2m"\ntask = "T"\nkind = "perpetual"\n')
    assert ch.params(folder / "env.py") == {}
    assert ch.load(folder / "tasks.py").recipe == {}


def test_a_missing_file_is_named(tmp_path):
    with pytest.raises(FileNotFoundError, match="challenge.toml"):
        ch.load(tmp_path / "elsewhere" / "tasks.py")


@pytest.mark.parametrize("toml, why", [
    ('task = "T"\nkind = "perpetual"\n', "event"),
    ('event = "e"\nkind = "perpetual"\n', "task"),
    ('event = "e"\ntask = "T"\n', "kind"),
    ('event = "e"\ntask = "T"\nkind = "forever"\n', "forever"),
])
def test_a_wrong_contract_is_named(tmp_path, toml, why):
    with pytest.raises(ValueError, match=why):
        ch.load(_folder(tmp_path, toml) / "tasks.py")


def test_a_knob_without_a_value_is_named(tmp_path):
    with pytest.raises(ValueError, match="params.forward_reward"):
        ch.params(_folder(tmp_path, TOML.replace("value = 2.0\n", "")) / "env.py")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_challenge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mjlab_microduck.challenge'`

- [ ] **Step 3: Write the module**

```python
# src/mjlab_microduck/challenge.py
"""A challenge's contract, read from the `challenge.toml` beside its code.

A challenge (a folder in `microduck-challenges`) keeps its training env in `env.py`, its
registration in `tasks.py`, and its contract in `challenge.toml` next to them:

    event = "sprint-2m"                  # the Arena event it trains for
    task  = "Mjlab-Sprint2m-MicroDuck"   # the mjlab task tasks.py registers
    kind  = "perpetual"                  # what publish writes in the manifest
    [recipe]                             # train's arguments for the first run
    num_envs = 4096
    [params.forward_reward]              # a knob a novice tunes from the workshop
    label = "Speed reward"
    value = 2.0
    min = 0.5
    max = 5.0

`tasks.py` calls `register(__file__)` next to mjlab's `register_mjlab_task`, so `publish`
finds the event and the kind from the task id and needs only `--repo`. `env.py` calls
`params(__file__)` and builds its config from the values; the workshop and a shell user edit
the same file, so both train the same thing.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mjlab_microduck.publish.manifest import KINDS

FILE = "challenge.toml"


@dataclass(frozen=True)
class Challenge:
    folder: Path
    event: str
    task: str
    kind: str
    recipe: dict[str, Any] = field(default_factory=dict)


_REGISTRY: dict[str, Challenge] = {}


def _table(tasks_file: str | Path) -> tuple[Path, dict[str, Any]]:
    path = Path(tasks_file).resolve().parent / FILE
    if not path.exists():
        raise FileNotFoundError(f"{path}: a challenge's code sits next to its {FILE}")
    return path, tomllib.loads(path.read_text())


def load(tasks_file: str | Path) -> Challenge:
    path, table = _table(tasks_file)
    for key in ("event", "task", "kind"):
        if key not in table:
            raise ValueError(f"{path}: no `{key}`")
    if table["kind"] not in KINDS:
        raise ValueError(f"{path}: kind must be one of {KINDS}, not {table['kind']!r}")
    return Challenge(
        folder=path.parent,
        event=str(table["event"]),
        task=str(table["task"]),
        kind=str(table["kind"]),
        recipe=dict(table.get("recipe", {})),
    )


def register(tasks_file: str | Path) -> Challenge:
    """Called by a challenge's tasks.py at import; `publish` then knows the task's contract."""
    found = load(tasks_file)
    _REGISTRY[found.task] = found
    return found


def for_task(task_id: str) -> Challenge | None:
    return _REGISTRY.get(task_id)


def params(tasks_file: str | Path) -> dict[str, float]:
    """`{name: value}` for every `[params.<name>]` in the challenge.toml beside `tasks_file`."""
    path, table = _table(tasks_file)
    values: dict[str, float] = {}
    for name, knob in table.get("params", {}).items():
        if "value" not in knob:
            raise ValueError(f"{path}: params.{name} has no value")
        values[name] = float(knob["value"])
    return values
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_challenge.py -v`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add src/mjlab_microduck/challenge.py tests/test_challenge.py
git commit -m "Add challenge: a challenge registers its contract from the challenge.toml beside it"
```

---

### Task 5: Accessories in the manifest, read from the robot model

**Files:**
- Modify: `src/mjlab_microduck/publish/manifest.py` (`ROBOT`, `build_manifest`, `validate_manifest`, `render_readme`; new `ACCESSORIES`, `accessories_of`)
- Test: `tests/test_publish_manifest.py` (append)

**Interfaces:**
- Produces:
  - `ACCESSORIES: tuple[str, ...] = ("rollers",)` — what the robot can wear.
  - `accessories_of(spec) -> tuple[str, ...]` — from a `mujoco.MjSpec`: `("rollers",)` when any mesh is named `roller…` (only `robot_groundcontact_rollers*.xml` carries `roller_blade`), else `()`.
  - `build_manifest(…, accessories: tuple[str, ...] = (), arena: dict[str, Any] | None = None)` — writes `robot.accessories` (a list, possibly empty) and, when given, a top-level `arena` block (`{"event": …}`, what `arena recover` in the Arena reads).
  - `validate_manifest` refuses an accessory outside `ACCESSORIES`; a manifest without `robot.accessories` stays valid.
  - The README's header line names the accessories when there are any: `… 50 Hz), on rollers.`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_publish_manifest.py`:

```python
def test_accessories_are_read_from_the_robot_model():
    import mujoco

    bare = mujoco.MjSpec()
    bare.add_mesh().name = "left_shell"
    assert m.accessories_of(bare) == ()
    wheeled = mujoco.MjSpec()
    wheeled.add_mesh().name = "left_shell"
    wheeled.add_mesh().name = "roller_blade"
    assert m.accessories_of(wheeled) == ("rollers",)


def test_the_manifest_says_what_the_robot_wears():
    manifest = m.build_manifest(name="glide", kind="perpetual", description="Glides.", slot="walk",
                                accessories=("rollers",), arena={"event": "roller-sprint-2m"})
    assert manifest["robot"]["accessories"] == ["rollers"]
    assert manifest["robot"]["model"] == "microduck", "the daemon refuses any other model name"
    assert manifest["arena"] == {"event": "roller-sprint-2m"}
    m.validate_manifest(manifest)
    plain = m.build_manifest(name="walk", kind="perpetual", description="Walks.", slot="walk")
    assert plain["robot"]["accessories"] == [] and "arena" not in plain
    assert "on rollers" in m.render_readme(manifest, "alice/microduck-glide")
    assert "on rollers" not in m.render_readme(plain, "alice/microduck-walk")


def test_an_unknown_accessory_is_refused():
    manifest = m.build_manifest(name="ski", kind="perpetual", description="Skis.", slot="walk")
    manifest["robot"]["accessories"] = ["skis"]
    with pytest.raises(m.ManifestError, match="skis"):
        m.validate_manifest(manifest)


def test_absence_of_accessories_is_not_evidence():
    m.validate_manifest(FLAMINGO)  # the community manifest predates the field
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v -k "accessor or wears"`
Expected: FAIL — `AttributeError: module … has no attribute 'accessories_of'`; `TypeError: build_manifest() got an unexpected keyword argument 'accessories'`.

- [ ] **Step 3: Implement**

In `src/mjlab_microduck/publish/manifest.py`:

After `ROBOT: dict[str, Any] = {...}` add:

```python
# What the robot can wear, as the manifest's `robot.accessories` says it. Read from the robot
# model itself (`accessories_of`), so a challenge that builds its own config from the roller
# model is described right without declaring anything.
ACCESSORIES: tuple[str, ...] = ("rollers",)


def accessories_of(spec) -> tuple[str, ...]:
    """`("rollers",)` when the MjSpec carries the passive wheels' mesh, else `()`."""
    if any(mesh.name.startswith("roller") for mesh in spec.meshes):
        return ("rollers",)
    return ()
```

In `build_manifest`'s signature add, after `eval: dict[str, Any] | None = None`:

```python
    accessories: tuple[str, ...] = (),
    arena: dict[str, Any] | None = None,
```

and in its body: build `robot = dict(ROBOT); robot["accessories"] = list(accessories)` and use `"robot": robot` in the manifest dict instead of `"robot": dict(ROBOT)`; after the `if eval:` block add:

```python
    if arena:
        manifest["arena"] = dict(arena)
```

In `validate_manifest`, after the `robot.model` check:

```python
    worn = (manifest.get("robot") or {}).get("accessories")
    if worn is not None:
        unknown = [a for a in worn if a not in ACCESSORIES]
        if unknown:
            raise ManifestError(f"robot.accessories {unknown}: this robot wears only {list(ACCESSORIES)}")
```

In `render_readme`, change the header line so it ends with the accessories when present:

```python
    worn = (manifest.get("robot") or {}).get("accessories") or []
    wearing = f", on {' and '.join(worn)}" if worn else ""
    lines = [
        ...
        f"A **{kind}** policy for the [microduck](https://github.com/pollen-robotics/microduck) "
        f"({OBS_LEN}-D observation, {ACTION_LEN} actions, {ROBOT['control_hz']} Hz{wearing}). {timing}",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v`
Expected: all passed. (`test_constants_are_the_daemons` and the FLAMINGO/OFFICIAL_SET tests still pass: `ROBOT` itself is unchanged, the field is added per manifest.)

- [ ] **Step 5: Commit**

```bash
git add src/mjlab_microduck/publish/manifest.py tests/test_publish_manifest.py
git commit -m "Say what the robot wears: robot.accessories read from the model, and an arena.event block"
```

---

### Task 6: `publish --run <log dir>` — only `--repo` needed for a challenge

**Files:**
- Modify: `src/mjlab_microduck/publish/cli.py`
- Modify: `README.md` (section *Publishing a policy*)
- Test: `tests/test_publish_manifest.py` (append)

**Interfaces:**
- Consumes: `provenance.read`, `provenance.FILE` (Task 1); `render_readme`, `accessories_of`, `build_manifest(accessories=, arena=)` (Tasks 3, 5); `challenge.for_task` (Task 4); `mjlab_microduck.export.run_export` (exists; behind `_export_checkpoint`, monkeypatched in tests).
- Produces:
  - `PublishConfig.kind` becomes optional (`Literal["episodic", "perpetual"] | None = None`): required unless the task belongs to a registered challenge.
  - `PublishConfig.run: str | None = None`, `PublishConfig.allow_dirty: bool = False`, `PublishConfig.accessories: tuple[str, ...] = ()` (for `--onnx`; with a task it is read from the model).
  - `_export_checkpoint(task: str, checkpoint: Path, out: Path, device: str | None) -> Path` and `_accessories_of_task(task: str) -> tuple[str, ...]` — the only places `--run`/`--task` touch mjlab; tests replace them.
  - `_pick_checkpoint(run_dir: Path, iteration: int | None) -> Path`.
  - The staged repo of a `--run` publish holds `policy.onnx`, `checkpoint.pt`, `manifest.json`, `README.md`.
  - The manifest's `training` for `--run`: `repo`, `commit`, `branch`, `dirty` (when recorded), `command`, `seed`, `base`, `started`, `task_id`, `checkpoint` (iteration), `source_file` (`model_<N>.pt`); `robot.accessories` from the task's model; `arena.event` when the task is a registered challenge's.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_publish_manifest.py`:

```python
def _run_dir(tmp_path: Path, *, dirty: bool = False, iterations=(100, 250), with_checkout: bool = True,
             task: str = "Mjlab-Sprint2m-MicroDuck") -> Path:
    """A finished local run: provenance from `train`, two checkpoints."""
    run = tmp_path / "logs" / "rsl_rl" / "sprint" / "2026-09-25_10-00-00_first"
    run.mkdir(parents=True)
    record = {
        "command": ["train", task, "--agent.seed", "7"],
        "task": task,
        "seed": 7,
        "base": "mjlab-microduck 0.1.0",
        "started": "2026-09-25T10:00:00Z",
    }
    if with_checkout:
        record |= {
            "repo": "https://github.com/alice/microduck-challenges",
            "commit": "3f9c2d1ab", "branch": "main", "dirty": dirty,
        }
    (run / "provenance.json").write_text(json.dumps(record))
    for n in iterations:
        (run / f"model_{n}.pt").write_bytes(b"checkpoint %d" % n)
    return run


@pytest.fixture
def fake_mjlab(monkeypatch, tmp_path):
    """Stand in for the GPU export and the registry: records what was asked, writes a tiny policy,
    says the sprint task's robot wears nothing and the roller task's wears rollers."""
    from mjlab_microduck.publish import cli

    calls = []

    def _export(task, checkpoint, out, device):
        calls.append((task, Path(checkpoint).name))
        return _tiny_policy(out)

    monkeypatch.setattr(cli, "_export_checkpoint", _export)
    monkeypatch.setattr(cli, "_accessories_of_task", lambda task: ("rollers",) if "Roller" in task else ())
    return calls


@pytest.fixture
def sprint_challenge(tmp_path, monkeypatch):
    from mjlab_microduck import challenge as ch

    monkeypatch.setattr(ch, "_REGISTRY", {})
    folder = tmp_path / "sprint_2m"
    folder.mkdir()
    (folder / "challenge.toml").write_text(
        'event = "sprint-2m"\ntask = "Mjlab-Sprint2m-MicroDuck"\nkind = "perpetual"\n'
    )
    (folder / "tasks.py").write_text("")
    return ch.register(folder / "tasks.py")


def test_publish_run_needs_only_the_repo_for_a_challenge(tmp_path, monkeypatch, fake_mjlab, sprint_challenge):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), dry_run=True)) == 0
    assert fake_mjlab == [("Mjlab-Sprint2m-MicroDuck", "model_250.pt")], "latest checkpoint by default"
    out = tmp_path / "publish-sprint"
    assert (out / "policy.onnx").exists()
    assert (out / "checkpoint.pt").read_bytes() == b"checkpoint 250"
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["kind"] == "perpetual", "from the challenge, not a flag"
    assert manifest["arena"] == {"event": "sprint-2m"}
    assert manifest["robot"]["accessories"] == []
    training = manifest["training"]
    assert training["repo"] == "https://github.com/alice/microduck-challenges"
    assert training["commit"] == "3f9c2d1ab"
    assert training["command"] == ["train", "Mjlab-Sprint2m-MicroDuck", "--agent.seed", "7"]
    assert training["seed"] == 7 and training["base"] == "mjlab-microduck 0.1.0"
    assert training["task_id"] == "Mjlab-Sprint2m-MicroDuck"
    assert training["checkpoint"] == 250 and training["source_file"] == "model_250.pt"
    readme = (out / "README.md").read_text()
    assert "## Reproduce" in readme and "git checkout 3f9c2d1ab" in readme


def test_publish_run_of_a_library_task_needs_kind_and_reads_accessories(tmp_path, monkeypatch, fake_mjlab, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, task="Mjlab-Velocity-Flat-MicroDuck-Rollers")
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-glide", run=str(run_dir), dry_run=True))
    assert "--kind" in capsys.readouterr().err
    assert run(PublishConfig(repo="alice/microduck-glide", run=str(run_dir), kind="perpetual", slot="walk",
                             dry_run=True)) == 0
    manifest = json.loads((tmp_path / "publish-glide" / "manifest.json").read_text())
    assert manifest["robot"]["accessories"] == ["rollers"] and "arena" not in manifest


def test_publish_run_picks_the_asked_checkpoint(tmp_path, monkeypatch, fake_mjlab, sprint_challenge):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), checkpoint=100, dry_run=True)) == 0
    assert fake_mjlab == [("Mjlab-Sprint2m-MicroDuck", "model_100.pt")]
    assert (tmp_path / "publish-sprint" / "checkpoint.pt").read_bytes() == b"checkpoint 100"


def test_a_dirty_run_is_refused_unless_allowed(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, dirty=True)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), dry_run=True))
    assert "uncommitted changes" in capsys.readouterr().err
    assert fake_mjlab == [], "refused before any export"
    assert run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), dry_run=True, allow_dirty=True)) == 0
    assert json.loads((tmp_path / "publish-sprint" / "manifest.json").read_text())["training"]["dirty"] is True


def test_missing_checkpoint_is_named(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), checkpoint=999, dry_run=True))
    assert "model_999.pt" in capsys.readouterr().err
    assert fake_mjlab == []


def test_a_run_without_checkpoints_is_refused(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, iterations=())
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), dry_run=True))
    assert "no model_<N>.pt" in capsys.readouterr().err


def test_a_run_trained_outside_git_publishes_without_a_recipe(tmp_path, monkeypatch, fake_mjlab, sprint_challenge):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, with_checkout=False)
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), dry_run=True)) == 0
    training = json.loads((tmp_path / "publish-sprint" / "manifest.json").read_text())["training"]
    assert "commit" not in training and training["command"][0] == "train"
    assert "## Reproduce" not in (tmp_path / "publish-sprint" / "README.md").read_text()


def test_run_is_a_source_of_its_own(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", run=str(run_dir), onnx="x.onnx", dry_run=True))
    assert "--run" in capsys.readouterr().err


def test_an_onnx_publish_takes_accessories_from_the_flag(tmp_path, monkeypatch):
    from mjlab_microduck.publish.cli import PublishConfig, run

    policy = _tiny_policy(tmp_path / "out.onnx")
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="someone/microduck-glide", kind="perpetual", slot="walk", onnx=str(policy),
                             accessories=("rollers",), dry_run=True)) == 0
    manifest = json.loads((tmp_path / "publish-glide" / "manifest.json").read_text())
    assert manifest["robot"]["accessories"] == ["rollers"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v -k "publish_run or dirty_run or missing_checkpoint or without_checkpoints or outside_git or source_of_its_own or accessories_from_the_flag"`
Expected: FAIL — `AttributeError: … has no attribute '_export_checkpoint'` (the fixture), then `TypeError: unexpected keyword argument 'run'`.

- [ ] **Step 3: Implement `--run`**

In `src/mjlab_microduck/publish/cli.py`:

`PublishConfig`: make `kind` optional —

```python
    kind: Literal["episodic", "perpetual"] | None = None
    """episodic: runs `duration_s` and comes back on its own. perpetual: holds until told.
    Required, unless the task belongs to a registered challenge (its challenge.toml says)."""
```

add after `onnx`:

```python
    run: str | None = None
    """A local training run's log directory (`logs/rsl_rl/<experiment>/<stamp>_<name>/`). Reads
    its provenance.json, exports its latest checkpoint (or --checkpoint N) and uploads that
    checkpoint next to policy.onnx. A source of its own: not with --onnx or --wandb-run-path."""
    accessories: tuple[str, ...] = ()
    """--onnx only: what the robot wears, e.g. rollers. With a task it is read from the model."""
```

and after `force`:

```python
    allow_dirty: bool = False
    """--run only: publish a run started from a checkout with uncommitted changes anyway."""
```

Update the module docstring with a new first example:

```
    # From a local run (the workshop's path): the challenge's kind and event, the latest
    # checkpoint exported and uploaded too, the recipe in the model card
    uv run publish --run logs/rsl_rl/sprint/2026-09-25_10-00-00_first --repo <user>/microduck-sprint
```

Imports: add `import re` and `from mjlab_microduck import challenge as ch, provenance`. After `_fail`, add:

```python
_CHECKPOINT = re.compile(r"model_(\d+)\.pt$")

# Kept for the manifest, in this order; `command`, `seed`, `base` and `started` are the recipe.
_RECIPE_KEYS = ("repo", "commit", "branch", "dirty", "command", "seed", "base", "started")


def _iteration(path: Path) -> int:
    match = _CHECKPOINT.search(path.name)
    return int(match.group(1)) if match else -1


def _pick_checkpoint(run_dir: Path, iteration: int | None) -> Path:
    if iteration is not None:
        path = run_dir / f"model_{iteration}.pt"
        if not path.exists():
            _fail(f"{path}: no such checkpoint in this run")
        return path
    found = sorted(run_dir.glob("model_*.pt"), key=_iteration)
    if not found:
        _fail(f"{run_dir}: no model_<N>.pt yet; the run has not saved a checkpoint")
    return found[-1]


def _export_checkpoint(task: str, checkpoint: Path, out: Path, device: str | None) -> Path:
    """The one call that needs mjlab and torch; tests stand it in."""
    import mjlab.tasks  # noqa: F401  (populates the registry, and the challenge registry with it)
    from mjlab_microduck.export import ExportConfig, run_export

    return run_export(
        task,
        ExportConfig(onnx_file=str(out), checkpoint_file=str(checkpoint), num_envs=1, device=device),
    ).onnx_path


def _accessories_of_task(task: str) -> tuple[str, ...]:
    """What the task's robot model wears, from its MjSpec; needs mjlab's registry."""
    import mjlab.tasks  # noqa: F401
    from mjlab.tasks.registry import load_env_cfg

    return m.accessories_of(load_env_cfg(task, play=True).scene.entities["robot"].spec_fn())


def _resolve_run(cfg: PublishConfig, workdir: Path) -> tuple[Path, dict, Path]:
    """The ONNX exported from a local run, its recipe, and the checkpoint it came from."""
    if cfg.onnx or cfg.wandb_run_path or cfg.checkpoint_file:
        _fail("--run is a source of its own; drop --onnx, --wandb-run-path and --checkpoint-file")
    run_dir = Path(cfg.run)  # type: ignore[arg-type]
    try:
        record = provenance.read(run_dir)
    except FileNotFoundError as e:
        _fail(str(e))
    if record.get("dirty") and not cfg.allow_dirty:
        _fail(
            f"{run_dir.name} was started from a checkout with uncommitted changes, so commit "
            f"{record.get('commit')} is not the code that trained it. Commit and train again, "
            "or --allow-dirty to publish it as is."
        )
    task = cfg.task or record.get("task")
    if not task:
        _fail("provenance.json names no task; pass --task <id>")
    checkpoint = _pick_checkpoint(run_dir, cfg.checkpoint)
    onnx_path = _export_checkpoint(task, checkpoint, workdir / m.POLICY_FILE, cfg.device)
    training: dict = {k: record[k] for k in _RECIPE_KEYS if k in record}
    training["task_id"] = task
    training["checkpoint"] = _iteration(checkpoint)
    training["source_file"] = checkpoint.name
    return onnx_path, training, checkpoint
```

In `run()`, replace `onnx_path, training = _resolve_weights(cfg, workdir)` with:

```python
        checkpoint: Path | None = None
        if cfg.run is not None:
            onnx_path, training, checkpoint = _resolve_run(cfg, workdir)
        else:
            onnx_path, training = _resolve_weights(cfg, workdir)

        # The task's contract, when it is a challenge's: kind and event come from its
        # challenge.toml (registered when mjlab imported the task), not from flags.
        task_id = training.get("task_id")
        found = ch.for_task(task_id) if task_id else None
        kind = cfg.kind or (found.kind if found else None)
        if kind is None:
            _fail("--kind is required (episodic or perpetual) unless the task belongs to a registered challenge")
        accessories = tuple(cfg.accessories) if cfg.onnx is not None else _accessories_of_task(task_id)
```

then in the `build_manifest(...)` call use `kind=kind` instead of `kind=cfg.kind`, and add `accessories=accessories, arena={"event": found.event} if found else None,`. After `shutil.copyfile(onnx_path, staged / m.POLICY_FILE)` add:

```python
        if checkpoint is not None:
            shutil.copyfile(checkpoint, staged / "checkpoint.pt")
```

Change the dry-run message to list what was staged:

```python
            print(f"[publish] dry run: wrote {dest}/ ({', '.join(sorted(p.name for p in dest.iterdir()))})")
```

and the commit message to use `kind` (`f"publish {name}: {kind}, …"`). `_resolve_weights` is not touched: the `--onnx` and `--task` paths run the code they run today; the `--task` path now also reads accessories from the model, which is the one added key.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v`
Expected: all passed, `test_the_cli_dry_run_writes_a_repo` included (it passes `kind=` explicitly, and its dry-run line now reads `(README.md, manifest.json, policy.onnx)`; it asserts files, not the line).

- [ ] **Step 5: Document it**

In `README.md`, section *Publishing a policy*, add as the first example in the code block:

```bash
# From a local run — kind and Arena event from the challenge's challenge.toml, the recipe
# (commit, command, seed) from the run's provenance.json, the latest checkpoint exported and
# uploaded next to policy.onnx. A library task (no challenge) still takes --kind.
uv run publish --run logs/rsl_rl/sprint/2026-09-25_10-00-00_first --repo <user>/microduck-sprint
```

and after the paragraph starting "Before anything is uploaded, `publish` checks…" add:

```markdown
Every `uv run train` writes `provenance.json` into its log directory: the command, the seed,
the commit, branch and dirty flag of the checkout it ran in, and this package's version.
`publish --run` puts that in the manifest's `training` block and ends the model card with a
*Reproduce* section. A run started on a dirty tree is refused (`--allow-dirty` to override):
the published recipe should be the code that trained. `robot.accessories` says what the
robot wore (`["rollers"]` for the roller tasks), read from the task's model; give
`--accessories rollers` with `--onnx`.
```

- [ ] **Step 6: Commit**

```bash
git add src/mjlab_microduck/publish/cli.py tests/test_publish_manifest.py README.md
git commit -m "Publish a local run: --run exports, records the recipe, uploads the checkpoint, reads the challenge"
```

---

### Task 7: The HF Jobs bootstrap calls modules, and the job knows its checkout

**Files:**
- Move: `scripts/hf/uploader.py` → `src/mjlab_microduck/hf_uploader.py` (git mv), then recreate `scripts/hf/uploader.py` as a shim
- Modify: `src/mjlab_microduck/hf_jobs.py` (`BOOTSTRAP` string, the docstring line mentioning `scripts/hf/uploader.py`, and `submit`'s `env` dict)
- Modify: `scripts/hf/README.md` (the line mentioning `scripts/hf/uploader.py`)
- Test: `tests/test_hf_jobs_flag.py` (append)

**Interfaces:**
- Consumes: `provenance.checkout`, `provenance.JOB_ENV` (Task 1).
- Produces: `python -m mjlab_microduck.hf_uploader` (same env vars as today: `CKPT_REPO`, `CKPT_POLL_INTERVAL`, `CKPT_ROOT`, `CKPT_ONE_SHOT`); `python -m mjlab_microduck.export <task> …` (already works); `BOOTSTRAP` contains no `scripts/` path; `hf_jobs.job_provenance(repo_root: Path) -> dict[str, str]` — `{JOB_ENV: <json of checkout(repo_root)>}`, or `{}` outside git — merged into the job's `env` by `submit`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_hf_jobs_flag.py`:

```python
def test_the_bootstrap_runs_modules_not_repo_scripts():
    """The job extracts a tarball of WHATEVER repo `train --hf-jobs` ran in — a challenges
    checkout has no scripts/ of ours — so the bootstrap must reach our code as modules."""
    from mjlab_microduck import hf_jobs

    assert "scripts/" not in hf_jobs.BOOTSTRAP
    assert "python -m mjlab_microduck.hf_uploader" in hf_jobs.BOOTSTRAP
    assert "python -m mjlab_microduck.export" in hf_jobs.BOOTSTRAP


def test_the_uploader_is_a_module_and_the_script_delegates():
    from mjlab_microduck import hf_uploader

    assert callable(hf_uploader.main)
    shim = (_ROOT / "scripts" / "hf" / "uploader.py").read_text()
    assert "from mjlab_microduck.hf_uploader import main" in shim


def test_the_uploader_module_refuses_to_run_without_a_repo():
    env = {k: v for k, v in os.environ.items() if k != "CKPT_REPO"}
    proc = subprocess.run(
        [sys.executable, "-m", "mjlab_microduck.hf_uploader"], capture_output=True, text=True, env=env
    )
    assert proc.returncode == 1 and "CKPT_REPO" in proc.stdout


def test_submit_hands_the_job_its_checkout(tmp_path):
    """Inside the job there is no .git; provenance.json must still name the commit that trained."""
    import json

    from mjlab_microduck import hf_jobs, provenance

    assert hf_jobs.job_provenance(tmp_path) == {}, "outside git there is nothing to hand over"
    env = hf_jobs.job_provenance(_ROOT)
    record = json.loads(env[provenance.JOB_ENV])
    assert record["commit"] and "dirty" in record
    source = (_ROOT / "src" / "mjlab_microduck" / "hf_jobs.py").read_text()
    assert "**job_provenance(repo_root)" in source, "submit() must merge job_provenance(repo_root) into the job's env"
```

Add `import os` to the file's imports (`subprocess` and `sys` are already imported).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_hf_jobs_flag.py -v -k "bootstrap or uploader or checkout"`
Expected: FAIL — `assert "scripts/" not in hf_jobs.BOOTSTRAP`; `ImportError: cannot import name 'hf_uploader'`; `AttributeError: … no attribute 'job_provenance'`.

- [ ] **Step 3: Move the uploader and write the shim**

```bash
git mv scripts/hf/uploader.py src/mjlab_microduck/hf_uploader.py
```

Edit the docstring at the top of `src/mjlab_microduck/hf_uploader.py` so its second paragraph reads:

```
Run as `python -m mjlab_microduck.hf_uploader` from the job bootstrap (a module, because the
job's tarball may be a dependent repo with no scripts/ of ours), with auth coming from the
HF_TOKEN secret injected by `hf jobs run`. `scripts/hf/uploader.py` still runs it by path.
```

Create `scripts/hf/uploader.py`:

```python
"""Kept so `uv run python scripts/hf/uploader.py` keeps working; the watcher lives in
mjlab_microduck.hf_uploader, which the HF Jobs bootstrap runs as a module."""

import sys

from mjlab_microduck.hf_uploader import main

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Point the bootstrap at the modules and hand the job its checkout**

In `src/mjlab_microduck/hf_jobs.py`, in `BOOTSTRAP`, change the three lines:

```
nohup uv run python scripts/hf/uploader.py > /tmp/uploader.log 2>&1 &
```
→
```
nohup uv run python -m mjlab_microduck.hf_uploader > /tmp/uploader.log 2>&1 &
```

```
CKPT_ONE_SHOT=1 uv run python scripts/hf/uploader.py || true
```
→
```
CKPT_ONE_SHOT=1 uv run python -m mjlab_microduck.hf_uploader || true
```

```
        uv run python scripts/export.py "$TASK_ID" \
```
→
```
        uv run python -m mjlab_microduck.export "$TASK_ID" \
```

In the same file's docstring, change `(scripts/hf/uploader.py)` to `(mjlab_microduck.hf_uploader)`. Add `import json` and `from mjlab_microduck import provenance` to its imports, and above `submit`:

```python
def job_provenance(repo_root: Path) -> dict[str, str]:
    """The checkout the tarball came from, for the job's provenance.json — it has no .git."""
    record = provenance.checkout(repo_root)
    return {provenance.JOB_ENV: json.dumps(record)} if record else {}
```

In `submit`, extend the `env` dict literal:

```python
    env: dict[str, str] = {
        # Disarms the --hf-jobs interception inside the job, so the job's own
        # `uv run train` can only ever train locally (see train_hook.py).
        "MICRODUCK_IN_HF_JOB": "1",
        "CKPT_REPO": ckpt_repo,
        "TRAIN_ARGS": " ".join(shlex.quote(a) for a in [args.task, *train_args]),
        # The commit that trained, since the tarball carries no .git.
        **job_provenance(repo_root),
    }
```

In `scripts/hf/README.md`, change `starts `scripts/hf/uploader.py` in background` to `starts the checkpoint uploader (`python -m mjlab_microduck.hf_uploader`) in background`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_hf_jobs_flag.py -v`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add -A scripts/hf src/mjlab_microduck/hf_uploader.py src/mjlab_microduck/hf_jobs.py tests/test_hf_jobs_flag.py
git commit -m "Run the HF Jobs uploader and export as modules; hand the job the checkout that trained"
```

---

### Task 8: `infer` as a declared script

**Files:**
- Move: `scripts/infer_policy.py` → `src/mjlab_microduck/infer.py`; `scripts/odom_anchor_sets.json` → `src/mjlab_microduck/odom_anchor_sets.json` (git mv both; `infer.py` locates the JSON relative to `__file__`, so the pair stays valid)
- Create: `scripts/infer_policy.py` (shim)
- Modify: `pyproject.toml` (`[project.scripts]`), `scripts/odom_anchor_points.py:34` (`DEFAULT_JSON`) and its docstring line 21, `tests/test_infer_policy_bam.py` (the `ip` fixture's loading lines only), `README.md` and `AGENTS.md` (mention `uv run infer` next to the script)
- Test: `tests/test_publish_manifest.py` (append one declared-script test, same shape as `test_publish_is_a_declared_script`)

**Interfaces:**
- Produces: `uv run infer --walking out.onnx` ≡ `uv run scripts/infer_policy.py --walking out.onnx`; `mjlab_microduck.infer.main`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_publish_manifest.py`, next to `test_publish_is_a_declared_script`:

```python
def test_infer_is_a_declared_script():
    """A challenges checkout has no scripts/ of ours; the rehearsal must be reachable as `uv run infer`."""
    pyproject = tomllib.loads((_ROOT / "pyproject.toml").read_text())
    assert pyproject["project"]["scripts"].get("infer") == "mjlab_microduck.infer:main"
    shim = (_ROOT / "scripts" / "infer_policy.py").read_text()
    assert "from mjlab_microduck.infer import main" in shim
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v -k infer_is_a_declared`
Expected: FAIL — `assert None == "mjlab_microduck.infer:main"`

- [ ] **Step 3: Move the files and write the shim**

```bash
git mv scripts/infer_policy.py src/mjlab_microduck/infer.py
git mv scripts/odom_anchor_sets.json src/mjlab_microduck/odom_anchor_sets.json
```

Create `scripts/infer_policy.py`:

```python
#!/usr/bin/env python3
"""Kept so every `uv run scripts/infer_policy.py …` in the docs keeps working. The rehearsal
lives in mjlab_microduck.infer and is also `uv run infer`."""

import sys

from mjlab_microduck.infer import main

if __name__ == "__main__":
    sys.exit(main())
```

In `pyproject.toml`, `[project.scripts]`, after the `publish` line:

```toml
infer = "mjlab_microduck.infer:main"
```

In `scripts/odom_anchor_points.py` line 34:

```python
DEFAULT_JSON = os.path.join(REPO, "src/mjlab_microduck/odom_anchor_sets.json")
```

and its docstring line 21: `Writes src/mjlab_microduck/odom_anchor_sets.json (consumed by infer.py)`.

In `tests/test_infer_policy_bam.py`, replace the `spec_from_file_location` / `module_from_spec` / `exec_module` lines of the `ip` fixture with:

```python
    import importlib

    mod = importlib.import_module("mjlab_microduck.infer")
```

(keep the fixture's name and return; drop the now-unused `importlib.util` import if it was only used there).

Docs: in `README.md`, after the line `uv run scripts/infer_policy.py --walking output.onnx`, add `# or: uv run infer --walking output.onnx`. In `AGENTS.md` line 21, append ` (also \`uv run infer\`)` to the comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv sync >/dev/null && uv run --with pytest pytest tests/test_publish_manifest.py tests/test_infer_policy_bam.py -v && uv run infer --help | head -3`
Expected: all passed; `--help` prints the rehearsal's usage.

- [ ] **Step 5: Commit**

```bash
git add -A scripts src/mjlab_microduck/infer.py src/mjlab_microduck/odom_anchor_sets.json pyproject.toml tests/test_infer_policy_bam.py tests/test_publish_manifest.py README.md AGENTS.md
git commit -m "Declare infer as a script; keep scripts/infer_policy.py as its shim"
```

---

### Task 9: `microduck <command>` and `microduck check`

**Files:**
- Create: `src/mjlab_microduck/cli.py`, `src/mjlab_microduck/publish/check.py`
- Modify: `pyproject.toml` (`[project.scripts]`: `microduck = "mjlab_microduck.cli:main"`)
- Modify: `README.md` (Quickstart: the `microduck` forms next to the existing ones)
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `mjlab.scripts.train.main`, `mjlab.scripts.play.main`, `mjlab.scripts.list_envs.main` (mjlab 1.3.0 console scripts), `mjlab_microduck.export.main`, `mjlab_microduck.publish.cli.main`, `mjlab_microduck.infer.main` (Task 8); `manifest.check_onnx`, `smoke_run_onnx`, `validate_manifest`; `provenance.read`; `cli._pick_checkpoint` (Task 6).
- Produces:
  - `cli.COMMANDS: dict[str, tuple[str, str]]` — name → (module, attribute).
  - `cli.main(argv: list[str] | None = None) -> int` — `microduck <command> [args…]`: sets `sys.argv = [<command>, *args]` **before** importing the target module, then calls it and returns its exit code (`None` → 0). No command or `--help` prints the command list and returns 0; an unknown command names it and returns 2.
  - `check.CheckConfig(onnx: str | None = None, run: str | None = None, manifest: str | None = None, smoke: bool = True)`; `check.run(cfg) -> int` — prints one line per check, returns 0 when all hold, 2 on the first failure (with `[check] error: …` on stderr), 2 with usage when nothing was given. `check.main()` is the tyro entry.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_cli.py
"""`microduck <command>`: one name for the training side, mirroring `robotctl` on the robot.

Every command delegates to the entry point that already exists — `train` to mjlab's trainer,
`publish` to ours — with argv[0] rewritten to the command's name BEFORE mjlab is imported,
because the --hf-jobs interception and the provenance hook both key on argv[0] == "train".
`check` is what publish verifies, without the Hub."""

from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

import pytest

from mjlab_microduck import cli

_ROOT = Path(__file__).resolve().parents[1]


def test_microduck_is_a_declared_script():
    scripts = tomllib.loads((_ROOT / "pyproject.toml").read_text())["project"]["scripts"]
    assert scripts.get("microduck") == "mjlab_microduck.cli:main"
    assert scripts.get("train") == "mjlab_microduck.train_cli:main", "the old names stay"


def test_every_command_names_a_real_entry_point():
    import importlib

    for name, (module, attr) in cli.COMMANDS.items():
        assert callable(getattr(importlib.import_module(module), attr)), name
    assert set(cli.COMMANDS) == {"train", "play", "list-envs", "export", "publish", "check", "infer"}


def test_train_is_delegated_with_argv0_rewritten(monkeypatch):
    import mjlab.scripts.train

    seen = []
    monkeypatch.setattr(mjlab.scripts.train, "main", lambda: seen.append(list(sys.argv)) or 7)
    monkeypatch.setattr(sys, "argv", ["/v/bin/microduck", "train", "Mjlab-Velocity-Flat-MicroDuck", "--agent.seed", "3"])
    assert cli.main(["train", "Mjlab-Velocity-Flat-MicroDuck", "--agent.seed", "3"]) == 7
    assert seen == [["train", "Mjlab-Velocity-Flat-MicroDuck", "--agent.seed", "3"]]


def test_the_hooks_see_train(monkeypatch):
    """What the rewrite is for: both import-time hooks decide on argv[0]'s name."""
    import mjlab.scripts.train

    from mjlab_microduck.train_hook import _invoked_as_train

    verdict = []
    monkeypatch.setattr(mjlab.scripts.train, "main", lambda: verdict.append(_invoked_as_train()) or 0)
    cli.main(["train", "T"])
    assert verdict == [True]


def test_no_command_lists_them(capsys):
    assert cli.main([]) == 0
    out = capsys.readouterr().out
    for name in cli.COMMANDS:
        assert name in out


def test_an_unknown_command_is_named(capsys):
    assert cli.main(["dance"]) == 2
    assert "dance" in capsys.readouterr().err


def test_check_passes_a_good_policy(tmp_path, capsys):
    from mjlab_microduck.publish.check import CheckConfig, run
    from tests.test_publish_manifest import _tiny_policy

    policy = _tiny_policy(tmp_path / "out.onnx")
    assert run(CheckConfig(onnx=str(policy))) == 0
    assert "61 -> 14" in capsys.readouterr().out


def test_check_refuses_a_legacy_policy(tmp_path, capsys):
    from mjlab_microduck.publish.check import CheckConfig, run
    from tests.test_publish_manifest import _tiny_policy

    policy = _tiny_policy(tmp_path / "old.onnx", obs_len=51)
    assert run(CheckConfig(onnx=str(policy))) == 2
    assert "51" in capsys.readouterr().err


def test_check_reads_a_run(tmp_path, capsys):
    from mjlab_microduck.publish.check import CheckConfig, run

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    assert run(CheckConfig(run=str(run_dir))) == 2
    assert "provenance.json" in capsys.readouterr().err
    (run_dir / "provenance.json").write_text(json.dumps({"task": "T", "commit": "abc", "dirty": True, "command": ["train", "T"]}))
    (run_dir / "model_10.pt").write_bytes(b"x")
    assert run(CheckConfig(run=str(run_dir))) == 0
    out = capsys.readouterr().out
    assert "model_10.pt" in out and "uncommitted" in out


def test_check_validates_a_manifest(tmp_path, capsys):
    from mjlab_microduck.publish.check import CheckConfig, run

    good = tmp_path / "manifest.json"
    good.write_text(json.dumps({"schema_version": 2, "obs_len": 61, "action_len": 14, "kind": "perpetual"}))
    assert run(CheckConfig(manifest=str(good))) == 0
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"obs_len": 51}))
    assert run(CheckConfig(manifest=str(bad))) == 2
    assert "obs_len" in capsys.readouterr().err


def test_check_with_nothing_to_check_says_so(capsys):
    from mjlab_microduck.publish.check import CheckConfig, run

    assert run(CheckConfig()) == 2
    assert "--onnx" in capsys.readouterr().err
```

Create an empty `tests/__init__.py` (the repo's `tests/` is a plain directory today): with it, pytest puts the repo root on `sys.path` and `from tests.test_publish_manifest import _tiny_policy` resolves. Discovery is unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mjlab_microduck.cli'`

- [ ] **Step 3: Write the dispatcher**

```python
# src/mjlab_microduck/cli.py
"""`microduck <command>` — the training side's tools under one name.

    microduck train Mjlab-Velocity-Flat-MicroDuck --env.scene.num-envs 4096
    microduck play  Mjlab-Velocity-Flat-MicroDuck --wandb-run-path <...>
    microduck list-envs
    microduck export  Mjlab-Velocity-Flat-MicroDuck --checkpoint-file model_3000.pt
    microduck publish --run logs/rsl_rl/sprint/<run> --repo <user>/microduck-sprint
    microduck check   --onnx output.onnx
    microduck infer   --walking output.onnx

Each one IS the entry point it names — `uv run train`, `uv run publish`… keep working and
behave identically. The only thing done here is rewriting argv[0] to the command's name before
the target is imported: mjlab's import runs our plugin hooks (`--hf-jobs`, provenance.json),
and both decide on `Path(sys.argv[0]).name == "train"`.
"""

from __future__ import annotations

import importlib
import sys

COMMANDS: dict[str, tuple[str, str]] = {
    "train": ("mjlab.scripts.train", "main"),
    "play": ("mjlab.scripts.play", "main"),
    "list-envs": ("mjlab.scripts.list_envs", "main"),
    "export": ("mjlab_microduck.export", "main"),
    "publish": ("mjlab_microduck.publish.cli", "main"),
    "check": ("mjlab_microduck.publish.check", "main"),
    "infer": ("mjlab_microduck.infer", "main"),
}


def _usage() -> str:
    lines = ["usage: microduck <command> [args...]", "", "commands:"]
    lines += [f"  {name}" for name in COMMANDS]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print(_usage())
        return 0
    name, rest = args[0], args[1:]
    if name not in COMMANDS:
        print(f"microduck: unknown command {name!r}\n{_usage()}", file=sys.stderr)
        return 2
    # Before any mjlab import: the hooks read argv[0] when mjlab loads its plugins.
    sys.argv = [name, *rest]
    module, attr = COMMANDS[name]
    code = getattr(importlib.import_module(module), attr)()
    return int(code or 0)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Write `check`**

```python
# src/mjlab_microduck/publish/check.py
"""`microduck check` — what `publish` verifies, without the Hub.

    microduck check --onnx output.onnx          # 61 -> 14, runs, no NaN, output moves
    microduck check --run logs/rsl_rl/<run>     # provenance.json, latest checkpoint, dirty?
    microduck check --manifest manifest.json    # what the daemon would refuse

Any combination; the first failure ends it with exit 2 and the reason on stderr.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

import tyro

from mjlab_microduck import provenance
from mjlab_microduck.publish import manifest as m


@dataclass(frozen=True)
class CheckConfig:
    onnx: str | None = None
    """An exported policy: the shape gate and the smoke run publish applies."""
    run: str | None = None
    """A local run's log directory: its provenance and the checkpoint publish would pick."""
    manifest: str | None = None
    """A manifest.json: validated as the daemon would."""
    smoke: bool = True
    """With --onnx, run the network on plausible inputs (off: shape only)."""


def _fail(msg: str) -> int:
    print(f"[check] error: {msg}", file=sys.stderr)
    return 2


def run(cfg: CheckConfig) -> int:
    if not (cfg.onnx or cfg.run or cfg.manifest):
        return _fail("nothing to check; give --onnx <file>, --run <dir> and/or --manifest <file>")
    try:
        if cfg.onnx:
            shape = m.check_onnx(Path(cfg.onnx))
            print(f"[check] {Path(cfg.onnx).name}: {shape.obs_len} -> {shape.action_len}, ok")
            if cfg.smoke:
                m.smoke_run_onnx(Path(cfg.onnx))
                print("[check] smoke run: finite, non-constant output")
        if cfg.run:
            # Imported here: cli.py pulls tyro's PublishConfig, which check need not pay for.
            from mjlab_microduck.publish.cli import _pick_checkpoint

            run_dir = Path(cfg.run)
            record = provenance.read(run_dir)
            checkpoint = _pick_checkpoint(run_dir, None)
            print(f"[check] {run_dir.name}: task {record.get('task')}, commit {record.get('commit', 'unknown')}, "
                  f"would publish {checkpoint.name}")
            if record.get("dirty"):
                print("[check] started from a checkout with uncommitted changes: publish will refuse it without --allow-dirty")
        if cfg.manifest:
            m.validate_manifest(json.loads(Path(cfg.manifest).read_text()))
            print(f"[check] {Path(cfg.manifest).name}: the daemon would load it")
    except (m.ManifestError, FileNotFoundError) as e:
        return _fail(str(e))
    except SystemExit as e:  # _pick_checkpoint fails through publish's _fail
        return int(e.code or 2)
    return 0


def main() -> int:
    return run(tyro.cli(CheckConfig))


if __name__ == "__main__":
    sys.exit(main())
```

`_pick_checkpoint` calls `publish.cli._fail`, which prints `[publish] error: …` and raises `SystemExit(2)`; `check` lets that message stand and returns the code, so `test_check_reads_a_run`'s first assertion (`provenance.json` in stderr) is satisfied by `provenance.read`'s `FileNotFoundError`, caught above.

- [ ] **Step 5: Declare the script and document it**

`pyproject.toml`, `[project.scripts]`, after `infer`:

```toml
microduck = "mjlab_microduck.cli:main"
```

`README.md`, Quickstart: after the code block that starts with `git clone https://github.com/pollen-robotics/microduck_rl`, add:

```markdown
The same tools answer to one name, `microduck train`, `microduck play`, `microduck list-envs`,
`microduck export`, `microduck publish`, `microduck infer` — and `microduck check --onnx out.onnx`
runs the checks `publish` applies, without uploading. Both spellings stay.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv sync >/dev/null && uv run --with pytest pytest tests/test_cli.py tests/test_hf_jobs_flag.py -v && uv run microduck && uv run microduck check --onnx /nonexistent.onnx; echo "exit $?"`
Expected: all passed; the bare `microduck` prints the command list; the last line prints `[check] error: /nonexistent.onnx: no such file` and `exit 2`.

- [ ] **Step 7: Commit**

```bash
git add src/mjlab_microduck/cli.py src/mjlab_microduck/publish/check.py pyproject.toml README.md tests/__init__.py tests/test_cli.py
git commit -m "Add microduck <command>: one name for the training tools, and microduck check"
```

---

### Task 10: README — using `microduck_rl` from a challenge repo

**Files:**
- Modify: `README.md` (new section *Using this package from another repo*, before *Tests*)

**Interfaces:**
- Consumes: everything above; the `[tool.uv]` and `[tool.uv.sources]` tables of this repo's `pyproject.toml` as they stand when the task runs.

- [ ] **Step 1: Write the section**

Insert before `## Tests`:

```markdown
## Using this package from another repo

`microduck-challenges` (and any repo that trains a microduck) depends on this one as a git
dependency and gets every tool above. Four things a dependent repo has to do, because uv
applies `[tool.uv]` tables only to the project it reads them in:

1. **Depend on it**, and copy this repo's `[tool.uv.sources]` and
   `[tool.uv] override-dependencies` tables verbatim into your `pyproject.toml`. They pin
   BAM's git branch, keep protobuf and onnx on versions with wheels, and bind torch to the
   CUDA index on ARM; none of that reaches you transitively.

   ```toml
   dependencies = ["mjlab-microduck @ git+https://github.com/pollen-robotics/microduck_rl"]
   ```

2. **Register your tasks** the way `src/mjlab_microduck/tasks/__init__.py` does, with
   `runner_cls=MicroduckOnPolicyRunner` (that runner is what writes `provenance.json`), and
   declare your package under `[project.entry-points."mjlab.tasks"]` so `microduck train
   <your task>` finds it.

3. **Describe a challenge** in a `challenge.toml` beside its `tasks.py` and `env.py`
   (`event`, `task`, `kind`, `[recipe]`, `[params.<name>]`); `tasks.py` calls
   `mjlab_microduck.challenge.register(__file__)` and `env.py` reads its knobs with
   `mjlab_microduck.challenge.params(__file__)`. `microduck publish --run <dir> --repo …`
   then needs nothing else: kind, Arena event and accessories come from the task.

4. **Import the robot, never copy it.** `MICRODUCK_WALK_ROBOT_CFG` and its roller and
   backlash variants, the BAM actuators and `tasks/mdp.py` are the library; a challenge's
   `env.py` builds its own observations, rewards, terminations and randomisation on top of
   them, the way `microduck_velocity_env_cfg.py` does here.

`train … --hf-jobs` works from such a checkout too: the tarball is your repo, and the job
resolves your lock file.
```

- [ ] **Step 2: Check the section against the real tables**

```bash
grep -n "tool.uv.sources\|override-dependencies" pyproject.toml
```

Expected: both tables exist (they do today); the section names them and nothing else.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document using mjlab-microduck from a challenge repo"
```

---

### Task 11: Whole-suite check and `uv.lock`

**Files:**
- Modify: `uv.lock` only if `uv sync` changed it.

- [ ] **Step 1: Run everything**

```bash
uv run --with pytest pytest tests/ -v
```

Expected: all passed; the count is the previous count + 54 (Task 1: 10, Task 2: 2, Task 3: 3, Task 4: 10, Task 5: 4, Task 6: 9, Task 7: 4, Task 8: 1, Task 9: 11).

- [ ] **Step 2: Run the documented commands that must not have changed**

```bash
uv run publish --help | grep -E -- "--run|--allow-dirty|--accessories|--onnx|--wandb-run-path|--kind"
uv run scripts/export.py --help | head -2
uv run scripts/infer_policy.py --help | head -2
uv run python scripts/hf/uploader.py; echo "exit $?"    # prints "[uploader] CKPT_REPO not set, exiting", exit 1
uv run microduck list-envs | head -3
uv run microduck check --onnx /nonexistent.onnx; echo "exit $?"
git status --short                                       # only uv.lock, if anything
```

Expected: the six flags listed; both scripts print usage; the uploader shim behaves as the module; `list-envs` lists tasks; `check` names the missing file with exit 2; the tree is clean apart from a possible `uv.lock`.

- [ ] **Step 3: Commit the lock if it moved**

```bash
git add uv.lock && git commit -m "Lock after declaring the infer and microduck scripts" || true
```
