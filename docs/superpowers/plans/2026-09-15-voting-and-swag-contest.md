# Voting, and the Swag Contest — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voting to the Arena as a manifest-driven capability, and ship Swag Contest as its first client — a challenge on the sprint's course, ranked on votes received over a sliding seven-day window.

**Architecture:** A second append-only log (one immutable file per ballot, sharded by day) beside the run log, folded into a ranking on every read. Nothing is stored ranked. The event manifest's `[vote]` section carries every rule, so a future challenge becomes votable without touching code. The frontend reads `event.vote` and never names `swag-contest`.

**Tech Stack:** Python 3.13, FastAPI, `huggingface_hub`, pytest. Frontend: vanilla ES modules, three.js, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-15-voting-and-swag-contest-design.md`

## Global Constraints

- **Run Python through uv with `--frozen`**: `uv run --frozen pytest …`. The local uv mirror config rewrites `uv.lock` otherwise.
- **JS tests**: `cd app && npx vitest run src/<file>.test.js`. `app/src/brightness.test.js` has 4 pre-existing failures under Node 25 — ignore them, they are not yours.
- **Timestamps are strings compared as strings**: `datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")`, never `isoformat()` — an offset would misorder the log. This is already the convention in `routes_submit.py:344`.
- **`arena/votes.py` and `arena/points.py` are pure and I/O-free.** No clock reads, no filesystem, no network. `now` is a parameter.
- **Records live in `store.py`, folds live in `index.py` / `points.py` / `votes.py`.** `votes.py` imports `RunRecord`; `store.py` must never import `votes.py`.
- **Ruff line length is 100.** Run `uv run --frozen ruff check arena tests` before each commit.
- **Never `git push`.** A push to `main` deploys the live Space.

---

### Task 1: Rename `new_run_id` to `new_id`

It is about to name two species of thing. Mechanical, on its own commit so the real work reads clean.

**Files:**
- Modify: `arena/store.py:28`
- Modify: `arena/recover.py:203,215`
- Modify: `arena/cli.py:18,49`
- Modify: `arena/web/routes_submit.py:34,340`
- Test: `tests/test_store.py:5,10,31`

**Interfaces:**
- Consumes: nothing
- Produces: `arena.store.new_id() -> str` — a time-ordered unique id. Every later task uses it.

- [ ] **Step 1: Rename the function and its docstring**

In `arena/store.py`, rename `def new_run_id() -> str:` to `def new_id() -> str:` and change the first docstring line from

```python
    """A time-ordered unique id, so run ids sort chronologically.
```

to

```python
    """A time-ordered unique id, so records sort chronologically.
```

- [ ] **Step 2: Update every call site**

```bash
cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena
grep -rl "new_run_id" --include="*.py" . --exclude-dir=.venv | xargs sed -i '' 's/new_run_id/new_id/g'
```

- [ ] **Step 3: Verify nothing is left**

Run: `grep -rn "new_run_id" --include="*.py" . --exclude-dir=.venv`
Expected: no output.

- [ ] **Step 4: Run the whole suite**

Run: `uv run --frozen pytest -q -m "not network"`
Expected: PASS, same count as before the rename.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rename new_run_id to new_id: it is about to name ballots too"
```

---

### Task 2: The `[vote]` manifest section, and swag-contest.toml

**Files:**
- Modify: `arena/manifest.py`
- Create: `arena/events/swag-contest.toml`
- Modify: `arena/web/routes_read.py` (`event_summary`)
- Test: `tests/test_manifest.py`, `tests/test_routes_read.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `arena.manifest.Vote` — frozen dataclass `(ballot_min: int, ballot_max: int, window_days: int, per_day: int)`
  - `Manifest.vote: Vote | None`
  - `METRICS` now `("mean_finish_time", "votes")`
  - `event_summary(manifest)` gains keys `"metric": str` and `"vote": dict | None`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_manifest.py`:

```python
def test_an_event_without_a_vote_section_has_no_vote_rules():
    assert load_event("sprint-2m").vote is None


def test_the_swag_contest_declares_its_ballot_and_its_window():
    vote = load_event("swag-contest").vote
    assert (vote.ballot_min, vote.ballot_max) == (2, 4)
    assert (vote.window_days, vote.per_day) == (7, 20)


def test_the_swag_contest_races_the_sprints_environment_at_one_pinned_speed():
    swag, sprint = load_event("swag-contest"), load_event("sprint-2m")
    assert swag.course == sprint.course
    assert swag.command == sprint.command
    assert swag.start == sprint.start
    assert swag.termination == sprint.termination
    assert swag.seeds == sprint.seeds
    # lo == hi: everyone walks at the same commanded speed, so the judgement
    # lands on style and not on who was asked to go faster.
    assert swag.sweep.speeds() == (0.25,)
    assert swag.metric == "votes"


def test_a_vote_section_is_validated_loudly(tmp_path):
    base = (EVENTS_DIR / "swag-contest.toml").read_text()
    for bad, message in [
        ("ballot_min  = 1", "ballot_min"),
        ("ballot_max  = 1", "ballot_max"),
        ("window_days = 0", "window_days"),
        ("per_day     = 0", "per_day"),
    ]:
        key = bad.split()[0]
        broken = "\n".join(
            bad if line.startswith(key) else line for line in base.splitlines()
        )
        path = tmp_path / "broken.toml"
        path.write_text(broken)
        with pytest.raises(ManifestError, match=message):
            load_manifest(path)


def test_ranking_on_votes_without_a_vote_section_is_refused(tmp_path):
    base = (EVENTS_DIR / "sprint-2m.toml").read_text()
    path = tmp_path / "no-rules.toml"
    path.write_text(base.replace('metric       = "mean_finish_time"', 'metric       = "votes"'))
    with pytest.raises(ManifestError, match="votes"):
        load_manifest(path)
```

Add `EVENTS_DIR`, `ManifestError`, `load_event` and `load_manifest` to the file's existing imports from `arena.manifest` if they are not already there, and `import pytest` if absent.

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --frozen pytest tests/test_manifest.py -q`
Expected: FAIL — `no such event: 'swag-contest'`, and `AttributeError: 'Manifest' object has no attribute 'vote'`.

- [ ] **Step 3: Add the `Vote` dataclass and widen `METRICS`**

In `arena/manifest.py`, change `METRICS` and add the dataclass beside `Sweep`:

```python
METRICS = ("mean_finish_time", "votes")
```

```python
@dataclass(frozen=True)
class Vote:
    """How an event collects ballots.

    Separate from `metric` on purpose: collecting votes and RANKING on them are
    different questions, and a future challenge may want to be timed and voted
    at once. `ballot_max` is a target, not a promise — a ballot shrinks to
    `ballot_min` while the field is small, so a contest works from its second
    entry rather than its fourth.
    """

    ballot_min: int
    ballot_max: int
    window_days: int
    per_day: int
```

- [ ] **Step 4: Add the field and parse the section**

Add to `Manifest`, after `command`:

```python
    # None unless the event takes votes. The frontend reads this to decide
    # whether the VOTE badge and the vote button exist at all.
    vote: Vote | None = None
```

In `load_manifest`, immediately before the `return Manifest(`:

```python
    vote_raw = raw.get("vote")
    vote = None
    if vote_raw is not None:
        vote = Vote(
            ballot_min=int(_require(vote_raw, "ballot_min", "[vote]")),
            ballot_max=int(_require(vote_raw, "ballot_max", "[vote]")),
            window_days=int(_require(vote_raw, "window_days", "[vote]")),
            per_day=int(_require(vote_raw, "per_day", "[vote]")),
        )
        if vote.ballot_min < 2:
            raise ManifestError(f"{path}: [vote] ballot_min must be at least 2")
        if vote.ballot_max < vote.ballot_min:
            raise ManifestError(f"{path}: [vote] ballot_max must not be below ballot_min")
        if vote.window_days < 1:
            raise ManifestError(f"{path}: [vote] window_days must be at least 1")
        if vote.per_day < 1:
            raise ManifestError(f"{path}: [vote] per_day must be at least 1")
    if metric == "votes" and vote is None:
        raise ManifestError(f"{path}: metric 'votes' needs a [vote] section to rank by")
```

and pass `vote=vote,` as the last argument of the `Manifest(...)` call.

- [ ] **Step 5: Write the event**

Create `arena/events/swag-contest.toml`:

```toml
id           = "swag-contest"
order        = 15
title        = "Swag Contest"
rig          = "legs"
time_limit_s = 50.0
metric       = "votes"
seeds        = [1, 2, 3, 4, 5]

[course]
kind          = "lane"
length_m      = 2.0
width_m       = 0.8
wall_height_m = 0.15
slope_deg     = 0.0

[command]
vel  = [0.25, 0.0, 0.0]
head = [0.0, 0.0, 0.0, 0.0]
body = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

[start]
keyframe = "STAND"
settle_s = 0.5

[start.perturbation]
joint_rad = 0.01
yaw_deg   = 2.0

[termination]
fall_gravity_z = -0.5
fall_hold_s    = 0.3

# lo == hi: the sweep exists to find where a policy is FASTEST, and the score
# here is not a time. Pinning one speed also makes the comparison fair — every
# duck is asked to walk at 0.25 m/s, so the judgement lands on style. Costs 6
# simulations per entry instead of the sprint's 36.
[sweep]
lo        = 0.25
hi        = 0.25
step      = 0.05
finalists = 1

[vote]
ballot_min  = 2
ballot_max  = 4
window_days = 7
per_day     = 20
```

- [ ] **Step 6: Publish it through the API**

In `arena/web/routes_read.py`, add to the dict `event_summary` returns, after `"status"`:

```python
        "metric": manifest.metric,
        # The whole vote configuration, or null. The page reads this to decide
        # whether the VOTE badge, the vote button and the #/v/ route exist.
        "vote": (
            {
                "ballot_min": manifest.vote.ballot_min,
                "ballot_max": manifest.vote.ballot_max,
                "window_days": manifest.vote.window_days,
                "per_day": manifest.vote.per_day,
            }
            if manifest.vote
            else None
        ),
```

- [ ] **Step 7: Fix the two tests that enumerate the open programme**

In `tests/test_manifest.py`, rename `test_the_three_original_events_are_open` to `test_the_open_events_are_the_three_originals_and_the_swag_contest` and change its assertion to:

