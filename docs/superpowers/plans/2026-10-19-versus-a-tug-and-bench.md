# Versus A — the Tug and the Pulling Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A policy entered on the new `tug-of-war` event is rated on the pulling bench (the mean force in newtons it held against a winch over five seeds, higher wins) and gets a board place, points, commentary, a page and a clip like a race; the bout and match physics the weekly cup plays exist and are tested.

**Architecture:** The event is data (`arena/events/tug-of-war.toml`; `Tug`, `Bench`, `BoutRules` in the manifest). `arena/course.py` compiles the race lane cut by a pit, the string a MuJoCo spatial tendon (neck to neck for a bout, neck to a tendon-motor winch for the bench), on the troupe helpers `compile_stage` now shares. `arena/tug.py` runs bench and bout on the runner's `_start`; `arena/match.py` plays a match; `evaluate` makes five bench runs a rating, and every "lower is better" sort reads `higher_wins`. The site draws string, marker and dial from the trace (`app/src/tug.js`).

**Tech Stack:** Python 3.12, MuJoCo 3.10 (`MjSpec` sites, spatial tendon, tendon motor), FastAPI, pytest; vanilla JS + three.js 0.169, vitest + jsdom; headless Chrome (puppeteer), ffmpeg, cwebp.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md` · **Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md` (§ Plan A — names).

## Global Constraints

All of docs/superpowers/plans/2026-10-19-versus-interfaces.md § Global constraints apply. Plan-specific:

- `<W>` = `/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`, `<S>` = the executing session's scratchpad: write both out in full in every command (no shell variables).
- A commit step written `add <paths>` · `"<message>"` means `/usr/bin/git -C <W> add <paths>` then `/usr/bin/git -C <W> commit -m "<message>"` (unsigned, as Task 1 writes it out).
- One Python file: `cd <W> && uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/<file>.py`. One front file: `cd <W>/app && npx vitest run src/<file>.test.js`. Foreground, `timeout: 600000`.
- The word `category` never appears in `arena/evaluate.py`, `arena/points.py`, `arena/store.py` (`test_manifest.py` greps for it): code knows a tug by `course.kind == "tug"` or `higher_wins(event_id)`.
- **`bench_force` is clamped to the top** (contract): `min(top_n, max(0.0, ramp_n_per_s·t + Σ amp·sin(2π·hz·t + phase)))`. Unclamped, the sum reaches `top_n + 2·jerk_n`, and a duck dragged in at the top would outscore one that held (`top_n`). Nothing asks it during the settle: the runner sets the winch on timed steps only; the page asks `forceAt`, 0 before the lead-in ends.
- **A fall loses** (owner, 2026-10-20; contract § Plan A, "A duck is OUT"): measured on this plan's prototype, a zero-action duck falls flat and holds the winch to 5–6 N on body friction, more than a standing duck pulling at the neck holds before tipping; without the rule falling would be the best strategy. A duck is out in the pit, or when `stage.fell_at` holds over its last `round(fall_hold_s / CTRL_DT)` frames (the Arena's rule, reused): the bench run ends with `status "fall"` at that step's force, a bout is lost by `"fall"`.
- Pinned: `PIT_DROP_M = 0.05`; tests' string tolerance 0.01 m; a commentary gap under 0.25 N is "close"; the TOML as the contract prints it.
- Words: the bench's score is a **rating** in **N** (`4.21 N`); board column `rating`; run page label `rating · N`, stamp `RATED`; clip stamp `HELD ON` (the replayed seed held), `PULLED IN` (into the pit) or `KNOCKED DOWN` (it fell), each a pass; round card `Pull!` on lime; the participant is "pulling with" a policy.
- Settled by the owner (2026-10-20): those stamp words, the lime round card with `Pull!` and its placeholder art (Task 12), and a bench clip of about 35 s for a duck that holds (the 30 s tape with its title and outro; a duck that goes out early gives a shorter one).
- Tug lanes for `viewer.setLanes` (one per call; contract): `{tug: "bench", trace, settle?, bench, livery, name}` or `{tug: "bout", ducks: [{trace, settle?, livery, name}, {…}]}`, west first; an optional `settle` (Float32Array) plays before `trace`.
- API beyond the race's (contract): a tug's board rows carry `bench`; a player's publications carry `metric`; the submit answer carries the event's `metric` (the publish CLI's tug line reads it, Plan B's Task 13).
- Sites that need nothing for a tug: `hub_fetch.py:198` (the rig check: a tug is legs, checked like a race), `hub_fetch.py:299` and `routes_submit.py:288` (timelines and casts are a stage's), `workshop/challenges.py:141` (`is_stage`).

## Review Focus

1. **Legacy policies flooding the tug.** A Hub manifest without `event` is recovered onto every event of its rig: at the first boot after release every old legs walker would be re-raced on the bench and land on the tug board, so in the first cup. Recovery's fallback skips the tug (Task 5).
2. **A sprint walker entered on the tug.** The bench must rate it (it walks into the pit or falls in seconds) and the submit route answer (Tasks 3, 5).
3. **Falling must never pay.** A limp duck lying on the platform holds the winch on body friction: the bench ends its run at the fall with a small force, a bout counts it out, and both use the Arena's rule (`stage.fell_at`), not a copy (Task 3: `test_a_duck_that_does_nothing_falls_and_is_out_at_a_small_force`, `test_the_judge_reads_the_pit_a_fall_then_the_marker`, `test_two_ducks_that_do_nothing_fall_and_the_bout_is_decided_the_same_way_every_time`).
4. **A duck that holds every seed:** score exactly `top_n`, full 30 s traces, replay from seed 3, board ties to the earlier entry (Tasks 5, 6).
5. **Stored races and race answers byte-for-byte unchanged:** an exact JSON round-trip; no `force_n` in a race's seeds, no `bench` on its rows; the submit answer only gains `metric` (Tasks 5, 6).
6. **Direction wherever a best or a leader is picked:** board, standing, own best, podium, commentary gap and personal best, the time milestone (4.2 N is not "under 5 s"), the workshop's best checkpoint and bars (Tasks 6, 7, 11).

---

### Task 1: The tug-of-war event and its manifest

**Files:**
- Create: `arena/events/tug-of-war.toml` (the contract's text)
- Modify: `arena/manifest.py`, `arena/evaluate.py`, `arena/web/routes_read.py`
- Test: `tests/test_manifest.py`, `tests/test_evaluate.py`, `tests/test_routes_read.py`, `tests/test_commentary_notable.py`

**Interfaces:**
- Produces (contract): `CATEGORIES`, `METRICS`, `COURSE_KINDS`, `HIGHER_WINS`, `Tug`, `Bench`, `BoutRules`, `Manifest.bench`/`.bout` (`= None`, after `clip`), `higher_wins(event_id) -> bool`; `SeedResult(seed, status, time_s, force_n: float | None = None)`; `mean_hold_force(per_seed, time_limit_s) -> float`.

- [ ] **Step 1: Worktree.** From the main checkout: `/usr/bin/git worktree add .claude/worktrees/versus -b versus main`; `cd <W> && uv sync --no-config --frozen --extra dev && (cd app && npm ci)`. Run both Python calls and `npm test`; note the pass counts.

- [ ] **Step 2: Failing tests.** `tests/test_manifest.py`:

```python
from arena.manifest import Bench, BoutRules, Tug, higher_wins

TUG = {
    "root": GOOD["root"].replace('category="race"', 'category="versus"').replace('"mean_finish_time"', '"mean_hold_force"'),
    "course": '[course]\nkind="tug"\nlength_m=4.0\nwidth_m=0.8\nwall_height_m=0.15\npit_m=0.3\npit_depth_m=0.3\nstring_m=1.0\n',
    "sweep": '[bench]\nramp_n_per_s=0.25\ntop_n=7.0\njerk_n=0.4\njerk_hz=[0.7, 1.9]\n'
             '[bout]\ntime_limit_s=20.0\nbouts_to_win=2\nmax_bouts=5\n',
}

def test_the_tug_of_war_loads(tmp_path):
    m = load_event("tug-of-war")
    assert m.course == Tug(4.0, 0.8, 0.15, 0.3, 0.3, 1.0)
    assert m.bench == Bench(0.25, 7.0, 0.4, (0.7, 1.9)) and m.bout == BoutRules(20.0, 2, 5)
    assert (m.category, m.metric, m.rig, m.time_limit_s) == ("versus", "mean_hold_force", "legs", 30.0)
    assert m.sweep is None and m.vote is None and m.command[:3] == (-0.3, 0.0, 0.0)
    assert load_manifest(write_manifest(tmp_path, **TUG)).course.kind == "tug"

@pytest.mark.parametrize("change, complaint", [
    ({"root": TUG["root"].replace('"versus"', '"race"')}, "goes with"),
    ({"root": TUG["root"].replace('"mean_hold_force"', '"mean_finish_time"')}, "goes with"),
    ({"course": GOOD["course"], "sweep": GOOD["sweep"]}, "goes with"),
    ({"sweep": TUG["sweep"].split("[bout]")[0]}, r"needs \[bout\]"),
    ({"sweep": "[bout]" + TUG["sweep"].split("[bout]")[1]}, r"needs \[bench\]"),
    ({"sweep": TUG["sweep"] + GOOD["sweep"]}, r"no \[sweep\]"),
    ({"sweep": TUG["sweep"] + "[vote]\nballot_min=2\nballot_max=4\nwindow_days=7\nper_day=3\n"}, r"no \[vote\]"),
    ({"root": TUG["root"].replace('rig="legs"', 'rig="rollers"')}, "rig 'legs'"),
    ({"course": TUG["course"] + "slope_deg=0.0\n"}, "unknown keys"),
    ({"sweep": TUG["sweep"].replace("jerk_n=0.4", "jerk_n=0.4\nspring=1")}, "unknown keys"),
    ({"sweep": TUG["sweep"] + "draws=1\n"}, "unknown keys"),
    ({"sweep": TUG["sweep"].replace("max_bouts=5", "max_bouts=2")}, "max_bouts"),
])
def test_a_malformed_tug_is_refused(tmp_path, change, complaint):
    with pytest.raises(ManifestError, match=complaint):
        load_manifest(write_manifest(tmp_path, **(TUG | change)))

def test_only_a_tug_takes_a_bench_or_bouts(tmp_path):
    with pytest.raises(ManifestError, match="only a tug"):
        load_manifest(write_manifest(tmp_path, sweep=GOOD["sweep"] + TUG["sweep"]))

def test_higher_wins_reads_the_events_metric():
    assert higher_wins("tug-of-war") and not any(map(higher_wins, ("sprint-2m", "got-a-talent", "no-such-event")))
```

  Also: `"tug-of-war": "versus"` in `EXPECTED_CATEGORIES`, `"tug-of-war"` last in the programme order. `tests/test_routes_read.py`: `"tug-of-war"` in `test_events_lists_the_whole_programme`, and

```python
def test_a_tug_serves_its_course_bench_and_bouts(client):
    api, _ = client
    tug = next(e for e in api.get("/api/events").json()["events"] if e["id"] == "tug-of-war")
    assert (tug["course"], tug["category"], tug["metric"]) == ("tug", "versus", "mean_hold_force")
    assert [tug[k] for k in ("length_m", "width_m", "string_m", "pit_m", "pit_depth_m")] == [4.0, 0.8, 1.0, 0.3, 0.3]
    assert tug["bench"] == {"ramp_n_per_s": 0.25, "top_n": 7.0}
    assert tug["bout"] == {"time_limit_s": 20.0, "bouts_to_win": 2, "max_bouts": 5}
    assert "sweep_lo" not in tug and "size_m" not in tug
```

  `tests/test_evaluate.py`: `mean_hold_force((SeedResult(1, "pit", 21.7, 4.0), SeedResult(2, "held", None, 7.0)), 30.0) == 5.5`. `tests/test_commentary_notable.py::test_leading_two_events_publishing_on_every_event_and_a_busy_day` (the tug is an open event now): add `tug = run("alice", 4.0, "2026-09-10T09:15:00Z", event="tug-of-war")` to `facts_for(mine, hill, roller, tug, first, second)` and expect `"@alice now leads 4 events at once: 1.5 m Hill Climb, 2 m Roller Sprint, 2 m Sprint, Tug of War."`.

- [ ] **Step 3: Run** the four files. Expected: FAIL (`ImportError: Tug`).

- [ ] **Step 4: Implement.**
  - `manifest.py`: the contract's dataclasses and constants; `_tug`, `_bench`, `_bout` parsers, each `_refuse_unknown` on its own keys; `_bout` refuses `max_bouts < 2 * bouts_to_win - 1` ("[bout] max_bouts must be at least 2 * bouts_to_win - 1"). In `load_manifest`, before the vote section: when `(kind == "tug") != (category == "versus")` or `!= (metric == "mean_hold_force")` raise "[course] kind 'tug' goes with category 'versus' and metric 'mean_hold_force'"; a tug refuses `rig != "legs"` ("a tug is for rig 'legs'"), `sweep` ("a tug takes no [sweep]"), `vote` ("a tug takes no [vote]") and needs `bench`, `bout` ("a tug needs [bench]", "a tug needs [bout]"); any other course with either raises "only a tug takes [bench] and [bout]". `higher_wins`: `@functools.cache`, the event's TOML exists and its metric is in `HIGHER_WINS`.
  - `evaluate.py`: `force_n` on `SeedResult`; `mean_hold_force` = `statistics.fmean(r.force_n …)` (`time_limit_s` is the registry's call shape); `METRICS["mean_hold_force"]`.
  - `routes_read.event_summary`: the `"course"` comment names `"tug"`; `if lane … elif stage … else` (tug): `length_m, width_m, string_m, pit_m, pit_depth_m`, `bench: {ramp_n_per_s, top_n}`, `bout: {time_limit_s, bouts_to_win, max_bouts}`.

- [ ] **Step 5: Run** the four files. Expected: PASS.

- [ ] **Step 6: Commit.** `/usr/bin/git -C <W> add arena/manifest.py arena/evaluate.py arena/web/routes_read.py arena/events/tug-of-war.toml tests/test_manifest.py tests/test_evaluate.py tests/test_routes_read.py tests/test_commentary_notable.py` · `/usr/bin/git -C <W> commit -m "The Tug of War is an event: a lane cut by a pit, a pulling bench rated in newtons and bouts, declared in its manifest"`

---

### Task 2: The tug course in the physics

**Files:**
- Modify: `arena/course.py`, `arena/web/routes_read.py`
- Test: `tests/test_course.py`, `tests/test_routes_read.py`

**Interfaces:**
- Consumes: `Tug`, `Manifest`; `timeline.Start`.
- Produces (contract): `STRING_SITE`, `STRING`, `WINCH_SITE`, `WINCH`, `PLATFORM_OVERRUN_M = 20.0`, `string_offset`, `tug_walls`, `pit_boxes`, `tug_layout`, `winch_position`, `compile_tug`. Private: `_troupe(manifest, layout, string_end=None) -> MjSpec`, `_posed(model, manifest, layout) -> MjModel`.

- [ ] **Step 1: Failing tests**, appended to `tests/test_course.py` (its existing tests stay unchanged: `test_a_troupe_of_one_compiles_to_a_lone_ducks_stage` and its neighbours prove `compile_stage` bit-identical after the split):

```python
from arena.course import compile_tug, pit_boxes, string_offset, tug_layout, tug_walls, winch_position
from arena.runner import _Addresses

TUG = load_event("tug-of-war")
names = lambda boxes: [n for n, _, _ in boxes]
numbers = lambda boxes: [v for _, pos, half in boxes for v in (*pos, *half)]

def _standing(model):
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    mujoco.mj_forward(model, data)
    return data

def test_the_course_geometry_of_the_tug():
    assert string_offset("legs") == (0.026, 0.0145, 0.0324215)
    assert names(tug_walls(TUG.course)) == ["wall_left", "wall_right"]
    assert numbers(tug_walls(TUG.course)) == pytest.approx([0, 0.425, 0.075, 2.0, 0.025, 0.075, 0, -0.425, 0.075, 2.0, 0.025, 0.075])
    assert names(pit_boxes(TUG.course)) == ["platform_west", "platform_east", "pit_floor"]
    assert numbers(pit_boxes(TUG.course)) == pytest.approx([-11.075, 0, -0.175, 10.925, 20.45, 0.175,
                                                            11.075, 0, -0.175, 10.925, 20.45, 0.175, 0, 0, -0.325, 0.15, 20.45, 0.025])
    west, east = tug_layout(TUG.course, 2)
    assert (west.x, west.y, west.yaw_deg, east.x, east.y, east.yaw_deg) == pytest.approx((-0.526, -0.0145, 0, 0.526, 0.0145, 180))
    assert tug_layout(TUG.course, 1) == [west]
    assert winch_position(TUG.course) == pytest.approx((0.5, 0.0, 0.1524215))

def test_a_tug_has_platforms_a_pit_and_walls_but_no_floor_plane():
    model = compile_course(TUG)
    with pytest.raises(KeyError):
        model.geom("floor")
    top = lambda name: model.geom(name).pos[2] + model.geom(name).size[2]
    assert [top(n) for n in ("platform_west", "platform_east", "pit_floor")] == pytest.approx([0.0, 0.0, -0.3])
    assert model.geom("wall_left").id >= 0

def test_a_bout_ties_neck_to_neck_with_a_string_of_its_length():
    model = compile_tug(TUG, 2)
    string = model.tendon("string").id
    assert model.nu == 28 and model.tendon_limited[string] and list(model.tendon_range[string]) == [0.0, 1.0]
    data = _standing(model)
    np.testing.assert_allclose(data.site_xpos[model.site("string_end").id], [-0.5, 0, 0.1524215], atol=1e-9)
    np.testing.assert_allclose(data.site_xpos[model.site("duck1/string_end").id], [0.5, 0, 0.1524215], atol=1e-9)
    assert data.ten_length[string] == pytest.approx(1.0, abs=1e-9)

def test_the_bench_runs_the_string_to_a_winch_that_pulls_towards_its_drum():
    model = compile_tug(TUG, 1)
    winch, string = model.actuator("winch").id, model.tendon("string").id
    assert model.nu == 15 and not model.tendon_limited[string] and model.actuator_gear[winch, 0] == -1.0
    assert model.actuator_trntype[winch] == mujoco.mjtTrn.mjTRN_TENDON and model.actuator_trnid[winch, 0] == string
    assert len(model.key("STAND").ctrl) == 15 and model.key("STAND").ctrl[winch] == 0.0  # one ctrl per actuator
    np.testing.assert_allclose(model.site("winch_drum").pos, winch_position(TUG.course), atol=1e-12)
    data = _standing(model)
    assert data.ten_length[string] == pytest.approx(1.0, abs=1e-9)
    data.ctrl[winch] = 5.0
    mujoco.mj_forward(model, data)
    assert data.qfrc_actuator[0] > 4.0  # the trunk's free x: towards the drum

def test_the_string_and_the_winch_leave_every_ducks_addresses_alone():
    same = lambda a, b: all(np.array_equal(getattr(a, f), getattr(b, f)) for f in ("qpos", "dof", "act", "gyro", "trunk", "free"))
    assert same(_Addresses.of(compile_tug(TUG, 1), "STAND", ""), _Addresses.of(compile_course(TUG), "STAND", ""))
    stage = compile_stage(TUG, [("legs", s) for s in tug_layout(TUG.course, 2)])
    assert all(same(_Addresses.of(compile_tug(TUG, 2), "STAND", p), _Addresses.of(stage, "STAND", p)) for p in ("", "duck1/"))
```

  `tests/test_routes_read.py::test_a_tug_serves_its_course_bench_and_bouts` adds: walls named `["wall_left", "wall_right"]`, pit named `["platform_west", "platform_east", "pit_floor"]`, `string_offset == [0.026, 0.0145, 0.0324215]`, `winch == pytest.approx([0.5, 0.0, 0.1524215])`.

- [ ] **Step 2: Run** `tests/test_course.py tests/test_routes_read.py`. Expected: FAIL (`ImportError: compile_tug`).

- [ ] **Step 3: Implement** in `arena/course.py`:
  - `string_offset`: `@functools.cache`; the `pos` of the `neck` body in the rig's MJCF (`RIG_XML`).
  - `tug_walls`: per side `y = ±(width/2 + WALL_THICKNESS_M/2)`, pos `(0, y, h/2)`, half `(length/2, WALL_THICKNESS_M/2, h/2)`.
  - `pit_boxes`: `half_y = width/2 + WALL_THICKNESS_M + PLATFORM_OVERRUN_M`, `x_out = length/2 + PLATFORM_OVERRUN_M`, `slab = pit_depth + WALL_THICKNESS_M`; platforms at `(∓(x_out + pit/2)/2, 0, -slab/2)`, half `((x_out - pit/2)/2, half_y, slab/2)`; `pit_floor` at `(0, 0, -pit_depth - WALL_THICKNESS_M/2)`, half `(pit/2, half_y, WALL_THICKNESS_M/2)`.
  - `tug_layout`: with `(ox, oy, _) = string_offset(rig)`, west `Start(-string_m/2 - ox, -oy, 0.0)`, east `Start(string_m/2 + ox, oy, 180.0)`; the first `ducks`. `winch_position`: `(string_m/2, 0.0, SPAWN_HEIGHT_M + oz)`.
  - `_inject_course`: right after the `course` body, a tug writes `pit_boxes + tug_walls` as box geoms and returns (no infinite plane: the pit must be a hole); lanes and stages keep today's order, so their XML is unchanged.
  - Split `compile_stage`: `_troupe` = duck 0 from `build_course_xml`, the others attached on their frames, each duck's own `trunk_base` given `add_site(name=STRING_SITE, pos=list(string_end))` before it is attached when `string_end` is set; `_posed` = the keyframe patch; `compile_stage` returns `_posed(_compiled(_troupe(manifest, layout)), manifest, layout)`.
  - `compile_tug`: `spec = _troupe(manifest, layout, string_offset(rig))`; `string = spec.add_tendon(name=STRING)`, `limited=True, range=[0, string_m]` for a bout; `wrap_site(STRING_SITE)` then `duck_prefix(1) + STRING_SITE`, or for the bench `spec.worldbody.add_site(name=WINCH_SITE, pos=…winch_position…)`, wrapped, and `spec.add_actuator(name=WINCH, target=STRING, trntype=mujoco.mjtTrn.mjTRN_TENDON)` with `set_to_motor()` and `gear = [-1.0, 0, 0, 0, 0, 0]` (positive ctrl shortens the string). After the 14 servos, so no duck address moves; the keyframe's `ctrl` pads itself to 15. Return `_posed(_compiled(spec), manifest, layout)`.
  - `routes_read`: the tug branch adds `walls`, `pit` (`[{name, pos, half}]`), `string_offset`, `winch`.

- [ ] **Step 4: Run** `tests/test_course.py tests/test_routes_read.py tests/test_run_stage.py tests/test_evaluate.py`. Expected: PASS.

- [ ] **Step 5: Commit.** `add arena/course.py arena/web/routes_read.py tests/test_course.py tests/test_routes_read.py` · `"The tug course compiles: a lane cut by a pit, and a string from neck to neck or to a winch, on the troupe's own model"`

---

### Task 3: The bench and the bout

**Files:**
- Create: `arena/tug.py`, `tests/test_tug.py`

**Interfaces:**
- Consumes: `compile_tug`, `string_offset`, `WINCH`; `runner._start`; `stage.fell_at` (the Arena's fall rule, reused).
- Produces (contract): `PIT_DROP_M`, `string_ends`, `marker_x`, `in_pit`, `bench_profile`, `bench_force`, `BenchOutcome`, `run_bench`, `BoutOutcome`, `run_bout`. Private: `_out(duck, termination) -> str | None` (`"pit"`, `"fall"` or `None` for a duck's `(frames, 21)` trace so far), `_verdict(trace, offset, termination, final) -> tuple[int | None, str] | None`.

- [ ] **Step 1: Failing tests**, `tests/test_tug.py`:

```python
import dataclasses, math
import mujoco, numpy as np, pytest
from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT
from arena.course import compile_tug, string_offset
from arena.manifest import BoutRules, Termination, load_event
from arena.policy import load_policy
from arena.runner import _Addresses, _record
from arena.stage import fell_at
from arena.tug import _verdict, bench_force, bench_profile, in_pit, marker_x, run_bench, run_bout, string_ends

TUG, OFFSET = load_event("tug-of-war"), string_offset("legs")
SHORT = dataclasses.replace(TUG, bout=BoutRules(4.0, 2, 5))
# Gravity z never exceeds 1: the judge never sees a fall, so the pit and the time limit stay exercised.
NO_FALL, NO_FALL_SHORT = (dataclasses.replace(m, termination=Termination(1.0, 0.3)) for m in (TUG, SHORT))
WALKER = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
WEST, EAST = (1.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)
ON_ITS_SIDE = (math.cos(math.pi / 4), math.sin(math.pi / 4), 0.0, 0.0)   # 90° about x: gravity z 0 > -0.5

class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(14, dtype=np.float32)

def frame(pos, quat):
    f = np.zeros(21)
    f[0:3], f[3:7] = pos, quat
    return f

def test_a_string_end_turns_with_the_trunk_and_the_marker_is_their_middle():
    half = math.radians(30) / 2
    trace = np.array([[frame((-0.5, 0.1, 0.13), (math.cos(half), 0, 0, math.sin(half)))], [frame((0.6, 0.0145, 0.12), EAST)]])
    np.testing.assert_allclose(string_ends(trace, OFFSET)[:, 0], [[-0.4847333395016046, 0.12555736835487435, 0.1624215],
                                                                   [0.574, 0.0, 0.1524215]], atol=1e-12)
    assert marker_x(trace, OFFSET)[0] == pytest.approx(0.04463333024919769, abs=1e-12)

def test_string_ends_are_where_the_physics_puts_the_sites():
    model = compile_tug(TUG, 2)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    mujoco.mj_forward(model, data)
    trace = np.zeros((2, 1, 21))
    for k, prefix in enumerate(("", "duck1/")):
        _record(trace[k, 0], data, _Addresses.of(model, "STAND", prefix))
    for k, prefix in enumerate(("", "duck1/")):
        np.testing.assert_allclose(string_ends(trace, OFFSET)[k, 0], data.site_xpos[model.site(prefix + "string_end").id], atol=1e-9)

def test_the_pit_and_the_winch():
    assert in_pit(frame((0, 0, -0.051), WEST)) and not in_pit(frame((0, 0, -0.049), WEST))
    profile = bench_profile(TUG.bench, "tug-of-war", 1)
    assert profile == {"ramp_n_per_s": 0.25, "top_n": 7.0, "jerks": [[0.4, 0.7, pytest.approx(2.8020456591211773, abs=1e-12)],
                                                                    [0.4, 1.9, pytest.approx(2.137798647724724, abs=1e-12)]]}
    for t, newtons in ((0.0, 0.47062992744195403), (0.3, 0.0), (1.0, 0.9667824432317804), (12.0, 2.979120498892693), (29.5, 7.0)):
        assert bench_force(profile, t) == pytest.approx(newtons, abs=1e-12)

def test_a_duck_that_does_nothing_falls_and_is_out_at_a_small_force():
    """A fall loses (owner, 2026-10-20): a limp duck would otherwise hold 5–6 N on body friction."""
    out = run_bench(TUG, _ZeroPolicy(), 1)
    frames = out.trace.shape[1]
    assert out.status == "fall" and out.time_s <= 2.0   # it falls flat within about a second
    assert 0.0 <= out.force_n <= TUG.bench.ramp_n_per_s * out.time_s + 2 * TUG.bench.jerk_n   # bench_force's own bound
    assert out.trace.shape == (1, frames, 21) and frames == round(out.time_s / CTRL_DT)
    assert fell_at(out.trace[0], TUG.termination) == pytest.approx(out.time_s) and not in_pit(out.trace[0, -1])
    assert out.force_n == bench_force(out.profile, (frames - 1) * CTRL_DT)
    assert out.settle.shape == (1, 26, 21) and out.profile == bench_profile(TUG.bench, TUG.id, 1)
    np.testing.assert_array_equal(run_bench(TUG, _ZeroPolicy(), 1).trace, out.trace)

def test_the_winch_drags_a_duck_that_cannot_fall_into_the_pit():
    out = run_bench(NO_FALL, _ZeroPolicy(), 1)
    frames = out.trace.shape[1]
    assert out.status == "pit" and 3.0 < out.force_n <= 7.0 and 10.0 < out.time_s < 30.0
    assert frames == round(out.time_s / CTRL_DT) and in_pit(out.trace[0, -1]) and not in_pit(out.trace[0, -2])
    assert out.force_n == bench_force(out.profile, (frames - 1) * CTRL_DT)

def test_a_duck_still_in_at_the_end_scores_the_top_and_a_walker_is_still_rated():
    held = run_bench(dataclasses.replace(NO_FALL, time_limit_s=2.0), _ZeroPolicy(), 1)
    assert (held.status, held.force_n, held.time_s, held.trace.shape) == ("held", 7.0, None, (1, 100, 21))
    walker = run_bench(TUG, load_policy(WALKER), 2)
    assert walker.status in ("pit", "fall", "held") and 0.0 <= walker.force_n <= 7.0

def test_the_judge_reads_the_pit_a_fall_then_the_marker():
    base = np.array([[frame((-0.6, 0, 0.1), WEST)], [frame((0.6, 0, 0.1), EAST)]])
    assert _verdict(base, OFFSET, TUG.termination, final=False) is None
    east_in = base.copy(); east_in[1, 0, 2] = -0.1
    assert _verdict(east_in, OFFSET, TUG.termination, final=False) == (1, "pit")
    both = base.copy(); both[:, 0, 2] = -0.1; both[:, 0, 0] -= 0.1           # both in, the marker pulled west
    assert _verdict(both, OFFSET, TUG.termination, final=False) == (1, "marker")
    east_side = base.copy(); east_side[:, 0, 0] += 0.1
    assert _verdict(east_side, OFFSET, TUG.termination, final=True) == (0, "marker")
    assert _verdict(base, (0.0, 0.0, 0.0), TUG.termination, final=True) == (None, "draw")      # exactly on the centre line
    hold = round(TUG.termination.fall_hold_s / CTRL_DT)                       # 15 control steps
    tipped = np.repeat(base, hold, axis=1); tipped[0, :, 3:7] = ON_ITS_SIDE
    assert _verdict(tipped[:, 1:], OFFSET, TUG.termination, final=False) is None   # one step short of the hold
    assert _verdict(tipped, OFFSET, TUG.termination, final=False) == (0, "fall")
    tipped[1, -1, 2] = -0.1; tipped[:, -1, 0] -= 0.1                          # east drops in on the step west's fall completes
    assert _verdict(tipped, OFFSET, TUG.termination, final=False) == (1, "marker")

def test_two_ducks_that_do_nothing_fall_and_the_bout_is_decided_the_same_way_every_time():
    out = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert out.how in ("fall", "marker", "draw") and out.time_s < SHORT.bout.time_limit_s
    assert out.trace.shape[1] == round(out.time_s / CTRL_DT) and out.settle.shape == (2, 26, 21)
    if out.how == "fall":
        assert fell_at(out.trace[out.loser], TUG.termination) == pytest.approx(out.time_s)
    again = run_bout(SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    np.testing.assert_array_equal(again.trace, out.trace)
    assert (again.loser, again.how) == (out.loser, out.how)

def test_a_bout_nobody_goes_out_of_is_decided_by_the_marker_at_the_time_limit():
    out = run_bout(NO_FALL_SHORT, _ZeroPolicy(), _ZeroPolicy(), 1)
    assert out.trace.shape == (2, 200, 21) and out.time_s == pytest.approx(4.0)
    x = marker_x(out.trace[:, -1:], OFFSET)[0]
    assert (out.loser, out.how) == ((0, "marker") if x > 0 else (1, "marker") if x < 0 else (None, "draw"))

def test_the_string_never_stretches_past_its_length():
    walker = load_policy(WALKER)
    ends = string_ends(run_bout(NO_FALL, walker, walker, 1).trace, OFFSET)
    length = np.linalg.norm(ends[0] - ends[1], axis=1)
    assert TUG.course.string_m - 0.01 <= length.max() <= TUG.course.string_m + 0.01   # taut, never longer
```

  Measured on a prototype of this physics without the fall rule (2026-10-19, this Mac): the zero-action duck went in at about 21.7 s and 4.8–6.1 N, the walker walked in by itself at about 4.6 s, two walkers pulled the string to 1.0024 m, two zero ducks were both still out of the pit at 4 s. `NO_FALL` keeps that physics for the pit, the time limit and the string; with the rule (2026-10-20) a zero-action duck falls flat within about a second, whose exact time and force no formula gives: the bounds above hold them, Step 4 records them. If the walkers never pull the string taut on seed 1 here, take a seed where they do: the upper bound must be exercised, not vacuous.

- [ ] **Step 2: Run** `tests/test_tug.py`. Expected: FAIL (`ModuleNotFoundError: arena.tug`).

- [ ] **Step 3: Implement `arena/tug.py`** (docstring: a limited tendon is a string, it pulls only when taut; the judge's rules from the spec, a fall losing as the pit does).
  - `string_ends`: `pos = trace[..., 0:3]`, `w = trace[..., 3:4]`, `u = trace[..., 4:7]`, `v` = the offset broadcast; `t = 2·cross(u, v)`; return `pos + v + w·t + cross(u, t)` (float64). `marker_x`: `(ends[0, :, 0] + ends[1, :, 0]) / 2`. `in_pit`: `bool(frame[2] < -PIT_DROP_M)`.
  - `bench_profile`: phases from the contract's generator; `jerks = [[jerk_n, hz, float(phase)], …]`. `bench_force`: the clamped formula.
  - `_out(duck, termination)`: `"pit"` when `in_pit(duck[-1])`; `"fall"` when `stage.fell_at(duck[-hold:], termination)` is not `None`, `hold = round(termination.fall_hold_s / CTRL_DT)` (a window of exactly the hold: true only when its every frame is tipped, so the fall is timed at the step that completes the hold, as `fell_at` and `runner.run_once` time it, at O(hold) a step); else `None`. Comment: the Arena's own fall rule, reused, never copied.
  - `run_bench`: `model = model or compile_tug(manifest, 1)`; `sim, settle = _start(manifest, model, [policy], [0.0], seed, [command])`; each timed step: `force = bench_force(profile, step * CTRL_DT)`, `sim.data.ctrl[winch] = force`, `sim.step`, `sim.record(frames[:, step])`; `how = _out(frames[0, :step + 1], manifest.termination)`, out → `BenchOutcome(seed, how, force, (step + 1) * CTRL_DT, frames[:, :step + 1].copy(), settle, profile)`; at the end `"held"`, `top_n`, `None`.
  - `_verdict(trace, offset, termination, final)`: `outs = [_out(trace[k], termination) for k in (0, 1)]`; exactly one duck out → `(k, outs[k])`; both, or `final` → `x = marker_x(trace[:, -1:], offset)[0]`: `x < 0` → `(1, "marker")`, `x > 0` → `(0, "marker")`, else `(None, "draw")`; otherwise `None`.
  - `run_bout`: `_start(manifest, model, [west, east], [0.0, 180.0], seed, [command, command])`; after each step and record, `_verdict(frames[:, :step + 1], offset, manifest.termination, final=step == steps - 1)`; the first verdict returns `BoutOutcome(seed, loser, how, (step + 1) * CTRL_DT, frames[:, :step + 1].copy(), settle)`.

- [ ] **Step 4: Run** `tests/test_tug.py`. Expected: PASS (about 10 s). Record in the task report what the bounds hold: the zero duck's fall time and force on seed 1, the walker's status, force and time on seed 2, and the zero-duck bout's `how` and time (Plan B's G0 compares with them).

- [ ] **Step 5: Commit.** `add arena/tug.py tests/test_tug.py` · `"A duck pulls against a winch or another duck: the pulling bench and the bout, judged by the pit, a fall or the marker"`. **Plan B starts from this commit** (the event file, the course, the string, the winch, the bench and the fall rule its environment mirrors): report its hash.

---

### Task 4: Matches

**Files:** Create `arena/match.py`, `tests/test_match.py`.

**Interfaces:**
- Consumes: `run_bout`, `BoutOutcome`, `compile_tug`.
- Produces (contract): `bout_seed`, `BoutResult` (`to_dict`, `from_dict`), `MatchOutcome`, `play_match(manifest, a, b, seeds, ratings, model=None)`. `run_bout` is called through the module global, so tests swap it with `monkeypatch.setattr("arena.match.run_bout", …)`.

- [ ] **Step 1: Failing tests**, `tests/test_match.py`:

```python
import dataclasses
import numpy as np, pytest
from arena.manifest import BoutRules, load_event
from arena.match import BoutResult, bout_seed, play_match
from arena.tug import BoutOutcome
from tests.test_tug import _ZeroPolicy

TUG, SEEDS = load_event("tug-of-war"), (11, 12, 13, 14, 15)

def scripted(monkeypatch, winners):
    """Bout k is won by winners[k] ("a", "b" or None); records who stood west and east."""
    stood = []
    def bout(manifest, west, east, seed, model=None):
        k = len(stood); stood.append((west, east, seed))
        loser = None if winners[k] is None else (1 if (winners[k] == "a") == (west == "A") else 0)
        return BoutOutcome(seed, loser, "draw" if loser is None else "pit", 3.0,
                           np.full((2, 5, 21), k, np.float32), np.zeros((2, 26, 21), np.float32))
    monkeypatch.setattr("arena.match.run_bout", bout)
    return stood

def test_a_bout_seed_is_the_secrets_hash():
    secret = "0123456789abcdef0123456789abcdef"
    assert [bout_seed(secret, "tug-of-war-0001-000", k) for k in (0, 1)] == [4017010484, 4022833236]

def test_first_to_two_sides_swapped_after_each_bout(monkeypatch):
    stood = scripted(monkeypatch, ["a", "b", "a"])
    out = play_match(TUG, "A", "B", SEEDS, (3.0, 4.0), model=object())
    assert stood == [("A", "B", 11), ("B", "A", 12), ("A", "B", 13)]
    assert [(b.k, b.a_side, b.winner) for b in out.bouts] == [(0, "west", "a"), (1, "east", "b"), (2, "west", "a")]
    assert (out.wins, out.winner, out.decided_by, len(out.traces)) == ((2, 1), "a", "bouts", 3)

def test_five_draws_go_to_the_higher_rating_then_to_a(monkeypatch):
    scripted(monkeypatch, [None] * 5)
    out = play_match(TUG, "A", "B", SEEDS, (3.0, 4.0), model=object())
    assert (len(out.bouts), out.wins, out.winner, out.decided_by) == (5, (0, 0), "b", "rating")
    scripted(monkeypatch, [None] * 5)
    assert play_match(TUG, "A", "B", SEEDS, (4.0, 4.0), model=object()).winner == "a"

def test_after_the_last_bout_more_wins_decide(monkeypatch):
    scripted(monkeypatch, ["b", None, None, None, None])
    out = play_match(TUG, "A", "B", SEEDS, (9.0, 1.0), model=object())
    assert (out.wins, out.winner, out.decided_by) == ((0, 1), "b", "bouts")

def test_a_match_takes_one_seed_per_possible_bout_and_a_bout_round_trips():
    with pytest.raises(ValueError, match="max_bouts"):
        play_match(TUG, _ZeroPolicy(), _ZeroPolicy(), SEEDS[:3], (1.0, 1.0))
    result = BoutResult(1, 12, "east", None, "draw", 20.0)
    assert result.to_dict() == {"k": 1, "seed": 12, "a_side": "east", "winner": None, "how": "draw", "time_s": 20.0}
    assert BoutResult.from_dict(result.to_dict()) == result

def test_a_real_match_plays_the_same_twice():
    quick = dataclasses.replace(TUG, bout=BoutRules(1.0, 2, 5))
    one, two = (play_match(quick, _ZeroPolicy(), _ZeroPolicy(), SEEDS, (1.0, 2.0)) for _ in range(2))
    assert one.bouts == two.bouts and 2 <= len(one.bouts) <= 5
    assert one.traces[0][0].shape[0] == 2 and one.traces[0][0].shape[1] <= 50   # a duck may fall before the 1 s limit
    np.testing.assert_array_equal(one.traces[-1][0], two.traces[-1][0])
```

- [ ] **Step 2: Run** `tests/test_match.py`. Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement.** `play_match`: `len(seeds) != max_bouts` → `ValueError` naming `max_bouts`, before compiling; `model = model or compile_tug(manifest, 2)`; bout `k` has `a_side = "west"` on even `k`, the west/east pair `(a, b)` or `(b, a)`; its winner is `None` on a `None` loser, else `"a"` iff `(loser == 1) == (a_side == "west")`; stop when a side reaches `bouts_to_win`. Unequal wins → that side, `"bouts"`; equal → `"a"` if `ratings[0] >= ratings[1]` else `"b"`, `"rating"`.

- [ ] **Step 4: Run** `tests/test_match.py`. Expected: PASS.

- [ ] **Step 5: Commit.** `add arena/match.py tests/test_match.py` · `"A match is first to two bouts, sides swapped after each, a tie after five going to the higher rating"`

---

### Task 5: A bench entry is rated and recorded

**Files:**
- Modify: `arena/evaluate.py`, `arena/store.py`, `arena/web/routes_submit.py`, `arena/recover.py`, `arena/cli.py`
- Test: `tests/test_evaluate.py`, `tests/test_store.py`, `tests/test_routes_submit.py`, `tests/test_recover.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `run_bench`, `BenchOutcome`, `compile_tug`, `higher_wins`.
- Produces: `Evaluation.bench: dict | None = None`; `evaluate()` on a tug → `_evaluate_bench(manifest, policy)`; `seed_row(result) -> dict` in `evaluate.py` (`seed`, `status`, `time_s`, plus `force_n` only when set; every writer of a seed uses it); `RunRecord.bench: dict | None = None`; the submit answer's `metric`; `arena score`'s tug output (contract: one `seed n:` line per seed, then `rating: X.XX N · replay from seed n`; Plan B reads it).

- [ ] **Step 1: Failing tests.** `tests/test_evaluate.py`:

```python
from arena.evaluate import seed_row
from arena.tug import BenchOutcome
TUG = load_event("tug-of-war")

def fake_bench(forces):
    def run(manifest, policy, seed, model=None):
        held = forces[seed] == 7.0
        return BenchOutcome(seed, "held" if held else "pit", forces[seed], None if held else 20.0,
                            np.full((1, 3, 21), seed, np.float32), np.zeros((1, 26, 21), np.float32), {"seed": seed})
    return run

def test_a_bench_entry_is_rated_on_every_seed_and_replays_the_lower_median(monkeypatch):
    monkeypatch.setattr("arena.evaluate.run_bench", fake_bench({1: 4.0, 2: 7.0, 3: 2.0, 4: 5.0, 5: 3.0}))
    result = evaluate(TUG, object())
    assert result.score == pytest.approx(4.2) and result.seeds_finished == 5 and result.scan == ()
    assert [s.force_n for s in result.per_seed] == [4.0, 7.0, 2.0, 5.0, 3.0]
    assert (result.trace_seed, result.bench, result.command_vx, result.trace[0, 0, 0]) == (1, {"seed": 1}, -0.3, 1.0)

def test_a_duck_that_holds_every_seed_scores_the_top_and_replays_seed_3(monkeypatch):
    monkeypatch.setattr("arena.evaluate.run_bench", fake_bench(dict.fromkeys(range(1, 6), 7.0)))
    result = evaluate(TUG, object())
    assert (result.score, result.trace_seed, {s.status for s in result.per_seed}) == (7.0, 3, {"held"})

def test_a_tug_takes_no_cast_and_rates_a_walker():
    with pytest.raises(ValueError):
        evaluate(TUG, object(), cast=())
    result = evaluate(TUG, load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"))
    assert 0.0 <= result.score <= 7.0 and len(result.per_seed) == 5 and result.trace.shape[0] == 1
    assert result.bench["top_n"] == 7.0

def test_a_seed_row_adds_a_force_only_on_the_bench():
    assert seed_row(SeedResult(1, "finish", 12.5)) == {"seed": 1, "status": "finish", "time_s": 12.5}
    assert seed_row(SeedResult(2, "held", None, 7.0)) == {"seed": 2, "status": "held", "time_s": None, "force_n": 7.0}
    assert seed_row(SeedResult(3, "fall", 1.02, 0.62)) == {"seed": 3, "status": "fall", "time_s": 1.02, "force_n": 0.62}
```

  `tests/test_store.py` (`import json`):

```python
RACE = {"run_id": "01K7QX0000000000000000", "event_id": "sprint-2m", "submitted_at": "2026-09-03T10:00:00Z",
        "user": "alice", "policy_name": "sprinter-v3",
        "source": {"kind": "hub", "repo_id": "alice/sprinter", "filename": "policy.onnx", "revision": "c" * 40, "url": "u"},
        "model_sha256": "a" * 64, "score": 21.5, "seeds_finished": 5,
        "per_seed": [{"seed": 1, "status": "finish", "time_s": 21.5}], "trace_seed": 1, "runner_version": 4,
        "command_vx": 0.4, "model_stored": False, "env_url": None, "livery": "classic", "description": None,
        "timeline_sha256": None, "cast": [{"policy": "self", "rig": None, "start": None, "sound": None}]}

def test_a_stored_race_reads_and_writes_back_to_the_same_json():
    assert RunRecord.from_dict(json.loads(json.dumps(RACE))).to_dict() == RACE

def test_a_bench_run_keeps_its_profile_and_its_forces():
    profile = {"ramp_n_per_s": 0.25, "top_n": 7.0, "jerks": [[0.4, 0.7, 2.8]]}
    record = make_record(event_id="tug-of-war", bench=profile, per_seed=(SeedResult(1, "pit", 21.7, 4.0),))
    raw = record.to_dict()
    assert (raw["bench"], raw["per_seed"][0]["force_n"]) == (profile, 4.0) and RunRecord.from_dict(raw) == record
```

  `tests/test_recover.py`: its `Event` double gains a course, `def __init__(self, id, rig, kind="lane")` setting `self.course = SimpleNamespace(kind=kind)`, and

```python
def test_a_policy_with_no_recorded_event_is_never_recovered_onto_the_tug():
    """Entering a versus enters its cup: it takes a policy trained to pull, entered on purpose."""
    events = [*EVENTS, Event("tug-of-war", "legs", "tug")]
    legacy = Candidate("a/b", "r", "a", "b", "legs", event_id=None)
    assert [e.id for e in events_for(legacy, events)] == ["sprint-2m", "hill-climb-1m5"]
    tugger = Candidate("a/c", "r", "a", "c", "legs", event_id="tug-of-war")
    assert [e.id for e in events_for(tugger, events)] == ["tug-of-war"]
```

  `tests/test_routes_submit.py` and `tests/test_cli.py`:

```python
def test_a_tug_entry_is_rated_on_the_bench(api):
    body = submit(api, event="tug-of-war").json()
    assert body["course"] == "tug" and body["seeds_total"] == 5 and all("force_n" in s for s in body["per_seed"])
    assert body["metric"] == "mean_hold_force"   # the publish CLI says "a 4.21 N rating" from it
    assert _stored(api, "tug-of-war", body["run_id"]).bench["top_n"] == 7.0
    assert api.get(f"/api/runs/{body['run_id']}/trace").headers["X-Duck-Count"] == "1"
    assert submit(api, event="sprint-2m").json()["metric"] == "mean_finish_time"

def test_score_rates_a_tug_entry_and_the_board_says_rating(tmp_path, capsys):
    """The format Plan B's ledger reads: five seed lines, then the rating."""
    assert main(["score", REFERENCE, "--event", "tug-of-war", "--store", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert len(re.findall(r"^seed [1-5]: (pit|fall|held) +\d+\.\d\d N( at \d+\.\d\d s)?$", out, re.M)) == 5
    assert re.search(r"^rating: \d+\.\d\d N · replay from seed [1-5]$", out, re.M)
    assert main(["board", "--event", "tug-of-war", "--store", str(tmp_path)]) == 0
    assert "rating" in capsys.readouterr().out
```

  (`import re` in `tests/test_cli.py`.)

- [ ] **Step 2: Run** the five files. Expected: FAIL (`ImportError: seed_row`).

- [ ] **Step 3: Implement.**
  - `evaluate.py`: import `compile_tug` and `run_bench` as module globals; `Evaluation.bench`; `seed_row`; `evaluate` on a tug: a `cast` raises `ValueError(f"{manifest.id} rates the entry alone, on the bench")`, else `_evaluate_bench`: compile once, `run_bench` every seed, `SeedResult(o.seed, o.status, o.time_s, o.force_n)`, the trace seed the lower median of `sorted(per_seed, key=lambda r: (r.force_n, r.seed))`, `score = METRICS[metric](…)`, `seeds_finished = len(per_seed)` (a bench run always ends with a force), `command_vx = manifest.command[0]`, `scan = ()`, `bench` = the traced outcome's profile. A paragraph on the bench in the module docstring.
  - `store.py`: `bench` (comment: the winch's profile on the replayed seed, for the page's dial; None off the bench); `to_dict` writes seeds with `seed_row` and `bench` only when set; `from_dict` reads `r.get("force_n")`, `raw.get("bench")`.
  - `routes_submit.py`: `_seed_rows` maps `seed_row`; `bench=result.bench` in its `RunRecord`, as in `recover.py` and `cli.py`; `_answer` takes the manifest instead of its `course.kind` and adds `"metric": manifest.metric` (every event: the publish CLI reads it to say a rating in newtons; an older CLI ignores it).
  - `recover.events_for`'s fallback: `e.rig == candidate.rig and e.course.kind != "tug"`, the docstring saying why; its `recovered …` line ends `" N"` instead of `"s"` when `higher_wins(event.id)`.
  - `cli.py`: `_cmd_score` branches stage → `--timeline` refusal → tug → race; `_print_bench` prints one line per seed, `seed 1: pit      4.77 N at 21.76 s` / `seed 2: held     7.00 N` / `seed 3: fall     0.62 N at 1.02 s`, then `rating: 4.21 N · replay from seed 3` (the contract's format: Plan B reads it); `_cmd_board` heads its score column `rating` and prints `N` on a `higher_wins` event.

- [ ] **Step 4: Run** the five files plus `tests/test_hub_store.py`. Expected: PASS.

- [ ] **Step 5: Commit.** `add arena/evaluate.py arena/store.py arena/web/routes_submit.py arena/recover.py arena/cli.py tests/test_evaluate.py tests/test_store.py tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py` · `"A tug entry is rated on the bench: five seeds against the winch, the mean force held, recorded with the winch's profile"`. Plan B's scoring steps (`arena score` on a tug) start from this commit: report its hash.

---

### Task 6: The stronger ranks first, everywhere the board is read

**Files:**
- Modify: `arena/index.py`, `arena/web/routes_read.py`, `arena/web/routes_unfurl.py`
- Test: `tests/test_index.py`, `tests/test_points.py`, `tests/test_routes_read.py`, `tests/test_clips.py`

**Interfaces:**
- Consumes: `higher_wins`, `seed_row`, `RunRecord.bench`.
- Produces: `sort_key` per the contract; `GET /api/runs/{id}`: `bench` on a bench run, `per_seed` via `seed_row`; board rows add `bench` when set; player publications add `metric`.

- [ ] **Step 1: Failing tests.** `tests/test_index.py`:

```python
def tug(user, score, **more):
    return make_record(event_id="tug-of-war", user=user, score=score, **more)

def test_a_tug_board_ranks_the_strongest_first_and_keeps_each_ones_strongest():
    rows = leaderboard([tug("weak", 2.0), tug("strong", 4.0), tug("mid", 3.0), tug("strong", 5.0)])
    assert [(r.record.user, r.record.score) for r in rows] == [("strong", 5.0), ("mid", 3.0), ("weak", 2.0)]
    mine = tug("me", 4.0)
    assert standing([tug("a", 5.0), tug("b", 3.0), mine], mine.run_id).rank == 2

def test_a_tie_on_the_tug_goes_to_who_got_there_first():
    rows = leaderboard([tug("later", 7.0, submitted_at="2026-09-03T12:00:00Z"), tug("earlier", 7.0, submitted_at="2026-09-03T09:00:00Z")])
    assert [r.record.user for r in rows] == ["earlier", "later"]
```

  `tests/test_points.py`:

```python
def test_a_stronger_tug_rating_is_a_personal_best_and_the_podium_pays_the_strongest():
    first, better, weaker = (make_record(user="alice", event_id="tug-of-war", score=s, submitted_at=f"2026-09-03T{h}:00:00Z")
                             for s, h in ((3.0, "09"), (4.0, "10"), (2.0, "11")))
    assert [r.source_id for r in acts(receipts([first, better, weaker], frozenset()), "own_best")] == [better.run_id]
    runs = [make_record(user=u, event_id="tug-of-war", score=s) for u, s in (("a", 2.0), ("b", 5.0), ("c", 3.0))]
    assert [(r.user, r.points) for r in acts(receipts(runs, frozenset()), "podium")] == [("b", 250), ("c", 150), ("a", 100)]
```

  `tests/test_routes_read.py` (import `SeedResult`):

```python
PROFILE = {"ramp_n_per_s": 0.25, "top_n": 7.0, "jerks": [[0.4, 0.7, 2.8], [0.4, 1.9, 2.1]]}

def test_a_bench_run_serves_its_profile_its_forces_and_a_board_strongest_first(client):
    api, app = client
    record_run(app, event_id="tug-of-war", user="bob", score=3.0, bench=PROFILE, per_seed=(SeedResult(1, "pit", 21.7, 3.0),))
    mine = record_run(app, event_id="tug-of-war", user="alice", score=4.2, bench=PROFILE, per_seed=(SeedResult(1, "held", None, 7.0),))
    body = api.get(f"/api/runs/{mine.run_id}").json()
    assert body["bench"] == PROFILE and body["per_seed"] == [{"seed": 1, "status": "held", "time_s": None, "force_n": 7.0}]
    assert (body["rank"], [r["user"] for r in body["board"]], body["board"][0]["bench"]) == (1, ["alice", "bob"], PROFILE)
    assert [r["user"] for r in api.get("/api/events/tug-of-war/leaderboard").json()["rows"]] == ["alice", "bob"]
    assert api.get("/api/players/alice").json()["publications"][0]["metric"] == "mean_hold_force"

def test_a_race_answer_carries_nothing_of_the_bench(client):
    api, app = client
    body = api.get(f"/api/runs/{record_run(app).run_id}").json()
    assert "bench" not in body and "force_n" not in body["per_seed"][0] and "bench" not in body["board"][0]
```

  `tests/test_clips.py`, beside `test_a_performance_is_described_as_one`:

```python
def test_a_bench_run_is_described_by_its_rating():
    from arena.index import Standing
    from arena.manifest import load_event
    from arena.web.routes_unfurl import describe
    record = make_record(user="eve", event_id="tug-of-war", score=4.213)
    assert describe(record, Standing(2, True, []), load_event("tug-of-war")) == (
        "@eve's duck holds a 4.21 N rating on the Tug of War, #2 on the board.")
```

- [ ] **Step 2: Run** the four files. Expected: FAIL (the tug board ascending; no `bench`).

- [ ] **Step 3: Implement.** `index.sort_key` per the contract, docstring: better first (the higher score where the metric is in `HIGHER_WINS`, the lower elsewhere), then more seeds finished, then who got there first. `routes_read.py:183`'s comment: votes are not a score but a count in a window (`arena/votes.py`), hence their own function; `index.sort_key` ranks every scored event in its metric's direction. `_board_row` and `run_detail` add `**({"bench": record.bench} if record.bench else {})`; `run_detail`'s seeds use `seed_row`; publications add `"metric": events[run.event_id].metric`. `routes_unfurl.describe` on a tug: `@{user}'s duck holds a {score:.2f} N rating on the {title}`, then `, #{rank} on the board.` or `.`.

- [ ] **Step 4: Run** the four files plus `tests/test_commentary_context.py tests/test_commentary_notable.py tests/test_live.py`. Expected: PASS.

- [ ] **Step 5: Commit.** `add arena/index.py arena/web/routes_read.py arena/web/routes_unfurl.py tests/test_index.py tests/test_points.py tests/test_routes_read.py tests/test_clips.py` · `"On the Tug of War the stronger ranks first: the board, a run's standing, its points and its card"`

---

### Task 7: Peter and Ray call a bench run

**Files:**
- Modify: `arena/commentary/context.py`, `arena/commentary/notable.py`, `arena/commentary/generator.py`
- Test: `tests/test_commentary_context.py`, `tests/test_commentary_notable.py`, `tests/test_commentary_generator.py`

**Interfaces:**
- Produces: `measure(manifest) -> tuple[str, str]` in `context.py`, `("rating", "N")` on a `higher_wins` event, else `("time", "s")`, used by `_board`, `personal_best`, `opponents`; `milestone` runs only on `metric == "mean_finish_time"`.

- [ ] **Step 1: Failing tests.** `tests/test_commentary_context.py`:

```python
def bench_seeds(*forces):
    return tuple(SeedResult(i + 1, "held" if f == 7.0 else "pit", None if f == 7.0 else 20.0, f) for i, f in enumerate(forces))

def test_a_bench_run_states_its_rating_and_its_gap_in_newtons():
    manifest = load_event("tug-of-war")
    leader = run("carol", 5.0, "2026-09-10T10:00:00Z", event="tug-of-war", run_id="R0", per_seed=bench_seeds(5, 5, 5, 5, 5))
    mine = run("alice", 4.2, "2026-09-11T10:00:00Z", event="tug-of-war", run_id="R1", per_seed=bench_seeds(7.0, 3.0, 4.0, 3.5, 3.5))
    facts = {f.ref: f for f in result_facts(mine, manifest, [leader, mine], [])}
    assert facts["run#/event"].text == ("The event is the Tug of War, a pulling bench: the duck pulls backwards on a "
                                        "string against a winch that pulls harder and harder, across a pit.")
    assert facts["run#/participant"].text == "The participant is @alice, pulling with a policy named alice-v1."
    assert facts["run#/result"].text == (
        "The rating is 4.20 N: how hard the winch was pulling when the duck fell or went into the pit, averaged "
        "over 5 seeds; the duck held on to the end of 1 of them, which counts the winch's top pull of 7 N.")
    assert facts["run#/board"].text == "On the Tug of War board this run ranks 2 of 2, 0.80 N behind the leader, @carol."
    assert nature(manifest)[1] == ("tug",)
```

  `tests/test_commentary_notable.py`:

```python
def test_a_bench_run_has_no_time_milestone_and_beats_its_best_by_pulling_harder():
    first = run("alice", 3.0, "2026-09-10T10:00:00Z", event="tug-of-war")
    facts = facts_for(run("alice", 4.2, "2026-09-11T10:00:00Z", event="tug-of-war"), first)
    assert "notable#/milestone" not in facts and "notable#/record" not in facts
    assert facts["notable#/personal-best"].text == "@alice beats their previous best on the Tug of War, 3.00 N, by 1.20 N."

def test_a_displaced_bench_rival_is_quoted_in_newtons():
    bob = run("bob", 3.0, "2026-09-01T10:00:00Z", event="tug-of-war")
    facts = facts_for(run("alice", 4.0, "2026-09-11T10:00:00Z", event="tug-of-war"), bob)
    assert facts["notable#/opponent/bob"].text == ("@bob drops from rank 1 to rank 2 on the Tug of War; their best "
                                                   "rating there, 3.00 N, was published 10 days ago.")
```

  `tests/test_commentary_generator.py`: `assert "In the tug of war a duck pulls backwards on a string against a winch" in BOOTH_CONTEXT`.

- [ ] **Step 2: Run** the three files. Expected: FAIL.

- [ ] **Step 3: Implement.** `nature` on a tug: `("a pulling bench: the duck pulls backwards on a string against a winch that pulls harder and harder, across a pit", ("tug",))`; `doing` is `"pulling with"`; `_result`: the test's sentence (`{top_n:g}`), ending after "seeds." when no seed held; its tag the traced seed's status, `("held",)`, `("pit",)` or `("fall",)`. `_board`: `gap = abs(record.score - leader.score)` in `measure`'s unit, `close` under 0.5 s or 0.25 N. `notable`: `milestone`'s guard, `personal_best`'s `margin = abs(…)` and unit, `opponents`' `their best {word} there, {score:.2f} {unit}`; race sentences unchanged. `BOOTH_CONTEXT`, after the stage sentence: `"In the tug of war a duck pulls backwards on a string against a winch that pulls harder and harder; its rating is how hard the winch was pulling, in newtons, when the duck fell or went into the pit, and the higher the better. "` (the booth is taught in the prompt, never filtered).

- [ ] **Step 4: Run** the three files plus `tests/test_commentary.py tests/test_commentary_stock.py`. Expected: PASS.

- [ ] **Step 5: Commit.** `add arena/commentary/context.py arena/commentary/notable.py arena/commentary/generator.py tests/test_commentary_context.py tests/test_commentary_notable.py tests/test_commentary_generator.py` · `"Peter and Ray call a bench run in newtons: its rating, its gap to the leader, a personal best pulled harder"`

---

### Task 8: The site counts in newtons

**Files:**
- Create: `app/src/tug.js` (its arithmetic), `app/src/tug.test.js`
- Modify: `app/src/format.js`, `app/src/board.js`, `app/src/roundcard.js`, `app/src/player.js`
- Test: `app/src/format.test.js`, `app/src/board.test.js`, `app/src/roundcard.test.js`, `app/src/player.test.js`

**Interfaces:**
- Produces: `isTug`, `formatScore(value, { finished, metric })` (`"4.21 N"` for `mean_hold_force`, else `"12.346s"`, `"DNF"` at `finished === 0`), the tug's `formatEventFacts`; `buildRows(rows, { me, selected, metric })`. `tug.js` (mirrors `arena/tug.py`; MJCF in, three.js out): `toThree([x, y, z]) -> [x, z, -y]`, `stringEnd(frame, offset)` (MJCF), `markerX(westFrame, eastFrame, offset)`, `benchForce(profile, t)`, `forceAt(profile, index, lead)` (0 while `index < lead`, else `benchForce(profile, (index - lead) * CTRL_DT)`), `tugDucks(entry)` → `[{trace, lead, livery, name}]` (bench one, bout two; a `settle` led in with `leadIn`), `tugEnds(event, frames)` → MJCF `[a, b]` (duck 0's end; duck 1's or `event.winch`).

- [ ] **Step 1: Failing tests.** Test files do not import each other: each declares the `TUG` fields it reads, as below. `app/src/tug.test.js`:

```js
import { describe, expect, it } from "vitest";
import { TRACE_WIDTH } from "./replay.js";
import { benchForce, forceAt, markerX, stringEnd, toThree, tugDucks, tugEnds } from "./tug.js";

const TUG = {
  id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug", metric: "mean_hold_force", rig: "legs", vote: null,
  length_m: 4, width_m: 0.8, string_m: 1, pit_m: 0.3, pit_depth_m: 0.3, string_offset: [0.026, 0.0145, 0.0324215],
  winch: [0.5, 0, 0.1524215], bench: { ramp_n_per_s: 0.25, top_n: 7 },
  walls: [{ name: "wall_left", pos: [0, 0.425, 0.075], half: [2, 0.025, 0.075] }, { name: "wall_right", pos: [0, -0.425, 0.075], half: [2, 0.025, 0.075] }],
};
// arena.tug.bench_profile(bench, "tug-of-war", 1); the forces below are arena.tug.bench_force of it.
const PROFILE = { ramp_n_per_s: 0.25, top_n: 7, jerks: [[0.4, 0.7, 2.8020456591211773], [0.4, 1.9, 2.137798647724724]] };
const frame = (pos, quat) => Float32Array.from([...pos, ...quat, ...new Array(14).fill(0)]);
const A = frame([-0.5, 0.1, 0.13], [Math.cos(Math.PI / 12), 0, 0, Math.sin(Math.PI / 12)]);
const B = frame([0.6, 0.0145, 0.12], [0, 0, 0, 1]);

describe("the tug's arithmetic, as the server's", () => {
  it("benchForce equals arena.tug.bench_force", () => {
    for (const [t, n] of [[0, 0.47062992744195403], [0.3, 0], [1, 0.9667824432317804], [12, 2.979120498892693], [29.5, 7]]) {
      expect(benchForce(PROFILE, t)).toBeCloseTo(n, 9);
    }
  });
  it("the dial reads nothing during the settle, then the winch from the clock's start", () => {
    expect([forceAt(PROFILE, 10, 26), forceAt(PROFILE, 26, 26)]).toEqual([0, benchForce(PROFILE, 0)]);
    expect(forceAt(PROFILE, 76, 26)).toBeCloseTo(0.9667824432317804, 9);
  });
  it("a string end turns with the trunk, the marker is the middle, a bench's string ends at the winch", () => {
    [-0.4847333395016046, 0.12555736835487435, 0.1624215].forEach((v, i) => expect(stringEnd(A, TUG.string_offset)[i]).toBeCloseTo(v, 6));
    expect(markerX(A, B, TUG.string_offset)).toBeCloseTo(0.04463333024919769, 6);
    expect(toThree([1, 2, 3])).toEqual([1, 3, -2]);
    expect(tugEnds(TUG, [B])[1]).toEqual(TUG.winch);
    tugEnds(TUG, [A, B])[1].forEach((v, i) => expect(v).toBeCloseTo([0.574, 0, 0.1524215][i], 6));
  });
  it("a bench lane is one duck, its settle led in; a bout's are its two, west first", () => {
    const trace = new Float32Array(3 * TRACE_WIDTH), settle = new Float32Array(2 * TRACE_WIDTH);
    const [duck] = tugDucks({ tug: "bench", trace, settle, bench: PROFILE, livery: "gold", name: "@alice" });
    expect([duck.lead, duck.trace.length, duck.livery, duck.name]).toEqual([2, 5 * TRACE_WIDTH, "gold", "@alice"]);
    const bout = tugDucks({ tug: "bout", ducks: [{ trace, livery: "a", name: "W" }, { trace, livery: "b", name: "E" }] });
    expect(bout.map((d) => [d.name, d.lead])).toEqual([["W", 0], ["E", 0]]);
  });
});
```

  `format.test.js`: `formatScore(4.2134, { finished: 5, metric: "mean_hold_force" })` → `"4.21 N"`; `formatScore(12.3456, { finished: 5 })` → `"12.346s"`; `isTug({ course: "tug" })` true, `isTug({ course: "lane" })`, `isTug(undefined)` false; `formatEventFacts(TUG)` → `[{ label: "course", value: "4 m lane, 0.3 m pit" }, { label: "winch", value: "up to 7 N" }, { label: "rig", value: "legs" }]`. `board.test.js`: `renderBoard` of `TUG` with a row `score: 4.2134, seeds_finished: 5, seeds_total: 5` heads `th.time` `rating`, its cell reads `4.21 N`, no `th.speed`/`th.seeds`. `roundcard.test.js`: `roundCard(TUG, [{ user: "nico", score: 4.2134, seeds_finished: 5 }], { number: 5 })` → cells `["0.3 m pit", "7 N winch", "Legs"]`, `.round-card__score` text `4.21 N@nico`, category `versus`, cta `Pull!`. `player.test.js`, shaped like "says how many votes it earned": `profile(player)` with one publication `{ event_id: "tug-of-war", event_title: "Tug of War", rank: 1, score: 4.2134, seeds_finished: 5, seeds_total: 5, policy_name: "puller", run_id: "r9", submitted_at: "2026-10-20T10:00:00Z", votes: null, metric: "mean_hold_force" }` → its `.profile-results a` contains `#1 · 4.21 N`.

- [ ] **Step 2: Run** `npx vitest run src/tug.test.js src/format.test.js src/board.test.js src/roundcard.test.js src/player.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** `format.js`: `isTug`, `formatScore`, the tug's facts. `tug.js`: `stringEnd` is `arena/tug.string_ends`' rotation on `frame[0..7]`. `board.js`: `metric` to `formatScore`; on a tug the column heads `rating` (class still `time`, which the reveal reads) and the speed and seeds columns go, as on a stage. `roundcard.js`: `CARDS["tug-of-war"] = { accent: "var(--lime)", cta: "Pull!" }`, `CATEGORY_SYMBOLS.versus = "emoji_events"`, the tug's cells, `metric` in `leaderLine`. `player.js`: `metric: pub.metric`.

- [ ] **Step 4: Run** the same. Expected: PASS.

- [ ] **Step 5: Commit.** `add app/src/tug.js app/src/tug.test.js app/src/format.js app/src/format.test.js app/src/board.js app/src/board.test.js app/src/roundcard.js app/src/roundcard.test.js app/src/player.js app/src/player.test.js` · `"The site counts the Tug of War in newtons: its board, its card, a player's results and the tug's own arithmetic"`

---

### Task 9: The tug drawn: the pit, the string and the winch

**Files:**
- Modify: `app/src/tug.js` (builders), `app/src/viewer.js`
- Test: `app/src/tug.test.js`

**Interfaces:**
- Consumes: Task 8's `tug.js`; `OVERRUN` (`course.js`); `attachStadium`, `buildGym`, `buildJudges` as the lane branch uses them.
- Produces (contract): `buildTugCourse(event)` → `Group "course"`: `"platform_west"`/`"platform_east"` (the platforms' lane part, between the walls: top at y 0, inner face at x = ±pit_m/2, out to ±(length_m/2 + OVERRUN)), the served walls, `"ground"` (`PlaneGeometry(length_m + 2·OVERRUN, width_m)` at y = −pit_depth_m: the pit's floor, and what `attachStadium` measures as on a lane), `"centre_line"` across it at x 0. `buildString()` → `{ group, update(a, b) }` (MJCF ends; a 2 mm cylinder `"string"` along y scaled to their distance, a red `"marker"` at the middle). `buildWinch(event)` → `{ group, setForce(newtons) }`: `"winch"` at `toThree(event.winch)`, drum, stand, a canvas-texture dial writing `"3.20 N"`, a `"needle"` at `rotation.z = −(newtons / top_n)·¾π`. `viewer.setLanes` takes the tug lanes of § Global Constraints.

- [ ] **Step 1: Failing tests**, appended to `app/src/tug.test.js` (merge the imports; extend the canvas mock with any other method the dial draws with):

```js
import { Vector3 } from "three";
import { vi } from "vitest";
import { OVERRUN } from "./course.js";
import { buildString, buildTugCourse, buildWinch } from "./tug.js";

describe("the tug drawn", () => {
  it("cuts the lane at the pit and lays the pit's floor deep", () => {
    const course = buildTugCourse(TUG);
    const west = course.getObjectByName("platform_west"), box = west.geometry.parameters;
    expect(west.position.y + box.height / 2).toBeCloseTo(0, 9);
    expect(west.position.x + box.width / 2).toBeCloseTo(-0.15, 9);
    expect(west.position.x - box.width / 2).toBeCloseTo(-(2 + OVERRUN), 9);
    const ground = course.getObjectByName("ground");
    expect([ground.position.y, ground.geometry.parameters.width]).toEqual([-0.3, 4 + OVERRUN * 2]);
    expect(course.getObjectByName("wall_left").position.toArray()).toEqual(toThree([0, 0.425, 0.075]));
    expect(course.getObjectByName("centre_line").position.x).toBe(0);
  });
  it("stretches the string between its ends and hangs the marker in the middle", () => {
    const string = buildString();
    string.update([-0.5, 0, 0.15], [0.5, 0, 0.15]);
    const rope = string.group.getObjectByName("string");
    expect(rope.scale.y).toBeCloseTo(1, 9);
    [0, 0.15, 0].forEach((v, i) => expect(rope.position.toArray()[i]).toBeCloseTo(v, 9));
    expect(new Vector3(0, 1, 0).applyQuaternion(rope.quaternion).x).toBeCloseTo(1, 9);
    expect(string.group.getObjectByName("marker").position.toArray()).toEqual(rope.position.toArray());
  });
  it("reads the winch's pull on its dial", () => {
    const fillText = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillText, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, stroke() {}, fill() {} });
    const winch = buildWinch(TUG);
    expect(winch.group.position.toArray()).toEqual(toThree(TUG.winch));
    winch.setForce(3.2);
    expect(fillText.mock.calls.at(-1)[0]).toBe("3.20 N");
    const once = winch.group.getObjectByName("needle").rotation.z;
    winch.setForce(6.4);
    expect(winch.group.getObjectByName("needle").rotation.z).toBeCloseTo(2 * once, 9);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tug.test.js`. Expected: FAIL (`buildTugCourse` not exported).

- [ ] **Step 3: Implement the builders** (materials from `palette.js`; platforms the track's colour; walls drawn translucent).

- [ ] **Step 4: Teach `viewer.setLanes` the tug** (vitest has no WebGL: Task 12 looks at it):
  - `let tug = null; // {event, rope, winch, profile} while a tug plays`, nulled by `clearScene` (rope and winch hang on `course`).
  - `setLanes`: `const tugged = isTug(event)`; then `profile = entries[0]?.bench ?? null`, `entries = entries.length ? tugDucks(entries[0]) : []`; `sideOffset` counts one lane. In the `else if (event)` branch: `course = tugged ? buildTugCourse(event) : attachCourse(…)` (`scene.add` for a tug); once stadium, gym and jury are built, a tug moves `audience.group`, `gym.group`, `judges.group` by `−event.length_m / 2` in x (built for a course from 0 to its length; the tug's is centred on the pit) and skips the floor-material swap; then `rope = buildString()` and, with a profile, `winch = buildWinch(event)`, both on `course`; `tug = { event, rope, winch, profile }`.
  - A tug duck is `placeLane(rig, 0)` (its trace is in world coordinates) under the stage's contact shadow, not a ring; no crowd progress on a tug.
  - `draw`: on a tug, `[a, b] = tugEnds(tug.event, lanes.map((lane, i) => frameAt(lane.trace, indices[i])))`, `tug.rope.update(a, b)`, `tug.winch?.setForce(forceAt(tug.profile, indices[0], lanes[0].lead))`, and every `lead` the camera and the screens read is `(a[0] + b[0]) / 2`, the string's middle.

- [ ] **Step 5: Run** `npx vitest run src/tug.test.js src/viewer.test.js src/stadium.test.js`. Expected: PASS.

- [ ] **Step 6: Commit.** `add app/src/tug.js app/src/tug.test.js app/src/viewer.js` · `"The viewer draws the tug: the lane cut by its pit, the string and its red marker, the winch and its dial"`

---

### Task 10: The bench on its pages and in its clip

**Files:**
- Modify: `app/src/lanes.js`, `app/src/cast.js`, `app/src/run.js`, `app/src/race.js`, `app/src/boardsheet.js`, `app/src/share.js`, `app/src/clip/score.js`, `app/src/clip/main.js`
- Test: `app/src/lanes.test.js`, `app/src/cast.test.js`, `app/src/run.test.js`, `app/src/race.test.js`, `app/src/boardsheet.test.js`, `app/src/share.test.js`, `app/src/clip/score.test.js`

**Interfaces:**
- Consumes: `isTug`, `formatScore`, the tug lanes; a run's and its rows' `bench`.
- Produces: `lanesFor` gives a tug the author's row; `replayLane` on a tug → `{ ...lane, tug: "bench", trace: traces[0] }` (the caller puts `bench` in `lane`); `run.js` exports `flipScore(run, { veiled })` and `seedText(seed)`, and on a tug `verdict` → `{ label: "rating · N", stamp: "RATED" }`, `replayLine` → `"replay: seed 3, the median pull"`; `clip/score.js` exports `clipVerdict(run) -> { stamp, pass }` (a tug: `HELD ON`, `PULLED IN` or `KNOCKED DOWN` from the traced seed's status), read by `clipScore` and the clip's `letter`.

- [ ] **Step 1: Failing tests**, with `TUG` (+ `clip: { sounds: ["crowd", "verdict"], tape_max_s: 30 }` where `clipScore` reads it) and `tugRun = { run_id: "R1", user: "nico", policy_name: "puller", event: TUG, score: 4.2134, seeds_finished: 5, seeds_total: 5, trace_seed: 3, rank: 2, on_board: true, withdrawn: false, receipts: [{ act: "run", points: 10 }], per_seed: [{ seed: 3, status: "held", time_s: null, force_n: 7 }], cast: [{ policy: "self" }] }`:
  - `lanes.test.js`: `lanesFor({ board, event: TUG })`, `board[1].you` → `[board[1]]`. `cast.test.js`: `replayLane(TUG, [{ policy: "self" }], [trace], { ...lane, bench: PROFILE })` → `{ ...lane, bench: PROFILE, tug: "bench", trace }`.
  - `run.test.js`: `verdict(tugRun)` and `replayLine(tugRun)` as above; `flipScore(tugRun)` `"4.21"`, veiled `"0.00"`; a race (`score: 12.3456`) `"12.346"`, veiled `"00.000"`; a DNF `"DNF"`; `seedText` of `{ seed: 3, status: "held", time_s: null, force_n: 7 }` → `"7.00 N · held on"`, `{ …, status: "pit", time_s: 21.7, force_n: 4.77 }` → `"4.77 N"`, `{ …, status: "fall", time_s: 1.02, force_n: 0.62 }` → `"0.62 N · knocked down"`, `{ seed: 1, status: "finish", time_s: 12.3456 }` → `"12.346s"`, `{ seed: 2, status: "fall", time_s: null }` → `"fall"`.
  - `race.test.js`: `renderEventFacts(root, TUG)`'s caveat → `"Ratings are measured on this bench, with this friction and this physics build. A policy tuned elsewhere can pull less here without being weaker."`. `boardsheet.test.js`: wired with `event: TUG`, `.pickall` is hidden.
  - `share.test.js`: the first two lines of `postText(tugRun, { origin: "https://x", network: "bluesky" })` → `"I coded a robot duck to pull. On Tug of War its rating is 4.21 N, #2 on the board (+10 pts)."`, `"Beat it: https://x/r/R1"`.
  - `clip/score.test.js`: `clipVerdict(tugRun)` → `{ stamp: "HELD ON", pass: true }`; the traced seed `"pit"` → `{ stamp: "PULLED IN", pass: true }`, `"fall"` → `{ stamp: "KNOCKED DOWN", pass: true }`; a race `{ stamp: "VICTORY", pass: true }`, its DNF `{ stamp: "DNF", pass: false }`, a stage `"WELL DONE"` / `"CUT SHORT"`; `clipScore({ run: tugRun, plan: clipPlan(100, 30, 26), trace, ducks: [] }).crowd.progress` → `[]`.

- [ ] **Step 2: Run** `npx vitest run src/lanes.test.js src/cast.test.js src/run.test.js src/race.test.js src/boardsheet.test.js src/share.test.js src/clip/score.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** `lanes.js`, `boardsheet.js` (`solo`), `cast.js` as specified; `race.js`: one lane as on a stage, the caveat, a `benches` map filled from the rows beside `liveries` and handed as the lane's `bench`. `run.js`: `renderRun` uses `flipScore(run, { veiled: revealing })` and `seedText`; its `race()` gives each lane `bench: byId.get(id).bench`. `share.js::postText`: a tug says `pull`, then `On {title} its rating is {score.toFixed(2)} N{place}{points}.` and `Beat it:`. `clip/score.js`: `clipVerdict` takes today's stamp choice out of `letter()` and adds the tug's (the traced seed's `status`); `clipScore` takes `pass` for its verdict and gives a tug, like a stage, no progress. `clip/main.js` on a tug: `setLanes([{ tug: "bench", trace: traces[0][0], settle: settles[0][0], bench: run.bench, livery, name, colour }], run.event, { loop: false })` (one lane: the plan's `settle` count holds); `letter()` writes `formatScore(…, { metric: run.event.metric })`, labels the figure `rating`, keeps the place, and takes stamp and class from `clipVerdict`.

- [ ] **Step 4: Run** the same, then `cd <W>/app && npm test` (the 4 known failures only). Expected: PASS.

- [ ] **Step 5: Commit.** `add app/src/lanes.js app/src/lanes.test.js app/src/cast.js app/src/cast.test.js app/src/run.js app/src/run.test.js app/src/race.js app/src/race.test.js app/src/boardsheet.js app/src/boardsheet.test.js app/src/share.js app/src/share.test.js app/src/clip/score.js app/src/clip/score.test.js app/src/clip/main.js` · `"A bench run has its page and its clip: one duck against the winch, its rating in newtons, the dial rising"`

---

### Task 11: The workshop trains for the tug

**Files:**
- Modify: `arena/workshop/evaluations.py`, `arena/workshop/tickets.py`, `app/src/workshop/tickets.js`, `app/src/workshop/job.js`
- Test: `tests/workshop/test_tickets.py`, `tests/workshop/test_evaluations.py`, `app/src/workshop/tickets.test.js`, `app/src/workshop/job.test.js`

**Interfaces:**
- Consumes: `seed_row`, `Evaluation.bench`, `HIGHER_WINS`, the bench lane.
- Produces: a checkpoint body's seeds via `seed_row`, `bench` on a tug; `tickets._metric(challenge) -> str` replaces `_voted`, `_checkpoints(run, metric, key)` (no best on `"votes"`, the highest score on a `HIGHER_WINS` metric, the earliest checkpoint on a tie); front `measure(value, metric)` (`"4.21 N"` or `seconds(value)`), `bars(…, { future, onPick, metric })`, `summary(ticket, voted, metric)`, `officialTime` reading `s` or `N`.

- [ ] **Step 1: Failing tests.** `tests/workshop/test_tickets.py`:

```python
def add_tug(checkout):
    folder = checkout / "src" / "microduck_challenges" / "tug_of_war"
    folder.mkdir()
    (folder / "challenge.toml").write_text(SPRINT.replace('"sprint-2m"', '"tug-of-war"').replace(TASK, "Mjlab-TugOfWar-MicroDuck"))
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "Tug of War")

def test_the_best_tug_checkpoint_is_the_strongest(checkout, fakes, hub):
    add_tug(checkout)
    run = make_run(checkout, "first", checkpoints=(0, 1, 2), task="Mjlab-TugOfWar-MicroDuck")
    for n, rating in ((0, 2.0), (1, 5.5), (2, 4.0)):
        store_evaluation(run, n, score=rating)
    (ticket,) = reopen(checkout, hub).get("/api/workshop/challenges/tug-of-war/jobs").json()["jobs"]
    assert ticket["best"] == 1
```

  `tests/workshop/test_evaluations.py`: `add_tug` (from `test_tickets`), a client reopened as there, a tug run with checkpoint 1, `evaluate_next(client.app.state.workshop)`, then `GET /api/workshop/challenges/tug-of-war/jobs/first/checkpoints/1`: `body["seeds_total"] == 5`, every seed has `force_n`, `body["bench"]["top_n"] == 7.0`, `body["ducks"] == 1` (the fake export hands over the walker). `tickets.test.js`: rows `row(0, 2), row(1, 5.5), row(2, 4)`: `bars(rows, 1, { metric: "mean_hold_force" })` heights `["36%", "100%", "73%"]`, the second `best`; `summary({ ...TICKET, checkpoints: rows, best: 1 }, false, "mean_hold_force").textContent` → `"Best: checkpoint 1 · 5.50 N · 5/5"`; `officialTime("entered on tug-of-war: a 4.21 N rating")` → `"4.21 N"` and the sprint line still `"4.89 s"`. `job.test.js`:

```js
it("a tug's training rates its checkpoints in newtons and replays the bench", async () => {
  const TUG = { id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug", metric: "mean_hold_force", rig: "legs", vote: null };
  api.getJob.mockResolvedValue({ ...JOB, checkpoints: [row(0, 2), row(250, 5.5)], best: 250 });
  api.getCheckpoint.mockResolvedValueOnce({ checkpoint: 250, score: 5.5, ducks: 1, traces: [new Float32Array(21)], cast: null, bench: { top_n: 7 } });
  const root = document.createElement("div");
  await open(root, TUG);
  await settle();
  expect(root.querySelector(".ckpts .hint").textContent).toBe("The higher, the stronger. Click one to watch it.");
  expect(root.querySelector(".score__value").textContent).toBe("5.50 N");
  expect(viewer.setLanes).toHaveBeenLastCalledWith([expect.objectContaining({ tug: "bench", bench: { top_n: 7 } })], TUG);
});
```

- [ ] **Step 2: Run** `pytest … tests/workshop/test_tickets.py tests/workshop/test_evaluations.py` and `npx vitest run src/workshop/tickets.test.js src/workshop/job.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** `evaluations._measure`: seeds via `seed_row`, `**({"bench": result.bench} if result.bench else {})` (no `FORMAT` bump: no tug evaluation exists yet). `tickets.py`: `_metric`, the direction in `_checkpoints`, callers pass the metric. `tickets.js`: `measure`, bars against the strongest on a tug, `describe`/`summary` in the unit, `ticketCard` handing them `event.metric`, `officialTime` on `/: (?:a )?([\d.]+) (s|N)\b/`. `job.js` on a tug: the hint, the caveat `"Indicative: only the Arena rates an entry."`, the value via `measure`, a seeds line without speed, and `play()` hands `{ tug: "bench", trace: body.traces[0], bench: body.bench, livery: "classic", name }`.

- [ ] **Step 4: Run** the same, then the workshop suite (call 1). Expected: PASS.

- [ ] **Step 5: Commit.** `add arena/workshop/evaluations.py arena/workshop/tickets.py app/src/workshop/tickets.js app/src/workshop/job.js tests/workshop/test_tickets.py tests/workshop/test_evaluations.py app/src/workshop/tickets.test.js app/src/workshop/job.test.js` · `"The workshop trains for the Tug of War: each checkpoint rated on the bench, the strongest starred, replayed against the winch"`

---

### Task 12: Both suites, a local rehearsal, the card's placeholder art

**Files:** Create `app/public/cards/tug-of-war.webp` (a placeholder the owner may replace). Anything the rehearsal shows wrong is fixed with its own test, in its own commit.

- [ ] **Step 1: Every suite**, foreground: both Python calls and `cd <W>/app && npm test`. Expected: Task 1's counts plus this plan's tests; only the 4 known `brightness.test.js` failures.

- [ ] **Step 2: Score and serve.** `cd <W>/app && npm run build`. `<W>/.venv/bin/arena score <W>/arena/assets/policies/BEST_alpha_walking.onnx --event tug-of-war --store <S>/tug-store --user nico --name walker` (and the same with a Plan B checkpoint's ONNX, `--name puller`, if one is exported). In the background, by absolute path: `ARENA_FRONTEND=<W>/app/dist <W>/.venv/bin/arena serve --store <S>/tug-store --port 8011`; check with `ps -o command -p` on port 8011's listener that it is the worktree's binary.

- [ ] **Step 3: Look at the pages.** Headless Chrome (puppeteer from `/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer`, `--no-sandbox`, 1920×1080, scale 1); screenshots into `<S>`, each read: the home wall (the tug card, `Pull!`, `x.xx N`), `#/e/tug-of-war` (facts, caveat, `rating` in N, one duck), `#/r/<run_id>` under `prefers-reduced-motion: reduce` (flip, `rating · N`, `RATED`, seeds in N). On the stage: platforms, pit, walls, the string from the duck's neck across the pit to the winch, the red marker at its middle, the dial, the stadium round it, the camera on the string.

- [ ] **Step 4: Render the clip.** `<S>/chrome.sh`: `#!/bin/sh` and `exec "/Users/nicolasrabault/.cache/puppeteer/chrome/mac_arm-140.0.7339.82/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" --use-mock-keychain --password-store=basic "$@"`; `chmod +x`. `CHROME=<S>/chrome.sh ARENA_FRONTEND=<W>/app/dist <W>/.venv/bin/arena clip <run_id> --store <S>/tug-store --parallel 4` (foreground; ~900 frames a layout). `ffmpeg -ss <t> -i <landscape mp4> -frames:v 1 <S>/clip-<t>.png` at 2 s, the middle and the end; read them and the poster: the title, the dial in N, the duck going out (falling, or dragged into the pit) or holding to the end, its stamp (`KNOCKED DOWN`, `PULLED IN` or `HELD ON`), the figures `x.xx N` · `rating` · `#1`.

- [ ] **Step 5: The card.** Screenshot `http://127.0.0.1:8011/clip.html?run=<run_id>&layout=landscape&frame=<window.clip.plan.poster>` at 1920×1080; `ffmpeg -i <S>/card.png -vf "crop=720:667:600:206" <S>/card-crop.png` (move the crop until duck, string and dial are in it; read it); `cwebp -q 82 <S>/card-crop.png -o <W>/app/public/cards/tug-of-war.webp`; reload the home wall and look. Stop the server.

- [ ] **Step 6: Commit.** `add app/public/cards/tug-of-war.webp` · `"The Tug of War's card shows the bench: a still of the duck against the winch, until the owner draws one"`. Report Task 3's commit hash (Plan B's start), Task 5's (Plan B's scoring), the rehearsal's rating, the images read (paths) and what was fixed.
