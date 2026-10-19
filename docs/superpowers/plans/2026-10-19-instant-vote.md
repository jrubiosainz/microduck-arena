# Instant Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A click on a ballot post-it seals the envelope and flies the stars at once, the next field is on stage right after, and a store read after a commit costs a tree listing rather than 10–57 s.

**Architecture:** The vote log is read from the Hub once and kept in memory, its commits made by a background writer. The run store refreshes by diffing the Hub tree against the folder it last built, under one lock. The booth loads the next field while the current one plays and hands the ceremony the cast as soon as the server answers.

**Tech Stack:** Python 3 / FastAPI, huggingface_hub 2.0.0 (`HfApi.repo_info`, `list_repo_tree`, `hf_hub_download`, `snapshot_download`, `create_commit`), pytest; vanilla JS, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-19-instant-vote-design.md`

## Global Constraints

- Everything written (code, comments, UI text, commit messages) is English. Commit messages are one sentence in the repo's style ("A … : …"), with no signature line.
- No dead code and no just-in-case code (the owner's rule): only what a task's tests or the spec require.
- Comments follow the surrounding files: they say why, in full sentences.
- Python tests: `.venv/bin/pytest` from the repo root (the main checkout's `.venv`, `/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.venv/bin/pytest`). Front tests: `npx vitest run <file>` from `app/`. Run them in the foreground; never wait on a background run.
- Known baseline: 4 front tests in `brightness.test.js` fail on this Mac (jsdom `localStorage`). They are not regressions.
- The refusal sentence, verbatim: `Votes cannot be saved right now. Try again in a minute.`
- Stuck threshold 30 s; writer backoff doubles from 1 s, capped at 60 s; shutdown flush waits at most 8 s.

## Review Focus

- A vote cast while the writer is retrying a failed commit (brief Hub hiccup, under 30 s): accepted and committed after the earlier one, in order. Test in Task 1.
- Two readers asking the store for a snapshot at the same moment, the snapshot stale: one tree listing, both get the same folder. Test in Task 2.
- A store write (`append`, `withdraw`, `mark_seen`, a clip) followed by a read: the read sees the write, as today. Test in Task 2.
- The prefetched field failing to load (the Space restarting): after the vote, the booth loads a fresh field instead of freezing on the spent one. Test in Task 3.
- A double click on a post-it: still one cast. The existing `busy` guard stays and `vote.test.js` keeps passing (Task 3).

---

### Task 1: The vote log in memory, committed in the background

**Files:**
- Modify: `arena/store.py` (`HubBallots`, `LocalBallots`, a new exception `BallotLogStuck`)
- Modify: `arena/web/routes_vote.py` (`cast_vote`, the `_vote_lock` comment)
- Modify: `arena/web/app.py` (a shutdown hook)
- Create: `tests/test_hub_ballots.py`
- Modify: `tests/test_routes_vote.py`

**Interfaces:**
- Produces: `class BallotLogStuck(RuntimeError)` in `arena/store.py`.
- Produces: `HubBallots(repo_id: str, token: str | None = None, api=None, retry_s: float = 1.0, stuck_after_s: float = 30.0)`. `api` defaults to `HfApi(token=token or os.environ.get("HF_TOKEN"))`. Methods: `since(first_day: str) -> list[Ballot]`, `cast(ballot: Ballot) -> None`, `flush(timeout: float) -> None`.
- Produces: `LocalBallots.flush(timeout: float) -> None`, a no-op ("nothing is owed: a cast is on disk when it returns"), so the app can flush whichever log it has.

- [ ] **Step 1: Write the failing tests** in `tests/test_hub_ballots.py`, with a fake api:
  - `FakeHub.snapshot_download(repo_id, repo_type, allow_patterns)` copies, from a `tmp_path` "remote" folder laid out like the dataset, only the `votes/{day}/*.json` matching `allow_patterns` into a new local folder and returns its path. It records each call's patterns.
  - `FakeHub.create_commit(repo_id, repo_type, commit_message, operations)` records `(path_in_repo, json.loads(path_or_fileobj))` per operation. It raises while its `failures` counter is above zero, counting down.

  Tests (`make_ballot` from `tests/test_ballots.py`):
  - `test_since_reads_the_hub_once_then_answers_from_memory`: two votes on the remote, `since("2026-10-13")` twice → both ballots both times, `snapshot_download` called once with `["votes/2026-10-13/*", …, "votes/<today>/*"]`.
  - `test_an_earlier_first_day_loads_only_the_days_missing`: `since("2026-10-15")` then `since("2026-10-13")` → the second call's patterns are exactly `["votes/2026-10-13/*", "votes/2026-10-14/*"]`.
  - `test_a_cast_is_counted_at_once_and_committed_by_the_writer`: `cast(b)`, then `since(...)` contains `b` before any flush; after `flush(5)`, `create_commit` recorded `(f"votes/{b.day}/{b.ballot_id}.json", b.to_dict())` with message `f"{b.event_id}: {b.voter} voted"`.
  - `test_a_failed_commit_is_retried_until_it_lands_in_order`: `failures=2`, `retry_s=0`; `cast(a)`, `cast(b)`, `flush(5)` → commits recorded `[a, b]`, each once.
  - `test_casting_a_ballot_twice_is_refused`: second `cast(b)` raises `FileExistsError`.
  - `test_a_writer_stuck_on_the_hub_refuses_the_next_vote`: `failures` = 10**6, `retry_s=0`, `stuck_after_s=0`; `cast(a)` passes, `cast(b)` raises `BallotLogStuck`; `b` is not in `since(...)`.

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/pytest tests/test_hub_ballots.py -q`
Expected: FAIL (`HubBallots()` takes no `api`, no `BallotLogStuck`).

- [ ] **Step 3: Implement `HubBallots`** in `arena/store.py`, replacing the snapshot-and-TTL version.
  - Memory: ballots by id, the earliest day loaded, one `threading.Lock`. `since` loads under that lock: the first call loads `days_from(first_day, today)`, and a call with an earlier `first_day` loads `days_from(first_day, <day before the earliest loaded>)`. It reads each download with `LocalBallots(path).since(first_day)` and keeps memory's copy on an id clash. It answers from memory: `day >= first_day`, sorted by `(cast_at, ballot_id)`.
  - `cast`: under the lock, raise `FileExistsError` for a known id. Raise `BallotLogStuck` when the oldest queued ballot was queued more than `stuck_after_s` ago (`time.monotonic()`). Otherwise add the ballot to memory and the queue. Start the writer thread on the first cast (`name="arena-votes"`, daemon).
  - Writer: one `threading.Condition`. It peeks at the queue's head and commits it exactly as today's `cast` did (no `file_exists`). On success it pops the head and notifies. On any exception it prints `votes: commit of <id> failed (<Type>: <message>), retrying in <n> s`, sleeps, and doubles the wait from `retry_s` up to 60 s. The wait resets after a success.
  - `flush(timeout)`: wait on the condition until the queue is empty or `timeout` passes.
  - Rewrite the class docstring: the Space is the only writer of `votes/`, the log is read once, an acknowledged vote is committed in the background, and the 30 s refusal exists. Keep the existing explanation of why the log has a store of its own.

- [ ] **Step 4: Run the ballot tests**

Run: `.venv/bin/pytest tests/test_hub_ballots.py tests/test_ballots.py -q`
Expected: PASS

- [ ] **Step 5: Write the failing route test** in `tests/test_routes_vote.py`:
  - `test_a_vote_the_log_cannot_take_is_refused_and_the_ballot_stays_open(client)`: enter enough runs for a ballot (as `test_voting_records_the_whole_field_and_pays_the_voter` does) and monkeypatch `app.state.ballots.cast` to raise `BallotLogStuck`. The POST answers 503 with `detail == "Votes cannot be saved right now. Try again in a minute."`. Then restore `cast`: the same ballot and lane vote successfully, since the ballot was not spent.

- [ ] **Step 6: Run it to see it fail**

Run: `.venv/bin/pytest tests/test_routes_vote.py -q -k cannot_take`
Expected: FAIL (500, the exception is not caught).

- [ ] **Step 7: Catch it in `cast_vote`** (`arena/web/routes_vote.py`): `except BallotLogStuck` raises `HTTPException(status_code=503, detail=<the sentence>)` beside the existing `FileExistsError` branch. Rewrite the `_vote_lock` comment: the critical section is now memory only, and the Hub commit happens after the answer. Add an `@app.on_event("shutdown")` hook in `arena/web/app.py` that calls `app.state.ballots.flush(8)`, with a comment that says it commits the votes this process acknowledged. Add `LocalBallots.flush`.

- [ ] **Step 8: Run the Python suite**

Run: `.venv/bin/pytest -q`
Expected: PASS (as before this task, plus the new tests).

- [ ] **Step 9: Commit**

```bash
git add arena/store.py arena/web/routes_vote.py arena/web/app.py tests/test_hub_ballots.py tests/test_routes_vote.py
git commit -m "A vote is counted in memory and committed to the Hub after the answer: the voter no longer waits on three Hub round trips"
```

### Task 2: The store refreshes by difference, one refresh at a time

**Files:**
- Modify: `arena/store.py` (`HubStore.__init__`, `HubStore.snapshot`)
- Create: `tests/test_hub_store.py`

**Interfaces:**
- Produces: `HubStore(repo_id: str, token: str | None = None, snapshot_ttl_s: float = 20.0, api=None)`. `api` defaults to `HfApi(token=token or os.environ.get("HF_TOKEN"))`. `snapshot(fresh: bool = False) -> LocalStore` keeps its signature. Every other method is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/test_hub_store.py`, with a fake api over a `tmp_path` "remote" folder of files and a `blobs: dict[path, str]` you edit between refreshes:
  - `repo_info(repo_id, repo_type)` returns `SimpleNamespace(sha=<current head>)` and counts its calls.
  - `list_repo_tree(repo_id, recursive, revision, repo_type)` yields `RepoFolder(path="runs", oid="x")` and one `RepoFile(path=p, size=1, oid=blob)` per remote file.
  - `hf_hub_download(repo_id, filename, repo_type, revision)` copies the remote file into a fake cache folder named by `revision` and returns that path. It records `filename`.

  Tests (`make_record` from `tests/test_store.py`, written to the remote as `runs/<event>/<id>.json`, plus `traces/<id>.npz`, `votes/…`, `clips/<id>/clip.json`, `clips/<id>/clip.mp4`):
  - `test_the_first_refresh_fetches_every_file_but_media_and_votes`: `store.runs(event)` reads the record back, and the downloaded filenames exclude `*.mp4`, `*.png` and `votes/…`.
  - `test_an_unchanged_head_refreshes_without_fetching`: TTL 0, `runs()` twice with the same head → one round of downloads only.
  - `test_a_new_head_fetches_only_what_changed`: add a run and change `clip.json`'s blob, new head → the second round downloads exactly the new run's two files and `clip.json`, and `runs()` lists both runs.
  - `test_a_file_gone_from_the_hub_is_gone_from_the_snapshot`: remove `clips/<id>/pending.json`, new head → `clip_state` no longer reads it as pending.
  - `test_a_reader_keeps_its_folder_for_one_refresh`: keep `s1 = store.snapshot()`, one refresh to a new head, then `s1.runs(event)` still reads. After a second new head, the first folder is deleted.
  - `test_concurrent_readers_share_one_refresh`: `repo_info` sleeps 0.2 s, and 8 threads call `store.snapshot()` on a stale store → `repo_info` called once and every thread got the same `LocalStore`.
  - `test_a_write_is_read_back_at_once`: the fake `create_commit` also writes the file into the remote and moves the head. `store.withdraw(...)`, then `store.withdrawals()` contains it without waiting out the TTL.

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/pytest tests/test_hub_store.py -q`
Expected: FAIL (`HubStore()` takes no `api`).

- [ ] **Step 3: Implement the refresh** in `HubStore`.
  - The snapshot folders go under one `tempfile.mkdtemp(prefix="arena-store-")` per instance. Keep `{path: (blob_id, absolute target)}` for the current folder, the commit it was built from, and the current and previous folders.
  - `snapshot()`, under one `threading.Lock`, re-checks the TTL and `_snapshot` inside the lock. It reads the head with `repo_info`. If the head is the current folder's commit, it reuses the folder: `_snapshot = LocalStore(folder)` and restarts the TTL. Otherwise it builds:

```python
tree = {f.path: f.blob_id for f in api.list_repo_tree(repo, recursive=True, revision=head, repo_type="dataset")
        if isinstance(f, RepoFile) and not f.path.endswith((".mp4", ".png")) and not f.path.startswith("votes/")}
# a file whose blob is unchanged points where it pointed; the rest is fetched (thread pool of 8)
targets = {p: old[p][1] for p, blob in tree.items() if p in old and old[p][0] == blob}
targets |= dict(zip(missing, pool.map(lambda p: os.path.realpath(api.hf_hub_download(...)), missing)))
# folder = root / head, rmtree'd first if a failed build left it; one absolute symlink per path;
# then swap: current ← folder, previous ← old current, rmtree the one before
```
  - Delete the `snapshot_download` import from `HubStore`, since `HubBallots` keeps its own. Rewrite the class comment about reads: snapshots are built by difference from the Hub tree, one at a time, because a `snapshot_download` at a new revision costs a HEAD per file (10–57 s measured on the Space, 2026-10-19).

- [ ] **Step 4: Run the store tests**

Run: `.venv/bin/pytest tests/test_hub_store.py tests/test_store.py -q`
Expected: PASS

- [ ] **Step 5: Measure on the real dataset, read only.** Point a `HubStore("pollen-robotics/microduck-arena-runs")` at the live repo with `HF_HUB_CACHE` set to a scratch folder. Time the first `snapshot()`. Then construct with `snapshot_ttl_s=0`, read `repo_info` and pin an older commit by monkeypatching `repo_info` to return `commits[3]`, then the head. Time the second refresh.
Expected: the second refresh is about the tree listing (≈2 s from this Mac) and downloads only the files added since `commits[3]`.

- [ ] **Step 6: Run the Python suite and commit**

Run: `.venv/bin/pytest -q` → PASS

```bash
git add arena/store.py tests/test_hub_store.py
git commit -m "The store refreshes by difference from the Hub tree, one refresh at a time: a new revision no longer costs a HEAD per file"
```

### Task 3: The booth plays the next field it already has

**Files:**
- Modify: `app/src/vote.js` (`renderVote`)
- Create: `app/src/vote.flow.test.js`

**Interfaces:**
- Consumes: `castVote` answering `{ points, cast_today }`, a 503 refusal surfacing as an `Error` whose message is the sentence (unchanged `api.js`).
- Produces: nothing exported. `votePanel`, `runningOrder` and `DEAD_BALLOT_MESSAGE` keep their signatures.

- [ ] **Step 1: Write the failing tests** in `app/src/vote.flow.test.js`. Mock `./viewer.js` (`setLanes` spy, `player: { time: 0, duration: 20, playing: true }`), `./sound.js` (`play`, `isMuted`, `toggleMuted` no-ops) and `./api.js`. `getBallot` returns the promises a test queues: a ballot is `{ state: "ballot", ballot: "<token>", lanes: 2, cast: [[duck], [duck]], cast_today, per_day: 20 }`, and `getBallotTrace` returns `[new Float32Array([<token-specific value>])]` so entries can be told apart. Use the stage event of `vote.solo.test.js`.
  - `the envelope seals as soon as the vote is counted, while the next field is still loading`: stub `matchMedia` to `{ matches: false }` and use fake timers. The second `getBallot` never resolves, and `castVote` resolves `{ points: 1, cast_today: 1 }`. Click a `.vote-pick`, `await vi.advanceTimersByTimeAsync(600)` → `document.querySelector(".vote-ceremony__envelope--sealed")` is not null.
  - `the prefetched field takes the stage after the vote, its count from the cast`: the second ballot "B" (`cast_today: 0`) resolves, and `castVote` resolves `{ points: 1, cast_today: 1 }` → after the click settles, the last `setLanes` call plays B's first lane and `.vote-count` reads `1 / 20 today`. `getBallot` was called exactly twice.
  - `the day's last vote shows the quota panel, not the prefetched field`: `castVote` resolves `{ points: 1, cast_today: 20 }` → `.vote-empty` reads `That is your 20 votes for today. Come back tomorrow.`
  - `a dead ballot loads a fresh field rather than the prefetched one`: `castVote` rejects `new Error(DEAD_BALLOT_MESSAGE)`, and the third `getBallot` resolves ballot "C" → C is on stage and `.vote-status.bad` reads the message.
  - `a prefetch that failed is loaded again after the vote`: the second `getBallot` rejects, and the third resolves "C" → C is on stage after the vote.

- [ ] **Step 2: Run them to see them fail**

Run (from `app/`): `npx vitest run src/vote.flow.test.js`
Expected: FAIL (the envelope waits for the next field, and `getBallot` is called after the cast rather than before).

- [ ] **Step 3: Restructure `renderVote`.**
  - `load()` returns `{ ballot }` for a non-ballot state, or `{ ballot, entries }`. That is today's `next()` up to building the entries.
  - `show(field, message)` puts a field on screen, as today's `next()` does after loading. For a ballot it starts loading the next field: `upcoming = load()`, with `upcoming.catch(() => {})` so a prefetch nobody awaits never reports an unhandled rejection.
  - `onPick(lane)`: keep the `busy` guard. `const cast = await castVote(...)`. Then, without awaiting, the booth advances: it awaits `upcoming`, or `load()` again if that rejected, and shows the quota panel when `cast.cast_today >= ballot.per_day`. Otherwise it shows the field with its ballot's `cast_today` replaced by `cast.cast_today`. `onPick` returns `cast`. On `DEAD_BALLOT_MESSAGE`: `show(await load(), error.message)`. Any other error: rethrow (unchanged).
  - Start with `show(await load())`. Update the comment above `runCeremony`'s server wait only if it now says something false.

- [ ] **Step 4: Run the booth's tests**

Run (from `app/`): `npx vitest run src/vote.flow.test.js src/vote.solo.test.js src/vote.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole front suite**

Run (from `app/`): `npx vitest run`
Expected: only the 4 known `brightness.test.js` failures.

- [ ] **Step 6: Check it in a browser.** Run the local booth on the scratch store (API on 8003, vite on 5182, as set up in this session) and use headless Chrome. Click a post-it, then record the time to `.vote-ceremony__envelope--sealed` and to the next field's `.act` row.
Expected: sealed within ~0.6 s of the click, and the next field present when the ceremony ends.

- [ ] **Step 7: Commit**

```bash
git add app/src/vote.js app/src/vote.flow.test.js
git commit -m "The booth loads the next field while this one plays and hands the ceremony the cast as soon as it is counted"
```
