# Arena foundations — implementation plan (plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Arena runs on `microduck_rl`'s physics stack and Python, re-baselined as `RUNNER_VERSION` 3, and is consumable as a wheel that carries the built site — the two things a `microduck-challenges` checkout needs before it can depend on it.

**Architecture:** Four pins move in `pyproject.toml` and the golden run is re-measured on the new physics. The built site (`app/dist`, which already contains every `public/` asset, meshes included) is copied into the package as `arena/frontend/` by one small script that both the Dockerfile and a new release workflow run; hatchling ships that directory as a build artefact and `ArenaConfig` looks for it inside the package before falling back to `app/dist`. A tag `vX.Y` builds the wheel and attaches it to a GitHub release.

**Tech Stack:** Python 3.12, `uv`, hatchling, MuJoCo 3.10.0, onnxruntime 1.24.4, numpy 2.4.1, Vite 5 / Node 20, GitHub Actions, `gh`.

**Spec:** `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md`, section *Versions and distribution*.

## Global Constraints

- Pins stay **exact**: `mujoco==3.10.0`, `onnxruntime==1.24.4`, `numpy==2.4.1`, `requires-python = ">=3.12,<3.13"`. These are what `microduck_rl`'s `uv.lock` resolves today; the challenges repo's lock must be able to hold both packages.
- `RUNNER_VERSION` moves to 3 **in the same commit** as the pins and the new golden numbers (`arena/golden.py` and `tests/test_evaluate.py` record the same numbers; `test_the_golden_module_agrees_with_this_files_baseline` pins that).
- `main` carries no build artefact: `arena/frontend/` is gitignored, excluded from the Space upload, and produced only by `scripts/bundle_frontend.py`.
- The Space's Docker build keeps its layer order (dependencies before source) and keeps running `python -m arena.golden` at build time.
- The release wheel must contain real binary assets, never Git LFS pointers: the workflow checks out with `lfs: true` and the wheel is inspected before it is attached.
- The pre-existing uncommitted `uv.lock` diff in the owner's tree (a machine-level uv mirror, `pypi.registries.huggingface.tech`, and `exclude-newer`) is **not** part of this work: the committed lock must resolve from `https://pypi.org/simple`.
- Tests: `uv run --extra dev pytest` from the repo root (the golden test re-runs the sweep, ~10 s); `cd app && npm test` is untouched by this plan.

## Review Focus

- A source checkout that has run `npm run build` but never bundled: `arena serve` must still find `app/dist` (the packaged path is preferred only when it exists). Pinned in Task 2 (`test_the_packaged_frontend_wins_when_present`, `test_app_dist_is_the_fallback`).
- A wheel built from a checkout without LFS content would ship 130-byte pointer files and the workshop would draw no duck: the release workflow refuses such a wheel. Pinned in Task 3's workflow step (`inspect_wheel`), exercised by hand in Task 3 Step 5.
- `python -m arena.golden` on the new physics may report the reference walker falling at speeds it used to hold; the plan records whatever the sweep finds, but a `seeds_finished < 5` result means the walker no longer finishes and the pin question reopens with mjlab — stop and report rather than lower the bar. Pinned in Task 1 Step 4's expected output.
- A stale `arena/frontend/` from a previous bundle must not leak into the Space upload or a later wheel: `bundle_frontend` replaces the directory wholesale, and `deploy_space.py` ignores it. Pinned in Task 2 (`test_bundle_replaces_a_stale_copy`, `test_the_space_upload_ignores_the_bundle`).
- A tag whose version disagrees with `pyproject.toml` would attach a mis-versioned wheel that `uv` then refuses by hash the next time: the workflow fails before building. Pinned in Task 3's workflow (`check_tag` step).

---

### Task 1: Move onto `microduck_rl`'s stack and re-baseline the golden run

**Files:**
- Modify: `pyproject.toml:7-27`
- Modify: `arena/golden.py:19-28`
- Modify: `arena/constants.py:51-61`
- Modify: `tests/test_evaluate.py:109-115`
- Modify: `Dockerfile:19`
- Modify: `.github/workflows/deploy-space.yml:33-34`
- Modify: `uv.lock` (regenerated)
- Modify: `README.md` (section *Run it*, one line)

