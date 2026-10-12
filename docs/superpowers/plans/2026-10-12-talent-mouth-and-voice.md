# The duck's mouth and voice on the Got a Talent stage — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Got a Talent `timeline.json` can pull the real pad's RT (the beak opens, the duck quacks) and LT (the beak opens, the duck wheees while held). The beak and the voice play on the run page, the event page, the ballot, the workshop and in the clip.

**Architecture:**
- **Arena server:** the timeline loader reads an optional `"triggers": [rt, lt]` group per keyframe. The policy never reads it, and nothing is simulated. Every run record keeps the compact trigger track. Board rows, ballots and workshop evaluations serve it.
- **Front-end:** one pure module, `duck-voice.js`, turns a track into the beak's opening per frame and into a list of sounds. It follows the pad's and the robot's own rules. The viewer opens the beak on a jaw pivot shared with the booth and plays the sounds live through `stage-voice.js`. The clip puts the same sounds in its soundtrack.
- **Synth:** the booth's wasm module (the `sounds` crate at e597877) gains the robot's `chirp` and `wheee` recipes.

**Tech Stack:** Python 3.12, FastAPI, pytest; vanilla JS + three.js, vitest/jsdom, Web Audio; Rust → wasm32-unknown-unknown.

**Spec:** `docs/superpowers/specs/2026-10-12-talent-mouth-and-voice-design.md` (approved by the owner 2026-10-12, amended with this plan: board rows carry the track, and the wheee has no end segment).

## Global Constraints

- **Commits and GitHub:** English only. Never signed: no `Co-Authored-By`, no "Generated with Claude Code". This overrides any default attribution.
- **Nothing leaves this Mac without the owner's yes.** No push, no wheel upload, no Hub write, no Space dataset write, no HF Job.
- **Worktree:** `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/talent-voice` on branch `talent-voice`, made from local `main` (which holds the spec and this plan). Set it up once:
  - `/usr/bin/git worktree add .claude/worktrees/talent-voice -b talent-voice main`
  - `cd .claude/worktrees/talent-voice && uv sync --no-config --frozen --extra dev && (cd app && npm ci)`
- **git:** always `/usr/bin/git`. The RTK hook's `git` rewrite is refused inside a worktree.
- **uv:** always `uv run --no-config --frozen …`. If `uv.lock` changes by accident, run `/usr/bin/git checkout -- uv.lock`.
- **Tests always run in the FOREGROUND, as one Bash call with `timeout: 600000`.** Never `run_in_background`, never a monitor, never end a turn "waiting for" a run. The Python suite runs as three calls; record the pass counts of each at the start:
  1. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
  2. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_[a-l]*.py`
  3. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_[m-z]*.py`
- **Front-end:** `cd app && npm test`. The only accepted failures are the 4 known ones in `src/brightness.test.js`. Single file: `cd app && npx vitest run src/<file>.test.js`.
- **Untouched:** `arena/runner.py`, the golden run, `RUNNER_VERSION`, the 13 command numbers and `timeline_version` (stays 1).
- **The rules are microduck's (pollen-robotics/microduck @ e597877), copied exactly:**
  - the beak opens to `max(rt, lt)`, over the real travel of 35° (−5° to +30°);
  - a quack (`chirp`) fires when RT crosses 0.3 going up;
  - the wheee plays while LT ≥ 0.3, and dropping under 0.3 cuts it;
  - one sound at a time: a new quack cuts the one playing, and a quack during a wheee is dropped;
  - at a single instant, the wheee is decided before the quack.
- **The voice:** `DUCK_SEED = 28`. This is provisional until the owner picks a seed from the audition WAVs. The executor uses whatever value is written here when it starts.
- **Wording:** English everywhere on the site, in the docs and in comments. A stage run is a "performance", never a "show".
- **Scratchpad:** `SCRATCH=/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/159f3cea-36ba-4867-b6d2-93f3f18efc9c/scratchpad`.

## Review Focus

1. **RT pulled, then released one keyframe later (0.02 s):** the quack still plays to the end of its recording. A release never cuts a quack; only the next sound or the performance's end does. Pinned in Task 5.
2. **RT held at 1 over many keyframes:** it quacks once, not once per keyframe. The track keeps changes only (Task 1), and the rules fire on rising edges (Task 5).
3. **RT and LT pulled at the same keyframe:** the wheee starts and the quack is dropped. LT released and RT pulled at the same keyframe: the quack plays. Pinned in Task 5.
4. **A performance cut short** (the trace ends before `duration_s`): its sounds stop where the trace stops, in the viewer and in the clip. Pinned in Task 9; the viewer uses the trace's length in Task 7.
5. **Every run, race and clip from before:** no `triggers` means no jaw pivot, no Web Audio and no wasm load, and nothing throws. An old record reads back with `triggers` None (Task 2). A clip without voice never loads the synth (Task 9). A lane without triggers keeps its beak as the rig made it (Task 7).

## Not in this plan (reported to the owner instead)

- The real robot replaying `timeline.json`: its daemon does not read the file yet.
- A voice per duck; a mute button; the booth's prompt; the reference choreography's own quacks (an option the owner decides later; republishing makes a new entry).
- **Owner's yes needed, each one:**
  1. push `talent-voice` → main (the Space deploys);
  2. the 0.4.4 wheel on pollen-robotics/microduck-arena-wheels and tag v0.4.4;
  3. microduck-challenges relocked onto 0.4.4 and pushed with the README line from Task 10.

---

### Task 1: The timeline reads the triggers

**Files:**
- Modify: `arena/timeline.py`
- Test: `tests/test_timeline.py`

**Interfaces:**
- Produces:
  - `Timeline.triggers: tuple[tuple[float, float], ...]`, default `()`. It holds one `(rt, lt)` per keyframe; a timeline made in code pulls nothing.
  - `trigger_track(timeline: Timeline) -> list[list[float]] | None`: a list of `[t, rt, lt]` at every change, starting at t = 0, or `None` when both triggers stay at 0.

- [ ] **Step 1: Write the failing tests**

In `tests/test_timeline.py`, import `trigger_track` (`from arena.timeline import Timeline, TimelineError, constant_timeline, load_timeline, trigger_track`) and add after `test_constant_timeline_holds_one_command`:

```python
def test_triggers_are_read_per_keyframe_and_released_when_left_out(tmp_path):
    raw = good(keyframes=[
        {"t": 0.0},
        {"t": 2.0, "twist": [1, 0, 0], "triggers": [1, 0]},
        {"t": 2.3, "twist": [1, 0, 0]},
        {"t": 4.0, "triggers": [0, 0.5]},
    ])
    timeline = load_timeline(write(tmp_path, raw), LIMIT_S)
    assert timeline.triggers == ((0.0, 0.0), (1.0, 0.0), (0.0, 0.0), (0.0, 0.5))
    # The policy never sees them: the command stays the 13 numbers.
    assert timeline.commands[1] == (1.0,) + (0.0,) * 12


def test_the_trigger_track_keeps_the_changes_only(tmp_path):
    """RT held over two keyframes is one pull, not two: the replay quacks on a change."""
    raw = good(keyframes=[
        {"t": 0.0, "triggers": [1, 0]},
        {"t": 1.0, "twist": [1, 0, 0], "triggers": [1, 0]},
        {"t": 2.0},
        {"t": 3.0, "head": [0, 0, 0.3, 0]},
        {"t": 4.0, "triggers": [0, 1]},
    ])
    track = trigger_track(load_timeline(write(tmp_path, raw), LIMIT_S))
    assert track == [[0.0, 1.0, 0.0], [2.0, 0.0, 0.0], [4.0, 0.0, 1.0]]


def test_a_performance_that_pulls_nothing_has_no_track(tmp_path):
    assert trigger_track(load_timeline(write(tmp_path, good()), LIMIT_S)) is None
    assert trigger_track(constant_timeline((0.0,) * 13, 20.0)) is None
```

Add these rows to the `parametrize` list of `test_a_malformed_timeline_is_refused_with_where`, after the `body` row:

```python
        (good(keyframes=[{"t": 0.0, "triggers": [1]}]), r"keyframes\[0\]\.triggers: expected 2 numbers"),
        (good(keyframes=[{"t": 0.0, "triggers": 1}]), r"keyframes\[0\]\.triggers: expected 2 numbers"),
        (good(keyframes=[{"t": 0.0, "triggers": [0, "1"]}]), r"keyframes\[0\]\.triggers\[1\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "triggers": [0, True]}]), r"keyframes\[0\]\.triggers\[1\]: expected a number"),
        (good(keyframes=[{"t": 0.0, "triggers": [1.5, 0]}]), r"keyframes\[0\]\.triggers\[0\]: 1.5 is outside \[0, 1\]"),
        (good(keyframes=[{"t": 0.0, "triggers": [0, -0.1]}]), r"keyframes\[0\]\.triggers\[1\]: -0.1 is outside \[0, 1\]"),
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py`
Expected: FAIL. The import of `trigger_track` fails, so the whole file errors.

- [ ] **Step 3: Implement**

In `arena/timeline.py`:

1. Append a paragraph to the module docstring, before the closing `"""`:

```
A keyframe may also pull the real pad's two triggers, `"triggers": [rt, lt]`, each within [0, 1]:
in the replay they open the duck's beak and make it quack or wheee (app/src/duck-voice.js). The
policy never reads them — the command stays 13 numbers — and a keyframe that leaves them out
releases both, like any group.
```

2. Under `GROUPS`, add:

```python
# The pad's RT and LT, read beside the command and never by the policy.
TRIGGERS = 2
```

3. Give `Timeline` the new field, after `commands`:

```python
    # The pad's (RT, LT) at each keyframe; empty for a timeline made in code, which pulls nothing.
    triggers: tuple[tuple[float, float], ...] = ()
```

4. In `_keyframe`, accept the key and read it. Replace the `unknown = …` line with:

```python
    unknown = sorted(set(raw) - {"t", "triggers", *(name for name, _ in GROUPS)})
```

and replace the final `return t, tuple(command)` with:

```python
    pulled = raw.get("triggers", [0.0] * TRIGGERS)
    if not isinstance(pulled, list) or len(pulled) != TRIGGERS:
        raise TimelineError(f"{where}.triggers: expected {TRIGGERS} numbers, got {pulled!r}")
    triggers = []
    for i, value in enumerate(pulled):
        number = _number(value, f"{where}.triggers[{i}]")
        if not 0.0 <= number <= 1.0:
            raise TimelineError(f"{where}.triggers[{i}]: {number} is outside [0, 1]")
        triggers.append(number)
    return t, tuple(command), tuple(triggers)
```

5. In `load_timeline`, collect them. Replace the loop and the return with:

```python
    times, commands, triggers, previous = [], [], [], None
    for index, keyframe in enumerate(keyframes):
        previous, command, pulled = _keyframe(keyframe, index, duration_s, previous)
        times.append(previous)
        commands.append(command)
        triggers.append(pulled)
    return Timeline(duration_s, tuple(times), tuple(commands), tuple(triggers))
```

6. At the end of the file, add:

```python
def trigger_track(timeline: Timeline) -> list[list[float]] | None:
    """What the replay needs of the triggers: [t, rt, lt] where they change, from t = 0. None when
    both stay released throughout, so a performance that pulls nothing stores nothing."""
    track = []
    for t, (rt, lt) in zip(timeline.times, timeline.triggers):
        if not track or track[-1][1:] != [rt, lt]:
            track.append([t, rt, lt])
    return track if any(rt or lt for _, rt, lt in track) else None
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py tests/test_hub_fetch.py tests/workshop/test_performance.py`
Expected: PASS. The hub fetch and the workshop already go through `load_timeline`, so they accept triggers now.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/timeline.py tests/test_timeline.py
/usr/bin/git commit -m "A timeline can pull the pad's RT and LT: read beside the command, never by the policy"
```

---

### Task 2: A run keeps the triggers its performance pulls

**Files:**
- Modify: `arena/store.py` (`RunRecord`, `to_dict`, `from_dict`)
- Modify: `arena/web/routes_submit.py` (`_enter`), `arena/recover.py` (`recover`), `arena/cli.py` (`_cmd_score`)
- Test: `tests/test_store.py`, `tests/test_routes_submit.py`, `tests/test_recover.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `trigger_track(timeline)` from Task 1.
- Produces: `RunRecord.triggers: list | None = None`, stored as `"triggers"` in the record's JSON.

- [ ] **Step 1: Write the failing tests**

`tests/test_store.py`, at the end:

```python
def test_a_record_keeps_its_triggers_and_an_older_one_has_none():
    record = make_record(event_id="got-a-talent", triggers=[[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]])
    assert RunRecord.from_dict(record.to_dict()) == record
    older = record.to_dict()
    del older["triggers"]
    assert RunRecord.from_dict(older).triggers is None
```

`tests/test_routes_submit.py`, after `test_the_same_weights_with_another_timeline_are_another_performance`:

```python
def _stored(api, event_id, run_id):
    return next(r for r in api.app.state.store.runs(event_id) if r.run_id == run_id)


def test_a_stage_entry_keeps_the_triggers_its_timeline_pulls(api):
    stand = (0.0,) * 13
    pulled = Timeline(2.0, (0.0, 0.5, 1.0), (stand,) * 3, ((0.0, 0.0), (1.0, 0.0), (0.0, 0.0)))
    _TIMELINES["alice/best_alpha_walking"] = (pulled, "c" * 64)
    body = submit(api, event="got-a-talent").json()
    assert _stored(api, "got-a-talent", body["run_id"]).triggers == [[0.0, 0.0, 0.0], [0.5, 1.0, 0.0], [1.0, 0.0, 0.0]]


def test_a_race_and_a_still_performance_keep_no_triggers(api):
    race = submit(api).json()
    assert _stored(api, "sprint-2m", race["run_id"]).triggers is None
    _TIMELINES["alice/best_alpha_walking"] = (performance(1.0), "d" * 64)
    still = submit(api, event="got-a-talent").json()
    assert _stored(api, "got-a-talent", still["run_id"]).triggers is None
```

`tests/test_recover.py`, in `test_recover_plays_a_stage_entry_with_its_timeline_at_the_listed_revision`: replace the `timeline=` argument with

```python
            timeline=Timeline(2.0, (0.0, 1.0), ((0.0,) * 13,) * 2, ((0.0, 1.0), (0.0, 0.0))),
            timeline_sha256="t" * 64,
```

and add at the end of the test:

```python
    assert record.triggers == [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]
```

`tests/test_cli.py`, at the end:

```python
def test_score_records_the_triggers_a_performance_pulls(tmp_path, capsys):
    from arena.store import LocalStore

    timeline = tmp_path / "timeline.json"
    timeline.write_text(json.dumps({"timeline_version": 1, "duration_s": 1.0,
                                    "keyframes": [{"t": 0.0}, {"t": 0.5, "triggers": [0, 1]}]}))
    store = tmp_path / "store"
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(timeline),
                 "--store", str(store)]) == 0
    [record] = LocalStore(store).runs("got-a-talent")
    assert record.triggers == [[0.0, 0.0, 0.0], [0.5, 0.0, 1.0]]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_store.py tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py`
Expected: FAIL with `TypeError: RunRecord.__init__() got an unexpected keyword argument 'triggers'` and with the `triggers` attribute missing.

- [ ] **Step 3: Implement**

`arena/store.py`: after the `timeline_sha256` field, add

```python
    # The pad's triggers a stage entry pulls, as arena.timeline.trigger_track gives them: [t, rt, lt]
    # where they change. None for a race and for a performance that pulls none. Never simulated: the
    # replay opens the duck's beak and plays its quack and wheee from it.
    triggers: list | None = None
```

In `to_dict`, after `"timeline_sha256": self.timeline_sha256,` add `"triggers": self.triggers,`. In `from_dict`, after `timeline_sha256=raw.get("timeline_sha256"),` add:

```python
            # .get, not [..]: runs recorded before triggers existed have no such key.
            triggers=raw.get("triggers"),
```

`arena/web/routes_submit.py`: add `from ..timeline import trigger_track` to the imports. In `_enter`'s `RunRecord(...)`, after `timeline_sha256=fetched.timeline_sha256,` add:

```python
        triggers=trigger_track(fetched.timeline) if fetched.timeline else None,
```

`arena/recover.py`: in `recover`, add `from .timeline import trigger_track` to the local imports (beside `from .store import RunRecord, new_id`). In its `RunRecord(...)`, after `timeline_sha256=fetched.timeline_sha256,` add:

```python
                triggers=trigger_track(fetched.timeline) if fetched.timeline else None,
```

