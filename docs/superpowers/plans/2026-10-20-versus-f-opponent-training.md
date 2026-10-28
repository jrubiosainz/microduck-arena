# Versus F: the Tug Recipe Trains Against a Frozen Opponent Duck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the `tug_of_war` recipe trains a duck in the Arena's bout against a frozen opponent duck (the reference, t7-250), the winch gone; HF Jobs trainings judged by the Arena's new rating; the best checkpoint at release handed to the owner.

**Architecture:** the training scene becomes the Arena's bout: mjlab entities `robot` (learner, always west) and `opponent` (east) tied neck to neck by `compile_tug(m)`'s limited string, lane, pit, 45 s. An action term with no agent dimension drives the opponent: each control step it builds the 61 numbers `arena.runner._observe` gives the east duck, runs the vendored reference ONNX as a torch `nn.Sequential` on the env's device, and sets its BAM joint targets as the learner's are set. Arena numbers are copied into `env.py` (the job cannot import it) and pinned by parity tests.

**Tech Stack:** Python 3.12, mjlab 1.3.0 (mujoco_warp 3.8.1), rsl_rl 5.0.1, onnx 1.23 (on the job via mjlab), onnxruntime (parity), mjlab_microduck (`tug-publish-line`, editable), HF Jobs l4x1, the versus Arena (editable), pytest.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md` §1–§3 as amended 2026-10-20 night (58acfc1). **Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md`. **History:** Plan B (`docs/superpowers/plans/2026-10-19-versus-b-tug-recipe.md`), ledger `.superpowers/sdd/2026-10-19-versus-b-tug-recipe/progress.md`.

