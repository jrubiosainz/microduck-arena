# Arena Race Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested Python engine that scores any Microduck `.onnx` policy on a declarative event and keeps a durable, ranked leaderboard — usable from the command line, with no web layer.

**Architecture:** Event manifests (TOML) declare course, command, termination and metric. A course builder turns a manifest plus a vendored robot MJCF into a compiled MuJoCo model. A narrow runner executes one policy, one event, one seed and returns an outcome plus a pose trace. An evaluator runs all seeds and applies the metric. A store appends immutable run records to a repo; an index derives the leaderboard from them.

**Tech Stack:** Python 3.11, `uv`, `mujoco`, `onnxruntime`, `numpy`, `huggingface_hub`, `pytest`, `ruff`.

**Spec:** `docs/superpowers/specs/2026-09-03-microduck-arena-design.md`

This plan covers spec build-order stages 1–3 (timing probe, runner + manifest, storage + index) plus stage 6 (a second event, brought forward because it validates the manifest abstraction *before* a UI is built on it). Stages 4–5 (API + OAuth + intake, frontend) are a separate plan written after this one lands.

## Global Constraints

Values copied verbatim from the spec and from the sandbox source they must match. **Every task's requirements implicitly include this section.** Getting any of these wrong produces a policy that runs but behaves differently than in the sandbox, which is worse than a crash.

- Observation is 61-D, in this order: `base_ang_vel(3), projected_gravity(3), joint_pos(14), joint_vel(14), last_action(14), command(13)`
- Action is 14-D joint position targets; `ctrl[j] = DEFAULT_POSE[j] + action[j] * ACTION_SCALE`
- `ACTION_SCALE = 1.0`, `TIMESTEP = 0.005`, `DECIMATION = 4`, `CTRL_DT = 0.02` (policy at 50 Hz)
- Command is 13-D: `[vx, vy, wz, head(4), body(6)]`
- `joint_pos` is `qpos[joint] - DEFAULT_POSE[joint]`; `joint_vel` is raw `qvel[joint]`
- `projected_gravity` is world `(0, 0, -1)` rotated into the trunk frame
- Reference speeds: legs `VEL_FWD = 0.25` m/s, rollers `RVEL_FWD = 0.6` m/s
- ONNX session input name `obs`, output name `actions`
- MuJoCo names: gyro sensor `imu_ang_vel`, trunk body `trunk_base`
- `JOINT_NAMES` and `DEFAULT_POSE` are the 14 values in Task 2, in that order, matching the MJCF actuator order
- Python 3.11; all commands run through `uv run`
- `RUNNER_VERSION` is an integer bumped on any change to physics, course geometry or the observation/action path. Runs are only ever compared within one `RUNNER_VERSION`.

---

### Task 1: Project skeleton and vendored robot assets

The MJCF and meshes come from the sandbox Space. They must be **vendored at a pinned commit**, not fetched at runtime: an upstream physics change must be a visible, deliberate event, because it invalidates every recorded time.

**Files:**
- Create: `pyproject.toml`
- Create: `arena/__init__.py`
- Create: `scripts/vendor_assets.sh`
- Create: `arena/assets/PROVENANCE.md`
- Create: `arena/assets/robot/legs/robot_allcollisions.xml` (vendored)
- Create: `arena/assets/robot/legs/assets/*.stl` (vendored)
- Create: `arena/assets/robot/rollers/robot_allcollisions_rollers.xml` (vendored)
- Create: `arena/assets/robot/rollers/assets/*.stl` (vendored)
- Create: `arena/assets/policies/BEST_alpha_walking.onnx` (vendored, reference policy for tests)
- Create: `.gitignore`
- Create: `tests/__init__.py` (empty — makes `tests` a package so Task 10 can import a fixture builder from `tests.test_store`)
- Test: `tests/test_assets.py`

**Interfaces:**
- Consumes: nothing
- Produces: `arena.assets.ASSET_ROOT: pathlib.Path` — the directory containing `robot/` and `policies/`

- [ ] **Step 1: Create the project skeleton**

`pyproject.toml`:

```toml
[project]
name = "microduck-arena"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "mujoco>=3.2",
    "onnxruntime>=1.18",
    "numpy>=1.26",
    "huggingface-hub>=0.24",
]

[project.optional-dependencies]
# onnx is only used by tests, to build deliberately malformed model fixtures.
dev = ["pytest>=8.0", "ruff>=0.6", "onnx>=1.16"]

[project.scripts]
arena = "arena.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["arena"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
```

`.gitignore`:

```
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/
dist/
probe-results.json
```

`arena/__init__.py`:

```python
"""Microduck Arena: score a policy on an event, rank it against every other."""
```

`tests/__init__.py`: empty. It exists so `tests.test_store` is importable as a
module — Task 10 reuses its record builder rather than duplicating one.

```bash
mkdir -p tests && touch tests/__init__.py
```

- [ ] **Step 2: Write the vendoring script**

`scripts/vendor_assets.sh`:

```bash
#!/usr/bin/env bash
# Vendor the robot model, meshes and reference policy from the sandbox Space.
#
# Deliberately a manual step, not a runtime fetch: the MJCF defines the physics
# every recorded time was measured against. Re-running this is a decision to
# invalidate the leaderboard, so it records what it took and when.
set -euo pipefail

SRC="${1:-../microduck-simulator}"
DEST="arena/assets"

if [ ! -d "$SRC/app/public/robot/mjlab" ]; then
  echo "error: $SRC is not a microduck-simulator checkout" >&2
  exit 1
fi

SRC_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
MJLAB="$SRC/app/public/robot/mjlab"

mkdir -p "$DEST/robot/legs/assets" "$DEST/robot/rollers/assets" "$DEST/policies"

cp "$MJLAB/robot_allcollisions.xml"         "$DEST/robot/legs/"
cp "$MJLAB/robot_allcollisions_rollers.xml" "$DEST/robot/rollers/"
# meshdir="assets" in the MJCF, so the STLs must land in an assets/ subdir.
cp "$MJLAB"/meshes/*.stl "$DEST/robot/legs/assets/"
cp "$MJLAB"/meshes/*.stl "$DEST/robot/rollers/assets/"
cp "$SRC/app/public/policies/BEST_alpha_walking.onnx" "$DEST/policies/"

cat > "$DEST/PROVENANCE.md" <<EOF
# Vendored assets

Do not edit these by hand. Re-vendor with \`scripts/vendor_assets.sh <simulator-checkout>\`.

| field | value |
| --- | --- |
| source | https://huggingface.co/spaces/pollen-robotics/microduck-simulator |
| commit | \`$SRC_COMMIT\` |
| vendored | $(date -u +%Y-%m-%dT%H:%M:%SZ) |

## Why this is pinned

The MJCF is the physics every recorded time was measured against. Re-vendoring can change
what a policy scores, which invalidates the leaderboard. When it happens, bump
\`RUNNER_VERSION\` in \`arena/constants.py\` in the same commit so old and new runs are never
compared.
EOF

echo "vendored from $SRC_COMMIT"
```

- [ ] **Step 3: Write the failing test**

`tests/test_assets.py`:

```python
import mujoco
import pytest

from arena.assets import ASSET_ROOT

RIGS = [
    ("legs", "robot_allcollisions.xml", 14),
    ("rollers", "robot_allcollisions_rollers.xml", 18),
]


def test_asset_root_exists():
    assert (ASSET_ROOT / "PROVENANCE.md").is_file()


@pytest.mark.parametrize("rig,xml_name,n_body_joints", RIGS)
def test_vendored_mjcf_compiles(rig, xml_name, n_body_joints):
    path = ASSET_ROOT / "robot" / rig / xml_name
    model = mujoco.MjModel.from_xml_path(str(path))
    # 14 position actuators in both rigs; the roller rig adds 4 passive wheel
    # hinges that appear in qpos but are not actuated.
    assert model.nu == 14
    assert model.body("trunk_base").id >= 0
    assert model.sensor("imu_ang_vel").adr[0] >= 0


def test_reference_policy_present():
    assert (ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx").is_file()
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_assets.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.assets'`

- [ ] **Step 5: Create the assets module**

`arena/assets/__init__.py`:

```python
"""Vendored robot models, meshes and the reference policy.

Pinned on purpose — see PROVENANCE.md. The MJCF defines the physics every
recorded time was measured against.
"""

from pathlib import Path

ASSET_ROOT = Path(__file__).parent
```

- [ ] **Step 6: Vendor the assets and run the tests**

Run:
```bash
chmod +x scripts/vendor_assets.sh
./scripts/vendor_assets.sh ../microduck-simulator
uv run --extra dev pytest tests/test_assets.py -v
```
Expected: PASS, 4 tests (`test_asset_root_exists`, two parametrised `test_vendored_mjcf_compiles`, `test_reference_policy_present`)

If `from_xml_path` fails on a missing mesh, the STLs did not land in `assets/` — check the `meshdir="assets"` attribute in the MJCF against where step 2 copied them.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml .gitignore arena/ scripts/ tests/
git commit -m "Vendor the robot model at a pinned commit

The MJCF is the physics every recorded time is measured against, so it is
copied in deliberately rather than fetched at runtime."
```

---

### Task 2: Constants

The numbers that must match the sandbox exactly. Isolated in one module so a mismatch is a one-file review.

**Files:**
- Create: `arena/constants.py`
- Test: `tests/test_constants.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `JOINT_NAMES: tuple[str, ...]` (14)
  - `DEFAULT_POSE: np.ndarray` (14, float64)
  - `NUM_JOINTS = 14`, `OBS_SIZE = 61`, `CMD_SIZE = 13`, `ACTION_SCALE = 1.0`
  - `TIMESTEP = 0.005`, `DECIMATION = 4`, `CTRL_DT = 0.02`
  - `VEL_FWD = 0.25`, `RVEL_FWD = 0.6`
  - `RUNNER_VERSION: int`
  - `TRACE_WIDTH = 21`

- [ ] **Step 1: Write the failing test**

`tests/test_constants.py`:

```python
import numpy as np

from arena import constants as c


def test_joint_names_match_default_pose():
    assert len(c.JOINT_NAMES) == c.NUM_JOINTS == 14
    assert c.DEFAULT_POSE.shape == (14,)


def test_observation_layout_sums_to_obs_size():
    # gyro(3) + projected gravity(3) + joint_pos(14) + joint_vel(14)
    # + last_action(14) + command(13)
    assert 3 + 3 + c.NUM_JOINTS * 3 + c.CMD_SIZE == c.OBS_SIZE == 61


def test_control_rate_is_50hz():
    assert c.CTRL_DT == c.TIMESTEP * c.DECIMATION
    assert 1.0 / c.CTRL_DT == 50.0


def test_default_pose_is_left_right_antisymmetric():
    # The stand keyframe mirrors left and right legs; a sign error in one leg
    # is the most likely transcription mistake and this catches it.
    pose = dict(zip(c.JOINT_NAMES, c.DEFAULT_POSE))
    for joint in ("hip_roll", "hip_pitch", "knee", "ankle"):
        assert pose[f"left_{joint}"] == -pose[f"right_{joint}"], joint


def test_trace_width_is_pos_quat_joints():
    assert c.TRACE_WIDTH == 3 + 4 + c.NUM_JOINTS == 21
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_constants.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.constants'`

- [ ] **Step 3: Write the constants**

`arena/constants.py`:

```python
"""Numbers that must match the sandbox exactly.

Transcribed from pollen-robotics/microduck-simulator, app/src/game/constants.js.
A mismatch here does not crash: it makes a policy behave differently than it does
in the sandbox, which is far harder to notice. Keep this module boring.
"""

import numpy as np

JOINT_NAMES: tuple[str, ...] = (
    "left_hip_yaw",
    "left_hip_roll",
    "left_hip_pitch",
    "left_knee",
    "left_ankle",
    "neck_pitch",
    "head_pitch",
    "head_yaw",
    "head_roll",
    "right_hip_yaw",
    "right_hip_roll",
    "right_hip_pitch",
    "right_knee",
    "right_ankle",
)

# The STAND keyframe from mjlab's scene_walk.xml, in JOINT_NAMES order.
DEFAULT_POSE = np.array(
    [
        0.0, -0.08726646259971647, -0.457924, -0.004940, 0.452984,
        0.3490658503988659, 0.3490658503988659, 0.0, 0.0,
        0.0, 0.08726646259971647, 0.457924, 0.004940, -0.452984,
    ],
    dtype=np.float64,
)

NUM_JOINTS = 14
OBS_SIZE = 61
CMD_SIZE = 13
ACTION_SCALE = 1.0

TIMESTEP = 0.005
DECIMATION = 4
CTRL_DT = TIMESTEP * DECIMATION  # 50 Hz

VEL_FWD = 0.25   # legs, m/s
RVEL_FWD = 0.6   # rollers, m/s

# One trace frame: trunk position(3) + trunk quaternion(4) + joint angles(14).
TRACE_WIDTH = 3 + 4 + NUM_JOINTS

# Bump on ANY change to physics, course geometry or the observation/action path.
# Runs are only ever compared within one RUNNER_VERSION.
RUNNER_VERSION = 1
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run --extra dev pytest tests/test_constants.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add arena/constants.py tests/test_constants.py
git commit -m "Transcribe the sandbox's sim constants, with tests that catch a typo"
```