`arena/cli.py`: add `trigger_track` to the existing `from .timeline import …` line. In `_cmd_score`, make `timeline` exist on every path. Replace the first two lines of the stage branch:

```python
    timeline = None
    if manifest.course.kind == "stage":
        timeline = load_timeline(Path(args.timeline), manifest.time_limit_s) if args.timeline else None
```

Then, in its `RunRecord(...)`, after `livery=args.livery,` add:

```python
            triggers=trigger_track(timeline) if timeline else None,
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_store.py tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/store.py arena/web/routes_submit.py arena/recover.py arena/cli.py tests/test_store.py tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py
/usr/bin/git commit -m "A run keeps the triggers its performance pulls: entered, recovered or scored locally"
```

---

### Task 3: Boards, ballots and workshop evaluations say how the duck sounds

**Files:**
- Modify: `arena/web/routes_read.py` (`_board_row`), `arena/web/routes_vote.py` (`issue_ballot`), `arena/workshop/evaluations.py` (`_measure`)
- Test: `tests/test_routes_read.py`, `tests/test_routes_vote.py`, `tests/workshop/test_performance.py`

**Interfaces:**
- Consumes: `RunRecord.triggers` (Task 2), `trigger_track` (Task 1).
- Produces:
  - every board row gains `"triggers"`, the record's track or null;
  - the ballot body gains `"triggers"`, one track or null per lane, in lane order;
  - a workshop checkpoint evaluation body gains `"triggers"`.

- [ ] **Step 1: Write the failing tests**

`tests/test_routes_read.py`, after `test_a_stage_event_is_served_without_a_lane_or_a_sweep`:

```python
def test_a_board_row_says_how_its_duck_sounds_on_the_stage(client):
    """A lane on a stage is a board row: the event page, the run page and the clip put any row on it."""
    api, app = client
    track = [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]
    pulled = record_run(app, event_id="got-a-talent", user="ann", triggers=track)
    record_run(app, event_id="got-a-talent", user="bob")
    rows = {row["user"]: row for row in api.get("/api/events/got-a-talent/leaderboard").json()["rows"]}
    assert (rows["ann"]["triggers"], rows["bob"]["triggers"]) == (track, None)
    detail = api.get(f"/api/runs/{pulled.run_id}").json()
    assert next(row for row in detail["board"] if row["you"])["triggers"] == track
```

`tests/test_routes_vote.py`, after `test_the_client_response_never_carries_a_run_id`:

```python
def test_a_ballot_says_how_each_lanes_duck_sounds(client):
    api, app = client
    ann = enter(app, "ann", triggers=[[0.0, 1.0, 0.0]])
    bob = enter(app, "bob")
    body = api.get("/api/events/got-a-talent/ballot").json()
    entry = app.state.ballot_book.get(body["ballot"])
    sounds = {ann.run_id: ann.triggers, bob.run_id: None}
    assert body["triggers"] == [sounds[run_id] for run_id in entry.run_ids]
```

`tests/workshop/test_performance.py`: under `THREE_SECONDS`, add

```python
QUACKS = '{"timeline_version": 1, "duration_s": 2.0, "keyframes": [{"t": 0.0}, {"t": 1.0, "triggers": [1, 0]}]}\n'
```

At the end of `test_a_stage_checkpoint_plays_the_challenges_timeline`, add `assert body["triggers"] is None`. After that test, add:

```python
def test_a_checkpoint_replays_with_the_triggers_its_timeline_pulls(stage, checkout):
    stage.timeline.write_text(QUACKS)
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    assert evaluated(stage, run)["triggers"] == [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_read.py tests/test_routes_vote.py tests/workshop/test_performance.py`
Expected: FAIL with `KeyError: 'triggers'`.

- [ ] **Step 3: Implement**

`arena/web/routes_read.py`, in `_board_row`'s dict, after `"submitted_at": record.submitted_at,`:

```python
        # How the duck sounds on a stage (arena.timeline.trigger_track), or None: a lane is a board
        # row, so the row carries what the replay opens the beak and plays from.
        "triggers": record.triggers,
```

`arena/web/routes_vote.py`, in `issue_ballot`'s ballot answer, after `"lanes": len(picked),`:

```python
        # How each lane's duck sounds, in lane order: the performance itself, never who made it.
        "triggers": [r.triggers for r in picked],
```

`arena/workshop/evaluations.py`: import it (`from ..timeline import load_timeline, trigger_track`). In `_measure`'s `body`, after `"timeline": key,`:

```python
        "triggers": trigger_track(timeline) if timeline else None,
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_read.py tests/test_routes_vote.py tests/workshop/test_performance.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/web/routes_read.py arena/web/routes_vote.py arena/workshop/evaluations.py tests/test_routes_read.py tests/test_routes_vote.py tests/workshop/test_performance.py
/usr/bin/git commit -m "Boards, ballots and workshop evaluations say how each performer's duck sounds"
```

---

### Task 4: The synth sings the pad's two calls

**Files:**
- Modify: `app/voice/src/lib.rs`, `app/voice/Cargo.toml` (comment only)
- Rebuild: `app/public/sound/microduck-voice.wasm` (LFS)
- Modify: `app/src/live/voice.js`
- Test: `app/src/live/voice.test.js`

**Interfaces:**
- Produces:
  - wasm exports `chirp(seed: u32, variant: u32) -> usize` and `wheee(seed: u32, variant: u32, segment: u32) -> usize`, where segment 0 is the start and anything else the loop. Both write into the existing `samples()` buffer and return its length.
  - JS: `loadCalls(fetcher = fetch) -> Promise<{ chirp(seed, variant): Float32Array, wheee(seed, variant, segment): Float32Array }>`, mono at 48 kHz. Each result is a copy that later calls do not overwrite.

- [ ] **Step 1: Write the failing test**

`app/src/live/voice.test.js`: import `loadCalls` beside the others (`import { createVoice, loadCalls, loadSynth, windGust } from "./voice.js";`) and add after the `loadSynth` describe:

```js
describe("loadCalls", () => {
  it("quacks and wheees in the robot's own voice, the same every time", async () => {
    const calls = await loadCalls(wasm);
    const quack = calls.chirp(28, 3);
    expect(quack.length).toBeGreaterThan(0.05 * 48000);
    expect(quack.length).toBeLessThan(0.6 * 48000);
    expect(quack.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(1);
    expect(calls.chirp(28, 4)).not.toEqual(quack);
    const start = calls.wheee(28, 0, 0);
    const ride = calls.wheee(28, 0, 1);
    expect(start.length).toBeGreaterThan(0.5 * 48000);
    expect(ride.length).toBeGreaterThan(1.2 * 48000);
    // A copy each: the calls made since did not overwrite the first quack.
    expect(calls.chirp(28, 3)).toEqual(quack);
    await expect(loadCalls(async () => ({ ok: false }))).rejects.toThrow("No voice");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npx vitest run src/live/voice.test.js`
Expected: FAIL, `loadCalls` is not exported.

- [ ] **Step 3: Implement the wasm exports**

`app/voice/src/lib.rs`: change the first doc line from `//! One syllable of Peter's or Ray's, sung by the microduck's own synthesiser.` to

```rust
//! One syllable of Peter's or Ray's, and the stage duck's quack and wheee, sung by the microduck's
//! own synthesiser.
```

and append to the crate doc, after the "No bindings" paragraph:

```rust
//!
//! The quack and the wheee are the robot's own calls, unshaped: what its pad's RT and LT play.
```

At the end of the file, add:

```rust
/// The quack the robot's RT plays: this seed's `chirp`, variant `variant`. Returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn chirp(seed: u32, variant: u32) -> usize {
    keep(sounds::voices::chirp(&Personality::from_seed(seed), variant))
}

/// The wheee the robot's LT rides: segment 0 is its start, anything else its loop, which plays
/// over and over while the trigger is held. No end: a timeline releases its trigger, which cuts
/// the ride as the robot does. Returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn wheee(seed: u32, variant: u32, segment: u32) -> usize {
    let (start, ride, _) = sounds::voices::wheee_segments(&Personality::from_seed(seed), variant);
    keep(if segment == 0 { start } else { ride })
}

fn keep(sig: Vec<f32>) -> usize {
    let length = sig.len();
    SAMPLES.with_borrow_mut(|out| *out = sig);
    length
}
```

`app/voice/Cargo.toml`: change the first comment line to `# The booth's voices and the stage duck's calls: the microduck's own synthesiser, compiled for the page.`

