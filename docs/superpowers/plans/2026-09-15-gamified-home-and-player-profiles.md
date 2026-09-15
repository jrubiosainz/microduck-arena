# Gamified Home and Player Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a Duck Jam-styled home page (global `Season standings` ladder, `Pick your round` flyers) and a `#/p/<user>` player page (avatar, points, rank, best publication per event) on top of the existing Microduck Arena, with points folded from the run log.

**Architecture:** A pure `arena/points.py` folds the append-only run log into receipts and a ranked ladder, applying the exact filter the board uses. Two read routes shape it. The vanilla-JS frontend gains a third hash view and a theme switch: Duck Jam's design system plus a `club.css` for `#/` and `#/p/`, the existing dark `race.css` for `#/e/`, both static files in `app/public/` toggled with `link.disabled`.

**Tech Stack:** Python 3.13, FastAPI, pytest; Vite 5, vanilla ES modules, vitest + jsdom; Duck Jam design CSS (Apache-2.0) and fonts (OFL).

**Spec:** `docs/superpowers/specs/2026-09-15-gamified-home-and-player-profiles-design.md`

## Global Constraints

- **Never push or deploy.** No `git push`, no `scripts/deploy_space.py`. The origin push URL is `DISABLED_no_push_to_live_space`; leave it so.
- Run Python with `uv run --frozen` so the local uv mirror config does not rewrite `uv.lock`. If `git status` shows `uv.lock` modified, `git checkout uv.lock`.
- Every commit: `git commit` with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Event pages `#/e/<id>` (`race.js`, `board.js`, `viewer.js`, …) are not modified.
- Points schedule, verbatim from the spec: `first_event` 100, `run` 10 capped at 3 per player per UTC day, `own_best` 25, `podium` 250/150/100. Podium uses `by_user` and skips `seeds_finished == 0` rows.
- Copy strings, verbatim: home eyebrows `Season standings` and `Pick your round`; flyer eyebrow `Race`; planned flyer `course not built yet`; empty ladder `Nobody has published yet.`; chip signed-out `Sign in with Hugging Face`; profile eyebrow `Player`; profile section `Best publications`; missing profile `No publication yet`.
- No dead code: `menu.js`, `menu.test.js`, `submit.js`, `submit.test.js` are deleted in Task 9.
- Commands run from the repo root `/Users/nicolasrabault/Projects/HuggingFace/microduck-arena` unless a step says `cd app`.

---

## File map

| File | Responsibility |
|---|---|
| `arena/points.py` (create) | Pure fold: counting runs → receipts → ranked cards; by-user boards per event |
| `arena/web/routes_read.py` (modify) | `GET /api/standings`, `GET /api/players/{user}`; shared `_withdrawn(store)` |
| `tests/test_points.py` (create) | Every rule of the schedule and the ladder order |
| `tests/test_routes_read.py` (modify) | The two routes, including the 404 |
| `app/public/design/` (create) | Duck Jam `tokens.css`, `effects.css`, `components.css`, `motion.css`, `fonts/` copied verbatim |
| `app/public/club.css` (create) | Page rules for home and player: body, hall, signage grid, chip, door, chapter, ladder, flyers, profile |
| `app/public/race.css` (rename from `app/src/style.css`) | The event pages' theme, unchanged content |
| `app/index.html` (modify) | Static `<link data-theme>` tags, no Google Fonts |
| `app/src/router.js` (modify) | `player` route, `playerHref`, `themeFor` |
| `app/src/api.js` (modify) | `getStandings`, `getPlayer` (null on 404) |
| `app/src/signage.js` (create) | `avatar(user)`, `chip(me)`, `signage(me)` |
| `app/src/home.js` (create) | `renderHome(root)`, `ladder(rows)`, `flyer(event, rows)` |
| `app/src/player.js` (create) | `renderPlayer(root, user)`, `profile(player)`, `noProfile(user)` |
| `app/src/main.js` (modify) | Three views, theme switch |
| `app/src/{signage,home,player}.test.js` (create), `router.test.js` (modify) | jsdom tests |

---

### Task 1: Points fold — counting runs and contribution receipts

**Files:**
- Create: `arena/points.py`
- Create: `tests/test_points.py`

**Interfaces:**
- Consumes: `arena.index.sort_key`, `arena.index.leaderboard`, `arena.index.by_user`, `arena.constants.RUNNER_VERSION`, `arena.store.RunRecord`, `tests.test_store.make_record`.
- Produces:
  - `SCHEDULE = {"first_event": 100, "run": 10, "own_best": 25, "podium": (250, 150, 100)}`, `RUNS_PER_DAY = 3`
  - `@dataclass(frozen=True) Receipt(user: str, act: str, points: int, event_id: str, run_id: str, at: str)`
  - `counting(records, withdrawn: frozenset[str], runner_version: int = RUNNER_VERSION) -> list[RunRecord]` — filtered, sorted by `(submitted_at, run_id)`
  - `receipts(records, withdrawn, runner_version=RUNNER_VERSION) -> list[Receipt]` — this task emits `first_event`, `run`, `own_best`; Task 2 adds `podium`

- [ ] **Step 1: Write the failing tests for counting, first_event, run cap and own_best**

Create `tests/test_points.py`:

```python
from arena.constants import RUNNER_VERSION
from arena.points import RUNS_PER_DAY, SCHEDULE, counting, receipts
from tests.test_store import make_record


def acts(rs, act):
    return [r for r in rs if r.act == act]


def test_counting_applies_the_boards_filter_and_orders_by_time():
    old = make_record(user="alice", runner_version=RUNNER_VERSION - 1)
    gone = make_record(user="alice", submitted_at="2026-09-03T11:00:00Z")
    late = make_record(user="alice", submitted_at="2026-09-03T12:00:00Z")
    early = make_record(user="alice", submitted_at="2026-09-03T09:00:00Z")
    kept = counting([old, gone, late, early], withdrawn=frozenset({gone.run_id}))
    assert kept == [early, late]


def test_first_publication_on_an_event_pays_once_per_event():
    a1 = make_record(user="alice", event_id="sprint-2m", submitted_at="2026-09-03T09:00:00Z")
    a2 = make_record(user="alice", event_id="sprint-2m", submitted_at="2026-09-03T10:00:00Z")
    a3 = make_record(user="alice", event_id="hill-climb-1m5", submitted_at="2026-09-03T11:00:00Z")
    firsts = acts(receipts([a2, a3, a1], frozenset()), "first_event")
    assert [(r.event_id, r.run_id, r.points) for r in firsts] == [
        ("sprint-2m", a1.run_id, SCHEDULE["first_event"]),
        ("hill-climb-1m5", a3.run_id, SCHEDULE["first_event"]),
    ]


def test_a_run_pays_ten_capped_at_three_per_utc_day_across_events():
    day = [
        make_record(user="alice", event_id="sprint-2m", submitted_at=f"2026-09-03T1{i}:00:00Z")
        for i in range(3)
    ] + [make_record(user="alice", event_id="hill-climb-1m5", submitted_at="2026-09-03T14:00:00Z")]
    tomorrow = make_record(user="alice", submitted_at="2026-09-04T08:00:00Z")
    runs = acts(receipts(day + [tomorrow], frozenset()), "run")
    assert len(runs) == RUNS_PER_DAY + 1
    assert {r.run_id for r in runs} == {d.run_id for d in day[:3]} | {tomorrow.run_id}
    assert all(r.points == SCHEDULE["run"] for r in runs)


def test_beating_your_own_best_pays_once_per_event_on_the_first_improvement():
    worse = make_record(user="alice", score=30.0, submitted_at="2026-09-03T09:00:00Z")
    better = make_record(user="alice", score=25.0, submitted_at="2026-09-03T10:00:00Z")
    same = make_record(user="alice", score=25.0, submitted_at="2026-09-03T11:00:00Z")
    best = make_record(user="alice", score=20.0, submitted_at="2026-09-03T12:00:00Z")
    own = acts(receipts([worse, better, same, best], frozenset()), "own_best")
    assert [(r.run_id, r.points) for r in own] == [(better.run_id, SCHEDULE["own_best"])]


def test_a_single_run_never_pays_own_best():
    only = make_record(user="alice")
    assert acts(receipts([only], frozenset()), "own_best") == []


def test_withdrawn_and_old_runner_runs_pay_nothing():
    gone = make_record(user="alice")
    old = make_record(user="bob", runner_version=RUNNER_VERSION - 1)
    assert receipts([gone, old], frozenset({gone.run_id})) == []


def test_receipts_carry_the_runs_own_timestamp():
    run = make_record(user="alice", submitted_at="2026-09-03T09:30:00Z")
    assert {r.at for r in receipts([run], frozenset())} == {"2026-09-03T09:30:00Z"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --frozen pytest tests/test_points.py -q`
