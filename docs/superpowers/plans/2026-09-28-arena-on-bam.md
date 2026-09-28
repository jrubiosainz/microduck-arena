# The Arena drives the robot with BAM — implementation plan (plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Arena's evaluator actuates the Microduck exactly as training does — the BAM XL330 "m6" actuator model with nominal values — instead of MJCF position servos, so a policy races on the Arena under the physics it learned in; runs become `RUNNER_VERSION` 4.

**Architecture:** A vendored, numpy-only port of the BAM control law and friction budget (`arena/actuator.py`, from Rhoban/bam at rev `62bd8ce`, Apache-2.0) is driven once per physics substep by `arena/runner.py`. `arena/course.py` compiles the course through `MjSpec` and converts the 14 position actuators into torque motors with BAM's joint parameters, as `bam.mjlab.BamActuator.edit_spec` does in training. No new runtime dependency: the Space still installs numpy, mujoco and onnxruntime only. A parity test in `microduck-challenges` (the one environment holding `arena`, `bam` and torch together) pins the vendored numbers and math to bam's.

**Tech Stack:** Python 3.12, MuJoCo 3.10.0 (MjSpec), numpy 2.4.1, pytest; bam (better-actuator-models) @ 62bd8ce and torch only in the challenges repo's test.

**Spec:** `docs/superpowers/specs/2026-09-24-challenge-workshop-design.md` (versions and the golden run: *Versions and distribution*, *The Space*), and the owner's decision of 2026-09-28: "align the Arena on the BAM model". Research behind this plan (facts with file:line, the numpy prototype, measurements): the session scratchpad `bam-align/` — `bam_arena_prototype.py` (a working version of everything below), `parity.py`, `mjlab_vs_cpu.py`, `score.py` — copied into this plan's SDD workspace (`.superpowers/sdd/2026-09-28-arena-on-bam/research/`, git-ignored).

## Where things are

- Arena repo: `~/Projects/HuggingFace/microduck-arena`, local `main` (not pushed). Execute in a worktree `.claude/worktrees/arena-bam` on branch `arena-bam`.
- Another session is executing plan 4 (the workshop) on its own branch in this repo. It does not touch `arena/runner.py`, `arena/course.py`, `arena/golden.py`, `arena/constants.py` (`RUNNER_VERSION`), the physics, nor the package version. This plan owns those, and the version bump to 0.3.0. Do not touch `arena/workshop/`, `arena/web/`, `arena/hub_fetch.py`, `arena/hub_publish.py`, `arena/events/`, `app/`.
- Training's actuator, for reference: `~/Projects/HuggingFace/microduck-challenges/.venv/lib/python3.12/site-packages/bam/` (`mjlab.py:234-293` edit_spec, `:425-496` friction budget, `:580-675` per-step; `actuator.py:251-308` control/torque; `params/xl330/m6.json`; `dynamixel/actuator.py:84-107`) and `~/Projects/HuggingFace/microduck_rl/src/mjlab_microduck/robot/microduck_constants.py:163-176` (the training cfg, its randomisation ranges).
- Today's loop: `arena/runner.py:107-113` writes `ctrl = DEFAULT_POSE + action` to position servos (`kp 0.55`, `forcerange ±0.96` — BAM's own linear approximation) and calls `mj_step` 4 times.

## Global Constraints

