# The publication page — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every published run a page, `#/r/<run_id>`, that replays it against the ducks ranked just under it, shows its time, its place on the event's board and the points it earned — and reveals all of that to its author, once, with Duck Jam's theatre.

**Architecture:** The existing `GET /api/runs/{id}` grows to carry everything the page shows; a `seen/<run_id>.json` file beside `withdrawn/` records the author's first look; one pure fold, `index.standing`, places a run against everyone else's best. The frontend adds a fourth view built on the viewer that already exists, plus a port of Duck Jam's animation primitives and a sequencer that plays the reveal in beats on `animationend`.

**Tech Stack:** Python 3.13, FastAPI, `huggingface_hub`, pytest. Frontend: vanilla ES modules, three.js, vitest + jsdom. Duck Jam's design system (`app/public/design/*.css`) is already imported.

**Spec:** `docs/superpowers/specs/2026-09-15-publication-page-design.md`

## Global Constraints

- **Run Python through uv with `--frozen`**: `uv run --frozen pytest -q -m "not network"`. The local uv mirror config rewrites `uv.lock` otherwise.
- **Ruff line length is 100.** Run `uv run --frozen ruff check arena tests` before each Python commit.
- **JS tests**: `cd app && npx vitest run src/<file>.test.js`. `app/src/brightness.test.js` has 4 pre-existing failures under Node 25 — ignore them, they are not yours.
- **Timestamps are strings compared as strings**: `datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")`, never `isoformat()`.
- **Run files are never rewritten.** `runs/*.json` is append-only; a flag is a new file in its own folder.
- **`arena/index.py` and `arena/points.py` stay pure**: no I/O, no clock.
- **Never `git push`.** A push to `main` deploys the live Space. Commit locally only.
- **Tests are kept to the minimum the spec lists.** Do not add tests beyond the ones written here.
- **Do not commit `.claude/`.** Always `git add` named paths.

---

### Task 1: The `seen` flag on the store

**Files:**
- Modify: `arena/store.py:195-203` (Protocol), `:264-285` (LocalStore, after `withdrawals`), `:380-398` (HubStore, after `withdrawals`)
- Create: `tests/test_seen.py`

**Interfaces:**
- Produces: `Store.mark_seen(run_id: str, user: str, seen_at: str) -> None` (idempotent; first write wins) and `Store.seen() -> frozenset[str]` on the Protocol, `LocalStore` and `HubStore`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_seen.py`:

```python
"""A result its author has opened: one file per run, written once, never rewritten."""

import numpy as np
from fastapi.testclient import TestClient

from arena.store import LocalStore
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record


def test_marking_a_run_seen_is_one_file_and_the_first_visit_stays(tmp_path):
    store = LocalStore(tmp_path)
    assert store.seen() == frozenset()
    store.mark_seen("R1", "alice", "2026-09-15T10:00:00Z")
    store.mark_seen("R1", "alice", "2026-09-15T11:00:00Z")
    assert store.seen() == frozenset({"R1"})
    written = (tmp_path / "seen" / "R1.json").read_text()
    assert "10:00:00Z" in written and "11:00:00Z" not in written
```

(`TestClient`, `create_app`, `ArenaConfig`, `encode`, `np` and `make_record` are used by Task 3's tests in this same file; leave the imports in.)

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --frozen pytest -q tests/test_seen.py`
Expected: FAIL with `AttributeError: 'LocalStore' object has no attribute 'seen'`

- [ ] **Step 3: Add the two methods to the Protocol**

In `arena/store.py`, extend `class Store(Protocol)`:

```python
class Store(Protocol):
    def append(
        self, record: RunRecord, trace_blob: bytes, model_blob: bytes | None = None
    ) -> None: ...
    def runs(self, event_id: str) -> list[RunRecord]: ...
    def trace(self, run_id: str) -> bytes: ...
    def model(self, sha256: str) -> bytes: ...
    def withdraw(self, withdrawal: Withdrawal) -> None: ...
    def withdrawals(self) -> list[Withdrawal]: ...
    def mark_seen(self, run_id: str, user: str, seen_at: str) -> None: ...
    def seen(self) -> frozenset[str]: ...
```

- [ ] **Step 4: Implement them on LocalStore**

Append to `class LocalStore`, after `withdrawals`:

```python
    def _seen_path(self, run_id: str) -> Path:
        return self.root / "seen" / f"{run_id}.json"

    def mark_seen(self, run_id: str, user: str, seen_at: str) -> None:
        """The author has opened this run's page: the result has been revealed.

        The first visit is the one that matters, so an existing file is left
        alone rather than re-dated. Same shape as a withdrawal — one small file
        in its own folder, never a change to the run's own record.
        """
        path = self._seen_path(run_id)
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"run_id": run_id, "user": user, "seen_at": seen_at}, indent=2)
        )

    def seen(self) -> frozenset[str]:
        directory = self.root / "seen"
        if not directory.is_dir():
            return frozenset()
        return frozenset(p.stem for p in directory.glob("*.json"))
```

- [ ] **Step 5: Implement them on HubStore**

Append to `class HubStore`, after `withdrawals`:

```python
    def mark_seen(self, run_id: str, user: str, seen_at: str) -> None:
        from huggingface_hub import CommitOperationAdd

        path = f"seen/{run_id}.json"
        # The first visit stays, as on LocalStore; one round trip to know.
        if self.api.file_exists(self.repo_id, path, repo_type="dataset"):
            return
        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"seen {run_id} ({user})",
            operations=[
                CommitOperationAdd(
                    path_in_repo=path,
                    path_or_fileobj=json.dumps(
                        {"run_id": run_id, "user": user, "seen_at": seen_at}, indent=2
                    ).encode(),
                )
            ],
        )
        # The dot must go out the moment the page is seen, not after the TTL.
        self._snapshot = None

    def seen(self) -> frozenset[str]:
        return self.snapshot().seen()
```

- [ ] **Step 6: Run the test and the suite**

Run: `uv run --frozen pytest -q tests/test_seen.py tests/test_store.py && uv run --frozen ruff check arena tests`
Expected: PASS, ruff clean.

- [ ] **Step 7: Commit**

```bash
git add arena/store.py tests/test_seen.py
git commit -m "Store: a seen file per run, written once, beside withdrawn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `index.standing` — where one run stands

**Files:**
- Modify: `arena/index.py` (append after `leaderboard`)
- Test: `tests/test_index.py` (append)

**Interfaces:**
- Consumes: `leaderboard`, `by_user`, `sort_key`, `Row` from `arena/index.py`.
- Produces: `standing(records, run_id, withdrawn=frozenset(), runner_version=RUNNER_VERSION, above=2, below=5) -> Standing` where `Standing(rank: int, on_board: bool, board: list[Row])`. `board` is in board order and holds exactly one `Row` whose `record.run_id == run_id`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_index.py`:

```python
def test_standing_places_a_run_among_everyone_elses_best():
    field = [make_record(run_id=f"R{i}", user=f"u{i}", score=10.0 + i) for i in range(10)]
    mine = make_record(run_id="ME", user="me", score=14.5)  # between R4 and R5
    s = standing([*field, mine], "ME")
    assert (s.rank, s.on_board) == (6, True)
    # Two rows above, the run, five below — with their ranks on the whole board.
    assert [row.rank for row in s.board] == [4, 5, 6, 7, 8, 9, 10, 11]
    assert [row.record.run_id for row in s.board][:3] == ["R3", "R4", "ME"]


def test_standing_of_a_run_beaten_by_your_own_better_one():
    """Off the board, since the board keeps one row per person — but still placed
    against the others, with the author's own better row taken out of the way."""
    runs = [
        make_record(run_id="BEST", user="me", score=10.0),
        make_record(run_id="WORSE", user="me", score=12.0),
        make_record(run_id="B", user="bob", score=11.0),
    ]
    s = standing(runs, "WORSE")
    assert (s.rank, s.on_board) == (2, False)
    assert [row.record.run_id for row in s.board] == ["B", "WORSE"]
```

At the top of `tests/test_index.py`, change line 2 from

```python
from arena.index import by_policy, by_user, leaderboard
```

to

```python
from arena.index import by_policy, by_user, leaderboard, standing
```