Expected: `ModuleNotFoundError: No module named 'arena.points'`

- [ ] **Step 3: Write `arena/points.py` with counting and the three contribution acts**

```python
"""Player points, folded from the run log like the board is.

A point is a receipt for an ACT — publishing, coming back, beating yourself,
holding a podium place — priced by a flat schedule. A score never converts
into points: the board ranks policies, the ladder ranks people, and the only
place the two meet is the podium bonus, which is read off the board.

Pure and I/O-free on purpose. Nothing here is stored; every request re-derives
the ladder from the same records the board is built from, with the same
filter, so a run either counts everywhere or nowhere.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass

from .constants import RUNNER_VERSION
from .index import by_user, leaderboard, sort_key
from .store import RunRecord

# Duck Jam's own numbers for the acts that transfer to an arena that never
# closes an event: the "top three at close" bonus becomes "while you hold it".
SCHEDULE = {"first_event": 100, "run": 10, "own_best": 25, "podium": (250, 150, 100)}
RUNS_PER_DAY = 3


@dataclass(frozen=True)
class Receipt:
    user: str
    act: str
    points: int
    event_id: str
    run_id: str
    at: str


def counting(
    records, withdrawn: frozenset[str], runner_version: int = RUNNER_VERSION
) -> list[RunRecord]:
    """The runs that count, oldest first. Exactly the board's filter."""
    kept = [
        r for r in records
        if r.runner_version == runner_version and r.run_id not in withdrawn
    ]
    return sorted(kept, key=lambda r: (r.submitted_at, r.run_id))


def _receipt(record: RunRecord, act: str, points: int) -> Receipt:
    return Receipt(record.user, act, points, record.event_id, record.run_id, record.submitted_at)


def receipts(
    records, withdrawn: frozenset[str], runner_version: int = RUNNER_VERSION
) -> list[Receipt]:
    runs = counting(records, withdrawn, runner_version)
    out: list[Receipt] = []
    per_day: Counter = Counter()
    best: dict[tuple[str, str], RunRecord] = {}
    improved: set[tuple[str, str]] = set()
    for run in runs:
        key = (run.user, run.event_id)
        if key not in best:
            out.append(_receipt(run, "first_event", SCHEDULE["first_event"]))
        day = (run.user, run.submitted_at[:10])
        per_day[day] += 1
        if per_day[day] <= RUNS_PER_DAY:
            out.append(_receipt(run, "run", SCHEDULE["run"]))
        previous = best.get(key)
        if previous is not None and sort_key(run) < sort_key(previous):
            if key not in improved:
                improved.add(key)
                out.append(_receipt(run, "own_best", SCHEDULE["own_best"]))
            best[key] = run
        elif previous is None:
            best[key] = run
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --frozen pytest tests/test_points.py -q`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add arena/points.py tests/test_points.py
git commit -m "Points: fold contribution receipts from the run log

First publication per event, capped daily runs, first own-best improvement.
Same filter as the board: current runner, withdrawn runs excluded.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Points fold — podium bonus and the ladder

**Files:**
- Modify: `arena/points.py`
- Modify: `tests/test_points.py`

**Interfaces:**
- Consumes: Task 1's `receipts`, `counting`, `Receipt`, `SCHEDULE`.
- Produces:
  - `boards_by_user(records, withdrawn, runner_version=RUNNER_VERSION) -> dict[str, list[Row]]` — event id → `arena.index.leaderboard(..., entrant=by_user)` rows
  - `receipts(...)` now also emits `podium` receipts
  - `@dataclass(frozen=True) Card(rank: int, user: str, points: int)`
  - `standings(receipts: list[Receipt]) -> list[Card]` — ranked ladder

- [ ] **Step 1: Write the failing tests for podium and standings**

Change the import line at the top of `tests/test_points.py` to:

```python
from arena.points import (
    RUNS_PER_DAY, SCHEDULE, Card, boards_by_user, counting, receipts, standings,
)
```

Then append:

```python
def test_podium_pays_the_top_three_by_user_and_skips_dnf_rows():
    first = make_record(user="ann", score=20.0, submitted_at="2026-09-03T09:00:00Z")
    first_again = make_record(user="ann", score=21.0, policy_name="v2")
    second = make_record(user="bob", score=22.0)
    third = make_record(user="cid", score=23.0)
    fourth = make_record(user="dee", score=24.0)
    dnf = make_record(user="eve", score=50.0, seeds_finished=0)
    podium = acts(receipts([dnf, fourth, third, first_again, second, first], frozenset()), "podium")
    assert [(r.user, r.points, r.run_id) for r in podium] == [
        ("ann", 250, first.run_id),
        ("bob", 150, second.run_id),
        ("cid", 100, third.run_id),
    ]


def test_a_lone_dnf_is_not_a_podium():
    dnf = make_record(user="eve", score=50.0, seeds_finished=0)
    assert acts(receipts([dnf], frozenset()), "podium") == []


def test_podium_is_per_event():
    sprint = make_record(user="ann", event_id="sprint-2m")
    hill = make_record(user="ann", event_id="hill-climb-1m5")
    podium = acts(receipts([sprint, hill], frozenset()), "podium")
    assert sorted(r.event_id for r in podium) == ["hill-climb-1m5", "sprint-2m"]
    assert all(r.points == 250 for r in podium)


def test_boards_by_user_collapse_a_players_policies_to_one_row():
    v1 = make_record(user="ann", policy_name="v1", score=25.0)
    v2 = make_record(user="ann", policy_name="v2", score=20.0)
    bob = make_record(user="bob", score=22.0)
    rows = boards_by_user([v1, v2, bob], frozenset())["sprint-2m"]
    assert [(r.rank, r.record.user, r.record.run_id) for r in rows] == [
        (1, "ann", v2.run_id),
        (2, "bob", bob.run_id),
    ]


def test_standings_sum_receipts_and_rank_by_total():
    ann = make_record(user="ann", score=20.0, submitted_at="2026-09-03T09:00:00Z")
    bob = make_record(user="bob", score=22.0, submitted_at="2026-09-03T10:00:00Z")
    cards = standings(receipts([ann, bob], frozenset()))
    # ann: first_event 100 + run 10 + podium 250; bob: 100 + 10 + 150.
    assert cards == [Card(1, "ann", 360), Card(2, "bob", 260)]


def test_a_tied_total_goes_to_whoever_published_first_then_by_name():
    later = make_record(user="zed", event_id="sprint-2m", submitted_at="2026-09-03T10:00:00Z")
    earlier = make_record(user="amy", event_id="hill-climb-1m5", submitted_at="2026-09-03T09:00:00Z")
    same_time = make_record(user="bea", event_id="roller-sprint-2m",
                            submitted_at="2026-09-03T09:00:00Z")
    cards = standings(receipts([later, earlier, same_time], frozenset()))
    assert [c.user for c in cards] == ["amy", "bea", "zed"]
    assert [c.rank for c in cards] == [1, 2, 3]


def test_standings_of_nothing_is_empty():
    assert standings([]) == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --frozen pytest tests/test_points.py -q`
Expected: `ImportError: cannot import name 'Card' from 'arena.points'`

- [ ] **Step 3: Add `boards_by_user`, podium receipts, `Card` and `standings`**

In `arena/points.py`, add after `Receipt`:

```python
@dataclass(frozen=True)
class Card:
    rank: int
    user: str
    points: int


def boards_by_user(
    records, withdrawn: frozenset[str], runner_version: int = RUNNER_VERSION
) -> dict:
    """Each event's board with one row per PERSON, whatever the local board shows.

    The podium is a people's prize, so a player with three policies in the top
    three takes one place, not three.
    """
    by_event: dict[str, list[RunRecord]] = defaultdict(list)
    for run in counting(records, withdrawn, runner_version):
        by_event[run.event_id].append(run)
    return {
        event_id: leaderboard(runs, runner_version, entrant=by_user, withdrawn=withdrawn)
        for event_id, runs in by_event.items()
    }
```

Then in `receipts`, after the `for run in runs:` loop and before `return out`, add:

```python
    for rows in boards_by_user(runs, withdrawn, runner_version).values():
        finishers = [row for row in rows if row.record.seeds_finished > 0]
        for row, points in zip(finishers, SCHEDULE["podium"]):
            out.append(_receipt(row.record, "podium", points))
```

And add at the end of the file:

```python
def standings(receipts: list[Receipt]) -> list[Card]:
    """One card per player: the total, ranked. Ties go to who published first."""
    points: Counter = Counter()
    since: dict[str, str] = {}
    for receipt in receipts:
        points[receipt.user] += receipt.points
        since[receipt.user] = min(since.get(receipt.user, receipt.at), receipt.at)
    order = sorted(points, key=lambda user: (-points[user], since[user], user))
    return [Card(rank, user, points[user]) for rank, user in enumerate(order, 1)]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --frozen pytest tests/test_points.py -q`
