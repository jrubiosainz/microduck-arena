# Versus H — Upright Ducks on the Ring (training) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the `tug_of_war` recipe trains on the Arena's ring and physical string; an opt-in "stay upright" knob keeps a duck on its feet; a new upright reference is trained, handed to the Arena (Plan G Task 9) and becomes the recipe's opponent; the owner's upright candidate is trained against it and picked.

**Architecture:** `tug_scene` copies Plan G's ring (boxes in 2 m tiles, rope capsules in ≤ 2 m pieces) and string (the same 16-segment two-hinge chain, built by a copy of the Arena's builder, pinned field by field by parity tests); a reset event lays the string straight between the two ducks' actual tie points; the marker reads the string's middle site. The knob, a cost in pits, adds a `down` termination (trunk under 7 cm or tilted past 45° for 0.3 s) in place of the training-only fall. Trainings on HF Jobs, judged every 250 iterations on the Arena's physics with `arena score` and `check.py`.

**Tech Stack:** Python 3.12, mjlab 1.3.0 (mujoco_warp + warp 1.12), rsl_rl 5.0.1, onnx, onnxruntime (parity), mjlab_microduck (editable), the versus Arena (editable), HF Jobs l4x1, pytest.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md`, "Owner decisions, 2026-10-21" and its calls, §1–§3. **Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md` ("Plan B — cross-repo names" as Plan G Task 2 leaves it). **Plan G:** `docs/superpowers/plans/2026-10-21-versus-g-ring-and-rope.md`. **History:** Plan F (`…/2026-10-20-versus-f-opponent-training.md`) and its ledger `.superpowers/sdd/2026-10-20-versus-f-opponent-training/progress.md` (warm start wins; runs peak by 250–500 and decay by 1000; between close ratings the head-to-head decides). **Rope study:** `/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/e3798270-5a89-4af8-a12f-f9d4d292ea4f/scratchpad/rope/` (`warp_rope.py`, `rope-report.md` §5: the armature, nconmax, njmax, the reset).

## Global Constraints