- **Nominal values, never randomised** — every per-env randomisation in training becomes its nominal value: voltage `7.35` V (middle of U(6.5, 8.2)), voltage-drop gain `0.1` (middle of U(0, 0.2)), voltage floor `6.0`, friction scale `1`, armature scale `1`; no encoder bias, IMU misalignment, observation noise, mass/CoM/foot-friction randomisation, pushes, or gyro/gravity observation delay.
- **Kept exactly as training does** (owner's rule, rulings of 2026-09-28): the target delay is drawn **per physics substep** uniformly in {3, 4, 5, 6} physics steps from a stream seeded per run, `numpy.random.default_rng([zlib.crc32(event_id.encode()), seed, 1])` (distinct from the perturbation stream `[crc32, seed]`); the actor's joint-velocity observation slot (`obs[20:34]`) is the joint velocity **one control step old**; `mj_forward` runs after the 4 substeps (mjlab's `sim.forward()`); current limit `1.75` A on; forcerange `±8.2·KT/R`.
- Integrator: implicitfast, `iterations 10`, `ls_iterations 20` (training's solver; measured bit-identical to Euler 100/50 with motor actuators, set explicitly anyway).
- The vendored code keeps bam's Apache-2.0 notice: a header naming the source (Rhoban/bam, rev `62bd8ce12154340be97e06f7f41a0ca8f116d967`, the files it derives from) and the license text shipped inside the package as `arena/LICENSE.bam` (copied from bam's dist-info in the challenges venv).
- No new dependency in `pyproject.toml`. The pins (`mujoco==3.10.0`, `onnxruntime==1.24.4`, `numpy==2.4.1`) do not move.
- `RUNNER_VERSION` becomes 4 **in the same commit** as the new golden numbers (`arena/golden.py` and `tests/test_evaluate.py` agree; `test_the_golden_module_agrees_with_this_files_baseline` pins that).
- Always `uv … --no-config` (the machine's uv.toml sets a mirror and exclude-newer); `uv run --no-config --extra dev pytest` for the Arena's tests. `/usr/bin/git` inside the worktree. Commit messages: one line, English, never signed (no `Co-Authored-By`, no tool attribution).

## Review Focus

- **The compiled model is shared across the runs of one evaluation** (`evaluate.py:181` compiles once) and the servo model writes `model.dof_frictionloss` / `model.dof_damping` every substep: a run must start from the same model state whatever ran before it. Pinned in Task 3 (`test_a_run_does_not_depend_on_the_run_before_it`).
- **Determinism**: the random delay must come from the seeded per-run stream, never a global RNG — same seed, same trace, in any order and any process. Pinned in Task 3 (`test_the_run_is_deterministic`, existing, plus the order test above).
- **The roller rig's four passive wheels** must stay free (no actuator, no BAM friction, keyframe qpos 0). Pinned in Task 2 (`test_passive_wheels_are_untouched`).
- **A drift between the vendored numbers and bam's** would silently re-open the gap this plan closes. Pinned in Task 5 (the parity test in microduck-challenges).
- **The Docker build runs `python -m arena.golden` on x86**: a Mac-measured baseline that x86 misses by more than 2 % breaks the Space build. Pinned in Task 4 Step 5 (an x86 measurement before the numbers are committed).

---

### Task 1: `arena/actuator.py` — the BAM servo, numpy only

**Files:**
- Create: `arena/actuator.py`, `arena/LICENSE.bam`
- Test: `tests/test_actuator.py`

**Interfaces:**
- Produces:
  - module constants `KT, R, ARMATURE, FRICTION_BASE, FRICTION_STRIBECK, LOAD_MOTOR, LOAD_EXTERNAL, LOAD_MOTOR_STRIBECK, LOAD_EXTERNAL_STRIBECK, LOAD_MOTOR_QUAD, LOAD_EXTERNAL_QUAD, DTHETA_STRIBECK, ALPHA, FRICTION_VISCOUS, ERROR_GAIN, MAX_PWM, MAX_CURRENT, KP_FW, VIN_NOMINAL=7.35, VIN_DROP_GAIN=0.1, VIN_MIN=6.0, VIN_MAX=8.2, DELAY_STEPS=(3, 6), SOLREF_FRICTION, SOLIMP_FRICTION` and `FORCE_LIMIT = VIN_MAX * KT / R`;
  - `control_torque(q_target, q, dq, vin) -> np.ndarray` (duty with the current window and PWM clamp, then torque);
  - `friction_budget(mot, ext, dq) -> np.ndarray`;
  - `class Servos: __init__(self, model, dof: np.ndarray, act_ids: np.ndarray, rng: np.random.Generator)`, `drive(self, data, target: np.ndarray) -> None` (called once per physics substep, before `mj_step`). The constructor resets `model.dof_frictionloss[dof] = 0` and `model.dof_damping[dof] = FRICTION_VISCOUS` so a run never inherits the previous run's friction.

- [ ] **Step 1: Write the failing tests**

`tests/test_actuator.py` — values computed by hand from the formulas (no bam import in this repo):

```python
import numpy as np
import pytest

from arena import actuator as A


def test_torque_is_bams_law_inside_the_limits():
    q_target, q, dq, vin = np.array([0.01]), np.array([0.0]), np.array([0.0]), 7.35
    duty = 0.01 * A.KP_FW * A.ERROR_GAIN
    expected = A.KT * vin * duty / A.R
    assert A.control_torque(q_target, q, dq, vin) == pytest.approx([expected])


def test_the_current_limit_caps_a_large_error():
    dq, vin = np.array([0.0]), 7.35
    tau = A.control_torque(np.array([1.0]), np.array([0.0]), dq, vin)
    # duty is clamped to KT*dq/vin + R*MAX_CURRENT/vin, so torque = KT*R*MAX_CURRENT/R = KT*MAX_CURRENT at dq=0
    assert tau == pytest.approx([A.KT * A.MAX_CURRENT])


def test_back_emf_brakes_a_moving_joint_with_no_error():
    dq = np.array([5.0])
    tau = A.control_torque(np.array([0.0]), np.array([0.0]), dq, 7.35)
    assert tau == pytest.approx([-A.KT**2 * 5.0 / A.R])


def test_friction_budget_at_rest_with_no_load_is_base_plus_stribeck():
    fl = A.friction_budget(np.zeros(1), np.zeros(1), np.zeros(1))
    assert fl == pytest.approx([A.FRICTION_BASE + A.FRICTION_STRIBECK])


def test_friction_budget_quadratic_term_follows_the_driving_side():
    mot, ext, dq = np.array([0.5]), np.array([0.1]), np.zeros(1)
    fl = A.friction_budget(mot, ext, dq)
    lin = abs(0.1 * A.LOAD_EXTERNAL - 0.5 * A.LOAD_MOTOR) + abs(0.1 * A.LOAD_EXTERNAL_STRIBECK - 0.5 * A.LOAD_MOTOR_STRIBECK)
    assert fl == pytest.approx([A.FRICTION_BASE + A.FRICTION_STRIBECK + lin + A.LOAD_EXTERNAL_QUAD * 0.1**2])


def test_force_limit_is_the_top_of_the_voltage_range():
    assert A.FORCE_LIMIT == pytest.approx(8.2 * A.KT / A.R)
```

Plus, for `Servos`, tests on a tiny MuJoCo model built in the test (one hinge, one motor actuator, `MjSpec` from a 10-line XML string):
- `test_delay_backfills_then_lags`: with an `rng` whose draws are known (`np.random.default_rng(0)`, record the first draws with a copy of the generator), the first substep's delayed target is the first target (backfill), and after pushing distinct targets the applied target is `targets[-1 - lag]` for the drawn lag.
- `test_lag_stays_within_three_to_six`: 1000 substeps, every lag drawn is in {3, 4, 5, 6} (expose the drawn lag for the test only through the target actually applied — compare against the ring, do not add a debug attribute).
- `test_voltage_sags_with_load_and_floors`: after a substep producing large torques, the next substep uses `max(7.35 - 0.1*sum|prev_tau|, 6.0)`.
- `test_construction_resets_the_models_friction`: set `model.dof_frictionloss[dof] = 9.9` before `Servos(...)`; after construction it is 0 and damping is `FRICTION_VISCOUS`.

- [ ] **Step 2: Run them and see them fail** — `uv run --no-config --extra dev pytest tests/test_actuator.py -q` → ImportError.

- [ ] **Step 3: Write `arena/actuator.py`**

Port it from the prototype (`research/bam_arena_prototype.py`, constants at lines 17–39 and class `Bam` at lines 98–142), with these differences: the lag is always drawn from `rng.integers(DELAY_STEPS[0], DELAY_STEPS[1] + 1)` (no fixed-lag option); the model/data/addresses are passed as `model`, `dof`, `act_ids` and `data` per call; the friction rows are matched by **DOF id** (`efc_type == mjCNSTR_FRICTION_DOF`, `efc_id` is the DOF), as the prototype does. Header:

```python
"""The BAM XL330 servo model, as training drives it, in numpy.

Derived from Rhoban/bam (better-actuator-models) at rev 62bd8ce12154340be97e06f7f41a0ca8f116d967:
bam/params/xl330/m6.json and bam/dynamixel/actuator.py (constants), bam/actuator.py (control
and torque, current window), bam/mjlab.py (per-substep order, voltage sag, command delay, the m6
friction budget written to dof_frictionloss). Copyright the bam authors, Apache License 2.0 — see
LICENSE.bam next to this file. Vendored rather than depended on: the Space image has no git and
must not install torch, and a pinned copy keeps the math at the revision training uses.

Every per-environment randomisation of training takes its nominal value here; the command delay
keeps training's distribution, drawn from a stream seeded per run so a run stays reproducible.
"""
```

Copy bam's license: `cp ~/Projects/HuggingFace/microduck-challenges/.venv/lib/python3.12/site-packages/better_actuator_models-*.dist-info/licenses/LICENSE arena/LICENSE.bam` (or wherever the dist-info keeps it — find it; if bam ships no LICENSE file in the dist-info, take it from `https://raw.githubusercontent.com/Rhoban/bam/62bd8ce12154340be97e06f7f41a0ca8f116d967/LICENSE`). Check the wheel will include it: `hatch` ships every file under `arena/` that is not gitignored.

- [ ] **Step 4: Tests pass** — `uv run --no-config --extra dev pytest tests/test_actuator.py -q`.

- [ ] **Step 5: Commit** — `arena/actuator.py arena/LICENSE.bam tests/test_actuator.py`, message e.g. `Vendor the BAM XL330 servo model as numpy`.

---

### Task 2: The course compiles with torque motors and BAM joints

**Files:**
- Modify: `arena/course.py` (`_inject_keyframe`, `compile_course`)
- Test: `tests/test_course.py`

**Interfaces:**
- Consumes: `arena.actuator` constants (`FORCE_LIMIT`, `ARMATURE`, `SOLREF_FRICTION`, `SOLIMP_FRICTION`).
- Produces: `compile_course(manifest) -> mujoco.MjModel` whose 14 actuators (by `JOINT_NAMES`) are `motor`s, gear 1, `forcerange ±FORCE_LIMIT`, not ctrl-limited; the 14 joints have `armature = ARMATURE`, `damping 0`, `frictionloss 0`, friction solref/solimp as training; `opt.integrator = implicitfast`, `iterations 10`, `ls_iterations 20`; the keyframe's `ctrl` is zeros. `build_course_xml` is unchanged (its XML still describes the position servos; the conversion happens at compile).

- [ ] **Step 1: Failing tests** in `tests/test_course.py`:
  - `test_the_fourteen_servos_are_torque_motors` — for both rigs (`sprint-2m`, `roller-sprint-2m`): each named actuator has `gaintype` fixed with gain 1 and `biastype` none (a motor), `forcerange == (-FORCE_LIMIT, FORCE_LIMIT)`, `ctrllimited == 0`.
  - `test_the_fourteen_joints_carry_bams_parameters` — armature, damping 0, frictionloss 0, `jnt_solref`… for friction: `model.dof_solref`/`dof_solimp` equal the constants.
  - `test_passive_wheels_are_untouched` — roller rig: the four `passive_*_wheel` joints keep the XML's damping 0, frictionloss 0, armature 1e-4, have no actuator, and start at qpos 0 in the keyframe.
  - `test_the_keyframe_holds_no_control` — `model.key_ctrl[stand] == 0`.
  - `test_the_solver_is_trainings` — integrator implicitfast, iterations 10, ls_iterations 20.
- [ ] **Step 2:** see them fail.
- [ ] **Step 3: Implement** — `compile_course` builds `spec = mujoco.MjSpec.from_string(xml, assets=…)` (check the 3.10.0 signature; the prototype sets `spec.assets = assets`), converts as the prototype's `compile_bam_course` (lines 57–95, without the `train_collisions` branch, which measured no effect), sets the solver on the compiled model, returns it. `_inject_keyframe` writes `ctrl` zeros (keep the docstring's explanation of qpos; replace the ctrl sentence: the servos are torque motors driven by `arena.actuator`, so the keyframe holds no command). Update the module docstring where it says the robot is the sandbox's position-servo robot.
- [ ] **Step 4:** `uv run --no-config --extra dev pytest tests/test_course.py -q` passes. (`tests/test_runner.py` and `tests/test_evaluate.py` may fail from here until Tasks 3–4: expected; do not "fix" them in this task.)
- [ ] **Step 5: Commit** — e.g. `Compile the course with torque motors and BAM joint parameters`.

---

### Task 3: The runner drives the servos per substep

**Files:**
- Modify: `arena/runner.py`
- Test: `tests/test_runner.py`

**Interfaces:**
- Consumes: `arena.actuator.Servos`, `compile_course` from Task 2.
- Produces: `run_once(manifest, policy, seed, model=None, command=None) -> RunOutcome` unchanged in signature and outcome; inside: a `Servos(model, adr.dof, act_ids, np.random.default_rng([zlib.crc32(manifest.id.encode()), seed, 1]))` per run; `_step` builds the observation with `obs[20:34]` = the joint velocity recorded **before the previous control step's substeps** (i.e. one control step old; the first step uses the reset state's velocity), runs the policy, `target = DEFAULT_POSE + action * ACTION_SCALE`, then 4× (`servos.drive(data, target)`; `mj_step`), then `mj_forward`. `_Addresses` gains `act: np.ndarray` (actuator ids by `JOINT_NAMES`).

- [ ] **Step 1: Failing tests** in `tests/test_runner.py`:
  - `test_a_run_does_not_depend_on_the_run_before_it` — with one compiled model: run seed 2, then seed 1; compare with seed 1 run on a fresh model: identical traces (`np.array_equal`).
  - `test_the_actor_sees_joint_velocity_one_step_old` — a recording fake policy (captures each obs); with the real runner, the obs at control step k has `obs[20:34]` equal to the qvel captured at step k-1 (capture qvel through a second fake that reads `data`? — simpler: run `_step` directly on a model/data twice and assert the second call's observed velocity equals `data.qvel[dof]` read just before the first call's substeps). Keep it a black-box as far as possible; the exact form is the implementer's, the property is the requirement.
  - Keep every existing test in the file; the determinism, seeds-differ, fall-beats-finish, limp-policy-falls, settle and clock tests must pass unchanged on the new physics (thresholds that depend on the old physics' numbers, if any, are updated with a comment saying they were re-measured at runner v4).
- [ ] **Step 2:** see the new ones fail.
- [ ] **Step 3: Implement** — port the prototype's `run_once`/`step` (lines 145–204) into the existing `run_once`/`_step`, keeping the existing comments that still hold (fall-before-finish, settle, command override). Update the module docstring: the loop is training's (BAM servos driven per physics substep, `mj_forward` after, actor joint velocity one control step old); it is no longer the sandbox's.
- [ ] **Step 4:** `uv run --no-config --extra dev pytest tests/test_runner.py tests/test_course.py tests/test_actuator.py -q` passes.
- [ ] **Step 5: Commit** — e.g. `Drive the robot with the BAM servos in the runner`.

---

### Task 4: Runner version 4 and the golden run re-measured

**Files:**
- Modify: `arena/constants.py` (`RUNNER_VERSION`, module docstring, comment block), `arena/golden.py` (`SCORE_S`, `COMMAND_VX`, docstring, tolerance comment), `tests/test_evaluate.py` (`GOLDEN_SCORE_S`, `GOLDEN_COMMAND_VX`, `PINNED_SCORE_S` and their comment), any other test pinning a v3 number.

- [ ] **Step 1: Measure on this Mac** — `uv run --no-config python -m arena.golden` fails (drift) and prints the new score and speed; also run `uv run --no-config python -c "from arena.evaluate import …"` for the pinned score at the event's declared 0.25 m/s the way `tests/test_evaluate.py` computes `PINNED_SCORE_S` (read that test). Expected, from the prototype: about 7.99 s at 0.55 m/s, 5/5 seeds; pinned about 18.2 s. If the walker does not finish 5/5, STOP and report — do not lower the bar.
- [ ] **Step 2: Constants** — `RUNNER_VERSION = 4` with a `4:` paragraph in the comment block: the Arena drives the robot with the BAM XL330 servo model training uses (arena/actuator.py), with nominal values and training's command delay and one-step joint-velocity lag, instead of the MJCF position servos; v3 times were made by a different actuator and are not comparable. Rewrite the module docstring's first lines: these numbers are the policy interface (joint order, default pose, obs/action sizes, rates) shared with training and the sandbox; the physics no longer matches the sandbox's position servos.
- [ ] **Step 3: Golden** — `SCORE_S`, `COMMAND_VX` = the Mac measurement; docstring gains a sentence for version 4; the tolerance comment keeps its reasoning and states the new Mac and x86 numbers (Step 5).
- [ ] **Step 4: Tests** — `GOLDEN_SCORE_S`, `GOLDEN_COMMAND_VX`, `PINNED_SCORE_S` and the comment above them (keep the history: v1, v2, v3 numbers, then v4). Run the full suite: `uv run --no-config --extra dev pytest -q` → all pass except tests unrelated to this plan that already failed on `main` (compare with `git stash`-free evidence: run the same command on `main` in the main checkout if unsure, and list them).
- [ ] **Step 5: x86 check before committing** — measure the golden run on x86 the way the Space will: either `docker build --platform linux/amd64 .` with colima (check `df -h` first; the build runs `python -m arena.golden` and must pass; delete the image after), or an HF Jobs CPU job (`cpu-basic`) running `python -m arena.golden` from this branch's wheel — ask the owner before spending credits. Record the x86 number; if it differs from the Mac's by more than 2 %, STOP and report (the tolerance must not be widened silently).
- [ ] **Step 6: Commit** — constants, golden and tests together, e.g. `Runner version 4: the golden run re-measured on the BAM servos`.

---

### Task 5: Parity with bam, from the challenges repo

**Files (in `~/Projects/HuggingFace/microduck-challenges`, branch `main`):**
- Create: `tests/test_arena_actuator_parity.py`

This repo is the only environment with `arena`, `bam` and torch together. It needs the new Arena code: until Task 6 publishes the 0.3.0 wheel, run it against the worktree with `uv run --no-config --frozen --group workshop --with-editable ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/arena-bam pytest tests/test_arena_actuator_parity.py` (check `--with-editable` overrides the locked wheel; if not, `uv pip install --no-config -e <worktree>` into `.venv` for the run and re-sync with `uv sync --no-config --frozen --group workshop` afterwards).

- [ ] **Step 1: The test** (port `research/parity.py`):
  - every constant of `arena.actuator` equals bam's (`bam.model.load_model(motor_name="xl330", model="m6")` parameters, `XL330Actuator` error gain/max pwm/max current, `bam.mjlab` solref/solimp for friction, kp_fw 200);
  - `friction_budget` equals `BamActuator._compute_friction_budget` (instantiate with `BamActuator.__new__` and set `_bam_model`) on 20 000 random (mot, ext, dq) — max abs diff < 1e-9;
  - `control_torque` equals `bam.actuator`'s `compute_control` + `compute_torque` on 2 000 random samples — max abs diff < 1e-9;
  - the nominal values sit inside training's ranges from `mjlab_microduck.robot.microduck_constants` (vin range, vin drop gain range, delay range) and `VIN_NOMINAL`/`VIN_DROP_GAIN` are their midpoints; `DELAY_STEPS` equals training's delay bounds.
- [ ] **Step 2:** it passes against the worktree. If a constant differs, the vendored number is wrong: fix it in the Arena worktree (Task 1's file, with a test), not in this test.
- [ ] **Step 3: Commit** in microduck-challenges (do not push), e.g. `Pin the Arena's vendored BAM servo to bam's own numbers`.

---

### Task 6: Version 0.3.0, the wheel, the challenges lock

**Files:** `pyproject.toml` (version), `uv.lock` (re-lock) in the Arena worktree; in microduck-challenges: `pyproject.toml` (the wheel URL's file name), `uv.lock`.

- [ ] **Step 1:** Arena `version = "0.3.0"`; `uv lock --no-config`; full suite passes; commit (`Version 0.3.0: runner v4 on BAM servos`).
- [ ] **Step 2: Build the wheel** exactly as `.github/workflows/release.yml` does (`cd app && npm ci && npm run build`, `uv run --no-config --no-project python scripts/bundle_frontend.py`, `uv build --no-config --wheel -o /private/tmp/arena-wheel`) and run the workflow's inspection (site present, no LFS pointers, and `arena/LICENSE.bam` present).
- [ ] **Step 3: Upload — ask the owner first** (it replaces what the challenges repo installs): `uvx --no-config --from 'huggingface_hub[cli]' hf upload pollen-robotics/microduck-arena-wheels /private/tmp/arena-wheel/microduck_arena-0.3.0-py3-none-any.whl microduck_arena-0.3.0-py3-none-any.whl` (the 0.2.0 file stays).
- [ ] **Step 4: Challenges** — change the `microduck-arena` source URL's file name to `0.3.0`, `export HF_TOKEN=…`, `uv lock --no-config`, `uv sync --no-config --frozen --group workshop`, run the full suite plus the parity test against the installed wheel (no `--with-editable` now); commit (`Install the Arena 0.3.0 wheel (runner v4, BAM servos)`). Do not push.

---

### Task 7: Re-score the published references on runner v4

**Files:** none (a report).

- [ ] **Step 1:** In the challenges venv (0.3.0 installed), download and score the three public references: `hf download pollen-robotics/microduck-<id>-reference policy.onnx --local-dir /private/tmp/ref-<id>` and `uv run --no-config --frozen --group workshop arena score --event <id> /private/tmp/ref-<id>/policy.onnx` for `sprint-2m`, `hill-climb-1m5`, `roller-sprint-2m`. Also the Arena's own reference walker on `sprint-2m`.
- [ ] **Step 2:** Report the table (v3 → v4): expected from the prototype — golden 11.79 → ~8.0 s, sprint ref 3.77 → ~7.7 s (it yaws right and meets the wall: a training fix follows in another plan), hill 6.02 → ~7.3 s, roller 3.20 → ~3.1 s. A reference that no longer finishes 5/5 is reported, not fixed here.

---

## After this plan (the owner's)

- Merge `arena-bam` into `main` (the plan-4 branch merges separately; conflicts expected only in `pyproject.toml`/`uv.lock` — re-lock after the second merge).
- Push `main` (deploys the Space; its Docker build re-measures the golden run on x86), tag `v0.3.0` → the release workflow attaches the same wheel, `arena recover` (or `ARENA_RECOVER=1` at boot) re-races the Hub entries on runner v4.
- Training follow-up (separate plan): sprint and hill hold their heading (the references yaw right by ~25° in 6 s, which the lane's walls punish now that the Arena reproduces training's physics).