**Interfaces:**
- Produces: `arena.constants.RUNNER_VERSION == 3`; `arena.golden.MUJOCO_VERSION == "3.10.0"`, `SCORE_S` and `COMMAND_VX` as measured in Step 4.

- [ ] **Step 1: Make sure the machine has Python 3.12 and a clean lock to start from**

```bash
git checkout -- uv.lock          # drop the machine-mirror diff; see Global Constraints
uv python install 3.12
```

- [ ] **Step 2: Move the pins**

In `pyproject.toml`, replace lines 3–7 (the `requires-python` comment and line) with:

```toml
# One minor version, exactly. The golden run is measured on it, and it is the
# interpreter mjlab (through mujoco-warp) allows, so a microduck-challenges
# checkout can hold this package and mjlab-microduck in one environment.
requires-python = ">=3.12,<3.13"
```

and the three physics pins with:

```toml
    "mujoco==3.10.0",
    "onnxruntime==1.24.4",
    "numpy==2.4.1",
```

Add one sentence to the end of the pin comment block (after "...bump RUNNER_VERSION in the same commit."):

```toml
    # These three are what mjlab 1.3.0 / mujoco-warp 3.8.1 lock in microduck_rl;
    # moving them means moving with mjlab, so the challenges repo's uv.lock can
    # resolve both packages. Version 3 of the runner is that move.
```

- [ ] **Step 3: Re-lock from PyPI**

```bash
uv lock --default-index https://pypi.org/simple
git diff --stat uv.lock
grep -c "pypi.registries.huggingface.tech" uv.lock    # must print 0
uv sync --extra dev
```

Expected: the lock moves mujoco, onnxruntime, numpy and the Python marker; no mirror URL in it.

- [ ] **Step 4: Measure the new golden run**

```bash
uv run python -m arena.golden; echo "exit $?"
```

Expected: exit 1 with `AssertionError: MuJoCo 3.10.0 is installed, but every recorded time was measured with 3.12.0 …` — the tripwire working. Now measure the number the new physics gives:

```bash
uv run python - <<'EOF'
from arena.assets import ASSET_ROOT
from arena.evaluate import evaluate
from arena.manifest import load_event
from arena.policy import load_policy
r = evaluate(load_event("sprint-2m"), load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"))
print(f"score={r.score:.3f} command_vx={r.command_vx:.2f} seeds_finished={r.seeds_finished}/{len(r.per_seed)}")
EOF
```

Expected: one line, `seeds_finished=5/5`. **If `seeds_finished` is below 5, stop here and report**: the reference walker no longer finishes on this physics, and that is a decision for the owner (see *Review Focus*), not a number to record.

- [ ] **Step 5: Record the baseline and bump the runner version**

In `arena/golden.py` set `MUJOCO_VERSION = "3.10.0"`, `SCORE_S = <score from Step 4, three decimals>`, `COMMAND_VX = <command_vx from Step 4>`, and add to its module docstring, after the paragraph on the 3.13 drift:

```
Version 3 moved the pins to MuJoCo 3.10.0, the version mjlab trains with, so a
challenges checkout can install this package next to mjlab-microduck. The
walker was re-measured on it; the number below is that measurement.
```

In `tests/test_evaluate.py` replace lines 109–115 with:

```python
# Baseline, measured at RUNNER_VERSION 3 (MuJoCo 3.10.0, the version mjlab
# trains with). At version 2 — same sweep, MuJoCo 3.12.0 — the same policy
# scored 11.724 s at 0.40 m/s; at version 1 — one pinned command at 0.25 m/s —
# 18.216 s. Kept as the contrast: the sweep and the physics each moved it.
GOLDEN_SCORE_S = <score from Step 4>
GOLDEN_COMMAND_VX = <command_vx from Step 4>
PINNED_SCORE_S = 18.216  # what version 1 reported, at the event's declared vx
```

(`PINNED_SCORE_S` is still read further down the file; leave it.)

In `arena/constants.py`, after the `# 2:` paragraph and before `RUNNER_VERSION = 2`, add:

```python
# 3: the physics moved to MuJoCo 3.10.0 (with onnxruntime 1.24.4 and numpy
#    2.4.1), the versions mjlab trains with, so the Arena can be installed next
#    to mjlab-microduck in a challenges checkout. The reference walker was
#    re-measured on it (arena/golden.py); v2 times were made by a different
#    solver and are not comparable.
```

