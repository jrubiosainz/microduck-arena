# MicroDuck Got a Talent, phase B — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An entry on the `got-a-talent` stage plays its own `timeline.json` from the Hub. The site draws, replays, films and words it as a performance. The workshop edits the timeline, plays it and publishes it. Everything is ready to push, and nothing is pushed.

**Architecture:**
- **Arena server:** `hub_fetch` reads and validates `timeline.json` at the pinned revision for a stage, and submit and `recover` play it. A run records its timeline's sha256, so that the same weights with another timeline count as another performance. The event summary says which course an event is on (`course`).
- **Front-end:** one `isStage(event)` replaces the five `got-a-talent` id checks and drives the stage's facts, board, publication page, share text and clip.
- **Workshop:** it keeps the challenge folder's `timeline.json` as the performance. It evaluates stage checkpoints with it, replays a checkpoint at once after an edit (reusing the exported ONNX), and passes `--timeline` to `publish`.
- **microduck_rl:** its `publish` writes what each command group means, from the challenge's `challenge.toml`. It also words a stage entry as a performance.

**Tech Stack:** Python 3.12, FastAPI, MuJoCo 3.10, numpy, onnxruntime, pytest; vanilla JS + three.js, vitest/jsdom; microduck_rl (tyro CLI, pytest).

**Spec:** `docs/superpowers/specs/2026-09-29-swag-stage-design.md` (section *Phase B: after plan 4 merges*), plus the owner's phase B brief of 2026-10-01: the three phase A findings, re-export the reference under got-a-talent, rewrite the guide, version 0.4.3+. Phase A plan: `docs/superpowers/plans/2026-09-29-swag-stage-phase-a.md` (executed).

## Global Constraints

- **Commits and GitHub:** English only. Never signed: no `Co-Authored-By`, no "Generated with Claude Code". This overrides any default attribution.
- **Nothing leaves this Mac without the owner's yes.** No push of any branch, no wheel upload, no Hub publish, no write to the Space's dataset, no HF Job.
- **git:** always `/usr/bin/git`. The RTK hook's `git` rewrite is refused inside a worktree.
- **Arena worktree:** `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/swag-stage` (branch `swag-stage`, rebased on main 93cc1d3). uv is always `uv run --no-config --frozen …`.
- **microduck-challenges worktree:** `~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/swag-stage`.
  - Its `.venv` holds the Arena worktree and the microduck_rl worktree, both editable.
  - **Never `uv run` or `uv sync` there**, not even `uv run --no-sync`.
  - Call the tools directly: `.venv/bin/python`, `.venv/bin/publish`, `.venv/bin/arena`, `.venv/bin/hf`.