---

### Task 3: Event manifest loader

**Files:**
- Create: `arena/manifest.py`
- Create: `arena/events/sprint-2m.toml`
- Test: `tests/test_manifest.py`

**Interfaces:**
- Consumes: `arena.constants`
- Produces:
  - `@dataclass(frozen=True) Course: kind: str, length_m: float, width_m: float, wall_height_m: float, slope_deg: float`
  - `@dataclass(frozen=True) Start: keyframe: str, settle_s: float, joint_rad: float, yaw_deg: float`
  - `@dataclass(frozen=True) Termination: fall_gravity_z: float, fall_hold_s: float`
  - `@dataclass(frozen=True) Manifest: id, title, rig, time_limit_s, metric, seeds: tuple[int, ...], course: Course, start: Start, termination: Termination, command: tuple[float, ...]` (13 values)
    - `command` is a tuple, not an ndarray, so that `frozen=True` is true: an ndarray field would leave a loaded event mutable in place, make the dataclass unhashable, and make `==` return an elementwise array instead of a bool. The runner converts it to an array once per run.
  - `load_manifest(path) -> Manifest`
  - `load_event(event_id) -> Manifest`
  - `all_events() -> list[Manifest]`
  - `EVENTS_DIR: Path`
  - `class ManifestError(Exception)`

- [ ] **Step 1: Write the sprint manifest**

`arena/events/sprint-2m.toml`:

```toml
id           = "sprint-2m"
title        = "2 m Sprint"
rig          = "legs"
time_limit_s = 50.0
metric       = "mean_finish_time"
seeds        = [1, 2, 3, 4, 5]

[course]
kind          = "lane"
length_m      = 2.0
width_m       = 0.8
wall_height_m = 0.15
slope_deg     = 0.0

[command]
vel  = [0.25, 0.0, 0.0]
head = [0.0, 0.0, 0.0, 0.0]
body = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

[start]
keyframe = "STAND"
settle_s = 0.5

[start.perturbation]
joint_rad = 0.01
yaw_deg   = 2.0

[termination]
fall_gravity_z = -0.5
fall_hold_s    = 0.3
```

- [ ] **Step 2: Write the failing test**

`tests/test_manifest.py`:

```python
import pytest

from arena.manifest import ManifestError, all_events, load_event, load_manifest

# A well-formed manifest, as TOML sections. Tests override one entry to build a
# specific malformation, so each test names only what it is breaking.
GOOD = {
    "root": 'id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
            'metric="mean_finish_time"\nseeds=[1]\n',
    "course": '[course]\nkind="lane"\nlength_m=1.0\nwidth_m=0.8\n'
              'wall_height_m=0.15\nslope_deg=0.0\n',
    "command": '[command]\nvel=[0.25,0,0]\nhead=[0,0,0,0]\nbody=[0,0,0,0,0,0]\n',
    "start": '[start]\nkeyframe="STAND"\nsettle_s=0.5\n'
             '[start.perturbation]\njoint_rad=0.01\nyaw_deg=2.0\n',
    "termination": '[termination]\nfall_gravity_z=-0.5\nfall_hold_s=0.3\n',
}


def write_manifest(tmp_path, **overrides):
    """Write a manifest that is well-formed except for the sections overridden."""
    sections = GOOD | overrides
    path = tmp_path / "probe.toml"
    path.write_text("".join(sections[key] for key in GOOD))
    return path


def test_sprint_loads():
    m = load_event("sprint-2m")
    assert m.id == "sprint-2m"
    assert m.rig == "legs"
    assert m.seeds == (1, 2, 3, 4, 5)
    assert m.course.length_m == 2.0
    assert m.time_limit_s == 50.0


def test_command_is_13_wide_with_velocity_first():
    m = load_event("sprint-2m")
    assert len(m.command) == 13
    assert m.command[:3] == (0.25, 0.0, 0.0)
    # head(4) and body(6) slots are zero-padded, as the runtime pads them.
    assert m.command[3:] == (0.0,) * 10


def test_a_manifest_is_hashable_and_compares_by_value():
    """frozen=True has to mean what it says.

    An ndarray command field would make this dataclass unhashable, make `==`
    return an elementwise array instead of a bool, and — worst — leave a loaded
    event mutable in place, so one stray write could corrupt the event for every
    later run in the same process.
    """
    a, b = load_event("sprint-2m"), load_event("sprint-2m")
    assert a == b
    assert len({a, b}) == 1


def test_every_shipped_event_loads():
    events = all_events()
    assert len(events) >= 1
    assert len({m.id for m in events}) == len(events), "duplicate event ids"


def test_unknown_event_is_an_error():
    with pytest.raises(ManifestError, match="no such event"):
        load_event("nope")


def test_the_probe_fixture_is_itself_valid(tmp_path):
    """Guards the helper: if the baseline were malformed, every test below would
    pass for the wrong reason."""
    assert load_manifest(write_manifest(tmp_path)).id == "probe"


def test_unknown_metric_is_rejected(tmp_path):
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
             'metric="vibes"\nseeds=[1]\n',
    )
    with pytest.raises(ManifestError, match="unknown metric"):
        load_manifest(path)


def test_unknown_rig_is_rejected(tmp_path):
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="hovercraft"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[1]\n',
    )
    with pytest.raises(ManifestError, match="unknown rig"):
        load_manifest(path)


def test_command_width_is_validated(tmp_path):
    path = write_manifest(
        tmp_path,
        command='[command]\nvel=[0.25,0]\nhead=[0,0,0,0]\nbody=[0,0,0,0,0,0]\n',
    )
    with pytest.raises(ManifestError, match="vel must have 3"):
        load_manifest(path)


def test_empty_seeds_is_rejected(tmp_path):
    """An event with no seeds would score every entry as a mean of nothing."""
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[]\n',
    )
    with pytest.raises(ManifestError, match="seeds must not be empty"):
        load_manifest(path)


def test_duplicate_seeds_are_rejected(tmp_path):
    """A repeated seed would run the same episode twice and weight it double."""
    path = write_manifest(
        tmp_path,
        root='id="probe"\ntitle="Probe"\nrig="legs"\ntime_limit_s=10.0\n'
             'metric="mean_finish_time"\nseeds=[1,1,2]\n',
    )
    with pytest.raises(ManifestError, match="duplicate seeds"):
        load_manifest(path)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.manifest'`

- [ ] **Step 4: Write the loader**

`arena/manifest.py`:

```python
"""Events are data. The runner never knows which one it is running.

Adding the roller race or the hill climb is a file in arena/events/, not a code
change. Validation is strict and loud: a broken manifest must fail at load, not
halfway through someone's timed run.
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path

from .constants import CMD_SIZE

EVENTS_DIR = Path(__file__).parent / "events"

RIGS = ("legs", "rollers")
METRICS = ("mean_finish_time",)
COURSE_KINDS = ("lane",)


class ManifestError(Exception):
    """A manifest is malformed, or names something that does not exist."""


@dataclass(frozen=True)
class Course:
    kind: str
    length_m: float
    width_m: float
    wall_height_m: float
    slope_deg: float


@dataclass(frozen=True)
class Start:
    keyframe: str
    settle_s: float
    joint_rad: float
    yaw_deg: float


@dataclass(frozen=True)
class Termination:
    fall_gravity_z: float
    fall_hold_s: float


@dataclass(frozen=True)
class Manifest:
    id: str
    title: str
    rig: str
    time_limit_s: float
    metric: str
    seeds: tuple[int, ...]
    course: Course
    start: Start
    termination: Termination
    # 13 values, held constant for the whole run. A tuple rather than an ndarray:
    # an ndarray would be mutable in place despite frozen=True, letting one bad
    # write corrupt the event for every later run in the same process — and
    # evaluate() runs five seeds in one process.
    command: tuple[float, ...]


def _require(raw: dict, key: str, where: str):
    if key not in raw:
        raise ManifestError(f"{where}: missing {key!r}")
    return raw[key]


def _command(raw: dict) -> tuple[float, ...]:
    vel = _require(raw, "vel", "[command]")
    head = _require(raw, "head", "[command]")
    body = _require(raw, "body", "[command]")
    for name, values, width in (("vel", vel, 3), ("head", head, 4), ("body", body, 6)):
        if len(values) != width:
            raise ManifestError(f"[command]: {name} must have {width} values, got {len(values)}")
    cmd = tuple(float(v) for v in (*vel, *head, *body))
    if len(cmd) != CMD_SIZE:
        raise ManifestError(f"[command]: assembles to {len(cmd)} values, expected {CMD_SIZE}")
    return cmd


def load_manifest(path: Path) -> Manifest:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)

    rig = _require(raw, "rig", str(path))
    if rig not in RIGS:
        raise ManifestError(f"{path}: unknown rig {rig!r}, expected one of {RIGS}")

    metric = _require(raw, "metric", str(path))
    if metric not in METRICS:
        raise ManifestError(f"{path}: unknown metric {metric!r}, expected one of {METRICS}")

    course_raw = _require(raw, "course", str(path))
    kind = _require(course_raw, "kind", "[course]")
    if kind not in COURSE_KINDS:
        raise ManifestError(f"{path}: unknown course kind {kind!r}, expected one of {COURSE_KINDS}")

    seeds = tuple(int(s) for s in _require(raw, "seeds", str(path)))
    if not seeds:
        raise ManifestError(f"{path}: seeds must not be empty")
    if len(set(seeds)) != len(seeds):
        raise ManifestError(f"{path}: duplicate seeds")

    start_raw = _require(raw, "start", str(path))
    perturb = _require(start_raw, "perturbation", "[start]")
    term_raw = _require(raw, "termination", str(path))

    return Manifest(
        id=_require(raw, "id", str(path)),
        title=_require(raw, "title", str(path)),
        rig=rig,
        time_limit_s=float(_require(raw, "time_limit_s", str(path))),
        metric=metric,
        seeds=seeds,
        course=Course(
            kind=kind,
            length_m=float(_require(course_raw, "length_m", "[course]")),
            width_m=float(_require(course_raw, "width_m", "[course]")),
            wall_height_m=float(_require(course_raw, "wall_height_m", "[course]")),
            slope_deg=float(_require(course_raw, "slope_deg", "[course]")),
        ),
        start=Start(
            keyframe=_require(start_raw, "keyframe", "[start]"),
            settle_s=float(_require(start_raw, "settle_s", "[start]")),
            joint_rad=float(_require(perturb, "joint_rad", "[start.perturbation]")),
            yaw_deg=float(_require(perturb, "yaw_deg", "[start.perturbation]")),
        ),
        termination=Termination(
            fall_gravity_z=float(_require(term_raw, "fall_gravity_z", "[termination]")),
            fall_hold_s=float(_require(term_raw, "fall_hold_s", "[termination]")),
        ),
        command=_command(_require(raw, "command", str(path))),
    )


def load_event(event_id: str) -> Manifest:
    path = EVENTS_DIR / f"{event_id}.toml"
    if not path.is_file():
        raise ManifestError(f"no such event: {event_id!r}")
    return load_manifest(path)


def all_events() -> list[Manifest]:
    return sorted(
        (load_manifest(p) for p in EVENTS_DIR.glob("*.toml")),
        key=lambda m: m.id,
    )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `uv run --extra dev pytest tests/test_manifest.py -v`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add arena/manifest.py arena/events/ tests/test_manifest.py
git commit -m "Events are declarative manifests, validated strictly at load"
```

---

### Task 4: Course builder

Turn a manifest plus a vendored robot MJCF into a compiled MuJoCo model. This mirrors `buildPhysicsXml` in the sandbox's `game.js` (strip visuals, prune meshes, set the timestep, inject a floor and a STAND keyframe) but injects a **lane** instead of a square arena, and no ball, props or terrain.

**Files:**
- Create: `arena/course.py`
- Test: `tests/test_course.py`

**Interfaces:**
- Consumes: `arena.constants`, `arena.manifest.Manifest`, `arena.assets.ASSET_ROOT`
- Produces:
  - `build_course_xml(manifest) -> tuple[str, dict[str, bytes]]` — MJCF text and the mesh assets dict
  - `compile_course(manifest) -> mujoco.MjModel`
  - `ramp_dir(slope_deg) -> np.ndarray` (3,) unit vector pointing up the lane
  - `ramp_normal(slope_deg) -> np.ndarray` (3,) unit vector normal to the lane surface
  - `SPAWN_HEIGHT_M = 0.12`

- [ ] **Step 1: Write the failing test**

`tests/test_course.py`:

```python
import dataclasses
import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import pytest

from arena.constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from arena.course import (
    SPAWN_HEIGHT_M,
    build_course_xml,
    compile_course,
    ramp_dir,
    ramp_normal,
)
from arena.manifest import load_event


def test_course_compiles_and_keeps_14_actuators():
    model = compile_course(load_event("sprint-2m"))
    assert model.nu == 14
    assert model.opt.timestep == TIMESTEP


def test_floor_and_two_lane_walls_exist():
    model = compile_course(load_event("sprint-2m"))
    for name in ("floor", "wall_left", "wall_right"):
        assert model.geom(name).id >= 0, name


def test_stand_keyframe_sets_every_actuated_joint():
    m = load_event("sprint-2m")
    model = compile_course(m)
    data = mujoco.MjData(model)
    key = model.key("STAND")
    mujoco.mj_resetDataKeyframe(model, data, key.id)
    for i, name in enumerate(JOINT_NAMES):
        adr = int(model.joint(name).qposadr[0])
        assert data.qpos[adr] == pytest.approx(DEFAULT_POSE[i]), name


def test_keyframe_spawns_the_trunk_above_the_floor():
    model = compile_course(load_event("sprint-2m"))
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    assert data.qpos[2] == pytest.approx(SPAWN_HEIGHT_M)


def test_visual_geoms_are_stripped_and_meshes_pruned():
    built, assets = build_course_xml(load_event("sprint-2m"))
    root = ET.fromstring(built)
    # Assert the property, not a substring. The vendored MJCF also carries a
    # <default class="visual"> template, which goes dead once the geoms
    # referencing it are gone. The reference implementation leaves that template
    # in place, so this builder must too — the built model stays as close to the
    # MJCF the policies were trained against as possible.
    assert [g for g in root.iter("geom") if g.get("class") == "visual"] == []
    # Only meshes referenced by surviving collision geoms are shipped.
    assert 0 < len(assets) < 20
    for name in assets:
        assert name.endswith(".stl")
        assert name in built


def test_roller_rig_compiles_with_passive_wheels_in_qpos():
    m = dataclasses.replace(load_event("sprint-2m"), id="roller-probe", rig="rollers")
    model = compile_course(m)
    assert model.nu == 14
    assert model.joint("passive_LF_wheel").id >= 0
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    # Wheels start at zero; the named joints still take DEFAULT_POSE.
    assert data.qpos[int(model.joint("passive_LF_wheel").qposadr[0])] == 0.0
    assert data.qpos[int(model.joint("left_knee").qposadr[0])] == pytest.approx(
        DEFAULT_POSE[JOINT_NAMES.index("left_knee")]
    )


def test_flat_ramp_direction_is_plain_x():
    np.testing.assert_allclose(ramp_dir(0.0), [1.0, 0.0, 0.0], atol=1e-12)
    np.testing.assert_allclose(ramp_normal(0.0), [0.0, 0.0, 1.0], atol=1e-12)


def test_sloped_ramp_direction_climbs_and_stays_unit():
    d = ramp_dir(8.0)
    n = ramp_normal(8.0)
    assert d[2] > 0, "a positive slope must climb toward +x"
    assert np.linalg.norm(d) == pytest.approx(1.0)
    assert np.linalg.norm(n) == pytest.approx(1.0)
    assert abs(float(d @ n)) < 1e-12, "direction and normal must be orthogonal"


def test_a_sloped_course_is_tilted_by_the_angle_it_declares():
    """The COMPILED body's rotation must agree with ramp_dir / ramp_normal.

    This is the test that earns its keep. MuJoCo reads `euler` in radians here,
    because the vendored MJCF declares <compiler angle="radian"> and the lane body
    inherits it. A degree value written straight into the attribute tilts the lane
    by 8 radians instead of 8 degrees — it compiles cleanly, `model.nu` is still
    14, and every hill-climb time is silently measured on the wrong slope. Only
    inspecting the compiled geometry catches that; asserting on the pure math
    functions in isolation never will.
    """
    m = load_event("sprint-2m")
    sloped = dataclasses.replace(m, course=dataclasses.replace(m.course, slope_deg=8.0))
    model = compile_course(sloped)
    assert model.nu == 14

    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    mujoco.mj_forward(model, data)

    rotation = data.geom_xmat[model.geom("floor").id].reshape(3, 3)
    # The floor's local +z is the surface normal, its local +x is up-lane.
    np.testing.assert_allclose(rotation @ [0.0, 0.0, 1.0], ramp_normal(8.0), atol=1e-6)
    np.testing.assert_allclose(rotation @ [1.0, 0.0, 0.0], ramp_dir(8.0), atol=1e-6)

    # The floor plane passes through the lane body's origin, so the signed
    # distance from it is normal . position. The duck must spawn above the ramp
    # surface, not buried in it.
    normal = rotation @ np.array([0.0, 0.0, 1.0])
    assert float(normal @ data.qpos[0:3]) == pytest.approx(SPAWN_HEIGHT_M, abs=1e-6)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_course.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.course'`

- [ ] **Step 3: Write the course builder**

`arena/course.py`:

```python
"""Build the MuJoCo model for an event.

Mirrors buildPhysicsXml() in the sandbox's app/src/game/game.js: strip visual
geoms, prune the meshes they were the only user of, pin the timestep, inject a
floor and a STAND keyframe. Differences, all deliberate: a lane instead of a
square arena, and no ball, props or terrain — nothing in an official run may
depend on scenery.
"""

import math
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

from .assets import ASSET_ROOT
from .constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from .manifest import Manifest

SPAWN_HEIGHT_M = 0.12  # matches the trunk_base pos in the vendored MJCF

RIG_XML = {
    "legs": ("legs", "robot_allcollisions.xml"),
    "rollers": ("rollers", "robot_allcollisions_rollers.xml"),
}

WALL_THICKNESS_M = 0.05


def ramp_dir(slope_deg: float) -> np.ndarray:
    """Unit vector up the lane. Progress along the course is a dot with this."""
    t = math.radians(slope_deg)
    return np.array([math.cos(t), 0.0, math.sin(t)])


def ramp_normal(slope_deg: float) -> np.ndarray:
    """Unit vector normal to the lane surface."""
    t = math.radians(slope_deg)
    return np.array([-math.sin(t), 0.0, math.cos(t)])


def _sub(parent: ET.Element, tag: str, **attrs) -> ET.Element:
    return ET.SubElement(parent, tag, {k: str(v) for k, v in attrs.items()})


def _strip_visuals(root: ET.Element) -> None:
    """Remove visual geoms, then the mesh assets nothing references any more.

    Visual meshes are irrelevant to the dynamics — every body carries an explicit
    <inertial>, and visual geoms are contype=0 conaffinity=0 — so dropping them
    cuts the assets dict from ~40 meshes to the ~10 the collision geoms use.
    """
    for parent in root.iter():
        for geom in [g for g in parent.findall("geom") if g.get("class") == "visual"]:
            parent.remove(geom)

    used = {g.get("mesh") for g in root.iter("geom") if g.get("mesh")}
    asset = root.find("asset")
    if asset is None:
        return
    for mesh in list(asset.findall("mesh")):
        name = mesh.get("name") or mesh.get("file", "").removesuffix(".stl")
        if name not in used:
            asset.remove(mesh)


def _inject_lane(root: ET.Element, manifest: Manifest) -> None:
    """Floor plus two side walls, inside one static rotated body.

    A static body (no joint) leaves qpos untouched, so tilting the whole lane for
    a hill climb costs nothing in the keyframe. The walls are the referee: with wz
    pinned to zero, a policy that pulls to one side scrubs speed against them, so
    straightness is part of the time rather than a separate rule.
    """
    course = manifest.course
    worldbody = root.find("worldbody")
    # euler is RADIANS here: the vendored MJCF declares <compiler angle="radian">,
    # which this body inherits. Writing the degree value straight in would tilt
    # the lane by 8 radians for slope_deg = 8 — geometry that compiles cleanly
    # and is completely wrong.
    pitch = -math.radians(course.slope_deg)
    lane = _sub(worldbody, "body", name="course", euler=f"0 {pitch} 0")

    _sub(lane, "geom", name="floor", type="plane", size="0 0 0.05", pos="0 0 0")

    half_t = WALL_THICKNESS_M / 2
    half_h = course.wall_height_m / 2
    half_len = course.length_m / 2 + 0.5  # overrun past the finish line
    y_off = course.width_m / 2 + half_t
    for name, y in (("wall_left", y_off), ("wall_right", -y_off)):
        _sub(
            lane,
            "geom",
            name=name,
            type="box",
            pos=f"{half_len - 0.5} {y} {half_h}",
            size=f"{half_len} {half_t} {half_h}",
        )


def _inject_keyframe(root: ET.Element, manifest: Manifest) -> None:
    """The STAND keyframe.

    qpos must cover every joint in document order: the 14 actuated hinges take
    DEFAULT_POSE by name, anything else (the roller rig's four passive wheels)
    starts at zero. Matching by name rather than position is what makes one
    keyframe builder work for both rigs.
    """
    slope = manifest.course.slope_deg
    spawn = ramp_normal(slope) * SPAWN_HEIGHT_M
    free = f"{spawn[0]} {spawn[1]} {spawn[2]} 1 0 0 0"

    pose_by_name = dict(zip(JOINT_NAMES, DEFAULT_POSE))
    worldbody = root.find("worldbody")
    joints = [pose_by_name.get(j.get("name"), 0.0) for j in worldbody.iter("joint")]

    keyframe = _sub(root, "keyframe")
    _sub(
        keyframe,
        "key",
        name=manifest.start.keyframe,
        qpos=free + " " + " ".join(str(v) for v in joints),
        ctrl=" ".join(str(v) for v in DEFAULT_POSE),
    )


def build_course_xml(manifest: Manifest) -> tuple[str, dict[str, bytes]]:
    rig_dir, xml_name = RIG_XML[manifest.rig]
    robot_dir = ASSET_ROOT / "robot" / rig_dir
    root = ET.parse(robot_dir / xml_name).getroot()

    _strip_visuals(root)

    # meshdir is cleared so the assets dict can be keyed by bare filename.
    compiler = root.find("compiler")
    compiler.set("meshdir", "")

    _sub(root, "option", timestep=TIMESTEP)
    _inject_lane(root, manifest)
    _inject_keyframe(root, manifest)

    asset = root.find("asset")
    files = [m.get("file") for m in asset.findall("mesh")]
    assets = {f: (robot_dir / "assets" / f).read_bytes() for f in files}

    return ET.tostring(root, encoding="unicode"), assets


def compile_course(manifest: Manifest) -> mujoco.MjModel:
    xml, assets = build_course_xml(manifest)
    return mujoco.MjModel.from_xml_string(xml, assets)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run --extra dev pytest tests/test_course.py -v`
Expected: PASS, 9 tests

Two things that can go wrong here:

- **A keyframe size mismatch** means the injected `qpos` does not cover every joint. Print `model.nq` and compare against `7 + len(list(worldbody.iter("joint")))`.
- **`model.key("STAND")` raising `KeyError`** means this `mujoco` version does not expose keyframes under that named accessor. Fall back to `mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")` in both the test and `_Addresses.of` in Task 6.

- [ ] **Step 5: Commit**

```bash
git add arena/course.py tests/test_course.py
git commit -m "Build a lane course from a manifest, mirroring the sandbox MJCF surgery

A static rotated body holds floor and walls, so a hill climb is one manifest
field and the keyframe never changes."
```

---

### Task 5: Policy loading and shape validation

The check that makes a rejection a diagnosis. Worded exactly as `robotd` words it at load, so a policy the Arena rejects would have been rejected by the robot in the same sentence.

**Files:**
- Create: `arena/policy.py`
- Test: `tests/test_policy.py`

**Interfaces:**
- Consumes: `arena.constants`
- Produces:
  - `class PolicyError(Exception)`
  - `@dataclass Policy: session: ort.InferenceSession, sha256: str, _input_name: str, _output_name: str`, with method `act(obs: np.ndarray) -> np.ndarray` returning `(14,)` float32. Later tasks only ever call `.act()` and read `.sha256`.
  - `load_policy(path) -> Policy`
  - `MAX_MODEL_BYTES = 4 * 1024 * 1024`

- [ ] **Step 1: Write the failing test**

`tests/test_policy.py`:

```python
import contextlib

import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import NUM_JOINTS, OBS_SIZE
from arena.policy import MAX_MODEL_BYTES, PolicyError, _width, load_policy

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"


def test_reference_policy_loads_and_acts():
    policy = load_policy(REFERENCE)
    action = policy.act(np.zeros(OBS_SIZE, dtype=np.float32))
    assert action.shape == (NUM_JOINTS,)
    assert np.all(np.isfinite(action))


def test_sha256_is_stable():
    assert load_policy(REFERENCE).sha256 == load_policy(REFERENCE).sha256
    assert len(load_policy(REFERENCE).sha256) == 64


def test_wrong_observation_width_is_named_precisely(tmp_path):
    # The 51-D family is a real mistake people make: same sensors, the legacy
    # 3-value command instead of the unified 13-value one.
    model = _make_onnx(tmp_path / "legacy.onnx", obs_width=51, action_width=14)
    with pytest.raises(PolicyError, match=r"observation width is 51, expected 61"):
        load_policy(model)


def test_wrong_action_width_is_named_precisely(tmp_path):
    model = _make_onnx(tmp_path / "wide.onnx", obs_width=61, action_width=20)
    with pytest.raises(PolicyError, match=r"action width is 20, expected 14"):
        load_policy(model)


def test_oversize_model_is_rejected(tmp_path):
    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    with pytest.raises(PolicyError, match="larger than"):
        load_policy(fat)


def test_garbage_is_rejected(tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    with pytest.raises(PolicyError, match="not a loadable ONNX model"):
        load_policy(junk)


def test_a_missing_file_is_rejected_not_crashed(tmp_path):
    """A path that does not exist is a rejection, not a FileNotFoundError."""
    with pytest.raises(PolicyError, match="cannot read the model file"):
        load_policy(tmp_path / "does-not-exist.onnx")


def test_a_dynamic_batch_axis_is_accepted(tmp_path):
    """A symbolic batch dimension is an unknown width, not a wrong one.

    Rejecting it would turn away perfectly ordinary exports, since most training
    pipelines emit a dynamic batch axis.
    """
    model = _make_onnx(tmp_path / "dyn.onnx", 61, 14, dynamic_batch=True)
    policy = load_policy(model)
    assert policy.act(np.zeros(OBS_SIZE, dtype=np.float32)).shape == (NUM_JOINTS,)


def test_width_reads_an_unknown_axis_as_unknown_rather_than_erroring():
    """The guard that keeps an IndexError from escaping load_policy.

    onnxruntime's lenient shape merge can hand back an EMPTY shape when a graph's
    declared output shape conflicts with the inferred one. Whether any particular
    malformed model triggers that depends on the onnxruntime version, so the
    guard is pinned here directly instead of through a fixture that may quietly
    stop reproducing it on an upgrade. Without the guard, the first case raises
    IndexError.
    """
    assert _width([]) is None
    assert _width([1, 61]) == 61
    assert _width(["batch", 61]) == 61
    assert _width(["batch"]) is None
    assert _width([1, 61], axis=5) is None


def test_a_one_dimensional_input_does_not_crash_the_loader(tmp_path):
    """A smoke test over the whole loader for an odd but well-formed graph.

    This module is the front door for untrusted files, so the loader must answer
    with a Policy or a PolicyError and never a raw exception — any other
    exception type escaping this block fails the test. Note this fixture does not
    necessarily exercise the empty-shape path; which graphs trigger that is an
    onnxruntime implementation detail. The direct guarantee lives in
    test_width_reads_an_unknown_axis_as_unknown_rather_than_erroring.
    """
    model = _make_onnx(tmp_path / "flat.onnx", 61, 14, flat_input=True)
    with contextlib.suppress(PolicyError):
        load_policy(model)


def _make_onnx(path, obs_width, action_width, dynamic_batch=False, flat_input=False):
    """A minimal valid ONNX graph with the given input/output widths."""
    import onnx
    from onnx import TensorProto, helper

    weight = helper.make_tensor(
        "w",
        TensorProto.FLOAT,
        [obs_width, action_width],
        np.zeros(obs_width * action_width, dtype=np.float32).tolist(),
    )
    node = helper.make_node("MatMul", ["obs", "w"], ["actions"])
    if flat_input:
        in_shape, out_shape = [obs_width], [action_width]
    elif dynamic_batch:
        in_shape, out_shape = ["batch", obs_width], ["batch", action_width]
    else:
        in_shape, out_shape = [1, obs_width], [1, action_width]
    graph = helper.make_graph(
        [node],
        "tiny",
        [helper.make_tensor_value_info("obs", TensorProto.FLOAT, in_shape)],
        [helper.make_tensor_value_info("actions", TensorProto.FLOAT, out_shape)],
        [weight],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)])
    onnx.save(model, str(path))
    return path
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_policy.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.policy'`

- [ ] **Step 3: Write the policy loader**

`arena/policy.py`:

```python
"""Load a submitted policy, or say precisely why not.

The shape check is the same one robotd does at load, worded the same way. A
policy the Arena rejects would have been rejected by the robot, in the same
sentence — and getting that sentence back in two seconds is most of what a
newcomer experiences here.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort

from .constants import NUM_JOINTS, OBS_SIZE

MAX_MODEL_BYTES = 4 * 1024 * 1024


class PolicyError(Exception):
    """A submitted model cannot be used, with a reason fit to show a human."""


@dataclass
class Policy:
    session: ort.InferenceSession
    sha256: str
    _input_name: str
    _output_name: str

    def act(self, obs: np.ndarray) -> np.ndarray:
        feeds = {self._input_name: obs.reshape(1, OBS_SIZE).astype(np.float32)}
        out = self.session.run([self._output_name], feeds)[0]
        return np.asarray(out, dtype=np.float32).reshape(NUM_JOINTS)


def _width(shape, axis=-1):
    """The size of one axis, or None when it is not a concrete integer.

    Two different things mean "unknown", and neither is grounds for rejecting a
    model: a symbolic batch axis arrives as a string rather than an int, and
    onnxruntime's shape inference can hand back an EMPTY shape when a graph's
    declared output shape conflicts with the inferred one. Indexing an empty
    shape is how this function used to raise IndexError out of load_policy.
    """
    if not shape or not (-len(shape) <= axis < len(shape)):
        return None
    value = shape[axis]
    return value if isinstance(value, int) else None


def load_policy(path: Path) -> Policy:
    path = Path(path)
    try:
        size = path.stat().st_size
    except OSError as exc:
        # Every exit from this function has to be a PolicyError: a submitted path
        # that does not exist must read as a rejection, not a traceback.
        raise PolicyError(f"cannot read the model file: {exc}") from exc
    if size > MAX_MODEL_BYTES:
        raise PolicyError(f"model is {size} bytes, larger than the {MAX_MODEL_BYTES} byte limit")

    options = ort.SessionOptions()
    options.log_severity_level = 3
    try:
        session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    except Exception as exc:  # onnxruntime raises a variety of types here
        raise PolicyError(f"not a loadable ONNX model: {exc}") from exc

    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1:
        raise PolicyError(f"model takes {len(inputs)} inputs, expected 1")
    if len(outputs) != 1:
        raise PolicyError(f"model returns {len(outputs)} outputs, expected 1")

    obs_width = _width(inputs[0].shape)
    if obs_width is not None and obs_width != OBS_SIZE:
        raise PolicyError(f"observation width is {obs_width}, expected {OBS_SIZE}")

    action_width = _width(outputs[0].shape)
    if action_width is not None and action_width != NUM_JOINTS:
        raise PolicyError(f"action width is {action_width}, expected {NUM_JOINTS}")

    return Policy(
        session=session,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        _input_name=inputs[0].name,
        _output_name=outputs[0].name,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run --extra dev pytest tests/test_policy.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add arena/policy.py tests/test_policy.py
git commit -m "Reject a bad policy with the sentence robotd already uses"
```

---

### Task 6: The runner — one policy, one event, one seed

Deliberately narrow: no queue, no storage, no HTTP. That narrowness is what makes the determinism and golden-run tests possible.

**Files:**
- Create: `arena/runner.py`
- Test: `tests/test_runner.py`

**Interfaces:**
- Consumes: `arena.constants`, `arena.course`, `arena.manifest.Manifest`, `arena.policy.Policy`
- Produces:
  - `@dataclass(frozen=True) RunOutcome: seed: int, status: str, time_s: float | None, progress_m: float, start_progress_m: float, trace: np.ndarray`
    - `start_progress_m` is where the start line landed in course coordinates, after settling. Exposed so a test can assert the clock and the start line agree.
    - `status` is one of `"finish"`, `"fall"`, `"timeout"`
    - `time_s` is set only when `status == "finish"`
    - `trace` is `(frames, 21)` float32
  - `run_once(manifest, policy, seed, model=None) -> RunOutcome`
  - `seed_rng(event_id, seed) -> np.random.Generator`

- [ ] **Step 1: Write the failing test**

`tests/test_runner.py`:

```python
import dataclasses

import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, TRACE_WIDTH
from arena.course import compile_course, ramp_dir
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once, seed_rng

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"


@pytest.fixture(scope="module")
def sprint():
    return load_event("sprint-2m")


@pytest.fixture(scope="module")
def walker():
    return load_policy(REFERENCE)


def test_seed_rng_is_stable_across_processes(sprint):
    # Must NOT depend on hash(), which is salted per process.
    a = seed_rng("sprint-2m", 1).standard_normal(4)
    b = seed_rng("sprint-2m", 1).standard_normal(4)
    np.testing.assert_array_equal(a, b)


def test_seed_rng_differs_by_seed_and_by_event():
    same_event = seed_rng("sprint-2m", 1).standard_normal(4)
    other_seed = seed_rng("sprint-2m", 2).standard_normal(4)
    other_event = seed_rng("roller-sprint-2m", 1).standard_normal(4)
    assert not np.array_equal(same_event, other_seed)
    assert not np.array_equal(same_event, other_event)


def test_reference_policy_finishes_the_sprint(sprint, walker):
    outcome = run_once(sprint, walker, seed=1)
    assert outcome.status == "finish", f"walker did not finish: {outcome.status}"
    assert outcome.time_s is not None
    # The reference walker tracks about 44% of its commanded 0.25 m/s, so 2 m
    # takes it roughly 18.5 s. The band is wide enough not to be brittle and
    # tight enough that a broken observation layout cannot pass it.
    assert 10.0 < outcome.time_s < 30.0


def test_trace_shape_matches_the_clock(sprint, walker):
    outcome = run_once(sprint, walker, seed=1)
    assert outcome.trace.ndim == 2
    assert outcome.trace.shape[1] == TRACE_WIDTH
    assert outcome.trace.shape[0] == pytest.approx(outcome.time_s / CTRL_DT, abs=1)
    assert outcome.trace.dtype == np.float32


def test_the_run_is_deterministic(sprint, walker):
    first = run_once(sprint, walker, seed=3)
    second = run_once(sprint, walker, seed=3)
    assert first.status == second.status
    assert first.time_s == second.time_s
    np.testing.assert_array_equal(first.trace, second.trace)


def test_different_seeds_give_different_traces(sprint, walker):
    a = run_once(sprint, walker, seed=1)
    b = run_once(sprint, walker, seed=2)
    assert not np.array_equal(a.trace, b.trace), "perturbation had no effect"


def test_a_fall_beats_a_finish_on_the_same_step(sprint, walker):
    """A robot already collapsing does not get credited with the win.

    Crafted so both conditions are true on the very first clocked step, which is
    the only way to test the precedence deterministically: fall_gravity_z = -1.5
    sits above the upright value (about -1.0), so the robot counts as tipped from
    the first step; fall_hold_s = 0 removes the debounce; and length_m = 0 puts
    the finish line under its feet. The order of the two checks is then the only
    thing that decides the outcome — this test returns "finish" if they are
    swapped back.
    """
    both = dataclasses.replace(
        sprint,
        course=dataclasses.replace(sprint.course, length_m=0.0),
        termination=dataclasses.replace(
            sprint.termination, fall_gravity_z=-1.5, fall_hold_s=0.0
        ),
    )
    outcome = run_once(both, walker, seed=1)
    assert outcome.status == "fall"
    assert outcome.time_s is None


def test_a_limp_policy_falls(sprint):
    """A policy that commands the zero action collapses; that must be a fall."""
    outcome = run_once(sprint, _ZeroPolicy(), seed=1)
    assert outcome.status == "fall"
    assert outcome.time_s is None
    assert outcome.progress_m < sprint.course.length_m


def test_an_unreachable_finish_line_times_out(sprint, walker):
    long_course = dataclasses.replace(
        sprint,
        course=dataclasses.replace(sprint.course, length_m=500.0),
        time_limit_s=3.0,
    )
    outcome = run_once(long_course, walker, seed=1)
    assert outcome.status == "timeout"
    assert outcome.time_s is None
    assert outcome.trace.shape[0] == pytest.approx(3.0 / CTRL_DT, abs=1)


def test_the_clock_starts_on_the_start_line(sprint, walker):
    """The first clocked frame sits on the start line.

    Note the duck is already moving by then: the pinned forward command runs
    during the settle, so it has walked ~10 cm before the clock starts. The start
    line is therefore defined where it *is* at that moment, not at the world
    origin — which is exactly what start_progress_m records.
    """
    outcome = run_once(sprint, walker, seed=1)
    direction = ramp_dir(sprint.course.slope_deg)
    first_frame = float(direction @ outcome.trace[0, :3])
    # One control step of travel at most, since the frame is recorded after a step.
    assert abs(first_frame - outcome.start_progress_m) < 0.02


def test_a_longer_settle_does_not_inflate_the_time(sprint, walker):
    """Settling is not timed, so extending it must not change the recorded time.

    Both runs enter the clocked phase already at walking speed from their own
    start line, so the times should agree closely. If settling were timed, the
    longer settle would add its extra 1.5 s to the clock.
    """
    long_settle = dataclasses.replace(
        sprint, start=dataclasses.replace(sprint.start, settle_s=2.0)
    )
    brief = run_once(sprint, walker, seed=1)
    extended = run_once(long_settle, walker, seed=1)
    assert brief.status == extended.status == "finish"
    assert extended.time_s == pytest.approx(brief.time_s, rel=0.25)


def test_model_can_be_supplied_to_avoid_recompiling(sprint, walker):
    model = compile_course(sprint)
    a = run_once(sprint, walker, seed=1, model=model)
    b = run_once(sprint, walker, seed=1)
    assert a.time_s == b.time_s


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(14, dtype=np.float32)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.runner'`

