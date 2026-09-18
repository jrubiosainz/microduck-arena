# The Commentary Written On The Air — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peter and Ray write a fresh dialogue for every airing, from facts read at the moment of writing and from the last five dialogues that actually went out, kept in a reserve ahead of the playhead so the grid can lay a booth the instant it has one.

**Architecture:** A `BroadcastBook` on the process's own disk holds dialogues that have been written but not yet aired, plus the recently aired ones the writer reads as history. A `CommentaryStock` worker keeps eight runs stocked, calling the existing `gather` and `write` at generation time and preparing each plan in its own dedicated Chrome — one browser, one tab, never backgrounded. The programme claims a broadcast when it lays a booth and marks it aired when its slot passes; a run with no broadcast contributes a replay and no booth. `commentary.json` disappears in the other direction.

**Tech Stack:** Python 3.12, FastAPI, `huggingface_hub`, Chrome DevTools Protocol over websockets, pytest; JavaScript ES modules, Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-live-commentary-design.md`. It amends the section "The commentary, written at publish time" of `docs/superpowers/specs/2026-09-17-live-channel-design.md`, which remains the authority for everything else about the channel.

## Global Constraints

- Python: always `uv run --frozen ...` — the local uv mirror rewrites `uv.lock` otherwise. Suite: `uv run --frozen pytest -q`. Lint: `uv run --frozen ruff check arena tests`.
- Frontend: `cd app && npx vitest run` and `cd app && npm run build`. Under Node 25, `app/src/brightness.test.js` has 4 pre-existing failures (jsdom localStorage): not yours, do not fix.
- A broadcast's `plan.duration_ms` must be a whole multiple of 40 ms, or the grid cannot lay it. This is already enforced by `commentary_json`'s check and must survive into the broadcast.
- Broadcasts never reach the `Store`. They live on the process's disk, under a directory the `BroadcastBook` owns. The `Store` protocol gains nothing.
- The reserve keeps **8** runs stocked, attempts at most **120** generations an hour counted whether they succeed or are refused, and runs **one** generation at a time.
- History is the last **5** aired broadcasts, all runs together, newest last. Retention keeps an aired broadcast until **20** newer ones have aired after it.
- The reserve's Chrome is its own `arena.recorder.Chrome` with exactly one tab. Never a second tab in the clip renderer's browser: a backgrounded renderer stops committing frames.
- A refusal from the router is not an error. It is logged and the loop moves to the next run.
- One commit per task, message in the repository's style (one sentence, capitalised, no `feat:` prefix), ending with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never push, never merge, never switch branch: a push to `main` deploys the Hugging Face Space.
- No dead code, no "just in case" branches; nothing a reader sees carries a technical name. Match the surrounding comment density, naming and idiom.

---

### Task 1: The page that only prepares a plan

**Files:**
- Create: `app/plan.html`
- Create: `app/src/plan/main.js`
- Create: `app/src/plan/main.test.js`
- Modify: `app/vite.config.js:11`

**Interfaces:**
- Consumes: `prepare` from `app/src/live/score.js` (already exported).
- Produces: a built page at `/plan.html` that sets `window.plan(dialogue) -> plan`. Task 3's `PlanTab` navigates one tab to it and evaluates `window.plan(...)`.

The clip page could do this — it already exposes `window.clip.commentary` — but it loads a three.js scene, a soundtrack and a run's assets to call a pure function, and it ties the tab to a run that may be withdrawn under it. `prepare(dialogue)` takes its seed from `dialogue.run_id`, so this page needs no run at all.

- [ ] **Step 1: Write the failing test**

Create `app/src/plan/main.test.js`:

```js
import { describe, expect, it } from "vitest";

