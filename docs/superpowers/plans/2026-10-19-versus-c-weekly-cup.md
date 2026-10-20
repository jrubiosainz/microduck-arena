# Weekly Cup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Friday each player's latest tug-of-war entry is drawn into a cup (groups, then a crossed knockout, every bout seeded by a secret drawn at close), the whole cup is played on the Space, every match gets its clip, and the cup is revealed match by match from a fixed running order: on the cup page, the match pages, the profiles, the points and the live channel.

**Architecture:** `arena/cup.py` is the pure tournament: records, calendar, draw, tables, bracket, and what is public at a given `now`. `arena/cupworker.py` is the only writer: a daemon thread that, tick by tick and idempotently from the dataset, closes, draws, plays every match with Plan A's `play_match`, owes one clip job per match, and fixes the running order once every clip is ready. Everything public (API, points, live, pages) reads the stored cup through `cup_view` / `revealed_at` at the request's `now`.

**Tech Stack:** Python 3.12, FastAPI, `zoneinfo`, MuJoCo through Plan A's `arena/match.py`, HF Jobs clip renders (`arena clip`), headless Chrome; vanilla JS, three.js viewer, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-19-versus-tug-of-war-design.md` (sections 4, 5, and 6's "After the premiere").
**Contract:** `docs/superpowers/plans/2026-10-19-versus-interfaces.md` ("Plan A — names" consumed, "Plan C — names" produced).

## Global Constraints

Everything in the contract's "Global constraints" applies. In addition:

- **Shorthands.** Each one stands for exactly this command. Never put a shell variable in its place.
  - `PYTEST <files>` = `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider <files>`
  - `VITEST <file>` = `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app && npx vitest run <file>`
  - `GIT` = `/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus`