**Decisions** (what, then why):
1. Learner always west, opponent east: half a turn about the pit's vertical axis maps the course and west start onto the east's, and the actor's observation is in the trunk's frame: the east side is the same bout turned.
2. Entities `robot` and `opponent`, both `MICRODUCK_STANDUP_ROBOT_CFG`; `tug_scene` adds the course, both `string_end` sites and the tendon `string` limited to `[0, STRING_M]`: `compile_tug(m)`'s bout.
3. The opponent is `logs/tug_of_war/onnx/t7-250.onnx` vendored as `tug_of_war/reference.onnx` (775 KB, sha256 `0c4e8b0abc9223c51bc4a32bc78591a4dc72c92ff873b6de7cd894bfad4bc1a2`), `.gitignore` excepted: the job gets only non-ignored files, the ckpt repo is private, public users need it; the Arena vendors the same bytes (Plan E).
4. `load_actor` reads the graph `Sub(mean) → Div(std) → 3 × (Gemm transB=1 → Elu α=1) → Gemm` with `onnx.numpy_helper` into `Normalize` + `nn.Sequential`, refusing any other node: no new dependency, and any model of the same exporter loads alike (the league's hook).
5. `OpponentAction`, a `JointPositionAction` on `opponent` with `action_dim` 0: mjlab calls it at each step's start, on the state the learner's observation saw, so both ducks act on one state as in the Arena's `_step`; its targets take the parent's default offset × 1.0 into its own BAM actuators (reset and fifth drives included).
6. Its observation is `_observe`'s: `root_link_ang_vel_b`, `projected_gravity_b`, joints minus default, the joint velocity read at its previous step, its previous action, the event's 13-number command; no noise, delay or encoder bias (the Arena gives none); memory zero after a reset.
7. No randomisation on the opponent: every DR event and push names `robot`.
8. Terminations `time_out`, `nan_state`, `in_pit`, `opponent_in_pit`, `fell` (learner, TRAINING ONLY: without it t2/t3 lay down from 1 s). `out` −50 on `in_pit`/`fell`, `win` +50 on `opponent_in_pit`; both on one step pay nothing (the rarest end).
9. `marker_ground` (stateful like `Retreat`, which it replaces): the marker's new ground west, scale 0.05 m/s, knob `pull_reward` "Win ground" 2.0: the rating measures the marker, and new ground pays a sway nothing.
10. Locomotion first: an episode that starts before iteration 250 has a slack string (limit `SLACK_M = 100 m`, written per env at its reset, `tendon_range` expanded per world): t6/t7 learned the walk back only with no load, by 250; switching at a reset never yanks a running bout.
11. Starts: west x `[west_x, west_x + 0.02]`, east x `[east_x − 0.02, east_x]`, y ±0.01, yaw ±5° (east 180° ± 5°), z (0.12, 0.13), joints ±0.01: never farther apart than the Arena's taut start (a stretched start jerks both ducks).
12. Critic adds `opponent` (12: trunk position from the learner's, projected gravity, world linear and own-frame angular velocity), `string_length`, `marker_x`; actor 61-D.
13. Episode 45.5 s (`SETTLE_S + BOUT_S`); `nconmax = 400` (two ducks).

## Global Constraints

The contract's Global constraints apply. On top of them:

- **Worktree** `/Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war` (`<wt>`, ALWAYS in full in commands), branch `tug-of-war` (HEAD 370239a at the start). Each Bash call is `cd <wt> && <command>`, no globs or shell variables.
- **uv:** always `uv run --no-config --no-sync …`; never `uv sync` or `uv lock`; if `uv.lock` changes, `/usr/bin/git -C <wt> checkout -- uv.lock`. Git is `/usr/bin/git`.
- **Tests:** `cd <wt> && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests`, foreground, `timeout: 600000`; never wait on a background run.
- **`env.py`, `rewards.py`, `tasks.py`, `opponent.py` never import `arena`**; only tests and `check.py` do.
- **Commits:** English, unsigned, one per task; before every training, message = the hypothesis; never rebase or squash `tug-of-war` once a candidate's training commit exists. Nothing pushed; `publish` only with `--dry-run`.
- **HF Jobs** without asking under `--namespace Nico-robot` (owner's grant, no budget limit), l4x1, ≤ 3 in flight, always `--detach`, ckpt repos private. A subagent launches and returns; the controller waits (Monitor, never `sleep`) and dispatches judges per checkpoint batch.
- **`arena score` on a tug** (Plan E): five bout lines, then `rating: X.X cm · replay from seed n`; the ledger takes the number after `rating: `. Mac numbers are indicative. Every judge reads 50 Hz traces (trunk z and tilt, string end-to-end distance, marker).
- **Stop rule:** 3 trainings in a row with no checkpoint passing R1–R3 (Task 7): report to the owner (ledger, curves, traces, next proposal) and wait. The release never waits for it (Task 9).
- **Ledger** `<wt>/logs/tug_of_war/ledger.md` (git-ignored), continued: commit, job id, repo, hypothesis, ratings, R1–R3, verdict.
- **Order** (the contract's, 2026-10-20 night): Task 1 first and alone (this suite imports the Arena's winch until then); then Plan E's Tasks 1–8 (Arena, `versus`: the rating, the vendored reference, the winch and `compile_tug`'s `ducks` argument removed; its Tasks 2 and 4 bring this suite along: `BOUT_S = 45.0`, `compile_tug(EVENT)`, `tug_layout(EVENT.course)`); then Tasks 2–8, Task 7's trainings on HF Jobs in the background while the controller runs Plan C's Tasks 8–14 and Plan D; Task 9 at release. From Task 2 on, only the one-argument forms.

## Review Focus

1. **The opponent sees other numbers than the Arena gives it** (gyro frame, joint order, a fresh or twice-stale joint velocity, the learner's noise, a non-zero head/body command): `test_the_opponent_observes_as_the_arena_does`, `test_the_opponent_remembers_as_the_arena_does` (Task 3).
2. **The torch net is not the ONNX** (normalizer, `transB`, ELU α, a skipped node): `test_the_opponent_net_is_its_onnx`, `test_a_graph_the_loader_does_not_know_is_refused` (Task 3).
3. **The job runs without its opponent** (`*.onnx` is ignored, the tarball skips ignored files): `test_the_reference_ships_with_the_challenge` (Task 3), the preflight (Task 5).
4. **The opponent keeps memory across episodes, or gets the learner's randomisation**: `test_a_reset_clears_the_opponents_memory` (Task 3), `test_the_learners_randomisation_leaves_the_opponent_alone` (Task 4).
5. **A pit pays the wrong side, or a start stretches the string**: `test_either_pit_ends_the_episode_and_pays_its_side` (Task 4), `test_a_pit_on_either_side_ends_the_episode` (Task 5), `test_no_start_stretches_the_string` (Task 2).

---

### Task 1: The winch leaves the recipe

First and alone, so Plan E can delete the Arena's winch.

**Files:** Modify `src/microduck_challenges/tug_of_war/env.py`, `tug_of_war/rewards.py`, `tug_of_war/challenge.toml`, `tests/test_tug_of_war.py`, `tests/test_challenges.py`.

**Interfaces:**
- Produces: `env.py` and `rewards.py` without the names `test_the_recipe_knows_no_winch` lists, nor `WinchCommand`, the critic's winch terms, `hold`; `BOUT_S = 20.0` (the versus `[bout]` today; Plan E's Task 2 makes it 45.0), `episode_length_s = SETTLE_S + BOUT_S`; `tug_scene` = course + `robot/string_end` (Task 2 ties the string to it); knobs `back_reward`, `upright_reward` (`pull_reward` returns in Task 4). The `arena_model` fixture is `compile_tug(EVENT, 2)`, the Arena's form at this task (Plan E's Task 4 rewrites it, and Step 1's `tug_layout(EVENT.course, 2)`, to one argument).

- [ ] **Step 1: Rewrite the tests.** Delete `test_the_string_and_winch_are_built_like_the_arenas`, `_pull`, `test_the_winch_pulls_like_the_arenas`, `test_the_pull_is_the_benchs`, `test_training_pulls_around_the_bench`, `_winch_env`, `test_the_winch_pulls_its_profile_on_the_arenas_clock`, `test_some_episodes_have_a_yielding_winch`, `test_the_winch_top_widens_stage_by_stage`, `test_the_curriculum_pulls_past_the_benchs_top`, `test_the_winch_top_widens_on_training_iterations`, `test_no_winch_until_the_duck_walks_backwards`, `test_hold_pays_the_pull_whatever_the_posture`, `test_the_env_pulls_on_time`. `test_the_constants_are_the_arenas`: drop the bench, `EVENT.time_limit_s` and winch asserts, add `tug.BOUT_S == EVENT.bout.time_limit_s`. `test_the_start_is_the_arenas` reads `tug_layout(EVENT.course, 2)[0]` and `SETTLE_S + EVENT.bout.time_limit_s`. The actor test's privileged set is `{"pit_margin", "heading_error"}` (drop its `winch_top` check). Row: `"tug_of_war": {"back_reward": ("track_linear_velocity", 2.3), "upright_reward": ("upright", 1.7)}`. Add:

```python
def test_the_recipe_knows_no_winch(cfg, training_model):
    for name in ("WINCH", "WINCH_SITE", "BENCH_TOP_N", "TIME_LIMIT_S", "winch_position", "bench_force",
                 "WinchCommandCfg", "winch_top", "winch_top_curriculum"):
        assert not hasattr(tug, name), name
    assert not hasattr(rewards, "hold") and "hold" not in cfg.rewards
    assert "winch" not in cfg.commands and "winch_top" not in cfg.curriculum
    assert not {"winch_pull", "winch_top"} & set(cfg.observations["critic"].terms)
    assert training_model.nu == 14 and training_model.ntendon == 0
```

- [ ] **Step 2:** Run the file: `test_the_recipe_knows_no_winch`, `test_the_constants_are_the_arenas` and `test_the_start_is_the_arenas` fail.
- [ ] **Step 3: Remove the winch**; `env.py`'s decision list loses D4, D10, D12 and the winch halves of D11 ("the settle plus a bout"), D13–D15; `challenge.toml` loses `[params.pull_reward]`.
- [ ] **Step 4:** Suite green; `cd <wt> && grep -n -i -E "winch|bench" src/microduck_challenges/tug_of_war/env.py src/microduck_challenges/tug_of_war/rewards.py src/microduck_challenges/tug_of_war/check.py` prints nothing (the guide is Task 6's).
- [ ] **Step 5: Commit:** "The Tug of War's recipe drops the winch: a duck alone on the lane for a bout's length, ready for an opponent". Report the hash to the controller: Plan E's Tasks 1–8 may start.

### Task 2: The bout scene: two ducks tied neck to neck

**Files:** Modify `tug_of_war/env.py`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Consumes: Plan E's Tasks 1–8 (`[bout] time_limit_s = 45.0`, and `BOUT_S = 45.0` already set here by its Task 2: `test_the_constants_are_the_arenas` pins it); `arena.course.compile_tug(EVENT)` (duck 1 is `duck1/`), `tug_layout(EVENT.course)`.
- Produces: `OPPONENT = "opponent/"`, `east_start() -> tuple[float, float]`; `tug_scene` per Decision 2; `make_env_cfg`: both entities, events `reset_opponent_base` (`mdp.reset_root_state_uniform` on `opponent`) and `reset_opponent_joints`, starts per Decision 11, `nconmax = 400`. The opponent is not driven yet.

- [ ] **Step 0:** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus show HEAD:arena/events/tug-of-war.toml | grep -A1 "^\[bout\]"` shows `time_limit_s = 45.0` and `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && grep -n "compile_tug(EVENT)" tests/test_tug_of_war.py` shows the fixture; otherwise stop, Task 2 waits for Plan E's Tasks 1–8.
- [ ] **Step 1: Write the failing tests.** `training_model` builds `SceneCfg(num_envs=1, entities={"robot": MICRODUCK_STANDUP_ROBOT_CFG, "opponent": MICRODUCK_STANDUP_ROBOT_CFG}, spec_fn=tug.tug_scene)`; `TENDON` gains `"tendon_range", "tendon_solref_lim", "tendon_solimp_lim", "tendon_margin"`; `test_the_start_is_the_arenas` asserts `pose["x"][0] == west.x` and y centred on `west.y`; `test_the_recipe_knows_no_winch` drops its `nu`/`ntendon` line. Add:

```python
def test_the_string_is_tied_like_the_arenas(arena_model, training_model):
    a, t = arena_model.tendon(tug.STRING).id, training_model.tendon(tug.STRING).id
    for field in TENDON:
        np.testing.assert_allclose(getattr(training_model, field)[t], getattr(arena_model, field)[a], err_msg=field)
    for ours, theirs in (("robot/", ""), ("opponent/", "duck1/")):
        site, arena_site = training_model.site(ours + tug.STRING_SITE), arena_model.site(theirs + tug.STRING_SITE)
        assert training_model.body(site.bodyid[0]).name == ours + "trunk_base"
        np.testing.assert_allclose(site.pos, arena_site.pos, atol=1e-12)
    assert training_model.nu == arena_model.nu == 28   # two ducks' servos, nothing else


@pytest.mark.parametrize("gap, held", [(-0.01, False), (0.01, True)])
def test_the_string_holds_at_its_length(arena_model, training_model, gap, held):
    """_bout_data: both ducks in DEFAULT_POSE at their bout starts, each moved gap / 2 away from the pit, mj_forward."""
    for model, prefixes in ((arena_model, ("", "duck1/")), (training_model, ("robot/", "opponent/"))):
        data = _bout_data(model, prefixes, gap)
        assert data.ten_length[model.tendon(tug.STRING).id] == pytest.approx(tug.STRING_M + gap, abs=1e-6)
        assert bool((data.efc_type[:data.nefc] == mujoco.mjtConstraint.mjCNSTR_LIMIT_TENDON).any()) is held


def test_the_bout_is_the_same_from_either_side():
    boxes = {(tuple(round(v, 9) for v in pos), tuple(size)) for _, pos, size in tug.course_boxes()}
    assert {((round(-x, 9), round(-y, 9), z), size) for (x, y, z), size in boxes} == boxes
    west, east = arena_course.tug_layout(EVENT.course)
    assert (east.x, east.y, east.yaw_deg) == pytest.approx((-west.x, -west.y, 180.0))
    assert tug.east_start() == pytest.approx((east.x, east.y)) and tug.west_start() == pytest.approx((west.x, west.y))


def test_no_start_stretches_the_string(cfg):
    """No corner of the start ranges puts the ends more than 5 mm past the string (the Arena's ±2° alone gives ~1 mm)."""
    west, east = cfg.events["reset_base"].params["pose_range"], cfg.events["reset_opponent_base"].params["pose_range"]
    corners = itertools.product(west["x"], west["y"], west["yaw"], east["x"], east["y"], east["yaw"])
    assert max(_ends_apart(*corner) for corner in corners) <= tug.STRING_M + 0.005   # STRING_OFFSET turned by each yaw
    assert west["x"][0] == pytest.approx(tug.west_start()[0]) and east["x"][1] == pytest.approx(tug.east_start()[0])
    yaw = math.radians(EVENT.start.yaw_deg)
    assert east["yaw"][0] <= math.pi - yaw and math.pi + yaw <= east["yaw"][1]
```

- [ ] **Step 2:** Run: they fail.
- [ ] **Step 3: Implement** them; a differing tendon field is set to the Arena's value, tolerances never loosened; the docstring names both ducks and Decision 1.
- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit:** "The Tug of War trains in the Arena's bout: two ducks on the lane, a 1 m string neck to neck, 45 s".

### Task 3: The frozen opponent plays the reference duck

**Files:** Create `tug_of_war/opponent.py`, `tug_of_war/reference.onnx` (`cp <wt>/logs/tug_of_war/onnx/t7-250.onnx`); modify `.gitignore` (`!src/microduck_challenges/tug_of_war/reference.onnx` after `*.onnx`), `tug_of_war/env.py`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Consumes: Task 2's `opponent` entity.
- Produces in `opponent.py` (stdlib, `onnx`, `torch`, mjlab only):

```python
REFERENCE = Path(__file__).with_name("reference.onnx")   # t7-250, the Arena's reference duck
class Normalize(torch.nn.Module)            # (x - mean) / std, rsl_rl's exported obs_normalizer
def load_actor(path: Path) -> torch.nn.Sequential   # ValueError naming the first node outside Decision 4's

@dataclass(kw_only=True)
class OpponentActionCfg(JointPositionActionCfg):
    entity_name: str = "opponent"
    actuator_names: tuple[str, ...] = (".*",)
    policy: Path = REFERENCE
    command: tuple[float, ...]               # env.COMMAND; build() returns OpponentAction

class OpponentAction(JointPositionAction):
    policy: Callable[[torch.Tensor], torch.Tensor]   # load_actor(cfg.policy) on env.device, eval
    last_action: torch.Tensor                # (n, 14)
    prev_joint_vel: torch.Tensor             # (n, 14)
    action_dim -> 0
    def observe(self) -> torch.Tensor        # (n, 61), Decision 6; memory untouched
    def process_actions(self, actions)       # empty slice: observe, act (no_grad), remember, super()
    def reset(self, env_ids)                 # memory zero, then super().reset
```

`env.py`: `COMMAND = (COMMAND_VX,) + (0.0,) * 12`; `cfg.actions["opponent"] = OpponentActionCfg(command=COMMAND)`.

- [ ] **Step 1: Write the failing tests** (`T7_250_SHA256` = Decision 3's hex):

```python
def test_the_opponent_net_is_its_onnx():
    obs = np.random.default_rng(0).normal(0.0, 3.0, (1000, 61)).astype(np.float32)
    session = onnxruntime.InferenceSession(str(opponent.REFERENCE), providers=["CPUExecutionProvider"])
    theirs = np.concatenate([session.run(None, {"obs": row[None]})[0] for row in obs])
    with torch.no_grad():
        ours = opponent.load_actor(opponent.REFERENCE)(torch.from_numpy(obs)).numpy()
    np.testing.assert_allclose(ours, theirs, atol=1e-5)


def test_a_graph_the_loader_does_not_know_is_refused(tmp_path):
    with pytest.raises(ValueError, match="Relu"):   # _relu_actor: onnx.helper's Sub, Div, Gemm, Relu, Gemm, 61 → 14
        opponent.load_actor(_relu_actor(tmp_path))


def test_the_reference_ships_with_the_challenge():
    assert hashlib.sha256(opponent.REFERENCE.read_bytes()).hexdigest() == T7_250_SHA256
    root = Path(microduck_challenges.__file__).parents[2]
    listed = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=root,
                            capture_output=True, text=True, check=True).stdout.split()
    assert "src/microduck_challenges/tug_of_war/reference.onnx" in listed   # hf_jobs.py tars exactly this list


def test_the_opponent_acts_on_the_arenas_joints(live):
    term, duck = live.action_manager.get_term("opponent"), live.scene["opponent"]
    assert term.target_names == list(JOINT_NAMES) and live.action_manager.total_action_dim == 14
    assert duck.data.default_joint_pos[0, term.target_ids].tolist() == pytest.approx(list(DEFAULT_POSE), abs=1e-6)
    act = torch.linspace(-0.2, 0.2, 14).expand(2, 14)
    policy, term.policy = term.policy, lambda obs: act
    try:
        term.process_actions(torch.zeros(2, 0))
        term.apply_actions()
    finally:
        term.policy = policy
    expected = torch.tensor(DEFAULT_POSE, dtype=torch.float32) + act * ACTION_SCALE   # runner._Duck.act
    assert torch.allclose(duck.data.joint_pos_target[:, term.target_ids], expected, atol=1e-6)


def test_the_opponent_observes_as_the_arena_does(live, arena_model):
    """Env 0's opponent pitched 20°, yaw 170°, joints ± U(0.2) off home, velocities U(±2), forward; known memory.
    MjData(arena_model) gets env 0's raw qpos/qvel: trunk free joint by body, joints "opponent/x" → "duck1/x"."""
    adr = arena_runner._Addresses.of(arena_model, EVENT.start.keyframe, "duck1/")
    theirs = arena_runner._observe(arena_model, data, adr, last_action, np.asarray(EVENT.command, dtype=np.float64), prev_joint_vel)
    np.testing.assert_allclose(term.observe()[0].numpy(), theirs, atol=1e-4)


def test_the_opponent_remembers_as_the_arena_does(live):
    term, duck = live.action_manager.get_term("opponent"), live.scene["opponent"]
    live.reset()
    live.step(torch.zeros(2, 14))   # moving: a reset's velocities are zeros
    before = duck.data.joint_vel[:, term.target_ids].clone()
    live.step(torch.zeros(2, 14))
    obs, now = term.observe(), duck.data.joint_vel[:, term.target_ids]
    assert torch.equal(obs[:, 20:34], before) and not torch.equal(obs[:, 20:34], now)   # a step old
    assert torch.equal(obs[:, 34:48], term.last_action) and term.last_action.any()


def test_a_reset_clears_the_opponents_memory(live):
    term = live.action_manager.get_term("opponent")
    live.step(torch.zeros(2, 14))
    live.reset(env_ids=torch.tensor([1]))
    assert not term.last_action[1].any() and not term.prev_joint_vel[1].any() and term.last_action[0].any()
```

`test_the_training_never_imports_the_arena` also imports `microduck_challenges.tug_of_war.opponent`.

- [ ] **Step 2:** Run the file: they fail on the missing module.
- [ ] **Step 3: Implement** `opponent.py` and its wiring. If only the gyro slot differs, read the opponent's `imu_ang_vel` sensor from `env.sim.data.sensordata` (the Arena's source); never loosen a tolerance.
- [ ] **Step 4:** Suite green; `cd <wt> && /usr/bin/git check-ignore -q src/microduck_challenges/tug_of_war/reference.onnx` exits 1.
- [ ] **Step 5: Commit** (`/usr/bin/git -C <wt> add .gitignore src/microduck_challenges/tug_of_war tests/test_tug_of_war.py`): "The Tug of War's opponent is the reference duck, frozen: the Arena's observation, its own servos, on the training's device".

### Task 4: The recipe pulls against the opponent

**Files:** Modify `tug_of_war/env.py`, `tug_of_war/rewards.py`, `tug_of_war/challenge.toml`, `tests/test_challenges.py`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces in `rewards.py` (`Retreat` and its tests go):

```python
def marker_x(env, offset: tuple) -> torch.Tensor          # (n,): middle of the two string ends, arena.tug.marker_x's
def string_length(env, offset: tuple) -> torch.Tensor     # (n, 1): the ends' distance, m
def opponent_state(env) -> torch.Tensor                   # (n, 12): Decision 12
class MarkerGround(ManagerTermBase):                      # __call__(env, offset, scale) -> (n,); reset(env_ids)
#   tanh(max(best - x, 0) / (scale * step_dt)), best = westmost marker x this episode (NaN at reset), then best = min(best, x)
def ended_by(env, terms: tuple[str, ...]) -> torch.Tensor # (n,) float: 1 where a named termination fired this step
```

`env.py`: `SLACK_M = 100.0`, `TAUT_FROM_ITERATION = 250`, `@requires_model_fields("tendon_range") def string_limit(env, env_ids, taut_from_step: int) -> None` (rows `env_ids` of `env.sim.model.tendon_range[:, string, 1]` = `STRING_M` once `env.common_step_counter ≥ taut_from_step`, else `SLACK_M`), event `string_limit` mode `reset`; terminations and rewards per Decisions 8–9; critic per 12. `[params.pull_reward]`: "Win ground", 2.0, 0.5–5.0.

- [ ] **Step 1: Write the failing tests.** Row gains `"pull_reward": ("marker_ground", 3.1)`. The actor test's privileged set becomes `{"opponent", "string_length", "marker_x", "pit_margin", "heading_error", "base_lin_vel"}`; `test_the_pit_and_a_training_fall_end_an_episode` folds into the first test below; the knob test asserts `pull_reward` "Win ground" 2.0.

```python
def test_either_pit_ends_the_episode_and_pays_its_side(cfg):
    t, r = cfg.terminations, cfg.rewards
    assert set(t) == {"time_out", "nan_state", "in_pit", "opponent_in_pit", "fell"}
    assert t["opponent_in_pit"].params["minimum_height"] == -arena_tug.PIT_DROP_M
    assert t["opponent_in_pit"].params["asset_cfg"].name == "opponent"
    assert (r["out"].func, r["out"].weight, r["out"].params) == (rewards.ended_by, -50.0, {"terms": ("in_pit", "fell")})
    assert (r["win"].func, r["win"].weight, r["win"].params) == (rewards.ended_by, 50.0, {"terms": ("opponent_in_pit",)})
    fired = {"in_pit": torch.tensor([True, False, False, True]), "fell": torch.tensor([False, True, False, False]),
             "opponent_in_pit": torch.tensor([False, False, True, True])}
    env = SimpleNamespace(termination_manager=SimpleNamespace(get_term=fired.get))
    paid = -50 * rewards.ended_by(env, ("in_pit", "fell")) + 50 * rewards.ended_by(env, ("opponent_in_pit",))
    assert paid.tolist() == [-50.0, -50.0, 50.0, 0.0]   # both in on one step: neither


def test_the_string_is_slack_until_the_walk_back(cfg, training_model):
    term = cfg.events["string_limit"]
    assert term.mode == "reset" and (tug.TAUT_FROM_ITERATION, tug.SLACK_M) == (250, 100.0)
    assert term.params == {"taut_from_step": tug.TAUT_FROM_ITERATION * tug.RL_CFG.num_steps_per_env}
    assert "tendon_range" in tug.string_limit.model_fields
    string, ranges = training_model.tendon(tug.STRING).id, torch.zeros(3, training_model.ntendon, 2)
    env = SimpleNamespace(common_step_counter=0, sim=SimpleNamespace(mj_model=training_model, model=SimpleNamespace(tendon_range=ranges)))
    tug.string_limit(env, torch.tensor([0, 1, 2]), **term.params)
    env.common_step_counter = term.params["taut_from_step"]
    tug.string_limit(env, torch.tensor([1]), **term.params)
    assert ranges[:, string, 1].tolist() == [tug.SLACK_M, tug.STRING_M, tug.SLACK_M]   # only a reset turns it taut


def test_the_learners_randomisation_leaves_the_opponent_alone(cfg):
    for name, term in cfg.events.items():
        named = {v.name for v in term.params.values() if isinstance(v, SceneEntityCfg)}
        if name in ("reset_opponent_base", "reset_opponent_joints"):
            assert named == {"opponent"}, name
        else:
            assert named <= {"robot"}, name
```

`test_the_marker_is_where_the_arena_reads_it`: two trunks at random poses in a fake scene; `marker_x` and `string_length` equal `arena_tug.marker_x` and the `string_ends` distance on the same `(2, 1, 21)` frame, `abs=1e-6`. `test_marker_ground_pays_new_ground_towards_the_learner` and `test_a_reset_clears_the_marker_record` are the two retreat tests on `_marker_run` (the opponent's end held at +0.5 m, so the marker moves at half the learner's end; `step = 2 * 0.05 * 0.02`), with `params == {"offset": tug.STRING_OFFSET, "scale": 0.05}`.

- [ ] **Step 2:** Run: they fail.
- [ ] **Step 3: Implement** them; the docstring gives Decisions 7–10 and their whys.
- [ ] **Step 4:** Suite green (the generic row tests included).
- [ ] **Step 5: Commit:** "The Tug of War's duck pulls against the reference duck: the marker's new ground, either pit ends the bout, a slack string until it walks back".

### Task 5: The bout runs end to end on the Mac

**Files:** Modify `tests/test_tug_of_war.py` (`test_a_trunk_in_the_pit_ends_the_episode` is replaced).

**Interfaces:**
- Consumes: Tasks 1–4; Plan E's rating for step 5.
- Produces: proof on the real env (2 envs, CPU), a smoke checkpoint that exports and scores, a preflight listing.

- [ ] **Step 1: Write the live tests:**

```python
def test_the_opponent_starts_where_the_arenas_east_duck_does(live):
    live.reset()
    east, data = arena_course.tug_layout(EVENT.course)[1], live.scene["opponent"].data
    pos, quat = data.root_link_pos_w, data.root_link_quat_w
    assert ((pos[:, 0] - east.x).abs() <= 0.02).all() and ((pos[:, 1] - east.y).abs() <= 0.01).all()
    yaw = torch.rad2deg(2 * torch.atan2(quat[:, 3], quat[:, 0])) % 360
    assert ((yaw - 180.0).abs() <= 5.0 + 1e-3).all()


def test_the_string_turns_taut_episode_by_episode(live):
    string = live.sim.mj_model.tendon(tug.STRING).id
    live.common_step_counter = 0
    live.reset()
    assert live.sim.model.tendon_range[:, string, 1].tolist() == [tug.SLACK_M] * 2
    live.common_step_counter = tug.TAUT_FROM_ITERATION * tug.RL_CFG.num_steps_per_env
    live.reset(env_ids=torch.tensor([0]))
    assert live.sim.model.tendon_range[:, string, 1].tolist() == [tug.STRING_M, tug.SLACK_M]


def test_a_pit_on_either_side_ends_the_episode(live):
    live.reset()
    for env, name in ((0, "robot"), (1, "opponent")):
        duck = live.scene[name]
        pose = duck.data.root_link_pose_w.clone()
        pose[env, 2] = -0.2
        duck.write_root_link_pose_to_sim(pose)
    live.sim.forward()
    _, _, terminated, _, _ = live.step(torch.zeros(2, 14))
    assert terminated.tolist() == [True, True]
    assert live.termination_manager.get_term("in_pit").tolist() == [True, False]
    assert live.termination_manager.get_term("opponent_in_pit").tolist() == [False, True]


def test_a_bout_steps(live):
    live.reset()
    for _ in range(25):
        obs, *_ = live.step(torch.zeros(2, 14))
    assert obs["actor"].shape == (2, 61) and torch.isfinite(obs["critic"]).all()
```

- [ ] **Step 2:** Run them; a failure is an integration bug: fix the code, never the test; then the suite.
- [ ] **Step 3: Smoke train:** `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --gpu-ids None --env.scene.num-envs 2 --agent.max-iterations 2 --agent.save-interval 1 --agent.logger tensorboard --agent.run-name smoke` writes `logs/rsl_rl/tug_of_war/<stamp>_smoke/model_1.pt`.
- [ ] **Step 4: Export:** `cd <wt> && uv run --no-config --no-sync publish --run logs/rsl_rl/tug_of_war/<stamp>_smoke --checkpoint 1 --repo local/microduck-eval --dry-run --allow-dirty`: `publish-eval/policy.onnx` takes 61 numbers, returns 14.
- [ ] **Step 5: Score** (Plan E's rating): `cd <wt> && uv run --no-config --no-sync arena score publish-eval/policy.onnx --event tug-of-war` prints five bout lines and `rating: X.X cm · replay from seed n`; `shasum -a 256` of the Arena's vendored reference is `T7_250_SHA256` (else stop: Plan E vendored another duck). Remove the smoke run and `publish-eval/`.
- [ ] **Step 6: Preflight:** Task 7 step 2's command, `--dry-run` for `--detach`, run name `preflight`: the tarball lists `tug_of_war/env.py`, `rewards.py`, `opponent.py`, `reference.onnx`, `challenge.toml`.
- [ ] **Step 7: Commit:** "The Tug of War's bout runs on the real env: the reference starts east, either pit ends it, the string turns taut at a reset".

### Task 6: check.py says how each bout was pulled, and the guide

**Files:** Modify `tug_of_war/check.py`, `tug_of_war/AGENTS.md`, `tug_of_war/challenge.toml` (header), `README.md`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Consumes: `arena.tug.run_bout`, `string_ends`, `marker_x`; `opponent.REFERENCE`.
- Produces in `check.py`: `TAUT_M = 0.995` (the judges' threshold); `pull(outcome, side: str) -> str` (when the ends first reach `TAUT_M`, or `never taut`; how far A's string end moved away from the pit from the settle's last frame to the 2.00 s frame; the marker's last x signed towards A); a bout line = verdict + ` · ` + `pull(...)`; tally `"A 2 · B 1 · draws 1 · A in the pit 1 · B in the pit 1 · by marker 1 · median decision 4.6 s"`; `main`: `check.py A.onnx [B.onnx] [--bouts 10]`, B defaulting to `opponent.REFERENCE`.

- [ ] **Step 1: Failing tests:** `test_a_bout_line_says_how_the_pull_went`: a hand-made 2250-frame bout, the west string end from −0.50 m (settle's last frame) to −0.58 m linearly over 1.00 s then still, the east end still at +0.42 m (trunk turned 180°): `pull(outcome, "west") == "taut at 0.94 s · A backed 8.0 cm by 2 s · marker 8.0 cm to A"`, `pull(outcome, "east") == "taut at 0.94 s · A backed 0.0 cm by 2 s · marker -8.0 cm to A"`; ends held 0.98 m apart: `never taut`. `test_the_summary_counts_who_lost_and_how` keeps its four bouts (now with standing traces) and the new tally. `test_the_check_plays_the_reference_by_default`: `main([walker, "--bouts", "2"])` returns 0, three lines.
- [ ] **Step 2:** Run: they fail.
- [ ] **Step 3: Implement** `check.py`.
- [ ] **Step 4: The guide.** `AGENTS.md` on its outline, rewritten for: the rules (only the pit decides, 45 s); the rating (five bouts against the reference, cm of marker plus the pit bonus); training against `reference.onnx` (learner west, slack until 250, training-only fall); `opponent.py`, `reference.onnx` and the copied constants as do-not-change; healthy curves (`marker_ground`, `win` rising after 250); judging with `arena score` and `check.py`; "What is known" keeps t1–t7 and says why the winch went (a lying duck held it as well as any trained one). `README.md` and the toml's header in two lines.
- [ ] **Step 5:** Suite; commit: "The Tug of War's check says how each bout was pulled and plays the reference by default; the guide trains against it".

### Task 7: Trainings t8 and t9, judged on the Arena

**Files:** none tracked; the ledger, `logs/rsl_rl/tug_of_war/`, `logs/tug_of_war/onnx/`.

**Interfaces:** Consumes Tasks 1–6 committed, clean tree, Plan E's rating. Produces rated `logs/tug_of_war/onnx/t<k>-<N>.onnx`, ledger rows, R1–R3 verdicts.

- [ ] **Step 1:** Suite green, `/usr/bin/git -C <wt> status --short` empty; ledger rows `t8`, `t9` (HEAD, "against the frozen reference, slack string until 250").
- [ ] **Step 2: Launch** both: `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 3000 --agent.seed 1 --agent.logger tensorboard --agent.run-name t8 --hf-jobs --detach --no-wandb --namespace Nico-robot --ckpt-repo Nico-robot/mjlab-tugofwar-microduck-t8` (t9: seed 2, `t9`, `-t9`); `[job] id: <id>` into the ledger.
- [ ] **Step 3:** `cd <wt> && uv run --no-config --no-sync hf jobs inspect <id> --namespace Nico-robot` reaches RUNNING; ERROR naming a volume mount: resubmit; another ERROR: `hf jobs logs <id> --namespace Nico-robot`, fix, commit, relaunch.
- [ ] **Step 4: The controller waits** per checkpoint (Monitor on the repo's `.pt` list, Plan B Task 9 step 4), then `hf download Nico-robot/mjlab-tugofwar-microduck-t<k> --local-dir logs/rsl_rl`. Judged: 250, 500, 750, 1000, 1500, 2000, 2500, the last.
- [ ] **Step 5: Judge each** (a subagent per batch), all into the ledger: export (Task 5 step 4) to `logs/tug_of_war/onnx/t<k>-<N>.onnx`; `arena score`; `cd <wt> && uv run --no-config --no-sync python -m microduck_challenges.tug_of_war.check logs/tug_of_war/onnx/t<k>-<N>.onnx --bouts 10`; bout 1's 50 Hz trace (`run_bout`, checkpoint west, seed 1) each second: both trunks' z and `tilt_deg`, the ends' distance, the marker; curves `Train/mean_episode_length`, `Episode_Termination/{in_pit,opponent_in_pit,fell,nan_state}`, `Episode_Reward/{marker_ground,win,out,track_linear_velocity,pit_margin_reward,upright}`.
- [ ] **Step 6: Gates** (R1 and R2 make a checkpoint ≥ 500 a release candidate; R3 is a training target, never a release gate):
  - **R1** no NaN error, `nan_state` < 0.01; of the 10 bouts, the string is taut by 2.00 s in ≥ 8 and A backed ≥ 2 cm by 2 s in ≥ 8 (the reference alone also tightens the string).
  - **R2** `rating:` ≥ +20.0 cm: it out-pulls the duck it trained against, clearly above the +10.0 cm t6-250 already scores without opponent training (Mac, indicative).
  - **R3 (target)** ≥ 3 of the 10 bouts end `B loses by pit`: the reference dragged in.
- [ ] **Step 7:** A checkpoint passes R1–R3: no further training, Task 9 at release. Else ONE lever (aimed at the first of R1, R2, R3 missed), hypothesis in the commit, launch `t<n>` as step 2 (new name and repo), judge as steps 4–6; the stop rule counts t8, t9, t10.

**Levers, in order:** (1) another checkpoint, then seed; (2) the slack phase: 500 if the walk back decays once taut, 0 if it never forms; (3) `marker_ground` scale 0.02 or weight 4, `win` 100; (4) the training-only fall lifted once taut, so the learner may go down to hold as the Arena allows; (5) the learner's actor warm-started from `reference.onnx` (`load_actor`'s weights and normalizer, `init_std` 0.3).

### Task 8: The publish CLI says a tug entry's rating in centimetres (microduck_rl)

After Plan E's rating; independent of the trainings.

**Files:** in `/Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line` (branch `tug-publish-line`, a5561ae): `src/mjlab_microduck/publish/arena.py`, `tests/test_publish_enter.py`.

**Interfaces:**
- Consumes: the tug's `metric` (`/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus show HEAD:arena/events/tug-of-war.toml | grep ^metric`), `score` in cm.
- Produces: `entered_line` says `[publish] entered on tug-of-war: a 12.3 cm rating → <page url>` on that metric; the `mean_hold_force` branch goes (no Arena sends it).

- [ ] **Step 1:** `test_a_tug_entry_is_said_as_a_rating` sends `{"score": 12.34, "course": "tug", "metric": <that metric>}` and expects `a 12.3 cm rating`.
- [ ] **Step 2:** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line && /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_publish_enter.py`: it fails (newtons).
- [ ] **Step 3:** Implement `f"a {entry.score:.1f} cm rating"` with a comment (centimetres of marker against the reference duck, higher wins).
- [ ] **Step 4:** Step 2's command on `tests/test_publish_enter.py tests/test_publish_manifest.py`: green.
- [ ] **Step 5:** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck_rl/.claude/worktrees/tug-publish-line add src/mjlab_microduck/publish/arena.py tests/test_publish_enter.py`; commit (unsigned) "A tug entry is said as its rating in centimetres"; report the hash: Plan D's release pushes `tug-publish-line`.

### Task 9: The first candidate at release, and what is known

When the controller says the release is near; never waits for a gate.

**Files:** `tug_of_war/AGENTS.md`, the ledger; `<wt>/publish-tug-of-war/` (git-ignored).

- [ ] **Step 1: Pick** among every judged checkpoint (t6-250 and t7-250 from before this plan included) the highest rating passing R1 and R2, else passing R1, else the highest rating (the release takes the best available); a tie goes to more `B loses by pit`.
- [ ] **Step 2: Export as the owner will publish** (clean tree): `cd <wt> && uv run --no-config --no-sync publish --run logs/rsl_rl/tug_of_war/<stamp>_<run> --checkpoint <N> --repo Nico-robot/microduck-tug-of-war --dry-run`; `publish-tug-of-war/manifest.json` names event `tug-of-war`, the task, the twist help, Reproduce = the run's commit.
- [ ] **Step 3:** `arena score publish-tug-of-war/policy.onnx --event tug-of-war` equals the ledger's number.
- [ ] **Step 4: "What is known"** in `AGENTS.md`, measured facts only (t8+ ratings, R1–R3, what the traces showed, each lever, the candidate). Suite; commit "The Tug of War's guide says what training against the reference measured".
- [ ] **Step 5: Hand over** (ledger and report) the owner's command for after Plan D's release (Task 8 pushed, `tug-of-war` merged without squash, relocked), from the main checkout:

```bash
cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges
uv run --no-config publish --run /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/logs/rsl_rl/tug_of_war/<stamp>_<run> --checkpoint <N> --repo Nico-robot/microduck-tug-of-war --no-private --enter
```

It prints `[publish] entered on tug-of-war: a X.X cm rating → <page url>`. Keep the worktree until he has.

---

## Next step, not in this plan: the league

Choosing and switching opponents among our best checkpoints and published models plugs into `OpponentActionCfg.policy`: it becomes `policies: tuple[Path, ...]` (vendored exports; published models fetched from the Hub at job start), each loaded by `load_actor`, one drawn per env at `reset`, each run on its envs' rows, a curriculum changing the pool by iteration. Not built now.

## Self-review

- **Spec:** §1's bout is the training scene (Tasks 2, 4); §2's rating comes from Plan E's `arena score` (Tasks 5, 7, 9) and the publish line (Task 8); §3's frozen opponent (Tasks 3–4), the league as next step, the candidate not waiting (Task 9); the winch first for Plan E (Task 1); the anti-goal "a training bout unlike the Arena's" is Tasks 2–3's parity.
- **Checked in the installed code:** mjlab 1.3.0's step order, `ActionManager` splitting by `action_dim`, `JointPositionAction`'s offset and `encoder_bias`, `requires_model_fields`, `tendon_range (*, ntendon, 2)`, `get_term` surviving a reset; t7-250's graph (61 → 14, batch 1); `hf_jobs.py`'s `git ls-files -co --exclude-standard`; `*.onnx` ignored; no tendon in the robot.
- **Lessons:** BAM parity, every checkpoint on the Arena, 50 Hz traces (t1), training-only fall (t2/t3), locomotion first (t6/t7), seeds, a stop rule.