- [ ] **Step 3: Write the runner**

`arena/runner.py`:

```python
"""Run one policy, on one event, at one seed.

No queue, no storage, no HTTP: this narrowness is what makes the determinism and
golden-run tests possible, and those tests are the only thing standing between a
physics change and a silently invalidated leaderboard.

The loop is the sandbox's controlStep(), verbatim in effect: build the 61-D
observation, run the policy, write ctrl = DEFAULT_POSE + action, step physics
four times.
"""

import zlib
from dataclasses import dataclass

import mujoco
import numpy as np

from .constants import (
    ACTION_SCALE,
    CTRL_DT,
    DECIMATION,
    DEFAULT_POSE,
    JOINT_NAMES,
    NUM_JOINTS,
    OBS_SIZE,
    TRACE_WIDTH,
)
from .course import compile_course, ramp_dir
from .manifest import Manifest

_WORLD_DOWN = np.array([0.0, 0.0, -1.0])


@dataclass(frozen=True)
class RunOutcome:
    seed: int
    status: str  # "finish" | "fall" | "timeout"
    time_s: float | None
    progress_m: float
    # Where the start line landed in course coordinates, after settling. Exposed
    # so a test can assert the clock and the start line agree.
    start_progress_m: float
    trace: np.ndarray  # (frames, TRACE_WIDTH) float32


@dataclass(frozen=True)
class _Addresses:
    qpos: np.ndarray
    dof: np.ndarray
    gyro: int
    trunk: int
    stand_key: int

    @classmethod
    def of(cls, model, keyframe: str) -> "_Addresses":
        return cls(
            qpos=np.array([int(model.joint(n).qposadr[0]) for n in JOINT_NAMES]),
            dof=np.array([int(model.joint(n).dofadr[0]) for n in JOINT_NAMES]),
            gyro=int(model.sensor("imu_ang_vel").adr[0]),
            trunk=int(model.body("trunk_base").id),
            stand_key=int(model.key(keyframe).id),
        )


def seed_rng(event_id: str, seed: int) -> np.random.Generator:
    """A generator that is identical in every process.

    Python's hash() is salted per process, so it must never appear here: a run
    that is not reproducible cannot be verified, and verification is the whole
    point of running server-side.
    """
    return np.random.default_rng([zlib.crc32(event_id.encode()), seed])


def _observe(model, data, adr, last_action, command) -> np.ndarray:
    obs = np.empty(OBS_SIZE, dtype=np.float32)
    obs[0:3] = data.sensordata[adr.gyro : adr.gyro + 3]
    # Projected gravity: world -z rotated into the trunk frame. xmat is
    # body->world, so its transpose takes a world vector into the body frame.
    rotation = data.xmat[adr.trunk].reshape(3, 3)
    obs[3:6] = rotation.T @ _WORLD_DOWN
    obs[6:20] = data.qpos[adr.qpos] - DEFAULT_POSE
    obs[20:34] = data.qvel[adr.dof]
    obs[34:48] = last_action
    obs[48:61] = command
    return obs


def _perturb(model, data, adr, manifest, seed) -> None:
    rng = seed_rng(manifest.id, seed)
    start = manifest.start
    data.qpos[adr.qpos] += rng.uniform(-start.joint_rad, start.joint_rad, NUM_JOINTS)
    yaw = np.radians(rng.uniform(-start.yaw_deg, start.yaw_deg))
    data.qpos[3:7] = [np.cos(yaw / 2), 0.0, 0.0, np.sin(yaw / 2)]
    mujoco.mj_forward(model, data)


def _step(model, data, policy, adr, command, last_action) -> np.ndarray:
    obs = _observe(model, data, adr, last_action, command)
    action = policy.act(obs)
    data.ctrl[:] = DEFAULT_POSE + action * ACTION_SCALE
    for _ in range(DECIMATION):
        mujoco.mj_step(model, data)
    return action


def run_once(manifest: Manifest, policy, seed: int, model=None) -> RunOutcome:
    model = model if model is not None else compile_course(manifest)
    data = mujoco.MjData(model)
    adr = _Addresses.of(model, manifest.start.keyframe)

    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    _perturb(model, data, adr, manifest, seed)

    # Converted once per run, not per step. The manifest holds an immutable tuple
    # so a loaded event cannot be mutated in place by anything downstream.
    command = np.asarray(manifest.command, dtype=np.float64)
    last_action = np.zeros(NUM_JOINTS, dtype=np.float32)

    # Settle with the policy running and the clock stopped: nobody is timed on
    # standing up.
    for _ in range(round(manifest.start.settle_s / CTRL_DT)):
        last_action = _step(model, data, policy, adr, command, last_action)

    direction = ramp_dir(manifest.course.slope_deg)
    start_progress = float(direction @ data.qpos[0:3])
    max_steps = round(manifest.time_limit_s / CTRL_DT)
    fall_steps_needed = round(manifest.termination.fall_hold_s / CTRL_DT)

    frames = np.empty((max_steps, TRACE_WIDTH), dtype=np.float32)
    tipped_for = 0
    status = "timeout"
    time_s = None
    progress = 0.0
    written = 0

    for step in range(max_steps):
        last_action = _step(model, data, policy, adr, command, last_action)

        frames[written, 0:3] = data.qpos[0:3]
        frames[written, 3:7] = data.qpos[3:7]
        frames[written, 7:TRACE_WIDTH] = data.qpos[adr.qpos]
        written += 1

        if not np.all(np.isfinite(data.qpos)):
            status = "fall"  # a solver explosion is a fall, not a mystery
            break

        # Fall is judged BEFORE finish, and the order matters. Reaching the fall
        # branch means the robot has been tipped for fall_hold_s — 0.3 s, fifteen
        # straight steps — so a step where both fire is a robot that was already
        # collapsing and slid over the line. That is not a win.
        #
        # This does not penalise a sprinter falling past the tape: such a robot
        # has tipped_for == 0 at the crossing step, so finish still wins there.
        rotation = data.xmat[adr.trunk].reshape(3, 3)
        gravity_z = float((rotation.T @ _WORLD_DOWN)[2])
        tipped_for = tipped_for + 1 if gravity_z > manifest.termination.fall_gravity_z else 0
        if tipped_for >= fall_steps_needed:
            status = "fall"
            break

        progress = float(direction @ data.qpos[0:3]) - start_progress
        if progress >= manifest.course.length_m:
            status = "finish"
            time_s = (step + 1) * CTRL_DT
            break

    return RunOutcome(
        seed=seed,
        status=status,
        time_s=time_s,
        progress_m=progress,
        start_progress_m=start_progress,
        trace=frames[:written].copy(),
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run --extra dev pytest tests/test_runner.py -v`
Expected: PASS, 10 tests

If `test_reference_policy_finishes_the_sprint` fails with `status == "fall"`, the observation layout is wrong — the most likely culprits are the projected-gravity transpose and the `qpos - DEFAULT_POSE` offset. Print `obs[3:6]` on the first step: standing upright it must be close to `[0, 0, -1]`.

- [ ] **Step 5: Commit**

```bash
git add arena/runner.py tests/test_runner.py
git commit -m "Run one policy, one event, one seed — deterministically

crc32 rather than hash() for the seed: hash() is salted per process, and a run
that cannot be reproduced cannot be verified."
```

---

### Task 7: Timing probe — the gate on synchronous feedback

The spec's claim that a run is sub-second is load-bearing: it is what makes five seeds affordable and lets a submission return a time instead of a queue ticket. **Measure it, record the number, and stop if it is wrong.**

**Files:**
- Create: `scripts/probe_timing.py`
- Create: `docs/probe-results.md`
- Test: none (this is a measurement, not a behaviour)

**Interfaces:**
- Consumes: `arena.runner.run_once`, `arena.course.compile_course`, `arena.policy.load_policy`
- Produces: `docs/probe-results.md` — the measured numbers, committed

- [ ] **Step 1: Write the probe**

`scripts/probe_timing.py`:

```python
"""Measure what an official run costs.

The spec bets that a run is sub-second, which is what makes five seeds per entry
affordable and lets a submission return a verified time synchronously. If that
bet is wrong, the platform plan changes shape: submissions become a queue the
frontend polls. So this runs before any of that is built.
"""

import json
import statistics
import sys
import time

from arena.assets import ASSET_ROOT
from arena.course import compile_course
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once


def main() -> int:
    manifest = load_event("sprint-2m")

    t0 = time.perf_counter()
    model = compile_course(manifest)
    compile_s = time.perf_counter() - t0

    t0 = time.perf_counter()
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    load_s = time.perf_counter() - t0

    per_seed = []
    for seed in manifest.seeds:
        t0 = time.perf_counter()
        outcome = run_once(manifest, policy, seed, model=model)
        elapsed = time.perf_counter() - t0
        per_seed.append({
            "seed": seed,
            "wall_s": round(elapsed, 4),
            "status": outcome.status,
            "sim_time_s": outcome.time_s,
            "steps": int(outcome.trace.shape[0]),
        })
        print(f"seed {seed}: {elapsed:.3f}s wall, {outcome.status}, sim {outcome.time_s}")

    walls = [r["wall_s"] for r in per_seed]
    summary = {
        "compile_course_s": round(compile_s, 4),
        "load_policy_s": round(load_s, 4),
        "per_seed": per_seed,
        "mean_run_wall_s": round(statistics.mean(walls), 4),
        "total_entry_wall_s": round(compile_s + load_s + sum(walls), 4),
    }
    print(json.dumps(summary, indent=2))

    verdict = "SYNCHRONOUS OK" if summary["total_entry_wall_s"] < 10.0 else "NEEDS A QUEUE"
    print(f"\nverdict: {verdict} (a full 5-seed entry takes "
          f"{summary['total_entry_wall_s']:.2f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run the probe**

Run: `uv run python scripts/probe_timing.py`
Expected: five per-seed lines, a JSON summary, and a verdict line.

- [ ] **Step 3: Record the numbers**

Write `docs/probe-results.md` with the actual measured output — the JSON summary pasted in, the machine it ran on (`uname -srm`, CPU model from `lscpu | grep 'Model name'`), and one paragraph answering: **does a five-seed entry complete fast enough to return synchronously?**

Use this structure, filling in real numbers:

```markdown
# Timing probe results

Measured with `scripts/probe_timing.py` on <date>.

Machine: <uname -srm>, <CPU model>

<the JSON summary, verbatim>

## Verdict

A full five-seed entry takes <N> s wall-clock, of which <M> s is <the dominant
term>. Submissions <can / cannot> return a verified time synchronously, so the
platform plan <keeps the direct submit flow / needs a job queue the frontend
polls>.

## What this does NOT measure

State the limits of the measurement explicitly. The platform plan is designed
from this document, so an unstated gap here becomes a wrong assumption there.

- **The Hub model fetch is absent.** The probe loads a policy already on local
  disk. In production a submitter's model is downloaded from a model repo, and
  the design spec predicted that download would dominate wall clock. Give a
  rough allowance for it (an 800 KB file plus API round-trips) and say whether
  the verdict survives once it is added.
- **The hardware is not the target.** These numbers come from the developer
  workstation named above. Production is a Hugging Face free-tier CPU Space of
  roughly 2 vCPU. Give a rough slowdown factor and say whether the verdict
  survives that too.
- **Conclusion under both.** Add the two allowances to the measured figure and
  restate the verdict against the ~10 s threshold. If the margin still holds,
  say so with the arithmetic; if it does not, that is the real result and it
  changes the next plan.
