# The challenge workshop, and the Space's side of it — implementation plan (plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Mac with no GPU, a novice goes from a challenge page to an Arena entry: the page gives one line; the line opens a local workshop; the workshop trains on Hugging Face Jobs, brings the checkpoints back, tests one with the Arena's own evaluator, publishes it with `uv run publish`, and opens the challenge page pre-filled with the Hub repo, where the Space checks the manifest and records the entry.

**Architecture:** Three repos. **microduck_rl** (draft PR #57): the HF job uploads its TensorBoard files, and its auto-export finds the run's checkpoint. **Arena, Space side:** events declare `kind`; `hub_fetch` reads `manifest.json` at a pinned revision and refuses one that disagrees with the event; `submit` takes a `revision` and refuses files; `hub_publish.py` and the visitor's Hub token go; `GET /workshop.py` serves the one line's launcher with the Arena's own address in it; the race page enters a Hub repo pre-filled from `?repo=&revision=&env=` and shows a *Train my robot* panel. **Arena, workshop:** `arena/workshop/`, a separate FastAPI app started by a `workshop` console script inside a microduck-challenges checkout; every training step is a `uv run --no-sync …` subprocess there; its page `workshop.html` is built with the site and reuses the replay viewer. **microduck-challenges:** a test that each challenge's `kind` is its event's, and the one line in its README.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, `huggingface_hub`, pytest; Vite 5 + vitest (jsdom); `uv` (≥ 0.9, remote scripts with inline metadata); git, `gh` (optional); mjlab-microduck's `train` / `publish` / `hf` scripts, reached only as subprocesses.

**Spec:** `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md`, sections *The workshop*, *The Space*, *The one line*, *Testing*, milestones 2 and 3. Plans 1–3 (`2026-09-25-*.md`) built what this one uses.

## Where things are

- **Arena worktree** — `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop`, branch `plan4-workshop` from local `main` (a32314c). Its `.venv` (`uv sync --no-config --frozen --extra dev`) and `app/node_modules` (`npm ci`) exist. Every path without a prefix is relative to it. Baseline on 2026-09-28: `pytest` 711 passed; `npm test` 593 passed, 4 failed (all in `brightness.test.js`, localStorage under jsdom — pre-existing on main, see the memory *vitest-failures-preexisting*).
- **microduck_rl worktree** — `~/Projects/HuggingFace/microduck_rl/.claude/worktrees/plan4-hf-jobs`, branch `plan4-hf-jobs` from `challenge-recipe-publishing` (981a279, the head of draft PR #57). No venv of its own; Task 1 runs its tests with the challenges checkout's interpreter and `PYTHONPATH=src`.
- **microduck-challenges worktree** — `~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop`, branch `plan4-workshop` from `main` (611b645), with its own `.venv` synced with the `workshop` group (the Arena 0.2.0 wheel). It holds a real 3-iteration CPU run, `logs/rsl_rl/sprint_2m/2026-09-28_11-04-09_plan4probe/` (provenance, `model_0..2.pt`, a TensorBoard file), used by Task 9's fixture and Task 17's rehearsal.
- `.claude/` is excluded locally in each repo (`.git/info/exclude`, not committed), so the main checkouts stay clean — an untracked folder there would make every run the other session trains record `dirty: true`.

## Coordination — read before any task

Another session works on these repos at the same time. **Never edit**: `arena/runner.py`, `arena/golden.py`, `arena/constants.py`, the dependencies or the `version` in `pyproject.toml`, any `uv.lock`, anything under `microduck-challenges/src/microduck_challenges/swag_contest/`. This plan only *reads* `RUNNER_VERSION`. Its one `pyproject.toml` edit is a line under `[project.scripts]` (Task 10); it changes no lock. If a task seems to need one of these files, stop and report instead.

## Deviations from the spec, decided while planning

1. `workshop.py` is served by a route (`arena/web/routes_launcher.py`), not from `app/public/`: the route writes the Arena's own address into the script, so a local `arena serve` stands in for the Space and the workshop sends the user back to the Arena they came from.
2. One training at a time: `POST /api/workshop/train` and its `stop`/`pull`, instead of per-run launch routes. Runs are still discovered on disk (`logs/rsl_rl/*/*/provenance.json`).
3. Test exports with `uv run publish --run <dir> --checkpoint N --dry-run --allow-dirty` (the owner's instruction; it is also exactly the exporter a real publish uses), not `mjlab_microduck.export`.
4. `workshop` with no challenge lists them in the terminal; no web chooser.
5. The pre-filled entry survives the sign-in round trip in `sessionStorage` (the OAuth callback lands on `/#<route>` with no query).
6. With `hub_publish.py` gone, the Space keeps no visitor token and stops asking for `contribute-repos`.
7. A run whose `provenance.json` says `dirty` is published only with *publish anyway* (`--allow-dirty`): committing afterwards cannot make an old run clean, so the spec's "until *Commit and push* has run" is dropped. Runs launched from the workshop are never dirty (it commits first).
8. The HF Jobs curve comes from TensorBoard files pulled every two minutes. It needs Task 1 **in the job**, i.e. after the owner pushes PR #57's branch and the challenges lock moves to that commit; until then an HF run has checkpoints but no curve, and the page says so.

## Global Constraints

- Commit messages: one line, English, never signed — no `Co-Authored-By`, no tool attribution. Use `/usr/bin/git` (the RTK hook rewrites `git` and the worktree guard refuses that).
- uv on this Mac: always `--no-config` (the owner's `~/.config/uv/uv.toml` rewrites locks); install/run with `--frozen`. In the challenges worktree also `UV_NO_SYNC=1` (from Task 16 on, an editable Arena sits there) and `HF_TOKEN=$(cat ~/.cache/huggingface/token)` (the Arena wheel is on a private Hub repo).
- Arena tests: `uv run --no-config --frozen --extra dev pytest -q` (about 3.5 min for everything; run the task's files while iterating, everything before committing a task). Front: `cd app && npm test` — judge by "no failure beyond the 4 in `brightness.test.js`".
- The workshop's subprocesses are `uv run --no-sync <command>` in the checkout, with `PYTHONUNBUFFERED=1`: the workshop already runs in the checkout's environment, a sync per call costs seconds and would put the locked Arena wheel back over a development install.
- The `arena` package never imports mjlab, torch or tensorboard. `arena/workshop/` is imported only by the `workshop` script, the launcher route (which reads `launcher.py` as text) and tests.
- Only the Space measures: the workshop labels its score *indicative — only the Arena times an entry*.
- No network in tests: the Hub is a fake object; `uv` and `gh` are fake executables on `PATH`; GitHub is played by local bare repos (Task 10's harness).
- Nothing pushed, nothing created on the Hub or GitHub, no HF job, without the owner's explicit go-ahead in this conversation (Task 17 stops and asks).
- Names, exactly: console script `workshop`; package `arena/workshop/`; API prefix `/api/workshop/`; launcher route `/workshop.py`; default Arena URL `https://pollen-robotics-microduck-arena.hf.space`; challenges repo `https://github.com/pollen-robotics/microduck-challenges`; the page `app/workshop.html`.

## Review Focus

1. **A novice who is signed out on the Space** arrives from the workshop with `?repo=&revision=&env=`; signing in leaves for huggingface.co and comes back to `/#/e/<id>` with no query. The pre-fill must survive, or the return trip dead-ends. Pinned in Task 7 (`entry.test.js`: *keeps it across the sign-in round trip*).
2. **A dirty run** (trained from a shell on uncommitted changes) must not be published by accident: Publish refuses it unless *publish anyway* is ticked, server-side too; Test still works on it. Pinned in Task 12 (`--allow-dirty` on the trial's dry run) and Task 13 (`test_a_dirty_run_is_refused_unless_published_anyway`).
3. **An HF job before its first pull**: no run directory, no curve, no checkpoint — every zone says "nothing yet" instead of failing, and a pull while the job still runs brings new files. Pinned in Task 11 (`test_an_hf_run_appears_only_once_pulled`).
4. **A manifest that disagrees with the event** — a roller policy on the sprint, an episodic one, a 48-observation one — is refused naming the field, before the ONNX is downloaded; a repo with no manifest is still accepted. Pinned in Task 3.
5. **A second launch while one runs, or a run name already on disk**, is refused (409) instead of losing the first job's handle or mixing two runs' logs. Pinned in Task 11.

---

### Task 1: The HF job uploads its TensorBoard files, and its auto-export finds the run's checkpoint (microduck_rl)

**Repo:** the microduck_rl worktree. These commits go into draft PR #57 when the owner fast-forwards `challenge-recipe-publishing` to `plan4-hf-jobs` (not in this plan).

**Files:**
- Modify: `src/mjlab_microduck/hf_uploader.py` (`_watched`, module docstring)
- Modify: `src/mjlab_microduck/hf_jobs.py` (the auto-export block of `BOOTSTRAP` becomes the constant `EXPORT_STEP`)
- Modify: `scripts/hf/README.md:56` (what the uploader watches)
- Test: `tests/test_hf_jobs_flag.py`

**Interfaces:**
- Produces: `hf_uploader._watched(root)` also returns `**/events.out.tfevents.*`; `hf_jobs.EXPORT_STEP: str`, the bash block run after training, included verbatim in `hf_jobs.BOOTSTRAP`.

- [ ] **Step 1: Record the baseline**

```bash
cd ~/Projects/HuggingFace/microduck_rl/.claude/worktrees/plan4-hf-jobs
PY=~/Projects/HuggingFace/microduck-challenges/.venv/bin/python
PYTHONPATH=src $PY -m pytest tests/test_hf_jobs_flag.py -q 2>&1 | tail -3
```

Expected: `1 failed, 16 passed` — `test_train_on_path_is_a_mjlab_trainer` needs microduck_rl's own `train` shim on `PATH`, which this interpreter's environment does not have. It fails identically at 981a279; it is the environment, not the code. Every other test must stay green.

- [ ] **Step 2: Write the failing tests**

In `tests/test_hf_jobs_flag.py`, replace `test_the_uploader_pushes_what_publish_run_reads` with:

```python
def test_the_uploader_pushes_what_publish_run_reads(tmp_path):
    """A cloud run pulled back into logs/ must carry its provenance, or `publish --run` refuses
    it, and its TensorBoard file, or the workshop has no curve to draw for it."""
    from mjlab_microduck.hf_uploader import _watched

    names = (
        "run/model_10.pt",
        "run/params/env.yaml",
        "run/provenance.json",
        "run/events.out.tfevents.1790586250.host.3263.0",
        "run/other.txt",
    )
    for name in names:
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text("x")
    watched = {p.relative_to(tmp_path).as_posix() for p in _watched(tmp_path)}
    assert watched == set(names) - {"run/other.txt"}
```

and add, after it:

```python
def test_auto_export_finds_the_checkpoint_in_the_run_directory(tmp_path):
    """Runs are logs/rsl_rl/<experiment>/<stamp>_<name>/model_<N>.pt. The glob one level up
    found nothing ("no checkpoint found" on every job), and export opens --checkpoint-file as a
    path, so it must get the path, not the file's bare name."""
    from mjlab_microduck import hf_jobs

    assert hf_jobs.EXPORT_STEP in hf_jobs.BOOTSTRAP
    run = tmp_path / "logs" / "rsl_rl" / "sprint_2m" / "2026-09-28_10-00-00_first"
    run.mkdir(parents=True)
    for n in (0, 50, 100):
        checkpoint = run / f"model_{n}.pt"
        checkpoint.write_text("x")
        os.utime(checkpoint, (1_000 + n, 1_000 + n))  # the last one saved is the newest
    fakes = tmp_path / "bin"
    fakes.mkdir()
    calls = tmp_path / "uv-calls"
    # Fails, so the upload after the export is never reached.
    (fakes / "uv").write_text(f'#!/bin/sh\necho "$@" >> {calls}\nexit 1\n')
    (fakes / "uv").chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{fakes}{os.pathsep}{os.environ['PATH']}",
        "TRAIN_RC": "0",
        "TRAIN_ARGS": "Mjlab-Sprint2m-MicroDuck --agent.seed 1",
    }
    proc = subprocess.run(
        ["bash", "-c", hf_jobs.EXPORT_STEP], cwd=tmp_path, env=env, capture_output=True, text=True
    )
    assert "no checkpoint found" not in proc.stdout, proc.stdout + proc.stderr
    first = calls.read_text().splitlines()[0]
    assert first.startswith("run python -m mjlab_microduck.export Mjlab-Sprint2m-MicroDuck")
    assert "--checkpoint-file logs/rsl_rl/sprint_2m/2026-09-28_10-00-00_first/model_100.pt" in first
```

- [ ] **Step 3: Run them to see them fail**

```bash
PYTHONPATH=src $PY -m pytest tests/test_hf_jobs_flag.py -q -k "uploader_pushes or auto_export"
```

Expected: FAIL — the tfevents file is not watched; `AttributeError: module 'mjlab_microduck.hf_jobs' has no attribute 'EXPORT_STEP'`.

- [ ] **Step 4: Watch the TensorBoard files**

In `src/mjlab_microduck/hf_uploader.py`, the first docstring line becomes:

```python
"""Checkpoint uploader run inside an HF Job.

Watches `logs/rsl_rl/**/model_*.pt` (with the run's params, `provenance.json` and TensorBoard files) and uploads new/updated files to the
```

and `_watched`:

```python
def _watched(root: Path) -> list[Path]:
    """The checkpoints, the dumped configs, the provenance `publish --run` needs, and the
    TensorBoard files the workshop draws its curve from (re-sent as they grow)."""
    files = list(root.glob("**/model_*.pt"))
    files += root.glob("**/params/*.yaml")
    files += root.glob("**/params/*.json")
    files += root.glob("**/provenance.json")
    files += root.glob("**/events.out.tfevents.*")
    return files
```

- [ ] **Step 5: Split the auto-export out of the bootstrap and fix its glob**

In `src/mjlab_microduck/hf_jobs.py`, cut the block from the comment `# Auto-export the final checkpoint to daemon-ready ONNX …` down to (and including) the `fi` that closes `if [ "$TRAIN_RC" -eq 0 ] …`, and put it, fixed, in a constant defined **before** `BOOTSTRAP`:

```python
# Run after training, while the env is still warm. Its own constant so a test can run it in bash.
EXPORT_STEP = r"""
# Auto-export the final checkpoint to daemon-ready ONNX while the env is
# still warm — a separate export job would pay the full bootstrap (image
# pull + apt + uv sync) again just to run this one command. Best-effort:
# an export failure must not mark a successful training as failed.
if [ "$TRAIN_RC" -eq 0 ] && [ "${AUTO_EXPORT:-1}" = "1" ]; then
    set +e
    TASK_ID=${TRAIN_ARGS%% *}
    # A run is logs/rsl_rl/<experiment>/<stamp>_<name>/, and export opens
    # --checkpoint-file as a path: hand it the path, not the file's name.
    CKPT=$(ls -t logs/rsl_rl/*/*/model_*.pt 2>/dev/null | head -1)
    if [ -n "$CKPT" ]; then
        echo "[bootstrap] auto-exporting ONNX from $CKPT"
        uv run python -m mjlab_microduck.export "$TASK_ID" \
            --checkpoint-file "$CKPT" \
            --num-envs 1 --onnx-file /work/policy.onnx \
        && uv run python - <<'PY'
import os
from huggingface_hub import HfApi
HfApi().upload_file(path_or_fileobj="/work/policy.onnx",
                    path_in_repo="exported/policy.onnx",
                    repo_id=os.environ["CKPT_REPO"], repo_type="model")
print("[bootstrap] uploaded exported/policy.onnx")
PY
        [ $? -ne 0 ] && echo "[bootstrap] auto-export failed (training still OK)"
    else
        echo "[bootstrap] no checkpoint found, skipping auto-export"
    fi
    set -e
fi
"""
```

and make `BOOTSTRAP` end with it: keep `BOOTSTRAP = r"""…` exactly as it was up to and including the line `CKPT_ONE_SHOT=1 uv run python -m mjlab_microduck.hf_uploader || true`, close the string there, and write

```python
""" + EXPORT_STEP + r"""
exit $TRAIN_RC
"""
```

(`BOOTSTRAP` stays one `str`; `test_the_bootstrap_runs_modules_not_repo_scripts` keeps passing because `EXPORT_STEP` is inside it.)

- [ ] **Step 6: Say it in the HF README**

`scripts/hf/README.md` line 56: `(watches logs/rsl_rl/**/model_*.pt, pushes every 60s)` → `(watches logs/rsl_rl/**/model_*.pt, the run's params, provenance.json and TensorBoard files; pushes every 60s)`.

- [ ] **Step 7: Run the file again**

```bash
PYTHONPATH=src $PY -m pytest tests/test_hf_jobs_flag.py -q 2>&1 | tail -3
```

Expected: `1 failed, 17 passed` — the same environment-only failure as Step 1, nothing else.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add src/mjlab_microduck/hf_uploader.py src/mjlab_microduck/hf_jobs.py scripts/hf/README.md tests/test_hf_jobs_flag.py
/usr/bin/git commit -m "HF Jobs: upload the run's TensorBoard files, and auto-export from the run's own checkpoint path"
```

---

### Task 2: Events declare the kind of policy they take

**Files:**
- Modify: `arena/manifest.py` (a `KINDS` tuple, `Manifest.kind`, `load_manifest`)
- Modify: all eight `arena/events/*.toml`
- Test: `tests/test_manifest.py`

**Interfaces:**
- Produces: `arena.manifest.KINDS == ("episodic", "perpetual")`; `Manifest.kind: str`, required in every event file; every shipped event is `"perpetual"`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_manifest.py`, give `GOOD` a `kind` entry right after `root` (the dict's order is the file's order, and `kind` is a top-level key, so it must come before the first `[section]`):

```python
GOOD = {
    "root": 'id="probe"\ntitle="Probe"\nrig="legs"\ncategory="race"\n'
            'time_limit_s=10.0\nmetric="mean_finish_time"\nseeds=[1]\n',
    "kind": 'kind="perpetual"\n',
    "course": '[course]\nkind="lane"\nlength_m=1.0\nwidth_m=0.8\n'
    # … the rest unchanged
```

and append:

```python
def test_every_shipped_event_takes_perpetual_policies():
    """What `publish` writes for a gait, and what the Space checks a manifest's `kind` against."""
    assert {e.id: e.kind for e in all_events()} == {e.id: "perpetual" for e in all_events()}


def test_an_unknown_kind_is_refused(tmp_path):
    with pytest.raises(ManifestError, match="unknown kind"):
        load_manifest(write_manifest(tmp_path, kind='kind="forever"\n'))


def test_a_missing_kind_is_refused(tmp_path):
    """No default: an entry's manifest is checked against it, and a guessed kind would
    admit or refuse the wrong policies without anyone having decided which."""
    with pytest.raises(ManifestError, match="missing 'kind'"):
        load_manifest(write_manifest(tmp_path, kind=""))
```

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_manifest.py -q
```

Expected: the three new tests FAIL (`AttributeError: 'Manifest' object has no attribute 'kind'`, no `ManifestError`).

- [ ] **Step 3: Load and validate `kind`**

In `arena/manifest.py`, after `METRICS`:

```python
# What an entry must be, in the policy manifest's own words
# (mjlab_microduck.publish.manifest.KINDS): `perpetual` runs until told
# otherwise, `episodic` ends itself. The Space refuses a policy whose
# manifest.json names another kind than its event's (arena/hub_fetch.py).
KINDS = ("episodic", "perpetual")
```

In `Manifest`, right after `category: str` and its comment:

```python
    # "perpetual" or "episodic": the kind of policy this event races. Checked
    # against an entry's manifest.json; a policy's own contract, not a score input.
    kind: str
```

In `load_manifest`, right after the `category` check (the name `kind` is already taken there by the course's kind, hence `policy_kind`):

```python
    policy_kind = _require(raw, "kind", str(path))
    if policy_kind not in KINDS:
        raise ManifestError(f"{path}: unknown kind {policy_kind!r}, expected one of {KINDS}")
```

and pass `kind=policy_kind,` to `Manifest(...)` after `category=category,`.

- [ ] **Step 4: Declare it in every event**

In each of the eight files in `arena/events/`, add right after the `category     = "…"` line, aligned the same way:

```toml
kind         = "perpetual"
```

- [ ] **Step 5: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_manifest.py tests/test_routes_read.py tests/test_course.py -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add arena/manifest.py arena/events/*.toml tests/test_manifest.py
/usr/bin/git commit -m "Events declare the kind of policy they take"
```

---

### Task 3: Read a policy's manifest at a pinned revision, and refuse one that disagrees with its event

**Files:**
- Modify: `arena/hub_fetch.py`
- Modify: `arena/recover.py` (reads the rig through `rig_of`; defines its own `TAG`)
- Test: `tests/test_hub_fetch.py`, `tests/test_recover.py`

**Interfaces:**
- Consumes: `Manifest.kind`, `Manifest.rig`, `Manifest.title` (Task 2); `arena.constants.OBS_SIZE` (61), `NUM_JOINTS` (14).
- Produces:
  - `fetch_policy(repo_ref: str, revision: str | None = None, event: Manifest | None = None, download=…, info=…) -> FetchedPolicy`. `info(repo_id, revision) -> (files, sha, sizes)`; `download(repo_id, filename, revision) -> path`. With `event`, a present manifest is checked **before** the ONNX is downloaded.
  - `FetchedPolicy.manifest: dict | None` (the parsed `manifest.json`, None when the repo has none); `FetchedPolicy.revision` is the commit the files were read at.
  - `rig_of(manifest: dict) -> str | None` — `"legs"`, `"rollers"`, or None for a machine no event races.
  - `check_manifest(manifest: dict, event: Manifest) -> None`, raising `FetchError` naming the field.

- [ ] **Step 1: Adapt the existing tests to the new `info` signature**

In `tests/test_hub_fetch.py`, every `info=lambda repo_id: (…)` becomes `info=lambda repo_id, revision: (…)` (the tests at lines 41–140; the network test at the bottom uses the defaults and is untouched).

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_hub_fetch.py`:

```python
import json

from arena.hub_fetch import check_manifest, rig_of
from arena.manifest import load_event

GOOD_MANIFEST = {
    "obs_len": 61,
    "action_len": 14,
    "kind": "perpetual",
    "name": "walker",
    "robot": {"model": "microduck", "accessories": []},
}


def _fetch(tmp_path, manifest, event_id="sprint-2m", revision=None, downloads=None):
    """fetch_policy against a fake Hub holding policy.onnx and, unless None, this manifest."""
    files = ["README.md", "policy.onnx"] + ([] if manifest is None else ["manifest.json"])
    manifest_path = tmp_path / "manifest.json"
    if manifest is not None:
        manifest_path.write_text(manifest if isinstance(manifest, str) else json.dumps(manifest))
    seen = [] if downloads is None else downloads

    def download(repo_id, filename, rev):
        seen.append((filename, rev))
        return str(manifest_path) if filename == "manifest.json" else "/tmp/x.onnx"

    return fetch_policy(
        "alice/walker",
        revision=revision,
        event=load_event(event_id),
        info=lambda repo_id, rev: (files, f"sha-of-{rev or 'main'}", {}),
        download=download,
    )


def test_a_matching_manifest_is_read_and_kept(tmp_path):
    assert _fetch(tmp_path, GOOD_MANIFEST).manifest == GOOD_MANIFEST


def test_a_repo_without_a_manifest_is_still_accepted(tmp_path):
    """Not every community repo has one; the ONNX is validated regardless."""
    assert _fetch(tmp_path, None).manifest is None


def test_a_revision_pins_every_file_and_the_link(tmp_path):
    downloads = []
    fetched = _fetch(tmp_path, GOOD_MANIFEST, revision="abc123", downloads=downloads)
    assert fetched.revision == "sha-of-abc123"
    assert downloads == [("manifest.json", "sha-of-abc123"), ("policy.onnx", "sha-of-abc123")]
    assert fetched.url.endswith("/resolve/sha-of-abc123/policy.onnx")


@pytest.mark.parametrize(
    "change,field",
    [
        ({"obs_len": 48}, "obs_len"),
        ({"action_len": 12}, "action_len"),
        ({"kind": "episodic"}, "kind"),
        ({"robot": {"model": "microduck", "accessories": ["rollers"]}}, "robot"),
        ({"robot": {"model": "flyduck"}}, "robot"),
    ],
)
def test_a_manifest_that_disagrees_with_the_event_is_refused_by_field(tmp_path, change, field):
    downloads = []
    with pytest.raises(FetchError, match=field):
        _fetch(tmp_path, GOOD_MANIFEST | change, downloads=downloads)
    assert [name for name, _ in downloads] == ["manifest.json"], "refused before the ONNX is fetched"


def test_a_roller_manifest_enters_the_roller_sprint(tmp_path):
    rollers = GOOD_MANIFEST | {"robot": {"model": "microduck", "accessories": ["rollers"]}}
    assert _fetch(tmp_path, rollers, event_id="roller-sprint-2m").manifest == rollers


def test_a_manifest_that_is_not_json_is_refused(tmp_path):
    with pytest.raises(FetchError, match="not valid JSON"):
        _fetch(tmp_path, "{nope")


@pytest.mark.parametrize(
    "robot,rig",
    [
        ({"model": "microduck", "accessories": []}, "legs"),
        ({"model": "microduck"}, "legs"),
        ({"model": "microduck", "accessories": ["rollers"]}, "rollers"),
        # What this Arena's own publisher wrote before `uv run publish` took over.
        ({"model": "microduck passive rollers"}, "rollers"),
        ({"model": "flyduck"}, None),
        ({}, None),
    ],
)
def test_the_rig_is_read_from_both_vocabularies(robot, rig):
    assert rig_of({"robot": robot}) == rig


def test_check_manifest_is_silent_when_everything_agrees():
    check_manifest(GOOD_MANIFEST, load_event("sprint-2m"))
```

Append to `tests/test_recover.py`:

```python
def test_a_manifest_written_by_publish_maps_its_accessories_to_the_rig():
    """`uv run publish` says rollers as an accessory of the one "microduck" robot."""
    manifest = {"name": "skater", "robot": {"model": "microduck", "accessories": ["rollers"]}}
    found = candidates(lambda: [("alice/microduck-skater", "rev1")], lambda repo_id: manifest, all_tagged=True)
    assert [c.rig for c in found] == ["rollers"]
```

(`candidates` is already imported at the top of `test_recover.py`; add it to the import if not.)

- [ ] **Step 3: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_hub_fetch.py tests/test_recover.py -q
```

Expected: FAIL — `ImportError: cannot import name 'check_manifest'`.

- [ ] **Step 4: Read and check the manifest**

In `arena/hub_fetch.py`: add to the module docstring, as a last paragraph:

```
A repo's `manifest.json`, when it has one, is read at the same pinned revision
and, when the caller names the event, checked against it before the ONNX is
downloaded: the observation and action sizes, the robot the event races, the
kind of policy it takes. A repo without one is accepted as before.
```

Imports and constants:

```python
import json
from dataclasses import dataclass
from pathlib import Path

from .constants import NUM_JOINTS, OBS_SIZE
from .policy import MAX_MODEL_BYTES

PREFERRED = "policy.onnx"
MANIFEST = "manifest.json"
# What this Arena's own publisher (removed) wrote for the roller rig, before
# `uv run publish` described rollers as an accessory of the one microduck.
LEGACY_ROLLERS_MODEL = "microduck passive rollers"
```

`FetchedPolicy` gains a last field:

```python
    # The repo's manifest.json, parsed, or None when it has none.
    manifest: dict | None = None
```

`_default_info` takes the revision:

```python
def _default_info(repo_id: str, revision: str | None):
    from huggingface_hub import HfApi

    # files_metadata=True is what makes each sibling carry `.size` — without
    # it the Hub returns the file list alone, and there is nothing to check
    # the cap against before downloading.
    info = HfApi().model_info(repo_id, revision=revision, files_metadata=True)
    siblings = info.siblings or []
    files = [s.rfilename for s in siblings]
    sizes = {s.rfilename: s.size for s in siblings}
    return files, info.sha, sizes
```

Add, before `fetch_policy`:

```python
def rig_of(manifest: dict) -> str | None:
    """The Arena rig a policy manifest describes, or None for a machine no event races."""
    robot = manifest.get("robot") or {}
    model = robot.get("model")
    if model == LEGACY_ROLLERS_MODEL:
        return "rollers"
    if model != "microduck":
        return None
    return "rollers" if "rollers" in (robot.get("accessories") or []) else "legs"


def check_manifest(manifest: dict, event) -> None:
    """Refuse a policy whose manifest.json disagrees with `event`, naming the field."""
    if manifest.get("obs_len") != OBS_SIZE:
        raise FetchError(
            f"{MANIFEST}: obs_len is {manifest.get('obs_len')!r}; the Arena feeds {OBS_SIZE} observations"
        )
    if manifest.get("action_len") != NUM_JOINTS:
        raise FetchError(
            f"{MANIFEST}: action_len is {manifest.get('action_len')!r}; the Arena drives {NUM_JOINTS} joints"
        )
    if rig_of(manifest) != event.rig:
        robot = manifest.get("robot") or {}
        raise FetchError(
            f"{MANIFEST}: robot {robot.get('model')!r} with accessories {robot.get('accessories') or []} "
            f"is not the {event.rig} robot {event.title} races"
        )
    if manifest.get("kind") != event.kind:
        raise FetchError(
            f"{MANIFEST}: kind is {manifest.get('kind')!r}; {event.title} takes {event.kind} policies"
        )


def _read_manifest(repo_id: str, revision: str, download) -> dict:
    try:
        path = Path(download(repo_id, MANIFEST, revision))
    except Exception as exc:
        raise FetchError(f"could not download {repo_id}/{MANIFEST}: {exc}") from exc
    try:
        manifest = json.loads(path.read_text())
    except ValueError as exc:
        raise FetchError(f"{repo_id}/{MANIFEST} is not valid JSON: {exc}") from exc
    if not isinstance(manifest, dict):
        raise FetchError(f"{repo_id}/{MANIFEST} is not a JSON object")
    return manifest
```

and `fetch_policy` becomes:

```python
def fetch_policy(
    repo_ref: str,
    revision: str | None = None,
    event=None,
    download=_default_download,
    info=_default_info,
) -> FetchedPolicy:
    repo_id, wanted = parse_repo_ref(repo_ref)
    try:
        files, sha, sizes = info(repo_id, revision)
    except FetchError:
        raise
    except Exception as exc:
        raise FetchError(f"could not read {repo_id}: {exc}") from exc
    # Every file is read at the commit the listing came from, so the manifest
    # checked and the weights raced are one publication, not two.
    pinned = sha or revision or "main"

    filename = _pick(list(files), wanted, repo_id)

    # Refused BEFORE downloading anything: a declared size over the cap costs
    # nothing to reject. A missing (None) size is not evidence of a large
    # file, so it is not grounds for refusal — `load_policy` still checks the
    # actual bytes once they exist, downstream.
    size = (sizes or {}).get(filename)
    if size is not None and size > MAX_MODEL_BYTES:
        raise FetchError(
            f"{repo_id}/{filename} is {size} bytes, larger than the "
            f"{MAX_MODEL_BYTES} byte limit"
        )

    manifest = _read_manifest(repo_id, pinned, download) if MANIFEST in files else None
    if manifest is not None and event is not None:
        check_manifest(manifest, event)  # before the weights: a refusal costs one small file

    try:
        path = Path(download(repo_id, filename, pinned))
    except Exception as exc:
        raise FetchError(f"could not download {repo_id}/{filename}: {exc}") from exc

    return FetchedPolicy(
        repo_id=repo_id,
        filename=filename,
        revision=pinned,
        path=path,
        url=f"https://huggingface.co/{repo_id}/resolve/{pinned}/{filename}",
        manifest=manifest,
    )
```

- [ ] **Step 5: Recovery reads the rig the same way**

In `arena/recover.py`, replace

```python
from .constants import RUNNER_VERSION
from .hub_publish import RIG_MODEL, TAGS

TAG = TAGS[0]  # "microduck-policy"
PUBLISHER = "microduck-arena"
# manifest robot.model -> our rig name. The inverse of hub_publish.RIG_MODEL.
_RIG_BY_MODEL = {model: rig for rig, model in RIG_MODEL.items()}
```

with

```python
from .constants import RUNNER_VERSION
from .hub_fetch import rig_of

# The tag the ecosystem searches policies by.
TAG = "microduck-policy"
PUBLISHER = "microduck-arena"
```

and in `_candidate`, replace the two lines reading `robot = …` and `rig = _RIG_BY_MODEL.get(robot.get("model"))` with

```python
    rig = rig_of(manifest or {})
```

- [ ] **Step 6: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_hub_fetch.py tests/test_recover.py tests/test_routes_submit.py -q
```

Expected: all pass (`routes_submit` still calls `fetch_policy(repo_id)`, which keeps working).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add arena/hub_fetch.py arena/recover.py tests/test_hub_fetch.py tests/test_recover.py
/usr/bin/git commit -m "Read a policy's manifest at a pinned revision and refuse one that disagrees with its event"
```

---

### Task 4: Entering takes a Hub repo at a revision; the Space publishes nothing

**Files:**
- Modify: `arena/web/routes_submit.py`
- Delete: `arena/hub_publish.py`, `tests/test_hub_publish.py`
- Test: `tests/test_routes_submit.py`

**Interfaces:**
- Consumes: `fetch_policy(repo_ref, revision, event)`, `FetchedPolicy.manifest` (Task 3).
- Produces:
  - `POST /api/events/{id}/submit` form fields: `repo_id` (required), `revision` (optional; pinned when given), `name`, `livery`, `command_vx`, `env_url`. A `file` is refused: 400 with `PUBLISH_A_REPO`, which names the workshop and `uv run publish`.
  - `POST /api/events/{id}/try`: as before (a file **or** a `repo_id`), plus `revision`.
  - `arena.web.routes_submit._fetch_from_hub(repo_id: str, revision: str | None, event) -> FetchedPolicy` — the one function tests replace.
  - A Hub entry with no typed name is called by its manifest's `name`, else its repo's name without `microduck-`.

- [ ] **Step 1: Route every test's submission through a fake Hub**

In `tests/test_routes_submit.py`, replace the `submit` helper with a fake Hub the whole file uses:

```python
from pathlib import Path

from arena.hub_fetch import FetchedPolicy

# Every entry is a Hub repo now. `submit()` puts the file it is given in this
# fake Hub under a repo id; the autouse fixture below serves it back.
_HUB: dict[str, Path] = {}


def _fetched(path=REFERENCE, repo_id="alice/walker", filename="policy.onnx", revision="rev1", manifest=None):
    return FetchedPolicy(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        path=path,
        url=f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}",
        manifest=manifest,
    )


@pytest.fixture(autouse=True)
def hub(monkeypatch):
    """Stands in for the Hub: a repo id registered in _HUB comes back as that file, at the
    revision asked for. Records every call, so a test can see what reached it."""
    _HUB.clear()
    calls = []

    def fetch(repo_id, revision, event):
        calls.append((repo_id, revision, event.id))
        if repo_id not in _HUB:
            from arena.hub_fetch import FetchError

            raise FetchError(f"{repo_id} has no .onnx file")
        return _fetched(path=_HUB[repo_id], repo_id=repo_id, revision=revision or "rev1")

    monkeypatch.setattr("arena.web.routes_submit._fetch_from_hub", fetch)
    return calls


def submit(api, path=REFERENCE, event="sprint-2m", name="walker", **fields):
    repo_id = f"alice/{Path(path).stem.lower()}"
    _HUB[repo_id] = Path(path)
    data = {"repo_id": repo_id, **fields}
    if name is not None:
        data["name"] = name
    return api.post(f"/api/events/{event}/submit", data=data)
```

Delete the old `_fetched` further down (it moved up). Then, test by test:

- Every test that posted a file to `/submit` itself (search `"/submit",` with `files=`) calls `submit(api, …)` instead, keeping its assertions.
- `test_the_policy_name_defaults_to_the_filename` becomes:

```python
def test_a_nameless_entry_is_called_by_its_manifest_then_its_repo(api, monkeypatch):
    monkeypatch.setattr(
        "arena.web.routes_submit._fetch_from_hub",
        lambda repo_id, revision, event: _fetched(repo_id="alice/microduck-walker", manifest={"name": "strider"}),
    )
    named = api.post("/api/events/sprint-2m/submit", data={"repo_id": "alice/microduck-walker"}).json()
    assert named["policy_name"] == "strider"
    monkeypatch.setattr(
        "arena.web.routes_submit._fetch_from_hub",
        lambda repo_id, revision, event: _fetched(repo_id="alice/microduck-walker"),
    )
    bare = api.post("/api/events/sprint-2m/submit", data={"repo_id": "alice/microduck-walker"}).json()
    assert bare["policy_name"] == "walker"
```

- `test_an_oversize_upload_is_refused_before_anything_is_written` is deleted (an upload can no longer be published; `test_an_oversize_trial_is_refused_too` keeps the size guard covered).
- `test_a_hub_published_run_stores_no_weights_and_records_a_link`, `test_a_failed_hub_write_records_nothing_at_all`, `test_a_signed_in_repo_id_race_never_republishes_to_the_hub` and `test_a_policy_that_fails_validation_never_reaches_the_hub` are deleted with the code they tested.
- The repo-id tests that patched `_fetch_from_hub` with `lambda repo_id: fetched` now take `lambda repo_id, revision, event: fetched`.
- `test_sending_both_a_file_and_a_repo_id_is_refused` and `test_sending_neither_a_file_nor_a_repo_id_is_refused` post to `/try` (where that rule still holds).

Add:

```python
def test_publishing_a_file_is_refused_with_the_two_ways_to_publish(api, store_dir):
    with open(REFERENCE, "rb") as fh:
        response = api.post("/api/events/sprint-2m/submit", files={"file": ("w.onnx", fh)})
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "workshop" in detail and "uv run publish" in detail
    assert list(store_dir.rglob("*.json")) == []


def test_a_file_and_a_repo_together_are_refused_for_publishing_too(api):
    _HUB["alice/walker"] = REFERENCE
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit", files={"file": ("w.onnx", fh)}, data={"repo_id": "alice/walker"}
        )
    assert response.status_code == 400
    assert "uv run publish" in response.json()["detail"]


def test_a_revision_is_pinned_and_recorded(api, hub):
    body = submit(api, revision="abc1234").json()
    assert hub[-1] == ("alice/best_alpha_walking", "abc1234", "sprint-2m")
    assert body["policy_url"].endswith("/resolve/abc1234/policy.onnx")
    row = api.get("/api/events/sprint-2m/leaderboard").json()["rows"][0]
    assert row["policy_url"] == body["policy_url"]


def test_a_trial_can_pin_a_revision_too(api, hub):
    _HUB["alice/walker"] = REFERENCE
    response = api.post("/api/events/sprint-2m/try", data={"repo_id": "alice/walker", "revision": "abc1234"})
    assert response.status_code == 200, response.text
    assert hub[-1] == ("alice/walker", "abc1234", "sprint-2m")


def test_a_manifest_that_disagrees_is_a_400_naming_the_field(api, monkeypatch, store_dir):
    from arena.hub_fetch import FetchError

    def refuse(repo_id, revision, event):
        raise FetchError(f"manifest.json: kind is 'episodic'; {event.title} takes {event.kind} policies")

    monkeypatch.setattr("arena.web.routes_submit._fetch_from_hub", refuse)
    response = api.post("/api/events/sprint-2m/submit", data={"repo_id": "alice/walker"})
    assert response.status_code == 400
    assert "kind" in response.json()["detail"]
    assert list(store_dir.rglob("*.json")) == []
```

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_routes_submit.py -q
```

Expected: many FAIL (the fake is called with three arguments; a file still publishes).

- [ ] **Step 3: Rewrite the submit route's Hub side**

In `arena/web/routes_submit.py`:

Module docstring — append a paragraph:

```
Entering the board takes a Hugging Face repo, at a revision when one is given:
the policy is published by its author (`uv run publish`, or the workshop that
runs it) and the Space only reads it. A file can still be tried, never
entered — the Space writes into no one's namespace and keeps no weights.
```

Imports: drop `from ..hub_publish import HubPublishError, publish_policy`. Delete `_publish_to_hub`. Replace `_fetch_from_hub` with:

```python
def _fetch_from_hub(repo_id: str, revision: str | None, event) -> FetchedPolicy:
    """Wrapped so tests replace one function rather than the Hub client."""
    return fetch_policy(repo_id, revision=revision, event=event)
```

Add after `router = APIRouter(prefix="/api")`:

```python
PUBLISH_A_REPO = (
    "A file can be tested, not published. Publish it to your Hugging Face account "
    "first — from the workshop (Train my robot, on this page) or with `uv run publish` — "
    "then enter its repo here."
)
```

`_race` gains `revision` and hands the event to the fetch:

```python
async def _race(
    event_id: str,
    file: UploadFile | None,
    repo_id: str | None = None,
    command_vx: str | None = None,
    revision: str | None = None,
):
```

and inside it `fetched = await run_in_threadpool(_fetch_from_hub, repo_id, revision, manifest)`. Update its docstring's first paragraph: "Exactly one of `file` (a trial's upload) and `repo_id` (a Hub repo, at `revision` when given) …".

Names:

```python
def _hub_name(fetched: FetchedPolicy) -> str:
    """A Hub entry's name when its author typed none: its manifest's, else its repo's."""
    named = str((fetched.manifest or {}).get("name") or "").strip()
    return named or fetched.repo_id.rsplit("/", 1)[-1].removeprefix("microduck-")


def _label(name: str | None, fallback: str) -> str:
    # Capped: this is submitter-supplied text that ends up on a shared board, and
    # nothing downstream bounds it. 80 characters is generous for a policy name.
    return ((name or "").strip() or fallback)[:80]
```

`try_policy` gains `revision: str | None = Form(default=None)`, calls `_race(event_id, file, repo_id, command_vx, revision)`, and names with
`_label(name, Path(file.filename or "policy.onnx").stem if file else _hub_name(fetched))`.

`submit` gains `revision: str | None = Form(default=None)` and becomes, from the session check on:

```python
    session = _require_session(request)
    if file is not None or not repo_id:
        raise HTTPException(status_code=400, detail=PUBLISH_A_REPO)
    # Checked before racing: a link this server will refuse should cost nobody
    # thirty seconds of simulation first.
    link = _env_url(env_url)
    # (keep the long comment on command_vx here, unchanged)
    manifest, policy, result, _payload, fetched = await _race(
        event_id, None, repo_id, command_vx, revision
    )

    store = request.app.state.store
    record = RunRecord(
        run_id=new_id(),
        event_id=manifest.id,
        # Zero-padded ISO-8601 ending in Z. arena/index.py breaks a full tie by
        # comparing this as a STRING, so an isoformat() offset would misorder it.
        submitted_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        user=session.username,
        policy_name=_label(name, _hub_name(fetched)),
        source={
            "kind": "hub",
            "repo_id": fetched.repo_id,
            "filename": fetched.filename,
            "revision": fetched.revision,
            "url": fetched.url,
        },
        model_sha256=policy.sha256,
        score=result.score,
        command_vx=result.command_vx,
        seeds_finished=result.seeds_finished,
        per_seed=result.per_seed,
        trace_seed=result.trace_seed,
        runner_version=result.runner_version,
        # The weights live in the author's own repo, at this revision; the
        # Space keeps none, and anyone can download and race them from there.
        model_stored=False,
        env_url=link,
        livery=_livery(livery),
    )
    store.append(record, trace_codec.encode(result.trace, result.settle))
```

(the clip block and the response dict after it are unchanged; `session.token` is no longer read anywhere in this file).

- [ ] **Step 4: Delete the Arena's publisher**

```bash
/usr/bin/git rm -q arena/hub_publish.py tests/test_hub_publish.py
grep -rn "hub_publish\|publish_policy\|HubPublishError" arena tests app/src docs/guides README.md || echo "none left"
```

Expected: `none left`.

- [ ] **Step 5: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_routes_submit.py tests/test_recover.py tests/test_hub_fetch.py tests/test_web_app.py -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add -A arena tests
/usr/bin/git commit -m "Enter a Hub repo at a pinned revision, refuse files for publishing, and delete the Arena's own publisher"
```

---

### Task 5: The Space keeps no visitor token

With `hub_publish.py` gone, nothing reads a visitor's OAuth token after sign-in: the Space asks only who you are.

**Files:**
- Modify: `arena/web/session.py` (`Session` without `token`, `Sessions.create(username, ttl_s)`, docstring)
- Modify: `arena/web/routes_auth.py` (callback, `current_user`, `/api/me` without `can_publish_to_hub`, docstring)
- Modify: `README.md` (Space front matter: drop `hf_oauth_scopes`)
- Modify: `app/src/session.js`, `app/src/session.test.js`, `app/src/race.js`, `app/src/race.test.js` (no `no-hub` state)
- Test: `tests/test_session.py`, `tests/test_routes_auth.py`, `tests/test_routes_submit.py` (`sign_in` helper)

**Interfaces:**
- Produces: `Session(username: str, expires_at: float)`; `Sessions.create(username: str, ttl_s: float) -> str`; `/api/me` → `{signed_in, user, oauth_enabled, [points, unseen]}`; `panelState(me)` → `"signed-out" | "ready"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_routes_auth.py`:

```python
def test_the_space_asks_for_no_write_scope():
    """It writes into no one's namespace any more, so it must not ask for the right to."""
    from pathlib import Path

    front_matter = (Path(__file__).resolve().parents[1] / "README.md").read_text().split("---")[1]
    assert "hf_oauth_scopes" not in front_matter and "contribute-repos" not in front_matter
```

and in the existing tests that assert `body["can_publish_to_hub"]` (lines ~37 and ~103), replace the assertion with `assert "can_publish_to_hub" not in body`. In `tests/test_session.py`, calls `create(username, token, ttl)` become `create(username, ttl)`; add:

```python
def test_a_session_holds_no_token():
    from arena.web.session import Session

    assert [f.name for f in dataclasses.fields(Session)] == ["username", "expires_at"]
```

(`import dataclasses` at the top if missing.) In `tests/test_routes_submit.py` the helper becomes `def sign_in(api, username="alice"):` with `sid = app.state.sessions.create(username, 3600)`, and its callers drop `token="hf_tok"`. Search the tests for any other `sessions.create(` or `token=` passed to it and adapt the same way.

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_session.py tests/test_routes_auth.py tests/test_routes_submit.py -q
```

Expected: FAIL (`create()` still takes a token; `can_publish_to_hub` still sent; scopes still in the README).

- [ ] **Step 3: Drop the token**

`arena/web/session.py`: the docstring's first paragraph becomes

```
The cookie carries an OPAQUE session id, and the session holds a name and an
expiry — nothing else. The Space reads a visitor's identity at sign-in and
writes into no one's Hub namespace, so it keeps no token of theirs at all.
```

(keep the paragraph on the in-memory table, minus its last clause about a leaked token). `Session` loses `token`; `Sessions.create(self, username: str, ttl_s: float)` builds `Session(username, time.time() + ttl_s)`; the eviction comment's "dead tokens" becomes "dead sessions".

`arena/web/routes_auth.py`: in the module docstring, "the session names a real Hugging Face user and carries their token" → "the session names a real Hugging Face user"; "there is no token, so nothing can be written to anyone's Hub namespace" → drop that clause. `current_user`'s local branch: `Session(username=config.dev_user, expires_at=float("inf"))` and its comment "Local: ARENA_DEV_USER is always signed in." In `callback`: `sid = request.app.state.sessions.create(username, config.session_ttl_s)` (the token from `_exchange` is used for `_username` only, then dropped). In `me`: delete the `can_publish_to_hub` entry and its comment.

`README.md` front matter: delete the two lines `hf_oauth_scopes:` and `  - contribute-repos`.

- [ ] **Step 4: The entry panel has two states**

`app/src/session.js`:

```js
/**
 * Which of the two panels to render: signed out, or ready to race.
 *
 * Locally there is no OAuth at all and ARENA_DEV_USER is always signed in,
 * which is `ready` — a sign-in button there is a dead end.
 */
export function panelState(me) {
  return me && me.signed_in ? "ready" : "signed-out";
}
```

and fix the file's header comment ("three states" → "two states"). `app/src/session.test.js`: drop the `no-hub` cases and the `can_publish_to_hub` fields. `app/src/race.js`: in `renderEntryPanel`, remove `${state === "no-hub" ? "disabled" : ""}` on `#publish`, the `entry__nohub` paragraph, the `no-hub` guard in `run()` and its comment, and set `publishButton.disabled = false;` in `finally`. `app/src/race.test.js`: delete `describe("renderEntryPanel: no-hub …")` and remove `can_publish_to_hub: true,` from every `me` object.

- [ ] **Step 5: Run everything touched**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_session.py tests/test_routes_auth.py tests/test_routes_submit.py tests/test_oauth.py -q
cd app && npx vitest run src/session.test.js src/race.test.js && cd ..
grep -rn "can_publish_to_hub\|no-hub\|nohub" arena app/src app/public || echo "none left"
```

Expected: all pass; `none left`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add -A arena tests app/src app/public README.md
/usr/bin/git commit -m "Keep no visitor token: the Space no longer writes to anyone's Hub namespace"
```

---

### Task 6: The Space serves the one line's launcher

Verified while planning (2026-09-28, uv 0.9.21): `uv run http://127.0.0.1:<port>/workshop.py sprint-2m` fetches a script served as `text/x-python` and runs it with its argument, even from inside the challenges project, without syncing that project — because the script carries inline metadata (`# /// script`). Task 17 repeats it against `arena serve`.

**Files:**
- Create: `arena/workshop/__init__.py`, `arena/workshop/launcher.py`
- Create: `arena/web/routes_launcher.py`
- Modify: `arena/web/app.py` (include the router, before the static mount)
- Test: `tests/test_launcher.py`

**Interfaces:**
- Produces: `GET /workshop.py` → `text/x-python`, the launcher with `ARENA = '<this Arena's origin>'` (`config.public_origin`, else the request's base URL). The launcher's contract: run in a directory; if it is a microduck-challenges checkout (has `src/microduck_challenges/`) work there, else in `./microduck-challenges`, cloned from `https://github.com/pollen-robotics/microduck-challenges` if missing; export `HF_TOKEN` from the saved Hub token when the environment has none; then `exec uv run --frozen --group workshop workshop <its args…> --arena <ARENA>` in that checkout.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_launcher.py
"""The one line: `uv run <arena>/workshop.py <challenge>`. The Arena serves the launcher with its
own address written in, and the launcher clones (or reuses) the challenges repo and hands over
to `uv run workshop` there. git and uv are played by fakes that record what they were asked."""

import json
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.routes_launcher import DEFAULT, LAUNCHER

REPO = "https://github.com/pollen-robotics/microduck-challenges"


@pytest.fixture
def api(tmp_path):
    return TestClient(create_app(ArenaConfig.from_env(store_dir=tmp_path / "board", dev_user="coralie")),
                      base_url="https://testserver")


def test_it_is_served_as_python_with_this_arenas_address(api):
    response = api.get("/workshop.py")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/x-python")
    assert "ARENA = 'https://testserver'" in response.text
    compile(response.text, "workshop.py", "exec")


def test_on_a_space_the_public_address_is_written_in(tmp_path, monkeypatch):
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    api = TestClient(create_app(ArenaConfig.from_env(store_dir=tmp_path / "board", dev_user="coralie")))
    assert "ARENA = 'https://example.hf.space'" in api.get("/workshop.py").text


def test_the_template_carries_the_line_the_server_replaces():
    assert DEFAULT in LAUNCHER.read_text()


FAKE = r'''#!{python}
import json, os, sys
from pathlib import Path
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps({{"tool": "{tool}", "argv": sys.argv[1:], "cwd": os.getcwd(),
                          "hf_token": os.environ.get("HF_TOKEN")}}) + "\n")
if "{tool}" == "git" and sys.argv[1] == "clone":
    (Path(sys.argv[3]) / "src" / "microduck_challenges").mkdir(parents=True)
'''


def _launch(tmp_path, cwd, *args, env=None):
    """Run the launcher as served by an Arena at http://arena.test, with fake git and uv."""
    fakes = tmp_path / "bin"
    fakes.mkdir(exist_ok=True)
    for tool in ("git", "uv"):
        (fakes / tool).write_text(FAKE.format(python=sys.executable, tool=tool))
        (fakes / tool).chmod(0o755)
    script = tmp_path / "workshop.py"
    script.write_text(LAUNCHER.read_text().replace(DEFAULT, "ARENA = 'http://arena.test'"))
    log = tmp_path / "calls.jsonl"
    base = {k: v for k, v in os.environ.items() if k not in ("HF_TOKEN", "HF_HOME")}
    full_env = {**base, "PATH": f"{fakes}{os.pathsep}/usr/bin:/bin", "FAKE_LOG": str(log),
                "HF_HOME": str(tmp_path / "no-hf"), **(env or {})}
    subprocess.run([sys.executable, str(script), *args], cwd=cwd, env=full_env, check=True)
    return [json.loads(line) for line in log.read_text().splitlines()]


def test_from_an_empty_folder_it_clones_then_opens_the_workshop_in_the_clone(tmp_path):
    here = tmp_path / "here"
    here.mkdir()
    git, uv = _launch(tmp_path, here, "sprint-2m")
    assert git["argv"] == ["clone", REPO, str(here / "microduck-challenges")]
    assert uv["argv"] == ["run", "--frozen", "--group", "workshop", "workshop", "sprint-2m", "--arena", "http://arena.test"]
    assert os.path.realpath(uv["cwd"]) == os.path.realpath(here / "microduck-challenges")


def test_a_clone_already_there_is_reused_as_is(tmp_path):
    here = tmp_path / "here"
    (here / "microduck-challenges" / "src" / "microduck_challenges").mkdir(parents=True)
    calls = _launch(tmp_path, here, "sprint-2m")
    assert [c["tool"] for c in calls] == ["uv"]


def test_inside_a_clone_it_works_in_place(tmp_path):
    clone = tmp_path / "my-fork"
    (clone / "src" / "microduck_challenges").mkdir(parents=True)
    (uv,) = _launch(tmp_path, clone, "hill-climb-1m5", "--no-browser")
    assert os.path.realpath(uv["cwd"]) == os.path.realpath(clone)
    assert uv["argv"][5:] == ["hill-climb-1m5", "--no-browser", "--arena", "http://arena.test"]


def test_the_saved_hub_token_reaches_uv(tmp_path):
    """While the Arena wheel is on a private Hub repo, uv needs HF_TOKEN to install it."""
    hf_home = tmp_path / "hf"
    hf_home.mkdir()
    (hf_home / "token").write_text("hf_saved\n")
    clone = tmp_path / "clone"
    (clone / "src" / "microduck_challenges").mkdir(parents=True)
    (uv,) = _launch(tmp_path, clone, "sprint-2m", env={"HF_HOME": str(hf_home)})
    assert uv["hf_token"] == "hf_saved"
```

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_launcher.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'arena.web.routes_launcher'`.

- [ ] **Step 3: Write the launcher**

`arena/workshop/__init__.py`:

```python
"""The challenge workshop: train, test and publish a policy from a microduck-challenges checkout."""
```

`arena/workshop/launcher.py`:

```python
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Open the Microduck challenge workshop. The one line on a challenge's page:

    uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m

Works in the microduck-challenges clone you are standing in, or in
./microduck-challenges — cloned first if it is not there — then hands over to
`uv run workshop <challenge>` inside it, which installs everything once and
opens the workshop in your browser. Run the same line tomorrow: it reopens the
same work, fork included.

No dependencies, so uv runs it without installing anything. The Arena serves
this file with its own address in ARENA, so the workshop sends you back to the
Arena you came from.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ARENA = "https://pollen-robotics-microduck-arena.hf.space"
REPO = "https://github.com/pollen-robotics/microduck-challenges"
FOLDER = "microduck-challenges"


def checkout(here: Path) -> Path:
    if (here / "src" / "microduck_challenges").is_dir():
        return here
    clone = here / FOLDER
    if not clone.is_dir():
        if shutil.which("git") is None:
            sys.exit("git is needed first: https://git-scm.com/downloads")
        if subprocess.run(["git", "clone", REPO, str(clone)]).returncode != 0:
            sys.exit(f"could not clone {REPO}")
    return clone


def hf_token() -> str | None:
    """The token `hf auth login` saved. uv needs it to install the Arena wheel while that
    sits on a private Hugging Face repo (uv sends HF_TOKEN to huggingface.co only)."""
    if os.environ.get("HF_TOKEN"):
        return os.environ["HF_TOKEN"]
    saved = Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "token"
    return saved.read_text().strip() if saved.is_file() else None


def main() -> None:
    root = checkout(Path.cwd())
    env = dict(os.environ)
    if token := hf_token():
        env["HF_TOKEN"] = token
    os.chdir(root)
    command = ["uv", "run", "--frozen", "--group", "workshop", "workshop", *sys.argv[1:], "--arena", ARENA]
    os.execvpe("uv", command, env)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Serve it**

`arena/web/routes_launcher.py`:

```python
"""The one line's launcher, served with this Arena's own address written in.

`uv run <arena>/workshop.py <challenge>` fetches it; the address is how the
workshop sends a published policy back to the Arena it came from — the Space,
or a local `arena serve` standing in for it.
"""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import Response

LAUNCHER = Path(__file__).resolve().parents[1] / "workshop" / "launcher.py"
DEFAULT = 'ARENA = "https://pollen-robotics-microduck-arena.hf.space"'

router = APIRouter()


@router.get("/workshop.py")
def launcher(request: Request) -> Response:
    origin = request.app.state.config.public_origin or str(request.base_url).rstrip("/")
    # repr(): whatever the Host header said, it lands in the script as a string literal.
    script = LAUNCHER.read_text().replace(DEFAULT, f"ARENA = {origin!r}", 1)
    return Response(script, media_type="text/x-python", headers={"Cache-Control": "no-cache"})
```

In `arena/web/app.py`: `from .routes_launcher import router as launcher_router` with the other router imports, and `app.include_router(launcher_router)` after `app.include_router(live_router)` (so before the frontend's catch-all mount).

- [ ] **Step 5: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/test_launcher.py tests/test_web_app.py -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add arena/workshop/__init__.py arena/workshop/launcher.py arena/web/routes_launcher.py arena/web/app.py tests/test_launcher.py
/usr/bin/git commit -m "Serve the one line's launcher at /workshop.py with the Arena's own address"
```

---

### Task 7: The race page enters a Hub repo, pre-filled from the workshop's link

**Files:**
- Create: `app/src/entry.js`, `app/src/entry.test.js`
- Modify: `app/src/api.js` (`detailFrom` exported; `submitPolicy` and `tryPolicy` take one entry object)
- Modify: `app/src/api.test.js`
- Modify: `app/src/race.js` (`renderEntryPanel`, `renderRace`)
- Modify: `app/src/race.test.js`
- Modify: `app/public/race.css` (the repo field, the collapsed file picker)

**Interfaces:**
- Consumes: `/submit` needs `repo_id` (+ `revision`); `/try` takes a file or a `repo_id` (+ `revision`) (Task 4).
- Produces:
  - `entryFromLocation(eventId, search = location.search, storage = sessionStorage) -> {repo, revision, env}` and `forgetEntry(storage = sessionStorage)`.
  - `submitPolicy(eventId, {repoId, revision, name, livery, commandVx, envUrl})`; `tryPolicy(eventId, {file | repoId, revision, name, livery, commandVx})`.
  - `renderEntryPanel(container, me, {event, entry, onTry, onPublish, onLiveryChange})`: `onPublish({repoId, revision, envUrl, name, livery, commandVx})`; `onTry` gets `{file, …}` when a file is chosen, else `{repoId, revision, …}`.
  - `export async function detailFrom(response)` in `app/src/api.js` (the workshop page reuses it, Task 14).

- [ ] **Step 1: Write the failing tests**

```js
// app/src/entry.test.js
import { describe, expect, it } from "vitest";
import { entryFromLocation, forgetEntry } from "./entry.js";

function memory() {
  const kept = new Map();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
}

const query = "?repo=alice%2Fmicroduck-walker&revision=abc1234&env=https%3A%2F%2Fgithub.com%2Falice%2Fx%2Ftree%2Fabc";

describe("the entry the workshop sends back", () => {
  it("reads the repo, the revision and the code link from the query", () => {
    expect(entryFromLocation("sprint-2m", query, memory())).toEqual({
      repo: "alice/microduck-walker", revision: "abc1234", env: "https://github.com/alice/x/tree/abc",
    });
  });

  it("keeps it across the sign-in round trip, which drops the query", () => {
    const storage = memory();
    entryFromLocation("sprint-2m", query, storage);
    expect(entryFromLocation("sprint-2m", "", storage).repo).toBe("alice/microduck-walker");
  });

  it("only for the challenge it was sent to", () => {
    const storage = memory();
    entryFromLocation("sprint-2m", query, storage);
    expect(entryFromLocation("roller-sprint-2m", "", storage)).toEqual({ repo: "", revision: "", env: "" });
  });

  it("forgets it once published", () => {
    const storage = memory();
    entryFromLocation("sprint-2m", query, storage);
    forgetEntry(storage);
    expect(entryFromLocation("sprint-2m", "", storage).repo).toBe("");
  });

  it("still reads the query when storage throws, as it can in a private window", () => {
    const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(entryFromLocation("sprint-2m", query, throwing).repo).toBe("alice/microduck-walker");
    expect(entryFromLocation("sprint-2m", "", throwing).repo).toBe("");
  });
});
```

In `app/src/api.test.js`, import `submitPolicy, tryPolicy` too and add:

```js
describe("entering a policy", () => {
  function sentForm() {
    return Object.fromEntries(globalThis.fetch.mock.calls[0][1].body.entries());
  }

  it("publishes a Hub repo at a revision, with its code link", async () => {
    respondWith({ body: { run_id: "r1" } });
    await submitPolicy("sprint-2m", {
      repoId: "alice/microduck-walker", revision: "abc1234", envUrl: "https://github.com/a/b", name: "", livery: "classic", commandVx: "",
    });
    expect(globalThis.fetch.mock.calls[0][0]).toBe("/api/events/sprint-2m/submit");
    expect(sentForm()).toEqual({
      repo_id: "alice/microduck-walker", revision: "abc1234", env_url: "https://github.com/a/b", livery: "classic",
    });
  });

  it("tests a file when given one", async () => {
    respondWith({ body: { trace_b64: "" } });
    await tryPolicy("sprint-2m", { file: new File(["x"], "p.onnx"), livery: "classic" });
    expect(Object.keys(sentForm())).toEqual(["file", "livery"]);
  });
});
```

In `app/src/race.test.js`: the `ready` describe's `render()` passes `entry` through (`renderEntryPanel(container, me, { event, entry, onTry, onPublish, onLiveryChange })`, with `entry` a parameter defaulting to `{ repo: "", revision: "", env: "" }`), and the tests become:

```js
  it("names the signed-in user and renders the repo field, the file picker and every control", () => {
    const { container } = render();
    expect(container.querySelector("#entry-user").textContent).toBe("alice");
    expect(container.querySelector("#policy-repo")).not.toBeNull();
    expect(container.querySelector("#dropzone")).not.toBeNull();
    expect(container.querySelector("#policy-name")).not.toBeNull();
    expect(container.querySelectorAll("#liveries .swatch")).toHaveLength(4);
    expect(container.querySelector("#speed")).not.toBeNull();
    expect(container.querySelector("#try").disabled).toBe(false);
    expect(container.querySelector("#publish").disabled).toBe(false);
  });

  it("shows what the workshop sent: the repo, the revision it pins, the code link", () => {
    const { container } = render({ repo: "alice/microduck-walker", revision: "abc1234def", env: "https://github.com/alice/x/tree/abc" });
    expect(container.querySelector("#policy-repo").value).toBe("alice/microduck-walker");
    expect(container.querySelector("#policy-revision").textContent).toContain("abc1234");
    expect(container.querySelector("#policy-env").value).toBe("https://github.com/alice/x/tree/abc");
  });

  it("Publish sends the repo, the revision and the link", async () => {
    const { container, onPublish } = render({ repo: "alice/microduck-walker", revision: "abc1234", env: "https://github.com/a/b" });
    container.querySelector("#publish").click();
    await flush();
    expect(onPublish.mock.calls[0][0]).toMatchObject({ repoId: "alice/microduck-walker", revision: "abc1234", envUrl: "https://github.com/a/b" });
  });

  it("editing the repo drops the revision, which belonged to the other one", async () => {
    const { container, onPublish } = render({ repo: "alice/microduck-walker", revision: "abc1234", env: "" });
    const repo = container.querySelector("#policy-repo");
    repo.value = "alice/microduck-other";
    repo.dispatchEvent(new Event("input"));
    container.querySelector("#publish").click();
    await flush();
    expect(onPublish.mock.calls[0][0]).toMatchObject({ repoId: "alice/microduck-other", revision: "" });
    expect(container.querySelector("#policy-revision").textContent).toBe("");
  });

  it("Publish without a repo says how to get one, and calls nothing", () => {
    const { container, onPublish } = render();
    chooseFile(container);
    container.querySelector("#publish").click();
    expect(container.querySelector("#entry-status").textContent).toMatch(/uv run publish/);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("Test it sends the chosen file when there is one", async () => {
    const { container, onTry } = render({ repo: "alice/microduck-walker", revision: "", env: "" });
    chooseFile(container);
    container.querySelector("#try").click();
    await flush();
    expect(onTry.mock.calls[0][0].file).toBeInstanceOf(File);
    expect(onTry.mock.calls[0][0].repoId).toBeUndefined();
  });

  it("Test it races the repo when no file is chosen", async () => {
    const { container, onTry } = render({ repo: "alice/microduck-walker", revision: "abc", env: "" });
    container.querySelector("#try").click();
    await flush();
    expect(onTry.mock.calls[0][0]).toMatchObject({ repoId: "alice/microduck-walker", revision: "abc" });
  });

  it("with neither, Test it says so instead of silently doing nothing", () => {
    const { container, onTry } = render();
    container.querySelector("#try").click();
    expect(container.querySelector("#entry-status").textContent).toMatch(/repo|file/i);
    expect(onTry).not.toHaveBeenCalled();
  });
```

(keep the livery test). In the speed-picker and training-environment describes, replace `chooseFile(container)` before a Publish click by rendering with `entry: { repo: "alice/microduck-walker", revision: "", env: "" }`.

- [ ] **Step 2: Run them to see them fail**

```bash
cd app && npx vitest run src/entry.test.js src/api.test.js src/race.test.js; cd ..
```

Expected: FAIL — `entry.js` missing; forms built from positional arguments; no `#policy-repo`.

- [ ] **Step 3: Keep the workshop's entry**

```js
// app/src/entry.js
// What the workshop sends a novice back with: the Hub repo it just published,
// the revision to pin and the code's address, as ?repo=&revision=&env= ahead of
// the hash. Kept in sessionStorage as well, because signing in leaves the page
// for huggingface.co and comes back to "/#<route>" with no query at all.

const KEY = "arena.entry";
const EMPTY = { repo: "", revision: "", env: "" };

function session() {
  try {
    return window.sessionStorage;
  } catch {
    return null; // storage disabled: the query still works, the round trip does not
  }
}

export function entryFromLocation(eventId, search = location.search, storage = session()) {
  const params = new URLSearchParams(search);
  const sent = { repo: params.get("repo") ?? "", revision: params.get("revision") ?? "", env: params.get("env") ?? "" };
  if (sent.repo) {
    try {
      storage?.setItem(KEY, JSON.stringify({ ...sent, eventId }));
    } catch {
      // A private window may refuse; the query in hand is still the answer.
    }
    return sent;
  }
  try {
    const kept = JSON.parse(storage?.getItem(KEY) ?? "null");
    if (kept?.eventId === eventId && kept.repo) {
      return { repo: kept.repo, revision: kept.revision ?? "", env: kept.env ?? "" };
    }
  } catch {
    // Nothing kept, or not ours to read.
  }
  return { ...EMPTY };
}

export function forgetEntry(storage = session()) {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
```

- [ ] **Step 4: Send the entry as one object**

In `app/src/api.js`: `async function detailFrom` becomes `export async function detailFrom`, and:

```js
function policyForm({ file, repoId, revision, name, livery, commandVx, envUrl }) {
  const form = new FormData();
  // A trial's upload, or a Hub repo — the server takes exactly one of the two,
  // and only a repo can be published.
  if (file) form.append("file", file);
  if (repoId) form.append("repo_id", repoId);
  // Left off when blank: the server then reads the repo's current head.
  if (revision) form.append("revision", revision);
  if (name) form.append("name", name);
  if (livery) form.append("livery", livery);
  // Empty means "sweep", which is the server's default too, so it is left off
  // the form entirely rather than sent as a blank the server has to interpret.
  if (commandVx) form.append("command_vx", commandVx);
  // Left off entirely when blank: the field is optional, and the server reads
  // an absent value and an empty one the same way.
  if (envUrl) form.append("env_url", envUrl);
  return form;
}

/** Race a Hub repo and put it on the board. */
export function submitPolicy(eventId, entry) {
  return json(`/api/events/${eventId}/submit`, { method: "POST", body: policyForm(entry) });
}
```

and `tryPolicy(eventId, entry)` builds `policyForm(entry)` (its body is otherwise unchanged; its doc comment says "a file, or a Hub repo").

- [ ] **Step 5: The entry panel**

In `app/src/race.js`, `renderEntryPanel(container, me, { event, entry = { repo: "", revision: "", env: "" }, onTry, onPublish, onLiveryChange } = {})`. Its ready-state markup becomes:

```js
  container.innerHTML = `
    <span class="flyer-tape"></span>
    <p class="entry__user">Racing as <strong id="entry-user"></strong></p>
    <label class="entry__name">Hugging Face repo
      <input type="text" id="policy-repo" placeholder="you/microduck-your-policy" autocomplete="off" spellcheck="false" />
      <span class="entry__hint" id="policy-revision"></span>
    </label>
    ${help}
    <label class="entry__name">Name
      <input type="text" id="policy-name" placeholder="optional" />
    </label>
    <label class="entry__name">Training environment
      <input type="url" id="policy-env"
             placeholder="optional — github.com, gitlab.com or huggingface.co" />
      <span class="entry__hint">A link to how this policy was trained. Shown on your row.</span>
    </label>
    <fieldset class="livery">
      <legend>Colour</legend>
      <div class="livery__swatches" id="liveries"></div>
    </fieldset>
    <label class="entry__speed">Speed
      <select id="speed"></select>
      <span class="entry__hint">Sweeping tries every speed and keeps your best.</span>
    </label>
    <div class="entry__actions">
      <button id="try" class="ghost">Test it</button>
      <button id="publish">Publish</button>
    </div>
    <details class="entry__file">
      <summary>Test a .onnx file instead</summary>
      <div id="dropzone"></div>
    </details>
    <p class="entry__consent">
      Publish races the policy at this revision of its Hugging Face repo and puts
      it on the board with a link to it. A file can be tested, not published.
    </p>
    <p class="entry__status" id="entry-status"></p>
  `;
```

After the element references (`status`, `tryButton`, …) add:

```js
  const repoInput = container.querySelector("#policy-repo");
  const revisionHint = container.querySelector("#policy-revision");
  repoInput.value = entry.repo;
  envInput.value = entry.env;
  // The revision belongs to the repo the workshop sent; typing another repo drops it.
  let revision = entry.revision;
  revisionHint.textContent = revision ? `at revision ${revision.slice(0, 7)}` : "";
  repoInput.addEventListener("input", () => {
    revision = "";
    revisionHint.textContent = "";
  });
```

and `run(kind)` becomes:

```js
  async function run(kind) {
    const file = dropzone.file;
    const repoId = repoInput.value.trim();
    if (kind === "publish" && !repoId) {
      status.textContent =
        "Publishing needs a Hugging Face repo. Publish from the workshop (Train my robot) " +
        "or with `uv run publish`, then enter it here.";
      status.className = "entry__status bad";
      return;
    }
    if (kind === "try" && !file && !repoId) {
      status.textContent = "Enter a Hugging Face repo, or choose a .onnx file to test.";
      status.className = "entry__status bad";
      return;
    }
    tryButton.disabled = true;
    publishButton.disabled = true;
    status.className = "entry__status";
    // Say what is actually taking the time: a sweep is dominated by the number
    // of speeds, a pinned run by the seeds.
    const pinned = speed.value;
    status.textContent = pinned
      ? `Racing ${event.seeds} seeds at ${pinned} m/s…`
      : `Sweeping ${event.sweep_count} speeds × ${event.seeds} seeds…`;
    const common = { name: nameInput.value, livery, commandVx: pinned };
    try {
      if (kind === "try") {
        // A chosen file wins for a trial: it is the one way to look at a policy before publishing it.
        await onTry(file ? { file, ...common } : { repoId, revision, ...common });
        status.textContent = "Tested. Nothing published yet.";
      } else {
        // NOT optional-chained. When the markup and this reader disagreed,
        // `envInput?.value ?? ""` silently published every policy with no
        // link and nothing anywhere said so.
        const published = await onPublish({ repoId, revision, envUrl: envInput.value, ...common });
        status.textContent = `Published as ${published.policy_name}.`;
      }
    } catch (error) {
      // The server's own wording — for a refused manifest, the field it disagrees on.
      status.textContent = error.message;
      status.className = "entry__status bad";
    } finally {
      tryButton.disabled = false;
      publishButton.disabled = false;
    }
  }
```

In `renderRace`: `import { entryFromLocation, forgetEntry } from "./entry.js";`, and the panel is rendered with

```js
  renderEntryPanel(entry, me, {
    event,
    entry: entryFromLocation(event.id),
    onLiveryChange: (livery) => {
      currentLivery = livery;
      race([...sheet.selection], sheet.tiers);
    },
    onTry: async (sent) => {
      trial = await tryPolicy(event.id, sent);
      await sheet.paint();
    },
    onPublish: async (sent) => {
      const published = await submitPolicy(event.id, sent);
      // Entered: the workshop's query and its kept copy have done their job.
      forgetEntry();
      history.replaceState(null, "", location.pathname + location.hash);
      // The result has its own page now, and the reveal plays there.
      location.hash = runHref(published.run_id);
      return published;
    },
  });
```

(`entry` on the left is the existing `#entry` element variable; rename it `entryColumn` in `renderRace` if the two names read badly together.)

In `app/public/race.css`, next to the other `.entry__*` rules: `.entry__file summary { cursor: pointer; }` and `.entry__file[open] summary { margin-bottom: var(--space-2, 8px); }`; give `#policy-repo` the same rule as the other `.entry__name input` (check the existing selector covers it).

- [ ] **Step 6: Run the tests**

```bash
cd app && npm test 2>&1 | tail -6; cd ..
```

Expected: only the 4 known `brightness.test.js` failures.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add app/src/entry.js app/src/entry.test.js app/src/api.js app/src/api.test.js app/src/race.js app/src/race.test.js app/public/race.css
/usr/bin/git commit -m "Enter a Hub repo on the race page, pre-filled from the workshop's link and kept across sign-in"
```

---

### Task 8: A *Train my robot* panel on the race page, and guides that start from it

**Files:**
- Create: `app/src/trainpanel.js`, `app/src/trainpanel.test.js`
- Modify: `app/src/race.js` (`renderRace` hangs the panel)
- Modify: `app/public/race.css` (`.train`)
- Modify: `docs/guides/challenges/sprint-2m.md`, `hill-climb-1m5.md`, `roller-sprint-2m.md`, `swag-contest.md` (their *Train* sections), `docs/guides/train-a-policy.md` (rewritten), `docs/guides/index.md`

**Interfaces:**
- Produces: `oneLine(event, origin = location.origin) -> "uv run <origin>/workshop.py <event.id>"`; `trainPanel(event, origin) -> HTMLDetailsElement`; `renderTrainPanel(root, event, origin)` — above `#entry`, open events only.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/trainpanel.test.js
import { afterEach, describe, expect, it, vi } from "vitest";
import { oneLine, renderTrainPanel, trainPanel } from "./trainpanel.js";

const sprint = { id: "sprint-2m", status: "open" };

afterEach(() => vi.restoreAllMocks());

describe("Train my robot", () => {
  it("gives the one line for this challenge, on this Arena", () => {
    expect(oneLine(sprint, "http://127.0.0.1:8000")).toBe("uv run http://127.0.0.1:8000/workshop.py sprint-2m");
    const panel = trainPanel(sprint, "https://arena.example");
    const lines = [...panel.querySelectorAll(".train__line code")].map((node) => node.textContent);
    expect(lines).toContain("uv run https://arena.example/workshop.py sprint-2m");
    expect(lines).toContain("curl -LsSf https://astral.sh/uv/install.sh | sh");
  });

  it("says what is needed, GPU or Hugging Face Jobs", () => {
    const text = trainPanel(sprint, "https://arena.example").textContent;
    expect(text).toMatch(/NVIDIA GPU/);
    expect(text).toMatch(/Hugging Face Jobs/);
  });

  it("copies the line", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const panel = trainPanel(sprint, "https://arena.example");
    panel.querySelector(".train__copy").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("uv run https://arena.example/workshop.py sprint-2m");
  });

  it("hangs above the entry form, and not for a planned event", () => {
    const root = document.createElement("div");
    root.innerHTML = '<aside id="entry"></aside>';
    renderTrainPanel(root, { id: "highest-jump", status: "planned" }, "https://a");
    expect(root.querySelector(".train")).toBeNull();
    renderTrainPanel(root, sprint, "https://a");
    expect(root.querySelector("#entry").previousElementSibling.classList.contains("train")).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd app && npx vitest run src/trainpanel.test.js; cd ..
```

Expected: FAIL — no `trainpanel.js`.

- [ ] **Step 3: Write the panel**

```js
// app/src/trainpanel.js
// The way from a challenge to training for it: what you need, and one line to
// copy. The line runs the launcher this Arena serves (arena/web/routes_launcher.py),
// which clones microduck-challenges and opens the workshop on this challenge.

const UV_INSTALL = "curl -LsSf https://astral.sh/uv/install.sh | sh";

export const oneLine = (event, origin = location.origin) => `uv run ${origin}/workshop.py ${event.id}`;

export function trainPanel(event, origin = location.origin) {
  const panel = document.createElement("details");
  panel.className = "train fx-shadow-card";
  panel.innerHTML = `
    <summary class="train__open">Train my robot</summary>
    <p class="train__need">You need <code>git</code>, <code>uv</code> and a Hugging Face account.
      Training runs on your NVIDIA GPU, or on Hugging Face Jobs — billed to your account — when you have none.</p>
    <p class="train__step">No <code>uv</code> yet? Install it first:</p>
    <pre class="train__line"><code></code></pre>
    <p class="train__step">Then, in a terminal:</p>
    <pre class="train__line"><code></code></pre>
    <button type="button" class="train__copy">Copy</button>
    <p class="train__note">It clones <code>microduck-challenges</code> into the folder you run it in
      (or reuses it) and opens the workshop in your browser.</p>`;
  const [install, line] = panel.querySelectorAll(".train__line code");
  install.textContent = UV_INSTALL;
  line.textContent = oneLine(event, origin);
  const copy = panel.querySelector(".train__copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(line.textContent);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the line and copy it";
    }
  });
  return panel;
}

/** Above the entry form, for an event that can be trained for today. */
export function renderTrainPanel(root, event, origin = location.origin) {
  if (event.status !== "open") return;
  root.querySelector("#entry").before(trainPanel(event, origin));
}
```

In `renderRace`, right after `renderVoteButton(root, event);`: `renderTrainPanel(root, event);` (import it). In `app/public/race.css`, a `.train` block in the entry column's style: the card like `.entry` (same padding, border, shadow tokens), `summary` as a primary button, `.train__line` as a code line that wraps (`white-space: pre-wrap; word-break: break-all;`).

- [ ] **Step 4: The guides start from the button**

`docs/guides/challenges/sprint-2m.md`, the *Train* section becomes:

````markdown
## Train

Open **Train my robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m
```

Get a stable walk first, then increase speed. Practice small changes in starting
pose and heading; aim to finish all five attempts.
````

`hill-climb-1m5.md`:

````markdown
## Train

Open **Train my robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py hill-climb-1m5
```

Its training already walks on generated slopes up to 8°. Practice forward
progress without slipping or tipping backwards.
````

`roller-sprint-2m.md`:

````markdown
## Train

Open **Train my robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py roller-sprint-2m
```

Practice balance and forward propulsion, then increase speed without drifting
or spinning. The wheels are passive: your policy controls the 14 body joints.
Test several checkpoints: on this course some score well and their neighbours fall.
````

`swag-contest.md` — only the first paragraph of *Train* changes:

````markdown
## Train

Open **Train my robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py swag-contest
```

Then experiment with step rhythm, body motion or head movement. Keep the gait
reliable while adding personality.
````

(its second paragraph, on the constant 0.25 m/s command, stays.) In all four, the last line `[Setup, export and submission →](../train-a-policy.md)` becomes `[How the workshop works, and the shell path →](../train-a-policy.md)`.

`docs/guides/train-a-policy.md`, whole file:

````markdown
# Train your first policy

A policy is the model that controls the robot. You train it in simulation, publish it
to your Hugging Face account, then enter it here. You do not need a physical robot.

## The workshop

Open a challenge and select **Train my robot**. You need `git`, `uv` and a Hugging Face
account; the panel gives one line to paste in a terminal. It clones
[microduck-challenges](https://github.com/pollen-robotics/microduck-challenges) and opens
the workshop in your browser:

1. **Preflight** checks your tools and your Hugging Face login.
2. **Train** starts from the challenge's own recipe. Change a knob if you like, then launch.
   With an NVIDIA GPU it trains on your machine; without one it runs on Hugging Face Jobs,
   billed to your account, and brings the checkpoints back as they are saved.
3. **Test** exports a checkpoint and races it with this Arena's own rules, on your machine.
   The time is indicative: only the Arena times an entry.
4. **Publish** puts the policy, its manifest and its recipe in your Hugging Face account,
   then opens this page with everything filled in. Select **Publish** here to enter it.

## From a shell

Everything the workshop does is a command you can run yourself in a clone of
microduck-challenges (the challenge's `task` is in its `challenge.toml`):

```bash
uv run train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 3000 \
    --agent.seed 1 --agent.logger tensorboard --agent.run-name first
# no NVIDIA GPU: add --hf-jobs --no-wandb, then bring the run back with
# uv run hf download <the checkpoint repo it printed> --local-dir logs/rsl_rl
uv run publish --run logs/rsl_rl/sprint_2m/<the run> --repo <you>/microduck-first --no-private
```

Then enter `<you>/microduck-first` on the challenge's page. The Arena expects 61
observations, 14 actions and a file no larger than 64 MiB; `publish` checks all three.
````

`docs/guides/index.md`, first paragraph: `Train a policy in simulation, publish it to your Hugging Face account, then enter it in the Arena. You do not need a physical robot.`

- [ ] **Step 5: Run the front's tests**

```bash
cd app && npm test 2>&1 | tail -6; cd ..
```

Expected: only the 4 known failures (`guides.test.js` still finds `uv run train` in the guide's code blocks).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/src/trainpanel.js app/src/trainpanel.test.js app/src/race.js app/public/race.css docs/guides
/usr/bin/git commit -m "Add a Train my robot panel with the one line, and start the guides from it"
```

---

### Task 9: The workshop reads a checkout: its challenges, its runs, their curves

Pure modules, no server yet.

**Files:**
- Create: `arena/workshop/challenges.py`, `arena/workshop/runs.py`, `arena/workshop/tfevents.py`
- Create: `tests/workshop/__init__.py` (empty), `tests/workshop/test_challenges.py`, `tests/workshop/test_runs.py`
- Create: `tests/fixtures/workshop/events.out.tfevents.probe` (a real TensorBoard file, copied)

**Interfaces:**
- Produces:
  - `challenges.PACKAGE = Path("src") / "microduck_challenges"`; `challenges.RECIPE = ("num_envs", "max_iterations", "seed")`.
  - `Knob(name, label, value: float, min: float, max: float)`; `Challenge(folder: str, toml: Path, event: str, task: str, kind: str, recipe: dict[str, int], knobs: tuple[Knob, ...])`.
  - `read_challenge(toml: Path) -> Challenge`; `open_challenges(root: Path) -> list[Challenge]` (events open on this Arena, folder order); `write_values(challenge, recipe: dict[str, int], params: dict[str, float]) -> bool` (in place, comments kept; `ChallengeError` on a bad value, nothing written).
  - `runs.LOGS = Path("logs") / "rsl_rl"`; `Run(id: str, path: Path, name: str, provenance: dict, checkpoints: tuple[int, ...])`; `find_runs(root, task) -> list[Run]` newest first; `find_run(root, task, run_id) -> Run | None`; `curve(run, tag="Train/mean_reward") -> list[tuple[int, float]]`.
  - `tfevents.scalars(path, tag) -> list[tuple[int, float]]`.

- [ ] **Step 1: Bring a real TensorBoard file in as a fixture**

It comes from a 3-iteration CPU run of the sprint made while planning (rsl_rl 5.0.1, `--agent.logger tensorboard`); its `Train/mean_reward` is `[(1, -0.6283…), (2, -0.5193…)]` (read with tensorboard's own `EventAccumulator`).

```bash
mkdir -p tests/fixtures/workshop
cp ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop/logs/rsl_rl/sprint_2m/2026-09-28_11-04-09_plan4probe/events.out.tfevents.* tests/fixtures/workshop/events.out.tfevents.probe
ls -l tests/fixtures/workshop/    # 8325 bytes
```

- [ ] **Step 2: Write the failing tests**

```python
# tests/workshop/test_challenges.py
"""A checkout's challenges, as the workshop reads and edits them."""

import pytest

from arena.workshop.challenges import ChallengeError, open_challenges, read_challenge, write_values

SPRINT = """\
# The 2 m Sprint.
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
kind  = "perpetual"

[recipe]                  # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]
label = "Follow the speed order"
value = 2.0               # what the page edits
min   = 0.5
max   = 5.0
"""


def _folder(root, name, text):
    folder = root / "src" / "microduck_challenges" / name
    folder.mkdir(parents=True)
    (folder / "challenge.toml").write_text(text)
    return folder / "challenge.toml"


def test_a_challenge_reads_its_contract_recipe_and_knobs(tmp_path):
    challenge = read_challenge(_folder(tmp_path, "sprint_2m", SPRINT))
    assert (challenge.folder, challenge.event, challenge.task, challenge.kind) == (
        "sprint_2m", "sprint-2m", "Mjlab-Sprint2m-MicroDuck", "perpetual")
    assert challenge.recipe == {"num_envs": 4096, "max_iterations": 3000, "seed": 1}
    (knob,) = challenge.knobs
    assert (knob.name, knob.label, knob.value, knob.min, knob.max) == (
        "forward_reward", "Follow the speed order", 2.0, 0.5, 5.0)


def test_only_challenges_whose_event_is_open_here_are_offered(tmp_path):
    _folder(tmp_path, "sprint_2m", SPRINT)
    _folder(tmp_path, "jump", SPRINT.replace('"sprint-2m"', '"highest-jump"'))  # planned
    _folder(tmp_path, "gone", SPRINT.replace('"sprint-2m"', '"no-such-event"'))
    assert [c.event for c in open_challenges(tmp_path)] == ["sprint-2m"]


def test_a_challenge_without_a_recipe_is_refused_by_name(tmp_path):
    toml = _folder(tmp_path, "broken", SPRINT.split("[recipe]")[0])
    with pytest.raises(ChallengeError, match="broken"):
        read_challenge(toml)


def test_values_are_written_in_place_keeping_every_comment(tmp_path):
    toml = _folder(tmp_path, "sprint_2m", SPRINT)
    changed = write_values(read_challenge(toml), {"num_envs": 1024, "max_iterations": 500, "seed": 7},
                           {"forward_reward": 3.5})
    assert changed is True
    assert toml.read_text() == (
        SPRINT.replace("= 4096", "= 1024").replace("= 3000", "= 500").replace("seed           = 1", "seed           = 7")
        .replace("value = 2.0 ", "value = 3.5 ")
    )
    again = read_challenge(toml)
    assert again.recipe["num_envs"] == 1024 and again.knobs[0].value == 3.5


def test_writing_the_same_values_changes_nothing(tmp_path):
    toml = _folder(tmp_path, "sprint_2m", SPRINT)
    challenge = read_challenge(toml)
    assert write_values(challenge, challenge.recipe, {"forward_reward": 2.0}) is False
    assert toml.read_text() == SPRINT


@pytest.mark.parametrize(
    "recipe,params,complaint",
    [
        ({"num_envs": 0}, {}, "num_envs"),
        ({"seed": -1}, {}, "seed"),
        ({"batch": 4}, {}, "batch"),
        ({}, {"forward_reward": 9.0}, "between 0.5 and 5"),
        ({}, {"mystery": 1.0}, "mystery"),
    ],
)
def test_a_bad_value_is_refused_and_nothing_is_written(tmp_path, recipe, params, complaint):
    toml = _folder(tmp_path, "sprint_2m", SPRINT)
    with pytest.raises(ChallengeError, match=complaint):
        write_values(read_challenge(toml), recipe, params)
    assert toml.read_text() == SPRINT
```

```python
# tests/workshop/test_runs.py
"""Runs are found on disk, wherever they were trained; their curve is read from TensorBoard."""

import json
import shutil
from pathlib import Path

import pytest

from arena.workshop import tfevents
from arena.workshop.runs import curve, find_run, find_runs

PROBE = Path(__file__).resolve().parents[1] / "fixtures" / "workshop" / "events.out.tfevents.probe"
TASK = "Mjlab-Sprint2m-MicroDuck"


def _run(root, name, task=TASK, checkpoints=(0, 1, 2), stamp="2026-09-28_10-00-00", experiment="sprint_2m"):
    run = root / "logs" / "rsl_rl" / experiment / f"{stamp}_{name}"
    run.mkdir(parents=True)
    (run / "provenance.json").write_text(json.dumps({"task": task, "dirty": False}))
    for n in checkpoints:
        (run / f"model_{n}.pt").write_bytes(b"pt")
    shutil.copy(PROBE, run / "events.out.tfevents.1790586250.host.3263.0")
    return run


def test_runs_of_this_task_are_found_newest_first(tmp_path):
    _run(tmp_path, "first", stamp="2026-09-28_10-00-00")
    _run(tmp_path, "second", stamp="2026-09-28_11-00-00")
    _run(tmp_path, "rolling", task="Mjlab-RollerSprint2m-MicroDuck", experiment="roller_sprint_2m")
    (tmp_path / "logs" / "rsl_rl" / "sprint_2m" / "no-provenance").mkdir()
    runs = find_runs(tmp_path, TASK)
    assert [r.name for r in runs] == ["second", "first"]
    assert runs[0].id == "2026-09-28_11-00-00_second"


def test_checkpoints_are_listed_by_iteration_not_by_name(tmp_path):
    _run(tmp_path, "first", checkpoints=(0, 250, 1000, 2999))
    (run,) = find_runs(tmp_path, TASK)
    assert run.checkpoints == (0, 250, 1000, 2999)


def test_a_provenance_still_being_written_is_skipped_not_fatal(tmp_path):
    _run(tmp_path, "first")
    torn = _run(tmp_path, "pulling", stamp="2026-09-28_12-00-00")
    (torn / "provenance.json").write_text('{"task": "Mjlab-Spr')
    assert [r.name for r in find_runs(tmp_path, TASK)] == ["first"]


def test_find_run_by_id(tmp_path):
    _run(tmp_path, "first")
    assert find_run(tmp_path, TASK, "2026-09-28_10-00-00_first").name == "first"
    assert find_run(tmp_path, TASK, "nope") is None


def test_the_curve_is_the_mean_reward_tensorboard_recorded(tmp_path):
    _run(tmp_path, "first")
    (run,) = find_runs(tmp_path, TASK)
    assert curve(run) == pytest.approx([(1, -0.6283139), (2, -0.5193406)])


def test_a_run_without_tensorboard_files_has_no_curve_yet(tmp_path):
    run_dir = _run(tmp_path, "first")
    for events in run_dir.glob("events.out.tfevents.*"):
        events.unlink()
    (run,) = find_runs(tmp_path, TASK)
    assert curve(run) == []


def test_a_record_cut_off_mid_write_is_left_for_next_time(tmp_path):
    whole = PROBE.read_bytes()
    torn = tmp_path / "events.out.tfevents.torn"
    # A next record whose length has arrived but whose bytes have not all: what a
    # pull catches while the job's writer is mid-flush.
    torn.write_bytes(whole + whole[:20])
    assert tfevents.scalars(torn, "Train/mean_reward") == tfevents.scalars(PROBE, "Train/mean_reward")
```

- [ ] **Step 3: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'arena.workshop.challenges'`.

- [ ] **Step 4: Read TensorBoard files without TensorBoard**

```python
# arena/workshop/tfevents.py
"""Scalars from a TensorBoard event file, without TensorBoard.

The Arena must not depend on the training stack, and a curve needs one tag. The
file is a sequence of TFRecords — an 8-byte length, a 4-byte CRC, the record, a
4-byte CRC — each record an `Event` protobuf: `step` is field 2, `summary` field
5; a summary's `value`s are field 1, each with `tag` (1) and `simple_value` (2),
which is what rsl_rl's SummaryWriter.add_scalar writes. CRCs are not checked: a
record still being written is simply shorter than its length says, and is left
for the next read. Checked against tensorboard's own EventAccumulator on a real
rsl_rl 5.0.1 file (tests/fixtures/workshop/).
"""

import struct
from pathlib import Path


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes):
    """(field number, value) for each field of one protobuf message."""
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(buf, i)
        elif wire == 1:
            value = struct.unpack_from("<d", buf, i)[0]
            i += 8
        elif wire == 2:
            size, i = _varint(buf, i)
            value = bytes(buf[i:i + size])
            i += size
        elif wire == 5:
            value = struct.unpack_from("<f", buf, i)[0]
            i += 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        yield field, value


def scalars(path: Path, tag: str) -> list[tuple[int, float]]:
    """Every (step, value) recorded under `tag`, in file order."""
    data = Path(path).read_bytes()
    wanted = tag.encode()
    points, i = [], 0
    while i + 12 <= len(data):
        (size,) = struct.unpack_from("<Q", data, i)
        record = data[i + 12:i + 12 + size]
        if len(record) < size:
            break
        i += 12 + size + 4
        event = dict(_fields(record))
        if 5 not in event:
            continue
        for field, value in _fields(event[5]):
            if field != 1:
                continue
            entry = dict(_fields(value))
            if entry.get(1) == wanted and 2 in entry:
                points.append((event.get(2, 0), entry[2]))
    return points
```

- [ ] **Step 5: Read and write challenge.toml**

```python
# arena/workshop/challenges.py
"""The challenges a microduck-challenges checkout holds, read from each folder's challenge.toml.

The workshop edits two things in that file — `[recipe]` and each
`[params.<name>].value` — and edits them in place, line by line: the comments
and the layout are the author's explanation of the knobs, and a user reads the
same file in an editor. The Arena never imports the challenge's Python.
"""

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from ..manifest import ManifestError, load_event

PACKAGE = Path("src") / "microduck_challenges"
RECIPE = ("num_envs", "max_iterations", "seed")

_SECTION = re.compile(r"^\s*\[([^\]]+)\]")
_ASSIGN = re.compile(r"^(\s*(\w+)\s*=\s*)([^#\n]*?)(\s*(?:#.*)?)$")


class ChallengeError(ValueError):
    """A challenge.toml the workshop cannot use, or a value it will not write."""


@dataclass(frozen=True)
class Knob:
    name: str
    label: str
    value: float
    min: float
    max: float


@dataclass(frozen=True)
class Challenge:
    folder: str  # e.g. "sprint_2m"; also the experiment folder under logs/rsl_rl/
    toml: Path
    event: str
    task: str
    kind: str
    recipe: dict[str, int]
    knobs: tuple[Knob, ...]


def read_challenge(toml: Path) -> Challenge:
    table = tomllib.loads(toml.read_text())
    try:
        return Challenge(
            folder=toml.parent.name,
            toml=toml,
            event=str(table["event"]),
            task=str(table["task"]),
            kind=str(table["kind"]),
            recipe={key: int(table["recipe"][key]) for key in RECIPE},
            knobs=tuple(
                Knob(name, str(k["label"]), float(k["value"]), float(k["min"]), float(k["max"]))
                for name, k in table.get("params", {}).items()
            ),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ChallengeError(
            f"{toml}: missing or unreadable {exc} — the workshop needs event, task, kind, "
            f"[recipe] {', '.join(RECIPE)}, and a label, value, min and max for each knob"
        ) from exc


def open_challenges(root: Path) -> list[Challenge]:
    """The checkout's challenges whose event is open on this Arena, in folder order."""
    found = []
    for toml in sorted((root / PACKAGE).glob("*/challenge.toml")):
        challenge = read_challenge(toml)
        try:
            is_open = load_event(challenge.event).status == "open"
        except ManifestError:
            is_open = False  # an event this Arena version does not have
        if is_open:
            found.append(challenge)
    return found


def write_values(challenge: Challenge, recipe: dict[str, int], params: dict[str, float]) -> bool:
    """Write recipe entries and knob values into challenge.toml. True when the file changed.

    Every value is checked before anything is written: recipe numbers at least 1
    (a seed may be 0), a knob within its own min and max.
    """
    wanted: dict[tuple[str, str], str] = {}
    for key, value in recipe.items():
        if key not in RECIPE:
            raise ChallengeError(f"{key!r} is not a recipe entry; the recipe is {', '.join(RECIPE)}")
        floor = 0 if key == "seed" else 1
        if int(value) < floor:
            raise ChallengeError(f"{key} must be at least {floor}, not {value}")
        wanted[("recipe", key)] = str(int(value))
    knobs = {knob.name: knob for knob in challenge.knobs}
    for name, value in params.items():
        knob = knobs.get(name)
        if knob is None:
            raise ChallengeError(f"{name!r} is not a knob of {challenge.event}")
        if not knob.min <= float(value) <= knob.max:
            raise ChallengeError(f"{knob.label} must be between {knob.min:g} and {knob.max:g}, not {value:g}")
        wanted[(f"params.{name}", "value")] = repr(float(value))
    text = challenge.toml.read_text()
    edited = _set(text, wanted)
    if edited == text:
        return False
    challenge.toml.write_text(edited)
    return True


def _set(text: str, wanted: dict[tuple[str, str], str]) -> str:
    section, lines, todo = None, [], dict(wanted)
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\n")
        if header := _SECTION.match(body):
            section = header.group(1).strip()
        elif (assign := _ASSIGN.match(body)) and (section, assign.group(2)) in todo:
            line = assign.group(1) + todo.pop((section, assign.group(2))) + assign.group(4) + line[len(body):]
        lines.append(line)
    if todo:
        raise ChallengeError(f"challenge.toml has no line for {sorted(todo)}")
    return "".join(lines)
```

- [ ] **Step 6: Find runs on disk**

```python
# arena/workshop/runs.py
"""Training runs on disk: every logs/rsl_rl/<experiment>/<stamp>_<name>/ holding a provenance.json.

Discovered, never kept in a ledger of the workshop's own: a run trained from a
shell, or pulled back from an HF job, is found exactly like one the workshop
launched, and restarting the workshop loses nothing.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from . import tfevents

LOGS = Path("logs") / "rsl_rl"
REWARD = "Train/mean_reward"
_STAMPED = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(.+)$")
_CHECKPOINT = re.compile(r"^model_(\d+)\.pt$")


@dataclass(frozen=True)
class Run:
    id: str  # the directory's name, <YYYY-MM-DD_HH-MM-SS>_<name>
    path: Path
    name: str  # what --agent.run-name said
    provenance: dict
    checkpoints: tuple[int, ...]  # iterations that have a model_<N>.pt, in order


def _read(path: Path) -> Run | None:
    try:
        provenance = json.loads((path / "provenance.json").read_text())
    except ValueError:
        return None  # still being written by a pull: it will be whole next time
    stamped = _STAMPED.match(path.name)
    checkpoints = sorted(int(m.group(1)) for f in path.iterdir() if (m := _CHECKPOINT.match(f.name)))
    return Run(path.name, path, stamped.group(1) if stamped else path.name, provenance, tuple(checkpoints))


def find_runs(root: Path, task: str) -> list[Run]:
    """This task's runs, newest first (the directory names start with their start time)."""
    runs = (_read(found.parent) for found in (root / LOGS).glob("*/*/provenance.json"))
    return sorted((r for r in runs if r and r.provenance.get("task") == task), key=lambda r: r.id, reverse=True)


def find_run(root: Path, task: str, run_id: str) -> Run | None:
    return next((r for r in find_runs(root, task) if r.id == run_id), None)


def curve(run: Run, tag: str = REWARD) -> list[tuple[int, float]]:
    """The run's `tag` over its steps, from every TensorBoard file in it."""
    points = []
    for events in sorted(run.path.glob("events.out.tfevents.*")):
        points += tfevents.scalars(events, tag)
    return sorted(points)
```

- [ ] **Step 7: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop -q
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add arena/workshop/challenges.py arena/workshop/runs.py arena/workshop/tfevents.py tests/workshop tests/fixtures/workshop
/usr/bin/git commit -m "Workshop: read a checkout's open challenges, its runs on disk and their TensorBoard curves"
```

---

### Task 10: The workshop opens: the `workshop` command, its server, the preflight

**Files:**
- Create: `arena/workshop/shell.py`, `arena/workshop/hub.py`, `arena/workshop/app.py`, `arena/workshop/cli.py`
- Modify: `pyproject.toml` — one line under `[project.scripts]` (see *Coordination*)
- Create: `tests/workshop/conftest.py`, `tests/workshop/fake_uv.py`, `tests/workshop/fake_gh.py`
- Test: `tests/workshop/test_app.py`, `tests/workshop/test_cli.py`

**Interfaces:**
- Consumes: `open_challenges`, `Challenge` (Task 9); `arena.web.routes_read.event_summary`; `arena.web.config.default_frontend`.
- Produces:
  - `shell.ShellError`; `shell.git(root, *args, check=True) -> str`; `shell.commit_all(root, message) -> bool`; `shell.gh_ready(root) -> bool`; `shell.uv(*args) -> list[str]` (`["uv", "run", "--no-sync", *args]`); `shell.uv_run(root, *args) -> CompletedProcess`; `shell.child_env() -> dict` (the environment with `PYTHONUNBUFFERED=1`).
  - `hub.Hub` with `whoami() -> str | None`, `login(token: str) -> None`, `cancel_job(job_id: str, namespace: str) -> None`.
  - `app.Workshop` (dataclass: `root`, `challenge`, `arena`, `hub`, `open_browser`, `training=None`) at `app.state.workshop`; `app.preflight(root, hub) -> dict` with keys `git, identity, uv, gpu, gh, user`; `create_workshop_app(root, challenge, arena, hub, frontend_dir=None, open_browser=webbrowser.open) -> FastAPI`.
  - Routes: `GET /api/workshop/status` → `{challenge: {folder, event, task, kind, recipe, knobs: [{name,label,value,min,max}]}, event: event_summary, arena, preflight, mode: "local" | "hf-jobs"}`; `POST /api/workshop/login {token}` → `{user}`; `GET /` → `workshop.html` (503 with the build command when there is no built site).
  - Console script `workshop [challenge] [--arena URL] [--port 8765] [--no-browser]`; `challenge` is the event id (or the folder name).
  - Test harness (`tests/workshop/conftest.py`): fixtures `remotes`, `checkout`, `fakes`, `hub`, `workshop`; helpers `git(root, *args)`, `make_run(root, name, …)`, `wait_for(predicate, timeout=10)`.

- [ ] **Step 1: Build the test harness**

```python
# tests/workshop/fake_uv.py
"""`uv`, as the workshop calls it — `uv run --no-sync <command> …` — played without training anything.

Each call is appended to $FAKE_UV_LOG as JSON. `train` writes a run the way
mjlab does (provenance.json, model_0.pt and model_1.pt, the fixture TensorBoard
file); with --hf-jobs it prints what hf_jobs prints and writes the run into
$FAKE_HUB/<ckpt repo>/ instead, which `hf download` copies back. `publish
--dry-run` writes ./publish-<name>/ with $FAKE_UV_ONNX as policy.onnx; a real
`publish` prints the commit URL the real one prints. FAKE_UV_FAIL_<COMMAND>=1
makes that command fail; FAKE_UV_TRAIN_S keeps `train` alive that long.
"""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


def flag(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


def train(argv):
    name = flag(argv, "--agent.run-name")
    commit = subprocess.run(["git", "rev-parse", "--short=9", "HEAD"], capture_output=True, text=True).stdout.strip()
    record = {"command": ["train", *argv], "task": argv[0], "seed": int(flag(argv, "--agent.seed", 42)),
              "commit": commit, "branch": "main", "dirty": False, "started": "2026-09-28T10:00:00Z"}
    if "--hf-jobs" in argv:
        repo = flag(argv, "--ckpt-repo")
        print(f"[ckpt] checkpoints -> https://huggingface.co/{repo}", flush=True)
        print("[job] id:  fakejob42", flush=True)
        base = Path(os.environ["FAKE_HUB"]) / repo
    else:
        base = Path("logs") / "rsl_rl"
    run = base / "sprint_2m" / f"{datetime.now():%Y-%m-%d_%H-%M-%S}_{name}"
    run.mkdir(parents=True)
    (run / "provenance.json").write_text(json.dumps(record))
    shutil.copy(os.environ["FAKE_UV_TFEVENTS"], run / "events.out.tfevents.1.fake")
    for n in (0, 1):
        (run / f"model_{n}.pt").write_bytes(b"pt")
    print("Learning iteration 1/2", flush=True)
    time.sleep(float(os.environ.get("FAKE_UV_TRAIN_S", "0")))
    return int(os.environ.get("FAKE_UV_TRAIN_RC", "0"))


def hf(argv):
    repo, dest = argv[1], Path(flag(argv, "--local-dir"))
    source = Path(os.environ["FAKE_HUB"]) / repo
    if source.is_dir():
        shutil.copytree(source, dest, dirs_exist_ok=True)
    print(dest)
    return 0


def publish(argv):
    name = flag(argv, "--name")
    if "--dry-run" in argv:
        out = Path(f"publish-{name}")
        out.mkdir(exist_ok=True)
        shutil.copy(os.environ["FAKE_UV_ONNX"], out / "policy.onnx")
        (out / "manifest.json").write_text(json.dumps({"name": name, "kind": "perpetual"}))
        (out / "README.md").write_text(f"# {name}\n")
        print(f"[publish] dry run: wrote {out.resolve()}/ (policy.onnx, manifest.json, README.md, checkpoint.pt)")
        return 0
    print(f"[publish] uploaded: https://huggingface.co/{flag(argv, '--repo')}/commit/{'a' * 40}")
    return 0


def main():
    argv = sys.argv[1:]
    with open(os.environ["FAKE_UV_LOG"], "a") as log:
        log.write(json.dumps({"argv": argv, "cwd": os.getcwd()}) + "\n")
    assert argv[:2] == ["run", "--no-sync"], argv
    command, rest = argv[2], argv[3:]
    if os.environ.get(f"FAKE_UV_FAIL_{command.upper()}"):
        print(f"{command}: boom", file=sys.stderr)
        return 2
    return {"train": train, "hf": hf, "publish": publish}[command](rest)


if __name__ == "__main__":
    sys.exit(main())
```

```python
# tests/workshop/fake_gh.py
"""`gh`, as the workshop calls it. `gh auth status` fails when FAKE_GH_LOGGED_OUT is set.
`gh repo fork --remote` does to the checkout what the real one does: creates alice's fork
(a bare repo under $FAKE_GITHUB), renames origin to upstream and adds the fork as origin."""

import os
import subprocess
import sys
from pathlib import Path


def main():
    argv = sys.argv[1:]
    if argv[:2] == ["auth", "status"]:
        return 1 if os.environ.get("FAKE_GH_LOGGED_OUT") else 0
    if argv[:3] == ["repo", "fork", "--remote"]:
        fork = Path(os.environ["FAKE_GITHUB"]) / "alice" / "microduck-challenges"
        fork.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "--bare", str(fork)], check=True)
        subprocess.run(["git", "remote", "rename", "origin", "upstream"], check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/alice/microduck-challenges"], check=True)
        print("✓ Created fork alice/microduck-challenges")
        return 0
    print(f"fake gh: unexpected {argv}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

```python
# tests/workshop/conftest.py
"""The workshop's world, played locally: a microduck-challenges checkout in a temp dir, GitHub as
bare repos (https://github.com/<owner>/<name> is rewritten to them with url.insteadOf), and fake
`uv` and `gh` first on PATH. The real git runs everything git."""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from arena.assets import ASSET_ROOT

HERE = Path(__file__).resolve().parent
PROBE = HERE.parent / "fixtures" / "workshop" / "events.out.tfevents.probe"
REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
UPSTREAM = "https://github.com/pollen-robotics/microduck-challenges"

SPRINT = """\
# The 2 m Sprint.
event = "sprint-2m"
task  = "Mjlab-Sprint2m-MicroDuck"
kind  = "perpetual"

[recipe]                  # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.forward_reward]
label = "Follow the speed order"
value = 2.0
min   = 0.5
max   = 5.0
"""


def git(root, *args) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()


def wait_for(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if found := predicate():
            return found
        time.sleep(0.05)
    raise AssertionError("timed out waiting")


def make_run(root, name="first", checkpoints=(0, 1), dirty=False, stamp="2026-09-28_10-00-00", task="Mjlab-Sprint2m-MicroDuck"):
    run = root / "logs" / "rsl_rl" / "sprint_2m" / f"{stamp}_{name}"
    run.mkdir(parents=True)
    (run / "provenance.json").write_text(json.dumps({
        "task": task, "commit": git(root, "rev-parse", "--short=9", "HEAD"), "branch": "main",
        "dirty": dirty, "seed": 1, "started": "2026-09-28T10:00:00Z",
    }))
    for n in checkpoints:
        (run / f"model_{n}.pt").write_bytes(b"pt")
    shutil.copy(PROBE, run / "events.out.tfevents.1.probe")
    return run


@pytest.fixture
def remotes(tmp_path):
    base = tmp_path / "github"
    upstream = base / "pollen-robotics" / "microduck-challenges"
    upstream.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "--bare", str(upstream)], check=True)
    return base


@pytest.fixture
def checkout(tmp_path, remotes):
    root = tmp_path / "microduck-challenges"
    folder = root / "src" / "microduck_challenges" / "sprint_2m"
    folder.mkdir(parents=True)
    (folder / "challenge.toml").write_text(SPRINT)
    (root / ".gitignore").write_text("logs/\npublish-*/\n")
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "novice@example.com")
    git(root, "config", "user.name", "Novice")
    git(root, "config", f"url.file://{remotes}/.insteadOf", "https://github.com/")
    git(root, "remote", "add", "origin", UPSTREAM)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "the challenges")
    git(root, "push", "-q", "-u", "origin", "main")
    return root


@pytest.fixture
def fakes(tmp_path, monkeypatch, remotes):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool, source in (("uv", "fake_uv.py"), ("gh", "fake_gh.py")):
        target = bin_dir / tool
        target.write_text(f"#!{sys.executable}\n" + (HERE / source).read_text())
        target.chmod(0o755)
    real_git = Path(shutil.which("git")).parent
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{real_git}")
    log = tmp_path / "uv-calls.jsonl"
    monkeypatch.setenv("FAKE_UV_LOG", str(log))
    monkeypatch.setenv("FAKE_HUB", str(tmp_path / "hub"))
    monkeypatch.setenv("FAKE_UV_TFEVENTS", str(PROBE))
    monkeypatch.setenv("FAKE_UV_ONNX", str(REFERENCE))
    monkeypatch.setenv("FAKE_GITHUB", str(remotes))

    def gpu():
        smi = bin_dir / "nvidia-smi"
        smi.write_text("#!/bin/sh\nexit 0\n")
        smi.chmod(0o755)

    def calls(command=None):
        rows = [json.loads(line)["argv"] for line in log.read_text().splitlines()] if log.exists() else []
        return [argv for argv in rows if command is None or argv[2] == command]

    return SimpleNamespace(bin=bin_dir, gpu=gpu, calls=calls)


class FakeHub:
    def __init__(self, user="alice"):
        self.user = user
        self.tokens = []
        self.cancelled = []

    def whoami(self):
        return self.user

    def login(self, token):
        if token != "hf_good":
            raise ValueError("Invalid user token.")
        self.tokens.append(token)
        self.user = "alice"

    def cancel_job(self, job_id, namespace):
        self.cancelled.append((job_id, namespace))


@pytest.fixture
def hub():
    return FakeHub()


@pytest.fixture
def workshop(checkout, fakes, hub):
    from arena.workshop.app import create_workshop_app
    from arena.workshop.challenges import open_challenges

    opened = []
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub,
                              open_browser=opened.append)
    client = TestClient(app)
    client.opened = opened
    return client
```

(`PATH` keeps the real git's directory after the fakes. On a Mac with Homebrew that directory also holds the real `uv` and `gh` — shadowed by the fakes, which come first — and no `nvidia-smi`.)

- [ ] **Step 2: Write the failing tests**

```python
# tests/workshop/test_app.py
"""The page's server: what it says about the checkout and the machine, before anything runs."""

from arena.workshop.app import create_workshop_app


def test_status_names_the_challenge_its_recipe_knobs_and_event(workshop):
    body = workshop.get("/api/workshop/status").json()
    assert body["challenge"]["event"] == "sprint-2m"
    assert body["challenge"]["task"] == "Mjlab-Sprint2m-MicroDuck"
    assert body["challenge"]["recipe"] == {"num_envs": 4096, "max_iterations": 3000, "seed": 1}
    assert body["challenge"]["knobs"] == [
        {"name": "forward_reward", "label": "Follow the speed order", "value": 2.0, "min": 0.5, "max": 5.0}]
    assert body["event"]["id"] == "sprint-2m" and body["event"]["rig"] == "legs"
    assert body["arena"] == "http://arena.test"


def test_without_an_nvidia_gpu_training_goes_to_hf_jobs(workshop):
    body = workshop.get("/api/workshop/status").json()
    assert body["preflight"] == {"git": True, "identity": True, "uv": True, "gpu": False, "gh": True, "user": "alice"}
    assert body["mode"] == "hf-jobs"


def test_with_an_nvidia_gpu_it_trains_here(workshop, fakes):
    fakes.gpu()
    assert workshop.get("/api/workshop/status").json()["mode"] == "local"


def test_a_logged_out_user_is_told_so(workshop, hub):
    hub.user = None
    assert workshop.get("/api/workshop/status").json()["preflight"]["user"] is None


def test_logging_in_with_a_token(workshop, hub):
    hub.user = None
    assert workshop.post("/api/workshop/login", json={"token": " hf_good "}).json() == {"user": "alice"}
    assert hub.tokens == ["hf_good"]


def test_a_refused_token_says_why(workshop, hub):
    hub.user = None
    response = workshop.post("/api/workshop/login", json={"token": "nope"})
    assert response.status_code == 400
    assert "Invalid user token" in response.json()["detail"]


def test_git_without_a_name_on_commits_is_flagged(workshop, checkout, monkeypatch, tmp_path):
    from tests.workshop.conftest import git

    git(checkout, "config", "--unset", "user.email")
    monkeypatch.setenv("HOME", str(tmp_path))  # no global identity either
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    assert workshop.get("/api/workshop/status").json()["preflight"]["identity"] is False


def test_the_page_is_served_from_the_built_site(checkout, fakes, hub, tmp_path):
    from fastapi.testclient import TestClient

    from arena.workshop.challenges import open_challenges

    site = tmp_path / "site"
    site.mkdir()
    (site / "workshop.html").write_text("<html>workshop</html>")
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub, frontend_dir=site)
    assert TestClient(app).get("/").text == "<html>workshop</html>"


def test_without_a_built_site_the_page_says_how_to_build_it(workshop):
    response = workshop.get("/")
    assert response.status_code == 503
    assert "npm run build" in response.text
```

```python
# tests/workshop/test_cli.py
"""`uv run workshop` lists the challenges open in this checkout; `uv run workshop <id>` opens one."""

from arena.workshop import cli


def test_with_no_challenge_it_lists_the_open_ones(checkout, monkeypatch, capsys):
    monkeypatch.chdir(checkout)
    assert cli.main([]) == 0
    assert "uv run --group workshop workshop sprint-2m" in capsys.readouterr().out


def test_an_unknown_challenge_is_refused_with_the_list(checkout, monkeypatch, capsys):
    monkeypatch.chdir(checkout)
    assert cli.main(["moon-landing"]) == 2
    out = capsys.readouterr()
    assert "moon-landing" in out.err and "workshop sprint-2m" in out.out


def test_outside_a_checkout_it_says_where_to_run_it(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["sprint-2m"]) == 2
    assert "microduck-challenges" in capsys.readouterr().err


def test_a_challenge_opens_the_workshop_on_it(checkout, monkeypatch):
    served = {}
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.run", lambda app, **kw: served.update(app=app, **kw))
    assert cli.main(["sprint-2m", "--arena", "http://127.0.0.1:8000/", "--no-browser", "--port", "9999"]) == 0
    workshop = served["app"].state.workshop
    assert workshop.challenge.event == "sprint-2m"
    assert workshop.arena == "http://127.0.0.1:8000"
    assert served["port"] == 9999 and served["host"] == "127.0.0.1"


def test_the_folder_name_works_too(checkout, monkeypatch):
    served = {}
    monkeypatch.chdir(checkout)
    monkeypatch.setattr("uvicorn.run", lambda app, **kw: served.update(app=app))
    assert cli.main(["sprint_2m", "--no-browser"]) == 0
    assert served["app"].state.workshop.challenge.event == "sprint-2m"
```

- [ ] **Step 3: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop/test_app.py tests/workshop/test_cli.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'arena.workshop.app'`.

- [ ] **Step 4: The subprocess helpers and the Hub**

```python
# arena/workshop/shell.py
"""The workshop's subprocesses: git and gh as they are, uv as `uv run --no-sync <command>`.

`--no-sync`: the workshop already runs in the checkout's environment — the
launcher synced it once — so every command runs in that environment as it is.
A sync per call costs seconds and, during development, would put the locked
Arena wheel back over an editable install. Output is never interpreted beyond
what a step needs; on failure it is handed back whole.
"""

import os
import shutil
import subprocess
from pathlib import Path


class ShellError(RuntimeError):
    """A command failed. The message is the command and its whole output."""


def child_env() -> dict:
    # Python children buffer a pipe in blocks; a log that arrives a page at a time is no log.
    return {**os.environ, "PYTHONUNBUFFERED": "1"}


def git(root: Path, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if check and done.returncode != 0:
        raise ShellError(f"$ git {' '.join(args)}\n{done.stdout}{done.stderr}")
    return done.stdout.strip()


def commit_all(root: Path, message: str) -> bool:
    """Commit everything git does not ignore. False when there was nothing to commit."""
    if not git(root, "status", "--porcelain"):
        return False
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)
    return True


def gh_ready(root: Path) -> bool:
    """The GitHub CLI is installed and logged in, so the workshop can fork for the user."""
    if shutil.which("gh") is None:
        return False
    return subprocess.run(["gh", "auth", "status"], cwd=root, capture_output=True).returncode == 0


def uv(*args: str) -> list[str]:
    return ["uv", "run", "--no-sync", *args]


def uv_run(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(uv(*args), cwd=root, capture_output=True, text=True, env=child_env())
```

```python
# arena/workshop/hub.py
"""The three Hugging Face calls the workshop makes itself; everything else is a `uv run` subprocess."""


class Hub:
    def whoami(self) -> str | None:
        from huggingface_hub import whoami

        try:
            return whoami()["name"]
        except Exception:  # noqa: BLE001
            # No token, an expired one, no network: to a novice all three mean
            # "log in", which is what the page then says.
            return None

    def login(self, token: str) -> None:
        from huggingface_hub import login

        login(token=token)

    def cancel_job(self, job_id: str, namespace: str) -> None:
        from huggingface_hub import HfApi

        HfApi().cancel_job(job_id=job_id, namespace=namespace)
```

(Check `huggingface_hub.login`'s signature in the installed version — `uv run --no-config --frozen python -c "import inspect, huggingface_hub; print(inspect.signature(huggingface_hub.login))"` — and pass only arguments it has.)

- [ ] **Step 5: The server**

```python
# arena/workshop/app.py
"""The workshop's server: one challenge, one checkout, on 127.0.0.1, never deployed.

Separate from arena/web — no OAuth, no store — and it only ever runs on the
machine that holds the checkout. The page (workshop.html) is built with the
site and served from the same folder, so the replay uses the site's viewer.
"""

import shutil
import webbrowser
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..manifest import load_event
from ..web.routes_read import event_summary
from .challenges import Challenge
from .hub import Hub
from .shell import gh_ready, git

NO_SITE = (
    "The workshop's page has not been built.\n\n"
    "    cd app && npm install && npm run build\n\n"
    "in the Arena's checkout (an installed Arena wheel carries it already).\n"
)

router = APIRouter(prefix="/api/workshop")


@dataclass
class Workshop:
    root: Path
    challenge: Challenge
    arena: str
    hub: Hub
    open_browser: object
    training: object = field(default=None)


def preflight(root: Path, hub: Hub) -> dict:
    has_git = shutil.which("git") is not None
    return {
        "git": has_git,
        # A commit needs a name: the workshop commits before every training.
        "identity": has_git and bool(git(root, "config", "user.email", check=False)),
        "uv": shutil.which("uv") is not None,
        "gpu": shutil.which("nvidia-smi") is not None,
        "gh": gh_ready(root),
        "user": hub.whoami(),
    }


def _workshop(request: Request) -> Workshop:
    return request.app.state.workshop


@router.get("/status")
def status(request: Request) -> dict:
    ws = _workshop(request)
    tools = preflight(ws.root, ws.hub)
    c = ws.challenge
    return {
        "challenge": {
            "folder": c.folder, "event": c.event, "task": c.task, "kind": c.kind,
            "recipe": c.recipe, "knobs": [asdict(k) for k in c.knobs],
        },
        "event": event_summary(load_event(c.event)),
        "arena": ws.arena,
        "preflight": tools,
        "mode": "local" if tools["gpu"] else "hf-jobs",
    }


class Token(BaseModel):
    token: str


@router.post("/login")
def login(body: Token, request: Request) -> dict:
    ws = _workshop(request)
    try:
        ws.hub.login(body.token.strip())
    except Exception as exc:  # noqa: BLE001 — the Hub's own sentence is the useful part
        raise HTTPException(status_code=400, detail=f"Hugging Face refused this token: {exc}") from exc
    return {"user": ws.hub.whoami()}


def create_workshop_app(
    root: Path,
    challenge: Challenge,
    arena: str,
    hub: Hub,
    frontend_dir: Path | None = None,
    open_browser=webbrowser.open,
) -> FastAPI:
    app = FastAPI(title="Microduck workshop", docs_url=None, redoc_url=None)
    app.state.workshop = Workshop(root, challenge, arena, hub, open_browser)
    app.include_router(router)

    if frontend_dir is None:
        @app.get("/")
        def no_site() -> PlainTextResponse:
            return PlainTextResponse(NO_SITE, status_code=503)
    else:
        page = frontend_dir / "workshop.html"

        @app.get("/")
        def workshop_page() -> FileResponse:
            return FileResponse(page, headers={"Cache-Control": "no-store"})

        # Last, so /api/workshop wins: the bundle, the meshes, the design tokens.
        app.mount("/", StaticFiles(directory=frontend_dir), name="site")
    return app
```

- [ ] **Step 6: The command**

```python
# arena/workshop/cli.py
"""`workshop` — train, test and publish a policy for one challenge, from a microduck-challenges checkout.

    uv run --group workshop workshop              # the challenges open here
    uv run --group workshop workshop sprint-2m    # the workshop for that one, in the browser

The one line on a challenge's page runs the second form for you.
"""

import argparse
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

from .challenges import open_challenges

SPACE = "https://pollen-robotics-microduck-arena.hf.space"
CHALLENGES = "https://github.com/pollen-robotics/microduck-challenges"


def _checkout() -> Path | None:
    if shutil.which("git") is None:
        return None
    found = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return Path(found.stdout.strip()) if found.returncode == 0 else None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="workshop", description=__doc__.splitlines()[0])
    parser.add_argument("challenge", nargs="?", help="the Arena event, e.g. sprint-2m")
    parser.add_argument("--arena", default=SPACE, help="the Arena to enter the published policy on")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="print the address instead of opening it")
    args = parser.parse_args(argv)

    root = _checkout()
    challenges = open_challenges(root) if root else []
    if not challenges:
        print(f"No open challenge here. Run this inside a clone of {CHALLENGES}.", file=sys.stderr)
        return 2
    chosen = next((c for c in challenges if args.challenge in (c.event, c.folder)), None)
    if chosen is None:
        if args.challenge:
            print(f"{args.challenge!r} is not a challenge open here.", file=sys.stderr)
        print("Open challenges:")
        for c in challenges:
            print(f"  uv run --group workshop workshop {c.event}")
        return 2 if args.challenge else 0

    import uvicorn

    from ..web.config import default_frontend
    from .app import create_workshop_app
    from .hub import Hub

    site = default_frontend(Path(__file__).resolve().parents[1])
    app = create_workshop_app(
        root, chosen, args.arena.rstrip("/"), Hub(), site if (site / "workshop.html").is_file() else None
    )
    url = f"http://127.0.0.1:{args.port}/"
    print(f"{chosen.event} workshop: {url}  (Ctrl-C to close it)")
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0
```

(The listed lines read `uv run --group workshop workshop <id>`: the form that works in a plain clone, where the Arena is in the non-default `workshop` group.)

`pyproject.toml`, under `[project.scripts]` after `arena = "arena.cli:main"`:

```toml
# The challenge workshop, run inside a microduck-challenges checkout.
workshop = "arena.workshop.cli:main"
```

- [ ] **Step 7: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop -q
uv run --no-config --frozen workshop --help | head -3
```

Expected: all pass; the help prints (uv reinstalls the project to create the script).

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add arena/workshop pyproject.toml tests/workshop
/usr/bin/git commit -m "Workshop: the workshop command, its local server and the preflight"
```

---

### Task 11: Train — launch, follow, stop, and bring an HF run back

**Files:**
- Create: `arena/workshop/training.py`
- Modify: `arena/workshop/app.py` (routes `train`, `train/stop`, `train/pull`, `runs`, `runs/{id}/curve`)
- Test: `tests/workshop/test_training.py`

**Interfaces:**
- Consumes: `write_values`, `read_challenge`, `RECIPE` (Task 9); `find_runs`, `find_run`, `curve`, `LOGS` (Task 9); `shell.uv`, `shell.child_env`, `shell.commit_all`, `ShellError` (Task 10); `Hub.cancel_job`.
- Produces:
  - `training.PULL_EVERY_S = 120.0`; `training.ckpt_repo(user, challenge, name) -> "<user>/<task lowercased>-<name>"`; `training.train_command(challenge, name, recipe, hf_user: str | None) -> list[str]`.
  - `Training(root, name, command, ckpt_repo=None, namespace=None)` with `.name`, `.state` (`running|stopped|finished|failed`), `.returncode`, `.job_id`, `.snapshot(since) -> dict`, `.pull() -> bool`, `.stop(hub)`.
  - `POST /api/workshop/train {name, recipe: {num_envs, max_iterations, seed}, params: {knob: value}}` → the snapshot; 409 while one runs or for a name already used; 400 on a bad value, a failed commit, or HF Jobs without a login.
  - `GET /api/workshop/train?since=N` → `{name, mode, state, returncode, ckpt_repo, job_id, log: [lines from N], next}` or `{state: null}`.
  - `POST /api/workshop/train/stop`; `POST /api/workshop/train/pull` (HF runs only) → the snapshot.
  - `GET /api/workshop/runs` → `{runs: [{id, name, started, dirty, checkpoints: [N…]}]}`; `GET /api/workshop/runs/{id}/curve` → `{points: [[step, value]…]}`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/workshop/test_training.py
"""Launching commits the knobs and trains — here with a GPU, on HF Jobs without one — and an HF run
is brought back into logs/ so Test and Publish find it where they find a local one."""

import pytest

from tests.workshop.conftest import SPRINT, git, make_run, wait_for

LAUNCH = {"name": "first", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3}, "params": {"forward_reward": 3.5}}


def _finished(workshop):
    body = workshop.get("/api/workshop/train?since=0").json()
    return body if body["state"] in ("finished", "failed", "stopped") else None


def test_launch_commits_the_recipe_and_knobs_then_trains_here(workshop, fakes, checkout):
    fakes.gpu()
    assert workshop.post("/api/workshop/train", json=LAUNCH).status_code == 200
    body = wait_for(lambda: _finished(workshop))
    assert body["state"] == "finished" and body["mode"] == "local"
    toml = (checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml").read_text()
    assert "num_envs       = 512" in toml and "value = 3.5" in toml and "# the first training, as is" in toml
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m: run first"
    assert git(checkout, "status", "--porcelain") == ""
    (train,) = fakes.calls("train")
    assert train == ["run", "--no-sync", "train", "Mjlab-Sprint2m-MicroDuck", "--env.scene.num-envs", "512",
                     "--agent.max-iterations", "50", "--agent.seed", "3", "--agent.logger", "tensorboard",
                     "--agent.run-name", "first"]
    (run,) = workshop.get("/api/workshop/runs").json()["runs"]
    assert run["name"] == "first" and run["checkpoints"] == [0, 1] and run["dirty"] is False
    points = workshop.get(f"/api/workshop/runs/{run['id']}/curve").json()["points"]
    assert [step for step, _ in points] == [1, 2]


def test_without_a_gpu_it_trains_on_hf_jobs_and_brings_the_run_back(workshop, fakes, checkout):
    workshop.post("/api/workshop/train", json=LAUNCH)
    body = wait_for(lambda: _finished(workshop))
    assert body["mode"] == "hf-jobs" and body["state"] == "finished"
    assert body["ckpt_repo"] == "alice/mjlab-sprint2m-microduck-first" and body["job_id"] == "fakejob42"
    (train,) = fakes.calls("train")
    assert train[-6:] == ["--hf-jobs", "--no-wandb", "--namespace", "alice", "--ckpt-repo",
                          "alice/mjlab-sprint2m-microduck-first"]
    assert ["run", "--no-sync", "hf", "download", "alice/mjlab-sprint2m-microduck-first",
            "--local-dir", "logs/rsl_rl", "--quiet"] in fakes.calls("hf")
    assert [r["name"] for r in workshop.get("/api/workshop/runs").json()["runs"]] == ["first"]
    assert any("fetched the checkpoints" in line for line in body["log"])


def test_an_hf_run_appears_only_once_pulled(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: any("[job] id:" in l for l in workshop.get("/api/workshop/train?since=0").json()["log"]))
    assert workshop.get("/api/workshop/runs").json()["runs"] == []
    assert workshop.post("/api/workshop/train/pull").status_code == 200
    (run,) = workshop.get("/api/workshop/runs").json()["runs"]
    assert run["checkpoints"] == [0, 1]
    workshop.post("/api/workshop/train/stop")


def test_hf_jobs_needs_a_hugging_face_login_and_nothing_is_touched_without_one(workshop, hub, checkout, fakes):
    hub.user = None
    response = workshop.post("/api/workshop/train", json=LAUNCH)
    assert response.status_code == 400 and "log" in response.json()["detail"].lower()
    assert (checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml").read_text() == SPRINT
    assert fakes.calls("train") == []


def test_a_second_launch_while_one_runs_is_refused(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    again = workshop.post("/api/workshop/train", json=LAUNCH | {"name": "second"})
    assert again.status_code == 409
    workshop.post("/api/workshop/train/stop")


def test_a_run_name_already_on_disk_is_refused(workshop, fakes, checkout):
    fakes.gpu()
    make_run(checkout, "first")
    assert workshop.post("/api/workshop/train", json=LAUNCH).status_code == 409


@pytest.mark.parametrize("name", ["", "First", "a b", "x" * 41, "-lead"])
def test_a_run_name_must_be_a_plain_slug(workshop, fakes, name):
    fakes.gpu()
    assert workshop.post("/api/workshop/train", json=LAUNCH | {"name": name}).status_code == 400


def test_a_knob_out_of_range_is_refused_and_nothing_is_written(workshop, fakes, checkout):
    fakes.gpu()
    response = workshop.post("/api/workshop/train", json=LAUNCH | {"params": {"forward_reward": 50.0}})
    assert response.status_code == 400 and "between" in response.json()["detail"]
    assert (checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml").read_text() == SPRINT


def test_stop_ends_a_local_training(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    assert workshop.post("/api/workshop/train/stop").status_code == 200
    assert wait_for(lambda: _finished(workshop))["state"] == "stopped"


def test_stop_cancels_the_hf_job_it_follows(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: workshop.get("/api/workshop/train?since=0").json()["job_id"])
    workshop.post("/api/workshop/train/stop")
    assert hub.cancelled == [("fakejob42", "alice")]
    assert wait_for(lambda: _finished(workshop))["state"] == "stopped"


def test_a_failed_training_says_so_with_its_code(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_RC", "3")
    workshop.post("/api/workshop/train", json=LAUNCH)
    body = wait_for(lambda: _finished(workshop))
    assert (body["state"], body["returncode"]) == ("failed", 3)


def test_the_log_is_read_from_an_offset(workshop, fakes):
    fakes.gpu()
    workshop.post("/api/workshop/train", json=LAUNCH)
    whole = wait_for(lambda: _finished(workshop))
    assert whole["log"][0].startswith("$ uv run --no-sync train")
    tail = workshop.get(f"/api/workshop/train?since={whole['next'] - 1}").json()
    assert tail["log"] == whole["log"][-1:]


def test_nothing_launched_yet(workshop):
    assert workshop.get("/api/workshop/train?since=0").json() == {"state": None}
    assert workshop.post("/api/workshop/train/stop").status_code == 409
```

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop/test_training.py -q
```

Expected: FAIL — 404/405 on `/api/workshop/train`.

- [ ] **Step 3: One training, followed**

```python
# arena/workshop/training.py
"""One training at a time, as `uv run --no-sync train …` in the checkout.

With an NVIDIA GPU the process IS the training. Without one it is `train …
--hf-jobs`, which submits the job and streams its log until the job ends. The
job's uploader pushes the run to a Hub repo that mirrors logs/rsl_rl/; this
pulls that repo back into logs/rsl_rl/ every few minutes and once more at the
end, so Test and Publish find an HF run exactly where they find a local one.
"""

import os
import re
import shlex
import signal
import subprocess
import threading

from .runs import LOGS
from .shell import child_env, uv

PULL_EVERY_S = 120.0
_JOB_ID = re.compile(r"^\[job\] id:\s+(\S+)")


def ckpt_repo(user: str, challenge, name: str) -> str:
    return f"{user}/{challenge.task.lower()}-{name}"


def train_command(challenge, name: str, recipe: dict[str, int], hf_user: str | None) -> list[str]:
    """`hf_user` is the Hugging Face account the job runs (and is billed) under; None trains here."""
    command = uv(
        "train", challenge.task,
        "--env.scene.num-envs", str(recipe["num_envs"]),
        "--agent.max-iterations", str(recipe["max_iterations"]),
        "--agent.seed", str(recipe["seed"]),
        "--agent.logger", "tensorboard",
        "--agent.run-name", name,
    )
    if hf_user:
        command += ["--hf-jobs", "--no-wandb", "--namespace", hf_user,
                    "--ckpt-repo", ckpt_repo(hf_user, challenge, name)]
    return command


class Training:
    def __init__(self, root, name: str, command: list[str], ckpt_repo: str | None = None, namespace: str | None = None):
        self.root, self.name, self.ckpt_repo, self.namespace = root, name, ckpt_repo, namespace
        self.returncode: int | None = None
        self._lines = [f"$ {shlex.join(command)}"]
        self._lock = threading.Lock()
        self._pulling = threading.Lock()
        self._ended = threading.Event()
        self._stopped = False
        self.proc = subprocess.Popen(
            command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=child_env(), start_new_session=True,
        )
        threading.Thread(target=self._follow, daemon=True).start()
        if ckpt_repo:
            threading.Thread(target=self._pull_while_running, daemon=True).start()

    def _say(self, line: str) -> None:
        with self._lock:
            self._lines.append(line)

    def _follow(self) -> None:
        for line in self.proc.stdout:
            self._say(line.rstrip("\n"))
        code = self.proc.wait()
        self._ended.set()
        if self.ckpt_repo:
            self.pull()  # whatever the job saved last
        self.returncode = code  # read by `state`: set last, after the final pull

    def _pull_while_running(self) -> None:
        while not self._ended.wait(PULL_EVERY_S):
            self.pull()

    def pull(self) -> bool:
        with self._pulling:  # the periodic pull and a button press never overlap
            done = subprocess.run(
                uv("hf", "download", self.ckpt_repo, "--local-dir", str(LOGS), "--quiet"),
                cwd=self.root, capture_output=True, text=True, env=child_env(),
            )
        if done.returncode == 0:
            self._say(f"[workshop] fetched the checkpoints from {self.ckpt_repo}")
        else:
            self._say(f"[workshop] could not fetch {self.ckpt_repo}:")
            for line in (done.stdout + done.stderr).splitlines():
                self._say(line)
        return done.returncode == 0

    @property
    def job_id(self) -> str | None:
        with self._lock:
            return next((m.group(1) for line in self._lines if (m := _JOB_ID.match(line))), None)

    @property
    def state(self) -> str:
        if self.returncode is None:
            return "running"
        if self._stopped:
            return "stopped"
        return "finished" if self.returncode == 0 else "failed"

    def stop(self, hub) -> None:
        """Killing `train --hf-jobs` would only detach from the job, so an HF job is cancelled first."""
        if self.ckpt_repo and (job := self.job_id):
            hub.cancel_job(job, self.namespace)
            self._say(f"[workshop] cancelled job {job}")
        self._stopped = True
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    def snapshot(self, since: int = 0) -> dict:
        with self._lock:
            lines, total = self._lines[max(since, 0):], len(self._lines)
        return {
            "name": self.name, "mode": "hf-jobs" if self.ckpt_repo else "local", "state": self.state,
            "returncode": self.returncode, "ckpt_repo": self.ckpt_repo, "job_id": self.job_id,
            "log": lines, "next": total,
        }
```

- [ ] **Step 4: The routes**

In `arena/workshop/app.py` add (imports: `re`, `from fastapi.concurrency import run_in_threadpool`, `from .challenges import RECIPE, ChallengeError, read_challenge, write_values`, `from .runs import curve, find_run, find_runs`, `from .shell import ShellError, commit_all`, `from .training import Training, ckpt_repo, train_command`):

```python
RUN_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


class Launch(BaseModel):
    name: str
    recipe: dict[str, int]
    params: dict[str, float] = {}


def _running(ws: Workshop) -> bool:
    return ws.training is not None and ws.training.state == "running"


@router.post("/train")
def launch(body: Launch, request: Request) -> dict:
    ws = _workshop(request)
    if _running(ws):
        raise HTTPException(status_code=409, detail="A training is already running: stop it first.")
    if not RUN_NAME.match(body.name):
        raise HTTPException(status_code=400, detail="A run name is lowercase letters, digits and dashes, up to 40.")
    taken = {r.name for r in find_runs(ws.root, ws.challenge.task)} | ({ws.training.name} if ws.training else set())
    if body.name in taken:
        raise HTTPException(status_code=409, detail=f"There is already a run called {body.name}.")
    if set(body.recipe) != set(RECIPE):
        raise HTTPException(status_code=400, detail=f"The recipe is {', '.join(RECIPE)}, all three.")
    tools = preflight(ws.root, ws.hub)
    hf_user = None if tools["gpu"] else tools["user"]
    if not tools["gpu"] and not hf_user:
        raise HTTPException(
            status_code=400,
            detail="Without an NVIDIA GPU, training runs on Hugging Face Jobs: log in to Hugging Face first.",
        )
    try:
        write_values(ws.challenge, body.recipe, body.params)
        # Every run starts from a commit, so the recipe a policy is published with is what trained it.
        commit_all(ws.root, f"{ws.challenge.event}: run {body.name}")
    except ChallengeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ws.challenge = read_challenge(ws.challenge.toml)
    ws.training = Training(
        ws.root, body.name, train_command(ws.challenge, body.name, body.recipe, hf_user),
        ckpt_repo=ckpt_repo(hf_user, ws.challenge, body.name) if hf_user else None, namespace=hf_user,
    )
    return ws.training.snapshot()


@router.get("/train")
def follow_training(request: Request, since: int = 0) -> dict:
    ws = _workshop(request)
    return ws.training.snapshot(since) if ws.training else {"state": None}


@router.post("/train/stop")
def stop(request: Request) -> dict:
    ws = _workshop(request)
    if not _running(ws):
        raise HTTPException(status_code=409, detail="No training is running.")
    try:
        ws.training.stop(ws.hub)
    except Exception as exc:  # noqa: BLE001
        # The job was NOT cancelled and is still billed: say so, keep following it.
        raise HTTPException(status_code=502, detail=f"Could not cancel the Hugging Face job: {exc}") from exc
    return ws.training.snapshot()


@router.post("/train/pull")
async def pull(request: Request) -> dict:
    ws = _workshop(request)
    if ws.training is None or not ws.training.ckpt_repo:
        raise HTTPException(status_code=409, detail="Only a Hugging Face Jobs run has checkpoints to fetch.")
    await run_in_threadpool(ws.training.pull)
    return ws.training.snapshot()


def _run_summary(run) -> dict:
    return {
        "id": run.id, "name": run.name, "started": run.provenance.get("started"),
        "dirty": bool(run.provenance.get("dirty")), "checkpoints": list(run.checkpoints),
    }


@router.get("/runs")
def runs(request: Request) -> dict:
    ws = _workshop(request)
    return {"runs": [_run_summary(r) for r in find_runs(ws.root, ws.challenge.task)]}


def _run_or_404(ws: Workshop, run_id: str):
    run = find_run(ws.root, ws.challenge.task, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id} in logs/rsl_rl/.")
    return run


@router.get("/runs/{run_id}/curve")
def run_curve(run_id: str, request: Request) -> dict:
    return {"points": curve(_run_or_404(_workshop(request), run_id))}
```

- [ ] **Step 5: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop -q
```

Expected: all pass (the HF tests take a few seconds: every fake call is a Python start-up).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add arena/workshop/training.py arena/workshop/app.py tests/workshop/test_training.py
/usr/bin/git commit -m "Workshop: launch a training from the recipe, follow it, stop it, and pull an HF Jobs run back"
```

---

### Task 12: Test — export a checkpoint and race it with the Arena's evaluator

**Files:**
- Create: `arena/workshop/trials.py`
- Modify: `arena/workshop/app.py` (`POST /api/workshop/runs/{id}/trial`; `trials` in the runs listing)
- Test: `tests/workshop/test_trials.py`

**Interfaces:**
- Consumes: `Run`, `find_run` (Task 9); `uv_run` (Task 10); `arena.evaluate.evaluate`, `arena.policy.load_policy`, `PolicyError`, `arena.constants.RUNNER_VERSION`.
- Produces:
  - `trials.trial(root, run, checkpoint: int, event_id: str) -> dict` — `{checkpoint, score, command_vx, seeds_finished, seeds_total, per_seed: [{seed, status, time_s}], trace_seed, trace_b64, runner_version}`; cached in `<run>/workshop/model_<N>.json` (with the ONNX next to it) per `RUNNER_VERSION`; raises `TrialError` carrying the export's whole output.
  - `trials.tested(run) -> dict[int, dict]` — the cached results without their traces.
  - `POST /api/workshop/runs/{id}/trial {checkpoint}` → the dict above; the runs listing gains `trials: {"<N>": {score, seeds_finished, seeds_total, command_vx}}`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/workshop/test_trials.py
"""Test: the checkpoint is exported exactly as `publish` would, then raced by the Arena's own evaluator."""

import json

from arena.constants import TRACE_WIDTH
from tests.workshop.conftest import make_run


def _trial(workshop, run, checkpoint=1):
    return workshop.post(f"/api/workshop/runs/{run.name}/trial", json={"checkpoint": checkpoint})


def test_a_checkpoint_is_exported_by_a_dry_run_publish_and_raced(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    response = _trial(workshop, run)
    assert response.status_code == 200, response.text
    body = response.json()
    # The fake export hands over the Arena's reference walker, which finishes the sprint.
    assert (body["seeds_total"], body["seeds_finished"]) == (5, 5)
    assert body["checkpoint"] == 1 and body["score"] < 50
    import base64

    assert len(base64.b64decode(body["trace_b64"])) % (4 * TRACE_WIDTH) == 0
    (publish,) = fakes.calls("publish")
    assert publish[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert "--dry-run" in publish and "--allow-dirty" in publish
    assert not (checkout / "publish-workshop-trial").exists()
    assert (run / "workshop" / "model_1.onnx").is_file()


def test_the_same_checkpoint_comes_from_the_cache_the_second_time(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    first = _trial(workshop, run).json()
    assert _trial(workshop, run).json() == first
    assert len(fakes.calls("publish")) == 1


def test_a_result_from_another_runner_version_is_measured_again(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    _trial(workshop, run)
    cache = run / "workshop" / "model_1.json"
    cache.write_text(json.dumps(json.loads(cache.read_text()) | {"runner_version": -1}))
    _trial(workshop, run)
    assert len(fakes.calls("publish")) == 2


def test_a_failed_export_shows_its_whole_output(workshop, fakes, checkout, monkeypatch):
    run = make_run(checkout, "first")
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    response = _trial(workshop, run)
    assert response.status_code == 400 and "publish: boom" in response.json()["detail"]


def test_an_unknown_checkpoint_or_run_is_refused(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    assert _trial(workshop, run, checkpoint=7).status_code == 400
    assert workshop.post("/api/workshop/runs/nope/trial", json={"checkpoint": 1}).status_code == 404


def test_a_dirty_run_can_still_be_tested(workshop, fakes, checkout):
    run = make_run(checkout, "first", dirty=True)
    assert _trial(workshop, run).status_code == 200


def test_the_runs_listing_shows_what_was_tested(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    score = _trial(workshop, run).json()["score"]
    (listed,) = workshop.get("/api/workshop/runs").json()["runs"]
    assert set(listed["trials"]) == {"1"}
    assert listed["trials"]["1"]["score"] == score and listed["trials"]["1"]["seeds_finished"] == 5
    assert "trace_b64" not in listed["trials"]["1"]
```

(In `_trial`, the run's id is its directory name: use `run.name` of the `Path` returned by `make_run`, which is `<stamp>_first`.)

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop/test_trials.py -q
```

Expected: FAIL — 404 on `/trial`.

- [ ] **Step 3: The trial**

```python
# arena/workshop/trials.py
"""Test a checkpoint: export it as `publish` would, then race it with the Arena's own evaluator.

`publish --run … --dry-run` is the exporter: it bakes the observation normaliser
in and checks the 61 → 14 shape exactly as the real publish will. `--allow-dirty`
because a trial publishes nothing. `arena.evaluate` is the code the Space runs,
on this machine's MuJoCo: the score is indicative — only the Space times an
entry, and replays drift apart between machines after a few seconds.

Results are cached next to the checkpoint, per Arena runner version.
"""

import base64
import json
import shutil
import threading

from ..constants import RUNNER_VERSION
from ..evaluate import evaluate
from ..manifest import load_event
from ..policy import load_policy
from .shell import uv_run

NAME = "workshop-trial"
# The dry run always writes ./publish-workshop-trial/: one export at a time.
_EXPORTING = threading.Lock()


class TrialError(RuntimeError):
    """The export failed; the message is its whole output."""


def _cache(run, checkpoint: int):
    return run.path / "workshop" / f"model_{checkpoint}.json"


def _cached(run, checkpoint: int) -> dict | None:
    path = _cache(run, checkpoint)
    if not path.is_file():
        return None
    body = json.loads(path.read_text())
    return body if body.get("runner_version") == RUNNER_VERSION else None


def tested(run) -> dict[int, dict]:
    """The checkpoints of `run` already tested on this runner version, without their traces."""
    keep = ("score", "seeds_finished", "seeds_total", "command_vx")
    return {n: {k: body[k] for k in keep} for n in run.checkpoints if (body := _cached(run, n))}


def trial(root, run, checkpoint: int, event_id: str) -> dict:
    if checkpoint not in run.checkpoints:
        raise TrialError(f"{run.id} has no model_{checkpoint}.pt")
    if (found := _cached(run, checkpoint)) is not None:
        return found
    onnx = _cache(run, checkpoint).with_suffix(".onnx")
    with _EXPORTING:
        done = uv_run(
            root, "publish", "--run", str(run.path), "--checkpoint", str(checkpoint),
            "--repo", f"local/microduck-{NAME}", "--name", NAME, "--dry-run", "--allow-dirty",
        )
        if done.returncode != 0:
            raise TrialError(done.stdout + done.stderr)
        out = root / f"publish-{NAME}"
        onnx.parent.mkdir(exist_ok=True)
        shutil.move(out / "policy.onnx", onnx)
        shutil.rmtree(out)
    result = evaluate(load_event(event_id), load_policy(onnx))
    body = {
        "checkpoint": checkpoint,
        "score": result.score,
        "command_vx": result.command_vx,
        "seeds_finished": result.seeds_finished,
        "seeds_total": len(result.per_seed),
        "per_seed": [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed],
        "trace_seed": result.trace_seed,
        "trace_b64": base64.b64encode(result.trace.astype("<f4").tobytes()).decode("ascii"),
        "runner_version": result.runner_version,
    }
    _cache(run, checkpoint).write_text(json.dumps(body))
    return body
```

- [ ] **Step 4: The route**

In `arena/workshop/app.py` (imports `from ..policy import PolicyError`, `from .trials import TrialError, tested, trial`):

```python
class TrialRequest(BaseModel):
    checkpoint: int


@router.post("/runs/{run_id}/trial")
async def run_trial(run_id: str, body: TrialRequest, request: Request) -> dict:
    ws = _workshop(request)
    run = _run_or_404(ws, run_id)
    try:
        # Seconds of export and simulation: off the event loop, which keeps the log flowing.
        return await run_in_threadpool(trial, ws.root, run, body.checkpoint, ws.challenge.event)
    except (TrialError, PolicyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

and `_run_summary` gains `"trials": {str(n): r for n, r in tested(run).items()},`.

- [ ] **Step 5: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add arena/workshop/trials.py arena/workshop/app.py tests/workshop/test_trials.py
/usr/bin/git commit -m "Workshop: test a checkpoint with a dry-run export and the Arena's own evaluator"
```

---

### Task 13: Your code, and Publish

**Files:**
- Create: `arena/workshop/code.py`, `arena/workshop/publishing.py`
- Modify: `arena/workshop/app.py` (routes `code`, `code/fork`, `code/push`, `publish`)
- Test: `tests/workshop/test_code.py`, `tests/workshop/test_publishing.py`

**Interfaces:**
- Consumes: `git`, `commit_all`, `gh_ready`, `uv_run`, `ShellError` (Task 10); `find_run` (Task 9); `Manifest.sweep`, `Manifest.title`.
- Produces:
  - `code.github_repo(url) -> (owner, name) | None`; `code.code_state(root) -> {state: "not-shared"|"changes"|"shared", origin, fork, changes, unpushed, commit, gh, fork_page}`; `code.fork(root, url: str | None, message) -> str`; `code.push(root, message) -> str`; `code.code_url(root, commit) -> str | None`.
  - `publishing.SPEED_TWIST`; `publishing.slug(text)`; `publishing.repo_for(user, name) -> "<user>/microduck-<slug>"`; `publishing.publish_args(run, checkpoint, repo, name, description, event, allow_dirty) -> list[str]`; `publishing.preview(...) -> {readme, manifest, output}`; `publishing.publish(...) -> {repo, revision, output}`; `publishing.arena_link(arena, event_id, repo, revision, env) -> str`; `PublishError`.
  - Routes: `GET /api/workshop/code`; `POST /api/workshop/code/fork {url?}`; `POST /api/workshop/code/push` — each returns `code_state` plus `output`; 400 with git's/gh's output on failure. `POST /api/workshop/publish {run, checkpoint, name, description, allow_dirty, dry_run}` → dry run: `{repo, readme, manifest, output}`; real: `{repo, revision, output, env, arena_url}` and the Arena opened in the browser.

- [ ] **Step 1: Write the failing tests**

```python
# tests/workshop/test_code.py
"""Your code: where the checkout stands, and the one button that shares it."""

import pytest

from tests.workshop.conftest import git


def _state(workshop):
    return workshop.get("/api/workshop/code").json()


def test_a_fresh_clone_is_not_shared_yet(workshop):
    body = _state(workshop)
    assert body["state"] == "not-shared" and body["fork"] is None
    assert body["fork_page"] == "https://github.com/pollen-robotics/microduck-challenges/fork"


def test_gh_forks_pushes_and_the_code_is_then_shared(workshop, checkout, remotes):
    response = workshop.post("/api/workshop/code/fork", json={})
    assert response.status_code == 200, response.text
    assert git(checkout, "config", "--get", "remote.origin.url") == "https://github.com/alice/microduck-challenges"
    assert git(checkout, "config", "--get", "remote.upstream.url") == "https://github.com/pollen-robotics/microduck-challenges"
    fork = remotes / "alice" / "microduck-challenges"
    assert git(fork, "rev-parse", "main") == git(checkout, "rev-parse", "HEAD")
    assert response.json()["state"] == "shared" and response.json()["fork"] == "alice/microduck-challenges"


def test_without_gh_the_fork_made_on_github_becomes_origin(workshop, checkout, remotes, monkeypatch):
    monkeypatch.setenv("FAKE_GH_LOGGED_OUT", "1")
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    assert workshop.post("/api/workshop/code/fork", json={}).status_code == 400  # gh cannot do it
    response = workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "shared"


def test_an_address_that_is_not_github_is_refused(workshop, monkeypatch):
    monkeypatch.setenv("FAKE_GH_LOGGED_OUT", "1")
    response = workshop.post("/api/workshop/code/fork", json={"url": "https://evil.example/alice/x"})
    assert response.status_code == 400


def test_changes_not_online_are_counted_then_pushed(workshop, checkout):
    workshop.post("/api/workshop/code/fork", json={})
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    body = _state(workshop)
    assert body["state"] == "changes" and body["changes"] == 1
    pushed = workshop.post("/api/workshop/code/push").json()
    assert pushed["state"] == "shared"
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m: my changes"


def test_the_code_link_names_the_commit_once_it_is_on_the_fork(workshop, checkout):
    from arena.workshop.code import code_url

    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    assert code_url(checkout, commit) is None
    workshop.post("/api/workshop/code/fork", json={})
    assert code_url(checkout, commit) == f"https://github.com/alice/microduck-challenges/tree/{commit}"


@pytest.mark.parametrize(
    "url,repo",
    [
        ("https://github.com/alice/microduck-challenges", ("alice", "microduck-challenges")),
        ("https://github.com/alice/microduck-challenges.git", ("alice", "microduck-challenges")),
        ("git@github.com:alice/microduck-challenges.git", ("alice", "microduck-challenges")),
        ("https://gitlab.com/alice/x", None),
        (None, None),
    ],
)
def test_github_addresses_are_read_in_both_forms(url, repo):
    from arena.workshop.code import github_repo

    assert github_repo(url) == repo
```

```python
# tests/workshop/test_publishing.py
"""Publish: `uv run publish` does the work; the workshop previews, publishes, and sends the user back to the Arena."""

from urllib.parse import parse_qs, urlsplit

from arena.manifest import load_event
from arena.workshop.publishing import SPEED_TWIST, publish_args, slug
from tests.workshop.conftest import git, make_run

AAA = "a" * 40


def _publish(workshop, run, **fields):
    body = {"run": run.name, "checkpoint": 1, "name": "My Walker!", "description": "", **fields}
    return workshop.post("/api/workshop/publish", json=body)


def test_the_preview_is_a_dry_run_showing_the_hub_card(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run, dry_run=True).json()
    assert body["repo"] == "alice/microduck-my-walker"
    assert body["readme"] == "# my-walker\n" and body["manifest"]["kind"] == "perpetual"
    (call,) = fakes.calls("publish")
    assert "--dry-run" in call and "--no-private" not in call
    assert not (checkout / "publish-my-walker").exists()


def test_publishing_is_public_pins_the_commit_and_opens_the_arena(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run).json()
    (call,) = fakes.calls("publish")
    assert call[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert {"--no-private", "--force"} <= set(call)
    assert call[call.index("--repo") + 1] == "alice/microduck-my-walker"
    assert call[call.index("--description") + 1] == "2 m Sprint"
    assert call[call.index("--twist-help") + 1] == SPEED_TWIST
    assert body["revision"] == AAA and body["env"] is None
    link = urlsplit(body["arena_url"])
    assert (link.scheme, link.netloc, link.fragment) == ("http", "arena.test", "/e/sprint-2m")
    assert parse_qs(link.query) == {"repo": ["alice/microduck-my-walker"], "revision": [AAA]}
    assert workshop.opened == [body["arena_url"]]


def test_the_arena_link_carries_the_code_once_it_is_shared(workshop, fakes, checkout):
    workshop.post("/api/workshop/code/fork", json={})
    run = make_run(checkout, "first")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    body = _publish(workshop, run).json()
    assert body["env"] == f"https://github.com/alice/microduck-challenges/tree/{commit}"
    assert parse_qs(urlsplit(body["arena_url"]).query)["env"] == [body["env"]]


def test_a_dirty_run_is_refused_unless_published_anyway(workshop, fakes, checkout):
    run = make_run(checkout, "first", dirty=True)
    refused = _publish(workshop, run)
    assert refused.status_code == 400 and "uncommitted" in refused.json()["detail"]
    assert fakes.calls("publish") == []
    assert _publish(workshop, run, allow_dirty=True).status_code == 200
    assert "--allow-dirty" in fakes.calls("publish")[0]


def test_publishing_needs_a_hugging_face_login(workshop, fakes, checkout, hub):
    hub.user = None
    assert _publish(workshop, make_run(checkout, "first")).status_code == 400


def test_a_failed_publish_shows_its_whole_output(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400 and "publish: boom" in response.json()["detail"]
    assert workshop.opened == []


def test_no_speed_order_for_an_event_that_does_not_sweep(checkout):
    from arena.workshop.runs import find_runs

    make_run(checkout, "first")
    (run,) = find_runs(checkout, "Mjlab-Sprint2m-MicroDuck")
    swag = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("swag-contest"), False)
    assert "--twist-help" not in swag
    sprint = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("sprint-2m"), False)
    assert "--twist-help" in sprint


def test_slugs_are_what_a_hub_repo_name_accepts():
    assert slug("My Walker!") == "my-walker"
    assert slug("  ") == "policy"
```

- [ ] **Step 2: Run them to see them fail**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop/test_code.py tests/workshop/test_publishing.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'arena.workshop.code'`.

- [ ] **Step 3: Your code**

```python
# arena/workshop/code.py
"""Where the user's code stands, and the one button that shares it.

The recipe a policy is published with names a commit; it is worth something
only if that commit is somewhere people can open it. So the Publish zone says
whether the code is not shared yet (origin is still Pollen's repo), has changes
not online yet, or is shared — and offers the step that fixes it. A nudge,
never a gate: a policy can be published without a code link.
"""

import re
import subprocess
from pathlib import Path

from .shell import ShellError, commit_all, gh_ready, git

UPSTREAM_OWNER = "pollen-robotics"
FORK_PAGE = "https://github.com/pollen-robotics/microduck-challenges/fork"
_GITHUB = re.compile(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")


def github_repo(url: str | None) -> tuple[str, str] | None:
    found = _GITHUB.match(url or "")
    return (found.group(1), found.group(2)) if found else None


def _remote(root: Path, name: str) -> str | None:
    # config, not `git remote get-url`: the address as the user set it, before any url.insteadOf.
    return git(root, "config", "--get", f"remote.{name}.url", check=False) or None


def _fork(root: Path) -> tuple[str, str] | None:
    repo = github_repo(_remote(root, "origin"))
    return repo if repo and repo[0] != UPSTREAM_OWNER else None


def code_state(root: Path) -> dict:
    fork = _fork(root)
    changes = len(git(root, "status", "--porcelain").splitlines())
    unpushed = int(git(root, "rev-list", "--count", "HEAD", "--not", "--remotes=origin", check=False) or 0)
    state = "not-shared" if fork is None else ("changes" if changes or unpushed else "shared")
    return {
        "state": state,
        "origin": _remote(root, "origin"),
        "fork": "/".join(fork) if fork else None,
        "changes": changes,
        "unpushed": unpushed,
        "commit": git(root, "rev-parse", "--short=9", "HEAD"),
        "gh": gh_ready(root),
        "fork_page": FORK_PAGE,
    }


def push(root: Path, message: str) -> str:
    commit_all(root, message)
    return git(root, "push", "-u", "origin", "HEAD")


def fork(root: Path, url: str | None, message: str) -> str:
    """Make origin the user's fork, then push. With gh logged in, gh makes the fork; otherwise
    `url` is the fork the user made on GitHub's page."""
    if url is None:
        if not gh_ready(root):
            raise ShellError("The GitHub CLI is not logged in: make your fork on GitHub's page, then paste its address.")
        done = subprocess.run(["gh", "repo", "fork", "--remote"], cwd=root, capture_output=True, text=True)
        if done.returncode != 0:
            raise ShellError(f"$ gh repo fork --remote\n{done.stdout}{done.stderr}")
    else:
        if github_repo(url.strip()) is None:
            raise ShellError(f"{url} is not a GitHub repository address (https://github.com/<you>/<name>).")
        git(root, "remote", "rename", "origin", "upstream")
        git(root, "remote", "add", "origin", url.strip())
    return push(root, message)


def code_url(root: Path, commit: str | None) -> str | None:
    """https://github.com/<fork>/tree/<commit>, once that commit is on the user's fork."""
    fork = _fork(root)
    if not commit or fork is None:
        return None
    holders = git(root, "branch", "-r", "--contains", commit, check=False).splitlines()
    if not any(line.strip().startswith("origin/") for line in holders):
        return None
    return f"https://github.com/{fork[0]}/{fork[1]}/tree/{commit}"
```

- [ ] **Step 4: Publishing**

```python
# arena/workshop/publishing.py
"""Publish a run's checkpoint with `uv run publish`, then send the user to the Arena to enter it.

The workshop writes no manifest and uploads nothing itself: `publish --run`
does, exactly as from a shell. It runs twice — `--dry-run` for the preview of
the Hub card, then for real — and the real one prints the commit it made,
which is the revision the Arena pins.
"""

import json
import re
import shutil
from urllib.parse import urlencode

from ..manifest import load_event
from .shell import uv_run

# The Arena drives the policy's twist with a forward speed it sweeps across a
# range: for such an event the manifest says what the three numbers are.
SPEED_TWIST = "[vx, vy, wz]: forward and sideways speed in m/s, turn rate in rad/s"
_UNSAFE = re.compile(r"[^a-z0-9]+")
_COMMIT = re.compile(r"/commit/([0-9a-f]{7,40})")


class PublishError(RuntimeError):
    """`publish` failed; the message is its whole output."""


def slug(text: str) -> str:
    return _UNSAFE.sub("-", text.lower()).strip("-")[:60].strip("-") or "policy"


def repo_for(user: str, name: str) -> str:
    return f"{user}/microduck-{slug(name)}"


def publish_args(run, checkpoint: int, repo: str, name: str, description: str, event, allow_dirty: bool) -> list[str]:
    args = ["publish", "--run", str(run.path), "--checkpoint", str(checkpoint), "--repo", repo,
            "--name", slug(name), "--description", description]
    if event.sweep.lo < event.sweep.hi:
        args += ["--twist-help", SPEED_TWIST]
    if allow_dirty:
        args.append("--allow-dirty")
    return args


def _run(root, args: list[str]) -> str:
    done = uv_run(root, *args)
    output = done.stdout + done.stderr
    if done.returncode != 0:
        raise PublishError(output)
    return output


def preview(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    output = _run(root, [*args, "--dry-run"])
    out = root / f"publish-{slug(name)}"
    try:
        return {"readme": (out / "README.md").read_text(),
                "manifest": json.loads((out / "manifest.json").read_text()), "output": output}
    finally:
        shutil.rmtree(out, ignore_errors=True)


def publish(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict:
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    # Public, or the Arena cannot read it; --force because publishing a name again is a new
    # commit on the same repo, and the Arena pins the commit it raced.
    output = _run(root, [*args, "--no-private", "--force"])
    found = _COMMIT.search(output)
    if not found:
        raise PublishError(output + "\n[workshop] publish printed no commit for the Arena to pin")
    return {"repo": repo, "revision": found.group(1), "output": output}


def arena_link(arena: str, event_id: str, repo: str, revision: str, env: str | None) -> str:
    query = {"repo": repo, "revision": revision} | ({"env": env} if env else {})
    # The site routes on the hash, so the query goes before it.
    return f"{arena}/?{urlencode(query)}#/e/{event_id}"
```

- [ ] **Step 5: The routes**

In `arena/workshop/app.py` (imports `from .code import code_state, code_url, fork, push`, `from .publishing import PublishError, arena_link, preview, publish, repo_for`):

```python
class ForkRequest(BaseModel):
    url: str | None = None


def _code(ws: Workshop, output: str = "") -> dict:
    return {**code_state(ws.root), "output": output}


@router.get("/code")
def code(request: Request) -> dict:
    return _code(_workshop(request))


@router.post("/code/fork")
def code_fork(body: ForkRequest, request: Request) -> dict:
    ws = _workshop(request)
    try:
        return _code(ws, fork(ws.root, body.url, f"{ws.challenge.event}: my changes"))
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/code/push")
def code_push(request: Request) -> dict:
    ws = _workshop(request)
    try:
        return _code(ws, push(ws.root, f"{ws.challenge.event}: my changes"))
    except ShellError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class PublishRequest(BaseModel):
    run: str
    checkpoint: int
    name: str
    description: str = ""
    allow_dirty: bool = False
    dry_run: bool = False


@router.post("/publish")
async def publish_route(body: PublishRequest, request: Request) -> dict:
    ws = _workshop(request)
    run = _run_or_404(ws, body.run)
    if body.checkpoint not in run.checkpoints:
        raise HTTPException(status_code=400, detail=f"{run.id} has no model_{body.checkpoint}.pt")
    if run.provenance.get("dirty") and not body.allow_dirty:
        raise HTTPException(
            status_code=400,
            detail="This run started from uncommitted changes, so the code it records is not what "
                   "trained it. Train again from the workshop (it commits first), or publish anyway.",
        )
    user = ws.hub.whoami()
    if not user:
        raise HTTPException(status_code=400, detail="Log in to Hugging Face first (Preflight).")
    event = load_event(ws.challenge.event)
    repo = repo_for(user, body.name)
    args = (ws.root, run, body.checkpoint, repo, body.name, body.description.strip() or event.title,
            ws.challenge.event, body.allow_dirty)
    try:
        if body.dry_run:
            return {"repo": repo, **await run_in_threadpool(preview, *args)}
        published = await run_in_threadpool(publish, *args)
    except PublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    env = code_url(ws.root, run.provenance.get("commit"))
    link = arena_link(ws.arena, ws.challenge.event, repo, published["revision"], env)
    ws.open_browser(link)  # the Arena's page, pre-filled: the user clicks Publish there
    return {**published, "env": env, "arena_url": link}
```

- [ ] **Step 6: Run the tests**

```bash
uv run --no-config --frozen --extra dev pytest tests/workshop -q
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add arena/workshop/code.py arena/workshop/publishing.py arena/workshop/app.py tests/workshop/test_code.py tests/workshop/test_publishing.py
/usr/bin/git commit -m "Workshop: share the code from the page, publish with uv run publish, and open the Arena pre-filled"
```

---

### Task 14: The workshop page — Preflight and Train

**Files:**
- Create: `app/workshop.html`
- Create: `app/src/workshop/api.js`, `app/src/workshop/preflight.js`, `app/src/workshop/train.js`, `app/src/workshop/curve.js`, `app/src/workshop/main.js`
- Create: `app/public/workshop.css`
- Modify: `app/vite.config.js` (a fourth page)
- Test: `app/src/workshop/preflight.test.js`, `app/src/workshop/train.test.js`, `app/src/workshop/curve.test.js`

**Interfaces:**
- Consumes: the routes of Tasks 10–13; `detailFrom` (Task 7); `createViewer`, `deckMarkup`, `wireDeck`, `MIN` from the site.
- Produces: `app/dist/workshop.html` (and so `arena/frontend/workshop.html` in a wheel); `ITEMS`, `canTrain(preflight)`, `renderPreflight(zone, status, {onLogin})`; `runName(now)`, `renderTrainForm(zone, status, {onLaunch})`, `formValues(form, challenge)`, `renderTraining(zone, training, {onStop, onPull})`, `appendLog(pre, lines)`; `curvePath(points, width, height)`, `renderCurve(figure, points)`. Task 15 adds `trial.js` and `publish.js` and fills the last two zones of `main.js`.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/workshop/preflight.test.js
import { describe, expect, it, vi } from "vitest";
import { canTrain, renderPreflight } from "./preflight.js";

const ready = { git: true, identity: true, uv: true, gpu: false, gh: true, user: "alice" };
const status = (preflight) => ({ preflight });

describe("preflight", () => {
  it("shows each missing item with the command that fixes it", () => {
    const zone = document.createElement("section");
    renderPreflight(zone, status({ ...ready, identity: false, user: null }), { onLogin: vi.fn() });
    const missing = [...zone.querySelectorAll(".preflight__missing")].map((li) => li.textContent);
    expect(missing).toHaveLength(2);
    expect(missing.join(" ")).toContain("git config --global user.email");
    expect(missing.join(" ")).toContain("hf auth login");
    expect(zone.querySelector(".preflight__login").hidden).toBe(false);
  });

  it("names the Hugging Face account and hides the token field once logged in", () => {
    const zone = document.createElement("section");
    renderPreflight(zone, status(ready), { onLogin: vi.fn() });
    expect(zone.textContent).toContain("as alice");
    expect(zone.querySelector(".preflight__login").hidden).toBe(true);
  });

  it("says where training runs, and who pays for Hugging Face Jobs", () => {
    const zone = document.createElement("section");
    renderPreflight(zone, status(ready), { onLogin: vi.fn() });
    expect(zone.querySelector(".preflight__where").textContent).toMatch(/Hugging Face Jobs, billed to alice/);
    renderPreflight(zone, status({ ...ready, gpu: true }), { onLogin: vi.fn() });
    expect(zone.querySelector(".preflight__where").textContent).toMatch(/this machine/);
  });

  it("logs in with the pasted token", async () => {
    const zone = document.createElement("section");
    const onLogin = vi.fn(async () => {});
    renderPreflight(zone, status({ ...ready, user: null }), { onLogin });
    zone.querySelector("input[name=token]").value = " hf_x ";
    zone.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onLogin).toHaveBeenCalledWith("hf_x");
  });

  it("can train with a GPU, or without one once logged in, never without git", () => {
    expect(canTrain(ready)).toBe(true);
    expect(canTrain({ ...ready, user: null })).toBe(false);
    expect(canTrain({ ...ready, user: null, gpu: true })).toBe(true);
    expect(canTrain({ ...ready, git: false })).toBe(false);
  });
});
```

```js
// app/src/workshop/train.test.js
import { describe, expect, it, vi } from "vitest";
import { appendLog, formValues, renderTrainForm, renderTraining, runName } from "./train.js";

const status = (preflight = {}) => ({
  preflight: { git: true, identity: true, uv: true, gpu: false, gh: true, user: "alice", ...preflight },
  challenge: {
    event: "sprint-2m",
    recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 },
    knobs: [{ name: "forward_reward", label: "Follow the speed order", value: 2, min: 0.5, max: 5 }],
  },
});

describe("the Train form", () => {
  it("starts from the challenge's recipe and knobs, with a fresh run name", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, status(), { onLaunch: vi.fn() });
    const form = zone.querySelector("form");
    expect(formValues(form, status().challenge)).toEqual({
      name: runName(), recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, params: { forward_reward: 2 },
    });
    expect(zone.textContent).toContain("Follow the speed order");
  });

  it("launches what was edited", async () => {
    const zone = document.createElement("div");
    const onLaunch = vi.fn(async () => {});
    renderTrainForm(zone, status(), { onLaunch });
    const form = zone.querySelector("form");
    form.elements.run.value = "first";
    form.elements.num_envs.value = "512";
    form.elements.forward_reward.value = "3.5";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onLaunch.mock.calls[0][0]).toEqual({
      name: "first", recipe: { num_envs: 512, max_iterations: 3000, seed: 1 }, params: { forward_reward: 3.5 },
    });
  });

  it("cannot launch before the preflight allows it, and says where it would run", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, status({ user: null }), { onLaunch: vi.fn() });
    expect(zone.querySelector("button[type=submit]").disabled).toBe(true);
    renderTrainForm(zone, status(), { onLaunch: vi.fn() });
    expect(zone.textContent).toMatch(/Hugging Face Jobs/);
  });

  it("names a run after the minute it was started", () => {
    expect(runName(new Date(2026, 8, 28, 14, 2))).toBe("run-0928-1402");
  });
});

describe("a training in progress", () => {
  const hf = { name: "first", mode: "hf-jobs", state: "running", ckpt_repo: "alice/x-first", job_id: "j1", log: [], next: 0 };

  it("offers Stop while it runs, and fetching checkpoints for an HF job", () => {
    const zone = document.createElement("div");
    const onStop = vi.fn();
    const onPull = vi.fn();
    renderTraining(zone, hf, { onStop, onPull });
    zone.querySelector(".training__stop").click();
    zone.querySelector(".training__pull").click();
    expect(onStop).toHaveBeenCalled();
    expect(onPull).toHaveBeenCalled();
    expect(zone.textContent).toContain("alice/x-first");
  });

  it("offers neither once it is over, and says how it ended", () => {
    const zone = document.createElement("div");
    renderTraining(zone, { ...hf, mode: "local", state: "failed", returncode: 3 }, { onStop: vi.fn(), onPull: vi.fn() });
    expect(zone.querySelector(".training__stop")).toBeNull();
    expect(zone.querySelector(".training__pull")).toBeNull();
    expect(zone.textContent).toMatch(/failed.*3/);
  });

  it("appends new log lines to what is shown", () => {
    const pre = document.createElement("pre");
    appendLog(pre, ["$ uv run --no-sync train …", "Learning iteration 1/2"]);
    appendLog(pre, ["Learning iteration 2/2"]);
    expect(pre.textContent.split("\n").filter(Boolean)).toHaveLength(3);
  });
});
```

```js
// app/src/workshop/curve.test.js
import { describe, expect, it } from "vitest";
import { curvePath, renderCurve } from "./curve.js";

describe("the reward curve", () => {
  it("spans the box from the first iteration to the last, low reward at the bottom", () => {
    expect(curvePath([[0, -1], [10, 1]], 100, 50)).toBe("M0.0,50.0 L100.0,0.0");
  });

  it("draws nothing from fewer than two points, and no NaN from a flat line", () => {
    expect(curvePath([[1, 0.5]], 100, 50)).toBe("");
    expect(curvePath([[0, 2], [5, 2]], 100, 50)).not.toMatch(/NaN/);
  });

  it("says why there is no curve yet", () => {
    const figure = document.createElement("figure");
    renderCurve(figure, []);
    expect(figure.textContent).toMatch(/No curve yet/);
    renderCurve(figure, [[1, -0.63], [2, -0.52]]);
    expect(figure.textContent).toContain("-0.52 at iteration 2");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd app && npx vitest run src/workshop; cd ..
```

Expected: FAIL — the modules do not exist.

- [ ] **Step 3: The calls**

```js
// app/src/workshop/api.js
// Every call the workshop page makes. Errors carry the server's own sentence —
// for a failed command, its whole output.

import { detailFrom } from "../api.js";

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

const post = (url, body = {}) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const runUrl = (id) => `/api/workshop/runs/${encodeURIComponent(id)}`;

export const getStatus = () => json("/api/workshop/status");
export const login = (token) => post("/api/workshop/login", { token });
export const launch = (body) => post("/api/workshop/train", body);
export const getTraining = (since) => json(`/api/workshop/train?since=${since}`);
export const stopTraining = () => post("/api/workshop/train/stop");
export const pullCheckpoints = () => post("/api/workshop/train/pull");
export const getRuns = () => json("/api/workshop/runs").then((body) => body.runs);
export const getCurve = (id) => json(`${runUrl(id)}/curve`).then((body) => body.points);

/** Export and race one checkpoint; the trace comes back inline, as a trial's does on the Arena. */
export async function testCheckpoint(id, checkpoint) {
  const body = await post(`${runUrl(id)}/trial`, { checkpoint });
  const bytes = Uint8Array.from(atob(body.trace_b64), (c) => c.charCodeAt(0));
  return { ...body, trace: new Float32Array(bytes.buffer) };
}

export const getCode = () => json("/api/workshop/code");
export const forkCode = (url) => post("/api/workshop/code/fork", url ? { url } : {});
export const pushCode = () => post("/api/workshop/code/push");
export const publishRun = (body) => post("/api/workshop/publish", body);
```

- [ ] **Step 4: Preflight**

```js
// app/src/workshop/preflight.js
// What the workshop needs before it can train or publish. Each missing item
// shows the command that fixes it; nothing launches while one is missing.

export const ITEMS = [
  { key: "git", label: "git", fix: "Install git: https://git-scm.com/downloads" },
  {
    key: "identity",
    label: "Your name on commits",
    fix: 'git config --global user.name "Your Name" && git config --global user.email you@example.com',
  },
  { key: "uv", label: "uv", fix: "curl -LsSf https://astral.sh/uv/install.sh | sh" },
  { key: "user", label: "Logged in to Hugging Face", fix: "hf auth login" },
];

/** git, a name on commits and uv — and, without an NVIDIA GPU, a Hugging Face login for HF Jobs. */
export function canTrain(preflight) {
  return Boolean(preflight.git && preflight.identity && preflight.uv && (preflight.gpu || preflight.user));
}

export function renderPreflight(zone, status, { onLogin }) {
  const p = status.preflight;
  zone.innerHTML = `
    <p class="eyebrow">1 · Preflight</p>
    <ul class="preflight"></ul>
    <p class="preflight__where"></p>
    <p class="preflight__gh"></p>
    <form class="preflight__login">
      <label>Or paste a Hugging Face token
        <input type="password" name="token" autocomplete="off" spellcheck="false" />
      </label>
      <button class="button-secondary" type="submit">Log in</button>
      <span class="preflight__note"></span>
    </form>`;
  const list = zone.querySelector(".preflight");
  for (const item of ITEMS) {
    const ok = Boolean(p[item.key]);
    const row = document.createElement("li");
    row.className = ok ? "preflight__ok" : "preflight__missing";
    const label = document.createElement("span");
    label.textContent = ok && item.key === "user" ? `${item.label} as ${p.user}` : item.label;
    row.append(label);
    if (!ok) {
      const fix = document.createElement("code");
      fix.textContent = item.fix;
      row.append(fix);
    }
    list.append(row);
  }
  zone.querySelector(".preflight__where").textContent = p.gpu
    ? "NVIDIA GPU found: training runs on this machine."
    : `No NVIDIA GPU: training runs on Hugging Face Jobs, billed to ${p.user ?? "your Hugging Face account"}.`;
  zone.querySelector(".preflight__gh").textContent = p.gh
    ? "GitHub CLI logged in: the workshop can fork the challenges for you."
    : "No GitHub CLI: to share your code you will fork on GitHub's page (optional).";
  const form = zone.querySelector(".preflight__login");
  form.hidden = Boolean(p.user);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector(".preflight__note");
    note.textContent = "";
    try {
      await onLogin(form.elements.token.value.trim());
    } catch (error) {
      note.textContent = error.message;
    }
  });
}
```

- [ ] **Step 5: Train and its curve**

```js
// app/src/workshop/train.js
// Train: the challenge's recipe and knobs, editable. Launch writes them into
// challenge.toml, commits, and trains — on this machine's GPU, or on HF Jobs.

import { canTrain } from "./preflight.js";

const RECIPE = [
  ["num_envs", "Robots trained in parallel", 1],
  ["max_iterations", "Iterations", 1],
  ["seed", "Seed", 0],
];

export function runName(now = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  return `run-${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

export function formValues(form, challenge) {
  const field = (name) => form.elements.namedItem(name).value;
  return {
    name: field("run").trim(),
    recipe: Object.fromEntries(RECIPE.map(([key]) => [key, Number.parseInt(field(key), 10)])),
    params: Object.fromEntries(challenge.knobs.map((knob) => [knob.name, Number.parseFloat(field(knob.name))])),
  };
}

export function renderTrainForm(zone, status, { onLaunch }) {
  const { challenge, preflight } = status;
  zone.innerHTML = `
    <form class="train-form">
      <label class="field">Run name
        <input name="run" required pattern="[a-z0-9][a-z0-9\\-]{0,39}" spellcheck="false" />
      </label>
      <fieldset class="knobs"><legend class="mono-label">Knobs</legend></fieldset>
      <fieldset class="recipe"><legend class="mono-label">Recipe</legend></fieldset>
      <p class="train-form__where"></p>
      <button class="button" type="submit">Launch</button>
      <p class="train-form__status"></p>
    </form>`;
  const form = zone.querySelector("form");
  form.elements.namedItem("run").value = runName();
  const knobs = form.querySelector(".knobs");
  for (const knob of challenge.knobs) {
    const label = document.createElement("label");
    label.className = "knob";
    label.textContent = knob.label;
    const input = Object.assign(document.createElement("input"), {
      // step "any": a stepped range would snap an exact value written in challenge.toml.
      type: "range", name: knob.name, min: knob.min, max: knob.max, step: "any", value: knob.value,
    });
    const shown = document.createElement("output");
    shown.textContent = knob.value;
    input.addEventListener("input", () => { shown.textContent = input.value; });
    label.append(input, shown);
    knobs.append(label);
  }
  const recipe = form.querySelector(".recipe");
  for (const [key, text, min] of RECIPE) {
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = text;
    label.append(Object.assign(document.createElement("input"), {
      type: "number", name: key, min, step: 1, value: challenge.recipe[key],
    }));
    recipe.append(label);
  }
  form.querySelector(".train-form__where").textContent = preflight.gpu
    ? "Trains on this machine's NVIDIA GPU."
    : `Trains on Hugging Face Jobs (one L4 GPU), billed to ${preflight.user ?? "your account"}; ` +
      "the checkpoints come back here as they are saved.";
  const button = form.querySelector("button[type=submit]");
  button.disabled = !canTrain(preflight);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector(".train-form__status");
    note.textContent = "Committing the recipe and starting…";
    button.disabled = true;
    try {
      await onLaunch(formValues(form, challenge));
      note.textContent = "";
    } catch (error) {
      note.textContent = error.message;
    } finally {
      button.disabled = !canTrain(preflight);
    }
  });
}

export function renderTraining(zone, training, { onStop, onPull }) {
  const where = training.mode === "hf-jobs" ? `Hugging Face Jobs → ${training.ckpt_repo}` : "this machine";
  const ended = training.state === "failed" ? `failed (exit ${training.returncode})` : training.state;
  zone.innerHTML = `
    <p class="training__head"><span class="mono-label"></span> <strong class="training__state"></strong></p>
    <div class="training__actions"></div>`;
  zone.querySelector(".mono-label").textContent = `${training.name} · ${where}`;
  zone.querySelector(".training__state").textContent = ended;
  const actions = zone.querySelector(".training__actions");
  if (training.state === "running") {
    const stop = Object.assign(document.createElement("button"), { className: "button-secondary training__stop", textContent: "Stop" });
    stop.addEventListener("click", () => onStop());
    actions.append(stop);
    if (training.mode === "hf-jobs") {
      const pull = Object.assign(document.createElement("button"), { className: "button-secondary training__pull", textContent: "Fetch checkpoints now" });
      pull.addEventListener("click", () => onPull());
      actions.append(pull);
    }
  }
}

/** Add new lines to the log, keeping it scrolled to the end if it was there. */
export function appendLog(pre, lines) {
  if (!lines.length) return;
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent += `${lines.join("\n")}\n`;
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
```

(The failed-state test expects `failed … 3` in the text: `failed (exit 3)` matches `/failed.*3/`.)

```js
// app/src/workshop/curve.js
// The mean reward per iteration, as the run's TensorBoard file recorded it.

export function curvePath(points, width, height) {
  if (points.length < 2) return "";
  const steps = points.map(([step]) => step);
  const values = points.map(([, value]) => value);
  const [s0, s1] = [Math.min(...steps), Math.max(...steps)];
  const [v0, v1] = [Math.min(...values), Math.max(...values)];
  const x = (s) => ((s - s0) / (s1 - s0 || 1)) * width;
  const y = (v) => height - ((v - v0) / (v1 - v0 || 1)) * height;
  return points.map(([s, v], i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

export function renderCurve(figure, points) {
  figure.innerHTML = `
    <svg viewBox="0 0 400 120" preserveAspectRatio="none" role="img" aria-label="Mean reward per iteration">
      <path fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
    </svg>
    <figcaption class="mono-label"></figcaption>`;
  figure.querySelector("path").setAttribute("d", curvePath(points, 400, 120));
  const last = points.at(-1);
  figure.querySelector("figcaption").textContent = last
    ? `Mean reward ${last[1].toFixed(2)} at iteration ${last[0]}`
    : "No curve yet: it appears once the run's TensorBoard file is here.";
}
```

- [ ] **Step 6: The page and its entry point**

`app/workshop.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Microduck workshop</title>
    <link rel="icon" href="/duck-head-mark.webp" />
    <!-- Duck Jam's design system, as on every page of the site. -->
    <link rel="stylesheet" href="/design/tokens.css" />
    <link rel="stylesheet" href="/design/effects.css" />
    <link rel="stylesheet" href="/design/components.css" />
    <link rel="stylesheet" href="/design/motion.css" />
    <!-- race.css dresses the deck (stage and transport) the replay plays in. -->
    <link rel="stylesheet" href="/race.css" />
    <link rel="stylesheet" href="/workshop.css" />
  </head>
  <body>
    <main class="workshop">
      <header class="workshop__head">
        <p class="eyebrow">Microduck workshop</p>
        <h1 id="title">Workshop</h1>
        <a id="arena-link" class="mono-label">Back to the challenge on the Arena</a>
      </header>
      <section class="zone flyer" id="preflight"></section>
      <section class="zone flyer">
        <p class="eyebrow">2 · Train</p>
        <div id="train-form"></div>
        <div id="training"></div>
        <figure class="curve" id="curve"></figure>
        <pre class="log" id="train-log" tabindex="0" aria-label="Training output"></pre>
      </section>
      <section class="zone flyer" id="test-zone">
        <p class="eyebrow">3 · Test</p>
        <div id="runs"></div>
        <p class="trial__status" id="trial-status"></p>
        <div id="result"></div>
        <div id="replay"></div>
      </section>
      <section class="zone flyer" id="publish-zone">
        <p class="eyebrow">4 · Publish</p>
        <div id="code"></div>
        <div id="publish-form"></div>
      </section>
    </main>
    <script type="module" src="/src/workshop/main.js"></script>
  </body>
</html>
```

`app/src/workshop/main.js` (Task 15 adds the Test and Publish zones to it):

```js
// The workshop page: four zones over one challenge, fed by /api/workshop/*.

import * as api from "./api.js";
import { renderCurve } from "./curve.js";
import { renderPreflight } from "./preflight.js";
import { appendLog, renderTrainForm, renderTraining } from "./train.js";

const $ = (selector) => document.querySelector(selector);
const page = { status: null, since: 0, runs: [], selection: null, viewer: null, deck: null };
const FOLLOW_EVERY_MS = 3000;

async function refreshStatus() {
  page.status = await api.getStatus();
  const { event, arena } = page.status;
  document.title = `${event.title} · Microduck workshop`;
  $("#title").textContent = event.title;
  $("#arena-link").href = `${arena}/#/e/${event.id}`;
  renderPreflight($("#preflight"), page.status, {
    onLogin: async (token) => {
      await api.login(token);
      await refreshStatus();
    },
  });
  renderTrainForm($("#train-form"), page.status, { onLaunch });
}

async function refreshRuns() {
  page.runs = await api.getRuns();
}

async function onLaunch(body) {
  await api.launch(body);
  page.since = 0;
  $("#train-log").textContent = "";
  await follow();
}

async function follow() {
  const training = await api.getTraining(page.since);
  if (training.state === null) return;
  page.since = training.next;
  renderTraining($("#training"), training, {
    onStop: async () => { await api.stopTraining(); },
    onPull: async () => { await api.pullCheckpoints(); },
  });
  appendLog($("#train-log"), training.log);
  await refreshRuns();
  const run = page.runs.find((r) => r.name === training.name);
  renderCurve($("#curve"), run ? await api.getCurve(run.id) : []);
  if (training.state === "running") setTimeout(follow, FOLLOW_EVERY_MS);
}

async function start() {
  try {
    await refreshStatus();
    await refreshRuns();
    await follow(); // a training launched before a reload is picked up again
  } catch (error) {
    $("main").insertAdjacentHTML("afterbegin", '<p class="failed"></p>');
    $(".failed").textContent = `The workshop's server did not answer: ${error.message}`;
  }
}

start();
```

`app/vite.config.js`: the comment above `rollupOptions` says "Four pages: the app, the clip the recorder photographs, the plan the booth's dialogue is timed by, and the workshop (served by `workshop`, never by the Space's API)", and `input` gains `workshop: page("workshop.html")`.

`app/public/workshop.css`: the page is a single column (`.workshop { max-width: var(--space-content-column); margin: 0 auto; padding: … }`) of four `.zone` cards (`.flyer` already gives the card; add spacing between zones, a `--ink` 2 px rule under each eyebrow). `.preflight__ok::before` a check mark, `.preflight__missing` in the error colour with its `code` on its own line, wrapping. `.knob` a grid row: label, range, value. `.log`: monospace, ink background, paper text, `max-height: 18rem; overflow: auto`. `.curve svg`: 100% wide, 120 px high. Use only tokens from `design/tokens.css` (colours, fonts, spacing) — no raw hex.

- [ ] **Step 7: Run the tests and build**

```bash
cd app && npx vitest run src/workshop && npm run build && ls dist/workshop.html && cd ..
```

Expected: pass; `dist/workshop.html` exists.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add app/workshop.html app/src/workshop app/public/workshop.css app/vite.config.js
/usr/bin/git commit -m "Workshop page: Preflight and Train, with the training's log and reward curve"
```

---

### Task 15: The workshop page — Test, Your code, Publish

**Files:**
- Create: `app/src/workshop/trial.js`, `app/src/workshop/publish.js`
- Modify: `app/src/workshop/main.js`, `app/public/workshop.css`
- Test: `app/src/workshop/trial.test.js`, `app/src/workshop/publish.test.js`

**Interfaces:**
- Consumes: `testCheckpoint`, `getRuns`, `getCode`, `forkCode`, `pushCode`, `publishRun` (Task 14's `api.js`); the runs listing's `trials` (Task 12); `code_state` and the publish route (Task 13).
- Produces: `INDICATIVE`, `formatTrial(trial)`, `renderRuns(zone, runs, selection, {onSelect, onTest})`, `renderResult(zone, result)`; `codeMessage(code)`, `renderCode(zone, code, {onFork, onPush})`, `defaultName(status, run)`, `publishValues(form, selection)`, `renderPublish(zone, selection, status, {onPreview, onPublish})`.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/workshop/trial.test.js
import { describe, expect, it, vi } from "vitest";
import { INDICATIVE, formatTrial, renderResult, renderRuns } from "./trial.js";

const run = {
  id: "2026-09-28_10-00-00_first", name: "first", started: "2026-09-28T10:00:00Z", dirty: false,
  checkpoints: [0, 1000, 2999],
  trials: { 1000: { score: 3.2, seeds_finished: 5, seeds_total: 5, command_vx: 0.6 } },
};

describe("choosing what to test", () => {
  it("says what to do when there is no run yet", () => {
    const zone = document.createElement("div");
    renderRuns(zone, [], null, { onSelect: vi.fn(), onTest: vi.fn() });
    expect(zone.textContent).toMatch(/No run yet/);
  });

  it("lists every checkpoint, with the score of those already tested", () => {
    const zone = document.createElement("div");
    renderRuns(zone, [run], null, { onSelect: vi.fn(), onTest: vi.fn() });
    const chips = [...zone.querySelectorAll(".checkpoint")].map((b) => b.textContent);
    expect(chips).toHaveLength(3);
    expect(chips[1]).toContain("3.20 s");
  });

  it("selects a checkpoint, then tests it", () => {
    const zone = document.createElement("div");
    const onSelect = vi.fn();
    const onTest = vi.fn();
    renderRuns(zone, [run], null, { onSelect, onTest });
    zone.querySelectorAll(".checkpoint")[2].click();
    expect(onSelect).toHaveBeenCalledWith({ run, checkpoint: 2999 });
    renderRuns(zone, [run], { run, checkpoint: 2999 }, { onSelect, onTest });
    expect(zone.querySelector(".checkpoint[aria-pressed=true]").textContent).toContain("2999");
    zone.querySelector(".trial__go").click();
    expect(onTest).toHaveBeenCalled();
  });
});

describe("a test's result", () => {
  it("is a time, how many starts finished, at which speed — and indicative", () => {
    expect(formatTrial({ score: 3.2, seeds_finished: 5, seeds_total: 5, command_vx: 0.6 }))
      .toBe("3.20 s · 5/5 finished · best at 0.60 m/s");
    const zone = document.createElement("div");
    renderResult(zone, { checkpoint: 1000, score: 3.2, seeds_finished: 5, seeds_total: 5, command_vx: 0.6, per_seed: [] });
    expect(zone.textContent).toContain(INDICATIVE);
    expect(zone.textContent).toContain("checkpoint 1000");
  });
});
```

```js
// app/src/workshop/publish.test.js
import { describe, expect, it, vi } from "vitest";
import { codeMessage, defaultName, publishValues, renderCode, renderPublish } from "./publish.js";

const code = (state, extra = {}) => ({
  state, fork: state === "not-shared" ? null : "alice/microduck-challenges", changes: 0, unpushed: 0,
  commit: "abc123456", gh: true, fork_page: "https://github.com/pollen-robotics/microduck-challenges/fork", ...extra,
});
const status = { challenge: { folder: "sprint_2m" }, event: { title: "2 m Sprint" }, preflight: { user: "alice" } };
const run = { id: "2026-09-28_10-00-00_first", name: "first", dirty: false, checkpoints: [1000], trials: {} };

describe("your code", () => {
  it("says where it stands", () => {
    expect(codeMessage(code("not-shared"))).toMatch(/not shared yet/);
    expect(codeMessage(code("changes", { changes: 2, unpushed: 1 }))).toMatch(/3 changes not online yet/);
    expect(codeMessage(code("shared"))).toMatch(/github\.com\/alice\/microduck-challenges @ abc123456/);
  });

  it("forks with gh in one click", () => {
    const zone = document.createElement("div");
    const onFork = vi.fn();
    renderCode(zone, code("not-shared"), { onFork, onPush: vi.fn() });
    zone.querySelector(".code__fork").click();
    expect(onFork).toHaveBeenCalledWith(null);
  });

  it("without gh, links GitHub's fork page and takes the fork's address", () => {
    const zone = document.createElement("div");
    const onFork = vi.fn();
    renderCode(zone, code("not-shared", { gh: false }), { onFork, onPush: vi.fn() });
    expect(zone.querySelector("a.code__forkpage").href).toBe("https://github.com/pollen-robotics/microduck-challenges/fork");
    zone.querySelector("input[name=fork]").value = "https://github.com/alice/microduck-challenges";
    zone.querySelector(".code__use").click();
    expect(onFork).toHaveBeenCalledWith("https://github.com/alice/microduck-challenges");
  });

  it("commits and pushes changes, and offers nothing once shared", () => {
    const zone = document.createElement("div");
    const onPush = vi.fn();
    renderCode(zone, code("changes", { changes: 1 }), { onFork: vi.fn(), onPush });
    zone.querySelector(".code__push").click();
    expect(onPush).toHaveBeenCalled();
    renderCode(zone, code("shared"), { onFork: vi.fn(), onPush });
    expect(zone.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows why a fork or a push failed, in git's words", async () => {
    const zone = document.createElement("div");
    const onPush = vi.fn(async () => { throw new Error("! [rejected] main -> main (non-fast-forward)"); });
    renderCode(zone, code("changes", { changes: 1 }), { onFork: vi.fn(), onPush });
    zone.querySelector(".code__push").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(zone.querySelector(".code__output").textContent).toContain("non-fast-forward");
  });
});

describe("publishing", () => {
  it("asks for a checkpoint first", () => {
    const zone = document.createElement("div");
    renderPublish(zone, null, status, { onPreview: vi.fn(), onPublish: vi.fn() });
    expect(zone.textContent).toMatch(/Choose a checkpoint/);
  });

  it("names the policy after the challenge and the run, and sends what was chosen", () => {
    expect(defaultName(status, run)).toBe("sprint-2m-first");
    const zone = document.createElement("div");
    const onPublish = vi.fn();
    renderPublish(zone, { run, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish });
    zone.querySelector(".publish__go").click();
    expect(onPublish.mock.calls[0][0]).toEqual({
      run: run.id, checkpoint: 1000, name: "sprint-2m-first", description: "", allow_dirty: false,
    });
  });

  it("holds back a dirty run until 'publish anyway' is ticked", () => {
    const zone = document.createElement("div");
    renderPublish(zone, { run: { ...run, dirty: true }, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish: vi.fn() });
    const go = zone.querySelector(".publish__go");
    expect(zone.textContent).toMatch(/uncommitted/);
    expect(go.disabled).toBe(true);
    const anyway = zone.querySelector("input[name=anyway]");
    anyway.checked = true;
    anyway.dispatchEvent(new Event("change"));
    expect(go.disabled).toBe(false);
    expect(publishValues(zone.querySelector("form"), { run, checkpoint: 1000 }).allow_dirty).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd app && npx vitest run src/workshop; cd ..
```

Expected: the two new files FAIL (modules missing).

- [ ] **Step 3: Test zone**

```js
// app/src/workshop/trial.js
// Test: pick a run and a checkpoint; the workshop exports it and races it with
// the Arena's own evaluator on this machine. Checkpoints differ — on the roller
// sprint, neighbours can score 3 s and fall — so each tested one keeps its score.

export const INDICATIVE = "Indicative — only the Arena times an entry.";

export function formatTrial(t) {
  return `${t.score.toFixed(2)} s · ${t.seeds_finished}/${t.seeds_total} finished · best at ${t.command_vx.toFixed(2)} m/s`;
}

export function renderRuns(zone, runs, selection, { onSelect, onTest }) {
  if (!runs.length) {
    zone.innerHTML = '<p class="runs__empty"></p>';
    zone.firstElementChild.textContent =
      "No run yet. Launch a training above; a Hugging Face Jobs run appears here once its first checkpoints are fetched.";
    return;
  }
  zone.innerHTML = '<div class="runs"></div><button class="button trial__go" type="button">Test this checkpoint</button>';
  const list = zone.querySelector(".runs");
  for (const run of runs) {
    const row = document.createElement("div");
    row.className = "run";
    const title = document.createElement("p");
    title.className = "mono-label";
    title.textContent = `${run.name}${run.dirty ? " · started from uncommitted changes" : ""}`;
    row.append(title);
    for (const checkpoint of run.checkpoints) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "checkpoint";
      const tried = run.trials?.[checkpoint];
      chip.textContent = tried ? `${checkpoint} · ${tried.score.toFixed(2)} s ${tried.seeds_finished}/${tried.seeds_total}` : `${checkpoint}`;
      const chosen = selection?.run.id === run.id && selection.checkpoint === checkpoint;
      chip.setAttribute("aria-pressed", String(chosen));
      chip.addEventListener("click", () => onSelect({ run, checkpoint }));
      row.append(chip);
    }
    list.append(row);
  }
  const go = zone.querySelector(".trial__go");
  go.disabled = !selection;
  go.addEventListener("click", () => onTest());
}

export function renderResult(zone, result) {
  zone.innerHTML = '<p class="trial__score"></p><p class="trial__seeds mono-label"></p><p class="trial__caveat"></p>';
  zone.querySelector(".trial__score").textContent = `checkpoint ${result.checkpoint}: ${formatTrial(result)}`;
  zone.querySelector(".trial__seeds").textContent = result.per_seed
    .map((s) => `seed ${s.seed} ${s.status}${s.time_s == null ? "" : ` ${s.time_s.toFixed(2)} s`}`)
    .join(" · ");
  zone.querySelector(".trial__caveat").textContent = INDICATIVE;
}
```

- [ ] **Step 4: Your code and Publish**

```js
// app/src/workshop/publish.js
// Your code, then Publish. The policy goes to the user's Hugging Face account
// through `uv run publish`, and the Arena opens with the entry filled in.

export function codeMessage(code) {
  if (code.state === "not-shared") {
    return "Your code is not shared yet: people who open your entry will not see how it was trained.";
  }
  if (code.state === "changes") return `${code.changes + code.unpushed} changes not online yet on ${code.fork}.`;
  return `Shared at github.com/${code.fork} @ ${code.commit} ✔`;
}

function button(className, text, onClick, primary = false) {
  const b = Object.assign(document.createElement("button"), {
    type: "button", className: `${primary ? "button" : "button-secondary"} ${className}`, textContent: text,
  });
  b.addEventListener("click", onClick);
  return b;
}

export function renderCode(zone, code, { onFork, onPush }) {
  zone.innerHTML = '<p class="code__state"></p><div class="code__actions"></div><p class="code__output"></p>';
  zone.querySelector(".code__state").textContent = codeMessage(code);
  const actions = zone.querySelector(".code__actions");
  // git's or gh's own words when a step fails: a rejected push, a fork the org forbids.
  const attempt = (action) => async () => {
    const output = zone.querySelector(".code__output");
    output.textContent = "";
    try {
      await action();
    } catch (error) {
      output.textContent = error.message;
    }
  };
  if (code.state === "not-shared" && code.gh) {
    actions.append(button("code__fork", "Create my fork and push", attempt(() => onFork(null))));
  } else if (code.state === "not-shared") {
    const page = Object.assign(document.createElement("a"), {
      className: "code__forkpage", href: code.fork_page, target: "_blank", rel: "noopener", textContent: "Fork on GitHub",
    });
    const address = Object.assign(document.createElement("input"), {
      type: "url", name: "fork", placeholder: "https://github.com/you/microduck-challenges",
    });
    actions.append(page, address, button("code__use", "Use my fork", attempt(() => onFork(address.value.trim()))));
  } else if (code.state === "changes") {
    actions.append(button("code__push", "Commit and push", attempt(() => onPush())));
  }
}

export function defaultName(status, run) {
  return `${status.challenge.folder.replaceAll("_", "-")}-${run.name}`;
}

export function publishValues(form, selection) {
  return {
    run: selection.run.id,
    checkpoint: selection.checkpoint,
    name: form.elements.namedItem("policy").value.trim(),
    description: form.elements.namedItem("description").value.trim(),
    allow_dirty: Boolean(form.elements.namedItem("anyway")?.checked),
  };
}

export function renderPublish(zone, selection, status, { onPreview, onPublish }) {
  if (!selection) {
    zone.innerHTML = '<p class="publish__empty">Choose a checkpoint in Test first.</p>';
    return;
  }
  const { run, checkpoint } = selection;
  zone.innerHTML = `
    <form class="publish">
      <p class="mono-label publish__what"></p>
      <label class="field">Name <input name="policy" spellcheck="false" /></label>
      <label class="field">Description <input name="description" /></label>
      <p class="publish__dirty" hidden>This run started from uncommitted changes: the code it records is not
        what trained it. <label><input type="checkbox" name="anyway" /> Publish anyway</label></p>
      <div class="publish__actions"></div>
      <p class="publish__status"></p>
      <pre class="publish__card" hidden></pre>
    </form>`;
  const form = zone.querySelector("form");
  zone.querySelector(".publish__what").textContent =
    `${run.name}, checkpoint ${checkpoint}${run.trials?.[checkpoint] ? "" : " — not tested yet"}`;
  form.elements.namedItem("policy").value = defaultName(status, run);
  form.elements.namedItem("description").placeholder = status.event.title;
  const go = button("publish__go", "Publish", async () => {
    const note = zone.querySelector(".publish__status");
    note.textContent = "Exporting and uploading…";
    try {
      const done = await onPublish(publishValues(form, selection));
      note.innerHTML = "";
      note.append(`Published ${done.repo} @ ${done.revision.slice(0, 7)}. The Arena opened in your browser: `,
        Object.assign(document.createElement("a"), { href: done.arena_url, target: "_blank", textContent: "enter it there" }), ".");
    } catch (error) {
      note.textContent = error.message;
    }
  }, true);
  const preview = button("publish__preview", "Preview the Hub card", async () => {
    const card = zone.querySelector(".publish__card");
    try {
      const done = await onPreview(publishValues(form, selection));
      card.hidden = false;
      card.textContent = `${done.repo}\n\n${done.readme}`;
    } catch (error) {
      zone.querySelector(".publish__status").textContent = error.message;
    }
  });
  zone.querySelector(".publish__actions").append(preview, go);
  const dirty = zone.querySelector(".publish__dirty");
  const allowed = () => !run.dirty || form.elements.namedItem("anyway").checked;
  const signedIn = Boolean(status.preflight.user);
  dirty.hidden = !run.dirty;
  go.disabled = !allowed() || !signedIn;
  form.elements.namedItem("anyway").addEventListener("change", () => { go.disabled = !allowed() || !signedIn; });
}
```

- [ ] **Step 5: Wire the two zones**

In `app/src/workshop/main.js`, add the imports

```js
import { MIN } from "../brightness.js";
import { deckMarkup, wireDeck } from "../deck.js";
import { createViewer } from "../viewer.js";
import { renderCode, renderPublish } from "./publish.js";
import { renderResult, renderRuns } from "./trial.js";
```

make `refreshRuns` also draw the Test zone:

```js
async function refreshRuns() {
  page.runs = await api.getRuns();
  // A selection keeps pointing at the same run object as the list refreshes.
  if (page.selection) {
    const run = page.runs.find((r) => r.id === page.selection.run.id);
    page.selection = run ? { run, checkpoint: page.selection.checkpoint } : null;
  }
  renderRuns($("#runs"), page.runs, page.selection, { onSelect, onTest });
}

function onSelect(selection) {
  page.selection = selection;
  renderRuns($("#runs"), page.runs, page.selection, { onSelect, onTest });
  renderPublishForm();
}

async function onTest() {
  const { run, checkpoint } = page.selection;
  const note = $("#trial-status");
  note.textContent = `Exporting checkpoint ${checkpoint} and racing it (a minute or so)…`;
  try {
    const result = await api.testCheckpoint(run.id, checkpoint);
    note.textContent = "";
    renderResult($("#result"), result);
    await replay(result);
    await refreshRuns();
    renderPublishForm();
  } catch (error) {
    note.textContent = error.message;
  }
}

async function replay(result) {
  if (!page.viewer) {
    $("#replay").innerHTML = deckMarkup;
    page.viewer = await createViewer($("#stage"), { rig: page.status.event.rig });
    page.viewer.setBrightness(MIN);
    page.deck = wireDeck($("#replay"), page.viewer);
  }
  page.viewer.setLanes(
    [{ runId: null, trace: result.trace, tier: "trial", livery: "classic", name: `checkpoint ${result.checkpoint}` }],
    page.status.event,
  );
  page.deck.reset();
}

async function refreshCode() {
  const code = await api.getCode();
  renderCode($("#code"), code, {
    onFork: async (url) => { await api.forkCode(url); await refreshCode(); },
    onPush: async () => { await api.pushCode(); await refreshCode(); },
  });
}

function renderPublishForm() {
  renderPublish($("#publish-form"), page.selection, page.status, {
    onPreview: (values) => api.publishRun({ ...values, dry_run: true }),
    onPublish: (values) => api.publishRun(values),
  });
}
```

In `start()`, after `await refreshRuns();`: `await refreshCode(); renderPublishForm();`.

`app/public/workshop.css`: `.runs .run` rows; `.checkpoint` chips (pill buttons, `aria-pressed=true` inked); `.trial__score` large, in the display font; `.trial__caveat` in `--ink-70`; `.publish__card` monospace, scrollable; `.publish__dirty` in the warning colour; `.code__actions` a wrapping row.

- [ ] **Step 6: Run the tests and build**

```bash
cd app && npm test 2>&1 | tail -6 && npm run build && cd ..
```

Expected: only the 4 known failures; the build succeeds.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add app/src/workshop app/public/workshop.css
/usr/bin/git commit -m "Workshop page: Test with a replay, Your code, and Publish back to the Arena"
```

---

### Task 16: microduck-challenges — each challenge's kind is its event's, and the one line

**Repo:** the challenges worktree (`~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop`). `swag_contest/` is read only (see *Coordination*).

**Files:**
- Modify: `tests/test_challenges.py` (one test)
- Modify: `README.md` (a *The workshop* section)

- [ ] **Step 1: Put this plan's Arena in the challenges environment, for development**

The locked Arena is the 0.2.0 wheel, which has neither `Manifest.kind` nor `workshop`. Install the Arena worktree over it, editable, and keep uv from syncing it back:

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop
export HF_TOKEN=$(cat ~/.cache/huggingface/token) UV_NO_SYNC=1
uv pip install --no-config --no-deps -e ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop
.venv/bin/python -c "import arena, arena.workshop; print(arena.__file__)"
ls .venv/bin/workshop
```

Expected: the path is the Arena worktree's; `workshop` exists. (Undone by a plain `uv sync --group workshop`. `uv.lock` does not change.)

- [ ] **Step 2: Write the test**

In `tests/test_challenges.py`, after `test_the_event_is_open_on_the_installed_arena` (or next to the other per-folder tests):

```python
@pytest.mark.parametrize("folder", sorted(CHALLENGES))
def test_the_kind_is_the_events(folder):
    """The Space refuses a manifest whose kind is not its event's; publish writes the challenge's."""
    contract = _contract(folder)
    assert contract.kind == load_event(contract.event).kind
```

- [ ] **Step 3: Run it — against this plan's Arena, then against the wheel**

```bash
uv run --no-config --group workshop pytest tests/test_challenges.py -q -k kind
```

Expected: 4 passed. (Against the 0.2.0 wheel it fails with `AttributeError: 'Manifest' object has no attribute 'kind'` — expected until the challenges lock moves to a wheel built from this plan, an owner step after the merge.)

- [ ] **Step 4: The one line in the README**

In `README.md`, before `## Train from a shell`:

````markdown
## The workshop

Each challenge's page on the Arena has a **Train my robot** button with one line to copy:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py sprint-2m
```

It works in the clone you run it in (or clones this repo next to you) and opens
the workshop in your browser: Preflight, Train (on your NVIDIA GPU, or on
Hugging Face Jobs without one), Test (the Arena's own evaluator, on your
machine), Publish (to your Hugging Face account), then back to the Arena to
enter it. From a clone, `uv run --group workshop workshop` lists the challenges
and `uv run --group workshop workshop sprint-2m` opens one.
````

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tests/test_challenges.py README.md
/usr/bin/git commit -m "Test that each challenge's kind is its Arena event's, and put the workshop's one line in the README"
```

---

### Task 17: Rehearse the journey on this Mac, and hand over

**Files:** none new, unless the rehearsal finds something to fix (fix it in the task that owns the code, with a test, and commit it). Screenshots go to the session's scratchpad.

- [ ] **Step 1: The Arena, standing in for the Space**

```bash
cd ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop
(cd app && npm run build)
SCRATCH=/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/112eb36d-e1cc-492b-9be0-d344ee25cacf/scratchpad
uv run --no-config --frozen arena serve --store $SCRATCH/board --port 8000 &   # background
curl -s http://127.0.0.1:8000/workshop.py | grep "^ARENA"
```

Expected: `ARENA = 'http://127.0.0.1:8000'`.

- [ ] **Step 2: The one line**

From the challenges worktree (it is a checkout, so the launcher works in place; Task 16 put this plan's Arena in its venv):

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/plan4-workshop
UV_NO_CONFIG=1 UV_NO_SYNC=1 uv run http://127.0.0.1:8000/workshop.py sprint-2m --no-browser &   # background
```

Expected: `sprint-2m workshop: http://127.0.0.1:8765/`. (`UV_NO_SYNC=1` is the development stand-in for a wheel that has the workshop in it; a novice's line has neither variable.)

- [ ] **Step 3: Drive the page in headless Chrome**

With the puppeteer bundled at `/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer` (see the memory *headless-chrome-available-locally*), in a script under the scratchpad:

1. Open `http://127.0.0.1:8765/`, 1280×900. Screenshot. The Preflight says no NVIDIA GPU → Hugging Face Jobs, billed to the owner's account; the Train form shows the sprint's recipe and knobs.
2. Test: the run `…_plan4probe` lists checkpoints 0, 1, 2. Select 2, Test. Within ~60 s a result shows (this 3-iteration policy falls: expect 50 s, 0/5) with *Indicative — only the Arena times an entry*, and the replay's canvas draws a duck. Screenshot.
3. Publish: the zone names `plan4probe, checkpoint 2`; *Preview the Hub card* shows a README (`publish --dry-run`: nothing leaves the machine). *Your code* says "not shared yet". Screenshot. **Do not press Publish, Fork or Push.**
4. The Arena: open `http://127.0.0.1:8000/?repo=Nico-robot/microduck-demo&revision=abc1234&env=https%3A%2F%2Fgithub.com%2FNico-robot%2Fmicroduck-challenges%2Ftree%2Fabc#/e/sprint-2m`. The entry panel shows the repo, "at revision abc1234" and the link; *Train my robot* shows `uv run http://127.0.0.1:8000/workshop.py sprint-2m`. Screenshot.
5. Read each screenshot (it is an image) and fix what looks wrong — overflow, unreadable contrast, a zone that did not render — in Tasks 14/15's files, with a test where the fix is logic.

- [ ] **Step 4: Run every suite once more**

```bash
cd ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/plan4-workshop
uv run --no-config --frozen --extra dev pytest -q 2>&1 | tail -3
uv run --no-config --frozen --extra dev ruff check arena tests
(cd app && npm test 2>&1 | tail -4)
```

Expected: all Python tests pass; no ruff finding in files this plan touched; the 4 known vitest failures only.

- [ ] **Step 5: Stop, and ask the owner**

Each of these writes outside this machine and needs the owner's explicit yes:

1. **A short HF job from the workshop** (e.g. the sprint, 512 envs × 100 iterations: an L4 for roughly 15–25 minutes including scheduling), to see Launch → the job's log → checkpoints pulled back → Test. Until PR #57's branch is pushed and the challenges lock moves (see below), the job runs microduck_rl 981a279: checkpoints come back, the curve does not.
2. **A real Publish** of a checkpoint: creates a public repo `<owner>/microduck-<name>` on the Hub, then the local Arena opens pre-filled; clicking Publish there records the entry on the local board.
3. **Fork and push** from *Your code*: creates or writes a GitHub repo.

Report what the rehearsal showed (with the screenshots) and wait.

---

## After this plan (the owner's)

In this order; each step is the owner's because it pushes, uploads or merges with the other session's work.

1. **microduck_rl** — review `plan4-hf-jobs` (one commit on top of 981a279) and fast-forward PR #57's branch: `git push origin plan4-hf-jobs:challenge-recipe-publishing`.
2. **Arena** — merge `plan4-workshop` and the other session's branch into `main`. Expected overlap: `tests/test_routes_submit.py` (this plan routed its submissions through a fake Hub and kept every assertion's line; the other session re-baselines the golden numbers in those same assertions — keep their numbers). `pyproject.toml`: this plan adds one line under `[project.scripts]`, nothing else. Run both suites, then push `main` (it deploys the Space).
3. **A wheel with the workshop** — version as the owner decides with the other session's `RUNNER_VERSION` move; `npm run build`, `scripts/bundle_frontend.py`, `uv build --wheel`, upload to the private `pollen-robotics/microduck-arena-wheels`.
4. **microduck-challenges** — point `[tool.uv.sources] microduck-arena` at that wheel, `uv lock --no-config --upgrade-package microduck-arena --upgrade-package mjlab-microduck` (the second picks up step 1's commit, so jobs upload TensorBoard files), merge `plan4-workshop`, push. From then on the one line works with no `UV_NO_SYNC`.
5. **For people outside Pollen** — the Space is private: `uv run https://…hf.space/workshop.py` and the workshop's return link answer 404 without the Hub's auth, and the challenges repo and the wheel are private too. The one line is for members until those open.

Known limits, left as they are: `arena recover` does not find workshop-published repos by default (their manifests are not `published_by: microduck-arena` and `publish` does not tag `microduck-policy`) — the same as any Hub-repo entry today, and the run log is durable; the Space's build also ships `workshop.html`, inert there (its API is not the Space's).