Rebuild, from `app/voice`:

```bash
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/microduck_voice.wasm ../public/sound/microduck-voice.wasm
```

- [ ] **Step 4: Implement `loadCalls`**

In `app/src/live/voice.js`, replace `loadSynth`'s first three lines (fetch, ok check, instantiate) with a shared loader, and add `loadCalls`:

```js
async function voiceExports(fetcher) {
  const response = await fetcher("/sound/microduck-voice.wasm");
  if (!response.ok) throw new Error("No voice");
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  return instance.exports;
}

/** The robot's synthesiser, built from app/voice: `sing(seed, note)` renders
 * one note's syllable with that seed's microduck personality. The samples are
 * a view into the synth's memory, good until the next call. */
export async function loadSynth(fetcher = fetch) {
  const { memory, contour, syllable, samples } = await voiceExports(fetcher);
  return (seed, note) => {
    // …unchanged…
  };
}

/** The robot pad's two calls in its own synthesiser: `chirp(seed, variant)` is
 * RT's quack, `wheee(seed, variant, segment)` LT's ride (0 its start, 1 its
 * loop). Each is a copy, kept however many calls follow. */
export async function loadCalls(fetcher = fetch) {
  const { memory, chirp, wheee, samples } = await voiceExports(fetcher);
  const copy = (length) => new Float32Array(memory.buffer, samples(), length).slice();
  return {
    chirp: (seed, variant) => copy(chirp(seed, variant)),
    wheee: (seed, variant, segment) => copy(wheee(seed, variant, segment)),
  };
}
```

`loadSynth`'s body below its first line stays exactly as it is.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npx vitest run src/live/voice.test.js src/live/score.test.js`
Expected: PASS. The booth's `loadSynth` test still sings 12 000 samples, so the rebuild did not change the booth's voice.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/voice/src/lib.rs app/voice/Cargo.toml app/public/sound/microduck-voice.wasm app/src/live/voice.js app/src/live/voice.test.js
/usr/bin/git commit -m "The voice module sings the pad's two calls: RT's quack and LT's wheee, in the robot's own synth"
```

---

### Task 5: The rules of the beak and the voice

**Files:**
- Create: `app/src/duck-voice.js`
- Test: `app/src/duck-voice.test.js`

**Interfaces:**
- Consumes: `CTRL_DT` from `./replay.js`. `callSamples` takes the `calls` object from Task 4.
- Produces:
  - `DUCK_SEED`, `PULL` (0.3), `MOUTH_TRAVEL` (35° in radians);
  - `mouthTrack(track, frames, lead = 0) -> Float32Array | null`, the opening from 0 to 1 at each 50 Hz frame;
  - `voiceEvents(track, duration) -> [{ tag: "chirp" | "wheee", variant, start, end }]`;
  - `callSamples(calls, sound, seed = DUCK_SEED) -> Float32Array`, the exact samples a sound plays.

- [ ] **Step 1: Write the failing tests**

`app/src/duck-voice.test.js`:

```js
import { describe, expect, it } from "vitest";
import { DUCK_SEED, callSamples, mouthTrack, voiceEvents } from "./duck-voice.js";

