# Versus E — The Rating Against the Reference Duck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tug entry is rated by five 45 s bouts against a frozen reference duck shipped with the Arena (centimetres of marker won, a pit worth 100 cm); its page and clip replay the median bout with the entry and "Reference" on the rope; the winch bench is gone from every layer.

**Architecture:** The reference ONNX is vendored beside the golden walker and named by the event's new `[rating]`. `arena.evaluate` plays one `run_bout` per seed (entry west on odd seeds, east on even), `arena.tug` scores each bout for the entry, and the traced bout is stored as a two-duck trace; every consumer recomputes the entry's side from `trace_seed`, so no record field is added. Then the bench is removed outright, Python and front.

**Tech Stack:** Python 3.12, MuJoCo 3.10, FastAPI, pytest; vanilla JS, three.js 0.169, vitest + jsdom; headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md` as amended 2026-10-20 night (58acfc1), §1 and §2. **Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md` — Task 1 rewrites its "Plan A — names" (where the bench was) and "Plan B — cross-repo names" (its plans table and order of execution already name E and F); Task 8 its "Plan D — names" moments. **Plan F:** `docs/superpowers/plans/2026-10-20-versus-f-opponent-training.md` (the challenges side; it owns microduck_rl's publish line, its Task 8).

## Global Constraints

- The contract's global constraints apply (unsigned English commits, `/usr/bin/git`, `uv run --no-config --frozen`, no globs or shell variables, tests in the FOREGROUND with `timeout: 600000`, nothing leaves this Mac without the owner's yes).
- Shorthands, written out in full in every call: **PYTEST** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider`; **SUITE** the contract's two Python calls then `cd …/versus/app && npm test` (only the 4 known brightness failures); **VITEST** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app && npx vitest run`; **GIT** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`; **CHALLENGES** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && uv run --no-config --no-sync pytest -q -p no:cacheprovider tests` (never a sync there: it swaps the editable versus Arena for the locked wheel); **CGIT** `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war`; **SCRATCH** the session scratchpad's absolute path.
- **Order** (the contract's, 2026-10-20 night): Plan F's Task 1 first, on microduck-challenges branch `tug-of-war` (it takes the winch and the bench out of the challenges' env, `check.py` and parity tests, against the Arena as it stands, leaving `BOUT_S = 20.0`, `compile_tug(EVENT, 2)`, `tug_layout(EVENT.course, 2)`); then this plan's Tasks 1–8, after Plan C Task 7 (57f8e62); then Plan F's Tasks 2–8 (its Task 7's trainings on HF Jobs in the background); while they train, Plan C's Tasks 8–14, then Plan D; Plan F's Task 9 at release. Check first: `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war && rtk proxy grep -rnI "WINCH\|winch_position\|bench_profile\|bench_force\|EVENT.bench\|compile_tug(EVENT, 1)\|tug_layout(EVENT.course, 1)" src tests` prints nothing, else stop and report.
- **Cross-repo sittings.** Tasks 2 and 4 are retunes in the contract's sense and end with CHALLENGES green. A failure there must be a pin of what the task changes on purpose (Task 2: the 45 s bout, i.e. Plan F's `tug.BOUT_S == EVENT.bout.time_limit_s` and episode length → `BOUT_S = 45.0` in `env.py`, which Plan F's Task 2 then only asserts; Task 4: `compile_tug(EVENT, 2)` → `compile_tug(EVENT)` and `tug_layout(EVENT.course, 2)` → `tug_layout(EVENT.course)` in `tests/test_tug_of_war.py`, the `arena_model` fixture and `test_the_start_is_the_arenas`, the only callers; `check.py` calls neither): bring the challenges' copy to the Arena's, nothing else, and commit it there (CGIT, files by name). Any other failure stops the task. Plan F's Tasks 2–9 call the one-argument forms.
- **Pinned.**
  - Reference duck `arena/assets/policies/tug-reference-t7-250.onnx`, sha256 `0c4e8b0abc9223c51bc4a32bc78591a4dc72c92ff873b6de7cd894bfad4bc1a2`. `*.onnx` is already an LFS rule in `.gitattributes`: `scripts/deploy_space.py served_as_pointers` and the release's wheel check pass it unchanged.
  - `metric = "mean_ground_cm"` (in `HIGHER_WINS`); `[rating] pit_bonus_cm = 100.0`; `time_limit_s = 45.0` at the top and in `[bout]`, validated equal; `[clip] tape_max_s = 45.0` (the whole bout: a 51.04 s clip).
  - Why 100 cm: the marker is the string's middle, so while the losing duck is out of the pit it stands at most `string_m/2 + pit_m/2` = 65 cm towards the winner, and at a drop it is never more than ~2 cm on the faller's side: one string length makes every pit finish outscore every marker finish. Measured drafting (Mac): marker finishes −16…+10 cm, a duck walking itself in −143…−146 cm.
  - Entry west on odd seeds, east on even (`entry_side`/`entrySide`). Seed statuses, the entry's view: `won`, `lost` (marker), `pit_won`, `pit_lost` (pit), `draw`; words `won the pull`, `lost the pull`, `pulled it in`, `dragged in`, `draw`; the clip stamps them upper-case, a pass for `won`/`pit_won`. The reference on screen: `Reference`, livery `charcoal`, or `classic` when the entry wears `charcoal` (the two ducks on the rope never share a livery). Ratings print to 0.1 cm (`-15.2 cm`); the booth's close gap is under 5 cm.
- **No dead code.** Task 2 leaves the bench code unused but tested for one task; Task 4 removes it, Tasks 4 and 7 grep that none is left.
- **Untouched:** the golden run, `RUNNER_VERSION` 4, races, the stage, `run_bout`/`play_match` and Plan C Tasks 1–7, but for their `compile_tug` calls. Mac numbers are indicative; tests pin behaviour.

## Review Focus

1. **The entry on the reference's end** — three places recompute the side. Tests: Task 2 `test_a_tug_is_rated_by_one_bout_a_seed_against_the_reference`, Task 5 `puts the entry west on an odd seed…`, Task 7 `stampLane lands the stamp on the entry's duck…`.
2. **A sign turned the wrong way** (ground from either end, the bonus, both in on one step). Test: Task 2 `test_a_bout_scores_the_ground_the_entry_won_and_the_pit_either_way`.
3. **Another reference than t7-250** (an LFS pointer, a re-export). Tests: Task 1 `test_the_tug_reference_duck_is_t7_250_byte_for_byte`, Task 2 `reference_duck(TUG).sha256`.
4. **The challenges broken out of step.** Tests: CHALLENGES in Tasks 2 and 4; Task 4's grep.
5. **Negative ratings where only positive newtons were met.** Tests: Task 7 `a tug's bars span its worst to its best…`, `reads a negative rating off the entry's line`; Task 3 `test_a_tug_best_beaten_by_a_little_below_zero_is_no_big_margin`; Task 2's CLI regex (Plan F reads it, and its Task 8 the publish line).

---

### Task 1: The reference duck ships with the Arena, and the contract says so

**Files:** Create `arena/assets/policies/tug-reference-t7-250.onnx`. Modify `arena/assets/PROVENANCE.md`, `tests/test_assets.py`, `docs/superpowers/plans/2026-10-19-versus-interfaces.md`.

**Interfaces:** Produces `tests.test_assets.REFERENCE_SHA256` and the contract text below.

- [ ] **Step 1: Failing test** in `tests/test_assets.py` (it gains `import hashlib`):

```python
REFERENCE_SHA256 = "0c4e8b0abc9223c51bc4a32bc78591a4dc72c92ff873b6de7cd894bfad4bc1a2"

def test_the_tug_reference_duck_is_t7_250_byte_for_byte():
    """Every tug rating is bouts against it: an LFS pointer or another checkpoint changes them all."""
    blob = (ASSET_ROOT / "policies" / "tug-reference-t7-250.onnx").read_bytes()
    assert hashlib.sha256(blob).hexdigest() == REFERENCE_SHA256
```
- [ ] **Step 2:** `PYTEST tests/test_assets.py` → FAIL (no file).
- [ ] **Step 3:** `cp /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/logs/tug_of_war/onnx/t7-250.onnx /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/arena/assets/policies/tug-reference-t7-250.onnx`. `PROVENANCE.md` gains `## The tug's reference duck`: every tug rating is five bouts against it (`[rating]`); a table of source (`Nico-robot/mjlab-tugofwar-microduck-t7`, checkpoint 250, exported to ONNX), recipe (microduck-challenges `tug-of-war` at `370239a`), sha256, date; it walks back and pulls the string taut; frozen: replacing it changes every rating, so never without the owner's decision on the board.
- [ ] **Step 4:** `PYTEST tests/test_assets.py` → PASS.
- [ ] **Step 5: The contract** (its plans table and order of execution already name E and F).
  - Settled by the owner: "A's stamp words `RATED` / `HELD ON` / `PULLED IN`, the lime round card with `Pull!` and its placeholder art, a bench clip of about 35 s." → "the run page's stamp `RATED`, the lime round card with `Pull!`; 45 s bouts, a rating of five bouts against a frozen reference duck in cm with a pit bonus, no winch (2026-10-20 night)."
  - "Plan A — names" → "Plan A — names (as Plan E leaves them)". Delete `Bench`, `WINCH_SITE`, `WINCH`, `winch_position`, `compile_tug`'s bench branch, `bench_profile`, `bench_force`, `BenchOutcome`, `run_bench`, `force_n`, `mean_hold_force`, `RunRecord.bench`, `Evaluation.bench`, the API's `winch`/`bench`, `benchForce`, `forceAt`, `buildWinch`, the bench lane, `HELD ON | PULLED IN`; keep the rest as written; add:

```python
# manifest.py
METRICS = ("mean_finish_time", "votes", "mean_ground_cm"); HIGHER_WINS = frozenset({"mean_ground_cm"})
@dataclass(frozen=True)
class Rating:
    reference: str        # the reference duck: a file name in arena/assets/policies/
    pit_bonus_cm: float   # added when the reference ends in the pit, taken off when the entry does
# Manifest gains rating: Rating | None = None, bout: BoutRules | None = None. A tug: versus and mean_ground_cm, needs
# [rating] and [bout], its time_limit_s equal to [bout]'s; others refuse both.
# course.py
def tug_layout(course, rig: str = "legs") -> list[Start]   # [west yaw 0, east yaw 180]
def compile_tug(manifest: Manifest) -> mujoco.MjModel       # two ducks, STRING limited to (0, string_m)
# tug.py
SIDES = ("west", "east")
def reference_duck(manifest: Manifest) -> Policy            # load_policy(ASSET_ROOT / "policies" / manifest.rating.reference)
def entry_side(seed: int) -> int                            # 0 (west) on an odd seed, 1 (east) on an even one
def bout_status(outcome: BoutOutcome, entry: int) -> str    # "won" | "lost" | "pit_won" | "pit_lost" | "draw"
def bout_score_cm(outcome: BoutOutcome, entry: int, pit_bonus_cm: float, offset) -> float
# evaluate.py
SeedResult(seed, status, time_s, score_cm: float | None = None); def mean_ground_cm(per_seed, time_limit_s) -> float
# a tug: one run_bout per seed, the entry on entry_side(seed), reference_duck opposite; trace seed = lower median by
# (score_cm, seed), its (2, frames, 21) trace and settle; no record field (a page places the entry by trace_seed)
```
  - The toml block: `time_limit_s = 45.0`, `metric = "mean_ground_cm"`, `[bench]` replaced by Task 2's `[rating]`, `[bout] time_limit_s = 45.0`, `[clip] tape_max_s = 45.0`. `arena score` on a tug (Plan F reads it): per seed `f"seed {s}: {SIDES[entry_side(s)]:<4} {status:<8} {score_cm:+7.1f} cm at {time_s:.2f} s"`, then `f"rating: {score:.1f} cm · replay from seed {n}"` (a minus sign when negative).
  - API: a tug's summary serves `course`, the lane's numbers, `walls`, `pit`, `string_offset`, `bout`; `per_seed` items carry `score_cm`; every board row carries `trace_seed`. JS: `formatScore` → `"12.3 cm"`; `tug.js` `SIDES`, `entrySide`, `REFERENCE`, `BOUT_WORDS`, `ratingLane(traces, settles, {traceSeed, livery, name})`, `tugEnds(event, frames)` (two ducks), `tugSpan(frames)`; `clipVerdict` stamps a tug's traced status; `clip/plan.js stampLane(run, laneCount)`; a tug lane is only `{tug: "bout", ducks: [west, east]}`.
  - "Plan B — cross-repo names" (Plan F keeps them): drop `WINCH_SITE`, `WINCH`, `winch_position`, the gear sign, the bench keyframe, `bench_profile`, `bench_force`, `[bench]`; `tug_layout`'s two starts; add `[bout]`, `[rating]` and the reference duck's bytes; a retune covers `[command]`, `[bout]`, `[rating]`. microduck_rl (Plan F's Task 8): `[publish] entered on tug-of-war: a 12.3 cm rating → <page url>` (metric `mean_ground_cm`). "Plan C — names": `Entrant.rating` is in cm.
- [ ] **Step 6:** `GIT add arena/assets/policies/tug-reference-t7-250.onnx arena/assets/PROVENANCE.md tests/test_assets.py docs/superpowers/plans/2026-10-19-versus-interfaces.md`; `GIT commit -m "The Tug of War's reference duck ships with the Arena: t7-250, the checkpoint that walks back and pulls the string taut"`; `GIT lfs ls-files` lists it.

---

### Task 2: A tug is rated by five bouts against the reference duck

**Files:** Modify `arena/manifest.py`, `arena/events/tug-of-war.toml`, `arena/tug.py`, `arena/evaluate.py`, `arena/store.py`, `arena/cli.py`, `arena/recover.py`; tests `tests/test_manifest.py`, `test_tug.py`, `test_evaluate.py`, `test_store.py`, `test_cli.py`, `test_routes_read.py`, `test_routes_submit.py`, `tests/workshop/test_evaluations.py`; the challenges pins of Step 6.

**Interfaces:** Consumes Task 1's ONNX, `REFERENCE_SHA256`; Plan A's `run_bout`, `BoutOutcome`, `marker_x`, `in_pit`, `string_offset`. Produces Task 1's manifest, tug and evaluate names (`force_n` renamed `score_cm`), `evaluate._evaluate_rating`, `cli._print_rating`.

- [ ] **Step 1: Failing tests.**

```python
# tests/test_tug.py
def bout_trace(x, pit=()):
    """One frame of a bout whose marker stands x m east of the centre line; the ducks in `pit` below the floor."""
    trace = np.array([[frame((-0.6 + x, 0, 0.1), WEST)], [frame((0.6 + x, 0, 0.1), EAST)]])
    for k in pit:
        trace[k, 0, 2] = -0.1
    return trace

def test_a_bout_scores_the_ground_the_entry_won_and_the_pit_either_way():
    out = lambda loser, how, x, pit=(): BoutOutcome(1, loser, how, 45.0, bout_trace(x, pit), np.zeros((2, 26, 21)))
    assert [bout_score_cm(out(1, "marker", -0.1), e, 100.0, OFFSET) for e in (0, 1)] == pytest.approx([10.0, -10.0])
    assert [bout_score_cm(out(1, "pit", -0.1, (1,)), e, 100.0, OFFSET) for e in (0, 1)] == pytest.approx([110.0, -110.0])
    assert bout_score_cm(out(1, "marker", -0.1, (0, 1)), 0, 100.0, OFFSET) == pytest.approx(10.0)   # both in: no bonus
    drawn = BoutOutcome(1, None, "draw", 0.02, np.zeros((2, 0, 21)), np.zeros((2, 26, 21)))        # reset before a frame
    assert bout_score_cm(drawn, 0, 100.0, OFFSET) == 0.0 and bout_status(drawn, 1) == "draw"
    assert [bout_status(out(1, "pit", 0.0, (1,)), e) for e in (0, 1)] == ["pit_won", "pit_lost"]
    assert [bout_status(out(0, "marker", 0.1), e) for e in (0, 1)] == ["lost", "won"]
    assert [entry_side(s) for s in (1, 2, 3, 4, 5)] == [0, 1, 0, 1, 0] and SIDES == ("west", "east")
    assert reference_duck(TUG).sha256 == REFERENCE_SHA256

# tests/test_evaluate.py (replaces the bench tests; bout_trace from tests.test_tug)
def test_a_tug_is_rated_by_one_bout_a_seed_against_the_reference(monkeypatch):
    entry, reference, played = object(), object(), []
    bouts = {1: (1, "marker", -0.10, ()), 2: (1, "marker", -0.20, ()), 3: (1, "pit", -0.30, (1,)),
             4: (0, "marker", 0.02, ()), 5: (0, "marker", 0.05, ())}
    def fake(manifest, west, east, seed, model=None):
        played.append((seed, west is entry, {id(west), id(east)} == {id(entry), id(reference)}))
        loser, how, x, pit = bouts[seed]
        return BoutOutcome(seed, loser, how, 45.0, bout_trace(x, pit), np.zeros((2, 26, 21)))
    monkeypatch.setattr("arena.evaluate.reference_duck", lambda manifest: reference)
    monkeypatch.setattr("arena.evaluate.compile_tug", lambda *args: "model")
    monkeypatch.setattr("arena.evaluate.run_bout", fake)
    result = evaluate(TUG, entry)
    assert played == [(1, True, True), (2, False, True), (3, True, True), (4, False, True), (5, True, True)]
    assert [s.status for s in result.per_seed] == ["won", "lost", "pit_won", "won", "lost"]
    assert [s.score_cm for s in result.per_seed] == pytest.approx([10.0, -20.0, 130.0, 2.0, -5.0])
    assert (result.score, result.trace_seed, result.seeds_finished) == (pytest.approx(23.4), 4, 5)
    assert (result.command_vx, result.scan, result.trace.shape, result.settle.shape) == (-0.3, (), (2, 1, 21), (2, 26, 21))

def test_the_reference_against_itself_wins_no_ground_to_speak_of():
    result = evaluate(TUG, reference_duck(TUG))
    assert abs(result.score) < 10.0 and not [s for s in result.per_seed if s.status.startswith("pit")]
    assert result.trace.shape[0] == 2 and result.settle.shape == (2, 26, 21)

def test_a_duck_that_walks_forward_drops_itself_in_and_rates_below_minus_the_bonus():
    with pytest.raises(ValueError, match="against its reference duck"):   # a tug takes no cast
        evaluate(TUG, object(), cast=())
    result = evaluate(TUG, load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"))
    assert {s.status for s in result.per_seed} == {"pit_lost"} and result.score < -TUG.rating.pit_bonus_cm

def test_a_seed_row_carries_centimetres_only_on_a_tug():
    assert seed_row(SeedResult(2, "won", 45.0, 12.5)) == {"seed": 2, "status": "won", "time_s": 45.0, "score_cm": 12.5}
    assert seed_row(SeedResult(1, "finish", 4.9)) == {"seed": 1, "status": "finish", "time_s": 4.9}
```
  - `test_manifest.py`: `TUG`'s root says `"mean_ground_cm"`; `RATING = '[rating]\nreference="tug-reference-t7-250.onnx"\npit_bonus_cm=100.0\n'` goes before its `[bout]`, now `time_limit_s=10.0` (GOOD's); the `needs \[bench\]` case keeps `RATING`. `test_the_tug_of_war_loads`: `m.rating == Rating("tug-reference-t7-250.onnx", 100.0)`, `m.bout == BoutRules(45.0, 2, 5)`, `(m.category, m.metric, m.rig, m.time_limit_s, m.clip.tape_max_s) == ("versus", "mean_ground_cm", "legs", 45.0, 45.0)`. New refusals: no `RATING` → `r"needs \[rating\]"`; `t9.onnx` → `r"\[rating\] reference"`; `pit_bonus_cm=0.0` → `r"\[rating\] pit_bonus_cm"`; `opponent=1` → `"unknown keys"`; `[bout]` at `12.0` → `"time_limit_s is its bouts'"`; a race with `RATING` → `"only a tug"` (the `0.01` case replaces `time_limit_s=10.0`).
  - `test_store.py`: a record with `per_seed=(SeedResult(1, "won", 45.0, 12.5),)` round-trips, its raw seed holding `"score_cm": 12.5`. `test_cli.py`'s tug test: five `^seed [1-5]: (west|east) (won|lost|draw|pit_won|pit_lost) +[+-]\d+\.\d cm at \d+\.\d\d s$`, one `^rating: -?\d+\.\d cm · replay from seed [1-5]$`, the board holding `" cm"`. `test_routes_read.py`: the tug's metric and `bout == {"time_limit_s": 45.0, "bouts_to_win": 2, "max_bouts": 5}`; the rated run records `SeedResult(1, "won", 45.0, 7.0)` and serves `{"seed": 1, "status": "won", "time_s": 45.0, "score_cm": 7.0}`. `test_routes_submit.py::test_a_tug_entry_is_rated_in_bouts_against_the_reference` and `test_evaluations.py::test_a_tug_checkpoint_is_rated_against_the_reference` (renamed from `…_on_the_bench`): `score_cm` on every seed, no `bench` line; the first `metric == "mean_ground_cm"` and `X-Duck-Count == "2"`, the second `ducks == 2`.
- [ ] **Step 2:** `PYTEST tests/test_tug.py tests/test_evaluate.py tests/test_manifest.py tests/test_store.py tests/test_cli.py tests/test_routes_read.py tests/test_routes_submit.py` and `PYTEST tests/workshop/test_evaluations.py` → FAIL.
- [ ] **Step 3: Implement.**
  - `manifest.py`: Task 1's `METRICS`, `HIGHER_WINS`, `Rating`, `Manifest.rating` (after `bench`); `_rating(raw, path)` refuses other keys than `reference`, `pit_bonus_cm`, a `reference` that is not a bare name of a file in `ASSET_ROOT / "policies"` (`f"{path}: [rating] reference {name!r} is no policy in arena/assets/policies"`), `pit_bonus_cm <= 0` (`"[rating] pit_bonus_cm must be positive"`); a tug needs `[rating]` like `[bout]`; after `_bout`, `f"{path}: a tug's time_limit_s is its bouts': {a} against [bout]'s {b}"`; non-tugs: "only a tug takes [bench], [rating] and [bout]"; the category comment: a versus event rates a duck in bouts against a reference duck.
  - The toml: `time_limit_s = 45.0  # a bout's timed length, after the settle, as [bout] says`, `metric = "mean_ground_cm"`, `[bout] time_limit_s = 45.0`, `[clip] tape_max_s = 45.0`, and after `[termination]`:

```toml
[rating]                      # one bout a seed against the reference duck, the entry west on odd seeds
reference    = "tug-reference-t7-250.onnx"   # in arena/assets/policies/
pit_bonus_cm = 100.0          # a pit outweighs any marker margin: 65 cm at most
```
  - `tug.py`: `SIDES`, `reference_duck`, `entry_side`, `bout_status` (no loser → `"draw"`; lost when `loser == entry`; `pit_` prefix when `how == "pit"`), and:

```python
def bout_score_cm(outcome, entry, pit_bonus_cm, offset):
    if outcome.how == "draw":   # the centre line exactly, or a step MuJoCo reset: nobody's ground
        return 0.0
    x = float(marker_x(outcome.trace[:, -1:], offset)[0])
    last = outcome.trace[:, -1]
    pits = int(in_pit(last[1 - entry])) - int(in_pit(last[entry]))
    return 100.0 * (-x if entry == 0 else x) + pit_bonus_cm * pits
```
  - `evaluate.py`: `force_n` → `score_cm` (`seed_row` writes it when set); `mean_ground_cm = fmean(score_cm)` in `METRICS` instead of `mean_hold_force`; a tug goes to `_evaluate_rating` (a cast → `ValueError(f"{manifest.id} rates the entry alone, against its reference duck")`); `_evaluate_bench` and the `run_bench` import go; the docstring's bench paragraph tells the rating. `_evaluate_rating` uses module globals imported from `.tug` and `.course`:

```python
model, reference, offset = compile_tug(manifest, 2), reference_duck(manifest), string_offset(manifest.rig)
for seed in manifest.seeds:
    entry = entry_side(seed)
    west, east = (policy, reference) if entry == 0 else (reference, policy)
    out = outcomes[seed] = run_bout(manifest, west, east, seed, model)
    per_seed.append(SeedResult(seed, bout_status(out, entry), out.time_s,
                               bout_score_cm(out, entry, manifest.rating.pit_bonus_cm, offset)))
traced = outcomes[sorted(per_seed, key=lambda r: (r.score_cm, r.seed))[(len(per_seed) - 1) // 2].seed]
# Evaluation: METRICS score, command_vx=manifest.command[0], seeds_finished=len(per_seed), scan=(), traced's trace/settle/seed
```
  - `store.py` reads `score_cm=r.get("score_cm")`; `cli.py` `_print_bench` → `_print_rating` (Task 1's formats), the board cell `f"{r.score:>7.1f} cm"`; `recover.py` `f"{result.score:.1f} cm"`.
- [ ] **Step 4:** Step 2's commands → PASS; SUITE.
- [ ] **Step 5 (indicative):** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen arena score /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/logs/tug_of_war/onnx/t6-250.onnx --event tug-of-war` → five `won` lines near +10 cm, `rating:` within 10.0 ± 2.
- [ ] **Step 6: Challenges sitting:** CHALLENGES; the only failures allowed are the 45 s pins (`test_the_constants_are_the_arenas`, `test_the_start_is_the_arenas`; the challenges pin no metric): `BOUT_S = 45.0` in `src/microduck_challenges/tug_of_war/env.py`, nothing else; CGIT add it; CGIT `commit -m "The Tug of War trains for the Arena's 45 s bouts"`; CHALLENGES green.
- [ ] **Step 7:** `GIT add` the 7 sources and 8 tests; `GIT commit -m "The Tug of War rates a duck in five 45 s bouts against the reference duck: the centimetres of string it wins, a pit worth 100"`.

---

### Task 3: The booth, the unfurl card and the guide speak in centimetres

**Files:** Modify `arena/commentary/context.py`, `notable.py`, `generator.py`, `arena/web/routes_unfurl.py`, `docs/guides/challenges/tug-of-war.md`; tests `tests/test_commentary_context.py`, `test_commentary_notable.py`, `test_commentary_generator.py`, `test_clips.py`.

**Interfaces:** Consumes Task 2's statuses, `score_cm`, `manifest.rating`. Produces `context._rating_result(record, manifest) -> Fact` (replaces `_bench_result`); `measure()` → `("rating", "cm")` on a tug.

- [ ] **Step 1: Failing tests.**

```python
# tests/test_commentary_context.py (replaces bench_seeds and its test)
RATED = (SeedResult(1, "won", 45.0, 12.0), SeedResult(2, "won", 45.0, 8.0), SeedResult(3, "lost", 45.0, -4.0),
         SeedResult(4, "pit_won", 30.0, 130.0), SeedResult(5, "pit_lost", 4.5, -140.0))

def test_a_rated_run_states_its_ground_its_wins_and_its_gap_in_centimetres():
    manifest = load_event("tug-of-war")
    leader = run("carol", 5.0, "2026-09-10T10:00:00Z", event="tug-of-war", run_id="R0", per_seed=RATED)
    mine = run("alice", 1.2, "2026-09-11T10:00:00Z", event="tug-of-war", run_id="R1", per_seed=RATED)
    facts = {f.ref: f for f in result_facts(mine, manifest, [leader, mine], [])}
    assert facts["run#/event"].text == ("The event is the Tug of War, a pulling contest against the Arena's reference duck: "
                                        "the two are tied by a string across a pit and each pulls by walking backwards.")
    assert facts["run#/result"].text == (
        "The rating is 1.2 cm: the ground the duck won from the reference duck in 5 bouts, on average, 100 cm more "
        "for dragging it into the pit and 100 cm less for being dragged in; it won 3 of them.")
    assert facts["run#/result"].tags == ("won",)   # the traced seed, 1
    dragged = dataclasses.replace(mine, trace_seed=5)
    assert {f.ref: f for f in result_facts(dragged, manifest, [leader, dragged], [])}["run#/result"].tags == ("pit_lost",)
    assert facts["run#/board"].text == "On the Tug of War board this run ranks 2 of 2, 3.80 cm behind the leader, @carol."
    assert "close" in facts["run#/board"].tags

# tests/test_commentary_notable.py
def test_a_tug_best_beaten_by_a_little_below_zero_is_no_big_margin():
    first = run("alice", -20.0, "2026-09-10T10:00:00Z", event="tug-of-war")
    facts = facts_for(run("alice", -19.9, "2026-09-11T10:00:00Z", event="tug-of-war"), first)
    assert facts["notable#/personal-best"].text == "@alice beats their previous best on the Tug of War, -20.00 cm, by 0.10 cm."
    assert facts["notable#/personal-best"].tags == ("pb",)
```
  - The other notable tug tests read `cm` where they read `N`. `test_the_booth_is_taught_what_the_tug_is`: `"a duck's rating is the ground it wins from the Arena's reference duck" in BOOTH_CONTEXT and "winch" not in BOOTH_CONTEXT`. `test_clips.py::test_a_rated_run_is_described_by_its_rating` → `"@eve's duck holds a 4.2 cm rating on the Tug of War, #2 on the board."`.
- [ ] **Step 2:** `PYTEST tests/test_commentary_context.py tests/test_commentary_notable.py tests/test_commentary_generator.py tests/test_clips.py` → FAIL.
- [ ] **Step 3: Implement.**
  - `context.py`: `measure` → `("rating", "cm")` where higher wins; `nature` for a tug → the tested text, tags `("tug",)`; `_rating_result`: `f"The rating is {score:.1f} cm: the ground the duck won from the reference duck in {n} bouts, on average, {b:g} cm more for dragging it into the pit and {b:g} cm less for being dragged in; it won {w} of them."` (`w` counts `won` and `pit_won`, `b` = `pit_bonus_cm`), tagged with the traced seed's status; `_board`'s close gap `5.0 if unit == "cm" else 0.5`.
  - `notable.py personal_best`: `big = margin >= 0.1 * abs(best.score)`.
  - `generator.py BOOTH_CONTEXT`'s tug sentence: "In the tug of war two ducks tied by a string across a pit each pull by walking backwards; a duck's rating is the ground it wins from the Arena's reference duck over five bouts, in centimetres, a drop into the pit counting far more, and the higher the better. "
  - `routes_unfurl.describe`: `f"@{record.user}'s duck holds a {record.score:.1f} cm rating on the {event.title}"`.
  - The guide: "after **20 seconds**" → "after **45 seconds**"; "where the duck trains against the bench's own winch." → "where the duck trains against a frozen opponent duck on the Arena's own bout."; the "## Rating" body becomes exactly:

```markdown
The board ranks a rating from five bouts against the Arena's **reference duck**, a frozen policy
that walks backwards and pulls the string taut. Your duck plays the west end on odd starts and the
east end on even ones. A bout scores the centimetres the marker moved towards your duck by its end
(negative when the reference pulled it away), plus **100 cm** when the reference ends in the pit,
or minus 100 cm when your duck does. The rating is the mean of the five bouts; the higher rating wins.

For example, bouts of +12, +8 and −4 cm, one where the reference was dragged in with the marker
30 cm your way (+130) and one where your duck was, 40 cm the other way (−140), rate **1.2 cm**.
```
- [ ] **Step 4:** Step 2's command → PASS; SUITE.
- [ ] **Step 5:** commit the 9 files: `"Peter and Ray, the unfurl card and the guide tell a tug rating in centimetres won from the reference duck"`.

---

### Task 4: The winch and the bench leave the Arena

**Files:** Modify `arena/manifest.py`, `arena/events/tug-of-war.toml`, `arena/course.py`, `arena/tug.py`, `arena/match.py`, `arena/cupworker.py`, `arena/evaluate.py`, `arena/store.py`, `arena/cli.py`, `arena/recover.py`, `arena/web/routes_read.py`, `arena/web/routes_submit.py`, `arena/workshop/evaluations.py`; tests `tests/test_manifest.py`, `test_course.py`, `test_tug.py`, `test_cupworker.py`, `test_store.py`, `test_routes_read.py`; the challenges call sites of Step 6.

**Interfaces:** Produces `compile_tug(manifest)`, `tug_layout(course, rig="legs")`, board rows with `trace_seed`; removes every bench name of Task 1's list.

- [ ] **Step 1: Failing tests.** Delete every bench and winch test (course, tug, routes) and `TUG["sweep"]`'s `[bench]` with its two cases; `test_tug.py`'s `test_the_pit_and_the_winch` keeps its `in_pit` line as `test_a_trunk_below_the_drop_is_in_the_pit`; `test_cupworker.py`'s `lambda manifest, ducks:` → `lambda manifest:`; other tug model tests call `compile_tug(TUG)` and `tug_layout(TUG.course)` (the addresses test compares the stage's two ducks only).

```python
# tests/test_course.py
def test_a_tug_is_two_ducks_neck_to_neck_and_nothing_else():
    west, east = tug_layout(TUG.course)
    assert (west.x, west.y, west.yaw_deg, east.x, east.y, east.yaw_deg) == pytest.approx((-0.526, -0.0145, 0, 0.526, 0.0145, 180))
    model = compile_tug(TUG)
    assert model.nu == 28 and model.ntendon == 1 and len(model.key("STAND").ctrl) == 28
# tests/test_routes_read.py (and test_a_tug_serves_its_course_and_its_bouts: "winch" not in tug and "bench" not in tug)
def test_a_rated_run_serves_its_bouts_and_a_board_strongest_first_each_row_with_its_seed(client):
    api, app = client
    record_run(app, event_id="tug-of-war", user="bob", score=-15.2, trace_seed=2, per_seed=(SeedResult(2, "lost", 45.0, -15.2),))
    mine = record_run(app, event_id="tug-of-war", user="alice", score=12.5, trace_seed=1, per_seed=(SeedResult(1, "won", 45.0, 12.5),))
    body = api.get(f"/api/runs/{mine.run_id}").json()
    assert body["per_seed"] == [{"seed": 1, "status": "won", "time_s": 45.0, "score_cm": 12.5}] and "bench" not in body
    assert [(r["user"], r["trace_seed"]) for r in body["board"]] == [("alice", 1), ("bob", 2)]
```
- [ ] **Step 2:** `PYTEST tests/test_course.py tests/test_tug.py tests/test_manifest.py tests/test_store.py tests/test_routes_read.py tests/test_cupworker.py` → FAIL.
- [ ] **Step 3: Implement.**
  - `manifest.py`: `Bench`, `_bench`, `Manifest.bench` and every `[bench]` check go ("only a tug takes [rating] and [bout]"). The toml drops `[bench]`; `[command]`'s comment "every duck, every bout", `[termination]`'s "a fall never ends a bout".
  - `course.py`: `WINCH_SITE`, `WINCH`, `winch_position`, the bench branch go; `tug_layout(course, rig="legs")` returns both starts; `compile_tug(manifest)` ties two ducks; docstrings drop the winch.
  - `tug.py`: `bench_profile`, `bench_force`, `BenchOutcome`, `run_bench` and the imports only they used go; the docstring: a duck pulls against another duck, the reference duck on a rating seed.
  - `tug.py`'s `run_bout`, `match.py`, `cupworker.py`, `evaluate.py`: `compile_tug(manifest)`. `Evaluation.bench`, `RunRecord.bench` (field, `to_dict`, `from_dict`), every `bench=result.bench` (`cli.py`, `recover.py`, `routes_submit.py`) and `evaluations.py`'s `bench` key go.
  - `routes_read.py`: the summary drops `winch` (and its import) and `bench`; `run_detail` drops `bench`; `_board_row` drops `bench` and gains `"trace_seed": record.trace_seed` (a page places a rated run's entry by it).
- [ ] **Step 4:** Step 2's command → PASS; SUITE.
- [ ] **Step 5:** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && rtk proxy grep -rniIE "winch|bench|force_n|hold_force" arena` prints only `store.py`'s "open benchmark" and `commentary/generator.py`'s `scripts/commentary_bench.py` lines.
- [ ] **Step 6: Challenges sitting:** CHALLENGES; the only failures allowed are calls of the two signatures, in `tests/test_tug_of_war.py` (the `arena_model` fixture, `test_the_start_is_the_arenas`); rewrite them (`compile_tug(EVENT)`, `tug_layout(EVENT.course)`); CGIT add that file; CGIT `commit -m "The Tug of War calls the Arena's tug for its two ducks, now that the winch is gone"`; CHALLENGES green.
- [ ] **Step 7:** commit the 13 sources and 6 tests: `"The winch and the pulling bench leave the Arena: a tug is a bout of two ducks, and a board row says which seed it replays"`.

---

### Task 5: The page's tug plays the rated bout

**Files:** Modify `app/src/tug.js`, `tug.test.js`, `cast.js`, `cast.test.js`, `viewer.js`, `viewer.test.js` (a comment), `format.js`, `format.test.js`, `lanes.js` (a comment), `lanes.test.js` (a test name).

**Interfaces:** Consumes Task 4's summary and two-duck traces. Produces Task 1's JS names; `replayLane` gives a tug `{...lane, ...ratingLane(traces, null, lane)}` (the lane carries `traceSeed`).

- [ ] **Step 1: Failing tests.** Every tug fixture drops `winch`, `bench`, `PROFILE`, gains `bout: { time_limit_s: 45, bouts_to_win: 2, max_bouts: 5 }`, `metric: "mean_ground_cm"`; the `benchForce`, `forceAt`, `buildWinch` tests go.

```js
// tug.test.js
it("puts the entry west on an odd seed and east on an even one, the reference on the other end", () => {
  expect([1, 2, 3].map(entrySide)).toEqual([0, 1, 0]);
  expect(ratingLane(["tw", "te"], ["sw", "se"], { traceSeed: 2, livery: "blue", name: "@ann" })).toEqual({ tug: "bout", ducks: [
    { trace: "tw", settle: "sw", livery: "charcoal", name: "Reference" }, { trace: "te", settle: "se", livery: "blue", name: "@ann" }] });
  expect(ratingLane(["tw", "te"], null, { traceSeed: 3, livery: "blue", name: "@ann" }).ducks).toEqual([
    { trace: "tw", livery: "blue", name: "@ann" }, { trace: "te", livery: "charcoal", name: "Reference" }]);
  expect(ratingLane(["tw", "te"], null, { traceSeed: 1, livery: "charcoal", name: "@nico" }).ducks[1]).toEqual(
    { trace: "te", livery: "classic", name: "Reference" });
  expect(BOUT_WORDS).toEqual({ won: "won the pull", lost: "lost the pull", draw: "draw", pit_won: "pulled it in", pit_lost: "dragged in" });
});
it("ties the string to both necks, and holds a bout from duck to duck", () => {
  tugEnds(TUG, [A, B])[1].forEach((v, i) => expect(v).toBeCloseTo([0.574, 0, 0.1524215][i], 6));
  [A[0] - 0.15, B[0] + 0.15].forEach((v, i) => expect(tugSpan([B, A])[i]).toBeCloseTo(v, 9));
});
// the dispose test frees a course with buildString() on it: every geometry and material, no texture
// cast.test.js
it("puts a rated run's entry on its end of the string and the reference duck on the other", () => {
  const [west, east] = [frames(2, 0), frames(2, 1)];
  expect(replayLane(TUG, [{ policy: "self" }], [west, east], { ...lane, traceSeed: 4 })).toEqual({ ...lane, traceSeed: 4, tug: "bout",
    ducks: [{ trace: west, livery: "charcoal", name: "Reference" }, { trace: east, livery: "purple", name: "alice" }] });
});
// format.test.js
expect(formatScore(-15.24, { finished: 5, metric: "mean_ground_cm" })).toBe("-15.2 cm");
expect(formatEventFacts(TUG)).toEqual([{ label: "course", value: "4 m lane, 0.3 m pit" },
  { label: "bout", value: "up to 45 s" }, { label: "rig", value: "legs" }]);
```
- [ ] **Step 2:** `VITEST src/tug.test.js src/cast.test.js src/format.test.js src/lanes.test.js src/viewer.test.js` → FAIL.
- [ ] **Step 3: Implement.**
  - `tug.js`: delete `benchForce`, `forceAt`, `buildWinch`, `DRUM`, `DIAL`, `RIM`, `CENTRE`, `SWEEP`, `DIAL_PX` and the imports only they used; `disposeTugCourse` frees no map; `tugDucks` takes a bout lane only; `tugEnds` maps both frames through `stringEnd`; `tugSpan(frames)` = `[min x − DUCK_REACH, max x + DUCK_REACH]`; add `SIDES`, `entrySide`, `REFERENCE`, `BOUT_WORDS`, `ratingLane` (the entry `{trace, settle?, livery, name}` at `entrySide(traceSeed)`, `{trace, settle?, ...REFERENCE}` at the other, its livery `classic` when the entry wears `charcoal`; a `settle` key only when `settles` is given); the header comment.
  - `viewer.js`: `profile`, `buildWinch`, `forceAt`, `tug.winch` go (`tug = { event, rope: buildString() }`); `tugSpan(frames)` in `draw` and `setLanes`; comments.
  - `cast.js`, `lanes.js`: the tug branch and comments (a rated run plays alone, its traced bout). `format.js`: `` `${value.toFixed(1)} cm` `` for `mean_ground_cm`; `isTug`'s comment; the tug's facts.
- [ ] **Step 4:** Step 2's command → PASS; VITEST.
- [ ] **Step 5:** commit the 10 files: `"A rated run plays its median bout on the page: the entry on its end of the string, the reference duck on the other, no winch"`.

---

### Task 6: The run page, the race page, the board, the post, the card and the profile in centimetres

**Files:** Modify `app/src/run.js`, `run.test.js`, `race.js`, `race.test.js`, `board.js` (a comment), `board.test.js`, `boardsheet.js` (a comment), `boardsheet.test.js` (a test name), `share.js`, `share.test.js`, `roundcard.js`, `roundcard.test.js`, `player.test.js` (`player.js` formats through `formatScore`).

**Interfaces:** Consumes `replayLane`, `BOUT_WORDS`, `SIDES`, `entrySide`, board rows' `trace_seed`.

- [ ] **Step 1: Failing tests** (tug fixtures: `metric: "mean_ground_cm"`, `score: 12.34`, `per_seed: [{ seed: 3, status: "won", time_s: 45, score_cm: 10.1 }]`, `bout: { time_limit_s: 45 }`, no `bench`):

```js
// run.test.js
expect(verdict(tugRun)).toEqual({ label: "rating · cm", stamp: "RATED" });
expect(replayLine(tugRun)).toBe("replay: seed 3, the median bout");
expect([flipScore(tugRun), flipScore(tugRun, { veiled: true })]).toEqual(["12.3", "00.0"]);
expect(seedText({ seed: 3, status: "won", time_s: 45, score_cm: 10.14 })).toBe("+10.1 cm · west · won the pull");
expect(seedText({ seed: 2, status: "pit_lost", time_s: 4.5, score_cm: -143.42 })).toBe("-143.4 cm · east · dragged in");
// race.test.js
expect(renderEventFacts(root, TUG).textContent).toBe("Ratings are measured in bouts against the reference duck, with this " +
  "friction and this physics build. A policy tuned elsewhere can pull less here without being weaker.");
// share.test.js
"I coded a robot duck to pull. On Tug of War its rating is 12.3 cm against the reference duck, #2 on the board (+10 pts)."
// board.test.js td.time "12.3 cm"; roundcard.test.js cells ["0.3 m pit", "45 s bouts", "Legs"], score "12.3 cm@nico";
// player.test.js "#1 · 12.3 cm"
```
- [ ] **Step 2:** `VITEST src/run.test.js src/race.test.js src/board.test.js src/boardsheet.test.js src/share.test.js src/roundcard.test.js src/player.test.js` → FAIL.
- [ ] **Step 3: Implement.** `run.js`: the tug's `replayLine`, `verdict`, `flipScore` (`toFixed(1)`, veiled `"00.0"`), `seedText` for a seed with `score_cm` = `` `${score_cm >= 0 ? "+" : ""}${score_cm.toFixed(1)} cm · ${SIDES[entrySide(seed)]} · ${BOUT_WORDS[status]}` `` (`BENCH_ENDS` goes), the lane's `traceSeed: byId.get(id).trace_seed` instead of `bench`. `race.js`: `benches` → `seeds` (run id → `row.trace_seed`), the lane's `traceSeed`, the caveat, its comments. `share.js`: `` `On ${title} its rating is ${run.score.toFixed(1)} cm against the reference duck${place}${points}.` ``. `roundcard.js`: `stat("straighten", …pit)`, `stat("sports_score", `${event.bout.time_limit_s} s bouts`)`, the rig. `board.js`, `boardsheet.js`: comments (a tug is rated by its bouts against the reference; a rated run plays alone).
- [ ] **Step 4:** Step 2's command → PASS; VITEST.
- [ ] **Step 5:** commit the 13 files: `"The run page, the race page, the board, the post and the card tell a tug rating in centimetres, each bout by its side and how it ended"`.

---

### Task 7: The clip stamps the bout's verdict, and the workshop rates in centimetres

**Files:** Modify `app/src/clip/main.js`, `clip/plan.js`, `clip/plan.test.js`, `clip/score.js`, `clip/score.test.js`, `workshop/tickets.js`, `workshop/tickets.test.js`, `workshop/job.js`, `workshop/job.test.js`, `workshop/challenge.js`, `workshop/challenge.test.js`.

**Interfaces:** Produces `stampLane(run, laneCount) -> number` (the viewer lane the outro's stamp lands on), a tug's `clipVerdict`, `tickets.js` `measure`/`bars`/`officialTime` in cm.

- [ ] **Step 1: Failing tests.**

```js
// clip/score.test.js
const traced = (status) => ({ ...tugRun, per_seed: [{ seed: 3, status, time_s: 45, score_cm: 1 }] });
expect(["won", "lost", "draw", "pit_won", "pit_lost"].map((s) => clipVerdict(traced(s)))).toEqual([
  { stamp: "WON THE PULL", pass: true }, { stamp: "LOST THE PULL", pass: false }, { stamp: "DRAW", pass: false },
  { stamp: "PULLED IT IN", pass: true }, { stamp: "DRAGGED IN", pass: false }]);
// clip/plan.test.js
it("stampLane lands the stamp on the entry's duck, a race's on the author's lane", () => {
  expect([2, 3].map((seed) => stampLane({ event: TUG, trace_seed: seed }, 1))).toEqual([1, 0]);
  expect(stampLane({ event: { course: "lane" }, trace_seed: 2 }, 4)).toBe(3);
});
// workshop/tickets.test.js
it("a tug's bars span its worst to its best, in centimetres", () => {
  const rows = [row(0, -15), row(1, 10), row(2, 0)];
  expect([...bars(rows, 1, { metric: "mean_ground_cm" }).children].map((b) => b.style.height)).toEqual(["6%", "100%", "62%"]);
  expect(summary({ ...TICKET, checkpoints: rows, best: 1 }, false, "mean_ground_cm").textContent).toBe("Best: checkpoint 1 · 10.0 cm · 5/5");
});
it("reads a negative rating off the entry's line", () => {
  expect(officialTime("entered on tug-of-war: a -15.2 cm rating → https://x/r/1")).toBe("-15.2 cm");
});
// workshop/job.test.js: a tug checkpoint replays its bout against the reference
api.getCheckpoint.mockResolvedValueOnce({ checkpoint: 250, score: 10.1, ducks: 2, traces: [w, e], trace_seed: 2, cast: null });
expect(viewer.setLanes).toHaveBeenLastCalledWith([{ tug: "bout", ducks: [{ trace: w, livery: "charcoal", name: "Reference" },
  { trace: e, livery: "classic", name: "checkpoint 250" }] }], TUG);
// workshop/challenge.test.js: the caveat "The Arena rates your duck in five bouts against its reference duck: the
// centimetres of string it wins, a pit worth far more. "
```
- [ ] **Step 2:** `VITEST src/clip/score.test.js src/clip/plan.test.js src/workshop/tickets.test.js src/workshop/job.test.js src/workshop/challenge.test.js` → FAIL.
- [ ] **Step 3: Implement.**
  - `clip/score.js`: `BENCH_STAMPS` goes; a tug's verdict is `{stamp: BOUT_WORDS[status].toUpperCase(), pass: status === "won" || status === "pit_won"}` of the traced seed. `clip/plan.js`: `stampLane` = `isTug(run.event) ? entrySide(run.trace_seed) : laneCount - 1`. `clip/main.js`: the tug lane `ratingLane(traces[i], settles[i], { traceSeed: run.trace_seed, livery: lane.livery, name: `@${lane.user}` })` (other keys as before), the stamp at `viewer.spot(stampLane(run, lanes.length))`, comments.
  - `workshop/tickets.js`: `strongest` reads `mean_ground_cm`; `measure` → `` `${value.toFixed(1)} cm` ``; a strongest metric's bar is `top === low ? 100 : Math.round(6 + (94 * (c.score - low)) / (top - low))`, `low = Math.min(...scores)` (a time's as before); `officialTime` matches `/: (?:a )?(-?[\d.]+) (s|cm)\b/`, `cm` → `mean_ground_cm`. `job.js`: the tug lane `ratingLane(body.traces, null, { traceSeed: body.trace_seed, livery: "classic", name })`, the speed comment "A tug has no commanded speed: every duck walks back at the event's." `challenge.js`: the caveat.
- [ ] **Step 4:** Step 2's command → PASS; `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && rtk proxy grep -rniIE "winch|bench|forceAt|force_n|hold_force" app/src --exclude='*.test.js'` prints nothing; VITEST; `npm run build` in `app`.
- [ ] **Step 5:** commit the 11 files: `"A rated run's clip stamps how its bout ended on the entry's duck, and the workshop rates checkpoints in centimetres"`.

---

### Task 8: Suites green, a local rehearsal, the card re-shot, Plans C and D brought to the rating

**Files:** whatever the rehearsal shows wrong (a fix, a test pinning it, a commit each); `app/public/cards/tug-of-war.webp` (LFS); `docs/superpowers/plans/2026-10-19-versus-c-weekly-cup.md`, `…-versus-d-cup-show.md`, `…-versus-interfaces.md`. Scratch only: `SCRATCH/e-store`, screenshots, probes.

- [ ] **Step 1:** SUITE; `npm run build` in `app`.
- [ ] **Step 2: Rate the stand-ins** into `SCRATCH/e-store`, one foreground call each (about 15 s): `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen arena score <onnx> --event tug-of-war --user <user> --name <name> --livery <livery> --store SCRATCH/e-store` for the challenges worktree's `logs/tug_of_war/onnx/t7-250.onnx` (nico, charcoal), `t1-2750.onnx` (ann, blue), `t6-250.onnx` (bob, purple). Measured drafting (Mac, indicative): t7-250 against itself +1.5 cm (expect `|rating| < 10`), t1-2750 −15.2 cm, t6-250 +10.0 cm, every bout `won`/`lost` at 45.00 s, the traced seeds odd (west). `arena board --event tug-of-war --store SCRATCH/e-store` ranks bob, nico, ann.
- [ ] **Step 3: Look at it.** `ARENA_FRONTEND=/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app/dist /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/.venv/bin/arena serve --store SCRATCH/e-store --port 8765` with `run_in_background`; each view with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1440,1000 --virtual-time-budget=15000 --screenshot=SCRATCH/<name>.png "<url>"`, each PNG Read:
  - `#/r/<bob's run>`: two ducks on the rope over the pit, plates `@bob` on the traced seed's side and `Reference`, no winch or dial; "rating · cm" `10.0`; five lines `+10.x cm · west|east · won the pull`.
  - `#/e/tug-of-war`: the board in cm, "bout: up to 45 s", the new caveat; another ticked row replays its bout.
  - `clip.html?run=<bob's run>&layout=landscape&frame=30`, `frame=757` (the poster, mid-bout) and `frame=1243` (the outro: the stamp on bob's duck, whole in the frame); the same in `layout=vertical` at `--window-size=1080,1920`. A full 45 s bout's plan is 75 + 1138 + 63 = 1276 frames (51.04 s). No mp4 here (1276 frames at Plan A's measured ~1.6 s a frame: over half an hour on this Mac): the HF Job renders it at release.
  - Stop the server.
- [ ] **Step 4: Re-shoot the card** from bob's run's clip page at frame 757 with Plan A Task 12's card recipe (`.superpowers/sdd/2026-10-19-versus-a-tug-and-bench/task-12-report.md`): the page narrowed to 1166×1080 before the stage is built, a fixed camera holding both ducks and the marker over the pit (`[-0.73, 0.42, 1.1] → [0.05, 0.17, 0]` fov 42 to start from), overlays hidden, both plates wiped, 720×667, `cwebp -q 82` → `app/public/cards/tug-of-war.webp`. Rebuild, serve, screenshot `#/`, Read it: the lime `#05` card, two ducks on the rope, cells `0.3 m pit`, `45 s bouts`, `Legs`, the leader `10.0 cm @bob`. `GIT add app/public/cards/tug-of-war.webp`; commit `"The Tug of War's card shows a bout: two ducks on the rope over the pit"`.
- [ ] **Step 5: Fix what missed** (Steps 3–4): a failing test in the owning file, the fix, its files re-run, a commit saying what changed on the page.
- [ ] **Step 6: Plan C, Tasks 8–14.**
  - Task 8 `match.test.js`: `const twenty = { settle: 26, steps: 1000 }` → `const full = { settle: 26, steps: 2250 }` (both uses); "chains three 45 s bouts between the title and the outro: a 142 s clip" with `plan.frames` `3552`, `plan.seconds` `toBeCloseTo(142.08)`, `plan.bouts` `[{ k: 0, tape_start_s: 3.52, tape_end_s: 48.52 }, { k: 1, tape_start_s: 49.04, tape_end_s: 94.04 }, { k: 2, tape_start_s: 94.56, tape_end_s: 139.56 }]`; "keeps the longest match, five full bouts, under four minutes" `toBeCloseTo(233.12)`; Step 3's "as Plan A's bench clip counts its `{tug: "bench", trace, settle}` lane" → "as a rated run's clip counts its `{tug: "bout", ducks}` lane (Plan E)".
  - Task 12 `cup.test.js`: `metric: "mean_hold_force"` → `"mean_ground_cm"`. Task 13: bouts 1 and 2 `time_s: 20` → `45`, the lines read `45.00 s`.
  - Task 14: Step 3's "Expected: a bench rating, then `recorded <run id>`." → "Expected: five `seed n:` bout lines, `rating: X.X cm · replay from seed n`, then `recorded <run id>`."; Step 4 adds "a 45 s bout takes about 2 s here"; Step 5's "A match of three full bouts gives 67.08 s" → "a three-bout match gives 142.08 s (3552 frames: about an hour and a half here)" (its two renders and five stand-ins as written); Step 7's `2026-10-30T17:01:30+00:00` → `2026-10-30T17:03:00+00:00`, "the first group match(es)" → "the first group match" (a first clip now runs up to 142 s, a second ends after 3 min).
- [ ] **Step 7: Plan D, and its moments for 45 s bouts.**
  - Global Constraints: `FAVOURITE_N = 0.5` → `FAVOURITE_CM = 5.0`, plus `GROUND_M = 0.10`.
  - Task 1 (the spec's "the marker moving": a long bout needs more than a start and a time): Produces `GROUND_M = 0.10`; Step 3 adds "`ground`: once per side, the first frame the marker is `GROUND_M` or more on that side of the centre line, side that side, after `lead` within a frame"; `test_a_duck_dragged_to_its_edge_then_into_the_pit` → `[start, Moment(0.42, "lead", "east"), Moment(2.02, "ground", "east"), Moment(5.42, "edge", "west"), Moment(8.02, "pit", "west")]`; new `test_the_marker_pulled_ground_m_one_way_is_a_moment`: `t = bout(); d = 0.15 * np.arange(500) / 499; t[0, :, 0] = -0.5 + d; t[1, :, 0] = 0.5 + d` → `[start, Moment(1.36, "lead", "east"), Moment(6.68, "ground", "east"), Moment(10.0, "time", "east")]`; the commit names "the marker pulled 10 cm one way".
  - Task 2: `rating=5.0 - 0.5 * k` → `rating=50.0 - 5.0 * k`; `FAVOURITE_N` → `FAVOURITE_CM = 5.0`; texts `"Ratings against the reference duck, at the top: puller 0 (@p0) 50.0 cm, puller 1 (@p1) 45.0 cm, puller 2 (@p2) 40.0 cm; at the bottom: puller 5 (@p5) 25.0 cm."` and `"Against the reference duck puller 0 (@p0) rates 50.0 cm and puller 3 (@p3) 35.0 cm: puller 0 (@p0) is the favourite by 15.0 cm."`; Step 4: ratings `:.1f` + `" cm"`, `"Ratings against the reference duck: {d} 50.0 cm, …."`, `cup#/bench` → `cup#/favourite` with `f": only {gap:.1f} cm apart, too close to call."`, `how` `", on the rating after {len(bouts)} bouts without a winner"`.
  - Task 5: `cup#/bench` → `cup#/favourite` (calls' facts, `DESK_FACTS["intro"]`); `DESK_ANGLES["opening"]` "name the favourites on the bench" → "name the favourites by their ratings against the reference duck"; "…goes to {w} on the bench rating." → "…on the rating."; a `ground` what `f"{u} has pulled the marker 10 cm their way."`.
  - Task 10 Step 6: "~35 min of clip jobs" → "~75 min of clip jobs (a 45 s bout makes a match clip about 2.1 times the 20 s plan's)". Task 12: Step 0 lists Plans A, C, E and D in `main..versus` and names Plan F's Task 8 commit beside Plan B's Task 13; Step 5's "is Task 13's hash" → "is Plan F's Task 8 hash"; Steps 2 and 6 "its pulling bench" → "its rating against a reference duck"; Step 7 "Plan B's Task 12 step 5 command" → "Plan F's Task 9 step 5 command" and `a X.XX N rating` → `a X.X cm rating`.
  - The contract's "Plan D — names": `GROUND_M = 0.10`; `Moment.kind` gains `"ground"`.
- [ ] **Step 8:** SUITE; `GIT add` the three plan files; commit `"Plans C and D follow the rating against the reference duck: centimetres, 45 s bouts, the marker's ground as a moment"`.
- [ ] **Step 9: Report:** the three ratings, the screenshot paths, the card, each fix, the two cross-repo commits, anything for the owner.

---

## Self-review (amended spec, contract)

§1 45 s bouts: Tasks 2, 8 (the judge untouched). §2 reference vendored and frozen: Task 1; per-seed score with alternating sides, the mean, higher wins: Task 2; the median bout's clip: Tasks 2, 5, 7, 8; the bonus bound: Global Constraints. §3 the workshop's Test step: Tasks 2, 7. The winch gone: Tasks 4 and 7's greps. `arena score` for Plan F: Tasks 1, 2. Plan F first and the sittings: Global Constraints, Tasks 2, 4. The contract: Tasks 1, 8.
