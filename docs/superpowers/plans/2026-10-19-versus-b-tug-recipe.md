# Versus B: the Tug of War Recipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a `tug_of_war` challenge that trains against the Arena's own bench, HF Jobs trainings judged on the Arena until a checkpoint clears the gates, and that checkpoint exported for the owner to publish under Nico-robot after the release.

**Architecture:** the sprint's recipe on the Arena's collision set; `SceneCfg.spec_fn` swaps mjlab's floor for the tug course and adds the Arena's string tendon and winch motor; a command term drives the winch each step from a per-episode profile around the bench's. Arena numbers are copied into `env.py` (the job cannot import it) and pinned by parity tests against `compile_tug(load_event("tug-of-war"), 1)`. Trainings are measured loops: each checkpoint exported and rated by the Arena on the Mac (indicative), bouts via `run_bout`.

**Tech Stack:** Python 3.12, mjlab 1.3.0 (mujoco 3.10, mujoco_warp 3.8.1), mjlab_microduck (microduck_rl `challenge-recipe-publishing` @ 8d0dbc9), rsl_rl PPO, HF Jobs (l4x1), the Arena from the `versus` worktree (editable), pytest.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md` §3. **Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md` (Plan A's names are the physics matched here).

**Decisions** (each: what, then why):
1. `scene.terrain = None`, `spec_fn = tug_scene`: no mjlab terrain has a pit; without terrain every env origin is 0, so each world holds the course at the Arena's coordinates.
2. Course body named `terrain`, geoms named as the Arena's: mjlab's foot contact sensor matches body `terrain`; parity matches geoms by name.
3. Site `robot/string_end` added on `robot/trunk_base` by `tug_scene`: the robot cfg stays `MICRODUCK_STANDUP_ROBOT_CFG` untouched.
4. Winch = the Arena's tendon `string` + motor `winch`, ctrl written by a `WinchCommand` term: MuJoCo applies the force as in the Arena; a command term holds per-env state, resamples at reset, takes a curriculum, updates before the next physics.
5. Arena numbers copied into `env.py`, pinned by parity tests: the job's plain `uv sync` has no Arena.
6. Twist fixed `(-0.30, -0.30)`, no standing envs; head/body keep the sprint's tiny ranges around 0: the actor reads the event's `[command]`.
7. Standup robot, implicitfast, 10/20, 0.005 s × 4, `nconmax = 200`: the Arena's collision set (a dragged duck touches with its body) and solver; nconmax is a buffer.
8. Base = the sprint's recipe: the shortest way to a duck that steps backwards.
9. The pit (`root_height_below_minimum(-PIT_DROP_M)`) and a fall (`ArenaFall`: projected gravity z above `FALL_GRAVITY_Z` for `round(FALL_HOLD_S / 0.02)` straight control steps, the Arena's rule) end the episode, an `out` penalty of −50: a fall loses (owner, 2026-10-20), so the Arena ends a bench run and loses a bout at the first of them.
10. `hold` pays the pull only while upright (gravity z ≤ `fall_gravity_z`) and not terminated: a duck earns by pulling on its feet; lying down ends the episode (D9).
11. Episode 30.5 s = settle + bench time: the policy lives the whole ramp.
12. Profiles: ramp ×0.5–3, jerk amplitude 0–2×, frequencies ×0.7–1.3, uniform phases, top widened to 1.25× `top_n` by curriculum: contains the bench's nominal and pulls harder, so the policy learns to lose late.
13. Critic adds `winch_pull`, `pit_margin`; actor stays 61-D: privileged, blind.
14. Bouts judged by `tug_of_war/check.py` over `arena.tug.run_bout`: no CLI plays a bout; users need it too (like Got a Talent's `check.py`).

## Global Constraints

The contract's Global constraints apply. On top of them:

- **Worktree** `/Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war` (`<wt>`, ALWAYS written in full in commands), branch `tug-of-war` from challenges `main` (6ff4070). Each Bash call is `cd <wt> && <command>`; no globs or shell variables in git/uv commands.
- **uv in `<wt>`:** after Task 1's sync, always `uv run --no-config --no-sync …`: a sync swaps the editable versus Arena for the locked 0.5.0 wheel (restore: Task 1 step 4). Never `uv lock` (Plan D relocks); if `uv.lock` changes, `/usr/bin/git -C <wt> checkout -- uv.lock`.
- **Tests:** `cd <wt> && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests`, foreground, `timeout: 600000`.
- **`env.py`, `rewards.py`, `tasks.py` never import `arena`**; only tests and `check.py` do.
- **HF Jobs** without asking under `--namespace Nico-robot` (owner's grant), on l4x1 as every training so far (owner, 2026-10-20), ≤ 3 in flight, always `--detach`; no background shell; wait with the Monitor tool, never a bare `sleep`. Checkpoint repos stay private. Nothing pushed; `publish` only with `--dry-run`.
- **Commit before every training**, message = the hypothesis. Once a candidate's training commit exists, never rebase or squash `tug-of-war` (its Reproduce names it).
- **A `[bench]`/`[command]` retune** in one sitting (contract § Plan B): the toml in the arena `versus` worktree (its two Python suite calls green, committed there), `env.py`'s constants, both repos' parity tests green; tell the controller (C and D read the toml).
- **`arena score` on a tug** prints Plan A's format (contract): five `seed n: <status> <force> N[ at <t> s]` lines, then `rating: X.XX N · replay from seed n`. The ledger takes the number after `rating: `. It needs Plan A's Task 5 committed in the versus worktree.
- **Mac numbers are indicative**, never compared with the Space.
- **Stop rule:** a gate failing on 3 trainings in a row: report to the owner (ledger rows, curves, what was tried, next proposal) and wait.
- **Ledger** `<wt>/logs/tug_of_war/ledger.md` (git-ignored): baselines, stand-ins, per training: run, commit, job id, repo, hypothesis, G1, rating per checkpoint, G3 summary, verdict.

## Review Focus

1. **The winch pulls elsewhere than the Arena's** (gear sign, site frame, drum height): `test_the_winch_pulls_like_the_arenas` (Task 2).
2. **The pull runs on another clock or channel** (during the settle, a step late, a servo's ctrl): `test_the_winch_pulls_its_profile_on_the_arenas_clock` (Task 3), `test_the_env_pulls_on_time` (Task 5).
3. **The course differs or mjlab's floor survives**: `test_the_course_compiles_like_the_arenas` (Task 2).
4. **The HF job crashes at import** on `arena` (killing every challenge's registration): `test_the_training_never_imports_the_arena` (Task 2).
5. **Actor or start drift** (critic terms in the actor, standing envs, template yaw ±π): `test_the_actor_reads_the_events_command`, `test_the_start_is_the_arenas` (Task 4), 61 numbers on the real env (Task 5).
6. **A fall that training forgives** (an instantaneous tilt check, another threshold or hold, no penalty): the Arena ends the bench at a fall, so training must too. `test_a_fall_is_the_arenas_rule`, `test_the_pit_and_a_fall_end_an_episode_early` (Task 4).

---

### Task 1: The worktree on the versus Arena, the ledger

**Files:** none tracked; `<wt>`, `<wt>/.venv`, `<wt>/logs/tug_of_war/ledger.md`.

**Interfaces:** Consumes Plan A's physics commit on arena `versus` (A's Task 3 names it); the steps that run `arena score` on a tug (Task 5 step 5, Tasks 10–12) wait for A's Task 5 commit, which the editable install picks up as soon as it lands. Produces a venv whose `arena` is the versus worktree.

- [ ] **Step 1:** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus log --oneline -8` shows A's Task 3 commit, and that worktree has `arena/tug.py` and `arena/events/tug-of-war.toml`. Otherwise stop: B waits for A.
- [ ] **Step 2:** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges worktree add .claude/worktrees/tug-of-war -b tug-of-war main`
- [ ] **Step 3:** `cd <wt> && uv sync --no-config --frozen --group workshop` exits 0; `/usr/bin/git -C <wt> status --short` is empty.
- [ ] **Step 4:** `cd <wt> && uv pip install --no-config --python .venv/bin/python --no-deps -e /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`
- [ ] **Step 5:** `cd <wt> && uv run --no-config --no-sync python -c "import arena, arena.tug, arena.course; print(arena.__file__, arena.course.compile_tug, arena.tug.run_bout)"` prints a path inside `.claude/worktrees/versus/arena/`.
- [ ] **Step 6:** Run the suite: every test passes (count into the ledger). A failure is a Plan A regression on an existing event: report it, do not fix it here.
- [ ] **Step 7:** Write the ledger's header (date, `<wt>` HEAD, the versus commit, the toml's bench numbers) and table header.

### Task 2: The course, string and winch in the training scene

**Files:** Create `src/microduck_challenges/tug_of_war/__init__.py` (empty), `tug_of_war/env.py` (physics part), `tests/test_tug_of_war.py`.

**Interfaces:** Consumes Plan A's `arena.course` tug names and `arena.tug.PIT_DROP_M`. Produces in `env.py`:

```python
# Copied from the Arena (the HF job cannot import it); tests/test_tug_of_war.py pins each one.
LENGTH_M, WIDTH_M, WALL_HEIGHT_M = 4.0, 0.8, 0.15          # arena/events/tug-of-war.toml
PIT_M, PIT_DEPTH_M, STRING_M = 0.30, 0.30, 1.00
COMMAND_VX = -0.30
TIME_LIMIT_S, SETTLE_S = 30.0, 0.5
JOINT_PERTURBATION_RAD, YAW_PERTURBATION_DEG = 0.01, 2.0
FALL_GRAVITY_Z, FALL_HOLD_S = -0.5, 0.3                    # [termination]: a fall loses
BENCH_RAMP_N_PER_S, BENCH_TOP_N, BENCH_JERK_N, BENCH_JERK_HZ = 0.25, 7.0, 0.4, (0.7, 1.9)
SPAWN_HEIGHT_M, WALL_THICKNESS_M, PLATFORM_OVERRUN_M = 0.12, 0.05, 20.0   # arena/course.py
STRING_OFFSET = (0.026, 0.0145, 0.0324215)                 # string_offset("legs")
PIT_DROP_M = 0.05                                          # arena/tug.py
STRING_SITE, STRING, WINCH_SITE, WINCH = "string_end", "string", "winch_drum", "winch"

def course_boxes() -> list[tuple[str, tuple, tuple]]    # pit_boxes(course) + tug_walls(course), same order
def west_start() -> tuple[float, float]                 # trunk (x, y) of tug_layout(course, 1)[0]
def winch_position() -> tuple[float, float, float]
def tug_scene(spec: mujoco.MjSpec) -> None              # SceneCfg.spec_fn
```

`tug_scene` adds: body `terrain` with `course_boxes()`; site `robot/string_end` on `robot/trunk_base` at `STRING_OFFSET`; site `winch_drum` on the world; the unlimited spatial tendon `string` over them; the motor `winch` on it. The scene keyframe `init_state` needs one ctrl per actuator (append `0.0` for the winch). Contact, tendon and actuator fields are whatever parity demands (the Arena's course geoms inherit its MJCF defaults).

- [ ] **Step 1: Write the failing tests:**

```python
"""The Tug of War trains in the Arena's tug: the same course, string, winch, pull, start and command."""
import subprocess, sys
from types import SimpleNamespace
import mujoco, numpy as np, pytest, torch
from mjlab.scene import Scene, SceneCfg
from mjlab_microduck.robot.microduck_constants import MICRODUCK_STANDUP_ROBOT_CFG

import microduck_challenges  # noqa: F401
from arena import course as arena_course, tug as arena_tug
from arena.constants import DEFAULT_POSE, JOINT_NAMES
from arena.manifest import load_event
from microduck_challenges.tug_of_war import env as tug

EVENT = load_event("tug-of-war")
CONTACT = ("geom_type", "geom_size", "geom_contype", "geom_conaffinity", "geom_condim", "geom_priority",
           "geom_friction", "geom_solref", "geom_solimp", "geom_solmix", "geom_margin", "geom_gap")
TENDON = ("tendon_limited", "tendon_stiffness", "tendon_damping", "tendon_frictionloss", "tendon_armature")
ACTUATOR = ("actuator_trntype", "actuator_dyntype", "actuator_gaintype", "actuator_biastype", "actuator_gear",
            "actuator_gainprm", "actuator_biasprm", "actuator_ctrllimited", "actuator_ctrlrange",
            "actuator_forcelimited", "actuator_forcerange")


@pytest.fixture(scope="module")
def arena_model():
    return arena_course.compile_tug(EVENT, 1)


@pytest.fixture(scope="module")
def training_model():
    scene = SceneCfg(num_envs=1, entities={"robot": MICRODUCK_STANDUP_ROBOT_CFG}, spec_fn=tug.tug_scene)
    return Scene(scene, device="cpu").compile()


def test_the_training_never_imports_the_arena():
    """HF Jobs install the default groups only: no Arena there. The package's __init__ imports every tasks.py."""
    code = "import sys; sys.modules['arena'] = None; import microduck_challenges.tug_of_war.env"
    subprocess.run([sys.executable, "-c", code], check=True)


def test_the_constants_are_the_arenas():
    c, b, s = EVENT.course, EVENT.bench, EVENT.start
    assert (tug.LENGTH_M, tug.WIDTH_M, tug.WALL_HEIGHT_M, tug.PIT_M, tug.PIT_DEPTH_M, tug.STRING_M) == (
        c.length_m, c.width_m, c.wall_height_m, c.pit_m, c.pit_depth_m, c.string_m)
    assert (tug.BENCH_RAMP_N_PER_S, tug.BENCH_TOP_N, tug.BENCH_JERK_N, tug.BENCH_JERK_HZ) == (
        b.ramp_n_per_s, b.top_n, b.jerk_n, b.jerk_hz)
    assert tuple(EVENT.command) == (tug.COMMAND_VX,) + (0.0,) * 12
    assert (tug.TIME_LIMIT_S, tug.SETTLE_S, tug.JOINT_PERTURBATION_RAD, tug.YAW_PERTURBATION_DEG) == (
        EVENT.time_limit_s, s.settle_s, s.joint_rad, s.yaw_deg)
    assert (tug.FALL_GRAVITY_Z, tug.FALL_HOLD_S) == (EVENT.termination.fall_gravity_z, EVENT.termination.fall_hold_s)
    assert tug.STRING_OFFSET == pytest.approx(arena_course.string_offset("legs"), abs=1e-12)
    assert (tug.SPAWN_HEIGHT_M, tug.WALL_THICKNESS_M, tug.PLATFORM_OVERRUN_M, tug.PIT_DROP_M) == (
        arena_course.SPAWN_HEIGHT_M, arena_course.WALL_THICKNESS_M, arena_course.PLATFORM_OVERRUN_M, arena_tug.PIT_DROP_M)
    assert (tug.STRING_SITE, tug.STRING, tug.WINCH_SITE, tug.WINCH) == (
        arena_course.STRING_SITE, arena_course.STRING, arena_course.WINCH_SITE, arena_course.WINCH)


def _static_colliders(model):
    return {model.geom(g).name for g in range(model.ngeom)
            if model.body_weldid[model.geom_bodyid[g]] == 0 and (model.geom_contype[g] or model.geom_conaffinity[g])}


def test_the_course_compiles_like_the_arenas(arena_model, training_model):
    names = {n for n, _, _ in tug.course_boxes()}
    assert _static_colliders(training_model) == names == _static_colliders(arena_model)  # no floor plane left
    datas = [mujoco.MjData(m) for m in (arena_model, training_model)]
    for m, d in zip((arena_model, training_model), datas):
        mujoco.mj_forward(m, d)
    for name in names:
        a, t = arena_model.geom(name).id, training_model.geom(name).id
        np.testing.assert_allclose(datas[1].geom_xpos[t], datas[0].geom_xpos[a], atol=1e-12, err_msg=name)
        for field in CONTACT:
            np.testing.assert_allclose(getattr(training_model, field)[t], getattr(arena_model, field)[a], err_msg=f"{name} {field}")


def test_the_string_and_winch_are_built_like_the_arenas(arena_model, training_model):
    for fields, kind, name in ((TENDON, "tendon", tug.STRING), (ACTUATOR, "actuator", tug.WINCH)):
        a, t = getattr(arena_model, kind)(name).id, getattr(training_model, kind)(name).id
        for field in fields:
            np.testing.assert_allclose(getattr(training_model, field)[t], getattr(arena_model, field)[a], err_msg=field)


def _pull(model, prefix, yaw_deg, pitch_deg, ctrl):
    """String end, drum, string length, and the winch's force on the trunk's free joint at the bench's start."""
    data = mujoco.MjData(model)
    trunk = model.body(prefix + "trunk_base").id
    free, dof = model.jnt_qposadr[model.body_jntadr[trunk]], model.jnt_dofadr[model.body_jntadr[trunk]]
    quat = np.zeros(4)
    mujoco.mju_euler2Quat(quat, np.radians([0.0, pitch_deg, yaw_deg]), "xyz")
    west = arena_course.tug_layout(EVENT.course, 1)[0]
    data.qpos[free:free + 7] = [west.x, west.y, arena_course.SPAWN_HEIGHT_M, *quat]
    for joint, angle in zip(JOINT_NAMES, DEFAULT_POSE):
        data.qpos[model.joint(prefix + joint).qposadr[0]] = angle
    winch, forces = model.actuator(tug.WINCH).id, []
    for value in (0.0, ctrl):
        data.ctrl[winch] = value
        mujoco.mj_forward(model, data)
        forces.append(data.qfrc_actuator[dof:dof + 6].copy())
    return (data.site(prefix + tug.STRING_SITE).xpos.copy(), data.site(tug.WINCH_SITE).xpos.copy(),
            data.ten_length[model.tendon(tug.STRING).id], forces[1] - forces[0])


@pytest.mark.parametrize("yaw_deg, pitch_deg", [(0.0, 0.0), (12.0, -25.0)])
def test_the_winch_pulls_like_the_arenas(arena_model, training_model, yaw_deg, pitch_deg):
    theirs = _pull(arena_model, "", yaw_deg, pitch_deg, 3.0)
    ours = _pull(training_model, "robot/", yaw_deg, pitch_deg, 3.0)
    for t, a in zip(ours, theirs):
        np.testing.assert_allclose(t, a, atol=1e-9)
    force = ours[3][:3]
    assert np.linalg.norm(force) == pytest.approx(3.0, rel=1e-6) and force[0] > 0  # 3 N, towards the drum
```

- [ ] **Step 2:** Run the file: it fails on importing `microduck_challenges.tug_of_war`.
- [ ] **Step 3:** Implement `__init__.py` and the physics part of `env.py`, mirroring the versus worktree's `arena/course.py` arithmetic (standard library, `math`, `mujoco` only).
- [ ] **Step 4:** Run the file: all pass. A differing field is set explicitly in `tug_scene` to the Arena's value; tolerances never loosened.
- [ ] **Step 5:** `/usr/bin/git -C <wt> add src/microduck_challenges/tug_of_war tests/test_tug_of_war.py` and commit: "The Tug of War's training scene is the Arena's tug: lane, pit, string to the neck and winch, pinned by tests"

### Task 3: The winch pulls the bench's profiles, on the Arena's clock

**Files:** Modify `tug_of_war/env.py`, `tests/test_tug_of_war.py`.

**Interfaces:** Consumes `arena.tug.bench_profile` (`{"ramp_n_per_s", "top_n", "jerks": [[amp_n, hz, phase_rad], …]}`), `arena.tug.bench_force`. Produces:

```python
def bench_force(profile: torch.Tensor, t: torch.Tensor) -> torch.Tensor
#   profile (n, 2 + 3k): ramp, top, then (amp, hz, phase) per jerk; t (n,): seconds since the settle ended
#   min(top, max(0, ramp·t + Σ amp·sin(2π·hz·t + phase))), arena.tug.bench_force's clamp; 0 where t < 0

@dataclass(kw_only=True)
class WinchCommandCfg(CommandTermCfg):
    resampling_time_range: tuple[float, float] = (1e9, 1e9)   # one profile per episode, drawn at reset
    ramp_n_per_s: tuple[float, float] = (0.5 * BENCH_RAMP_N_PER_S, 3.0 * BENCH_RAMP_N_PER_S)
    top_n: tuple[float, float] = (0.5, 2.0)                    # widened by the winch_top curriculum
    jerk_n: tuple[float, float] = (0.0, 2.0 * BENCH_JERK_N)
    jerk_hz: tuple[float, ...] = BENCH_JERK_HZ
    hz_scale: tuple[float, float] = (0.7, 1.3)
    settle_s: float = SETTLE_S

class WinchCommand(CommandTerm):
    profile: torch.Tensor   # (num_envs, 2 + 3·len(jerk_hz)); phases U(0, 2π)
    command: torch.Tensor   # (num_envs, 1): the pull now / BENCH_TOP_N
    # _update_command: ctrl[:, winch] = bench_force(profile, episode_length_buf · step_dt − settle_s)

def winch_top_curriculum(env, env_ids, top_stages: list[dict]) -> dict   # the last stage with step ≤ common_step_counter
```

- [ ] **Step 1: Write the failing tests** (append):

```python
@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_the_pull_is_the_benchs(seed):
    profile = arena_tug.bench_profile(EVENT.bench, EVENT.id, seed)
    row = [profile["ramp_n_per_s"], profile["top_n"], *[v for jerk in profile["jerks"] for v in jerk]]
    t = torch.linspace(0.0, EVENT.time_limit_s, 1501, dtype=torch.float64)
    ours = tug.bench_force(torch.tensor([row] * len(t), dtype=torch.float64), t)
    assert ours.tolist() == pytest.approx([arena_tug.bench_force(profile, s) for s in t.tolist()], abs=1e-9)
    settle = torch.tensor([-tug.SETTLE_S, -0.02], dtype=torch.float64)
    assert tug.bench_force(torch.tensor([row] * 2, dtype=torch.float64), settle).tolist() == [0.0, 0.0]


def test_training_pulls_around_the_bench():
    cfg = tug.WinchCommandCfg()
    assert cfg.ramp_n_per_s[0] <= tug.BENCH_RAMP_N_PER_S <= cfg.ramp_n_per_s[1]
    assert cfg.jerk_n[0] <= tug.BENCH_JERK_N <= cfg.jerk_n[1]
    assert cfg.hz_scale[0] <= 1.0 <= cfg.hz_scale[1] and cfg.jerk_hz == tug.BENCH_JERK_HZ


def test_the_winch_pulls_its_profile_on_the_arenas_clock(training_model):
    n = 64
    ctrl = torch.zeros(n, training_model.nu, dtype=torch.float64)
    env = SimpleNamespace(num_envs=n, device="cpu", step_dt=0.02, episode_length_buf=torch.zeros(n, dtype=torch.long),
                          sim=SimpleNamespace(mj_model=training_model, data=SimpleNamespace(ctrl=ctrl)))
    term = tug.WinchCommandCfg().build(env)
    term.reset(torch.arange(n))
    p = term.profile
    assert ((p[:, 0] >= 0.125) & (p[:, 0] <= 0.75) & (p[:, 1] >= 0.5) & (p[:, 1] <= 2.0)).all()
    winch = training_model.actuator(tug.WINCH).id
    for k in (0, 24, 25, 26, 500, 1524):
        env.episode_length_buf[:] = k
        term.compute(0.02)
        expected = tug.bench_force(p, torch.full((n,), k * 0.02 - tug.SETTLE_S, dtype=p.dtype))
        assert torch.allclose(ctrl[:, winch], expected.to(ctrl.dtype))
        assert torch.allclose(term.command[:, 0], (expected / tug.BENCH_TOP_N).to(term.command.dtype))
    assert not ctrl[:, [i for i in range(training_model.nu) if i != winch]].any()  # servos untouched
```

- [ ] **Step 2:** Run the file: the new tests fail on the missing `bench_force`.
- [ ] **Step 3:** Implement them (`WinchCommand` resolves the winch's actuator id once from `env.sim.mj_model`; `winch_top_curriculum` follows `microduck_mdp.reward_weight`'s stage pattern).
- [ ] **Step 4:** File, then suite: all pass.
- [ ] **Step 5:** Commit: "The Tug of War's winch pulls a profile drawn around the bench's each episode, on the Arena's clock"

### Task 4: The recipe: command, start, rewards, pit, critic, knobs

**Files:** Create `tug_of_war/challenge.toml`, `tug_of_war/tasks.py` (the sprint's verbatim), `tug_of_war/rewards.py`. Modify `tug_of_war/env.py` (`make_env_cfg`, `heading_error`, `RL_CFG`), `src/microduck_challenges/__init__.py`, `tests/test_challenges.py` (row), `tests/test_tug_of_war.py`.

**Interfaces:** Produces task `Mjlab-TugOfWar-MicroDuck`, `RL_CFG.experiment_name == "tug_of_war"`, and `rewards.py`:

```python
def pit_margin(env, offset: tuple, pit_edge_x: float) -> torch.Tensor   # (n, 1): pit_edge_x − x of the string end, m
def pit_margin_reward(env, offset: tuple, pit_edge_x: float, scale: float) -> torch.Tensor  # (n,): tanh(max(margin, 0) / scale)
def hold(env, fall_gravity_z: float) -> torch.Tensor   # (n,): the winch command while upright and not terminated

class ArenaFall(ManagerTermBase):   # a termination term: mjlab builds it with (cfg, env) and resets it per env
    def __call__(self, env, fall_gravity_z: float, hold_steps: int) -> torch.Tensor
    #   (n,) bool: projected_gravity_b z above fall_gravity_z for hold_steps straight control steps,
    #   the Arena's fall rule (arena.stage.fell_at, runner.run_once); reset(env_ids) clears the count
```

The string end is `root_link_pos_w + quat_apply(root_link_quat_w, offset)`, as `arena.tug.string_ends` reads a trace.

`challenge.toml`: a header comment (two ducks neck to neck over a pit, pulling by walking backwards; a duck that drops into the pit or falls over loses; rated on the bench in newtons, mean of five seeds; every entry plays the weekly cup); `event = "tug-of-war"`, `task = "Mjlab-TugOfWar-MicroDuck"`, `kind = "perpetual"`; `[command] twist = "[vx: the Arena sends -0.30 m/s, walk backwards; unused; unused]"`; `[recipe]` 4096 / 3000 / 1; knobs:

| Knob | Label | Value | Range | Sets |
|---|---|---|---|---|
| `pull_reward` | Hold the pull | 2.0 | 0.5–5.0 | `hold` |
| `back_reward` | Walk backwards | 1.0 | 0.0–4.0 | `track_linear_velocity` |
| `upright_reward` | Stay upright | 1.0 | 0.0–4.0 | `upright` |

`make_env_cfg(play=False)` = the sprint's, changed as follows (D = decision; each change commented with its why):

| Area | Change |
|---|---|
| Scene, sim | D1–D3, D7, D11; sensors `feet_ground_contact`, `self_collision` only (no `foot_height_scan`) |
| Commands | D6; `winch = WinchCommandCfg()` |
| Rewards | `hold` (knob, D10); `pit_margin_reward` 1.0, scale 0.35, edge `-PIT_M / 2`; `track_linear_velocity` (knob), std √0.1; `upright` (knob), std 0.5 (leaning back is how a duck holds); `out` = `mdp.is_terminated` −50 (the pit or a fall); `air_time` 1.0; the sprint's others; drop `foot_clearance`, `foot_swing_height`, `soft_landing` |
| Terminations | exactly `time_out`, `nan_state`, `in_pit`, `fell` = `ArenaFall` with `fall_gravity_z = FALL_GRAVITY_Z`, `hold_steps = round(FALL_HOLD_S / 0.02)` (D9; it replaces the sprint's instantaneous `fell_over`) |
| Events | the sprint's DR; `reset_base` x, y = `west_start()` ± 0.02, z (0.12, 0.13), yaw ±5°; `reset_robot_joints` ±0.01 |
| Observations | D13; critic keeps `base_lin_vel`, `heading_error`, drops `foot_height` |
| Curricula | the sprint's minus `standing_envs`; `winch_top` at iterations 0/500/1000/1500: top (0.5, 2), (0.5, 4), (0.5, 6), (0.5, 1.25·BENCH_TOP_N) |

- [ ] **Step 1: Write the failing tests.** `test_challenges.py` row: `"tug_of_war": {"pull_reward": ("hold", 3.1), "back_reward": ("track_linear_velocity", 2.3), "upright_reward": ("upright", 1.7)}`. Append to `test_tug_of_war.py`:

```python
from mjlab_microduck import challenge as ch
from microduck_challenges.tug_of_war import rewards


@pytest.fixture(scope="module")
def cfg():
    return tug.make_env_cfg()


def test_the_scene_and_solver_are_the_tugs(cfg, arena_model):
    assert cfg.scene.terrain is None and cfg.scene.spec_fn is tug.tug_scene
    assert cfg.scene.entities["robot"] is MICRODUCK_STANDUP_ROBOT_CFG  # collisions pinned by test_got_a_talent
    assert (cfg.sim.mujoco.iterations, cfg.sim.mujoco.ls_iterations) == (arena_model.opt.iterations, arena_model.opt.ls_iterations)
    assert cfg.sim.mujoco.timestep == pytest.approx(arena_model.opt.timestep) and cfg.decimation == 4
    assert cfg.sim.mujoco.integrator == "implicitfast" and arena_model.opt.integrator == mujoco.mjtIntegrator.mjINT_IMPLICITFAST


def test_the_actor_reads_the_events_command(cfg):
    ranges = cfg.commands["twist"].ranges
    assert ranges.lin_vel_x == (EVENT.command[0],) * 2 and ranges.lin_vel_y == (0.0, 0.0) and ranges.ang_vel_z == (0.0, 0.0)
    assert cfg.commands["twist"].rel_standing_envs == 0.0 and "standing_envs" not in cfg.curriculum
    for name in ("head_pose", "body_pose"):
        assert all(lo <= 0.0 <= hi for lo, hi in cfg.commands[name].ranges)  # the Arena sends zeros
    actor, critic = cfg.observations["actor"].terms, cfg.observations["critic"].terms
    assert list(actor)[-3:] == ["command", "head_command", "body_command"]
    privileged = {"winch_pull", "pit_margin", "heading_error"}
    assert privileged <= set(critic) and not privileged & set(actor)


def test_the_start_is_the_arenas(cfg):
    pose, west = cfg.events["reset_base"].params["pose_range"], arena_course.tug_layout(EVENT.course, 1)[0]
    assert sum(pose["x"]) / 2 == pytest.approx(west.x) and sum(pose["y"]) / 2 == pytest.approx(west.y)
    assert pose["z"][0] <= arena_course.SPAWN_HEIGHT_M <= pose["z"][1]
    yaw = np.radians(EVENT.start.yaw_deg)
    assert pose["yaw"][0] <= -yaw and yaw <= pose["yaw"][1] <= 0.1  # not the template's ±π
    joints = cfg.events["reset_robot_joints"].params["position_range"]
    assert joints[0] <= -EVENT.start.joint_rad and EVENT.start.joint_rad <= joints[1]
    assert cfg.episode_length_s == pytest.approx(EVENT.start.settle_s + EVENT.time_limit_s)


def test_the_curriculum_pulls_past_the_benchs_top(cfg):
    last = cfg.curriculum["winch_top"].params["top_stages"][-1]["top_n"]
    assert last[0] < tug.BENCH_TOP_N < last[1]


def test_the_pit_and_a_fall_end_an_episode_early(cfg):
    assert set(cfg.terminations) == {"time_out", "nan_state", "in_pit", "fell"}
    assert cfg.terminations["in_pit"].params["minimum_height"] == -arena_tug.PIT_DROP_M
    assert cfg.terminations["fell"].func is rewards.ArenaFall
    assert cfg.terminations["fell"].params == {"fall_gravity_z": EVENT.termination.fall_gravity_z,
                                               "hold_steps": round(EVENT.termination.fall_hold_s / 0.02)}
    assert cfg.rewards["out"].weight == -50.0


def test_a_fall_is_the_arenas_rule(cfg):
    """Gravity z above fall_gravity_z for the hold's straight control steps, as arena.stage.fell_at counts it."""
    params = cfg.terminations["fell"].params
    gravity = torch.tensor([[0.0, 0.0, -1.0], [0.0, -1.0, 0.0]])   # env 0 upright, env 1 on its side
    env = SimpleNamespace(num_envs=2, device="cpu",
                          scene={"robot": SimpleNamespace(data=SimpleNamespace(projected_gravity_b=gravity))})
    term = rewards.ArenaFall(cfg.terminations["fell"], env)
    seen = [term(env, **params).tolist() for _ in range(params["hold_steps"])]
    assert seen[-2:] == [[False, False], [False, True]]   # out on the step that completes the hold
    term.reset(torch.tensor([1]))
    assert term(env, **params).tolist() == [False, False]


def test_the_string_end_is_where_the_arena_judges_it():
    pos, quat = torch.tensor([[-0.53, -0.01, 0.11]]), torch.tensor([[0.97, 0.05, -0.2, 0.1]])
    quat = quat / quat.norm()
    env = SimpleNamespace(scene={"robot": SimpleNamespace(data=SimpleNamespace(root_link_pos_w=pos, root_link_quat_w=quat))})
    margin = rewards.pit_margin(env, tug.STRING_OFFSET, -tug.PIT_M / 2)
    frame = np.zeros((1, 1, 21))
    frame[0, 0, :3], frame[0, 0, 3:7] = pos[0].numpy(), quat[0].numpy()
    end = arena_tug.string_ends(frame, arena_course.string_offset("legs"))[0, 0]
    assert margin.item() == pytest.approx(-tug.PIT_M / 2 - end[0], abs=1e-6)


def test_the_manifest_says_what_the_policy_reads():
    assert "-0.30" in ch.for_task("Mjlab-TugOfWar-MicroDuck").command["twist"]
```

- [ ] **Step 2:** Run the suite: the new tests fail.
- [ ] **Step 3:** Implement `challenge.toml`, `tasks.py`, `rewards.py`, `make_env_cfg`, `RL_CFG` (the sprint's, `experiment_name = run_name = "tug_of_war"`), the package import; `env.py`'s docstring says it is the sprint's recipe made the tug's and lists the decisions it carries.
- [ ] **Step 4:** Suite: all pass, including every generic `test_challenges.py` test on the new row.
- [ ] **Step 5:** Commit: "The Tug of War's recipe: walk backwards against the winch, hold the pull upright, a fall or the pit ends it as on the Arena; three knobs"

### Task 5: The recipe runs end to end on the Mac

**Files:** Modify `tests/test_tug_of_war.py`.

**Interfaces:** Consumes `mjlab.envs.ManagerBasedRlEnv`. Produces proof on the real env, then a smoke checkpoint that exports and scores.

- [ ] **Step 1: Write the env tests** (append; CPU, 2 envs; the first run compiles warp kernels, minutes):

```python
from mjlab.envs import ManagerBasedRlEnv


@pytest.fixture(scope="module")
def live():
    cfg = tug.make_env_cfg()
    cfg.scene.num_envs = 2
    env = ManagerBasedRlEnv(cfg, device="cpu")
    env.reset()
    yield env
    env.close()


def test_the_env_pulls_on_time(live):
    term, winch = live.command_manager.get_term("winch"), live.sim.mj_model.actuator(tug.WINCH).id
    for _ in range(40):
        obs, *_ = live.step(torch.zeros(2, 14))
        t = live.episode_length_buf.double() * live.step_dt - tug.SETTLE_S
        assert torch.allclose(live.sim.data.ctrl[:, winch], tug.bench_force(term.profile.double(), t).float(), atol=1e-5)
    assert obs["actor"].shape == (2, 61) and torch.isfinite(obs["critic"]).all()


def test_a_trunk_in_the_pit_ends_the_episode(live):
    robot = live.scene["robot"]
    pose = robot.data.root_link_pose_w.clone()
    pose[0, 2] = -0.2
    robot.write_root_link_pose_to_sim(pose)
    live.sim.forward()
    _, _, terminated, _, _ = live.step(torch.zeros(2, 14))
    assert terminated.tolist() == [True, False]
```

- [ ] **Step 2:** Run them. A failure is an integration bug (keyframe ctrl size, site naming, origins): fix `env.py`, never the test. Then the suite.
- [ ] **Step 3: Smoke train:** `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --gpu-ids None --env.scene.num-envs 2 --agent.max-iterations 2 --agent.save-interval 1 --agent.logger tensorboard --agent.run-name smoke` writes `logs/rsl_rl/tug_of_war/<stamp>_smoke/model_1.pt`.
- [ ] **Step 4: Export:** `cd <wt> && uv run --no-config --no-sync publish --run logs/rsl_rl/tug_of_war/<stamp>_smoke --checkpoint 1 --repo local/microduck-eval --dry-run --allow-dirty`; `publish-eval/manifest.json` names event `tug-of-war`, the task, the twist help.
- [ ] **Step 5: Score** (needs Plan A's Task 5): `cd <wt> && uv run --no-config --no-sync arena score publish-eval/policy.onnx --event tug-of-war` prints five `seed n:` lines and `rating: X.XX N · replay from seed n` (a smoke policy falls: near 0 N). Remove the smoke run and `publish-eval/`.
- [ ] **Step 6: Job preflight, not submitted:** Task 9 step 2's command with `--dry-run` instead of `--detach` and `--agent.run-name preflight`: the printed tarball holds `tug_of_war/env.py`, `rewards.py`, `challenge.toml`.
- [ ] **Step 7:** Commit: "The Tug of War's env pulls on the bench's clock and ends in the pit, checked on the real env"

### Task 6: check.py plays bouts between two policies

**Files:** Create `tug_of_war/check.py`; modify `tests/test_tug_of_war.py`.

**Interfaces:** Consumes `arena.tug.run_bout(manifest, west, east, seed) -> BoutOutcome(seed, loser, how, time_s, …)`, `arena.policy.load_policy`. Produces:

```python
def play(manifest, a, b, bouts: int) -> list[tuple[str, BoutOutcome]]   # bout k on seed k + 1; A is west when k is even
def summary(results) -> list[str]
#   per bout "bout 3 · seed 3 · A east · A loses by pit at 6.20 s" (or "by fall", "by marker"), then
#   "A 6 · B 3 · draws 1 · by pit 4 · by fall 3 · by marker 2 · median decision 6.8 s"
def main(argv=None) -> int    # check.py A.onnx B.onnx [--bouts 10]; 1 on an unreadable policy
```

- [ ] **Step 1: Failing tests:** `summary` over hand-made `BoutOutcome`s (counts by pit, fall and marker, median, side swap, a draw for nobody); `main` with the vendored walker against itself, `--bouts 2`: 2 bout lines + the summary, returns 0; a missing file: returns 1, path on stderr.
- [ ] **Step 2:** Run: they fail on the missing module.
- [ ] **Step 3:** Implement (imports the Arena; nothing in `tasks.py` imports it).
- [ ] **Step 4:** Suite green, `test_the_training_never_imports_the_arena` included.
- [ ] **Step 5:** Commit: "The Tug of War's check plays bouts between two policies on the Arena's physics, sides swapped"

### Task 7: The challenge's AGENTS.md and the READMEs

**Files:** Create `tug_of_war/AGENTS.md`; modify `README.md`, `AGENTS.md`.

- [ ] **Step 1:** `tug_of_war/AGENTS.md` on the sprint's outline: the rules (course, judge: the pit or a fall loses, then the marker; bench, rating in newtons, higher wins, the weekly cup); the policy (61 numbers, `[-0.30, 0, 0]`); files, knobs, do-not-change (robot, 61-D, `experiment_name`, the copied constants: "the Arena first, then here, then the parity tests"); running; judging (`arena score`, `check.py`); publishing; "What is known" (Task 12).
- [ ] **Step 2:** Rows `tug_of_war | tug-of-war | Mjlab-TugOfWar-MicroDuck` in `README.md` (+ a paragraph on the rating and `check.py`) and root `AGENTS.md`. Suite; commit: "The Tug of War's guide for a coding agent, and its rows in the READMEs"

### Task 8: G0, the bench's baselines

**Files:** the ledger.

- [ ] **Step 1: Measure** (Mac):

```bash
cd <wt> && uv run --no-config --no-sync python -c "
import numpy as np
from arena.assets import ASSET_ROOT
from arena.manifest import load_event
from arena.policy import load_policy
from arena.tug import run_bench
class Zero:
    def act(self, obs): return np.zeros(14, np.float32)
m = load_event('tug-of-war')
for name, p in (('zero', Zero()), ('walker', load_policy(ASSET_ROOT / 'policies' / 'BEST_alpha_walking.onnx'))):
    runs = [run_bench(m, p, s) for s in m.seeds]
    print(name, round(float(np.mean([r.force_n for r in runs])), 3), [(r.status, round(r.force_n, 2), r.time_s) for r in runs])
"
```

- [ ] **Step 2:** Both ratings and per-seed lines into the ledger, beside the numbers Plan A's Task 3 report recorded.
- [ ] **Step 3: Gate G0:** the baselines are expected near 0 N, since a fall ends the run (owner, 2026-10-20). Pass: the zero duck goes out by `fall` on every seed, and `max(zero, walker) ≤ BENCH_TOP_N − 1.5` (G2 reachable). A zero duck that holds on, or rates above 1.5 N, means the bench is not ending the run at a fall: a Plan A regression, reported to the controller, never tuned around here. Task 9 still runs.

### Task 9: Training t1, G1, and the stand-ins for Plans C and D

**Files:** none tracked; the ledger, `logs/rsl_rl/tug_of_war/`, `logs/tug_of_war/onnx/`.

- [ ] **Step 1:** Suite green, `/usr/bin/git -C <wt> status --short` clean; ledger row `t1` (HEAD, "the recipe as written").
- [ ] **Step 2: Launch:** `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 3000 --agent.seed 1 --agent.logger tensorboard --agent.run-name t1 --hf-jobs --detach --no-wandb --namespace Nico-robot --ckpt-repo Nico-robot/mjlab-tugofwar-microduck-t1` prints `[job] id: <id>` (ledger).
- [ ] **Step 3:** `cd <wt> && uv run --no-config --no-sync hf jobs inspect <id> --namespace Nico-robot` reaches RUNNING. ERROR naming a volume mount: resubmit. Other ERROR: read `hf jobs logs <id> --namespace Nico-robot`, fix, relaunch.
- [ ] **Step 4: Once per checkpoint:** wait (Monitor) on `cd <wt> && uv run --no-config --no-sync python -c "from huggingface_hub import list_repo_files; print(sorted(f for f in list_repo_files('Nico-robot/mjlab-tugofwar-microduck-t1') if f.endswith('.pt')))"`, then `cd <wt> && uv run --no-config --no-sync hf download Nico-robot/mjlab-tugofwar-microduck-t1 --local-dir logs/rsl_rl`.
- [ ] **Step 5: Curves** (the sprint AGENTS.md's EventAccumulator one-liner): `Train/mean_episode_length`, `Episode_Termination/{in_pit,fell,nan_state}`, `Episode_Reward/{hold,pit_margin_reward,track_linear_velocity,out}`; penalties ≤ 0.
- [ ] **Step 6: Gate G1** (iteration ≥ 1000): no NaN error and `nan_state` < 0.01; `Episode_Reward/hold` at 1000 above 250's; `mean_episode_length` grows (a fall and the pit both end an episode, so length is the plain signal) while `fell` and `in_pit` fall, and recovers within 500 iterations after each `winch_top` stage. Fail: cause from the curves, one fix commit, relaunch `t2` (the stop rule counts).
- [ ] **Step 7: Stand-ins:** checkpoints 500, 1000, 2000 and the last: `cd <wt> && uv run --no-config --no-sync publish --run logs/rsl_rl/tug_of_war/<stamp>_t1 --checkpoint <N> --repo local/microduck-eval --dry-run --allow-dirty`, then `cp publish-eval/policy.onnx logs/tug_of_war/onnx/t1-<N>.onnx`. Absolute paths into the ledger ("stand-ins for Plans C and D"); tell the controller. Rehearsal entrants only.

### Task 10: Judge and iterate, G2 and G3

**Files:** `env.py`, `rewards.py`, `challenge.toml` as a lever needs; the ledger.

- [ ] **Step 1: Rate every checkpoint ≥ 500:** export as Task 9 step 7 to `logs/tug_of_war/onnx/<run>-<N>.onnx`, then `cd <wt> && uv run --no-config --no-sync arena score logs/tug_of_war/onnx/<run>-<N>.onnx --event tug-of-war`; the `rating:` number and the five seed lines (how each went out: pit, fall or held) into the ledger.
- [ ] **Step 2: Gate G2:** best rating ≥ max(zero, walker) + 1.5 N.
- [ ] **Step 3: Gate G3:** `cd <wt> && uv run --no-config --no-sync python -m microduck_challenges.tug_of_war.check logs/tug_of_war/onnx/<best>.onnx logs/tug_of_war/onnx/<other>.onnx --bouts 10` (`<other>`: second best, or ≥ 500 iterations away). Passes when the median decision is ≥ 4 s and not every bout is a draw.
- [ ] **Step 4:** Both pass: Task 11. Else ONE lever below: hypothesis, change, suite, commit, launch `t<n>` as Task 9 step 2 (new name and repo), judge with steps 1–3. Read traces at 50 Hz (`run_bench(...).trace`: tilt, string-end x), never subsampled.
- [ ] **Step 5: Stop rule** (Global Constraints).

**Levers, in order:** (1) same commit, another `--agent.seed` (GPU variance is large); (2) another checkpoint (the best is often not the last); (3) noise reliance: curves good, Arena bad → roll out with and without action noise in the training env; if only the noisy one holds, `entropy_coef` 0.01 → 0.005; (4) anchors: a term paying a passive state wins (the swag's stand-still); read `Episode_Reward/<term>`, loosen or drop `pose`, `upright` or `pit_margin_reward`; (5) the pull signal: `winch_top` stages, the `out` penalty, the `hold` gate; (6) the profile (ramp, top) in the critic; (7) warm start from a walking checkpoint (microduck_rl's velocity task walks back at 0.4 m/s; the job sees only tracked files); (8) the event's command (−0.20 / −0.40): cross-repo, owner-visible, last.

### Task 11: G4, the ratings spread

**Files:** if a retune: arena `versus` `arena/events/tug-of-war.toml` (+ any Arena test pinning old numbers), challenges `env.py`; the ledger.

- [ ] **Step 1: Gate G4** (≥ 6 rated checkpoints of the passing runs): max − min ≥ 1.5 N, and fewer than half within 0.25 N of `top_n` or of the zero baseline.
- [ ] **Step 2:** All at the top: raise `top_n` (and the ramp, so the top stays within `time_limit_s`). All near zero: slow the ramp or shrink `jerk_n`. Retune as Global Constraints say (versus commit "The tug's bench ramps …", then `env.py` and this suite).
- [ ] **Step 3:** Re-rate the same ONNX files (no retraining for a judge change). If the nominal leaves the training family (`test_training_pulls_around_the_bench`, `test_the_curriculum_pulls_past_the_benchs_top` fail), widen it, commit, retrain, back to Task 10.

### Task 12: The first candidate, ready for the owner

**Files:** `tug_of_war/AGENTS.md`, the ledger; `<wt>/publish-tug-of-war/` (git-ignored).

- [ ] **Step 1: Pick** the best rating among checkpoints passing G3; on a tie, more bout wins.
- [ ] **Step 2: Export as the owner will publish** (no `--allow-dirty`; the repo is `Nico-robot/microduck-tug-of-war` unless the owner names another at publish time, 2026-10-20): `cd <wt> && uv run --no-config --no-sync publish --run logs/rsl_rl/tug_of_war/<stamp>_<run> --checkpoint <N> --repo Nico-robot/microduck-tug-of-war --dry-run`. `publish-tug-of-war/manifest.json`: event `tug-of-war`, the task, the twist help, Reproduce = the run's commit on `tug-of-war`.
- [ ] **Step 3:** `cd <wt> && uv run --no-config --no-sync arena score publish-tug-of-war/policy.onnx --event tug-of-war` equals the ledger's number.
- [ ] **Step 4:** "What is known" in `tug_of_war/AGENTS.md`, measured facts only (baselines, the candidate's Mac rating, what each lever did, checkpoint spread); suite; commit: "The Tug of War's guide says what the first trainings measured".
- [ ] **Step 5: Hand over** in the ledger and the final report the owner's command, for after Plan D's release (Space on 0.6.0, Task 13's microduck_rl commit pushed, `tug-of-war` merged into challenges main without squash, main relocked on both), run from the main checkout (its venv then holds the 0.6.0 wheel and the new publish CLI, not this worktree's editable copies):

```bash
cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges
uv run --no-config publish --run /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/logs/rsl_rl/tug_of_war/<stamp>_<run> --checkpoint <N> --repo Nico-robot/microduck-tug-of-war --no-private --enter
```

It prints `[publish] entered on tug-of-war: a X.XX N rating → <page url>` (Task 13). An ordinary entry under the owner's name; nothing in this plan runs it.

### Task 13: The publish CLI says a tug entry as its rating (microduck_rl)

Independent of the trainings: run it any time after Task 1.

**Files:** in `<rl>` = `/Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line` (ALWAYS written in full), branch `tug-publish-line` from `challenge-recipe-publishing` (8d0dbc9 or later): modify `src/mjlab_microduck/publish/arena.py`, `tests/test_publish_enter.py`.

**Interfaces:** Consumes the submit answer's `score`, `course` and `metric` (Plan A's Task 5). Produces `Entry.metric: str = "mean_finish_time"` and `entered_line`'s tug branch: `[publish] entered on tug-of-war: a 4.21 N rating → <page url>` (`already entered` when the Arena says so). Today a tug entry would print `4.210 s (5/5 seeds) at -0.30 m/s`.

- [ ] **Step 1:** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck_rl worktree add .claude/worktrees/tug-publish-line -b tug-publish-line challenge-recipe-publishing`. Run its tests with this plan's venv, the worktree installed in it editable: `cd <wt> && uv pip install --no-config --python .venv/bin/python --no-deps -e /Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line`; `cd <wt> && uv run --no-config --no-sync python -c "import mjlab_microduck.publish.arena as a; print(a.__file__)"` prints a path inside `<rl>`. `<wt>`'s own suite stays green.
- [ ] **Step 2: Failing test**, in `tests/test_publish_enter.py` beside `test_a_stage_entry_is_said_as_a_performance`:

```python
def test_a_tug_entry_is_said_as_a_rating(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, arena, capsys):
    arena.reply["body"] = json.dumps(ENTERED | {"score": 4.2134, "course": "tug", "metric": "mean_hold_force"})
    assert _publish(tmp_path, monkeypatch, arena=arena.url) == 0
    assert f"[publish] entered on sprint-2m: a 4.21 N rating → {PAGE}" in capsys.readouterr().out
```

- [ ] **Step 3:** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line && /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_publish_enter.py`, foreground: the new test fails (the line says seconds).
- [ ] **Step 4: Implement.** `Entry.metric`, read as `body.get("metric", "mean_finish_time")` (an older Arena sends none); `entered_line`: `if entry.metric == "mean_hold_force": return f"[publish] {said} on {event}: a {entry.score:.2f} N rating → {entry.page_url}"`, with a comment (a tug's score is a rating in newtons, higher wins; it has no speed), before the stage branch.
- [ ] **Step 5:** Step 3's command on `tests/test_publish_enter.py tests/test_publish_manifest.py`: all pass.
- [ ] **Step 6:** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line add src/mjlab_microduck/publish/arena.py tests/test_publish_enter.py` and commit (unsigned): "A tug entry is said as its rating in newtons". Report the hash: Plan D's release pushes it (`challenge-recipe-publishing` fast-forwarded) before the challenges relock picks it up.

---

## Self-review

Spec §3 covered by Tasks 2–4 and 12 (the workshop's Test step is Arena code: a contract gap). Plan A's names used as written; `Manifest.start.joint_rad/yaw_deg` and mjlab 1.3.0's `spec_fn`, `reset_base`, `reset_robot_joints`, `root_link_pose_w`, `write_root_link_pose_to_sim`, `is_terminated`, `root_height_below_minimum`, `projected_gravity_b` and class terms (`ManagerTermBase`, built by the termination manager with `(cfg=…, env=…)` and reset per env) checked in the installed code. The publish CLI's line for a tug entry is Task 13 (contract § Plan B). Lessons: physics pinned (BAM), every checkpoint on the Arena (roller), seed re-runs, noise reliance, anchors, 50 Hz traces (swag), a stop rule.