Expected: `14 passed`

- [ ] **Step 5: Run the whole Python suite to make sure nothing else moved**

Run: `uv run --frozen pytest -q`
Expected: all passed (the pre-existing count plus 14)

- [ ] **Step 6: Commit**

```bash
git add arena/points.py tests/test_points.py
git commit -m "Points: live podium bonus and the ranked ladder

250/150/100 to the first three finishers of each event's by-user board, held
while the place is held. Standings sum receipts; ties go to who published first.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: API — `/api/standings` and `/api/players/{user}`

**Files:**
- Modify: `arena/web/routes_read.py`
- Modify: `tests/test_routes_read.py`

**Interfaces:**
- Consumes: Task 2's `receipts`, `standings`, `boards_by_user`; `arena.manifest.all_events`.
- Produces:
  - `GET /api/standings` → `{"rows": [{"rank", "user", "points"}]}`
  - `GET /api/players/{user}` → `{"user", "points", "rank", "best": [{"event_id", "event_title", "rank", "score", "seeds_finished", "seeds_total", "policy_name", "run_id", "submitted_at"}]}`; 404 with `detail` when the player has no counting run

- [ ] **Step 1: Write the failing route tests**

Append to `tests/test_routes_read.py`:

```python
def test_standings_rank_every_player_who_published(client):
    api, app = client
    record_run(app, user="ann", score=20.0, submitted_at="2026-09-03T09:00:00Z")
    record_run(app, user="bob", score=22.0, submitted_at="2026-09-03T10:00:00Z")
    rows = api.get("/api/standings").json()["rows"]
    # ann: first_event 100 + run 10 + podium 250; bob: 100 + 10 + 150.
    assert rows == [
        {"rank": 1, "user": "ann", "points": 360},
        {"rank": 2, "user": "bob", "points": 260},
    ]


def test_standings_are_empty_before_anyone_publishes(client):
    api, _ = client
    assert api.get("/api/standings").json() == {"rows": []}


def test_a_player_page_carries_points_rank_and_the_best_run_per_event(client):
    api, app = client
    slow = record_run(app, user="ann", event_id="sprint-2m", score=30.0,
                      policy_name="v1", submitted_at="2026-09-03T09:00:00Z")
    fast = record_run(app, user="ann", event_id="sprint-2m", score=20.0,
                      policy_name="v2", submitted_at="2026-09-03T10:00:00Z")
    hill = record_run(app, user="ann", event_id="hill-climb-1m5", score=40.0,
                      submitted_at="2026-09-03T11:00:00Z")
    record_run(app, user="bob", event_id="hill-climb-1m5", score=35.0,
               submitted_at="2026-09-03T12:00:00Z")

    body = api.get("/api/players/ann").json()
    assert body["user"] == "ann"
    assert body["rank"] == 1
    # sprint: first 100 + runs 10+10 + own_best 25 + podium 250; hill: first 100 + run 10 + podium 150.
    assert body["points"] == 655
    assert [(b["event_id"], b["rank"], b["run_id"]) for b in body["best"]] == [
        ("sprint-2m", 1, fast.run_id),
        ("hill-climb-1m5", 2, hill.run_id),
    ]
    sprint = body["best"][0]
    assert sprint["event_title"] == "2 m Sprint"
    assert sprint["policy_name"] == "v2"
    assert sprint["score"] == 20.0
    assert sprint["seeds_finished"] == 5
    assert sprint["seeds_total"] == 1
    assert sprint["submitted_at"] == "2026-09-03T10:00:00Z"
    assert slow.run_id not in {b["run_id"] for b in body["best"]}


def test_a_player_with_no_publication_is_404(client):
    api, _ = client
    response = api.get("/api/players/nobody")
    assert response.status_code == 404
    assert "nobody" in response.json()["detail"]


def test_a_withdrawn_run_leaves_the_player_page_and_the_ladder(client):
    api, app = client
    from arena.store import Withdrawal
    run = record_run(app, user="ann")
    app.state.store.withdraw(Withdrawal(run_id=run.run_id, event_id="sprint-2m", user="ann",
                                        withdrawn_at="2026-09-03T12:00:00Z"))
    assert api.get("/api/standings").json() == {"rows": []}
    assert api.get("/api/players/ann").status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --frozen pytest tests/test_routes_read.py -q -k "standings or player"`
Expected: 5 failed — `/api/standings` and `/api/players/…` do not exist yet, so they answer FastAPI's default 404 `Not Found`, which has no `rows` and does not name `nobody`.

- [ ] **Step 3: Add the routes**

In `arena/web/routes_read.py`, change the import block to add the fold:

```python
from ..index import leaderboard
from ..manifest import Manifest, ManifestError, all_events, load_event
from ..points import boards_by_user, receipts, standings
from ..store import RunRecord
from ..trace import decode
```

Add two helpers right after `_event_or_404`:

```python
def _withdrawn(store) -> frozenset[str]:
    return frozenset(w.run_id for w in store.withdrawals())


def _all_runs(store) -> list[RunRecord]:
    """Every event's log, because points and ladders are across the programme."""
    return [record for manifest in all_events() for record in store.runs(manifest.id)]
```

In `event_leaderboard`, replace `withdrawn=frozenset(w.run_id for w in store.withdrawals()),` with `withdrawn=_withdrawn(store),`.

Then add, after `event_leaderboard`:

```python
@router.get("/standings")
def player_standings(request: Request) -> dict:
    """One ladder across every event: the sum of each player's receipts, ranked."""
    store = request.app.state.store
    cards = standings(receipts(_all_runs(store), _withdrawn(store)))
    return {"rows": [{"rank": c.rank, "user": c.user, "points": c.points} for c in cards]}


@router.get("/players/{user}")
def player_page(user: str, request: Request) -> dict:
    """A player's total, rank, and best run on every event they entered."""
    store = request.app.state.store
    runs, withdrawn = _all_runs(store), _withdrawn(store)
    card = next((c for c in standings(receipts(runs, withdrawn)) if c.user == user), None)
    if card is None:
        raise HTTPException(status_code=404, detail=f"{user!r} has not published yet")
    boards = boards_by_user(runs, withdrawn)
    best = []
    for manifest in sorted(all_events(), key=lambda m: (m.order, m.title)):
        row = next((r for r in boards.get(manifest.id, []) if r.record.user == user), None)
        if row is None:
            continue
        best.append({
            "event_id": manifest.id,
            "event_title": manifest.title,
            "rank": row.rank,
            "score": row.record.score,
            "seeds_finished": row.record.seeds_finished,
            "seeds_total": len(row.record.per_seed),
            "policy_name": row.record.policy_name,
            "run_id": row.record.run_id,
            "submitted_at": row.record.submitted_at,
        })
    return {"user": user, "points": card.points, "rank": card.rank, "best": best}
```

- [ ] **Step 4: Run the route tests and the full suite**

Run: `uv run --frozen pytest tests/test_routes_read.py -q && uv run --frozen pytest -q`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_read.py tests/test_routes_read.py
git commit -m "API: player standings and player pages

GET /api/standings ranks everyone who published; GET /api/players/{user}
carries points, rank and the best run per event, 404 for nobody.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — two themes as static stylesheets

**Files:**
- Create: `app/public/design/` (copied from Duck Jam)
- Create: `app/public/club.css`
- Rename: `app/src/style.css` → `app/public/race.css`
- Modify: `app/index.html`
- Modify: `app/src/router.js`, `app/src/router.test.js`

**Interfaces:**
- Consumes: Duck Jam files at `/Users/nicolasrabault/Projects/HuggingFace/duckJam/design/`.
- Produces:
  - `<link rel="stylesheet" data-theme="club|race">` tags in `index.html`
  - `router.js`: `parseRoute(hash)` also returns `{view: "player", user}`; `playerHref(user)`; `themeFor(view) -> "race" | "club"`
  - CSS classes for Tasks 6–8: `.hall`, `.signage`, `.club-brand`, `.club-duck`, `.site-nav`, `.profile-chip`, `.avatar`, `.door`, `.hero`, `.lede`, `.chapter`, `.ladders`, `.ladder`, `.ladder-row`, `.ladder-rank`, `.ladder-shell`, `.ladder-shell-{cream,graphite,lavender,sky}`, `.ladder-name`, `.ladder-points`, `.ladder-empty`, `.cabinets`, `.challenge-note`, `.challenge-note--planned`, `.challenge-link`, `.challenge-art`, `.challenge-facts`, `.challenge-standing`, `.challenge-star`, `.profile`, `.profile-header`, `.profile-duck`, `.profile-summary`, `.profile-results`, `.profile-empty`, `.failed`

- [ ] **Step 1: Write the failing router tests**

Replace the contents of `app/src/router.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { menuHref, parseRoute, playerHref, raceHref, themeFor } from "./router.js";

