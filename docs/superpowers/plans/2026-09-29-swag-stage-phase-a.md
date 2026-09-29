# Swag stage, phase A — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Arena plays a policy's command timeline for up to 20 s on an open stage (the new Swag Contest), microduck-challenges trains a sit & stand swag policy that performs Pollen's reference choreography there, and `publish` can upload a `timeline.json`.

**Architecture:** In the Arena, a new course kind `stage` (manifest, course, runner, evaluate, CLI), a strict `arena/timeline.py` for the file format, and `arena/stage.py` to read postures and falls off a trace. In microduck-challenges, `swag_contest/` becomes a copy of microduck_rl's sitstand env on the Arena's solver, with the reference `timeline.json` and a `check.py` acceptance script. In microduck_rl, `publish --timeline`. Three unpushed branches; the reference is trained on HF Jobs and judged deterministically on the Arena and in the training env.

**Tech Stack:** Python 3.12, MuJoCo 3.10.0, numpy, onnxruntime, pytest; mjlab 1.3.0 (training), rsl_rl, tyro (publish CLI); HF Jobs.

**Spec:** `docs/superpowers/specs/2026-09-29-swag-stage-design.md` (commit b15cdd4), approved by the owner on 2026-09-29, including its three flagged points: the `event_summary` exception under `arena/web`, pushes and sensor noise kept in the swag training, and the reference choreography with its check thresholds.

## Global Constraints