and set `RUNNER_VERSION = 3`.

In `Dockerfile` line 19: `FROM python:3.12-slim`. In `.github/workflows/deploy-space.yml`, `python-version: "3.12"`. In `README.md`, section *Run it*, before the `uv sync` block add the line: `Python 3.12 (`uv` installs it: `uv python install 3.12`).`

- [ ] **Step 6: Run the physics tests and the tripwire**

```bash
uv run python -m arena.golden
uv run --extra dev pytest tests/test_evaluate.py tests/test_constants.py tests/test_runner.py -v
```

Expected: `golden run holds: <score>s`; all tests pass, including `test_the_installed_mujoco_is_the_one_the_baseline_was_measured_with`.

- [ ] **Step 7: Run the whole suite**

```bash
uv run --extra dev pytest -q
```

Expected: all pass. (`tests/test_index.py`, `test_recover.py` and `test_routes_submit.py` import `RUNNER_VERSION` rather than hard-coding 2; if any assertion names `2`, it is comparing against the constant and still passes.)

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml uv.lock arena/golden.py arena/constants.py tests/test_evaluate.py Dockerfile .github/workflows/deploy-space.yml README.md
git commit -m "Move to mjlab's physics stack and re-baseline the golden run as runner version 3"
```

---

### Task 2: The built site travels inside the package

**Files:**
- Create: `scripts/bundle_frontend.py`
- Modify: `arena/web/config.py:107-115`
- Modify: `pyproject.toml` (`[tool.hatch.build.targets.wheel]`)
- Modify: `.gitignore`
- Modify: `scripts/deploy_space.py:26-38` (`IGNORE`)
- Modify: `Dockerfile:40-58`
- Modify: `README.md` (section *Run it*)
- Test: `tests/test_bundle_frontend.py`, `tests/test_web_config.py` (append), `tests/test_deploy_space.py` (append)

**Interfaces:**
- Produces:
  - `scripts/bundle_frontend.py`: `bundle(dist: Path = DIST, target: Path = TARGET) -> Path` copies a built `app/dist` into `arena/frontend/`, replacing what was there; exits 2 with a message naming `dist` when it holds no `index.html`.
  - `arena.web.config.default_frontend(package_dir: Path) -> Path` — `package_dir / "frontend"` when it holds `index.html`, else `package_dir.parent / "app" / "dist"`.
  - An installed wheel serves the site with no `ARENA_FRONTEND` variable.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_bundle_frontend.py
"""The built site goes inside the package, so a wheel carries it and `arena serve`
(or `workshop`) finds it wherever the package is installed."""

from pathlib import Path

import pytest

from tests.loading import load_script

bundle_frontend = load_script("bundle_frontend")


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "app" / "dist"
    (dist / "robot").mkdir(parents=True)
    (dist / "index.html").write_text("<html>site</html>")
    (dist / "robot" / "microduck.glb").write_bytes(b"glb" * 100)
    return dist


def test_bundle_copies_the_whole_dist(tmp_path):
    target = tmp_path / "arena" / "frontend"
    assert bundle_frontend.bundle(_dist(tmp_path), target) == target
    assert (target / "index.html").read_text() == "<html>site</html>"
    assert (target / "robot" / "microduck.glb").stat().st_size == 300


def test_bundle_replaces_a_stale_copy(tmp_path):
    target = tmp_path / "arena" / "frontend"
    target.mkdir(parents=True)
    (target / "old-bundle.js").write_text("stale")
    bundle_frontend.bundle(_dist(tmp_path), target)
    assert not (target / "old-bundle.js").exists(), "a previous bundle must not leak into a new wheel"


def test_an_unbuilt_dist_is_refused_by_name(tmp_path, capsys):
    with pytest.raises(SystemExit) as caught:
        bundle_frontend.bundle(tmp_path / "nowhere", tmp_path / "arena" / "frontend")
    assert caught.value.code == 2
    err = capsys.readouterr().err
    assert "nowhere" in err and "npm run build" in err


def test_the_wheel_ships_the_bundle_as_an_artifact():
    """hatchling honours .gitignore; the bundle is ignored, so it must be listed as an artifact."""
    import tomllib

    root = Path(__file__).resolve().parents[1]
    hatch = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["hatch"]["build"]["targets"]["wheel"]
    assert "arena/frontend/**" in hatch.get("artifacts", [])
    assert "arena/frontend/" in (root / ".gitignore").read_text()
```