```python
    assert {m.id for m in all_events() if m.status == "open"} == {
        "sprint-2m",
        "roller-sprint-2m",
        "hill-climb-1m5",
        "swag-contest",
    }
```

In `tests/test_routes_read.py::test_events_lists_the_whole_programme_open_and_planned`, add `"swag-contest",` to the expected open set.

- [ ] **Step 8: Add the API test**

Append to `tests/test_routes_read.py`:

```python
def test_an_event_says_whether_it_takes_votes_and_how(client):
    api, _ = client
    events = {e["id"]: e for e in api.get("/api/events").json()["events"]}
    assert events["sprint-2m"]["vote"] is None
    assert events["sprint-2m"]["metric"] == "mean_finish_time"
    swag = events["swag-contest"]
    assert swag["metric"] == "votes"
    assert swag["vote"] == {
        "ballot_min": 2, "ballot_max": 4, "window_days": 7, "per_day": 20,
    }
```

- [ ] **Step 9: Run the tests**

Run: `uv run --frozen pytest tests/test_manifest.py tests/test_routes_read.py -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
uv run --frozen ruff check arena tests
git add arena/manifest.py arena/events/swag-contest.toml arena/web/routes_read.py tests/
git commit -m "Events can declare a [vote] section, and the Swag Contest does"
```

---

### Task 3: The `Ballot` record and its two stores

**Files:**
- Modify: `arena/store.py`
- Modify: `arena/web/config.py`, `arena/web/app.py`
- Test: `tests/test_ballots.py` (create)

**Interfaces:**
- Consumes: `arena.store.new_id` (Task 1)
- Produces:
  - `arena.store.Ballot` — frozen dataclass `(ballot_id, event_id, voter, cast_at, candidates: tuple[str, ...], choice)`, with `.day` property, `.to_dict()`, `.from_dict()`
  - `arena.store.Ballots` protocol: `cast(ballot) -> None`, `since(first_day: str) -> list[Ballot]`
  - `arena.store.LocalBallots(root: Path)`, `arena.store.HubBallots(repo_id, token=None, snapshot_ttl_s=10.0)`
  - `ArenaConfig.build_ballots()`, `app.state.ballots`

- [ ] **Step 1: Write the failing test**

Create `tests/test_ballots.py`:

```python
import pytest

from arena.store import Ballot, LocalBallots, new_id


def make_ballot(**overrides) -> Ballot:
    fields = {
        "ballot_id": new_id(),
        "event_id": "swag-contest",
        "voter": "coralie",
        "cast_at": "2026-09-15T10:00:00Z",
        "candidates": ("run-a", "run-b", "run-c"),
        "choice": "run-b",
    }
    fields.update(overrides)
    return Ballot(**fields)


def test_a_ballot_round_trips_through_its_dict():
    ballot = make_ballot()
    assert Ballot.from_dict(ballot.to_dict()) == ballot


def test_a_ballot_is_filed_under_the_day_it_was_cast():
    assert make_ballot(cast_at="2026-09-15T23:59:59Z").day == "2026-09-15"


def test_casting_writes_one_file_that_reads_back(tmp_path):
    ballots = LocalBallots(tmp_path)
    one = make_ballot(cast_at="2026-09-15T10:00:00Z")
    two = make_ballot(cast_at="2026-09-16T10:00:00Z")
    ballots.cast(one)
    ballots.cast(two)
    assert ballots.since("2026-09-01") == [one, two]


def test_since_ignores_days_before_the_window(tmp_path):
    ballots = LocalBallots(tmp_path)
    old = make_ballot(cast_at="2026-09-01T10:00:00Z")
    recent = make_ballot(cast_at="2026-09-15T10:00:00Z")
    ballots.cast(old)
    ballots.cast(recent)
    assert ballots.since("2026-09-10") == [recent]


def test_an_empty_store_has_no_ballots(tmp_path):
    assert LocalBallots(tmp_path).since("2026-09-01") == []


def test_casting_the_same_ballot_twice_is_refused(tmp_path):
    """The id is the seal's own MAC, so a double-click addresses the same file.
    The route turns this refusal into an idempotent success."""
    ballots = LocalBallots(tmp_path)
    ballot = make_ballot()
    ballots.cast(ballot)
    with pytest.raises(FileExistsError):
        ballots.cast(ballot)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --frozen pytest tests/test_ballots.py -q`
Expected: FAIL — `ImportError: cannot import name 'Ballot' from 'arena.store'`.

- [ ] **Step 3: Add the record**

In `arena/store.py`, after the `Withdrawal` dataclass:

```python
@dataclass(frozen=True)
class Ballot:
    """One person's verdict on one drawn field of ducks.

    `candidates` is IN LANE ORDER, which is why there is no colour field: lane i
    wears the frontend's `LANE_CSS[i]`, and the draw shuffles the order. The
    order IS the colour assignment, so there is nothing to keep in step.

    Recording every candidate and not only the winner is what makes a raw vote
    count honest: exposure — how often a duck was SHOWN — derives from the same
    record, so the draw can equalise it without a second log.
    """

    ballot_id: str
    event_id: str
    voter: str
    cast_at: str
    candidates: tuple[str, ...]
    choice: str

    @property
    def day(self) -> str:
        """The UTC date it was cast on: its shard, and the unit of the quota."""
        return self.cast_at[:10]

    def to_dict(self) -> dict:
        return {
            "ballot_id": self.ballot_id,
            "event_id": self.event_id,
            "voter": self.voter,
            "cast_at": self.cast_at,
            "candidates": list(self.candidates),
            "choice": self.choice,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "Ballot":
        return cls(
            ballot_id=raw["ballot_id"],
            event_id=raw["event_id"],
            voter=raw["voter"],
            cast_at=raw["cast_at"],
            candidates=tuple(raw["candidates"]),
            choice=raw["choice"],
        )
```

- [ ] **Step 4: Add the protocol and the local store**

After the `Ballot` dataclass:

```python
class Ballots(Protocol):
    def cast(self, ballot: Ballot) -> None: ...
    def since(self, first_day: str) -> list[Ballot]: ...


def days_from(first_day: str, today: str) -> list[str]:
    """Every YYYY-MM-DD from `first_day` to `today`, inclusive.

    The Hub reader needs them explicitly: `allow_patterns` takes paths, not a
    range, and that restriction is what keeps a read the same size in a year as
    it is today.
    """
    start, end = date.fromisoformat(first_day), date.fromisoformat(today)
    out, day = [], start
    while day <= end:
        out.append(day.isoformat())
        day += timedelta(days=1)
    return out


class LocalBallots:
    """The ballot log on a local filesystem. One immutable file per ballot."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, ballot: Ballot) -> Path:
        return self.root / "votes" / ballot.day / f"{ballot.ballot_id}.json"

    def cast(self, ballot: Ballot) -> None:
        path = self._path(ballot)
        # Refused rather than overwritten, exactly as a run is. The id is the
        # seal's MAC, so this is the double-vote guard and not merely caution.
        if path.exists():
            raise FileExistsError(f"ballot {ballot.ballot_id} already cast at {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(ballot.to_dict(), indent=2))

    def since(self, first_day: str) -> list[Ballot]:
        root = self.root / "votes"
        if not root.is_dir():
            return []
        out: list[Ballot] = []
        for shard in sorted(root.iterdir()):
            if not shard.is_dir() or shard.name < first_day:
                continue
            out.extend(
                Ballot.from_dict(json.loads(p.read_text())) for p in sorted(shard.glob("*.json"))
            )
        return sorted(out, key=lambda b: (b.cast_at, b.ballot_id))
```

Add `from datetime import date, timedelta` to the module's imports.

- [ ] **Step 5: Run the local tests**

Run: `uv run --frozen pytest tests/test_ballots.py -q`
Expected: PASS.

- [ ] **Step 6: Add the Hub store**

At the end of `arena/store.py`:

```python
class HubBallots:
    """The ballot log on the same dataset repo, read through its OWN snapshot.

    Two things matter here and neither is an optimisation detail. The snapshot
    is separate from the run store's, so casting a vote never invalidates the
    board's cache — voting must not make the leaderboard slow. And it is
    downloaded with `allow_patterns` over the window only, so a read costs the
    same in a year as it does today. That is what lets the log stay append-only
    with nothing ever pruned: the repo grows, reads do not.
    """

    def __init__(self, repo_id: str, token: str | None = None, snapshot_ttl_s: float = 10.0):
        from huggingface_hub import HfApi

        self.repo_id = repo_id
        self.api = HfApi(token=token or os.environ.get("HF_TOKEN"))
        self._snapshot_ttl_s = snapshot_ttl_s
        self._snapshot: LocalBallots | None = None
        self._snapshot_at = 0.0
        self._patterns: tuple[str, ...] = ()

    def cast(self, ballot: Ballot) -> None:
        from huggingface_hub import CommitOperationAdd

        path = f"votes/{ballot.day}/{ballot.ballot_id}.json"
        if self.api.file_exists(self.repo_id, path, repo_type="dataset"):
            raise FileExistsError(f"ballot {ballot.ballot_id} already cast in {self.repo_id}")
        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=f"{ballot.event_id}: {ballot.voter} voted",
            operations=[
                CommitOperationAdd(
                    path_in_repo=path,
                    path_or_fileobj=json.dumps(ballot.to_dict(), indent=2).encode(),
                )
            ],
        )
        # Your own vote must be in the count the page shows you next.
        self._snapshot = None

    def since(self, first_day: str) -> list[Ballot]:
        from huggingface_hub import snapshot_download

        today = datetime.now(UTC).date().isoformat()
        patterns = tuple(f"votes/{day}/*" for day in days_from(first_day, today))
        stale = (
            self._snapshot is None
            or patterns != self._patterns
            or time.monotonic() - self._snapshot_at >= self._snapshot_ttl_s
        )
        if stale:
            self._snapshot = LocalBallots(
                Path(
                    snapshot_download(
                        self.repo_id, repo_type="dataset", allow_patterns=list(patterns)
                    )
                )
            )
            self._snapshot_at = time.monotonic()
            self._patterns = patterns
        return self._snapshot.since(first_day)
```

Add `UTC, datetime` to the `datetime` import line: `from datetime import UTC, date, datetime, timedelta`.

- [ ] **Step 7: Wire it into the app**

