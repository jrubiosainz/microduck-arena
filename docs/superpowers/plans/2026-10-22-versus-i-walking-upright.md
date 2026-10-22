# Versus I — Walking Upright (training) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the owner's ducks pull the way the robot walks: upright, head high, only the feet on the floor, stepping. The plan:
- replaces the `stay_upright` knob's 7 cm / 45° rule with the walking-upright rule, and has `check.py` judge it and the stepping;
- trains a new reference from the walker against the frozen walker, and hands it to both repos in place of t15-250;
- trains the owner's candidate against that reference, and verifies the users' recipe once.

**Architecture:**
- **One predicate in `rewards.py`.** `is_upright(z, gravity_b, head_z, neck_dev)` works on torch and numpy alike. The training's `Down` termination feeds it from mjlab's entity data plus a contact sensor on every body but the feet. `check.py` feeds it from a bout's trace through MuJoCo's forward kinematics, with the course contacts recomputed.
- **Stepping is judged only.** Clear touch-downs a second and the share of foot travel in contact, from the same recomputed contacts.
- **The walker for one training.** It is vendored as `walker.onnx` and started by `WalkerActor`. A field on the opponent's action names which ONNX the opponent runs, set from the command line for the reference's training only; Task 8 removes all three.

**Tech Stack:** Python 3.12, mjlab 1.3.0 (mujoco_warp 3.8.1 + warp 1.12), rsl_rl 5.0.1, MuJoCo 3.10, onnx, onnxruntime, mjlab_microduck (editable, `tug-publish-line`), the versus Arena (editable), HF Jobs l4x1, pytest.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md`, "Owner decisions, 2026-10-22 (walking upright)" and "My calls (2026-10-22)", §2–§3.

**Measurements:**
- `SCRATCH/posture-report.md`: the probe, `SCRATCH/posture_probe.py`, and its npz in `SCRATCH/probe/`.
- `SCRATCH/i-plan/` holds the planner's read-only probes:
  - `contact_bound_probe.py`: the shin contacts within the bands;
  - `posture_prototype.py`: `check.py`'s posture line on real bouts; Task 2's expected lines come from it;
  - `walker_probe.py`, `walker_std.py`: the walker's graph and normalizer;
  - `names_probe.py`: the bodies and joints;
  - `train-help.txt`: the train CLI.

**Previous plans:** Plan H `docs/superpowers/plans/2026-10-21-versus-h-upright-on-the-ring.md` and its ledger `.superpowers/sdd/2026-10-21-versus-h-upright-on-the-ring/progress.md`; Plan G Task 9 (`…/2026-10-21-versus-g-ring-and-rope.md`), the Arena side of a hand-over.

## Global Constraints

- **Plan H's Global Constraints apply unchanged** (`.superpowers/sdd/2026-10-21-versus-h-upright-on-the-ring/constraints.md`, all but its "Upright" and "Reference pick" lines, which this plan replaces):
  - the worktree `<wt>` = `/Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war`, always written in full, branch `tug-of-war`, HEAD 8a4aec8 at the start;
  - `uv run --no-config --no-sync …` (`--no-sync` mandatory, never `uv sync`/`uv lock`), and `/usr/bin/git`;
  - **TESTS** = `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests`, in the foreground with `timeout: 600000`;
  - `env.py`, `rewards.py`, `tasks.py` and `opponent.py` never import `arena`;
  - unsigned English commits, one per task; a training's commit message is its hypothesis;
  - nothing pushed, and `publish` only with `--dry-run`;
  - HF Jobs under `--namespace Nico-robot`, l4x1, at most 3 in flight, always `--detach`, private ckpt repos; a subagent launches and returns, and the controller waits (Monitor);
  - the ledger `<wt>/logs/tug_of_war/ledger.md` is continued; Mac numbers are indicative; English only; no dead code.
- **Shorthands, written out in full in every call:**
  - **ONNX** = `<wt>/logs/tug_of_war/onnx`; **ARENA** = `/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`; **SCRATCH** = `/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/e3798270-5a89-4af8-a12f-f9d4d292ea4f/scratchpad`.
  - Plan G's **PYTEST**, **SUITE** and **GIT** for the Arena (Task 6).
  - **CHECK** = `cd <wt> && uv run --no-config --no-sync python -m microduck_challenges.tug_of_war.check`.
- **Order:** Tasks 1 → 2 → 3 → 4 → 5, then Task 6 in one sitting across both repos, then 7, then 8. TESTS is green through Task 3. From Task 4 Step 1 to Task 8 Step 2 it is red on `test_the_recipe_users_get_lets_the_duck_go_down` alone, by design: that test pins what users get, while the owner's trainings run on the owner's values.
- **Pinned (`rewards.py`):**
  - `UPRIGHT_Z_M = 0.10`, `UPRIGHT_PITCH_DEG = (-10.0, 20.0)` (bowed towards the opponent, then leaning away from it), `UPRIGHT_ROLL_DEG = 10.0`, `UPRIGHT_HEAD_Z_M = 0.18`, `UPRIGHT_NECK_DEG = 30.0`;
  - `HEAD = "jaw_soft"`, `NECK = ("neck_pitch", "head_pitch")`, `FEET = ("ankle_left", "ankle_right")`;
  - `UPRIGHT_TILT_DEG` is gone;
  - the pitch is asin(−g_b[0]) (= asin(2(xz − wy)) off the trunk quaternion), the roll asin(−g_b[1]) (= asin(2(yz + wx))), + meaning the trunk's top leans away from the opponent the duck faces;
  - the hold stays `FALL_HOLD_S` (0.3 s, 15 control steps).
- **Pinned (`env.py`):**
  - `BODY_GROUND = "body_ground_contact"`.
  - With `stay_upright > 0`, `cfg.scene.sensors` gains `ContactSensorCfg(name=BODY_GROUND, primary=ContactMatch(mode="body", pattern=".*", entity="robot", exclude=FEET), secondary=ContactMatch(mode="body", pattern="terrain"), fields=("found",), reduce="none", num_slots=1)`.
  - `terminations["down"] = TerminationTermCfg(func=Down, params={"sensor_name": BODY_GROUND, "hold_steps": 15, "asset_cfg": SceneEntityCfg("robot", body_names=(HEAD,), joint_names=NECK)})`.
  - The rewards `down` (−50 × knob) and `out` (`("in_pit",)`) are as today.
- **Pinned (`check.py`):** `TAUT_M`, `BACKED_S` and `LIP_M` are as today; `STEP_AIR_FRAMES = 2`, `STEP_LIFT_M = 0.005`, `STILL_CM_S = 1.0`.
  - The bout line ends `… · {pull(...)} · {posture(...)}`.
  - `posture` reads `upright {u:.0f} % · longest out {s:.2f} s · feet only {f:.0f} % · {gait}`, where `gait` is `standing still` or `{steps:.1f} steps/s · slide {slide:.0f} %`.
- **Pinned (walker):** `WALKER = Path(__file__).with_name("walker.onnx")`, the bytes of `ARENA/arena/assets/policies/BEST_alpha_walking.onnx` (793,705 bytes, sha256 `e36332d383997d51401897734cd3e79cf5038406feddb18b4d57ecfb141daa6c`).
  - `OpponentActionCfg.onnx: str = "reference.onnx"`, a file beside `opponent.py`, which the CLI sets with `--env.actions.opponent.onnx walker.onnx`.
  - `WalkerActor`, selected with `--agent.actor.class-name microduck_challenges.tug_of_war.opponent:WalkerActor`.
- **Knobs:** `stay_upright` and `pull_reward` ("Win ground") are 0.0 and 2.0 for users. They are 1.0 and 4.0 for every owner training here: Task 4 Step 1 commits them, Task 8 Step 2 sets them back.
- **Gates** (CHECK's 10 bouts; `arena score`'s rating; the curves):
  - **U2** (walking upright): in ≥ 9 of 10 bouts, `upright` ≥ 90 % and `longest out` < 0.30 s.
  - **S** (stepping): in ≥ 8 of 10 bouts, `standing still`, or `steps/s` ≥ 2.0 and `slide` ≤ 20 %.
  - **R1**: `nan_state` < 0.01 in the curves, and in ≥ 8 bouts `A backed` ≥ +2.0 cm by 2 s.
  - **R2** (candidates): `rating:` ≥ +20.0 cm against the new reference.
  - **R3** (candidates, a target): ≥ 3 of 10 `B loses by pit`.
  - Candidates pass U2 and S over every round-robin bout too (Plan H's ruling).
- **The reference's judge:**
  - Its gates are read on CHECK against the walker (`<wt>/src/microduck_challenges/tug_of_war/walker.onnx` as B), its training opponent.
  - It is ranked by `arena score`'s rating against t15-250, the Arena's reference until Task 6, among the checkpoints passing U2, S and R1. Ratings within 5.0 cm go to a round robin: CHECK A B for each pair, more bouts won, then more pits.
  - CHECK against t15-250 (B left as the default) is information: the posture under a planter's pull.
  - The walker itself, measured on the Mac: against t15-250 it is dragged into the pit in 5.2–5.9 s, still 100 % upright. So expect every ranking rating near −160 cm, and the round robin to decide.
- **Judged checkpoints:** 250, 500, 750 and 1000. A run declining on every judged measure may be cancelled (Plan H's rulings).
- **Stop rules:** three reference trainings in a row without a checkpoint passing U2, S and R1, or three candidate trainings without one passing U2, S, R1 and R2. Then report to the owner (ledger, curves, CHECK lines, next proposal) and wait.
- **Names:** reference trainings t20 (seed 1) and t21 (seed 2); a reference lever takes the next name. The candidates take the next two free names, and the users' verification the one after.

## Review Focus

1. **The pitch's sign flipped**, which passes the bow and ends a lean back: `test_the_walking_upright_rule…` (−11° fires, +19.5° stays, +21° fires) and Task 1's posed east duck.
2. **The rule drifting between training and judging**: both call `rewards.is_upright`, and `test_one_rule_trains_and_judges` runs it on torch and numpy.
3. **The body sensor watching the feet** (every step "down") **or missing a shin**: `test_down_reads_the_head_the_neck_and_a_body_on_the_course`, plus Task 4's probe (the walker warm start should almost never go down).
4. **The judge's contacts disagreeing with the physics**: Task 2 Step 4's lines against the prototype and the force-based probe (t17-250 feet only 22–23 %, slide 57–60 %).
5. **The walker left in the shipped recipe, or the users' knobs left at the owner's values**: Task 8's removal, and `test_the_recipe_users_get_lets_the_duck_go_down`.

---

### Task 1: One walking-upright rule, trained and judged

**Files:** Modify `src/microduck_challenges/tug_of_war/rewards.py`, `env.py`, `check.py`, `challenge.toml` (the knob's comment), `tests/test_tug_of_war.py`.

**Verified for this task (planner, 2026-10-22):**
- The training entity (`robot/…`) and the Arena's duck have the same body and joint names. The head is body `jaw_soft`, at the end of the chain trunk_base → neck (`neck_pitch`) → neck_pitch (`head_pitch`) → yaw_roll_motion (`head_yaw`) → jaw_soft (`head_roll`).
- The colliding bodies are trunk_base, hip_l, leg, ankle_left, jaw_soft, hip_l_2, leg_2 and ankle_right. Only the feet's geoms are named (`left_foot_collision`, `right_foot_collision`), so the sensor matches bodies.
- STAND, the training's `default_joint_pos` (HOME): neck_pitch and head_pitch are both 0.3491 rad. The Arena's `DEFAULT_POSE` has 0.349066.
- The course is body `terrain` in training and `course` in the Arena: platforms, pit, ring ropes, posts and backstops.
- Today's `Down` reads `root_link_pos_w[:, 2]` and `projected_gravity_b[:, 2]`. mjlab's entity data has `body_com_pos_w` (xipos), `joint_pos` and `default_joint_pos`. The termination manager resolves a `SceneEntityCfg` param's `body_ids` and `joint_ids` (`manager_base._resolve_common_term_cfg`). `ContactMatch.exclude` drops exact local names (`contact_sensor._resolve_primary_names`).

**Interfaces:**
- Produces in `rewards.py`:
  - the Pinned constants;
  - `is_upright(z, gravity_b, head_z, neck_dev)`, a bool mask over the leading dims for numpy arrays or torch tensors alike, using only comparisons, `abs` and `.all(-1)`: `z >= UPRIGHT_Z_M`, `sin(-10°) <= -gravity_b[..., 0] <= sin(20°)`, `abs(gravity_b[..., 1]) <= sin(10°)`, `head_z >= UPRIGHT_HEAD_Z_M`, `(abs(neck_dev) <= radians(30)).all(-1)`;
  - `class Down(ArenaFall)` with `__call__(env, sensor_name: str, hold_steps: int, asset_cfg: SceneEntityCfg) -> torch.Tensor`. It fires when the learner has not been upright (`is_upright` on root z, projected gravity, `body_com_pos_w[:, body_ids[0], 2]` and `joint_pos − default_joint_pos` at `joint_ids`, and no `found` on `env.scene[sensor_name]`) for `hold_steps` straight steps.
- Produces in `env.py`: `BODY_GROUND`, the sensor and the `down` termination with `stay_upright > 0` (Pinned). D22 is rewritten (Step 3).
- Produces in `check.py`:
  - `posture(outcome, side, model) -> str` = `"upright {u:.0f} % · longest out {s:.2f} s · feet only {f:.0f} %"` (Task 2 appends the gait), over A's frames counted as today (trunk more than `PIT_M/2 + LIP_M` from the centre line). With none counted it reads `upright 100 % · longest out 0.00 s · feet only 100 %`.
  - Each frame: both ducks' qpos from `outcome.trace` (free joint `[:7]`, `JOINT_NAMES` `[7:]`), the string left at qpos0, then `mujoco.mj_fwdPosition`. The head height is `xipos[<prefix>jaw_soft]`'s z. `gravity_b` = −R[2,:] off the trace quaternion. `neck_dev` = the `NECK` joints − `DEFAULT_POSE`. "Feet only" means no A geom outside `FEET`'s bodies is in contact with a geom of body `course`. Upright = `is_upright(...)` and feet only.
  - `play(manifest, model, a, b, bouts)`; `summary(results, model)`. `main` compiles `compile_tug(manifest)` once and passes it to `run_bout(…, model=model)` and to `summary`. `upright()` is gone.

- [ ] **Step 1: Failing tests.** Replace `_posed_env`, `test_the_upright_rule_lets_a_puller_lean_and_ends_a_sitting_duck`, `test_a_down_count_restarts_on_a_reset`, `test_stay_upright_ends_a_down_duck_and_costs_its_pits` and `test_a_bout_line_says_how_long_a_was_down` with:

```python
# Postures the posture probe measured (2026-10-22, pull-phase medians): trunk z m, pitch ° (+ the trunk's top leaning away
# from the opponent), roll °, head COM z m, neck_pitch and head_pitch off STAND °.
WALKER_BACK = (0.120, -1.0, 2.0, 0.236, 8.0, -1.0)     # BEST_alpha_walking backwards at -0.40
WALKER_STILL = (0.116, 2.0, 2.0, 0.234, 1.0, -1.0)     # it, at the tug's -0.30: it stands
LEANING = (0.101, 19.5, -9.5, 0.181, 29.5, -29.5)      # a puller leaning back, inside every edge
T17_250 = (0.072, -38.0, -11.0, 0.063, -69.0, -6.0)    # bowed, the head on the floor
T15_250 = (0.084, -33.0, 9.0, 0.064, -85.0, -10.0)
T19_250 = (0.071, -44.0, 12.0, 0.063, -50.0, 12.0)
OUT_BY_ONE = [(0.095, -1.0, 2.0, 0.236, 8.0, -1.0), (0.120, -11.0, 2.0, 0.236, 8.0, -1.0), (0.120, 21.0, 2.0, 0.236, 8.0, -1.0),
              (0.120, -1.0, 11.0, 0.236, 8.0, -1.0), (0.120, -1.0, -11.0, 0.236, 8.0, -1.0), (0.120, -1.0, 2.0, 0.175, 8.0, -1.0),
              (0.120, -1.0, 2.0, 0.236, -31.0, -1.0), (0.120, -1.0, 2.0, 0.236, 8.0, 31.0)]