Append to `tests/test_web_config.py`:

```python
def test_the_packaged_frontend_wins_when_present(tmp_path):
    from arena.web.config import default_frontend

    package = tmp_path / "site-packages" / "arena"
    (package / "frontend").mkdir(parents=True)
    (package / "frontend" / "index.html").write_text("")
    assert default_frontend(package) == package / "frontend"


def test_app_dist_is_the_fallback(tmp_path):
    from arena.web.config import default_frontend

    package = tmp_path / "checkout" / "arena"
    package.mkdir(parents=True)
    assert default_frontend(package) == tmp_path / "checkout" / "app" / "dist"
```

Append to `tests/test_deploy_space.py`:

```python
def test_the_space_upload_ignores_the_bundle():
    """The Space's Docker build bundles the site itself; a host bundle would be stale."""
    assert "arena/frontend/**" in deploy.IGNORE and "app/dist/**" in deploy.IGNORE
```

(`tests/test_deploy_space.py` already loads the script as `deploy = load_script("deploy_space")`; use `deploy.IGNORE` instead of the import above.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
uv run --extra dev pytest tests/test_bundle_frontend.py tests/test_web_config.py tests/test_deploy_space.py -v
```

Expected: FAIL — `FileNotFoundError` for the script, `ImportError: cannot import name 'default_frontend'`, and the two assertion failures.

- [ ] **Step 3: Write the bundler**

```python
#!/usr/bin/env python
"""Put the built site inside the package, so the wheel serves it.

`npm run build` writes `app/dist` — the pages, the hashed bundle and everything
in `app/public` (the meshes, the sounds, the stylesheets). Copied to
`arena/frontend/`, hatchling ships it as a build artefact and `arena serve` or
`workshop` finds it next to the code, wherever the package is installed. Both
the Dockerfile and the release workflow run this; nothing else writes that
directory, and it is never committed.

    uv run python scripts/bundle_frontend.py
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "app" / "dist"
TARGET = ROOT / "arena" / "frontend"


def bundle(dist: Path = DIST, target: Path = TARGET) -> Path:
    if not (dist / "index.html").is_file():
        print(f"{dist}: no index.html — run `npm run build` in app/ first", file=sys.stderr)
        sys.exit(2)
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(dist, target)
    return target


if __name__ == "__main__":
    print(f"bundled {bundle()}")
```

- [ ] **Step 4: Teach the config where the packaged site lives**

In `arena/web/config.py`, add a module-level function above `class ArenaConfig` (or just above `from_env` if the file orders helpers that way):

```python
def default_frontend(package_dir: Path) -> Path:
    """Inside the package first (a wheel carries the built site), then a checkout's build."""
    packaged = package_dir / "frontend"
    if (packaged / "index.html").is_file():
        return packaged
    return package_dir.parent / "app" / "dist"
```

and in `from_env` replace

```python
        if candidate is None:
            candidate = Path(__file__).resolve().parents[2] / "app" / "dist"
```

with

```python
        if candidate is None:
            candidate = default_frontend(Path(__file__).resolve().parents[1])
```

- [ ] **Step 5: Ship it in the wheel, keep it out of git and out of the Space upload**

`pyproject.toml`:

```toml
[tool.hatch.build.targets.wheel]
packages = ["arena"]
# The built site, copied in by scripts/bundle_frontend.py. Gitignored, so it
# has to be named here: hatchling drops ignored files unless they are artifacts.
artifacts = ["arena/frontend/**"]
```

`.gitignore`, after `app/dist/`:

```
arena/frontend/
```

`scripts/deploy_space.py`, in `IGNORE` after `"app/dist/**",`:

```python
    "arena/frontend/**",
```

and extend the comment above `IGNORE`: `app/dist and arena/frontend especially: the Dockerfile builds and bundles the site itself, and a stale host copy would be served in preference to nothing.`

- [ ] **Step 6: The Dockerfile bundles the same way**

Replace, in `Dockerfile`, from `COPY --chown=user pyproject.toml README.md ./` to the end of the `ENV ARENA_FRONTEND=…` block, with:

```dockerfile
# Dependencies before source, again for the layer cache. mujoco and onnxruntime
# are the slow ones and they change least.
COPY --chown=user pyproject.toml README.md ./
COPY --chown=user arena/ ./arena/
RUN pip install --no-cache-dir --user .

# The physics tripwire, at BUILD time. An image whose MuJoCo does not reproduce
# the recorded baseline cannot be built, so a Space can never come up serving a
# leaderboard that is silently incomparable with every other one. This is not
# hypothetical: an unpinned `mujoco>=3.2` resolved 3.13 here once, where the
# reference walker scores 44.9 s against the 18.2 s it was measured at.
RUN python -m arena.golden

# The built site goes INSIDE the package, where the release wheel carries it
# too (scripts/bundle_frontend.py does on a host what this COPY does here:
# app/dist -> arena/frontend). The package is then installed again without
# its dependencies, so the slow layer above stays cached. No ARENA_FRONTEND:
# the config finds arena/frontend next to the code.
COPY --chown=user --from=frontend /build/app/dist ./arena/frontend
RUN pip install --no-cache-dir --no-deps --user .

ENV ARENA_STORE=/home/user/arena-board \
    ARENA_RANK_BY=policy \
    ARENA_DEV_USER=guest
```

- [ ] **Step 7: Run the tests, then prove a local wheel serves the site**

```bash
uv run --extra dev pytest tests/test_bundle_frontend.py tests/test_web_config.py tests/test_deploy_space.py tests/test_web_app.py -v
cd app && npm ci && npm run build && cd ..
uv run python scripts/bundle_frontend.py
uv build --wheel
python3 -c "
import zipfile, glob
z = zipfile.ZipFile(glob.glob('dist/microduck_arena-*.whl')[0])
names = z.namelist()
assert 'arena/frontend/index.html' in names, 'no site in the wheel'
assert z.getinfo('arena/frontend/robot/microduck.glb').file_size > 100_000, 'LFS pointer, not a mesh'
assert z.getinfo('arena/assets/robot/legs/assets/leg.stl').file_size > 10_000, 'LFS pointer, not a mesh'
print('wheel ok', len(names), 'files')
"
git status --short    # arena/frontend/ and dist/ must NOT appear
```

Expected: tests pass; `wheel ok …`; a clean status.

- [ ] **Step 8: Document the bundle step**

In `README.md`, section *Run it*, after the `npm run build` line's block, add:

```markdown
`arena serve` finds the built site in `app/dist`. A wheel of this package (`uv build --wheel`
after `uv run python scripts/bundle_frontend.py`) carries it inside the package instead, at
`arena/frontend/`, so an installed Arena serves its site with nothing else on disk; that is
what the release workflow attaches to a tag.
```

- [ ] **Step 9: Commit**

```bash
git add scripts/bundle_frontend.py arena/web/config.py pyproject.toml .gitignore scripts/deploy_space.py Dockerfile README.md tests/test_bundle_frontend.py tests/test_web_config.py tests/test_deploy_space.py
git commit -m "Bundle the built site inside the package so a wheel serves it"
```

---

### Task 3: A tag builds the wheel and attaches it to a GitHub release

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `pyproject.toml:3` (`version = "0.2.0"`)
- Modify: `README.md` (new short section *Releasing*)

**Interfaces:**
- Produces: on `git push origin vX.Y`, a release `vX.Y` with `microduck_arena-X.Y-py3-none-any.whl`, downloadable at `https://github.com/pollen-robotics/microduck-arena/releases/download/vX.Y/microduck_arena-X.Y-py3-none-any.whl` — the URL the challenges repo's `pyproject.toml` will pin (plan 3).

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/release.yml
#
# A tag `vX.Y` becomes a wheel on a GitHub release. The challenges repo
# depends on that wheel by URL (uv locks its hash), which is how a training
# checkout gets the evaluator, the event rules and the workshop without PyPI
# and without building the site itself.
#
# The wheel carries the built site and the robot meshes, so this checks out
# LFS content and refuses a wheel that would ship pointer files.
name: Release a wheel

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  wheel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true

      - name: The tag must be the package version
        id: check_tag
        run: |
          version=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])")
          test "v$version" = "$GITHUB_REF_NAME" || { echo "tag $GITHUB_REF_NAME but pyproject.toml says $version"; exit 1; }

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
        working-directory: app
      - run: npm run build
        working-directory: app

      - uses: astral-sh/setup-uv@v5
        with:
          python-version: "3.12"
      - run: uv run --no-project python scripts/bundle_frontend.py
      - run: uv build --wheel

      - name: The wheel carries real assets, not LFS pointers
        id: inspect_wheel
        run: |
          python3 - <<'EOF'
          import glob, zipfile
          z = zipfile.ZipFile(glob.glob("dist/microduck_arena-*.whl")[0])
          names = z.namelist()
          assert "arena/frontend/index.html" in names, "no site in the wheel"
          assert z.getinfo("arena/frontend/robot/microduck.glb").file_size > 100_000, "LFS pointer, not a mesh"
          assert z.getinfo("arena/assets/robot/legs/assets/leg.stl").file_size > 10_000, "LFS pointer, not a mesh"
          print("wheel ok:", len(names), "files")
          EOF

      - run: gh release create "$GITHUB_REF_NAME" dist/*.whl --title "$GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 2: Bump the version and document the procedure**

`pyproject.toml`: `version = "0.2.0"`.

`README.md`, new section after *Deploying* (or after the deploy commands at lines ~47–48):

```markdown
## Releasing

A tag `vX.Y` matching `version` in `pyproject.toml` builds the wheel — package, built site,
meshes — and attaches it to a GitHub release (`.github/workflows/release.yml`). That wheel is
what `microduck-challenges` depends on:

```bash
git tag v0.2.0 && git push origin v0.2.0
```
```

- [ ] **Step 3: Validate the workflow file and the version check locally**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')" 2>/dev/null || uv run --with pyyaml python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
version=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])"); test "v$version" = "v0.2.0" && echo "version ok"
uv run --extra dev pytest -q
```

Expected: `yaml ok`, `version ok`, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml pyproject.toml README.md uv.lock
git commit -m "Release a wheel with the built site on every version tag"
```

- [ ] **Step 5: With the owner — push, tag, and check the release**

This step needs the owner: pushing `main` deploys the Space (memory: *Space deploys from GitHub main*), and the golden check runs in the Docker build.

```bash
git push origin main                 # Space rebuild; watch it come up on Python 3.12 / MuJoCo 3.10.0
git tag v0.2.0 && git push origin v0.2.0
gh run watch                         # the release workflow
gh release view v0.2.0               # lists microduck_arena-0.2.0-py3-none-any.whl
```

Then, on a machine with `uv`:

```bash
cd "$(mktemp -d)" && uv venv -p 3.12 -q && uv pip install -q "microduck-arena @ https://github.com/pollen-robotics/microduck-arena/releases/download/v0.2.0/microduck_arena-0.2.0-py3-none-any.whl" && uv run arena serve --store ./board --port 8765 &
sleep 5 && curl -s http://127.0.0.1:8765/ | head -c 200 && kill %1
```

Expected: the release exists with the wheel; the installed package serves the site's `index.html` with no `ARENA_FRONTEND` and no `app/` on disk. (While the repo is private, the download needs `gh auth` / a token — `uv pip install` with `https://<token>@github.com/…` — and the check is done by a member.)

---

### Task 4: The board after the physics move — with the owner

**Files:** none in this repo.

`RUNNER_VERSION` 3 empties the board until entries are re-raced. `arena recover` re-races every Hub entry whose revision is not recorded under the current runner version (`arena/recover.py::already_recorded`). With `ARENA_RECOVER=1` on the Space this runs at boot; otherwise it is one command.

- [ ] **Step 1: Check whether the Space recovers at boot**

`gh` cannot read Space variables; the owner checks `ARENA_RECOVER` in the Space's settings. If it is `1`, the Space's log after the first boot on v3 shows `recover: … restored N runs`.

- [ ] **Step 2: Otherwise, recover by hand against the Space's store**

```bash
ARENA_DATASET=<the Space's dataset> HF_TOKEN=<token> uv run arena recover --store ./board --all-tagged
```

Expected: every Hub-backed entry re-raced and recorded at runner version 3; entries whose weights lived only on the Space stay in the log and off the board, as the spec accepts.

- [ ] **Step 3: Record the outcome**

Note in the PR / commit message of the next plan the number of entries re-raced and any that failed to fetch, so plan 4's Space changes start from a known board.