describe("parseRoute", () => {
  it("shows the home page by default", () => {
    for (const hash of ["", "#", "#/", undefined, null]) {
      expect(parseRoute(hash)).toEqual({ view: "menu" });
    }
  });

  it("opens one race", () => {
    expect(parseRoute("#/e/sprint-2m")).toEqual({ view: "race", eventId: "sprint-2m" });
    expect(parseRoute("#/e/hill-climb-1m5/")).toEqual({
      view: "race",
      eventId: "hill-climb-1m5",
    });
  });

  it("opens one player", () => {
    expect(parseRoute("#/p/cdeplanne")).toEqual({ view: "player", user: "cdeplanne" });
    expect(parseRoute("#/p/a.b-c_d/")).toEqual({ view: "player", user: "a.b-c_d" });
  });

  it("falls back to the home page for anything it does not recognise", () => {
    for (const hash of ["#/nonsense", "#/e/", "#/e/bad id", "#/e/a/b", "#/p/", "#/p/a/b"]) {
      expect(parseRoute(hash)).toEqual({ view: "menu" });
    }
  });

  it("builds the links it parses", () => {
    expect(parseRoute(raceHref("sprint-2m"))).toEqual({ view: "race", eventId: "sprint-2m" });
    expect(parseRoute(playerHref("cdeplanne"))).toEqual({ view: "player", user: "cdeplanne" });
    expect(parseRoute(menuHref)).toEqual({ view: "menu" });
  });
});

describe("themeFor", () => {
  it("dresses races in the trackside theme and everything else as the club", () => {
    expect(themeFor("race")).toBe("race");
    expect(themeFor("menu")).toBe("club");
    expect(themeFor("player")).toBe("club");
  });
});
```

- [ ] **Step 2: Run the router tests to verify they fail**

Run: `cd app && npx vitest run src/router.test.js`
Expected: FAIL — `playerHref` and `themeFor` are not exported

- [ ] **Step 3: Extend the router**

Replace `app/src/router.js` with:

```js
// Three views, addressed by hash so the browser's own back button works and
// "back to the races" is an ordinary link rather than a piece of state.

const SEGMENT = "([A-Za-z0-9._-]+)";
const RACE = new RegExp(`^/e/${SEGMENT}/?$`);
const PLAYER = new RegExp(`^/p/${SEGMENT}/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const race = path.match(RACE);
  if (race) return { view: "race", eventId: race[1] };
  const player = path.match(PLAYER);
  if (player) return { view: "player", user: player[1] };
  return { view: "menu" };
}

export const raceHref = (eventId) => `#/e/${eventId}`;
export const playerHref = (user) => `#/p/${user}`;
export const menuHref = "#/";

/**
 * Which stylesheet set a view wears. The race pages keep their dark trackside
 * board; the home and player pages are the club, in Duck Jam's paper and ink.
 * The two sets define `--ink` and `--paper` with opposite meanings, so only
 * one is ever enabled.
 */
export const themeFor = (view) => (view === "race" ? "race" : "club");
```

- [ ] **Step 4: Run the router tests to verify they pass**

Run: `cd app && npx vitest run src/router.test.js`
Expected: PASS

- [ ] **Step 5: Copy the Duck Jam design system and move the race theme**

```bash
mkdir -p app/public/design
D=/Users/nicolasrabault/Projects/HuggingFace/duckJam/design
cp "$D/tokens.css" "$D/effects.css" "$D/components.css" "$D/motion.css" app/public/design/
cp -R "$D/fonts" app/public/design/fonts
git mv app/src/style.css app/public/race.css
ls app/public/design app/public/design/fonts
```

Expected listing: the four `.css` files, and in `fonts/` four `.woff2` plus `Anton-OFL.txt` and `DMSans-OFL.txt`.

- [ ] **Step 6: Write `app/public/club.css`**

```css
/* The club: the home and player pages, in Duck Jam's paper and ink.
 *
 * Every colour, size and face is a token from design/tokens.css; every object
 * (eyebrow, mono label, signage, sticker, flyer tape and title, marquee title)
 * is design/components.css's. This file only places them. It is enabled on
 * the club views and disabled on the race pages, which wear race.css instead:
 * the two sets define --ink and --paper with opposite meanings. */

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--body);
  font-size: var(--type-body-size);
  line-height: var(--type-body-line);
  overflow-x: hidden;
}

.hall {
  position: relative;
  max-width: var(--space-content-column);
  margin: 0 auto;
  padding: var(--space-gutter-max) var(--space-gutter-min);
  flex: 1;
  width: 100%;
}

.failed { padding: var(--space-gutter-max); color: var(--orange-inked); }

/* ── Signage: the brand left, the player top-right ─────────────────────────── */

.signage { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
.club-brand { display: flex; align-items: center; gap: 12px; }
.club-brand .mono-label { display: block; }
.club-duck { width: 52px; height: 52px; object-fit: contain; }
.signage-title a { color: inherit; text-decoration: none; }
.site-nav { display: flex; align-items: center; gap: var(--space-gutter-min); }

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px 4px 4px;
  border: 2px solid var(--paper);
  background: var(--ink);
  color: var(--paper);
  text-decoration: none;
  font-family: var(--type-sticker-family);
  font-size: 1rem;
  letter-spacing: var(--type-sticker-tracking);
  text-transform: uppercase;
}
.profile-chip:hover { background: var(--deep-ink); }
.profile-chip:focus-visible, .ladder-row:focus-visible, .challenge-link:focus-visible,
.profile-results a:focus-visible { outline: 3px solid var(--cyan); outline-offset: 3px; }

/* The Hub's picture when it has one, a duck on lavender when it does not. */
.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border: 2px solid var(--ink);
  background: var(--lavender);
  font-size: 22px;
  line-height: 1;
}
.avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }

/* ── Door: the hero over the hall ──────────────────────────────────────────── */

.door { padding: 0 0 var(--space-gutter-max); }

.hero {
  margin: 4px 0 0;
  max-width: 14ch;
  font-family: var(--type-hero-title-family);
  font-weight: var(--type-hero-title-weight);
  font-size: var(--type-section-title-size);
  line-height: var(--type-hero-title-line);
  letter-spacing: var(--type-hero-title-tracking);
  text-transform: uppercase;
}

.lede {
  max-width: 62ch;
  margin: var(--space-gutter-min) 0 0;
  font-family: var(--type-lede-family);
  font-size: var(--type-lede-size);
  line-height: var(--type-lede-line);
}

.chapter { margin-top: var(--space-gutter-max); }
.chapter > .eyebrow { margin-bottom: var(--space-gutter-min); }

/* ── Ladder: one rung per player ───────────────────────────────────────────── */

.ladders {
  max-width: 640px;
  background: var(--warm-paper);
  border: 3px solid var(--ink);
  box-shadow: 5px 5px 0 var(--ink);
  color: var(--ink);
}

.ladder-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: var(--space-gutter-min);
  padding: 12px var(--space-card-padding-min);
  border-top: 3px solid var(--ink);
  color: inherit;
  text-decoration: none;
}
.ladder > .ladder-row:first-child { border-top: 0; }
.ladder-row:hover { background: var(--cream); }

.ladder-rank, .ladder-points {
  font-family: var(--type-card-title-family);
  font-weight: var(--type-card-title-weight);
  font-size: var(--type-card-title-size);
  line-height: var(--type-card-title-line);
  letter-spacing: var(--type-card-title-tracking);
}
.ladder-rank { min-width: 2ch; }

.ladder-shell { width: 14px; height: 14px; border: 2px solid var(--ink); }
.ladder-shell-cream { background: var(--cream); }
.ladder-shell-graphite { background: var(--graphite); }
.ladder-shell-lavender { background: var(--lavender); }
.ladder-shell-sky { background: var(--sky); }

.ladder-name { font-weight: 600; overflow-wrap: anywhere; }
.ladder-empty { margin: 0; padding: 12px var(--space-card-padding-min); }

/* ── Flyers: one per event, taped up crooked ───────────────────────────────── */

.cabinets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--space-grid-wide)), 1fr));
  gap: var(--space-gutter-max);
  align-items: stretch;
  margin-top: var(--space-gutter-min);
}

.challenge-note {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--space-card-padding-min);
  border: 2px solid var(--ink);
  background: var(--yellow);
  box-shadow: 5px 5px 0 var(--ink);
  rotate: -1deg;
}
.challenge-note:nth-child(2n) { rotate: 1deg; }
.challenge-note:nth-child(3n + 2) { background: var(--sky); }
.challenge-note:nth-child(3n) { background: var(--cream); }
.challenge-note--planned { background: var(--warm-paper); color: var(--ink-70); }