- **microduck_rl worktree:** `~/Projects/HuggingFace/microduck_rl/.claude/worktrees/publish-timeline` (branch `publish-timeline`, draft PR #64, already pushed once). Commit locally only. Tests: `.venv/bin/python -m pytest -q <files>`.
- **Tests always run in the FOREGROUND, as one Bash call with `timeout: 600000`.** Never `run_in_background`, never a monitor, never end a turn "waiting for" a run. The Arena's Python suite runs as three calls, each under 10 minutes:
  1. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop` (184 passed at the start)
  2. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_[a-l]*.py`
  3. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_[m-z]*.py`

  Calls 2 and 3 together were 860 passed and 1 deselected at the start.
- **Front-end:** `cd app && npm test`. The only accepted failures are the 4 known ones in `src/brightness.test.js` (644 passed at the start).
- **Runner:** the lane path of `arena/runner.py`, the golden run and `RUNNER_VERSION` (4) do not change. Never re-score a published run on this Mac.
- **Wording:** the event id is `got-a-talent` and the title is "MicroDuck Got a Talent". A stage run is a "performance", never a "show": the booth prompt uses "show" for the broadcast. A stage has no time, finish, seeds or speed; its only time is its length.
- **Workshop UI:**
  - Reuse the Arena's own components: terminal box, figure, hint, button, quiet.
  - Very few buttons, each shown only when it is needed.
  - No new zone of controls.
- **Scratchpad:** `SCRATCH=/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/4e7a2c6d-de34-49fd-913c-8ce191bfc1ce/scratchpad`.

## Review Focus

1. **The same weights entered again with another timeline** are another performance, not "already entered". The idempotency key holds the timeline's sha256. Pinned in Task 3.
2. **A `timeline.json` on the Hub the Arena will not play** (not JSON, longer than 20 s, a wrong group size) is refused with a 400. The refusal names `<repo>/timeline.json` and the reason, and comes before the ONNX is downloaded. Pinned in Task 2.
3. **The real stage summary** (no `length_m`, no `sweep_*`) is fed to every view that prints event facts: home flyers, the other-rounds strip, the race page, the workshop home and challenge page. None may throw, which is what they do today. Pinned in Task 5 with fixtures of the real shape.
4. **A timeline the workshop's page sends that the Arena refuses** is not saved, and the refusal says where. A `timeline.json` broken by hand fails the evaluation until it is fixed, then evaluates again. Pinned in Task 8.
5. **A performance whose simulation MuJoCo had to reset** (its state stays finite) ends as `"fall"` and never reaches a ballot. Pinned in Task 1.

## Not in this plan (reported to the owner instead)

- **The booth's prompt.** Phase A gave Peter & Ray the stage's facts and context ("a performance on a stage decided by the public's votes", its length as its only time, no fall word). Nothing here changes the prompt: the tone is measured once the platform is public, and every measure costs LLM calls.
- **The lane's own `isfinite` check in `run_once`.** MuJoCo's reset makes it dead too, but the lane path does not move in this phase.
- **Self-contacts.** They are frictionless (condim 1) in got_a_talent's training and have condim 3 in the Arena. The fix is a retrain on HF Jobs. The reference passes the Arena as it is.
- **The 4 got-a-talent entries on the Space.** They are walking policies (cdeplanne ×2, Nico-robot ×2), raced on the old lane, with no timeline. Re-run as performances, they would stand still for 20 s. Withdrawn, they leave the board, the ballots and recovery: a withdrawal is append-only and `recover` respects it. The owner decides at the deploy; no code either way.
- **Owner's yes needed:**
  - pushing any of the three branches;
  - the 0.4.3 wheel upload;
  - relocking microduck-challenges onto it and onto PR #64's new head;
  - publishing the reference to `pollen-robotics/microduck-got-a-talent-reference`.

---

## Part 1 — The Arena (worktree `swag-stage`)

### Task 1: a performance MuJoCo had to reset ends there

MuJoCo answers a non-finite state by resetting the simulation to the model's defaults and counting a warning. The state stays finite, so `run_stage`'s `isfinite` check never fires: a diverged performance would carry on from the reset pose and go to voters. Measured on 2026-10-01: after `qvel = 1e200`, `mj_step` reset `time` to 0.005, `qpos` stayed finite, and `warning[mjWARN_BADQVEL].number` went to 1.

**Files:**
- Modify: `arena/runner.py`. Add `_RESET_WARNINGS` and `_reset_by_mujoco` above `run_stage`, and change the loop and the docstring of `run_stage` only.
- Test: `tests/test_run_stage.py`

**Interfaces:**
- Produces: `run_stage` returns status `"fall"`, `time_s` `None`, and a trace that stops before the step MuJoCo reset.

- [ ] **Step 1: Write the failing test** (append to `tests/test_run_stage.py`)

```python
def test_a_simulation_mujoco_had_to_reset_ends_the_performance(talent, walker, monkeypatch):
    """MuJoCo answers a non-finite state by resetting to the model's defaults and carrying on: the
    state stays finite, and only its warning counters say the performance diverged."""
    import arena.runner as runner

    real, calls = runner._step, []

    def diverging(model, data, *rest):
        calls.append(None)
        if len(calls) == 25 + 40:  # the settle's 25 steps, then the 40th timed step
            data.qvel[:] = 1e200  # past mjMAXVAL: what a solver explosion leaves behind
        return real(model, data, *rest)

    monkeypatch.setattr(runner, "_step", diverging)
    outcome = run_stage(talent, walker, constant_timeline(STILL, 3.0), seed=1)
    assert (outcome.status, outcome.time_s) == ("fall", None)
    assert len(outcome.trace) == 39  # the steps played before it, never the reset pose
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_run_stage.py -k reset`
Expected: FAIL (`('finish', 3.0) != ('fall', None)`).

- [ ] **Step 3: Implement**

In `arena/runner.py`, above `run_stage`:

```python
# MuJoCo answers a non-finite position, velocity or acceleration by resetting the whole
# simulation to the model's defaults and counting a warning (mj_checkPos, mj_checkVel,
# mj_checkAcc). The state stays finite, so a diverged run would carry on from the reset
# pose; these counters are what says it happened.
_RESET_WARNINGS = (
    mujoco.mjtWarning.mjWARN_BADQPOS,
    mujoco.mjtWarning.mjWARN_BADQVEL,
    mujoco.mjtWarning.mjWARN_BADQACC,
)


def _reset_by_mujoco(data) -> bool:
    return any(data.warning[w].number for w in _RESET_WARNINGS)
```

In `run_stage`, replace the docstring's last two sentences and the loop body:

```python
    """Play a timeline on a stage: no line to cross, and no fall stops the show.

    The settle plays the first keyframe; timed step k plays the command at
    k * CTRL_DT. Only a simulation MuJoCo had to reset ends a performance early:
    a solver explosion is not a performance, and the trace stops before it.
    """
    ...
    for step in range(steps):
        sim.step(np.asarray(timeline.command_at(step * CTRL_DT), dtype=np.float64))
        if _reset_by_mujoco(sim.data):
            status, time_s = "fall", None
            break
        sim.record(frames[written])
        written += 1
```

`run_once` (the lane) keeps its own check, unchanged.

- [ ] **Step 4: Run the stage and runner tests**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_run_stage.py tests/test_evaluate_stage.py tests/test_runner.py`
Expected: all pass, the golden run included.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/runner.py tests/test_run_stage.py
/usr/bin/git commit -m "run_stage ends a performance MuJoCo had to reset: its state stays finite, only the warning counters say so"
```

### Task 2: `hub_fetch` reads a stage entry's `timeline.json` at the pinned revision

**Files:**
- Modify: `arena/hub_fetch.py`
- Test: `tests/test_hub_fetch.py`

**Interfaces:**
- Consumes: `arena.timeline.load_timeline(path, max_duration_s) -> Timeline`, `TimelineError`.
- Produces: two new defaulted fields on `FetchedPolicy`, `timeline: Timeline | None = None` and `timeline_sha256: str | None = None`. Both are set only when `event` is a stage and the repo holds `timeline.json`.

- [ ] **Step 1: Write the failing tests**

Change `_fetch` in `tests/test_hub_fetch.py`. A `timeline` argument puts `timeline.json` in the fake repo:

```python
def _fetch(tmp_path, manifest, event_id="sprint-2m", revision=None, downloads=None, timeline=None):
    """fetch_policy against a fake Hub holding policy.onnx and, unless None, this manifest and this
    timeline.json."""
    files = (["README.md", "policy.onnx"] + ([] if manifest is None else ["manifest.json"])
             + ([] if timeline is None else ["timeline.json"]))
    manifest_path = tmp_path / "manifest.json"
    if manifest is not None:
        manifest_path.write_text(manifest if isinstance(manifest, str) else json.dumps(manifest))
    timeline_path = tmp_path / "timeline.json"
    if timeline is not None:
        timeline_path.write_text(timeline if isinstance(timeline, str) else json.dumps(timeline))
    seen = [] if downloads is None else downloads

    def download(repo_id, filename, rev):
        seen.append((filename, rev))
        return {"manifest.json": str(manifest_path), "timeline.json": str(timeline_path)}.get(filename, "/tmp/x.onnx")

    return fetch_policy(
        "alice/walker", revision=revision, event=load_event(event_id),
        info=lambda repo_id, rev: (files, f"sha-of-{rev or 'main'}", {}), download=download,
    )
```

Then append the tests (add `import hashlib` at the top):

```python
PERFORMANCE = {"timeline_version": 1, "duration_s": 4.0,
               "keyframes": [{"t": 0.0}, {"t": 2.0, "twist": [1, 0, 0]}]}


def test_a_stage_entry_brings_its_timeline_from_the_pinned_revision(tmp_path):
    downloads = []
    fetched = _fetch(tmp_path, None, event_id="got-a-talent", revision="abc123", downloads=downloads,
                     timeline=PERFORMANCE)
    assert fetched.timeline.duration_s == 4.0
    assert fetched.timeline.command_at(2.0)[0] == 1.0
    assert fetched.timeline_sha256 == hashlib.sha256((tmp_path / "timeline.json").read_bytes()).hexdigest()
    assert downloads == [("timeline.json", "sha-of-abc123"), ("policy.onnx", "sha-of-abc123")]


def test_a_stage_entry_without_a_timeline_plays_the_events_command(tmp_path):
    fetched = _fetch(tmp_path, None, event_id="got-a-talent")
    assert (fetched.timeline, fetched.timeline_sha256) == (None, None)


@pytest.mark.parametrize("content, reason", [
    ("{not json", "not a JSON file"),
    ({**PERFORMANCE, "duration_s": 25.0}, "longer than this event's 20 s"),
    ({**PERFORMANCE, "keyframes": [{"t": 0.0, "head": [0, 0, 1]}]}, "keyframes[0].head"),
])
def test_a_timeline_the_arena_will_not_play_is_refused_before_the_weights(tmp_path, content, reason):
    downloads = []
    with pytest.raises(FetchError) as refused:
        _fetch(tmp_path, None, event_id="got-a-talent", downloads=downloads, timeline=content)
    assert "alice/walker/timeline.json" in str(refused.value)
    assert reason in str(refused.value)
    assert "policy.onnx" not in [name for name, _ in downloads]


def test_a_race_never_reads_a_timeline(tmp_path):
    downloads = []
    fetched = _fetch(tmp_path, None, event_id="sprint-2m", downloads=downloads, timeline="{not json")
    assert fetched.timeline is None
    assert "timeline.json" not in [name for name, _ in downloads]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_hub_fetch.py`
Expected: the new tests fail (`FetchedPolicy` has no `timeline`, and no refusal is raised).

- [ ] **Step 3: Implement** in `arena/hub_fetch.py`

Add `import hashlib` and `from .timeline import Timeline, TimelineError, load_timeline`. Add `TIMELINE = "timeline.json"` under `MANIFEST`. Then add a paragraph at the end of the module docstring:

```
A stage entry's `timeline.json` — the command it performs, and when — is read at
the same revision too, when the event named is a stage, and checked with the
Arena's own loader before the weights: a file the Arena will not play is refused
with the reason. A repo without one plays the event's own command. A race never
reads it.
```

The new fields, after `manifest`:

```python
    # A stage entry's performance (its timeline.json at the same revision), checked; None when the
    # repo has none (the event's own command plays) or the event is a race, which never reads it.
    timeline: Timeline | None = None
    # The sha256 of that file's bytes: the same weights with another timeline are another entry.
    timeline_sha256: str | None = None
```

The reader, after `_read_manifest`:

```python
def _read_timeline(repo_id: str, revision: str, download, event) -> tuple[Timeline, str]:
    try:
        path = Path(download(repo_id, TIMELINE, revision))
    except Exception as exc:
        raise FetchError(f"could not download {repo_id}/{TIMELINE}: {exc}") from exc
    try:
        timeline = load_timeline(path, event.time_limit_s)
    except TimelineError as exc:
        raise FetchError(f"{repo_id}/{TIMELINE} cannot be played: {exc}") from exc
    return timeline, hashlib.sha256(path.read_bytes()).hexdigest()
```

In `fetch_policy`, right after the `check_manifest` lines:

```python
    timeline = timeline_sha256 = None
    if event is not None and event.course.kind == "stage" and TIMELINE in files:
        # Before the weights too: a performance the Arena will not play costs one small file.
        timeline, timeline_sha256 = _read_timeline(repo_id, pinned, download, event)
```

Pass `timeline=timeline, timeline_sha256=timeline_sha256` to the returned `FetchedPolicy`.

- [ ] **Step 4: Run the hub tests**

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_hub_fetch.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/hub_fetch.py tests/test_hub_fetch.py
/usr/bin/git commit -m "hub_fetch reads a stage entry's timeline.json at the pinned revision and refuses one the Arena will not play, before the weights"
```

### Task 3: submit and recover play the entry's timeline; a run remembers which one

**Files:**
- Modify: `arena/store.py` (`RunRecord`), `arena/web/routes_submit.py`, `arena/recover.py`
- Test: `tests/test_routes_submit.py`, `tests/test_recover.py`, `tests/test_store.py` (round trip)

**Interfaces:**
- Consumes: `FetchedPolicy.timeline`, `FetchedPolicy.timeline_sha256` (Task 2).
- Produces:
  - `RunRecord.timeline_sha256: str | None = None`, serialised as `"timeline_sha256"`.
  - The submit answer gains `"course": "lane" | "stage"`, which microduck_rl reads in Task 11.
  - `_speed` returns `None` for an event without a sweep.

- [ ] **Step 1: Write the failing tests**

In `tests/test_routes_submit.py`, make the fake Hub able to serve a timeline:

```python
from arena.timeline import Timeline

# A repo id registered here also carries this timeline.json, as (Timeline, sha256).
_TIMELINES: dict[str, tuple] = {}


def _fetched(path=REFERENCE, repo_id="alice/walker", filename="policy.onnx", revision="rev1", manifest=None,
             timeline=None, timeline_sha256=None):
    return FetchedPolicy(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        path=path,
        url=f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}",
        manifest=manifest,
        timeline=timeline,
        timeline_sha256=timeline_sha256,
    )
```

In the autouse `hub` fixture:
- add `_TIMELINES.clear()` beside `_HUB.clear()`;
- in `fetch`, add `timeline, digest = _TIMELINES.get(repo_id, (None, None))`;
- change the return to `return _fetched(path=_HUB[repo_id], repo_id=repo_id, revision=revision or "rev1", timeline=timeline, timeline_sha256=digest)`.

Then append:

```python
def performance(seconds, sit_at=None):
    """A timeline of `seconds` standing, sitting from `sit_at` when given."""
    stand, sit = (0.0,) * 13, (1.0,) + (0.0,) * 12
    if sit_at is None:
        return Timeline(seconds, (0.0,), (stand,))
    return Timeline(seconds, (0.0, sit_at), (stand, sit))


def test_a_stage_entry_plays_its_timeline(api):
    _TIMELINES["alice/best_alpha_walking"] = (performance(2.0), "a" * 64)
    response = submit(api, event="got-a-talent")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["course"] == "stage"
    assert (body["score"], body["seeds_finished"], body["seeds_total"]) == (pytest.approx(2.0), 1, 1)
    trace = api.get(f"/api/runs/{body['run_id']}/trace")
    assert int(trace.headers["X-Frame-Count"]) == 100


def test_the_same_weights_with_another_timeline_are_another_performance(api):
    _TIMELINES["alice/best_alpha_walking"] = (performance(2.0), "a" * 64)
    first = submit(api, event="got-a-talent").json()
    again = submit(api, event="got-a-talent").json()
    assert again["already_entered"] and again["run_id"] == first["run_id"]
    _TIMELINES["alice/best_alpha_walking"] = (performance(2.0, sit_at=1.0), "b" * 64)
    other = submit(api, event="got-a-talent").json()
    assert not other["already_entered"] and other["run_id"] != first["run_id"]


def test_a_speed_sent_to_a_stage_is_ignored_not_a_500(api):
    _TIMELINES["alice/best_alpha_walking"] = (performance(1.0), "a" * 64)
    response = submit(api, event="got-a-talent", command_vx="0.3")
    assert response.status_code == 200, response.text
    assert response.json()["command_vx"] == 0.0
```

In `test_an_entry_is_credited_to_the_tokens_owner`, add `assert response.json()["course"] == "lane"`.

In `tests/test_recover.py`, append:

```python
def test_recover_plays_a_stage_entry_with_its_timeline_at_the_listed_revision(tmp_path, monkeypatch):
    import pytest

    from arena.assets import ASSET_ROOT
    from arena.hub_fetch import FetchedPolicy
    from arena.manifest import load_event
    from arena.recover import recover
    from arena.store import LocalStore
    from arena.timeline import Timeline

    asked = []

    def fetch_policy(repo_id, revision=None, event=None):
        asked.append((repo_id, revision, event.id))
        return FetchedPolicy(
            repo_id=repo_id, filename="policy.onnx", revision=revision,
            path=ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx",
            url=f"https://huggingface.co/{repo_id}/resolve/{revision}/policy.onnx",
            timeline=Timeline(2.0, (0.0,), ((0.0,) * 13,)), timeline_sha256="t" * 64,
        )

    monkeypatch.setattr("arena.hub_fetch.fetch_policy", fetch_policy)
    reader = (listing(("alice/talent", "rev7")),
              manifests({"alice/talent": arena_manifest(arena={"event": "got-a-talent"})}))
    [record] = recover(LocalStore(tmp_path), [load_event("got-a-talent")], reader=reader)
    assert asked == [("alice/talent", "rev7", "got-a-talent")]
    assert record.score == pytest.approx(2.0)
    assert (record.timeline_sha256, record.source["revision"]) == ("t" * 64, "rev7")
```

In `tests/test_store.py`, add a round trip:

```python
def test_a_run_keeps_the_timeline_it_played():
    record = make_record(event_id="got-a-talent", timeline_sha256="t" * 64)
    assert RunRecord.from_dict(record.to_dict()).timeline_sha256 == "t" * 64
    old = make_record().to_dict()
    del old["timeline_sha256"]  # a run recorded before timelines existed
    assert RunRecord.from_dict(old).timeline_sha256 is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_submit.py tests/test_recover.py tests/test_store.py`
Expected: the new tests fail.

- [ ] **Step 3: Implement**

`arena/store.py`, `RunRecord`, after `description`:

```python
    # The sha256 of the timeline.json a stage entry played, from its repo at the pinned revision;
    # None for a race, or for a performance of the event's own command. The same weights with
    # another timeline are another performance.
    timeline_sha256: str | None = None
```

In `to_dict`, add `"timeline_sha256": self.timeline_sha256`. In `from_dict`, add `timeline_sha256=raw.get("timeline_sha256")`, with the same comment as `description` (runs recorded before it have no such key).

`arena/web/routes_submit.py`:

```python
def _speed(manifest, value: str | None) -> float | None:
    """A trial's chosen speed, or None for the full sweep — and always None on a stage, which plays
    its timeline at no speed: a speed sent to one is ignored.
    ...(keep the rest of the docstring)
    """
    if manifest.sweep is None or value is None or str(value).strip() == "":
        return None
```

```python
def _evaluate(manifest, policy, command_vx: float | None, timeline):
    if command_vx is None:
        return evaluate(manifest, policy, timeline)
    return evaluate_at(manifest, policy, command_vx)
```

`_already_entered` gets a `timeline_sha256` parameter and matches `r.timeline_sha256 == timeline_sha256` beside `r.model_sha256 == sha256`. Its docstring opens: "Keyed on the ONNX's sha256 and, on a stage, the timeline's: a retry after a lost answer is the same files, while the same weights with another timeline are another performance. Not the revision or the speed: …".

`_answer(record, course, page_url, already)` adds `"course": course` (the event's course kind, which `publish` words the entry by). Its two callers pass `manifest.course.kind`.

In `_enter`:
- the idempotency check becomes `kept = _already_entered(store, manifest.id, user, policy.sha256, fetched.timeline_sha256)`;
- the evaluation becomes `result = await run_in_threadpool(_evaluate, manifest, policy, _speed(manifest, command_vx), fetched.timeline)`;
- the `RunRecord` gets `timeline_sha256=fetched.timeline_sha256`.

`arena/recover.py`, inside the loop:

```python
            # At the revision the listing found and against its event: the record says that
            # revision, and a stage's timeline.json is read with the weights it goes with.
            fetched = fetch_policy(candidate.repo_id, revision=candidate.revision, event=event)
            policy = load_policy(fetched.path)
            result = evaluate(event, policy, fetched.timeline)
```

In the record, `model_sha256=policy.sha256` (the policy is no longer loaded twice) and `timeline_sha256=fetched.timeline_sha256`.

- [ ] **Step 4: Run the touched suites**

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_routes_submit.py tests/test_recover.py tests/test_store.py tests/test_withdraw.py tests/test_hub_fetch.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/store.py arena/web/routes_submit.py arena/recover.py tests/test_routes_submit.py tests/test_recover.py tests/test_store.py
/usr/bin/git commit -m "Submit and recover play a stage entry's timeline; a run keeps its sha256, so new moves are a new performance, and a speed sent to a stage is ignored"
```

### Task 4: the summary says the course; a voted publication stands by its votes; the unfurl describes a performance

`run_detail` ranks a voted event's publication on the timed standing ("a publication stands by its time even on a voted event", `app/src/run.js`). That rule was written for the lane swag. On a stage every row is 20.000 s, so the rank is just the order of publication. `got-a-talent` is the only voted event, and it is now a stage. The publication page therefore takes the voted board's rule, which the event's board and the player page already use.

**Files:**
- Modify: `arena/web/routes_read.py`, `arena/votes.py`, `arena/web/routes_unfurl.py`
- Test: `tests/test_routes_read.py`, `tests/test_votes.py`, `tests/test_clips.py` (where the unfurl is tested)

**Interfaces:**
- Produces:
  - `event_summary(...)["course"]` is `"lane"` or `"stage"` for every event.
  - `votes.placed(records, run_id, ballots, withdrawn) -> tuple[int, bool, list[VotedRow]]`.
  - `run_detail` of a voted event: `rank`, `on_board` and `board` come from votes, and each board row carries `votes` and `shown`.
  - `describe(record, place, event)` takes the event's `Manifest`.

- [ ] **Step 1: Write the failing tests**

`tests/test_routes_read.py`. The voted tests go after `cast` (line ~362):

```python
def test_every_event_says_what_kind_of_course_it_is(client):
    api, _ = client
    courses = {e["id"]: e["course"] for e in api.get("/api/events").json()["events"]}
    assert courses == {"sprint-2m": "lane", "roller-sprint-2m": "lane", "hill-climb-1m5": "lane",
                       "got-a-talent": "stage"}


def test_a_voted_events_publication_stands_where_its_votes_put_it(client):
    api, app = client
    ann = record_run(app, user="ann", event_id="got-a-talent", score=20.0, submitted_at="2026-09-03T10:00:00Z")
    bob = record_run(app, user="bob", event_id="got-a-talent", score=20.0, submitted_at="2026-09-04T10:00:00Z")
    cast(app, bob.run_id, [ann.run_id, bob.run_id])
    body = api.get(f"/api/runs/{bob.run_id}").json()
    assert (body["rank"], body["on_board"]) == (1, True)
    assert [(r["user"], r["votes"], r["you"]) for r in body["board"]] == [("bob", 1, True), ("ann", 0, False)]


def test_an_older_performance_finds_its_place_off_the_board(client):
    api, app = client
    old = record_run(app, user="ann", event_id="got-a-talent", score=20.0, submitted_at="2026-09-03T10:00:00Z")
    record_run(app, user="ann", event_id="got-a-talent", score=20.0, submitted_at="2026-09-05T10:00:00Z")
    body = api.get(f"/api/runs/{old.run_id}").json()
    assert body["on_board"] is False
    assert [r["you"] for r in body["board"]] == [True]
```

`tests/test_votes.py`:

```python
def test_a_run_is_placed_by_votes_among_the_others_entries():
    from arena.votes import placed

    ann = make_record(user="ann", event_id="got-a-talent", submitted_at="2026-09-03T10:00:00Z")
    bob = make_record(user="bob", event_id="got-a-talent", submitted_at="2026-09-04T10:00:00Z")
    ballot = Ballot(ballot_id="b1", event_id="got-a-talent", voter="cid", cast_at="2026-09-05T10:00:00Z",
                    candidates=(ann.run_id, bob.run_id), choice=bob.run_id)
    rank, on_board, rows = placed([ann, bob], bob.run_id, [ballot], frozenset())
    assert (rank, on_board) == (1, True)
    assert [(row.record.user, row.votes) for row in rows] == [("bob", 1), ("ann", 0)]
```

(Use the imports `test_votes.py` already has. If it does not import `Ballot` and `make_record`, add `from arena.store import Ballot` and `from tests.test_store import make_record`.)

`tests/test_clips.py`:

```python
def test_a_performance_is_described_as_one():
    from arena.manifest import load_event
    from arena.web.routes_unfurl import describe

    talent = load_event("got-a-talent")
    played = make_record(user="eve", event_id="got-a-talent", score=20.0, seeds_finished=1)
    assert describe(played, None, talent) == "@eve's duck gave a 20.00 s performance on MicroDuck Got a Talent."
    cut = make_record(user="eve", event_id="got-a-talent", score=20.0, seeds_finished=0)
    assert describe(cut, None, talent) == "@eve's duck performed on MicroDuck Got a Talent; the performance was cut short."
```

(`tests/test_clips.py` already imports `make_record`; check, and import it from `tests.test_store` if not.)

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_read.py tests/test_votes.py tests/test_clips.py -k "course or voted_events_publication or older_performance or placed_by_votes or described_as_one"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`arena/web/routes_read.py`, `event_summary`, after `"metric"`:

```python
        # "lane" or "stage": what the page draws, and how it words a result. A stage has no
        # lane, no line and no speed (the lane fields below are a lane's alone).
        "course": manifest.course.kind,
```

Pull the event's own ballot window out of `event_leaderboard` into a helper, and move its comment with it:

```python
def _event_ballots(request: Request, manifest: Manifest, now: datetime) -> list:
    """This event's ballots inside its own window: what its voted board counts."""
    days = manifest.vote.window_days
    # Filtered to THIS event, like points.boards_by_user already does — ballots.since() returns
    # every votable event's ballots inside the window, and without this an event's tally would
    # read another event's votes too. Correct today only because run ids are globally unique,
    # which made the leak invisible rather than absent.
    own = [b for b in request.app.state.ballots.since(votes.first_day(now, days)) if b.event_id == manifest.id]
    return votes.window(own, now, days)
```

`event_leaderboard` then uses `kept = _event_ballots(request, manifest, datetime.now(UTC))`. Its first comment, about `index.sort_key`, stays.

`run_detail`:

```python
    manifest = load_event(record.event_id)
    if manifest.metric == "votes":
        # A voted event's publication stands where its votes put it, as on the event's own board
        # and the player's page: on a stage, a time would only be the performance's length.
        rank, on_board, rows = votes.placed(store.runs(record.event_id), run_id,
                                            _event_ballots(request, manifest, now), withdrawn)
        board = [{**_board_row(row), "votes": row.votes, "shown": row.shown,
                  "you": row.record.run_id == record.run_id} for row in rows]
    else:
        place = standing(store.runs(record.event_id), run_id, withdrawn=withdrawn)
        rank, on_board = place.rank, place.on_board
        board = [{**_board_row(row), "you": row.record.run_id == record.run_id} for row in place.board]
```

The response then uses `"event": event_summary(manifest)`, `"on_board": on_board`, `"rank": rank` and `"board": board`. Keep the comment "The same columns as the event's board: the page draws the same table." above `"board"`.

`arena/votes.py`, after `standings`:

```python
def placed(records, run_id: str, ballots, withdrawn: frozenset[str]) -> tuple[int, bool, list[VotedRow]]:
    """Where ONE run stands on the voted board, on it or not: `index.standing`'s rule, by votes.

    The board holds each person's latest finished entry (`pool`). This run takes its author's
    place at its rank by votes; `on_board` says whether it is the entry holding that place.
    """
    record = next(r for r in records if r.run_id == run_id)
    entries = pool(records, withdrawn)
    rows = standings([*(r for r in entries if r.user != record.user), record], ballots)
    rank = next(row.rank for row in rows if row.record.run_id == run_id)
    return rank, any(r.run_id == run_id for r in entries), rows
```

`arena/web/routes_unfurl.py`:

```python
def describe(record, place, event) -> str:
    """One sentence for the card."""
    if event.course.kind == "stage":
        # A performance is never timed or ranked by its length; the public's votes rank it.
        if record.seeds_finished == 0:
            return f"@{record.user}'s duck performed on {event.title}; the performance was cut short."
        return f"@{record.user}'s duck gave a {record.score:.2f} s performance on {event.title}."
    seeds = len(record.per_seed)
    ...
```

In the race branch, use `event.title` wherever `title` was. In `unfurl`, use `event = load_event(record.event_id)` and `title = event.title`, and call `describe(record, place, event)`.

- [ ] **Step 4: Run the touched suites**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_read.py tests/test_votes.py tests/test_clips.py tests/test_points.py tests/test_routes_vote.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/web/routes_read.py arena/votes.py arena/web/routes_unfurl.py tests/test_routes_read.py tests/test_votes.py tests/test_clips.py
/usr/bin/git commit -m "Every event says its course; a voted publication stands by its votes, and a shared performance is described as one"
```

### Task 5: the site draws a stage from its real summary

Today the stage summary makes `formatEventFacts` throw on `event.sweep_lo.toFixed`. That breaks the home page, the race page, the other-rounds strip of every race page, the workshop home and the challenge page. The thumbnails draw a lane with NaN sizes.

**Files:**
- Modify:
  - `app/src/format.js` (`isStage`, stage facts)
  - `app/src/race.js` (caveat, the solo slice)
  - `app/src/lanes.js`, `app/src/boardsheet.js`, `app/src/viewer.js`, `app/src/vote.js` (`isStage` instead of the id)
  - `app/src/board.js` (no m/s or seeds columns on a stage)
  - `app/src/thumbnail.js` (a stage still)
- Test:
  - `app/src/format.test.js`, `app/src/flyer.test.js`, `app/src/race.rounds.test.js`, `app/src/race.test.js`, `app/src/board.test.js`
  - and the fixtures of `lanes.test.js`, `vote.solo.test.js`, `boardsheet.test.js`, `talent-stage.test.js`, which gain `course: "stage"` where they mean a stage

**Interfaces:**
- Consumes: `event.course` (Task 4).
- Produces: `export const isStage = (event) => event?.course === "stage";` in `app/src/format.js`. Tasks 6, 7 and 9 import it from there.

- [ ] **Step 1: Write the failing tests**

`app/src/format.test.js`:

```js
const STAGE = { id: "got-a-talent", course: "stage", rig: "legs", time_limit_s: 20 };

describe("a stage's facts", () => {
  it("say what it is, never a distance or a speed", () => {
    expect(formatEventFacts(STAGE)).toEqual([
      { label: "stage", value: "open floor" },
      { label: "performance", value: "up to 20 s" },
      { label: "rig", value: "legs" },
    ]);
  });
  it("isStage reads the course, not the id", () => {
    expect(isStage(STAGE)).toBe(true);
    expect(isStage({ ...STAGE, course: "lane" })).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});
```

(Add `isStage` to the import.)

`app/src/flyer.test.js`: replace `TALENT` with the shape `/api/events` really serves:

```js
const TALENT = { id: "got-a-talent", title: "MicroDuck Got a Talent", category: "showcase", course: "stage",
  rig: "legs", time_limit_s: 20, metric: "votes", vote: { ballot_min: 2 } };
```

and add:

```js
  it("pins a stage's facts on its sheet", () => {
    expect(flyer(TALENT, []).querySelector(".challenge-facts").textContent).toBe("open floor · up to 20 s · legs");
  });
```

`app/src/race.rounds.test.js`: the programme's `got-a-talent` entry takes the real stage shape, `{ id: "got-a-talent", title: "MicroDuck Got a Talent", category: "showcase", course: "stage", rig: "legs", seeds: 1, time_limit_s: 20, metric: "votes", vote: { ballot_min: 2 } }`. Keep the existing assertions, which count the other rounds drawn. The strip now draws with a stage in the programme; before this task, the stage's flyer threw and the strip vanished.

`app/src/race.test.js`:

```js
it("a stage's facts say what it is, and its caveat speaks of performances", () => {
  const root = document.createElement("div");
  root.innerHTML = '<dl id="facts"></dl>';
  const caveat = renderEventFacts(root, { id: "got-a-talent", course: "stage", rig: "legs", time_limit_s: 20 });
  expect([...root.querySelectorAll("dt")].map((n) => n.textContent)).toEqual(["stage", "performance", "rig"]);
  expect(caveat.textContent).toContain("Performances play on this stage");
});
```

(Import `renderEventFacts` if the file does not already.)

`app/src/board.test.js`:

```js
it("a stage's board has no speed and no seeds: a performance has neither", () => {
  const container = document.createElement("div");
  renderBoard(container, {
    event: { id: "got-a-talent", title: "MicroDuck Got a Talent", metric: "votes", course: "stage" },
    rows: [{ rank: 1, user: "ann", policy_name: "p", score: 20, command_vx: 0, seeds_finished: 1, seeds_total: 1,
             run_id: "r1", submitted_at: "2026-10-01T10:00:00Z", votes: 3 }],
  });
  const heads = [...container.querySelectorAll("th")].map((th) => th.textContent);
  expect(heads).not.toContain("m/s");
  expect(heads).not.toContain("seeds");
  expect(container.querySelector("td.speed")).toBeNull();
  expect(container.querySelector("td.votes").textContent).toBe("3");
});
```

Fixtures that mean a stage gain `course: "stage"`:
- `lanes.test.js`: `{ id: "got-a-talent", course: "stage" }`;
- `vote.solo.test.js`: `event`;
- `boardsheet.test.js`: the solo-sheet case;
- `talent-stage.test.js`: none needed, it never goes through `isStage`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/format.test.js src/flyer.test.js src/race.test.js src/race.rounds.test.js src/board.test.js src/lanes.test.js src/vote.solo.test.js src/boardsheet.test.js`
Expected: the new and re-shaped tests fail (`isStage` is not exported; `TypeError ... toFixed`).

- [ ] **Step 3: Implement**

`app/src/format.js`:

```js
/** Whether an event is a stage: an open floor that plays each entry's timeline once, with no lane,
 * no line and no speed. The event summary says so in `course`. */
export const isStage = (event) => event?.course === "stage";
```

`formatEventFacts` opens with:

```js
  // A stage plays a performance, never a race: no distance, no surface to climb, no sweep.
  if (isStage(event)) {
    return [
      { label: "stage", value: "open floor" },
      { label: "performance", value: `up to ${event.time_limit_s} s` },
      { label: "rig", value: event.rig },
    ];
  }
```

`app/src/race.js`:
- import `isStage` from `./format.js`;
- `renderEventFacts`' caveat text becomes `isStage(event) ? "Performances play on this stage, with this friction and this physics build. A policy tuned elsewhere can perform differently here." : <the existing text>`;
- line 245 becomes `isStage(event) ? lanes.slice(0, 1) : lanes`.

Each of these replaces `event.id === "got-a-talent"` (or `event?.id`, or `run.event?.id`) with `isStage(…)` imported from `./format.js`:
- `app/src/lanes.js:15`
- `app/src/boardsheet.js:46`
- `app/src/viewer.js:372`
- `app/src/vote.js:278`

`app/src/board.js`, `renderBoard`: `const stage = isStage(event);`. In the header, write `(stage ? "" : "<th class='speed'>m/s</th><th class='seeds'>seeds</th>")` in place of the two `<th>`. In the row, the speed and seeds cells become `...(stage ? [] : [cell(row.speed, "speed"), cell(row.seeds, "seeds")])`. Add a comment: "A performance has no speed and is played once: on a stage, neither column means anything."

`app/src/thumbnail.js`: a stage gets its own still, one duck on a dark round floor, front-three-quarter:

```js
import { CircleGeometry, Mesh, MeshStandardMaterial } from "three"; // merged into the existing three import
import { isStage } from "./format.js";

/** Where the camera sits for a stage's still: the duck alone, front three-quarter. */
const STAGE_VIEW = { position: [0.62, 0.3, 0.42], target: [0, 0.1, 0] };

/** A stage's still: one duck on its spot, no lane, no line. */
function onStage(scene, kinematics, geometries) {
  const floor = new Mesh(new CircleGeometry(0.75, 48), new MeshStandardMaterial({ color: 0x1a1236, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const rig = buildRigTree(kinematics);
  attachMeshes(rig, kinematics, geometries, { livery: "classic" });
  scene.add(rig.placer);
  return STAGE_VIEW;
}
```

In `still(...)`, branch before `buildCourse`. `isStage(event)` gives `const { position, target } = onStage(scene, kinematics, geometries)`. Otherwise run the existing course, pair and `cameraFor(event.length_m)` code. Then build the same camera from `position` and `target`.

Check the still visually in Task 14. Adjust `STAGE_VIEW` there if the duck is not centred and whole.

- [ ] **Step 4: Run the whole front-end suite**

Run: `cd app && npm test`
Expected: only the 4 known `src/brightness.test.js` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src
/usr/bin/git commit -m "The site draws a stage from its real summary: its facts, a board without speed or seeds, its still, and isStage instead of the event's id"
```

### Task 6: the publication page and the share text speak of a performance

**Files:**
- Modify: `app/src/run.js`, `app/src/share.js`
- Test: `app/src/run.test.js`, `app/src/share.test.js`

**Interfaces:**
- Consumes: `isStage` (Task 5); the voted `run.board` rows with `votes` (Task 4).
- Produces: `export function verdict(run) -> { label, stamp }` and `export function replayLine(run)` in `run.js`.

- [ ] **Step 1: Write the failing tests**

`app/src/run.test.js`:

```js
import { replayLine, verdict } from "./run.js";

const STAGE = { title: "MicroDuck Got a Talent", course: "stage", metric: "votes" };

describe("a performance's scoreboard", () => {
  it("says its length and that it was performed, or cut short", () => {
    expect(verdict({ event: STAGE, seeds_finished: 1, seeds_total: 1 })).toEqual({ label: "length", stamp: "PERFORMED" });
    expect(verdict({ event: STAGE, seeds_finished: 0, seeds_total: 1 })).toEqual({ label: "length", stamp: "CUT SHORT" });
  });
  it("keeps a race's time and seeds", () => {
    expect(verdict({ event: { course: "lane" }, seeds_finished: 4, seeds_total: 5 })).toEqual({ label: "time", stamp: "FINISHED 4/5" });
  });
  it("replays the whole performance, at no speed and no seed", () => {
    expect(replayLine({ event: STAGE, command_vx: 0, seeds_finished: 1, per_seed: [], trace_seed: 1 })).toBe("replay: the whole performance");
  });
});
```

`app/src/share.test.js`:

```js
it("shares a performance as one", () => {
  const run = { event: { title: "MicroDuck Got a Talent", course: "stage" }, seeds_total: 1, seeds_finished: 1,
    score: 20, receipts: [{ points: 100 }], per_seed: [], run_id: "r1", rank: 1, on_board: true, policy_url: null };
  const text = postText(run, { origin: "https://arena.test", network: "linkedin" });
  expect(text).toContain("I coded a robot duck to perform. On MicroDuck Got a Talent it gave a 20.00 s performance (+100 pts).");
  expect(text).toContain("Watch it: https://arena.test/r/r1");
  expect(postText({ ...run, seeds_finished: 0, receipts: [] }, { origin: "https://arena.test", network: "linkedin" }))
    .toContain("Its performance on MicroDuck Got a Talent was cut short.");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/run.test.js src/share.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/run.js`, importing `isStage` from `./format.js`:

```js
/** Which seed the stored replay is, and why that one; a performance is played once. */
export function replayLine(run) {
  if (isStage(run.event)) return "replay: the whole performance";
  ...existing body...
}

/** What the scoreboard says over its number, and the stamp it lands. A stage has no time and no
 * finish: its number is the performance's length, and it was performed or cut short. */
export function verdict(run) {
  const dnf = run.seeds_finished === 0;
  if (isStage(run.event)) return { label: "length", stamp: dnf ? "CUT SHORT" : "PERFORMED" };
  return { label: "time", stamp: dnf ? "DNF" : `FINISHED ${run.seeds_finished}/${run.seeds_total}` };
}
```

In `runHall`, the scoreboard's `<span class="mono-label">time</span>` gets `id="score-label"`. In `renderRun`:
- `const said = verdict(run);`, then `$("score-label").textContent = said.label;` and `stamp.textContent = said.stamp;`.
- The seed list is built only off a stage. On a stage, `$("seedlist").remove()`: one performance has no seeds to list.
- The board sheet takes `event: run.event`. The `metric: "mean_finish_time"` override and its comment go: the server now ranks a voted event's publication by votes (Task 4), so the table reads what the server ranked by.
- `const yourScore = yourRow.querySelector(".time, .votes");`, because a voted table has no `.time` cell.

`app/src/share.js`, `postText`:

```js
export function postText(run, { origin, network }) {
  const total = run.seeds_total;
  const earned = run.receipts.reduce((sum, r) => sum + r.points, 0);
  const points = earned > 0 ? ` (+${earned} pts)` : "";
  const stage = isStage(run.event);
  let result;
  if (stage) {
    result = run.seeds_finished === 0
      ? `Its performance on ${run.event.title} was cut short.`
      : `On ${run.event.title} it gave a ${run.score.toFixed(2)} s performance${points}.`;
  } else if (run.seeds_finished === 0) {
    ...existing...
  } else {
    ...existing, using the shared `points`...
  }
  const lines = [`I coded a robot duck to ${stage ? "perform" : "walk"}. ${result}`,
    `${stage ? "Watch it" : "Beat it"}: ${origin}/r/${run.run_id}`];
  ...unchanged...
}
```

- [ ] **Step 4: Run the whole front-end suite**

Run: `cd app && npm test`
Expected: only the 4 known `brightness` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/run.js app/src/run.test.js app/src/share.js app/src/share.test.js
/usr/bin/git commit -m "A performance's page says its length, performed or cut short, and ranks it by votes; its share text invites a watch, not a race"
```

### Task 7: the clip films the whole performance on the stage

At the moment, the clip fails on a stage before its first frame:
- `run.event.length_m` is undefined, so every progress sample is NaN and `stadiumDirection` throws.
- With the default `tape_max_s = 12`, it would cut a 20 s performance at 12 s.
- It plays a start horn, stamps VICTORY, and shows a time and a place ranked by time.
- The stage's 24 s shot cycle cuts back to its opening shot 0.5 s into the outro, because a 20 s clip runs 3 s of titles + 20.52 s + 2.5 s.

**Files:**
- Modify: `arena/events/got-a-talent.toml` (`[clip]`), `app/src/clip/score.js`, `app/src/clip/main.js`, `app/src/talent-stage.js` (`stageCameraPose`'s clock)
- Test: `tests/test_manifest.py`, `app/src/clip/score.test.js`, `app/src/talent-stage.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/test_manifest.py`:

```python
def test_a_performance_is_filmed_whole_without_a_start_horn():
    clip = load_event("got-a-talent").clip
    assert (clip.tape_max_s, clip.sounds) == (20.0, ("crowd", "verdict"))
```

`app/src/clip/score.test.js`. Build a stage run and a plan with the file's existing helpers, and use a trace of a few frames:

```js
it("a stage's crowd answers the verdict alone: a performance goes down no course", () => {
  const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
  const run = { run_id: "r1", seeds_finished: 1, event };
  const plan = clipPlan(1000, 20, 26);
  const trace = new Float32Array(21 * 1026);
  const score = clipScore({ run, plan, trace });
  expect(score.crowd.progress).toEqual([]);
  expect(score.cues.map((cue) => cue.file)).not.toContain("air-horn.mp3");
});
```

(Import `clipPlan` from `./plan.js` if the file does not.)

`app/src/talent-stage.test.js`:

```js
it("holds its last shot past the cycle: a clip's outro ends on the crane, not back on the opening", () => {
  const subject = [new Vector3(0, 0.14, 0)];
  const end = stageCameraPose(24, subject, 16 / 9, 42);
  const after = stageCameraPose(25.5, subject, 16 / 9, 42);
  expect(after.shot).toBe("crane");
  expect(after.position).toEqual(end.position);
});
```

(Use the imports the file already has: `Vector3`, `stageCameraPose`.)

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_manifest.py -k filmed`, then `cd app && npx vitest run src/clip/score.test.js src/talent-stage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`arena/events/got-a-talent.toml`, before `[vote]`:

```toml
# The whole performance on tape, under the stage's own cameras (the viewer's,
# for a stage). No start horn: nothing starts and nothing is raced; the crowd
# answers the end.
[clip]
tape_max_s = 20.0
sounds     = ["crowd", "verdict"]
```

`app/src/clip/score.js`, importing `isStage` from `../format.js`:

```js
    crowd: sounds.includes("crowd")
      // A stage has no course to go down: its crowd answers the verdict alone.
      ? { start, end, verdict, progress: isStage(run.event) ? [] : progress(trace, plan, run.event.length_m, start) }
      : null,
```

`app/src/clip/main.js`, `letter(run)`, importing `isStage` from `../format.js`:

```js
  const stage = isStage(run.event);
  ...
  $("fig-time").textContent = formatScore(run.score, { finished: run.seeds_finished });
  // A performance's number is its length, and votes rank it: no place to give at publication.
  if (stage) {
    $("fig-time").nextElementSibling.textContent = "length";
    $("fig-place").parentElement.hidden = true;
  } else {
    $("fig-place").textContent = run.on_board && !run.withdrawn ? `#${run.rank}` : "—";
  }
  ...
  stamp.textContent = dnf ? (stage ? "CUT SHORT" : "DNF") : stage ? "BRAVO" : "VICTORY";
```

`app/src/talent-stage.js`, `stageCameraPose`:

```js
  // One cycle of shots; a clip runs past it (titles and outro around a 20 s performance), and
  // there the last shot holds rather than cutting back to the opening.
  const time = Math.min(Math.max(0, seconds), 24);
```

- [ ] **Step 4: Run the suites**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_manifest.py tests/test_routes_read.py`, then `cd app && npm test`
Expected: Python all pass. Front-end: only the 4 known `brightness` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/events/got-a-talent.toml app/src/clip app/src/talent-stage.js app/src/talent-stage.test.js tests/test_manifest.py
/usr/bin/git commit -m "A performance's clip runs its whole 20 s without a start horn, stamps BRAVO or CUT SHORT, shows its length, and ends on the crane"
```

### Task 8: the workshop plays a stage checkpoint with the challenge's timeline, and publishes it

**Files:**
- Modify:
  - `arena/stage.py` (`summary`), `arena/cli.py` (`_print_stage` uses it)
  - `arena/workshop/challenges.py` (timeline helpers)
  - `arena/workshop/evaluations.py` (timeline-aware, exported ONNX reused)
  - `arena/workshop/tickets.py` (passes the key)
  - `arena/workshop/app.py` (two routes; the checkpoint route replays on demand; publish validates and passes `--timeline`)
  - `arena/workshop/publishing.py` (`--timeline`)
  - `tests/workshop/conftest.py` (`make_run` gets `experiment`)
- Test:
  - Create: `tests/workshop/test_performance.py`
  - Modify: `tests/test_stage.py`

**Interfaces:**
- Consumes: `arena.timeline.load_timeline`, `TimelineError`; `arena.stage.fell_at`, `seated`, `standing`.
- Produces:
  - `arena.stage.summary(trace, termination) -> {"fell_at": float | None, "seated_s": float, "standing_s": float}`.
  - In `arena.workshop.challenges`:
    - `TIMELINE = "timeline.json"`;
    - `is_stage(challenge) -> bool`;
    - `timeline_file(challenge) -> Path`;
    - `timeline_key(challenge) -> str | None`;
    - `read_timeline(challenge) -> str`;
    - `save_timeline(challenge, text) -> None` (raises `TimelineError`).
  - In `arena.workshop.evaluations`:
    - `stored(run, n, timeline=None)`, `summary(run, timeline=None)`;
    - `exported(run, n) -> bool`;
    - `evaluate_checkpoint(root, run, n, challenge) -> None`, which replaces `_evaluate`.
  - A stage evaluation body carries `"timeline": <key>` and `"stage": summary(...)`. A lane body carries `"timeline": None`.
  - HTTP:
    - `GET /api/workshop/challenges/{event}/timeline` returns `{"text": str}`;
    - `POST /api/workshop/challenges/{event}/timeline` takes `{"text": str}` and returns `{"text": str}`, or 400 with the refusal;
    - a race gets 409 on both.
  - `publish_args(..., timeline=None)` appends `["--timeline", str(timeline)]`.

- [ ] **Step 1: Write the failing tests**

`tests/test_stage.py`:

```python
def test_a_summary_says_when_it_fell_and_how_long_it_sat_and_stood():
    from arena.manifest import load_event
    from arena.stage import summary

    standing_frame = [0, 0, 0.115, 1, 0, 0, 0] + [0] * 14
    seated_frame = [0, 0, 0.06, 1, 0, 0, 0] + [0] * 14
    trace = np.array([standing_frame] * 50 + [seated_frame] * 25, dtype=np.float32)
    done = summary(trace, load_event("got-a-talent").termination)
    assert done == {"fell_at": None, "seated_s": pytest.approx(0.5), "standing_s": pytest.approx(1.0)}
```

(Check the file's imports for `np` and `pytest`.)

`tests/workshop/conftest.py`: `make_run` takes `experiment="sprint_2m"` and writes `root / "logs" / "rsl_rl" / experiment / f"{stamp}_{name}"`. No caller changes.

`tests/workshop/test_performance.py`:

```python
"""A stage challenge's performance is its folder's timeline.json: the training's page edits it, every
checkpoint plays it, an edit replays the chosen checkpoint at once, and Publish sends it with --timeline."""

import base64
import hashlib

import pytest

from arena.constants import TRACE_WIDTH
from arena.workshop.evaluations import evaluate_next, next_checkpoint
from tests.workshop.conftest import git, make_run, reopen

TALENT = """\
event = "got-a-talent"
task  = "Mjlab-GotATalent-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.head_reward]
label = "Follow the head moves"
value = 0.75
min   = 0.0
max   = 2.0
"""
TWO_SECONDS = '{"timeline_version": 1, "duration_s": 2.0, "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [1, 0, 0]}]}\n'
THREE_SECONDS = '{"timeline_version": 1, "duration_s": 3.0, "keyframes": [{"t": 0.0}]}\n'
URL = "/api/workshop/challenges/got-a-talent"
TASK = "Mjlab-GotATalent-MicroDuck"


@pytest.fixture
def stage(checkout, fakes, hub, monkeypatch):
    """The workshop on a checkout that also holds MicroDuck Got a Talent, its timeline committed."""
    folder = checkout / "src" / "microduck_challenges" / "got_a_talent"
    folder.mkdir()
    (folder / "challenge.toml").write_text(TALENT)
    (folder / "timeline.json").write_text(TWO_SECONDS)
    git(checkout, "add", "-A")
    git(checkout, "commit", "-qm", "the stage")
    monkeypatch.setenv("HF_TOKEN", "hf_from_the_launcher")
    client = reopen(checkout, hub)
    client.timeline = folder / "timeline.json"
    return client


def frames(body) -> int:
    return len(base64.b64decode(body["trace_b64"])) // (4 * TRACE_WIDTH)


def evaluated(client, run, n=1):
    while evaluate_next(client.app.state.workshop):
        pass
    return client.get(f"{URL}/jobs/{run.name}/checkpoints/{n}").json()


def test_a_stage_checkpoint_plays_the_challenges_timeline(stage, checkout):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    body = evaluated(stage, run)
    assert frames(body) == 100  # 2 s at 50 Hz: the timeline's length, not the event's 20 s
    assert body["timeline"] == hashlib.sha256(TWO_SECONDS.encode()).hexdigest()
    assert set(body["stage"]) == {"fell_at", "seated_s", "standing_s"}
    assert (body["seeds_finished"], body["seeds_total"]) == (1, 1)


def test_the_page_reads_and_saves_the_timeline_and_the_checkpoint_replays_without_a_new_export(stage, checkout, fakes):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    evaluated(stage, run)
    assert stage.get(f"{URL}/timeline").json() == {"text": TWO_SECONDS}
    saved = stage.post(f"{URL}/timeline", json={"text": THREE_SECONDS})
    assert saved.status_code == 200, saved.text
    assert stage.timeline.read_text() == THREE_SECONDS
    body = stage.get(f"{URL}/jobs/{run.name}/checkpoints/1").json()
    assert frames(body) == 150
    assert len(fakes.calls("publish")) == 1  # the ONNX exported once is played again


def test_a_timeline_the_arena_refuses_is_not_saved_and_says_where(stage):
    refused = stage.post(f"{URL}/timeline", json={"text": THREE_SECONDS.replace("3.0", "25.0")})
    assert refused.status_code == 400
    assert "longer than this event's 20 s" in refused.json()["detail"]
    assert stage.timeline.read_text() == TWO_SECONDS


def test_a_race_has_no_timeline(stage):
    assert stage.get("/api/workshop/challenges/sprint-2m/timeline").status_code == 409


def test_a_timeline_broken_by_hand_fails_the_evaluation_until_it_is_fixed(stage, checkout):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    stage.timeline.write_text("{")
    body = evaluated(stage, run)
    assert "timeline.json" in body["error"]
    stage.timeline.write_text(TWO_SECONDS)
    found = next_checkpoint(checkout, list(stage.app.state.workshop.challenges.values()))
    assert (found[1].id, found[2]) == (run.name, 1)


def test_a_stage_publishes_its_timeline(stage, checkout, fakes):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and looks around."}
    done = stage.post(f"{URL}/jobs/{run.name}/publish", json=body)
    assert done.status_code == 200, done.text
    (published,) = [argv for argv in fakes.calls("publish") if "--enter" in argv]
    assert published[published.index("--timeline") + 1] == str(stage.timeline)


def test_a_broken_timeline_is_never_published(stage, checkout, fakes):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    stage.timeline.write_text("{")
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and looks around."}
    refused = stage.post(f"{URL}/jobs/{run.name}/publish", json=body)
    assert refused.status_code == 400 and "not a JSON file" in refused.json()["detail"]
    assert fakes.calls("publish") == []
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/workshop/test_performance.py tests/test_stage.py`
Expected: FAIL.

- [ ] **Step 3: Implement**

`arena/stage.py`:

```python
def summary(trace: np.ndarray, termination: Termination) -> dict:
    """What a performance did: when the fall rule first held (or None), and how long it sat and stood."""
    return {
        "fell_at": fell_at(trace, termination),
        "seated_s": float(seated(trace).sum() * CTRL_DT),
        "standing_s": float(standing(trace).sum() * CTRL_DT),
    }
```

`arena/cli.py`, `_print_stage`: from `fell = ...` down, it uses `done = stage.summary(result.trace, manifest.termination)`, `done["fell_at"]`, `done["seated_s"]` and `done["standing_s"]`. The printed lines are byte-identical; `tests/test_cli.py` holds them.

`arena/workshop/challenges.py`. Add the imports `hashlib`, `json`, `os`, `tempfile` and `from ..timeline import load_timeline`. Then add:

```python
TIMELINE = "timeline.json"


def is_stage(challenge: Challenge) -> bool:
    return load_event(challenge.event).course.kind == "stage"


def timeline_file(challenge: Challenge) -> Path:
    """A stage challenge's performance: timeline.json beside its challenge.toml, the author's to edit."""
    return challenge.toml.parent / TIMELINE


def timeline_key(challenge: Challenge) -> str | None:
    """Which performance a challenge's checkpoints play: the sha256 of its timeline.json on a stage;
    None on a race, or on a stage without one, which plays the event's own command."""
    if not is_stage(challenge):
        return None
    try:
        return hashlib.sha256(timeline_file(challenge).read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


def read_timeline(challenge: Challenge) -> str:
    """The text the training's page edits. Without a file, a timeline that stands still for the
    event's whole time limit, which is what the event plays without one."""
    try:
        return timeline_file(challenge).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        event = load_event(challenge.event)
        still = {"timeline_version": 1, "duration_s": event.time_limit_s, "keyframes": [{"t": 0.0}]}
        return json.dumps(still, indent=2) + "\n"


def save_timeline(challenge: Challenge, text: str) -> None:
    """Write the page's timeline.json as typed, once the Arena's own loader has read it: a refusal
    (TimelineError, which says where) leaves the file as it was."""
    with tempfile.TemporaryDirectory() as tmp:
        candidate = Path(tmp) / TIMELINE  # so a refusal names timeline.json, not a temp file
        candidate.write_text(text, encoding="utf-8")
        load_timeline(candidate, load_event(challenge.event).time_limit_s)
    path = timeline_file(challenge)
    staged = path.with_name(f".{TIMELINE}.tmp")
    staged.write_text(text, encoding="utf-8")
    os.replace(staged, path)
```

`arena/workshop/evaluations.py`:
- Module docstring, add: "On a stage, each checkpoint plays the challenge's timeline.json (`timeline_key`); an edit makes every stored evaluation stale. The ONNX a checkpoint was exported to is kept beside it and played again, so a stale checkpoint costs a second or two, not an export."
- `stored(run, n, timeline=None)`: after the `runner_version` check, add `if body.get("timeline") != timeline: return None` ("played with another timeline: stale, a failure included").
- `summary(run, timeline=None)` passes it to `stored`. An evaluated row also carries `"stage": body["stage"]` when the body has one.
- `exported` and `_measure` change as follows:

```python
def exported(run, n: int) -> bool:
    """Whether checkpoint n's ONNX is already exported from the checkpoint file as it is."""
    try:
        return _path(run, n).with_suffix(".onnx").stat().st_mtime >= _mtime(run, n)
    except OSError:
        return False


def _measure(root, run, n: int, challenge, key: str | None) -> dict:
    onnx = _path(run, n).with_suffix(".onnx")
    if not exported(run, n):
        ...the existing export block, unchanged...
    event = load_event(challenge.event)
    timeline = load_timeline(timeline_file(challenge), event.time_limit_s) if key else None
    result = evaluate(event, load_policy(onnx), timeline)
    body = {...the existing fields..., "timeline": key}
    if event.course.kind == "stage":
        body["stage"] = stage_summary(result.trace, event.termination)
    return body


def evaluate_checkpoint(root, run, n: int, challenge) -> None:
    """Measure checkpoint n with the challenge's timeline as it is now, and store what came of it."""
    mtime = _mtime(run, n)
    key = timeline_key(challenge)
    try:
        body = _measure(root, run, n, challenge, key)
    except Exception as exc:  # noqa: BLE001 — stored, so the worker moves on to the next checkpoint
        error = str(exc) if isinstance(exc, EvaluationError) else f"{type(exc).__name__}: {exc}"
        body = {"checkpoint": n, "error": error, "mtime": mtime, "runner_version": RUNNER_VERSION, "timeline": key}
    _write(run, n, body)
```

The imports are `from ..stage import summary as stage_summary`, `from ..timeline import load_timeline` and `from .challenges import timeline_file, timeline_key`.

`next_checkpoint` computes `keys = {c.event: timeline_key(c) for c in challenges}` once and calls `stored(run, n, keys[challenge.event])`. `evaluate_next` calls `evaluate_checkpoint(ws.root, run, n, challenge)`.

`arena/workshop/tickets.py:72` becomes `done = summary(run, timeline_key(challenge)) if run else {}`. Thread the challenge there if the function does not have it; find where it is called with `rg -n "summary\(" arena/workshop`.

`arena/workshop/app.py`. The checkpoint route:

```python
@router.get("/challenges/{event}/jobs/{ticket_id}/checkpoints/{n}")
def checkpoint(event: str, ticket_id: str, n: int, request: Request) -> dict:
    """A checkpoint's stored evaluation, its trace inline: the page replays it at once. On a stage, a
    checkpoint last played with another timeline is played again now, from its exported ONNX — a
    second or two — so an edit to the performance shows on the stage straight away."""
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    found = source(ws, challenge, ticket_id)
    run = found[3] if found else None
    if run is None or n not in run.checkpoints:
        raise HTTPException(status_code=404, detail=f"Checkpoint {n} is not evaluated yet.")
    body = stored(run, n, timeline_key(challenge))
    if body is None and is_stage(challenge) and exported(run, n):
        evaluate_checkpoint(ws.root, run, n, challenge)
        body = stored(run, n, timeline_key(challenge))
    if body is None:
        raise HTTPException(status_code=404, detail=f"Checkpoint {n} is not evaluated yet.")
    return {"checkpoint": n, "error": body["error"]} if "error" in body else body
```

The two timeline routes:

```python
class TimelineText(BaseModel):
    text: str


def _stage_or_409(ws: Workshop, event: str) -> Challenge:
    challenge = _challenge_or_404(ws, event)
    if not is_stage(challenge):
        raise HTTPException(status_code=409, detail=f"{event} is a race: it plays the event's command, with no timeline.")
    return challenge


@router.get("/challenges/{event}/timeline")
def get_timeline(event: str, request: Request) -> dict:
    return {"text": read_timeline(_stage_or_409(_workshop(request), event))}


@router.post("/challenges/{event}/timeline")
def post_timeline(event: str, body: TimelineText, request: Request) -> dict:
    """Save the performance the page typed; the Arena's own loader reads it first, and a refusal says where."""
    challenge = _stage_or_409(_workshop(request), event)
    try:
        save_timeline(challenge, body.text)
    except TimelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"text": body.text}
```

`publish_route`, after the dirty check:

```python
    # A stage publishes its performance beside the weights; one the Arena would refuse is never uploaded.
    timeline = timeline_file(challenge) if is_stage(challenge) and timeline_file(challenge).exists() else None
    if timeline is not None:
        try:
            load_timeline(timeline, load_event(challenge.event).time_limit_s)
        except TimelineError as exc:
            raise HTTPException(status_code=400, detail=f"Your performance cannot be published: {exc}") from exc
```

Pass `timeline=timeline` to `preview(...)` and to `publish(...)`.

`arena/workshop/publishing.py`:
- `publish_args(run, checkpoint, repo, name, description, event, allow_dirty, timeline=None)` gets, before `--allow-dirty`: `if timeline is not None: args += ["--timeline", str(timeline)]`, with the comment "A stage's performance, uploaded beside the weights".
- `preview(..., timeline=None)` and `publish(..., *, arena, code_url, timeline=None)` pass it through.

- [ ] **Step 4: Run the workshop suite, then the CLI and stage tests**

Run (separate foreground calls):
1. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
2. `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_cli.py tests/test_stage.py`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/stage.py arena/cli.py arena/workshop tests/workshop tests/test_stage.py
/usr/bin/git commit -m "The workshop plays a stage checkpoint with the challenge's timeline, replays it at once after an edit, and publishes it with --timeline"
```

### Task 9: the training's page edits the performance

**Files:**
- Create: `app/src/workshop/performance.js`, `app/src/workshop/performance.test.js`
- Modify:
  - `app/src/workshop/api.js` (two calls), `app/src/workshop/job.js` (stage mode)
  - `app/src/workshop/publish.js` (no "official time" on a voted event), `app/src/workshop/challenge.js` (`timeline.json` among a stage's files)
  - `app/public/workshop.css`
- Test: `app/src/workshop/job.test.js`, `publish.test.js`, `challenge.test.js`

**Interfaces:**
- Consumes:
  - `GET` and `POST /api/workshop/challenges/{event}/timeline` (Task 8);
  - a stage checkpoint's `stage` summary (Task 8);
  - `isStage` (Task 5);
  - `eventGuideHref` from `../router.js`.
- Produces: `api.getTimeline(event) -> {text}`, `api.saveTimeline(event, text) -> {text}`; `performancePanel({ guide }, { load, save, onSaved }) -> HTMLElement`.

The page stays the training's page:
- one panel under the checkpoints, the Arena's terminal box holding `timeline.json`;
- a link to the event's guide for what the numbers mean;
- a single **Save and play** button, shown only once the text differs from the file;
- a refusal line under the box, shown only when there is one.

The score card of a stage says whether the duck fell and how long it sat and stood.

- [ ] **Step 1: Write the failing tests**

`app/src/workshop/performance.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { performancePanel } from "./performance.js";

const TEXT = '{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}]}\n';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const edit = (box, value) => {
  const text = box.querySelector("textarea");
  text.value = value;
  text.dispatchEvent(new Event("input"));
};

describe("the performance panel", () => {
  it("shows the file, and Save and play only once it is changed", async () => {
    const box = performancePanel({ guide: "https://arena.test/#/e/got-a-talent/guide" },
      { load: async () => ({ text: TEXT }), save: vi.fn(), onSaved: vi.fn() });
    await flush();
    expect(box.querySelector("textarea").value).toBe(TEXT);
    expect(box.querySelector(".performance__save").hidden).toBe(true);
    expect(box.querySelector("a").href).toBe("https://arena.test/#/e/got-a-talent/guide");
    edit(box, TEXT.replace("20.0", "12.0"));
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });

  it("saves, then plays: the button goes until the next change", async () => {
    const save = vi.fn(async (text) => ({ text }));
    const onSaved = vi.fn();
    const box = performancePanel({ guide: "#" }, { load: async () => ({ text: TEXT }), save, onSaved });
    await flush();
    edit(box, TEXT.replace("20.0", "12.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(save).toHaveBeenCalledWith(TEXT.replace("20.0", "12.0"));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(box.querySelector(".performance__save").hidden).toBe(true);
  });

  it("says where a refused timeline is wrong, and keeps the text and the button", async () => {
    const save = vi.fn(async () => { throw new Error("duration_s: 25 s is longer than this event's 20 s"); });
    const box = performancePanel({ guide: "#" }, { load: async () => ({ text: TEXT }), save, onSaved: vi.fn() });
    await flush();
    edit(box, TEXT.replace("20.0", "25.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    expect(box.querySelector(".performance__why").textContent).toContain("longer than this event's 20 s");
    expect(box.querySelector("textarea").value).toContain("25.0");
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });
});
```

`app/src/workshop/job.test.js`:
- Add `getTimeline: vi.fn(async () => ({ text: "{}" }))` and `saveTimeline: vi.fn(async (event, text) => ({ text }))` to the hoisted `api`.
- Replace `TALENT` with the real stage shape: `{ id: "got-a-talent", title: "MicroDuck Got a Talent", category: "showcase", course: "stage", metric: "votes", rig: "legs", time_limit_s: 20, vote: { ballot_min: 2 } }`.
- Add:

```js
  it("a stage's training page edits its performance and says what the checkpoint did", async () => {
    const stageRow = { n: 500, status: "evaluated", score: 20, seeds_finished: 1, seeds_total: 1, command_vx: 0,
      stage: { fell_at: null, seated_s: 7.9, standing_s: 11.5 } };
    api.getJob.mockResolvedValue({ ...JOB, checkpoints: [stageRow], best: null });
    const root = document.createElement("div");
    await open(root, TALENT);
    await settle();
    expect(root.querySelector(".performance textarea")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith("got-a-talent");
    root.querySelector(".ckpts .bars i").click();
    await settle();
    expect(root.querySelector(".score__value").textContent).toBe("No fall");
    expect(root.querySelector(".score__seeds").textContent).toBe("seated 7.90 s · standing 11.50 s");
  });

  it("a race has no performance to edit", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    await open(root, SPRINT);
    await settle();
    expect(root.querySelector(".performance")).toBeNull();
    expect(api.getTimeline).not.toHaveBeenCalled();
  });
```

`app/src/workshop/publish.test.js`:

```js
  it("a voted event's entry gives no official time", async () => {
    const on = handlers();
    on.onPublish.mockResolvedValue({ entered: "entered on got-a-talent: a 20.00 s performance", page_url: "http://arena.test/#/r/x" });
    const p = publishPanel({ event: { id: "got-a-talent", title: "MicroDuck Got a Talent", metric: "votes" }, folder: "got_a_talent" }, on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "It sits and looks around.");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(p.el.querySelector(".result b")).toBeNull();
    expect(p.el.querySelector(".result").textContent).toContain("a 20.00 s performance");
  });
```

`app/src/workshop/challenge.test.js`. Add a stage challenge to a status, `{ event: { id: "got-a-talent", title: "MicroDuck Got a Talent", category: "showcase", course: "stage", metric: "votes", rig: "legs", time_limit_s: 20, vote: { ballot_min: 2 } }, folder: "got_a_talent", task: "T", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [], running: 0 }`, then:

```js
  it("a stage lists its performance among the files that make it yours", async () => {
    const root = document.createElement("div");
    await mountChallenge(root, { status: { ...STATUS, challenges: [TALENT_CHALLENGE] }, account,
      route: { view: "challenge", event: "got-a-talent" } });
    expect(root.querySelector(".yours").textContent).toContain("timeline.json");
    expect(root.querySelector(".facts").textContent).toContain("open floor");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/workshop`
Expected: the new tests fail.

- [ ] **Step 3: Implement**

`app/src/workshop/api.js`:

```js
export const getTimeline = (event) => json(`${challengeUrl(event)}/timeline`);
export const saveTimeline = (event, text) => post(`${challengeUrl(event)}/timeline`, { text });
```

`app/src/workshop/performance.js`:

```js
// A stage challenge's performance, timeline.json, edited on the training's page: the file as it is, in
// the Arena's terminal box, and one button once it changed. Saving goes through the Arena's own
// loader first; the checkpoint on the stage then plays the new moves. A refusal says where the file
// is wrong, and the text stays as typed.

import { el } from "./dom.js";

export function performancePanel({ guide }, { load, save, onSaved }) {
  const box = el("section", "performance");
  box.innerHTML = `
    <div class="section-label"><p class="eyebrow">Your performance</p>
      <a class="hint" target="_blank" rel="noopener">What the numbers mean ↗</a></div>
    <div class="terminal">
      <div class="terminal-bar mono-label">timeline.json</div>
      <textarea class="terminal-body performance__text" spellcheck="false" rows="14"></textarea>
    </div>
    <p class="note bad performance__why" hidden></p>
    <div class="actions"><button class="button performance__save" type="button" hidden>Save and play</button></div>`;
  const $ = (selector) => box.querySelector(selector);
  $("a").href = guide;
  const text = $(".performance__text");
  const why = $(".performance__why");
  const button = $(".performance__save");
  let saved = "";
  const changed = () => {
    button.hidden = text.value === saved;
  };
  const refuse = (error) => {
    why.textContent = error.message;
    why.hidden = false;
  };
  text.addEventListener("input", changed);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      ({ text: saved } = await save(text.value));
      why.hidden = true;
      changed();
      onSaved();
    } catch (error) {
      refuse(error);
    } finally {
      button.disabled = false;
    }
  });
  load().then(({ text: current }) => {
    saved = current;
    text.value = current;
    changed();
  }, refuse);
  return box;
}
```

`app/src/workshop/job.js`. Import `isStage` from `../format.js`, `eventGuideHref` from `../router.js` and `performancePanel` from `./performance.js`. Then:
- `const stage = isStage(event);` next to `voted`.
- After the grid is appended, for a stage only:

```js
  if (stage) {
    $(".ckpts").after(performancePanel({ guide: `${status.arena}/${eventGuideHref(event.id)}` }, {
      load: () => api.getTimeline(event.id),
      save: (text) => api.saveTimeline(event.id, text),
      // The new moves on the stage at once: the checkpoint chosen is played again with them.
      onSaved: () => {
        evaluations.clear();
        if (selected !== null) pick(selected);
      },
    }));
  }
```

- `drawScore`: in the evaluated branch, a stage says what the performance did:

```js
    } else if (stage) {
      const done = row.stage;
      value.textContent = done.fell_at == null ? "No fall" : `Fell at ${seconds(done.fell_at)}`;
      seeds.textContent = `seated ${seconds(done.seated_s)} · standing ${seconds(done.standing_s)}`;
    } else {
```

- The caveat: `$(".score__caveat").textContent = stage ? "Indicative: the Arena plays your entry again, on its own computer." : <the markup's text>`. Set it once after the markup.
- The checkpoints' hint: `stage ? "Click one to watch it perform." : <existing>`.

`app/src/workshop/publish.js`. In the result, the bold time is for races only: `...(event.metric === "votes" ? [] : [el("b", "", officialTime(done.entered))])`, with the comment "A voted event's entry has no official time: votes rank it."

`app/src/workshop/challenge.js`. Add `const PERFORMANCE = ["timeline.json", "your performance: what the Arena commands, and when (a training's page edits it and plays it)"];`. Then `yours(folder, stage)` lists `stage ? [...FILES, PERFORMANCE] : FILES`, and `head` passes `isStage(event)`.

`app/public/workshop.css`. Keep it to what makes the terminal hold a textarea:

```css
/* The performance: timeline.json in the Arena's terminal box, edited in place. */
.performance { margin-top: 16px; }
.performance__text { display: block; width: 100%; min-height: 16em; resize: vertical; border: 0; outline: 0;
  font: inherit; color: inherit; background: transparent; white-space: pre; }
```

(`workshop.css` spaces in plain pixels, as above; check the box at 1280 and 420 wide in Task 14.)

- [ ] **Step 4: Run the whole front-end suite**

Run: `cd app && npm test`
Expected: only the 4 known `brightness` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/workshop app/public/workshop.css
/usr/bin/git commit -m "The training's page of a stage edits timeline.json in the terminal box, saves and plays it with one button, and says what the checkpoint did"
```

### Task 10: the guide describes the stage

**Files:**
- Modify: `docs/guides/challenges/got-a-talent.md`. Also check `README.md` and `docs/guides/train-a-policy.md` for any got-a-talent sentence that still describes the lane. As of 2026-10-01 they hold none; if one appears, fix it in the same commit.

- [ ] **Step 1: Rewrite** `docs/guides/challenges/got-a-talent.md`:

````markdown
# MicroDuck Got a Talent

Put on a 20-second performance on an open stage. The public votes for its favourite.

## Train

Open **Train my own robot** on the challenge page, or run this in a terminal:

```bash
uv run https://pollen-robotics-microduck-arena.hf.space/workshop.py got-a-talent
```

The challenge trains a duck to sit and stand on command and to turn its head where it is told.
Your policy follows the commands; your performance gives them.

## Your performance

A performance is a `timeline.json` published beside your policy: when to sit, when to stand,
where to look. The Arena plays it once, on a flat open floor, for at most **20 seconds**. Nothing is
timed and nothing has to be finished; a fall is part of the show.

```json
{"timeline_version": 1, "duration_s": 20.0, "keyframes": [
  {"t": 0.0},
  {"t": 2.0, "twist": [1, 0, 0], "head": [0, 0, 0.5, 0]},
  {"t": 7.0, "head": [0, 0.4, 0, 0]}
]}
```

- From each keyframe's `t`, in seconds, until the next one, the policy reads its 13 command
  numbers: `twist` (3), `head` (4), `body` (6). A group a keyframe leaves out is zeros.
- The challenge's policy reads `twist[0]` as the sit flag (1 sit, 0 stand), and `head` as neck
  pitch, head pitch, head yaw and head roll, in radians from its default pose.
- The first keyframe is at 0, times go up, at most 1000 keyframes, every number within ±10.

The workshop edits it on a training's page and plays it with the checkpoint you pick. From a
shell, `uv run --group workshop arena score policy.onnx --event got-a-talent --timeline timeline.json`
plays it on your machine, and `uv run publish … --timeline timeline.json --enter` enters it. An entry
without a timeline stands still for 20 s.

## Judging

Every performance played to the end goes to the ballots. The most votes over the **last seven
days** wins; tied entries favour the earlier publication.

Your **latest entry** represents you. Votes on an older entry do not transfer to its replacement.

Ballots offer two to four anonymous performances, excluding your own, watched one at a time on
stage. You can cast **20 votes per UTC day**. Each accepted vote earns **2 player points** until it
leaves the seven-day window.

[How the workshop works, and the shell path →](../train-a-policy.md)
````

- [ ] **Step 2: Check the guide renders and its tests hold**

Run: `cd app && npx vitest run src/guides.test.js`, then `rg -n "0.25 m/s|2 m flat|qualify" docs/guides/challenges/got-a-talent.md`
Expected: tests pass; the `rg` finds nothing.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/guides
/usr/bin/git commit -m "The MicroDuck Got a Talent guide describes the stage: a 20 s timeline.json, what its numbers mean, and how it is judged"
```

---

## Part 2 — microduck_rl (worktree `publish-timeline`)

### Task 11: a challenge says what its commands mean; a stage entry is worded as a performance

The manifest of every got-a-talent policy says `twist` and `head` are "unused (zeros)", although its policy reads the sit flag and the head pose. `publish --enter` also prints a stage entry as a race: "20.000 s (1/1 seeds) at 0.00 m/s".

**Files:**
- Modify:
  - `src/mjlab_microduck/challenge.py` (`Challenge.command`)
  - `src/mjlab_microduck/publish/cli.py` (command help from the challenge)
  - `src/mjlab_microduck/publish/arena.py` (`Entry.course`, `entered_line`)
- Test: `tests/test_challenge.py`, `tests/test_publish_manifest.py`, `tests/test_publish_enter.py`

**Interfaces:**
- Consumes: the Arena's submit answer `course` (Task 3).
- Produces:
  - `Challenge.command: dict[str, str]`, from an optional `[command]` table holding only `twist`, `head` and `body`.
  - The manifest's command help: the challenge's `[command]`, with `--twist-help` overriding its twist.
  - `Entry.course: str = "lane"`.

- [ ] **Step 1: Write the failing tests**

`tests/test_challenge.py`. `test_load_reads_the_contract` still holds, because `command` defaults to `{}`. Add:

```python
def test_a_challenge_says_what_its_commands_mean(tmp_path):
    folder = _folder(tmp_path, TOML + '\n[command]\ntwist = "[sit flag; unused; unused]"\nhead = "4 head deltas, rad"\n')
    assert ch.load(folder / "tasks.py").command == {"twist": "[sit flag; unused; unused]", "head": "4 head deltas, rad"}


def test_a_command_group_the_policy_does_not_have_is_named(tmp_path):
    folder = _folder(tmp_path, TOML + '\n[command]\nlegs = "?"\n')
    with pytest.raises(ValueError, match="legs"):
        ch.load(folder / "tasks.py")
```

`tests/test_publish_manifest.py`. Mirror `test_publish_run_needs_only_the_repo_for_a_challenge`, with a `[command]` table in the sprint challenge's toml:

```python
def test_the_challenges_command_help_is_in_the_manifest_and_a_flag_overrides_it(tmp_path, monkeypatch, fake_mjlab):
    import json

    from mjlab_microduck import challenge as ch
    from mjlab_microduck.publish.cli import PublishConfig, run

    monkeypatch.setattr(ch, "_REGISTRY", {})
    folder = tmp_path / "sprint_2m"
    folder.mkdir()
    (folder / "challenge.toml").write_text(
        'event = "sprint-2m"\ntask = "Mjlab-Sprint2m-MicroDuck"\nkind = "perpetual"\n'
        '[command]\ntwist = "[sit flag; unused; unused]"\nhead = "4 head deltas, rad"\n'
    )
    (folder / "tasks.py").write_text("")
    ch.register(folder / "tasks.py")
    monkeypatch.chdir(tmp_path)
    assert run(PublishConfig(repo="alice/microduck-sprint", run=str(_run_dir(tmp_path)), dry_run=True,
                             twist_help="[vx, vy, wz]")) == 0
    command = json.loads((tmp_path / "publish-sprint" / "manifest.json").read_text())["command"]
    assert command["twist"] == "[vx, vy, wz]"
    assert command["head"] == "4 head deltas, rad"
    assert command["body"] == "unused (zeros)"
```

`tests/test_publish_enter.py`:

```python
def test_a_stage_entry_is_said_as_a_performance(tmp_path, monkeypatch, fake_mjlab, sprint_challenge, hub, arena, capsys):
    arena.reply["body"] = json.dumps(ENTERED | {"score": 20.0, "seeds_finished": 1, "seeds_total": 1,
                                                "command_vx": 0.0, "course": "stage"})
    assert _publish(tmp_path, monkeypatch, arena=arena.url) == 0
    assert f"[publish] entered on sprint-2m: a 20.00 s performance → {PAGE}" in capsys.readouterr().out
```

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/python -m pytest -q tests/test_challenge.py tests/test_publish_manifest.py tests/test_publish_enter.py`
Expected: the new tests fail.

- [ ] **Step 3: Implement**

`src/mjlab_microduck/challenge.py`:
- Docstring: add `[command]` to the example, with the comment "what the policy reads in each command group, for the manifest".
- `Challenge` gets `command: dict[str, str] = field(default_factory=dict)`.
- In `load`:

```python
    command = table.get("command", {})
    unknown = sorted(set(command) - {"twist", "head", "body"})
    if unknown:
        raise ValueError(f"{path}: [command] says what twist, head and body mean, not {unknown}")
    ...
        command={group: str(text) for group, text in command.items()},
```

`src/mjlab_microduck/publish/cli.py`:
- The `twist_help` docstring gains "Default: the challenge's.".
- The command help becomes:

```python
        # What each command group means: the challenge's challenge.toml says it once for every publish
        # of its task; --twist-help overrides the twist's for one.
        command_help = {**(found.command if found else {}), **({"twist": cfg.twist_help} if cfg.twist_help else {})} or None
```

`src/mjlab_microduck/publish/arena.py`:
- `Entry` gets `course: str = "lane"` as its last field.
- `enter()` passes `course=body.get("course", "lane")`; an Arena older than 0.4.3 sends none.
- `entered_line`:

```python
def entered_line(event: str, entry: Entry) -> str:
    said = "already entered" if entry.already else "entered"
    if entry.course == "stage":
        # A performance has no time, seeds or speed: its length is the only number it has.
        played = f"a {entry.score:.2f} s performance" if entry.seeds_finished else "a performance cut short"
        return f"[publish] {said} on {event}: {played} → {entry.page_url}"
    return (f"[publish] {said} on {event}: {entry.score:.3f} s ({entry.seeds_finished}/{entry.seeds_total} "
            f"seeds) at {entry.command_vx:.2f} m/s → {entry.page_url}")
```

- [ ] **Step 4: Run microduck_rl's publish and challenge tests**

Run: `.venv/bin/python -m pytest -q tests/test_challenge.py tests/test_publish_manifest.py tests/test_publish_enter.py tests/test_cli.py tests/test_provenance.py tests/test_hf_jobs_flag.py`
Expected: all pass.

- [ ] **Step 5: Commit** (in the microduck_rl worktree, not pushed)

```bash
/usr/bin/git add src/mjlab_microduck/challenge.py src/mjlab_microduck/publish tests/test_challenge.py tests/test_publish_manifest.py tests/test_publish_enter.py
/usr/bin/git commit -m "A challenge says what its commands mean for the manifest, and a stage entry is said as a performance"
```

---

## Part 3 — microduck-challenges (worktree `swag-stage`)

### Task 12: got_a_talent says what its commands mean; the README mentions the performance editor

**Files:**
- Modify: `src/microduck_challenges/got_a_talent/challenge.toml`, `README.md` (the workshop section), `tests/test_got_a_talent.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_got_a_talent.py`)

```python
def test_the_manifest_says_what_the_policy_reads():
    """publish writes this into every got-a-talent manifest: the sit flag and the head pose, never 'unused'."""
    from mjlab_microduck import challenge as ch

    import microduck_challenges  # noqa: F401 — registers every challenge's task

    command = ch.for_task("Mjlab-GotATalent-MicroDuck").command
    assert command["twist"].startswith("[sit flag")
    assert "head_yaw" in command["head"]
```

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python -m pytest -q tests/test_got_a_talent.py -k reads`. Use the venv directly: never `uv run` here.
Expected: FAIL (`KeyError: 'twist'`).

- [ ] **Step 3: Implement**

`src/microduck_challenges/got_a_talent/challenge.toml`, after `kind`:

```toml
# What the policy reads in each command group: publish writes it in the manifest.
[command]
twist = "[sit flag: 1 sit, 0 stand; unused; unused]"
head  = "[neck_pitch, head_pitch, head_yaw, head_roll]: rad from the default pose"
```

In `README.md`'s workshop section, add one sentence: "On MicroDuck Got a Talent, a training's page also edits `timeline.json`, your performance, and plays it with the checkpoint you pick."

- [ ] **Step 4: Run the challenge tests**

Run: `.venv/bin/python -m pytest -q tests/test_got_a_talent.py tests/test_challenges.py`
Expected: all pass.

- [ ] **Step 5: Commit** (not pushed)

```bash
/usr/bin/git add src/microduck_challenges/got_a_talent/challenge.toml README.md tests/test_got_a_talent.py
/usr/bin/git commit -m "got_a_talent says what its policy reads, for the manifest; the README's workshop edits the performance"
```

### Task 13: re-export the reference under got-a-talent (local, not published)

The phase A export, `publish-swag-contest-reference/`, names the event `swag-contest` and the task `Mjlab-SwagContest-MicroDuck`. Its run directory is no longer on disk. Checkpoint 2000 is in the private checkpoint repo `Nico-robot/mjlab-swagcontest-microduck-20260929-151904`. Reading it is a download, not a publish.

- [ ] **Step 1: Download the reference run** into the scratchpad. The repo mirrors `logs/rsl_rl/`, so the run is `swag_contest/<stamp>_reference/`.

```bash
cd ~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/swag-stage
export HF_TOKEN=$(cat ~/.cache/huggingface/token)
.venv/bin/hf download Nico-robot/mjlab-swagcontest-microduck-20260929-151904 --local-dir $SCRATCH/reference-run \
  --include "*/*_reference/model_2000.pt" "*/*_reference/provenance.json" "*/*_reference/params/*"
ls $SCRATCH/reference-run/*/*
```

- [ ] **Step 2: Export it as the got-a-talent reference**

The run's provenance names the task `Mjlab-SwagContest-MicroDuck`, which is no longer registered. `--task` exports the checkpoint through today's `Mjlab-GotATalent-MicroDuck`: the same env, renamed (diff 0f11bbd..swag-stage: names and comments only). The challenge then gives the event, the kind and the command help (Task 12), so neither `--event` nor `--twist-help` is passed.

```bash
RUN=$(ls -d $SCRATCH/reference-run/*/*_reference)
.venv/bin/publish --run "$RUN" --task Mjlab-GotATalent-MicroDuck --checkpoint 2000 \
  --repo pollen-robotics/microduck-got-a-talent-reference --name got-a-talent-reference --slot sitstand --dry-run \
  --timeline src/microduck_challenges/got_a_talent/timeline.json \
  --description 'Sits and stands on the sit flag, head on command; checkpoint 2000, the MicroDuck Got a Talent reference.'
```

Expected: `publish-got-a-talent-reference/` holds `policy.onnx`, `manifest.json`, `README.md`, `checkpoint.pt` and `timeline.json`. In the manifest:
- `"arena": {"event": "got-a-talent"}`;
- `"name": "got-a-talent-reference"`;
- `training.task_id` is `Mjlab-GotATalent-MicroDuck`;
- `command.twist` and `command.head` are got_a_talent's `[command]`.

- [ ] **Step 3: Judge the export on the Arena** (deterministic ONNX, this Mac's MuJoCo)

```bash
.venv/bin/python -m microduck_challenges.got_a_talent.check publish-got-a-talent-reference/policy.onnx
.venv/bin/arena score publish-got-a-talent-reference/policy.onnx --event got-a-talent --timeline publish-got-a-talent-reference/timeline.json
```

Expected: `check.py` prints PASS, and the summary reads "fell: no". Phase A measured sits of 0.78–0.80 s, a stand of 0.34 s, and head error ≤ 0.08 rad. Compare the ONNX's sha256 with the phase A export's: same checkpoint, same exporter, so it should be identical.

- [ ] **Step 4: Remove the stale export** only once Step 3 passes: `rm -r publish-swag-contest-reference`. It is gitignored and generated.

Nothing is committed in this task. Record in the final report what the README's Reproduce block says. It replays the recorded command, `train Mjlab-SwagContest-MicroDuck`, at the recorded commit `0f11bbd`. That commit exists only on the local branch `swag-stage-pre-rebase`, so it does not reproduce from GitHub until it is pushed somewhere (the owner's call).

### Task 14: see it work on this Mac (site, ballot, clip, workshop)

The controller does this task, not an implementer. It ends with screenshots in the scratchpad and the numbers measured.

- [ ] **Step 1: Build the site and record three local performances under different users**

```bash
cd ~/Projects/HuggingFace/microduck-arena/.claude/worktrees/swag-stage
(cd app && npm run build)
REF=~/Projects/HuggingFace/microduck-challenges/.claude/worktrees/swag-stage/publish-got-a-talent-reference
STORE=$SCRATCH/stage-store
for who in ann bob cid; do
  uv run --no-config --frozen arena score "$REF/policy.onnx" --event got-a-talent --timeline "$REF/timeline.json" --store "$STORE" --user "$who"
done
uv run --no-config --frozen arena score assets/policies/BEST_alpha_walking.onnx --event sprint-2m --store "$STORE" --user ann
```

- [ ] **Step 2: Serve it and look.** Start `uv run --no-config --frozen arena serve --store "$STORE"` in the background; this is a server, not a test. Use headless Chrome (memory `headless-chrome-available-locally`), at 1280×800 and 420×900:
- the home wall: the stage flyer's facts and still;
- the race page `#/e/got-a-talent`: its facts, caveat and board without m/s or seeds, and the stage replaying 20 s;
- a publication `#/r/<id>`: length, PERFORMED, no seed list, the board by votes;
- the ballot `#/v/got-a-talent`, signed in as `dev_user`;
- a race page, which must be unchanged.

Watch the console for errors. Save the screenshots in `$SCRATCH/phase-b-shots/`.

- [ ] **Step 3: Render one stage clip and time it**

```bash
uv run --no-config --frozen arena clip <run_id> --store "$STORE"
```

Watch both layouts: whole performance, no horn, BRAVO, length + points, ends on the crane. Write down the render time. The Space's budget is 900 s for both layouts: compare with a sprint clip rendered the same way.

- [ ] **Step 4: The workshop on the reference run, without `uv run`**
1. Copy the downloaded reference run into the challenges worktree as `logs/rsl_rl/got_a_talent/<stamp>_reference/`, with `model_2000.pt` and `provenance.json` only. Edit its `provenance.json` task to `Mjlab-GotATalent-MicroDuck` (a local copy, for the rehearsal only).
2. Put `publish-got-a-talent-reference/policy.onnx` as `workshop/model_2000.onnx`, newer than the `.pt`. The workshop then plays it without exporting, so no `uv` is called.
3. Start `.venv/bin/workshop got-a-talent --arena http://127.0.0.1:8000 --no-browser` from the challenges worktree.
4. Open the training's page, pick checkpoint 2000 and watch the performance.
5. Edit `timeline.json` in the panel (e.g. a sit at 2 s → 4 s), Save and play, and watch the new moves.
6. Break it (a duration of 25): the refusal shows and the file is untouched.
7. Do not press Publish or Preview: both call `uv run`.

Screenshots at 1280 and 420 wide, side by side with the Arena's race page.

- [ ] **Step 5: Clean up** the copied run, the store and the servers. The challenges worktree's `timeline.json` must be byte-identical to its commit: `/usr/bin/git status --short` shows nothing.

### Task 15: version 0.4.3 and the whole-branch review

- [ ] **Step 1: Bump the version** exactly as `93cc1d3` did. Check with `/usr/bin/git show 93cc1d3 -- pyproject.toml uv.lock`, then edit the same two lines to `0.4.3`.

```bash
/usr/bin/git add pyproject.toml uv.lock
/usr/bin/git commit -m "Version 0.4.3: MicroDuck Got a Talent on the stage"
```

- [ ] **Step 2: Run everything** as the Global Constraints say. In the Arena:
- the three Python calls;
- `cd app && npm test`.

In microduck_rl: `.venv/bin/python -m pytest -q tests/test_challenge.py tests/test_publish_manifest.py tests/test_publish_enter.py`. In the challenges worktree: `.venv/bin/python -m pytest -q`.

Expected: everything green, except the 4 known `brightness` failures.

- [ ] **Step 3: Whole-branch review** (superpowers:requesting-code-review). Review the three branches against this plan and the spec's phase B section, then fix what it finds.