ENTITY = SimpleNamespace(name="robot", body_ids=[0], joint_ids=[0, 1])


def _posed_env(z, pitch_deg, roll_deg, head_z, dneck_deg, dhead_deg, touching=False):
    """One env as the probe measured it: projected gravity (-sin pitch, -sin roll, -√(1 - both²)), the head's COM at
    head_z (body 0), neck_pitch and head_pitch off STAND (0.3491) by these, the body sensor's 13 slots touching or not."""


@pytest.mark.parametrize("pose, touching, fires_at", [(WALKER_BACK, False, None), (WALKER_STILL, False, None), (LEANING, False, None),
    (T17_250, False, 15), (T15_250, False, 15), (T19_250, False, 15), (WALKER_BACK, True, 15),
    *[(pose, False, 15) for pose in OUT_BY_ONE]])
def test_the_walking_upright_rule_keeps_the_walker_and_ends_the_bow(pose, touching, fires_at):
    """The walker walks or stands inside every band, a puller may lean back to 20°; the bowed pullers, a shin on the floor
    and each band crossed alone go down on the 15th straight step."""
    env = _posed_env(*pose, touching=touching)
    term = rewards.Down(None, env)
    fired = [bool(term(env, tug.BODY_GROUND, 15, ENTITY)[0]) for _ in range(20)]
    assert (fired.index(True) + 1 if any(fired) else None) == fires_at