In `arena/web/config.py`, change the `HubStore, LocalStore` import to `HubBallots, HubStore, LocalBallots, LocalStore` and add after `build_store`:

```python
    def build_ballots(self):
        """The ballot log this deployment writes to. Same repo, own snapshot."""
        if self.dataset_repo and self.hf_token:
            return HubBallots(self.dataset_repo, token=self.hf_token)
        return LocalBallots(self.ensure_store())
```

In `arena/web/app.py`, after `app.state.store = config.build_store()`:

```python
    app.state.ballots = config.build_ballots()
```

- [ ] **Step 8: Add the wiring test**

Append to `tests/test_web_config.py`:

```python
def test_a_local_deployment_keeps_its_ballots_beside_its_runs(tmp_path):
    from arena.store import LocalBallots

    config = ArenaConfig.from_env(store_dir=tmp_path)
    ballots = config.build_ballots()
    assert isinstance(ballots, LocalBallots)
    assert ballots.root == tmp_path
```

Add `from arena.web.config import ArenaConfig` to the file's imports if it is not already there.

- [ ] **Step 9: Run the tests**

Run: `uv run --frozen pytest tests/test_ballots.py tests/test_web_config.py -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
uv run --frozen ruff check arena tests
git add arena/store.py arena/web/config.py arena/web/app.py tests/
git commit -m "A ballot is one immutable file, sharded by the day it was cast"
```

---

### Task 4: `arena/votes.py` — the pure fold

**Files:**
- Create: `arena/votes.py`
- Test: `tests/test_votes.py` (create)

**Interfaces:**
- Consumes: `arena.store.Ballot`, `arena.store.RunRecord`, `arena.constants.RUNNER_VERSION`
- Produces:
  - `VotedRow` — frozen dataclass `(rank: int, record: RunRecord, votes: int, shown: int)`
  - `first_day(now: datetime, days: int) -> str`
  - `window(ballots, now: datetime, days: int) -> list[Ballot]`
  - `tally(ballots) -> Counter` / `impressions(ballots) -> Counter`
  - `cast_today(ballots, voter: str, event_id: str, now: datetime) -> int`
  - `pool(records, withdrawn, exclude_user=None, runner_version=RUNNER_VERSION) -> list[RunRecord]`
  - `draw(candidates, shown, ballot_min, ballot_max, rng) -> list[RunRecord] | None`
  - `standings(candidates, ballots) -> list[VotedRow]`

- [ ] **Step 1: Write the failing test**

Create `tests/test_votes.py`:

```python
import random
from collections import Counter
from datetime import UTC, datetime

from arena.constants import RUNNER_VERSION
from arena.votes import (
    cast_today, draw, first_day, impressions, pool, standings, tally, window,
)
from tests.test_ballots import make_ballot
from tests.test_store import make_record

NOW = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)


def test_the_window_starts_a_whole_number_of_days_back():
    assert first_day(NOW, 7) == "2026-09-08"


def test_the_window_keeps_what_is_inside_it_and_drops_what_fell_out():
    inside = make_ballot(cast_at="2026-09-09T00:00:00Z")
    edge = make_ballot(cast_at="2026-09-08T12:00:00Z")
    outside = make_ballot(cast_at="2026-09-08T11:59:59Z")
    assert window([inside, edge, outside], NOW, 7) == [inside, edge]


def test_a_tally_counts_winners_and_impressions_count_everyone_shown():
    ballots = [
        make_ballot(candidates=("a", "b"), choice="a"),
        make_ballot(candidates=("a", "c"), choice="c"),
    ]
    assert tally(ballots) == Counter({"a": 1, "c": 1})
    assert impressions(ballots) == Counter({"a": 2, "b": 1, "c": 1})


def test_the_quota_counts_this_voter_on_this_event_today_only():
    mine = [make_ballot(voter="ann", cast_at="2026-09-15T08:00:00Z") for _ in range(3)]
    yesterday = make_ballot(voter="ann", cast_at="2026-09-14T23:00:00Z")
    elsewhere = make_ballot(voter="ann", event_id="other", cast_at="2026-09-15T09:00:00Z")
    someone = make_ballot(voter="bob", cast_at="2026-09-15T09:00:00Z")
    every = mine + [yesterday, elsewhere, someone]
    assert cast_today(every, "ann", "swag-contest", NOW) == 3


def test_the_pool_is_one_entry_per_person_their_most_recent():
    old = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z")
    new = make_record(user="ann", submitted_at="2026-09-12T10:00:00Z")
    bob = make_record(user="bob", submitted_at="2026-09-11T10:00:00Z")
    assert pool([old, new, bob], frozenset()) == [bob, new]


def test_the_pool_drops_withdrawn_old_physics_and_ducks_that_never_finished():
    gone = make_record(user="ann")
    stale = make_record(user="bob", runner_version=RUNNER_VERSION - 1)
    fell = make_record(user="cid", seeds_finished=0)
    kept = make_record(user="dee")
    assert pool([gone, stale, fell, kept], frozenset({gone.run_id})) == [kept]


def test_you_are_never_handed_your_own_duck():
    mine = make_record(user="ann")
    theirs = make_record(user="bob")
    assert pool([mine, theirs], frozenset(), exclude_user="ann") == [theirs]


def test_a_draw_prefers_the_least_shown_and_refuses_a_field_that_is_too_small():
    seen = [make_record(user=f"seen{i}") for i in range(3)]
    fresh = [make_record(user=f"new{i}") for i in range(2)]
    shown = Counter({r.run_id: 10 for r in seen})
    picked = draw(seen + fresh, shown, 2, 4, random.Random(0))
    assert {r.run_id for r in fresh} <= {r.run_id for r in picked}
    assert len(picked) == 4
    assert draw(seen[:1], shown, 2, 4, random.Random(0)) is None


def test_a_draw_shrinks_to_the_field_rather_than_refusing_it():
    field = [make_record(user="ann"), make_record(user="bob")]
    picked = draw(field, Counter(), 2, 4, random.Random(0))
    assert len(picked) == 2


def test_a_draw_shuffles_lane_order_so_a_duck_is_not_always_the_same_colour():
    field = [make_record(user=f"u{i}") for i in range(4)]
    orders = {
        tuple(r.run_id for r in draw(field, Counter(), 2, 4, random.Random(seed)))
        for seed in range(20)
    }
    assert len(orders) > 1


def test_standings_rank_by_votes_then_by_who_published_first():
    ann = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z")
    bob = make_record(user="bob", submitted_at="2026-09-11T10:00:00Z")
    cid = make_record(user="cid", submitted_at="2026-09-09T10:00:00Z")
    ballots = [
        make_ballot(candidates=(ann.run_id, bob.run_id, cid.run_id), choice=bob.run_id)
        for _ in range(2)
    ]
    rows = standings([ann, bob, cid], ballots)
    assert [(r.rank, r.record.user, r.votes, r.shown) for r in rows] == [
        (1, "bob", 2, 2),
        (2, "cid", 0, 2),
        (3, "ann", 0, 2),
    ]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --frozen pytest tests/test_votes.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'arena.votes'`.

- [ ] **Step 3: Write the module**

Create `arena/votes.py`:

```python
"""Ballots, folded into a ranking. The third fold over the same logs.

A vote is a receipt like a run is: nothing here is stored, every request
re-derives the board from the ballots on disk. That is what lets a score MOVE —
the window slides, so an entry is never protected by its age, and last week's
votes leave the ranking on their own.

Pure and I/O-free on purpose, like points.py. `now` is a parameter; this module
never reads a clock, because a sliding window that reads its own clock cannot be
tested at its edges.
"""

import random
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta

from .constants import RUNNER_VERSION
from .store import Ballot, RunRecord

STAMP = "%Y-%m-%dT%H:%M:%SZ"


@dataclass(frozen=True)
class VotedRow:
    """A row of a voted board.

    `shown` rides along beside `votes` because a raw count only means something
    next to the exposure that produced it — and because the draw reads it.
    """

    rank: int
    record: RunRecord
    votes: int
    shown: int


def first_day(now: datetime, days: int) -> str:
    """The earliest DAY the window can touch, as a shard name."""
    return (now - timedelta(days=days)).date().isoformat()


def window(ballots, now: datetime, days: int) -> list[Ballot]:
    """The ballots inside the sliding window, oldest first.

    Compared as STRINGS, which is safe because every stamp in the logs is
    written in the same fixed UTC format (see routes_submit.py) and misordering
    an offset is exactly the bug that format exists to prevent.
    """
    edge = (now - timedelta(days=days)).strftime(STAMP)
    return [b for b in ballots if b.cast_at >= edge]


def tally(ballots) -> Counter:
    """run id -> votes received."""
    return Counter(b.choice for b in ballots)


def impressions(ballots) -> Counter:
    """run id -> times SHOWN.

    The draw equalises this, which is what makes a raw vote count a measure of
    merit rather than of luck. It costs nothing to know, because a ballot
    records every candidate and not only its winner.
    """
    return Counter(run_id for b in ballots for run_id in b.candidates)


def cast_today(ballots, voter: str, event_id: str, now: datetime) -> int:
    """How many of this voter's daily quota is spent on this event.

    Per event, not global: the cap lives in each manifest, so a second votable
    challenge grants its own twenty rather than sharing one pool.
    """
    today = now.date().isoformat()
    return sum(
        1 for b in ballots if b.voter == voter and b.event_id == event_id and b.day == today
    )


def pool(
    records,
    withdrawn: frozenset[str],
    exclude_user: str | None = None,
    runner_version: int = RUNNER_VERSION,
) -> list[RunRecord]:
    """The ducks that can appear on a ballot, oldest entry first.

    The board's own filter, plus three rules. A duck that never finished a seed
    makes a dead lane. One entry per person — their most recent — because in a
    raw count two entries are simply twice the exposure. And never your own,
    which is `exclude_user`: a ballot you can recognise yourself in is not
    anonymous.
    """
    best: dict[str, RunRecord] = {}
    for record in records:
        if record.runner_version != runner_version or record.run_id in withdrawn:
            continue
        if record.seeds_finished <= 0:
            continue
        if exclude_user is not None and record.user == exclude_user:
            continue
        current = best.get(record.user)
        if current is None or (record.submitted_at, record.run_id) > (
            current.submitted_at,
            current.run_id,
        ):
            best[record.user] = record
    return sorted(best.values(), key=lambda r: (r.submitted_at, r.run_id))


def draw(
    candidates,
    shown: Counter,
    ballot_min: int,
    ballot_max: int,
    rng: random.Random,
) -> list[RunRecord] | None:
    """One ballot's field, in lane order. None when there are too few ducks.

    Shuffle, then sort by exposure: the least-shown go first, and the shuffle
    breaks their ties, so the draw is uniform in the normal case where everyone
    has been shown equally often. The second shuffle fixes lane order, which IS
    the colour assignment — the same duck comes out orange on one ballot and
    lavender on the next, and that is what keeps a ballot anonymous.
    """
    field = list(candidates)
    if len(field) < ballot_min:
        return None
    rng.shuffle(field)
    field.sort(key=lambda r: shown[r.run_id])
    picked = field[:ballot_max]
    rng.shuffle(picked)
    return picked


def standings(candidates, ballots) -> list[VotedRow]:
    """The voted board: most votes first, ties to whoever published first."""
    votes, seen = tally(ballots), impressions(ballots)
    ranked = sorted(
        candidates, key=lambda r: (-votes[r.run_id], r.submitted_at, r.run_id)
    )
    return [
        VotedRow(rank=i, record=r, votes=votes[r.run_id], shown=seen[r.run_id])
        for i, r in enumerate(ranked, 1)
    ]
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_votes.py -q`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
uv run --frozen ruff check arena tests
git add arena/votes.py tests/test_votes.py
git commit -m "Fold ballots into a ranking: window, tally, exposure, draw"
```

---

### Task 5: The voted leaderboard

**Files:**
- Modify: `arena/web/routes_read.py`
- Test: `tests/test_routes_read.py`

**Interfaces:**
- Consumes: `arena.votes.{first_day, window, pool, standings}` (Task 4), `app.state.ballots` (Task 3)
- Produces: `GET /api/events/{id}/leaderboard` rows gain `"votes"` and `"shown"` when the event's `metric == "votes"`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_routes_read.py`:

```python
def cast(app, choice, candidates, **overrides):
    from datetime import UTC, datetime

    from arena.store import Ballot, new_id

    fields = {
        "ballot_id": new_id(),
        "event_id": "swag-contest",
        "voter": "coralie",
        "cast_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "candidates": tuple(candidates),
        "choice": choice,
    }
    fields.update(overrides)
    app.state.ballots.cast(Ballot(**fields))


def test_a_voted_board_ranks_on_votes_and_still_reports_the_time(client):
    api, app = client
    ann = record_run(app, user="ann", event_id="swag-contest", score=12.0)
    bob = record_run(app, user="bob", event_id="swag-contest", score=40.0)
    cast(app, bob.run_id, [ann.run_id, bob.run_id])

    rows = api.get("/api/events/swag-contest/leaderboard").json()["rows"]
    assert [(r["rank"], r["user"], r["votes"], r["shown"]) for r in rows] == [
        (1, "bob", 1, 1),
        (2, "ann", 0, 1),
    ]
    # The time is measured anyway, so it stays on the row — as a fact, not a rank.
    assert rows[0]["score"] == 40.0


def test_a_vote_that_fell_out_of_the_window_no_longer_counts(client):
    api, app = client
    ann = record_run(app, user="ann", event_id="swag-contest")
    bob = record_run(app, user="bob", event_id="swag-contest")
    cast(app, ann.run_id, [ann.run_id, bob.run_id], cast_at="2026-01-01T10:00:00Z")

    rows = api.get("/api/events/swag-contest/leaderboard").json()["rows"]
    assert all(r["votes"] == 0 for r in rows)


def test_a_timed_board_is_untouched_and_carries_no_vote_columns(client):
    api, app = client
    record_run(app, user="ann", event_id="sprint-2m", score=12.0)
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert "votes" not in rows[0]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --frozen pytest tests/test_routes_read.py -q -k "voted or window or untouched"`
Expected: FAIL — rows have no `"votes"` key.

- [ ] **Step 3: Split out the row builder**

In `arena/web/routes_read.py`, extract the existing row dict from `event_leaderboard` into a module-level function, above it:

```python
def _board_row(row) -> dict:
    """The fields every board shows, timed or voted."""
    record = row.record
    return {
        "rank": row.rank,
        "user": record.user,
        "policy_name": record.policy_name,
        "livery": record.livery,
        "score": record.score,
        "command_vx": record.command_vx,
        "model_stored": record.model_stored,
        "env_url": record.env_url,
        "offers_download": record.offers_download,
        "policy_url": (record.source or {}).get("url"),
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "run_id": record.run_id,
        "submitted_at": record.submitted_at,
    }
```

- [ ] **Step 4: Branch on the metric**

Replace the body of `event_leaderboard` with:

```python
@router.get("/events/{event_id}/leaderboard")
def event_leaderboard(event_id: str, request: Request) -> dict:
    manifest = _event_or_404(event_id)
    config = request.app.state.config
    store = request.app.state.store
    withdrawn = _withdrawn(store)
    records = store.runs(manifest.id)

    if manifest.metric == "votes":
        # A separate function, not a parameterised leaderboard: index.sort_key
        # means "lower is better" and is correct for five live timed events.
        # Teaching it a second direction would put all of them at risk.
        now = datetime.now(UTC)
        days = manifest.vote.window_days
        ballots = request.app.state.ballots
        kept = votes.window(ballots.since(votes.first_day(now, days)), now, days)
        rows = votes.standings(votes.pool(records, withdrawn), kept)
        out = [_board_row(row) for row in rows]
        for shaped, row in zip(out, rows):
            shaped["votes"], shaped["shown"] = row.votes, row.shown
        return {"event": event_summary(manifest), "rows": out}

    rows = leaderboard(records, entrant=config.entrant, withdrawn=withdrawn)
    return {"event": event_summary(manifest), "rows": [_board_row(row) for row in rows]}
```

Add to the imports of `routes_read.py`:

```python
from datetime import UTC, datetime

from .. import votes
```

- [ ] **Step 5: Run the tests**

Run: `uv run --frozen pytest tests/test_routes_read.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
uv run --frozen ruff check arena tests
git add arena/web/routes_read.py tests/test_routes_read.py
git commit -m "A voted event's board ranks on votes over the sliding window"
```

---

### Task 6: The sealed ballot and the vote routes

**Files:**
- Create: `arena/web/routes_vote.py`
- Modify: `arena/web/app.py`
- Test: `tests/test_routes_vote.py` (create)

**Interfaces:**
- Consumes: `arena.votes.*` (Task 4), `arena.store.Ballot` (Task 3), `arena.web.session.{sign, unsign}`, `arena.web.routes_auth.current_user`
- Produces:
  - `seal(event_id, voter, run_ids, issued_at: float, secret) -> str`
  - `unseal(token, secret, now: float, ttl_s=BALLOT_TTL_S) -> Sealed | None`
  - `Sealed` — frozen dataclass `(event_id, voter, run_ids: tuple[str, ...])`
  - `ballot_id(token: str) -> str`
  - `GET /api/events/{id}/ballot`, `GET /api/ballots/{token}/lanes/{lane}/trace`, `POST /api/events/{id}/vote`

- [ ] **Step 1: Write the failing test**

Create `tests/test_routes_vote.py`:

```python
import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.routes_vote import BALLOT_TTL_S, ballot_id, seal, unseal
from tests.test_store import make_record


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def enter(app, user, **overrides):
    record = make_record(user=user, event_id="swag-contest", policy_name=user, **overrides)
    app.state.store.append(record, encode(np.zeros((5, 21), dtype=np.float32)))
    return record


def test_a_seal_round_trips_and_a_forged_one_does_not():
    token = seal("swag-contest", "ann", ["a", "b"], 1000.0, "secret")
    opened = unseal(token, "secret", 1000.0)
    assert (opened.event_id, opened.voter, opened.run_ids) == ("swag-contest", "ann", ("a", "b"))
    assert unseal(token, "other-secret", 1000.0) is None
    assert unseal(token + "x", "secret", 1000.0) is None
    assert unseal("not-a-ballot", "secret", 1000.0) is None


def test_a_seal_expires():
    token = seal("swag-contest", "ann", ["a", "b"], 1000.0, "secret")
    assert unseal(token, "secret", 1000.0 + BALLOT_TTL_S - 1) is not None
    assert unseal(token, "secret", 1000.0 + BALLOT_TTL_S + 1) is None


def test_the_ballot_id_is_the_seals_own_mac():
    token = seal("swag-contest", "ann", ["a", "b"], 1000.0, "secret")
    assert ballot_id(token) == token.rpartition(".")[2]
    assert ballot_id(token) != ballot_id(seal("swag-contest", "ann", ["a", "b"], 1001.0, "secret"))


def test_an_event_that_takes_no_votes_has_no_ballot(client):
    api, _ = client
    assert api.get("/api/events/sprint-2m/ballot").status_code == 404


def test_a_field_too_small_is_a_state_and_not_an_error(client):
    api, app = client
    enter(app, "ann")
    body = api.get("/api/events/swag-contest/ballot").json()
    assert body == {"state": "too-few", "have": 1, "need": 2}


def test_a_ballot_never_holds_your_own_duck(client):
    api, app = client
    enter(app, "coralie")
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    assert body["state"] == "ballot"
    assert body["lanes"] == 2
    opened = unseal(body["ballot"], app.state.config.session_secret, 0.0, ttl_s=float("inf"))
    assert len(opened.run_ids) == 2


def test_voting_records_the_whole_field_and_pays_the_voter(client):
    api, app = client
    for name in ("ann", "bob", "cid"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    result = api.post("/api/events/swag-contest/vote", json={"ballot": body["ballot"], "lane": 1})

    assert result.json() == {"points": 2, "cast_today": 1}
    [ballot] = app.state.ballots.since("2000-01-01")
    assert ballot.voter == "coralie"
    assert len(ballot.candidates) == 3
    assert ballot.choice == ballot.candidates[1]


def test_voting_twice_with_one_ballot_changes_nothing(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    payload = {"ballot": body["ballot"], "lane": 0}
    api.post("/api/events/swag-contest/vote", json=payload)
    again = api.post("/api/events/swag-contest/vote", json=payload)

    assert again.json() == {"points": 0, "cast_today": 1}
    assert len(app.state.ballots.since("2000-01-01")) == 1


def test_a_ballot_issued_for_someone_else_is_refused(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    stolen = seal(
        "swag-contest", "someone-else", ["a", "b"], 0.0, app.state.config.session_secret
    )
    refused = api.post("/api/events/swag-contest/vote", json={"ballot": stolen, "lane": 0})
    assert refused.status_code == 400


def test_a_lane_outside_the_ballot_is_refused(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    refused = api.post("/api/events/swag-contest/vote", json={"ballot": body["ballot"], "lane": 7})
    assert refused.status_code == 400


def test_the_daily_quota_closes_the_gate(client, monkeypatch):
    api, app = client
    monkeypatch.setattr("arena.web.routes_vote.PER_DAY_OVERRIDE", 2)
    for name in ("ann", "bob", "cid"):
        enter(app, name)
    for _ in range(2):
        body = api.get("/api/events/swag-contest/ballot").json()
        api.post("/api/events/swag-contest/vote", json={"ballot": body["ballot"], "lane": 0})

    gate = api.get("/api/events/swag-contest/ballot").json()
    assert gate == {"state": "quota", "cast_today": 2, "per_day": 2}


def test_a_lanes_trace_is_served_without_ever_naming_a_run(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    trace = api.get(f"/api/ballots/{body['ballot']}/lanes/0/trace")
    assert trace.status_code == 200
    assert trace.headers["X-Frame-Count"] == "5"
    assert api.get(f"/api/ballots/{body['ballot']}/lanes/9/trace").status_code == 400
```