describe("the plan page", () => {
  it("exposes prepare on the window and nothing else", async () => {
    await import("./main.js");
    expect(typeof window.plan).toBe("function");
  });

  it("turns a dialogue into a plan whose duration is whole frames", async () => {
    await import("./main.js");
    const plan = window.plan({
      run_id: "01M2JFJX7CF5HF7ZWTZAA1",
      turns: [
        { speaker: "peter", text: "It is a number, Ray.", fact_refs: [] },
        { speaker: "ray", text: "It is the number.", fact_refs: [] },
        { speaker: "peter", text: "Then we agree.", fact_refs: [] },
      ],
    });
    expect(plan.duration_ms % 40).toBe(0);
    expect(plan.captions.length).toBeGreaterThan(0);
  });

  it("gives the same plan for the same dialogue, so two calls agree", async () => {
    await import("./main.js");
    const dialogue = {
      run_id: "01M2JFKAWWKK71F0FR0V1G",
      turns: [
        { speaker: "ray", text: "Hill climbs are honest.", fact_refs: [] },
        { speaker: "peter", text: "Hills are honest. Climbs lie.", fact_refs: [] },
        { speaker: "ray", text: "Write that down.", fact_refs: [] },
      ],
    };
    expect(window.plan(dialogue)).toEqual(window.plan(dialogue));
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npx vitest run src/plan/main.test.js`
Expected: FAIL — `Failed to resolve import "./main.js"`.

- [ ] **Step 3: Write the page's module**

Create `app/src/plan/main.js`:

```js
// The reserve's browser opens this page and nothing else. It turns a dialogue
// into the timed plan the live page will play — the same `prepare` the page
// itself imports, so what the reserve stores is exactly what plays.

import { prepare } from "../live/score.js";

window.plan = prepare;
```

- [ ] **Step 4: Write the page**

Create `app/plan.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Plan</title>
  </head>
  <body>
    <script type="module" src="/src/plan/main.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Add the entry to the build**

In `app/vite.config.js:11`, the `input` map gains a third entry:

```js
    rollupOptions: { input: { main: page("index.html"), clip: page("clip.html"), plan: page("plan.html") } },
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd app && npx vitest run src/plan/main.test.js`
Expected: PASS, 3 tests.

Run: `cd app && npm run build`
Expected: succeeds, and `app/dist/plan.html` exists.

- [ ] **Step 7: Commit**

```bash
git add app/plan.html app/src/plan/main.js app/src/plan/main.test.js app/vite.config.js
git commit -m "Commentary: a page whose whole job is turning a dialogue into its timed plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The broadcast and the book that keeps them

**Files:**
- Create: `arena/broadcasts.py`
- Create: `tests/test_broadcasts.py`

**Interfaces:**
- Consumes: `arena.store.new_id` for a time-ordered id.
- Produces:
  - `Broadcast` — a frozen dataclass with `id: str`, `run_id: str`, `dialogue: dict`, `plan: dict`, `written_at: str`, `aired_at: str | None`.
  - `BroadcastBook(directory: Path, keep: int = 20)` with:
    - `put(run_id: str, dialogue: dict, plan: dict, written_at: str) -> Broadcast`
    - `get(broadcast_id: str) -> Broadcast | None`
    - `unaired(run_id: str) -> Broadcast | None` — the oldest unaired one for that run, or None
    - `runs_stocked() -> set[str]` — every run with an unaired broadcast
    - `mark_aired(broadcast_id: str, aired_at: str) -> None`
    - `recent_aired(limit: int = 5) -> list[Broadcast]` — newest **last**, so the writer reads them in the order the spectator heard them
    - `sweep() -> int` — drops aired broadcasts once `keep` newer ones have aired, returns how many went

- [ ] **Step 1: Write the failing test**

Create `tests/test_broadcasts.py`:

```python
import json

from arena.broadcasts import Broadcast, BroadcastBook


def dialogue(run_id: str) -> dict:
    return {"run_id": run_id, "turns": [{"speaker": "peter", "text": "Well.", "fact_refs": []}]}


def plan(duration_ms: int = 4000) -> dict:
    return {"duration_ms": duration_ms, "captions": [], "notes": [], "gestures": []}


def test_a_broadcast_is_written_and_read_back(tmp_path):
    book = BroadcastBook(tmp_path)
    written = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    assert written.run_id == "run-a"
    assert written.aired_at is None
    back = book.get(written.id)
    assert back == written


def test_an_unknown_id_is_none(tmp_path):
    assert BroadcastBook(tmp_path).get("nope") is None


def test_unaired_gives_the_oldest_for_that_run(tmp_path):
    book = BroadcastBook(tmp_path)
    first = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:01:00Z")
    book.put("run-b", dialogue("run-b"), plan(), "2026-09-18T09:02:00Z")
    assert book.unaired("run-a").id == first.id
    assert book.unaired("run-c") is None


def test_an_aired_broadcast_is_no_longer_unaired(tmp_path):
    book = BroadcastBook(tmp_path)
    first = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    second = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:01:00Z")
    book.mark_aired(first.id, "2026-09-18T09:05:00Z")
    assert book.unaired("run-a").id == second.id
    assert book.get(first.id).aired_at == "2026-09-18T09:05:00Z"


def test_runs_stocked_is_every_run_with_one_waiting(tmp_path):
    book = BroadcastBook(tmp_path)
    a = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    book.put("run-b", dialogue("run-b"), plan(), "2026-09-18T09:01:00Z")
    assert book.runs_stocked() == {"run-a", "run-b"}
    book.mark_aired(a.id, "2026-09-18T09:05:00Z")
    assert book.runs_stocked() == {"run-b"}


def test_recent_aired_is_newest_last_and_leaves_the_unaired_out(tmp_path):
    book = BroadcastBook(tmp_path)
    ids = []
    for minute in range(4):
        made = book.put(f"run-{minute}", dialogue(f"run-{minute}"), plan(),
                        f"2026-09-18T09:0{minute}:00Z")
        ids.append(made.id)
    for minute, made in enumerate(ids[:3]):
        book.mark_aired(made, f"2026-09-18T10:0{minute}:00Z")
    heard = book.recent_aired(limit=2)
    assert [b.id for b in heard] == [ids[1], ids[2]]


def test_sweep_keeps_the_last_twenty_aired_and_never_an_unaired_one(tmp_path):
    book = BroadcastBook(tmp_path, keep=3)
    aired = []
    for i in range(6):
        made = book.put(f"run-{i}", dialogue(f"run-{i}"), plan(), f"2026-09-18T09:{i:02d}:00Z")
        book.mark_aired(made.id, f"2026-09-18T10:{i:02d}:00Z")
        aired.append(made.id)
    waiting = book.put("run-live", dialogue("run-live"), plan(), "2026-09-18T11:00:00Z")

    assert book.sweep() == 3
    assert [book.get(one) is None for one in aired[:3]] == [True, True, True]
    assert [book.get(one) is not None for one in aired[3:]] == [True, True, True]
    assert book.get(waiting.id) is not None
    assert book.sweep() == 0


def test_a_book_reads_a_directory_another_process_wrote(tmp_path):
    made = BroadcastBook(tmp_path).put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    assert BroadcastBook(tmp_path).get(made.id).run_id == "run-a"


def test_a_plan_that_is_not_whole_frames_is_refused(tmp_path):
    book = BroadcastBook(tmp_path)
    try:
        book.put("run-a", dialogue("run-a"), plan(duration_ms=4010), "2026-09-18T09:00:00Z")
    except ValueError as why:
        assert "40 ms" in str(why)
    else:
        raise AssertionError("a plan of 4010 ms must not be written")


def test_junk_in_the_directory_is_ignored(tmp_path):
    book = BroadcastBook(tmp_path)
    kept = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    (tmp_path / "notes.txt").write_text("not a broadcast")
    (tmp_path / "half.json").write_text("{")
    assert book.runs_stocked() == {"run-a"}
    assert book.get(kept.id) is not None
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_broadcasts.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'arena.broadcasts'`.

- [ ] **Step 3: Write the module**

Create `arena/broadcasts.py`:

```python
"""The dialogues waiting to go out, and the ones that just did.

A broadcast is one conversation written for one airing. It is not a property of
a run and it is not in the store: it is consumed once, kept for twenty airings
so the writer can read what was said, and then forgotten. The store is a dataset
repository on the Space, where every write is a commit; these are far too many
and live far too briefly to belong there.
"""

import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from .store import new_id


def utcnow() -> str:
    """The stamp a broadcast is written and aired with."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class Broadcast:
    id: str
    run_id: str
    dialogue: dict
    plan: dict
    written_at: str
    aired_at: str | None

    def body(self) -> dict:
        return {"id": self.id, "run_id": self.run_id, "dialogue": self.dialogue,
                "plan": self.plan, "written_at": self.written_at, "aired_at": self.aired_at}


class BroadcastBook:
    """One directory of broadcasts, read fresh every time.

    Reading from disk rather than from memory is what lets a book be built
    wherever it is needed — the worker's thread, the programme's rebuild, a
    route — without any of them owning the others' state.
    """

    def __init__(self, directory: Path, keep: int = 20):
        self.directory = Path(directory)
        self.keep = keep
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, broadcast_id: str) -> Path:
        return self.directory / f"{broadcast_id}.json"

    def _all(self) -> list[Broadcast]:
        found = []
        for path in self.directory.glob("*.json"):
            try:
                body = json.loads(path.read_text())
                found.append(Broadcast(**body))
            except (OSError, ValueError, TypeError):
                # A half-written file from a killed process, or something a hand
                # dropped in: the channel reads around it rather than stopping.
                continue
        found.sort(key=lambda one: one.id)
        return found

    def _write(self, broadcast: Broadcast) -> None:
        self._path(broadcast.id).write_text(
            json.dumps(broadcast.body(), indent=2, ensure_ascii=False))

    def put(self, run_id: str, dialogue: dict, plan: dict, written_at: str) -> Broadcast:
        if plan["duration_ms"] % 40:
            raise ValueError("a plan's duration must be a whole number of 40 ms frames")
        made = Broadcast(new_id(), run_id, dialogue, plan, written_at, None)
        self._write(made)
        return made

    def get(self, broadcast_id: str) -> Broadcast | None:
        path = self._path(broadcast_id)
        if not path.is_file():
            return None
        try:
            return Broadcast(**json.loads(path.read_text()))
        except (OSError, ValueError, TypeError):
            return None

    def unaired(self, run_id: str) -> Broadcast | None:
        for one in self._all():
            if one.run_id == run_id and one.aired_at is None:
                return one
        return None

    def runs_stocked(self) -> set[str]:
        return {one.run_id for one in self._all() if one.aired_at is None}

    def mark_aired(self, broadcast_id: str, aired_at: str) -> None:
        one = self.get(broadcast_id)
        if one is None or one.aired_at is not None:
            return
        self._write(replace(one, aired_at=aired_at))

    def recent_aired(self, limit: int = 5) -> list[Broadcast]:
        """Newest last: the writer reads them in the order they went out."""
        aired = [one for one in self._all() if one.aired_at is not None]
        aired.sort(key=lambda one: one.aired_at)
        return aired[-limit:]

    def sweep(self) -> int:
        aired = [one for one in self._all() if one.aired_at is not None]
        aired.sort(key=lambda one: one.aired_at)
        gone = 0
        for one in aired[:-self.keep] if self.keep else aired:
            self._path(one.id).unlink(missing_ok=True)
            gone += 1
        return gone
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_broadcasts.py -q`
Expected: PASS, 10 tests.

Run: `uv run --frozen ruff check arena tests`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add arena/broadcasts.py tests/test_broadcasts.py
git commit -m "Commentary: a broadcast is one conversation for one airing, kept off the store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The tab that prepares plans

**Files:**
- Create: `arena/commentary/tab.py`
- Create: `tests/test_commentary_tab.py`

**Interfaces:**
- Consumes: `arena.recorder.Chrome`, `arena.recorder.find_chrome`, and Task 1's `/plan.html`.
- Produces: `PlanTab(origin: str, binary: str | None = None, nice: int = 10)` with `prepare(dialogue: dict) -> dict` and `close() -> None`, usable as a context manager. It owns one `Chrome` and one `Tab` for its whole life and re-opens both if the browser has died.

The browser is launched once and kept. `arena.recorder.Chrome` already carries `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows` and `--disable-background-timer-throttling`, and its own comment says why: a backgrounded renderer stops committing frames. One tab, so it is always the foreground one.

- [ ] **Step 1: Write the failing test**

Create `tests/test_commentary_tab.py`:

```python
import pytest

from arena.commentary.tab import PlanTab

PLAN = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}


class FakeTab:
    def __init__(self):
        self.asked = []
        self.closed = False
        self.alive = True

    def navigate(self, url):
        self.url = url

    def wait_ready(self, timeout_s=60.0):
        pass

    def evaluate(self, expression, await_promise=False, timeout=60.0):
        if not self.alive:
            raise ConnectionError("socket is closed")
        self.asked.append(expression)
        return PLAN

    def close(self):
        self.closed = True


class FakeChrome:
    made = 0

    def __init__(self, binary, nice=10):
        FakeChrome.made += 1
        self.tabs = []
        self.closed = False

    def tab(self, width, height):
        made = FakeTab()
        self.tabs.append(made)
        return made

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _fresh():
    FakeChrome.made = 0


def test_it_opens_the_plan_page_once_and_reuses_the_tab(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        assert tab.prepare({"run_id": "a", "turns": []}) == PLAN
        assert tab.prepare({"run_id": "b", "turns": []}) == PLAN
    assert FakeChrome.made == 1


def test_it_navigates_to_the_plan_page_and_nothing_else(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "a", "turns": []})
        assert tab._tab.url == "http://127.0.0.1:8000/plan.html"


def test_it_asks_the_page_for_the_plan_with_the_dialogue(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "01M2", "turns": [{"speaker": "peter"}]})
        asked = tab._tab.asked[0]
        assert asked.startswith("window.plan(")
        assert '"run_id": "01M2"' in asked or '"run_id":"01M2"' in asked


def test_a_dead_browser_is_replaced_and_the_dialogue_still_prepares(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        tab.prepare({"run_id": "a", "turns": []})
        tab._tab.alive = False
        assert tab.prepare({"run_id": "b", "turns": []}) == PLAN
    assert FakeChrome.made == 2


def test_a_second_failure_in_a_row_is_raised(monkeypatch):
    class AlwaysDead(FakeChrome):
        def tab(self, width, height):
            made = super().tab(width, height)
            made.alive = False
            return made

    monkeypatch.setattr("arena.commentary.tab.Chrome", AlwaysDead)
    with PlanTab("http://127.0.0.1:8000", binary="/chrome") as tab:
        with pytest.raises(ConnectionError):
            tab.prepare({"run_id": "a", "turns": []})


def test_closing_closes_the_browser(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.Chrome", FakeChrome)
    tab = PlanTab("http://127.0.0.1:8000", binary="/chrome")
    tab.prepare({"run_id": "a", "turns": []})
    chrome = tab._chrome
    tab.close()
    assert chrome.closed
    assert tab._chrome is None


def test_no_chrome_on_the_machine_is_told_plainly(monkeypatch):
    monkeypatch.setattr("arena.commentary.tab.find_chrome", lambda: None)
    with pytest.raises(RuntimeError, match="no Chrome"):
        PlanTab("http://127.0.0.1:8000").prepare({"run_id": "a", "turns": []})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_commentary_tab.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'arena.commentary.tab'`.

- [ ] **Step 3: Write the module**

Create `arena/commentary/tab.py`:

```python
"""One browser, one tab, kept for the life of the process.

The plan a booth plays is computed by the page, not by Python, so that the file
the reserve keeps is exactly what the live page will play. That needs a browser,
and launching one per dialogue would cost seconds of CPU every forty seconds.
So the browser stays open — and it is a browser of its own with a single tab,
never a second tab in the clip renderer's: a backgrounded renderer stops
committing frames, as `Chrome`'s own switches record.
"""

import json

from ..recorder import Chrome, find_chrome

# The plan page draws nothing; the size only has to be a size.
SIZE = (640, 360)


class PlanTab:
    def __init__(self, origin: str, binary: str | None = None, nice: int = 10):
        self.origin = origin
        self.binary = binary
        self.nice = nice
        self._chrome = None
        self._tab = None

    def _open(self) -> None:
        binary = self.binary or find_chrome()
        if binary is None:
            raise RuntimeError("no Chrome found: set $CHROME")
        self._chrome = Chrome(binary, self.nice)
        self._tab = self._chrome.tab(*SIZE)
        self._tab.navigate(f"{self.origin}/plan.html")
        self._tab.wait_ready()

    def prepare(self, dialogue: dict) -> dict:
        """The dialogue's timed plan, computed by the page."""
        if self._tab is None:
            self._open()
        asking = f"window.plan({json.dumps(dialogue)})"
        try:
            return self._tab.evaluate(asking)
        except (ConnectionError, OSError, RuntimeError):
            # A browser that died under us — killed by the host, out of memory —
            # is replaced once. A second failure is the machine talking, and the
            # reserve's caller logs it and tries the next run.
            self.close()
            self._open()
            return self._tab.evaluate(asking)

    def close(self) -> None:
        if self._chrome is not None:
            self._chrome.close()
        self._chrome = None
        self._tab = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_commentary_tab.py -q`
Expected: PASS, 7 tests.

Run: `uv run --frozen ruff check arena tests`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add arena/commentary/tab.py tests/test_commentary_tab.py
git commit -m "Commentary: one browser with one tab, kept open to turn dialogues into plans

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The history is what just went out

**Files:**
- Modify: `arena/commentary/__init__.py:1-7` (the module docstring), `:48-60` (`recent_commentaries`), `:61-63` (`used_memories`), `:75-93` (`gather`), `:95-106` (`compose`)
- Modify: `tests/test_commentary.py`

**Interfaces:**
- Consumes: Task 2's `BroadcastBook.recent_aired`.
- Produces:
  - `recent_broadcasts(book, limit: int = RECENT) -> list[Broadcast]` replaces `recent_commentaries`
  - `used_memories(book, cooldown: int = COOLDOWN) -> set[str]`
  - `gather(store, record, lore, book) -> tuple[list[Fact], list[dict]]`
  - `compose(store, run_id, *, lore, provider, model, book) -> dict`

`recent_commentaries` took the run being written as `exclude`, because a run's own commentary sat in the same list it was about to be rewritten from. Airings have no such overlap — a broadcast that has aired is history whoever it was about — so `exclude` goes.

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/test_commentary.py` that covers `recent_commentaries` and `used_memories` with these, keeping the file's existing imports and fixtures:

```python
def test_recent_broadcasts_are_the_last_aired_newest_last(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.commentary import recent_broadcasts

    book = BroadcastBook(tmp_path)
    plan = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}
    ids = []
    for minute in range(3):
        made = book.put(f"run-{minute}",
                        {"run_id": f"run-{minute}", "turns": [], "lore_refs": []},
                        plan, f"2026-09-18T09:0{minute}:00Z")
        ids.append(made.id)
    book.mark_aired(ids[0], "2026-09-18T10:00:00Z")
    book.mark_aired(ids[1], "2026-09-18T10:01:00Z")

    heard = recent_broadcasts(book, limit=5)
    assert [one.id for one in heard] == [ids[0], ids[1]]


def test_used_memories_are_counted_in_airings(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.commentary import used_memories

    book = BroadcastBook(tmp_path)
    plan = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}
    aired = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": ["lore:pit"]},
                     plan, "2026-09-18T09:00:00Z")
    book.put("run-b", {"run_id": "run-b", "turns": [], "lore_refs": ["lore:rain"]},
             plan, "2026-09-18T09:01:00Z")
    book.mark_aired(aired.id, "2026-09-18T10:00:00Z")

    # Only what went out counts: a dialogue still waiting has spent no memory.
    assert used_memories(book) == {"lore:pit"}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_commentary.py -q`
Expected: FAIL — `ImportError: cannot import name 'recent_broadcasts'`.

- [ ] **Step 3: Rewrite the two readers**

In `arena/commentary/__init__.py`, replace `recent_commentaries` and `used_memories` (lines 48-63) with:

```python
def recent_broadcasts(book, limit: int = RECENT) -> list:
    """The last dialogues that went out, newest last — the order they were heard."""
    return book.recent_aired(limit)


def used_memories(book, cooldown: int = COOLDOWN) -> set[str]:
    """Memories spent on the air lately, so the bible does not repeat itself."""
    return {ref for one in book.recent_aired(cooldown)
            for ref in one.dialogue["lore_refs"]}
```

- [ ] **Step 4: Thread the book through `gather` and `compose`**

In `gather` (line 75), the signature gains `book` and the two reads change:

```python
def gather(store, record: RunRecord, lore: Lore, book) -> tuple[list[Fact], list[dict]]:
    """Everything the writer may cite for this run, and the recent wording.

    Read at the moment of writing, not at publish: the standings, the records
    and the memories are the ones true when Peter and Ray open their mouths.
    """
    events = open_events()
    withdrawn = frozenset(w.run_id for w in store.withdrawals())
    all_runs = [r for m in all_events() for r in store.runs(m.id)]
    s = situation(record, all_runs, withdrawn, events)
    voted = {m.id: m.vote for m in events.values() if m.vote is not None}
    earned = receipts(counting(list(s.runs), frozenset()), frozenset(), voted=voted)
    facts = list(result_facts(record, s.manifest, s.on_event(), earned))
    facts += pick(notable_facts(s)) + profiles(s, earned)
    used = used_memories(book)
    facts += [Fact(f"lore:{m.id}", m.memory, "lore", m.tags)
              for m in select_memories(lore, facts, used)]
    recent = recent_broadcasts(book)
    facts += [_recent_fact(one) for one in recent]
    wording = [{"ref": f"recent:{one.run_id}",
                "turns": [t["text"] for t in one.dialogue["turns"]]} for one in recent]
    return facts, wording
```

`_recent_fact` now takes a `Broadcast` rather than a commentary body. Its `facts` were what the file beside the clip carried; a broadcast carries the dialogue only, so the fact it makes is built from the run it was about:

```python
def _recent_fact(one) -> Fact:
    spoken = " ".join(turn["text"] for turn in one.dialogue["turns"])
    # The names the booth has already spoken are the ones a callback may use,
    # read with the writer's own pattern so "@alice's" yields the same identity.
    names = AT_NAME.findall(spoken)
    return Fact(f"recent:{one.run_id}", f"Earlier on the channel: {spoken}", "recent",
                identities=tuple(dict.fromkeys(names)))
```

And `compose` takes the book and passes it on:

```python
def compose(store, run_id: str, *, lore: Lore, provider, model: str, book) -> dict:
    """A checked dialogue for one run, or Rejected from the writer."""
    record = find_run(store, run_id)
    facts, recent = gather(store, record, lore, book)
    written = write(run_id, facts, recent, lore=lore, provider=provider, model=model)
    cited = {ref for turn in written["turns"] for ref in turn["fact_refs"]}
    return {
        "run_id": run_id, **written,
        "facts": [{"ref": f.ref, "kind": f.kind, "text": f.text} for f in facts
                  if f.kind == "result" or f.ref in cited],
    }
```

- [ ] **Step 5: Update the module docstring**

The first paragraph of `arena/commentary/__init__.py` says the lines are written at publish time. Replace the docstring with:

```python
"""Peter and Ray's lines, written for one airing.

context projects a run's own facts, notable digs the log for more, lore offers a
memory or two, the last five dialogues that went out give continuity, and
generator writes and checks. This module puts them together for one run, at the
moment the reserve needs it.
"""
```

- [ ] **Step 6: Run the tests**

Run: `uv run --frozen pytest tests/test_commentary.py -q`
Expected: PASS. Other suites still reference the old signatures and are fixed in Task 10; if `tests/test_clips.py` fails here, leave it — Task 10 owns it.

Run: `uv run --frozen ruff check arena tests`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add arena/commentary/__init__.py tests/test_commentary.py
git commit -m "Commentary: the continuity is what the channel just said, not what was last published

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The reserve

**Files:**
- Create: `arena/commentary/stock.py`
- Create: `tests/test_commentary_stock.py`

**Interfaces:**
- Consumes: Task 2's `BroadcastBook`, Task 3's `PlanTab`, Task 4's `compose`, `arena.live.cycle` and `arena.live.pool`, `arena.commentary.generator.Rejected`.
- Produces: `CommentaryStock(store, book, tab, compose, pool, *, depth=8, per_hour=120, log=print, landed=lambda: None, now=time.monotonic, clock=utcnow)` with `wanted() -> list[str]`, `turn() -> str | None`, `start() -> None`, `stop() -> None`, and an `available` property.

`turn()` does one unit of work and returns the run it wrote for, or None. Everything the thread does is `turn()` in a loop, so every branch is testable without a thread.

- [ ] **Step 1: Write the failing test**

Create `tests/test_commentary_stock.py`:

```python
import itertools

import pytest

from arena.broadcasts import BroadcastBook
from arena.commentary.generator import Rejected
from arena.commentary.stock import CommentaryStock
from arena.live import Entry

PLAN = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}


def entries(*run_ids):
    return [Entry(run_id, "nicolas", "Sprint", f"2026-09-1{i}", 8000, None)
            for i, run_id in enumerate(run_ids)]


class FakeTab:
    def __init__(self):
        self.prepared = []

    def prepare(self, dialogue):
        self.prepared.append(dialogue)
        return PLAN


def written(run_id):
    return {"run_id": run_id, "turns": [{"speaker": "peter", "text": "Well.", "fact_refs": []}],
            "lore_refs": [], "model": "m", "usage": {}, "facts": []}


def stock(tmp_path, pool_entries, compose, **kw):
    book = BroadcastBook(tmp_path)
    ticks = itertools.count(0, 60)
    return CommentaryStock(
        store=object(), book=book, tab=FakeTab(), compose=compose,
        pool=lambda: pool_entries, log=lambda *_: None,
        now=lambda: next(ticks), clock=lambda: "2026-09-18T09:00:00Z", **kw), book


def test_it_wants_the_next_runs_that_have_nothing_waiting(tmp_path):
    worker, book = stock(tmp_path, entries("a", "b", "c"), lambda run_id: written(run_id),
                         depth=2)
    assert worker.wanted() == ["a", "b"]
    book.put("a", {"run_id": "a", "turns": [], "lore_refs": []}, PLAN, "2026-09-18T09:00:00Z")
    assert worker.wanted() == ["b", "c"]


def test_it_wants_nothing_once_every_run_is_stocked(tmp_path):
    worker, book = stock(tmp_path, entries("a"), lambda run_id: written(run_id), depth=8)
    book.put("a", {"run_id": "a", "turns": [], "lore_refs": []}, PLAN, "2026-09-18T09:00:00Z")
    assert worker.wanted() == []
    assert worker.turn() is None


def test_a_turn_writes_a_broadcast_for_the_run_that_needs_one(tmp_path):
    worker, book = stock(tmp_path, entries("a", "b"), lambda run_id: written(run_id))
    assert worker.turn() == "a"
    waiting = book.unaired("a")
    assert waiting is not None
    assert waiting.plan == PLAN
    assert waiting.dialogue["turns"][0]["text"] == "Well."


def test_a_refusal_costs_a_turn_and_no_broadcast(tmp_path):
    def refuse(run_id):
        raise Rejected("the dialogue must be 3 to 6 turns")

    worker, book = stock(tmp_path, entries("a", "b"), refuse)
    assert worker.turn() is None
    assert book.unaired("a") is None


def test_a_refusal_lets_the_next_turn_take_the_next_run(tmp_path):
    seen = []

    def refuse_first(run_id):
        seen.append(run_id)
        if len(seen) == 1:
            raise Rejected("no")
        return written(run_id)

    worker, book = stock(tmp_path, entries("a", "b"), refuse_first)
    worker.turn()
    assert worker.turn() == "b"
    assert seen == ["a", "b"]


def test_the_hourly_cap_stops_the_turns(tmp_path):
    worker, book = stock(tmp_path, entries("a", "b", "c"), lambda run_id: written(run_id),
                         depth=8, per_hour=2)
    assert worker.turn() == "a"
    assert worker.turn() == "b"
    assert worker.turn() is None
    assert book.unaired("c") is None


def test_the_cap_counts_refusals_too(tmp_path):
    def refuse(run_id):
        raise Rejected("no")

    worker, _ = stock(tmp_path, entries("a", "b", "c"), refuse, per_hour=2)
    worker.turn()
    worker.turn()
    assert worker.attempts_left() == 0


def test_a_landed_broadcast_tells_the_programme(tmp_path):
    told = []
    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        store=object(), book=book, tab=FakeTab(), compose=lambda run_id: written(run_id),
        pool=lambda: entries("a"), log=lambda *_: None, landed=lambda: told.append(True),
        now=lambda: 0.0, clock=lambda: "2026-09-18T09:00:00Z")
    worker.turn()
    assert told == [True]


def test_a_broken_browser_costs_one_turn_and_is_logged(tmp_path):
    said = []

    class DeadTab:
        def prepare(self, dialogue):
            raise RuntimeError("no Chrome found: set $CHROME")

    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        store=object(), book=book, tab=DeadTab(), compose=lambda run_id: written(run_id),
        pool=lambda: entries("a"), log=lambda line: said.append(line),
        now=lambda: 0.0, clock=lambda: "2026-09-18T09:00:00Z")
    assert worker.turn() is None
    assert any("no Chrome" in line for line in said)


def test_it_sweeps_what_has_aged_out(tmp_path):
    worker, book = stock(tmp_path, entries("a"), lambda run_id: written(run_id), keep=1)
    first = book.put("x", {"run_id": "x", "turns": [], "lore_refs": []}, PLAN, "t")
    second = book.put("y", {"run_id": "y", "turns": [], "lore_refs": []}, PLAN, "t")
    book.mark_aired(first.id, "2026-09-18T10:00:00Z")
    book.mark_aired(second.id, "2026-09-18T10:01:00Z")
    worker.turn()
    assert book.get(first.id) is None
    assert book.get(second.id) is not None
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_commentary_stock.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'arena.commentary.stock'`.

- [ ] **Step 3: Write the worker**

Create `arena/commentary/stock.py`:

```python
"""The reserve: dialogues written before the grid needs them.

A booth can only be laid once its dialogue exists, because the slot's length is
the dialogue's length. So the writing runs ahead of the playhead: the reserve
walks the order the next cycle will play and keeps the first few runs stocked.
A run with nothing waiting simply gets no booth, which is a state the channel
already knows how to be in.
"""

import threading
import time

from ..broadcasts import utcnow
from ..live import cycle
from .generator import Rejected

DEPTH = 8  # runs kept stocked: about ten minutes of programme
PER_HOUR = 120  # generation attempts, refusals included; steady state is about 80
IDLE_S = 5.0  # how long to wait when every run in reach is stocked


class CommentaryStock:
    def __init__(self, store, book, tab, compose, pool, *, depth: int = DEPTH,
                 per_hour: int = PER_HOUR, keep: int | None = None, log=print,
                 landed=lambda: None, now=time.monotonic, clock=utcnow):
        self.store = store
        self.book = book
        self.tab = tab
        self.compose = compose
        self.pool = pool
        self.depth = depth
        self.per_hour = per_hour
        self.log = log
        self.landed = landed
        self.now = now
        self.clock = clock
        if keep is not None:
            self.book.keep = keep
        self._attempts: list[float] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def available(self) -> bool:
        return self.tab is not None

    def attempts_left(self) -> int:
        edge = self.now() - 3600
        self._attempts = [at for at in self._attempts if at > edge]
        return max(0, self.per_hour - len(self._attempts))

    def wanted(self) -> list[str]:
        """The next runs to reach the screen that have no dialogue waiting."""
        stocked = self.book.runs_stocked()
        order = cycle(self.pool(), 0)
        return [entry.run_id for entry in order if entry.run_id not in stocked][:self.depth]

    def turn(self) -> str | None:
        """One unit of work: at most one dialogue written. The run it wrote for,
        or None when nothing was wanted, the cap is reached, or it was refused."""
        self.book.sweep()
        if not self.attempts_left():
            return None
        wanted = self.wanted()
        if not wanted:
            return None
        run_id = wanted[0]
        self._attempts.append(self.now())
        try:
            written = self.compose(run_id)
            plan = self.tab.prepare({"run_id": run_id, "turns": written["turns"]})
        except Rejected as why:
            # Half of them are refused on the real router. It is the audit doing
            # its job, not a fault: the run comes round again.
            self.log(f"commentary: {run_id} refused ({why})")
            return None
        except (OSError, RuntimeError, ValueError) as why:
            self.log(f"commentary: {run_id} not written ({why})")
            return None
        self.book.put(run_id, {"turns": written["turns"], "lore_refs": written["lore_refs"]},
                      plan, self.clock())
        self.landed()
        return run_id

    def _work(self) -> None:
        while not self._stop.is_set():
            if self.turn() is None:
                self._stop.wait(IDLE_S)

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._work, name="arena-commentary",
                                            daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self.tab is not None:
            self.tab.close()
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_commentary_stock.py -q`
Expected: PASS, 10 tests.

Run: `uv run --frozen ruff check arena tests`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add arena/commentary/stock.py tests/test_commentary_stock.py
git commit -m "Commentary: a reserve that keeps the next runs stocked ahead of the playhead

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The grid lays a booth only when it has one

**Files:**
- Modify: `arena/live.py:22-30` (`Entry`), `:33-55` (`pool`), `:68-86` (`slots_for`), `Programme`
- Modify: `tests/test_live.py`

**Interfaces:**
- Consumes: Task 2's `BroadcastBook`.
- Produces: `Entry` without `booth_ms`; `slots_for(entries, start_ms, book)`; a booth slot carrying `"broadcast": "<id>"`; `Programme(source, now_ms, book)` with `mark_aired()` called on every build.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_live.py`:

```python
def test_a_run_with_no_broadcast_gets_a_replay_and_no_booth(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    entries = [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)]
    laid = slots_for(entries, 0, book)
    assert [slot["kind"] for slot in laid] == ["shutter", "replay"]


def test_a_run_with_a_broadcast_gets_its_booth_at_the_plan_s_length(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 41400, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    entries = [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)]
    laid = slots_for(entries, 0, book)
    assert [slot["kind"] for slot in laid] == ["shutter", "replay", "shutter", "booth"]
    booth = laid[3]
    assert booth["duration_ms"] == 41400
    assert booth["broadcast"] == made.id
    assert booth["run_id"] == "run-a"


def test_one_broadcast_is_laid_once_even_when_the_run_comes_round_twice(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
             {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
             "2026-09-18T09:00:00Z")
    entry = Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)
    laid = slots_for([entry, entry], 0, book)
    assert [slot["kind"] for slot in laid] == [
        "shutter", "replay", "shutter", "booth", "shutter", "replay"]


def test_a_playing_booth_is_never_handed_to_a_second_slot(tmp_path):
    """The bug this guards: a broadcast stays unaired until its slot ends, so a
    rebuild that re-reads the book would lay the playing booth again."""
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    entries = [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)]
    again = slots_for(entries, 0, book, claimed={made.id})
    assert [slot["kind"] for slot in again] == ["shutter", "replay"]


def test_a_booth_whose_slot_has_passed_is_marked_aired(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, Programme

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    at = [1_000_000]
    programme = Programme(lambda: [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)],
                          lambda: at[0], book)
    programme.slots()
    assert book.get(made.id).aired_at is None

    at[0] += 60_000
    programme.slots()
    assert book.get(made.id).aired_at is not None
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_live.py -q`
Expected: FAIL — `Entry.__init__() missing 1 required positional argument: 'booth_ms'` and `slots_for() takes 2 positional arguments but 3 were given`.

- [ ] **Step 3: Drop `booth_ms` from the pool**

In `arena/live.py`, `Entry` loses its last field:

```python
@dataclass(frozen=True)
class Entry:
    run_id: str
    user: str
    event_title: str
    submitted_at: str
    replay_ms: int
```

and `pool` stops reading a commentary. Replace the commentary lines of `pool` with nothing and tighten the frame check to the replay alone:

```python
        state, clip = store.clip_state(record.run_id)
        if state != "ready":
            continue
        replay_ms = round(clip["layouts"]["landscape"]["seconds"] * 1000)
        # A length that is not a whole number of frames cannot be laid on the
        # grid; such a run stays off the programme rather than breaking the
        # channel for everyone.
        if replay_ms % 40:
            continue
        entries.append(Entry(record.run_id, record.user, manifest.title,
                             record.submitted_at, replay_ms))
```

- [ ] **Step 4: Lay a booth only for a broadcast that is waiting**

`slots_for` takes the book and claims one broadcast per booth it lays:

```python
def slots_for(entries: list[Entry], start_ms: int, book, claimed: set[str] | None = None) -> list[dict]:
    slots: list[dict] = []
    at = start_ms
    # One waiting dialogue is one booth. `claimed` carries the broadcasts the
    # slots already laid are using, so a rebuild cannot hand a screen's playing
    # booth to a second slot in the future: a broadcast is unaired right up to
    # the moment its slot ends.
    claimed = set() if claimed is None else set(claimed)

    def add(slot: dict) -> None:
        nonlocal at
        if slot["duration_ms"] % 40:
            raise ValueError(f"{slot['kind']} for {slot.get('run_id')} is not a whole number of frames")
        slots.append({**slot, "at_ms": at})
        at += slot["duration_ms"]

    for entry in entries:
        add({"kind": "shutter", "duration_ms": SHUTTER_MS,
             "next": {"run_id": entry.run_id, "event": entry.event_title, "user": entry.user}})
        add({"kind": "replay", "duration_ms": entry.replay_ms, "run_id": entry.run_id})
        waiting = book.unaired(entry.run_id)
        if waiting is not None and waiting.id not in claimed:
            claimed.add(waiting.id)
            add({"kind": "shutter", "duration_ms": SHUTTER_MS, "next": None})
            add({"kind": "booth", "duration_ms": waiting.plan["duration_ms"],
                 "run_id": entry.run_id, "broadcast": waiting.id})
    return slots
```

- [ ] **Step 5: Give the programme the book and mark what has aired**

`Programme.__init__` takes the book and keeps it. `_extend` passes it to `slots_for` **together with the broadcasts its kept slots already use** — without that, `invalidate()` would re-offer the booth a screen is playing right now to a second slot in the future, because a broadcast stays unaired until its slot ends:

```python
    def _claimed(self) -> set[str]:
        return {slot["broadcast"] for slot in self._slots if slot["kind"] == "booth"}
```

and the call inside `_extend` becomes `slots_for(entries, self._cursor, self._book, self._claimed())`.

Every build also marks the booths whose slots have ended:

```python
    def __init__(self, source, now_ms, book):
        self._source = source
        self._now = now_ms
        self._book = book
        self._lock = threading.Lock()
        self.origin_ms = now_ms()
        self._slots: list[dict] = []
        self._cursor = self.origin_ms  # where the next cycle starts
        self._cycle = 0
```

and, called wherever the grid is read after `_extend`:

```python
    def _mark_aired(self, now: int) -> None:
        """A booth whose slot has ended has been heard, wherever a screen was.
        The server knows the grid and the clock; no screen reports anything."""
        for slot in self._slots:
            if slot["kind"] != "booth" or slot["at_ms"] + slot["duration_ms"] > now:
                continue
            self._book.mark_aired(slot["broadcast"], utcnow())
```

`utcnow` comes from `arena/broadcasts.py`, where Task 2 put it — `arena.live` must not import the commentary package.

- [ ] **Step 6: Run the tests**

Run: `uv run --frozen pytest tests/test_live.py tests/test_broadcasts.py tests/test_commentary_stock.py -q`
Expected: PASS. Existing `test_live.py` cases that built an `Entry` with `booth_ms` need their call sites updated to the five-field `Entry`; that is part of this task.

Run: `uv run --frozen ruff check arena tests`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add arena/live.py arena/broadcasts.py arena/commentary/stock.py tests/test_live.py
git commit -m "Live: the grid lays a booth only for a dialogue that is already waiting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The route that serves a broadcast

**Files:**
- Modify: `arena/web/routes_live.py`
- Modify: `tests/test_live.py` (or the suite that covers `/api/live`)

**Interfaces:**
- Consumes: Task 2's `BroadcastBook`, reached as `request.app.state.broadcasts`.
- Produces: `GET /api/live/broadcast/{broadcast_id}` returning `{"dialogue": ..., "plan": ...}`, 404 when unknown.

The body is the same shape the booth reads today from `commentary.json`, so the page's parsing does not change.

- [ ] **Step 1: Write the failing test**

```python
def test_a_broadcast_is_served_by_its_id(client, app):
    made = app.state.broadcasts.put(
        "run-a", {"run_id": "run-a", "turns": [{"speaker": "peter", "text": "Well.",
                                                "fact_refs": []}], "lore_refs": []},
        {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
        "2026-09-18T09:00:00Z")
    answer = client.get(f"/api/live/broadcast/{made.id}")
    assert answer.status_code == 200
    assert answer.json()["plan"]["duration_ms"] == 4000
    assert answer.json()["dialogue"]["turns"][0]["text"] == "Well."


def test_an_unknown_broadcast_is_a_404(client):
    assert client.get("/api/live/broadcast/nope").status_code == 404
```

Follow the fixtures the existing `/api/live` tests use; if they build the app through a helper, use the same helper and reach the book through `app.state.broadcasts`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_live.py -q`
Expected: FAIL — 404 for the first test, because the route does not exist.

- [ ] **Step 3: Add the route**

In `arena/web/routes_live.py`:

```python
@router.get("/live/broadcast/{broadcast_id}")
def broadcast(broadcast_id: str, request: Request) -> dict:
    """The dialogue a booth slot names, and the plan that plays it."""
    one = request.app.state.broadcasts.get(broadcast_id)
    if one is None:
        raise HTTPException(status_code=404, detail="no such broadcast")
    return {"dialogue": one.dialogue, "plan": one.plan}
```

with `HTTPException` and `Request` imported alongside whatever the file already imports.

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_live.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_live.py tests/test_live.py
git commit -m "Live: a booth's dialogue is served by the broadcast its slot names

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The page asks for the broadcast

**Files:**
- Modify: `app/src/api.js` (the `getCommentary` block)
- Modify: `app/src/live/interlude.js`
- Modify: `app/src/api.test.js`, `app/src/live/channel.test.js` if it names `run_id` on a booth slot

**Interfaces:**
- Consumes: Task 7's route.
- Produces: `getBroadcast(id) -> body | null` in `api.js`; the interlude prepares from `slot.broadcast`.

- [ ] **Step 1: Write the failing test**

In `app/src/api.test.js`, replace the `getCommentary` cases with:

```js
  it("fetches a broadcast by its id", async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push([url, init]);
      return { ok: true, json: async () => ({ dialogue: { turns: [] }, plan: { duration_ms: 4000 } }) };
    };
    const body = await getBroadcast("01M2K");
    expect(calls[0][0]).toBe("/api/live/broadcast/01M2K");
    expect(body.plan.duration_ms).toBe(4000);
  });

  it("gives nothing for a broadcast that is gone", async () => {
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await getBroadcast("gone")).toBe(null);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npx vitest run src/api.test.js`
Expected: FAIL — `getBroadcast is not defined`.

- [ ] **Step 3: Replace `getCommentary`**

In `app/src/api.js`, the `getCommentary` export becomes:

```js
/** A booth's dialogue and the plan that plays it, or null when it is gone. */
export async function getBroadcast(id) {
  const answer = await fetch(`/api/live/broadcast/${id}`, { cache: "no-store" });
  if (answer.status === 404) return null;
  if (!answer.ok) throw new Error(await said(answer));
  return answer.json();
}
```

matching the file's own error idiom — use the same helper the neighbouring `getCommentary` used for its message.

- [ ] **Step 4: Point the interlude at the slot's broadcast**

In `app/src/live/interlude.js`, the mount reads `slot.broadcast` instead of `slot.run_id`, and calls `getBroadcast`. The cache key becomes the broadcast id, since two airings of one run are two different dialogues:

```js
    const body = files.get(slot.broadcast) ?? await getBroadcast(slot.broadcast);
    files.set(slot.broadcast, body);
```

Keep the identity check after the await exactly as it is — it is what stops a late fetch mounting over a newer slot.

- [ ] **Step 5: Run the tests and the build**

Run: `cd app && npx vitest run`
Expected: PASS bar the 4 pre-existing `brightness.test.js` failures.

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src/api.js app/src/live/interlude.js app/src/api.test.js app/src/live/channel.test.js
git commit -m "Live: the booth fetches the broadcast its slot names, not the run's one file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Wiring, and the switch that bounds it

**Files:**
- Modify: `arena/web/app.py:44-90`
- Modify: `arena/web/config.py` (a directory for the book)
- Modify: `tests/test_live.py`

**Interfaces:**
- Consumes: every task before it.
- Produces: `app.state.broadcasts` (a `BroadcastBook`), `app.state.commentary` (a `CommentaryStock`), and a boot line saying why the booth is off when it is.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_live.py`, which already builds an app this way:

```python
def test_the_app_holds_a_broadcast_book_and_a_reserve(tmp_path):
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie"))
    assert app.state.broadcasts is not None
    assert app.state.commentary is not None


def test_the_reserve_does_not_start_when_writing_is_off(monkeypatch, tmp_path):
    monkeypatch.setenv("ARENA_COMMENTARY", "0")
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie"))
    assert app.state.booth_off == "ARENA_COMMENTARY=0"
    assert not app.state.commentary.available


def test_the_book_lives_where_the_config_says(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_BROADCASTS", str(tmp_path / "elsewhere"))
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie"))
    assert app.state.broadcasts.directory == tmp_path / "elsewhere"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_live.py -q`
Expected: FAIL — `AttributeError: 'State' object has no attribute 'broadcasts'`.

- [ ] **Step 3: Build the book and the reserve**

In `arena/web/app.py`, after the store is built and before the programme:

```python
    from ..broadcasts import BroadcastBook

    # The dialogues waiting to go out live with the process, not in the store:
    # they are consumed once and forgotten twenty airings later, and every store
    # write on the Space is a dataset commit.
    app.state.broadcasts = BroadcastBook(config.broadcast_dir)
    app.state.programme = Programme(lambda: pool(app.state.store), now_ms, app.state.broadcasts)
```

The `writer` closure loses its clip-worker role and gains the book:

```python
            def writer(run_id: str) -> dict:
                return commentary.compose(
                    app.state.store, run_id, lore=lore, provider=provider,
                    model=config.commentary_model, book=app.state.broadcasts,
                )
```

`ClipRenderer` no longer takes it (Task 10 removes the parameter). Instead, the reserve does:

```python
    from ..commentary.stock import CommentaryStock
    from ..commentary.tab import PlanTab

    app.state.commentary = CommentaryStock(
        app.state.store, app.state.broadcasts,
        PlanTab(config.origin) if writer else None,
        writer, lambda: pool(app.state.store),
        landed=lambda: app.state.programme.invalidate(),
    )
    if writer and app.state.commentary.available:
        @app.on_event("startup")
        def _stock_the_booth() -> None:
            app.state.commentary.start()
```

- [ ] **Step 4: Give the config a directory**

In `arena/web/config.py`, beside the other paths:

```python
    broadcast_dir: Path = Path(os.environ.get("ARENA_BROADCASTS", "/tmp/arena-broadcasts"))
```

matching the file's own idiom for reading an environment variable with a default.

- [ ] **Step 5: Run the tests**

Run: `uv run --frozen pytest -q`
Expected: PASS bar whatever Task 10 owns.

- [ ] **Step 6: Commit**

```bash
git add arena/web/app.py arena/web/config.py tests/test_live.py
git commit -m "Live: the Space keeps a book of broadcasts and a reserve that fills it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `commentary.json` goes

**Files:**
- Modify: `arena/store.py:26-28` (`CLIP_MEDIA`), `:320-321` (the `Store` protocol), `:507-521` (`LocalStore`), `:733-739` (`HubStore`)
- Modify: `arena/clips.py:20-21, 60-68, 155-160, 185-220`
- Modify: `arena/cli.py:194-245`
- Modify: `tests/test_clips.py`, `tests/test_cli.py`, `tests/test_routes_read.py`

**Interfaces:**
- Consumes: nothing. This task removes.
- Produces: a clip folder of three files; a `ClipRenderer` with no `commentary` parameter.

Nothing reads `commentary.json` after Task 8. This task takes it out rather than leaving it written and unread.

- [ ] **Step 1: Write the failing test**

```python
def test_a_clip_folder_holds_three_files(tmp_path):
    from arena.store import CLIP_MEDIA
    assert "commentary.json" not in CLIP_MEDIA
    assert len(CLIP_MEDIA) == 3


def test_a_render_owes_no_dialogue(tmp_path):
    # ClipRenderer's constructor no longer takes one.
    import inspect

    from arena.clips import ClipRenderer
    assert "commentary" not in inspect.signature(ClipRenderer.__init__).parameters
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: FAIL on both.

- [ ] **Step 3: Remove it from the store**

- `CLIP_MEDIA` becomes `("landscape.mp4", "vertical.mp4", "poster.png")`, and the comment above it loses its second sentence about commentary.json being rewritable.
- Delete `put_commentary` and `commentary` from the `Store` protocol, from `LocalStore` (with the `── commentary.json` section comment) and from `HubStore`.

- [ ] **Step 4: Remove it from the clip renderer**

- Drop the `commentary` parameter and `self.commentary`, the `from .commentary import commentary_json` and `from .commentary.generator import Rejected` imports, the `if self.store.commentary(run_id) is None` branch in the drain, the `self.commentary(run_id)` call, the `files["commentary.json"] = ...` line, the `prepare` parameter and `self.prepare`, and the `", with commentary"` fragment of the log line.
- `prepare_plan` stays in `arena/recorder.py`: Task 3's `PlanTab` is its own thing, and `_prepare` is still used there.

- [ ] **Step 5: Point the CLI at the book**

`arena commentary` composes with a book. Give it one on the local store's own disk:

```python
    from ..broadcasts import BroadcastBook

    book = BroadcastBook(Path(args.store).expanduser() / "broadcasts")
    written = commentary.compose(store, args.run_id, lore=lore, provider=provider,
                                 model=args.model, book=book)
```

and on a real run (not `--dry-run`) it prepares the plan and writes a broadcast:

```python
    from ..commentary.tab import PlanTab

    if args.dry_run:
        print(json.dumps(written, indent=2, ensure_ascii=False))
        return 0
    with PlanTab(args.origin) as tab:
        plan = tab.prepare({"run_id": args.run_id, "turns": written["turns"]})
    made = book.put(args.run_id, {"turns": written["turns"], "lore_refs": written["lore_refs"]},
                    plan, utcnow())
    print(f"broadcast {made.id} for {args.run_id}, {plan['duration_ms']} ms")
    return 0
```

with `utcnow` imported from `..broadcasts`. If the existing command has no `--origin`, give it one defaulting to `http://127.0.0.1:8000`, since preparing a plan needs a served page.

- [ ] **Step 6: Delete the file from the test store**

The two runs in `~/arena-board` still carry a `commentary.json`. They are ignored by the code from this task on; the on-screen check in Task 11 confirms the channel fills its reserve from scratch.

- [ ] **Step 7: Run everything**

Run: `uv run --frozen pytest -q`
Expected: PASS, no skips left behind.

Run: `uv run --frozen ruff check arena tests`
Expected: clean.

Run: `cd app && npx vitest run && npm run build`
Expected: PASS bar the 4 pre-existing failures; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add arena/store.py arena/clips.py arena/cli.py tests/
git commit -m "Clips: a render owes no dialogue, and a clip folder is three files again

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: On screen — the reserve filling, and two cycles that never repeat

**Files:**
- None committed. Screenshots and scripts stay in the session scratchpad; findings go in the commit message of the fix they cause, if any.

- [ ] **Step 1: Start from an empty reserve**

```bash
cd app && npm run build
rm -rf /tmp/arena-broadcasts
ARENA_BROADCASTS=/tmp/arena-broadcasts uv run --frozen arena serve --store ~/arena-board --user nicolas
```

Expected: the boot line says the booth is on. Within a minute or two, `ls /tmp/arena-broadcasts` shows JSON files appearing — one per run, up to the number of runs in the store.

- [ ] **Step 2: Watch a booth that was written minutes ago**

Open `http://127.0.0.1:8000/#/live`. Expected: replays only at first — the grid has no dialogue to lay a booth from — then booths appearing as the reserve fills, without a reload.

- [ ] **Step 3: The same run, twice, two conversations**

Let the channel run two full cycles and read the captions of the same run's two booths. Expected: different dialogues. Confirm from the files:

```bash
python3 -c "
import json, pathlib
for p in sorted(pathlib.Path('/tmp/arena-broadcasts').glob('*.json')):
    b = json.loads(p.read_text())
    first = b['dialogue']['turns'][0]['text']
    print(b['run_id'][:8], b['aired_at'] or 'waiting', first[:60])
"
```

Expected: two rows for the same run with different opening lines, the older one carrying an `aired_at`.

- [ ] **Step 4: The history reaches the writer**

After four or five airings, check that a fresh dialogue refers to what went before — the writer is given the last five as wording, and the audit refuses a rehash. Expected: no two consecutive booths making the same joke. If they do, that is a prompt finding, not a pipeline one: note it for the owner rather than changing the prompt here.

- [ ] **Step 5: The reserve survives a router refusal**

The real router refuses about half the time. Expected: the server log carries `commentary: <run> refused (...)` lines, and the channel keeps playing. No traceback, no stall.

- [ ] **Step 6: Record what was seen**

Write which runs aired, how many broadcasts were written and swept, what the two dialogues for one run said, and how many refusals were logged.

---

## Done when

- `uv run --frozen pytest -q` passes and `uv run --frozen ruff check arena tests` is clean.
- `cd app && npx vitest run` passes bar the 4 pre-existing Node 25 failures, and `npm run build` succeeds.
- A store with no broadcasts fills its reserve within minutes of a start, and the channel plays replays without booths until it does.
- The same run airing twice carries two different dialogues, and the second was written knowing the first went out.
- A refusal from the router costs one booth and no more.
- `commentary.json` is written nowhere and read nowhere.