def test_one_rule_trains_and_judges():
    """check.py and Down call one predicate: numpy and torch give the same mask."""
    poses = np.array([WALKER_BACK, WALKER_STILL, LEANING, T17_250, T15_250, T19_250, *OUT_BY_ONE])
    # z, gravity_b, head_z, neck_dev built from the columns as _posed_env does
    assert numpy_mask.tolist() == torch_mask.tolist() == [True] * 3 + [False] * (3 + len(OUT_BY_ONE))


def test_a_down_count_restarts_on_a_reset():   # T17_250 for 14 steps, reset(env 0), then one step: not down


def test_stay_upright_ends_a_down_duck_and_costs_its_pits():
    cfg = _cfg_with_knobs(stay_upright=1.0)
    down = cfg.terminations["down"]
    assert down.func is rewards.Down and (down.params["sensor_name"], down.params["hold_steps"]) == ("body_ground_contact", 15)
    entity = down.params["asset_cfg"]
    assert (entity.name, tuple(entity.body_names), tuple(entity.joint_names)) == ("robot", ("jaw_soft",), ("neck_pitch", "head_pitch"))
    sensor = {s.name: s for s in cfg.scene.sensors}["body_ground_contact"]
    assert (sensor.primary.mode, sensor.primary.pattern, sensor.primary.entity, tuple(sensor.primary.exclude)) == ("body", ".*", "robot", ("ankle_left", "ankle_right"))
    assert (sensor.secondary.mode, sensor.secondary.pattern, tuple(sensor.fields)) == ("body", "terrain", ("found",))
    # the rewards as today: down -50 {"terms": ("down",)}, out {"terms": ("in_pit",)}, "fell" absent
    off = _cfg_with_knobs(stay_upright=0.0)
    assert "body_ground_contact" not in {s.name for s in off.scene.sensors} and "down" not in off.terminations
    # off: "down" not in off.rewards, out {"terms": ("in_pit", "fell")}; stay_upright 2.0: down weight -100.0