(`make_record` is already imported there from `tests.test_store`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --frozen pytest -q tests/test_index.py`
Expected: FAIL with `ImportError: cannot import name 'standing'`

- [ ] **Step 3: Implement `standing`**

Append to `arena/index.py`:

```python
@dataclass(frozen=True)
class Standing:
    rank: int
    on_board: bool
    board: list[Row]


def standing(
    records,
    run_id: str,
    withdrawn: frozenset[str] = frozenset(),
    runner_version: int = RUNNER_VERSION,
    above: int = 2,
    below: int = 5,
) -> Standing:
    """Where ONE run stands against everyone else's best, on the board or not.

    The board keeps one row per person, so a run beaten by its author's own
    better run, a withdrawn run, or one from an older runner has no row — and
    still deserves an answer to "where would this have placed". The author's
    own row is taken out and the run put in at its sorted place; `rank` is that
    place, and `board` is the window around it: `above` rows over it, up to
    `below` under it, every rank counted on the whole field.
    """
    record = next(r for r in records if r.run_id == run_id)
    rows = leaderboard(records, runner_version, entrant=by_user, withdrawn=withdrawn)
    others = [row.record for row in rows if row.record.user != record.user]
    field = sorted([*others, record], key=sort_key)
    at = field.index(record)
    ranked = [Row(rank=i + 1, record=r) for i, r in enumerate(field)]
    return Standing(
        rank=at + 1,
        on_board=any(row.record.run_id == run_id for row in rows),
        board=ranked[max(0, at - above) : at + 1 + below],
    )
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest -q tests/test_index.py && uv run --frozen ruff check arena tests`
Expected: PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add arena/index.py tests/test_index.py
git commit -m "Index: standing places one run against everyone else's best

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The run detail, the seen route, and the chip's two numbers

**Files:**
- Modify: `arena/web/routes_read.py:1-20` (imports), `:165-186` (`run_detail`)
- Modify: `arena/web/routes_submit.py` (append a route after `withdraw`)
- Modify: `arena/web/routes_auth.py:1-20` (imports), `:114-128` (`me`)
- Modify: `tests/test_routes_trace.py:34-40`
- Test: `tests/test_routes_read.py` (append), `tests/test_seen.py` (append)

**Interfaces:**
- Consumes: `standing` (Task 2), `store.seen()` / `store.mark_seen()` (Task 1), `receipts`, `standings` from `arena/points.py`, `_all_runs`, `_withdrawn`, `_find_run` from `routes_read.py`.
- Produces: `GET /api/runs/{run_id}` with the fields below; `POST /api/runs/{run_id}/seen` → `{"seen": true}`; `GET /api/me` with `points` and `unseen` when signed in.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_routes_read.py`:

```python
def test_a_run_detail_carries_its_place_its_receipts_and_its_event(client):
    api, app = client
    record_run(app, user="bob", score=10.0, submitted_at="2026-09-03T09:00:00Z")
    mine = record_run(app, user="coralie", score=12.0, submitted_at="2026-09-03T10:00:00Z")

    body = api.get(f"/api/runs/{mine.run_id}").json()
    assert body["event"]["title"] == "2 m Sprint"
    assert (body["rank"], body["on_board"], body["withdrawn"], body["seen"]) == (
        2, True, False, False,
    )
    assert [(r["rank"], r["user"], r["you"]) for r in body["board"]] == [
        (1, "bob", False),
        (2, "coralie", True),
    ]
    # first entry 100 + run 10 + second place 150; no own_best, a lone run beats nothing.
    assert sorted(r["act"] for r in body["receipts"]) == ["first_event", "podium", "run"]
    assert sum(r["points"] for r in body["receipts"]) == 260
    # Dropped: it cost a full trace decode, and the page loads the trace anyway.
    assert "frames" not in body
```

Append to `tests/test_seen.py`:

```python
def app_with(tmp_path, dev_user):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user=dev_user)
    app = create_app(config)
    return TestClient(app), app


def record_run(app, **overrides):
    record = make_record(**overrides)
    app.state.store.append(record, encode(np.zeros((5, 21), dtype=np.float32)))
    return record


def test_the_author_marks_a_run_seen_and_the_dot_goes_out(tmp_path):
    api, app = app_with(tmp_path, dev_user="alice")
    run = record_run(app, user="alice")
    me = api.get("/api/me").json()
    # first entry 100 + run 10 + first place 250
    assert (me["points"], me["unseen"]) == (360, 1)
    assert api.get(f"/api/runs/{run.run_id}").json()["seen"] is False

    assert api.post(f"/api/runs/{run.run_id}/seen").json() == {"seen": True}
    assert api.post(f"/api/runs/{run.run_id}/seen").status_code == 200  # a double-click

    assert api.get(f"/api/runs/{run.run_id}").json()["seen"] is True
    assert api.get("/api/me").json()["unseen"] == 0


def test_only_the_author_can_mark_a_run_seen(tmp_path):
    api, app = app_with(tmp_path, dev_user="bob")
    run = record_run(app, user="alice")
    assert api.post(f"/api/runs/{run.run_id}/seen").status_code == 403
    assert app.state.store.seen() == frozenset()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --frozen pytest -q tests/test_seen.py tests/test_routes_read.py`
Expected: the three new tests FAIL (`KeyError: 'event'`, `KeyError: 'points'`, and a 404/405 on the POST).

- [ ] **Step 3: Extend `run_detail`**

In `arena/web/routes_read.py`, change the import line `from ..index import leaderboard` to:

```python
from ..index import leaderboard, standing
```

Replace the whole `run_detail` function (`:165-186`) with:

```python
@router.get("/runs/{run_id}")
def run_detail(run_id: str, request: Request) -> dict:
    """One run and everything its page shows: where it stands, what it earned,
    whether its author has seen it. Placed by `index.standing`, priced by
    `points.receipts` — nothing is decided here."""
    store = request.app.state.store
    record = _find_run(store, run_id)
    runs, withdrawn = _all_runs(store), _withdrawn(store)
    place = standing(store.runs(record.event_id), run_id, withdrawn=withdrawn)
    return {
        "run_id": record.run_id,
        "event": event_summary(load_event(record.event_id)),
        "user": record.user,
        "policy_name": record.policy_name,
        "livery": record.livery,
        "score": record.score,
        "command_vx": record.command_vx,
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "per_seed": [
            {"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in record.per_seed
        ],
        "trace_seed": record.trace_seed,
        "submitted_at": record.submitted_at,
        "runner_version": record.runner_version,
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
        "env_url": record.env_url,
        "withdrawn": record.run_id in withdrawn,
        "on_board": place.on_board,
        "rank": place.rank,
        "board": [
            {
                "rank": row.rank,
                "user": row.record.user,
                "policy_name": row.record.policy_name,
                "score": row.record.score,
                "seeds_finished": row.record.seeds_finished,
                "run_id": row.record.run_id,
                "livery": row.record.livery,
                "you": row.record.run_id == record.run_id,
            }
            for row in place.board
        ],
        # Podium receipts are HELD, so this list can change between two reads.
        "receipts": [
            {"act": r.act, "points": r.points}
            for r in receipts(runs, withdrawn)
            if r.run_id == record.run_id
        ],
        "seen": record.run_id in store.seen(),
    }
```

- [ ] **Step 4: Drop the `frames` assertion the old detail carried**

In `tests/test_routes_trace.py:34-40`, replace

```python
    # 9, not the fixture's default: `frames` has to be derived from the stored
    # trace, and a hardcoded default would pass an assertion on the default.
    app.state.store.append(record, encode(a_trace(frames=9)))

    body = api.get(f"/api/runs/{record.run_id}").json()
    assert body["user"] == "alice"
    assert body["frames"] == 9
```

with

```python
    app.state.store.append(record, encode(a_trace(frames=9)))

    body = api.get(f"/api/runs/{record.run_id}").json()
    assert body["user"] == "alice"
```

- [ ] **Step 5: Add the seen route**

Append to `arena/web/routes_submit.py`, after `withdraw`:

```python
@router.post("/runs/{run_id}/seen")
def mark_seen(run_id: str, request: Request) -> dict:
    """The author has opened this run's page: the reveal has played, the dot goes out.

    Owner-only, decided from the session exactly as a withdrawal is. Idempotent:
    the store keeps the first visit and ignores the rest.
    """
    from .routes_read import _find_run

    session = _require_session(request)
    store = request.app.state.store
    record = _find_run(store, run_id)
    if record.user != session.username:
        raise HTTPException(
            status_code=403,
            detail=f"{run_id} was published by {record.user}, not you.",
        )
    store.mark_seen(
        record.run_id, record.user, datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    return {"seen": True}
```

(`datetime` and `UTC` are already imported at the top of the file.)

- [ ] **Step 6: Add `points` and `unseen` to `/api/me`**

In `arena/web/routes_auth.py`, add to the imports (next to the existing `from .session import ...` lines):

```python
from ..points import receipts, standings
from .routes_read import _all_runs, _withdrawn
```

Replace the body of `me` (`:114-128`) with:

```python
@router.get("/api/me")
def me(request: Request, response: Response) -> dict:
    config = request.app.state.config
    session = current_user(request)
    # The one response whose body varies per user. Behind any shared cache, a
    # cached copy would serve one person's identity to the next visitor.
    response.headers["Cache-Control"] = "no-store"
    body = {
        "signed_in": session is not None,
        "user": session.username if session else None,
        # Publishing to the author's own repo needs their OAuth token. The local
        # path has none, so it publishes to the local store instead.
        "can_publish_to_hub": bool(session and session.token),
        "oauth_enabled": config.oauth_enabled,
    }
    if session:
        # The chip's two numbers: the standing total, and how many of your own
        # results you have never opened.
        store = request.app.state.store
        runs, withdrawn = _all_runs(store), _withdrawn(store)
        card = next(
            (c for c in standings(receipts(runs, withdrawn)) if c.user == session.username),
            None,
        )
        seen = store.seen()
        body["points"] = card.points if card else 0
        body["unseen"] = sum(
            1 for r in runs if r.user == session.username and r.run_id not in seen
        )
    return body
```

- [ ] **Step 7: Run the suite**

Run: `uv run --frozen pytest -q -m "not network" && uv run --frozen ruff check arena tests`
Expected: PASS, ruff clean. If the import in `routes_auth.py` raises a circular import at app start, `routes_read.py` has grown an import of `routes_auth` — it must not; the dependency only goes `routes_auth → routes_read`.

- [ ] **Step 8: Commit**

```bash
git add arena/web/routes_read.py arena/web/routes_submit.py arena/web/routes_auth.py tests/test_routes_read.py tests/test_routes_trace.py tests/test_seen.py
git commit -m "API: the run detail carries its place, receipts and seen flag; POST seen; me.points and me.unseen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `publications` on the player page

**Files:**
- Modify: `arena/web/routes_read.py:6-20` (imports), `:123-149` (`player_page`)
- Test: `tests/test_routes_read.py:296-339` (two existing tests rewritten)

**Interfaces:**
- Consumes: `standing` (Task 2), `store.seen()` (Task 1).
- Produces: `GET /api/players/{user}` → `{user, points, rank, publications: [...]}`; `rank` is `null` when the player has no counting run; 404 only with no run at all.

- [ ] **Step 1: Rewrite the two tests**

In `tests/test_routes_read.py`, replace `test_a_player_page_carries_points_rank_and_the_best_run_per_event` with:

```python
def test_a_player_page_carries_points_rank_and_every_publication_newest_first(client):
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
    # sprint: first 100 + runs 10+10 + own_best 25 + podium 250; hill: first 100 + run 10 + podium 150.
    assert (body["user"], body["rank"], body["points"]) == ("ann", 1, 655)
    assert [(p["run_id"], p["rank"], p["on_board"]) for p in body["publications"]] == [
        (hill.run_id, 2, True),
        (fast.run_id, 1, True),
        # Beaten by her own v2, so off the board — and still placed: alone in
        # a field with nobody else on the sprint, first.
        (slow.run_id, 1, False),
    ]
    sprint = body["publications"][1]
    assert (sprint["event_title"], sprint["policy_name"], sprint["seeds_total"]) == (
        "2 m Sprint", "v2", 1,
    )
    assert (sprint["withdrawn"], sprint["seen"]) == (False, False)
```

Replace `test_a_withdrawn_run_leaves_the_player_page_and_the_ladder` with:

```python
def test_a_withdrawn_run_leaves_the_ladder_but_stays_on_the_player_page(client):
    api, app = client
    from arena.store import Withdrawal
    run = record_run(app, user="ann")
    app.state.store.withdraw(Withdrawal(run_id=run.run_id, event_id="sprint-2m", user="ann",
                                        withdrawn_at="2026-09-03T12:00:00Z"))
    assert api.get("/api/standings").json() == {"rows": []}
    body = api.get("/api/players/ann").json()
    assert (body["points"], body["rank"]) == (0, None)
    assert [(p["run_id"], p["withdrawn"], p["on_board"]) for p in body["publications"]] == [
        (run.run_id, True, False),
    ]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --frozen pytest -q tests/test_routes_read.py`
Expected: the two rewritten tests FAIL (`KeyError: 'publications'`, and a 404 where 200 is expected).

- [ ] **Step 3: Rewrite `player_page`**

In `arena/web/routes_read.py`, change the points import to drop `boards_by_user`:

```python
from ..points import receipts, standings
```

and add `from collections import defaultdict` to the standard-library imports at the top. Replace `player_page` (`:123-149`) with:

```python
@router.get("/players/{user}")
def player_page(user: str, request: Request) -> dict:
    """A player's total, rank, and every publication they made, newest first."""
    store = request.app.state.store
    runs, withdrawn = _all_runs(store), _withdrawn(store)
    mine = sorted((r for r in runs if r.user == user), key=lambda r: r.submitted_at, reverse=True)
    if not mine:
        raise HTTPException(status_code=404, detail=f"{user!r} has not published yet")
    card = next((c for c in standings(receipts(runs, withdrawn)) if c.user == user), None)
    titles = {m.id: m.title for m in all_events()}
    seen = store.seen()
    by_event: dict[str, list[RunRecord]] = defaultdict(list)
    for run in runs:
        by_event[run.event_id].append(run)
    publications = []
    for run in mine:
        place = standing(by_event[run.event_id], run.run_id, withdrawn=withdrawn)
        publications.append({
            "run_id": run.run_id,
            "event_id": run.event_id,
            "event_title": titles[run.event_id],
            "policy_name": run.policy_name,
            "score": run.score,
            "seeds_finished": run.seeds_finished,
            "seeds_total": len(run.per_seed),
            "rank": place.rank,
            "on_board": place.on_board,
            "withdrawn": run.run_id in withdrawn,
            "submitted_at": run.submitted_at,
            "seen": run.run_id in seen,
        })
    return {
        "user": user,
        "points": card.points if card else 0,
        "rank": card.rank if card else None,
        "publications": publications,
    }
```

- [ ] **Step 4: Run the suite**

Run: `uv run --frozen pytest -q -m "not network" && uv run --frozen ruff check arena tests`
Expected: PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_read.py tests/test_routes_read.py
git commit -m "API: a player's publications, newest first, each placed and flagged seen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Frontend plumbing — route, API call, a Player that can stop, sounds

**Files:**
- Modify: `app/src/router.js`, `app/src/api.js`, `app/src/replay.js:47-92` (`Player`), `app/src/viewer.js:248-281` (`setLanes`)
- Create: `app/src/sound.js`, `app/public/design/sound/` (five `.wav` files)
- Test: `app/src/router.test.js`

**Interfaces:**
- Produces: `parseRoute("#/r/<id>") → {view: "run", runId}`, `runHref(runId)`, `themeFor("run") === "race"`; `markSeen(runId)`; `new Player(traces, {onTick, loop})` with a public `loop` field that, when false, holds the last frame and stops; `viewer.setLanes(entries, event, playerOptions)` where an entry may carry `opacity`; `sound.js` exporting `load()`, `cue(name)` for `win | stamp | points | climb | chirp`, and `followCounter(tile) → stop`.

- [ ] **Step 1: Write the failing router test**

In `app/src/router.test.js`, add `runHref` to the import and add inside `describe("parseRoute")`:

```js
  it("opens one publication", () => {
    expect(parseRoute("#/r/01ABC")).toEqual({ view: "run", runId: "01ABC" });
    expect(parseRoute(runHref("01ABC"))).toEqual({ view: "run", runId: "01ABC" });
  });
```

and inside `describe("themeFor")`'s test, add the line:

```js
    expect(themeFor("run")).toBe("race");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/router.test.js`
Expected: FAIL, `runHref` is not exported.

- [ ] **Step 3: Add the route**

Replace `app/src/router.js` with:

```js
// Four views, addressed by hash so the browser's own back button works and
// "back to the races" is an ordinary link rather than a piece of state.

const SEGMENT = "([A-Za-z0-9._-]+)";
const RACE = new RegExp(`^/e/${SEGMENT}/?$`);
const PLAYER = new RegExp(`^/p/${SEGMENT}/?$`);
const RUN = new RegExp(`^/r/${SEGMENT}/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const race = path.match(RACE);
  if (race) return { view: "race", eventId: race[1] };
  const player = path.match(PLAYER);
  if (player) return { view: "player", user: player[1] };
  const run = path.match(RUN);
  if (run) return { view: "run", runId: run[1] };
  return { view: "menu" };
}

export const raceHref = (eventId) => `#/e/${eventId}`;
export const playerHref = (user) => `#/p/${user}`;
export const runHref = (runId) => `#/r/${runId}`;
export const menuHref = "#/";

/**
 * Which placement sheet a view wears. Both are the club, in Duck Jam's paper
 * and ink; they differ only in what they place — a page with a stage (a race,
 * a publication) owns its own body and column for it. Only one is ever enabled.
 */
export const themeFor = (view) => (view === "race" || view === "run" ? "race" : "club");
```

- [ ] **Step 4: Run the router tests**

Run: `cd app && npx vitest run src/router.test.js`
Expected: PASS.

- [ ] **Step 5: Add `markSeen` to the API module**

In `app/src/api.js`, after `withdrawRun`:

```js
/** Tell the server its author has seen this run's page. The server refuses anyone else. */
export const markSeen = (runId) => json(`/api/runs/${runId}/seen`, { method: "POST" });
```

- [ ] **Step 6: Let the Player stop at the line**

In `app/src/replay.js`, change the `Player` constructor and `advance`:

```js
export class Player {
  constructor(traces, { onTick, loop = true } = {}) {
    this.traces = traces;
    this.counts = traces.map(frameCount);
    this.duration = this.counts.length ? Math.max(...this.counts) * CTRL_DT : 0;
    this.time = 0;
    this.playing = false;
    this.onTick = onTick;
    // Loop the race so it can be watched repeatedly; with `loop` off it holds
    // the last frame and stops — the reveal wants the ducks at the line.
    this.loop = loop;
    this._last = null;
  }
```

and in `advance`, replace

```js
    let next = this.time + dt;
    if (next >= this.duration) {
      next = 0; // loop the race, so it can be watched repeatedly
      this._last = nowMs;
    }
```

with

```js
    let next = this.time + dt;
    if (next >= this.duration) {
      if (!this.loop) {
        this.time = this.duration;
        this.playing = false;
        this.onTick?.(this.time);
        return;
      }
      next = 0;
      this._last = nowMs;
    }
```

- [ ] **Step 7: Pass player options and a solid opacity through the viewer**

In `app/src/viewer.js`, change the `setLanes` signature and two lines inside it:

```js
  function setLanes(entries, event, playerOptions = {}) {
```

```js
      attachMeshes(rig, kinematics, geometries, {
        livery: entry.livery ?? "classic",
        // A rival on a publication page is a real entry, drawn solid: an
        // explicit `opacity` overrides what the tier would give it.
        opacity: entry.opacity ?? (tier === "ghost" ? GHOST_OPACITY : 1),
      });
```

```js
    player = new Player(lanes.map((lane) => lane.trace), playerOptions);
    player.play();
```

- [ ] **Step 8: Copy the five sounds and write `sound.js`**

```bash
mkdir -p app/public/design/sound
for f in microduck-victory stamp points rank-climb microduck-chirp; do
  cp "/Users/nicolasrabault/Projects/HuggingFace/duckJam/design/sound/$f.wav" app/public/design/sound/
done
ls -la app/public/design/sound
```

Expected: five files, about 200 KB together.

Create `app/src/sound.js`:

```js
// The theatre's cues: Duck Jam's own files, at Duck Jam's own volumes.
//
// One <audio> per file, made on first use and cloned per play so two cues can
// overlap. A play the browser refuses — a page opened cold, with no gesture yet
// — is silence, not an error: nothing in the theatre waits on a sound.

const FILES = {
  win: ["microduck-victory.wav", 0.4],
  stamp: ["stamp.wav", 0.6],
  points: ["points.wav", 0.4],
  climb: ["rank-climb.wav", 0.4],
  chirp: ["microduck-chirp.wav", 0.4],
};

const held = new Map();

function template(file) {
  if (!held.has(file)) held.set(file, new Audio(`/design/sound/${file}`));
  return held.get(file);
}

/** Fetch the kit now, so the first cue of a reveal is not late. */
export function load() {
  for (const [file] of Object.values(FILES)) template(file).load();
}

export function cue(name) {
  const [file, volume] = FILES[name];
  const play = template(file).cloneNode();
  play.volume = volume;
  play.play().catch(() => {});
}

/**
 * A tick per flap while a split-flap tile rolls, read off the tile's rendered
 * faces rather than a timer, so dropped frames never queue a burst of missed
 * clicks. Returns the function that stops following.
 */
export function followCounter(tile) {
  const faces = () =>
    ["::before", "::after"]
      .map((face) => getComputedStyle(tile, face).getPropertyValue("--flip-at"))
      .join("/");
  let previous = faces();
  let frame = requestAnimationFrame(sample);
  function sample() {
    if (!tile.isConnected || !tile.classList.contains("flip-roll")) return;
    const current = faces();
    if (current !== previous) cue("points");
    previous = current;
    frame = requestAnimationFrame(sample);
  }
  return () => cancelAnimationFrame(frame);
}
```

- [ ] **Step 9: Run the whole JS suite and the build**

Run: `cd app && npx vitest run && npm run build`
Expected: every file passes except the 4 pre-existing `brightness.test.js` failures; the build succeeds.

- [ ] **Step 10: Commit**

```bash
git add app/src/router.js app/src/router.test.js app/src/api.js app/src/replay.js app/src/viewer.js app/src/sound.js app/public/design/sound
git commit -m "Frontend: the run route, markSeen, a Player that can stop at the line, and the theatre's sounds

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The chip shows points and an unread dot

**Files:**
- Modify: `app/src/signage.js:36-56` (`chip`), `app/public/shell.css` (append)
- Test: `app/src/signage.test.js:24-31`

**Interfaces:**
- Consumes: `flipTiles(value)` — defined in Task 7's `animation.js`. **Create `app/src/animation.js` in this task with only `flipTiles`**; Task 7 appends the rest.
- Produces: a signed-in chip `a.profile-chip[.unread]` containing `.avatar`, the name, and `span.flip.chip-points` whose `.flip-digit` tiles spell `me.points`.

- [ ] **Step 1: Write the failing test**

In `app/src/signage.test.js`, replace the first `chip` test with:

```js
  it("links a signed-in player to their page, with picture, name and points", () => {
    const el = chip({ signed_in: true, user: "cdeplanne", oauth_enabled: true, points: 385, unseen: 0 });
    expect(el.matches("a.profile-chip")).toBe(true);
    expect(el.getAttribute("href")).toBe("#/p/cdeplanne");
    expect(el.querySelector(".avatar img")).not.toBeNull();
    expect(el.textContent).toContain("cdeplanne");
    expect([...el.querySelectorAll(".chip-points .flip-digit")].map((t) => t.textContent)).toEqual(["3", "8", "5"]);
    expect(el.classList.contains("unread")).toBe(false);
  });

  it("wears a dot while a result waits to be opened", () => {
    const el = chip({ signed_in: true, user: "cdeplanne", oauth_enabled: true, points: 10, unseen: 2 });
    expect(el.classList.contains("unread")).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/signage.test.js`
Expected: FAIL on `.chip-points .flip-digit`.

- [ ] **Step 3: Create `animation.js` with `flipTiles`**

Create `app/src/animation.js`:

```js
// The theatre's primitives, ported from Duck Jam (dome/web/shared/animation.mjs).
//
// Every beat sequences on `animationend`, never on a timer: design/motion.css
// owns the durations, and reduced motion sets them all to zero without a second
// code path. An AbortSignal ends any wait early, so a skipped reveal never
// leaves a promise hanging.

/** The digits of a value as split-flap tiles; anything else sits between them. */
export function flipTiles(value) {
  return [...String(value)].map((c) => {
    const span = document.createElement("span");
    if (/\d/.test(c)) span.className = "flip-digit";
    span.textContent = c;
    return span;
  });
}
```

- [ ] **Step 4: Rewrite `chip`**

In `app/src/signage.js`, add `import { flipTiles } from "./animation.js";` and replace the signed-in branch of `chip` (everything after the `if (!me.signed_in) {...}` block) with:

```js
  const link = document.createElement("a");
  link.className = me.unseen > 0 ? "profile-chip unread" : "profile-chip";
  link.href = playerHref(me.user);
  const name = document.createElement("span");
  name.textContent = me.user;
  // The points as split-flap tiles even at rest, so a reveal can roll them up
  // in place. The star before them is the sheet's, not a tile.
  const points = document.createElement("span");
  points.className = "flip chip-points";
  points.append(...flipTiles(me.points ?? 0));
  link.append(avatar(me.user), name, points);
  return link;
```

Update the `chip` doc comment's first line to: `Who you are, top-right: your picture, your name, your points, and a dot while a result of yours waits to be opened.`

- [ ] **Step 5: Place the tiles and the dot**

Append to `app/public/shell.css`, after the `.profile-chip:hover` rule:

```css
/* The points, as flip tiles small enough for a strip: deep-ink tiles on the
   ink chip, the seam in ink, the star in the club's yellow. */
.profile-chip { position: relative; }
.profile-chip .flip { gap: 2px; font-size: 1rem; }
.profile-chip .flip-digit { width: 0.75em; height: 1.25em; background: var(--deep-ink); }
.profile-chip .flip-digit::after { background: var(--ink); }
.profile-chip .chip-points::before { content: "✦"; color: var(--yellow); padding-right: 4px; }
/* When it receives points it jolts as the CRT does, not as a cell does. */
.profile-chip.jolt { --impact-distance: var(--impact-verdict); }

/* A result its author has not opened yet: the club's hot colour, on the corner. */
.profile-chip.unread::after {
  content: "";
  position: absolute;
  top: -6px;
  right: -6px;
  width: 12px;
  height: 12px;
  background: var(--magenta);
  border: 2px solid var(--paper);
}
```

- [ ] **Step 6: Run the tests**

Run: `cd app && npx vitest run src/signage.test.js src/home.test.js src/player.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/signage.js app/src/signage.test.js app/src/animation.js app/public/shell.css
git commit -m "Chip: the player's points as flip tiles, and a dot while a result waits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The animation primitives and the reveal sequencer

**Files:**
- Modify: `app/src/animation.js` (append)
- Create: `app/src/reveal.js`, `app/src/reveal.test.js`
- Modify: `app/public/race.css` (append the `fly-to-chip` keyframes)

**Interfaces:**
- Consumes: `cue`, `followCounter` from `sound.js` (Task 5); `flipTiles` (Task 6).
- Produces in `animation.js`: `ended(node, name, pseudo, signal)`, `slam(node, {support, contact, signal})`, `spread(count)`, `confetti(root, count, signal)`, `rollCounter(flip, signal)`, `climb(pegboard, rows, climber, signal)`, `fly(sticker, target, signal)`.
- Produces in `reveal.js`: `revealFor(run, me, reducedMotion) → boolean`; `climbPlan(board) → {start, end}` (arrays of board rows, `start === end` when nothing is under you); `reveal(parts, show, signal) → Promise` where
  - `parts = { page, chip, chipFlip, score, stamp, crt, flip, boardBox, pegboard, pegRows /* Map run_id → element */, pointsBox, stickers /* elements in receipts order */ }`
  - `show = { run, plan, receipts, raced /* Promise */, startPoints, onSeen }`
  - the signal's `reason` is `"skip"` (Space: settle and mark seen) or `"leave"` (navigation: settle, do not mark seen).

- [ ] **Step 1: Write the failing tests**

Create `app/src/reveal.test.js`:

```js
import { describe, expect, it } from "vitest";
import { climbPlan, revealFor } from "./reveal.js";

const run = { user: "ann", seen: false };

describe("revealFor", () => {
  it("reveals only to the author, once, with motion allowed", () => {
    expect(revealFor(run, { user: "ann" })).toBe(true);
    expect(revealFor(run, { user: "bob" })).toBe(false);
    expect(revealFor({ ...run, seen: true }, { user: "ann" })).toBe(false);
    expect(revealFor(run, { user: "ann" }, true)).toBe(false);
    expect(revealFor(run, null)).toBe(false);
  });
});

describe("climbPlan", () => {
  const row = (rank, you = false) => ({ rank, run_id: `R${rank}`, you });

  it("starts you at the bottom of the window, the rows under you one place up", () => {
    const board = [row(5), row(6), row(7, true), row(8), row(9)];
    const { start, end } = climbPlan(board);
    expect(start.map((r) => [r.run_id, r.rank])).toEqual([
      ["R5", 5], ["R6", 6], ["R8", 7], ["R9", 8], ["R7", 9],
    ]);
    expect(end).toBe(board);
  });

  it("has nothing to climb when nobody is under you", () => {
    const board = [row(1), row(2, true)];
    const { start, end } = climbPlan(board);
    expect(start).toBe(end);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/reveal.test.js`
Expected: FAIL, `./reveal.js` does not exist.

- [ ] **Step 3: Port the primitives**

Append to `app/src/animation.js`:

```js
/** Resolves when `name` ends on `node` (or its `pseudo` element), or when the signal aborts. */
export const ended = (node, name, pseudo = "", signal) =>
  new Promise((there) => {
    const finish = () => {
      node.removeEventListener("animationend", done);
      signal?.removeEventListener("abort", finish);
      there();
    };
    const done = (event) => {
      if (event.target !== node || event.animationName !== name || event.pseudoElement !== pseudo) {
        return;
      }
      finish();
    };
    if (signal?.aborted) return there();
    node.addEventListener("animationend", done);
    signal?.addEventListener("abort", finish, { once: true });
  });

/** The stamp comes down on its support; `contact` fires at the moment of impact. */
export async function slam(node, { support = null, contact = () => {}, signal } = {}) {
  node.hidden = false;
  if (signal?.aborted) return;
  // Subscribe before adding classes, including when reduced motion ends both phases at once.
  const landed = ended(node, "stamp-contact", "", signal).then(() => {
    if (!signal?.aborted) contact();
  });
  const settled = ended(node, "stamp-slam", "", signal);
  const jolted = support === null ? null : ended(support, "jolt", "", signal);
  node.classList.add("stamp-slam");
  support?.classList.add("jolt", "stamp-impact");
  try {
    await Promise.all([landed, settled, jolted]);
  } finally {
    node.classList.remove("stamp-slam");
    support?.classList.remove("jolt", "stamp-impact");
  }
}

/** Seeded, so the confetti falls the same way every time. */
export function spread(count) {
  let state = 7;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, () => ({
    x: random(),
    lag: random(),
    sway: (random() - 0.5) * 2,
  }));
}

export async function confetti(root, count = 48, signal) {
  const layer = document.createElement("div");
  layer.className = "confetti-fall";
  layer.setAttribute("aria-hidden", "true");
  const strips = spread(count).map((piece) => {
    const strip = document.createElement("span");
    strip.className = "confetti-piece";
    strip.style.setProperty("--confetti-x", `${(piece.x * 100).toFixed(1)}%`);
    strip.style.setProperty("--confetti-lag", piece.lag.toFixed(2));
    strip.style.setProperty("--confetti-sway", `${Math.round(piece.sway * 40)}px`);
    return strip;
  });
  layer.replaceChildren(...strips);
  root.append(layer);
  await Promise.all(strips.map((strip) => ended(strip, "confetti-fall", "", signal)));
  layer.remove();
}

/**
 * Roll every tile of a `.flip` to the digit it already shows. The number is in
 * the DOM before the theatre starts; the roll is drawn on the tiles' faces.
 */
export async function rollCounter(flip, signal) {
  if (signal?.aborted) return;
  const tiles = [...flip.querySelectorAll(".flip-digit")];
  const done = tiles.map((tile) => ended(tile, "flip-roll", "::after", signal));
  for (const tile of tiles) {
    const from = (Number(tile.textContent) + 1) % 10;
    tile.style.setProperty("--flip-from", from);
    tile.style.setProperty("--flip-to", from + 9);
    tile.classList.add("flip-roll");
  }
  await Promise.all(done);
  for (const tile of tiles) {
    tile.classList.remove("flip-roll");
    tile.style.removeProperty("--flip-from");
    tile.style.removeProperty("--flip-to");
  }
}

/**
 * The pegboard climb, design/motion.css's `.rank-climb` beat.
 *
 * `rows` are the `.pegboard-row` elements in their FINAL order; `climber` is
 * the one that moves up. Call with the DOM still in the starting order: this
 * measures where each row was, reorders the DOM, measures where each is, and
 * animates every moved row from the one to the other. Ends on the climber's
 * peg-drop. A climber that does not move ends at once.
 */
export async function climb(pegboard, rows, climber, signal) {
  const was = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
  pegboard.replaceChildren(...rows);
  const moved = rows.filter((row) => row.getBoundingClientRect().top !== was.get(row));
  if (signal?.aborted || !moved.includes(climber)) return;
  // The displaced rows drop one peg each, bottom-most first, so the last to
  // fall has cleared its peg before the climber lands on it.
  const displaced = moved.filter((row) => row !== climber).reverse();
  const landed = ended(climber, "peg-drop", "", signal);
  for (const row of moved) {
    row.style.setProperty("--peg-dy", `${was.get(row) - row.getBoundingClientRect().top}px`);
  }
  displaced.forEach((row, order) => {
    row.style.setProperty("--peg-order", order);
    row.classList.add("rank-shuffle");
  });
  climber.classList.add("rank-climb");
  try {
    await landed;
  } finally {
    for (const row of moved) {
      row.classList.remove("rank-climb", "rank-shuffle");
      row.style.removeProperty("--peg-dy");
      row.style.removeProperty("--peg-order");
    }
  }
}

/**
 * A copy of the sticker flies to the target and shrinks into it (race.css's
 * `fly-to-chip`), then is gone. The sticker itself stays where it is.
 */
export async function fly(sticker, target, signal) {
  if (signal?.aborted) return;
  const from = sticker.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const ghost = sticker.cloneNode(true);
  ghost.classList.add("fly");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    margin: "0",
  });
  ghost.style.setProperty("--fly-x", `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
  ghost.style.setProperty("--fly-y", `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
  const flown = ended(ghost, "fly-to-chip", "", signal);
  document.body.append(ghost);
  await flown;
  ghost.remove();
}
```

- [ ] **Step 4: The flight's keyframes**

Append to `app/public/race.css`:

```css
/* ── a receipt on its way to the chip ─────────────────────────────────── */

/* The copy travels the vector the page measured and shrinks into the chip. */
.sticker.fly {
  z-index: 3;
  pointer-events: none;
  animation: fly-to-chip var(--t-roll) var(--ease-hard) both;
}
@keyframes fly-to-chip {
  to { translate: var(--fly-x) var(--fly-y); scale: 0.3; opacity: 0.4; }
}
```

- [ ] **Step 5: Write `reveal.js`**

Create `app/src/reveal.js`:

```js
// The reveal: the author's first look at a result, as a sequence of beats.
//
// `revealFor` and `climbPlan` are pure. `reveal` drives the DOM the page built,
// one act at a time, on design/motion.css's animationend events; aborting the
// signal jumps every wait to its end, and `settle` puts the page in the state
// plain mode renders directly.

import { climb, confetti, ended, flipTiles, fly, rollCounter, slam } from "./animation.js";
import { cue, followCounter } from "./sound.js";

/** Whether this visit reveals: the author, a result never seen, motion allowed. */
export function revealFor(run, me, reducedMotion = false) {
  return Boolean(me?.user) && me.user === run.user && !run.seen && !reducedMotion;
}

/**
 * The pegboard before and after the climb.
 *
 * `board` is the window the server sent, in board order, one row `you`. Before
 * the climb you sit in the last slot and the rows under you stand one place
 * higher — the board as it was before your run — so every row is renumbered to
 * match. The end state is the window as sent. Same array twice when nothing is
 * under you: there is nothing to climb.
 */
export function climbPlan(board) {
  const at = board.findIndex((row) => row.you);
  const under = board.slice(at + 1);
  if (!under.length) return { start: board, end: board };
  const start = [
    ...board.slice(0, at),
    ...under.map((row) => ({ ...row, rank: row.rank - 1 })),
    { ...board[at], rank: under[under.length - 1].rank },
  ];
  return { start, end: board };
}

function setRanks(pegRows, order) {
  for (const row of order) {
    pegRows.get(row.run_id).querySelector(".pegboard-rank").textContent = String(row.rank);
  }
}

/**
 * Play the reveal on a page run.js built.
 *
 * `raced` resolves when the author's lane reaches its last frame. `onSeen` is
 * called once, when the theatre ends or is skipped — not when the page is left
 * mid-way (`signal.reason === "leave"`), so the dot stays for a result that was
 * not actually seen.
 */
export async function reveal(parts, show, signal) {
  const { page, chip, chipFlip, score, stamp, crt, flip } = parts;
  const { boardBox, pegboard, pegRows, pointsBox, stickers } = parts;
  const { run, plan, receipts, raced, startPoints, onSeen } = show;
  const act = (name) => {
    page.dataset.act = name;
  };
  let total = startPoints;

  const settle = () => {
    act("rest");
    score.hidden = stamp.hidden = boardBox.hidden = pointsBox.hidden = false;
    for (const sticker of stickers) sticker.hidden = false;
    setRanks(pegRows, plan.end);
    pegboard.replaceChildren(...plan.end.map((row) => pegRows.get(row.run_id)));
    chipFlip.replaceChildren(...flipTiles(startPoints + receipts.reduce((s, r) => s + r.points, 0)));
    chip.classList.remove("jolt");
    if (signal.reason !== "leave") onSeen();
  };

  try {
    act("race");
    await raced;
    if (signal.aborted) return;

    if (run.seeds_finished > 0) {
      act("celebrate");
      cue("win");
      await confetti(page, 48, signal);
      if (signal.aborted) return;
    }

    act("verdict");
    score.hidden = false;
    await slam(stamp, { support: crt, signal, contact: () => cue("stamp") });
    if (signal.aborted) return;

    act("time");
    const tile = flip.querySelector(".flip-digit");
    const silence = tile ? followCounter(tile) : () => {};
    await rollCounter(flip, signal);
    silence();
    if (signal.aborted) return;

    boardBox.hidden = false;
    if (plan.start !== plan.end) {
      act("climb");
      cue("climb");
      cue("chirp");
      setRanks(pegRows, plan.end);
      const rows = plan.end.map((row) => pegRows.get(row.run_id));
      await climb(pegboard, rows, pegRows.get(run.run_id), signal);
      if (signal.aborted) return;
    }

    act("points");
    pointsBox.hidden = false;
    for (const [i, sticker] of stickers.entries()) {
      sticker.hidden = false;
      await fly(sticker, chip, signal);
      if (signal.aborted) return;
      total += receipts[i].points;
      chipFlip.replaceChildren(...flipTiles(total));
      chip.classList.add("jolt");
      await Promise.all([ended(chip, "jolt", "", signal), rollCounter(chipFlip, signal)]);
      chip.classList.remove("jolt");
      if (signal.aborted) return;
    }
  } finally {
    settle();
  }
}
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd app && npx vitest run src/reveal.test.js src/signage.test.js && npm run build`
Expected: PASS; the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/src/animation.js app/src/reveal.js app/src/reveal.test.js app/public/race.css
git commit -m "Theatre: Duck Jam's primitives ported, a pegboard climb, a flight to the chip, and the reveal in beats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The run page

**Files:**
- Create: `app/src/run.js`
- Modify: `app/src/main.js`, `app/public/race.css` (append)

**Interfaces:**
- Consumes: `getRun`, `getMe`, `getTrace`, `markSeen` (`api.js`); `createViewer` and `setLanes(entries, event, playerOptions)` (Task 5); `Player.loop` (Task 5); `revealFor`, `climbPlan`, `reveal` (Task 7); `flipTiles` (Task 6); `LANE_CSS` (`course.js`); `formatScore` (`format.js`); `CTRL_DT`, `frameCount` (`replay.js`); `signage` (`signage.js`); `load` from `sound.js`.
- Produces: `renderRun(root, runId, state)`; `state.teardown` — a function `main.js` calls before rendering the next view.

- [ ] **Step 1: Write `run.js`**

Create `app/src/run.js`:

```js
// One publication: the replay of the run against the ducks ranked just under
// it, the time it set, where it stands on the event's board, what it earned.
//
// Two modes. Plain shows all of it at once and loops the replay. Reveal — the
// author's first look — hides the result and plays it in beats (reveal.js).

import { getMe, getRun, getTrace, markSeen } from "./api.js";
import { flipTiles } from "./animation.js";
import { LANE_CSS } from "./course.js";
import { formatScore } from "./format.js";
import { CTRL_DT, frameCount } from "./replay.js";
import { climbPlan, reveal, revealFor } from "./reveal.js";
import { playerHref, raceHref, runHref } from "./router.js";
import { signage } from "./signage.js";
import { load as loadSounds } from "./sound.js";
import { createViewer } from "./viewer.js";

// How many of the ducks ranked just under this run race beside it.
const RIVALS = 3;

const TONES = {
  first_event: "sticker-lime",
  run: "sticker-cyan",
  own_best: "sticker-lavender",
  podium: "sticker-magenta",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The lanes on the stage: this run first, then the rows ranked just under it. */
export function lanesFor(run) {
  const at = run.board.findIndex((row) => row.you);
  return [run.board[at], ...run.board.slice(at + 1, at + 1 + RIVALS)];
}

/** Which seed the stored replay is, and why that one. */
function replayLine(run) {
  const finishers = run.per_seed.filter((s) => s.status === "finish").length;
  const which =
    finishers > 1 ? "median finisher" : finishers === 1 ? "the one finisher" : "furthest attempt";
  return `${run.command_vx.toFixed(2)} m/s · replay: seed ${run.trace_seed}, ${which}`;
}

function receiptLabel(receipt, eventTitle) {
  const what = {
    first_event: `first entry on ${eventTitle}`,
    run: "run",
    own_best: "personal best",
    podium: "podium · held",
  }[receipt.act];
  return `+${receipt.points} ${what}`;
}

export function pegRow(row) {
  const link = el("a", row.you ? "pegboard-row pegboard-row-you" : "pegboard-row");
  link.href = runHref(row.run_id);
  const name = el("span", "pegboard-name", `@${row.user}`);
  name.append(el("span", "pegboard-repo", row.policy_name));
  link.append(
    el("span", "pegboard-rank", String(row.rank)),
    name,
    el("span", "pegboard-score", formatScore(row.score, { finished: row.seeds_finished })),
  );
  return link;
}

export async function renderRun(root, runId, state) {
  const [run, me] = await Promise.all([getRun(runId), getMe()]);
  root.replaceChildren(signage(me));
  const revealing = revealFor(run, me, matchMedia("(prefers-reduced-motion: reduce)").matches);
  const earned = run.receipts.reduce((sum, r) => sum + r.points, 0);
  const plan = climbPlan(run.board);
  const lanes = lanesFor(run);
  const dnf = run.seeds_finished === 0;

  const page = el("main", "hall run");
  page.dataset.act = revealing ? "race" : "rest";
  page.innerHTML = `
    <p class="eyebrow">Publication</p>
    <h2 class="racetitle" id="title"></h2>
    <p class="run-byline mono-label" id="byline"></p>
    <div class="stage"><canvas id="stage"></canvas></div>
    <ul class="key run-legend" id="legend"></ul>
    <section class="run-score" id="score">
      <div class="scoreboard"><span class="mono-label">time</span><div class="flip" id="flip"></div></div>
      <div class="crt-screen" id="crt"><span class="stamp" id="stamp"></span></div>
      <p class="mono-label run-facts" id="facts"></p>
    </section>
    <section class="run-board" id="board"><div class="pegboard" id="pegboard"></div></section>
    <section class="run-receipts" id="points"></section>
    <section class="run-details">
      <h3 class="eyebrow">Seeds</h3>
      <table class="run-seeds"><tbody id="seeds"></tbody></table>
      <p class="run-links" id="links"></p>
    </section>
  `;
  root.append(page);
  const $ = (id) => page.querySelector(`#${id}`);

  $("title").textContent = run.event.title;
  const who = el("a", null, `@${run.user}`);
  who.href = playerHref(run.user);
  $("byline").append(who, ` · ${run.policy_name} · ${run.submitted_at.slice(0, 10)}`);
  if (run.withdrawn) $("byline").append(" · ", el("span", "sticker sticker-magenta", "withdrawn"));
  else if (!run.on_board) $("byline").append(" · ", el("span", "sticker", "not on the board"));

  // The score is in the DOM before any theatre: the roll is drawn over it.
  $("flip").append(...flipTiles(dnf ? "DNF" : run.score.toFixed(3)));
  const stamp = $("stamp");
  stamp.textContent = dnf ? "DNF" : `FINISHED ${run.seeds_finished}/${run.seeds_total}`;
  stamp.classList.add(dnf ? "stamp-fail" : "stamp-pass");
  stamp.hidden = revealing;
  $("facts").textContent = replayLine(run);

  // The pegboard, in its starting order when revealing: you at the bottom.
  const pegRows = new Map(plan.end.map((row) => [row.run_id, pegRow(row)]));
  const order = revealing ? plan.start : plan.end;
  for (const row of order) {
    pegRows.get(row.run_id).querySelector(".pegboard-rank").textContent = String(row.rank);
  }
  $("pegboard").append(...order.map((row) => pegRows.get(row.run_id)));

  const stickers = run.receipts.map((r) =>
    el("span", `sticker ${TONES[r.act]}`, receiptLabel(r, run.event.title)),
  );
  for (const sticker of stickers) sticker.hidden = revealing;
  $("points").append(...stickers);
  if (!stickers.length) $("points").append(el("p", "mono-label", "no points from this run"));

  for (const s of run.per_seed) {
    const tr = el("tr", s.seed === run.trace_seed ? "replayed" : null);
    tr.append(
      el("td", null, `seed ${s.seed}`),
      el("td", null, s.status),
      el("td", null, s.time_s == null ? "—" : `${s.time_s.toFixed(3)}s`),
    );
    $("seeds").append(tr);
  }
  const back = el("a", null, `Back to ${run.event.title}`);
  back.href = raceHref(run.event.id);
  $("links").append(back);
  if (run.offers_download) {
    const grab = el("a", null, "Download .onnx");
    grab.href = run.policy_url || `/api/runs/${run.run_id}/policy`;
    grab.setAttribute("download", "");
    $("links").append(grab);
  }
  if (run.env_url) {
    const env = el("a", null, "Training environment");
    env.href = run.env_url;
    env.target = "_blank";
    env.rel = "noopener noreferrer";
    $("links").append(env);
  }

  for (const box of [$("score"), $("board"), $("points")]) box.hidden = revealing;

  // The stage: this run in lane one, the three under it beside, all solid.
  const viewer = await createViewer($("stage"), { rig: run.event.rig });
  state.viewer = viewer;
  const traces = await Promise.all(lanes.map((lane) => getTrace(lane.run_id)));
  lanes.forEach((lane, i) => {
    const item = el("li");
    item.style.setProperty("--lane", LANE_CSS[i % LANE_CSS.length]);
    item.append(
      el("strong", null, `@${lane.user}`),
      ` ${formatScore(lane.score, { finished: lane.seeds_finished })}`,
    );
    $("legend").append(item);
  });
  let crossed;
  const raced = new Promise((resolve) => {
    crossed = resolve;
  });
  const line = (frameCount(traces[0]) - 1) * CTRL_DT;
  viewer.setLanes(
    lanes.map((lane, i) => ({
      runId: lane.run_id,
      trace: traces[i],
      livery: lane.livery,
      tier: i === 0 ? "leader" : "ghost",
      opacity: 1,
    })),
    run.event,
    revealing ? { loop: false, onTick: (t) => t >= line && crossed() } : {},
  );
  if (!revealing) return;

  // The reveal. The chip starts at the total BEFORE this run, since /api/me
  // already counts it; Space skips; leaving the page abandons without marking.
  loadSounds();
  const chip = root.querySelector(".profile-chip");
  const chipFlip = chip.querySelector(".flip");
  chipFlip.replaceChildren(...flipTiles(me.points - earned));
  const theatre = new AbortController();
  const lifetime = new AbortController();
  state.teardown = () => {
    lifetime.abort();
    theatre.abort("leave");
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "Space" || event.target.closest("button, a, input, select, textarea")) {
        return;
      }
      event.preventDefault();
      theatre.abort("skip");
    },
    { signal: lifetime.signal },
  );
  await reveal(
    {
      page,
      chip,
      chipFlip,
      score: $("score"),
      stamp,
      crt: $("crt"),
      flip: $("flip"),
      boardBox: $("board"),
      pegboard: $("pegboard"),
      pegRows,
      pointsBox: $("points"),
      stickers,
    },
    {
      run,
      plan,
      receipts: run.receipts,
      raced,
      startPoints: me.points - earned,
      onSeen: () => {
        markSeen(run.run_id).catch(() => {});
        if (me.unseen <= 1) chip.classList.remove("unread");
        viewer.player.loop = true;
        viewer.player.play();
      },
    },
    theatre.signal,
  );
}
```

- [ ] **Step 2: Dispatch the view**

In `app/src/main.js`: add `import { renderRun } from "./run.js";`, change the state line to

```js
const state = { events: null, viewer: null, teardown: null };
```

change the header comment to `// Four views, chosen by the hash. Everything else lives in its view.`, and in `show()` replace

```js
  state.viewer?.dispose();
  state.viewer = null;
```

with

```js
  state.viewer?.dispose();
  state.viewer = null;
  // A reveal in progress is abandoned, not finished, when the page is left.
  state.teardown?.();
  state.teardown = null;
```

and add the branch before the `player` one:

```js
    } else if (route.view === "run") {
      await renderRun(root, route.runId, state);
```

- [ ] **Step 3: Place the page**

Append to `app/public/race.css`:

```css
/* ── a publication: the run page ─────────────────────────────────────── */

.run-byline { margin: 0 0 14px; color: var(--ink-70); }
.run-byline a { color: var(--sky-inked); }
.run-byline .sticker { font-size: 0.7rem; padding: 2px 8px; }

/* The stage's key: one entry per lane, in the lane's own stripe colour. */
.run-legend li { color: var(--lane); }
.run-legend li::before { background: var(--lane); border-color: var(--lane); }
.run-legend strong { color: var(--ink); }

/* The score: the split-flap board and the CRT the stamp lands on, side by side. */
.run-score {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  margin: 26px 0;
}
@media (max-width: 760px) { .run-score { grid-template-columns: minmax(0, 1fr); } }
.run-score .scoreboard { align-items: center; }
.run-score .flip { font-size: clamp(2rem, 6vw, 3.6rem); }
.run-score .crt-screen {
  display: grid;
  place-items: center;
  min-height: 7rem;
  aspect-ratio: auto;
  overflow: visible; /* the stamp overshoots the bezel as it lands */
  box-shadow: var(--shadow-card-min) var(--shadow-card-min) var(--shadow-blur) var(--ink);
}
.run-score .stamp { font-size: clamp(1.4rem, 4vw, 2.6rem); rotate: calc(-1 * var(--rotate-2-5)); }
.run-facts { grid-column: 1 / -1; margin: 0; color: var(--ink-70); }

/* The pegboard: a window of the board, this run's row in lime, each row a link. */
.run-board { margin: 26px 0; }
.pegboard-row { color: inherit; text-decoration: none; }
.pegboard-row:hover { background: var(--cream); }
.pegboard-row-you:hover { background: var(--lime); }

/* What the run earned, one sticker per receipt. */
.run-receipts { display: flex; flex-wrap: wrap; gap: 14px; margin: 26px 0; }
.run-receipts .mono-label { color: var(--ink-70); }

.run-details { margin-top: 26px; }
.run-seeds { border-collapse: collapse; margin: 8px 0 18px; }
.run-seeds td { padding: 4px 14px 4px 0; font-variant-numeric: tabular-nums; }
.run-seeds .replayed { color: var(--orange-inked); }
.run-links { display: flex; flex-wrap: wrap; gap: 18px; margin: 0; }
.run-links a { color: var(--orange-inked); }
```

- [ ] **Step 4: Build, then look at it**

```bash
cd app && npm run build && cd ..
rm -rf ~/arena-board-pub && for u in alice bob carol dave; do
  uv run --frozen arena score arena/assets/policies/BEST_alpha_walking.onnx --event sprint-2m --user $u --name walker-$u --store ~/arena-board-pub
done
uv run --frozen arena score arena/assets/policies/BEST_alpha_walking.onnx --event sprint-2m --user nicolas --name mine --store ~/arena-board-pub
ls ~/arena-board-pub/runs/sprint-2m/
uv run --frozen arena serve --store ~/arena-board-pub --user nicolas
```

Open <http://127.0.0.1:8000/#/r/RUN_ID> with the LAST run id listed (the one by `nicolas`). Expected, in order: the header chip shows `✦ 0`-ish tiles (the total before this run) with a magenta dot; the stage races your duck and up to three others, then holds at the line; victory sound and confetti; the scoreboard appears, the stamp slams; the digits roll with ticks; the pegboard appears with your row at the bottom and climbs to its place; each receipt sticker appears and a copy flies to the chip, which jolts and rolls up; the replay resumes looping. Reload: the page is plain, the dot is gone, `~/arena-board-pub/seen/` holds one file. Open the same page after restarting the server with `--user alice`: plain. Fix what is broken before moving on — the console is where a hung beat shows itself (an `animationend` that never fired).

Identical times for every user are expected — same policy — so the ranks fall to `submitted_at`; that is fine for looking at the page.

- [ ] **Step 5: Run the JS suite**

Run: `cd app && npx vitest run`
Expected: everything passes but the 4 pre-existing `brightness.test.js` failures.

- [ ] **Step 6: Commit**

```bash
git add app/src/run.js app/src/main.js app/public/race.css
git commit -m "The publication page: the run against the ducks under it, its time, its place, its points — revealed once to its author

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The ways in — board rows, the profile, and the publish landing

**Files:**
- Modify: `app/src/board.js:110-121` (inside the row loop), `app/public/race.css` (one rule)
- Modify: `app/src/player.js:16-58` (`profile`), `:61-67` (`renderPlayer`), `app/public/club.css` (append)
- Modify: `app/src/race.js:414-419` (`onPublish`)
- Test: `app/src/player.test.js`

**Interfaces:**
- Consumes: `runHref` (Task 5); `publications` payload (Task 4).
- Produces: a click on a published board row navigates to `runHref(runId)`; `profile(player, me)` renders `player.publications`; a completed publish navigates to the run's page.

- [ ] **Step 1: Rewrite the profile test**

In `app/src/player.test.js`, replace the `ann` fixture and the second test:

```js
const ann = {
  user: "ann",
  points: 655,
  rank: 1,
  publications: [
    { run_id: "r3", event_id: "hill-climb-1m5", event_title: "1.5 m Hill Climb", rank: 2,
      score: 50.0, seeds_finished: 0, seeds_total: 5, policy_name: "hill", on_board: true,
      withdrawn: false, submitted_at: "2026-09-03T11:00:00Z", seen: false },
    { run_id: "r2", event_id: "sprint-2m", event_title: "2 m Sprint", rank: 1, score: 20.0,
      seeds_finished: 5, seeds_total: 5, policy_name: "v2", on_board: true, withdrawn: false,
      submitted_at: "2026-09-03T10:00:00Z", seen: true },
    { run_id: "r1", event_id: "sprint-2m", event_title: "2 m Sprint", rank: 1, score: 30.0,
      seeds_finished: 5, seeds_total: 5, policy_name: "v1", on_board: false, withdrawn: true,
      submitted_at: "2026-09-03T09:00:00Z", seen: true },
  ],
};
```

```js
  it("lists every publication newest first, linking to each run's page", () => {
    const el = profile(ann, { user: "ann" });
    expect(el.querySelector("h3.eyebrow").textContent).toBe("Publications");
    const items = [...el.querySelectorAll(".profile-results a")];
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["#/r/r3", "#/r/r2", "#/r/r1"]);
    // A DNF says so rather than printing the time limit as an achieved time.
    expect(items[0].textContent).toContain("#2 · DNF");
    expect(items[1].textContent).toContain("#1 · 20.000s");
    // The owner sees a dot on a result never opened; a withdrawn run says so.
    expect(items[0].classList.contains("unread")).toBe(true);
    expect(items[1].classList.contains("unread")).toBe(false);
    expect(items[2].classList.contains("withdrawn")).toBe(true);
    expect(items[2].textContent).toContain("withdrawn");
    // Another viewer never sees the dot.
    expect(profile(ann, { user: "bob" }).querySelector(".unread")).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/player.test.js`
Expected: FAIL (`player.best` is undefined).

- [ ] **Step 3: Rewrite `profile` and `renderPlayer`**

In `app/src/player.js`, change the router import to `import { menuHref, runHref } from "./router.js";` and replace `profile` and `renderPlayer`:

```js
export function profile(player, me = null) {
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
    el("span", "sticker sticker-cyan", player.rank == null ? "#—" : `#${player.rank}`),
  );

  // Every run, newest first, each the way to its own page. The dot is the
  // owner's alone: it says a result of THEIRS waits to be opened.
  const list = el("ul", "profile-results");
  for (const pub of player.publications) {
    const item = el("li");
    const link = el("a", pub.withdrawn ? "withdrawn" : null);
    link.href = runHref(pub.run_id);
    if (me?.user === player.user && !pub.seen) link.classList.add("unread");
    link.append(
      el("span", "eyebrow", pub.event_title),
      el("strong", null, `#${pub.rank} · ${formatScore(pub.score, { finished: pub.seeds_finished })}`),
      el("span", "mono-label", pub.withdrawn ? `${pub.policy_name} · withdrawn` : pub.policy_name),
      el("span", "profile-date", pub.submitted_at.slice(0, 10)),
    );
    item.append(link);
    list.append(item);
  }

  box.append(header, summary, el("h3", "eyebrow", "Publications"), list);
  return box;
}
```

```js
export async function renderPlayer(root, user) {
  const [player, me] = await Promise.all([getPlayer(user), getMe()]);
  root.replaceChildren(signage(me));
  const hall = el("main", "hall");
  hall.append(player ? profile(player, me) : noProfile(user));
  root.append(hall);
}
```

Update the file's header comment to: `// One player: their picture and name, what their publications earned, where they stand, and every run they published, newest first.`

- [ ] **Step 4: Place the cards' dot and the withdrawn state**

Append to `app/public/club.css`:

```css
.profile-results a { position: relative; }
.profile-results a.withdrawn { color: var(--ink-70); background: var(--warm-paper); }
.profile-results a.unread::after {
  content: "";
  position: absolute;
  top: -7px;
  right: -7px;
  width: 14px;
  height: 14px;
  background: var(--magenta);
  border: 3px solid var(--ink);
}
.profile-date { color: var(--ink-70); font-size: 0.85rem; }
```

- [ ] **Step 5: Make board rows the way to a run's page**

In `app/src/board.js`, add `import { runHref } from "./router.js";` and, inside the `for (const row of built)` loop right after `tr.classList.add(\`tier-${row.tier}\`);`, add:

```js
    if (!row.provisional) {
      // The row is the way to the run's page. Its own controls — the lane box,
      // the two links, the withdraw button — keep their own behaviour.
      tr.classList.add("linked");
      tr.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input")) return;
        location.hash = runHref(row.runId);
      });
    }
```

Add to `app/public/race.css`, after `table.board tbody tr:hover { background: var(--cream); }`:

```css
table.board tr.linked { cursor: pointer; }
```

- [ ] **Step 6: Land on the run's page after a publish**

In `app/src/race.js`, add `runHref` to the router import (`import { runHref } from "./router.js";` — the file has no router import yet) and replace `onPublish`:

```js
    onPublish: async ({ file, name, livery, commandVx, envUrl }) => {
      const published = await submitPolicy(event.id, file, name, livery, commandVx, envUrl);
      // The result has its own page now, and the reveal plays there.
      location.hash = runHref(published.run_id);
      return published;
    },
```

- [ ] **Step 7: Run the suite and the build; look at the three ways in**

Run: `cd app && npx vitest run && npm run build`
Expected: PASS but the 4 pre-existing failures; build OK.

Then `uv run --frozen arena serve --store ~/arena-board-pub --user nicolas` and check: the home ladder → a player page lists publications newest first with a date each; your own page shows a dot on any run you have not opened; a click on a board row of `#/e/sprint-2m` opens its run page; the lane checkbox and the download glyph still do their own thing. Publish a policy from the race page (drop `arena/assets/policies/BEST_alpha_walking.onnx`): the page lands on the new run and the reveal plays.

- [ ] **Step 8: Commit**

```bash
git add app/src/board.js app/src/player.js app/src/player.test.js app/src/race.js app/public/race.css app/public/club.css
git commit -m "Ways in: board rows open a run, the profile lists publications with a dot, a publish lands on its page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Whole-suite verification

**Files:** none new.

- [ ] **Step 1: Python**

Run: `uv run --frozen pytest -q -m "not network" && uv run --frozen ruff check arena tests`
Expected: PASS, ruff clean.

- [ ] **Step 2: JavaScript and the bundle**

Run: `cd app && npx vitest run; npm run build`
Expected: every file passes except `brightness.test.js`'s 4 pre-existing failures; the build succeeds.

- [ ] **Step 3: Dead code**

Run: `grep -rn "boards_by_user\|\"best\"\|frames" arena/web tests/test_routes_read.py app/src/player.js app/src/run.js`
Expected: no hit for `boards_by_user` in `routes_read.py`, none for `"best"` in the player route or `player.js`, none for `frames` in `run_detail`.

- [ ] **Step 4: The state of the tree**

Run: `git status --short`
Expected: only `?? .claude/`. Nothing is pushed.