`PER_DAY_OVERRIDE` is a test seam and must exist in the module — see Step 3.

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --frozen pytest tests/test_routes_vote.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'arena.web.routes_vote'`.

- [ ] **Step 3: Write the module**

Create `arena/web/routes_vote.py`:

```python
"""Issuing a ballot, and recording what it decided.

The client never sees a run id. A ballot is a SEALED token, its traces are
served through the ballot rather than through the runs, and a vote names a lane
index. Without that, one look at devtools plus /api/runs/{id} would name the
author, and the anonymity the draw builds would be decorative.

Nothing is remembered between the two calls. The token is signed with the same
HMAC the session cookie uses, so there is no table to expire, no memory to grow,
and a Space restart does not fail a vote in flight.
"""

import base64
import json
import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .. import votes
from ..manifest import Manifest, ManifestError, load_event
from ..points import SCHEDULE
from ..store import Ballot
from ..trace import decode
from .routes_auth import current_user
from .session import sign, unsign

router = APIRouter(prefix="/api")

# Long enough to watch a replay and think, short enough that a ballot held back
# cannot vote for an entry withdrawn since.
BALLOT_TTL_S = 15 * 60

# Tests lower the daily cap rather than casting twenty ballots. None means "use
# the manifest's own number", which is every real deployment.
PER_DAY_OVERRIDE: int | None = None


@dataclass(frozen=True)
class Sealed:
    event_id: str
    voter: str
    run_ids: tuple[str, ...]


class VoteBody(BaseModel):
    ballot: str
    lane: int


def seal(event_id: str, voter: str, run_ids, issued_at: float, secret: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"e": event_id, "v": voter, "r": list(run_ids), "t": issued_at},
            separators=(",", ":"),
        ).encode()
    ).decode().rstrip("=")
    return sign(payload, secret)


def unseal(token: str, secret: str, now: float, ttl_s: float = BALLOT_TTL_S) -> Sealed | None:
    """The ballot, or None. Never raises: this reads attacker-controlled input."""
    payload = unsign(str(token or ""), secret)
    if payload is None:
        return None
    try:
        raw = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not isinstance(raw, dict) or now - float(raw["t"]) > ttl_s:
            return None
        return Sealed(str(raw["e"]), str(raw["v"]), tuple(str(r) for r in raw["r"]))
    except (KeyError, TypeError, ValueError):
        return None


def ballot_id(token: str) -> str:
    """The seal's own MAC.

    Not a fresh id, and that is the double-click guard: two POSTs of one ballot
    address the same file, and the log already refuses to overwrite a file.
    """
    return token.rpartition(".")[2]


def _votable(event_id: str) -> Manifest:
    try:
        manifest = load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if manifest.vote is None:
        raise HTTPException(status_code=404, detail=f"{event_id} does not take votes")
    return manifest


def _voter(request: Request) -> str:
    session = current_user(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Please sign in to vote.")
    return session.username


def _per_day(manifest: Manifest) -> int:
    return PER_DAY_OVERRIDE if PER_DAY_OVERRIDE is not None else manifest.vote.per_day


def _window(request: Request, manifest: Manifest, now: datetime) -> list[Ballot]:
    days = manifest.vote.window_days
    ballots = request.app.state.ballots
    return votes.window(ballots.since(votes.first_day(now, days)), now, days)


@router.get("/events/{event_id}/ballot")
def issue_ballot(event_id: str, request: Request) -> dict:
    """A field to judge, or the reason there is none.

    "Too few ducks" and "quota reached" answer 200 with a state, because neither
    is an error: they are states of a voting session, and the page draws each as
    a panel of its own.
    """
    manifest = _votable(event_id)
    voter = _voter(request)
    store = request.app.state.store
    now = datetime.now(UTC)
    kept = _window(request, manifest, now)

    per_day = _per_day(manifest)
    spent = votes.cast_today(kept, voter, event_id, now)
    if spent >= per_day:
        return {"state": "quota", "cast_today": spent, "per_day": per_day}

    field = votes.pool(
        store.runs(event_id),
        frozenset(w.run_id for w in store.withdrawals()),
        exclude_user=voter,
    )
    picked = votes.draw(
        field,
        votes.impressions(kept),
        manifest.vote.ballot_min,
        manifest.vote.ballot_max,
        random.Random(),
    )
    if picked is None:
        return {"state": "too-few", "have": len(field), "need": manifest.vote.ballot_min}

    return {
        "state": "ballot",
        "ballot": seal(
            event_id,
            voter,
            [r.run_id for r in picked],
            now.timestamp(),
            request.app.state.config.session_secret,
        ),
        # A COUNT, not a palette: lane i wears the frontend's own LANE_CSS[i],
        # and sending the hex codes would be a second copy of a list it has.
        "lanes": len(picked),
        "cast_today": spent,
        "per_day": per_day,
    }


def _open(token: str, request: Request, voter: str, lane: int) -> Sealed:
    sealed = unseal(token, request.app.state.config.session_secret, time.time())
    if sealed is None or sealed.voter != voter or not 0 <= lane < len(sealed.run_ids):
        raise HTTPException(
            status_code=400, detail="That ballot is not valid any more. Ask for a new one."
        )
    return sealed


@router.get("/ballots/{token}/lanes/{lane}/trace")
def ballot_trace(token: str, lane: int, request: Request) -> Response:
    """One lane's replay, addressed through the ballot so no run id is exposed."""
    sealed = _open(token, request, _voter(request), lane)
    trace = decode(request.app.state.store.trace(sealed.run_ids[lane]))
    return Response(
        content=np.ascontiguousarray(trace, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )


@router.post("/events/{event_id}/vote")
def cast_vote(event_id: str, body: VoteBody, request: Request) -> dict:
    manifest = _votable(event_id)
    voter = _voter(request)
    sealed = _open(body.ballot, request, voter, body.lane)
    if sealed.event_id != event_id:
        raise HTTPException(status_code=400, detail="That ballot belongs to another event.")

    now = datetime.now(UTC)
    kept = _window(request, manifest, now)
    per_day = _per_day(manifest)
    spent = votes.cast_today(kept, voter, event_id, now)
    if spent >= per_day:
        raise HTTPException(
            status_code=429, detail=f"That is your {per_day} votes for today. Come back tomorrow."
        )

    ballot = Ballot(
        ballot_id=ballot_id(body.ballot),
        event_id=event_id,
        voter=voter,
        cast_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        candidates=sealed.run_ids,
        choice=sealed.run_ids[body.lane],
    )
    try:
        request.app.state.ballots.cast(ballot)
    except FileExistsError:
        # A double-click, not an error. The id is the seal's MAC, so the second
        # POST addressed the file the first one wrote — nothing to say but so.
        return {"points": 0, "cast_today": spent}
    return {"points": SCHEDULE["ballot"], "cast_today": spent + 1}
```

`SCHEDULE["ballot"]` does not exist yet — Task 7 adds it. Add it to `arena/points.py` now as part of this task's Step 4, so this module imports something real.

- [ ] **Step 4: Add the ballot price**

In `arena/points.py`, change the `SCHEDULE` line to:

```python
SCHEDULE = {
    "first_event": 100, "run": 10, "own_best": 25, "podium": (250, 150, 100), "ballot": 2,
}
```

- [ ] **Step 5: Mount the router**

In `arena/web/app.py`, add the import beside the others and include it before the static mount:

```python
from .routes_vote import router as vote_router
```

```python
    app.include_router(vote_router)
```

- [ ] **Step 6: Run the tests**

Run: `uv run --frozen pytest tests/test_routes_vote.py -q`
Expected: PASS, 12 tests.

- [ ] **Step 7: Run the whole suite**

Run: `uv run --frozen pytest -q -m "not network"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
uv run --frozen ruff check arena tests
git add arena/web/routes_vote.py arena/web/app.py arena/points.py tests/test_routes_vote.py
git commit -m "Issue a sealed ballot, serve its lanes, record what it decided"
```

---

### Task 7: Points — the `ballot` act and the voted podium

**Files:**
- Modify: `arena/points.py`
- Modify: `arena/web/routes_read.py`
- Test: `tests/test_points.py`

**Interfaces:**
- Consumes: `arena.manifest.Vote` (Task 2), `arena.store.Ballot` (Task 3), `arena.votes.*` (Task 4)
- Produces:
  - `Receipt.run_id` renamed to `Receipt.source_id` — it names a ballot as often as a run now
  - `receipts(records, withdrawn, ballots=(), voted=None, now=None, runner_version=RUNNER_VERSION)`
  - `boards_by_user(records, withdrawn, ballots=(), voted=None, now=None, runner_version=RUNNER_VERSION)`
  - `voted: dict[str, Vote]` maps a votable event id to its rules; `now: datetime` is required whenever `ballots` is non-empty

- [ ] **Step 1: Write the failing test**

Append to `tests/test_points.py`:

```python
def test_a_ballot_pays_its_voter_two_capped_at_the_manifests_per_day():
    from datetime import UTC, datetime

    from arena.manifest import Vote
    from tests.test_ballots import make_ballot

    now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)
    rules = {"swag-contest": Vote(ballot_min=2, ballot_max=4, window_days=7, per_day=2)}
    today = [
        make_ballot(voter="ann", cast_at=f"2026-09-15T0{i}:00:00Z") for i in range(3)
    ]
    yesterday = [make_ballot(voter="ann", cast_at="2026-09-14T09:00:00Z")]

    paid = acts(
        receipts([], frozenset(), ballots=today + yesterday, voted=rules, now=now), "ballot"
    )
    assert [r.points for r in paid] == [SCHEDULE["ballot"]] * 3
    assert {r.user for r in paid} == {"ann"}


def test_a_ballot_on_an_event_that_does_not_take_votes_pays_nothing():
    from datetime import UTC, datetime

    from tests.test_ballots import make_ballot

    now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)
    stray = make_ballot(event_id="sprint-2m", cast_at="2026-09-15T09:00:00Z")
    assert acts(receipts([], frozenset(), ballots=[stray], voted={}, now=now), "ballot") == []