@pytest.fixture(scope="module")
def upright_live():
    """The owner's training env (stay upright 1.0), 2 envs; Task 3 names its opponent."""


def test_down_reads_the_head_the_neck_and_a_body_on_the_course(upright_live):
    entity = upright_live.termination_manager.get_term_cfg("down").params["asset_cfg"]
    robot = upright_live.scene["robot"]
    assert [robot.body_names[i] for i in entity.body_ids] == ["jaw_soft"]
    assert [robot.joint_names[i] for i in entity.joint_ids] == ["neck_pitch", "head_pitch"]
    upright_live.reset()
    upright_live.step(torch.zeros(2, 14))
    assert ((robot.data.body_com_pos_w[:, entity.body_ids[0], 2] - 0.237).abs() <= 0.015).all()   # STAND: 23.7 cm (probe)
    sensor = upright_live.scene["body_ground_contact"]
    assert not sensor.data.found.any()                                  # on its feet: the feet are not watched
    pose = robot.data.root_link_pose_w.clone()
    pose[1, 2] = 0.03                                                   # env 1's trunk sunk into the platform
    robot.write_root_link_pose_to_sim(pose)
    upright_live.sim.forward()
    upright_live.step(torch.zeros(2, 14))
    assert sensor.data.found.any(dim=-1).tolist() == [False, True]
```
  - `check.py`, with `_posed_bout(frames, side, x=0.6)`: both ducks at ±x, standing at STAND and facing each other. A's frames are posed from `dict(z, pitch_deg, roll_deg, dneck_deg, dhead_deg)`: the quaternion is yaw (0 west, 180° east), then the pitch (a nose-up rotation is +), then the roll, in the trunk's frame. A's joints are STAND, but neck_pitch and head_pitch.

```python
WALK = dict(z=0.12, pitch_deg=-1.0, roll_deg=2.0, dneck_deg=8.0, dhead_deg=-1.0)       # the walker backwards
BOW = dict(z=0.072, pitch_deg=-38.0, roll_deg=-11.0, dneck_deg=-69.0, dhead_deg=-6.0)  # t17-250

def test_a_bout_line_says_how_a_walked(arena_model):
    from microduck_challenges.tug_of_war import check
    for side in ("west", "east"):
        assert check.posture(_posed_bout([WALK] * 50, side), side, arena_model) == "upright 100 % · longest out 0.00 s · feet only 100 %"
    assert check.posture(_posed_bout([BOW] * 50, "west"), "west", arena_model).startswith("upright 0 % · longest out 1.00 s · ")
    dipped = _posed_bout([WALK] * 20 + [BOW] * 15 + [WALK] * 15, "west")
    assert check.posture(dipped, "west", arena_model).startswith("upright 70 % · longest out 0.30 s · ")
    assert check.posture(_posed_bout([dict(WALK, z=0.02)] * 50, "west"), "west", arena_model).endswith(" · feet only 0 %")
    assert check.posture(_posed_bout([BOW] * 50, "west", x=0.20), "west", arena_model) == "upright 100 % · longest out 0.00 s · feet only 100 %"   # at the lip: left out
```
  - `_bout` and `_pulled_by_a_step_back` trace standing ducks (identity and yaw-180 quaternions, STAND), not zeros. `test_the_summary_counts_who_lost_and_how` calls `check.summary(results, arena_model)`; its assertions are unchanged.
- [ ] **Step 2:** TESTS → the new tests fail (a missing name, the old params).
- [ ] **Step 3: Implement** to the Interfaces.
  - **`env.py` docstring.** D22 says:
    - 0, what users get, lets a duck crouch, sit, lie or plant its head, as the Arena allows, and keeps D9's fall.
    - Above 0, `down` replaces `fell`. The learner out of the walking-upright bands, or any body but its feet on the course, for `FALL_HOLD_S` ends the training episode and costs that many pits.
    - The bands are the walker's envelope with margin: BEST_alpha_walking over six runs held the trunk at 11.0–12.4 cm, pitch −2.7..+2.1°, roll ≤ 4.7°, head 22.6–24.1 cm, neck −4.7..+11°, head pitch −8.3..+5°, only the feet down. The 20° of leaning back is sized for a ~2.5 N string held at the 15 cm tie, a physics estimate.
    - The bow it ends (t15-250, t17-250 and t19-250, probe 2026-10-22): trunk 7–8 cm, pitched 33–44° towards the opponent, neck 50–85° down, head on the floor in 77–83 % of frames.
    - Why the sensor: posed at random within every band, a shin touched the floor in 2.2 % of 200,000 poses, the trunk at 10.0–11.1 cm with a foot down.
    - The owner's ducks train with it on (owner, 2026-10-22); `check.py` reads the same rule.
    - Line 573's comment ("the training's fall termination (ArenaFall, below) is the hard line") names `down` too.
  - **`challenge.toml`'s comment:**

```toml
# 0 lets the duck crouch, sit, lie or plant its head as the Arena allows; above 0 it must
# walk upright: trunk 10 cm up or more, pitched 10° forward to 20° back, rolled 10° at most,
# its head 18 cm up or more, neck and head within 30° of standing, only its feet on the
# course. Out of that for 0.3 s ends the training episode and costs that many pits.
```
  - **`check.py`'s docstring:** each line says how A pulled and how it walked.
- [ ] **Step 4:** TESTS → green.
- [ ] **Step 5: Commit:** "The Tug of War's stay upright means walking upright, as the robot walks: head high, trunk up, pitched 10° forward to 20° back, only the feet on the course; check.py judges the same rule".

### Task 2: Stepping, judged

**Files:** Modify `tug_of_war/check.py`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Produces `gait(contact: np.ndarray, feet: np.ndarray, counted: np.ndarray) -> str`, where `contact` is (n, 2) bool (left, right), `feet` is (n, 2, 3) (sites `left_foot`, `right_foot`) and `counted` is (n,) bool. It returns `"standing still"` when the horizontal foot travel is under `STILL_CM_S`; otherwise `"{steps:.1f} steps/s · slide {slide:.0f} %"`.
  - It reads only pairs of consecutive frames both counted.
  - A clear step is a frame in contact after ≥ `STEP_AIR_FRAMES` frames out of contact, during which the foot's site rose ≥ `STEP_LIFT_M` above its height on its last frame in contact. A foot starting in the air has no clear first step.
  - `steps` = both feet's clear steps / (counted frames × `CTRL_DT`).
  - `slide` = 100 × the horizontal site travel between two frames both in contact / all the horizontal site travel, both feet.
  - These are the definitions of `posture_probe.gait`.
- `posture` appends `· {gait(...)}`; a foot's contact is its body (`ankle_left`, `ankle_right`) touching a `course` geom in the recomputed collisions.

- [ ] **Step 1: Failing tests:**

```python
def _feet(n=100, period=20, lag=10):
    """(contact, feet): each foot on the floor period/2 frames then in the air as long, the right one `lag` frames behind;
    in the air a foot is 1 cm up and moves 3 mm back a frame, on the floor it stays still."""