- Commits, and anything written on GitHub: English only, never signed by Claude (no `Co-Authored-By`, no "Generated with").
- Nothing is pushed, published to the Hub, or uploaded as a wheel. Those need the owner's yes and are not part of phase A.
- Inside a worktree, git is `/usr/bin/git` (the RTK hook's `git` rewrite is refused there).
- uv: always `--no-config`; `--frozen` to install or run. In microduck-challenges every uv command is preceded by `export HF_TOKEN=$(cat ~/.cache/huggingface/token)` (the Arena wheel is on a private Hub repo).
- In the challenges worktree, once Task 7 has installed the editable Arena (and Task 10 the editable microduck_rl), never run `uv run` or `uv sync` again: they reinstall the locked wheels over the editable ones. Run tools as `.venv/bin/python`, `.venv/bin/arena`, `.venv/bin/publish`, `.venv/bin/train`, `.venv/bin/hf`.
- Do not touch `arena/web` (except `event_summary` in `arena/web/routes_read.py`, Task 2), `app/`, `arena/workshop`, `arena/hub_fetch.py`, the `plan4-workshop` branch or its worktrees.
- The Arena's lane path, `RUNNER_VERSION` (4) and the golden run do not change.
- Tests run in the foreground. Never start a background run and wait on it.
- Paid compute: only HF Jobs training under `--namespace Nico-robot`, flavor l4x1, 4096 envs, `--hf-jobs --no-wandb`. A failing job may be cancelled. Any other paid job needs the owner's yes.
- Policies are judged deterministically, on their exported ONNX, never through the training policy's noise.
- The robot model (MJCF, masses, BAM actuators) is the same in every challenge. The swag's training physics is the Arena's: solver 10/20, timestep 0.005 s, BAM.
- Session scratchpad: `SCRATCH=/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/7d59d3c8-dc26-4292-aa29-64aebe947a57/scratchpad`.

## Review Focus

1. **Keyframe times that binary floating point cannot hold** (0.3, 4.5, 7.0, 13.46): a keyframe must take effect at step `round(t / CTRL_DT)`, not one step late because `15 * 0.02 < 0.3`. Pinned in Task 1 (`command_at` tolerance) and Task 3 (the step that first sees a keyframe).
2. **JSON that is valid but not a number where one is expected**: `NaN`/`Infinity` literals (Python's `json` accepts them), strings, booleans (`true == 1` in Python), nested lists. Each is refused with the field named. Pinned in Task 1.
3. **A file that is not a timeline at all**: not JSON, not UTF-8, a top-level array, a missing file. Each gives a `TimelineError`, and the CLI exits 1 with it rather than a traceback. Pinned in Task 1 and Task 5.
4. **A performance shorter than one control step** (`duration_s` 0.01) would play zero steps and leave an empty trace. It is refused at load. Pinned in Task 1.
5. **An entry that arrives without a timeline** (every swag entry reaching the Space today, and `recover`) must still play 20 s and stay eligible for ballots (`seeds_finished` 1). Pinned in Task 4.

---

## Part 1 — The Arena (worktree `swag-stage`)

### Task 1: `arena/timeline.py`, the timeline format

**Files:**
- Create: `arena/timeline.py`
- Test: `tests/test_timeline.py`

**Interfaces:**
- Consumes: `arena.constants.CTRL_DT` (0.02).
- Produces:
  - `TimelineError(Exception)`
  - `Timeline(duration_s: float, times: tuple[float, ...], commands: tuple[tuple[float, ...], ...])`, frozen, with `command_at(t: float) -> tuple[float, ...]` (13 floats)
  - `load_timeline(path: Path, max_duration_s: float) -> Timeline`
  - `constant_timeline(command, duration_s: float) -> Timeline`

- [ ] **Step 0: Create the worktree and its venv, and record the baseline**

```bash
cd ~/Projects/HuggingFace/microduck-arena
/usr/bin/git worktree add .claude/worktrees/swag-stage -b swag-stage main
cd .claude/worktrees/swag-stage
uv sync --no-config --frozen --extra dev
.venv/bin/python -m pytest -q -m "not network" -p no:cacheprovider 2>&1 | tail -3
```

Expected: the same count as `main` on 2026-09-29, 735 passed and 1 deselected. If this fresh worktree fails tests that `main`'s checkout passes (for example a front-end bundle missing), write down the failing test ids. They are this branch's baseline, and every later task must end with exactly those failures and no others.

- [ ] **Step 1: Write the failing tests**

`tests/test_timeline.py`:

```python
import json
from pathlib import Path

import pytest

from arena.constants import CTRL_DT
from arena.timeline import Timeline, TimelineError, constant_timeline, load_timeline

LIMIT_S = 20.0


def write(tmp_path, content) -> Path:
    path = tmp_path / "timeline.json"
    path.write_text(content if isinstance(content, str) else json.dumps(content))
    return path


def good(**overrides) -> dict:
    raw = {
        "timeline_version": 1,
        "duration_s": 10.0,
        "keyframes": [
            {"t": 0.0, "twist": [0, 0, 0]},
            {"t": 2.0, "twist": [1, 0, 0], "head": [0, 0, 0.5, 0]},
            {"t": 4.5, "body": [0, 0, 0, 0, 0, 0.25]},
        ],
    }
    return raw | overrides


def test_a_good_timeline_loads(tmp_path):
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert timeline.duration_s == 10.0
    assert timeline.times == (0.0, 2.0, 4.5)
    assert timeline.commands[1] == (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6


def test_a_missing_group_is_zeros_not_the_previous_keyframes(tmp_path):
    """keyframes[2] names only body: its twist and head are zeros, although
    keyframes[1] sat and looked left. Every keyframe is the whole command."""
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert timeline.commands[2] == (0.0,) * 12 + (0.25,)


def test_the_command_is_the_last_keyframe_at_or_before_t(tmp_path):
    timeline = load_timeline(write(tmp_path, good()), LIMIT_S)
    assert timeline.command_at(0.0) == timeline.commands[0]
    assert timeline.command_at(1.98) == timeline.commands[0]
    assert timeline.command_at(2.0) == timeline.commands[1]
    assert timeline.command_at(4.49) == timeline.commands[1]
    assert timeline.command_at(9.99) == timeline.commands[2]


@pytest.mark.parametrize("t", [0.3, 4.5, 7.0, 13.46])
def test_a_keyframe_on_the_control_grid_starts_at_its_own_step(tmp_path, t):
    """k * CTRL_DT is not exactly t in binary floating point (15 * 0.02 against
    0.3); the keyframe must still take effect at step round(t / CTRL_DT)."""
    raw = good(duration_s=20.0, keyframes=[{"t": 0.0}, {"t": t, "twist": [1, 0, 0]}])
    timeline = load_timeline(write(tmp_path, raw), LIMIT_S)
    k = round(t / CTRL_DT)
    assert timeline.command_at(k * CTRL_DT)[0] == 1.0
    assert timeline.command_at((k - 1) * CTRL_DT)[0] == 0.0


def test_constant_timeline_holds_one_command():
    command = (0.25,) + (0.0,) * 12
    timeline = constant_timeline(command, 20.0)
    assert timeline == Timeline(20.0, (0.0,), (command,))
    assert timeline.command_at(19.99) == command


@pytest.mark.parametrize(
    "raw, said",
    [
        (good(extra=1), r"unknown keys \['extra'\]"),
        ({k: v for k, v in good().items() if k != "keyframes"}, "missing 'keyframes'"),
        (good(timeline_version=2), "timeline_version: this Arena plays version 1"),
        (good(timeline_version=True), "timeline_version: this Arena plays version 1"),
        (good(duration_s=0.0), "duration_s: must be at least one control step"),
        (good(duration_s=0.01), "duration_s: must be at least one control step"),
        (good(duration_s=20.5), "duration_s: 20.5 s is longer than this event's 20 s"),
        (good(duration_s="10"), "duration_s: expected a number"),
        (good(keyframes=[]), "keyframes: expected 1 to 1000"),
        (good(keyframes=[{"t": 0.01 * i} for i in range(1001)]), "keyframes: expected 1 to 1000"),
        (good(keyframes={"t": 0.0}), "keyframes: expected 1 to 1000"),
        (good(keyframes=[{"t": 0.5}]), r"keyframes\[0\]\.t: the first keyframe starts at 0.0"),
        (good(keyframes=[{"t": 0.0}, {"t": 0.0}]), r"keyframes\[1\]\.t: 0.0 does not come after 0.0"),
        (good(keyframes=[{"t": 0.0}, {"t": 3.0}, {"t": 2.0}]), r"keyframes\[2\]\.t"),
        (good(keyframes=[{"t": 0.0}, {"t": 10.0}]), r"keyframes\[1\]\.t: 10.0 is not before the end"),
        (good(keyframes=[{"twist": [0, 0, 0]}]), r"keyframes\[0\]: missing 't'"),
        (good(keyframes=[{"t": 0.0, "arms": [1]}]), r"keyframes\[0\]: unknown keys \['arms'\]"),
        (good(keyframes=[[0.0, 1, 0, 0]]), r"keyframes\[0\]: expected an object"),
        (good(keyframes=[{"t": 0.0, "twist": [0, 0]}]), r"keyframes\[0\]\.twist: expected 3 numbers"),
        (good(keyframes=[{"t": 0.0, "head": 0.5}]), r"keyframes\[0\]\.head: expected 4 numbers"),
        (good(keyframes=[{"t": 0.0, "twist": ["1", 0, 0]}]), r"keyframes\[0\]\.twist\[0\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "twist": [True, 0, 0]}]), r"keyframes\[0\]\.twist\[0\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "body": [0, 0, 0, 0, 0, 10.5]}]), r"keyframes\[0\]\.body\[5\]: 10.5 is outside ±10"),
    ],
)
def test_a_malformed_timeline_is_refused_with_where(tmp_path, raw, said):
    with pytest.raises(TimelineError, match=said):
        load_timeline(write(tmp_path, raw), LIMIT_S)


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_jsons_non_finite_literals_are_refused(tmp_path, literal):
    """Python's json module reads NaN and Infinity as floats; a command must not hold one."""
    text = ('{"timeline_version": 1, "duration_s": 5.0, '
            '"keyframes": [{"t": 0.0, "head": [0, 0, %s, 0]}]}' % literal)
    with pytest.raises(TimelineError, match=r"keyframes\[0\]\.head\[2\]: must be finite"):
        load_timeline(write(tmp_path, text), LIMIT_S)


def test_a_file_that_is_not_json_is_refused(tmp_path):
    with pytest.raises(TimelineError, match="timeline.json: not a JSON file"):
        load_timeline(write(tmp_path, "{nope"), LIMIT_S)


def test_a_file_that_is_not_utf8_is_refused(tmp_path):
    path = tmp_path / "timeline.json"
    path.write_bytes(b"\xff\xfe{}")
    with pytest.raises(TimelineError, match="timeline.json: not a JSON file"):
        load_timeline(path, LIMIT_S)


def test_a_top_level_that_is_not_an_object_is_refused(tmp_path):
    with pytest.raises(TimelineError, match="timeline.json: expected a JSON object, got list"):
        load_timeline(write(tmp_path, "[]"), LIMIT_S)


def test_a_missing_file_is_refused(tmp_path):
    with pytest.raises(TimelineError, match="missing.json"):
        load_timeline(tmp_path / "missing.json", LIMIT_S)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_timeline.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'arena.timeline'`.

- [ ] **Step 3: Write the implementation**

`arena/timeline.py`:

```python
"""A performance's command timeline: what the Arena asks a policy for, and when.

A stage event (arena/manifest.py) plays an author's `timeline.json` instead of a
constant command: at every control step, the 13 command numbers the policy
reads come from the last keyframe at or before that time. The format is the
Arena's contract with authors, so it is checked strictly and every refusal says
where the file is wrong. What the numbers mean is the policy's business: the
Arena checks the format, never the choreography.

    {"timeline_version": 1, "duration_s": 20.0,
     "keyframes": [{"t": 0.0, "twist": [0, 0, 0], "head": [0, 0, 0, 0], "body": [0, 0, 0, 0, 0, 0]}]}

Every keyframe is the whole command: a group it leaves out is zeros, never the
previous keyframe's values.
"""

import bisect
import json
import math
from dataclasses import dataclass
from pathlib import Path

from .constants import CTRL_DT

TIMELINE_VERSION = 1
MAX_KEYFRAMES = 1000
MAX_VALUE = 10.0
# The command groups, in the order they fill the observation's command slot.
GROUPS = (("twist", 3), ("head", 4), ("body", 6))
_TOP_KEYS = ("timeline_version", "duration_s", "keyframes")
# Keyframe times are decimal seconds; the runner asks for k * CTRL_DT, which
# binary floating point cannot always hold (15 * 0.02 < 0.3). A keyframe takes
# effect at the step that starts within this of its time.
_EPS_S = 1e-9


class TimelineError(Exception):
    """A timeline.json the Arena will not play, with the reason and the place."""


@dataclass(frozen=True)
class Timeline:
    duration_s: float
    times: tuple[float, ...]
    commands: tuple[tuple[float, ...], ...]

    def command_at(self, t: float) -> tuple[float, ...]:
        """The 13 command numbers at time t: the last keyframe with t_k <= t."""
        return self.commands[bisect.bisect_right(self.times, t + _EPS_S) - 1]


def constant_timeline(command, duration_s: float) -> Timeline:
    """One command for the whole performance: what an entry without a timeline plays."""
    return Timeline(float(duration_s), (0.0,), (tuple(float(v) for v in command),))


def _number(value, where: str) -> float:
    # bool is an int in Python, and `true` would otherwise read as 1.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TimelineError(f"{where}: expected a number, got {value!r}")
    if not math.isfinite(value):
        raise TimelineError(f"{where}: must be finite, got {value!r}")
    return float(value)


def _keyframe(raw, index: int, duration_s: float, previous_t: float | None):
    where = f"keyframes[{index}]"
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - {"t", *(name for name, _ in GROUPS)})
    if unknown:
        raise TimelineError(f"{where}: unknown keys {unknown}")
    if "t" not in raw:
        raise TimelineError(f"{where}: missing 't'")
    t = _number(raw["t"], f"{where}.t")
    if previous_t is None and t != 0.0:
        raise TimelineError(f"{where}.t: the first keyframe starts at 0.0, got {t}")
    if previous_t is not None and t <= previous_t:
        raise TimelineError(f"{where}.t: {t} does not come after {previous_t}")
    if t >= duration_s:
        raise TimelineError(f"{where}.t: {t} is not before the end of the performance ({duration_s:g} s)")
    command = []
    for name, width in GROUPS:
        values = raw.get(name, [0.0] * width)
        if not isinstance(values, list) or len(values) != width:
            raise TimelineError(f"{where}.{name}: expected {width} numbers, got {values!r}")
        for i, value in enumerate(values):
            number = _number(value, f"{where}.{name}[{i}]")
            if abs(number) > MAX_VALUE:
                raise TimelineError(f"{where}.{name}[{i}]: {number} is outside ±{MAX_VALUE:g}")
            command.append(number)
    return t, tuple(command)


def load_timeline(path: Path, max_duration_s: float) -> Timeline:
    """Read and check a timeline.json. `max_duration_s` is the event's time limit,
    so the event stays the one place the 20 s is written."""
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise TimelineError(f"{path}: {exc.strerror or exc}") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TimelineError(f"{path.name}: not a JSON file ({exc})") from exc
    if not isinstance(raw, dict):
        raise TimelineError(f"{path.name}: expected a JSON object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - set(_TOP_KEYS))
    if unknown:
        raise TimelineError(f"{path.name}: unknown keys {unknown}")
    for key in _TOP_KEYS:
        if key not in raw:
            raise TimelineError(f"{path.name}: missing {key!r}")

    version = raw["timeline_version"]
    if isinstance(version, bool) or version != TIMELINE_VERSION:
        raise TimelineError(f"timeline_version: this Arena plays version {TIMELINE_VERSION}, got {version!r}")
    duration_s = _number(raw["duration_s"], "duration_s")
    if duration_s < CTRL_DT:
        raise TimelineError(f"duration_s: must be at least one control step ({CTRL_DT:g} s), got {duration_s}")
    if duration_s > max_duration_s:
        raise TimelineError(f"duration_s: {duration_s:g} s is longer than this event's {max_duration_s:g} s")

    keyframes = raw["keyframes"]
    if not isinstance(keyframes, list) or not 1 <= len(keyframes) <= MAX_KEYFRAMES:
        got = len(keyframes) if isinstance(keyframes, list) else f"a {type(keyframes).__name__}"
        raise TimelineError(f"keyframes: expected 1 to {MAX_KEYFRAMES} keyframes in a list, got {got}")
    times, commands, previous = [], [], None
    for index, keyframe in enumerate(keyframes):
        previous, command = _keyframe(keyframe, index, duration_s, previous)
        times.append(previous)
        commands.append(command)
    return Timeline(duration_s, tuple(times), tuple(commands))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_timeline.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/timeline.py tests/test_timeline.py
/usr/bin/git commit -m "Read a performance's command timeline, refusing a malformed file with the place it is wrong"
```

### Task 2: the `stage` course kind, the new swag event, and its summary

**Files:**
- Modify: `arena/manifest.py` (course kinds, `Stage`, optional sweep, one seed)
- Modify: `arena/course.py` (`_inject_lane` → `_inject_course`, flat floor only for a stage)
- Modify: `arena/events/swag-contest.toml` (rewritten)
- Modify: `arena/web/routes_read.py` (`event_summary` only)
- Test: `tests/test_manifest.py`, `tests/test_course.py`, `tests/test_routes_read.py`, `tests/test_second_event.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `arena.manifest.Stage` (frozen dataclass, one field `kind: str = "stage"`)
  - `Manifest.course: Course | Stage`, `Manifest.sweep: Sweep | None`; every consumer tells them apart with `manifest.course.kind == "stage"`
  - `load_event("swag-contest")`: `course == Stage()`, `sweep is None`, `seeds == (1,)`, `time_limit_s == 20.0`, `command == (0.0,) * 13`

- [ ] **Step 1: Write the failing tests**

In `tests/test_manifest.py`, change the import line to also import `Stage`:

```python
from arena.manifest import EVENTS_DIR, ManifestError, Stage, all_events, load_event, load_manifest
```

Replace `test_the_swag_contest_races_the_sprints_environment_at_one_pinned_speed` with:

```python
def test_the_swag_contest_is_a_stage_played_once_for_20_s():
    swag, sprint = load_event("swag-contest"), load_event("sprint-2m")
    assert swag.course == Stage()
    assert swag.sweep is None
    assert swag.seeds == (1,)
    assert swag.time_limit_s == 20.0
    # An entry without a timeline stands still: the all-zero command.
    assert swag.command == (0.0,) * 13
    assert swag.start == sprint.start
    assert swag.termination == sprint.termination
    assert swag.metric == "votes"
```

Add, after `test_a_missing_sweep_section_is_rejected`:

```python
# A stage's sections, over GOOD: [course] names only its kind, and there is no [sweep].
STAGE = {"course": '[course]\nkind="stage"\n', "sweep": ""}


def test_a_stage_loads_with_no_lane_and_no_sweep(tmp_path):
    m = load_manifest(write_manifest(tmp_path, **STAGE))
    assert m.course == Stage()
    assert m.course.kind == "stage"
    assert m.sweep is None


def test_a_stage_refuses_a_lanes_geometry(tmp_path):
    course = '[course]\nkind="stage"\nlength_m=2.0\n'
    with pytest.raises(ManifestError, match=r"\[course\]: unknown keys \['length_m'\]"):
        load_manifest(write_manifest(tmp_path, course=course, sweep=""))


def test_a_stage_refuses_a_sweep(tmp_path):
    with pytest.raises(ManifestError, match=r"takes no \[sweep\]"):
        load_manifest(write_manifest(tmp_path, course=STAGE["course"]))


def test_a_stage_plays_one_seed(tmp_path):
    root = GOOD["root"].replace("seeds=[1]", "seeds=[1,2]")
    with pytest.raises(ManifestError, match="exactly one seed"):
        load_manifest(write_manifest(tmp_path, root=root, **STAGE))
```

In `tests/test_course.py`, add at the end:

```python
def test_a_stage_is_an_open_flat_floor():
    model = compile_course(load_event("swag-contest"))
    assert model.geom("floor").id >= 0
    for wall in ("wall_left", "wall_right"):
        with pytest.raises(KeyError):
            model.geom(wall)
    np.testing.assert_array_equal(model.body("course").quat, [1.0, 0.0, 0.0, 0.0])
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    np.testing.assert_allclose(data.qpos[0:3], [0.0, 0.0, SPAWN_HEIGHT_M])


def test_a_stage_compiles_the_lanes_robot_and_solver():
    """The same robot in every event: only the floor around it differs."""
    stage = compile_course(load_event("swag-contest"))
    lane = compile_course(load_event("sprint-2m"))
    for field in ("body_mass", "body_inertia", "jnt_range", "dof_armature", "dof_damping", "actuator_forcerange"):
        np.testing.assert_array_equal(getattr(stage, field), getattr(lane, field), err_msg=field)
    np.testing.assert_array_equal(stage.key("STAND").qpos, lane.key("STAND").qpos)
    assert stage.opt.timestep == lane.opt.timestep
    assert stage.opt.integrator == lane.opt.integrator
    assert (stage.opt.iterations, stage.opt.ls_iterations) == (lane.opt.iterations, lane.opt.ls_iterations)
```

In `tests/test_routes_read.py`, add after `test_an_event_carries_the_walls_the_physics_uses`:

```python
def test_a_stage_event_is_served_without_a_lane_or_a_sweep(client):
    """The swag plays on an open stage: no length, walls, slope or speed sweep to draw."""
    api, _ = client
    swag = next(e for e in api.get("/api/events").json()["events"] if e["id"] == "swag-contest")
    for key in ("length_m", "width_m", "slope_deg", "walls", "sweep_lo", "sweep_hi", "sweep_step", "sweep_count"):
        assert key not in swag, key
    assert swag["time_limit_s"] == 20.0
    assert swag["seeds"] == 1
```

In `tests/test_second_event.py`, `test_the_raceable_events_are_the_three_originals_and_the_swag_contest` keeps its assertion. Replace the last sentence of its docstring ("The swag contest races the sprint's own course rather than one of its own.") with: "The swag contest plays on a stage of its own."

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_manifest.py tests/test_course.py tests/test_routes_read.py -q`
Expected: `ImportError: cannot import name 'Stage'` for test_manifest.py; the stage tests in the other two files fail.

- [ ] **Step 3: Implement the manifest**

In `arena/manifest.py`:

1. `COURSE_KINDS = ("lane",)` becomes `COURSE_KINDS = ("lane", "stage")`.
2. After the `Course` dataclass, add:

```python
@dataclass(frozen=True)
class Stage:
    """An open floor: no walls, no slope, no line to cross. A stage event plays
    each entry's own command timeline (arena/timeline.py) instead of racing it."""

    kind: str = "stage"
```

3. In `Manifest`, the two annotations become:

```python
    course: Course | Stage
```

and

```python
    # None on a stage, which plays the entry's timeline rather than a speed.
    sweep: Sweep | None
```

4. Add a module-level helper before `load_manifest`, holding the sweep parsing and checks now inline in `load_manifest` (same messages):

```python
def _sweep(raw: dict, path: Path) -> Sweep:
    sweep = Sweep(
        lo=float(_require(raw, "lo", "[sweep]")),
        hi=float(_require(raw, "hi", "[sweep]")),
        step=float(_require(raw, "step", "[sweep]")),
        finalists=int(_require(raw, "finalists", "[sweep]")),
    )
    if sweep.step <= 0:
        raise ManifestError(f"{path}: [sweep] step must be positive")
    if sweep.hi < sweep.lo:
        raise ManifestError(f"{path}: [sweep] hi must not be below lo")
    if sweep.finalists < 1:
        raise ManifestError(f"{path}: [sweep] finalists must be at least 1")
    return sweep
```

5. In `load_manifest`, delete the inline `sweep_raw = _require(raw, "sweep", str(path))`, the `sweep = Sweep(...)` block and its three checks. After the `term_raw = ...` line, insert:

```python
    if kind == "stage":
        _refuse_unknown(course_raw, {"kind"}, "[course]")
        if len(seeds) != 1:
            raise ManifestError(f"{path}: a stage plays one performance, so it declares exactly one seed")
        if "sweep" in raw:
            raise ManifestError(f"{path}: a stage plays each entry's timeline, so it takes no [sweep]")
        course, sweep = Stage(), None
    else:
        course = Course(
            kind=kind,
            length_m=float(_require(course_raw, "length_m", "[course]")),
            width_m=float(_require(course_raw, "width_m", "[course]")),
            wall_height_m=float(_require(course_raw, "wall_height_m", "[course]")),
            slope_deg=float(_require(course_raw, "slope_deg", "[course]")),
        )
        sweep = _sweep(_require(raw, "sweep", str(path)), path)
```

6. In the `return Manifest(...)`, replace the inline `course=Course(...)` with `course=course,` (`sweep=sweep,` stays).

- [ ] **Step 4: Implement the course**

In `arena/course.py`, replace `_inject_lane` with:

```python
def _slope_deg(course) -> float:
    """A lane tilts by what it declares; a stage is flat."""
    return course.slope_deg if course.kind == "lane" else 0.0


def _inject_course(root: ET.Element, manifest: Manifest) -> None:
    """The floor inside one static rotated body, plus a lane's two side walls.

    A static body (no joint) leaves qpos untouched, so tilting the whole lane for
    a hill climb costs nothing in the keyframe. The walls are the referee: with wz
    pinned to zero, a policy that pulls to one side scrubs speed against them, so
    straightness is part of the time rather than a separate rule. A stage is the
    same floor with nothing else: an open space to perform in.
    """
    course = manifest.course
    worldbody = root.find("worldbody")
    # euler is RADIANS here: the vendored MJCF declares <compiler angle="radian">,
    # which this body inherits. Writing the degree value straight in would tilt
    # the lane by 8 radians for slope_deg = 8 — geometry that compiles cleanly
    # and is completely wrong.
    pitch = -math.radians(_slope_deg(course))
    body = _sub(worldbody, "body", name="course", euler=f"0 {pitch} 0")

    _sub(body, "geom", name="floor", type="plane", size="0 0 0.05", pos="0 0 0")
    if course.kind == "stage":
        return

    for name, pos, size in wall_boxes(course):
        _sub(
            body,
            "geom",
            name=name,
            type="box",
            pos=" ".join(str(v) for v in pos),
            size=" ".join(str(v) for v in size),
        )
```

In `_inject_keyframe`, `slope = manifest.course.slope_deg` becomes `slope = _slope_deg(manifest.course)`. In `build_course_xml`, `_inject_lane(root, manifest)` becomes `_inject_course(root, manifest)`. Update the module docstring's "a lane instead of a square arena" to "a lane or an open stage instead of a square arena".

- [ ] **Step 5: Rewrite the swag event**

`arena/events/swag-contest.toml`, whole file:

```toml
id           = "swag-contest"
order        = 15
title        = "Swag Contest"
category     = "showcase"
rig          = "legs"
time_limit_s = 20.0
metric       = "votes"
seeds        = [1]

# A performance, not a race: an open floor, no walls, no line. Each entry's
# timeline.json (arena/timeline.py) says what to command and when; the event
# plays it once, for at most time_limit_s. Voters judge the show.
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

# On a stage this does not end the run: a fall is part of the show. It is what
# `arena score` calls a fall in its summary (arena/stage.py).
[termination]
fall_gravity_z = -0.5
fall_hold_s    = 0.3

[vote]
ballot_min  = 2
ballot_max  = 4
window_days = 7
per_day     = 20
```

- [ ] **Step 6: Serve a stage without a lane**

In `arena/web/routes_read.py`, `event_summary` becomes:

```python
def event_summary(manifest: Manifest) -> dict:
    summary = {
        "id": manifest.id,
        "title": manifest.title,
        "rig": manifest.rig,
        "status": manifest.status,
        # What kind of event this is, for the flyer's label and its shadow
        # colour. The board and the race page do not read it.
        "category": manifest.category,
        "metric": manifest.metric,
        # The whole vote configuration, or null. The page reads this to decide
        # whether the VOTE badge, the vote button and the #/v/ route exist.
        "vote": (
            {
                "ballot_min": manifest.vote.ballot_min,
                "ballot_max": manifest.vote.ballot_max,
                "window_days": manifest.vote.window_days,
                "per_day": manifest.vote.per_day,
            }
            if manifest.vote
            else None
        ),
        "order": manifest.order,
        "time_limit_s": manifest.time_limit_s,
        "seeds": len(manifest.seeds),
        "clip": manifest.clip.to_dict(),
    }
    # A stage is an open floor that plays each entry's timeline: no lane to
    # draw and no speed to sweep.
    if manifest.course.kind == "lane":
        summary |= {
            "length_m": manifest.course.length_m,
            "width_m": manifest.course.width_m,
            "slope_deg": manifest.course.slope_deg,
            # The lane walls the PHYSICS uses, in MJCF coordinates, so the viewer can
            # draw exactly what the robot can hit rather than recomputing where the
            # walls ought to be. They are invisible unless you ask for them.
            "walls": [
                {"name": name, "pos": list(pos), "half": list(half)}
                for name, pos, half in wall_boxes(manifest.course)
            ],
            # The sweep, not a single command: the event no longer pins a speed,
            # it declares the range every entry is tried over.
            "sweep_lo": manifest.sweep.lo,
            "sweep_hi": manifest.sweep.hi,
            "sweep_step": manifest.sweep.step,
            "sweep_count": len(manifest.sweep.speeds()),
        }
    return summary
```

Nothing else under `arena/web` changes.

- [ ] **Step 7: Run the tests to verify they pass, then the whole suite**

Run: `.venv/bin/python -m pytest tests/test_manifest.py tests/test_course.py tests/test_routes_read.py tests/test_second_event.py -q`
Expected: all pass.

Run: `.venv/bin/python -m pytest -q -m "not network" -p no:cacheprovider 2>&1 | tail -3`
Expected: the baseline from Task 1 Step 0, plus the new tests. If a test elsewhere reads the swag's lane or sweep (`grep -rn "swag" tests/`), it is fixed here, in the spirit of the stage. A test that exercises only the lane path must not be weakened.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add arena/manifest.py arena/course.py arena/events/swag-contest.toml arena/web/routes_read.py tests/
/usr/bin/git commit -m "A stage course kind: an open flat floor, one seed, no sweep; the Swag Contest becomes a 20 s stage"
```

### Task 3: `run_stage`, playing a timeline

**Files:**
- Modify: `arena/runner.py`
- Test: `tests/test_run_stage.py`

**Interfaces:**
- Consumes: `Timeline.command_at(t)` (Task 1), `load_event("swag-contest")` as a stage (Task 2).
- Produces: `arena.runner.run_stage(manifest: Manifest, policy, timeline: Timeline, seed: int, model=None) -> RunOutcome`. Status `"finish"` with `time_s` = the duration played, or `"fall"` with `time_s` `None` when the state went non-finite. `progress_m` and `start_progress_m` are 0.0.

- [ ] **Step 1: Write the failing tests**

`tests/test_run_stage.py`:

```python
import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, NUM_JOINTS
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once, run_stage
from arena.timeline import Timeline, constant_timeline

STILL = (0.0,) * 13


@pytest.fixture(scope="module")
def swag():
    return load_event("swag-contest")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


class _RecordingPolicy:
    def __init__(self):
        self.observed = []

    def act(self, obs):
        self.observed.append(obs.copy())
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def test_a_stage_plays_exactly_its_duration(swag, walker):
    outcome = run_stage(swag, walker, constant_timeline(STILL, 3.0), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape[0] == round(3.0 / CTRL_DT)
    assert outcome.time_s == pytest.approx(3.0)
    assert outcome.progress_m == 0.0 and outcome.start_progress_m == 0.0


def test_a_fall_does_not_stop_a_performance(swag):
    """The same limp policy is a fall on a lane; on a stage it plays to the end."""
    assert run_once(load_event("sprint-2m"), _ZeroPolicy(), seed=1).status == "fall"
    outcome = run_stage(swag, _ZeroPolicy(), constant_timeline(STILL, 3.0), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape[0] == round(3.0 / CTRL_DT)


def test_each_step_observes_the_command_at_its_time(swag):
    """The settle plays the first keyframe; timed step k plays command_at(k * CTRL_DT).
    A keyframe at 0.3 s is first seen at step 15, although 15 * 0.02 < 0.3 in floating point."""
    first = (0.0,) * 13
    sit = (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6
    look = (0.0, 0.0, 0.0, -0.25, 0.0, 0.0, 0.0) + (0.0,) * 5 + (0.25,)
    timeline = Timeline(1.5, (0.0, 0.3, 1.0), (first, sit, look))
    policy = _RecordingPolicy()
    run_stage(swag, policy, timeline, seed=1)

    settle_steps = round(swag.start.settle_s / CTRL_DT)
    commands = [tuple(float(v) for v in obs[48:61]) for obs in policy.observed]
    assert len(commands) == settle_steps + round(1.5 / CTRL_DT)
    assert set(commands[:settle_steps]) == {first}
    timed = commands[settle_steps:]
    assert timed[14] == first and timed[15] == sit
    assert timed[49] == sit and timed[50] == look
    assert timed[-1] == look


def test_a_stage_run_is_deterministic(swag, walker):
    timeline = constant_timeline(STILL, 2.0)
    a = run_stage(swag, walker, timeline, seed=1)
    b = run_stage(swag, walker, timeline, seed=1)
    assert np.array_equal(a.trace, b.trace)
    assert np.array_equal(a.settle, b.settle)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_run_stage.py -q`
Expected: `ImportError: cannot import name 'run_stage'`.

- [ ] **Step 3: Extract the shared opening and add the stage path**

In `arena/runner.py`:

1. Add `from .timeline import Timeline` to the imports.
2. After `_step`, add the simulation holder and the shared opening. The reset, perturbation, servo and settle code moves here verbatim from `run_once`, comments included, so the lane's arithmetic does not change:

```python
class _Sim:
    """One run's simulation between control steps: the physics, and the two
    things the next observation carries over from this step."""

    def __init__(self, model, data, adr, servos, policy):
        self.model, self.data, self.adr, self.servos, self.policy = model, data, adr, servos, policy
        self.last_action = np.zeros(NUM_JOINTS, dtype=np.float32)
        # The actor's joint-velocity observation is one control step old — a fixed
        # lag in training (delay_min_lag = delay_max_lag = 1 on its joint_vel term),
        # not a randomisation; the first step uses the reset state's qvel.
        self.prev_qvel = data.qvel[adr.dof].copy()

    def step(self, command: np.ndarray) -> None:
        self.last_action, self.prev_qvel = _step(
            self.model, self.data, self.policy, self.adr, command,
            self.last_action, self.prev_qvel, self.servos,
        )

    def record(self, frame: np.ndarray) -> None:
        _record(frame, self.data, self.adr)


def _start(manifest: Manifest, policy, seed: int, model, command: np.ndarray) -> tuple[_Sim, np.ndarray]:
    """Every run's opening, lane or stage: training's reset, then the untimed
    settle on `command`. Returns the simulation where the clock starts, and the
    settle's frames."""
    model = model if model is not None else compile_course(manifest)
    data = mujoco.MjData(model)
    adr = _Addresses.of(model, manifest.start.keyframe)

    # <the "A fresh Servos every run ..." comment block from run_once, verbatim>
    servos = Servos(
        model, adr.dof, adr.act, np.random.default_rng([zlib.crc32(manifest.id.encode()), seed, 1])
    )

    # <the "Training's reset (module docstring) ..." comment, verbatim>
    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    _perturb(data, adr, manifest, seed)
    mujoco.mj_forward(model, data)
    servos.drive(data, np.zeros(NUM_JOINTS))
    mujoco.mj_forward(model, data)

    sim = _Sim(model, data, adr, servos, policy)
    # Settle with the policy running and the clock stopped: nobody is timed on
    # standing up.
    settle_steps = round(manifest.start.settle_s / CTRL_DT)
    settle = np.empty((settle_steps + 1, TRACE_WIDTH), dtype=np.float32)
    sim.record(settle[0])
    for step in range(settle_steps):
        sim.step(command)
        sim.record(settle[step + 1])
    return sim, settle
```

(The two `<...>` lines stand for the existing comment blocks in `run_once`, moved unchanged. They are the only text not written out here.)

3. `run_once` keeps its signature and its lane loop and uses the opening:

```python
def run_once(manifest: Manifest, policy, seed: int, model=None, command=None) -> RunOutcome:
    # <the "Converted once per run, not per step ..." comment block, verbatim>
    command = np.asarray(manifest.command if command is None else command, dtype=np.float64)
    sim, settle = _start(manifest, policy, seed, model, command)
    data, adr = sim.data, sim.adr

    direction = ramp_dir(manifest.course.slope_deg)
    # ... unchanged from here, except the loop body's first lines:
    for step in range(max_steps):
        sim.step(command)
        sim.record(frames[written])
        written += 1
        # ... the rest of the loop unchanged (non-finite, fall, finish)
```

The locals `model`, `data`, `adr`, `servos`, `last_action` and `prev_qvel` of the old `run_once` are gone. Everything after the settle reads `data` and `adr`, as before.

4. After `run_once`, add:

```python
def run_stage(manifest: Manifest, policy, timeline: Timeline, seed: int, model=None) -> RunOutcome:
    """Play a timeline on a stage: no line to cross, and no fall stops the show.

    The settle plays the first keyframe; timed step k plays the command at
    k * CTRL_DT. Only a non-finite state ends a performance early — a solver
    explosion is not a performance, and a trace cannot hold one.
    """
    sim, settle = _start(manifest, policy, seed, model, np.asarray(timeline.command_at(0.0), dtype=np.float64))
    steps = round(timeline.duration_s / CTRL_DT)
    frames = np.empty((steps, TRACE_WIDTH), dtype=np.float32)
    status, time_s, written = "finish", steps * CTRL_DT, 0
    for step in range(steps):
        sim.step(np.asarray(timeline.command_at(step * CTRL_DT), dtype=np.float64))
        sim.record(frames[written])
        written += 1
        if not np.all(np.isfinite(sim.data.qpos)):
            status, time_s = "fall", None
            break
    return RunOutcome(
        seed=seed,
        status=status,
        time_s=time_s,
        progress_m=0.0,
        start_progress_m=0.0,  # a stage has no line
        trace=frames[:written].copy(),
        settle=settle,
    )
```

- [ ] **Step 4: Run the stage tests, then the lane's guards**

Run: `.venv/bin/python -m pytest tests/test_run_stage.py tests/test_runner.py tests/test_evaluate.py -q`
Expected: all pass, the golden run (`test_golden_run_reference_policy_holds_its_time`) included. A golden drift means the extraction changed the lane's arithmetic: fix the extraction, never the baseline.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/runner.py tests/test_run_stage.py
/usr/bin/git commit -m "run_stage plays a timeline on a stage: the lane's reset and settle, no line, no fall stop"
```

### Task 4: evaluating a stage

**Files:**
- Modify: `arena/evaluate.py`
- Test: `tests/test_evaluate_stage.py`

**Interfaces:**
- Consumes: `run_stage` (Task 3), `Timeline` and `constant_timeline` (Task 1).
- Produces: `evaluate(manifest: Manifest, policy, timeline: Timeline | None = None) -> Evaluation`. For a stage: one run at `manifest.seeds[0]`; `per_seed` holds it; `seeds_finished` is 1 or 0; `score` is the duration played (or `time_limit_s` when the run diverged); `scan == ()`; `command_vx == 0.0`; `trace_seed` is the seed. For a lane, a timeline raises `ValueError`.

- [ ] **Step 1: Write the failing tests**

`tests/test_evaluate_stage.py`:

```python
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, RUNNER_VERSION
from arena.evaluate import evaluate
from arena.manifest import load_event
from arena.policy import load_policy
from arena.timeline import Timeline

STILL = (0.0,) * 13


@pytest.fixture(scope="module")
def swag():
    return load_event("swag-contest")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


def test_an_entry_without_a_timeline_plays_the_events_command_for_20_s(swag, walker):
    """Every swag entry reaching the Space today comes without a timeline; it must
    still play the whole performance and stay eligible for ballots."""
    result = evaluate(swag, walker)
    assert result.trace.shape[0] == round(20.0 / CTRL_DT)
    assert result.seeds_finished == 1
    assert result.score == pytest.approx(20.0)
    assert [(r.seed, r.status) for r in result.per_seed] == [(1, "finish")]
    assert result.scan == ()
    assert result.command_vx == 0.0
    assert result.trace_seed == 1
    assert result.runner_version == RUNNER_VERSION


def test_a_timeline_sets_the_performance_and_its_length(swag, walker):
    timeline = Timeline(2.0, (0.0, 1.0), (STILL, (1.0,) + (0.0,) * 12))
    result = evaluate(swag, walker, timeline)
    assert result.trace.shape[0] == 100
    assert result.score == pytest.approx(2.0)


def test_a_race_refuses_a_timeline(walker):
    with pytest.raises(ValueError, match="race"):
        evaluate(load_event("sprint-2m"), walker, Timeline(2.0, (0.0,), (STILL,)))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_evaluate_stage.py -q`
Expected: the first two fail (`AttributeError: 'Stage' object has no attribute 'slope_deg'` from `run_once`); the third fails with `TypeError` (too many arguments).

- [ ] **Step 3: Implement**

In `arena/evaluate.py`:

1. Imports: `from .runner import run_once, run_stage` and `from .timeline import Timeline, constant_timeline`.
2. Append to the module docstring:

```
A stage is not a race and none of this applies to it: it plays the entry's
command timeline once, on one seed, and every performance that plays to the
end goes to the voters. Its score is the duration played, and only informs:
a stage's board ranks on votes.
```

3. `evaluate` becomes:

```python
def evaluate(manifest: Manifest, policy, timeline: Timeline | None = None) -> Evaluation:
    if manifest.course.kind == "stage":
        return _evaluate_stage(manifest, policy, timeline)
    if timeline is not None:
        raise ValueError(f"{manifest.id} is a race: it plays the event's command, not a timeline")
    model = compile_course(manifest)  # compiled once, reused for every run
    # ... the rest of the lane body unchanged
```

4. Add after `evaluate`:

```python
def _evaluate_stage(manifest: Manifest, policy, timeline: Timeline | None) -> Evaluation:
    """One performance: the entry's timeline, or the event's command for the whole time limit."""
    if timeline is None:
        timeline = constant_timeline(manifest.command, manifest.time_limit_s)
    seed = manifest.seeds[0]
    outcome = run_stage(manifest, policy, timeline, seed)
    per_seed = (SeedResult(seed=seed, status=outcome.status, time_s=outcome.time_s),)
    return Evaluation(
        event_id=manifest.id,
        score=METRICS[manifest.metric](per_seed, manifest.time_limit_s),
        command_vx=0.0,
        seeds_finished=1 if outcome.status == "finish" else 0,
        per_seed=per_seed,
        scan=(),
        trace=outcome.trace,
        settle=outcome.settle,
        trace_seed=seed,
        runner_version=RUNNER_VERSION,
    )
```

`evaluate_at` is not changed: it stays lane-only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_evaluate_stage.py tests/test_evaluate.py tests/test_votes.py tests/test_points.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/evaluate.py tests/test_evaluate_stage.py
/usr/bin/git commit -m "Evaluate a stage as one performance of the entry's timeline, or of the event's command without one"
```

### Task 5: reading a performance, and `arena score --timeline`

**Files:**
- Create: `arena/stage.py`
- Modify: `arena/cli.py`, `README.md` (the "From the command line" block)
- Test: `tests/test_stage.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `evaluate(manifest, policy, timeline)` (Task 4), `load_timeline`, `TimelineError` (Task 1), `Termination` from `arena.manifest`.
- Produces (`arena.stage`, used by the CLI here and by the challenge's `check.py` in Task 8):
  - `SEATED_Z_M = 0.07`, `STANDING_Z_M = 0.10`, `UPRIGHT_DEG = 20.0`
  - `tilt_deg(trace) -> np.ndarray`, `seated(trace) -> np.ndarray[bool]`, `standing(trace) -> np.ndarray[bool]`
  - `fell_at(trace, termination: Termination) -> float | None`
  - CLI: `arena score ONNX --event E [--timeline FILE] [--store DIR ...]`

- [ ] **Step 1: Write the failing tests**

`tests/test_stage.py`:

```python
import numpy as np
import pytest

from arena.constants import CTRL_DT, NUM_JOINTS, TRACE_WIDTH
from arena.manifest import load_event
from arena.runner import run_once
from arena.stage import fell_at, seated, standing, tilt_deg


def frames(n, z=0.115, tilt=0.0):
    """n trace frames at trunk height z, rolled by `tilt` degrees about x."""
    trace = np.zeros((n, TRACE_WIDTH), dtype=np.float32)
    trace[:, 2] = z
    half = np.radians(tilt) / 2
    trace[:, 3] = np.cos(half)
    trace[:, 4] = np.sin(half)
    return trace


def test_tilt_is_read_from_the_quaternion():
    np.testing.assert_allclose(tilt_deg(frames(3, tilt=35.0)), 35.0, atol=1e-3)


def test_seated_and_standing_follow_height_and_tilt():
    trace = np.concatenate([frames(2, z=0.06), frames(2), frames(2, tilt=30.0), frames(2, z=0.085)])
    assert seated(trace).tolist() == [True] * 2 + [False] * 6
    assert standing(trace).tolist() == [False] * 2 + [True] * 2 + [False] * 4


def test_a_fall_is_timed_where_a_lane_would_have_stopped():
    """Tipped past 60 degrees for 0.3 s (15 steps) straight; a shorter tip resets the count."""
    term = load_event("swag-contest").termination
    trace = np.concatenate([frames(50), frames(14, tilt=80.0), frames(10), frames(20, tilt=80.0)])
    assert fell_at(trace, term) == pytest.approx((50 + 14 + 10 + 15) * CTRL_DT)


def test_leaning_short_of_the_rule_is_no_fall():
    assert fell_at(frames(100, tilt=55.0), load_event("swag-contest").termination) is None


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def test_the_rule_is_the_runners():
    """A lane stops a limp policy at its fall; read off the trace, the fall lands on its last frame."""
    sprint = load_event("sprint-2m")
    outcome = run_once(sprint, _ZeroPolicy(), seed=1)
    assert outcome.status == "fall"
    assert fell_at(outcome.trace, sprint.termination) == pytest.approx(outcome.trace.shape[0] * CTRL_DT)
```

Add to `tests/test_cli.py` (add `import json` to its imports):

```python
def _timeline(tmp_path):
    path = tmp_path / "timeline.json"
    path.write_text(json.dumps({
        "timeline_version": 1, "duration_s": 2.0,
        "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [1, 0, 0]}],
    }))
    return path


def test_score_on_a_stage_summarises_the_performance(tmp_path, capsys):
    assert main(["score", REFERENCE, "--event", "swag-contest", "--timeline", str(_timeline(tmp_path))]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "stage: 2.00 s played, timeline.json (2 keyframes)"
    assert re.fullmatch(r"fell: (no|at \d+\.\d\d s)", lines[1])
    assert re.fullmatch(r"seated \d+\.\d s · standing \d+\.\d s", lines[2])


def test_score_on_a_stage_without_a_timeline_plays_the_events_command(capsys):
    assert main(["score", REFERENCE, "--event", "swag-contest"]) == 0
    assert capsys.readouterr().out.splitlines()[0] == "stage: 20.00 s played, the event's default command"


def test_a_timeline_on_a_race_is_refused(tmp_path, capsys):
    assert main(["score", REFERENCE, "--event", "sprint-2m", "--timeline", str(_timeline(tmp_path))]) == 1
    assert "--timeline is for stage events" in capsys.readouterr().err


def test_a_malformed_timeline_exits_1_with_where(tmp_path, capsys):
    path = tmp_path / "timeline.json"
    path.write_text('{"timeline_version": 1, "duration_s": 2.0, "keyframes": [{"t": 0.5}]}')
    assert main(["score", REFERENCE, "--event", "swag-contest", "--timeline", str(path)]) == 1
    assert "keyframes[0].t" in capsys.readouterr().err


def test_a_timeline_that_is_not_json_exits_1(tmp_path, capsys):
    path = tmp_path / "timeline.json"
    path.write_text("{nope")
    assert main(["score", REFERENCE, "--event", "swag-contest", "--timeline", str(path)]) == 1
    assert "not a JSON file" in capsys.readouterr().err


def test_a_stage_run_is_recorded_and_boarded(tmp_path, capsys):
    store = str(tmp_path / "store")
    assert main(["score", REFERENCE, "--event", "swag-contest", "--timeline", str(_timeline(tmp_path)),
                 "--user", "alice", "--store", store]) == 0
    capsys.readouterr()
    assert main(["board", "--event", "swag-contest", "--store", store]) == 0
    assert re.search(r"^\s*1\s+alice\b.*2\.000s", capsys.readouterr().out, re.MULTILINE)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_stage.py tests/test_cli.py -q`
Expected: `ModuleNotFoundError: No module named 'arena.stage'`; the CLI tests fail on the unknown `--timeline` argument.

- [ ] **Step 3: Write `arena/stage.py`**

```python
"""What a performance on a stage did, read off its trace.

A stage never stops a run for a fall (`arena.runner.run_stage`): whatever
happens is part of the show. So what happened is read afterwards, from the
trace: when the event's fall rule first held, and when the duck was seated or
standing. `arena score` summarises a stage run with these; a challenge can
check its own choreography with them.

A trace frame is the state after one control step: trunk position (0:3),
trunk quaternion w, x, y, z (3:7), then the joint angles in JOINT_NAMES order.
"""

import numpy as np

from .constants import CTRL_DT
from .manifest import Termination

# Trunk heights measured on the robot: about 0.06 m seated, 0.115 m standing.
SEATED_Z_M = 0.07
STANDING_Z_M = 0.10
UPRIGHT_DEG = 20.0


def _cos_tilt(trace: np.ndarray) -> np.ndarray:
    """The trunk's up axis against the world's, per frame: R[2, 2] of the quaternion."""
    x, y = trace[:, 4], trace[:, 5]
    return 1.0 - 2.0 * (x * x + y * y)


def tilt_deg(trace: np.ndarray) -> np.ndarray:
    return np.degrees(np.arccos(np.clip(_cos_tilt(trace), -1.0, 1.0)))


def seated(trace: np.ndarray) -> np.ndarray:
    return trace[:, 2] < SEATED_Z_M


def standing(trace: np.ndarray) -> np.ndarray:
    return (trace[:, 2] > STANDING_Z_M) & (tilt_deg(trace) <= UPRIGHT_DEG)


def fell_at(trace: np.ndarray, termination: Termination) -> float | None:
    """When the fall rule first held, where a lane would have stopped the run, or None.

    `arena.runner.run_once`'s rule: projected gravity's z (-R[2, 2]) above
    `fall_gravity_z` for `fall_hold_s` straight control steps, timed at the step
    that completes the hold.
    """
    tipped = -_cos_tilt(trace) > termination.fall_gravity_z
    needed = round(termination.fall_hold_s / CTRL_DT)
    run = 0
    for frame, is_tipped in enumerate(tipped):
        run = run + 1 if is_tipped else 0
        if run >= needed:
            return (frame + 1) * CTRL_DT
    return None
```

- [ ] **Step 4: Wire the CLI**

In `arena/cli.py`:

1. Imports: add `from . import stage`, `from .constants import CTRL_DT`, and `from .timeline import TimelineError, load_timeline`.
2. Move the sweep's prints out of `_cmd_score` into a helper, unchanged:

```python
def _print_sweep(result) -> None:
    print(f"sweep {len(result.scan)} commanded speeds "
          f"{result.scan[0].command_vx:.2f}–{result.scan[-1].command_vx:.2f} m/s")
    for point in result.scan:
        timing = f"{point.time_s:.2f}s" if point.time_s is not None else \
                 f"{point.status} at {point.progress_m:.2f}m"
        print(f"  {point.command_vx:>5.2f} m/s  {timing}")
    print(f"\nscored at {result.command_vx:.2f} m/s")

    for seed_result in result.per_seed:
        timing = f"{seed_result.time_s:.2f}s" if seed_result.time_s is not None else "—"
        print(f"seed {seed_result.seed}: {seed_result.status:<8} {timing}")
    print(f"\nscore {result.score:.3f}s · {result.seeds_finished}/"
          f"{len(result.per_seed)} finished · replay from seed {result.trace_seed}")


def _print_stage(manifest, result, timeline, name: str | None) -> None:
    played = result.trace.shape[0] * CTRL_DT
    what = f"{name} ({len(timeline.times)} keyframes)" if timeline else "the event's default command"
    if result.seeds_finished:
        print(f"stage: {played:.2f} s played, {what}")
    else:
        print(f"stage: stopped at {played:.2f} s, the simulation diverged; {what}")
    fell = stage.fell_at(result.trace, manifest.termination)
    print("fell: no" if fell is None else f"fell: at {fell:.2f} s")
    print(f"seated {stage.seated(result.trace).sum() * CTRL_DT:.1f} s · "
          f"standing {stage.standing(result.trace).sum() * CTRL_DT:.1f} s")
```

3. `_cmd_score` starts:

```python
def _cmd_score(args) -> int:
    manifest = load_event(args.event)
    policy = load_policy(Path(args.onnx))
    if manifest.course.kind == "stage":
        timeline = load_timeline(Path(args.timeline), manifest.time_limit_s) if args.timeline else None
        result = evaluate(manifest, policy, timeline)
        _print_stage(manifest, result, timeline, Path(args.timeline).name if args.timeline else None)
    elif args.timeline:
        print(f"{manifest.id} is a race: --timeline is for stage events", file=sys.stderr)
        return 1
    else:
        result = evaluate(manifest, policy)
        _print_sweep(result)

    if args.store:
        # ... unchanged
```

4. In `main`, after `score.add_argument("--store", ...)`:

```python
    score.add_argument("--timeline", default=None,
                       help="a stage event's timeline.json (default: the event's own command)")
```

and `except (ManifestError, PolicyError) as exc:` becomes `except (ManifestError, PolicyError, TimelineError) as exc:`.

5. In `README.md`, in the "From the command line" block, after the `arena board` line, add:

```bash

# A stage event plays a command timeline (arena/timeline.py) instead of racing:
uv run arena score $REF --event swag-contest --timeline timeline.json
```

- [ ] **Step 5: Run the tests to verify they pass, then the whole suite**

Run: `.venv/bin/python -m pytest tests/test_stage.py tests/test_cli.py -q`
Expected: all pass.

Run: `.venv/bin/python -m pytest -q -m "not network" -p no:cacheprovider 2>&1 | tail -3`
Expected: Task 1's baseline plus every test added in Tasks 1–5, and nothing else failing.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add arena/stage.py arena/cli.py README.md tests/test_stage.py tests/test_cli.py
/usr/bin/git commit -m "arena score --timeline plays a stage and says how long it played, whether it fell, and time seated or standing"
```

---

## Part 2 — `publish --timeline` (microduck_rl, worktree `publish-timeline`)

### Task 6: `publish --timeline`

**Files:**
- Modify: `src/mjlab_microduck/publish/cli.py`, `README.md`
- Test: `tests/test_publish_manifest.py`

**Interfaces:**
- Consumes: nothing from Part 1 (microduck_rl does not depend on the Arena).
- Produces: `PublishConfig.timeline: str | None`. With it, `timeline.json` (the file's bytes, unchanged) is staged beside `policy.onnx`, uploaded in the same commit, or copied into `publish-<name>/` by `--dry-run`. A file that is not JSON exits 2 before anything is exported.

- [ ] **Step 0: Create the worktree and its venv, and record the baseline**

```bash
cd ~/Projects/HuggingFace/microduck_rl
/usr/bin/git worktree add .claude/worktrees/publish-timeline -b publish-timeline develop
cd .claude/worktrees/publish-timeline
/usr/bin/git log --oneline -1          # 981a279, the commit the challenges lock resolves
uv sync --no-config --frozen
.venv/bin/python -m pytest -q tests/test_publish_manifest.py 2>&1 | tail -3
```

- [ ] **Step 1: Write the failing tests**

In `tests/test_publish_manifest.py`, after `test_the_cli_dry_run_writes_a_repo`:

```python
def test_the_cli_dry_run_stages_a_timeline_beside_the_policy(tmp_path, monkeypatch, capsys):
    """A stage event's performance travels with its policy, byte for byte; the manifest does not change."""
    from mjlab_microduck.publish.cli import PublishConfig, run

    policy = _tiny_policy(tmp_path / "out.onnx")
    timeline = tmp_path / "moves.json"
    timeline.write_text('{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}]}\n')
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(
        repo="someone/microduck-swag", kind="perpetual", onnx=str(policy), slot="sitstand",
        timeline=str(timeline), dry_run=True,
    )) == 0
    out = tmp_path / "publish-swag"
    assert (out / "timeline.json").read_bytes() == timeline.read_bytes()
    assert "timeline" not in json.loads((out / "manifest.json").read_text())
    assert f"dry run: wrote {out}/ (policy.onnx, manifest.json, README.md, timeline.json)\n" in capsys.readouterr().out


def test_a_timeline_that_is_not_json_is_refused_before_anything_is_built(tmp_path, monkeypatch, capsys):
    from mjlab_microduck.publish.cli import PublishConfig, run

    policy = _tiny_policy(tmp_path / "out.onnx")
    bad = tmp_path / "moves.json"
    bad.write_text("{nope")
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit) as exit_:
        run(PublishConfig(repo="someone/microduck-swag", kind="perpetual", onnx=str(policy),
                          timeline=str(bad), dry_run=True))
    assert exit_.value.code == 2
    assert "--timeline" in capsys.readouterr().err
    assert not (tmp_path / "publish-swag").exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest -q tests/test_publish_manifest.py -k timeline`
Expected: `TypeError: PublishConfig.__init__() got an unexpected keyword argument 'timeline'`.

- [ ] **Step 3: Implement**

In `src/mjlab_microduck/publish/cli.py`:

1. Add `import json` to the imports.
2. In `PublishConfig`, after `twist_help`:

```python
    timeline: str | None = None
    """A stage event's performance (timeline.json): uploaded at the repo root beside policy.onnx.
    The Arena checks its format; publish refuses only a file that is not JSON."""
```

3. The `dry_run` docstring becomes `"""Write policy.onnx, manifest.json and README.md (and checkpoint.pt, timeline.json when given) to ./publish-<name>/ and stop."""`.
4. After `_default_name`, add:

```python
def _read_timeline(path: str) -> bytes:
    """The --timeline file's bytes, refused unless they parse as JSON."""
    try:
        data = Path(path).read_bytes()
        json.loads(data)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        _fail(f"--timeline {path}: not a readable JSON file ({e})")
    return data
```

5. In `run`, right after `name = cfg.name or _default_name(cfg.repo)`:

```python
    timeline = _read_timeline(cfg.timeline) if cfg.timeline else None  # refuse before the export
```

6. After `(staged / "README.md").write_text(...)`:

```python
        if timeline is not None:
            (staged / "timeline.json").write_bytes(timeline)
```

7. In the dry-run branch, `extra = ", checkpoint.pt" if checkpoint is not None else ""` becomes:

```python
            extra = (", checkpoint.pt" if checkpoint is not None else "") + \
                    (", timeline.json" if timeline is not None else "")
```

`upload_folder(staged)` already uploads every staged file, so the upload needs no change.

8. In `README.md`, in the `publish` examples, after the "A new gait for a slot" example, add:

```bash

# A performance for the Arena's Swag Contest: the policy, and the timeline the Arena plays
uv run publish --onnx output.onnx --repo <user>/microduck-my-swag --kind perpetual --slot sitstand \
    --timeline timeline.json
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest -q tests/test_publish_manifest.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/mjlab_microduck/publish/cli.py README.md tests/test_publish_manifest.py
/usr/bin/git commit -m "publish --timeline uploads a stage performance's timeline.json beside the policy"
```

---

## Part 3 — The `swag_contest` challenge (microduck-challenges, worktree `swag-stage`)

### Task 7: the sit & stand env, on the Arena's solver

**Files:**
- Replace: `src/microduck_challenges/swag_contest/env.py`, `src/microduck_challenges/swag_contest/challenge.toml`
- Modify: `tests/test_challenges.py`
- Create: `tests/test_swag_contest.py`

**Interfaces:**
- Consumes: the Arena worktree (Tasks 2–5) installed in editable mode: `arena.course.compile_course`, `arena.manifest.load_event("swag-contest")` as a stage, `arena.constants.DECIMATION`.
- Produces: `microduck_challenges.swag_contest.env.make_env_cfg(play: bool = False)` and `RL_CFG` (`experiment_name == "swag_contest"`). The task id `Mjlab-SwagContest-MicroDuck` and `tasks.py` are unchanged. Knobs: `head_reward` → `head_pose_tracking`, `stillness_reward` → `posture_stillness`, `upright_reward` → `upright_linear`.

- [ ] **Step 0: Create the worktree and its venv with the stage Arena, and record the baseline**

```bash
cd ~/Projects/HuggingFace/microduck-challenges
/usr/bin/git worktree add .claude/worktrees/swag-stage -b swag-stage main
cd .claude/worktrees/swag-stage
export HF_TOKEN=$(cat ~/.cache/huggingface/token)
uv sync --no-config --frozen --group workshop
uv pip install --no-config --python .venv/bin/python --no-deps -e ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/swag-stage
.venv/bin/python -c "import arena, arena.timeline, arena.stage; print(arena.__file__)"
.venv/bin/python -m pytest -q 2>&1 | tail -3
```

Expected: `arena.__file__` is inside `microduck-arena/.claude/worktrees/swag-stage`; the suite passes. From here on, no `uv run` and no `uv sync` in this worktree (Global Constraints).

- [ ] **Step 1: Write the failing tests**

In `tests/test_challenges.py`:

1. Import `MICRODUCK_STANDUP_ROBOT_CFG` next to the two robot cfgs already imported, and add `import numpy as np`.
2. The `"swag_contest"` row of `CHALLENGES` becomes:

```python
    "swag_contest": {
        "head_reward": ("head_pose_tracking", 1.3),
        "stillness_reward": ("posture_stillness", 3.1),
        "upright_reward": ("upright_linear", 3.7),
    },
```

3. `test_the_robot_matches_the_events_rig` becomes:

```python
@pytest.mark.parametrize("folder", CHALLENGES)
def test_the_robot_matches_the_events_rig(folder):
    # One robot per rig. A legs challenge may use the standup variant, which is the
    # same robot with the collision set a seated trunk needs (next test).
    env = importlib.import_module(f"microduck_challenges.{folder}.env")
    robot = env.make_env_cfg().scene.entities["robot"]
    expected = {
        "legs": (MICRODUCK_WALK_ROBOT_CFG, MICRODUCK_STANDUP_ROBOT_CFG),
        "rollers": (MICRODUCK_WALK_ROLLERS_ROBOT_CFG,),
    }
    assert any(robot is cfg for cfg in expected[load_event(_contract(folder).event).rig])


def test_the_standup_robot_is_the_walk_robot_with_other_collisions():
    """One robot in every challenge (MJCF, masses, actuators); only the collision set may differ."""
    walk, standup = MICRODUCK_WALK_ROBOT_CFG, MICRODUCK_STANDUP_ROBOT_CFG
    assert standup.articulation == walk.articulation
    assert standup.init_state == walk.init_state
    a, b = walk.spec_fn().compile(), standup.spec_fn().compile()
    assert [a.body(i).name for i in range(a.nbody)] == [b.body(i).name for i in range(b.nbody)]
    assert [a.joint(i).name for i in range(a.njnt)] == [b.joint(i).name for i in range(b.njnt)]
    for field in ("body_mass", "body_inertia", "body_ipos", "body_iquat", "body_pos", "body_quat",
                  "jnt_range", "dof_armature", "dof_damping", "dof_frictionloss"):
        np.testing.assert_allclose(getattr(a, field), getattr(b, field), err_msg=field)
```

`tests/test_swag_contest.py`:

```python
"""The swag trains in the Arena's physics, and reads the command a timeline carries."""

import importlib
import math

import pytest

import microduck_challenges  # noqa: F401  (registers every task)
from arena.constants import DECIMATION
from arena.course import compile_course
from arena.manifest import load_event
from mjlab_microduck.tasks import mdp as microduck_mdp


@pytest.fixture(scope="module")
def cfg():
    return importlib.import_module("microduck_challenges.swag_contest.env").make_env_cfg()


@pytest.fixture(scope="module")
def arena():
    return compile_course(load_event("swag-contest"))


def _training_model(entity):
    """The robot as training compiles it: its MJCF with the entity's collision
    settings applied (mjlab's Entity runs each CollisionCfg.edit_spec on the spec)."""
    spec = entity.spec_fn()
    for collision in entity.collisions:
        collision.edit_spec(spec)
    return spec.compile()


def _body(model, geom):
    return model.body(int(model.geom_bodyid[geom])).name


def _robot_geoms(model, skip):
    return [g for g in range(model.ngeom)
            if (model.geom_contype[g] or model.geom_conaffinity[g]) and _body(model, g) not in skip]


def _colliding(model, skip):
    """(body, geom type) of every geom that can collide, bodies in `skip` left out."""
    return sorted((_body(model, g), int(model.geom_type[g])) for g in _robot_geoms(model, skip))


# mjlab's flat terrain (terrain_entity._import_ground_plane) is a plane with
# MuJoCo's default contact: priority 0, condim 3, sliding friction 1.
FLOOR = (0, 3, 1.0)


def _floor_contacts(model, skip):
    """(body, condim, sliding friction) of each robot geom's contact with that floor.
    MuJoCo pairs two geoms by priority first; at equal priority it takes the larger
    condim and the larger friction."""
    out = []
    for g in _robot_geoms(model, skip):
        priority, condim, friction = int(model.geom_priority[g]), int(model.geom_condim[g]), float(model.geom_friction[g][0])
        if priority > FLOOR[0]:
            pair = (condim, friction)
        elif priority < FLOOR[0]:
            pair = FLOOR[1:]
        else:
            pair = (max(condim, FLOOR[1]), max(friction, FLOOR[2]))
        out.append((_body(model, g), *pair))
    return sorted(out)


def test_the_swag_collides_like_the_arena(cfg, arena):
    # A sit puts the trunk and hips on the floor: training must collide with the
    # same robot geoms as the Arena's stage, or a seated trunk sinks in one and
    # not the other.
    robot = _training_model(cfg.scene.entities["robot"])
    assert _colliding(robot, skip={"world"}) == _colliding(arena, skip={"world", "course"})


def test_the_swag_touches_the_floor_like_the_arena(cfg, arena):
    """Every robot geom meets the floor with the Arena's condim and friction.
    Robot-on-robot contacts are where the two differ: training gives its non-foot
    geoms condim 1 (FULL_COLLISION), so two of them touch without friction, and
    the Arena's are all condim 3."""
    floor = arena.geom("floor").id
    assert (int(arena.geom_priority[floor]), int(arena.geom_condim[floor]), float(arena.geom_friction[floor][0])) == FLOOR
    robot = _training_model(cfg.scene.entities["robot"])
    assert _floor_contacts(robot, skip={"world"}) == _floor_contacts(arena, skip={"world", "course"})


def test_the_swag_solves_contacts_like_the_arena(cfg, arena):
    assert cfg.sim.mujoco.iterations == arena.opt.iterations
    assert cfg.sim.mujoco.ls_iterations == arena.opt.ls_iterations
    assert math.isclose(cfg.sim.mujoco.timestep, arena.opt.timestep)
    assert cfg.decimation == DECIMATION


def test_the_swag_plays_on_after_a_fall_like_the_stage(cfg):
    assert "fell_over" not in cfg.terminations
    assert "nan_state" in cfg.terminations


def test_the_swag_reads_what_a_timeline_carries(cfg):
    """twist.vx is the sit flag, head_pose the 4 head deltas, body zeros: a
    keyframe's 13 numbers, in the 61-D observation's command slot."""
    assert isinstance(cfg.commands["twist"], microduck_mdp.SitStandCommandCfg)
    assert len(cfg.commands["head_pose"].ranges) == 4
    actor = cfg.observations["actor"].terms
    assert list(actor)[-3:] == ["command", "head_command", "body_command"]
    assert actor["head_command"].params == {"command_name": "head_pose"}
    assert actor["body_command"].func is microduck_mdp.zero_command_padding
    assert actor["body_command"].params == {"dim": 6}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest -q tests/test_swag_contest.py tests/test_challenges.py`
Expected: the swag tests fail against the old walking env: `SitStandCommandCfg`, the solver's `decimation`, `fell_over` present, and the knob names (`head_reward` exists, `stillness_reward` does not).

- [ ] **Step 3: Copy the sitstand env and adapt it**

```bash
/usr/bin/git -C ~/Projects/HuggingFace/microduck_rl show 981a279:src/mjlab_microduck/tasks/microduck_sitstand_env_cfg.py \
    > src/microduck_challenges/swag_contest/env.py
```

981a279 is the commit `uv.lock` resolves (`grep -n 'microduck_rl?branch=challenge-recipe-publishing#' uv.lock`). If the lock names another commit, copy from that one.

Then edit `src/microduck_challenges/swag_contest/env.py`:

1. Replace the docstring's first line (`"""Microduck *sitstand* task (v1.5, mjlab 1.3.0) — commanded sit ↔ stand, GENTLY.`) with:

```python
"""The Swag Contest's training environment: Microduck sits and stands on command.

A complete copy of microduck_rl's sitstand task (microduck_sitstand_env_cfg.py,
the config behind alpha_sitstand), made the swag contest's own: flat ground
only, the Arena's contact solver, and three reward weights a novice tunes read
from challenge.toml ([params]). The Arena plays each entry's timeline.json on a
stage: twist.vx is the sit flag (1 = sit, 0 = stand), head is 4 deltas from the
default pose (neck_pitch, head_pitch, head_yaw, head_roll). Everything here is
yours to change; the robot (MICRODUCK_STANDUP_ROBOT_CFG) and the reward
functions (microduck_mdp) come from mjlab_microduck and are not edited here.

The source's own notes follow.

Microduck *sitstand* task (v1.5, mjlab 1.3.0) — commanded sit ↔ stand, GENTLY.
```

(The rest of the docstring stays as it is.)

2. Imports: delete `MICRODUCK_ROUGH_TERRAINS_CFG,` from the `microduck_velocity_env_cfg` import, and add `from mjlab_microduck import challenge` above `from mjlab_microduck.robot.microduck_constants import ...`.
3. The function header:

```python
def make_env_cfg(
    play: bool = False,
) -> ManagerBasedRlEnvCfg:
    """The swag contest's training environment."""

    # The knobs a novice tunes, from challenge.toml beside this file.
    knobs = challenge.params(__file__)
```

(replacing `def make_microduck_sitstand_env_cfg(play: bool = False, rough: bool = False) -> ...:` and its docstring).
4. The knobs: in `cfg.rewards["head_pose_tracking"]`, `weight=0.75,` becomes `weight=knobs["head_reward"],`. In `cfg.rewards["upright_linear"]`, `weight=2.5,` becomes `weight=knobs["upright_reward"],`. In `cfg.rewards["posture_stillness"]`, `weight=2.0,` becomes `weight=knobs["stillness_reward"],`.
5. The solver block:

```python
    cfg.sim.nconmax = 200
    cfg.sim.mujoco.iterations = 30
    cfg.sim.mujoco.ls_iterations = 50
```

becomes:

```python
    # The Arena solves every contact with 10/20 (arena/course.py), so the swag
    # trains with it too; the source's 30/50 above was its seated-contact NaN
    # fix, and alpha_sitstand sits and rises at 10/20 all the same. nconmax is a
    # contact buffer, not physics: 200 keeps a seated pose from overflowing it.
    cfg.sim.nconmax = 200
    cfg.sim.mujoco.iterations = 10
    cfg.sim.mujoco.ls_iterations = 20
```

6. The terrain and curriculum branches on `rough` become:

```python
    # ── Terrain ───────────────────────────────────────────────────────────────
    # Flat: the Arena's stage is an open floor.
    cfg.scene.terrain.terrain_type = "plane"
    cfg.scene.terrain.terrain_generator = None
```

and `del cfg.curriculum["terrain_levels"]` without the `if not rough:`. After the edit, `grep -n rough src/microduck_challenges/swag_contest/env.py` finds nothing but prose.
7. The runner config: `MicroduckSitStandRlCfg = RslRlOnPolicyRunnerCfg(` becomes `RL_CFG = RslRlOnPolicyRunnerCfg(`, and `experiment_name="microduck_sitstand"` / `run_name="microduck_sitstand"` become `"swag_contest"` (with the comment `# logs/rsl_rl/swag_contest/` like the other challenges).

`src/microduck_challenges/swag_contest/challenge.toml`, whole file:

```toml
# The Swag Contest: a 20 s performance on a stage. The Arena plays your
# timeline.json (when to sit, when to stand, where to look); visitors vote.
# Nothing is timed. Make the moves yours.
event = "swag-contest"
task  = "Mjlab-SwagContest-MicroDuck"
kind  = "perpetual"

[recipe]                  # the first training, as is
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.head_reward]
label = "Follow the head moves"
value = 0.75
min   = 0.0
max   = 2.0

[params.stillness_reward]
label = "Hold still between moves"
value = 2.0
min   = 0.0
max   = 4.0

[params.upright_reward]
label = "Stay upright"
value = 2.5
min   = 0.5
max   = 5.0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass. A failing parity test (`test_the_standup_robot_is_the_walk_robot_with_other_collisions`, `test_the_swag_collides_like_the_arena`, `test_the_swag_touches_the_floor_like_the_arena`) is a finding, not a test to loosen: stop and report exactly which field or geom differs. The owner decides. (The 61-D observation itself is checked at export: `publish` refuses a graph that is not `[1,61] -> [1,14]`.)

- [ ] **Step 5: Smoke-train on CPU**

```bash
.venv/bin/train Mjlab-SwagContest-MicroDuck --gpu-ids None --env.scene.num-envs 2 \
    --agent.max-iterations 2 --agent.save-interval 1 --agent.logger tensorboard --agent.run-name smoke
ls logs/rsl_rl/swag_contest/*_smoke/model_1.pt
rm -rf logs/rsl_rl/swag_contest/*_smoke
```

Expected: two iterations run, `model_1.pt` exists.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/microduck_challenges/swag_contest/env.py src/microduck_challenges/swag_contest/challenge.toml tests/
/usr/bin/git commit -m "swag_contest: microduck_rl's sit & stand env on the Arena's 10/20 solver, with head, stillness and upright knobs"
```

### Task 8: the reference choreography and `check.py`

**Files:**
- Create: `src/microduck_challenges/swag_contest/timeline.json`, `src/microduck_challenges/swag_contest/check.py`
- Modify: `tests/test_swag_contest.py`, `README.md`

**Interfaces:**
- Consumes: `arena.timeline.load_timeline`, `Timeline` (Task 1); `arena.stage` (Task 5); `arena.evaluate.evaluate(manifest, policy, timeline)` (Task 4); `arena.policy.load_policy`; the env's head curriculum and dwell times (Task 7).
- Produces: `microduck_challenges.swag_contest.check.report(trace, timeline, termination) -> tuple[list[str], bool, float]` (lines, passed, largest head error in rad) and `main(argv=None) -> int` (0 pass, 1 fail). Run it with `.venv/bin/python -m microduck_challenges.swag_contest.check policy.onnx [--timeline FILE]`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_swag_contest.py`, add to the imports at the top:

```python
from pathlib import Path

import numpy as np

from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, DEFAULT_POSE, JOINT_NAMES, TRACE_WIDTH
from arena.timeline import Timeline, load_timeline
```

(`from arena.constants import DECIMATION` from Task 7 joins the `arena.constants` line.) Then append:

```python
TIMELINE = Path(microduck_challenges.__file__).parent / "swag_contest" / "timeline.json"


def test_the_reference_timeline_plays_on_the_arena():
    timeline = load_timeline(TIMELINE, load_event("swag-contest").time_limit_s)
    assert timeline.duration_s == 20.0
    assert len(timeline.times) == 9


def test_the_reference_timeline_stays_inside_what_training_saw(cfg):
    timeline = load_timeline(TIMELINE, load_event("swag-contest").time_limit_s)
    final = cfg.curriculum["head_pose_range"].params["range_stages"][-1]["ranges"]
    dwell = cfg.commands["twist"].resampling_time_range[0]
    head_every = cfg.commands["head_pose"].resampling_time_range[0]
    flags = [c[0] for c in timeline.commands]
    assert set(flags) <= {0.0, 1.0}
    for command in timeline.commands:
        assert command[1:3] == (0.0, 0.0) and command[7:] == (0.0,) * 6
        for value, (_, hi) in zip(command[3:7], final):
            assert abs(value) <= 0.4 * hi
    changes = [t for i, t in enumerate(timeline.times) if i and flags[i] != flags[i - 1]]
    bounds = changes + [timeline.duration_s]
    assert all(b - a >= dwell for a, b in zip(bounds, bounds[1:]))
    head_changes = [t for i, t in enumerate(timeline.times)
                    if i and timeline.commands[i][3:7] != timeline.commands[i - 1][3:7]]
    assert all(b - a >= head_every for a, b in zip(head_changes, head_changes[1:]))


STAND = (0.0,) * 13
SIT_LEFT = (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6
EIGHT_S = Timeline(8.0, (0.0, 2.0, 5.0), (STAND, SIT_LEFT, STAND))


def _trace(z_at, yaw_at=lambda t: 0.0, tilt_at=lambda t: 0.0, duration_s=8.0):
    """A synthetic performance: trunk height, head yaw delta and roll tilt as functions of time."""
    n = round(duration_s / CTRL_DT)
    trace = np.zeros((n, TRACE_WIDTH), dtype=np.float32)
    for i in range(n):
        t = i * CTRL_DT
        half = np.radians(tilt_at(t)) / 2
        trace[i, 2] = z_at(t)
        trace[i, 3:7] = (np.cos(half), np.sin(half), 0.0, 0.0)
        trace[i, 7:] = DEFAULT_POSE
        trace[i, 7 + JOINT_NAMES.index("head_yaw")] += yaw_at(t)
    return trace


def _seated_between(a, b):
    return lambda t: 0.06 if a <= t < b else 0.115


def _report(trace):
    from microduck_challenges.swag_contest import check

    return check.report(trace, EIGHT_S, load_event("swag-contest").termination)


def test_a_performance_that_follows_its_timeline_passes():
    lines, passed, head = _report(_trace(_seated_between(3.0, 5.8), yaw_at=lambda t: 0.5 if 2.3 <= t < 5.0 else 0.0))
    assert passed, lines
    assert len(lines) == 4  # three keyframes, then the fall line
    assert head < 0.01


def test_a_sit_never_reached_fails():
    lines, passed, _ = _report(_trace(lambda t: 0.115))
    assert not passed
    assert "sit: not reached within 1.5 s" in lines[1]


def test_a_sit_reached_late_fails():
    lines, passed, _ = _report(_trace(_seated_between(3.8, 5.8)))
    assert not passed
    assert "sit: not reached within 1.5 s" in lines[1]


def test_a_sit_left_early_fails():
    lines, passed, _ = _report(_trace(_seated_between(3.0, 4.0)))
    assert not passed
    assert "left at 4.00 s" in lines[1]


def test_a_head_far_from_its_command_fails():
    lines, passed, head = _report(_trace(_seated_between(3.0, 5.8), yaw_at=lambda t: 0.9 if 2.3 <= t < 5.0 else 0.0))
    assert not passed
    assert head == pytest.approx(0.4, abs=1e-3)
    assert "head: off by 0.40 rad" in lines[1]


def test_a_fall_fails():
    lines, passed, _ = _report(_trace(_seated_between(3.0, 5.8), tilt_at=lambda t: 80.0 if t >= 6.0 else 0.0))
    assert not passed
    assert lines[-1] == "fell at 6.30 s"


def test_check_plays_the_stage_and_fails_a_walker(capsys):
    """End to end on the Arena: the reference walker does not sit."""
    from microduck_challenges.swag_contest import check

    assert check.main([str(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")]) == 1
    out = capsys.readouterr().out.splitlines()
    assert len(out) == 9 + 2  # a line per keyframe, the fall line, the verdict
    assert out[-1].startswith("FAIL: largest head error ")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest -q tests/test_swag_contest.py`
Expected: the new tests fail: no `timeline.json`, no `check` module.

- [ ] **Step 3: Write the choreography**

`src/microduck_challenges/swag_contest/timeline.json`:

```json
{
  "timeline_version": 1,
  "duration_s": 20.0,
  "keyframes": [
    {"t": 0.0,  "twist": [0, 0, 0], "head": [0, 0, 0, 0]},
    {"t": 2.0,  "twist": [1, 0, 0], "head": [0, 0, 0.5, 0]},
    {"t": 4.5,  "twist": [1, 0, 0], "head": [0, 0, -0.5, 0]},
    {"t": 7.0,  "twist": [0, 0, 0], "head": [0, 0, 0, 0]},
    {"t": 9.0,  "twist": [0, 0, 0], "head": [0, 0.4, 0, 0]},
    {"t": 11.0, "twist": [1, 0, 0], "head": [0, 0, 0, 0]},
    {"t": 15.0, "twist": [0, 0, 0], "head": [0, 0, 0.5, 0]},
    {"t": 17.0, "twist": [0, 0, 0], "head": [0, 0, -0.5, 0]},
    {"t": 19.0, "twist": [0, 0, 0], "head": [0, 0, 0, 0]}
  ]
}
```

- [ ] **Step 4: Write `check.py`**

`src/microduck_challenges/swag_contest/check.py`:

```python
"""Does a swag policy perform its timeline on the Arena's stage?

    .venv/bin/python -m microduck_challenges.swag_contest.check policy.onnx [--timeline FILE]

Plays the stage the way the Arena scores an entry (arena.evaluate, with this
folder's timeline.json by default), then checks the performance against the
timeline, keyframe by keyframe:

- no fall, by the event's own rule;
- after each change of the sit flag (twist.vx) to 1: seated within 1.5 s, and
  seated until the flag changes again;
- at the start and after each change to 0: standing upright within 1.5 s, and
  standing until the flag changes again;
- every keyframe held 2 s or more: each head joint within 0.25 rad of the
  default pose plus the keyframe's head command, over the hold's last 0.5 s.

Seated and standing are the Arena's own readings (arena.stage). Prints a line
per keyframe; exits 1 when anything fails.
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from arena import stage
from arena.constants import CTRL_DT, DEFAULT_POSE, JOINT_NAMES
from arena.evaluate import evaluate
from arena.manifest import load_event
from arena.policy import load_policy
from arena.timeline import Timeline, load_timeline

EVENT = "swag-contest"
TIMELINE = Path(__file__).with_name("timeline.json")
REACH_S = 1.5
HEAD_HOLD_S = 2.0
HEAD_WINDOW_S = 0.5
HEAD_TOLERANCE_RAD = 0.25
HEAD_JOINTS = [JOINT_NAMES.index(n) for n in ("neck_pitch", "head_pitch", "head_yaw", "head_roll")]


def _frames(start_s: float, end_s: float) -> slice:
    """The trace frames of the control steps that start in [start_s, end_s)."""
    return slice(round(start_s / CTRL_DT), round(end_s / CTRL_DT))


def _flag_segments(timeline: Timeline) -> list[tuple[float, float, bool]]:
    """(start, end, sit) for each stretch where the sit flag keeps one value."""
    segments: list[tuple[float, float, bool]] = []
    for t, command in zip(timeline.times, timeline.commands):
        sit = command[0] >= 0.5
        if segments and segments[-1][2] == sit:
            continue
        if segments:
            segments[-1] = (segments[-1][0], t, segments[-1][2])
        segments.append((t, timeline.duration_s, sit))
    return segments


def _posture(trace, start_s: float, end_s: float, sit: bool) -> tuple[str, bool]:
    name = "sit" if sit else "stand"
    window = (stage.seated(trace) if sit else stage.standing(trace))[_frames(start_s, end_s)]
    reach = window[: round(REACH_S / CTRL_DT)]
    if not reach.any():
        return f"{name}: not reached within {REACH_S:g} s", False
    first = int(np.argmax(reach))
    if not window[first:].all():
        left = start_s + (first + int(np.argmin(window[first:]))) * CTRL_DT
        return f"{name}: reached after {first * CTRL_DT:.2f} s, left at {left:.2f} s", False
    return f"{name}: reached after {first * CTRL_DT:.2f} s, held until {end_s:.2f} s", True


def _head(trace, command, start_s: float, end_s: float) -> tuple[str, bool, float]:
    if end_s - start_s < HEAD_HOLD_S:
        return f"head: held under {HEAD_HOLD_S:g} s, not checked", True, 0.0
    angles = trace[_frames(end_s - HEAD_WINDOW_S, end_s)][:, [7 + j for j in HEAD_JOINTS]]
    if not len(angles):
        return "head: the performance ended before this hold", False, float("inf")
    target = DEFAULT_POSE[HEAD_JOINTS] + np.asarray(command[3:7])
    worst = float(np.abs(angles.mean(axis=0) - target).max())
    return f"head: off by {worst:.2f} rad", worst <= HEAD_TOLERANCE_RAD, worst


def report(trace, timeline: Timeline, termination) -> tuple[list[str], bool, float]:
    """A line per keyframe then the fall line, whether everything passed, and the largest head error."""
    starts = {start: (end, sit) for start, end, sit in _flag_segments(timeline)}
    ends = list(timeline.times[1:]) + [timeline.duration_s]
    lines, passed, head_error = [], True, 0.0
    for t, command, end in zip(timeline.times, timeline.commands, ends):
        parts = []
        if t in starts:
            text, ok = _posture(trace, t, *starts[t])
            parts.append(text)
            passed &= ok
        text, ok, worst = _head(trace, command, t, end)
        parts.append(text)
        passed &= ok
        head_error = max(head_error, worst)
        lines.append(f"t={t:5.2f}  " + "; ".join(parts))
    fell = stage.fell_at(trace, termination)
    lines.append("no fall" if fell is None else f"fell at {fell:.2f} s")
    return lines, passed and fell is None, head_error


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Check a swag policy's performance on the Arena's stage.")
    parser.add_argument("onnx")
    parser.add_argument("--timeline", default=str(TIMELINE))
    args = parser.parse_args(argv)
    event = load_event(EVENT)
    timeline = load_timeline(Path(args.timeline), event.time_limit_s)
    result = evaluate(event, load_policy(Path(args.onnx)), timeline)
    lines, passed, head_error = report(result.trace, timeline, event.termination)
    print("\n".join(lines))
    print(f"{'PASS' if passed else 'FAIL'}: largest head error {head_error:.2f} rad")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
```

A run that diverged has a short trace: its later holds find no frames and fail, so it cannot pass.

- [ ] **Step 5: Say it in the README**

In `README.md`, after the challenges table, add:

```markdown
The Swag Contest is a performance, not a race: the Arena plays the entry's
`timeline.json` for up to 20 s on an open stage, and visitors vote.
`swag_contest/timeline.json` is Pollen's: `twist[0]` is the sit flag (1 sits,
0 stands) and `head` is 4 deltas in radians from the default pose (neck_pitch,
head_pitch, head_yaw, head_roll). Check a policy against a timeline with
`uv run --group workshop python -m microduck_challenges.swag_contest.check policy.onnx [--timeline FILE]`,
and publish the timeline with the policy: `uv run publish … --timeline src/microduck_challenges/swag_contest/timeline.json`.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add src/microduck_challenges/swag_contest/timeline.json src/microduck_challenges/swag_contest/check.py tests/test_swag_contest.py README.md
/usr/bin/git commit -m "swag_contest: Pollen's 20 s reference choreography, and check.py to judge a policy's performance of it on the Arena"
```

---

## Part 4 — Training and acceptance (controller tasks, not dispatched to an implementer)

These two tasks spend paid compute and hours of wall time, so the controller runs them itself (a subagent stalls waiting on background runs). Results go into the SDD ledger.

### Task 9: train the reference on HF Jobs

**Depends on:** Task 7 reviewed and committed (the job uploads a snapshot of the worktree, so it must be clean).

- [ ] **Step 1: Launch**

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/swag-stage
/usr/bin/git status --short        # empty: provenance must not be dirty
export HF_TOKEN=$(cat ~/.cache/huggingface/token)
.venv/bin/train Mjlab-SwagContest-MicroDuck --hf-jobs --no-wandb --namespace Nico-robot --timeout 8h \
    --env.scene.num-envs 4096 --agent.max-iterations 3000 --agent.seed 1 \
    --agent.logger tensorboard --agent.run-name reference > $SCRATCH/swag-stage.log 2>&1
```

Run it with the Bash tool's `run_in_background`, because the process streams the job's log until the job ends. Record the job id and the checkpoint repo (`Nico-robot/mjlab-swagcontest-microduck-<stamp>`, printed near the top of the log) in the ledger.

- [ ] **Step 2: Watch it**

Copy the previous session's tools into this session's scratchpad: `cp /private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/98dce1b5-4c3b-4860-a42d-02a9eb1ddeb0/scratchpad/{progress.py,wait_ckpt.sh} $SCRATCH/`. In `wait_ckpt.sh`, `cd` into the challenges main checkout (whose venv is untouched) and keep `uv run --no-config --frozen`, as written. Add `"Episode_Termination/nan_state"`, `"Episode_Reward/posture_composite"` and `"Episode_Reward/head_pose_tracking"` to `progress.py`'s `KEYS`. Check `python3 $SCRATCH/progress.py $SCRATCH/swag-stage.log` about every 20–30 minutes.

- Cancel (`.venv/bin/hf jobs cancel <id> --namespace Nico-robot`) when the job has failed to start, or when training collapses: mean episode length falling for 250+ iterations after it had risen, or `nan_state` above 1 % of terminations after iteration 500 (the source's 30/50 solver was its NaN fix). Diagnose before relaunching. Relaunch at most once without reporting to the owner.
- ~1.2–3 s per iteration on l4x1: 1–2.5 h for 3000 iterations.

### Task 10: judge every checkpoint, and pick the reference

**Depends on:** Tasks 5, 6 and 8 committed. Checkpoints appear every 250 iterations while Task 9 runs, so judging starts as soon as `model_1000.pt` exists.

- [ ] **Step 1: Install the `publish --timeline` worktree into the challenges venv**

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/swag-stage
uv pip install --no-config --python .venv/bin/python --no-deps -e ~/Projects/HuggingFace/microduck_rl/.claude/worktrees/publish-timeline
.venv/bin/publish --help | grep -- --timeline
```

- [ ] **Step 2: Write the training-env probe**

`$SCRATCH/swag_probe.py`:

```python
"""A swag ONNX in the swag's TRAINING env, deterministic and without pushes.

Two passes of 8 envs, one from seated starts and one from standing starts. The
sit flag is written into the observation (head and body at 0) and toggled every
4 s for 16 s. For each flag change, the pass reports how many envs reached the
pose within 1.5 s (seated: trunk z < 0.07; standing: z > 0.10 and tilt <= 20 deg).
usage: .venv/bin/python swag_probe.py policy.onnx
"""
import sys

import numpy as np
import onnxruntime as ort
import torch

import microduck_challenges  # noqa: F401
from microduck_challenges.swag_contest.env import make_env_cfg
from mjlab.envs import ManagerBasedRlEnv

N, PERIOD_S, TOTAL_S, REACH_S = 8, 4.0, 16.0, 1.5
sess = ort.InferenceSession(sys.argv[1])
name = sess.get_inputs()[0].name
failures = 0
for seated_start in (True, False):
    cfg = make_env_cfg()
    cfg.scene.num_envs = N
    cfg.episode_length_s = TOTAL_S + 2.0
    cfg.events.pop("push_robot")
    cfg.curriculum.pop("push_magnitude")
    cfg.events["set_ground_state"].params["sitting_prob"] = 1.0 if seated_start else 0.0
    cfg.events["set_ground_state"].params["standing_prob"] = 0.0 if seated_start else 1.0
    env = ManagerBasedRlEnv(cfg=cfg, device="cpu")
    obs, _ = env.reset()
    robot = env.scene["robot"]
    reached = {}
    for k in range(round(TOTAL_S / env.step_dt)):
        t = k * env.step_dt
        segment = int(t // PERIOD_S)
        sit = (segment % 2 == 0) == seated_start
        o = obs["actor"].clone().numpy()
        o[:, 48:61] = 0.0
        o[:, 48] = 1.0 if sit else 0.0
        a = np.stack([sess.run(None, {name: x[None].astype(np.float32)})[0][0] for x in o])
        obs, *_ = env.step(torch.from_numpy(a))
        z = robot.data.root_link_pos_w[:, 2]
        q = robot.data.root_link_quat_w
        tilt = torch.rad2deg(torch.acos(torch.clamp(1 - 2 * (q[:, 1] ** 2 + q[:, 2] ** 2), -1, 1)))
        ok = (z < 0.07) if sit else ((z > 0.10) & (tilt <= 20.0))
        if t - segment * PERIOD_S < REACH_S:
            reached[segment] = reached.get(segment, torch.zeros(N, dtype=torch.bool)) | ok
    for segment, got in sorted(reached.items()):
        sit = (segment % 2 == 0) == seated_start
        n = int(got.sum())
        failures += N - n
        start = "seated" if seated_start else "standing"
        print(f"{start} start, t={segment * PERIOD_S:4.1f} {'sit' if sit else 'stand'}: {n}/{N} within {REACH_S} s")
    env.close()
print("PASS" if failures == 0 else f"FAIL: {failures} misses")
sys.exit(1 if failures else 0)
```

Run it once on `alpha_sitstand.onnx` to prove the probe (`hf download pollen-robotics/microduck-policies alpha_sitstand.onnx --local-dir $SCRATCH/sitstand-ref` with `.venv/bin/hf`). The spec's feasibility evidence says it passes. If it does not, fix the probe before trusting it on a checkpoint.

- [ ] **Step 3: For each checkpoint N in 1000, 1250, …, 2750, 2999**

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/swag-stage
REPO=<checkpoint repo from Task 9>
.venv/bin/hf download $REPO --local-dir logs/eval/${REPO#*/} \
    --include "*model_$N.pt" --include "*provenance.json" --include "*params/*"
RUN=$(dirname $(ls -d logs/eval/${REPO#*/}/*/*/model_$N.pt | head -1))
.venv/bin/publish --run $RUN --checkpoint $N --dry-run --repo Nico-robot/microduck-swag-eval-$N
cp publish-swag-eval-$N/policy.onnx $SCRATCH/evals/swag-$N.onnx && rm -rf publish-swag-eval-$N
.venv/bin/python -m microduck_challenges.swag_contest.check $SCRATCH/evals/swag-$N.onnx
.venv/bin/arena score $SCRATCH/evals/swag-$N.onnx --event swag-contest
.venv/bin/python $SCRATCH/swag_probe.py $SCRATCH/evals/swag-$N.onnx
```

(`mkdir -p $SCRATCH/evals` once.) A checkpoint passes when `check.py` passes; the no-timeline `arena score` says `fell: no` with standing close to 20 s; and the probe passes. Record in the ledger, for each N: `check.py`'s verdict, its failing lines and its largest head error; the `arena score` summary; the probe's 16 lines.

- [ ] **Step 4: Pick and export the reference**

The reference is the passing checkpoint with the smallest head error, the earlier one on a tie. Export it with its timeline:

```bash
.venv/bin/publish --run $RUN --checkpoint $BEST --dry-run --repo pollen-robotics/microduck-swag-contest-reference \
    --slot sitstand --timeline src/microduck_challenges/swag_contest/timeline.json \
    --twist-help '[sit flag: 1 sit, 0 stand; unused; unused]' \
    --description "Sits and stands on the sit flag, head on command; checkpoint $BEST, the swag reference."
.venv/bin/python -m microduck_challenges.swag_contest.check publish-swag-contest-reference/policy.onnx
```

This is a dry run only: `publish-swag-contest-reference/` (gitignored by `publish-*/`) holds `policy.onnx`, `manifest.json`, `README.md`, `checkpoint.pt` and `timeline.json`. Nothing is uploaded.

If no checkpoint passes, stop and report to the owner, with each checkpoint's failing lines and the pattern across them. Do not change the thresholds, the choreography or the rewards to make one pass.

---

## After the tasks

- Final whole-branch review of each of the three branches (subagent-driven's last step).
- Update the memory `swag-stage-design`: branch heads, the checkpoint repo, the reference checkpoint and its `check.py` report, and what remains for the owner (push the three branches, the 0.4.0 wheel and relock, publishing the reference, phase B after plan 4). Report the robot-on-robot contact difference (Task 7's floor-contact test) to the owner.
