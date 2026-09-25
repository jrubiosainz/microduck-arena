# `microduck_rl` recipe publishing — implementation plan (plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `microduck_rl` records what trained every run, publishes a run from its log directory with the checkpoint and a *Reproduce* block, and can be driven from another repo (the future `microduck-challenges`) without any of its current commands changing behaviour.

**Architecture:** Three additive pieces in the `mjlab_microduck` package: `provenance.py` (written at train start by the runner subclass this repo already registers for every task, read by `publish --run`), `challenge.py` (a challenge env's knobs, from the `challenge.toml` next to it), and two script-to-module moves (`hf_uploader`, `infer`) with shims left in `scripts/` so every documented command keeps working. The HF Jobs bootstrap calls modules, not repo scripts, so a tarball of a dependent repo runs it unchanged.

**Tech Stack:** Python 3.12, `uv`, tyro, mjlab 1.3.0 / rsl_rl, huggingface_hub, pytest (CPU only, no GPU in any test).

**Spec:** `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md` in `microduck-arena`, sections *Changes to `microduck_rl`* and *What reproducibility means here*. This plan is executed in a checkout of `pollen-robotics/microduck_rl` (branch `develop`), not in the arena repo.

## Global Constraints

- Every change is additive. `uv run train`, `uv run play`, `uv run publish --onnx …`, `uv run publish --task … --wandb-run-path …`, `uv run scripts/export.py`, `uv run scripts/infer_policy.py`, `uv run scripts/hf/train_hf.py` and `train … --hf-jobs` keep their exact behaviour, flags and outputs. Existing tests are not edited except where a file they load moves (Task 7), and then only the loading line.
- No new dependency. `tomllib`, `importlib.metadata`, `subprocess`, `json` are all standard library.
- Tests run on CPU without mjlab's registry, torch or a network: `uv run --with pytest pytest tests/<file> -v` from the repo root. Anything that would import torch is behind a function boundary that tests monkeypatch.
- `requires-python = ">=3.12, <3.13"` stays as is.
- The `training` block of a published manifest keeps every key it has today (`repo`, `commit`, `branch`, `dirty`, `task_id`, `run`, `checkpoint`, `source_file`, `exported`); new keys are added, none renamed.
- Commit messages: one imperative line, as in `git log` (e.g. `Record run provenance at train start`).

## Review Focus

- A `train` started outside a git checkout (an HF Jobs container extracts a tarball with no `.git`): `provenance.json` must still be written, without `repo`/`commit`/`branch`/`dirty`, and `publish --run` must publish it with a README that has no *Reproduce* block rather than a half one. Pinned in Task 1 (`test_outside_git_records_no_checkout`) and Task 3 (`test_no_reproduce_block_without_a_commit`).
- `play` (or `export`) constructing the runner on an existing run must never overwrite the run's `provenance.json`. Pinned in Task 1 (`test_written_once`) and Task 2 (`test_runner_records_only_when_invoked_as_train`).
- `argv[0]` is the absolute path of the `train` console script (`/…/.venv/bin/train`); the recorded command must start with the bare word `train` so the *Reproduce* block reads `uv run train …`. Pinned in Task 1 (`test_command_starts_with_bare_train`).
- `publish --run --checkpoint 999` for an iteration the run never saved, and `publish --run` on a run that has not saved a checkpoint yet, must fail with the path named, before any export. Pinned in Task 4 (`test_missing_checkpoint_is_named`, `test_a_run_without_checkpoints_is_refused`).
- A checkout with no `origin` remote (a local-only repo) records no `repo`; the README then omits *Reproduce* and the manifest's `training` simply lacks the key. Pinned in Task 1 (`test_no_origin_records_no_repo`) and Task 3.

---

### Task 1: `provenance.py` — what trained a run

**Files:**
- Create: `src/mjlab_microduck/provenance.py`
- Test: `tests/test_provenance.py`

**Interfaces:**
- Produces:
  - `FILE = "provenance.json"`
  - `checkout(cwd: Path | None = None) -> dict[str, Any]` — `{"repo", "commit", "branch", "dirty"}` of the git checkout at `cwd` (default: the process's working directory); `{}` outside git; `repo` absent when there is no `origin` remote.
  - `base() -> str` — `"mjlab-microduck <version>"`, plus `" @ <commit9>"` when the package was installed from git.
  - `record_run_start(log_dir: Path, *, argv: list[str], seed: int | None, cwd: Path | None = None) -> Path | None` — writes `log_dir/provenance.json` once; returns the path, or `None` when the file already exists.
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


def test_outside_git_records_no_checkout(tmp_path):
    assert provenance.checkout(tmp_path) == {}


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

Standard library only: this runs inside `train`, and must cost nothing there.
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path
from typing import Any

FILE = "provenance.json"
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
    # argv[0] is the console script's absolute path; the recipe says `uv run train …`.
    command = ["train", *argv[1:]]
    record: dict[str, Any] = {
        "command": command,
        "task": argv[1] if len(argv) > 1 else None,
        "seed": seed,
        **checkout(cwd),
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
- Consumes: a `training` dict that may carry `command: list[str]`, `repo`, `commit`, `seed`, `base`, `started` (Task 4 fills them).
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

### Task 4: `publish --run <log dir>`

**Files:**
- Modify: `src/mjlab_microduck/publish/cli.py`
- Modify: `README.md` (section *Publishing a policy*)
- Test: `tests/test_publish_manifest.py` (append)

**Interfaces:**
- Consumes: `provenance.read`, `provenance.FILE` (Task 1); `render_readme` (Task 3); `mjlab_microduck.export.run_export` (exists; behind `_export_checkpoint`, monkeypatched in tests).
- Produces:
  - `PublishConfig.run: str | None = None`, `PublishConfig.allow_dirty: bool = False`.
  - `_export_checkpoint(task: str, checkpoint: Path, out: Path, device: str | None) -> Path` — the only place `--run` touches torch; tests replace it.
  - `_pick_checkpoint(run_dir: Path, iteration: int | None) -> Path`.
  - The staged repo of a `--run` publish holds `policy.onnx`, `checkpoint.pt`, `manifest.json`, `README.md`.
  - The manifest's `training` for `--run`: `repo`, `commit`, `branch`, `dirty` (when recorded), `command`, `seed`, `base`, `started`, `task_id`, `checkpoint` (iteration), `source_file` (`model_<N>.pt`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_publish_manifest.py`:

```python
def _run_dir(tmp_path: Path, *, dirty: bool = False, iterations=(100, 250), with_checkout: bool = True) -> Path:
    """A finished local run: provenance from `train`, two checkpoints."""
    run = tmp_path / "logs" / "rsl_rl" / "sprint" / "2026-09-25_10-00-00_first"
    run.mkdir(parents=True)
    record = {
        "command": ["train", "Mjlab-Sprint2m-MicroDuck", "--agent.seed", "7"],
        "task": "Mjlab-Sprint2m-MicroDuck",
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
def fake_export(monkeypatch, tmp_path):
    """Stand in for the GPU export: records what it was asked and writes a tiny valid policy."""
    from mjlab_microduck.publish import cli

    calls = []

    def _export(task, checkpoint, out, device):
        calls.append((task, Path(checkpoint).name))
        return _tiny_policy(out)

    monkeypatch.setattr(cli, "_export_checkpoint", _export)
    return calls


def test_publish_run_stages_weights_checkpoint_and_recipe(tmp_path, monkeypatch, fake_export):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                             run=str(run_dir), dry_run=True)) == 0
    assert fake_export == [("Mjlab-Sprint2m-MicroDuck", "model_250.pt")], "latest checkpoint by default"
    out = tmp_path / "publish-sprint"
    assert (out / "policy.onnx").exists()
    assert (out / "checkpoint.pt").read_bytes() == b"checkpoint 250"
    training = json.loads((out / "manifest.json").read_text())["training"]
    assert training["repo"] == "https://github.com/alice/microduck-challenges"
    assert training["commit"] == "3f9c2d1ab"
    assert training["command"] == ["train", "Mjlab-Sprint2m-MicroDuck", "--agent.seed", "7"]
    assert training["seed"] == 7 and training["base"] == "mjlab-microduck 0.1.0"
    assert training["task_id"] == "Mjlab-Sprint2m-MicroDuck"
    assert training["checkpoint"] == 250 and training["source_file"] == "model_250.pt"
    readme = (out / "README.md").read_text()
    assert "## Reproduce" in readme and "git checkout 3f9c2d1ab" in readme


def test_publish_run_picks_the_asked_checkpoint(tmp_path, monkeypatch, fake_export):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                             run=str(run_dir), checkpoint=100, dry_run=True)) == 0
    assert fake_export == [("Mjlab-Sprint2m-MicroDuck", "model_100.pt")]
    assert (tmp_path / "publish-sprint" / "checkpoint.pt").read_bytes() == b"checkpoint 100"


def test_a_dirty_run_is_refused_unless_allowed(tmp_path, monkeypatch, fake_export, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, dirty=True)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                          run=str(run_dir), dry_run=True))
    assert "uncommitted changes" in capsys.readouterr().err
    assert fake_export == [], "refused before any export"
    assert run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                             run=str(run_dir), dry_run=True, allow_dirty=True)) == 0
    assert json.loads((tmp_path / "publish-sprint" / "manifest.json").read_text())["training"]["dirty"] is True


def test_missing_checkpoint_is_named(tmp_path, monkeypatch, fake_export, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                          run=str(run_dir), checkpoint=999, dry_run=True))
    assert "model_999.pt" in capsys.readouterr().err
    assert fake_export == []


def test_a_run_without_checkpoints_is_refused(tmp_path, monkeypatch, fake_export, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, iterations=())
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                          run=str(run_dir), dry_run=True))
    assert "no model_<N>.pt" in capsys.readouterr().err


def test_a_run_trained_outside_git_publishes_without_a_recipe(tmp_path, monkeypatch, fake_export):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path, with_checkout=False)
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                             run=str(run_dir), dry_run=True)) == 0
    training = json.loads((tmp_path / "publish-sprint" / "manifest.json").read_text())["training"]
    assert "commit" not in training and training["command"][0] == "train"
    assert "## Reproduce" not in (tmp_path / "publish-sprint" / "README.md").read_text()


def test_run_is_a_source_of_its_own(tmp_path, monkeypatch, fake_export, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    run_dir = _run_dir(tmp_path)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        run(PublishConfig(repo="alice/microduck-sprint", kind="perpetual", slot="walk",
                          run=str(run_dir), onnx="x.onnx", dry_run=True))
    assert "--run" in capsys.readouterr().err
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v -k "publish_run or dirty_run or missing_checkpoint or without_checkpoints or outside_git or source_of_its_own"`
Expected: FAIL — `AttributeError: module 'mjlab_microduck.publish.cli' has no attribute '_export_checkpoint'` (the fixture), then `TypeError: unexpected keyword argument 'run'`.

- [ ] **Step 3: Implement `--run`**

In `src/mjlab_microduck/publish/cli.py`:

Add two fields to `PublishConfig`, after `onnx`:

```python
    run: str | None = None
    """A local training run's log directory (`logs/rsl_rl/<experiment>/<stamp>_<name>/`). Reads
    its provenance.json, exports its latest checkpoint (or --checkpoint N) and uploads that
    checkpoint next to policy.onnx. A source of its own: not with --onnx or --wandb-run-path."""
```

and after `force`:

```python
    allow_dirty: bool = False
    """--run only: publish a run started from a checkout with uncommitted changes anyway."""
```

Update the module docstring with a fourth example, first in the list:

```
    # From a local run (the workshop's path): provenance, latest checkpoint, checkpoint uploaded too
    uv run publish --run logs/rsl_rl/sprint/2026-09-25_10-00-00_first \\
        --repo <user>/microduck-sprint --kind perpetual --slot walk
```

Add `import re` and `from mjlab_microduck import provenance` to the imports, and these functions after `_fail`:

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
    import mjlab.tasks  # noqa: F401  (populates the registry)
    from mjlab_microduck.export import ExportConfig, run_export

    return run_export(
        task,
        ExportConfig(onnx_file=str(out), checkpoint_file=str(checkpoint), num_envs=1, device=device),
    ).onnx_path


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

In `run()`, replace the line `onnx_path, training = _resolve_weights(cfg, workdir)` with:

```python
        checkpoint: Path | None = None
        if cfg.run is not None:
            onnx_path, training, checkpoint = _resolve_run(cfg, workdir)
        else:
            onnx_path, training = _resolve_weights(cfg, workdir)
```

After `shutil.copyfile(onnx_path, staged / m.POLICY_FILE)` add:

```python
        if checkpoint is not None:
            shutil.copyfile(checkpoint, staged / "checkpoint.pt")
```

and change the dry-run message to list what was staged:

```python
            print(f"[publish] dry run: wrote {dest}/ ({', '.join(sorted(p.name for p in dest.iterdir()))})")
```

`_resolve_weights` is not touched: the `--onnx` and `--task` paths run exactly the code they run today.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_publish_manifest.py -v`
Expected: all passed, `test_the_cli_dry_run_writes_a_repo` included (its dry-run line now reads `(README.md, manifest.json, policy.onnx)`; it asserts files, not the line).

- [ ] **Step 5: Document it**

In `README.md`, section *Publishing a policy*, add as the first example in the code block:

```bash
# From a local run — the recipe (commit, command, seed) comes from the run's provenance.json,
# the latest checkpoint is exported and uploaded next to policy.onnx
uv run publish --run logs/rsl_rl/velocity/2026-09-25_10-00-00_first \
    --repo <user>/microduck-my-walk --kind perpetual --slot walk
```

and after the paragraph starting "Before anything is uploaded, `publish` checks…" add:

```markdown
Every `uv run train` writes `provenance.json` into its log directory: the command, the seed,
the commit, branch and dirty flag of the checkout it ran in, and this package's version.
`publish --run` puts that in the manifest's `training` block and ends the model card with a
*Reproduce* section. A run started on a dirty tree is refused (`--allow-dirty` to override):
the published recipe should be the code that trained.
```

- [ ] **Step 6: Commit**

```bash
git add src/mjlab_microduck/publish/cli.py tests/test_publish_manifest.py README.md
git commit -m "Publish a local run: --run exports, records the recipe and uploads the checkpoint"
```

---

### Task 5: The HF Jobs bootstrap calls modules, not repo scripts

**Files:**
- Move: `scripts/hf/uploader.py` → `src/mjlab_microduck/hf_uploader.py` (git mv), then recreate `scripts/hf/uploader.py` as a shim
- Modify: `src/mjlab_microduck/hf_jobs.py` (`BOOTSTRAP` string, and the docstring line mentioning `scripts/hf/uploader.py`)
- Modify: `scripts/hf/README.md` (the line mentioning `scripts/hf/uploader.py`)
- Test: `tests/test_hf_jobs_flag.py` (append)

**Interfaces:**
- Produces: `python -m mjlab_microduck.hf_uploader` (same env vars as today: `CKPT_REPO`, `CKPT_POLL_INTERVAL`, `CKPT_ROOT`, `CKPT_ONE_SHOT`); `python -m mjlab_microduck.export <task> …` (already works, `export.py` has a `main`); `BOOTSTRAP` contains no `scripts/` path.

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
```

Add `import os` to the file's imports (`subprocess` and `sys` are already imported).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_hf_jobs_flag.py -v -k "bootstrap or uploader"`
Expected: FAIL — `assert "scripts/" not in hf_jobs.BOOTSTRAP`; `ImportError: cannot import name 'hf_uploader'`.

- [ ] **Step 3: Move the uploader and write the shim**

```bash
git mv scripts/hf/uploader.py src/mjlab_microduck/hf_uploader.py
```

Edit the docstring at the top of `src/mjlab_microduck/hf_uploader.py` so its third paragraph reads:

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

- [ ] **Step 4: Point the bootstrap at the modules**

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

In the same file's docstring, change `(scripts/hf/uploader.py)` to `(mjlab_microduck.hf_uploader)`. In `scripts/hf/README.md`, change `starts `scripts/hf/uploader.py` in background` to `starts the checkpoint uploader (`python -m mjlab_microduck.hf_uploader`) in background`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_hf_jobs_flag.py -v`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add -A scripts/hf src/mjlab_microduck/hf_uploader.py src/mjlab_microduck/hf_jobs.py tests/test_hf_jobs_flag.py
git commit -m "Run the HF Jobs uploader and export as modules so a dependent repo's tarball works"
```

---

### Task 6: `challenge.params(__file__)` — a challenge env's knobs

**Files:**
- Create: `src/mjlab_microduck/challenge.py`
- Test: `tests/test_challenge_params.py`

**Interfaces:**
- Produces: `params(tasks_file: str | Path) -> dict[str, float]` — the `value` of each `[params.<name>]` table in the `challenge.toml` next to `tasks_file`; `FileNotFoundError` naming the path when absent; `ValueError` naming the knob when it has no `value`. A challenge's `tasks.py` calls `params(__file__)` at import time and uses the result in its config.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_challenge_params.py
"""A challenge env reads its exposed knobs from the challenge.toml beside it.

The workshop edits that file and commits it before a run; the shell user edits it by hand.
Both train the same env from the same values, with no environment variable or flag."""

from pathlib import Path

import pytest

from mjlab_microduck.challenge import params

TOML = """
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs = 4096

[params.forward_reward]
label = "Speed reward"
value = 2.0
min   = 0.5
max   = 5.0

[params.upright_reward]
label = "Stay upright"
value = 1
"""


def _challenge(tmp_path: Path, toml: str = TOML) -> Path:
    folder = tmp_path / "sprint_2m"
    folder.mkdir()
    (folder / "challenge.toml").write_text(toml)
    (folder / "tasks.py").write_text("")
    return folder / "tasks.py"


def test_params_reads_each_knobs_value_as_a_float(tmp_path):
    assert params(_challenge(tmp_path)) == {"forward_reward": 2.0, "upright_reward": 1.0}


def test_a_challenge_without_knobs_has_none(tmp_path):
    assert params(_challenge(tmp_path, 'event = "sprint-2m"\n')) == {}


def test_a_missing_file_is_named(tmp_path):
    with pytest.raises(FileNotFoundError, match="challenge.toml"):
        params(tmp_path / "elsewhere" / "tasks.py")


def test_a_knob_without_a_value_is_named(tmp_path):
    with pytest.raises(ValueError, match="params.forward_reward"):
        params(_challenge(tmp_path, '[params.forward_reward]\nlabel = "x"\n'))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --with pytest pytest tests/test_challenge_params.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mjlab_microduck.challenge'`

- [ ] **Step 3: Write the module**

```python
# src/mjlab_microduck/challenge.py
"""The knobs a challenge exposes, read from the `challenge.toml` beside its `tasks.py`.

A challenge (in `microduck-challenges`) keeps its training env in `tasks.py` and its contract
in `challenge.toml` next to it: `event`, `task`, `kind`, a `[recipe]` of train arguments, and
`[params.<name>]` tables — `label`, `value`, `min`, `max` — for the values a novice may tune
from the workshop without touching Python. The env reads them with `params(__file__)`; the
workshop and a shell user edit the same file, so both train the same thing.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

FILE = "challenge.toml"


def params(tasks_file: str | Path) -> dict[str, float]:
    """`{name: value}` for every `[params.<name>]` in the challenge.toml beside `tasks_file`."""
    path = Path(tasks_file).resolve().parent / FILE
    if not path.exists():
        raise FileNotFoundError(f"{path}: a challenge's tasks.py sits next to its {FILE}")
    table = tomllib.loads(path.read_text()).get("params", {})
    values: dict[str, float] = {}
    for name, knob in table.items():
        if "value" not in knob:
            raise ValueError(f"{path}: params.{name} has no value")
        values[name] = float(knob["value"])
    return values
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --with pytest pytest tests/test_challenge_params.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/mjlab_microduck/challenge.py tests/test_challenge_params.py
git commit -m "Add challenge.params: a challenge env's knobs from the challenge.toml beside it"
```

---

### Task 7: `infer` as a declared script

**Files:**
- Move: `scripts/infer_policy.py` → `src/mjlab_microduck/infer.py`; `scripts/odom_anchor_sets.json` → `src/mjlab_microduck/odom_anchor_sets.json` (git mv both; `infer.py` locates the JSON relative to `__file__`, so the pair stays valid)
- Create: `scripts/infer_policy.py` (shim)
- Modify: `pyproject.toml` (`[project.scripts]`), `scripts/odom_anchor_points.py:34` (`DEFAULT_JSON`), `tests/test_infer_policy_bam.py` (the `ip` fixture's loading lines only), `README.md` and `AGENTS.md` (mention `uv run infer` next to the script)
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

### Task 8: Whole-suite check and `uv.lock`

**Files:**
- Modify: `uv.lock` only if `uv sync` changed it (a new script needs no lock change; check).

- [ ] **Step 1: Run everything**

Run: `uv run --with pytest pytest tests/ -v`
Expected: all passed; the count is the previous count + 30 (Task 1: 10, Task 2: 2, Task 3: 3, Task 4: 7, Task 5: 3, Task 6: 4, Task 7: 1).

- [ ] **Step 2: Run the documented commands that must not have changed**

```bash
uv run publish --help | grep -E -- "--run|--allow-dirty|--onnx|--wandb-run-path"
uv run scripts/export.py --help | head -2
uv run scripts/infer_policy.py --help | head -2
uv run python scripts/hf/uploader.py; echo "exit $?"    # prints "[uploader] CKPT_REPO not set, exiting", exit 1
git status --short                                       # only uv.lock, if anything
```

Expected: the four flags listed; both scripts print usage; the uploader shim behaves as the module; the tree is clean apart from a possible `uv.lock`.

- [ ] **Step 3: Commit the lock if it moved**

```bash
git add uv.lock && git commit -m "Lock after declaring the infer script" || true
```