def test_gait_counts_clear_steps_and_the_slide():
    from microduck_challenges.tug_of_war import check
    contact, feet = _feet()
    every = np.ones(100, dtype=bool)
    assert check.gait(contact, feet, every) == "4.0 steps/s · slide 0 %"   # left lands at 20, 40, 60, 80; right at 30, 50, 70, 90
    assert check.gait(contact, feet, np.arange(100) < 50) == "3.0 steps/s · slide 0 %"   # 20, 40 and 30 in the counted second
    dragged = np.zeros((100, 2, 3))
    dragged[:, :, 0] = -0.001 * np.arange(100)[:, None]                   # both feet down, slid 1 mm a frame
    assert check.gait(np.ones((100, 2), dtype=bool), dragged, every) == "0.0 steps/s · slide 100 %"
    chatter = np.ones((100, 2), dtype=bool)
    chatter[10::10, 0] = False                                            # the left foot off one frame in ten
    lifted = dragged.copy()
    lifted[10::10, 0, 2] = 0.001                                          # 1 mm up: no clear step
    assert check.gait(chatter, lifted, every) == "0.0 steps/s · slide 91 %"   # 180 of 198 moves in contact
    assert check.gait(np.ones((100, 2), dtype=bool), np.zeros((100, 2, 3)), every) == "standing still"
```
  - Task 1's posture asserts gain `· standing still` (posed ducks never move); its `endswith(" · feet only 0 %")` becomes `" · feet only 0 % · standing still"`.
  - `test_the_check_plays_the_reference_by_default` (the walker as A): each bout line contains `upright 100 % · longest out 0.00 s · feet only 100 % · ` and `steps/s`.
- [ ] **Step 2:** TESTS → they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** TESTS → green. Then on the Mac, in the foreground, `CHECK ONNX/t17-250.onnx --bouts 2` and `CHECK ARENA/arena/assets/policies/BEST_alpha_walking.onnx --bouts 2`. The prototype (`SCRATCH/i-plan/posture_prototype.py`) printed these, bout by bout:
  - t17-250: `upright 0 % · longest out 14.20 s · feet only 23 % · 4.7 steps/s · slide 57 %` and `upright 0 % · longest out 15.74 s · feet only 22 % · 4.6 steps/s · slide 60 %`;
  - the walker: `upright 100 % · longest out 0.00 s · feet only 100 % · 3.8 steps/s · slide 8 %` and `… 3.5 steps/s · slide 8 %`.

  The force-based probe measured t17-250 at 22–23 % feet only, 4.7 clear steps/s and 58–60 % slide. A difference of more than 1 % or 0.1 steps/s from the prototype means a definition differs: reconcile with the prototype before committing.
- [ ] **Step 5: Commit:** "check.py reads how the duck stepped: clear touch-downs a second and the share of foot travel slid in contact, standing still under 1 cm/s".

### Task 3: The walker, vendored, as a warm start and as an opponent

**Files:**
- Create `src/microduck_challenges/tug_of_war/walker.onnx`, a copy of `ARENA/arena/assets/policies/BEST_alpha_walking.onnx`.
- Modify `.gitignore` (`!src/microduck_challenges/tug_of_war/walker.onnx` under the reference's line), `tug_of_war/opponent.py`, `tests/test_tug_of_war.py`.

**Verified for this task (planner):**
- `opponent.load_actor` reads the walker: the same 9-node graph as the reference's (pytorch 2.9.1, opset 18, input `obs`, output `actions`), at most 7.2e-7 from onnxruntime.
- Its normalizer std is at least 0.0129, above rsl_rl's eps 0.01.
- The tug's commands sit inside its statistics:
  - vx −0.30, against a mean of 0.044 and a std of 0.214;
  - head commands, against a std of 0.14–0.60;
  - body commands, against stds of 0.0129 and 0.0389 (as t15-250's).
- `train … --help` lists `--env.actions.opponent.command` and `--agent.actor.class-name` (`SCRATCH/i-plan/train-help.txt`). `mjlab_microduck.provenance.record_run_start` records the full argv as the run's command, so a model card's Reproduce carries any override.

**Interfaces:**
- `WALKER` (Pinned).
- `ReferenceActor` gains the class attribute `onnx: Path = REFERENCE` and loads `load_actor(self.onnx)`; its count stays `REFERENCE_SEEN`.
- `class WalkerActor(ReferenceActor): onnx = WALKER`. Its docstring says three things:
  - It starts as BEST_alpha_walking, the Arena's golden walker and the only policy found walking backwards: it stands still for |vx| ≤ 0.2 and at the tug's −0.30, and walks back at −0.40.
  - Its normalizer count is the reference's. Its own is unknown; what matters is that PPO's first update does not replace its statistics with one batch's, and that is the inertia t15–t17 warm-started with.
  - Its noise std is `WARM_START_STD`.
- `OpponentActionCfg.onnx: str = "reference.onnx"`; `OpponentAction` loads `load_actor(Path(__file__).with_name(cfg.onnx))`. The module docstring: the opponent is the reference duck unless a training names another file beside it (`--env.actions.opponent.onnx`).

- [ ] **Step 1: Failing tests.**
  - `test_the_reference_ships_with_the_challenge` is parametrized over `(opponent.REFERENCE, EVENT.rating.reference)` and `(opponent.WALKER, "BEST_alpha_walking.onnx")`: the bytes equal the Arena's file, and the path is listed by `git ls-files -co --exclude-standard`.
  - `test_the_opponent_net_is_its_onnx` is parametrized over `REFERENCE` and `WALKER`.
  - `test_the_learner_starts_as_the_reference_duck` is parametrized over `("…opponent:ReferenceActor", REFERENCE)` and `("…opponent:WalkerActor", WALKER)`. The same assertions hold: outputs at 1e-5, std 0.3, and the statistics holding at 1e-2 after one batch. It keeps `resolve_callable(tug.RL_CFG.actor.class_name) is opponent.ReferenceActor`.
  - The `upright_live` fixture sets `cfg.actions["opponent"].onnx = "walker.onnx"` (the reference training's env). Add:

```python
def test_a_training_can_name_its_opponent(upright_live):
    """The reference's training plays the frozen walker (--env.actions.opponent.onnx walker.onnx); the recipe plays the reference."""
    assert tug.make_env_cfg().actions["opponent"].onnx == "reference.onnx"
    net = upright_live.action_manager.get_term("opponent").policy
    # observations as the walker's normalizer saw them (its mean + std × N(0, 1), 1000 rows): net(obs) equals onnxruntime on
    # opponent.WALKER at atol 1e-5