def test_a_voted_events_podium_is_paid_on_votes_not_on_time():
    from datetime import UTC, datetime

    from arena.manifest import Vote
    from tests.test_ballots import make_ballot

    now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)
    rules = {"swag-contest": Vote(ballot_min=2, ballot_max=4, window_days=7, per_day=20)}
    quick = make_record(
        user="ann", event_id="swag-contest", score=10.0, submitted_at="2026-09-14T09:00:00Z"
    )
    slow = make_record(
        user="bob", event_id="swag-contest", score=40.0, submitted_at="2026-09-14T10:00:00Z"
    )
    loved = [
        make_ballot(
            candidates=(quick.run_id, slow.run_id),
            choice=slow.run_id,
            cast_at="2026-09-15T09:00:00Z",
        )
    ]
    rows = boards_by_user([quick, slow], frozenset(), ballots=loved, voted=rules, now=now)
    assert [r.record.user for r in rows["swag-contest"]] == ["bob", "ann"]

    podium = acts(
        receipts([quick, slow], frozenset(), ballots=loved, voted=rules, now=now), "podium"
    )
    assert [(r.user, r.points) for r in podium] == [("bob", 250), ("ann", 150)]
```

- [ ] **Step 2: Rename `Receipt.run_id` to `Receipt.source_id`**

It names a ballot as often as a run now. In `arena/points.py`:

```python
@dataclass(frozen=True)
class Receipt:
    user: str
    act: str
    points: int
    event_id: str
    # A run id, or a ballot id: a receipt is proof of an ACT, and two kinds of
    # log record one now.
    source_id: str
    at: str
```

and in `_receipt`, `Receipt(record.user, act, points, record.event_id, record.run_id, record.submitted_at)` stays as-is — it passes `record.run_id` positionally into `source_id`, which is correct.

Then update the existing assertions in `tests/test_points.py`:

```bash
cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena
sed -i '' 's/r\.run_id/r.source_id/g' tests/test_points.py
```

Check the result reads correctly — the substitution must not have touched `d.run_id`, `a1.run_id` or any other fixture reference:

```bash
grep -n "source_id\|\.run_id" tests/test_points.py
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run --frozen pytest tests/test_points.py -q`
Expected: FAIL — `receipts() got an unexpected keyword argument 'ballots'`.

- [ ] **Step 4: Teach the fold about ballots**

In `arena/points.py`, add to the imports:

```python
from datetime import datetime

from . import votes
from .manifest import Vote
```

Add the cap constant beside `RUNS_PER_DAY`:

```python
# The manifest's own number is what applies; this is the value events ship with.
# Enforced HERE as well as at the gate, because a cap only a gate holds is a cap
# that a row written another way walks around.
BALLOTS_PER_DAY = 20
```

Replace `boards_by_user` with:

```python
def boards_by_user(
    records,
    withdrawn: frozenset[str],
    ballots=(),
    voted: dict[str, Vote] | None = None,
    now: datetime | None = None,
    runner_version: int = RUNNER_VERSION,
) -> dict:
    """Each event's board with one row per PERSON, whatever the local board shows.

    The podium is a people's prize, so a player with three policies in the top
    three takes one place, not three.

    `voted` maps a votable event id to its rules. Those events are ranked on
    votes instead of on time, which is what makes the podium bonus follow the
    swag contest without a line of its own.
    """
    voted = voted or {}
    by_event: dict[str, list[RunRecord]] = defaultdict(list)
    for run in counting(records, withdrawn, runner_version):
        by_event[run.event_id].append(run)

    out = {}
    for event_id, runs in by_event.items():
        rules = voted.get(event_id)
        if rules is None:
            out[event_id] = leaderboard(
                runs, runner_version, entrant=by_user, withdrawn=withdrawn
            )
            continue
        # `now` is only ever None when there are no ballots to window.
        kept = (
            votes.window([b for b in ballots if b.event_id == event_id], now, rules.window_days)
            if now is not None
            else []
        )
        out[event_id] = votes.standings(
            votes.pool(runs, withdrawn, runner_version=runner_version), kept
        )
    return out
```

Replace `receipts` with:

```python
def receipts(
    records,
    withdrawn: frozenset[str],
    ballots=(),
    voted: dict[str, Vote] | None = None,
    now: datetime | None = None,
    runner_version: int = RUNNER_VERSION,
) -> list[Receipt]:
    if ballots and now is None:
        raise ValueError("a sliding window needs a `now`; this module never reads a clock")
    voted = voted or {}
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

    ballots_per_day: Counter = Counter()
    for ballot in sorted(ballots, key=lambda b: (b.cast_at, b.ballot_id)):
        rules = voted.get(ballot.event_id)
        if rules is None:
            continue
        spent = (ballot.voter, ballot.event_id, ballot.day)
        ballots_per_day[spent] += 1
        if ballots_per_day[spent] <= rules.per_day:
            out.append(
                Receipt(
                    ballot.voter,
                    "ballot",
                    SCHEDULE["ballot"],
                    ballot.event_id,
                    ballot.ballot_id,
                    ballot.cast_at,
                )
            )

    for rows in boards_by_user(runs, withdrawn, ballots, voted, now, runner_version).values():
        finishers = [row for row in rows if row.record.seeds_finished > 0]
        for row, points in zip(finishers, SCHEDULE["podium"]):
            out.append(_receipt(row.record, "podium", points))
    return out
```

- [ ] **Step 5: Run the points tests**

Run: `uv run --frozen pytest tests/test_points.py -q`
Expected: PASS.

- [ ] **Step 6: Feed the routes**

In `arena/web/routes_read.py`, add a helper beside `_withdrawn`:

```python
def _voted() -> dict:
    """Every event that takes ballots, with its rules. The fold needs both."""
    return {m.id: m.vote for m in all_events() if m.vote is not None}


def _ballots(request: Request) -> list:
    """Every ballot inside the widest window any votable event declares."""
    rules = _voted()
    if not rules:
        return []
    now = datetime.now(UTC)
    widest = max(v.window_days for v in rules.values())
    return request.app.state.ballots.since(votes.first_day(now, widest))
```

Then in `player_standings` and `player_page`, pass them through:

```python
@router.get("/standings")
def player_standings(request: Request) -> dict:
    """One ladder across every event: the sum of each player's receipts, ranked."""
    store = request.app.state.store
    cards = standings(
        receipts(
            _all_runs(store),
            _withdrawn(store),
            ballots=_ballots(request),
            voted=_voted(),
            now=datetime.now(UTC),
        )
    )
    return {"rows": [{"rank": c.rank, "user": c.user, "points": c.points} for c in cards]}
```

In `player_page`, replace the two folds the same way:

```python
    runs, withdrawn = _all_runs(store), _withdrawn(store)
    ballots, rules, now = _ballots(request), _voted(), datetime.now(UTC)
    card = next(
        (
            c
            for c in standings(receipts(runs, withdrawn, ballots, rules, now))
            if c.user == user
        ),
        None,
    )
    if card is None:
        raise HTTPException(status_code=404, detail=f"{user!r} has not published yet")
    boards = boards_by_user(runs, withdrawn, ballots, rules, now)
```

- [ ] **Step 7: Add the route test**

Append to `tests/test_routes_read.py`:

```python
def test_voting_puts_points_on_the_ladder(client):
    api, app = client
    ann = record_run(app, user="ann", event_id="swag-contest")
    bob = record_run(app, user="bob", event_id="swag-contest")
    cast(app, ann.run_id, [ann.run_id, bob.run_id], voter="coralie")

    rows = {r["user"]: r["points"] for r in api.get("/api/standings").json()["rows"]}
    assert rows["coralie"] == 2
```

- [ ] **Step 8: Run the whole suite**

Run: `uv run --frozen pytest -q -m "not network"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
uv run --frozen ruff check arena tests
git add arena/points.py arena/web/routes_read.py tests/
git commit -m "A ballot pays its voter, and a voted podium is paid on votes"
```

---

### Task 8: The router, the theme, and the API client

**Files:**
- Modify: `app/src/router.js`, `app/src/api.js`, `app/src/main.js`
- Test: `app/src/router.test.js`, `app/src/api.test.js`

**Interfaces:**
- Consumes: Task 6's three routes
- Produces:
  - `parseRoute("#/v/<id>")` → `{view: "vote", eventId}`; `voteHref(eventId)`; `themeFor("vote") === "race"`
  - `getBallot(eventId)` → `{state, …}`; `ballotTraceUrl(ballot, lane)`; `castVote(eventId, ballot, lane)`

- [ ] **Step 1: Write the failing tests**

In `app/src/router.test.js`, add `voteHref` to the import list and append inside `describe("parseRoute", …)`:

```javascript
  it("opens one voting booth", () => {
    expect(parseRoute("#/v/swag-contest")).toEqual({ view: "vote", eventId: "swag-contest" });
    expect(parseRoute("#/v/swag-contest/")).toEqual({ view: "vote", eventId: "swag-contest" });
  });
```

Extend the existing fallback list to include `"#/v/"` and `"#/v/a/b"`, add to the "builds the links it parses" test:

```javascript
    expect(parseRoute(voteHref("swag-contest"))).toEqual({
      view: "vote",
      eventId: "swag-contest",
    });