.challenge-link {
  display: block;
  flex: 1;
  color: inherit;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.challenge-link .eyebrow { color: var(--ink); }

/* The frame keeps the still's 480×198 shape so nothing moves when it lands. */
.challenge-art {
  display: block;
  width: 100%;
  aspect-ratio: 480 / 198;
  margin-top: var(--space-gutter-min);
  border: 2px solid var(--ink);
  background: var(--deep-ink);
  overflow: hidden;
}
.challenge-art img { display: block; width: 100%; height: 100%; object-fit: cover; }

.challenge-facts { margin: var(--space-gutter-min) 0 0; }
.challenge-standing {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  font-family: var(--type-mono-label-family);
  font-weight: var(--type-mono-label-weight);
  font-size: 0.85rem;
  letter-spacing: 0.08em;
}
.challenge-star { width: 18px; height: 18px; }

@media (prefers-reduced-motion: no-preference) {
  .challenge-note { transition: transform 160ms ease; }
  .challenge-note:has(.challenge-link):hover { transform: translateY(-3px); }
}

/* ── Profile: a paper scrapbook ────────────────────────────────────────────── */

.profile { max-width: 1100px; margin-inline: auto; }
.profile-header { display: flex; align-items: center; gap: clamp(1rem, 4vw, 3rem); }
.profile-header > div { min-width: 0; flex: 1; }
.profile-header .marquee-title { margin: 0; overflow-wrap: anywhere; }
.profile-duck {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: clamp(4rem, 12vw, 8rem);
  aspect-ratio: 1;
  font-size: clamp(2.5rem, 8vw, 5rem);
  background: var(--lavender);
  border: 3px solid var(--ink);
  box-shadow: var(--shadow-card-min) var(--shadow-card-min) 0 var(--ink);
}
.profile-duck .avatar { width: 100%; height: 100%; border: 0; font-size: inherit; }

.profile-summary { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; margin-block: 1.5rem; }
.profile-summary .sticker { font-size: clamp(1.1rem, 3vw, 1.8rem); cursor: default; }
.profile-summary .sticker:active {
  translate: none;
  box-shadow: var(--shadow-sticker-min) var(--shadow-sticker-min) var(--shadow-blur) var(--ink);
}

.profile-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 1rem;
}
.profile-results li { min-width: 0; }
.profile-results a {
  display: grid;
  gap: 0.75rem;
  height: 100%;
  padding: 1.25rem;
  background: var(--paper);
  border: 3px solid var(--ink);
  box-shadow: 4px 4px 0 var(--ink);
  color: var(--ink);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.profile-results strong { font-size: 1.25rem; }
.profile-results a:hover { background: var(--warm-paper); }
.profile-empty a { color: var(--orange-inked); }

@media (max-width: 640px) {
  .signage { padding: 14px var(--space-gutter-min); gap: var(--space-gutter-min); }
  .club-duck { width: 36px; height: 36px; }
  .club-brand .mono-label { max-width: 16ch; }
}
```

- [ ] **Step 7: Rewrite `app/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Microduck Arena</title>
    <link rel="icon" href="/duck-head-mark.webp" />
    <!-- Two themes, one enabled at a time by main.js: the club (Duck Jam's
         design system, for the home and player pages) and the trackside board
         (for the races). They are static files on purpose — Vite would fold a
         src/ stylesheet into the bundle and drop the data-theme attribute the
         switch relies on. Anton and DM Sans are self-hosted by tokens.css. -->
    <link rel="stylesheet" href="/design/tokens.css" data-theme="club" />
    <link rel="stylesheet" href="/design/effects.css" data-theme="club" />
    <link rel="stylesheet" href="/design/components.css" data-theme="club" />
    <link rel="stylesheet" href="/design/motion.css" data-theme="club" />
    <link rel="stylesheet" href="/club.css" data-theme="club" />
    <link rel="stylesheet" href="/race.css" data-theme="race" disabled />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 8: Build and check the links survive**

Run: `cd app && npm run build && grep -c 'data-theme' dist/index.html && grep -c 'fonts.googleapis' dist/index.html; rm -rf dist`
Expected: `6` then `0` (the second grep exits 1 on zero matches, which is fine)

- [ ] **Step 9: Commit**

```bash
git add app/index.html app/public app/src/router.js app/src/router.test.js
git commit -m "Frontend: two themes as static stylesheets, and a player route

Duck Jam's design system and a club.css for the home and player pages, the
trackside board renamed race.css; main.js will enable one set per view.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Note: the app will not render correctly until Task 9 wires `main.js`; `race.css` is disabled by default and nothing enables it yet. That is expected mid-plan.

---

### Task 5: API client — standings and players

**Files:**
- Modify: `app/src/api.js`
- Modify: `app/src/api.test.js`

**Interfaces:**
- Produces: `getStandings() -> Promise<row[]>` (the `rows` array); `getPlayer(user) -> Promise<player | null>` — `null` on 404, throws on other errors.

- [ ] **Step 1: Write the failing tests**

`app/src/api.test.js` already stubs fetch with a `respondWith({ ok, status, statusText, body })` helper and restores it in `afterEach`. Change its second import line to `import { getLeaderboard, getPlayer, getStandings, getTrace } from "./api.js";` and append:

```js
describe("standings and players", () => {
  it("returns the ladder rows", async () => {
    respondWith({ body: { rows: [{ rank: 1, user: "ann", points: 360 }] } });
    expect(await getStandings()).toEqual([{ rank: 1, user: "ann", points: 360 }]);
    expect(fetch).toHaveBeenCalledWith("/api/standings");
  });

  it("returns a player", async () => {
    respondWith({ body: { user: "ann", points: 360, rank: 1, best: [] } });
    expect(await getPlayer("ann")).toEqual({ user: "ann", points: 360, rank: 1, best: [] });
    expect(fetch).toHaveBeenCalledWith("/api/players/ann");
  });

  it("returns null when nobody by that name has published", async () => {
    respondWith({ ok: false, status: 404, body: { detail: "'nobody' has not published yet" } });
    expect(await getPlayer("nobody")).toBeNull();
  });

  it("still surfaces any other failure as the server's sentence", async () => {
    respondWith({ ok: false, status: 500, body: { detail: "store unreadable" } });
    await expect(getPlayer("ann")).rejects.toThrow("store unreadable");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/api.test.js`
Expected: FAIL — `getStandings` / `getPlayer` are not exported

- [ ] **Step 3: Add the two calls to `app/src/api.js`**

After `export const getRun = …`, add:

```js
export const getStandings = () => json("/api/standings").then((b) => b.rows);

/** One player's page, or null when nobody by that name has published. */
export async function getPlayer(user) {
  const response = await fetch(`/api/players/${encodeURIComponent(user)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/api.js app/src/api.test.js
git commit -m "Frontend: standings and player API calls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Signage — avatar, player chip, header

**Files:**
- Create: `app/src/signage.js`
- Create: `app/src/signage.test.js`

**Interfaces:**
- Consumes: `session.js`'s `signInHref()`, `router.js`'s `playerHref`, `menuHref`.
- Produces:
  - `avatar(user) -> HTMLElement` — `span.avatar` holding an `img` from `https://huggingface.co/api/avatars/<user>`; on the image's `error` event the `img` is replaced by a `🦆` text node
  - `chip(me) -> HTMLElement` — `a.profile-chip` when `me?.signed_in`, `a.sticker.sticker-lavender` "Sign in with Hugging Face" when `me` is signed out, an empty `span` when `me` is `null`
  - `signage(me) -> HTMLElement` — `header.signage` with `.club-brand` (duck, `h1.signage-title > a[href="#/"]` "Microduck Arena", `span.mono-label` "Race on a clock you can trust") and `nav.site-nav` holding `chip(me)`

- [ ] **Step 1: Write the failing tests**

Create `app/src/signage.test.js`:

```js
import { describe, expect, it } from "vitest";
import { avatar, chip, signage } from "./signage.js";

describe("avatar", () => {
  it("asks the Hub for the user's picture", () => {
    const img = avatar("cdeplanne").querySelector("img");
    expect(img.getAttribute("src")).toBe("https://huggingface.co/api/avatars/cdeplanne");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to a duck when the Hub has no picture", () => {
    const el = avatar("local");
    el.querySelector("img").dispatchEvent(new Event("error"));
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("🦆");
  });

  it("escapes the handle in the URL", () => {
    expect(avatar("a b").querySelector("img").getAttribute("src")).toContain("a%20b");
  });
});

describe("chip", () => {
  it("links a signed-in player to their page, with picture and name", () => {
    const el = chip({ signed_in: true, user: "cdeplanne", oauth_enabled: true });
    expect(el.matches("a.profile-chip")).toBe(true);
    expect(el.getAttribute("href")).toBe("#/p/cdeplanne");
    expect(el.querySelector(".avatar img")).not.toBeNull();
    expect(el.textContent).toContain("cdeplanne");
  });

  it("offers sign-in when signed out", () => {
    const el = chip({ signed_in: false, user: null, oauth_enabled: true });
    expect(el.matches("a.sticker")).toBe(true);
    expect(el.textContent).toBe("Sign in with Hugging Face");
    expect(el.getAttribute("href")).toMatch(/^\/login/);
  });

  it("renders nothing when the server could not be reached", () => {
    const el = chip(null);
    expect(el.textContent).toBe("");
    expect(el.querySelector("a")).toBeNull();
  });
});

describe("signage", () => {
  it("names the arena, links home, and seats the chip top-right", () => {
    const el = signage({ signed_in: true, user: "ann", oauth_enabled: false });
    expect(el.matches("header.signage")).toBe(true);
    expect(el.querySelector("h1.signage-title a").getAttribute("href")).toBe("#/");
    expect(el.querySelector("h1").textContent).toBe("Microduck Arena");
    expect(el.querySelector(".club-brand img.club-duck")).not.toBeNull();
    expect(el.querySelector("nav.site-nav .profile-chip")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/signage.test.js`
Expected: FAIL — cannot resolve `./signage.js`

- [ ] **Step 3: Write `app/src/signage.js`**

```js
// The strip over the door: the arena's name on the left, the player on the
// right. Shared by the home and player pages; the race pages keep their own.

import { menuHref, playerHref } from "./router.js";
import { signInHref } from "./session.js";

/**
 * The Hub's picture for a handle, or a duck.
 *
 * The server keeps only the username, so the picture is asked of the Hub
 * directly by handle — nothing to store, nothing to go stale. A handle the Hub
 * does not know (the local dev user, say) answers 404, and the duck stands in.
 */
export function avatar(user) {
  const box = document.createElement("span");
  box.className = "avatar";
  const img = document.createElement("img");
  img.src = `https://huggingface.co/api/avatars/${encodeURIComponent(user)}`;
  img.alt = "";
  // setAttribute, not the property: jsdom does not reflect referrerPolicy.
  img.setAttribute("referrerpolicy", "no-referrer");
  img.addEventListener("error", () => img.replaceWith("🦆"), { once: true });
  box.append(img);
  return box;
}

/**
 * Who you are, top-right. Signed in: your page. Signed out: the door in.
 * `me` is null when /api/me could not be reached, and then there is nothing
 * honest to show — a sign-in link to a server that is not answering is worse
 * than a blank.
 */
export function chip(me) {
  if (!me) return document.createElement("span");
  if (!me.signed_in) {
    const link = document.createElement("a");
    link.className = "sticker sticker-lavender";
    link.href = signInHref();
    link.textContent = "Sign in with Hugging Face";
    return link;
  }
  const link = document.createElement("a");
  link.className = "profile-chip";
  link.href = playerHref(me.user);
  const name = document.createElement("span");
  name.textContent = me.user;
  link.append(avatar(me.user), name);
  return link;
}

export function signage(me) {
  const header = document.createElement("header");
  header.className = "signage";

  const brand = document.createElement("div");
  brand.className = "club-brand";
  const duck = document.createElement("img");
  duck.className = "club-duck";
  duck.src = "/duck-head-mark.webp";
  duck.alt = "";
  const words = document.createElement("div");
  const title = document.createElement("h1");
  title.className = "signage-title";
  const home = document.createElement("a");
  home.href = menuHref;
  home.textContent = "Microduck Arena";
  title.append(home);
  const line = document.createElement("span");
  line.className = "mono-label";
  line.textContent = "Race on a clock you can trust";
  words.append(title, line);
  brand.append(duck, words);

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Player");
  nav.append(chip(me));

  header.append(brand, nav);
  return header;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/signage.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/signage.js app/src/signage.test.js
git commit -m "Frontend: signage with the player chip and Hub avatar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Home page — ladder and flyers

**Files:**
- Create: `app/src/home.js`
- Create: `app/src/home.test.js`

**Interfaces:**
- Consumes: `api.js` `getEvents`, `getLeaderboard`, `getStandings`, `getMe`; `signage.js` `signage`; `thumbnail.js` `renderThumbnails(events) -> Map<eventId, url>`; `format.js` `formatEventFacts`, `formatScore`; `router.js` `raceHref`, `playerHref`.
- Produces:
  - `ladder(rows) -> HTMLElement` — `div.ladders > div.ladder` with one `a.ladder-row[href=#/p/<user>]` per row (`span.ladder-rank`, `span.ladder-shell.ladder-shell-<shell>`, `span.ladder-name` "@user", `span.ladder-points` "N PTS"); empty → `p.ladder-empty` "Nobody has published yet."
  - `flyer(event, rows) -> HTMLElement` — `article.challenge-note`; open: `a.challenge-link[href=#/e/<id>]`; planned: `div.challenge-link` with `.challenge-note--planned` on the article; always a `.challenge-art` frame, `h4.flyer-title`, `p.challenge-facts`, `p.challenge-standing`
  - `renderHome(root) -> Promise<void>`
  - `shellOf(user) -> "cream" | "graphite" | "lavender" | "sky"`

- [ ] **Step 1: Write the failing tests**

Create `app/src/home.test.js`:

```js
import { describe, expect, it } from "vitest";
import { flyer, ladder, shellOf } from "./home.js";

const open = {
  id: "sprint-2m", title: "2 m Sprint", status: "open", rig: "legs", length_m: 2, slope_deg: 0,
  sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
};
const planned = { ...open, id: "best-jump", title: "Best Jump", status: "planned" };
const held = [{ user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 }];

describe("the ladder", () => {
  it("hangs one rung per player, linking to their page", () => {
    const el = ladder([
      { rank: 1, user: "ann", points: 360 },
      { rank: 2, user: "bob", points: 260 },
    ]);
    const rows = [...el.querySelectorAll("a.ladder-row")];
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["#/p/ann", "#/p/bob"]);
    expect(rows[0].querySelector(".ladder-rank").textContent).toBe("1");
    expect(rows[0].querySelector(".ladder-name").textContent).toBe("@ann");
    expect(rows[0].querySelector(".ladder-points").textContent).toBe("360 PTS");
    expect(rows[0].querySelector(".ladder-shell").className).toMatch(/ladder-shell-(cream|graphite|lavender|sky)/);
  });

  it("says so when nobody has published", () => {
    const el = ladder([]);
    expect(el.querySelector("a.ladder-row")).toBeNull();
    expect(el.querySelector(".ladder-empty").textContent).toBe("Nobody has published yet.");
  });
});

describe("shellOf", () => {
  it("is stable per name and one of the four shells", () => {
    expect(shellOf("ann")).toBe(shellOf("ann"));
    for (const user of ["ann", "bob", "cid", "dee", "eve"]) {
      expect(["cream", "graphite", "lavender", "sky"]).toContain(shellOf(user));
    }
  });
});

describe("an open event's flyer", () => {
  it("links into the race and names it", () => {
    const el = flyer(open, held);
    expect(el.matches("article.challenge-note")).toBe(true);
    expect(el.querySelector("a.challenge-link").getAttribute("href")).toBe("#/e/sprint-2m");
    expect(el.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
    expect(el.querySelector(".eyebrow").textContent).toBe("Race");
  });

  it("leaves the art frame empty until the still lands", () => {
    const frame = flyer(open, held).querySelector(".challenge-art");
    expect(frame).not.toBeNull();
    expect(frame.childElementCount).toBe(0);
  });

  it("states the course facts without the sweep", () => {
    expect(flyer(open, held).querySelector(".challenge-facts").textContent).toBe("2 m · flat · legs");
  });

  it("shows who holds it and in what time", () => {
    const standing = flyer(open, held).querySelector(".challenge-standing");
    expect(standing.querySelector(".challenge-star")).not.toBeNull();
    expect(standing.textContent).toContain("cdeplanne");
    expect(standing.textContent).toContain("9.456s");
  });

  it("invites an entry when nobody has finished", () => {
    expect(flyer(open, []).textContent).toContain("be the first");
    const dnf = [{ user: "a", policy_name: "p", score: 50, seeds_finished: 0 }];
    expect(flyer(open, dnf).textContent).toContain("no finisher yet");
  });
});

describe("a planned event's flyer", () => {
  it("is on the wall but is not a link", () => {
    const el = flyer(planned, []);
    expect(el.querySelector("a.challenge-link")).toBeNull();
    expect(el.querySelector("div.challenge-link")).not.toBeNull();
    expect(el.classList.contains("challenge-note--planned")).toBe(true);
  });

  it("says why it cannot be entered and never invites one", () => {
    const el = flyer(planned, []);
    expect(el.textContent).toContain("course not built yet");
    expect(el.textContent).not.toContain("be the first");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL — cannot resolve `./home.js`

- [ ] **Step 3: Write `app/src/home.js`**

```js
// The club's front: who is ahead this season, and which round to pick.
//
// The ladder ranks PEOPLE by the points their publications earned; the flyers
// are the events, each carrying the course, its facts and who holds it. The
// race pages behind the flyers are unchanged — this page is the way in.

import { getEvents, getLeaderboard, getMe, getStandings } from "./api.js";
import { formatEventFacts, formatScore } from "./format.js";
import { playerHref, raceHref } from "./router.js";
import { signage } from "./signage.js";
import { renderThumbnails } from "./thumbnail.js";

const SHELLS = ["cream", "graphite", "lavender", "sky"];
const LADDER_ROWS = 10;

/** Which of the four duck shells a player drives: a stable hash of the name. */
export function shellOf(user) {
  let hash = 0;
  for (const char of String(user)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SHELLS[hash & 3];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function ladder(rows) {
  const box = el("div", "ladders");
  const list = el("div", "ladder");
  if (!rows.length) list.append(el("p", "ladder-empty", "Nobody has published yet."));
  for (const row of rows) {
    const rung = el("a", "ladder-row");
    rung.href = playerHref(row.user);
    rung.append(
      el("span", "ladder-rank", String(row.rank)),
      el("span", `ladder-shell ladder-shell-${shellOf(row.user)}`),
      el("span", "ladder-name", `@${row.user}`),
      el("span", "ladder-points", `${row.points} PTS`),
    );
    list.append(rung);
  }
  box.append(list);
  return box;
}

function standingLine(planned, rows) {
  const line = el("p", "challenge-standing");
  if (planned) {
    line.textContent = "course not built yet";
    return line;
  }
  const star = el("img", "challenge-star");
  star.src = "/star-yellow.webp";
  star.alt = "";
  const leader = rows.find((row) => row.seeds_finished > 0);
  if (leader) {
    line.append(
      star,
      el("span", null, leader.user),
      el("span", null, formatScore(leader.score, { finished: leader.seeds_finished })),
    );
  } else {
    line.append(star, el("span", null, rows.length ? "no finisher yet" : "be the first"));
  }
  return line;
}

/** One event on the wall: its course, its facts, and the time that stands on it. */
export function flyer(event, rows) {
  const planned = event.status === "planned";
  const note = el("article", planned ? "challenge-note challenge-note--planned" : "challenge-note");
  note.append(el("span", "flyer-tape"));
  const link = el(planned ? "div" : "a", "challenge-link");
  if (!planned) link.href = raceHref(event.id);
  const facts = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");
  link.append(
    el("span", "eyebrow", "Race"),
    el("h4", "flyer-title", event.title),
    el("div", "challenge-art"),
    el("p", "challenge-facts", facts),
    standingLine(planned, rows),
  );
  note.append(link);
  return note;
}

export async function renderHome(root) {
  const [events, standings, me] = await Promise.all([getEvents(), getStandings(), getMe()]);
  root.replaceChildren(signage(me));
  const hall = el("main", "hall");
  root.append(hall);

  const door = el("section", "door");
  door.append(
    el("p", "eyebrow", "The microduck arena"),
    el("h2", "hero", "Race on a clock you can trust."),
    el(
      "p",
      "lede",
      "Enter a policy in a race. It runs on our clock, over five perturbed starts, and the time you get is the time everyone gets.",
    ),
  );
  hall.append(door);

  const season = el("section", "chapter");
  season.append(el("h3", "eyebrow", "Season standings"), ladder(standings.slice(0, LADDER_ROWS)));
  hall.append(season);

  // Only an open event has a board worth asking for.
  const boards = await Promise.all(
    events.map((event) =>
      event.status === "planned"
        ? Promise.resolve({ rows: [] })
        : getLeaderboard(event.id).catch(() => ({ rows: [] })),
    ),
  );
  const rounds = el("section", "chapter");
  const wall = el("div", "cabinets");
  const flyers = events.map((event, i) => flyer(event, boards[i].rows));
  wall.append(...flyers);
  rounds.append(el("h3", "eyebrow", "Pick your round"), wall);
  hall.append(rounds);

  // After the wall is on screen: the stills replace the dark frames as they
  // arrive, rather than holding the whole page for WebGL and a 1.3 MB GLB.
  const stills = await renderThumbnails(events);
  events.forEach((event, i) => {
    const url = stills.get(event.id);
    if (!url) return; // no WebGL, or this rig failed — the frame stays dark
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    flyers[i].querySelector(".challenge-art").replaceChildren(img);
  });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/home.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/home.js app/src/home.test.js
git commit -m "Frontend: the club's home page, ladder and event flyers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Player page

**Files:**
- Create: `app/src/player.js`
- Create: `app/src/player.test.js`

**Interfaces:**
- Consumes: `api.js` `getPlayer`, `getMe`; `signage.js` `signage`, `avatar`; `format.js` `formatScore`; `router.js` `raceHref`, `menuHref`.
- Produces:
  - `profile(player) -> HTMLElement` — `div.profile` with `header.profile-header` (`span.profile-duck > .avatar`, `p.eyebrow` "Player", `h2.marquee-title` user), `div.profile-summary` (two `span.sticker`: `sticker-lime` "✦ N points", `sticker-cyan` "#R"), `h3.eyebrow` "Best publications", `ul.profile-results` with one `li > a[href=#/e/<event_id>]` per best entry
  - `noProfile(user) -> HTMLElement` — `div.profile.profile-empty` with "No publication yet" and a link to `#/`
  - `renderPlayer(root, user) -> Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/player.test.js`:

```js
import { describe, expect, it } from "vitest";
import { noProfile, profile } from "./player.js";

const ann = {
  user: "ann",
  points: 655,
  rank: 1,
  best: [
    { event_id: "sprint-2m", event_title: "2 m Sprint", rank: 1, score: 20.0, seeds_finished: 5,
      seeds_total: 5, policy_name: "v2", run_id: "r2", submitted_at: "2026-09-03T10:00:00Z" },
    { event_id: "hill-climb-1m5", event_title: "1.5 m Hill Climb", rank: 2, score: 50.0,
      seeds_finished: 0, seeds_total: 5, policy_name: "hill", run_id: "r3",
      submitted_at: "2026-09-03T11:00:00Z" },
  ],
};

describe("a player's profile", () => {
  it("shows the picture, the name, the points and the rank", () => {
    const el = profile(ann);
    expect(el.querySelector(".profile-header .avatar img").getAttribute("src"))
      .toBe("https://huggingface.co/api/avatars/ann");
    expect(el.querySelector("h2").textContent).toBe("ann");
    expect(el.querySelector(".eyebrow").textContent).toBe("Player");
    const stickers = [...el.querySelectorAll(".profile-summary .sticker")].map((s) => s.textContent);
    expect(stickers).toEqual(["✦ 655 points", "#1"]);
  });

  it("lists the best publication per event, linking into each race", () => {
    const el = profile(ann);
    expect(el.querySelector("h3.eyebrow").textContent).toBe("Best publications");
    const items = [...el.querySelectorAll(".profile-results a")];
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["#/e/sprint-2m", "#/e/hill-climb-1m5"]);
    expect(items[0].textContent).toContain("2 m Sprint");
    expect(items[0].textContent).toContain("#1 · 20.000s");
    expect(items[0].textContent).toContain("v2");
    // A DNF says so rather than printing the time limit as an achieved time.
    expect(items[1].textContent).toContain("#2 · DNF");
  });
});

describe("a name nobody has published under", () => {
  it("says so and points home", () => {
    const el = noProfile("nobody");
    expect(el.textContent).toContain("No publication yet");
    expect(el.textContent).toContain("nobody");
    expect(el.querySelector("a").getAttribute("href")).toBe("#/");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/player.test.js`
Expected: FAIL — cannot resolve `./player.js`

- [ ] **Step 3: Write `app/src/player.js`**

```js
// One player: their picture and name, what their publications earned, where
// they stand, and their best run on every event they entered.

import { getMe, getPlayer } from "./api.js";
import { formatScore } from "./format.js";
import { menuHref, raceHref } from "./router.js";
import { avatar, signage } from "./signage.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function profile(player) {
  const box = el("div", "profile");

  const header = el("header", "profile-header");
  const duck = el("span", "profile-duck");
  duck.append(avatar(player.user));
  const words = el("div");
  words.append(el("p", "eyebrow", "Player"), el("h2", "marquee-title", player.user));
  header.append(duck, words);

  const summary = el("div", "profile-summary");
  summary.append(
    el("span", "sticker sticker-lime", `✦ ${player.points} points`),
    el("span", "sticker sticker-cyan", `#${player.rank}`),
  );

  const list = el("ul", "profile-results");
  for (const best of player.best) {
    const item = el("li");
    const link = el("a");
    link.href = raceHref(best.event_id);
    link.append(
      el("span", "eyebrow", best.event_title),
      el("strong", null, `#${best.rank} · ${formatScore(best.score, { finished: best.seeds_finished })}`),
      el("span", "mono-label", best.policy_name),
    );
    item.append(link);
    list.append(item);
  }

  box.append(header, summary, el("h3", "eyebrow", "Best publications"), list);
  return box;
}

export function noProfile(user) {
  const box = el("div", "profile profile-empty");
  box.append(el("p", "eyebrow", "Player"), el("h2", "marquee-title", user));
  const line = el("p", "lede", `No publication yet. `);
  const back = el("a", null, "Pick a round");
  back.href = menuHref;
  line.append(back, " to put a time up.");
  box.append(line);
  return box;
}

export async function renderPlayer(root, user) {
  const [player, me] = await Promise.all([getPlayer(user), getMe()]);
  root.replaceChildren(signage(me));
  const hall = el("main", "hall");
  hall.append(player ? profile(player) : noProfile(user));
  root.append(hall);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/player.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/player.js app/src/player.test.js
git commit -m "Frontend: the player page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Wire the views, switch themes, remove the old menu

**Files:**
- Modify: `app/src/main.js`
- Delete: `app/src/menu.js`, `app/src/menu.test.js`, `app/src/submit.js`, `app/src/submit.test.js`

**Interfaces:**
- Consumes: `home.js` `renderHome`, `player.js` `renderPlayer`, `race.js` `renderRace`, `router.js` `parseRoute`, `themeFor`.

- [ ] **Step 1: Check nothing else imports the files to be deleted**

Run: `cd app && grep -rn "menu.js\|submit.js" src/ | grep -v "^src/menu\|^src/submit"`
Expected: only `src/main.js` imports `./menu.js`; nothing imports `./submit.js`

- [ ] **Step 2: Rewrite `app/src/main.js`**

```js
// Three views, chosen by the hash. Everything else lives in its view.

import { getEvents } from "./api.js";
import { renderHome } from "./home.js";
import { renderPlayer } from "./player.js";
import { renderRace } from "./race.js";
import { parseRoute, themeFor } from "./router.js";

const root = document.querySelector("#app");
const state = { events: null, viewer: null };

async function events() {
  if (!state.events) state.events = await getEvents();
  return state.events;
}

/**
 * Enable one theme's stylesheets and disable the other's. The two sets define
 * `--ink` and `--paper` with opposite meanings, so they never load together;
 * flipping `disabled` is instant and keeps both cached.
 */
function dress(theme) {
  for (const link of document.querySelectorAll("link[data-theme]")) {
    link.disabled = link.dataset.theme !== theme;
  }
}

async function show() {
  // Tear the old view's render loop down before building the next one, or two
  // viewers keep animating against the same canvas.
  state.viewer?.dispose();
  state.viewer = null;

  const route = parseRoute(location.hash);
  dress(themeFor(route.view));
  try {
    if (route.view === "race") {
      const event = (await events()).find((e) => e.id === route.eventId);
      if (!event) {
        // A stale link should land on something useful, not an error.
        location.hash = "#/";
        return;
      }
      await renderRace(root, { event, state });
    } else if (route.view === "player") {
      await renderPlayer(root, route.user);
    } else {
      await renderHome(root);
    }
  } catch (error) {
    root.innerHTML = `<p class="failed">Could not reach the API: ${error.message}</p>`;
  }
}

addEventListener("hashchange", show);
show();
```

- [ ] **Step 3: Delete the superseded modules**

```bash
git rm -q app/src/menu.js app/src/menu.test.js app/src/submit.js app/src/submit.test.js
```

- [ ] **Step 4: Run the whole JS suite and build**

Run: `cd app && npm test && npm run build && rm -rf dist`
Expected: all test files pass; build succeeds with no "failed to resolve" errors

- [ ] **Step 5: Commit**

```bash
git add app/src/main.js
git commit -m "Frontend: home, player and race views behind one theme switch

menu.js is replaced by home.js; submit.js, long superseded by the entry
panel, goes with it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Run it locally and look at it

**Files:**
- Modify: `README.md` (the `Run it` section and the routes)

- [ ] **Step 1: Build and serve**

```bash
cd app && npm run build && cd ..
uv run --frozen arena serve --store ~/arena-board --user nicolas --host 127.0.0.1 --port 8000
```

Run the server in the background (`run_in_background`), then check:

```bash
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:8000/api/standings
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/design/tokens.css
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/design/fonts/anton-400-latin.woff2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/club.css
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/race.css
```

Expected: health `ok: true`; `{"rows":[]}` on an empty store; four `200`s.

- [ ] **Step 2: Put three players on the ladder**

The reference policy is vendored; each `score` is one full sweep (a few seconds of CPU):

```bash
REF=arena/assets/policies/BEST_alpha_walking.onnx
uv run --frozen arena score $REF --event sprint-2m --user nicolas --name walker --store ~/arena-board
uv run --frozen arena score $REF --event sprint-2m --user coralie --name steady --store ~/arena-board
uv run --frozen arena score $REF --event hill-climb-1m5 --user nicolas --name climber --store ~/arena-board
curl -s http://127.0.0.1:8000/api/standings
curl -s http://127.0.0.1:8000/api/players/nicolas
```

Expected: two rows; `nicolas` first (two first_event, two runs, two podium places), `coralie` second. If `arena score` does not accept `--name`, run `uv run --frozen arena score --help` and use the flag it lists.

- [ ] **Step 3: Open the pages**

Open <http://127.0.0.1:8000/> — the signage with the chip top-right reading `nicolas`, the door, `Season standings` with two rungs, `Pick your round` with seven flyers (three linking, four planned) whose frames fill with course stills. Click a rung → `#/p/nicolas` with the duck avatar (the Hub has no `nicolas` user, so the fallback shows), `✦ N points`, `#1`, two best publications. Click a publication → the race page, dark theme, unchanged. Browser back → the club theme returns.

If the Playwright MCP is reachable, take screenshots of `/`, `/#/p/nicolas` and `/#/e/sprint-2m` at 1280 px into the scratchpad and look at them; otherwise ask Nicolas to look.

- [ ] **Step 4: Update the README**

In `README.md`, in the `## Run it` section, after `Open <http://127.0.0.1:8000>.`, add:

```markdown
The home page is the club: `Season standings` ranks players by the points
their publications earned (first publication on an event 100, each published
run 10 capped at three a day, beating your own best 25 once per event, and
250/150/100 while you hold a podium place), and `Pick your round` lists the
events. The chip top-right opens your page, `#/p/<user>`; the standings link
to everyone else's. Points are folded from the run log on every request, like
the board — `GET /api/standings` and `GET /api/players/<user>`.
```

- [ ] **Step 5: Full verification and commit**

```bash
uv run --frozen pytest -q
cd app && npm test && cd ..
git status --short
git add README.md
git commit -m "README: the club home page and player pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: both suites green, `git status` clean after the commit, `git log --oneline | head -12` showing the ten commits above the design commit. **Do not push.**

---

## Self-review against the spec

- Points module, filter, receipts table, DNF note, standings order, `by_user` podium → Tasks 1–2.
- `/api/standings`, `/api/players/{user}` shapes and 404 → Task 3.
- Routes and `themeFor` → Task 4; two stylesheets with `data-theme` and `disabled`, Google Fonts removed → Task 4 step 7; design import → Task 4 step 5; `club.css` → Task 4 step 6.
- Home structure (signage, door, Season standings top 10, Pick your round flyers open/planned, thumbnails) → Task 7.
- Chip states including unreachable API, avatar with fallback → Task 6.
- Player page (avatar, name, two stickers, best list, 404 state) → Task 8.
- Deletions → Task 9. Tests → each task. Running it → Task 10.
- Spec says the chip falls back to the sign-in link "signed out" and empty when unreachable: Task 6 `chip(null)` returns an empty span, `chip({signed_in:false})` returns the sticker. ✔
- Type consistency: `Receipt.at` used by `standings`; `Card(rank, user, points)` used by routes; `getPlayer` null contract used by `renderPlayer`; `flyer`/`ladder`/`profile`/`noProfile` names match tests and `main.js` imports. ✔