```
- [ ] **Step 2:** TESTS → they fail.
- [ ] **Step 3: Implement.** Copy the bytes: `cp ARENA/arena/assets/policies/BEST_alpha_walking.onnx <wt>/src/microduck_challenges/tug_of_war/walker.onnx`, run with `cd <wt> &&`.
- [ ] **Step 4:** TESTS → green. `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --help` lists `--env.actions.opponent.onnx STR` (default `reference.onnx`).
- [ ] **Step 5: Commit:** "The Tug of War can start as the walker and play it: walker.onnx is the Arena's golden walker, WalkerActor starts the learner as it, and a training names its opponent's ONNX".

### Task 4: The owner's recipe, end to end on the Mac and on warp

**Files:** `tug_of_war/challenge.toml` (the hypothesis commit); scratch `SCRATCH/i-probe.py`.

- [ ] **Step 1: The hypothesis commit.** `[params.stay_upright] value = 1.0`, `[params.pull_reward] value = 4.0`. TESTS: green but `test_the_recipe_users_get_lets_the_duck_go_down` (Global Constraints). The commit message is the hypothesis: "t20/t21: the reference trained walking upright, started as the walker and against it, Win ground 4.0 as t15 and t17 — a duck that already walks backwards upright, ended at 0.3 s out of the bands for a pit's cost, should learn to load the string without bowing onto its head". Ledger rows `t20` and `t21` (commit, seed, hypothesis, the two CLI overrides).
- [ ] **Step 2: Smoke:**
  - Run `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --gpu-ids None --env.scene.num-envs 2 --agent.max-iterations 2 --agent.save-interval 1 --agent.logger tensorboard --agent.run-name smoke --agent.actor.class-name microduck_challenges.tug_of_war.opponent:WalkerActor --env.actions.opponent.onnx walker.onnx`.
  - It writes `logs/rsl_rl/tug_of_war/<stamp>_smoke/model_1.pt`, and that run's `provenance.json` `command` lists both overrides.
- [ ] **Step 3: Export and score** as Plan H Task 4 Step 3. `arena score` prints five bout lines and a rating. Remove the smoke run and `publish-eval/`.
- [ ] **Step 4: The warp probe.** Write `SCRATCH/i-probe.py`, a copy of `SCRATCH/h-probe.py` with these changes:
  - `cfg = tug.make_env_cfg()` (the committed toml, now 1.0), then `cfg.actions["opponent"].onnx = "walker.onnx"`;
  - the learner driven by `load_actor(opponent.WALKER)`; 64 envs, 300 steps;
  - besides its numbers, each step's share of learner worlds upright: `rewards.is_upright` on the entity data, and no `found` on `body_ground_contact`.

  Run `cd <wt> && uv run --no-config --no-sync python SCRATCH/i-probe.py` in the foreground. Expected:
  - `nan_state` and `opponent_nan_state` 0;
  - contacts ≤ 200 a world and rows ≤ 1500 (Plan H: 39 and 190);
  - `down` near 0 and upright near 100 %: the walker in Arena bouts is 100 % upright, its longest stretch out 0.00 s.

  A NaN stops the plan. Many `down`s mean the walker warm start falls under the string's pull, or the rule misreads it: report both shares before Task 5.
- [ ] **Step 5: Preflight:** Task 5 Step 1's t20 command with `--dry-run` in place of `--detach`. The tarball lists `walker.onnx`, `reference.onnx`, `env.py`, `rewards.py`, `opponent.py` and `challenge.toml`.
- [ ] **Step 6:** report the probe's numbers to the controller; ledger: "walking-upright probe".

### Task 5: The walking-upright reference: t20 and t21

**Files:** none tracked unless a lever needs one; the ledger, ONNX.

- [ ] **Step 1: Launch** both on Task 4 Step 1's commit, a clean tree:
  - t20: `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 1000 --agent.seed 1 --agent.logger tensorboard --agent.run-name t20 --agent.actor.class-name microduck_challenges.tug_of_war.opponent:WalkerActor --env.actions.opponent.onnx walker.onnx --hf-jobs --detach --no-wandb --namespace Nico-robot --ckpt-repo Nico-robot/mjlab-tugofwar-microduck-t20`.
  - t21: the same with `--agent.seed 2`, `--agent.run-name t21` and `--ckpt-repo Nico-robot/mjlab-tugofwar-microduck-t21`.

  `[job] id: <id>` goes into the ledger. For RUNNING and errors, follow Plan F Task 7 Step 3.
- [ ] **Step 2: The controller waits** for each checkpoint (Monitor on the repo's `.pt` list), then runs `hf download Nico-robot/mjlab-tugofwar-microduck-t<k> --local-dir logs/rsl_rl`. Judged: 250, 500, 750, 1000.
- [ ] **Step 3: Judge each** (a subagent per batch, the full `cd <wt> && uv run --no-config --no-sync …` line in every prompt), all into the ledger:
  - export to `ONNX/t<k>-<N>.onnx`;
  - `arena score` (the rating against t15-250);
  - `CHECK ONNX/t<k>-<N>.onnx <wt>/src/microduck_challenges/tug_of_war/walker.onnx --bouts 10`, for U2, S and R1;
  - `CHECK ONNX/t<k>-<N>.onnx --bouts 10`, against t15-250, for information;
  - the curves: `Train/mean_episode_length`, `Episode_Termination/{in_pit,opponent_in_pit,down,nan_state,opponent_nan_state}`, `Episode_Reward/{marker_ground,win,out,down,track_linear_velocity,air_time,foot_slip,head_pose_tracking,upright}`.

  A gate missed: run `SCRATCH/posture_probe.py`'s per-second table on bout 1 for the diagnosis (scratch only).
- [ ] **Step 4: Verdicts:** U2, S and R1 per checkpoint; the rating and the information line beside them.
- [ ] **Step 5: Pick** by Global Constraints' reference judge. The ledger records the pick and why, with its U2/S numbers in both directions and the frames from a bout against t15-250 (a render, as Plan H's posture check).
  - If no checkpoint passes: ONE lever, aimed at the first gate missed, its hypothesis in the commit, `t<n>` launched as Step 1 (same overrides) and judged as Steps 2–4. The stop rule counts t20, t21 and the lever runs.

**Levers, in order:**
1. Another checkpoint, then a seed.
2. R1 missed: Win ground 5.0, the knob's top (4.0 is already in).
3. S missed: `foot_slip`'s weight −0.1 → −10.0 (env.py:585; mjlab's `feet_slip`, Σ of the feet's squared speed in contact). A pair sliding at the bowed pullers' 8.6 cm/s then costs about 0.15 a step (0.58 at their p90 17 cm/s), the walker's 1.3 cm/s about 0.003, against `air_time`'s up to 2.0 and walking back's up to 3.0.
4. U2 missed: `stay_upright` 2.0.

### Task 6: The new reference handed over (both repos, one sitting)

**Files:**
- Arena: Create `arena/assets/policies/tug-reference-<run>-<N>.onnx` (LFS). Delete `arena/assets/policies/tug-reference-t15-250.onnx`. Modify `arena/assets/PROVENANCE.md`, `arena/events/tug-of-war.toml`, `docs/guides/challenges/tug-of-war.md`, `docs/superpowers/plans/2026-10-19-versus-interfaces.md` (line 215), `tests/test_assets.py`, `tests/test_manifest.py` (lines 496, 509, 522).
- Challenges: Modify `tug_of_war/reference.onnx` (the pick's bytes) and `tug_of_war/opponent.py` (the module docstring's and `REFERENCE`'s comments, `REFERENCE_SEEN`, `WARM_START_STD`'s comment).

**Interfaces:** Consumes Task 5's pick: `ONNX/<run>-<N>.onnx`, its sha256, its repo, the recipe commit, the command's two overrides, and the date.

- [ ] **Step 1: Arena, red first:** `test_the_tug_reference_duck_is_<run>_<N>_byte_for_byte` replaces the t15-250 one (the new name, `REFERENCE_SHA256` = the pick's sha). Then `PYTEST tests/test_assets.py` → FAIL.
- [ ] **Step 2: Arena:**
  - `cp` the pick into `arena/assets/policies/tug-reference-<run>-<N>.onnx` and `GIT rm` the t15-250 file.
  - Set the toml's `[rating] reference`, and the new name in `test_manifest.py`'s three lines and in the contract.
  - `PROVENANCE.md`'s reference table:
    - its rows: repo and checkpoint, the recipe commit, the command's `--agent.actor.class-name …WalkerActor --env.actions.opponent.onnx walker.onnx`, sha256, date;
    - "It walks backwards upright …" with only facts the ledger measured: its U2 and S numbers, and against the walker and t15-250 who went in the pit and when;
    - the history line: "trained walking upright on the ring and the string (stay upright 1.0, Win ground 4.0), warm-started from BEST_alpha_walking and against it, frozen; replaces t15-250, which pulled bowed onto its head (owner, 2026-10-22): every rating changed".
  - The guide's "## Rating" sentence on the reference says the same measured facts.
- [ ] **Step 3:** `rtk proxy grep -rnI "t15-250\|t15_250" arena tests app/src docs/guides` prints only PROVENANCE's history line. Run SUITE: tests that rated against the reference by value are re-measured, never loosened.
- [ ] **Step 4: Challenges, red first:** TESTS → `test_the_reference_ships_with_the_challenge[reference]` fails.
- [ ] **Step 5: Challenges:**
  - `cp ONNX/<run>-<N>.onnx <wt>/src/microduck_challenges/tug_of_war/reference.onnx`.
  - The docstring and `REFERENCE`'s comment name `<run>-<N>`, trained walking upright (Plan I).
  - `REFERENCE_SEEN` = the actor normalizer's `count` read from `<run>`'s `model_<N>.pt`: about (502 + N + 1) × 24 × 4096, t15-250's count given to the walker it started as, then its own N + 1 rollouts. Its comment says so.
  - `WARM_START_STD` stays 0.3 unless the pick's own action std at `<N>` is above it; the comment gives that std.
  - TESTS: green but the users' test. If `load_actor` refuses the file, it came from another exporter: stop and report.
- [ ] **Step 6: Commits.**
  - Arena: "The Tug of War's reference duck walks upright, as the robot walks: <run>-<N>, trained from the walker against it, replaces t15-250 and every rating with it". `GIT lfs ls-files` lists the new file.
  - Challenges: "The Tug of War trains against the Arena's new reference, <run>-<N>, walking upright, and starts as it".
- [ ] **Step 7: Re-rate** Plan G Task 8 Steps 2–3's stand-ins into `SCRATCH/i-store`, plus `ONNX/t15-250.onnx`, `ONNX/t17-250.onnx` and `ONNX/t19-250.onnx`: the planters against the upright reference, decision 2's consequence. Look at bob's run page. Report the ratings.

### Task 7: The owner's candidate, walking upright

**Files:** none tracked unless a lever needs one; the ledger, ONNX.

**Interfaces:** Consumes Task 6 (`reference.onnx` = the new reference; the Arena rates against it). The candidate starts as the new reference (`ReferenceActor`, the default) and plays it (the default opponent): a duck that already pulls upright, where the walker never pulled. No CLI override. The knobs are still 1.0 and 4.0.

- [ ] **Step 1:** TESTS (green but the users' test), a clean tree. Ledger rows for the next two names, `<a>` (seed 1) and `<b>` (seed 2): HEAD, and "walking upright, warm-started from <run>-<N> and against it".
- [ ] **Step 2: Launch:**
  - `<a>`: `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 1000 --agent.seed 1 --agent.logger tensorboard --agent.run-name <a> --hf-jobs --detach --no-wandb --namespace Nico-robot --ckpt-repo Nico-robot/mjlab-tugofwar-microduck-<a>`.
  - `<b>`: the same with seed 2.
- [ ] **Step 3: Judge** as Task 5 Steps 2–3, now against the new reference: `arena score` (R2) and `CHECK ONNX/<run>-<N>.onnx --bouts 10` (B the default: U2, S, R1, R3). Nothing is played against t15-250 or the walker.
- [ ] **Step 4: Verdicts:** U2, S, R1, R2, R3 per checkpoint.
- [ ] **Step 5: Pick.**
  - Among the checkpoints passing U2, S, R1 and R2, take the highest rating, with a round robin between ratings within 5.0 cm. In the round robin each duck is A in 20 bouts; U2 and S must hold over those bouts too.
  - If none passes R2: the best passing U2, S and R1. Never one failing U2.
  - If none passes U2, S, R1 and R2: ONE lever, as Task 5 Step 5; the stop rule counts `<a>`, `<b>` and the lever runs.
  - The ledger records the candidate.

**Levers, in order:**
1. Another checkpoint, then a seed.
2. R2 missed: Win ground 5.0 and `win` 100.
3. S missed: `foot_slip` −10.0.
4. U2 missed: `stay_upright` 2.0.

### Task 8: The recipe users get, verified; the walker out; the guide; the hand-over

**Files:** Modify `tug_of_war/challenge.toml`, `tug_of_war/env.py` (only if a lever changed it), `tug_of_war/opponent.py`, `.gitignore`, `tug_of_war/AGENTS.md`, `tests/test_tug_of_war.py`. Delete `tug_of_war/walker.onnx`. Untracked: `<wt>/publish-tug-of-war/`.

- [ ] **Step 1:** TESTS → red on `test_the_recipe_users_get_lets_the_duck_go_down` alone (the toml says 1.0 and 4.0).
- [ ] **Step 2: The users' recipe, and the walker out.**
  - Set `stay_upright` 0.0 and `pull_reward` 2.0, and put every lever a training of this plan committed back to the users' value.
  - Delete `WalkerActor`, `WALKER`, `walker.onnx`, its `.gitignore` line, `OpponentActionCfg.onnx`, and the module docstring's sentence about naming another file. `OpponentAction` loads `REFERENCE` again, and `ReferenceActor` its `REFERENCE` without the class attribute.
  - Delete the walker's test parameters and `test_a_training_can_name_its_opponent`; `upright_live` plays the reference.
  - The reference's training commit and command, in PROVENANCE and the ledger, keep the walker.
  - TESTS → green.
- [ ] **Step 3: Commit, then verify the users' recipe.** Commit: "The Tug of War's recipe is the users' again: stay upright off, Win ground 2.0, warm-started from and against the walking-upright reference; the walker that started the reference is no longer needed". Then:
  - launch the next name, seed 1, as Task 7 Step 2 (no override), on this commit;
  - judge at 250 as Task 7 Step 3: R1 and R2 against the new reference, as t19 verified the last one; U2 and S are information;
  - if 250 fails R1 or R2, judge 500; if both fail, report to the controller (the users' recipe is the owner's to change).
- [ ] **Step 4: The guide and the test's comment, from the ledger** (measured facts only).
  - `test_the_recipe_users_get_lets_the_duck_go_down`'s comment names the verification run and its rating against `<run>-<N>`.
  - `AGENTS.md`, on its outline:
    - the challenge: the reference `<run>-<N>` walks upright;
    - the recipe: what stay upright means now and why the owner's ducks use it; the reference trained from the walker, with its training commit and command;
    - files: `rewards.py`'s rule constants;
    - judging: a real CHECK line as the example, `upright`, `longest out`, `feet only`, `steps/s`, `slide`, and the gates U2, S, R1–R3;
    - "What is known" (2026-10-22):
      - the probe: t15/t17/t19 bowed onto their heads (the head on the floor in 77–83 % of frames, about half the backward friction, the feet sliding 58–73 %);
      - the walker's own numbers: 100 % upright, 3.5–3.8 steps/s, slide 7–9 % in a bout;
      - the shin finding;
      - t20 onwards: ratings, gates, levers, picks;
      - the planters' ratings against the new reference (Task 6 Step 7);
      - the users' verification.

  TESTS green; commit: "The Tug of War's guide teaches walking upright and stepping, and what training the owner's ducks upright measured".
- [ ] **Step 5: Export as the owner will publish** (Plan F Task 9 Steps 2–3 with the candidate's run and checkpoint). `publish-tug-of-war/manifest.json` names `tug-of-war`, and its Reproduce is the candidate's training commit and command. `arena score publish-tug-of-war/policy.onnx --event tug-of-war` equals the ledger's number.
- [ ] **Step 6: Hand over** Plan F Task 9 Step 5's command with the candidate's `<stamp>_<run>` and `<N>`, for after Plan D's release (`tug-of-war` merged without squash, relocked). It prints `[publish] entered on tug-of-war: a X.X cm rating → <page url>`.

---

## Self-review (amended spec)

- **Decision 1 (walking upright, the owner's ducks):**
  - Task 1: the rule, trained and judged, every band and the feet-only sensor.
  - Task 2: stepping judged.
  - Tasks 3–5: the reference from the walker, against it.
  - Task 6: the hand-over.
  - Task 7: the candidate.
- **Decision 2 (others free):** the knob stays off for users (Task 8's test); the Arena's rules are untouched (no Arena code but the vendored reference); the planters are re-rated as information (Task 6 Step 7).
- **Decision 3:** no physics or venue change anywhere.
- **The 2026-10-22 calls:**
  - the bands and the sign (Pinned, Task 1);
  - feet only kept (sensor, Task 1); stepping judged (Task 2); one rule (Task 1 replaces `Down`'s 7 cm / 45° and `check.upright`);
  - the walker's warm start, count and opponent (Task 3); the command unchanged (Task 5's commands); Win ground 4.0 (Task 4 Step 1);
  - the gates, the judge and the stop rule (Global Constraints, Tasks 5 and 7);
  - the judges' tool (Task 2); the hand-over and the users' re-verification (Tasks 6 and 8); the walker removed (Task 8).
- **Names used across tasks:**
  - `is_upright`, `Down(env, sensor_name, hold_steps, asset_cfg)`, `BODY_GROUND`, `HEAD`, `NECK`, `FEET`;
  - `posture(outcome, side, model)`, `gait(contact, feet, counted)`, `play(manifest, model, a, b, bouts)`, `summary(results, model)`;
  - `WALKER`, `WalkerActor`, `OpponentActionCfg.onnx`, `upright_live`.