```

- [ ] **Step 4: Decide, out loud**

If a five-seed entry takes **under ~10 s**, the spec stands: record that and continue.

If it is **slower**, stop and report it before continuing. Two knobs, in preference order: drop `seeds` to 3 in the manifest (cheapest, costs some fairness), or move evaluation behind a queue (correct, and changes the platform plan). Either way it is a decision for the human partner, not a silent adjustment — note it and ask.

- [ ] **Step 5: Commit**

```bash
git add scripts/probe_timing.py docs/probe-results.md
git commit -m "Measure what a run costs, before betting the UI on it"
```

---

### Task 8: Evaluate — all seeds, and the score

**Files:**
- Create: `arena/evaluate.py`
- Test: `tests/test_evaluate.py`

**Interfaces:**
- Consumes: `arena.runner.RunOutcome`, `arena.runner.run_once`, `arena.course.compile_course`, `arena.manifest.Manifest`
- Produces:
  - `@dataclass(frozen=True) SeedResult: seed: int, status: str, time_s: float | None`
  - `@dataclass(frozen=True) Evaluation: event_id: str, score: float, seeds_finished: int, per_seed: tuple[SeedResult, ...], trace: np.ndarray, trace_seed: int, runner_version: int`
  - `evaluate(manifest, policy) -> Evaluation`
  - `mean_finish_time(per_seed, time_limit_s) -> float`
  - `pick_trace_seed(per_seed) -> int`

- [ ] **Step 1: Write the failing test**

`tests/test_evaluate.py`:

```python
import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import RUNNER_VERSION
from arena.evaluate import SeedResult, evaluate, mean_finish_time, pick_trace_seed
from arena.manifest import load_event
from arena.policy import load_policy


def _results(*pairs):
    return tuple(
        SeedResult(seed=s, status="finish" if t is not None else "fall", time_s=t)
        for s, t in pairs
    )


def test_mean_counts_a_dnf_at_the_time_limit():
    per_seed = _results((1, 20.0), (2, 20.0), (3, None))
    # (20 + 20 + 45) / 3
    assert mean_finish_time(per_seed, 45.0) == pytest.approx(85.0 / 3)


def test_mean_of_all_finishers_is_the_plain_mean():
    assert mean_finish_time(_results((1, 10.0), (2, 20.0)), 45.0) == pytest.approx(15.0)


def test_a_steady_policy_beats_a_brilliant_flaky_one():
    """The property the whole five-seed design exists to produce.

    Note the flaky times are 20.0, not 15.0: at 15.0 the two means are exactly
    equal ((15+15+45)/3 == 25.0), because t = 15 is precisely the break-even
    point for this limit and seed count. Sitting on that boundary made the
    assertion unsatisfiable.
    """
    steady = mean_finish_time(_results((1, 25.0), (2, 25.0), (3, 25.0)), 45.0)
    flaky = mean_finish_time(_results((1, 20.0), (2, 20.0), (3, None)), 45.0)
    assert steady < flaky


def test_trace_seed_is_the_lower_median_finisher():
    # Finishers 10, 20, 30 -> median 20 -> seed 2.
    assert pick_trace_seed(_results((1, 10.0), (2, 20.0), (3, 30.0))) == 2
    # Even count 10, 20 -> the faster of the middle two -> seed 1.
    assert pick_trace_seed(_results((1, 10.0), (2, 20.0))) == 1
    # Non-finishers are ignored when choosing.
    assert pick_trace_seed(_results((1, None), (2, 20.0), (3, 30.0))) == 2


def test_trace_seed_falls_back_to_the_first_seed_when_nobody_finishes():
    assert pick_trace_seed(_results((7, None), (8, None))) == 7


def test_evaluating_the_reference_policy_scores_and_carries_a_trace():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)

    assert result.event_id == "sprint-2m"
    assert len(result.per_seed) == len(manifest.seeds)
    assert 0 <= result.seeds_finished <= len(manifest.seeds)
    assert result.runner_version == RUNNER_VERSION
    assert result.trace.shape[1] == 21
    assert result.trace_seed in manifest.seeds
    assert result.score == pytest.approx(
        mean_finish_time(result.per_seed, manifest.time_limit_s)
    )


def test_evaluate_is_deterministic():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    first, second = evaluate(manifest, policy), evaluate(manifest, policy)
    assert first.score == second.score
    assert first.per_seed == second.per_seed
    np.testing.assert_array_equal(first.trace, second.trace)


def test_golden_run_reference_policy_holds_its_time():
    """Guards against a physics or harness change silently invalidating the board.

    If this fails, either the change was intended — bump RUNNER_VERSION and
    re-baseline this number in the same commit — or it is a regression. It must
    never be adjusted casually: every recorded time depends on it.
    """
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)
    assert result.seeds_finished == len(manifest.seeds), "the walker should finish every seed"
    assert result.score == pytest.approx(GOLDEN_SCORE_S, rel=0.02)


# Baseline: fill in from the first green run of test_evaluate_scores... and record
# the RUNNER_VERSION it was measured at in the commit message.
GOLDEN_SCORE_S = 0.0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_evaluate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.evaluate'`

- [ ] **Step 3: Write the evaluator**

`arena/evaluate.py`:

```python
"""Score an entry over every seed.

One run is a coin toss, so an entry is five. A DNF counts at the full time limit,
which makes flakiness cost proportionally instead of hiding behind a best-of: a
policy that is brilliant four times and falls once ranks below a steady one.
"""

import statistics
from dataclasses import dataclass

import numpy as np

from .constants import RUNNER_VERSION
from .course import compile_course
from .manifest import Manifest
from .runner import run_once


@dataclass(frozen=True)
class SeedResult:
    seed: int
    status: str
    time_s: float | None


@dataclass(frozen=True)
class Evaluation:
    event_id: str
    score: float
    seeds_finished: int
    per_seed: tuple[SeedResult, ...]
    trace: np.ndarray
    trace_seed: int
    runner_version: int


def mean_finish_time(per_seed: tuple[SeedResult, ...], time_limit_s: float) -> float:
    return statistics.fmean(
        r.time_s if r.time_s is not None else time_limit_s for r in per_seed
    )


METRICS = {"mean_finish_time": mean_finish_time}


def pick_trace_seed(per_seed: tuple[SeedResult, ...]) -> int:
    """The lower-median finishing seed.

    Median rather than best, so a replay lane shows typical behaviour and every
    entry's replay is chosen the same way. With no finishers at all we keep the
    first seed's trace: a failed entry should still be watchable.
    """
    finishers = sorted(
        (r for r in per_seed if r.time_s is not None), key=lambda r: (r.time_s, r.seed)
    )
    if not finishers:
        return per_seed[0].seed
    return finishers[(len(finishers) - 1) // 2].seed


def evaluate(manifest: Manifest, policy) -> Evaluation:
    model = compile_course(manifest)  # compiled once, reused for every seed

    outcomes = [run_once(manifest, policy, seed, model=model) for seed in manifest.seeds]
    per_seed = tuple(
        SeedResult(seed=o.seed, status=o.status, time_s=o.time_s) for o in outcomes
    )

    trace_seed = pick_trace_seed(per_seed)
    trace = next(o.trace for o in outcomes if o.seed == trace_seed)

    return Evaluation(
        event_id=manifest.id,
        score=METRICS[manifest.metric](per_seed, manifest.time_limit_s),
        seeds_finished=sum(1 for r in per_seed if r.status == "finish"),
        per_seed=per_seed,
        trace=trace,
        trace_seed=trace_seed,
        runner_version=RUNNER_VERSION,
    )
```

- [ ] **Step 4: Run the tests, then baseline the golden run**

Run: `uv run --extra dev pytest tests/test_evaluate.py -v`
Expected: 7 tests PASS, `test_golden_run_reference_policy_holds_its_time` FAILS against the `0.0` placeholder.

Read the real score from the failure message, set `GOLDEN_SCORE_S` to it, and re-run.

Run: `uv run --extra dev pytest tests/test_evaluate.py -v`
Expected: PASS, 8 tests

If the walker does not finish all five seeds, do not loosen the assertion — that is the signal the observation or the course is wrong, and it is worth more than a green test.

- [ ] **Step 5: Commit**

```bash
git add arena/evaluate.py tests/test_evaluate.py
git commit -m "Score an entry over five seeds, DNF at the time limit

Includes the golden-run baseline for BEST_alpha_walking at RUNNER_VERSION 1:
the tripwire for a physics change that would invalidate every recorded time."
```

---

### Task 9: Trace codec and the run store

Append-only: one immutable write per run, so two simultaneous submissions never contend and no locking is needed. A local-filesystem backend keeps the tests fast and offline; the Hub backend is the same interface.

**Files:**
- Create: `arena/trace.py`
- Create: `arena/store.py`
- Test: `tests/test_trace.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: `arena.evaluate.Evaluation`, `arena.constants`
- Produces:
  - `arena.trace.encode(trace: np.ndarray) -> bytes` (float16 npz)
  - `arena.trace.decode(blob: bytes) -> np.ndarray` (float32)
  - `@dataclass(frozen=True) RunRecord` with fields `run_id, event_id, submitted_at, user, policy_name, source, model_sha256, score, seeds_finished, per_seed, trace_seed, runner_version` and methods `to_dict()` / `from_dict(d)`
  - `new_run_id() -> str`
  - `class Store(Protocol)` with `append(record, trace_blob)`, `runs(event_id) -> list[RunRecord]`, `trace(run_id) -> bytes`
  - `LocalStore(root: Path)`
  - `HubStore(repo_id: str, token: str | None)`

- [ ] **Step 1: Write the failing trace test**

`tests/test_trace.py`:

```python
import io

import numpy as np

from arena import trace as codec
from arena.constants import TRACE_WIDTH


