# Versus G — The Ring and the Rope (Arena) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the tug of war is fought in its own venue, a 3 m wrestling ring whose ropes are the field's edges, on a physical string (16 segments, 80 g) whose middle point is the marker and whose 17 points are recorded every step and drawn as they lay; ratings run against t7-250 meanwhile, then against Plan H's upright reference.

**Architecture:** `compile_tug` builds the ring (platforms, pit, 12 rope capsules, 4 posts, 4 invisible backstops) and ties the ducks with a middle-rooted chain of capsules (two hinges a joint) instead of the tendon. `run_bout` records the string's 17 sites beside the ducks; the judge reads point 8. A tug's npz gains `string` and `string_settle`; two routes serve them; the front draws an 8 mm tube through the points. The `ring-mockup` venue is merged, then bound to the served ring.

**Tech Stack:** Python 3.12, MuJoCo 3.10, FastAPI, pytest; vanilla JS, three.js 0.169, vitest + jsdom; headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md`, "Owner decisions, 2026-10-21" and its calls, §1–§3. **Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md` (Task 2 rewrites its names). **Plan H:** `docs/superpowers/plans/2026-10-21-versus-h-upright-on-the-ring.md` (challenges; its parity tests import this plan's `compile_tug`, `tug_layout`, `marker_x`). **Rope study:** `/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/e3798270-5a89-4af8-a12f-f9d4d292ea4f/scratchpad/rope/` (`rope.py` `add_rope`, `arena_rope.py`, `rope-report.md`): read before Task 3. **Venue mockup:** branch `ring-mockup` (5781b91, c1e06f8, defa473), report `…/scratchpad/ring/ring-report.md`.

## Global Constraints

- The contract's global constraints apply (unsigned English commits, `/usr/bin/git`, `uv run --no-config --frozen`, no globs or shell variables, tests in the FOREGROUND with `timeout: 600000`, nothing leaves this Mac without the owner's yes, no clip render in production: none exists).
- Shorthands, written out in full in every call: **PYTEST** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider`; **SUITE** the contract's two Python calls, then `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app && npm test` (only the 4 known brightness failures); **VITEST** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app && npx vitest run`; **GIT** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`; **CHALLENGES** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests`; **SCRATCH** the session scratchpad's absolute path; **ONNX** `/Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/logs/tug_of_war/onnx`.
- **Order (cross-repo):** G1 any time first. G2 → G3 → G4 back to back: from G2's commit the challenges' parity tests fail (they compare to the lane and the tendon), and they stay red until Plan H's Task 2; nothing trains in between. Plan H Tasks 1–5 start after G4; G5–G8 run beside them. G9 waits for Plan H Task 6's hand-over and runs in one sitting with it (each repo checks the other's reference bytes). Plan H Task 7 (candidates) needs G9.
- **Pinned.**
  - `[course]` of a tug: `ring_m = 3.00`, `pit_m = 0.30`, `pit_depth_m = 0.30`, `string_m = 1.00`; `length_m`, `width_m`, `wall_height_m` go. Validation: all positive, `pit_m < string_m < ring_m`.
  - Ring (`arena/course.py`): `RING_ROPES_M = (0.06, 0.12, 0.18)` (axes over the canvas), `RING_ROPE_RADIUS_M = 0.006`, `RING_POST_RADIUS_M = 0.022`, `RING_POST_TOP_M = 0.23`; sides `("west", "east", "north", "south")` (−x, +x, +y, −y); geoms `rope_<side>_<k>` (k 0 bottom → 2 top), `post_nw`, `post_ne`, `post_sw`, `post_se`, `backstop_<side>`; `PLATFORM_OVERRUN_M = 20.0` and `WALL_THICKNESS_M = 0.05` kept (a backstop is that thick).
  - String (`arena/course.py`): `STRING = "string/"` (prefix of its bodies `string/seg{k}`, joints `string/root`, `string/j{k}y`, `string/j{k}z`, geoms `string/cap{k}`, sites `string/p{k}`), `STRING_SEGMENTS = 16`, `STRING_RADIUS_M = 0.004`, `STRING_MASS_KG = 0.080`, `STRING_END_MASS_KG = 0.015`, `STRING_DAMPING = 0.003`, `STRING_ARMATURE = 1e-6`, `STRING_TIE_SOLREF = (0.01, 1.0)`, `STRING_FRICTION = (1.0, 0.005, 0.0001)`; contype 0, conaffinity 1, priority 1, default solref/solimp; free root on `string/seg8`; each joint two hinges, y then z; ties `connect` site `string_end` ↔ `string/p0` and `duck1/string_end` ↔ `string/p16`; excludes `trunk_base`/`string/seg0`, `duck1/trunk_base`/`string/seg15`. Never lowered (spec).
  - `arena/tug.py`: `STRING_POINTS = 17`, `MIDDLE = 8`; `marker_x(string)` = `string[:, MIDDLE, 0]`.
  - Trace npz keys `trace`, `settle`, and on a tug `string` (frames, 17, 3), `string_settle` (settle + 1, 17, 3), float16.
  - Wire: `GET /api/runs/{id}/string`, `GET /api/matches/{id}/bouts/{k}/string`: little-endian float32, the settle's frames then the timed frames, 51 floats a frame; headers `X-Frame-Count` (timed), `X-Settle-Frame-Count`, `X-Point-Count: 17`, `Cache-Control: no-store`.
  - Front: the string a Catmull-Rom tube of radius 0.004 m through the 17 points (64 tubular segments, 6 radial), the red ribbon at point 8.
  - Stability (Task 3): 40 bouts, 0 MuJoCo resets, ends at most 1.0030 m apart, each tie within 0.010 m.
- **Untouched:** the golden run, `RUNNER_VERSION` 4, races (`wall_boxes`), the stage; the bout rules, the rating (cm + 100 for a pit), the cup and the show but where they read the string or the course. Mac numbers are indicative.

## Review Focus

1. **A string other than the measured one** (a mass, the armature, a ball joint): Task 3's `test_the_string_is_the_measured_one` and 40-bout check.
2. **A duck threading out of the ring, or "in the pit" outside it**: Task 2's `test_a_duck_thrown_at_the_ropes_stays_in_the_ring`.
3. **The verdict read off the wrong point or sign**: Task 4's `test_the_judge_reads_the_pit_then_the_strings_middle`.
4. **A bout stored without its string** (a writer missed): Task 4's `test_a_tug_entry_stores_its_bout_and_string`, `test_a_matchs_bout_file_holds_its_string`.
5. **The string out of step with the ducks** (a cut settle): Task 6's `tugString keeps its settle's last frames…`.

---

### Task 1: The venue mockup joins `versus`

**Files:** none edited; merges `ring-mockup` (`app/src/tug-venue.js`, `tug-venue.test.js`, `viewer.js`, `viewer.test.js`, `tug.js`, `tug.test.js`, `stadium.js`, `stadium.test.js`).

**Interfaces:** Produces `app/src/tug-venue.js buildTugVenue(event, spectators, reachy, branding, clearance) -> {group, crowd, pose, dispose}`; `buildString()` gains `dispose()`; `buildTugCourse`, `cutPit`, `disposeTugCourse`, `floorUnder` and the contact-shadow blob are gone.

- [ ] **Step 1:** `GIT log --oneline -1` is `4f386c2`, `GIT status --short` lists only `MUJOCO_LOG.TXT`; else stop and report.
- [ ] **Step 2:** `GIT merge --ff-only ring-mockup` (d9a4ac4 rides along, superseded by 5781b91 in the same history).
- [ ] **Step 3:** VITEST (only the 4 brightness failures); `npm run build` in `app`. Report the new HEAD (`defa473`); nothing to commit.

---

### Task 2: The tug is fought in a 3 m ring, its ropes the field's edges

**Files:** Modify `arena/manifest.py`, `arena/events/tug-of-war.toml`, `arena/course.py`, `arena/web/routes_read.py`, `arena/commentary/context.py`, `arena/commentary/cup.py`, `arena/commentary/generator.py`, `docs/guides/challenges/tug-of-war.md`, `docs/superpowers/plans/2026-10-19-versus-interfaces.md`, `app/src/format.js`; tests `tests/test_manifest.py`, `test_course.py`, `test_moments.py`, `test_routes_read.py`, `test_commentary_context.py`, `test_commentary_cup.py`, `test_commentary_generator.py`, `app/src/format.test.js`, and every front fixture that gives a tug `length_m`, `width_m` or `walls` (`clip/score.test.js`, `race.test.js`, `roundcard.test.js`, `tug.test.js`, `workshop/challenge.test.js`).

**Interfaces:**
- Produces in `manifest.py`: `Tug(ring_m, pit_m, pit_depth_m, string_m, kind="tug")`.
- Produces in `course.py`: the Pinned ring constants; `ring_ropes(course) -> list[tuple[str, tuple, tuple]]` (name, from, to: west, east, north, south, each bottom to top; a side runs post to post); `ring_posts(course) -> list[tuple[str, tuple, tuple]]` (`post_nw`, `post_ne`, `post_sw`, `post_se`, from z 0 to `RING_POST_TOP_M` at `(±ring_m/2, ±ring_m/2)`); `backstops(course) -> list[tuple[str, tuple, tuple]]` (name, pos, half; `backstop_<side>`, flush behind the side's ropes); `pit_boxes(course)` sized on `ring_m`; `tug_walls` removed.
- Produces in the API: a tug's summary serves `ring_m`, `string_m`, `pit_m`, `pit_depth_m`, `ropes` and `posts` (`[{name, from, to, radius}]`), `bout`, and `string_offset` until Task 6 (the page draws the string from it until then); no `length_m`, `width_m`, `walls`, `pit`.

- [ ] **Step 1: Failing tests.**

```python
# tests/test_course.py (replaces test_the_course_geometry_of_the_tug and ..._and_walls_but_no_floor_plane)
def test_the_ring_is_three_ropes_a_side_post_to_post_with_a_backstop_behind():
    ropes = ring_ropes(TUG.course)
    assert names(ropes) == [f"rope_{s}_{k}" for s in ("west", "east", "north", "south") for k in (0, 1, 2)]
    assert ropes[0] == ("rope_west_0", (-1.5, -1.5, 0.06), (-1.5, 1.5, 0.06))
    assert ropes[11] == ("rope_south_2", (-1.5, -1.5, 0.18), (1.5, -1.5, 0.18))
    assert ring_posts(TUG.course)[0] == ("post_nw", (-1.5, 1.5, 0.0), (-1.5, 1.5, 0.23))
    assert backstops(TUG.course)[0] == pytest.approx(("backstop_west", (-1.531, 0.0, 0.093), (0.025, 1.556, 0.093)))
    assert backstops(TUG.course)[2] == pytest.approx(("backstop_north", (0.0, 1.531, 0.093), (1.556, 0.025, 0.093)))
    assert numbers(pit_boxes(TUG.course)) == pytest.approx([-10.825, 0, -0.175, 10.675, 21.55, 0.175,
                                                            10.825, 0, -0.175, 10.675, 21.55, 0.175, 0, 0, -0.325, 0.15, 21.55, 0.025])

def test_a_tug_is_a_ring_on_platforms_over_a_pit_and_no_floor_plane():
    model = compile_course(TUG)
    with pytest.raises(KeyError):
        model.geom("floor")
    with pytest.raises(KeyError):
        model.geom("wall_left")
    rope = model.geom("rope_west_1")
    assert rope.type[0] == mujoco.mjtGeom.mjGEOM_CAPSULE and rope.size[:2] == pytest.approx([0.006, 1.5])
    assert model.geom("post_se").size[:2] == pytest.approx([0.022, 0.115])

def test_a_duck_thrown_at_the_ropes_stays_in_the_ring():
    """Both ducks moved 1.35 m north, 15 cm from the north ropes, thrown at them at 1.5 m/s, limp (no servo is
    driven): no trunk crosses y = 1.5 and none drops below the floor outside the pit."""
    model = compile_tug(TUG)
    data = _standing(model)
    for j in np.flatnonzero(model.jnt_type == mujoco.mjtJoint.mjJNT_FREE):   # the ducks; from Task 3 the string's root
        data.qpos[model.jnt_qposadr[j] + 1] += 1.35
        data.qvel[model.jnt_dofadr[j] + 1] = 1.5
    for _ in range(round(1.0 / model.opt.timestep)):
        mujoco.mj_step(model, data)
        trunks = [data.xpos[model.body(p + "trunk_base").id] for p in ("", "duck1/")]
        assert max(t[1] for t in trunks) < 1.5 and min(t[2] for t in trunks) > -0.05
```
  - `test_manifest.py`: `TUG`'s `[course]` is `ring_m=3.0` with `pit_m`, `pit_depth_m`, `string_m`; `test_the_tug_of_war_loads` asserts `m.course == Tug(3.0, 0.3, 0.3, 1.0)`; refusals: `length_m=4.0` → `"unknown keys"`; `pit_m=1.2` → `r"pit must be narrower than its string"`; `string_m=3.5` → `r"shorter than its ring"`. `test_moments.py`'s `COURSE = Tug(ring_m=3.0, pit_m=0.30, pit_depth_m=0.30, string_m=1.0)`.
  - `test_routes_read.py::test_a_tug_serves_its_course_and_its_bouts`: `tug["ring_m"] == 3.0`, `tug["ropes"][0] == {"name": "rope_west_0", "from": [-1.5, -1.5, 0.06], "to": [-1.5, 1.5, 0.06], "radius": 0.006}`, `len(tug["ropes"]) == 12`, `tug["posts"][3]["name"] == "post_se"`, and none of `length_m`, `width_m`, `walls`, `pit` in it.
  - Commentary pins: the event fact `"The event is the Tug of War, a pulling contest against the Arena's reference duck: the two are tied by a string across a pit in a wrestling ring and each pulls by walking backwards."`; the cup opening's course sentence `"Two ducks tied by a 1.0 m string pull across a pit 30 cm wide in a 3 m wrestling ring, walking backwards. "`; `"across a pit in a wrestling ring" in BOOTH_CONTEXT`.
  - `format.test.js`: `formatEventFacts(TUG)[0]` is `{ label: "course", value: "3 m ring, 0.3 m pit" }`; tug fixtures drop `length_m`, `width_m`, `walls`, gain `ring_m: 3`.
- [ ] **Step 2:** `PYTEST tests/test_course.py tests/test_manifest.py tests/test_moments.py tests/test_routes_read.py tests/test_commentary_context.py tests/test_commentary_cup.py tests/test_commentary_generator.py`; `VITEST src/format.test.js` → FAIL.
- [ ] **Step 3: Implement.**
  - `manifest.py` `_tug`: keys `{"kind", "ring_m", "pit_m", "pit_depth_m", "string_m"}`, each positive; `f"[course]: a tug's pit must be narrower than its string and its string shorter than its ring: pit_m {p}, string_m {s}, ring_m {r}"`. Docstring: a ring cut by a pit.
  - The toml's `[course]`: `ring_m = 3.00  # rope to rope: the field is the square inside the ring's ropes`, then `pit_m`, `pit_depth_m`, `string_m = 1.00  # neck base to neck base, straight at the start`.
  - `course.py`: `_capsules(body, capsules, radius)` writes `type="capsule" fromto=… size=radius`; the tug branch of `_inject_course` = `_boxes(pit_boxes + backstops)`, then the ropes and the posts. A backstop (`h = ring_m/2`, `r` the rope radius, `t = WALL_THICKNESS_M`, `top = RING_ROPES_M[-1] + r`): west at `(-(h + r + t/2), 0, top/2)`, half `(t/2, h + r + t, top/2)`, the four overlapping at the corners. `pit_boxes`: `width_m` and `length_m` both become `ring_m`. Docstrings: the backstop closes the 5.4 cm under the bottom rope and the 4.8 cm between two; the platforms still run `PLATFORM_OVERRUN_M` out, so no duck is below the floor but in the pit.
  - `routes_read.py`: the tug summary per Interfaces (`ropes` from `ring_ropes` with `RING_ROPE_RADIUS_M`, `posts` from `ring_posts` with `RING_POST_RADIUS_M`; comment: the page draws what the ducks bounce off, never a second arithmetic of it).
  - `context.py` `nature`, `cup.py` `_opening` (reads `ring_m` with `:g`), `generator.py` BOOTH_CONTEXT's tug sentence: the pinned texts. `format.js` the tug's course fact `` `${event.ring_m} m ring, ${event.pit_m} m pit` ``.
  - The guide: the first line `Two ducks are tied neck to neck by a 1 m string, over a 0.3 m pit, in a 3 m wrestling ring. Drag the other duck into the pit.`; "## The bout" gains, after its first paragraph, `The ring's ropes are the field's edges: a duck that backs into them bounces off. The string is a real rope: it sags, and a duck can step or lie on it.`
  - The contract: the plans table gains G (arena `versus`) and H (challenges `tug-of-war`); the order of execution gains this plan's Order; "Plan A — names" becomes "(as Plan G leaves them)", written once now with every name the Interfaces blocks of Tasks 2–6 produce or remove, and a tug lane `{tug: "bout", ducks, string: {trace, settle?}}`; "Plan B — cross-repo names" lists Plan H's copies: the lane's and the tendon's names out, the ring's and the string's constants and names, `string_sites` and `marker_x(string)` in.
- [ ] **Step 4:** Step 2's commands → PASS; SUITE.
- [ ] **Step 5:** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && rtk proxy grep -rnI "length_m\|width_m\|wall_height\|tug_walls\|\.walls" arena/tug.py arena/match.py arena/moments.py arena/commentary arena/web/routes_read.py app/src/tug.js app/src/tug-venue.js` prints only `routes_read.py`'s race summary lines.
- [ ] **Step 6:** commit the 11 sources and the tests: `"The Tug of War is fought in a 3 m ring: its ropes are the field's edges, a backstop behind them, the pit across it from rope to rope"`. Tell the controller: the challenges' parity tests are red until Plan H Task 2.

---

### Task 3: The string is a rope: sixteen segments tied neck to neck

**Files:** Modify `arena/course.py`; tests `tests/test_course.py`, `tests/test_tug.py` (the tendon's tests). Scratch: `SCRATCH/g-stability.py`.

**Interfaces:**
- Consumes: the study's `rope.py add_rope` (`attach="mid"`, `joint="universal"`) as the reference implementation, Task 2's course.
- Produces: the Pinned string constants; `_add_string(spec, a, b) -> None` (private: the chain straight from world point `a` to `b`, its ties, excludes); `string_sites(model) -> np.ndarray` (the 17 site ids, west to east); `compile_tug(manifest)` with the string, its STAND keyframe part its `qpos0`. `STRING` now names the prefix; the tendon is gone.

- [ ] **Step 1: Failing tests** (`test_a_tug_is_two_ducks_neck_to_neck_and_nothing_else` drops its tendon lines; `test_the_string_leaves_every_ducks_addresses_alone` stays as is):

```python
def test_the_string_is_the_measured_one():
    model = compile_tug(TUG)
    segs = [model.body(f"string/seg{k}") for k in range(16)]
    assert [round(float(s.mass[0]), 7) for s in segs] == [0.015] + [0.0035714] * 14 + [0.015]
    assert model.joint("string/root").type[0] == mujoco.mjtJoint.mjJNT_FREE and model.body(model.joint("string/root").bodyid[0]).name == "string/seg8"
    hinges = [model.joint(f"string/j{k}{a}") for k in range(16) if k != 8 for a in "yz"]
    assert {int(j.type[0]) for j in hinges} == {mujoco.mjtJoint.mjJNT_HINGE} and len(hinges) == 30
    assert [list(model.joint(f"string/j3{a}").axis) for a in "yz"] == [[0, 1, 0], [0, 0, 1]]
    dofs = [d for d in range(model.nv) if model.body(model.dof_bodyid[d]).name.startswith("string/")]
    assert len(dofs) == 36 and set(model.dof_armature[dofs]) == {1e-6}
    assert set(model.dof_damping[[d for d in dofs if model.dof_jntid[d] != model.joint("string/root").id]]) == {0.003}
    cap = model.geom("string/cap0")
    assert (cap.size[0], cap.size[1], cap.contype[0], cap.conaffinity[0], cap.priority[0]) == pytest.approx((0.004, 0.03125, 0, 1, 1))
    assert list(cap.friction) == pytest.approx([1.0, 0.005, 0.0001])
    ties = [model.eq(e) for e in range(model.neq)]
    assert [(model.site(t.obj1id[0]).name, model.site(t.obj2id[0]).name) for t in ties] == [("string_end", "string/p0"), ("duck1/string_end", "string/p16")]
    assert all(t.type[0] == mujoco.mjtEq.mjEQ_CONNECT and list(t.solref) == pytest.approx([0.01, 1.0]) for t in ties)
    assert model.ntendon == 0 and model.nu == 28 and model.nexclude == 2
    data = _standing(model)   # the STAND keyframe, forwarded
    points = data.site_xpos[string_sites(model)]
    np.testing.assert_allclose(points[[0, 8, 16]], [[-0.5, 0, 0.1524215], [0, 0, 0.1524215], [0.5, 0, 0.1524215]], atol=1e-9)
    assert np.linalg.norm(np.diff(points, axis=0), axis=1) == pytest.approx([0.0625] * 16)

def test_a_bout_on_the_string_holds_together():
    """The reference against itself, 4 s (the settle's yank included): no reset, ends never past 1.005 m, ties within 1 cm."""
    gaps, ties = _string_bout(SHORT, reference_duck(TUG), reference_duck(TUG), 1)   # _start + sim.step as run_bout, each step read off data
    assert max(gaps) <= 1.005 and max(ties) <= 0.01
```
  - `test_a_duck_thrown_at_the_ropes_stays_in_the_ring` stays as written: its loop moves and throws the string's free root with the ducks.
  - `test_tug.py`: `test_the_string_never_stretches_past_its_length` and `test_string_ends_are_where_the_physics_puts_the_sites` stay green as they are (the marker is still the ends' midpoint until Task 4).
- [ ] **Step 2:** `PYTEST tests/test_course.py tests/test_tug.py` → FAIL.
- [ ] **Step 3: Implement** `_add_string` from the study's `add_rope` (`mid`, `universal`) with the Pinned names and constants; `compile_tug`: `a`, `b` the two `string_end` sites at the STAND pose (`(w.x + ox, w.y + oy, SPAWN_HEIGHT_M + oz)`, `(e.x - ox, e.y - oy, SPAWN_HEIGHT_M + oz)`); after compile the string's key qpos is its `qpos0` (left zero, its free joint's quaternion would be invalid), then `_posed`. Docstrings: why each number (the study's table, a line each), never lowered.
- [ ] **Step 4:** Step 2's command → PASS; SUITE.
- [ ] **Step 5: Stability, the study's 40 bouts.** Write `SCRATCH/g-stability.py`: the bout loop of `run_bout` (`runner._start`, `sim.step`, `runner._reset_by_mujoco`, `tug._verdict` on the ducks' frames) recording per step the ends' distance (`string_end`/`duck1/string_end`), both tie errors (`string_end`↔`string/p0`, `duck1/string_end`↔`string/p16`) and any reset; one JSON line per bout. Bouts: entry against `reference_duck(TUG)`, west on odd seeds: `reference`, `ONNX/t10-500.onnx`, `ONNX/t9r-1000.onnx`, `ONNX/t9r-500.onnx` × seeds 1–5; `ONNX/t1-0.onnx`, `t4-1000`, `t11-750`, `t12-500`, `t6-500` × seeds 1–4. Run it (`cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen python SCRATCH/g-stability.py`, foreground, ~4 min). Expected: 0 resets, max gap ≤ 1.0030 m, max tie error ≤ 0.010 m (study: 1.0024 m, 7.0 mm). A miss stops the task: report, never retune.
- [ ] **Step 6:** commit `arena/course.py` and the two tests: `"The string is a real rope: sixteen 6 mm capsules, 80 g, tied neck to neck, sagging, stepped on, never through a body"`.

---

### Task 4: The judge reads the string's middle, and every bout keeps its string

**Files:** Modify `arena/runner.py`, `arena/tug.py`, `arena/trace.py`, `arena/evaluate.py`, `arena/web/routes_submit.py`, `arena/cli.py`, `arena/recover.py`, `arena/match.py`, `arena/cupworker.py`, `arena/moments.py`, `arena/commentary/show.py`; tests `tests/test_tug.py`, `test_trace.py`, `test_evaluate.py`, `test_routes_submit.py`, `test_cli.py`, `test_match.py`, `test_cupworker.py`, `test_moments.py`, `test_commentary_show.py`, `test_course.py` (the tendon-era `test_string_ends…` moves here as a sites test).

**Interfaces:**
- Consumes: Task 3's `string_sites`, `STRING_SEGMENTS`.
- Produces: `runner._start(manifest, model, policies, yaws_deg, seed, commands, sites=()) -> (sim, settle, settle_points)` (`settle_points` (settle steps + 1, len(sites), 3); `run_once`, `run_stage` take `sim, settle, _`); `_Sim(model, data, ducks, sites=())`, `_Sim.points(out)`; `tug.py` per the Pinned names, `_verdict(trace, string, final)`, `BoutOutcome(seed, loser, how, time_s, trace, settle, string, string_settle)`, `bout_score_cm(outcome, entry, pit_bonus_cm)`; `string_ends` removed; `trace.encode(trace, settle=None, string=None, string_settle=None)`, `trace.decode_string(blob) -> tuple[np.ndarray, np.ndarray]` ((string_settle, string) float32; `ValueError("this trace holds no string")` without one); `Evaluation.string`, `Evaluation.string_settle` (`None` but on a tug); `MatchOutcome.traces` = `(trace, settle, string, string_settle)` per bout; `moments(trace, string, course)`.

- [ ] **Step 1: Failing tests.** A test helper in `tests/test_tug.py`, imported by the others as `bout_trace` already is:

```python
def straight(trace):
    """A string laid straight between the two trunks of every frame, (frames, 17, 3): its middle is their midpoint."""
    w, e = trace[0, :, None, 0:3], trace[1, :, None, 0:3]
    return w + (e - w) * np.linspace(0.0, 1.0, 17)[None, :, None]

def test_the_marker_is_the_strings_middle_point():
    s = np.zeros((2, 17, 3)); s[:, 8, 0] = [0.07, -0.02]; s[:, 7, 0] = 9.0
    assert list(marker_x(s)) == pytest.approx([0.07, -0.02]) and (STRING_POINTS, MIDDLE) == (17, 8)

def test_the_judge_reads_the_pit_then_the_strings_middle():
    base = np.array([[frame((-0.6, 0, 0.1), WEST)], [frame((0.6, 0, 0.1), EAST)]])
    assert _verdict(base, straight(base), final=False) is None
    east_in = base.copy(); east_in[1, 0, 2] = -0.1
    assert _verdict(east_in, straight(east_in), final=False) == (1, "pit")
    both = base.copy(); both[:, 0, 2] = -0.1
    pulled = straight(both); pulled[:, 8, 0] = -0.03                      # the middle west, the ends' midpoint at 0
    assert _verdict(both, pulled, final=False) == (1, "marker")
    assert _verdict(base, straight(base), final=True) == (None, "draw")
    sagging = straight(base); sagging[:, 8, :] = [0.02, 0.0, -0.11]       # dipped into the pit, east of the line
    assert _verdict(base, sagging, final=True) == (0, "marker")

def test_a_bout_records_its_string_every_step_and_the_settle_before():
    out = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert out.string.shape == (out.trace.shape[1], 17, 3) and out.string_settle.shape == (26, 17, 3)
    assert np.linalg.norm(out.string[:, 0] - out.string[:, 16], axis=1).max() <= 1.005
    again = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    np.testing.assert_array_equal(again.string, out.string)
```
  - `test_tug.py`: the score and status tests build `BoutOutcome(..., trace, settle, straight(trace), np.zeros((26, 17, 3)))`, call `bout_score_cm(outcome, e, 100.0)`, same numbers; the explosion test asserts `out.string.shape == (10, 17, 3)`; the stretch test reads `out.string[:, 0]`, `[:, 16]`; the `string_ends` tests go; `test_course.py` gains `test_the_strings_ends_sit_on_the_necks_at_the_start` (in `_standing`, `string/p0`, `string/p16` on `string_end`, `duck1/string_end` within 1e-9).
  - `test_trace.py`: `test_a_tugs_string_round_trips_beside_its_ducks` (shapes (2,5,21), (2,26,21), (5,17,3), (26,17,3); `decode_string` gives back `(string_settle, string)` to float16 accuracy); `test_a_trace_without_a_string_says_so` (`pytest.raises(ValueError, match="no string")`).
  - `test_evaluate.py`: the fake `run_bout` returns `straight(bout_trace(x, pit))` strings and 26-frame settles; `result.string.shape == (1, 17, 3)` and `result.string_settle.shape == (26, 17, 3)` for the traced seed 4; a race's `result.string is None`.
  - `test_routes_submit.py::test_a_tug_entry_stores_its_bout_and_string` and `test_cli.py`'s tug test: the stored blob's `decode_string` has `string.shape[1:] == (17, 3)` and as many frames as `decode(blob).shape[1]`.
  - `test_match.py::test_a_real_match_plays_the_same_twice` compares all four arrays per bout; `test_cupworker.py::test_a_matchs_bout_file_holds_its_string`: `decode_string(files["bouts/<id>-0.npz"])[1].shape[1:] == (17, 3)`.
  - `test_moments.py` passes `straight(t)` (the trunks' midpoint is the old `ZERO`-offset marker: same expected moments; `ZERO` goes); `test_commentary_show.py`'s stored bouts carry `straight(...)` strings.
- [ ] **Step 2:** `PYTEST tests/test_tug.py tests/test_trace.py tests/test_evaluate.py tests/test_routes_submit.py tests/test_cli.py tests/test_match.py tests/test_cupworker.py tests/test_moments.py tests/test_commentary_show.py tests/test_course.py` → FAIL.
- [ ] **Step 3: Implement.**
  - `runner.py`: `_start` records `sites` into `settle_points` beside `settle`; `_Sim.points(out)` = `out[:] = data.site_xpos[sites]`; a lone duck and a stage pass none (bit-identical).
  - `tug.py`: `run_bout` passes `string_sites(model)`, records `sim.points(string[step])` after `sim.record`, cuts `string` as `frames` (a reset leaves its frame out of both); `_verdict` and `bout_score_cm` read `marker_x(string[-1:])[0]`; `string_ends` goes; the docstring: the string is a rope, the marker its middle point.
  - `trace.py`: `encode` validates `string`/`string_settle` as `(frames, 17, 3)` (`ValueError(f"{name} must be (frames, 17, 3), got {shape}")`) and writes them float16 when given; `decode_string` per Interfaces. Module docstring: a tug's file carries its string; the key is the version, races and performances are as they were.
  - `evaluate.py`: `Evaluation.string`, `.string_settle` (defaults `None`); `_evaluate_rating` fills them from the traced bout; `bout_score_cm` without offset. The three writers (`routes_submit.py`, `cli.py`, `recover.py`) encode `result.string, result.string_settle`.
  - `match.py`: `traces.append((outcome.trace, outcome.settle, outcome.string, outcome.string_settle))`; its type comment. `cupworker.py`: `encode(*frames)`.
  - `moments.py`: `moments(trace, string, course)`, `x = marker_x(string)`; `show.py` `match_footage`: `_, string = decode_string(blob)`, `moments(trace, string, manifest.course)`, the `string_offset` import goes.
- [ ] **Step 4:** Step 2's command → PASS; SUITE; `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && rtk proxy grep -rnI "string_ends\|string_offset" arena` prints only `course.py` (the site and `tug_layout`).
- [ ] **Step 5 (indicative):** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen arena score ONNX/t10-500.onnx --event tug-of-war` → five bout lines, `rating: X.X cm · replay from seed n` (any value: the format is the check).
- [ ] **Step 6:** commit the 11 sources and 10 tests: `"The marker is the string's middle point, and every bout keeps the string's seventeen points, settle included, beside its ducks"`. Tell the controller: Plan H may start.

---

### Task 5: The string is served, for pages, clips and the workshop

**Files:** Modify `arena/web/routes_read.py`, `arena/web/routes_cups.py`, `arena/workshop/evaluations.py`, `app/src/api.js`, `app/src/workshop/api.js`; tests `tests/test_routes_trace.py`, `test_routes_cups.py`, `tests/workshop/test_evaluations.py`, `app/src/api.test.js`, `app/src/workshop/api.test.js` (create either if absent, beside its module).

**Interfaces:**
- Consumes: Task 4's `decode_string`.
- Produces: the Pinned routes via `points_response(settle, string) -> Response` (routes_read.py; 404 `f"run {run_id} has no string"` when `decode_string` raises); a tug checkpoint's body gains `string_b64` (the timed string, little-endian float32), `FORMAT = 3`; JS `getString(runId) -> Promise<{settle: Float32Array, trace: Float32Array}>`, `getBoutString(matchId, k)` (same), workshop `getCheckpoint` returns `string` (Float32Array) when `string_b64` is there.

- [ ] **Step 1: Failing tests.**

  - `test_routes_trace.py::test_a_tugs_string_is_served_settle_first_then_timed`: a tug run stored with `encode(trace (2, 3, 21), settle (2, 2, 21), string (3, 17, 3), string_settle (2, 17, 3))` (string values `arange`, so the order shows): `GET /api/runs/<id>/string` has `X-Frame-Count` `"3"`, `X-Settle-Frame-Count` `"2"`, `X-Point-Count` `"17"`, `5 * 51 * 4` bytes whose first 102 floats are the settle's; a sprint run's `/string` is a 404 whose detail names the run.
  - `test_routes_cups.py`: a match's `/bouts/0/string` is a 404 before its reveal and 51-float frames after, as its `/trace` is.
  - `tests/workshop/test_evaluations.py::test_a_tug_checkpoint_is_rated_against_the_reference`: `len(b64decode(body["string_b64"])) == frames * 51 * 4` (frames = the trace's) and `body["format"] == 3`; a sprint checkpoint has no `string_b64`.
  - `api.test.js`: `getString("R1")` on a fake fetch of 5 frames with `X-Settle-Frame-Count: 2` resolves `{settle, trace}` of lengths 102 and 153; `workshop/api.test.js`: a body with `string_b64` gives `string.length === frames * 51`.
- [ ] **Step 2:** `PYTEST tests/test_routes_trace.py tests/test_routes_cups.py` and `PYTEST tests/workshop/test_evaluations.py`; `VITEST src/api.test.js src/workshop/api.test.js` → FAIL.
- [ ] **Step 3: Implement** the two routes (`/runs/{run_id}/string` after `_find_run`; `/matches/{match_id}/bouts/{k}/string` through `_bout_file`), `points_response`, `string_b64` (only when `result.string is not None`), `FORMAT = 3` with its comment (3: a tug's checkpoint carries its string); `api.js` `points(path)` splitting at `X-Settle-Frame-Count × 51`.
- [ ] **Step 4:** Step 2's commands → PASS; SUITE.
- [ ] **Step 5:** commit the 5 sources and the tests: `"A tug's string is served beside its ducks, settle first, for its run, each bout of a match and a workshop checkpoint"`.

---

### Task 6: The string is drawn as it lay, the ribbon at its middle

**Files:** Modify `app/src/tug.js`, `tug.test.js`, `viewer.js`, `cast.js`, `cast.test.js`, `bouts.js`, `bouts.test.js`, `run.js`, `race.js`, `match.js`, `match.test.js`, `clip/main.js`, `workshop/job.js`, `workshop/job.test.js`; `arena/web/routes_read.py`, `tests/test_routes_read.py` (the summary's `string_offset` goes).

**Interfaces:**
- Consumes: Task 5's `getString`, `getBoutString`, the checkpoint's `string`.
- Produces in `tug.js`: `STRING_WIDTH = 51`, `MIDDLE = 8`, `stringAt(string, f) -> Float32Array` (frame `f`'s 51 floats), `tugString(entry, lead) -> Float32Array` (a lane's string from where its ducks stand: its settle's LAST `lead` frames, its first frame held when shorter or absent, then its trace), `buildString() -> {group, update(points), dispose()}`, `ratingLane(traces, settles, string, {traceSeed, livery, name})` (the lane's `string: {trace, settle?}`, `settle` only when `string.settle` is given); `stringEnd`, `tugEnds` removed. `boutLane(match, k, traces, settles, string)`, `replayLane(event, cast, traces, lane, string)`.

- [ ] **Step 1: Failing tests.**

```js
// tug.test.js
it("tugString keeps its settle's last frames, so a string led in with cut duck settles stays in step", () => {
  const f = (v) => new Float32Array(51).fill(v);
  const cat = (...a) => Float32Array.from(a.flatMap((x) => [...x]));
  expect([...tugString({ string: { settle: cat(f(1), f(2), f(3)), trace: cat(f(9)) } }, 2)]).toEqual([...cat(f(2), f(3), f(9))]);
  expect([...tugString({ string: { trace: cat(f(9)) } }, 2)]).toEqual([...cat(f(9), f(9), f(9))]);
  expect([...stringAt(cat(f(1), f(2)), 1)]).toEqual([...f(2)]);
});
it("draws the string through its points, the ribbon on point 8", () => {
  const s = buildString();
  const points = new Float32Array(51).map((_, i) => (i % 3 === 0 ? -0.5 + (i / 3) / 16 : i % 3 === 2 ? 0.1 : 0));
  s.update(points);
  const rope = s.group.getObjectByName("string"), ribbon = s.group.getObjectByName("marker");
  expect(ribbon.position.toArray()).toEqual(toThree([0, 0, 0.1]));
  rope.geometry.computeBoundingBox();
  expect(rope.geometry.boundingBox.min.x).toBeCloseTo(-0.504, 3);
  expect(rope.geometry.boundingBox.max.x).toBeCloseTo(0.504, 3);
  s.dispose();   // geometry and material freed, the group off its parent
});
// ratingLane: the existing cases gain a string `{ trace: "st" }` → lane.string === { trace: "st" }; with settles given and string.settle "ss" → { trace: "st", settle: "ss" }
// bouts.test.js: boutLane(match, k, traces, settles, { trace: "st", settle: "ss" }).string deep-equals it
// cast.test.js: replayLane(TUG, …, { ...lane, traceSeed: 4 }, { trace: "st" }).string deep-equals { trace: "st" }
// match.test.js and job.test.js: setLanes is called with a lane carrying the fetched / decoded string
```
- [ ] **Step 2:** `VITEST src/tug.test.js src/bouts.test.js src/cast.test.js src/match.test.js src/workshop/job.test.js` → FAIL.
- [ ] **Step 3: Implement.**
  - `tug.js`: `buildString` keeps the ink material, a `CatmullRomCurve3` through `toThree` of the 17 points, a new `TubeGeometry(curve, 64, 0.004, 6)` per `update`, the old one disposed; the ribbon at point 8; the header comment (the string as recorded, not a line between two necks). `tugString` per Interfaces.
  - `viewer.js`: a tug's `tug = { event, rope: buildString(), string: tugString(entries[0], ducks[0].lead) }` (the raw entry, before `tugDucks` maps it); `draw` updates `tug.rope` with `stringAt(tug.string, i)` at the frame index the ducks are drawn at (the same clamp); `tugEnds` goes.
  - `routes_read.py`: the tug summary drops `string_offset` (`test_a_tug_serves_its_course_and_its_bouts` asserts it absent).
  - Callers fetch and pass the string: `run.js` and `race.js` (`getString(id)` beside `getTrace(id)`, cached alike; a page passes `{trace}` only, as it passes no settles), `match.js` (`getBoutString` beside the bout's trace and settle; settle passed), `clip/main.js` (rated run: `getString(run_id)` with its settle; match: `getBoutString` per bout), `workshop/job.js` (`{trace: body.string}`).
- [ ] **Step 4:** Step 2's command → PASS; VITEST; `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && rtk proxy grep -rnI "tugEnds\|stringEnd\|string_offset" app/src` prints nothing; `npm run build` in `app`.
- [ ] **Step 5:** SUITE; commit the 16 files: `"The string is drawn as it lay, sagging, stepped on, dipping into the pit, the red ribbon on its middle point"`.

---

### Task 7: The venue's ring is the physics' ring

**Files:** Modify `app/src/tug-venue.js`, `tug-venue.test.js`, `viewer.js` (a comment).

**Interfaces:** Consumes the served `ring_m`, `ropes`, `posts`, `pit_m`, `pit_depth_m`. Produces `buildTugVenue(event, spectators, reachy, branding, clearance)` drawing the ropes and posts from the served capsules; the constants `RING`, `ROPES`, `ROPE_RADIUS`, `POST_RADIUS` go (`RING_RISE`, `APRON`, the stands, the truss and the lights stay: decor tuned round the 3 m ring).

- [ ] **Step 1: Failing tests** in `tug-venue.test.js` (the served fixture is Task 2's summary: 12 ropes, 4 posts):

```js
it("draws the ring's ropes and posts where the physics has them", () => {
  const venue = buildTugVenue(TUG, spectators, reachy, branding, 2.5);
  const box = (name) => new Box3().setFromObject(venue.group.getObjectByName(name));
  expect(box("ropes").max.y).toBeCloseTo(0.18 + 0.006, 6);
  expect(box("ropes").min.y).toBeCloseTo(0.06 - 0.006, 6);
  expect(box("ropes").max.x).toBeCloseTo(1.5 + 0.006, 3);
  expect(box("posts").max.y).toBeCloseTo(0.23, 6);
  expect(box("ring").max.x).toBeCloseTo(1.5 + APRON, 6);
  venue.dispose();
});
it("follows a ring of another size", () => {
  const venue = buildTugVenue(widerRing(TUG, 3.6), spectators, reachy, branding, 2.5);   // ring_m 3.6, ropes and posts moved out
  expect(new Box3().setFromObject(venue.group.getObjectByName("ropes")).max.x).toBeCloseTo(1.8 + 0.006, 3);
});
```
  (`APRON` is exported for the test; `widerRing(event, ring)` in the test file rebuilds the served `ropes` and `posts` for another `ring_m` with Task 2's arithmetic.)
- [ ] **Step 2:** `VITEST src/tug-venue.test.js` → FAIL.
- [ ] **Step 3: Implement:** the canvas `ring_m + 2 * APRON` square, its pit cut `pit_m` × `ring_m`; the merged `ropes` from the served capsules (each a `strut(from, to, radius, 8)` in three.js coordinates via `toThree`); the posts and their pads at the served posts; the header comment drops "the lane under them is still the event's length".
- [ ] **Step 4:** VITEST; `npm run build` in `app`.
- [ ] **Step 5:** commit the 3 files: `"The venue draws the ring's ropes and posts where the physics puts them, the canvas as wide as the ring"`.

---

### Task 8: Suites, a local rehearsal on the ring, the card re-shot

**Files:** whatever the rehearsal shows wrong (a failing test in the owning file, the fix, a commit each); `app/public/cards/tug-of-war.webp` (LFS). Scratch only: `SCRATCH/g-store`, `SCRATCH/g-cup`, screenshots.

- [ ] **Step 1:** SUITE; `npm run build` in `app`.
- [ ] **Step 2: Rate the stand-ins** against t7-250 on the new physics, one foreground call each: `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen arena score <onnx> --event tug-of-war --user <user> --name <name> --livery <livery> --store SCRATCH/g-store` for `ONNX/t7-250.onnx` (nico, charcoal), `ONNX/t10-500.onnx` (bob, purple), `ONNX/t9r-1000.onnx` (ann, blue). Expected: five bout lines and a rating each, `recorded <run id>`; note the three ratings.
- [ ] **Step 3: Look at it.** `ARENA_FRONTEND=/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app/dist /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/.venv/bin/arena serve --store SCRATCH/g-store --port 8765` with `run_in_background`; each view with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1440,1000 --virtual-time-budget=15000 --screenshot=SCRATCH/<name>.png "<url>"`, each PNG Read:
  - `#/r/<bob's run>`: the ring and its ropes, the dark venue, two ducks, the string sagging between the necks (not a straight line), the ribbon on it, no halo under the feet.
  - `#/e/tug-of-war`: the course fact "3 m ring, 0.3 m pit".
  - `clip.html?run=<bob's run>&layout=landscape&frame=30`, `frame=757`, `frame=1243`; `layout=vertical` at `--window-size=1080,1920`: the string follows the ducks from the settle on, never a frame behind.
  - Stop the server.
- [ ] **Step 4: A cup's match on the ring.** Plan C Task 14's Steps 3–4 into `SCRATCH/g-cup` (users nico, ann, bob as in Step 2, and cat: `ONNX/t12-500.onnx`, classic): the cup computed with a fake clock. Then, on `arena.cli._app_on_loopback(store, reveal_all=True)` as Plan C Task 14 Step 5's `stub_clips.py` serves it, screenshot `clip.html?match=tug-of-war-0001-000&layout=landscape&frame=900`: both ducks, the bout's string drawn as it lay, the ribbon at its middle, the ring.
- [ ] **Step 5: Re-shoot the card** from bob's clip page at frame 757 with Plan A Task 12's card recipe (`.superpowers/sdd/2026-10-19-versus-a-tug-and-bench/task-12-report.md`): the page narrowed to 1166×1080, a fixed camera holding both ducks, the string and the ring's near ropes (`[-0.73, 0.42, 1.1] → [0.05, 0.17, 0]` fov 42 to start from), overlays hidden, plates wiped, 720×667, `cwebp -q 82` → `app/public/cards/tug-of-war.webp`. Rebuild, serve, screenshot `#/`, Read it. `GIT add app/public/cards/tug-of-war.webp`; commit `"The Tug of War's card shows a bout in the ring: two ducks on a sagging string over the pit"`.
- [ ] **Step 6: Report:** the three ratings, the screenshot paths, each fix, anything for the owner.

---

### Task 9: The upright reference replaces t7-250 (with Plan H Task 6, one sitting)

**Files:** Create `arena/assets/policies/tug-reference-<run>-<N>.onnx` (Plan H's name, e.g. `tug-reference-t13-500.onnx`); delete `arena/assets/policies/tug-reference-t7-250.onnx`; modify `arena/assets/PROVENANCE.md`, `tests/test_assets.py`, `arena/events/tug-of-war.toml`, `docs/guides/challenges/tug-of-war.md`, `docs/superpowers/plans/2026-10-19-versus-interfaces.md`, the tests that name the old file or its sha.

**Interfaces:** Consumes Plan H Task 6's hand-over: `<wt>/logs/tug_of_war/onnx/<run>-<N>.onnx`, its sha256, its repo, recipe commit, date. Produces `[rating] reference = "tug-reference-<run>-<N>.onnx"`, `tests.test_assets.REFERENCE_SHA256` = its sha.

- [ ] **Step 1: Failing test:** `test_the_tug_reference_duck_is_<run>_<N>_byte_for_byte` replaces the t7-250 one, the new name and sha.
- [ ] **Step 2:** `PYTEST tests/test_assets.py` → FAIL.
- [ ] **Step 3:** `cp` the hand-over ONNX into `arena/assets/policies/`; `GIT rm` the t7-250 file; the toml's `[rating] reference`; `PROVENANCE.md`'s reference table (repo, checkpoint, recipe commit, sha256, date; "trained upright on the ring and the rope, warm-started from t7-250 and against it; replaces t7-250, owner 2026-10-21: every rating changed"); the guide's "## Rating": `…a frozen policy that stays on its feet, walks backwards and pulls the string taut.`; the contract's reference name.
- [ ] **Step 4:** `rtk proxy grep -rnI "t7-250\|t7_250" arena tests app/src docs/guides` prints only PROVENANCE's history line; SUITE (tests that rated against the reference by value: their numbers are re-measured, never loosened).
- [ ] **Step 5: Challenges sitting:** Plan H Task 6 Steps 2–5 (its `reference.onnx` = these bytes); CHALLENGES green.
- [ ] **Step 6:** commit: `"The Tug of War's reference duck stays on its feet: <run>-<N>, trained upright on the ring and the rope, replaces t7-250 and every rating with it"`; `GIT lfs ls-files` lists the new file.
- [ ] **Step 7:** Task 8's Steps 2–3 again against the new reference (ratings recomputed); report them.

---

## Self-review (amended spec, contract)

- Decision 1 (rope): Tasks 3 (measured physics, 40-bout check), 4 (middle point, recorded every step), 5–6 (served; drawn on pages, clips, match pages, workshop; the live airs the clips). Decision 2 (ring): Tasks 1, 2, 7. Decision 3: Task 9; the rating's definition untouched; t7-250 rates until then. My calls: Global Constraints, Tasks 2–4. Cross-repo: the Order line.
- Types used alike across Tasks 4–6: `BoutOutcome`'s 8 fields, `decode_string → (string_settle, string)`, `MatchOutcome.traces` 4-tuples, `ratingLane`/`boutLane`/`replayLane` with `string`, `tugString(entry, lead)`.