```

and inside `describe("themeFor", …)`:

```javascript
    expect(themeFor("vote")).toBe("race");
```

Append to `app/src/api.test.js`:

```javascript
describe("the ballot", () => {
  it("reads a field to judge", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ state: "ballot", ballot: "tok.mac", lanes: 3, cast_today: 1, per_day: 20 }),
    });
    expect(await getBallot("swag-contest")).toEqual({
      state: "ballot", ballot: "tok.mac", lanes: 3, cast_today: 1, per_day: 20,
    });
  });

  it("reads being signed out as a state, not a failure", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    expect(await getBallot("swag-contest")).toEqual({ state: "signed-out" });
  });

  it("addresses a lane's replay through the ballot and never a run", () => {
    expect(ballotTraceUrl("tok.mac", 2)).toBe("/api/ballots/tok.mac/lanes/2/trace");
  });
});
```

Add `ballotTraceUrl, getBallot` to that file's import from `./api.js`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npx vitest run src/router.test.js src/api.test.js`
Expected: FAIL — `voteHref is not a function`, `getBallot is not a function`.

- [ ] **Step 3: Add the route**

In `app/src/router.js`:

```javascript
const VOTE = new RegExp(`^/v/${SEGMENT}/?$`);
```

In `parseRoute`, before the fallback:

```javascript
  const vote = path.match(VOTE);
  if (vote) return { view: "vote", eventId: vote[1] };
```

and:

```javascript
export const voteHref = (eventId) => `#/v/${eventId}`;
```

Change `themeFor` to:

```javascript
/**
 * Which placement sheet a view wears. Both are the club, in Duck Jam's paper
 * and ink; they differ only in what they place. A race page and a voting booth
 * both have a stage, so both wear the trackside sheet.
 */
export const themeFor = (view) => (view === "race" || view === "vote" ? "race" : "club");
```

- [ ] **Step 4: Add the API calls**

Append to `app/src/api.js`:

```javascript
/**
 * A field to judge, or the reason there is none.
 *
 * Every answer is a STATE, never a thrown error: "you are signed out", "there
 * are not enough ducks yet" and "that is your votes for today" are all things
 * the page draws as a panel, not failures.
 */
export async function getBallot(eventId) {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/ballot`);
  if (response.status === 401) return { state: "signed-out" };
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

/** One lane's replay. Addressed through the ballot, so no run id is exposed. */
export const ballotTraceUrl = (ballot, lane) => `/api/ballots/${ballot}/lanes/${lane}/trace`;

export async function getBallotTrace(ballot, lane) {
  const response = await fetch(ballotTraceUrl(ballot, lane));
  if (!response.ok) throw new Error(await detailFrom(response));
  return new Float32Array(await response.arrayBuffer());
}

export const castVote = (eventId, ballot, lane) =>
  json(`/api/events/${encodeURIComponent(eventId)}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ballot, lane }),
  });
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npx vitest run src/router.test.js src/api.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/router.js app/src/api.js app/src/router.test.js app/src/api.test.js
git commit -m "Route #/v/<event> to the voting booth, and call its three endpoints"
```

---

### Task 9: The voting page

**Files:**
- Create: `app/src/vote.js`, `app/src/vote.test.js`
- Modify: `app/src/main.js`, `app/src/course.js`, `app/src/viewer.js`
- Modify: `app/public/race.css`

**Interfaces:**
- Consumes: Task 8's `getBallot`, `getBallotTrace`, `castVote`; `createViewer` from `viewer.js`; `LANE_CSS`, `LANE_COLORS` from `course.js`
- Produces:
  - `renderVote(root, {event, state})`
  - `votePanel(ballot)` — the testable DOM for one state, returned as an element
  - `buildMarker(tier, colour)` — `colour` overrides the tier's own when given
  - `setLanes` entries accept an optional `colour`

- [ ] **Step 1: Write the failing test**

Create `app/src/vote.test.js`:

```javascript
import { describe, expect, it, vi } from "vitest";
import { votePanel } from "./vote.js";