- Plan F's Global Constraints apply unchanged: worktree `/Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war` (`<wt>`, always in full; HEAD 9f290e2 at the start), branch `tug-of-war`; `uv run --no-config --no-sync …`, never `uv sync`/`uv lock`; `/usr/bin/git`; **TESTS** `cd <wt> && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests` in the foreground with `timeout: 600000`, never waited on in the background; `env.py`, `rewards.py`, `tasks.py`, `opponent.py` never import `arena` (tests and `check.py` do); unsigned English commits, one per task, a training's commit message is its hypothesis, never rebase or squash; nothing pushed, `publish` only with `--dry-run`; HF Jobs under `--namespace Nico-robot` (owner's grant, no budget limit), l4x1, ≤ 3 in flight, always `--detach`, ckpt repos private; a subagent launches and returns, the controller waits (Monitor, never `sleep`); ledger `<wt>/logs/tug_of_war/ledger.md` continued; `arena score` and `check.py` on the Mac are indicative.
- **ONNX** = `<wt>/logs/tug_of_war/onnx`. **ARENA** = `/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`. **SCRATCH** = the session scratchpad's absolute path.
- **Order (cross-repo):** Task 1 starts once Plan G Task 4 is committed (`/usr/bin/git -C ARENA log --oneline -6` shows G2, G3, G4; else stop). TESTS is red on the parity tests from G2 until this plan's Task 2, by design; nothing trains before Task 4 is green. Tasks 1–4 in order; Task 5's trainings in the background while Plan G Tasks 5–8 run; Task 6 in one sitting with Plan G Task 9; Task 7 after both; Task 8 last.
- **Pinned (copies of Plan G's, each checked by a parity test):** `RING_M = 3.0`; `RING_ROPES_M = (0.06, 0.12, 0.18)`, `RING_ROPE_RADIUS_M = 0.006`, `RING_POST_RADIUS_M = 0.022`, `RING_POST_TOP_M = 0.23`; `STRING = "string/"`, `STRING_SEGMENTS = 16`, `STRING_RADIUS_M = 0.004`, `STRING_MASS_KG = 0.080`, `STRING_END_MASS_KG = 0.015`, `STRING_DAMPING = 0.003`, `STRING_ARMATURE = 1e-6`, `STRING_TIE_SOLREF = (0.01, 1.0)`, `STRING_FRICTION = (1.0, 0.005, 0.0001)`, `MIDDLE = 8`; `nconmax = 200` (the string peaks at 44 contacts a world), `njmax = 1500` (it peaks at 196 rows).
- **Pinned (this plan's):** `UPRIGHT_Z_M = 0.07`, `UPRIGHT_TILT_DEG = 45.0`, the hold `FALL_HOLD_S` (0.3 s, 15 steps); knob `[params.stay_upright]` label `"Stay upright"`, min 0.0, max 2.0, the cost of going down in pits (`down` weight `-50.0 × value`), value 0.0 in the recipe users get and 1.0 for every training of this plan (Task 5's commit sets it, Task 8 sets it back); the existing `[params.upright_reward]` is relabelled `"Keep the trunk level"`. Judges: `TAUT_M = 0.98`, `LIP_M = 0.08` (check.py leaves out the frames where A's trunk is within 8 cm of the pit's lip).
- **Gates** (check.py's 10 bouts against B = the recipe's reference, `arena score`'s rating, Plan F's 50 Hz trace of bout 1):
  - **U** (upright): in ≥ 9 of the 10 bouts, `longest down` < 0.30 s.
  - **R1**: `nan_state` < 0.01 in the curves; in ≥ 8 bouts the string is taut by 2.00 s, and in ≥ 8 A backed ≥ +2.0 cm by 2 s (signed: a negative value fails).
  - **R2** (candidates only): `rating:` ≥ +20.0 cm against the new reference.
  - **R3** (candidates, a target): ≥ 3 of the 10 bouts `B loses by pit`.
- **Stop rules:** three reference trainings in a row without a checkpoint passing U and R1, or three candidate trainings without one passing U, R1 and R2: report to the owner (ledger, curves, traces, next proposal) and wait.

## Review Focus

1. **The training's string is not the Arena's** (a mass, a joint axis, a tie, the root): `test_the_string_is_the_arenas` (Task 2).
2. **A reset leaves the string where the last episode put it, or between the nominal starts while the ducks moved**: `test_a_reset_lays_the_string_between_the_ducks` (Task 2).
3. **float32 NaN from the string on the L4** (armature dropped, a contact buffer full): the armature pinned by Task 2's parity, Task 4's probe, `nan_state` read at 250 (Task 5).
4. **The upright rule firing on a leaning puller, or missing a sitting one**: `test_the_upright_rule_lets_a_puller_lean_and_ends_a_sitting_duck` (Task 3).
5. **The knob left on in the recipe users get**: `test_the_recipe_users_get_lets_the_duck_go_down` (Task 8).

---

### Task 1: The ring in the training scene

**Files:** Modify `src/microduck_challenges/tug_of_war/env.py`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Consumes: Plan G Task 2's `arena.course.ring_ropes`, `ring_posts`, `backstops`, `pit_boxes`, ring constants, `Tug.ring_m`.
- Produces: the ring constants (Pinned); `course_boxes() -> list[(name, pos, half)]` = the Arena's `pit_boxes + backstops`, same order; `course_capsules() -> list[(name, from, to, radius)]` = ring ropes then posts; `pieces(capsules) -> list[(name, from, to, radius)]` (each cut into `ceil(length / TILE_M)` equal pieces named `f"{name}_{k}"`); `tug_scene` puts `tiles(course_boxes())` and `pieces(course_capsules())` on `terrain`. `LENGTH_M`, `WIDTH_M`, `WALL_HEIGHT_M` go.

- [ ] **Step 1: Failing tests.** `test_the_constants_are_the_arenas` compares `(tug.RING_M, tug.PIT_M, tug.PIT_DEPTH_M, tug.STRING_M)` to `EVENT.course`'s and the ring constants to `arena_course`'s. `_static_colliders(model, kind)` filters by geom type (box or capsule); `test_the_course_tiles_the_arenas` runs on boxes (the backstops come in with the platforms). Add:

```python
def test_the_rings_ropes_and_posts_are_the_arenas_in_pieces(arena_model, training_model):
    """D18 for capsules: every Arena rope or post comes as pieces at most TILE_M long, end to end from its `from`
    to its `to`, each with its radius and contacts. A capsule cut at a point is the same shape."""
    capsules = _static_colliders(arena_model, mujoco.mjtGeom.mjGEOM_CAPSULE)
    pieces = _static_colliders(training_model, mujoco.mjtGeom.mjGEOM_CAPSULE)
    assert capsules == {n for n, *_ in tug.course_capsules()} == {n.rsplit("_", 1)[0] for n in pieces}
    assert len(capsules) == 16
    for name in capsules:
        ends = _capsule_ends(arena_model, name)                       # (from, to) off geom_pos, geom_quat, size[1]
        chain = [_capsule_ends(training_model, p) for p in sorted(n for n in pieces if n.rsplit("_", 1)[0] == name)]
        np.testing.assert_allclose([chain[0][0], chain[-1][1]], ends, atol=1e-12)
        for (_, a), (b, _) in zip(chain, chain[1:]):
            np.testing.assert_allclose(a, b, atol=1e-12)
        for p in (n for n in pieces if n.rsplit("_", 1)[0] == name):
            t, g = training_model.geom(p).id, arena_model.geom(name).id
            assert 2 * training_model.geom_size[t][1] <= tug.TILE_M + 1e-12
            for field in set(CONTACT) - {"geom_size"}:
                np.testing.assert_allclose(getattr(training_model, field)[t], getattr(arena_model, field)[g], err_msg=f"{p} {field}")
            assert training_model.geom_size[t][0] == arena_model.geom_size[g][0]
```
- [ ] **Step 2:** TESTS → those fail (the string's tendon tests fail too until Task 2).
- [ ] **Step 3: Implement** them; `pieces` writes `fromto` capsules like the Arena's `_capsules`; the docstring's D1/D18 name the ring, its backstops and the capsule pieces ("D18's rule for every course geom; a cut capsule is the same union"); D20: the ring (the Arena's, Plan G Task 2).
- [ ] **Step 4:** `cd <wt> && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests/test_tug_of_war.py -k "constants or tiles or rings"` → PASS.
- [ ] **Step 5: Commit** (env.py and the test file): "The Tug of War trains in the Arena's ring: its ropes and posts in 2 m pieces, its backstops and platforms in tiles, the pit across it".

### Task 2: The string, laid straight at every reset, its middle the marker

**Files:** Modify `tug_of_war/env.py`, `tug_of_war/rewards.py`, `tug_of_war/check.py`, `tests/test_tug_of_war.py`.

**Interfaces:**
- Consumes: Plan G Task 3's `arena.course._add_string`'s model (`compile_tug`), `string_sites`, string constants; Task 4's `arena.tug.MIDDLE`, `marker_x(string)`, `BoutOutcome.string`, `.string_settle`.
- Produces in `env.py`: the string constants (Pinned); `add_string(spec, a, b) -> None` (a copy of the Arena's `_add_string`: same names, the root on `string/seg8`, two hinges y then z, ties `robot/string_end` ↔ `string/p0` and `opponent/string_end` ↔ `string/p16`, excludes `robot/trunk_base`/`string/seg0`, `opponent/trunk_base`/`string/seg15`); `tug_scene` calls it with `a, b` from `west_start()`/`east_start()`, `STRING_OFFSET` and z `SPAWN_HEIGHT_M + oz` (`SPAWN_HEIGHT_M = 0.12` copied); `reset_string(env, env_ids) -> None` (reset event after both ducks' base and joint resets: from each duck's free-joint qpos, its tie point `pos + quat ⊗ STRING_OFFSET`; the string's root at their midpoint, turned so its +x points west tie → east tie, every hinge at 0, every string velocity 0); `cfg.sim.nconmax = 200`, `cfg.sim.njmax = 1500`. Gone: the tendon, `SLACK_M`, `TAUT_FROM_ITERATION`, `string_limit` and its event (D17), `requires_model_fields` if unused.
- Produces in `rewards.py`: `MIDDLE = 8`; `marker_x(env) -> (n, 1)` (site `string/p8`'s x); `string_length(env) -> (n, 1)` (`string/p0` to `string/p16`); `MarkerGround.__call__(env, scale)`; the critic's terms lose their `offset` param (`pit_margin` keeps it).
- Produces in `check.py`: `TAUT_M = 0.98`; `pull(outcome, side)` reads `outcome.string` (A's end: point 0 west, 16 east; the start from `outcome.string_settle[-1]`; the marker `arena.tug.marker_x(outcome.string[-1:])[0]`).

- [ ] **Step 1: Failing tests.** Delete `TENDON`, `test_the_string_is_tied_like_the_arenas` (tendon), `test_the_string_holds_at_its_length`, `test_the_string_is_slack_until_the_walk_back`, `test_a_played_bout_is_taut_from_the_start`, `test_the_string_turns_taut_episode_by_episode`, `_bout_data` if nothing else uses it. Add:

```python
STRING_FIELDS = {"body": ("body_pos", "body_quat", "body_mass", "body_inertia", "body_ipos"),
                 "jnt": ("jnt_type", "jnt_axis", "jnt_pos"), "geom": CONTACT + ("geom_pos", "geom_quat"),
                 "site": ("site_pos",)}

def test_the_string_is_the_arenas(arena_model, training_model):
    """Every string body, joint, dof, geom and site, both ties and both excludes, as compile_tug builds them."""
    for kind, fields in STRING_FIELDS.items():
        names = [n for n in _names(arena_model, kind) if n.startswith(tug.STRING)]
        assert names == [n for n in _names(training_model, kind) if n.startswith(tug.STRING)] and names
        for name in names:
            a, t = _id(arena_model, kind, name), _id(training_model, kind, name)
            for field in fields:
                np.testing.assert_allclose(getattr(training_model, field)[t], getattr(arena_model, field)[a], err_msg=f"{name} {field}")
    string_dofs = lambda m: [d for d in range(m.nv) if m.body(m.dof_bodyid[d]).name.startswith(tug.STRING)]
    for field in ("dof_damping", "dof_armature"):
        np.testing.assert_array_equal(getattr(training_model, field)[string_dofs(training_model)],
                                      getattr(arena_model, field)[string_dofs(arena_model)])
    ties = lambda m, prefixes: [(m.site(m.eq_obj1id[e]).name.replace(prefixes[0], "").replace(prefixes[1], "#"),
                                 m.site(m.eq_obj2id[e]).name, tuple(m.eq_solref[e]), int(m.eq_type[e])) for e in range(m.neq)]
    assert ties(training_model, ("robot/", "opponent/")) == ties(arena_model, ("", "duck1/"))   # "#" marks the east neck
    assert training_model.nexclude == arena_model.nexclude == 2 and training_model.ntendon == 0


def test_a_reset_lays_the_string_between_the_ducks(live):
    live.reset()
    data, model = live.sim.data, live.sim.mj_model
    site = lambda name: data.site_xpos[:, model.site(name).id]
    points = torch.stack([site(f"{tug.STRING}p{k}") for k in range(17)], dim=1)          # (2, 17, 3)
    assert (points[:, 0] - site("robot/string_end")).norm(dim=-1).max() <= 0.01
    assert (points[:, 16] - site("opponent/string_end")).norm(dim=-1).max() <= 0.01
    line = points[:, 16] - points[:, 0]
    off = torch.linalg.cross(points - points[:, :1], line[:, None].expand_as(points)).norm(dim=-1) / line.norm(dim=-1)[:, None]
    assert off.max() <= 1e-5                                                                # straight
    assert not data.qvel[:, _string_dofs(model)].any()


def test_the_marker_is_the_strings_middle_point(live):
    live.reset()
    live.step(torch.zeros(2, 14))
    p8 = live.sim.data.site_xpos[:, live.sim.mj_model.site(f"{tug.STRING}p{rewards.MIDDLE}").id]
    assert rewards.MIDDLE == arena_tug.MIDDLE and torch.equal(rewards.marker_x(live)[:, 0], p8[:, 0])
    assert (tug.make_env_cfg().sim.nconmax, tug.make_env_cfg().sim.njmax) == (200, 1500)
```
  - `test_marker_ground_pays_new_ground_towards_the_learner` and `test_a_reset_clears_the_marker_record`: `_marker_run` fakes `env.sim.data.site_xpos` with the middle site moving as the old marker did (same expected payments); `params == {"scale": 0.05}`.
  - `check.py`'s `test_a_bout_line_says_how_the_pull_went`: the same hand-made bout, its `string` a straight line between the two ends each frame (`string_settle[-1]` at the start): `pull(outcome, "west") == "taut at 0.76 s · A backed 8.0 cm by 2 s · marker 8.0 cm to A"` (the ends 0.92 → 1.00 m apart: ≥ 0.98 from the 38th frame), east `"taut at 0.76 s · A backed 0.0 cm by 2 s · marker -8.0 cm to A"`; ends held 0.97 m apart: `never taut`.
- [ ] **Step 2:** TESTS → the new tests fail.
- [ ] **Step 3: Implement.** `reset_string` uses torch on the env's device; the quaternion turning +x onto the tie-to-tie direction (yaw, then pitch, as the study's `_quat_x_to`); its event placed in `cfg.events` after `reset_opponent_joints`. Docstring: D3 (both ties and the string), D4 (the string is a rope, the Arena's numbers, never lowered), D17 removed with its why (a rope has no limit to lift; every training warm-starts, t11 taut from step 0), D21 (the reset lays it straight between the actual ties: `reset_data` would put it between the nominal starts, up to 2 cm off), the armature's why (mujoco_warp float32 NaN without it, study §5).
- [ ] **Step 4:** TESTS → green (the whole suite, parity included).
- [ ] **Step 5: Commit:** "The Tug of War trains on the Arena's string: sixteen segments tied neck to neck, laid straight between the ducks at every reset, its middle the marker".

### Task 3: The "stay upright" knob

**Files:** Modify `tug_of_war/env.py`, `tug_of_war/rewards.py`, `tug_of_war/challenge.toml`, `tug_of_war/check.py`, `tests/test_tug_of_war.py`, `tests/test_challenges.py`.

**Interfaces:**
- Produces in `rewards.py`: `UPRIGHT_Z_M = 0.07`, `UPRIGHT_TILT_DEG = 45.0`; `class Down(ManagerTermBase)` with `__call__(env, min_height_m: float, gravity_z: float, hold_steps: int) -> torch.Tensor` (the learner's trunk z below `min_height_m` or projected gravity z above `gravity_z`, for `hold_steps` straight control steps; `reset(env_ids)` clears the count).
- Produces in `env.py`: with `knobs["stay_upright"] > 0`: `terminations["down"] = Down(min_height_m=UPRIGHT_Z_M, gravity_z=-cos(radians(UPRIGHT_TILT_DEG)), hold_steps=round(FALL_HOLD_S / ctrl_dt))`, `fell` deleted (a tilt past 60° held 0.3 s is past 45° first), `rewards["out"]` terms `("in_pit",)`, `rewards["down"] = ended_by(("down",))` weight `-50.0 * knobs["stay_upright"]`; at 0, as today.
- Produces in `check.py`: `LIP_M = 0.08`; `upright(outcome, side) -> str` = `f"on its feet {share:.0f} % · longest down {seconds:.2f} s"` over A's timed frames whose trunk is more than `PIT_M/2 + LIP_M` from the centre line (share 100 % and 0.00 s when none is), tilt read as `arena/moments.py` reads it; the bout line ends `… · {pull(...)} · {upright(...)}`.
- `challenge.toml`: `[params.stay_upright]` (Pinned), its comment: 0 lets the duck crouch, sit or lie as the Arena allows; above 0, going down (trunk under 7 cm or tilted past 45° for 0.3 s) ends the training episode and costs that many pits.

- [ ] **Step 1: Failing tests.** `test_challenges.py`'s row gains `"stay_upright": (None, 1.0)` (not a reward weight, as the hill's `max_slope_deg`). Add:

```python
@pytest.mark.parametrize("z, tilt_deg, fires_at", [(0.09, 40.0, None), (0.12, 0.0, None), (0.06, 55.0, 15), (0.036, 7.0, 15), (0.10, 46.0, 15)])
def test_the_upright_rule_lets_a_puller_lean_and_ends_a_sitting_duck(z, tilt_deg, fires_at):
    """A puller leaning 40° at 9 cm stays in; t10-500's sit (6 cm, 55°), a belly-flat crawler (3.6 cm, 7°) and a 46° lean go
    down on the 15th straight step."""
    env = _posed_env(z, tilt_deg)            # robot root_link_pos_w z, projected_gravity_b z = -cos(tilt), 1 env
    term = rewards.Down(None, env)
    fired = [bool(term(env, 0.07, -math.cos(math.radians(45.0)), 15)[0]) for _ in range(20)]
    assert (fired.index(True) + 1 if any(fired) else None) == fires_at


def test_stay_upright_ends_a_down_duck_and_costs_its_pits(tmp_path, monkeypatch):
    cfg = _cfg_with_knobs(tmp_path, monkeypatch, stay_upright=1.0)   # as test_the_hill_trains_on_slopes_up_to_the_knob does
    assert "down" in cfg.terminations and "fell" not in cfg.terminations
    assert cfg.terminations["down"].params == {"min_height_m": 0.07, "gravity_z": pytest.approx(-0.7071068), "hold_steps": 15}
    assert (cfg.rewards["down"].weight, cfg.rewards["down"].params) == (-50.0, {"terms": ("down",)})
    assert cfg.rewards["out"].params == {"terms": ("in_pit",)}
    off = _cfg_with_knobs(tmp_path, monkeypatch, stay_upright=0.0)
    assert "down" not in off.terminations and "down" not in off.rewards and off.rewards["out"].params == {"terms": ("in_pit", "fell")}


def test_a_bout_line_says_how_long_a_was_down():
    """100 frames: 50 standing (z 0.10), 20 at z 0.05, 30 standing; A's trunk 0.5 m from the pit."""
    assert check.upright(_upright_bout(), "west") == "on its feet 80 % · longest down 0.40 s"
    assert check.upright(_upright_bout(x=-0.20), "west") == "on its feet 100 % · longest down 0.00 s"   # at the lip: left out
```
  - The knob test's label row: `upright_reward`'s label is `"Keep the trunk level"`, `stay_upright`'s `"Stay upright"`, value 0.0, min 0.0, max 2.0.
  - The module's `cfg` and `live` fixtures build the recipe with `stay_upright` at 0.0 whatever the toml says (`_cfg_with_knobs` through `tmp_path_factory` and `pytest.MonkeyPatch.context()`), so Task 5's training commit (the knob at 1.0) leaves the suite green; Task 8 pins the toml itself.
- [ ] **Step 2:** TESTS → they fail.
- [ ] **Step 3: Implement** them; D22 in the docstring: the rule's numbers and their derivation (standing 11–12 cm; feet-only poses leaning back to 45° keep ≥ 7.8 cm; t10-500 sat at 5–6 cm, 55°; lying 3.6 cm), off for users, on for the owner's ducks (spec, 2026-10-21).
- [ ] **Step 4:** TESTS → green.
- [ ] **Step 5: Commit:** "The Tug of War's recipe can keep a duck on its feet: stay upright, off by default, ends a training episode at a 7 cm trunk or a 45° tilt held 0.3 s and costs a pit".

### Task 4: The string runs end to end, on the Mac and on warp

**Files:** none tracked unless a bug shows (then the fix and a test pinning it); scratch `SCRATCH/h-probe.py`.

- [ ] **Step 1:** TESTS (the live tests `test_a_bout_steps`, `test_a_pit_on_either_side_ends_the_episode`, `test_the_opponent_starts_where_the_arenas_east_duck_does` run the string).
- [ ] **Step 2: Smoke train:** `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --gpu-ids None --env.scene.num-envs 2 --agent.max-iterations 2 --agent.save-interval 1 --agent.logger tensorboard --agent.run-name smoke` writes `logs/rsl_rl/tug_of_war/<stamp>_smoke/model_1.pt`.
- [ ] **Step 3: Export and score:** `cd <wt> && uv run --no-config --no-sync publish --run logs/rsl_rl/tug_of_war/<stamp>_smoke --checkpoint 1 --repo local/microduck-eval --dry-run --allow-dirty`; `cd <wt> && uv run --no-config --no-sync arena score publish-eval/policy.onnx --event tug-of-war` prints five bout lines and `rating: X.X cm · replay from seed n`. Remove the smoke run and `publish-eval/`.
- [ ] **Step 4: The warp probe.** `SCRATCH/h-probe.py`, from the study's `warp_rope.py` without its rope builder (the env has the string): `ManagerBasedRlEnv(tug.make_env_cfg(), device="cpu")` at 64 envs, the learner driven by `opponent.load_actor(ONNX/t10-500.onnx)`, 300 steps; prints the terminations fired, max contacts and constraint rows per world, env-steps/s. Run `cd <wt> && uv run --no-config --no-sync python SCRATCH/h-probe.py` (foreground). Expected: `nan_state` and `opponent_nan_state` 0, contacts ≤ 200 a world (study: 44), rows ≤ 1500 (study: 196). A NaN stops the plan: report, never retune the string.
- [ ] **Step 5: Preflight:** Task 5 Step 2's command with `--dry-run` for `--detach`, run name `preflight`: the tarball lists `tug_of_war/env.py`, `rewards.py`, `opponent.py`, `reference.onnx`, `challenge.toml`.
- [ ] **Step 6:** report the probe's numbers to the controller (ledger: "string probe").

### Task 5: The upright reference: t13 and t14

**Files:** `tug_of_war/challenge.toml` (the knob at 1.0, the hypothesis commit); untracked: the ledger, `logs/rsl_rl/tug_of_war/`, ONNX.

**Interfaces:** Consumes Tasks 1–4, a clean tree, the Arena still rating against t7-250. Produces judged `ONNX/t13-<N>.onnx`, `ONNX/t14-<N>.onnx`, ledger rows, U/R1 verdicts, the pick.

- [ ] **Step 1:** `[params.stay_upright] value = 1.0`; TESTS green; commit: "t13/t14: the reference trained upright on the ring and the string, warm-started from t7-250 and against it — ended at 0.3 s down for a pit's cost, a duck that already backs and pulls should learn to do it on its feet". Ledger rows `t13`, `t14` (commit, hypothesis).
- [ ] **Step 2: Launch** both: `cd <wt> && uv run --no-config --no-sync train Mjlab-TugOfWar-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 1000 --agent.seed 1 --agent.logger tensorboard --agent.run-name t13 --hf-jobs --detach --no-wandb --namespace Nico-robot --ckpt-repo Nico-robot/mjlab-tugofwar-microduck-t13` (t14: seed 2, `t14`, `-t14`); `[job] id: <id>` into the ledger. Plan F Task 7 Step 3 for RUNNING and errors (a CUDA OOM at start: report, the probe's memory estimate was +0.6 GB).
- [ ] **Step 3: The controller waits** per checkpoint (Monitor on the repo's `.pt` list), then `hf download Nico-robot/mjlab-tugofwar-microduck-t<k> --local-dir logs/rsl_rl`. Judged: 250, 500, 750, 1000.
- [ ] **Step 4: Judge each** (a subagent per batch), all into the ledger: export to `ONNX/t<k>-<N>.onnx`; `arena score` (against t7-250 on the ring and the string); `cd <wt> && uv run --no-config --no-sync python -m microduck_challenges.tug_of_war.check ONNX/t<k>-<N>.onnx --bouts 10` (B = t7-250); bout 1's 50 Hz trace each second: both trunks' z and tilt, the ends' distance, the marker (point 8), where the string lies (its lowest point's z); curves `Train/mean_episode_length`, `Episode_Termination/{in_pit,opponent_in_pit,down,nan_state,opponent_nan_state}`, `Episode_Reward/{marker_ground,win,out,down,track_linear_velocity,pit_margin_reward,upright}`.
- [ ] **Step 5: Verdicts:** U and R1 per checkpoint; the rating against t7-250 is the ranking, ≥ 0.0 cm a target (on its feet against a prone t7-250 that pins the string).
- [ ] **Step 6: Pick:** among the checkpoints passing U and R1, the highest rating; between ratings within 5.0 cm, a round robin decides (`check.py A B --bouts 10` for each pair, more bouts won, then more pits). Ledger: the pick and why. No checkpoint passes: ONE lever aimed at the first gate missed, its hypothesis in the commit, `t<n>` launched as Step 2, judged as Steps 3–5; the stop rule counts t13, t14, t15.

**Levers, in order:** (1) another checkpoint, then a seed; (2) `stay_upright` 2.0; (3) a `trunk_height` reward, `tanh(clamp(z − UPRIGHT_Z_M, min=0) / 0.04)`, weight 1.0 (U missed with the duck crouching just over the line); (4) `marker_ground` weight 4.0 (R1 missed: upright but not pulling).

### Task 6: The new reference handed over (with Plan G Task 9, one sitting)

**Files:** Modify `tug_of_war/reference.onnx` (the pick's bytes), `tug_of_war/opponent.py` (docstring), `tests/test_tug_of_war.py` (`T7_250_SHA256` → `REFERENCE_SHA256`, its value); the ledger.

**Interfaces:** Produces for Plan G Task 9: `ONNX/<run>-<N>.onnx`, its sha256, its ckpt repo, the recipe commit, the date, and the Arena name `tug-reference-<run>-<N>.onnx`.

- [ ] **Step 1:** `shasum -a 256 ONNX/<run>-<N>.onnx`; hand the five facts to the controller, who runs Plan G Task 9 Steps 1–4.
- [ ] **Step 2: Failing test:** `REFERENCE_SHA256 = "<its sha>"`; TESTS → `test_the_reference_ships_with_the_challenge` fails.
- [ ] **Step 3:** `cp ONNX/<run>-<N>.onnx src/microduck_challenges/tug_of_war/reference.onnx`; `opponent.py`'s `REFERENCE` comment: the Arena's reference duck, `<run>-<N>`, trained upright (Plan H).
- [ ] **Step 4:** TESTS green (the bytes equal the Arena's `EVENT.rating.reference` file once Plan G Task 9 is committed; `test_the_opponent_net_is_its_onnx` runs on the new graph; `load_actor` refusing it means another exporter: stop and report).
- [ ] **Step 5: Commit:** "The Tug of War trains against the Arena's new reference, <run>-<N>, upright on the ring, and starts as it". Plan G Task 9 Steps 5–7 follow.

### Task 7: The owner's candidate: t15 and t16

**Files:** none tracked unless a lever needs one; the ledger, ONNX.

**Interfaces:** Consumes Task 6 and Plan G Task 9 (the Arena rates against the new reference; the recipe's opponent and warm start are it; the knob still 1.0). Produces judged `ONNX/t15-<N>.onnx`, `ONNX/t16-<N>.onnx`, the candidate.

- [ ] **Step 1:** TESTS green, clean tree; ledger rows `t15`, `t16` (HEAD, "upright, warm-started from the new reference and against it").
- [ ] **Step 2:** launch as Task 5 Step 2 with run names `t15` (seed 1), `t16` (seed 2), repos `-t15`, `-t16`.
- [ ] **Step 3:** wait and judge as Task 5 Steps 3–4 (`arena score` and `check.py` now against the new reference).
- [ ] **Step 4: Verdicts:** U, R1, R2, R3 per checkpoint.
- [ ] **Step 5: Pick:** among the checkpoints passing U, R1 and R2, the highest rating, a round robin deciding between ratings within 5.0 cm (Plan F's rule: a cup is duck against duck); none: the best passing U and R1; never one failing U (the owner's duck stays on its feet). Ledger: the candidate. None passes U, R1 and R2: ONE lever, as Task 5 Step 6; the stop rule counts t15, t16, t17.

**Levers, in order:** (1) another checkpoint, then a seed; (2) `marker_ground` weight 4.0 and `win` 100 (R2 missed); (3) `stay_upright` 0.5 (a learner too cautious to pull, U passing with margin); (4) Task 5's `trunk_height` reward (U missed).

### Task 8: The recipe users get, the guide, the hand-over

**Files:** Modify `tug_of_war/challenge.toml` (the knob back to 0.0), `tug_of_war/AGENTS.md`, `README.md` (two lines), `tests/test_tug_of_war.py`; `<wt>/publish-tug-of-war/` (git-ignored).

- [ ] **Step 1: Failing test:**

```python
def test_the_recipe_users_get_lets_the_duck_go_down():
    """Off by default (owner, 2026-10-21): other players may crawl; the owner's ducks trained with stay_upright 1.0."""
    knob = tomllib.loads((Path(tug.__file__).with_name("challenge.toml")).read_text())["params"]["stay_upright"]
    shipped = tug.make_env_cfg()   # the committed toml, not the fixture's
    assert (knob["label"], knob["value"]) == ("Stay upright", 0.0)
    assert "down" not in shipped.terminations and "fell" in shipped.terminations
```
- [ ] **Step 2:** TESTS → it fails (the toml says 1.0 since Task 5).
- [ ] **Step 3:** `value = 0.0`; `AGENTS.md` on its outline: the challenge (a 3 m ring, its ropes the edges, a real 80 g string that sags and can be lain on, only the pit decides), the policy, the recipe (warm start from `reference.onnx`, now the upright reference; no slack phase; the `stay_upright` knob, what "down" means, off by default, on for a duck that must stay on its feet), files (the copied ring and string constants as do-not-change, the parity tests), judging (`check.py`'s `taut` at 0.98 m and the `on its feet` line; U, R1–R3), "What is known" (measured facts only: the probe, t13–t16 ratings and gates, what the traces showed, each lever, the reference's and the candidate's pick); `README.md` and the toml's header in two lines.
- [ ] **Step 4:** TESTS green; commit: "The Tug of War's recipe lets a duck go down again, as the Arena does; the guide teaches the ring, the string and stay upright, and what training upright measured".
- [ ] **Step 5: Export as the owner will publish** (Plan F Task 9 Steps 2–3 with the candidate's run and checkpoint): `publish-tug-of-war/manifest.json` names `tug-of-war`, Reproduce = the candidate's training commit (knob 1.0); `arena score publish-tug-of-war/policy.onnx --event tug-of-war` equals the ledger's number.
- [ ] **Step 6: Hand over** Plan F Task 9 Step 5's command with the candidate's `<stamp>_<run>` and `<N>`, for after Plan D's release (`tug-of-war` merged without squash, relocked). It prints `[publish] entered on tug-of-war: a X.X cm rating → <page url>`.

---

## Self-review (amended spec, Plan G)

- Spec 2026-10-21 decision 1 in training: Task 2 (the same string, the reset, the middle marker), Task 4 (warp probe). Decision 2: Task 1. Decision 3: Task 3 (knob, off for users, Task 8's pin), Task 5 (the reference, warm start from t7-250 against it, judged every 250, U and R1, its rating against t7-250), Task 6 (it replaces t7-250 in both repos), Task 7 (the candidate, warm start from it, gates, round robin), Task 8 (users' default, guide, hand-over).
- My calls: two hinges and the armature (Pinned, parity), upright thresholds (Pinned, Task 3), the knob as pits (Task 3), no slack phase (Task 2), taut 0.98 (Task 2), the reference's scheme (Task 5).
- Plan G's names used here: `ring_ropes`, `ring_posts`, `backstops`, `pit_boxes`, `string_sites`, `_add_string`'s model, `arena.tug.MIDDLE`, `marker_x(string)`, `BoutOutcome.string`, `.string_settle`; the order: G2–G4 → Tasks 1–4; G9 with Task 6.