- **Commits.** Run `GIT add <the task's files, written out>`, then `GIT commit -m "<the subject given>"`. Nothing else goes in the message: no signature, no trailer.
- **Plan A's names** are used as the contract writes them. Where Plan A's committed code differs, follow the code and say so in the task report.
- **Time.** Python uses aware UTC `datetime`. Disk and wire use `"%Y-%m-%dT%H:%M:%SZ"` (`cup.iso`). Only three places read a clock: `CupWorker` (its injected `now`), `routes_cups.now()` (tests patch it) and `app.py`.
- **Pinned values:** `ORDER_LEAD`, `LOAD_PATIENCE` and `CLIP_RETRY` are each 10 minutes. `TICK_S = 30`. `cup.PREFETCH` is 30 s (the server serves a match's clip, and Plan D its call and desk segments, from then); the front's `PREFETCH_MS` is 25 s (the channel prepares a slot from then: 5 s for a screen's clock, since a video that failed to load is never loaded again). The cup page refreshes every 15 s while airing. `GROUP_NAMES = "ABCDEFGHIJKLMNOP"`. The running order's shutter is `live.SHUTTER_MS` (1600 ms).
- **Names this plan adds** beyond the contract's first list are all Plan C's own, and recorded in the contract (2026-10-20):
  - Python: `cup.iso`, `parse_iso`, `parse_match_id`, `match_title`, `match_label`, `reached`, `ends_at`, `airs_at`, `cup_state`, `PREFETCH`; `Entrant.view`; `Cup.draw_json`, `matches_json`, `from_json`; `cupworker.all_cups`, `load_entrant`; `live.Show`, `shows`, `Entry.title`; `routes_cups.now`.
  - Front: `app/src/bouts.js boutLane`, `app/src/clip/match.js`, `format.js countdown`, `cup.js cupCorner`, `live/standby.js`, `live/channel.js PREFETCH_MS`.
- **The coordinator's corrections (2026-10-19, 2026-10-20),** now in the contract:
  1. `/api/live` serves slots 5 minutes ahead. A cup shutter's `next` is therefore `{"match_id", "title": match_label(...)}` ("Group C", "Quarter-final 2", "Final") and never names a duck (Tasks 3, 6, 11).
  2. A match has two instants: `airs_at` (the order's `starts_at` + its match segment's `at_ms`) and `revealed_at` (`airs_at` + its `duration_ms`: its clip has finished airing). Its clip media (`/clip` and `/clip/{name}`) are served from `airs_at − PREFETCH`, so the live can buffer. The match JSON, bouts, traces, its effect on the tables and bracket in `cup_view`, the profiles and the points wait for `revealed_at` (Tasks 6, 9, 10). The channel prepares a match slot only from `PREFETCH_MS` before it starts (Task 11).
  3. Match entries in the rotation get no booth broadcast, and the commentary stock skips match ids (Task 11).
  4. The knockout's first round is laid as the bracket's two halves: A1–B2, C1–D2, E1–F2, G1–H2, then B1–A2, D1–C2, F1–E2, H1–G2; group-mates cannot meet before the final (Task 3).
  5. On air a duck is named by its on-air `name` (`Entrant.name`: its policy's name, plus ` (@<user>)` when another entrant of the cup has the same policy name) in titles, clip cards and the match page's stamp; the cup page, and the match page's byline, show the policy's name and the player's handle (Tasks 2, 3, 5, 8, 12, 13).

  A match's own sequence in the running order is (Plan D's intro desk segment), then the shutter that cuts into it, then the match. In this plan that is shutter, then match.
- **The running order's `clip`.** The contract's `running_order(cup, clips: Mapping[str, float], …)` gets only seconds, so `order.json`'s match segments carry no `clip` version. The live adds it when it lays the slot, reading `clip_state` (Task 11). Served slots carry `clip` as the contract says.
- **Tests never read the shipped cup #1 date.** The owner sets `[cup] first` at release (Plan D's release asks). Every helper takes the tug pinned to 2026-10-30, `TUG = replace(load_event("tug-of-war"), cup=replace(load_event("tug-of-war").cup, first=date(2026, 10, 30)))` in `tests/test_cupworker.py` (as Plan D's `MANIFEST`), and the route tests patch `arena.web.routes_cups.load_event` to answer it for the tug. Only `test_the_tug_of_war_holds_a_weekly_cup` reads the file's date; the release updates it with `first`.
- **Local main's uncommitted edits** to `router.js`, `main.js`, `race.css` and `share.js` are not in the worktree. This plan edits `router.js`, `main.js` and `race.css` from the committed versions. Conflicts with those edits are settled at release.

## Review Focus

1. **A Space restart at any point of a cup.** Each step resumes from the dataset with the same secret and results: after draw.json, during the matches, while clips are owed, after the order, and mid-show. The live then joins the segment airing now.
   - Task 7 `test_a_crash_after_any_step_ends_in_the_same_cup`
   - Task 11 `test_a_restart_mid_show_joins_the_segment_airing_now`
2. **A match clip whose job keeps failing.** There is no three-try limit. A failed render is relaunched at most every 10 minutes. The cup stays `drawn` ("starting soon") with no order, so nothing airs with a hole.
   - Task 8 `test_a_match_clip_job_is_launched_again_however_often_the_machine_ends_it`
   - Task 7 `test_a_failed_match_clip_is_relaunched_every_ten_minutes_and_holds_the_order`
3. **An entry that changes around close:**
   - a run published one second after close is out;
   - a withdrawal before close counts, one after close changes nothing;
   - a latest entry that was withdrawn falls back to the one before;
   - a repo that no longer loads at the draw is waited for 10 minutes, then left out.

   Tests:
   - Task 5 `test_entrants_are_each_players_latest_entry_at_close`
   - Task 7 `test_a_withdrawal_after_close_changes_nothing`
   - Task 7 `test_an_entrant_whose_policy_no_longer_loads_is_left_out_after_ten_minutes`
4. **A cup that closes while the previous one is still airing or waiting for clips.** It gets no order until the previous show has ended, then starts at least 10 minutes later. Cup N+1 never airs before cup N.
   - Task 7 `test_a_cup_gets_no_order_while_the_previous_one_has_not_aired`
5. **Europe/Paris across the 2026-10-25 change:**
   - cup 1 on 2026-10-23 (CEST) premieres at 16:00Z;
   - cup 2 on 2026-10-30 (CET) premieres at 17:00Z;
   - each closes 2 h before in absolute time;
   - `closed_cups` flips at the right instant;
   - the image carries the zone database.

   Tests:
   - Task 2 `test_cup_times_follow_paris_across_the_october_change`
   - Task 2 `test_a_cup_closes_at_its_own_instant_across_the_change`
   - Task 1 `test_the_image_carries_the_time_zones`
6. **A screen that reads the grid five minutes ahead, and buffers two slots ahead.** No served slot names who plays an unaired match, a match's clip answers 30 s before it airs, not earlier, and its result only once its clip has finished airing.
   - Task 6 `test_the_running_order_names_no_duck`, `test_a_match_is_public_from_its_reveal`
   - Task 9 `test_a_match_and_everything_of_it_is_a_404_until_its_reveal`, which checks the edges at `airs_at − PREFETCH` and at `revealed_at`
   - Task 11 `prepares a cup match only from PREFETCH_MS before it airs, inside the 30 s its clip is served` (`channel.test.js`)
7. **Group-mates meeting before the final.** Task 3 `test_the_knockout_crosses_the_groups` (two, four and eight groups).

---

### Task 1: The cup's calendar in the event file

**Files:**
- Modify: `arena/manifest.py`
- Modify: `arena/events/tug-of-war.toml`
- Modify: `Dockerfile`
- Modify: `tests/test_manifest.py`

**Interfaces:**
- Consumes: Plan A's `Manifest` with `bench` and `bout`, and `CATEGORIES` including `"versus"`.
- Produces: `CupRules(first: date, premiere: time, timezone: str, close_before_h: float, min_entrants: int)`, frozen, and `Manifest.cup: CupRules | None = None` as Manifest's last field.

- [ ] **Step 1: Write the failing tests** in `tests/test_manifest.py`:

```python
CUP = '[cup]\nfirst="2026-10-30"\npremiere="18:00"\ntimezone="Europe/Paris"\nclose_before_h=2.0\nmin_entrants=4\n'

def tug(tmp_path, cup=CUP):
    """The shipped tug of war with its [cup], its last section, replaced."""
    path = tmp_path / "tug.toml"
    path.write_text((EVENTS_DIR / "tug-of-war.toml").read_text().split("[cup]")[0] + cup)
    return path

def test_the_tug_of_war_holds_a_weekly_cup():
    assert load_event("tug-of-war").cup == CupRules(date(2026, 10, 30), time(18, 0), "Europe/Paris", 2.0, 4)
    assert load_event("sprint-2m").cup is None

def test_a_versus_event_needs_a_cup(tmp_path):
    with pytest.raises(ManifestError, match=r"\[cup\]"):
        load_manifest(tug(tmp_path, cup=""))

def test_only_a_versus_event_takes_a_cup(tmp_path):
    with pytest.raises(ManifestError, match=r"\[cup\]"):
        load_manifest(write_manifest(tmp_path, clip=CUP))

@pytest.mark.parametrize("old, new, complaint", [
    ('"Europe/Paris"', '"Mars/Olympus"', "timezone"), ('"2026-10-30"', '"2026-13-01"', "first"),
    ('"18:00"', '"6pm"', "premiere"), ("close_before_h=2.0", "close_before_h=0", "close_before_h"),
    ("min_entrants=4", "min_entrants=2", "min_entrants"),
    ("min_entrants=4", "min_entrants=4\nseeded=true", "unknown keys"),
])
def test_a_malformed_cup_is_refused(tmp_path, old, new, complaint):
    with pytest.raises(ManifestError, match=complaint):
        load_manifest(tug(tmp_path, cup=CUP.replace(old, new)))

def test_the_image_carries_the_time_zones():
    dockerfile = (EVENTS_DIR.parents[1] / "Dockerfile").read_text()
    assert "tzdata" in dockerfile and "ZoneInfo('Europe/Paris')" in dockerfile
```

- [ ] **Step 2: Run them.** `PYTEST tests/test_manifest.py`. Expected: FAIL (`CupRules` is not importable).

- [ ] **Step 3: Implement.**
  - **`manifest.py`.** Add `_cup(raw: dict, path: Path) -> CupRules`:
    - Unknown keys go through `_refuse_unknown(raw, {"first", "premiere", "timezone", "close_before_h", "min_entrants"}, "[cup]")`.
    - Parse `first` with `date.fromisoformat(str(...))` and `premiere` with `time.fromisoformat(str(...))`.
    - `timezone` must load with `zoneinfo.ZoneInfo`. Catch `ZoneInfoNotFoundError` and `ValueError`.
    - `close_before_h` must be in (0, 168). `min_entrants` must be ≥ 3, because a group plays a round robin of at least three.
    - Every refusal raises `ManifestError` and names its key.
  - **In `load_manifest`:**
    - a `versus` category without `[cup]` raises `f"{path}: a versus event needs a [cup] section"`;
    - any other category with `[cup]` raises `f"{path}: [cup] is for a versus event"`.
  - **`tug-of-war.toml`.** Append the contract's `[cup]` as the file's last section. Add a comment on `first`: the owner sets it at release.
  - **`Dockerfile`.**
    - Add `tzdata` to the apt line.
    - After that layer, add `RUN python -c "import zoneinfo; zoneinfo.ZoneInfo('Europe/Paris')"`.
    - Add a comment saying why: the cup's calendar is Paris time, and a slim image does not promise `/usr/share/zoneinfo`. The build fails, not the Space.

- [ ] **Step 4: Run.** `PYTEST tests/test_manifest.py tests/test_second_event.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "The tug of war declares its weekly cup: premiere day, local time, time zone, close and the fewest entrants"

---

### Task 2: Cup records, match ids and the calendar

**Files:**
- Create: `arena/cup.py`
- Create: `tests/test_cup.py`

**Interfaces:**
- Consumes: Plan A's `BoutResult` (`to_dict`, `from_dict`), and `CupRules`.
- Produces: the contract's `Entrant`, `MatchRecord`, `Cup`, `match_id`, `is_match_id`, `cup_times`, `closed_cups`, plus:

```python
GROUP_NAMES = "ABCDEFGHIJKLMNOP"
def iso(moment: datetime) -> str                 # aware -> "2026-10-30T17:00:00Z"
def parse_iso(stamp: str) -> datetime            # -> aware UTC
Entrant.view(self) -> dict                       # {"user", "policy_name", "name", "livery", "rating", "run_id"}
Entrant.to_dict / from_dict (every field: draw.json keeps each on-air `name`); MatchRecord.to_dict / from_dict (bouts through BoutResult)
Cup.draw_json(self) -> bytes                     # every field but matches and order
Cup.matches_json(self) -> bytes                  # {"matches": [...]}
Cup.from_json(draw: bytes, matches: bytes | None = None, order: bytes | None = None) -> Cup
def parse_match_id(text: str) -> tuple[str, int, int] | None   # r"^([a-z0-9-]+)-(\d{4})-(\d{3})$"
```

- [ ] **Step 1: Write the failing tests** in `tests/test_cup.py`:

```python
def entrant(i, rating=None):
    return Entrant(f"p{i}", f"R{i}", f"duck {i}", "classic", float(10 - i if rating is None else rating), "s" * 64,
                   {"kind": "hub", "repo_id": f"p{i}/tug", "filename": "policy.onnx", "revision": "c" * 40, "url": "u"},
                   f"duck {i}")
Z = lambda *a: datetime(*a, tzinfo=UTC)
PARIS = lambda first: CupRules(first, time(18, 0), "Europe/Paris", 2.0, 4)

def test_a_cup_round_trips_through_its_three_files():
    match = MatchRecord("tug-of-war-0001-000", 0, "final", None, 0, 1, (BoutResult(0, 7, "west", "a", "pit", 4.5),), (1, 0), 0, "bouts")
    cup = Cup("tug-of-war", 1, "2026-10-30T15:00:00Z", "2026-10-30T17:00:00Z", "ab" * 16, (entrant(0), entrant(1)),
              ((0, 1),), matches=(match,), order={"starts_at": "2026-10-30T17:00:00Z", "segments": []})
    assert Cup.from_json(cup.draw_json(), cup.matches_json(), json.dumps(cup.order).encode()) == cup
    assert set(json.loads(cup.draw_json())) == {"event_id", "number", "close_at", "premiere_at", "secret", "entrants", "groups", "skipped"}
    assert Cup.from_json(cup.draw_json()) == replace(cup, matches=(), order=None)
    assert entrant(0).view() == {"user": "p0", "policy_name": "duck 0", "name": "duck 0", "livery": "classic", "rating": 10.0, "run_id": "R0"}

def test_a_match_id_names_its_event_cup_and_place():
    assert match_id("tug-of-war", 3, 12) == "tug-of-war-0003-012"
    assert parse_match_id("tug-of-war-0003-012") == ("tug-of-war", 3, 12)
    assert is_match_id("tug-of-war-0003-012") and not is_match_id("01M4Z4YCJ15T56BAXX1RPD")
    assert parse_match_id("01M4Z4YCJ15T56BAXX1RPD") is None and parse_match_id("tug-of-war-3-12") is None

def test_cup_times_follow_paris_across_the_october_change():
    rules = PARIS(date(2026, 10, 23))
    assert cup_times(rules, 1) == (Z(2026, 10, 23, 14), Z(2026, 10, 23, 16))
    assert cup_times(rules, 2) == (Z(2026, 10, 30, 15), Z(2026, 10, 30, 17))

def test_cup_times_in_summer():
    assert cup_times(PARIS(date(2026, 7, 3)), 2) == (Z(2026, 7, 10, 14), Z(2026, 7, 10, 16))

def test_a_cup_closes_at_its_own_instant_across_the_change():
    rules = PARIS(date(2026, 10, 23))
    moments = [(2026, 10, 23, 13, 59, 59), (2026, 10, 23, 14), (2026, 10, 30, 14, 59, 59), (2026, 10, 30, 15)]
    assert [closed_cups(rules, Z(*m)) for m in moments] == [0, 1, 1, 2]
```

- [ ] **Step 2: Run them.** `PYTEST tests/test_cup.py`. Expected: FAIL (no `arena.cup`).

- [ ] **Step 3: Implement** `arena/cup.py`. Its module docstring says it is pure: no I/O, no clock.
  - `cup_times` computes `premiere = datetime.combine(rules.first + timedelta(weeks=number - 1), rules.premiere, ZoneInfo(rules.timezone)).astimezone(UTC)` and `close = premiere - timedelta(hours=rules.close_before_h)`. The local wall clock steps by weeks, and the close is absolute.
  - `closed_cups` counts `n = 1, 2, …` while `cup_times(rules, n)[0] <= now`.
  - JSON turns tuples into lists, and `from_json` turns them back into tuples.

- [ ] **Step 4: Run.** `PYTEST tests/test_cup.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "A cup is three files and a weekly calendar in Paris time: the draw and its secret, the matches, the running order"

---

### Task 3: The draw, the groups and the knockout

**Files:**
- Modify: `arena/cup.py`
- Modify: `tests/test_cup.py`

**Interfaces:**
- Produces: the contract's `group_count`, `draw_groups`, `group_fixtures`, `group_table`, `first_knockout` and `round_name`, plus:
  - `match_title(cup, match) -> str`;
  - `match_label(cup, match) -> str`: the stage alone, naming no duck. This is what a shutter announces 5 minutes ahead;
  - `reached(cup) -> list[str]`: per entrant, `"champion"`, `"final"`, the knockout round it lost in, or `"group"`.

- [ ] **Step 1: Write the failing tests** (`won` builds a group match whose winner has more bouts):

```python
def won(a, b, wins):
    return MatchRecord(f"m{a}{b}", 0, "group", "A", a, b, (), wins, a if wins[0] > wins[1] else b, "bouts")

def test_the_group_count_leaves_at_least_three_ducks_a_group():
    assert {n: group_count(n) for n in (3, 4, 5, 6, 11, 12, 23, 24, 47, 48)} == \
        {3: 1, 4: 1, 5: 1, 6: 2, 11: 2, 12: 4, 23: 4, 24: 8, 47: 8, 48: 16}

def test_the_draw_puts_one_duck_of_each_pot_in_every_group():
    ducks = [entrant(i, rating=8 - i) for i in range(8)]
    assert draw_groups(ducks, "0" * 32) == [[0, 2, 5, 6], [1, 3, 4, 7]]
    assert draw_groups(ducks, "f" * 32) == [[1, 2, 4, 7], [0, 3, 5, 6]]

def test_pots_rank_by_rating_then_user_and_the_last_pot_may_be_short():
    ducks = [replace(entrant(i, rating=r), user=u) for i, (r, u) in enumerate(zip([5, 5, 3, 2, 1, 9, 4], "bacdefg"))]
    assert draw_groups(ducks, "0" * 32) == [[5, 0, 3, 4], [1, 6, 2]]

def test_a_group_plays_a_circle_round_robin():
    assert group_fixtures([10, 11, 12, 13]) == [(10, 13), (11, 12), (10, 12), (13, 11), (10, 11), (12, 13)]
    assert group_fixtures([10, 11, 12]) == [(11, 12), (10, 12), (10, 11)]
    assert len(group_fixtures([1, 2, 3, 4, 5])) == 10

def test_a_table_ranks_wins_then_bout_difference():
    played = [won(0, 1, (1, 2)), won(0, 2, (2, 0)), won(0, 3, (2, 1)), won(1, 2, (2, 1)), won(1, 3, (0, 2)), won(2, 3, (2, 1))]
    assert group_table([0, 1, 2, 3], played, [4, 3, 2, 1]) == [0, 1, 3, 2]

def test_head_to_head_breaks_a_tie_before_the_rating():
    played = [won(0, 1, (1, 2)), won(0, 2, (2, 1)), won(0, 3, (2, 1)), won(1, 2, (2, 1)), won(1, 3, (1, 2)), won(2, 3, (2, 1))]
    assert group_table([0, 1, 2, 3], played, [4, 3, 1, 2]) == [1, 0, 2, 3]

def test_a_three_way_cycle_falls_to_the_rating_then_the_draw():
    cycle = [won(0, 1, (2, 1)), won(1, 2, (2, 1)), won(0, 2, (1, 2))]
    assert group_table([0, 1, 2], cycle, [1.0, 3.0, 2.0]) == [1, 2, 0]
    assert group_table([0, 1, 2], cycle, [2.0, 2.0, 2.0]) == [0, 1, 2]
    assert group_table([2, 0, 1], cycle, [2.0, 2.0, 2.0]) == [2, 0, 1]
    assert group_table([0, 1, 2], [], [1.0, 3.0, 2.0]) == [1, 2, 0]
    assert group_table([0, 1], [won(0, 5, (0, 2))], [1.0, 2.0]) == [1, 0]   # a match outside the group counts for nothing

def test_the_knockout_crosses_the_groups():
    """The bracket's two halves: a group's first and second are in different halves, so meet at the earliest in the final."""
    assert first_knockout([[2, 0, 1, 3]]) == [(2, 0)]                       # one group: 1st v 2nd is the final
    assert first_knockout([[0, 5, 3], [1, 4, 2]]) == [(0, 4), (1, 5)]       # A1–B2, B1–A2 are the semi-finals
    assert first_knockout([[0, 7], [1, 6], [2, 5], [3, 4]]) == [(0, 6), (2, 4), (1, 7), (3, 5)]   # A1–B2, C1–D2, B1–A2, D1–C2
    assert first_knockout([[g, 8 + g] for g in range(8)]) == [
        (0, 9), (2, 11), (4, 13), (6, 15), (1, 8), (3, 10), (5, 12), (7, 14)]   # A1–B2 … G1–H2, then B1–A2 … H1–G2
    assert [round_name(n) for n in (1, 2, 4, 8, 16)] == ["final", "semi-final", "quarter-final", "round of 16", "round of 32"]

def test_a_title_says_the_stage_and_both_ducks():
    cup = Cup("tug-of-war", 1, "", "", "", tuple(entrant(i) for i in range(4)), ((0, 1, 2, 3),))
    assert match_title(cup, won(0, 3, (2, 0))) == "Group A · duck 0 vs duck 3"
    assert match_title(cup, replace(won(0, 1, (2, 1)), round="semi-final", group=None)) == "Semi-final · duck 0 vs duck 1"

def test_reached_is_how_far_each_entrant_went():
    ko = lambda a, b, r: replace(won(a, b, (2, 0)), round=r, group=None)
    cup = Cup("tug-of-war", 1, "", "", "", tuple(entrant(i) for i in range(6)), ((0, 2, 4), (1, 3, 5)),
              matches=(won(0, 2, (2, 0)), ko(0, 3, "semi-final"), ko(1, 2, "semi-final"), ko(0, 1, "final")))
    assert reached(cup) == ["champion", "final", "semi-final", "semi-final", "group", "group"]
    assert [match_label(cup, m) for m in cup.matches] == ["Group A", "Semi-final 1", "Semi-final 2", "Final"]
```

- [ ] **Step 2: Run them.** `PYTEST tests/test_cup.py`. Expected: FAIL (the names are missing).

- [ ] **Step 3: Implement.** These are the algorithms the tests pin:

```python
def draw_groups(entrants, secret):
    count = group_count(len(entrants))
    ranked = sorted(range(len(entrants)), key=lambda i: (-entrants[i].rating, entrants[i].user))
    groups = [[] for _ in range(count)]
    for p, start in enumerate(range(0, len(ranked), count)):
        pot = ranked[start:start + count]
        random.Random(secret + str(p)).shuffle(pot)
        for g, i in enumerate(pot):
            groups[g].append(i)
    return groups

def group_fixtures(group):   # the circle method; a bye pads an odd group and plays nobody
    ring = list(group) + ([None] if len(group) % 2 else [])
    out = []
    for _ in range(len(ring) - 1):
        out += [(ring[i], ring[-1 - i]) for i in range(len(ring) // 2) if None not in (ring[i], ring[-1 - i])]
        ring = [ring[0], ring[-1], *ring[1:-1]]
    return out

def group_table(group, matches, ratings):
    played = [m for m in matches if m.a in group and m.b in group]
    wins = {i: sum(m.winner == i for m in played) for i in group}
    diff = {i: sum((m.wins[0] - m.wins[1]) * (1 if m.a == i else -1) for m in played if i in (m.a, m.b)) for i in group}
    def head_to_head(i):
        tied = {j for j in group if (wins[j], diff[j]) == (wins[i], diff[i])}
        return sum(m.winner == i for m in played if {m.a, m.b} <= tied)
    return sorted(group, key=lambda i: (-wins[i], -diff[i], -head_to_head(i), -ratings[i], list(group).index(i)))
```

  - `first_knockout` with one table returns `[(t[0], t[1])]`. Otherwise, with the tables paired `(0, 1), (2, 3), …` as `(X, Y)`, it emits every pair's `(X1, Y2)` in pair order, then every pair's `(Y1, X2)`: `[(t[2p][0], t[2p + 1][1]) for p in range(G // 2)] + [(t[2p + 1][0], t[2p][1]) for p in range(G // 2)]`. `compute_matches` pairs each round's winners in order, so these are the bracket's two halves and group-mates meet at the earliest in the final (docstring says so).
  - `round_name` maps 1 to "final", 2 to "semi-final", 4 to "quarter-final", and else returns `f"round of {2 * n}"`.
  - `match_label` is `f"Group {g}"`, or the round with its first letter capitalised. When the round has more than one match it adds the match's 1-based place in its round.
  - `match_title` is `f"{stage} · {A.name} vs {B.name}"` (on air a duck is named by its on-air `name`). Its stage is `f"Group {g}"` or the capitalised round, unnumbered.
  - `reached` starts every entrant at `"group"`. Walking the non-group matches in order, it sets each loser to the match's round. The final's winner becomes `"champion"` and its loser `"final"`.

- [ ] **Step 4: Run.** `PYTEST tests/test_cup.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "Cups are drawn from pots by rating, played as round robins in groups ranked on wins, bouts, head-to-head and rating, and crossed into a knockout"

---

### Task 4: The store keeps cups

**Files:**
- Modify: `arena/store.py`
- Create: `arena/cupworker.py`
- Modify: `tests/test_store.py`
- Modify: `tests/test_hub_store.py`
- Create: `tests/test_cupworker.py`

**Interfaces:**
- Produces:
  - the contract's `put_cup_files`, `cup_file` and `cup_numbers` on the `Store` protocol, `LocalStore` and `HubStore`;
  - in `arena/cupworker.py`, the contract's `load_cup(store, event_id, number) -> Cup | None`;
  - also in `arena/cupworker.py`, `all_cups(store) -> list[Cup]`: every event with a `[cup]`, each cup in number order.

- [ ] **Step 1: Write the failing tests.**

```python
# tests/test_store.py
def test_a_cup_is_written_once_and_read_back(tmp_path):
    store = LocalStore(tmp_path)
    store.put_cup_files("tug-of-war", 2, {"bouts/x-0.npz": b"z", "draw.json": b"{}"})
    assert store.cup_file("tug-of-war", 2, "draw.json") == b"{}"
    assert store.cup_file("tug-of-war", 2, "bouts/x-0.npz") == b"z"
    assert store.cup_file("tug-of-war", 2, "order.json") is None
    assert store.cup_numbers("tug-of-war") == [2] and store.cup_numbers("sprint-2m") == []
    with pytest.raises(FileExistsError):
        store.put_cup_files("tug-of-war", 2, {"order.json": b"{}", "draw.json": b"{}"})
    assert store.cup_file("tug-of-war", 2, "order.json") is None   # nothing of a refused write lands

# tests/test_hub_store.py
def test_cup_files_are_one_commit_and_never_written_twice(tmp_path):
    hub = FakeHub(tmp_path)
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=60)
    store.put_cup_files("tug-of-war", 1, {"draw.json": b"{}", "bouts/m-0.npz": b"z"})
    assert hub.head == 1
    assert store.cup_file("tug-of-war", 1, "bouts/m-0.npz") == b"z" and store.cup_numbers("tug-of-war") == [1]
    with pytest.raises(FileExistsError):
        store.put_cup_files("tug-of-war", 1, {"draw.json": b"{}"})
    assert hub.head == 1

# tests/test_cupworker.py
def test_a_cup_is_read_back_from_its_files(tmp_path):
    store = LocalStore(tmp_path)
    assert load_cup(store, "tug-of-war", 1) is None and all_cups(store) == []
    cup = Cup("tug-of-war", 1, "2026-10-30T15:00:00Z", "2026-10-30T17:00:00Z", "ab" * 16,
              tuple(entrant(i) for i in range(4)), ((0, 1, 2, 3),))
    store.put_cup_files("tug-of-war", 1, {"draw.json": cup.draw_json()})
    assert load_cup(store, "tug-of-war", 1) == cup and all_cups(store) == [cup]
```

- [ ] **Step 2: Run them.** `PYTEST tests/test_store.py tests/test_hub_store.py tests/test_cupworker.py`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`LocalStore`.**
    - Files live under `root / "cups" / event_id / f"{number:04d}"`.
    - `put_cup_files` checks every name first and refuses if any exists.
    - It then writes the names not ending in `.json` before the `.json` ones, so a write that dies part-way leaves no readable state.
    - `cup_numbers` reads the folders holding a `draw.json`, sorted.
  - **`HubStore.put_cup_files`.**
    - It checks names against `self.snapshot(fresh=True)`: one head read, not a HEAD per file.
    - It then makes one `create_commit` of `CommitOperationAdd(path_in_repo=f"cups/{event_id}/{number:04d}/{name}", …)` with the message `f"{event_id} cup {number}"`, then `refresh()`.
    - `cup_file` and `cup_numbers` read the snapshot. Its tree diff already fetches `.json` and `.npz`.
  - **`load_cup`** reads `draw.json`, then `matches.json` and `order.json` when present, and returns `Cup.from_json`.

- [ ] **Step 4: Run.** The same command. Expected: PASS.

- [ ] **Step 5: Commit.** "The store keeps each cup as write-once files under cups/<event>/<number>, one commit per write"

---

### Task 5: Who enters, and every match played

**Files:**
- Modify: `arena/cupworker.py`
- Modify: `tests/test_cupworker.py`

**Interfaces:**
- Consumes:
  - from Plan A: `compile_tug(manifest, 2)`, `play_match`, `bout_seed`, `MatchOutcome`, `BoutResult`;
  - `hub_fetch.fetch_policy`, `policy.load_policy`, `trace.encode`.
- Produces:
  - the contract's `entrants_at` and `compute_matches`;
  - `load_entrant(store, entrant) -> Policy`;
  - test helpers in `tests/test_cupworker.py`: `TUG` (the tug, cup #1 pinned to 2026-10-30), `fake_play`, `drawn_cup(n, number=1)`, `played_cup(n, number=1)` (Task 6 adds `starts_at`), and `WALKER`.

- [ ] **Step 1: Write the failing tests.**

```python
WALKER = Path(arena.__file__).parent / "assets/policies/BEST_alpha_walking.onnx"
# Cup #1 pinned to 2026-10-30: the owner sets the shipped date at release, and no test moves with it.
TUG = replace(load_event("tug-of-war"), cup=replace(load_event("tug-of-war").cup, first=date(2026, 10, 30)))

def fake_play(manifest, a, b, seeds, ratings, model=None):
    """No physics: the higher rating wins 2-0 on two-frame traces."""
    side = "a" if ratings[0] >= ratings[1] else "b"
    bouts = tuple(BoutResult(k, seeds[k], ("west", "east")[k], side, "pit", 4.0) for k in range(2))
    trace = (np.zeros((2, 2, 21), np.float32), np.zeros((2, 3, 21), np.float32))
    return MatchOutcome(bouts, (trace, trace), (2, 0) if side == "a" else (0, 2), side, "bouts")

def drawn_cup(n, number=1, secret="ab" * 16):
    close, premiere = cup_times(TUG.cup, number)
    ducks = tuple(entrant(i, rating=n - i) for i in range(n))
    return Cup("tug-of-war", number, iso(close), iso(premiere), secret, ducks,
               tuple(tuple(g) for g in draw_groups(ducks, secret)))

def played_cup(n, number=1):
    with patch("arena.cupworker.play_match", fake_play), patch("arena.cupworker.compile_tug", lambda *_: None):
        return compute_matches(TUG, drawn_cup(n, number), lambda e: e.user)[0]

def test_entrants_are_each_players_latest_entry_at_close():
    run = lambda user, at, score, **o: make_record(event_id="tug-of-war", user=user, submitted_at=at, score=score, **o)
    old, new = run("ann", "2026-10-20T09:00:00Z", 3.0), run("ann", "2026-10-29T09:00:00Z", 4.0)
    gone, kept = run("bob", "2026-10-29T10:00:00Z", 6.0), run("bob", "2026-10-28T10:00:00Z", 2.0)
    late = run("cat", "2026-10-30T15:00:01Z", 9.0)
    stale = run("cat", "2026-10-20T09:00:00Z", 9.0, runner_version=RUNNER_VERSION - 1)
    edge = run("dan", "2026-10-30T15:00:00Z", 5.0)
    got = entrants_at([old, new, gone, kept, late, stale, edge], frozenset({gone.run_id}), datetime(2026, 10, 30, 15, tzinfo=UTC))
    assert [(e.user, e.run_id, e.rating) for e in got] == [("dan", edge.run_id, 5.0), ("ann", new.run_id, 4.0), ("bob", kept.run_id, 2.0)]
    assert (got[0].source, got[0].model_sha256, got[0].livery) == (edge.source, edge.model_sha256, edge.livery)

def test_two_entrants_with_one_policy_name_air_under_their_handles():
    run = lambda user, name: make_record(event_id="tug-of-war", user=user, policy_name=name, submitted_at="2026-10-29T09:00:00Z")
    got = entrants_at([run("ann", "microduck-tug-of-war"), run("bob", "microduck-tug-of-war"), run("cat", "Tank")],
                      frozenset(), datetime(2026, 10, 30, 15, tzinfo=UTC))
    assert {e.user: e.name for e in got} == {
        "ann": "microduck-tug-of-war (@ann)", "bob": "microduck-tug-of-war (@bob)", "cat": "Tank"}
    assert {e.user: e.policy_name for e in got} == {"ann": "microduck-tug-of-war", "bob": "microduck-tug-of-war", "cat": "Tank"}

def test_an_entrant_is_loaded_from_the_hub_at_its_revision(monkeypatch):
    asked = []
    monkeypatch.setattr(cupworker, "fetch_policy", lambda ref, revision: asked.append((ref, revision)) or SimpleNamespace(path=WALKER))
    assert load_entrant(None, entrant(0)).sha256 == hashlib.sha256(WALKER.read_bytes()).hexdigest()
    assert asked == [("p0/tug:policy.onnx", "c" * 40)]

def test_an_entrant_kept_by_a_local_store_is_loaded_from_it(tmp_path):
    store, blob = LocalStore(tmp_path), WALKER.read_bytes()
    sha = hashlib.sha256(blob).hexdigest()
    store.append(make_record(run_id="R1", model_sha256=sha, model_stored=True), b"t", blob)
    assert load_entrant(store, replace(entrant(0), model_sha256=sha, source={"kind": "local", "path": "/gone.onnx"})).sha256 == sha

def test_groups_play_round_by_round_then_each_knockout_round(monkeypatch):
    calls = []
    monkeypatch.setattr(cupworker, "play_match", lambda m, a, b, seeds, ratings, model=None:
                        calls.append((a, b, seeds, model)) or fake_play(m, a, b, seeds, ratings))
    monkeypatch.setattr(cupworker, "compile_tug", lambda manifest, ducks: "model")
    cup = replace(drawn_cup(6), groups=((0, 2, 4), (1, 3, 5)))
    played, files = compute_matches(TUG, cup, lambda e: e.user)
    assert [(m.a, m.b, m.round, m.group) for m in played.matches] == [
        (2, 4, "group", "A"), (3, 5, "group", "B"), (0, 4, "group", "A"), (1, 5, "group", "B"), (0, 2, "group", "A"),
        (1, 3, "group", "B"), (0, 3, "semi-final", None), (1, 2, "semi-final", None), (0, 1, "final", None)]
    assert [m.match_id for m in played.matches] == [f"tug-of-war-0001-{i:03d}" for i in range(9)]
    assert played.matches[-1].winner == 0
    assert calls[0] == ("p2", "p4", [bout_seed("ab" * 16, "tug-of-war-0001-000", k) for k in range(5)], "model")
    assert sorted(files) == sorted(f"bouts/tug-of-war-0001-{i:03d}-{k}.npz" for i in range(9) for k in range(2))
    assert decode(files["bouts/tug-of-war-0001-000-0.npz"]).shape == (2, 2, 21)

def test_a_cup_plays_on_the_real_physics_and_replays_identically():
    manifest = replace(load_event("tug-of-war"), bout=BoutRules(time_limit_s=1.0, bouts_to_win=2, max_bouts=3))
    walker = load_policy(WALKER)
    first, files = compute_matches(manifest, drawn_cup(4), lambda e: walker)
    again, files_again = compute_matches(manifest, drawn_cup(4), lambda e: walker)
    assert len(first.matches) == 7 and first.matches[-1].round == "final" and first == again
    assert files.keys() == files_again.keys()
    assert all(np.array_equal(decode(files[k]), decode(files_again[k])) for k in files)
```

- [ ] **Step 2: Run them.** `PYTEST tests/test_cupworker.py`. Expected: FAIL.

- [ ] **Step 3: Implement** in `arena/cupworker.py`.
  - **`entrants_at`:**
    - walk the records sorted by `(submitted_at, run_id)`;
    - keep those with `submitted_at <= iso(close_at)` that are not withdrawn and are on `runner_version`;
    - the last one per user wins;
    - build an `Entrant` from the record (rating = `score`);
    - set each entrant's `name` once the entrants are known: its `policy_name`, or `f"{policy_name} (@{user})"` for every entrant whose `policy_name` another entrant has (exact match, a `Counter` over the policy names);
    - sort by `(-rating, user)`.
  - **`load_entrant`.** A `"hub"` source loads `load_policy(fetch_policy(f"{repo_id}:{filename}", revision=revision).path)`. Any other source writes `store.model(model_sha256)` to a `tempfile.TemporaryDirectory()` as `policy.onnx` and loads it. These are the two ways `routes_submit` and `arena score` record a policy.
  - **`compute_matches`.** This is the body; the playing order is the algorithm:

```python
def compute_matches(manifest, cup, load):
    model = compile_tug(manifest, 2)               # one model for every bout of the cup
    ratings = [e.rating for e in cup.entrants]
    policies, matches, files = {}, [], {}

    def play(a, b, round_, group):
        mid = match_id(cup.event_id, cup.number, len(matches))
        for i in (a, b):
            if i not in policies:
                policies[i] = load(cup.entrants[i])
        seeds = [bout_seed(cup.secret, mid, k) for k in range(manifest.bout.max_bouts)]
        out = play_match(manifest, policies[a], policies[b], seeds, (ratings[a], ratings[b]), model=model)
        for bout, (trace, settle) in zip(out.bouts, out.traces):
            files[f"bouts/{mid}-{bout.k}.npz"] = encode(trace, settle)
        winner = a if out.winner == "a" else b
        matches.append(MatchRecord(mid, len(matches), round_, group, a, b, out.bouts, out.wins, winner, out.decided_by))
        return winner

    fixtures = [group_fixtures(g) for g in cup.groups]
    per_round = [len(g) // 2 for g in cup.groups]   # a round of an odd group has a bye: still len // 2 matches
    for r in range(max((len(f) // k for f, k in zip(fixtures, per_round)), default=0)):
        for g, (pairs, k) in enumerate(zip(fixtures, per_round)):
            for a, b in pairs[r * k:(r + 1) * k]:
                play(a, b, "group", GROUP_NAMES[g])
    pairs = first_knockout([group_table(g, matches, ratings) for g in cup.groups])
    while pairs:
        winners = [play(a, b, round_name(len(pairs)), None) for a, b in pairs]
        pairs = list(zip(winners[::2], winners[1::2]))
    return replace(cup, matches=tuple(matches)), files
```

- [ ] **Step 4: Run.** `PYTEST tests/test_cupworker.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "At close each player's latest entry is their duck, and the cup is played in one go: groups round by round, then each knockout round"

---

### Task 6: The running order, and what is public when

**Files:**
- Modify: `arena/cup.py`
- Modify: `arena/cupworker.py`
- Modify: `tests/test_cupworker.py` (`played_cup` gains `starts_at`)
- Create: `tests/test_cup_view.py`

**Interfaces:**
- Produces:
  - `running_order(cup, clips, starts_at, show=None)`, the contract's signature. `show` is Plan D's and is not read here.
  - `airs_at(cup, match_id) -> datetime | None`: `starts_at` plus the match segment's `at_ms`, when its clip starts airing.
  - `revealed_at(cup, match_id) -> datetime | None`: `airs_at` plus the segment's `duration_ms`, when its clip has finished airing: the match's result is public from then. Both return `None` without an order or for an unknown id.
  - `PREFETCH = timedelta(seconds=30)`: a match's clip media are served from `airs_at − PREFETCH` (Task 9), and Plan D serves its call and desk segments by the same constant.
  - `ends_at(cup) -> datetime | None`: `starts_at` plus the last segment's end.
  - `cup_state(cup, now) -> str`. It returns, in this order: `"skipped"`; `"open"` (now < close_at); `"drawn"` (no order); `"ready"` (now < starts_at); `"airing"` (now < ends_at); else `"aired"`.
  - `cup_view(cup, now) -> dict`. Before the start it has exactly `{event_id, number, state, close_at, premiere_at, starts_at, entrants}`, with `entrants` as `[e.view()]` in `cup.entrants` order (by rating). From the start (`airing`/`aired`) it adds:
    - `groups`: `[{name, table: [{entrant, played, won, lost, bouts_for, bouts_against}]}]`, ordered by `group_table` over the revealed group matches only, and counting only those;
    - `matches`: one per match, `{match_id, index, round, group, reveal_at, a, b, title}`. A group pair is shown from the start. A knockout pair, and its `match_title`, appear once the match before the first of its round is revealed; until then `a`/`b` are `None` and `title` is `match_label`. From its own reveal a match adds `{bouts: [b.to_dict()], wins: [x, y], winner, decided_by}`;
    - `champion`: an entrant index once the final is revealed, else `None`;
    - `secret`: only once the final is revealed.
  - `played_cup(n, number=1, starts_at: str | None = None, seconds: float = 10.0)` (test helper). With `starts_at` it adds `order = running_order(cup, {m.match_id: seconds …}, parse_iso(starts_at))`.

- [ ] **Step 1: Write the failing tests** in `tests/test_cup_view.py`. With 10 s clips each match takes 11.6 s of the show (its shutter, then its clip), so `AIRS(i)` is when match `i` starts airing and `REVEAL(i)`, 10 s later, when its clip has finished.

```python
START, START_ISO = datetime(2026, 10, 30, 17, tzinfo=UTC), "2026-10-30T17:00:00Z"
AIRS = lambda i: START + timedelta(milliseconds=1600 + 11600 * i)
REVEAL = lambda i: START + timedelta(milliseconds=11600 * (i + 1))

def test_the_running_order_is_each_match_after_its_shutter():
    cup = played_cup(4)
    order = running_order(cup, {m.match_id: 41.24 for m in cup.matches}, START)
    assert order["starts_at"] == START_ISO and len(order["segments"]) == 14
    assert order["segments"][:2] == [
        {"kind": "shutter", "at_ms": 0, "duration_ms": 1600, "next": {"match_id": "tug-of-war-0001-000", "title": "Group A"}},
        {"kind": "match", "at_ms": 1600, "duration_ms": 41240, "match_id": "tug-of-war-0001-000"}]
    timed = replace(cup, order=order)
    assert airs_at(timed, "tug-of-war-0001-006") == START + timedelta(milliseconds=6 * 42840 + 1600)
    assert revealed_at(timed, "tug-of-war-0001-006") == START + timedelta(milliseconds=7 * 42840) == ends_at(timed)
    assert revealed_at(cup, "tug-of-war-0001-006") is None and airs_at(cup, "tug-of-war-0001-006") is None
    assert revealed_at(timed, "nope") is None and airs_at(timed, "nope") is None

def test_the_running_order_names_no_duck():
    """/api/live serves five minutes ahead: a shutter naming a knockout's ducks would tell who qualified."""
    cup = played_cup(6)
    order = running_order(cup, {m.match_id: 10.0 for m in cup.matches}, START)
    assert [s["next"]["title"] for s in order["segments"] if s["kind"] == "shutter"] == \
        ["Group A", "Group B"] * 3 + ["Semi-final 1", "Semi-final 2", "Final"]
    text = json.dumps(order)
    assert not any(e.user in text or e.policy_name in text for e in cup.entrants)

def test_before_the_start_only_the_field_is_public():
    cup = played_cup(4, starts_at=START_ISO)
    for now in (datetime(2026, 10, 30, 14, 59, tzinfo=UTC), datetime(2026, 10, 30, 15, 30, tzinfo=UTC), START - timedelta(seconds=1)):
        view = cup_view(cup, now)
        assert set(view) == {"event_id", "number", "state", "close_at", "premiere_at", "starts_at", "entrants"}
        assert cup.secret not in json.dumps(view) and "tug-of-war-0001-" not in json.dumps(view)
    assert [e["user"] for e in view["entrants"]] == ["p0", "p1", "p2", "p3"]
    assert [cup_view(cup, t)["state"] for t in (datetime(2026, 10, 30, 14, 59, tzinfo=UTC), START - timedelta(seconds=1))] == ["open", "ready"]
    assert cup_view(replace(cup, order=None), START)["state"] == "drawn"

def test_a_match_is_public_from_its_reveal():
    """Not while its clip airs: from the moment the clip has finished."""
    cup = played_cup(4, starts_at=START_ISO)
    assert "winner" not in cup_view(cup, AIRS(0))["matches"][0]
    early = cup_view(cup, REVEAL(0) - timedelta(milliseconds=1))
    assert "winner" not in early["matches"][0] and early["groups"][0]["table"][0]["played"] == 0
    view = cup_view(cup, REVEAL(0))
    assert view["state"] == "airing" and view["groups"][0]["name"] == "A"
    first, second = view["matches"][:2]
    assert (first["winner"], first["wins"], len(first["bouts"])) == (0, [2, 0], 2)
    assert "winner" not in second and "bouts" not in second and second["a"] == 1
    table = {row["entrant"]: row for row in view["groups"][0]["table"]}
    assert (table[0]["played"], table[0]["won"], table[0]["bouts_for"], table[1]["played"]) == (1, 1, 2, 0)

def test_the_champion_and_the_secret_wait_for_the_final():
    cup = played_cup(4, starts_at=START_ISO)
    before = cup_view(cup, REVEAL(6) - timedelta(milliseconds=1))
    assert before["champion"] is None and "secret" not in before and cup.secret not in json.dumps(before)
    assert before["matches"][6]["a"] == 0
    after = cup_view(cup, REVEAL(6))
    assert (after["champion"], after["secret"]) == (0, cup.secret)
    assert cup_view(cup, ends_at(cup))["state"] == "aired"

def test_a_knockout_pair_waits_for_the_round_before_it():
    cup = played_cup(6, starts_at=START_ISO)   # 6 group matches, semis 6 and 7, final 8
    early = cup_view(cup, REVEAL(5) - timedelta(milliseconds=1))["matches"][6:]
    assert [(m["a"], m["b"], m["title"]) for m in early] == [(None, None, "Semi-final 1"), (None, None, "Semi-final 2"), (None, None, "Final")]
    assert [m["a"] is not None for m in cup_view(cup, REVEAL(5))["matches"][6:]] == [True, True, False]
    assert cup_view(cup, REVEAL(7))["matches"][8]["a"] is not None

def test_a_skipped_cup_says_so():
    assert cup_view(replace(drawn_cup(3), groups=(), skipped=True), START)["state"] == "skipped"
```

- [ ] **Step 2: Run them.** `PYTEST tests/test_cup_view.py`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `running_order` lays a shutter then a match for every match in index order. The shutter is the cut into its match; Plan D puts its intro desk segment before that shutter.
    - the shutter is `{"kind": "shutter", "duration_ms": SHUTTER_MS, "next": {"match_id", "title": match_label(...)}}`, naming no duck;
    - the match is `{"kind": "match", "duration_ms": round(clips[mid] * 1000), "match_id"}`;
    - each segment's `at_ms` is the running sum.

    It returns `{"starts_at": iso(starts_at), "segments": [...]}`. Import `SHUTTER_MS` from `arena.live`. `live.py` must never import `cupworker` at module top (Task 11 imports it inside functions).
  - `cup_view` computes `shown`, the matches with `revealed_at(cup, m.match_id) <= now`. Tables and `group_table` use only `shown` matches whose round is `"group"`, so a knockout rematch of two group-mates is not counted in their group.

- [ ] **Step 4: Run.** `PYTEST tests/test_cup_view.py tests/test_cupworker.py tests/test_cup.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "A cup gets a running order and shows only what has aired: the field before the start, each match from its reveal, the champion and the secret from the final's"

---

### Task 7: The cup worker

**Files:**
- Modify: `arena/cupworker.py`
- Modify: `arena/web/app.py`
- Modify: `tests/test_cupworker.py`
- Modify: `tests/test_web_app.py`

**Interfaces:**
- Consumes: `ClipJobs.enqueue(run_id, priority=0)` and `Store.mark_clip_pending`.
- Produces:
  - `CupWorker(store, clips, *, events, load, now=lambda: datetime.now(UTC), log=print, show=None)` with `tick()`, `start()` and `stop()`. `show` is Plan D's writer, kept as the contract names it. With `None`, the order waits on the clips alone.
  - Module constants `ORDER_LEAD`, `LOAD_PATIENCE`, `CLIP_RETRY` and `TICK_S`.
  - `app.state.cups`.

- [ ] **Step 1: Write the failing tests.** In `EARLY`, cup 1 closes 2026-10-23T14:00Z with its premiere at 16:00Z, and cup 2 closes 2026-10-30T15:00Z with its premiere at 17:00Z.

```python
EARLY = replace(TUG, cup=replace(TUG.cup, first=date(2026, 10, 23)))   # TUG: Task 5's pinned tug
T1 = datetime(2026, 10, 23, 14, 1, tzinfo=UTC)

class Clock:
    def __init__(self, at): self.at = at
    def __call__(self): return self.at

class FakeClips:
    def __init__(self): self.owed = []
    def enqueue(self, run_id, priority=0): self.owed.append(run_id)

class Crashing:
    """A store whose `at`-th write raises before it lands, as a Space restarting there would."""
    def __init__(self, store, at): self.store, self.at, self.writes = store, at, 0
    def __getattr__(self, name): return getattr(self.store, name)
    def _write(self):
        self.writes += 1
        if self.writes == self.at:
            raise RuntimeError("the Space restarted")
    def put_cup_files(self, *args): self._write(); self.store.put_cup_files(*args)
    def mark_clip_pending(self, *args): self._write(); self.store.mark_clip_pending(*args)

@pytest.fixture
def no_physics(monkeypatch):
    monkeypatch.setattr(cupworker, "play_match", fake_play)
    monkeypatch.setattr(cupworker, "compile_tug", lambda *_: None)
    monkeypatch.setattr(cupworker.secrets, "token_hex", lambda n: "ab" * n)

def enter(store, n, at="2026-10-22T09:00:00Z"):
    for i in range(n):
        store.append(make_record(run_id=f"R{i}", event_id="tug-of-war", user=f"p{i}", score=float(n - i), submitted_at=at), b"t")

def render(store, number=1, seconds=10.0):
    """What the clip jobs leave behind for every clip this cup owes."""
    for m in load_cup(store, "tug-of-war", number).matches:
        if store.clip_state(m.match_id)[0] == "pending":
            store.put_clip(m.match_id, {"clip.json": json.dumps({"rendered_at": "2026-10-23T14:30:00Z",
                           "layouts": {"landscape": {"seconds": seconds}}}).encode()})

def worker(store, clock, clips=None, load=lambda e: e.user):
    return CupWorker(store, clips or FakeClips(), events=[EARLY], load=load, now=clock, log=lambda _: None)
```

  Tests:
  - **`test_a_cup_goes_from_close_to_its_running_order(tmp_path, no_physics)`**
    - Setup: `enter(store, 6)`, then a tick at `T1`.
    - Expected after the tick:
      - `cup.secret == "ab" * 16`, `len(cup.matches) == 9` and `cup.order is None`;
      - `clips.owed == [m.match_id for m in cup.matches]`;
      - every match clip's state is `"pending"`.
    - Then `render`, set the clock to 15:00Z and tick. Expected: `order["starts_at"] == "2026-10-23T16:00:00Z"`.
  - **`test_a_late_order_starts_ten_minutes_after_it_is_fixed`**
    - Setup: as above, but render and tick at `2026-10-23T16:30:25Z`.
    - Expected: `starts_at == "2026-10-23T16:40:25Z"`.
  - **`test_a_crash_after_any_step_ends_in_the_same_cup`**
    - Reference store: `enter(…, 6)`, then `worker(…).tick()`, `render`, `tick()`.
    - Crash runs, for `k in range(1, 13)` (draw, matches, nine pending markers, order):
      - a fresh store with the same `enter`;
      - `crashing = worker(Crashing(store, k), Clock(T1))`;
      - `crashing.tick()`; if the cup has matches, `render(store)`; `crashing.tick()`;
      - then a fresh `worker(store, Clock(T1))` ticks, `render(store)`, and ticks again.
    - Expected: the bytes of every file under `cups/` and every `clips/*/pending.json` equal the reference's.
  - **`test_a_failed_match_clip_is_relaunched_every_ten_minutes_and_holds_the_order`**
    - Setup:
      - tick at `T1`;
      - render every match but the first, and `store.fail_clip(first, "2026-10-23T14:05:00Z", "ffmpeg exited 1")`;
      - clear `owed`.
    - Expected:
      - at `T1 + 5 min`, `owed == [first]`;
      - at `T1 + 10 min`, still `[first]`;
      - at `T1 + 15 min`, `[first, first]`;
      - the order is `None` throughout.
    - Then put the first clip and tick: an order is fixed.
  - **`test_a_withdrawal_after_close_changes_nothing`**
    - Setup:
      - `enter(store, 6)`;
      - withdraw `R5` at `"2026-10-23T14:00:01Z"` and `R4` at `"2026-10-23T13:59:59Z"`;
      - tick at `T1`.
    - Expected: the entrants' users are `["p0", "p1", "p2", "p3", "p5"]`.
  - **`test_an_entrant_whose_policy_no_longer_loads_is_left_out_after_ten_minutes`**
    - Setup: `load` raises `FetchError("could not read p2/tug: 404")` for `p2`.
    - Expected:
      - at `T1`, `load_cup(...) is None`;
      - at `2026-10-23T14:10Z` (close + `LOAD_PATIENCE`), the users are `["p0", "p1", "p3", "p4", "p5"]`.
  - **`test_too_few_entrants_skip_the_week`**
    - Setup: `enter(store, 3)`, then tick.
    - Expected:
      - `skipped is True`, `groups == ()` and `matches == ()`;
      - `owed == []`;
      - a second tick writes nothing new.
  - **`test_a_cup_gets_no_order_while_the_previous_one_has_not_aired`**
    - Setup:
      - `enter(store, 6)` and tick at `T1`;
      - at `2026-10-30T15:01Z`, `render(store, 1)` and tick;
      - check that cup 1's `starts_at == "2026-10-30T15:11:00Z"`;
      - `render(store, 2)`.
    - Expected:
      - a tick at `ends_at(cup1) - 1 s` leaves cup 2's order `None`;
      - a tick at `ends_at(cup1)` fixes cup 2's order with `starts_at == "2026-10-30T17:00:00Z"`.
  - **In `tests/test_web_app.py`, `test_the_app_holds_a_cup_worker_it_starts_only_where_clips_render(tmp_path)`**
    - Setup: `app = create_app(ArenaConfig.from_env(store_dir=tmp_path))`.
    - Expected:
      - `[m.id for m in app.state.cups.events] == ["tug-of-war"]`;
      - no thread named `"arena-cups"` is alive.

- [ ] **Step 2: Run them.** `PYTEST tests/test_cupworker.py tests/test_web_app.py`. Expected: FAIL.

- [ ] **Step 3: Implement.** This is the state machine. Each step is read back from the store, so a restart resumes anywhere:

```python
def tick(self):
    for manifest in self.events:
        try:
            self._advance(manifest)
        except Exception as exc:  # noqa: BLE001 — a cup that cannot move now moves next tick
            self.log(f"cups: {manifest.id} held ({type(exc).__name__}: {exc})")

def _advance(self, manifest):
    now = self.now()
    for number in range(1, closed_cups(manifest.cup, now) + 1):
        cup = load_cup(self.store, manifest.id, number) or self._draw(manifest, number, now)
        if cup is None or cup.skipped:
            continue
        if not cup.matches:
            cup, files = compute_matches(manifest, cup, self.load)
            self.store.put_cup_files(manifest.id, number, {"matches.json": cup.matches_json(), **files})
        if cup.order is None:
            self._schedule(cup, now)

def _draw(self, manifest, number, now):
    close_at, premiere_at = cup_times(manifest.cup, number)
    withdrawn = frozenset(w.run_id for w in self.store.withdrawals() if w.withdrawn_at <= iso(close_at))
    entrants, missing = [], []
    for entrant in entrants_at(self.store.runs(manifest.id), withdrawn, close_at):
        try:
            self.load(entrant)
            entrants.append(entrant)
        except Exception as exc:  # noqa: BLE001 — whatever stops a policy playing, it cannot play
            missing.append(f"{entrant.user} ({type(exc).__name__}: {exc})")
    if missing and now < close_at + LOAD_PATIENCE:
        self.log(f"cups: {manifest.id} #{number} waits for {', '.join(missing)}")
        return None
    secret = secrets.token_hex(16)
    skipped = len(entrants) < manifest.cup.min_entrants
    groups = () if skipped else tuple(tuple(g) for g in draw_groups(entrants, secret))
    cup = Cup(manifest.id, number, iso(close_at), iso(premiere_at), secret, tuple(entrants), groups, skipped)
    self.store.put_cup_files(manifest.id, number, {"draw.json": cup.draw_json()})
    return cup

def _schedule(self, cup, now):
    seconds = {}
    for match in cup.matches:
        state, written = self.store.clip_state(match.match_id)
        if state == "ready":
            seconds[match.match_id] = written["layouts"]["landscape"]["seconds"]
            continue
        if state == "none":
            self.store.mark_clip_pending(match.match_id, "arena", cup.event_id, iso(now))
        if state == "failed":
            if now - self._relaunched.get(match.match_id, now - CLIP_RETRY) < CLIP_RETRY:
                continue
            self._relaunched[match.match_id] = now
        self.clips.enqueue(match.match_id)
    if len(seconds) < len(cup.matches) or not self._previous_aired(cup, now):
        return
    starts_at = max(parse_iso(cup.premiere_at), (now + ORDER_LEAD).replace(microsecond=0))
    order = running_order(cup, seconds, starts_at)
    self.store.put_cup_files(cup.event_id, cup.number, {"order.json": json.dumps(order, indent=2).encode()})

def _previous_aired(self, cup, now):
    if cup.number == 1:
        return True
    previous = load_cup(self.store, cup.event_id, cup.number - 1)
    return previous is not None and (previous.skipped or (previous.order is not None and ends_at(previous) <= now))
```

  - Also log, in one line each: when the worker goes on without a missing entrant, each draw, the end of the matches, and the order it fixes.
  - `start()` runs a daemon thread `"arena-cups"` that ticks at once and then every `TICK_S` until `stop()` sets its event.
  - **`app.py`:**
    - build `app.state.cups = CupWorker(app.state.store, app.state.clips, events=[m for m in all_events() if m.cup], load=lambda e: load_entrant(app.state.store, e))`;
    - start it on startup and stop it on shutdown, inside the existing `if config.clip_worker and app.state.clips.available:` branch;
    - comment why: a cup cannot premiere without its clips, and a clip job's own app (`clip_worker=False`) must not compute cups.

- [ ] **Step 4: Run.** `PYTEST tests/test_cupworker.py tests/test_web_app.py tests/test_clips.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "The cup worker closes, draws, plays, owes every match its clip and fixes the running order, picking up where the dataset left off after any restart"

---

### Task 8: A clip per match

**Files:**
- Modify (Python): `arena/recorder.py`, `arena/clips.py`, `arena/web/config.py`, `arena/cli.py`, `tests/test_clips.py`, `tests/test_web_config.py`, `tests/test_cli.py`
- Modify (front): `app/clip.html`, `app/public/clip.css`, `app/src/api.js`, `app/src/api.test.js`, `app/src/clip/score.js`, `app/src/clip/score.test.js`, `app/src/clip/main.js`
- Create (front): `app/src/bouts.js`, `app/src/bouts.test.js`, `app/src/clip/match.js`, `app/src/clip/match.test.js`

**Interfaces:**
- Consumes: `is_match_id`; Plan A's tug lane `{tug: "bout", ducks: [{trace, settle?, livery, name}, …]}` (west first, traces in world coordinates); Task 9's `GET /api/matches/{id}` body (`a`, `b`, `bouts`, `title`, `cup`, `event`, `winner`, `wins`).
- Produces (Python):
  - `ArenaConfig.reveal_all: bool = False` and `from_env(..., reveal_all: bool = False)`;
  - `cli._app_on_loopback(store_dir, reveal_all: bool = False)`, with `_cmd_clip` passing `reveal_all=True`;
  - the recorder opens `clip.html?match=<id>` for a match id;
  - `clip_manifest` puts the plan's `bouts` into each layout's `timing`;
  - `ClipJobs` never fails a match id for its tries.
- Produces (JS):

```js
// api.js
export const getMatch = (matchId) => json(`/api/matches/${matchId}`);
export const getBoutTrace = (matchId, k) => frames(`/api/matches/${matchId}/bouts/${k}/trace`);
export const getBoutSettle = (matchId, k) => frames(`/api/matches/${matchId}/bouts/${k}/settle`);
export const getMatchClip = (matchId) => json(`/api/matches/${matchId}/clip`);
export const matchClipUrl = (matchId, name, version) => `/api/matches/${matchId}/clip/${name}?v=${version}`;
// bouts.js
export function boutLane(match, k, traces, settles)   // {tug: "bout", ducks: [west, east]}, each {trace, settle, livery, name} (the entrant's on-air name), a/b placed by bouts[k].a_side
// clip/match.js
export function matchPlan(bouts)   // bouts: [{k, settle, steps}] -> {fps, stride, intro, travel, outro, frames, seconds, tapeEnd, poster, spans: [{k, from, to, settle, steps}], bouts: [{k, tape_start_s, tape_end_s}]}
export function boutAt(plan, i)    // {bout, step}: bout 0 step 0 in the intro, the last bout's last step in the outro
export function scoreAt(plan, match, i)   // [a, b]: the bouts whose tape has ended by frame i
export function matchWords(match)  // {title, line, outro}
// clip/score.js
export function matchScore({ match, plan })   // clipScore's crowd (progress []) and SOURCES cues, no voices
```

- [ ] **Step 1: Write the failing tests.**

```python
# tests/test_clips.py
def test_a_match_clip_opens_the_match_on_the_clip_page():
    opened = []
    tab = SimpleNamespace(navigate=opened.append, wait_ready=lambda: None)
    chrome = SimpleNamespace(tab=lambda width, height: tab)
    recorder._open(chrome, "http://o", "tug-of-war-0001-004", "landscape")
    recorder._open(chrome, "http://o", "01M4Z4YCJ15T56BAXX1RPD", "vertical")
    assert opened == ["http://o/clip.html?match=tug-of-war-0001-004&layout=landscape&frame=0",
                      "http://o/clip.html?run=01M4Z4YCJ15T56BAXX1RPD&layout=vertical&frame=0"]

def test_a_match_clip_says_where_each_bout_sits():
    run, bouts = rendered(), [{"k": 0, "tape_start_s": 3.52, "tape_end_s": 23.52}]
    land = run.layouts["landscape"]
    run.layouts["landscape"] = replace(land, plan={**land.plan, "bouts": bouts})
    manifest = clip_manifest("tug-of-war-0001-000", run, "2026-10-30T15:20:00Z")
    assert manifest["layouts"]["landscape"]["timing"] == {"total_wall_ms": 1, "bouts": bouts}
    assert manifest["layouts"]["vertical"]["timing"] == {"total_wall_ms": 1}

def test_a_match_clip_job_is_launched_again_however_often_the_machine_ends_it(tmp_path):
    store, mid = LocalStore(tmp_path), "tug-of-war-0001-000"
    store.mark_clip_pending(mid, "arena", "tug-of-war", "2026-10-30T15:01:00Z")
    api = FakeJobs()
    jobs = jobs_for(store, api)
    jobs.enqueue(mid)
    for attempt in range(1, JOB_TRIES + 3):
        jobs.tick()
        api.stage[f"J{attempt}"] = "ERROR"
    jobs.tick()
    assert len(api.launched) == JOB_TRIES + 3 and store.clip_state(mid) == ("pending", None)

# tests/test_web_config.py
def test_only_a_clip_job_reads_unrevealed_matches(tmp_path):
    assert ArenaConfig.from_env(store_dir=tmp_path).reveal_all is False
    assert ArenaConfig.from_env(store_dir=tmp_path, reveal_all=True).reveal_all is True

# tests/test_cli.py
def test_arena_clip_serves_its_page_every_match(tmp_path, monkeypatch):
    asked = []
    monkeypatch.setattr(cli, "_app_on_loopback", lambda store_dir, reveal_all=False: asked.append(reveal_all))
    assert cli.main(["clip", "tug-of-war-0001-000", "--store", str(tmp_path)]) == 1 and asked == [True]
```

```js
// app/src/clip/match.test.js
const twenty = { settle: 26, steps: 1000 };
it("chains three 20 s bouts between the title and the outro: a 67 s clip", () => {
  const plan = matchPlan([0, 1, 2].map((k) => ({ k, ...twenty })));
  expect(plan.frames).toBe(1677);
  expect(plan.seconds).toBeCloseTo(67.08);
  expect(plan.bouts).toEqual([{ k: 0, tape_start_s: 3.52, tape_end_s: 23.52 },
    { k: 1, tape_start_s: 24.04, tape_end_s: 44.04 }, { k: 2, tape_start_s: 44.56, tape_end_s: 64.56 }]);
});
it("keeps the longest match, five full bouts, under two minutes", () => {
  expect(matchPlan([0, 1, 2, 3, 4].map((k) => ({ k, ...twenty }))).seconds).toBeCloseTo(108.12);
});
const small = () => matchPlan([{ k: 0, settle: 2, steps: 4 }, { k: 1, settle: 2, steps: 6 }]);   // tape frames 75-77, then 78-81
it("finds the bout and its step for every frame", () => {
  const plan = small();
  expect([0, 76, 78, 81, plan.frames - 1].map((i) => boutAt(plan, i))).toEqual([
    { bout: 0, step: 0 }, { bout: 0, step: 2 }, { bout: 1, step: 0 }, { bout: 1, step: 6 }, { bout: 1, step: 7 }]);
});
it("counts a bout on the bug once its tape has ended", () => {
  const plan = small(), match = { bouts: [{ winner: "a" }, { winner: "b" }] };
  expect([77, 78, plan.frames - 1].map((i) => scoreAt(plan, match, i))).toEqual([[0, 0], [1, 0], [1, 1]]);
});
it("says who meets whom and who won", () => {
  const match = { cup: 3, title: "Final · Tank vs Lean", event: { title: "Tug of War" },
    a: { name: "Tank" }, b: { name: "Lean" }, winner: "a", wins: [2, 1] };
  expect(matchWords(match)).toEqual({ title: "Tug of War · Cup #3", line: "Final · Tank vs Lean", outro: "Tank wins 2–1" });
});
// app/src/clip/score.test.js
it("scores a match: the crowd answers the verdict and the stamp lands at the outro", () => {
  const plan = matchPlan([{ k: 0, settle: 26, steps: 1000 }]);
  const score = matchScore({ match: { match_id: "tug-of-war-0001-000", event: { clip: { sounds: ["crowd", "verdict"] } } }, plan });
  expect(score.crowd).toEqual({ start: 3, end: plan.tapeEnd / 25, verdict: "pass", progress: [] });
  expect(score.cues.map((cue) => cue.at)).toEqual([plan.tapeEnd / 25, plan.tapeEnd / 25 + 0.16]);
});
// app/src/bouts.test.js
it("puts each side on its end of the rope, west first, under its on-air name", () => {
  const match = { a: { livery: "blue", name: "Tank" }, b: { livery: "purple", name: "Lean" },
    bouts: [{ a_side: "west" }, { a_side: "east" }] };
  expect(boutLane(match, 1, ["tw", "te"], ["sw", "se"])).toEqual({ tug: "bout", ducks: [
    { trace: "tw", settle: "sw", livery: "purple", name: "Lean" },
    { trace: "te", settle: "se", livery: "blue", name: "Tank" }] });
});
// app/src/api.test.js
it("reads a bout as two ducks and versions a match clip's files", async () => {
  respondWith({ bytes: new Float32Array(84).buffer, headers: { "X-Duck-Count": "2" } });
  const ducks = await getBoutTrace("tug-of-war-0001-000", 1);
  expect(fetch).toHaveBeenCalledWith("/api/matches/tug-of-war-0001-000/bouts/1/trace");
  expect(ducks.map((d) => d.length)).toEqual([42, 42]);
  expect(matchClipUrl("tug-of-war-0001-000", "landscape.mp4", "v1")).toBe("/api/matches/tug-of-war-0001-000/clip/landscape.mp4?v=v1");
});
```

- [ ] **Step 2: Run them.**
  - `PYTEST tests/test_clips.py tests/test_web_config.py tests/test_cli.py`
  - `VITEST src/clip/match.test.js`, `VITEST src/clip/score.test.js`, `VITEST src/bouts.test.js` and `VITEST src/api.test.js`

  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`recorder._open`** asks for `match=` when `is_match_id(run_id)`, and `run=` otherwise.
  - **`clip_manifest`.** A layout's `timing` becomes `{**layout.timing, "bouts": layout.plan["bouts"]}` when the plan has `bouts`. Plan D times its calls by these.
  - **`ClipJobs._ended`** re-owes the clip when `is_match_id(run_id) or self._tries[run_id] < JOB_TRIES`. Add a comment: a cup cannot premiere with a hole, and the cup worker spaces the relaunches of failed renders.
  - **`ArenaConfig.reveal_all`.** Its comment says the clip job's loopback app must read matches before they air; the Space never sets it.
  - **`matchPlan`:**
    - `intro = FPS * 3`;
    - per bout, `tape = ceil((settle + steps) / STRIDE)`;
    - `tape_start_s = round3(from / FPS + settle * CTRL_DT)` and `tape_end_s = round3(tape_start_s + steps * CTRL_DT)`;
    - `outro = Math.round(FPS * 2.5)`;
    - `travel = FPS * 2.4`;
    - `poster = intro + Math.floor(tape * 0.6)`, where `tape` is the bouts' total.

    `actAt` and `travelAt` from `plan.js` then work on it unchanged.
  - **`boutAt` and `scoreAt`.**
    - In the tape, `step = (i - span.from) * stride`, clamped to the span's last step.
    - A bout counts on the bug once `i >= span.to`.
  - **`matchWords`** gives `{title: `${event.title} · Cup #${cup}`, line: match.title, outro: `${winner.name} wins ${w}–${l}`}`.
  - **`clip.html`.** Add `<p class="crt-osd osd-bug mono-label" id="osd-bug" hidden></p>` in `.screen`.
  - **`clip.css`.** Place `.osd-bug` top right (`right: 18px; top: 14px`), in paper colour. The digits are `<b>` in magenta, as `.crt-osd b` already does.
  - **`clip/main.js`.** Run `params.has("match") ? mainMatch() : main()` and keep `main()` as it is. `mainMatch()` does:
    - `getMatch`, then for every bout `getBoutTrace` with `getBoutSettle(...).then(standing)`;
    - `plan = matchPlan(bouts.map(... {k, settle: frameCount(settles[0]), steps: frameCount(traces[0])}))`;
    - builds the viewer as `main()` does, with `match.event`'s rig and camera;
    - `draw(i)`:
      - calls `viewer.setLanes([boutLane(match, k, traces, settles)], match.event, { loop: false })` whenever `boutAt` changes bout;
      - calls `viewer.frame(step * CTRL_DT, travelAt(plan, i), i / plan.fps, crowdDirection)`, the step counted from the settle's first frame as Plan A's bench clip counts its `{tug: "bench", trace, settle}` lane;
      - sets the clock to `clock(max(0, step - span.settle))`;
      - shows `#osd-bug` outside the intro as `` `${A} <b>${a}–${b}</b> ${B}` ``, `A` and `B` the sides' `name`s;
      - shows the stamp `matchWords(match).outro` centred (`left: 50%; top: 45%`) at the outro;
      - keeps `#sheet` hidden;
      - fills the words from `matchWords` (`top-title`, `intro-title`, `top-participant`, `intro-line`, `osd-rec` = `REC · ${line}`, `osd-event`).

      `window.clip` has the same shape as `main()`'s, with `score: matchScore({ match, plan })`.

- [ ] **Step 4: Run.** The same commands. Expected: PASS.

- [ ] **Step 5: Commit.** "Every match gets its clip: the bouts chained between a title and the winner with a score bug, rendered on a job that never gives up on a match"

---

### Task 9: The cup API

**Files:**
- Create: `arena/web/routes_cups.py`
- Modify: `arena/web/app.py` (`include_router`)
- Create: `tests/test_routes_cups.py`

**Interfaces:**
- Produces:
  - `now() -> datetime`, the request's moment, patched by tests;
  - the contract's endpoints:
    - `GET /api/events/{id}/cups`;
    - `GET /api/events/{id}/cups/{number}`, which returns `{"event": event_summary(m), "open": <the open cup's number>, "min_entrants", **cup_view(cup, now())}`;
    - `GET /api/matches/{id}`, which returns `{match_id, event, cup, round, group, title, a, b, bouts, wins, winner: "a"|"b", decided_by, clip}`. `a`/`b` are `Entrant.view()` and `clip` is the ready clip's `clip_version` or `None` (a bout's traces are in world coordinates: the viewer needs no starts);
    - `…/bouts/{k}/trace` and `…/settle`, through `frames_response`;
    - `…/clip`, as `run_clip`'s ready/failed/state body with `match_clip_url`;
    - `…/clip/{name}`.

    These last two answer from `airs_at − PREFETCH` (30 s before the clip airs). Everything else answers from `revealed_at`, once the clip has finished airing.

    Every cup and match answer carries `Cache-Control: no-store` except the clip files, which are immutable.
- Consumes: `store_cup(store, cup, seconds=10.0)`, a test helper added to `tests/test_cupworker.py`. It writes `draw.json`, `matches.json` and `order.json` when present, plus every bout as `encode(zeros((2, 2, 21)), zeros((2, 3, 21)))`. Each match gets a ready clip:
  - `clip.json` is `{"rendered_at": "2026-10-30T15:20:00Z", "poster": "poster.png", "layouts": {"landscape": {"file": "landscape.mp4", "width": 1920, "height": 1080, "seconds": seconds}}}`;
  - `landscape.mp4` is `b"mp4"` and `poster.png` is `b"png"`.

- [ ] **Step 1: Write the failing tests** (`client` as in `test_routes_read.py`, plus `monkeypatch.setattr("arena.web.routes_cups.load_event", lambda event_id: TUG if event_id == "tug-of-war" else load_event(event_id))` so the shipped cup #1 date never moves a test; `at(monkeypatch, moment)` patches `routes_cups.now`):

```python
def test_the_cups_list_names_the_open_cup_and_every_closed_one(client, monkeypatch):
    api, app = client
    for i in range(4):
        app.state.store.append(make_record(run_id=f"R{i}", event_id="tug-of-war", user=f"p{i}", score=float(4 - i),
                                           submitted_at="2026-10-29T09:00:00Z"), b"t")
    at(monkeypatch, datetime(2026, 10, 30, 15, 30, tzinfo=UTC))
    body = api.get("/api/events/tug-of-war/cups").json()
    assert (body["next"]["number"], body["next"]["premiere_at"]) == (2, "2026-11-06T17:00:00Z")
    assert [e["user"] for e in body["next"]["entrants"]] == ["p0", "p1", "p2", "p3"]
    assert body["cups"] == [{"number": 1, "premiere_at": "2026-10-30T17:00:00Z", "starts_at": None, "state": "drawn", "champion": None}]
    assert api.get("/api/events/sprint-2m/cups").status_code == 404

def test_a_cup_answers_as_of_now(client, monkeypatch):
    api, app = client
    cup = played_cup(4, starts_at=START_ISO)
    store_cup(app.state.store, cup)
    at(monkeypatch, START - timedelta(seconds=1))
    body = api.get("/api/events/tug-of-war/cups/1").json()
    assert (body["state"], body["event"]["id"], body["open"], body["min_entrants"]) == ("ready", "tug-of-war", 2, 4)
    assert "matches" not in body
    at(monkeypatch, REVEAL(6))
    assert api.get("/api/events/tug-of-war/cups/1").json()["secret"] == cup.secret
    assert api.get("/api/events/tug-of-war/cups/3").status_code == 404

def test_a_match_and_everything_of_it_is_a_404_until_its_reveal(client, monkeypatch):
    api, app = client
    cup = played_cup(4, starts_at=START_ISO)
    store_cup(app.state.store, cup)
    mid = cup.matches[0].match_id
    paths = [f"/api/matches/{mid}{tail}" for tail in ("", "/bouts/0/trace", "/bouts/0/settle", "/clip", "/clip/landscape.mp4")]
    def codes(moment):
        at(monkeypatch, moment)
        return [api.get(p).status_code for p in paths]
    # The clip's media come 30 s before it airs, so the live can buffer them; the rest once it has aired.
    assert codes(AIRS(0) - PREFETCH - timedelta(milliseconds=1)) == [404] * 5
    assert codes(AIRS(0) - PREFETCH) == [404, 404, 404, 200, 200]
    assert codes(AIRS(0)) == [404, 404, 404, 200, 200]
    assert codes(REVEAL(0) - timedelta(milliseconds=1)) == [404, 404, 404, 200, 200]
    assert codes(REVEAL(0)) == [200] * 5
    body = api.get(paths[0]).json()
    assert (body["a"]["user"], body["b"]["user"], body["winner"], body["wins"], body["round"], body["group"]) == ("p0", "p3", "a", [2, 0], "group", "A")
    assert (body["title"], body["clip"]) == ("Group A · duck 0 vs duck 3", "20261030T152000Z")
    trace = api.get(paths[1])
    assert (trace.headers["x-duck-count"], trace.headers["x-frame-count"]) == ("2", "2")
    assert api.get(f"/api/matches/{mid}/bouts/2/trace").status_code == 404
    assert api.get("/api/matches/nope").status_code == 404 and api.get("/api/matches/tug-of-war-0009-000").status_code == 404

def test_the_clip_jobs_own_app_reads_every_match(tmp_path, monkeypatch):
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path, reveal_all=True))
    cup = replace(played_cup(4), order=None)   # clips are rendered before there is an order
    store_cup(app.state.store, cup)
    at(monkeypatch, datetime(2026, 10, 30, 15, 5, tzinfo=UTC))
    assert TestClient(app).get(f"/api/matches/{cup.matches[6].match_id}").status_code == 200
```

  `START`, `START_ISO`, `AIRS` and `REVEAL` are imported from `tests/test_cup_view.py`, `TUG` from `tests/test_cupworker.py`.

- [ ] **Step 2: Run them.** `PYTEST tests/test_routes_cups.py`. Expected: FAIL (404 on every route).

- [ ] **Step 3: Implement** `routes_cups.py`.
  - `_cups_event(event_id)` reads the manifest through this module's `load_event` (tests patch it) and returns 404 for an unknown event or one without `[cup]`.
  - `_unsettled(store, manifest, number, moment) -> Cup` stands for a cup that is open, or closed and not drawn yet. It takes `moment = min(moment, close_at)`, the withdrawals at or before `iso(moment)`, `entrants_at(store.runs(id), withdrawn, moment)`, `secret=""` and `groups=()`.
  - `GET /api/events/{id}/cups`:
    - `next` is the `_unsettled` open cup `closed + 1`;
    - `cups` lists numbers `closed … 1`, each `load_cup(...) or _unsettled(...)`, as `{number, premiere_at, starts_at, state, champion}`;
    - `champion` is the user behind `cup_view(...)["champion"]`.
  - `GET /api/events/{id}/cups/{number}` returns 404 outside `1 … closed + 1`.
  - `_public_match(request, match_id, media=False)` uses `parse_match_id`, `_cups_event`, `load_cup` and the index. It returns 404 unless `config.reveal_all` or `now() >= (airs_at(...) - PREFETCH if media else revealed_at(...))`.
    - `/clip` and `/clip/{name}` pass `media=True`. Comment why: the live prepares a clip before its slot, the mp4 says nothing until it plays, and Plan D serves its call by the same rule (`PREFETCH` from `arena/cup.py`, Task 6).
  - Register the router in `create_app`.

- [ ] **Step 4: Run.** `PYTEST tests/test_routes_cups.py tests/test_routes_read.py`. Expected: PASS.

- [ ] **Step 5: Commit.** "The cup and match API answers as of now: the field before the start, each match with its bouts and its clip from its reveal"

---

### Task 10: Cup points and the profile's cups

**Files:**
- Modify: `arena/points.py`, `arena/web/routes_read.py`, `arena/web/routes_auth.py`, `arena/commentary/__init__.py`
- Modify: `tests/test_points.py`, `tests/test_routes_read.py`, `tests/test_commentary.py`

**Interfaces:**
- Produces:
  - `receipts(records, withdrawn, ballots=(), voted=None, now=None, runner_version=RUNNER_VERSION, cups: Sequence[Cup] = ())`. It raises `ValueError` when given cups without a `now`;
  - `SCHEDULE` gains `"cup_champion": 250, "cup_final": 150, "cup_semi": 100`;
  - `GET /api/players/{user}` gains `cups: [{event_id, event_title, number, starts_at, reached}]`, listing the cups whose final is revealed, the instant their points land.
- Consumes: `all_cups(store)` and `reached(cup)`.
- Every caller passes the cups:
  - `routes_read.py` passes `cups=all_cups(store)` at its three `receipts` calls (`/standings`, `/players/{user}`, `/runs/{id}`); its `boards_by_user` call is unchanged;
  - `routes_auth.py` passes them in `/api/me`;
  - `commentary.gather` passes `cups=all_cups(store), now=parse_iso(record.submitted_at)`: a season as of the run's publication.

- [ ] **Step 1: Write the failing tests.** In `played_cup(6)` the groups are A = (1, 3, 5) and B = (0, 2, 4). Semi 6 is p1 v p2, semi 7 is p0 v p3, and in final 8 p0 beats p1.

```python
# tests/test_points.py
def test_a_cup_pays_its_podium_from_the_finals_reveal():
    cup = played_cup(6, starts_at=START_ISO)
    assert receipts([], frozenset(), cups=[cup], now=REVEAL(8) - timedelta(milliseconds=1)) == []
    paid = receipts([], frozenset(), cups=[cup], now=REVEAL(8))
    final, (semi_a, semi_b) = cup.matches[8].match_id, (cup.matches[6].match_id, cup.matches[7].match_id)
    assert sorted((r.user, r.act, r.points, r.source_id) for r in paid) == sorted([
        ("p0", "cup_champion", 250, final), ("p1", "cup_final", 150, final),
        ("p2", "cup_semi", 100, semi_a), ("p3", "cup_semi", 100, semi_b)])
    assert {r.at for r in paid} == {"2026-10-30T17:01:44Z"}   # the final's clip ends 9 × 11.6 s into the show
    with pytest.raises(ValueError):
        receipts([], frozenset(), cups=[cup])

# tests/test_routes_read.py
def test_a_player_page_and_the_ladder_count_the_cups(client):
    api, app = client
    store_cup(app.state.store, played_cup(6, starts_at="2026-01-02T17:00:00Z"))
    record_run(app, run_id="R0", event_id="tug-of-war", user="p0")
    assert api.get("/api/players/p0").json()["cups"] == [{"event_id": "tug-of-war", "event_title": load_event("tug-of-war").title,
        "number": 1, "starts_at": "2026-01-02T17:00:00Z", "reached": "champion"}]
    ladder = {row["user"]: row["points"] for row in api.get("/api/standings").json()["rows"]}
    assert (ladder["p1"], ladder["p2"]) == (150, 100)

def test_the_chip_counts_cup_points(tmp_path):
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path, dev_user="p1"))
    store_cup(app.state.store, played_cup(6, starts_at="2026-01-02T17:00:00Z"))
    assert TestClient(app).get("/api/me").json()["points"] == 150

# tests/test_commentary.py
def test_a_season_counts_the_cups_aired_before_the_run(tmp_path):
    store = LocalStore(tmp_path)
    store_cup(store, played_cup(6, starts_at="2026-01-02T17:00:00Z"))
    mine = make_record(run_id="R9", event_id="tug-of-war", user="p1", submitted_at="2026-02-01T09:00:00Z")
    store.append(mine, b"trace")
    facts = gather(store, mine, LORE, BroadcastBook(tmp_path / "book"), random.Random(0), callback=False)
    assert "@p1 has 510 points this season" in next(f.text for f in facts if f.ref == "notable#/profile")
```

  The 510 points are cup_final 150, first_event 100, run 10, and podium 250 on a board of one.

- [ ] **Step 2: Run them.** `PYTEST tests/test_points.py tests/test_routes_read.py tests/test_commentary.py`. Expected: FAIL.

- [ ] **Step 3: Implement.** The `receipts` addition:
  - for each cup whose final is revealed by `now` (its clip has finished airing), take `at = iso(revealed_at(final))`;
  - for each entrant `i`, read `reached(cup)[i]`:
    - `"champion"` pays `cup_champion` and `"final"` pays `cup_final`, both against the final's id;
    - `"semi-final"` pays `cup_semi` against the id of the semi-final that entrant played.
  - A frozen cup pays even an entrant who has since withdrawn.

- [ ] **Step 4: Run.**
  - `PYTEST tests/test_points.py tests/test_routes_read.py tests/test_commentary.py tests/test_routes_auth.py`
  - `PYTEST tests/test_commentary_context.py tests/test_commentary_notable.py`

  Expected: PASS.

- [ ] **Step 5: Commit.** "A cup pays its champion, finalist and semi-finalists when the final airs, and a player's page lists the cups they played"

---

### Task 11: The cup on the live channel

**Files:**
- Modify (Python): `arena/live.py`, `arena/commentary/stock.py`, `arena/web/app.py`, `tests/test_live.py`, `tests/test_commentary_stock.py`
- Modify (front): `app/src/live/channel.js`, `app/src/live/replay.js`, `app/src/live/shutter.js`, `app/src/live.js`, `app/src/format.js`, `app/public/stage.css`
- Tests (front): `app/src/live/channel.test.js`, `app/src/live/replay.test.js`, `app/src/live/shutter.test.js`, `app/src/format.test.js`, `app/src/live/standby.test.js`
- Create (front): `app/src/live/standby.js`

**Interfaces:**
- Produces (Python):

```python
@dataclass(frozen=True)
class Entry: ...; title: str | None = None     # a cup match's "Tug of War · Cup #1 · Final · duck 0 vs duck 1"
@dataclass(frozen=True)
class Show:
    starts_ms: int; ends_ms: int
    slots: tuple[dict, ...]      # absolute: each shutter, and each match as a replay slot with its clip version
    standby: dict                # {"event", "number", "title", "starts_at_ms"}
def pool(store, now: datetime) -> list[Entry]   # the runs as today, plus the last aired cup's matches until that event's next cup starts
def shows(store, now: datetime) -> list[Show]   # every cup with an order that has not ended, by start
class Programme:  def __init__(self, source, now_ms, book, cups=lambda: []): ...
```

  - In `slots_for`, an entry with a `title` (a match) is announced by `next = {"match_id", "title"}`. Its replay slot adds `"media": "match"`, and it never gets a booth.
  - `CommentaryStock.wanted()` skips every `is_match_id` entry: `compose` finds runs only.
  - `app.py` passes both the programme and the stock `lambda: pool(store, datetime.now(UTC))`, and passes the programme `cups=lambda: shows(store, datetime.now(UTC))`.
  - The existing `pool(store)` call in `tests/test_live.py` gains `datetime(2026, 9, 16, tzinfo=UTC)`.
- Produces (JS): in `channel.js`, `PREFETCH_MS = 25_000`. A slot with `media === "match"` is prepared only from `PREFETCH_MS` before its `at_ms`: the server serves its clip from 30 s before (`cup.PREFETCH`, Task 9), and 5 s spare a screen whose clock runs a little ahead (Plan D's helper applies the same constant to every slot).
- Produces (JS):
  - `format.js`: `export function countdown(ms)` returns `"0:05"`, `"1:02:05"` or `"1d 01:01:01"`, rounding seconds up.
  - `live/standby.js`: `export function createStandby(stage)`, a segment with `failed`, `prepare`, `show`, `play`, `seek`, `stop` and `muted`.

- [ ] **Step 1: Write the failing tests.**

```python
SHOW = Show(10_030_000, 10_041_600, (
    {"kind": "shutter", "at_ms": 10_030_000, "duration_ms": 1600, "next": {"match_id": "m", "title": "Final"}},
    {"kind": "replay", "at_ms": 10_031_600, "duration_ms": 10000, "run_id": "m", "clip": "v", "media": "match"}),
    {"event": "tug-of-war", "number": 1, "title": "Cup #1", "starts_at_ms": 10_030_000})
TITLE = load_event("tug-of-war").title

def test_a_match_entry_is_announced_by_its_title_and_plays_its_match_clip_with_no_booth(tmp_path):
    match = Entry("tug-of-war-0001-008", "p0", TITLE, "2026-10-30T17:01:34Z", 10000, "v1", title="Final · x vs y")
    book = BroadcastBook(tmp_path)
    book.put(match.run_id, {"run_id": match.run_id, "turns": [], "lore_refs": []},
             {"duration_ms": 20000, "captions": [], "notes": [], "gestures": []}, "2026-10-30T18:00:00Z")
    shutter, replay = slots_for([match], 1_000_000, book)
    assert shutter["next"] == {"match_id": "tug-of-war-0001-008", "title": "Final · x vs y"}
    assert replay == {"kind": "replay", "at_ms": 1_001_600, "duration_ms": 10000, "run_id": "tug-of-war-0001-008",
                      "clip": "v1", "media": "match"}

def test_an_aired_cup_joins_the_pool_until_the_next_cup_starts(tmp_path):
    store, cup = LocalStore(tmp_path), played_cup(4, starts_at=START_ISO)
    store_cup(store, cup)
    assert pool(store, ends_at(cup) - timedelta(seconds=1)) == []
    entries = pool(store, ends_at(cup))
    assert len(entries) == 7 and entries[-1].title == f"{TITLE} · Cup #1 · Final · duck 0 vs duck 1"
    assert (entries[-1].submitted_at, entries[-1].replay_ms, entries[-1].clip) == (iso(REVEAL(6)), 10000, "20261030T152000Z")
    store_cup(store, played_cup(4, number=2, starts_at="2026-11-06T17:00:00Z"))
    assert len(pool(store, datetime(2026, 11, 6, 16, 59, tzinfo=UTC))) == 7
    assert pool(store, datetime(2026, 11, 6, 17, tzinfo=UTC)) == []

def test_shows_lay_a_cup_at_its_absolute_times(tmp_path):
    store, cup = LocalStore(tmp_path), played_cup(4, starts_at=START_ISO)
    store_cup(store, cup)
    start = int(START.timestamp() * 1000)
    [show] = shows(store, START - timedelta(hours=1))
    assert (show.starts_ms, show.ends_ms, len(show.slots)) == (start, start + 7 * 11600, 14)
    assert show.slots[0]["next"] == {"match_id": cup.matches[0].match_id, "title": "Group A"}
    assert show.slots[1] == {"kind": "replay", "at_ms": start + 1600, "duration_ms": 10000,
                             "run_id": cup.matches[0].match_id, "clip": "20261030T152000Z", "media": "match"}
    assert show.standby == {"event": "tug-of-war", "number": 1, "title": f"{TITLE} · Cup #1", "starts_at_ms": start}
    assert shows(store, ends_at(cup)) == []

def test_the_cycle_stands_by_for_a_show_then_plays_it_at_its_times(tmp_path):
    programme = Programme(lambda: [entry("A"), entry("B")], Clock(10_000_000), BroadcastBook(tmp_path), cups=lambda: [SHOW])
    slots = programme.slots()
    assert [(s["kind"], s["at_ms"]) for s in slots[:8]] == [
        ("shutter", 10_000_000), ("replay", 10_001_600), ("shutter", 10_009_600), ("replay", 10_011_200),
        ("shutter", 10_019_200), ("replay", 10_020_800), ("standby", 10_028_800), ("shutter", 10_030_000)]
    assert slots[6] == {"kind": "standby", "at_ms": 10_028_800, "duration_ms": 1200, "cup": SHOW.standby}
    assert slots[8] == SHOW.slots[1] and slots[9]["at_ms"] == 10_041_600
    for a, b in pairwise(slots):
        assert b["at_ms"] == a["at_ms"] + a["duration_ms"]

def test_a_restart_mid_show_joins_the_segment_airing_now(tmp_path):
    slots = Programme(lambda: [entry("A")], Clock(10_035_000), BroadcastBook(tmp_path), cups=lambda: [SHOW]).slots()
    assert slots[0] == SHOW.slots[1] and (slots[1]["kind"], slots[1]["at_ms"]) == ("shutter", 10_041_600)

# tests/test_commentary_stock.py
def test_the_booth_never_wants_a_cup_match(tmp_path):
    worker, _ = stock(tmp_path, entries("tug-of-war-0001-008", "a"), lambda run_id: written(run_id))
    assert worker.wanted() == ["a"]
```

```js
// live/channel.test.js
it("prepares a cup match only from PREFETCH_MS before it airs, inside the 30 s its clip is served", () => {
  const cup = [
    { kind: "replay", at_ms: 0, duration_ms: 60000, run_id: "m0", clip: "v", media: "match" },
    { kind: "shutter", at_ms: 60000, duration_ms: 1600, next: { match_id: "m1", title: "Final" } },
    { kind: "replay", at_ms: 61600, duration_ms: 60000, run_id: "m1", clip: "v", media: "match" }];
  channel.update({ slots: cup });
  now = 61_600 - PREFETCH_MS - 1;
  channel.tick();
  expect(replay.prepare).not.toHaveBeenCalledWith(cup[2]);
  now = 61_600 - PREFETCH_MS;
  channel.tick();
  expect(replay.prepare).toHaveBeenCalledWith(cup[2]);
  expect(PREFETCH_MS).toBe(25_000);
});
// live/replay.test.js
it("plays a cup match from the match's clip", () => {
  replay.prepare({ kind: "replay", at_ms: 0, duration_ms: 8000, run_id: "tug-of-war-0001-000", clip: "v1", media: "match" });
  expect([...stage.querySelectorAll("video")].some((v) => v.getAttribute("src") === "/api/matches/tug-of-war-0001-000/clip/landscape.mp4?v=v1")).toBe(true);
});
// live/shutter.test.js
it("announces a cup match by its title alone", () => {
  const container = document.createElement("div"), shutter = createShutter(container);
  shutter.draw(900, { match_id: "m", title: "Final · Tank vs Lean" });
  expect(container.querySelector(".live-upnext-event").textContent).toBe("Final · Tank vs Lean");
  expect(container.querySelector(".live-upnext-user").hidden).toBe(true);
  shutter.draw(900, { event: "2 m Sprint", user: "carol" });
  expect(container.querySelector(".live-upnext-user").hidden).toBe(false);
});
// format.test.js
it("counts down in the largest units that matter", () => {
  expect([0, 4_500, 65_000, 3_725_000, 90_061_000].map(countdown)).toEqual(["0:00", "0:05", "1:05", "1:02:05", "1d 01:01:01"]);
});
// live/standby.test.js
it("shows the cup and the time left from the slot's offset", () => {
  const stage = document.createElement("div"), standby = createStandby(stage);
  standby.play({ kind: "standby", at_ms: 0, duration_ms: 65_000, cup: { title: "Tug of War · Cup #1" } }, 0);
  const card = stage.querySelector(".live-standby");
  expect(card.hidden).toBe(false);
  expect(card.querySelector(".live-standby-title").textContent).toBe("Tug of War · Cup #1");
  expect(card.querySelector(".live-standby-time").textContent).toBe("1:05");
  standby.seek(60_500);
  expect(card.querySelector(".live-standby-time").textContent).toBe("0:05");
  standby.stop();
  expect(card.hidden).toBe(true);
});
```

- [ ] **Step 2: Run them.**
  - `PYTEST tests/test_live.py tests/test_commentary_stock.py`
  - `VITEST src/live/channel.test.js`, `VITEST src/live/replay.test.js`, `VITEST src/live/shutter.test.js`, `VITEST src/format.test.js` and `VITEST src/live/standby.test.js`

  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`slots_for`** asks `book.unaired` only for an entry that is not a match: Peter and Ray's writer writes about runs.
  - **`CommentaryStock.wanted`** leaves out `is_match_id(entry.run_id)` before it slices to `depth`.
  - **`pool` and `shows`** import `all_cups` inside the function. Comment why: `cupworker` reads `SHUTTER_MS` from this module.
  - **`pool` with `now`.** Per event, take the latest cup whose `starts_at <= now`. If it has ended, add each match with a ready clip:
    - `Entry(match_id, winner's user, title, iso(revealed_at), round(seconds * 1000), clip_version(clip), title=f"{title} · Cup #{n} · {match_title}")`.
  - **`shows`** maps the order's segments to absolute slots:
    - a shutter keeps `next`;
    - a match becomes a replay slot with `run_id = match_id`, `clip = clip_version(store.clip_state(match_id)[1])` and `media: "match"`.
  - **`Programme._extend`.** The standby is the one slot of any length: it plays no frames.

```python
def _extend(self, until_ms):
    self._cursor = max(self._cursor, until_ms - HORIZON_MS - BEHIND_MS)
    claimed, shows = self._claimed(), None
    while self._cursor < until_ms:
        shows = self._cups() if shows is None else shows          # read once per extension that lays something
        show = next((s for s in shows if s.ends_ms > self._cursor), None)
        if show is not None and show.starts_ms <= self._cursor:  # inside a show: its slots at their own times
            self._slots.extend(s for s in show.slots if s["at_ms"] + s["duration_ms"] > self._cursor)
            self._cursor = show.ends_ms
            continue
        if not self._pending and not self._take_up_the_cycle():
            if show is None:
                return
            self._stand_by(show)
            continue
        made = slots_for([self._pending[0]], self._cursor, self._book, claimed)
        if show is not None and made[-1]["at_ms"] + made[-1]["duration_ms"] > show.starts_ms:
            self._stand_by(show)                                  # the entry waits for after the show
            continue
        entry = self._pending.pop(0)
        claimed |= {slot["broadcast"] for slot in made if slot["kind"] == "booth"}
        self._laid.append((self._cursor, self._cycle, entry.run_id))
        self._slots.extend(made)
        self._cursor = made[-1]["at_ms"] + made[-1]["duration_ms"]
        if not self._pending:
            self._cycle += 1

def _stand_by(self, show):
    self._slots.append({"kind": "standby", "at_ms": self._cursor, "duration_ms": show.starts_ms - self._cursor, "cup": show.standby})
    self._cursor = show.starts_ms
```

  - **Front.**
    - `channel.js` prepares a slot through one guard, `slot.media !== "match" || slot.at_ms - ms <= PREFETCH_MS`, in both the shutter branch and the playing branch. Comment why: a cup clip is served from 30 s before it airs, a video that failed to load is never loaded again, and 25 s leaves a screen's clock 5 s of slack.
    - `replay.js` loads `matchClipUrl` when `slot.media === "match"`.
    - `shutter.js`, when `next.title` is set, writes it on the event line and hides the user line.
    - `standby.js` is a card in the live's look:
      - `.live-standby`, a full-stage grid on deep ink, as `.live-card`;
      - the wordmark;
      - an eyebrow "Starting soon";
      - `.live-standby-title`, and `.live-standby-time` = `countdown(slot.duration_ms - offset)`.

      Add the styles to `stage.css` beside `.live-card`.
    - `live.js` hands the channel `segments: { replay, booth: interlude, standby }`.

- [ ] **Step 4: Run.**
  - `PYTEST tests/test_live.py tests/test_commentary_stock.py tests/test_web_app.py`
  - the five `VITEST` files above

  Expected: PASS.

- [ ] **Step 5: Commit.** "The live stands by with a countdown, airs the cup at its running order's times, then keeps its matches in rotation until the next cup"

---

### Task 12: The cup page and the home countdown

**Files:**
- Modify: `app/src/router.js`, `app/src/router.test.js`, `app/src/api.js`, `app/src/main.js`, `app/src/home.js`, `app/public/club.css`, `app/public/cards.css`
- Create: `app/src/cup.js`, `app/src/cup.test.js`

**Interfaces:**
- Produces:
  - `router.js`:
    - `#/c/<event>/<number>` parses to `{view: "cup", eventId, number}` (number a Number);
    - `#/m/<matchId>` parses to `{view: "match", matchId}`;
    - `cupHref(eventId, number)` gives `` `#/c/${eventId}/${number}` `` and `matchHref(matchId)` gives `` `#/m/${matchId}` ``;
    - `themeFor("match")` is `"race"` and `themeFor("cup")` is `"club"`.
  - `api.js`: `getCups(eventId)` and `getCup(eventId, number)`.
  - `cup.js`:
    - `cupPage(view, nowMs) -> HTMLElement`;
    - `renderCup(root, eventId, number, state)`;
    - `cupCorner(eventId, cups, nowMs) -> {text, href}`.
  - `home.js` deals a versus event's card with `corner`: an `a.sticker.sticker-lime.round-card__cup`.

- [ ] **Step 1: Write the failing tests** (`cup.test.js`, and `router.test.js` for the routes):

```js
const event = { id: "tug-of-war", title: "Tug of War", metric: "mean_hold_force" };
const four = ["Tank", "Lean", "Grip", "Sway"].map((name, i) => ({ user: `p${i}`, policy_name: name, livery: "classic", rating: 5 - i, run_id: `R${i}` }));
const open = { event, number: 1, open: 1, min_entrants: 4, state: "open", close_at: "2026-10-30T15:00:00Z",
  premiere_at: "2026-10-30T17:00:00Z", starts_at: null, entrants: four };
const done = (i, a, b) => ({ match_id: `tug-of-war-0001-00${i}`, index: i, round: i < 6 ? "group" : "final", group: i < 6 ? "A" : null,
  a, b, title: "t", reveal_at: "2026-10-30T17:00:02Z", wins: [2, 0], winner: a, bouts: [], decided_by: "bouts" });
const pairs = [[0, 3], [1, 2], [0, 2], [3, 1], [0, 1], [2, 3], [0, 1]];
const aired = { ...open, open: 2, state: "aired", starts_at: "2026-10-30T17:00:00Z", champion: 0,
  groups: [{ name: "A", table: [0, 1, 2, 3].map((entrant) => ({ entrant, played: 3, won: 3 - entrant, lost: entrant, bouts_for: 6 - 2 * entrant, bouts_against: 2 * entrant })) }],
  matches: pairs.map(([a, b], i) => done(i, a, b)) };

it("before the show: the countdown to close, the field by rating and how to enter", () => {
  const page = cupPage(open, Date.parse("2026-10-28T12:00:00Z"));
  expect(page.querySelector("h2").textContent).toBe("Tug of War Cup #1");
  expect(page.querySelector(".cup-pill").textContent).toBe("Entries open");
  expect(page.querySelector(".cup-countdown").textContent).toBe("2d 03:00:00");
  expect(page.querySelector(".cup-until").textContent).toBe("until entries close");
  const rows = page.querySelectorAll(".cup-entrant");
  expect(rows).toHaveLength(4);
  expect(rows[0].querySelector("a").getAttribute("href")).toBe("#/p/p0");
  expect(rows[0].textContent).toContain("Tank");
  expect(page.querySelector(".cup-enter").textContent).toContain("uv run publish --enter");
  expect(page.querySelector(".cup-groups")).toBeNull();
});
it("between close and the show it counts to the premiere, then says it is starting soon", () => {
  const drawn = { ...open, state: "drawn", open: 2 };
  expect(cupPage(drawn, Date.parse("2026-10-30T16:00:00Z")).querySelector(".cup-countdown").textContent).toBe("1:00:00");
  const late = cupPage(drawn, Date.parse("2026-10-30T17:05:00Z"));
  expect(late.querySelector(".cup-countdown").textContent).toBe("Starting soon");
  expect(late.querySelector(".cup-enter")).toBeNull();
  expect(late.querySelector(".cup-pill").textContent).toBe("Entries closed");
});
it("once aired: the champion, the group table, the bracket, every aired match a link", () => {
  const page = cupPage(aired, Date.parse("2026-10-30T18:00:00Z"));
  expect(page.querySelector(".cup-pill").textContent).toBe("Finished");
  expect(page.querySelector(".cup-champion").textContent).toContain("Tank");
  expect(page.querySelectorAll(".cup-group tr.cup-q")).toHaveLength(2);
  const leader = page.querySelector(".cup-group tr.cup-q").textContent;
  expect(leader).toContain("Tank");   // the policy's name
  expect(leader).toContain("@p0");    // and the player's handle
  expect(page.querySelectorAll(".cup-round")).toHaveLength(1);
  expect(page.querySelectorAll('a[href^="#/m/"]')).toHaveLength(7);
});
it("mid-show a knockout match nobody has reached says so and links nowhere", () => {
  const airing = { ...aired, state: "airing", champion: null, matches: [...aired.matches.slice(0, 6),
    { match_id: "tug-of-war-0001-006", index: 6, round: "final", group: null, a: null, b: null, title: "Final", reveal_at: "2026-10-30T17:01:12Z" }] };
  const page = cupPage(airing, Date.parse("2026-10-30T17:01:00Z"));
  expect(page.querySelector(".cup-round").textContent).toContain("To be decided");
  expect(page.querySelectorAll('a[href^="#/m/"]')).toHaveLength(6);
  expect(page.querySelector(".cup-champion")).toBeNull();
  expect(page.querySelector('a[href="#/live"]')).not.toBeNull();
});
it("the home card counts down to what comes next", () => {
  const cups = (list) => ({ next: { number: 2, close_at: "2026-11-06T15:00:00Z", premiere_at: "2026-11-06T17:00:00Z", entrants: [] }, cups: list });
  const at = (iso) => Date.parse(iso);
  expect(cupCorner("tug-of-war", cups([]), at("2026-11-04T12:00:00Z"))).toEqual({ text: "Cup #2 · in 2d 5h", href: "#/c/tug-of-war/2" });
  expect(cupCorner("tug-of-war", cups([{ number: 1, state: "airing" }]), 0).text).toBe("Cup #1 · live now");
  expect(cupCorner("tug-of-war", cups([{ number: 1, state: "ready", starts_at: "2026-10-30T17:00:00Z" }]), at("2026-10-30T16:40:00Z")).text).toBe("Cup #1 · in 20m");
  expect(cupCorner("tug-of-war", cups([{ number: 1, state: "drawn", premiere_at: "2026-10-30T17:00:00Z" }]), at("2026-10-30T17:05:00Z")).text).toBe("Cup #1 · starting soon");
  expect(cupCorner("tug-of-war", cups([{ number: 1, state: "aired" }]), at("2026-11-06T13:30:00Z")).text).toBe("Cup #2 · in 3h 30m");
});
// router.test.js
it("opens a cup and a match", () => {
  expect(parseRoute("#/c/tug-of-war/3")).toEqual({ view: "cup", eventId: "tug-of-war", number: 3 });
  expect(parseRoute("#/m/tug-of-war-0003-012")).toEqual({ view: "match", matchId: "tug-of-war-0003-012" });
  expect([cupHref("tug-of-war", 3), matchHref("tug-of-war-0003-012")]).toEqual(["#/c/tug-of-war/3", "#/m/tug-of-war-0003-012"]);
  expect([themeFor("cup"), themeFor("match")]).toEqual(["club", "race"]);
});
```

- [ ] **Step 2: Run them.** `VITEST src/cup.test.js` and `VITEST src/router.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** Follow `player.js`'s frame: the private `el()`, and `dress("cup")` before the first write. `cupPage` builds:
  - **Head:** an eyebrow with the event title; `h2` `` `${title} Cup #${n}` ``; `.cup-pill`; and the prev/next links (`Cup #n-1` when n > 1, `Cup #n+1` when n < `open`).
  - **Pills:**

    | state | pill |
    |---|---|
    | open | Entries open |
    | drawn | Entries closed |
    | ready | Ready |
    | airing | Live now |
    | aired | Finished |
    | skipped | No cup |

  - **open, drawn, ready.** A `.cup-countdown` with `countdown(target - nowMs)`, or "Starting soon" once past. The target is `close_at` when open, else `starts_at ?? premiere_at`. `.cup-until` reads "until entries close" or "until the premiere". Then the entrants as `.cup-entrant` rows: rank, `@user` linking to `playerHref`, `policy_name`, and `formatScore(rating, { metric: event.metric })`.
  - **open only.** `.cup-enter`: "How to enter: train on the tug-of-war challenge, then `uv run publish --enter`. Your latest entry is the one that counts." It links to `eventGuideHref`.
  - **skipped.** "No cup this week: fewer than {min_entrants} ducks entered."
  - **airing, aired.**
    - A `.cup-champion` banner when `champion != null`: "Champion: @user · policy, beat X 2–1 in the final".
    - `.cup-groups`: one `.cup-group` per group, a table of the duck (its policy's name, the player's `@handle` small beside it), played, W–L and bouts, the top two `tr.cup-q`, then the group's revealed matches as `matchHref` lines.
    - `.cup-bracket`: one `.cup-round` column per knockout round in index order. Each box shows both sides (policy name, `@handle` small) with their wins, the winner bold. A revealed box carries a ▶ link to `matchHref`. "To be decided" shows when `a` is null.
    - A "Watch it live" link to `liveHref` while airing.
  - **`renderCup`** fetches `getCup` and re-renders:
    - every 15 s while airing;
    - every second for the countdown;
    - once the countdown reaches zero.

    It clears its timers in `state.teardown`.
  - **`cupCorner`** uses the first of `cups.cups` in `drawn`, `ready` or `airing`, else `next`, and labels it "live now", `in Xd Yh`, `in Xh Ym`, `in Xm` (at least 1) or "starting soon".
  - **`home.js`** fetches `getCups(event.id).catch(() => null)` for `event.category === "versus"` beside the boards, then passes the sticker as `corner`.
  - **`main.js`** routes `cup` to `renderCup`, and an unknown event goes back to `#/`. The `match` route arrives with its page in Task 13.
  - **CSS.** In `club.css`, `.cup-*` placement only, from the tokens. In `cards.css`, `.round-card__cup` absolute at the top right, tilted 6°, as `.ws-running`.

- [ ] **Step 4: Run.** `VITEST src/cup.test.js`, `VITEST src/router.test.js`, `VITEST src/home.test.js` and `VITEST src/roundcard.test.js`. Expected: PASS.

- [ ] **Step 5: Commit.** "A cup page counts down to close and to the show, then shows the champion, the groups and the bracket as they air, and the home card counts down to the next cup"

---

### Task 13: The match page and the profile's cups

**Files:**
- Create: `app/src/match.js`, `app/src/match.test.js`
- Modify: `app/src/main.js`, `app/src/player.js`, `app/src/player.test.js`, `app/public/race.css`, `app/public/club.css`

**Interfaces:**
- Consumes: `getMatch`, `getBoutTrace`, `getBoutSettle`, `getMatchClip`, `matchClipUrl`, `boutLane`, `deckMarkup`, `wireDeck`, `followKeyFor` and `createViewer`.
- Produces:
  - `matchHall(match) -> HTMLElement`;
  - `boutLine(match, bout) -> string`;
  - `renderMatch(root, matchId, state)`;
  - `player.js`'s `profile()` adds a `.profile-cups` list, with `reachedLabel(reached)`.

- [ ] **Step 1: Write the failing tests.**

```js
// match.test.js
const match = { match_id: "tug-of-war-0001-008", cup: 1, round: "final", group: null, title: "Final · Tank vs Lean",
  event: { id: "tug-of-war", title: "Tug of War", rig: "legs" }, a: { user: "ann", policy_name: "Tank", name: "Tank", livery: "blue" },
  b: { user: "bob", policy_name: "Lean", name: "Lean", livery: "classic" }, wins: [2, 1], winner: "a", decided_by: "bouts", clip: "v1",
  bouts: [
    { k: 0, a_side: "west", winner: "a", how: "pit", time_s: 8.42 }, { k: 1, a_side: "east", winner: "b", how: "marker", time_s: 20 },
    { k: 2, a_side: "west", winner: null, how: "draw", time_s: 20 }, { k: 3, a_side: "east", winner: "a", how: "pit", time_s: 3.1 }] };
it("names the cup, the round and both sides, gives the score, the bouts and the clip", () => {
  const page = matchHall(match);
  expect(page.querySelector("#title").getAttribute("href")).toBe("#/c/tug-of-war/1");
  expect(page.querySelector("#title").textContent).toBe("Tug of War Cup #1");
  expect(page.querySelector(".eyebrow").textContent).toBe("Final");
  expect(page.querySelector(".match-score").textContent).toBe("2–1");
  expect(page.querySelector(".stamp").textContent).toBe("Tank wins");
  expect([...page.querySelectorAll(".match-bout")].map((b) => b.textContent)).toEqual([
    "Bout 1 · Tank wins · Lean in the pit · 8.42 s", "Bout 2 · Lean wins · the marker on their side · 20.00 s",
    "Bout 3 · a draw · 20.00 s", "Bout 4 · Tank wins · Lean in the pit · 3.10 s"]);
  expect(page.querySelector(".match-clip video").getAttribute("src")).toBe("/api/matches/tug-of-war-0001-008/clip/landscape.mp4?v=v1");
});
// player.test.js
it("lists the cups a player played and how far they went, each the way to its page", () => {
  const el = profile({ ...ann, cups: [{ event_id: "tug-of-war", event_title: "Tug of War", number: 3, starts_at: "2026-11-13T17:00:00Z", reached: "semi-final" }] });
  const cup = el.querySelector(".profile-cups a");
  expect(cup.getAttribute("href")).toBe("#/c/tug-of-war/3");
  expect(cup.textContent).toBe("Tug of War Cup #3Semi-finalist2026-11-13");
  expect(profile(ann).querySelector(".profile-cups")).toBeNull();
});
```

- [ ] **Step 2: Run them.** `VITEST src/match.test.js` and `VITEST src/player.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`matchHall`** reuses the run page's frame (`main.hall.run`, `.run-head`, `.run-top` with `deckMarkup` and `.run-score`) in an innerHTML template:
    - the eyebrow is "Group A" or the capitalised round;
    - `#title` links to `cupHref`;
    - the byline is `@a · policy vs @b · policy`, each user linking to `playerHref`;
    - `.match-score` reads `` `${wins[0]}–${wins[1]}` `` and `.stamp.stamp-pass` reads `${winner.name} wins` (on air, the duck's `name`);
    - `ol.match-bouts` holds one `button.match-bout` per bout, with `boutLine` text (ducks by `name`, as the stamp);
    - `.match-clip` holds `<video controls playsinline preload="metadata">` with the landscape URL.
  - **`renderMatch`:**
    - `getMatch`, then `dress("match")` and `signage(me)`, then the hall and `footer()`;
    - the viewer as `run.js` builds it (`followKeyFor`, `wireDeck`, `offerOrbit`), stored in `state.viewer`;
    - it plays bout 0's `boutLane`;
    - a click on a bout row fetches that bout's traces (cached by k), plays it, and marks the row `aria-current`;
    - `state.teardown` aborts pending fetches.
  - **`main.js`** routes `match` to `renderMatch`.
  - **`player.js`.** When `player.cups?.length`, add `h3.eyebrow` "Cups" and `ul.profile-results.profile-cups` with one `li > a` per cup:
    - `strong` with `` `${event_title} Cup #${number}` ``;
    - `span.mono-label` with `reachedLabel(reached)`;
    - `span.profile-date` with `starts_at.slice(0, 10)`.

    `reachedLabel` maps each value to its label:

    | reached | label |
    |---|---|
    | champion | Champion |
    | final | Finalist |
    | semi-final | Semi-finalist |
    | quarter-final | Quarter-finalist |
    | round of N | Round of N |
    | group | Group stage |
  - **CSS.** In `race.css`, `.match-bouts`, `.match-bout[aria-current]` and `.match-clip`, placed in the run page's score column.

- [ ] **Step 4: Run.** `VITEST src/match.test.js`, `VITEST src/player.test.js` and `VITEST src/run.test.js`. Expected: PASS.

- [ ] **Step 5: Commit.** "A match page plays any of its bouts in the stadium beside its clip and score, and a player's page lists the cups they played"

---

### Task 14: Suites green, then a local cup rehearsed with a fake clock

**Files:**
- Modify: whatever the rehearsal shows wrong (fix, add a test that pins it, commit).
- Scratch only: `<scratch>`, your session scratchpad written as its absolute path. Every script and store below lives there, never in the repo.

- [ ] **Step 1: Run the full suites in the foreground.**
  - The contract's two Python calls.
  - `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app && npm test`

  Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 2: Build the site.** `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus/app && npm run build`

- [ ] **Step 3: Enter four ducks into a scratch store** (four entrants: one group, six matches and a final; enough to show every page and the clip without hours of local renders).
  - **Policies.** Four exports from different trainings in `/Users/nicolasrabault/Projects/HuggingFace/microduck-challenges/.claude/worktrees/tug-of-war/logs/tug_of_war/onnx/`. Otherwise use `arena/assets/policies/BEST_alpha_walking.onnx` four times.
  - **One call per duck,** with users `nico`, `ann`, `bob`, `cat` and liveries `classic`, `charcoal`, `purple`, `blue`:

    `cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/versus && uv run --no-config --frozen arena score <onnx> --event tug-of-war --user <user> --name <name> --livery <livery> --store <scratch>/cup-store`

    Expected: a bench rating, then `recorded <run id>`.
  - **Dates.** The runs are dated today, before cup 1's close (2026-10-30T15:00Z). If today is past that, use the first cup closing after today in every time below.

- [ ] **Step 4: Run the worker with a fake clock.** Write `<scratch>/rehearse.py`:

```python
import sys
from datetime import datetime
from arena.cupworker import CupWorker, load_cup, load_entrant
from arena.manifest import load_event
from arena.store import LocalStore

store, now = LocalStore(sys.argv[1]), datetime.fromisoformat(sys.argv[2])
class Owed:
    def enqueue(self, run_id, priority=0): print("owed", run_id)
CupWorker(store, Owed(), events=[load_event("tug-of-war")], load=lambda e: load_entrant(store, e), now=lambda: now).tick()
cup = load_cup(store, "tug-of-war", 1)
print(len(cup.matches), cup.order and cup.order["starts_at"])
```

  - Run `cd …/versus && uv run --no-config --frozen python <scratch>/rehearse.py <scratch>/cup-store 2026-10-30T15:01:00+00:00`.
  - Expected: seven `owed tug-of-war-0001-00N` lines (`000`–`005` the group, `006` the final), then `7 None`. Note the wall time of the real physics.

- [ ] **Step 5: Render two match clips on this Mac, and stand in for the other five.** Two renders show all a render can get wrong; more would only cost hours.
  - **Render** `tug-of-war-0001-002` (the third match: Plan D's show rehearsal airs it) and the final `tug-of-war-0001-006` (its match page plays it). **The controller renders, not a subagent** (no subagent waits on a background run): `cd …/versus && uv run --no-config --frozen arena clip <id> --store <scratch>/cup-store`, both with `run_in_background` at once, each awaited by a Monitor until-loop on its `clip.json` (Plan A measured ~1.6 s a frame here).
  - **Expected output:** `landscape: <s> s, …`. A match of three full bouts gives 67.08 s, one won in the pit gives less.
  - **Frames to look at.** Pull them with `ffmpeg -ss <t> -i <scratch>/cup-store/clips/<id>/landscape.mp4 -frames:v 1 <scratch>/<id>-<t>.png` at the intro (1 s), mid-bout and the outro, and look at them. Check for:
    - the title card "Tug of War · Cup #1" over "<stage> · A vs B";
    - the score bug changing after each bout;
    - both ducks on the rope;
    - the "X wins 2–1" stamp.
  - **Timing.** Read the `timing.bouts` in both `clip.json`s.
  - **The five others** (`000`, `001`, `003`, `004`, `005`): `<scratch>/stub_clips.py <scratch>/cup-store` starts `arena.cli._app_on_loopback(store, reveal_all=True)`, opens each `clip.html?match=<id>&layout=landscape&frame=0` with `arena.recorder`'s `Chrome` and `_open`'s steps, reads `window.clip.plan`, saves a `Page.captureScreenshot` (`tab.send`) after `window.clip.draw(plan.frames - 30)` (look at each: both ducks, the bug, the "X wins" stamp), and stores with `put_clip` a `clip.json` alone: `{"run_id": <id>, "version": "stub", "layouts": {"landscape": {"seconds": plan.seconds, "timing": {"bouts": plan.bouts}}}}` (what the worker and Plan D's `match_footage` read; no mp4).

- [ ] **Step 6: Fix the order.** Run `rehearse.py` at `2026-10-30T15:40:00+00:00`. Expected: `7 2026-10-30T17:00:00Z`.

- [ ] **Step 7: Serve at a fake time and screenshot.** Write `<scratch>/serve_at.py`. It sets `routes_cups.now = lambda: <argv time>`, then calls `uvicorn.run(create_app(ArenaConfig.from_env(store_dir=<argv store>, dev_user="nico")), port=<argv port>)`.
  - **For each time:**
    - start it with `run_in_background`;
    - screenshot with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1440,1000 --virtual-time-budget=10000 --screenshot=<scratch>/<name>.png "http://127.0.0.1:8765/#/c/tug-of-war/1"`;
    - look at the PNG;
    - stop the server.
  - **Times:**
    - `2026-10-30T16:59:00+00:00`: the `ready` countdown, the four entrants by rating, no groups;
    - `2026-10-30T17:01:30+00:00`: airing, the first group match(es) with results and tables counting only them, the knockout "To be decided", a "Watch it live" link;
    - `2026-10-30T18:30:00+00:00`: the champion, the table, the final, seven match links;
    - at the same time, `#/m/tug-of-war-0001-006`: the final's page with the stadium, the bouts and the clip;
    - at the same time, `#/p/nico`: the cup line;
    - `2026-10-30T16:00:00+00:00`, `#/`: the tug card's corner "Cup #1 · in 1h 0m".
  - **Where they miss.** Where a screenshot misses the spec (section 5) or the Arena's look, fix it, add a test that pins the fix, re-run the files touched, and repeat the screenshot.

- [ ] **Step 8: Re-run the full suites (Step 1) and commit the fixes.** "The cup and match pages as rehearsed on a local cup: <what changed>"

- [ ] **Step 9: Report** with:
  - the compute wall time;
  - the two clips' render wall time and length;
  - the screenshot paths;
  - anything left for the owner.

---

## Spec coverage (self-review)

| Spec | Where |
|---|---|
| §4 calendar | Tasks 1–2 |
| §4 entrants and withdrawals | Tasks 5, 7 |
| §4 secret | Tasks 6–7, 9 |
| §4 draw, format, tie-breaks | Task 3 |
| §4 computation and restart | Tasks 5, 7 |
| §4 running order | Task 6 |
| §4 secrecy | Tasks 6, 9–11 |
| §4 late clips, no try limit, N+1 after N | Tasks 7–8 |
| §4 points | Task 10 |
| §5 cup page | Task 12 |
| §5 match page | Task 13 |
| §5 home countdown | Task 12 |
| §5 profile | Tasks 10, 13 |
| §6 stage 2: premiere airs the matches; matches in rotation until the next cup | Task 11 |
| §6 stage 3 (desk, play-by-play, writer) | Plan D: `show` and running-order hooks kept as the contract names them |
| Anti-goal: Mac never scores | Task 14's numbers are a rehearsal only, never published |