describe("voiceEvents", () => {
  it("quacks once per press of RT across 0.3, and a release does not cut the quack", () => {
    const track = [[0, 0, 0], [1, 0.2, 0], [2, 1, 0], [2.02, 0, 0], [3, 0.9, 0], [3.1, 0.5, 0]];
    expect(voiceEvents(track, 10)).toEqual([
      { tag: "chirp", variant: 0, start: 2, end: 3 },
      { tag: "chirp", variant: 1, start: 3, end: 10 },
    ]);
  });

  it("rides the wheee while LT holds at 0.3 or more, cut at its release", () => {
    expect(voiceEvents([[0, 0, 0], [1, 0, 0.3], [1.5, 0, 1], [4, 0, 0.29]], 10)).toEqual([
      { tag: "wheee", variant: 0, start: 1, end: 4 },
    ]);
  });

  it("drops a quack during a wheee, and plays one pulled as the wheee is released", () => {
    expect(voiceEvents([[0, 0, 1], [1, 1, 1], [2, 0, 1], [3, 1, 0]], 10)).toEqual([
      { tag: "wheee", variant: 0, start: 0, end: 3 },
      { tag: "chirp", variant: 0, start: 3, end: 10 },
    ]);
  });

  it("decides the wheee before the quack when both are pulled at once", () => {
    expect(voiceEvents([[0, 0, 0], [1, 1, 1]], 5)).toEqual([{ tag: "wheee", variant: 0, start: 1, end: 5 }]);
  });

  it("cuts everything at the end of the performance and plays nothing past it", () => {
    expect(voiceEvents([[0, 0, 1], [6, 1, 0]], 5)).toEqual([{ tag: "wheee", variant: 0, start: 0, end: 5 }]);
  });

  it("goes through the robot's variants in turn: 12 quacks, then the first again", () => {
    const track = [];
    for (let i = 0; i < 13; i++) track.push([2 * i, 1, 0], [2 * i + 1, 0, 0]);
    expect(voiceEvents(track, 100).map((sound) => sound.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
  });

  it("makes no sound without a track", () => {
    expect(voiceEvents(null, 20)).toEqual([]);
  });
});

describe("mouthTrack", () => {
  it("opens to the harder-pulled trigger like a servo, and holds the start through a lead", () => {
    const open = mouthTrack([[0, 0.5, 0], [1, 0, 1], [2, 0, 0]], 200, 25);
    expect(open[0]).toBeCloseTo(0.5);
    expect(open[24]).toBeCloseTo(0.5); // the lead holds t = 0
    expect(open[75]).toBeLessThan(0.7); // eased at the change, not snapped
    expect(open[90]).toBeGreaterThan(0.99); // and there 0.3 s later
    expect(open[199]).toBeLessThan(0.01);
  });

  it("leaves the beak alone without a track", () => {
    expect(mouthTrack(null, 10)).toBeNull();
  });
});

describe("callSamples", () => {
  const calls = {
    chirp: (seed, variant) => new Float32Array(4800).fill(variant + 1),
    wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000).fill(segment ? 2 : 1),
  };

  it("plays a quack whole unless the next sound cuts it, and fades the cut", () => {
    expect(callSamples(calls, { tag: "chirp", variant: 2, start: 1, end: 5 })).toEqual(new Float32Array(4800).fill(3));
    const cut = callSamples(calls, { tag: "chirp", variant: 2, start: 1, end: 1.05 });
    expect(cut).toHaveLength(2400);
    expect(cut[0]).toBe(3);
    expect(cut[2399]).toBe(0);
  });

  it("rides the wheee's start, then its loop over and over, to the release", () => {
    const ride = callSamples(calls, { tag: "wheee", variant: 0, start: 0, end: 1 });
    expect(ride).toHaveLength(48000);
    expect(ride[23999]).toBe(1);
    expect(ride[24000]).toBe(2);
    expect(ride[24000 + 2 * 9600]).toBe(2);
    expect(ride[47999]).toBe(0);
  });

  it("sings in the stage duck's voice", () => {
    const asked = [];
    callSamples({ chirp: (seed) => (asked.push(seed), new Float32Array(1)) }, { tag: "chirp", variant: 0, start: 0, end: 1 });
    expect(asked).toEqual([DUCK_SEED]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/duck-voice.test.js`
Expected: FAIL, the module `./duck-voice.js` does not exist.

- [ ] **Step 3: Implement**

`app/src/duck-voice.js`:

```js
// The real pad's two triggers on the stage: what the duck's beak and voice do when a performance
// pulls RT or LT (arena/timeline.py reads them; a run, a board row, a ballot lane and a workshop
// evaluation carry them as a track of [t, rt, lt] at each change). The rules are microduck's own,
// padd's and robotd's at e597877: the beak opens to the harder-pulled trigger; RT quacks as it
// crosses PULL on the way up; LT rides the wheee while at or over PULL and its release cuts it; one
// sound at a time, a new quack cutting the last and a quack during a wheee dropped. Pure: the
// viewer and the clip hear the same sounds from it.

import { CTRL_DT } from "./replay.js";

/** The voice every performer sings in: a seed of the robot's `sounds` crate, picked by ear. */
export const DUCK_SEED = 28;
/** Where a trigger counts as pulled: padd's SOUND_THRESHOLD. */
export const PULL = 0.3;
/** The beak's travel, closed to wide open: duck-control's −5° to +30°. */
export const MOUTH_TRAVEL = (35 * Math.PI) / 180;
/** How fast the beak follows its trigger: a servo's ease, not a snap. */
const MOUTH_TAU_S = 0.06;
const RATE = 48000;
/** A cut sound fades out over this, so it stops without a click. */
const FADE_S = 0.005;
/** The variants of each call in the robot's bank (sounds::variant_count). */
const VARIANTS = { chirp: 12, wheee: 6 };

/** The change a track holds at `t`: its last at or before it. */
function pulledAt(track, t) {
  let held = track[0];
  for (const point of track) {
    if (point[0] > t + 1e-9) break;
    held = point;
  }
  return held;
}

/**
 * The beak's opening, 0 closed to 1 wide open, at each 50 Hz frame of a lane whose trace starts
 * `lead` frames before the performance (a clip's settle, which holds the opening at t = 0). Null
 * without a track, so the lane keeps its beak as the rig made it.
 */
export function mouthTrack(track, frames, lead = 0) {
  if (!track) return null;
  const out = new Float32Array(frames);
  const follow = 1 - Math.exp(-CTRL_DT / MOUTH_TAU_S);
  let open = Math.max(...pulledAt(track, 0).slice(1));
  for (let f = 0; f < frames; f++) {
    const [, rt, lt] = pulledAt(track, Math.max(0, f - lead) * CTRL_DT);
    open += (Math.max(rt, lt) - open) * follow;
    out[f] = open;
  }
  return out;
}

/**
 * Every sound a track makes before `duration` seconds, in order: { tag, variant, start, end }, `end`
 * being where it is cut — the next sound, LT's release, the end of the performance. A quack's own
 * recording may end sooner. The k-th quack plays variant k mod 12 and the k-th wheee k mod 6, so a
 * performance always sounds the same.
 */
export function voiceEvents(track, duration) {
  if (!track) return [];
  const sounds = [];
  const count = { chirp: 0, wheee: 0 };
  const begin = (tag, start) => {
    const last = sounds.at(-1);
    if (last && last.end > start) last.end = start;
    sounds.push({ tag, variant: count[tag]++ % VARIANTS[tag], start, end: duration });
  };
  let rt = 0;
  let riding = false;
  for (const [t, pulledRt, pulledLt] of track) {
    if (t >= duration) break;
    // robotd's order: the wheee first, then the one-shots, which see the ride this instant started.
    if (pulledLt >= PULL && !riding) begin("wheee", t);
    if (pulledLt < PULL && riding) sounds.at(-1).end = t;
    riding = pulledLt >= PULL;
    if (pulledRt >= PULL && rt < PULL && !riding) begin("chirp", t);
    rt = pulledRt;
  }
  return sounds;
}

/**
 * The samples a sound plays, from the robot's synth (`calls`, live/voice.js loadCalls): the quack as
 * recorded, the wheee's start then its loop over and over; cut at its `end`, with a short fade.
 */
export function callSamples(calls, { tag, variant, start, end }, seed = DUCK_SEED) {
  const room = Math.max(0, Math.round((end - start) * RATE));
  let whole = tag === "chirp" ? calls.chirp(seed, variant) : calls.wheee(seed, variant, 0);
  if (tag === "chirp" && whole.length <= room) return whole;
  if (tag === "wheee") {
    const ride = calls.wheee(seed, variant, 1);
    const grown = new Float32Array(Math.max(room, whole.length));
    grown.set(whole);
    for (let at = whole.length; at < room; at += ride.length) grown.set(ride.subarray(0, room - at), at);
    whole = grown;
  }
  const cut = whole.slice(0, room);
  const fade = Math.min(room, Math.round(FADE_S * RATE));
  for (let i = 0; i < fade; i++) cut[room - 1 - i] *= i / fade;
  return cut;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npx vitest run src/duck-voice.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/duck-voice.js app/src/duck-voice.test.js
/usr/bin/git commit -m "The pad's rules on the stage: the beak opens to the harder-pulled trigger, RT quacks, LT wheees"
```

---

### Task 6: The jaw pivot is the rig's, shared by the booth and the stage

**Files:**
- Modify: `app/src/rig.js`, `app/src/live/booth.js`
- Test: `app/src/rig.test.js`

**Interfaces:**
- Produces: `jawPivot(rig) -> Group`, exported from `rig.js`. Its `rotation.y` opens the lower beak, and positive values open it.

- [ ] **Step 1: Write the failing test**

`app/src/rig.test.js`: add `jawPivot` to the import from `./rig.js`. Inside `describe("attachMeshes against the real GLB", …)`, add:

```js
  it("hangs the lower beak on a pivot that opens it and leaves it in place at rest", async () => {
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, await loadedScene());
    const centre = () => {
      rig.root.updateMatrixWorld(true);
      return new Box3().setFromObject(rig.bodies.get("jaw_soft")).getCenter(new Vector3());
    };
    const rest = centre();
    const pivot = jawPivot(rig);
    expect(pivot.children.length).toBeGreaterThan(0);
    expect(centre().distanceTo(rest)).toBeLessThan(1e-6);
    pivot.rotation.y = 0.6;
    expect(centre().distanceTo(rest)).toBeGreaterThan(0.001);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npx vitest run src/rig.test.js`
Expected: FAIL, `jawPivot` is not exported.

- [ ] **Step 3: Implement**

`app/src/rig.js`:
- In the header comment, change `Deliberately left out: the jaw pivot, colour specs, comic-ink` / `outlines, and the STL fallback path` to `Deliberately left out: colour specs, comic-ink outlines, and the STL fallback path`. Keep the rest of the sentence.
- Make sure `Group` is in the three.js import (it is).
- Add after `setJoint`:

```js
// The lower beak, hung on a pivot in the jaw body's frame: what the booth's talkers and the
// stage's performer open.
const JAW_MESHES = new Set(["jaw.stl", "jaw_soft.stl"]);
const JAW_PIVOT = [-0.008, 0, -0.025];

/** Hang the lower beak on a pivot and return it: a positive `rotation.y` opens the beak. */
export function jawPivot(rig) {
  const body = rig.bodies.get("jaw_soft");
  const pivot = new Group();
  pivot.name = "jaw pivot";
  pivot.position.set(...JAW_PIVOT);
  for (const mesh of body.children.filter((child) => JAW_MESHES.has(child.name))) {
    mesh.position.sub(pivot.position);
    pivot.add(mesh);
  }
  body.add(pivot);
  return pivot;
}
```

`app/src/live/booth.js`: delete its `JAW_MESHES`, `JAW_PIVOT` and `function jawPivot`, together with the comment line above them (`// The lower beak, hung on a pivot in the jaw body's frame.`). Keep `JAW_OPEN`. Import `jawPivot` from `../rig.js`, beside the names booth.js already imports from there. Remove `Group` from booth.js's three.js import only if nothing else in the file still uses it (`grep -n "Group" app/src/live/booth.js`).

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npx vitest run src/rig.test.js src/live`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/rig.js app/src/rig.test.js app/src/live/booth.js
/usr/bin/git commit -m "The jaw pivot moves into the rig: the booth's talkers and the stage's performer open the same beak"
```

---

### Task 7: The viewer opens the beak and plays the voice on the replay's clock

**Files:**
- Create: `app/src/stage-voice.js`
- Test: `app/src/stage-voice.test.js`
- Modify: `app/src/viewer.js`

**Interfaces:**
- Consumes:
  - `mouthTrack`, `voiceEvents`, `callSamples`, `MOUTH_TRAVEL` (Task 5);
  - `jawPivot` (Task 6);
  - `loadCalls` (Task 4);
  - `isMuted` from `./sound.js`.
- Produces:
  - `createStageVoice(loadCalls, { makeContext, muted } = {}) -> { set(sounds), follow(seconds | null), dispose() }`;
  - a viewer lane entry may carry `triggers` (a track) and `lead` (frames of settle before the performance, default 0).

- [ ] **Step 1: Write the failing tests**

`app/src/stage-voice.test.js`:

```js
import { describe, expect, it } from "vitest";
import { createStageVoice } from "./stage-voice.js";

const calls = {
  chirp: () => new Float32Array(4800), // 0.1 s
  wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000),
};

function fakeContext(log) {
  return {
    state: "running",
    destination: {},
    resume: async () => log.push(["resume"]),
    close: async () => {},
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer: (channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource() {
      const node = {
        buffer: null,
        connect() {},
        start: (when, offset) => log.push(["start", node.buffer.length, offset]),
        stop: () => log.push(["stop"]),
      };
      return node;
    },
  };
}

async function voiceWith(sounds, { muted = () => false } = {}) {
  const log = [];
  const context = fakeContext(log);
  const voice = createStageVoice(async () => calls, { makeContext: () => context, muted });
  voice.set(sounds);
  await new Promise((done) => setTimeout(done));
  return { voice, log, context };
}

describe("createStageVoice", () => {
  it("starts a quack as the clock crosses it, once, and lets it end", async () => {
    const { voice, log } = await voiceWith([{ tag: "chirp", variant: 0, start: 1, end: 5 }]);
    voice.follow(0.98);
    voice.follow(1.0);
    voice.follow(1.02);
    voice.follow(1.2);
    expect(log.map(([what, length]) => [what, length])).toEqual([["start", 4800], ["stop"]]);
    expect(log[0][2]).toBeCloseTo(0);
  });

  it("resumes a wheee from where a jump lands inside it", async () => {
    const { voice, log } = await voiceWith([{ tag: "wheee", variant: 0, start: 1, end: 3 }]);
    voice.follow(0);
    voice.follow(2);
    expect(log).toEqual([["start", 96000, 1]]);
  });

  it("starts again from the top when the replay loops", async () => {
    const { voice, log } = await voiceWith([{ tag: "wheee", variant: 0, start: 0, end: 2 }]);
    voice.follow(0.5);
    voice.follow(0.52);
    voice.follow(0.02);
    expect(log.filter(([what]) => what === "start").map(([, , offset]) => offset)).toEqual([0.5, expect.closeTo(0.02)]);
  });

  it("stays silent when the Arena is muted, and stops when the replay pauses", async () => {
    const muted = await voiceWith([{ tag: "wheee", variant: 0, start: 0, end: 2 }], { muted: () => true });
    muted.voice.follow(0.5);
    expect(muted.log).toEqual([]);
    const { voice, log } = await voiceWith([{ tag: "wheee", variant: 0, start: 0, end: 2 }]);
    voice.follow(0.5);
    voice.follow(null);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
  });

  it("asks a suspended context to resume and plays once it runs", async () => {
    const { voice, log, context } = await voiceWith([{ tag: "chirp", variant: 0, start: 0, end: 1 }]);
    context.state = "suspended";
    voice.follow(0.02);
    expect(log).toEqual([["resume"]]);
    context.state = "running";
    voice.follow(0.04);
    expect(log.at(-1)[0]).toBe("start");
  });

  it("forgets the sounds of lanes that have left the stage", async () => {
    const log = [];
    let release;
    const slow = new Promise((done) => { release = done; });
    const voice = createStageVoice(() => slow, { makeContext: () => fakeContext(log), muted: () => false });
    voice.set([{ tag: "chirp", variant: 0, start: 0, end: 1 }]);
    voice.set([]);
    release(calls);
    await new Promise((done) => setTimeout(done));
    voice.follow(0.02);
    expect(log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/stage-voice.test.js`
Expected: FAIL, the module `./stage-voice.js` does not exist.

- [ ] **Step 3: Implement `stage-voice.js`**

```js
// The performer's voice on a live stage: the sounds duck-voice.js lists, played on the replay's own
// clock, one at a time as on the robot. A jump — the loop coming round, a scrub, new lanes — stops
// what plays and starts what the new time is inside, from where it is: a wheee resumes mid-ride.
// Nothing waits on a sound: no Web Audio, a context the browser keeps suspended or a muted Arena
// leave the replay playing in silence.

import { callSamples } from "./duck-voice.js";
import { isMuted } from "./sound.js";

const RATE = 48000;
/** A step longer than this between two frames is a jump, not playback. */
const JUMP_S = 0.25;
/** The voice under the replay, as the vote's cues sit (sound.js: 0.4–0.6). */
const GAIN = 0.6;

export function createStageVoice(loadCalls, { makeContext = () => new AudioContext(), muted = isMuted } = {}) {
  let loaded = null;
  let context = null;
  let output = null;
  let clips = [];
  let version = 0;
  let playing = -1;
  let source = null;
  let last = 0;

  function stop() {
    if (source) {
      try {
        source.stop();
      } catch {
        // Already ended: nothing to stop.
      }
    }
    source = null;
    playing = -1;
  }

  return {
    /** The sounds of the lane now on the stage (duck-voice.js voiceEvents); [] for none. */
    set(sounds) {
      stop();
      clips = [];
      const mine = ++version;
      if (!sounds.length) return;
      loaded ??= loadCalls();
      loaded.then((calls) => {
        if (mine !== version) return;
        if (!context) {
          context = makeContext();
          output = context.createGain();
          output.gain.value = GAIN;
          output.connect(context.destination);
        }
        clips = sounds.map((sound) => {
          const samples = callSamples(calls, sound);
          const buffer = context.createBuffer(1, samples.length, RATE);
          buffer.copyToChannel(samples, 0);
          return { start: sound.start, end: sound.start + samples.length / RATE, buffer };
        });
      }).catch(() => {});
    },

    /** Called every frame with the replay's time, or null while it does not play. */
    follow(seconds) {
      const jumped = seconds === null || seconds < last || seconds - last > JUMP_S;
      if (seconds !== null) last = seconds;
      const active = seconds === null || muted()
        ? -1
        : clips.findIndex((clip) => clip.start <= seconds && seconds < clip.end);
      if (active === playing && !jumped) return;
      stop();
      if (active < 0) return;
      if (context.state !== "running") {
        context.resume().catch(() => {});
        return;
      }
      try {
        source = context.createBufferSource();
        source.buffer = clips[active].buffer;
        source.connect(output);
        source.start(0, seconds - clips[active].start);
        playing = active;
      } catch {
        source = null;
      }
    },

    dispose() {
      stop();
      version++;
      context?.close().catch(() => {});
    },
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd app && npx vitest run src/stage-voice.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the viewer**

`app/src/viewer.js`:

1. Imports. Add `jawPivot` to the existing import from `./rig.js`, then add:

```js
import { MOUTH_TRAVEL, mouthTrack, voiceEvents } from "./duck-voice.js";
import { createStageVoice } from "./stage-voice.js";
import { loadCalls } from "./live/voice.js";
```

2. In `createViewer`, next to the other per-viewer state (beside `let player = new Player([]);`):

```js
  // The performer's voice, live: a clip renders its own soundtrack and stays silent here.
  const voice = manual ? null : createStageVoice(loadCalls);
```

3. In `setLanes`, inside `lanes = entries.map(...)`, right after `if (talent) placeStagePerformer(…); else placeLane(rig, z);`:

```js
      // The pad's triggers a performance pulls (duck-voice.js): the beak follows them.
      const mouth = talent ? mouthTrack(entry.triggers, frameCount(entry.trace), entry.lead) : null;
      const jaw = mouth ? jawPivot(rig) : null;
```

and change the map's return to `return { ...entry, rig, marker, plate, tier, gazeTarget: new Vector3(), mouth, jaw };`.

4. Still in `setLanes`, right after `player = new Player(…)`:

```js
    // What a lane's trace holds is what it performed: a cut-short performance falls silent with it.
    const performer = talent ? lanes[0] : null;
    voice?.set(performer ? voiceEvents(performer.triggers, frameCount(performer.trace) * CTRL_DT) : []);
```

5. In `draw`, inside `lanes.forEach((lane, i) => { … })`, after `applyFrame(lane.rig, frame);`:

```js
      if (lane.jaw) lane.jaw.rotation.y = lane.mouth[indices[i]] * MOUTH_TRAVEL;
```

6. In `tick`, after `player.advance(now);`:

```js
    voice?.follow(player.playing ? player.time : null);
```

7. In the returned `dispose()`, before `if (raf) cancelAnimationFrame(raf);`, add `voice?.dispose();`.

- [ ] **Step 6: Run the front-end suite**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add app/src/stage-voice.js app/src/stage-voice.test.js app/src/viewer.js
/usr/bin/git commit -m "The stage opens the performer's beak and plays its quacks and wheee on the replay's clock"
```

---

### Task 8: Every page hands its lane the triggers

**Files:**
- Modify: `app/src/run.js` (`race`), `app/src/race.js` (`race` and the rows' maps), `app/src/vote.js` (the ballot's entries), `app/src/workshop/job.js` (`play`), `app/src/clip/main.js` (`viewer.setLanes`)

**Interfaces:**
- Consumes:
  - board rows' `triggers` and the ballot's `triggers` (Task 3);
  - the workshop evaluation's `triggers` (Task 3);
  - the viewer's lane `triggers` / `lead` (Task 7).

- [ ] **Step 1: Pass them**

`app/src/run.js`, in `race`'s lane object, after `livery: byId.get(id).livery,`:

```js
      triggers: byId.get(id).triggers,
```

`app/src/race.js`:
- beside `const names = new Map(); …`, add `const pulls = new Map(); // run id -> the triggers its performance pulls`;
- beside `names.set(row.run_id, row.user);`, add `pulls.set(row.run_id, row.triggers);`;
- in `race`'s lane object, after `name: names.get(runId),`, add `triggers: pulls.get(runId),`.

`app/src/vote.js`, in the ballot's `entries` map, after `colour: LANE_COLORS[lane % LANE_COLORS.length],`:

```js
      triggers: ballot.triggers[lane],
```

`app/src/workshop/job.js`, in `play`, change the lane to:

```js
    viewer.setLanes([{ trace: body.trace, triggers: body.triggers, tier: "trial", livery: "classic", name: `checkpoint ${body.checkpoint}` }], event);
```

`app/src/clip/main.js`, in the `viewer.setLanes(lanes.map((lane, i) => ({ … })))` entry, after `name: \`@${lane.user}\`,`:

```js
        // The beak only: the clip's soundtrack plays the voice. Its lane starts with the settle.
        triggers: lane.triggers,
        lead: settle,
```

- [ ] **Step 2: Run the front-end suite**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures. A test that builds a ballot without `triggers` would now throw at `ballot.triggers[lane]`. Fix such a test by adding `triggers` to its ballot fixture, because the server always sends it. Do not add a fallback in the page.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add app/src/run.js app/src/race.js app/src/vote.js app/src/workshop/job.js app/src/clip/main.js
/usr/bin/git commit -m "The run page, the event page, the ballot, the workshop and the clip give the stage its triggers"
```

---

### Task 9: The clip's soundtrack carries the voice

**Files:**
- Modify: `app/src/clip/score.js` (`clipScore`), `app/src/clip/soundtrack.js` (`renderSoundtrack`), `app/src/clip/main.js` (the `clipScore` call)
- Test: `app/src/clip/score.test.js`; create `app/src/clip/soundtrack.test.js`

**Interfaces:**
- Consumes: `voiceEvents`, `callSamples` (Task 5); `loadCalls` (Task 4).
- Produces:
  - `clipScore({ run, plan, trace, triggers })`, where a voice cue is `{ at, call: { tag, variant, start, end }, gain }`;
  - `renderSoundtrack(score, seconds, { Context, load, calls = loadCalls })`.

- [ ] **Step 1: Write the failing tests**

`app/src/clip/score.test.js`, inside `describe("clipScore", …)`:

```js
  it("puts the duck's quack and wheee on the tape after the settle, cut where the performance ends", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const plan = clipPlan(250, 20, 26); // a 5 s performance after 26 frames of settle
    const triggers = [[0, 0, 0], [1, 1, 0], [1.2, 0, 0], [4, 0, 1]];
    const run = { run_id: "r1", seeds_finished: 1, event };
    const voice = clipScore({ run, plan, trace: new Float32Array(21 * 276), triggers }).cues.filter((cue) => cue.call);
    expect(voice.map((cue) => cue.call)).toEqual([
      { tag: "chirp", variant: 0, start: 1, end: 4 },
      { tag: "wheee", variant: 0, start: 4, end: 5 },
    ]);
    expect(voice[0].at).toBeCloseTo(3 + 0.52 + 1);
    expect(voice[1].at).toBeCloseTo(3 + 0.52 + 4);
  });

  it("a performance that pulls nothing adds no voice", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const score = clipScore({ run, plan: clipPlan(250, 20, 26), trace: new Float32Array(21 * 276), triggers: null });
    expect(score.cues.some((cue) => cue.call)).toBe(false);
  });
```

`app/src/clip/soundtrack.test.js`:

```js
import { describe, expect, it } from "vitest";
import { renderSoundtrack } from "./soundtrack.js";

function fakeContext(log) {
  return class {
    constructor(channels, length) {
      this.length = length;
      this.destination = {};
    }
    createDynamicsCompressor() {
      return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} };
    }
    createGain() {
      return { gain: {}, connect() {} };
    }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { data, copyToChannel: (samples) => data.set(samples) };
    }
    createBufferSource() {
      const node = { connect() {}, start: (at) => log.push({ at, buffer: node.buffer }) };
      return node;
    }
    async decodeAudioData() {
      return { decoded: true };
    }
    async startRendering() {
      const silent = new Float32Array(this.length);
      return { getChannelData: () => silent };
    }
  };
}

describe("renderSoundtrack", () => {
  it("renders a quack from the robot's synth at its instant, with no file to fetch", async () => {
    const log = [];
    const calls = { chirp: () => new Float32Array(480).fill(0.5), wheee: () => new Float32Array(1) };
    const score = { crowd: null, cues: [{ at: 0.5, call: { tag: "chirp", variant: 0, start: 0, end: 1 }, gain: 1 }] };
    const pcm = await renderSoundtrack(score, 1, {
      Context: fakeContext(log),
      load: () => { throw new Error("a voice cue fetched a file"); },
      calls: async () => calls,
    });
    expect(log).toHaveLength(1);
    expect(log[0].at).toBe(0.5);
    expect(log[0].buffer.data).toEqual(new Float32Array(480).fill(0.5));
    expect(pcm).toHaveLength(2 * 48000);
  });

  it("never loads the synth for a clip without a voice", async () => {
    await renderSoundtrack({ crowd: null, cues: [] }, 1, {
      Context: fakeContext([]),
      calls: () => { throw new Error("the synth was loaded"); },
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/clip/score.test.js src/clip/soundtrack.test.js`
Expected: FAIL. No cue has `call`, and `renderSoundtrack` tries to fetch the cue's `file`, which is undefined.

- [ ] **Step 3: Implement**

`app/src/clip/score.js`:
- import `import { voiceEvents } from "../duck-voice.js";`;
- add `voice: 1` to `GAINS` and extend its comment with `the duck's voice at the synth's own level, under the limiter`;
- change the signature to `export function clipScore({ run, plan, trace, triggers })`;
- in the body, before `return`:

```js
  // The performance starts on the tape after the settle; its length is the author's trace, cut short or not.
  const performed = start + plan.settle * CTRL_DT;
  const voice = voiceEvents(triggers, (plan.steps - plan.settle) * CTRL_DT)
    .map((call) => ({ at: performed + call.start, call, gain: GAINS.voice }));
```

- and the cues line becomes `cues: [...sounds.flatMap((name) => SOURCES[name]?.(context) ?? []), ...voice],`.

`app/src/clip/soundtrack.js`:
- import `import { callSamples } from "../duck-voice.js";` and `import { loadCalls } from "../live/voice.js";`;
- add under `interleave`:

```js
/** A sound of the robot's synth as a buffer: mono, which the context spreads to both sides. */
function synthBuffer(context, samples) {
  const buffer = context.createBuffer(1, samples.length, RATE);
  buffer.copyToChannel(samples, 0);
  return buffer;
}
```

- change the signature to `export async function renderSoundtrack(score, seconds, { Context = OfflineAudioContext, load = fetchWav, calls = loadCalls } = {})`;
- replace the `const cues = await Promise.all(…)` statement with:

```js
  // The synth only for a clip whose duck makes a sound: every race and silent performance skips it.
  const synth = score.cues.some((cue) => cue.call) ? await calls() : null;
  const cues = await Promise.all(
    score.cues.map(async (cue) => ({
      ...cue,
      buffer: cue.call
        ? synthBuffer(context, callSamples(synth, cue.call))
        : await context.decodeAudioData(await load(cue.file)),
    })),
  );
```

`app/src/clip/main.js`: change the score line to

```js
  const score = clipScore({ run, plan, trace: replays[0], triggers: lanes[0].triggers });
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npx vitest run src/clip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/clip/score.js app/src/clip/soundtrack.js app/src/clip/main.js app/src/clip/score.test.js app/src/clip/soundtrack.test.js
/usr/bin/git commit -m "A performance's clip quacks and wheees: the voice goes in the soundtrack from the robot's synth"
```

---

### Task 10: The guide says how to pull the triggers

**Files:**
- Modify: `docs/guides/challenges/got-a-talent.md`
- Modify (other repo, local commit only): `~/Projects/HuggingFace/microduck-challenges/README.md`

- [ ] **Step 1: The Arena's guide**

In `docs/guides/challenges/got-a-talent.md`, change the bullet `- The first keyframe is at 0, times go up, at most 1000 keyframes, every number within ±10.` to `- The first keyframe is at 0, times go up, at most 1000 keyframes, every command number within ±10.` Then, right after that bullet list and before the paragraph starting `The workshop edits it…`, insert:

````markdown
### Mouth and voice

A keyframe can also pull the real microduck pad's two triggers, `"triggers": [rt, lt]`, each from
0 (released) to 1 (pulled all the way):

- **RT** opens the beak and quacks once as it passes 0.3. To quack again, release it, then pull it again.
- **LT** opens the beak and goes "wheee" while it stays at 0.3 or more, and stops when it drops below.
- The beak opens as far as the harder-pulled trigger. Under 0.3 it opens without a sound.
- One sound at a time: a new quack cuts the last one, and a quack during a wheee is not heard.
- A keyframe that leaves `triggers` out releases both, like any group: repeat LT in each keyframe
  to keep the wheee going.

```json
{"t": 4.0, "twist": [1, 0, 0], "triggers": [1, 0]},
{"t": 4.3, "twist": [1, 0, 0]},
{"t": 6.0, "head": [0, 0.3, 0, 0], "triggers": [0, 1]},
{"t": 8.0}
```

Here the duck quacks at 4 s and wheees from 6 s to 8 s. The policy never reads the triggers: they
change what the audience sees and hears, not how the duck moves.
````

- [ ] **Step 2: The challenges README**

In `~/Projects/HuggingFace/microduck-challenges`, check first: `/usr/bin/git status --short` must be clean, on `main`. Then, in `README.md`, find the sentence that describes `got_a_talent/timeline.json` (`` `got_a_talent/timeline.json` is Pollen's: `twist[0]` is the sit flag …``). After the end of that sentence, add:

```markdown
A keyframe can also pull the pad's triggers, `"triggers": [rt, lt]`: RT quacks, LT wheees, both
open the beak (the Arena's [Got a Talent guide](https://pollen-robotics-microduck-arena.hf.space/#/e/got-a-talent/guide)).
```

Commit there (local only; it ships with the relock):

```bash
/usr/bin/git -C ~/Projects/HuggingFace/microduck-challenges add README.md
/usr/bin/git -C ~/Projects/HuggingFace/microduck-challenges commit -m "Got a Talent: a performance can pull the pad's triggers to quack and wheee"
```

- [ ] **Step 3: Check the guide still renders and its tests pass**

Run: `cd app && npx vitest run src/guides.test.js`
Expected: PASS.

- [ ] **Step 4: Commit (Arena)**

```bash
/usr/bin/git add docs/guides/challenges/got-a-talent.md
/usr/bin/git commit -m "The Got a Talent guide: how a performance pulls RT to quack and LT to wheee"
```

---

### Task 11: Seen and heard on this Mac

Nothing is committed in this task, and everything stays in the scratchpad. The aim is to observe the real thing before calling it done.

- [ ] **Step 1: A performance that quacks and wheees, scored into a scratch store**

Write `$SCRATCH/voice-check/timeline.json`:

```json
{"timeline_version": 1, "duration_s": 10.0, "keyframes": [
  {"t": 0.0},
  {"t": 1.0, "twist": [0.3, 0, 0], "triggers": [1, 0]},
  {"t": 1.3, "twist": [0.3, 0, 0]},
  {"t": 2.0, "twist": [0.3, 0, 0], "triggers": [1, 0]},
  {"t": 2.3, "twist": [0.3, 0, 0]},
  {"t": 4.0, "twist": [0, 0, 0.5], "triggers": [0, 1]},
  {"t": 7.0, "triggers": [0.2, 0]},
  {"t": 8.0, "triggers": [1, 0]},
  {"t": 8.3}
]}
```

From the worktree:

```bash
.venv/bin/arena score arena/assets/policies/BEST_alpha_walking.onnx --event got-a-talent \
  --timeline $SCRATCH/voice-check/timeline.json --store $SCRATCH/voice-check/store --user alice --name voice-check
```

Expected: `recorded <run_id>`. Note the run id.

- [ ] **Step 2: Serve it**

- API: `.venv/bin/arena serve --store $SCRATCH/voice-check/store --user alice --port 8001`. Run it with `run_in_background`, since it is a server and not a test.
- Front-end: write `$SCRATCH/voice-check/vite.config.js`. It spreads the worktree's `app/vite.config.js`, sets `root` to the worktree's `app`, `server.port` to 5180 and proxies `/api` to `http://127.0.0.1:8001`. Run `npx vite --config $SCRATCH/voice-check/vite.config.js` from the worktree's `app`, also in the background.
- Open `http://localhost:5180`, not `127.0.0.1`.

- [ ] **Step 3: The beak, on the clip page**

Use Puppeteer from `/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer`, with a 1920×1080 viewport and `deviceScaleFactor: 1`. Open `http://localhost:5180/clip.html?run=<run_id>&layout=landscape`. Wait for `window.clip.ready`, then for each of t = 3.5 s (beak closed) and t = 5.0 s (LT held, beak wide open):
- compute `i = clip.plan.intro + Math.round((clip.plan.settle + t / 0.02) / clip.plan.stride)`;
- call `clip.draw(i)`;
- take a screenshot.

Crop around the duck if it is small. Expected: the beak is visibly open at 5.0 s and closed at 3.5 s, and does not look detached at full travel. If it looks broken, reduce `MOUTH_TRAVEL`'s visual use only after asking the owner. Send both captures to the owner.

- [ ] **Step 4: The voice, in the clip's soundtrack**

On the same page, run `len = await clip.soundtrack()`. Read it back in 1 MiB slices with `clip.chunk(offset, size)` (base64) and write `$SCRATCH/voice-check/soundtrack.f32`. Then:

```bash
ffmpeg -y -loglevel error -f f32le -ar 48000 -ac 2 -i $SCRATCH/voice-check/soundtrack.f32 $SCRATCH/voice-check/soundtrack.wav
```

Expected: you hear quacks near 3 + settle + 1 s and + 2 s, a wheee from + 4 s to + 7 s, and a quack at + 8 s. The 0.2 pull at 7 s is silent. Send the WAV to the owner.

- [ ] **Step 5: The voice, live on the run page**

Launch Puppeteer with `--autoplay-policy=no-user-gesture-required`. Before any page script runs (`evaluateOnNewDocument`), wrap `AudioBufferSourceNode.prototype.start` so that it records `[performance.now(), buffer.length, offset]` in `window.__starts`. Open `http://localhost:5180/#/r/<run_id>` and wait 12 s.

Expected:
- `__starts` holds three quacks (buffers under 0.6 s) and one wheee (a buffer of about 3 s);
- they arrive about 1 s apart from each other as in the timeline, then again on the loop;
- there are no console errors.

- [ ] **Step 6: Stop the servers, and report to the owner**

Kill both background servers. Report the captures, the WAV and the start log, and ask the owner to listen.

---

### Task 12: Version 0.4.4

**Files:**
- Modify: `pyproject.toml` (`version`), `uv.lock` (the `microduck-arena` package's version line)

- [ ] **Step 1: Full suite**

Run the three Python calls and `cd app && npm test` from Global Constraints.
Expected: every pass count is at least the starting count plus the new tests; the 4 known brightness failures are the only failures.

- [ ] **Step 2: Bump**

In `pyproject.toml`, change `version = "0.4.3"` to `version = "0.4.4"`. In `uv.lock`, change the `version = "0.4.3"` line under `name = "microduck-arena"` to `"0.4.4"`. Check that nothing else moved with `/usr/bin/git diff --stat`, which should show 2 files and 2 lines.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add pyproject.toml uv.lock
/usr/bin/git commit -m "Version 0.4.4: a Got a Talent performance opens the beak, quacks and wheees"
```

Stop here. The release steps (push, wheel, challenges relock) each wait for the owner's yes. They are listed under "Not in this plan".