def test_round_trip_preserves_shape_and_dtype():
    original = np.random.default_rng(0).standard_normal((100, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    assert restored.shape == original.shape
    assert restored.dtype == np.float32


def test_round_trip_is_accurate_to_float16():
    original = np.random.default_rng(0).uniform(-3, 3, (50, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    # float16 has ~3 decimal digits; millimetre accuracy is plenty for a replay.
    np.testing.assert_allclose(restored, original, atol=3e-3)


def test_the_wire_format_is_float16():
    """Pin the dtype directly.

    The size assertion below cannot do this job: an all-zero or otherwise
    compressible array is crushed by zip regardless of dtype, so a regression
    that dropped the float16 downcast would sail past a size bound.
    """
    original = np.random.default_rng(0).standard_normal((10, TRACE_WIDTH)).astype(np.float32)
    with np.load(io.BytesIO(codec.encode(original))) as loaded:
        assert loaded["trace"].dtype == np.float16


def test_a_20_second_sprint_trace_stays_small():
    # Random data, not zeros: incompressible content is what makes the bound
    # mean something. A real 911-frame trace measures about 35 KB.
    frames = int(20.0 / 0.02)  # 1000 frames at 50 Hz
    noisy = np.random.default_rng(1).standard_normal((frames, TRACE_WIDTH)).astype(np.float32)
    blob = codec.encode(noisy)
    assert len(blob) < 100_000, f"{len(blob)} bytes is larger than expected"


def test_empty_trace_round_trips():
    empty = np.zeros((0, TRACE_WIDTH), dtype=np.float32)
    assert codec.decode(codec.encode(empty)).shape == (0, TRACE_WIDTH)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_trace.py -v`
Expected: FAIL with `ImportError: cannot import name 'trace' from 'arena'`

- [ ] **Step 3: Write the codec**

`arena/trace.py`:

```python
"""Replay traces on the wire.

float16 at 50 Hz: a 20 s sprint is ~42 KB, and half a millimetre of precision is
invisible in a replay. The frontend renders these directly through the rig, so
physics never runs client-side.
"""

import io

import numpy as np

from .constants import TRACE_WIDTH


def encode(trace: np.ndarray) -> bytes:
    if trace.ndim != 2 or trace.shape[1] != TRACE_WIDTH:
        raise ValueError(f"trace must be (frames, {TRACE_WIDTH}), got {trace.shape}")
    buffer = io.BytesIO()
    np.savez_compressed(buffer, trace=trace.astype(np.float16))
    return buffer.getvalue()


def decode(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        return loaded["trace"].astype(np.float32)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `uv run --extra dev pytest tests/test_trace.py -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Write the failing store test**

`tests/test_store.py`:

```python
import pytest

from arena.evaluate import SeedResult
from arena.store import LocalStore, RunRecord, new_run_id


def make_record(**overrides) -> RunRecord:
    fields = dict(
        run_id=new_run_id(),
        event_id="sprint-2m",
        submitted_at="2026-09-03T10:00:00Z",
        user="alice",
        policy_name="sprinter-v3",
        source={"kind": "repo", "repo_id": "alice/sprinter", "filename": "policy.onnx"},
        model_sha256="a" * 64,
        score=21.5,
        seeds_finished=5,
        per_seed=(SeedResult(seed=1, status="finish", time_s=21.5),),
        trace_seed=1,
        runner_version=1,
    )
    fields.update(overrides)
    return RunRecord(**fields)


def test_run_ids_are_unique_and_sort_by_time():
    ids = [new_run_id() for _ in range(50)]
    assert len(set(ids)) == 50
    assert ids == sorted(ids), "run ids must sort chronologically"


def test_record_round_trips_through_a_dict():
    record = make_record()
    assert RunRecord.from_dict(record.to_dict()) == record


def test_append_then_read_back(tmp_path):
    store = LocalStore(tmp_path)
    record = make_record()
    store.append(record, b"trace-bytes")

    assert store.runs("sprint-2m") == [record]
    assert store.trace(record.run_id) == b"trace-bytes"


def test_runs_are_isolated_per_event(tmp_path):
    store = LocalStore(tmp_path)
    sprint = make_record(event_id="sprint-2m")
    roller = make_record(event_id="roller-sprint-2m")
    store.append(sprint, b"a")
    store.append(roller, b"b")

    assert store.runs("sprint-2m") == [sprint]
    assert store.runs("roller-sprint-2m") == [roller]


def test_appending_is_immutable(tmp_path):
    store = LocalStore(tmp_path)
    record = make_record()
    store.append(record, b"a")
    with pytest.raises(FileExistsError):
        store.append(record, b"b")


def test_an_orphaned_trace_blocks_reuse_of_its_run_id(tmp_path):
    """An append that died between its two writes leaves a trace behind.

    Reusing that run_id must fail rather than silently overwrite the orphan —
    otherwise the one mutation this store forbids happens by accident.
    """
    store = LocalStore(tmp_path)
    record = make_record()
    orphan = tmp_path / "traces" / f"{record.run_id}.npz"
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(b"orphan")
    with pytest.raises(FileExistsError):
        store.append(record, b"new")


def test_unknown_event_reads_as_empty(tmp_path):
    assert LocalStore(tmp_path).runs("nope") == []


def test_unknown_trace_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        LocalStore(tmp_path).trace("01JNOPE")
```

- [ ] **Step 6: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.store'`

- [ ] **Step 7: Write the store**

`arena/store.py`:

```python
"""Runs are an append-only log, and the log is a git repo.

One immutable write per run, never a read-modify-write: two simultaneous
submissions cannot contend, so there is nothing to lock. Durability is "it is a
git repo", and the data is public — which for an open benchmark is a feature.

The leaderboard is never stored, only derived (see index.py).
"""

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .evaluate import SeedResult

_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford, ULID-style
_TAIL_BITS = 60  # 12 base32 chars

_id_lock = threading.Lock()
_id_state = {"stamp": -1, "rand": 0}


def new_run_id() -> str:
    """A time-ordered unique id, so run ids sort chronologically.

    Globally unique across events, which is why GET /api/runs/{run_id} needs no
    event in its path.

    Millisecond timestamp plus a random tail — but when two ids are generated in
    the same process within the same millisecond, which is routine under test and
    under any burst of submissions, the tail is INCREMENTED rather than re-rolled.
    A freshly random tail would sort arbitrarily inside that millisecond, so
    chronological ordering would hold only by luck. Each new millisecond draws a
    fresh 60-bit base, so two processes writing in the same millisecond still get
    distinct ids. `stamp <= state` rather than `==` also keeps ids monotonic if
    the wall clock steps backwards.
    """
    with _id_lock:
        stamp = int(time.time() * 1000)
        if stamp <= _id_state["stamp"]:
            stamp = _id_state["stamp"]
            _id_state["rand"] = (_id_state["rand"] + 1) & ((1 << _TAIL_BITS) - 1)
        else:
            _id_state["rand"] = uuid.uuid4().int & ((1 << _TAIL_BITS) - 1)
        _id_state["stamp"] = stamp
        rand = _id_state["rand"]

    head = "".join(_BASE32[(stamp >> shift) & 31] for shift in range(45, -5, -5))
    tail = "".join(_BASE32[(rand >> shift) & 31] for shift in range(_TAIL_BITS - 5, -5, -5))
    return f"{head}{tail}"


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    event_id: str
    submitted_at: str
    user: str
    policy_name: str
    source: dict
    model_sha256: str
    score: float
    seeds_finished: int
    per_seed: tuple[SeedResult, ...]
    trace_seed: int
    runner_version: int

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "event_id": self.event_id,
            "submitted_at": self.submitted_at,
            "user": self.user,
            "policy_name": self.policy_name,
            "source": self.source,
            "model_sha256": self.model_sha256,
            "score": self.score,
            "seeds_finished": self.seeds_finished,
            "per_seed": [
                {"seed": r.seed, "status": r.status, "time_s": r.time_s} for r in self.per_seed
            ],
            "trace_seed": self.trace_seed,
            "runner_version": self.runner_version,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "RunRecord":
        return cls(
            run_id=raw["run_id"],
            event_id=raw["event_id"],
            submitted_at=raw["submitted_at"],
            user=raw["user"],
            policy_name=raw["policy_name"],
            source=raw["source"],
            model_sha256=raw["model_sha256"],
            score=raw["score"],
            seeds_finished=raw["seeds_finished"],
            per_seed=tuple(
                SeedResult(seed=r["seed"], status=r["status"], time_s=r["time_s"])
                for r in raw["per_seed"]
            ),
            trace_seed=raw["trace_seed"],
            runner_version=raw["runner_version"],
        )


class Store(Protocol):
    def append(self, record: RunRecord, trace_blob: bytes) -> None: ...
    def runs(self, event_id: str) -> list[RunRecord]: ...
    def trace(self, run_id: str) -> bytes: ...


class LocalStore:
    """The store on a local filesystem: tests, development, and the read cache."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _run_path(self, event_id: str, run_id: str) -> Path:
        return self.root / "runs" / event_id / f"{run_id}.json"

    def _trace_path(self, run_id: str) -> Path:
        return self.root / "traces" / f"{run_id}.npz"

    def append(self, record: RunRecord, trace_blob: bytes) -> None:
        run_path = self._run_path(record.event_id, record.run_id)
        trace_path = self._trace_path(record.run_id)
        # Both paths are checked, not just the JSON. An append that died between
        # its two writes leaves an orphan trace behind, and silently overwriting
        # that on a retry would be the one mutation this store exists to prevent.
        # A retry simply takes a new run_id, which costs nothing.
        for path in (run_path, trace_path):
            if path.exists():
                raise FileExistsError(f"run {record.run_id} already recorded at {path}")
        run_path.parent.mkdir(parents=True, exist_ok=True)
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        # Trace first, JSON last: runs() globs only *.json, so a failure between
        # the two leaves a run that no reader can see, rather than a visible run
        # whose replay 404s.
        trace_path.write_bytes(trace_blob)
        run_path.write_text(json.dumps(record.to_dict(), indent=2))

    def runs(self, event_id: str) -> list[RunRecord]:
        directory = self.root / "runs" / event_id
        if not directory.is_dir():
            return []
        return [
            RunRecord.from_dict(json.loads(p.read_text())) for p in sorted(directory.glob("*.json"))
        ]

    def trace(self, run_id: str) -> bytes:
        return self._trace_path(run_id).read_bytes()


class HubStore:
    """The same log, on a Hugging Face dataset repo.

    Every write is a new file, so commits never conflict on content. Reads go
    through a local snapshot, which is also what the index scans at boot.
    """

    def __init__(self, repo_id: str, token: str | None = None):
        from huggingface_hub import HfApi

        self.repo_id = repo_id
        self.api = HfApi(token=token or os.environ.get("HF_TOKEN"))

    def append(self, record: RunRecord, trace_blob: bytes) -> None:
        from huggingface_hub import CommitOperationAdd

        run_path = f"runs/{record.event_id}/{record.run_id}.json"
        # Match LocalStore's refusal to overwrite. CommitOperationAdd would
        # otherwise apply a re-append of the same record — a retry loop in the
        # web layer, say — as a silent overwrite, which is exactly the history
        # rewrite this store is built to prevent.
        #
        # This deliberately does NOT claim to stop a concurrent race: two
        # processes could both see nothing and both commit. That safety comes
        # from run_id uniqueness instead, which is why ids are generated rather
        # than derived from the entry. Paying one round trip for the realistic
        # bug is worth it; pretending it closes the race would not be.
        if self.api.file_exists(self.repo_id, run_path, repo_type="dataset"):
            raise FileExistsError(f"run {record.run_id} already recorded in {self.repo_id}")

        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"{record.event_id}: {record.user} {record.score:.3f}s",
            operations=[
                CommitOperationAdd(
                    path_in_repo=run_path,
                    path_or_fileobj=json.dumps(record.to_dict(), indent=2).encode(),
                ),
                CommitOperationAdd(
                    path_in_repo=f"traces/{record.run_id}.npz",
                    path_or_fileobj=trace_blob,
                ),
            ],
        )

    def snapshot(self) -> LocalStore:
        from huggingface_hub import snapshot_download

        return LocalStore(Path(snapshot_download(self.repo_id, repo_type="dataset")))

    def runs(self, event_id: str) -> list[RunRecord]:
        return self.snapshot().runs(event_id)

    def trace(self, run_id: str) -> bytes:
        return self.snapshot().trace(run_id)
```

- [ ] **Step 8: Run the store tests**

Run: `uv run --extra dev pytest tests/test_store.py -v`
Expected: PASS, 7 tests

`HubStore` has no test here on purpose: it would need network and a token. It is exercised in the platform plan against a scratch dataset repo.

- [ ] **Step 9: Commit**

```bash
git add arena/trace.py arena/store.py tests/test_trace.py tests/test_store.py
git commit -m "Append runs to an immutable log; float16 traces on the wire

One new file per run means simultaneous submissions never contend, so there is
nothing to lock."
```

---

### Task 10: The index — deriving the leaderboard

**Files:**
- Create: `arena/index.py`
- Test: `tests/test_index.py`

**Interfaces:**
- Consumes: `arena.store.RunRecord`, `arena.constants.RUNNER_VERSION`
- Produces:
  - `@dataclass(frozen=True) Row: rank: int, record: RunRecord`
  - `leaderboard(records, runner_version=RUNNER_VERSION) -> list[Row]`
  - `sort_key(record) -> tuple`

- [ ] **Step 1: Write the failing test**

`tests/test_index.py`:

```python
from arena.index import leaderboard
from tests.test_store import make_record


def test_ranks_ascend_by_score():
    rows = leaderboard([
        make_record(user="slow", score=30.0),
        make_record(user="fast", score=20.0),
        make_record(user="mid", score=25.0),
    ])
    assert [r.record.user for r in rows] == ["fast", "mid", "slow"]
    assert [r.rank for r in rows] == [1, 2, 3]


def test_only_the_best_run_per_user_appears():
    rows = leaderboard([
        make_record(user="alice", score=30.0),
        make_record(user="alice", score=22.0),
        make_record(user="alice", score=27.0),
        make_record(user="bob", score=25.0),
    ])
    assert [(r.record.user, r.record.score) for r in rows] == [("alice", 22.0), ("bob", 25.0)]


def test_a_tie_breaks_on_seeds_finished():
    rows = leaderboard([
        make_record(user="flaky", score=20.0, seeds_finished=3),
        make_record(user="steady", score=20.0, seeds_finished=5),
    ])
    assert [r.record.user for r in rows] == ["steady", "flaky"]


def test_a_full_tie_breaks_on_earliest_submission():
    rows = leaderboard([
        make_record(user="later", score=20.0, seeds_finished=5,
                    submitted_at="2026-09-03T12:00:00Z"),
        make_record(user="earlier", score=20.0, seeds_finished=5,
                    submitted_at="2026-09-03T09:00:00Z"),
    ])
    assert [r.record.user for r in rows] == ["earlier", "later"]


def test_runs_from_another_runner_version_are_excluded():
    rows = leaderboard(
        [
            make_record(user="current", score=30.0, runner_version=2),
            make_record(user="stale", score=10.0, runner_version=1),
        ],
        runner_version=2,
    )
    assert [r.record.user for r in rows] == ["current"]


def test_an_empty_log_is_an_empty_board():
    assert leaderboard([]) == []


def test_a_dnf_entry_still_ranks_last_rather_than_vanishing():
    rows = leaderboard([
        make_record(user="finisher", score=20.0, seeds_finished=5),
        make_record(user="faller", score=45.0, seeds_finished=0),
    ])
    assert [r.record.user for r in rows] == ["finisher", "faller"]
    assert rows[-1].record.seeds_finished == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_index.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.index'`

- [ ] **Step 3: Write the index**

`arena/index.py`:

```python
"""The leaderboard is derived, never stored.

Scanned from the append-only log, so a restart costs a re-scan and nothing else.
Ranking is best-per-user: otherwise one determined person with forty retrains
owns the whole top ten.
"""

from dataclasses import dataclass

from .constants import RUNNER_VERSION
from .store import RunRecord


@dataclass(frozen=True)
class Row:
    rank: int
    record: RunRecord


def sort_key(record: RunRecord) -> tuple:
    """Lower is better: score, then more seeds finished, then who got there first."""
    return (record.score, -record.seeds_finished, record.submitted_at)


def leaderboard(records, runner_version: int = RUNNER_VERSION) -> list[Row]:
    best: dict[str, RunRecord] = {}
    for record in records:
        if record.runner_version != runner_version:
            continue  # a different physics; never comparable
        current = best.get(record.user)
        if current is None or sort_key(record) < sort_key(current):
            best[record.user] = record

    ranked = sorted(best.values(), key=sort_key)
    return [Row(rank=i + 1, record=r) for i, r in enumerate(ranked)]
```

- [ ] **Step 4: Run it to verify it passes**

Run: `uv run --extra dev pytest tests/test_index.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add arena/index.py tests/test_index.py
git commit -m "Derive the leaderboard from the log, ranking each user's best run"
```

---

### Task 11: The CLI — the engine, usable

The milestone where the competition works end to end with no web layer: score a local `.onnx`, record it, print the board.

**Files:**
- Create: `arena/cli.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `main(argv=None) -> int`
  - Subcommands: `arena events`, `arena score <onnx> --event <id> [--user <name>] [--name <label>] [--store <dir>]`, `arena board --event <id> --store <dir>` (`--store` is REQUIRED here, unlike on `score` where it is optional — a board with no store to read has nothing to show)

- [ ] **Step 1: Write the failing test**

`tests/test_cli.py`:

```python
import re

from arena.assets import ASSET_ROOT
from arena.cli import main

REFERENCE = str(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


def test_events_lists_the_sprint(capsys):
    assert main(["events"]) == 0
    assert "sprint-2m" in capsys.readouterr().out


def test_score_prints_per_seed_and_a_score(capsys):
    assert main(["score", REFERENCE, "--event", "sprint-2m"]) == 0
    out = capsys.readouterr().out
    assert "seed 1" in out
    assert "score" in out


def test_score_records_a_run_and_board_shows_it(tmp_path, capsys):
    """The board must show the same number the run produced, at rank 1.

    Note what this deliberately does NOT do: assert `"1" in out`. That passes on
    the "1" inside "18.216s" no matter what rank is printed, and it never checks
    that the board's score matches the one `score` reported — so a formatting bug
    that mangled the number would sail through.
    """
    store = str(tmp_path)
    assert main(["score", REFERENCE, "--event", "sprint-2m",
                 "--user", "alice", "--name", "walker", "--store", store]) == 0
    scored = capsys.readouterr().out
    seconds = re.search(r"score (\d+\.\d+)s", scored)
    assert seconds, f"no score line in: {scored!r}"

    assert main(["board", "--event", "sprint-2m", "--store", store]) == 0
    out = capsys.readouterr().out
    assert "walker" in out
    assert seconds.group(1) in out, "board score differs from the score just run"
    assert re.search(rf"^\s*1\s+alice\b", out, re.MULTILINE), f"alice not at rank 1: {out!r}"


def test_board_on_an_empty_store_says_so(tmp_path, capsys):
    assert main(["board", "--event", "sprint-2m", "--store", str(tmp_path)]) == 0
    assert "no runs" in capsys.readouterr().out.lower()


def test_a_rejected_policy_exits_nonzero_with_the_reason(tmp_path, capsys):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"nope")
    assert main(["score", str(junk), "--event", "sprint-2m"]) == 1
    assert "not a loadable ONNX model" in capsys.readouterr().err


def test_an_unknown_event_exits_nonzero(capsys):
    assert main(["score", REFERENCE, "--event", "nope"]) == 1
    assert "no such event" in capsys.readouterr().err
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.cli'`

- [ ] **Step 3: Write the CLI**

`arena/cli.py`:

```python
"""The engine without a web layer.

Everything the Space will do — validate, run, score, record, rank — is reachable
from here, which is what makes the platform plan a thin shell over tested code
rather than a place where behaviour is invented.
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import trace as trace_codec
from .evaluate import evaluate
from .index import leaderboard
from .manifest import ManifestError, all_events, load_event
from .policy import PolicyError, load_policy
from .store import LocalStore, RunRecord, new_run_id


def _cmd_events(args) -> int:
    for manifest in all_events():
        print(f"{manifest.id:<20} {manifest.title:<16} rig={manifest.rig} "
              f"seeds={len(manifest.seeds)} limit={manifest.time_limit_s}s")
    return 0


def _cmd_score(args) -> int:
    manifest = load_event(args.event)
    policy = load_policy(Path(args.onnx))
    result = evaluate(manifest, policy)

    for seed_result in result.per_seed:
        timing = f"{seed_result.time_s:.2f}s" if seed_result.time_s is not None else "—"
        print(f"seed {seed_result.seed}: {seed_result.status:<8} {timing}")
    print(f"\nscore {result.score:.3f}s · {result.seeds_finished}/"
          f"{len(result.per_seed)} finished · replay from seed {result.trace_seed}")

    if args.store:
        record = RunRecord(
            run_id=new_run_id(),
            event_id=manifest.id,
            submitted_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            user=args.user,
            policy_name=args.name or Path(args.onnx).stem,
            source={"kind": "local", "path": str(Path(args.onnx).resolve())},
            model_sha256=policy.sha256,
            score=result.score,
            seeds_finished=result.seeds_finished,
            per_seed=result.per_seed,
            trace_seed=result.trace_seed,
            runner_version=result.runner_version,
        )
        LocalStore(Path(args.store)).append(record, trace_codec.encode(result.trace))
        print(f"recorded {record.run_id}")
    return 0


def _cmd_board(args) -> int:
    manifest = load_event(args.event)
    rows = leaderboard(LocalStore(Path(args.store)).runs(manifest.id))
    if not rows:
        print(f"no runs recorded for {manifest.id}")
        return 0

    print(f"{manifest.title}\n")
    print(f"{'#':<4}{'who':<16}{'policy':<20}{'time':>10}{'seeds':>8}")
    for row in rows:
        r = row.record
        print(f"{row.rank:<4}{r.user:<16}{r.policy_name:<20}"
              f"{r.score:>9.3f}s{r.seeds_finished:>5}/{len(r.per_seed)}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="arena", description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)

    subs.add_parser("events", help="list the events").set_defaults(func=_cmd_events)

    score = subs.add_parser("score", help="score a policy on an event")
    score.add_argument("onnx")
    score.add_argument("--event", required=True)
    score.add_argument("--user", default="local")
    score.add_argument("--name", default=None)
    score.add_argument("--store", default=None, help="record the run into this directory")
    score.set_defaults(func=_cmd_score)

    board = subs.add_parser("board", help="print a leaderboard")
    board.add_argument("--event", required=True)
    board.add_argument("--store", required=True)
    board.set_defaults(func=_cmd_board)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (ManifestError, PolicyError) as exc:
        print(f"{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run it to verify it passes**

Run: `uv run --extra dev pytest tests/test_cli.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Try it by hand**

Run:
```bash
uv run arena events
uv run arena score arena/assets/policies/BEST_alpha_walking.onnx \
  --event sprint-2m --user alice --name reference-walker --store /tmp/arena-board
uv run arena board --event sprint-2m --store /tmp/arena-board
```
Expected: five per-seed lines, a score, a recorded run id, then a one-row leaderboard with alice at rank 1.

- [ ] **Step 6: Commit**

```bash
git add arena/cli.py tests/test_cli.py
git commit -m "arena score / arena board: the competition works without a web layer"
```

---

### Task 12: A second event, as a manifest only

The test of the platform claim. If this needs a code change, the abstraction is wrong — and it is far cheaper to learn that now than after a frontend is built on it.

**Files:**
- Create: `arena/events/roller-sprint-2m.toml`
- Create: `arena/events/hill-climb-1m5.toml`
- Modify: `tests/test_manifest.py` (add the cross-event test)
- Test: `tests/test_second_event.py`

**Interfaces:**
- Consumes: everything above
- Produces: two more entries from `all_events()`

- [ ] **Step 1: Write the roller manifest**

`arena/events/roller-sprint-2m.toml`:

```toml
id           = "roller-sprint-2m"
title        = "2 m Roller Sprint"
rig          = "rollers"
time_limit_s = 40.0
metric       = "mean_finish_time"
seeds        = [1, 2, 3, 4, 5]

[course]
kind          = "lane"
length_m      = 2.0
width_m       = 0.8
wall_height_m = 0.15
slope_deg     = 0.0

[command]
vel  = [0.6, 0.0, 0.0]   # RVEL_FWD
head = [0.0, 0.0, 0.0, 0.0]
body = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

[start]
keyframe = "STAND"
settle_s = 0.5

[start.perturbation]
joint_rad = 0.01
yaw_deg   = 2.0

[termination]
fall_gravity_z = -0.5
fall_hold_s    = 0.3
```

- [ ] **Step 2: Write the hill-climb manifest**

`arena/events/hill-climb-1m5.toml`:

```toml
id           = "hill-climb-1m5"
title        = "1.5 m Hill Climb"
rig          = "legs"
time_limit_s = 60.0
metric       = "mean_finish_time"
seeds        = [1, 2, 3, 4, 5]

[course]
kind          = "lane"
length_m      = 1.5
width_m       = 0.8
wall_height_m = 0.15
slope_deg     = 8.0

[command]
vel  = [0.25, 0.0, 0.0]
head = [0.0, 0.0, 0.0, 0.0]
body = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

[start]
keyframe = "STAND"
settle_s = 0.5

[start.perturbation]
joint_rad = 0.01
yaw_deg   = 2.0

[termination]
fall_gravity_z = -0.5
fall_hold_s    = 0.3
```

- [ ] **Step 3: Write the failing test**

`tests/test_second_event.py`:

```python
"""Does the manifest abstraction actually hold?

These events were added as data only. If any of them needed a runner change, the
abstraction is wrong, and this is the cheapest possible moment to find out.
"""

import pytest

from arena.assets import ASSET_ROOT
from arena.course import compile_course
from arena.manifest import all_events, load_event
from arena.policy import load_policy
from arena.runner import run_once

SECOND_EVENTS = ["roller-sprint-2m", "hill-climb-1m5"]


@pytest.mark.parametrize("event_id", SECOND_EVENTS)
def test_the_event_loads_and_its_course_compiles(event_id):
    model = compile_course(load_event(event_id))
    assert model.nu == 14


@pytest.mark.parametrize("event_id", SECOND_EVENTS)
def test_a_run_completes_and_terminates_cleanly(event_id):
    """Any of the three outcomes is fine — a leg policy will not win a roller race.

    What matters is that the runner terminates on a declared rule rather than
    hanging or crashing on an event it has never seen.
    """
    manifest = load_event(event_id)
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    outcome = run_once(manifest, policy, seed=1)
    assert outcome.status in {"finish", "fall", "timeout"}
    assert outcome.trace.shape[0] > 0


def test_the_roller_rig_uses_its_own_top_speed():
    assert load_event("roller-sprint-2m").command[0] == 0.6


def test_the_hill_actually_slopes():
    assert load_event("hill-climb-1m5").course.slope_deg == 8.0


def test_all_three_events_ship():
    assert {m.id for m in all_events()} == {
        "sprint-2m",
        "roller-sprint-2m",
        "hill-climb-1m5",
    }
```

- [ ] **Step 4: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_second_event.py -v`
Expected: FAIL — `ManifestError: no such event: 'roller-sprint-2m'` before the TOML files are added; after adding them, all tests pass with **no change to any module under `arena/`**.

- [ ] **Step 5: Run the whole suite**

Run: `uv run --extra dev pytest -v && uv run ruff check arena tests scripts`
Expected: every test passes, ruff clean.

If any test outside `tests/test_second_event.py` and `tests/test_manifest.py` had to change to make these events work, **stop and report it**: it means the manifest abstraction leaks, and that is a design finding worth more than a green suite.

- [ ] **Step 6: Commit**

```bash
git add arena/events/ tests/test_second_event.py
git commit -m "Add the roller race and hill climb as data only

The platform claim, tested: two new events, no runner change."
```

---

## What this plan delivers

A `uv run arena score <policy.onnx> --event sprint-2m` that returns a verified, reproducible time; three events defined as data; an append-only run log; and a leaderboard derived from it. No web layer, and every number protected by a golden-run tripwire.

## Handoff to the platform plan

Written after this lands, and it depends on two things this plan produces:

1. **`docs/probe-results.md`** decides whether submissions return synchronously or need a queue.
2. **Task 12's outcome** decides whether the manifest abstraction can be exposed in URLs and UI as-is.

The platform plan covers: HF OAuth, repo-id and upload intake on top of `arena.policy`, the subprocess wall-clock cap, per-user rate limits, `HubStore` against a real dataset repo, the FastAPI routes in the spec, and the Vite frontend with the head-to-head replay viewer.

Two spec items are deliberately deferred to it rather than dropped:

- **`models/<sha256>.onnx` content-addressed storage** — only uploads need it, and uploads arrive with the intake layer. `Policy.sha256` already exists for it.
- **`index/<event_id>.parquet` nightly compaction** — an optimisation for a log large enough to slow boot. `LocalStore.runs()` scanning JSON is correct and fast at the scale this plan produces; compaction is worth building when a measured boot time asks for it, not before.