describe("the voting panel", () => {
  it("offers one button per lane, in the lane's own colour", () => {
    const picks = [];
    const panel = votePanel(
      { state: "ballot", ballot: "tok.mac", lanes: 3, cast_today: 4, per_day: 20 },
      (lane) => picks.push(lane),
    );
    const buttons = [...panel.querySelectorAll("button.vote-pick")];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.style.getPropertyValue("--pick"))).toEqual([
      "#ff7a2f",
      "#8fb8dc",
      "#c8ff2e",
    ]);
    buttons[1].click();
    expect(picks).toEqual([1]);
  });

  it("counts down the day's votes", () => {
    const panel = votePanel({ state: "ballot", ballot: "t.m", lanes: 2, cast_today: 4, per_day: 20 });
    expect(panel.querySelector(".vote-count").textContent).toBe("4 / 20 today");
  });

  it("says how many ducks are missing", () => {
    const panel = votePanel({ state: "too-few", have: 1, need: 2 });
    expect(panel.querySelector(".vote-empty").textContent).toBe(
      "Voting needs 2 ducks, and there is 1 so far.",
    );
    expect(panel.querySelector("button.vote-pick")).toBeNull();
  });

  it("uses a plural when it should", () => {
    const panel = votePanel({ state: "too-few", have: 0, need: 4 });
    expect(panel.querySelector(".vote-empty").textContent).toBe(
      "Voting needs 4 ducks, and there are 0 so far.",
    );
  });

  it("closes the booth for the day", () => {
    const panel = votePanel({ state: "quota", cast_today: 20, per_day: 20 });
    expect(panel.querySelector(".vote-empty").textContent).toBe(
      "That is your 20 votes for today. Come back tomorrow.",
    );
  });

  it("shows the way in when signed out", () => {
    const panel = votePanel({ state: "signed-out" });
    expect(panel.querySelector("a.entry__signin").textContent.trim()).toBe(
      "Sign in with Hugging Face",
    );
  });

  it("never names a duck, a policy or a person", () => {
    const panel = votePanel({ state: "ballot", ballot: "t.m", lanes: 4, cast_today: 0, per_day: 20 });
    expect(panel.textContent).not.toMatch(/@|policy|run_/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/vote.test.js`
Expected: FAIL — cannot resolve `./vote.js`.

- [ ] **Step 3: Let a lane carry an explicit colour**

In `app/src/course.js`, change `buildMarker`:

```javascript
/**
 * The ring that travels under a duck.
 *
 * `colour` overrides the tier's own, which is what a ballot needs: on a voting
 * page every duck wears the same livery and the RING is the only thing that
 * tells one lane from another — the signal this ring was already the best at.
 */
export function buildMarker(tier = "ghost", colour = null) {
  const marker = new Mesh(
    new RingGeometry(0.085, 0.115, 32),
    new MeshBasicMaterial({
      color: colour ?? TIER_MARKER[tier] ?? TIER_MARKER.ghost,
      transparent: true,
      opacity: colour !== null || tier !== "ghost" ? 0.95 : 0.4,
    }),
  );
  marker.rotation.x = -Math.PI / 2; // lay the ring flat
  marker.position.y = 0.004;
  marker.name = `marker-${tier}`;
  return marker;
}
```

In `app/src/viewer.js`, inside `setLanes`, change the marker line to:

```javascript
      const marker = buildMarker(tier, entry.colour ?? null);
```

- [ ] **Step 4: Write the page**

Create `app/src/vote.js`:

```javascript
// The voting booth: a field of ducks, and one colour to pick.
//
// Every duck wears the same livery, so nothing but the ring under it — and the
// button that matches — tells one from another. That is deliberate: the ballot
// is anonymous, the draw hands out the colours, and the judgement is meant to
// land on how a duck WALKS and not on whose it is.

import { castVote, getBallot, getBallotTrace, getMe } from "./api.js";
import { LANE_COLORS, LANE_CSS } from "./course.js";
import { raceHref } from "./router.js";
import { signInHref } from "./session.js";
import { signage } from "./signage.js";
import { createViewer } from "./viewer.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The controls under the stage, for whichever state the booth is in.
 *
 * Split out from `renderVote` so all four states are testable without WebGL,
 * a viewer or a fetch.
 */
export function votePanel(ballot, onPick) {
  const panel = el("div", "vote-panel");

  if (ballot.state === "signed-out") {
    const link = el("a", "entry__signin", "Sign in with Hugging Face");
    link.href = signInHref();
    panel.append(link);
    return panel;
  }

  if (ballot.state === "too-few") {
    const verb = ballot.have === 1 ? "there is" : "there are";
    panel.append(
      el(
        "p",
        "vote-empty",
        `Voting needs ${ballot.need} ducks, and ${verb} ${ballot.have} so far.`,
      ),
    );
    return panel;
  }

  if (ballot.state === "quota") {
    panel.append(
      el(
        "p",
        "vote-empty",
        `That is your ${ballot.per_day} votes for today. Come back tomorrow.`,
      ),
    );
    return panel;
  }

  const picks = el("div", "vote-picks");
  for (let lane = 0; lane < ballot.lanes; lane += 1) {
    const button = el("button", "vote-pick");
    button.type = "button";
    button.style.setProperty("--pick", LANE_CSS[lane % LANE_CSS.length]);
    button.setAttribute("aria-label", `Vote for lane ${lane + 1}`);
    button.addEventListener("click", () => onPick?.(lane));
    picks.append(button);
  }
  panel.append(
    el("p", "vote-lead", "Which one has the swag?"),
    picks,
    el("p", "vote-count", `${ballot.cast_today} / ${ballot.per_day} today`),
  );
  return panel;
}

export async function renderVote(root, { event, state }) {
  root.replaceChildren(signage(await getMe()));

  const hall = el("main", "hall");
  hall.innerHTML = `
    <div class="votehead">
      <h2 class="racetitle">${event.title}</h2>
      <a class="votehead__back" href="${raceHref(event.id)}">Back to the challenge</a>
    </div>
    <div class="stage"><canvas id="stage"></canvas></div>
    <div id="booth"></div>
  `;
  root.append(hall);

  const viewer = await createViewer(root.querySelector("#stage"), { rig: event.rig });
  state.viewer = viewer;
  const booth = root.querySelector("#booth");

  let busy = false;

  async function next() {
    const ballot = await getBallot(event.id);
    if (ballot.state !== "ballot") {
      viewer.setLanes([], event);
      booth.replaceChildren(votePanel(ballot));
      return;
    }
    const traces = await Promise.all(
      Array.from({ length: ballot.lanes }, (_, lane) => getBallotTrace(ballot.ballot, lane)),
    );
    viewer.setLanes(
      traces.map((trace, lane) => ({
        runId: null,
        trace,
        // Every duck the same: the ring is what identifies a lane, not paint.
        tier: "leader",
        livery: "classic",
        colour: LANE_COLORS[lane % LANE_COLORS.length],
      })),
      event,
    );
    booth.replaceChildren(
      votePanel(ballot, async (lane) => {
        // A second click while the first is in flight would spend two ballots
        // on one field, and the cheapest guard is not to send it.
        if (busy) return;
        busy = true;
        try {
          await castVote(event.id, ballot.ballot, lane);
          await next();
        } finally {
          busy = false;
        }
      }),
    );
  }

  await next();
}
```

- [ ] **Step 5: Mount the view**

In `app/src/main.js`, add the import and the branch:

```javascript
import { renderVote } from "./vote.js";
```

```javascript
    } else if (route.view === "vote") {
      const event = (await events()).find((e) => e.id === route.eventId);
      if (!event || !event.vote) {
        location.hash = "#/";
        return;
      }
      await renderVote(root, { event, state });
    } else if (route.view === "player") {
```

- [ ] **Step 6: Style it**

Append to `app/public/race.css`:

```css
/* The voting booth. The colour buttons ARE the ballot, so they are the
   loudest thing under the stage — the opposite of the lane stripes, which
   stay quiet because the ring already identifies a lane in motion. */
.votehead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.vote-panel {
  margin: 1.25rem 0 2rem;
  text-align: center;
}

.vote-lead {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
}

.vote-picks {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.vote-pick {
  width: 4.5rem;
  height: 4.5rem;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  background: var(--pick);
  cursor: pointer;
}

.vote-pick:hover,
.vote-pick:focus-visible {
  border-color: #fff;
  transform: scale(1.06);
}

.vote-count,
.vote-empty {
  margin: 1rem 0 0;
  opacity: 0.8;
}
```

- [ ] **Step 7: Run the tests**

Run: `cd app && npx vitest run src/vote.test.js src/course.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/vote.js app/src/vote.test.js app/src/main.js app/src/course.js app/src/viewer.js app/public/race.css
git commit -m "The voting booth: a field of ducks, one colour to pick"
```

---

### Task 10: The flyer badge and the challenge-page button

**Files:**
- Modify: `app/src/home.js`, `app/src/race.js`
- Modify: `app/public/club.css`, `app/public/race.css`
- Test: `app/src/home.test.js`, `app/src/race.test.js`

**Interfaces:**
- Consumes: `voteHref` (Task 8), `event.vote` and the row's `votes` (Tasks 2 and 5)
- Produces: `flyer(event, rows)` renders a `VOTE` sticker and a vote-shaped standing line when `event.vote` is set; `renderRace` puts a `Vote` link beside the title

- [ ] **Step 1: Write the failing tests**

Append to `app/src/home.test.js`:

```javascript
const voted = {
  ...open,
  id: "swag-contest",
  title: "Swag Contest",
  metric: "votes",
  vote: { ballot_min: 2, ballot_max: 4, window_days: 7, per_day: 20 },
};

describe("a votable flyer", () => {
  it("wears a VOTE sticker and links to the booth", () => {
    const note = flyer(voted, []);
    expect(note.querySelector(".challenge-vote").textContent).toBe("VOTE");
    expect(note.querySelector(".challenge-vote").getAttribute("href")).toBe("#/v/swag-contest");
  });

  it("counts the week's votes instead of a time", () => {
    const note = flyer(voted, [{ user: "cdeplanne", votes: 43, seeds_finished: 5 }]);
    expect(note.querySelector(".challenge-standing").textContent).toContain("43 votes");
  });

  it("says so when nothing has been voted for yet", () => {
    const note = flyer(voted, [{ user: "cdeplanne", votes: 0, seeds_finished: 5 }]);
    expect(note.querySelector(".challenge-standing").textContent).toContain("no votes yet");
  });

  it("leaves a timed flyer alone", () => {
    const note = flyer(open, held);
    expect(note.querySelector(".challenge-vote")).toBeNull();
  });
});
```

Append to `app/src/race.test.js`:

```javascript
describe("the vote button", () => {
  it("stands beside the title only when the event takes votes", () => {
    const timed = document.createElement("div");
    timed.append(raceTitle({ id: "sprint-2m", title: "2 m Sprint" }));
    expect(timed.querySelector("a.racevote")).toBeNull();

    const votedBox = document.createElement("div");
    votedBox.append(
      raceTitle({ id: "swag-contest", title: "Swag Contest", vote: { ballot_min: 2 } }),
    );
    const link = votedBox.querySelector("a.racevote");
    expect(link.getAttribute("href")).toBe("#/v/swag-contest");
    expect(link.textContent).toBe("Vote");
  });
});
```

Add `raceTitle` to that file's import from `./race.js`, and `flyer` is already imported in `home.test.js`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npx vitest run src/home.test.js src/race.test.js`
Expected: FAIL — `raceTitle is not a function`, and `.challenge-vote` is null.

- [ ] **Step 3: Give the flyer its badge and its vote-shaped standing**

In `app/src/home.js`, add `voteHref` to the `./router.js` import, then replace `standingLine` and the relevant part of `flyer`:

```javascript
function standingLine(event, planned, rows) {
  const line = el("p", "challenge-standing");
  if (planned) {
    line.textContent = "course not built yet";
    return line;
  }
  const star = el("img", "challenge-star");
  star.src = "/star-yellow.webp";
  star.alt = "";
  const leader = rows.find((row) => row.seeds_finished > 0);
  if (!leader) {
    line.append(star, el("span", null, rows.length ? "no finisher yet" : "be the first"));
    return line;
  }
  // A voted event is held by whoever collected the most votes THIS WEEK, so
  // the line says votes. A time would be the wrong fact about it.
  if (event.vote) {
    line.append(
      star,
      el("span", null, leader.user),
      el("span", null, leader.votes ? `${leader.votes} votes` : "no votes yet"),
    );
    return line;
  }
  line.append(
    star,
    el("span", null, leader.user),
    el("span", null, formatScore(leader.score, { finished: leader.seeds_finished })),
  );
  return line;
}
```

In `flyer`, replace the `standingLine(planned, rows)` call with `standingLine(event, planned, rows)` and add the sticker after `note.append(el("span", "flyer-tape"))`:

```javascript
  if (event.vote && !planned) {
    const badge = el("a", "challenge-vote", "VOTE");
    badge.href = voteHref(event.id);
    note.append(badge);
  }
```

- [ ] **Step 4: Split the race title out and give it the button**

In `app/src/race.js`, add `voteHref` to the `./router.js` import and add above `renderRace`:

```javascript
/**
 * The title, and the way into the booth when the event takes votes.
 *
 * Its own function so the rule is testable without a WebGL viewer or a
 * leaderboard fetch: give it an event, check what comes back.
 */
export function raceTitle(event) {
  const head = document.createElement("div");
  head.className = "racehead";
  const title = document.createElement("h2");
  title.className = "racetitle";
  title.textContent = event.title;
  head.append(title);
  if (event.vote) {
    const link = document.createElement("a");
    link.className = "racevote";
    link.href = voteHref(event.id);
    link.textContent = "Vote";
    head.append(link);
  }
  return head;
}
```

In `renderRace`, replace the `<h2 class="racetitle">${event.title}</h2>` line of the template with `<div id="racehead"></div>`, and immediately after `root.append(hall);` add:

```javascript
  root.querySelector("#racehead").replaceWith(raceTitle(event));
```

- [ ] **Step 5: Style both**

Append to `app/public/club.css`:

```css
/* The VOTE sticker: this round is judged, not timed. Slapped on the corner of
   the note like the tape above it, in the charter's hi-vis lime. */
.challenge-vote {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  z-index: 2;
  padding: 0.2rem 0.55rem;
  border-radius: 0.2rem;
  background: #c8ff2e;
  color: #12131a;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-decoration: none;
  transform: rotate(4deg);
}
```

Append to `app/public/race.css`:

```css
.racehead {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
}

.racevote {
  padding: 0.35rem 0.9rem;
  border-radius: 0.25rem;
  background: #c8ff2e;
  color: #12131a;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-decoration: none;
}
```

Confirm `.challenge-note` is `position: relative` in `club.css`; if it is not, add it, or the sticker will pin itself to the page rather than to the note.

- [ ] **Step 6: Run the JS suite**

Run: `cd app && npx vitest run`
Expected: PASS except the 4 known `brightness.test.js` failures under Node 25.

- [ ] **Step 7: Build, and run the whole Python suite**

Run: `cd app && npm run build && cd .. && uv run --frozen pytest -q -m "not network"`
Expected: build succeeds, tests PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/home.js app/src/race.js app/src/home.test.js app/src/race.test.js app/public/club.css app/public/race.css app/dist
git commit -m "A VOTE sticker on the flyer, and a Vote button beside the title"
```

---

## Verify it by hand

Nothing here is a substitute for watching it work.

```bash
cd app && npm run build && cd ..
uv run --frozen arena score arena/assets/policies/BEST_alpha_walking.onnx \
  --event swag-contest --user ann --name struts --store ~/arena-board
uv run --frozen arena score arena/assets/policies/BEST_alpha_walking.onnx \
  --event swag-contest --user bob --name saunters --store ~/arena-board
uv run --frozen arena score arena/assets/policies/BEST_alpha_walking.onnx \
  --event swag-contest --user cid --name strolls --store ~/arena-board
uv run --frozen arena serve --store ~/arena-board --user nicolas
```

Then, at `http://127.0.0.1:8000`:

1. The Swag Contest flyer wears a **VOTE** sticker and says `be the first` until a duck finishes.
2. `#/e/swag-contest` shows a **Vote** button beside the title; the board ranks on votes with every duck on 0.
3. The button opens `#/v/swag-contest` with three ducks walking side by side, each ringed in a different colour, none of them yours.
4. Clicking a colour loads a new field immediately, and `0 / 20 today` climbs.
5. Back on `#/e/swag-contest`, the duck you picked is first. On `#/` the flyer says `N votes`. On `#/p/nicolas` your total went up 2 per vote.
