# A troupe on the Got a Talent stage — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Got a Talent entry puts up to 4 ducks on the stage (16 later), each with its own policy (the entry's own or any public one on the Hub), rig, place, keyframes, voice and song, all in one shared physics. The workshop composes, places, plays and publishes the troupe in one click.

**Architecture:**
- **Format:** `timeline.json` version 2 lists `ducks`. A v1 file is a troupe of one. `arena/timeline.py` parses both into a `Troupe`.
- **Simulation:** `arena/course.py` compiles one MuJoCo model with every duck. Duck 0 is built exactly as today; the others are attached with a `duck{k}/` prefix. `arena/runner.py` steps every duck's policy and servos on the shared physics, and records a `(ducks, frames, 21)` trace.
- **Server:** `hub_fetch` reads every referenced policy at its commit. `arena/cast.py` turns a troupe plus its policies into the runner's performers and the record's `cast`. `RunRecord.cast` replaces `RunRecord.sound` (an old record reads as a cast of one). Traces travel duck-major with `X-Duck-Count`.
- **Site:** a stage lane expands into one rig per duck, placed where its trace says (old runs keep their centring). The camera frames the troupe. Each duck has its own beak and voice, mixed through a limiter. Two or more singers sing through the robot's `Stream::choral`.
- **Workshop:** `local:` references name unpublished checkpoints. A top-view plan places the ducks. "Save and play" plays the troupe. Publishing sends each local policy without entering it, then the star with the resolved timeline and `--enter`.

**Tech Stack:** Python 3.12, MuJoCo 3.10 (`MjSpec`), FastAPI, pytest; vanilla JS + three.js, vitest/jsdom, Web Audio; Rust → wasm32-unknown-unknown.

**Spec:** `docs/superpowers/specs/2026-10-13-talent-troupe-design.md` (approved by the owner 2026-10-13). It builds on `docs/superpowers/specs/2026-10-13-talent-song-and-voice-design.md`, merged in main at 3c9ddce.

## Global Constraints

- **Commits and GitHub:** English only. Never signed: no `Co-Authored-By`, no "Generated with Claude Code". This overrides any default attribution.
- **Nothing leaves this Mac without the owner's yes.** No push, no wheel upload, no Hub write, no Space dataset write, no HF Job.
- **Worktree:** `~/Projects/HuggingFace/microduck-arena/.claude/worktrees/talent-troupe` on branch `talent-troupe`, made from local `main` (3c9ddce or later, which holds the spec and this plan). Set it up once, from the main checkout:
  - `/usr/bin/git worktree add .claude/worktrees/talent-troupe -b talent-troupe main`
  - `cd .claude/worktrees/talent-troupe && uv sync --no-config --frozen --extra dev && (cd app && npm ci)`
- **git:** always `/usr/bin/git`. The RTK hook's `git` rewrite is refused inside a worktree.
- **uv:** always `uv run --no-config --frozen …`. Without `--no-config`, a global `exclude-newer` makes uv re-resolve and rewrite `uv.lock`. If `uv.lock` changes by accident, run `/usr/bin/git checkout -- uv.lock`.
- **Shell inside the worktree:** the hook refuses globs and shell variables inside git, uv and npm commands. Write paths out in full.
- **Tests always run in the FOREGROUND, as one Bash call with `timeout: 600000`.** Never `run_in_background`, never a monitor, never end a turn "waiting for" a run. The Python suite runs as two calls; record the pass counts of each at the start:
  1. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
  2. `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests --ignore=tests/workshop` (about 6.5 min)
- **Front-end:** `cd app && npm test`. The only accepted failures are the 4 known ones in `src/brightness.test.js`. Single file: `cd app && npx vitest run src/<file>.test.js`.
- **Got a Talent only.** Troupes, `start` and placement exist only for an event whose `course.kind` is `"stage"`. These stay untouched:
  - what `run_once`, the sweep and the lanes do. Task 4 runs `run_once` through the troupe's machinery with one duck, so that no second copy of the start and the control step exists; the golden run and the race tests prove it bit-identical;
  - the golden run (`arena/golden.py`) and `RUNNER_VERSION` (stays 4);
  - the 13 command numbers and the 61-D observation;
  - the per-event rig check for races.

  A race still refuses a timeline.
- **Compatibility:**
  - Every `timeline.json` v1 (with or without `voice`, `song`, `triggers`) loads as one `"self"` duck at `{"x": 0, "y": 0, "yaw": 0}`.
  - A troupe of one plays bit-identically to today's `run_stage` (Task 4 proves it before the old code goes).
  - A stored record without `cast` reads as a cast of one with `start: null`, and the site draws it centred, as today.
  - A stored 2-D trace decodes as one duck.
  - A workshop evaluation stored by 0.4.x (a 2-D trace, one `stage` summary, no `cast`) is measured again rather than read (`"format": 2`, Task 13).
- **Order:** the tasks run in number order, with one caution. From Task 6, the payloads carry `cast` and no `sound`, so the pages have no beak and no voice until Tasks 9–10. Task 10 hands the stage `ducks` that the viewer only draws from Task 11, so run 10 and 11 back to back: tests stay green in between (the viewer is mocked), but a browser does not. Nothing ships before Task 18.
- **Numbers from the spec:**
  - `max_ducks = 4` and `size_m = [2.6, 3.8]` (depth along `x`, width along `y`) in `arena/events/got-a-talent.toml`.
  - `EDGE_MARGIN_M = 0.3` and `MIN_SPACING_M = 0.3` in `arena/timeline.py`.
  - A reference is `owner/repo@<40 lowercase hex>`.
  - `ducks[0]` is `"self"`.
  - `yaw` is in degrees, within ±180.
  - The stage's frame is the simulation's world frame: `x` towards the audience, `y` to the audience's right, `yaw` 0 faces the audience.
- **Streams:** duck 0 keeps today's: perturbation `seed_rng(event, seed)` = `[crc32(event), seed]`, servo delays `[crc32(event), seed, 1]`. Duck `k ≥ 1` uses `[crc32(event), seed, 2, k]` and `[crc32(event), seed, 3, k]`.
- **Votes and points** go to the entrant only. Borrowed policies are credited by name on the run page and in the clip's caption, never on the anonymous ballot.
- **Voice:**
  - One sound at a time per duck (the song spec's rules, per duck).
  - The ducks are mixed through a `DynamicsCompressorNode` limiter.
  - When two or more ducks have a `song`, every song renders through `Stream::choral(&tuned, variant)` with `variant` = the duck's index. A lone singer keeps `Stream::new(&tuned, "song", 0)`.
- **Livery** (left to the plan by the spec, decided here): a `"self"` duck wears the entry's livery; a borrowed duck wears `classic`.
- **The star's Hub README** is not changed. `microduck_rl`'s `publish` is not modified.
- **Wording:** English everywhere on the site, in the docs and in comments. A stage run is a "performance", never a "show".
- **Scratchpad:** `SCRATCH=/private/tmp/claude-501/-Users-nicolasrabault-Projects-HuggingFace-microduck-arena/875159f6-2b96-4465-8d2d-42e834d01978/scratchpad`.

## Shared interfaces

Every task builds against these names. A task's own **Interfaces** block repeats the part it uses.

**Python**

```python
# arena/manifest.py — Task 1
@dataclass(frozen=True)
class Stage:
    size_m: tuple[float, float]   # (depth along x, width along y)
    max_ducks: int
    kind: str = "stage"
# event_summary(manifest) for a stage adds: "size_m": [2.6, 3.8], "max_ducks": 4
#   (Task 14 adds "edge_margin_m": 0.3, "min_spacing_m": 0.3, from arena/timeline.py)

# arena/timeline.py — Task 2
TIMELINE_VERSIONS = (1, 2)
SELF = "self"
LOCAL = "local:"
EDGE_MARGIN_M = 0.3
MIN_SPACING_M = 0.3

@dataclass(frozen=True)
class Start:
    x: float = 0.0
    y: float = 0.0
    yaw_deg: float = 0.0
    def to_dict(self) -> dict          # {"x": …, "y": …, "yaw": …}

@dataclass(frozen=True)
class Duck:
    policy: str                        # SELF, "owner/repo@<40 hex>", or (workshop only) "local:<folder>/<run>@<n>"
    start: Start
    timeline: Timeline                 # this duck's keyframes, triggers, voice, song; duration_s is the troupe's

@dataclass(frozen=True)
class Troupe:
    duration_s: float
    ducks: tuple[Duck, ...]
    def references(self) -> tuple[str, ...]    # distinct non-SELF policies, in first-appearance order

def load_troupe(path: Path, event: Manifest, *, allow_local: bool = False) -> Troupe
def solo(timeline: Timeline) -> Troupe                  # one SELF duck at Start()
def split_reference(policy: str) -> tuple[str, str]     # "owner/repo@sha" -> ("owner/repo", "sha")
def split_local(policy: str) -> tuple[str, str, int]    # "local:folder/run@n" -> ("folder", "run", n)

# arena/trace.py — Task 3
def as_ducks(frames: np.ndarray) -> np.ndarray           # (frames, W) -> (1, frames, W); (ducks, frames, W) unchanged
def encode(trace: np.ndarray, settle: np.ndarray | None = None) -> bytes   # 2-D (a race) or 3-D (a stage)
def decode(blob: bytes) -> np.ndarray          # always (ducks, frames, TRACE_WIDTH); a 2-D blob is one duck
def decode_settle(blob: bytes) -> np.ndarray   # (ducks, steps, TRACE_WIDTH); (1, 0, TRACE_WIDTH) when none
# HTTP traces (/runs/{id}/trace, /runs/{id}/settle, /ballots/{t}/lanes/{i}/trace): little-endian float32,
# duck-major; headers X-Frame-Count (frames per duck) and X-Duck-Count. One helper writes them all:
# arena/web/routes_read.py frames_response(ducks).

# arena/stage.py — Task 3
def summaries(trace: np.ndarray, termination) -> list[dict]   # summary() per duck of a (ducks, frames, W) trace

# arena/course.py — Task 4
def duck_prefix(k: int) -> str                                       # "" for 0, "duck{k}/" otherwise
def compile_stage(manifest: Manifest, layout: Sequence[tuple[str, Start]]) -> mujoco.MjModel   # (rig, start) per duck

# arena/runner.py — Task 4
@dataclass(frozen=True)
class Performer:
    policy: object                     # anything with .act(obs) -> action (arena.policy.Policy)
    rig: str
    start: Start
    timeline: Timeline
def run_stage(manifest: Manifest, cast: Sequence[Performer], seed: int) -> RunOutcome
# A stage's RunOutcome.trace is (ducks, frames, TRACE_WIDTH); .settle is (ducks, settle steps + 1, TRACE_WIDTH).

# arena/evaluate.py — final from Task 5 on
def evaluate(manifest: Manifest, policy, cast: tuple[Performer, ...] | None = None) -> Evaluation
# A stage with cast None plays one Performer(policy, manifest.rig, Start(), constant_timeline(manifest.command, manifest.time_limit_s)).

# arena/hub_fetch.py — Task 5
@dataclass(frozen=True)
class FetchedPolicy:
    ...                                # today's fields, with `timeline` replaced by:
    troupe: Troupe | None = None
    timeline_sha256: str | None = None
    rig: str | None = None             # rig_of(manifest), or None without a manifest (the event's rig applies)
    borrowed: dict[str, "FetchedPolicy"] = field(default_factory=dict)   # by reference, a stage's v2 only
def fetch_references(troupe: Troupe, event, download=..., info=...) -> dict[str, FetchedPolicy]
    # every Hub reference once, at its commit; a `local:` duck is skipped (the workshop plays it)
def hub_name(fetched: FetchedPolicy) -> str              # routes_submit's _hub_name, moved here
def first_duck(troupe: Troupe, reference: str) -> str    # "ducks[k]: owner/repo", the first duck playing it

# arena/cast.py — Task 5
@dataclass(frozen=True)
class Cast:
    performers: tuple[Performer, ...]
    record: tuple[dict, ...]           # RunRecord.cast, in duck order
def cast_of(event: Manifest, troupe: Troupe | None, star: Policy, rig: str | None,
            borrowed: Mapping[str, tuple[FetchedPolicy, Policy]]) -> Cast
    # `rig` is the star's (fetched.rig, or None for the event's); troupe None = the star alone on the event's command
def load_borrowed(troupe: Troupe | None, references: Mapping[str, FetchedPolicy]) -> dict[str, tuple[FetchedPolicy, Policy]]
    # each reference loaded once; a PolicyError is re-raised as "ducks[k]: owner/repo: <reason>"
def duck_record(policy, rig: str, duck: Duck) -> dict    # {"policy", "rig", "start", "sound"}: one entry of RunRecord.cast
def borrowed_source(fetched: FetchedPolicy, policy: Policy) -> dict
    # {"repo_id", "filename", "revision", "url", "model_sha256", "user", "policy_name"}

# arena/store.py — Task 6
def lone_cast(sound: dict | None = None) -> tuple[dict, ...]
    # ({"policy": "self", "rig": None, "start": None, "sound": sound},): a race, or a run recorded before troupes
# RunRecord.cast: tuple[dict, ...] = field(default_factory=lone_cast), each {"policy": "self" | <borrowed_source dict>,
#   "rig": str | None, "start": {"x", "y", "yaw"} | None, "sound": dict | None}. RunRecord.sound is gone.
# from_dict without "cast": lone_cast(<old sound, or {"triggers": …}, or None>).
# Board rows, run detail and workshop evaluations carry "cast". The ballot carries "cast" per lane
# with every duck's "policy" reduced to "self" or "borrowed" (anonymous).
```

**Front-end**

```js
// app/src/replay.js — Task 10
export function splitDucks(values, ducks)            // Float32Array, count -> Float32Array[] (duck-major)
// app/src/api.js — Task 10
getTrace(runId) / getSettle(runId) / getBallotTrace(ballot, lane)  // -> Promise<Float32Array[]>, one per duck
// app/src/cast.js — Task 10 (new)
export function stageDucks(cast, traces, settles, { livery, eventRig, lead = 0 })
  // -> [{ trace, lead, sound, rig, livery, start, star }], in duck order; `start` null = draw centred;
  //    `settles` null = no lead-in (the workshop)
export function replayLane(event, cast, traces, lane)   // a stage lane { ...lane, ducks } or a race lane { ...lane, trace }
export function featured(cast)                          // the borrowed policies, each once, in duck order
// app/src/viewer.js — Task 11: stageLanes(entries); app/src/talent-stage.js — Task 11: placeStageDuck(rig, duck, centre)
// A stage lane entry handed to viewer.setLanes: { name, livery, ducks: [...] }. Race entries are unchanged.

// app/voice (wasm) — Task 8
// song(seed, pitch, brightness, buzz, vibrato, breath, seconds, choral: u32, variant: u32) -> usize
// app/src/live/voice.js — Task 8
//   calls.song(seed, voice, notes, seconds, { choral = false, variant = 0 } = {})
// app/src/duck-voice.js — Task 8
//   songSamples(calls, sound, duration, { choral = false, variant = 0 } = {})   // duration cuts a cut-short take
//   limiter(context)                  // Task 9: the one DynamicsCompressorNode every duck goes through
//   export function choirOf(ducks)    // true when two or more ducks have a song
// app/src/stage-voice.js — Task 9
//   voice.set(ducks, duration)        // ducks: [{ sound }] in duck order; [] = silent
```

**Workshop**

```python
# arena/workshop/troupe.py — Task 13 (new)
def local_policy(run, n: int) -> str                    # "local:<challenge folder>/<run name>@<n>"
def resolve_local(root, policy: str) -> tuple[Run, int, Challenge]
def candidates(root) -> list[dict]                      # [{"policy", "label", "rig"}] for "+ duck"
def performers_for(root, troupe, star_onnx, star_rig, event) -> tuple[Performer, ...]
def timeline_key(root, challenge) -> str | None         # moved from challenges.py: the text's sha256 plus each local duck's checkpoint stat
# GET /api/workshop/challenges/{event}/performers -> {"performers": candidates(root)}
# arena/workshop/publishing.py — Task 13: export(root, run, n) -> Path, exported(run, n), onnx_of(run, n) (moved from evaluations.py)
# arena/workshop/evaluations.py — Task 13: FORMAT = 2 on every stored body
# arena/workshop/publishing.py — Task 15
def publish_policy(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict   # {"repo", "revision"}, no --enter
```

```js
// app/src/workshop/placement.js — Task 14 (new)
export function placementPlan(event, { read, write, performers })   // -> { el, refresh }
  // read() -> the box's text; write(text) updates it; performers() -> /performers' list; refresh() after a text edit
```

## Review Focus

1. **A ballot of troupes:** voters see every duck's place, rig and voice, and never whose policies the borrowed ones are. A duck's `policy` is reduced to `"self"` or `"borrowed"`. Pinned in Task 6 (`test_a_ballot_carries_each_lanes_cast_and_never_whose_policies`).
2. **A duck exactly on the margin, or exactly 0.3 m from another:** the loader and the workshop's plan both take it, even though floats put 1.9 − 0.3 below 1.6. Pinned in Task 2 (`test_a_start_on_the_margin_or_exactly_the_spacing_apart_is_taken`) and Task 14 ("takes a duck on the margin, as the loader does").
3. **A borrowed repo that is gone, private, or not a microduck:**
   - the entry is refused with the first duck that plays it named, before the entry's own weights are downloaded;
   - a recovery skips that run and says why.

   Pinned in Task 5.
4. **A performance cut short by a MuJoCo reset:** every duck's trace stops at the same frame, and every duck falls silent there (no song past it, no call due after it). Pinned in Task 4 (the reset test) and Task 9 ("falls silent for every duck where a cut-short performance stops").
5. **A run recorded before troupes** (with `sound`, with the older `triggers`, or with neither): it reads as one duck, drawn centred on its own path, and sounds as it did, on the board, the run page, the ballot and in the clip. Pinned in Task 6 (`from_dict`), Task 10 ("keeps a run recorded before troupes as it was") and Task 11 ("centres a run recorded before troupes on its own path").

## Not in this plan (reported to the owner instead)

- The spec's "Out of scope": policies that see other ducks, a troupe without a policy of the author's own, positions in races, points for borrowed authors, a visual song editor, real robots performing a troupe.
- **Step 2, going to 16 ducks:** measure simulation time with contacts, a 16-duck clip on the HF Job, the ballot's frame rate, trace weight and the worst-case download, then change `max_ducks`.
- **The finishing session** (spec section 7): a local Got a Talent training whose performance is a troupe of 4 that sings and dances. Its first steps:
  - relock a local microduck-challenges onto the 0.5.0 code, so the workshop runs this branch;
  - run Task 16's `check.py` commit there for real.
- **Owner's yes needed, each one, after the finishing session:**
  1. merge `talent-troupe` into main, then push main (the Space deploys);
  2. the 0.5.0 wheel on pollen-robotics/microduck-arena-wheels, tag v0.5.0;
  3. microduck-challenges relocked onto 0.5.0 and pushed straight after, with its local commits (Task 16's two included).

---

### Task 1: The stage declares its size and how many ducks it takes

**Files:**
- Modify: `arena/manifest.py`, `arena/events/got-a-talent.toml`, `arena/web/routes_read.py`
- Test: `tests/test_manifest.py`, `tests/test_routes_read.py`

**Interfaces:**
- Produces:
  - `Stage(size_m: tuple[float, float], max_ducks: int, kind: str = "stage")` in `arena/manifest.py`. `size_m` is (depth along x, width along y), in metres.
  - A stage's `[course]` requires `size_m`, two positive numbers, and `max_ducks`, an integer ≥ 1. Either one missing or malformed is a `ManifestError` naming `[course]`.
  - Got a Talent: `size_m = [2.6, 3.8]`, `max_ducks = 4`.
  - `event_summary(manifest)` for a stage adds `"size_m": [2.6, 3.8]` and `"max_ducks": 4`; a lane has neither.

- [ ] **Step 1: Write the failing tests**

In `tests/test_manifest.py`, replace the `STAGE` constant and `test_a_stage_loads_with_no_lane_and_no_sweep` with:

```python
# A stage's sections, over GOOD: [course] names its kind, its floor and its cap, and there is no [sweep].
STAGE = {"course": '[course]\nkind="stage"\nsize_m=[2.0,3]\nmax_ducks=2\n', "sweep": ""}


def test_a_stage_loads_with_no_lane_and_no_sweep(tmp_path):
    m = load_manifest(write_manifest(tmp_path, **STAGE))
    assert m.course == Stage(size_m=(2.0, 3.0), max_ducks=2)
    assert m.course.kind == "stage"
    assert m.sweep is None


@pytest.mark.parametrize(
    "lines, complaint",
    [
        ("max_ducks=2\n", r"\[course\]: missing 'size_m'"),
        ("size_m=[2.0,3.0]\n", r"\[course\]: missing 'max_ducks'"),
        ("size_m=2.0\nmax_ducks=2\n", r"size_m must be two positive numbers, depth along x then width along y, got 2\.0"),
        ("size_m=[2.0]\nmax_ducks=2\n", r"size_m must be two positive numbers"),
        ("size_m=[2.0,3.0,1.0]\nmax_ducks=2\n", r"size_m must be two positive numbers"),
        ("size_m=[2.0,0.0]\nmax_ducks=2\n", r"size_m must be two positive numbers"),
        ("size_m=[-2.0,3.0]\nmax_ducks=2\n", r"size_m must be two positive numbers"),
        ('size_m=[2.0,"3"]\nmax_ducks=2\n', r"size_m must be two positive numbers"),
        ("size_m=[true,3.0]\nmax_ducks=2\n", r"size_m must be two positive numbers"),
        ("size_m=[2.0,3.0]\nmax_ducks=0\n", r"max_ducks must be a whole number of at least 1, got 0"),
        ("size_m=[2.0,3.0]\nmax_ducks=1.5\n", r"max_ducks must be a whole number of at least 1, got 1\.5"),
        ("size_m=[2.0,3.0]\nmax_ducks=true\n", r"max_ducks must be a whole number of at least 1, got True"),
    ],
)
def test_a_stages_floor_and_cap_are_checked(tmp_path, lines, complaint):
    course = '[course]\nkind="stage"\n' + lines
    with pytest.raises(ManifestError, match=complaint):
        load_manifest(write_manifest(tmp_path, course=course, sweep=""))
```

In `test_got_a_talent_is_a_stage_played_once_for_20_s`, replace `assert talent.course == Stage()` with:

```python
    assert talent.course == Stage(size_m=(2.6, 3.8), max_ducks=4)
```

In `tests/test_routes_read.py`, add before `test_a_board_row_says_how_its_duck_sounds_on_the_stage`:

```python
def test_a_stage_serves_its_floor_and_how_many_ducks_it_takes(client):
    """The server's placement rules, the workshop's plan and the drawn stage read these same numbers."""
    api, _ = client
    events = {e["id"]: e for e in api.get("/api/events").json()["events"]}
    assert (events["got-a-talent"]["size_m"], events["got-a-talent"]["max_ducks"]) == ([2.6, 3.8], 4)
    assert "size_m" not in events["sprint-2m"] and "max_ducks" not in events["sprint-2m"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_manifest.py tests/test_routes_read.py`

Expected: 17 FAIL.
- `Stage(size_m=…)` raises `TypeError: Stage.__init__() got an unexpected keyword argument 'size_m'`.
- The stage fixtures are refused with `[course]: unknown keys ['max_ducks', 'size_m']`. This includes `test_a_stage_refuses_a_sweep` and `test_a_stage_plays_one_seed`, which reuse `STAGE`.
- The route test fails with `KeyError: 'size_m'`.

- [ ] **Step 3: Implement**

`arena/manifest.py`, replace the `Stage` dataclass with:

```python
@dataclass(frozen=True)
class Stage:
    """An open floor: no walls, no slope, no line to cross. A stage event plays
    each entry's own command timeline (arena/timeline.py) instead of racing it,
    with a troupe of up to `max_ducks` ducks placed on its floor."""

    # Depth along x (towards the audience), then width along y, in metres: the
    # floor the pages draw, and the one the placement rules keep every duck on.
    size_m: tuple[float, float]
    max_ducks: int
    kind: str = "stage"
```

Add before `def _sweep(raw: dict, path: Path) -> Sweep:`:

```python
def _stage(raw: dict) -> Stage:
    size = _require(raw, "size_m", "[course]")
    # bool first: TOML's true is a Python int, and would otherwise read as 1.
    if not isinstance(size, list) or len(size) != 2 or not all(
        not isinstance(v, bool) and isinstance(v, (int, float)) and v > 0 for v in size
    ):
        raise ManifestError(
            f"[course]: size_m must be two positive numbers, depth along x then width along y, got {size!r}"
        )
    most = _require(raw, "max_ducks", "[course]")
    if isinstance(most, bool) or not isinstance(most, int) or most < 1:
        raise ManifestError(f"[course]: max_ducks must be a whole number of at least 1, got {most!r}")
    return Stage(size_m=(float(size[0]), float(size[1])), max_ducks=most)
```

In `load_manifest`'s stage branch, replace `_refuse_unknown(course_raw, {"kind"}, "[course]")` with:

```python
        _refuse_unknown(course_raw, {"kind", "size_m", "max_ducks"}, "[course]")
```

and `course, sweep = Stage(), None` with:

```python
        course, sweep = _stage(course_raw), None
```

`arena/events/got-a-talent.toml`, replace:

```toml
# plays it once, for at most time_limit_s. Voters judge the show.
[course]
kind = "stage"
```

with:

```toml
# plays it once, for at most time_limit_s. Voters judge the performance.
#
# The floor is size_m: 2.6 m deep along x (towards the audience) by 3.8 m wide
# along y, the stage the pages draw. One entry puts a troupe of up to max_ducks
# ducks on it: 4 for now, 16 once that cost is measured.
[course]
kind      = "stage"
size_m    = [2.6, 3.8]
max_ducks = 4
```

`arena/web/routes_read.py`, in `event_summary`, replace the end of the lane branch and the `return`:

```python
            "sweep_count": len(manifest.sweep.speeds()),
        }
    return summary
```

with:

```python
            "sweep_count": len(manifest.sweep.speeds()),
        }
    else:
        # The stage's floor and its cap, so the server's placement rules, the workshop's plan and
        # the drawn stage read the same numbers, as the walls are served for a lane.
        summary |= {"size_m": list(manifest.course.size_m), "max_ducks": manifest.course.max_ducks}
    return summary
```

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_manifest.py tests/test_routes_read.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS. The workshop serves `event_summary` too.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/manifest.py arena/events/got-a-talent.toml arena/web/routes_read.py tests/test_manifest.py tests/test_routes_read.py
/usr/bin/git commit -m "The Got a Talent stage declares its floor, 2.6 by 3.8 m, and that one entry may put up to 4 ducks on it; /api/events serves both"
```

---

### Task 2: A timeline can hold a troupe

**Files:**
- Modify: `arena/timeline.py`
- Test: `tests/test_timeline.py`; Create: `tests/test_troupe_format.py`

**Interfaces:**
- Consumes: Task 1's `Stage.size_m`, `Stage.max_ducks`.
- Produces (in `arena/timeline.py`):
  - The constants `TIMELINE_VERSIONS = (1, 2)` (replacing `TIMELINE_VERSION`), `SELF = "self"`, `LOCAL = "local:"`, `EDGE_MARGIN_M = 0.3` and `MIN_SPACING_M = 0.3`.
  - `Start(x=0.0, y=0.0, yaw_deg=0.0)`, with `to_dict() -> {"x", "y", "yaw"}`.
  - `Duck(policy, start, timeline)`. Each duck's `Timeline` carries its own keyframes, triggers, voice and song; its `duration_s` is the troupe's.
  - `Troupe(duration_s, ducks)`, with `references()`: the distinct non-SELF policies, in first-appearance order.
  - `load_troupe(path, event, *, allow_local=False) -> Troupe`, `solo(timeline) -> Troupe`, `split_reference(policy) -> (repo_id, commit)` and `split_local(policy) -> (folder, run, checkpoint)`.
  - `load_timeline(path, max_duration_s)` keeps working, version 1 only, with today's messages, until Task 5 removes it. `sound_of(timeline)` is unchanged and applies per duck.

- [ ] **Step 1: Write the failing tests**

`tests/test_timeline.py`: replace the imports and `LIMIT_S` with:

```python
import json
from pathlib import Path

import pytest

from arena.constants import CTRL_DT
from arena.manifest import load_event
from arena.timeline import (
    Note,
    Timeline,
    TimelineError,
    constant_timeline,
    load_timeline,
    load_troupe,
    sound_of,
)

LIMIT_S = 20.0
# Its time limit is LIMIT_S: a troupe and a lone timeline are refused at the same length.
TALENT = load_event("got-a-talent")
```

Delete these two rows from the `parametrize` list of `test_a_malformed_timeline_is_refused_with_where` (the version has its own tests now):

```python
        (good(timeline_version=2), "timeline_version: this Arena plays version 1"),
        (good(timeline_version=True), "timeline_version: this Arena plays version 1"),
```

Replace the body of `test_a_malformed_timeline_is_refused_with_where` and add the two version tests after it:

```python
def test_a_malformed_timeline_is_refused_with_where(tmp_path, raw, said):
    with pytest.raises(TimelineError, match=said):
        load_timeline(write(tmp_path, raw), LIMIT_S)
    # A troupe reads a version 1 file the same way, refusal for refusal.
    with pytest.raises(TimelineError, match=said):
        load_troupe(write(tmp_path, raw), TALENT)


@pytest.mark.parametrize("version", [2, True])
def test_a_lone_timeline_is_version_1(tmp_path, version):
    with pytest.raises(TimelineError, match="timeline_version: this Arena plays version 1, got"):
        load_timeline(write(tmp_path, good(timeline_version=version)), LIMIT_S)


@pytest.mark.parametrize("version", [0, 3, True, "1", 1.5, None])
def test_a_troupe_is_version_1_or_2(tmp_path, version):
    with pytest.raises(TimelineError, match="timeline_version: this Arena plays version 1 or 2, got"):
        load_troupe(write(tmp_path, good(timeline_version=version)), TALENT)
```

Create `tests/test_troupe_format.py`:

```python
"""timeline.json version 2: a troupe of ducks on the stage, each with its policy, place, keyframes,
voice and song. A version 1 file is a troupe of one."""

import json

import pytest

from arena.manifest import load_event
from arena.timeline import (
    EDGE_MARGIN_M,
    MIN_SPACING_M,
    SELF,
    Duck,
    Note,
    Start,
    TimelineError,
    Troupe,
    Timeline,
    constant_timeline,
    load_troupe,
    solo,
    split_local,
    split_reference,
)

TALENT = load_event("got-a-talent")
COMMIT = "0123456789abcdef0123456789abcdef01234567"
REFERENCE = f"pollen-robotics/microduck-got-a-talent-reference@{COMMIT}"
WALKER = f"ann/microduck-walker@{'f' * 40}"
LOCAL = "local:got_a_talent/2026-10-13_10-00-00_first@1500"


def write(tmp_path, content):
    path = tmp_path / "timeline.json"
    path.write_text(json.dumps(content))
    return path


def duck(policy=SELF, **keys) -> dict:
    return {"policy": policy, "keyframes": [{"t": 0.0}]} | keys


def troupe(*ducks, **top) -> dict:
    return {"timeline_version": 2, "duration_s": 10.0, "ducks": list(ducks)} | top


def apart(x: float, y: float = 0.0) -> dict:
    """A start far enough from the centre's duck."""
    return {"x": x, "y": y}


def test_a_version_1_file_is_a_troupe_of_one_self_duck_at_the_centre(tmp_path):
    raw = {"timeline_version": 1, "duration_s": 10.0, "voice": {"pitch": 0.3},
           "song": [{"t": 1.0, "note": "A4", "for": 0.5}],
           "keyframes": [{"t": 0.0}, {"t": 2.0, "twist": [1, 0, 0], "triggers": [1, 0]}]}
    path = write(tmp_path, raw)
    loaded = load_troupe(path, TALENT)
    still, sit = (0.0,) * 13, (1.0,) + (0.0,) * 12
    alone = Timeline(10.0, (0.0, 2.0), (still, sit), ((0.0, 0.0), (1.0, 0.0)), {"pitch": 0.3},
                     (Note(1.0, 0.5, 69, "mf", "ah"),))
    assert loaded == Troupe(10.0, (Duck(SELF, Start(), alone),))
    assert loaded.references() == ()


def test_solo_is_one_self_duck_at_the_centre_facing_the_audience():
    timeline = constant_timeline((0.0,) * 13, 20.0)
    assert solo(timeline) == Troupe(20.0, (Duck(SELF, Start(0.0, 0.0, 0.0), timeline),))
    assert Start().to_dict() == {"x": 0.0, "y": 0.0, "yaw": 0.0}


def test_each_duck_brings_its_policy_place_keyframes_voice_and_song(tmp_path):
    raw = troupe(
        duck(start={"x": 0.0, "y": 0.0, "yaw": 0}, voice={"pitch": 0.2},
             song=[{"t": 2.0, "note": "C4", "for": 0.5}],
             keyframes=[{"t": 0.0, "twist": [1, 0, 0], "triggers": [0, 1]}]),
        duck(REFERENCE, start={"x": 0.4, "y": -0.6, "yaw": 90}),
        duck(SELF, start={"y": 1.2}, keyframes=[{"t": 0.0}, {"t": 5.0, "body": [0, 0, 0, 0, 0, 0.25]}]),
    )
    loaded = load_troupe(write(tmp_path, raw), TALENT)
    assert loaded.duration_s == 10.0
    star, guest, copy = loaded.ducks
    assert (star.policy, guest.policy, copy.policy) == (SELF, REFERENCE, SELF)
    assert (star.start, guest.start, copy.start) == (Start(), Start(0.4, -0.6, 90.0), Start(0.0, 1.2, 0.0))
    assert star.timeline.commands == ((1.0,) + (0.0,) * 12,)
    assert star.timeline.triggers == ((0.0, 1.0),)
    assert (star.timeline.voice, star.timeline.song) == ({"pitch": 0.2}, (Note(2.0, 0.5, 60, "mf", "ah"),))
    assert (guest.timeline.voice, guest.timeline.song) == ({}, ())
    assert copy.timeline.times == (0.0, 5.0)
    # The troupe's length is every duck's.
    assert {d.timeline.duration_s for d in loaded.ducks} == {10.0}


def test_a_start_left_out_is_the_centre_and_a_coordinate_left_out_is_zero(tmp_path):
    raw = troupe(duck(), duck(SELF, start={"x": 0.5}), duck(SELF, start={"yaw": -180, "y": -0.5}))
    starts = [d.start for d in load_troupe(write(tmp_path, raw), TALENT).ducks]
    assert starts == [Start(), Start(0.5, 0.0, 0.0), Start(0.0, -0.5, -180.0)]


def test_the_references_are_every_borrowed_policy_once_in_order(tmp_path):
    raw = troupe(duck(), duck(WALKER, start=apart(0.5)), duck(REFERENCE, start=apart(-0.5)),
                 duck(SELF, start=apart(0.0, 0.5)))
    assert load_troupe(write(tmp_path, raw), TALENT).references() == (WALKER, REFERENCE)
    again = troupe(duck(), duck(WALKER, start=apart(0.5)), duck(WALKER, start=apart(-0.5)))
    assert load_troupe(write(tmp_path, again), TALENT).references() == (WALKER,)


def test_a_reference_and_a_local_checkpoint_split_into_their_parts():
    assert split_reference(REFERENCE) == ("pollen-robotics/microduck-got-a-talent-reference", COMMIT)
    assert split_local(LOCAL) == ("got_a_talent", "2026-10-13_10-00-00_first", 1500)


def test_a_local_checkpoint_plays_only_where_the_workshop_asks_for_it(tmp_path):
    path = write(tmp_path, troupe(duck(), duck(LOCAL, start=apart(0.5))))
    assert load_troupe(path, TALENT, allow_local=True).ducks[1].policy == LOCAL
    with pytest.raises(TimelineError, match=r"ducks\[1\]\.policy: 'local:got_a_talent/.*@1500' is a checkpoint on "
                                            r"your machine: publish it first"):
        load_troupe(path, TALENT)


def test_a_start_on_the_margin_or_exactly_the_spacing_apart_is_taken(tmp_path):
    """The stage is 2.6 x 3.8 m: a start may reach 1.0 m along x and 1.6 m along y, which 1.9 - 0.3 misses
    by one bit in floating point; 0.7 - 0.4 is under 0.3 by one bit too."""
    assert (TALENT.course.size_m[0] / 2 - EDGE_MARGIN_M, MIN_SPACING_M) == (1.0, 0.3)
    raw = troupe(duck(start={"x": 1.0, "y": 1.6}), duck(SELF, start={"x": -1.0, "y": -1.6}),
                 duck(SELF, start={"x": 0.4}), duck(SELF, start={"x": 0.7}))
    assert len(load_troupe(write(tmp_path, raw), TALENT).ducks) == 4


@pytest.mark.parametrize(
    "raw, said",
    [
        (troupe(duck(), keyframes=[{"t": 0.0}]), r"timeline\.json: unknown keys \['keyframes'\]"),
        ({"timeline_version": 2, "duration_s": 10.0}, r"timeline\.json: missing 'ducks'"),
        (troupe(duck(), duration_s=20.5), r"duration_s: 20\.5 s is longer than this event's 20 s"),
        (troupe(), r"ducks: expected 1 to 4 ducks in a list, got 0"),
        (troupe() | {"ducks": {"policy": "self"}}, r"ducks: expected 1 to 4 ducks in a list, got a dict"),
        (troupe(*[duck(SELF, start=apart(0.5 * i - 1.0)) for i in range(5)]), r"ducks: 5 ducks, this event takes at most 4"),
        (troupe(duck(), "self"), r"ducks\[1\]: expected an object, got str"),
        (troupe(duck(), duck(SELF, start=apart(0.5), speed=1)), r"ducks\[1\]: unknown keys \['speed'\]"),
        (troupe(duck(), {"keyframes": [{"t": 0.0}]}), r"ducks\[1\]: missing 'policy'"),
        (troupe(duck(), {"policy": SELF}), r"ducks\[1\]: missing 'keyframes'"),
        (troupe(duck(f"a/b@{COMMIT}")), r"""ducks\[0\]\.policy: the first duck is the entry's own policy: "self", got 'a/b@0123"""),
        (troupe(duck(), duck(3, start=apart(0.5))), r'ducks\[1\]\.policy: expected "self" or owner/repo@<commit>, got 3'),
        (troupe(duck(), duck("a/b@main", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b@main' must pin a full 40-character commit"),
        (troupe(duck(), duck("a/b", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b' must pin a full 40-character commit"),
        (troupe(duck(), duck(f"a/b@{COMMIT.upper()}", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b@0123456789ABCDEF.*' must pin"),
        (troupe(duck(), duck(f"a/b@{COMMIT[:7]}", start=apart(0.5))), r"ducks\[1\]\.policy: 'a/b@0123456' must pin"),
        (troupe(duck(), duck("walker", start=apart(0.5))), r"""ducks\[1\]\.policy: 'walker' is neither "self" nor owner/repo@<commit>"""),
        (troupe(duck(), duck(SELF, start=[0.5, 0])), r"ducks\[1\]\.start: expected an object, got list"),
        (troupe(duck(), duck(SELF, start={"x": 0.5, "z": 0.1})), r"ducks\[1\]\.start: unknown keys \['z'\]"),
        (troupe(duck(), duck(SELF, start={"x": "0.5"})), r"ducks\[1\]\.start\.x: expected a number"),
        (troupe(duck(), duck(SELF, start={"x": 0.5, "yaw": True})), r"ducks\[1\]\.start\.yaw: expected a number"),
        (troupe(duck(), duck(SELF, start={"x": 0.5, "yaw": 200})), r"ducks\[1\]\.start\.yaw: 200 is outside ±180 degrees"),
        (troupe(duck(), duck(SELF, start={"x": 1.2})), r"ducks\[1\]\.start: x 1\.2 is off the stage \(\|x\| ≤ 1 m\)"),
        (troupe(duck(), duck(SELF, start={"y": -1.7})), r"ducks\[1\]\.start: y -1\.7 is off the stage \(\|y\| ≤ 1\.6 m\)"),
        (troupe(duck(start={"x": -1.01})), r"ducks\[0\]\.start: x -1\.01 is off the stage"),
        (troupe(duck(), duck(SELF)), r"ducks\[1\]\.start: 0\.00 m from ducks\[0\], closer than 0\.3 m"),
        (troupe(duck(), duck(SELF, start=apart(0.5)), duck(SELF, start=apart(0.5, 0.21))),
         r"ducks\[2\]\.start: 0\.21 m from ducks\[1\], closer than 0\.3 m"),
        (troupe(duck(), duck(SELF, start=apart(0.5), keyframes=[{"t": 0.5}])),
         r"ducks\[1\]\.keyframes\[0\]\.t: the first keyframe starts at 0\.0"),
        (troupe(duck(), duck(SELF, start=apart(0.5), keyframes=[])), r"ducks\[1\]\.keyframes: expected 1 to 1000"),
        (troupe(duck(), duck(SELF, start=apart(0.5), keyframes=[{"t": 0.0, "twist": [11, 0, 0]}])),
         r"ducks\[1\]\.keyframes\[0\]\.twist\[0\]: 11\.0 is outside ±10"),
        (troupe(duck(), duck(SELF, start=apart(0.5), voice={"pitch": 1.5})), r"ducks\[1\]\.voice\.pitch: 1\.5 is outside \[0, 1\]"),
        (troupe(duck(), duck(SELF, start=apart(0.5), voice=[0.5])), r"ducks\[1\]\.voice: expected an object, got list"),
        (troupe(duck(), duck(SELF, start=apart(0.5), song=[{"t": 0, "note": "H4", "for": 1}])),
         r"ducks\[1\]\.song\[0\]\.note: 'H4' is not a note name"),
        (troupe(duck(), duck(SELF, start=apart(0.5), song=[{"t": 0, "note": "C4", "for": 1.5}, {"t": 1.2, "note": "D4", "for": 1}])),
         r"ducks\[1\]\.song\[1\]\.t: 1\.2 starts before ducks\[1\]\.song\[0\] ends \(1\.5\)"),
        (troupe(duck(), duck(SELF, start=apart(0.5), song=[{"t": 9.5, "note": "C4", "for": 0.9}])),
         r"ducks\[1\]\.song\[0\]: ends at 10\.4, after the end of the performance \(10 s\)"),
    ],
)
def test_a_malformed_troupe_is_refused_with_where(tmp_path, raw, said):
    with pytest.raises(TimelineError, match=said):
        load_troupe(write(tmp_path, raw), TALENT, allow_local=True)


@pytest.mark.parametrize("policy", ["local:got_a_talent", "local:got_a_talent/first", "local:a/b@x", "local:/b@1"])
def test_a_local_checkpoint_names_its_challenge_its_run_and_its_number(tmp_path, policy):
    with pytest.raises(TimelineError, match=r"ducks\[1\]\.policy: .* is not local:<challenge folder>/<run>@<checkpoint>"):
        load_troupe(write(tmp_path, troupe(duck(), duck(policy, start=apart(0.5)))), TALENT, allow_local=True)
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_timeline.py tests/test_troupe_format.py`
Expected: FAIL. Both files stop at collection with `ImportError: cannot import name 'load_troupe'` (or `'EDGE_MARGIN_M'`).

- [ ] **Step 3: Implement**

All in `arena/timeline.py`. The parsing that `load_timeline` does today is split into private helpers that both loaders share; each helper takes the place to prefix to its refusals ("" for a version 1 file, `ducks[k].` for a troupe's duck), so version 1 refusals read exactly as today.

1. Extend the module docstring. After its last paragraph ("…Neither is a policy input."), add:

```
Version 2 puts a troupe on the stage: up to the event's `max_ducks` ducks, each with its own
policy, place, keyframes, voice and song, sharing one `duration_s`.

    {"timeline_version": 2, "duration_s": 20.0,
     "ducks": [{"policy": "self", "start": {"x": 0.0, "y": 0.0, "yaw": 0}, "keyframes": [{"t": 0.0}]},
               {"policy": "owner/repo@<40-hex commit>", "start": {"x": 0.4, "y": -0.6, "yaw": 90},
                "keyframes": [{"t": 0.0}]}]}

The first duck is the entry's own policy, "self"; any other is "self" again or a Hub policy pinned
to a full commit, so a performance can be played again. A start is a pose in the stage's frame,
which is the simulation's world frame: from the stage's centre, x towards the audience, y to the
audience's right, yaw in degrees with 0 facing the audience. A version 1 file is a troupe of one:
the entry's own policy at the centre, with the file's keyframes, voice and song.
```

2. After `from .constants import CTRL_DT`, add `from .manifest import Manifest`. (`arena/manifest.py` imports only `arena.constants`: no cycle.)

3. Replace `TIMELINE_VERSION = 1` with:

```python
TIMELINE_VERSIONS = (1, 2)
# The entry's own policy, and the mark of a checkpoint still on the author's machine: the workshop
# plays one, an entry never does (nobody else could fetch it).
SELF = "self"
LOCAL = "local:"
# About the robot, not the stage: how far inside the stage's edge a duck starts, and how far
# apart two ducks start, centre to centre.
EDGE_MARGIN_M = 0.3
MIN_SPACING_M = 0.3
```

4. After `_TOP_KEYS = ("timeline_version", "duration_s", "keyframes")`, add:

```python
_TROUPE_KEYS = ("timeline_version", "duration_s", "ducks")
_DUCK_KEYS = ("policy", "start", "keyframes", "voice", "song")
_START_KEYS = ("x", "y", "yaw")
_REPO = r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
_REFERENCE = re.compile(rf"({_REPO})@([0-9a-f]{{40}})")
_UNPINNED = re.compile(rf"{_REPO}(@.*)?")
_LOCAL = re.compile(rf"{LOCAL}([^/@]+)/([^/@]+)@([0-9]+)")
```

and after `_EPS_S = 1e-9`, add:

```python
# Places are decimal metres too (1.9 - 0.3 < 1.6 in floating point): a start on the stage's
# margin, or exactly MIN_SPACING_M from another, is taken.
_EPS_M = 1e-9
```

5. After the `Timeline` dataclass (after its `command_at`), add:

```python
@dataclass(frozen=True)
class Start:
    """Where a duck starts, in the stage's frame: metres from the centre along x (towards the
    audience) and y (to the audience's right), and its heading in degrees, 0 facing the audience.
    Not arena.manifest.Start, the event's start rules (keyframe, settle, perturbation)."""

    x: float = 0.0
    y: float = 0.0
    yaw_deg: float = 0.0

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "yaw": self.yaw_deg}


@dataclass(frozen=True)
class Duck:
    # SELF, "owner/repo@<40 hex>", or (the workshop's only) "local:<folder>/<run>@<checkpoint>".
    policy: str
    start: Start
    # Its own keyframes, triggers, voice and song; duration_s is the troupe's.
    timeline: Timeline


@dataclass(frozen=True)
class Troupe:
    duration_s: float
    ducks: tuple[Duck, ...]

    def references(self) -> tuple[str, ...]:
        """Every policy but the entry's own, once each, in the order the ducks first name them."""
        return tuple(dict.fromkeys(duck.policy for duck in self.ducks if duck.policy != SELF))
```

6. After `constant_timeline`, add:

```python
def solo(timeline: Timeline) -> Troupe:
    """A troupe of one: the entry's own policy at the centre, facing the audience."""
    return Troupe(timeline.duration_s, (Duck(SELF, Start(), timeline),))


def split_reference(policy: str) -> tuple[str, str]:
    """A checked Hub reference as (repo id, commit)."""
    return _REFERENCE.fullmatch(policy).groups()


def split_local(policy: str) -> tuple[str, str, int]:
    """A checked local checkpoint as (challenge folder, run, checkpoint)."""
    folder, run, checkpoint = _LOCAL.fullmatch(policy).groups()
    return folder, run, int(checkpoint)
```

7. `_keyframe` takes its place instead of its index. Replace its first two lines:

```python
def _keyframe(raw, index: int, duration_s: float, previous_t: float | None):
    where = f"keyframes[{index}]"
```

with:

```python
def _keyframe(raw, where: str, duration_s: float, previous_t: float | None):
```

8. Replace `_voice` with:

```python
def _voice(raw, where: str) -> dict:
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    unknown = sorted(set(raw) - set(VOICE_KNOBS))
    if unknown:
        raise TimelineError(f"{where}: unknown keys {unknown}")
    voice = {}
    for name in VOICE_KNOBS:
        if name in raw:
            value = _number(raw[name], f"{where}.{name}")
            if not 0.0 <= value <= 1.0:
                raise TimelineError(f"{where}.{name}: {value} is outside [0, 1]")
            voice[name] = value
    return voice
```

9. In `_song`, the place becomes a parameter. Replace:

```python
def _song(raw, duration_s: float) -> tuple[Note, ...]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_NOTES:
        got = len(raw) if isinstance(raw, list) else f"a {type(raw).__name__}"
        raise TimelineError(f"song: expected 1 to {MAX_NOTES} notes in a list, got {got}")
    notes: list[Note] = []
    for index, note in enumerate(raw):
        where = f"song[{index}]"
```

with:

```python
def _song(raw, duration_s: float, place: str) -> tuple[Note, ...]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_NOTES:
        got = len(raw) if isinstance(raw, list) else f"a {type(raw).__name__}"
        raise TimelineError(f"{place}: expected 1 to {MAX_NOTES} notes in a list, got {got}")
    notes: list[Note] = []
    for index, note in enumerate(raw):
        where = f"{place}[{index}]"
```

and replace `f"{where}.t: {t} starts before song[{index - 1}] ends ({notes[-1].t + notes[-1].length_s:g})"` with:

```python
                f"{where}.t: {t} starts before {place}[{index - 1}] ends ({notes[-1].t + notes[-1].length_s:g})"
```

10. Replace the whole of `load_timeline` (from `def load_timeline(` down to the blank lines before `def _trigger_track(`) with:

```python
def _read(path: Path) -> dict:
    """The file's JSON object, or a refusal that says what is wrong with the file itself."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise TimelineError(f"{path}: {exc.strerror or exc}") from exc
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise TimelineError(f"{path.name}: not a JSON file ({exc})") from exc
    if not isinstance(raw, dict):
        raise TimelineError(f"{path.name}: expected a JSON object, got {type(raw).__name__}")
    return raw


def _keys(raw: dict, allowed, required, where: str) -> None:
    unknown = sorted(set(raw) - set(allowed))
    if unknown:
        raise TimelineError(f"{where}: unknown keys {unknown}")
    for key in required:
        if key not in raw:
            raise TimelineError(f"{where}: missing {key!r}")


def _version(raw: dict, name: str, versions: tuple[int, ...]) -> int:
    if "timeline_version" not in raw:
        raise TimelineError(f"{name}: missing 'timeline_version'")
    version = raw["timeline_version"]
    # bool first: True == 1 in Python, and would otherwise read as version 1.
    if isinstance(version, bool) or version not in versions:
        plays = " or ".join(str(v) for v in versions)
        raise TimelineError(f"timeline_version: this Arena plays version {plays}, got {version!r}")
    return version


def _duration(raw: dict, max_duration_s: float) -> float:
    duration_s = _number(raw["duration_s"], "duration_s")
    if duration_s < CTRL_DT:
        raise TimelineError(f"duration_s: must be at least one control step ({CTRL_DT:g} s), got {duration_s}")
    if duration_s > max_duration_s:
        raise TimelineError(f"duration_s: {duration_s:g} s is longer than this event's {max_duration_s:g} s")
    return duration_s


def _timeline(raw: dict, duration_s: float, prefix: str) -> Timeline:
    """One duck's performance: a version 1 file's keyframes, voice and song, or a troupe duck's.
    `prefix` puts the duck's place before every refusal ("" for a version 1 file)."""
    keyframes = raw["keyframes"]
    if not isinstance(keyframes, list) or not 1 <= len(keyframes) <= MAX_KEYFRAMES:
        got = len(keyframes) if isinstance(keyframes, list) else f"a {type(keyframes).__name__}"
        raise TimelineError(f"{prefix}keyframes: expected 1 to {MAX_KEYFRAMES} keyframes in a list, got {got}")
    times, commands, triggers, previous = [], [], [], None
    for index, keyframe in enumerate(keyframes):
        previous, command, pulled = _keyframe(keyframe, f"{prefix}keyframes[{index}]", duration_s, previous)
        times.append(previous)
        commands.append(command)
        triggers.append(pulled)
    voice = _voice(raw["voice"], f"{prefix}voice") if "voice" in raw else {}
    song = _song(raw["song"], duration_s, f"{prefix}song") if "song" in raw else ()
    return Timeline(duration_s, tuple(times), tuple(commands), tuple(triggers), voice, song)


def _v1(raw: dict, name: str, max_duration_s: float) -> Timeline:
    """A version 1 file: one performance, its keyframes, voice and song at the top level."""
    _keys(raw, (*_TOP_KEYS, "voice", "song"), _TOP_KEYS, name)
    return _timeline(raw, _duration(raw, max_duration_s), "")


def _policy(value, index: int, allow_local: bool) -> str:
    where = f"ducks[{index}].policy"
    if not isinstance(value, str):
        raise TimelineError(f'{where}: expected "self" or owner/repo@<commit>, got {value!r}')
    if index == 0:
        if value != SELF:
            raise TimelineError(f'{where}: the first duck is the entry\'s own policy: "self", got {value!r}')
        return value
    if value == SELF or _REFERENCE.fullmatch(value):
        return value
    if value.startswith(LOCAL):
        if not allow_local:
            raise TimelineError(f"{where}: {value!r} is a checkpoint on your machine: publish it first")
        if _LOCAL.fullmatch(value) is None:
            raise TimelineError(f"{where}: {value!r} is not local:<challenge folder>/<run>@<checkpoint>")
        return value
    if _UNPINNED.fullmatch(value):
        raise TimelineError(f"{where}: {value!r} must pin a full 40-character commit")
    raise TimelineError(f'{where}: {value!r} is neither "self" nor owner/repo@<commit>')


def _start(raw, where: str, size_m: tuple[float, float]) -> Start:
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    _keys(raw, _START_KEYS, (), where)
    x, y, yaw = (_number(raw.get(key, 0.0), f"{where}.{key}") for key in _START_KEYS)
    if abs(yaw) > 180.0:
        raise TimelineError(f"{where}.yaw: {yaw:g} is outside ±180 degrees")
    for name, value, size in (("x", x, size_m[0]), ("y", y, size_m[1])):
        reach = size / 2 - EDGE_MARGIN_M
        if abs(value) > reach + _EPS_M:
            raise TimelineError(f"{where}: {name} {value:g} is off the stage (|{name}| ≤ {reach:g} m)")
    return Start(x, y, yaw)


def _duck(raw, index: int, duration_s: float, event: Manifest, allow_local: bool) -> Duck:
    where = f"ducks[{index}]"
    if not isinstance(raw, dict):
        raise TimelineError(f"{where}: expected an object, got {type(raw).__name__}")
    _keys(raw, _DUCK_KEYS, ("policy", "keyframes"), where)
    policy = _policy(raw["policy"], index, allow_local)
    start = _start(raw["start"], f"{where}.start", event.course.size_m) if "start" in raw else Start()
    return Duck(policy, start, _timeline(raw, duration_s, f"{where}."))


def _troupe(raw: dict, name: str, event: Manifest, allow_local: bool) -> Troupe:
    _keys(raw, _TROUPE_KEYS, _TROUPE_KEYS, name)
    duration_s = _duration(raw, event.time_limit_s)
    listed, most = raw["ducks"], event.course.max_ducks
    if not isinstance(listed, list) or not listed:
        got = len(listed) if isinstance(listed, list) else f"a {type(listed).__name__}"
        raise TimelineError(f"ducks: expected 1 to {most} ducks in a list, got {got}")
    if len(listed) > most:
        raise TimelineError(f"ducks: {len(listed)} ducks, this event takes at most {most}")
    ducks: list[Duck] = []
    for index, entry in enumerate(listed):
        duck = _duck(entry, index, duration_s, event, allow_local)
        for other, placed in enumerate(ducks):
            apart = math.hypot(duck.start.x - placed.start.x, duck.start.y - placed.start.y)
            if apart < MIN_SPACING_M - _EPS_M:
                raise TimelineError(
                    f"ducks[{index}].start: {apart:.2f} m from ducks[{other}], closer than {MIN_SPACING_M:g} m"
                )
        ducks.append(duck)
    return Troupe(duration_s, tuple(ducks))


def load_troupe(path: Path, event: Manifest, *, allow_local: bool = False) -> Troupe:
    """Read and check a timeline.json of either version, as the troupe it puts on `event`'s stage.

    A version 1 file is a troupe of one (`solo`). `allow_local` lets a duck name a checkpoint on
    this machine, which only the workshop asks for, as it saves and plays the troupe it composes;
    an entry is refused one."""
    path = Path(path)
    raw = _read(path)
    if _version(raw, path.name, TIMELINE_VERSIONS) == 1:
        return solo(_v1(raw, path.name, event.time_limit_s))
    return _troupe(raw, path.name, event, allow_local)


def load_timeline(path: Path, max_duration_s: float) -> Timeline:
    """Read and check a version 1 timeline.json. `max_duration_s` is the event's time limit,
    so the event stays the one place the 20 s is written."""
    path = Path(path)
    raw = _read(path)
    _version(raw, path.name, (1,))
    return _v1(raw, path.name, max_duration_s)
```

Then check that nothing else named the old constant: `grep -rn "TIMELINE_VERSION\b" arena tests scripts` must print nothing.

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/test_timeline.py tests/test_troupe_format.py tests/test_cli.py tests/test_hub_fetch.py`
Expected: PASS (`test_cli` and `test_hub_fetch` still play version 1 files through `load_timeline`).

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/timeline.py tests/test_timeline.py tests/test_troupe_format.py
/usr/bin/git commit -m "A timeline can hold a troupe: up to the event's cap of ducks, each with its own policy, place, keyframes, voice and song, and a version 1 file is a troupe of one"
```

---

### Task 3: Traces carry ducks

**Files:**
- Modify: `arena/trace.py`, `arena/stage.py`, `arena/web/routes_read.py`, `arena/web/routes_vote.py`, `arena/workshop/evaluations.py`
- Test: `tests/test_trace.py`, `tests/test_routes_trace.py`, `tests/test_routes_vote.py`, `tests/test_stage.py`, `tests/workshop/test_evaluations.py`, `tests/workshop/test_performance.py`

**Interfaces:**
- Produces:
  - `encode(trace, settle=None)` takes a 2-D `(frames, TRACE_WIDTH)` or a 3-D `(ducks, frames, TRACE_WIDTH)` trace, its settle of the same rank; anything else is a `ValueError`.
  - `decode(blob)` always returns `(ducks, frames, TRACE_WIDTH)` float32: a 2-D blob is one duck.
  - `decode_settle(blob)` likewise, and `(1, 0, TRACE_WIDTH)` when none was stored.
  - New: `as_ducks(frames) -> np.ndarray` in `arena/trace.py`: `(1, F, W)` for 2-D, as is for 3-D, float32.
  - `summaries(trace, termination) -> list[dict]` in `arena/stage.py`: `summary` per duck.
  - `frames_response(ducks)` in `arena/web/routes_read.py` (public, `_frames` renamed): little-endian float32 duck-major, `X-Frame-Count` = frames per duck, `X-Duck-Count`. Served by `/runs/{id}/trace`, `/runs/{id}/settle` and `/ballots/{t}/lanes/{i}/trace`. One duck's bytes are exactly today's, so `app/src/api.js` `frames()` (which reads the bytes and no header) is unchanged.
  - The workshop evaluation body gains `"ducks"`; `trace_b64` is duck-major. Until Task 4 every trace is 2-D, so `ducks` is 1 and the bytes are today's.

- [ ] **Step 1: Write the failing tests**

`tests/test_trace.py`: add `import pytest` after `import numpy as np`. Replace `test_round_trip_preserves_shape_and_dtype` and `test_round_trip_is_accurate_to_float16` with:

```python
def test_round_trip_preserves_shape_and_dtype():
    original = np.random.default_rng(0).standard_normal((100, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    # A race's trace, or a performance stored before troupes, reads back as one duck.
    assert restored.shape == (1, *original.shape)
    assert restored.dtype == np.float32


def test_round_trip_is_accurate_to_float16():
    original = np.random.default_rng(0).uniform(-3, 3, (50, TRACE_WIDTH)).astype(np.float32)
    restored = codec.decode(codec.encode(original))
    # float16 has ~3 decimal digits; millimetre accuracy is plenty for a replay.
    np.testing.assert_allclose(restored[0], original, atol=3e-3)


def test_a_troupes_trace_and_settle_round_trip_duck_by_duck():
    rng = np.random.default_rng(3)
    trace = rng.uniform(-3, 3, (4, 40, TRACE_WIDTH)).astype(np.float32)
    settle = rng.uniform(-3, 3, (4, 26, TRACE_WIDTH)).astype(np.float32)
    blob = codec.encode(trace, settle)
    np.testing.assert_allclose(codec.decode(blob), trace, atol=3e-3)
    np.testing.assert_allclose(codec.decode_settle(blob), settle, atol=3e-3)


def test_a_trace_stored_before_troupes_reads_as_one_duck():
    """What the store holds today: a plain 2-D float16 trace and settle, written before this codec knew ducks."""
    trace = np.random.default_rng(4).uniform(-3, 3, (30, TRACE_WIDTH)).astype(np.float16)
    buffer = io.BytesIO()
    np.savez_compressed(buffer, trace=trace, settle=trace[:5])
    assert codec.decode(buffer.getvalue()).shape == (1, 30, TRACE_WIDTH)
    assert codec.decode_settle(buffer.getvalue()).shape == (1, 5, TRACE_WIDTH)


@pytest.mark.parametrize("shape", [(TRACE_WIDTH,), (2, 3, 4, TRACE_WIDTH), (5, TRACE_WIDTH + 1), (2, 5, 7)])
def test_a_trace_that_is_neither_one_duck_nor_a_troupe_is_refused(shape):
    with pytest.raises(ValueError, match="must be"):
        codec.encode(np.zeros(shape, dtype=np.float32))
```

In `test_empty_trace_round_trips`, replace `assert codec.decode(codec.encode(empty)).shape == (0, TRACE_WIDTH)` with:

```python
    assert codec.decode(codec.encode(empty)).shape == (1, 0, TRACE_WIDTH)
```

In `test_the_settle_round_trips_beside_the_trace`, replace its last four lines with:

```python
    np.testing.assert_allclose(codec.decode(blob)[0], trace, atol=3e-3)
    restored = codec.decode_settle(blob)
    assert restored.dtype == np.float32
    np.testing.assert_allclose(restored[0], settle, atol=3e-3)
```

In `test_a_trace_stored_before_settles_were_recorded_has_none`, replace `assert codec.decode_settle(blob).shape == (0, TRACE_WIDTH)` with:

```python
    assert codec.decode_settle(blob).shape == (1, 0, TRACE_WIDTH)
```

`tests/test_routes_trace.py`: replace `a_trace` with:

```python
def a_trace(frames=7, ducks=None):
    """A trace whose every value is distinct, so a transpose or stride bug shows: one duck's
    (frames, TRACE_WIDTH), or a troupe's (ducks, frames, TRACE_WIDTH)."""
    shape = (frames, TRACE_WIDTH) if ducks is None else (ducks, frames, TRACE_WIDTH)
    return np.arange(np.prod(shape), dtype=np.float32).reshape(shape)
```

In `test_the_trace_round_trips_as_float32`, after `assert response.headers["x-frame-count"] == "11"` add:

```python
    assert response.headers["x-duck-count"] == "1"
```

In `test_a_run_stored_before_settles_were_recorded_serves_an_empty_one`, after `assert response.headers["x-frame-count"] == "0"` add:

```python
    assert response.headers["x-duck-count"] == "1"
```

Add before `test_the_settle_is_served_like_the_trace`:

```python
def test_a_troupes_trace_and_settle_are_served_duck_after_duck(client):
    api, app = client
    record = make_record(event_id="got-a-talent")
    trace, settle = a_trace(frames=9, ducks=3), a_trace(frames=4, ducks=3)
    app.state.store.append(record, encode(trace, settle))
    for path, original in (("trace", trace), ("settle", settle)):
        response = api.get(f"/api/runs/{record.run_id}/{path}")
        assert response.headers["x-duck-count"] == "3", path
        assert response.headers["x-frame-count"] == str(original.shape[1]), path
        restored = np.frombuffer(response.content, dtype="<f4").reshape(original.shape)
        np.testing.assert_allclose(restored, original, rtol=0, atol=1e-2, err_msg=path)
```

`tests/test_routes_vote.py`: in `test_a_lanes_trace_is_served_without_ever_naming_a_run`, replace `assert trace.headers["X-Frame-Count"] == "5"` with:

```python
    assert (trace.headers["X-Frame-Count"], trace.headers["X-Duck-Count"]) == ("5", "1")
    assert len(trace.content) == 5 * 21 * 4
```

and add after that test:

```python
def test_a_lane_with_a_troupe_serves_every_duck_through_the_ballot(client):
    api, app = client
    troupe = np.arange(2 * 6 * 21, dtype=np.float32).reshape(2, 6, 21)
    for name in ("ann", "bob"):
        record = make_record(user=name, event_id="got-a-talent", policy_name=name)
        app.state.store.append(record, encode(troupe))
    body = api.get("/api/events/got-a-talent/ballot").json()
    trace = api.get(f"/api/ballots/{body['ballot']}/lanes/1/trace")
    assert (trace.headers["X-Frame-Count"], trace.headers["X-Duck-Count"]) == ("6", "2")
    np.testing.assert_array_equal(np.frombuffer(trace.content, dtype="<f4").reshape(2, 6, 21), troupe)
```

`tests/test_stage.py`: add before `test_a_summary_says_when_it_fell_and_how_long_it_sat_and_stood`:

```python
def test_a_troupe_is_summarised_duck_by_duck():
    from arena.stage import summaries, summary

    term = load_event("got-a-talent").termination
    troupe = np.stack([frames(50), frames(50, z=0.06), frames(50, tilt=80.0)])
    assert summaries(troupe, term) == [summary(duck, term) for duck in troupe]
    assert [s["seated_s"] for s in summaries(troupe, term)] == [0.0, pytest.approx(1.0), 0.0]
    assert summaries(troupe, term)[2]["fell_at"] == pytest.approx(15 * CTRL_DT)
```

`tests/workshop/test_evaluations.py`: in `test_a_checkpoint_is_exported_by_a_dry_run_publish_and_raced`, after `assert len(base64.b64decode(body["trace_b64"])) % (4 * TRACE_WIDTH) == 0` add:

```python
    assert body["ducks"] == 1  # a race is one duck
```

`tests/workshop/test_performance.py`: in `test_a_stage_checkpoint_plays_the_challenges_timeline`, after `assert frames(body) == 100  # 2 s at 50 Hz: …` add:

```python
    assert body["ducks"] == 1
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_trace.py tests/test_routes_trace.py tests/test_routes_vote.py tests/test_stage.py`
Expected: FAIL.
- The shape asserts fail.
- `encode` refuses a troupe: `ValueError: trace must be (frames, 21), got (4, 40, 21)`.
- The routes fail with `KeyError: 'x-duck-count'`.
- `test_stage.py` fails with `ImportError: cannot import name 'summaries'`.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop/test_evaluations.py tests/workshop/test_performance.py`
Expected: FAIL with `KeyError: 'ducks'`.

- [ ] **Step 3: Implement**

`arena/trace.py`: append to the module docstring, after "Traces stored before settles were recorded have none.":

```

A race keeps one duck's (frames, TRACE_WIDTH); a stage keeps every duck of its
troupe, (ducks, frames, TRACE_WIDTH). Read back, both are (ducks, frames,
TRACE_WIDTH): a race, and a performance stored before troupes, are one duck.
```

Replace the shape check in `encode`:

```python
        if array.ndim != 2 or array.shape[1] != TRACE_WIDTH:
            raise ValueError(f"{name} must be (frames, {TRACE_WIDTH}), got {array.shape}")
```

with:

```python
        if array.ndim not in (2, 3) or array.shape[-1] != TRACE_WIDTH:
            raise ValueError(
                f"{name} must be (frames, {TRACE_WIDTH}) or (ducks, frames, {TRACE_WIDTH}), got {array.shape}"
            )
```

Replace `decode` and `decode_settle` with:

```python
def as_ducks(frames: np.ndarray) -> np.ndarray:
    """A trace or a settle as (ducks, frames, TRACE_WIDTH) float32: one duck's is the first of one."""
    return (frames[np.newaxis] if frames.ndim == 2 else frames).astype(np.float32)


def decode(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        return as_ducks(loaded["trace"])


def decode_settle(blob: bytes) -> np.ndarray:
    with np.load(io.BytesIO(blob)) as loaded:
        if "settle" not in loaded:
            return np.zeros((1, 0, TRACE_WIDTH), dtype=np.float32)
        return as_ducks(loaded["settle"])
```

`arena/stage.py`: append after `summary`:

```python


def summaries(trace: np.ndarray, termination: Termination) -> list[dict]:
    """`summary` of each duck of a troupe's (ducks, frames, TRACE_WIDTH) trace, in duck order."""
    return [summary(duck, termination) for duck in trace]
```

`arena/web/routes_read.py`:
- In `run_trace`, replace the docstring's first line `"""Raw little-endian float32, TRACE_WIDTH values per frame.` with:

```python
    """Raw little-endian float32, TRACE_WIDTH values per frame, every duck's frames
    one duck after another (`frames_response`).
```

- Replace `return _frames(decode(store.trace(run_id)))` with `return frames_response(decode(store.trace(run_id)))`.
- Replace `return _frames(decode_settle(store.trace(run_id)))` with `return frames_response(decode_settle(store.trace(run_id)))`.
- Replace `_frames` with:

```python
def frames_response(ducks: np.ndarray) -> Response:
    """A (ducks, frames, TRACE_WIDTH) trace on the wire: little-endian float32, duck-major, so one
    duck's bytes are what a lone duck's always were. X-Frame-Count counts one duck's frames."""
    return Response(
        content=np.ascontiguousarray(ducks, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Frame-Count": str(ducks.shape[1]),
            "X-Duck-Count": str(ducks.shape[0]),
            "Cache-Control": "no-store",
        },
    )
```

`arena/web/routes_vote.py`:
- Delete the line `import numpy as np` (nothing else in the module uses numpy).
- After `from .routes_auth import current_user`, add `from .routes_read import frames_response`.
- In `ballot_trace`, replace:

```python
    return Response(
        content=np.ascontiguousarray(trace, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )
```

with:

```python
    return frames_response(trace)
```

`arena/workshop/evaluations.py`:
- After `from ..timeline import load_timeline, sound_of`, add `from ..trace import as_ducks`.
- In `_measure`, after `result = evaluate(event, load_policy(onnx), timeline)`, add `trace = as_ducks(result.trace)`.
- Replace the `"trace_b64"` line with:

```python
        # Every duck's frames, one duck after another, as the Arena serves a trace.
        "ducks": len(trace),
        "trace_b64": base64.b64encode(trace.astype("<f4").tobytes()).decode("ascii"),
```

Then check that every Python reader of a stored trace goes through the new shape: `grep -rn "decode_settle\|import decode\|_frames(" arena` must list only `arena/trace.py`, `arena/web/routes_read.py` and `arena/web/routes_vote.py`.

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_trace.py tests/test_routes_trace.py tests/test_routes_vote.py tests/test_stage.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests --ignore=tests/workshop`
Expected: PASS. `test_routes_submit` reads `X-Frame-Count` of fresh entries.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/trace.py arena/stage.py arena/web/routes_read.py arena/web/routes_vote.py arena/workshop/evaluations.py tests/test_trace.py tests/test_routes_trace.py tests/test_routes_vote.py tests/test_stage.py tests/workshop/test_evaluations.py tests/workshop/test_performance.py
/usr/bin/git commit -m "A trace can carry a troupe: stored as ducks of frames, served duck after duck with X-Duck-Count, and every trace stored before reads as one duck"
```

---

### Task 4: Several ducks share one physics

**Files:**
- Modify: `arena/course.py`, `arena/runner.py`, `arena/evaluate.py`, `arena/cli.py`, `arena/workshop/evaluations.py`
- Create: `tests/legacy_stage.py`
- Test: `tests/test_run_stage.py`, `tests/test_course.py`, `tests/test_runner.py`, `tests/test_evaluate_stage.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes:
  - Task 2's `Start` and `Timeline`.
  - Task 3's `summaries`. `encode` already takes the 3-D traces this task produces.
- Produces:
  - `duck_prefix(k)` in `arena/course.py`: `""` for 0, `"duck{k}/"` otherwise.
  - `compile_stage(manifest, layout)` in `arena/course.py`, where `layout` is `(rig, Start)` per duck. Duck 0 is built exactly as `compile_course` builds a lone duck, in its own rig. The others are attached under their prefix. The STAND keyframe holds every duck at its start.
  - `Performer(policy, rig, start, timeline)` and `run_stage(manifest, cast, seed)` in `arena/runner.py`. A stage's `RunOutcome.trace` is `(ducks, frames, TRACE_WIDTH)`, and its `.settle` is `(ducks, settle steps + 1, TRACE_WIDTH)`.
  - `run_once` runs on the same machinery with one duck. It is unchanged in signature, behaviour and its 2-D trace.
  - `evaluate(manifest, policy, timeline=None)` keeps its signature (Task 5 changes it). For a stage it plays `(Performer(policy, manifest.rig, Start(), timeline),)` and returns the 3-D trace and settle.
  - `arena score` on a stage prints one `duck k: fell … · seated … · standing …` line per duck.
  - The workshop body's `"stage"` is `summaries(...)[0]` (Task 13 makes it the list).
  - Streams: duck 0 keeps `seed_rng(event, seed)` and `[crc32(event), seed, 1]`. Duck k ≥ 1 uses `[crc32(event), seed, 2, k]` and `[crc32(event), seed, 3, k]`. The start's yaw noise is added to the duck's own yaw.

- [ ] **Step 1: Write the failing tests**

Create `tests/legacy_stage.py`: today's single-duck stage path, verbatim, as the reference a troupe of one must equal. Build it from main's runner with this exact command, run from the worktree root (no globs, no shell variables):

```bash
{ cat <<'EOF'
"""A lone duck's stage performance, as arena/runner.py played it before troupes (main at 3c9ddce).

Copied verbatim and never edited: it is the reference a troupe of one must equal bit for bit
(tests/test_run_stage.py). The model it compiles is arena.course.compile_course's, which
tests/test_course.py holds equal to a troupe of one's.
"""

import zlib
from dataclasses import dataclass

import mujoco
import numpy as np

from arena.actuator import Servos
from arena.constants import (
    ACTION_SCALE,
    CTRL_DT,
    DECIMATION,
    DEFAULT_POSE,
    JOINT_NAMES,
    NUM_JOINTS,
    OBS_SIZE,
    TRACE_WIDTH,
)
from arena.course import compile_course
from arena.manifest import Manifest
from arena.runner import RunOutcome
from arena.timeline import Timeline

EOF
/usr/bin/git show 3c9ddce:arena/runner.py | sed -n '52p'
printf '\n\n'
/usr/bin/git show 3c9ddce:arena/runner.py | sed -n '70,215p'
printf '\n\n'
/usr/bin/git show 3c9ddce:arena/runner.py | sed -n '281,322p'
} > tests/legacy_stage.py
```

The result is 222 lines and holds, unchanged, `_WORLD_DOWN`, `_Addresses`, `seed_rng`, `_observe`, `_perturb`, `_record`, `_step`, `_Sim`, `_start`, `_RESET_WARNINGS`, `_reset_by_mujoco` and `run_stage`. Check it:
- `uv run --no-config --frozen --extra dev ruff check tests/legacy_stage.py` prints `All checks passed!`.
- `sed -n '33p;178p;181p' tests/legacy_stage.py` prints `@dataclass(frozen=True)`, `    return sim, settle` and `# MuJoCo answers a non-finite position, …`.

Replace the whole of `tests/test_run_stage.py` with:

```python
import zlib

import mujoco
import numpy as np
import pytest

from arena import runner
from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, DEFAULT_POSE, NUM_JOINTS, TRACE_WIDTH
from arena.course import SPAWN_HEIGHT_M, duck_prefix
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import Performer, run_once, run_stage
from arena.timeline import Start, Timeline, constant_timeline
from tests import legacy_stage

# Commands a float32 observation holds exactly, so a test can read them back from it.
STILL = (0.0,) * 13
WALK = (0.25,) + (0.0,) * 12
SIT = (0.0,) * 12 + (0.25,)
LOOK = (0.0, 0.0, 0.0, -0.25, 0.0, 0.5, 0.0) + (0.0,) * 6


@pytest.fixture(scope="module")
def talent():
    return load_event("got-a-talent")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


class _RecordingPolicy:
    def __init__(self):
        self.observed = []

    def act(self, obs):
        self.observed.append(obs.copy())
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def alone(policy, timeline) -> tuple[Performer, ...]:
    """A lone duck on the legs rig at the centre: what every stage entry was before troupes."""
    return (Performer(policy, "legs", Start(), timeline),)


def test_a_stage_plays_exactly_its_duration(talent, walker):
    outcome = run_stage(talent, alone(walker, constant_timeline(STILL, 3.0)), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape == (1, round(3.0 / CTRL_DT), TRACE_WIDTH)
    assert outcome.settle.shape == (1, round(talent.start.settle_s / CTRL_DT) + 1, TRACE_WIDTH)
    assert outcome.time_s == pytest.approx(3.0)
    assert outcome.progress_m == 0.0 and outcome.start_progress_m == 0.0


def test_a_fall_does_not_stop_a_performance(talent):
    """The same limp policy is a fall on a lane; on a stage it plays to the end."""
    assert run_once(load_event("sprint-2m"), _ZeroPolicy(), seed=1).status == "fall"
    outcome = run_stage(talent, alone(_ZeroPolicy(), constant_timeline(STILL, 3.0)), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape[1] == round(3.0 / CTRL_DT)


def test_each_step_observes_the_command_at_its_time(talent):
    """The settle plays the first keyframe; timed step k plays command_at(k * CTRL_DT).
    A keyframe at 0.3 s is first seen at step 15, although 15 * 0.02 < 0.3 in floating point."""
    first = (0.0,) * 13
    sit = (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6
    look = (0.0, 0.0, 0.0, -0.25, 0.0, 0.0, 0.0) + (0.0,) * 5 + (0.25,)
    timeline = Timeline(1.5, (0.0, 0.3, 1.0), (first, sit, look))
    policy = _RecordingPolicy()
    run_stage(talent, alone(policy, timeline), seed=1)

    settle_steps = round(talent.start.settle_s / CTRL_DT)
    commands = [tuple(float(v) for v in obs[48:61]) for obs in policy.observed]
    assert len(commands) == settle_steps + round(1.5 / CTRL_DT)
    assert set(commands[:settle_steps]) == {first}
    timed = commands[settle_steps:]
    assert timed[14] == first and timed[15] == sit
    assert timed[49] == sit and timed[50] == look
    assert timed[-1] == look


def test_every_duck_plays_its_own_timeline(talent):
    """Two policies, two timelines: each policy only ever reads its own duck's command."""
    star, guest = _RecordingPolicy(), _RecordingPolicy()
    run_stage(talent, (
        Performer(star, "legs", Start(), Timeline(1.0, (0.0, 0.5), (STILL, WALK))),
        Performer(guest, "legs", Start(0.5, 0.0, 0.0), constant_timeline(SIT, 1.0)),
    ), seed=1)
    settle_steps = round(talent.start.settle_s / CTRL_DT)
    assert len(star.observed) == len(guest.observed) == settle_steps + 50
    assert {tuple(float(v) for v in obs[48:61]) for obs in star.observed[settle_steps + 25:]} == {WALK}
    assert {tuple(float(v) for v in obs[48:61]) for obs in guest.observed} == {SIT}


def test_a_stage_run_is_deterministic(talent, walker):
    cast = alone(walker, constant_timeline(STILL, 2.0))
    a = run_stage(talent, cast, seed=1)
    b = run_stage(talent, cast, seed=1)
    assert np.array_equal(a.trace, b.trace)
    assert np.array_equal(a.settle, b.settle)


def test_a_troupe_of_one_plays_bit_for_bit_as_a_lone_duck_did(talent, walker):
    """The troupe path replaced the lone duck's: every performance already published keeps its trace.
    (The settle's first frame starts at x = 0.0 where the lone duck's started at -0.0, the
    keyframe's sign of zero; the two are equal, and the trace that follows is equal to the bit.)"""
    timeline = Timeline(4.0, (0.0, 0.5, 1.5, 2.6), (STILL, WALK, LOOK, SIT))
    before = legacy_stage.run_stage(talent, walker, timeline, seed=1)
    now = run_stage(talent, alone(walker, timeline), seed=1)
    assert (now.status, now.time_s) == (before.status, before.time_s) == ("finish", 4.0)
    assert np.array_equal(now.trace, before.trace[np.newaxis])
    assert now.trace[0].tobytes() == before.trace.tobytes()
    assert np.array_equal(now.settle, before.settle[np.newaxis])


def test_a_mixed_troupe_plays_the_same_twice(talent, walker):
    cast = (
        Performer(walker, "legs", Start(), Timeline(3.0, (0.0, 1.0), (STILL, WALK))),
        Performer(walker, "legs", Start(0.4, -0.6, 90.0), constant_timeline(WALK, 3.0)),
        Performer(walker, "rollers", Start(-0.5, 0.7, -45.0), constant_timeline(STILL, 3.0)),
        Performer(_ZeroPolicy(), "legs", Start(0.0, 1.2, 180.0), constant_timeline(SIT, 3.0)),
    )
    a = run_stage(talent, cast, seed=1)
    b = run_stage(talent, cast, seed=1)
    assert a.status == "finish"
    assert a.trace.shape == (4, round(3.0 / CTRL_DT), TRACE_WIDTH)
    assert a.settle.shape == (4, round(talent.start.settle_s / CTRL_DT) + 1, TRACE_WIDTH)
    assert np.array_equal(a.trace, b.trace)
    assert np.array_equal(a.settle, b.settle)


def test_each_duck_stands_at_its_start_when_the_settle_begins(talent, walker):
    """The first settle frame is the reset pose: each duck's own x and y, the spawn height, and its
    yaw within the event's start perturbation."""
    starts = (Start(), Start(0.4, -0.6, 90.0), Start(-0.5, 0.7, -45.0), Start(0.0, 1.2, 180.0))
    rigs = ("legs", "legs", "rollers", "legs")
    cast = tuple(Performer(walker, rig, start, constant_timeline(STILL, 0.1)) for rig, start in zip(rigs, starts))
    first = run_stage(talent, cast, seed=1).settle[:, 0]
    for k, start in enumerate(starts):
        np.testing.assert_allclose(first[k, 0:3], [start.x, start.y, SPAWN_HEIGHT_M], atol=1e-6, err_msg=k)
        yaw = np.degrees(2 * np.arctan2(first[k, 6], first[k, 3]))
        assert abs((yaw - start.yaw_deg + 180.0) % 360.0 - 180.0) <= talent.start.yaw_deg + 1e-3, k


def test_two_ducks_walked_into_each_other_touch(talent, walker, monkeypatch):
    """One physics: the robots' collision geoms meet like any others."""
    touched, real_step = set(), runner._step

    def watching(model, data, ducks, commands):
        real_step(model, data, ducks, commands)
        trunks = {int(model.body(f"{duck_prefix(k)}trunk_base").id): k for k in range(len(ducks))}
        for pair in zip(data.contact.geom1, data.contact.geom2):
            a, b = (trunks.get(int(model.body_rootid[model.geom_bodyid[g]])) for g in pair)
            if a is not None and b is not None and a != b:
                touched.add((min(a, b), max(a, b)))

    monkeypatch.setattr(runner, "_step", watching)
    run_stage(talent, (
        Performer(walker, "legs", Start(-0.15, 0.0, 0.0), constant_timeline(WALK, 2.0)),
        Performer(walker, "legs", Start(0.15, 0.0, 180.0), constant_timeline(WALK, 2.0)),
    ), seed=1)
    assert touched == {(0, 1)}


def test_duck_0_keeps_a_lone_ducks_streams_and_the_others_have_their_own(talent, walker, monkeypatch):
    """Duck 0's perturbation is seed_rng's and its delays [crc, seed, 1], so a troupe never changes the
    star's start; duck k's are [crc, seed, 2, k] and [crc, seed, 3, k]."""
    delays, real_servos = [], runner.Servos

    def recording(model, dof, act, rng):
        delays.append(rng.bit_generator.state)
        return real_servos(model, dof, act, rng)

    monkeypatch.setattr(runner, "Servos", recording)
    timeline = constant_timeline(STILL, 0.1)
    troupe = run_stage(talent, (
        Performer(walker, "legs", Start(), timeline),
        Performer(walker, "legs", Start(0.5, 0.0, 30.0), timeline),
    ), seed=1)
    crc = zlib.crc32(b"got-a-talent")
    assert delays == [np.random.default_rng(seq).bit_generator.state for seq in ([crc, 1, 1], [crc, 1, 3, 1])]
    lone = legacy_stage.run_stage(talent, walker, timeline, seed=1)
    assert np.array_equal(troupe.settle[0, 0], lone.settle[0])
    noise = np.random.default_rng([crc, 1, 2, 1]).uniform(-talent.start.joint_rad, talent.start.joint_rad, NUM_JOINTS)
    np.testing.assert_array_equal(troupe.settle[1, 0, 7:], (DEFAULT_POSE + noise).astype(np.float32))


def test_a_simulation_mujoco_had_to_reset_ends_the_whole_troupes_performance(talent, walker, monkeypatch, tmp_path):
    """MuJoCo answers a non-finite state by resetting to the model's defaults and carrying on: the
    state stays finite, and only its warning counters say the performance diverged. The physics is
    shared, so every duck's trace stops there."""
    # MuJoCo logs the warning to MUJOCO_LOG.TXT in the working directory.
    monkeypatch.chdir(tmp_path)

    real_step, real_mj_step, calls, armed = runner._step, mujoco.mj_step, [], []

    def counting(*args):
        calls.append(None)
        if len(calls) == 25 + 40:  # the settle's 25 steps, then the 40th timed step
            armed.append(True)
        return real_step(*args)

    def exploding(model, data):
        if armed:
            armed.clear()
            data.qvel[:] = 1e200  # inside MuJoCo's own step, past mjMAXVAL: a solver explosion
        return real_mj_step(model, data)

    monkeypatch.setattr(runner, "_step", counting)
    monkeypatch.setattr(mujoco, "mj_step", exploding)
    outcome = run_stage(talent, (
        Performer(walker, "legs", Start(), constant_timeline(STILL, 3.0)),
        Performer(walker, "rollers", Start(0.5, 0.5, 0.0), constant_timeline(STILL, 3.0)),
    ), seed=1)
    assert (outcome.status, outcome.time_s) == ("fall", None)
    assert outcome.trace.shape == (2, 39, TRACE_WIDTH)  # the steps played before it, never the reset pose
```

`tests/test_course.py`: extend the `arena.course` import with `compile_stage` and `duck_prefix` (alphabetical, after `compile_course`), add `from arena.timeline import Start` after `from arena.manifest import load_event`, and append:

```python


def test_duck_0_has_a_lone_ducks_names_and_the_others_a_prefix():
    assert [duck_prefix(k) for k in range(3)] == ["", "duck1/", "duck2/"]


def test_a_troupe_of_one_compiles_to_a_lone_ducks_stage():
    """Every array of the model is the one a stage always compiled, so a troupe of one plays as a lone duck did."""
    talent = load_event("got-a-talent")
    lone, troupe = compile_course(talent), compile_stage(talent, [("legs", Start())])
    assert (troupe.nq, troupe.nbody, troupe.ngeom, troupe.nu) == (lone.nq, lone.nbody, lone.ngeom, lone.nu)
    for field in dir(lone):
        value = getattr(lone, field)
        if isinstance(value, np.ndarray):
            np.testing.assert_array_equal(getattr(troupe, field), value, err_msg=field)
    assert troupe.opt.integrator == lone.opt.integrator
    assert (troupe.opt.iterations, troupe.opt.ls_iterations) == (lone.opt.iterations, lone.opt.ls_iterations)


def test_duck_0_is_built_in_its_own_rig():
    model = compile_stage(load_event("got-a-talent"), [("rollers", Start())])
    assert model.joint("passive_LF_wheel").id >= 0


LAYOUT = [("legs", Start()), ("rollers", Start(0.4, -0.6, 90.0)), ("legs", Start(-0.5, 0.7, -45.0))]


def test_a_troupe_is_one_model_with_every_duck_under_its_prefix():
    model = compile_stage(load_event("got-a-talent"), LAYOUT)
    assert model.nu == 3 * 14
    for k, (rig, _) in enumerate(LAYOUT):
        prefix = duck_prefix(k)
        for name in JOINT_NAMES:
            assert model.joint(prefix + name).id >= 0, prefix + name
            assert model.actuator(prefix + name).id >= 0, prefix + name
        assert model.sensor(f"{prefix}imu_ang_vel").id >= 0
        assert model.body(f"{prefix}trunk_base").id >= 0
    assert model.joint("duck1/passive_LF_wheel").id >= 0
    with pytest.raises(KeyError):
        model.joint("duck2/passive_LF_wheel")
    assert model.nkey == 1 and model.key_qpos.shape == (1, model.nq)
    np.testing.assert_array_equal(model.key_ctrl[0], np.zeros(model.nu))


def test_the_keyframe_holds_every_duck_at_its_start():
    model = compile_stage(load_event("got-a-talent"), LAYOUT)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    for k, (_, start) in enumerate(LAYOUT):
        prefix = duck_prefix(k)
        free = int(model.joint(f"{prefix}trunk_base_freejoint").qposadr[0])
        half = np.radians(start.yaw_deg) / 2
        np.testing.assert_allclose(
            data.qpos[free : free + 7], [start.x, start.y, SPAWN_HEIGHT_M, np.cos(half), 0, 0, np.sin(half)],
            atol=1e-12, err_msg=prefix,
        )
        for i, name in enumerate(JOINT_NAMES):
            assert data.qpos[model.joint(prefix + name).qposadr[0]] == DEFAULT_POSE[i], prefix + name
    assert data.qpos[model.joint("duck1/passive_LF_wheel").qposadr[0]] == 0.0


def test_every_ducks_servos_are_torque_motors_with_bams_parameters():
    """The grafted robots are converted exactly as a lone duck's."""
    model = compile_stage(load_event("got-a-talent"), LAYOUT)
    for k in range(len(LAYOUT)):
        for name in JOINT_NAMES:
            act, dof = model.actuator(duck_prefix(k) + name).id, int(model.joint(duck_prefix(k) + name).dofadr[0])
            assert model.actuator_gaintype[act] == mujoco.mjtGain.mjGAIN_FIXED
            assert model.actuator_gainprm[act][0] == pytest.approx(1.0)
            assert model.actuator_biastype[act] == mujoco.mjtBias.mjBIAS_NONE
            assert model.actuator_forcerange[act] == pytest.approx((-FORCE_LIMIT, FORCE_LIMIT))
            assert model.actuator_ctrllimited[act] == 0
            assert model.dof_armature[dof] == pytest.approx(ARMATURE)
            assert model.dof_damping[dof] == pytest.approx(0.0)
            assert model.dof_frictionloss[dof] == pytest.approx(0.0)
            assert model.dof_solref[dof] == pytest.approx(SOLREF_FRICTION)
            assert model.dof_solimp[dof] == pytest.approx(SOLIMP_FRICTION)
```

`tests/test_runner.py`: the runner's internals now take a duck. Make four changes:

1. Change the import to `from arena.runner import _Addresses, _Duck, _step, run_once, seed_rng`.

2. In `test_the_actor_sees_joint_velocity_one_step_old`, replace from `adr = _Addresses.of(model, sprint.start.keyframe)` through the third `_step(...)` call with:

```python
    adr = _Addresses.of(model, sprint.start.keyframe, "")
    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    servos = Servos(model, adr.dof, adr.act, np.random.default_rng(0))
    command = np.asarray(sprint.command, dtype=np.float64)

    policy = _RecordingPolicy()
    duck = _Duck(data, adr, servos, policy)
    qvel_before_first_substeps = data.qvel[adr.dof].copy()
    _step(model, data, [duck], [command])
    qvel_before_second_substeps = data.qvel[adr.dof].copy()
    _step(model, data, [duck], [command])
    _step(model, data, [duck], [command])
```

3. In `test_a_control_step_drives_the_servos_a_fifth_time_before_its_forward_pass`:
   - Replace `adr = _Addresses.of(model, sprint.start.keyframe)` with `adr = _Addresses.of(model, sprint.start.keyframe, "")`.
   - Replace the `_step(...)` call (its four lines) with:

```python
    _step(model, data, [_Duck(data, adr, servos, _RecordingPolicy())], [command])
```

4. In `test_the_reset_drives_the_servos_toward_the_zero_pose_first`, replace:

```python
    adr = _Addresses.of(model, sprint.start.keyframe)
    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    runner._perturb(data, adr, sprint, 1)
```

with:

```python
    adr = _Addresses.of(model, sprint.start.keyframe, "")
    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    runner._perturb(data, adr, sprint, seed_rng(sprint.id, 1), 0.0)
```

`tests/test_evaluate_stage.py`:
- Add `TRACE_WIDTH` to the `arena.constants` import.
- In `test_an_entry_without_a_timeline_plays_the_events_command_for_20_s`, replace `assert result.trace.shape[0] == round(20.0 / CTRL_DT)` with:

```python
    # A troupe of one: the entry's own policy, alone at the centre.
    assert result.trace.shape == (1, round(20.0 / CTRL_DT), TRACE_WIDTH)
    assert result.settle.shape == (1, round(talent.start.settle_s / CTRL_DT) + 1, TRACE_WIDTH)
```

- Replace `assert result.trace.shape[0] == 100` with `assert result.trace.shape == (1, 100, TRACE_WIDTH)`.
- Replace `assert result.trace.shape[0] == 50` with `assert result.trace.shape == (1, 50, TRACE_WIDTH)`.

`tests/test_cli.py`: in `test_score_on_a_stage_summarises_the_performance`, replace its two `re.fullmatch` lines with:

```python
    # One line per duck: a version 1 timeline is a troupe of one.
    assert len(lines) == 2
    assert re.fullmatch(r"duck 0: fell (no|at \d+\.\d\d s) · seated \d+\.\d s · standing \d+\.\d s", lines[1])
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_run_stage.py tests/test_course.py tests/test_runner.py tests/test_evaluate_stage.py tests/test_cli.py`

Expected: FAIL.
- Collection stops on `ImportError: cannot import name 'Performer' from 'arena.runner'`, on `'compile_stage' from 'arena.course'` and on `'_Duck' from 'arena.runner'`.
- `test_evaluate_stage` and `test_cli` fail on the shapes and on the `duck 0:` line.

- [ ] **Step 3: Implement the model**

`arena/course.py`:

1. Append to the module docstring, after "…disagree on purpose.":

```

A stage holds a troupe (`compile_stage`): one robot per duck in one model, so
they share one physics and can push each other.
```

2. Replace the imports with:

```python
import dataclasses
import math
import xml.etree.ElementTree as ET
from collections.abc import Sequence

import mujoco
import numpy as np

from .actuator import ARMATURE, FORCE_LIMIT, SOLIMP_FRICTION, SOLREF_FRICTION
from .assets import ASSET_ROOT
from .constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from .manifest import Manifest
from .timeline import Start
```

3. Replace `build_course_xml` and `compile_course` (to the end of the file) with:

```python
def _robot(rig: str) -> tuple[ET.Element, dict[str, bytes]]:
    """A rig's MJCF without its visual geoms, and the meshes its collision geoms use."""
    rig_dir, xml_name = RIG_XML[rig]
    robot_dir = ASSET_ROOT / "robot" / rig_dir
    root = ET.parse(robot_dir / xml_name).getroot()

    _strip_visuals(root)

    # meshdir is cleared so the assets dict can be keyed by bare filename.
    compiler = root.find("compiler")
    compiler.set("meshdir", "")

    asset = root.find("asset")
    files = [m.get("file") for m in asset.findall("mesh")]
    return root, {f: (robot_dir / "assets" / f).read_bytes() for f in files}


def build_course_xml(manifest: Manifest) -> tuple[str, dict[str, bytes]]:
    root, assets = _robot(manifest.rig)
    _sub(root, "option", timestep=TIMESTEP)
    _inject_course(root, manifest)
    _inject_keyframe(root, manifest)
    return ET.tostring(root, encoding="unicode"), assets


def _motorized(xml: str, assets: dict[str, bytes]) -> mujoco.MjSpec:
    """The spec of `xml` with the 14 servos as BAM torque motors.

    The vendored MJCF still describes MuJoCo position servos; converting to
    motors here, as training's `bam.mjlab.BamActuator.edit_spec` does, is what
    lets `arena.actuator.Servos` drive them with real torque instead of the
    sandbox's position gain.
    """
    spec = mujoco.MjSpec.from_string(xml, assets=assets)
    for act in spec.actuators:
        act.set_to_motor()
        act.forcelimited = True
        act.forcerange = (-FORCE_LIMIT, FORCE_LIMIT)
        act.ctrllimited = False
        act.gear = [1.0, 0, 0, 0, 0, 0]
    for joint in spec.joints:
        if joint.name in JOINT_NAMES:
            joint.armature = ARMATURE
            joint.damping = np.zeros((3, 1))
            joint.frictionloss = 0.0
            joint.solref_friction = SOLREF_FRICTION
            joint.solimp_friction = SOLIMP_FRICTION
    return spec


def _compiled(spec: mujoco.MjSpec) -> mujoco.MjModel:
    """The model, with training's solver."""
    model = spec.compile()
    model.opt.integrator = mujoco.mjtIntegrator.mjINT_IMPLICITFAST
    model.opt.iterations = 10
    model.opt.ls_iterations = 20
    return model


def compile_course(manifest: Manifest) -> mujoco.MjModel:
    """Compile the event's model with the 14 servos as BAM torque motors."""
    return _compiled(_motorized(*build_course_xml(manifest)))


def duck_prefix(k: int) -> str:
    """Duck k's names in a stage's model. Duck 0's are a lone duck's own, so a
    troupe of one is the model a stage always compiled; another duck's carry its
    index."""
    return f"duck{k}/" if k else ""


def _yaw_quat(yaw_deg: float) -> list[float]:
    half = math.radians(yaw_deg) / 2
    return [math.cos(half), 0.0, 0.0, math.sin(half)]


def compile_stage(manifest: Manifest, layout: Sequence[tuple[str, Start]]) -> mujoco.MjModel:
    """A stage's model for a troupe: one robot per duck, `(rig, start)` in duck order.

    Duck 0 is built as `compile_course` builds a lone duck, from the same XML
    with the same names (in its own rig), so a troupe of one compiles to the
    model a stage always played. Every other duck is its rig's own MJCF,
    motorized the same way and grafted onto the world under its prefix
    (`duck_prefix`): each robot keeps its MJCF's own contact rules, and two
    robots' collision geoms collide like any others. The keyframe holds every
    duck at its start, at the stage's spawn height (the roller rig's 2 cm-deep
    spawn included), turned by its yaw; attaching left the new ducks' part of it
    at the origin.
    """
    (rig, _), others = layout[0], layout[1:]
    spec = _motorized(*build_course_xml(dataclasses.replace(manifest, rig=rig)))
    for k, (rig, start) in enumerate(others, start=1):
        root, assets = _robot(rig)
        robot = _motorized(ET.tostring(root, encoding="unicode"), assets)
        frame = spec.worldbody.add_frame(pos=[start.x, start.y, 0.0], quat=_yaw_quat(start.yaw_deg))
        spec.attach(robot, prefix=duck_prefix(k), frame=frame)
    model = _compiled(spec)
    pose = model.key_qpos[model.key(manifest.start.keyframe).id]
    for k, (_, start) in enumerate(layout):
        prefix = duck_prefix(k)
        trunk = model.body(f"{prefix}trunk_base").id
        free = model.jnt_qposadr[model.body_jntadr[trunk]]
        pose[free : free + 7] = [start.x, start.y, SPAWN_HEIGHT_M, *_yaw_quat(start.yaw_deg)]
        for name, angle in zip(JOINT_NAMES, DEFAULT_POSE):
            pose[model.joint(prefix + name).qposadr[0]] = angle
    return model
```

- [ ] **Step 4: Implement the shared control step**

Replace the whole of `arena/runner.py` with the code below. Compared with today's file:
- The module docstring gains the troupe paragraph.
- `RunOutcome`'s comments give the stage's shapes.
- `Performer` and `_streams` are new.
- `_Addresses.of` takes a prefix and finds the free joint through the trunk body.
- `_perturb` takes the duck's stream and yaw, and `_record` reads the duck's free joint.
- `_Duck`, the new `_step`, `_Sim` and `_start` hold any number of ducks.
- `run_once` passes a troupe of one.
- `run_stage` takes the cast.

```python
"""Run one policy, on one event, at one seed — or, on a stage, a troupe of them.

No queue, no storage, no HTTP: this narrowness is what makes the determinism and
golden-run tests possible, and those tests are the only thing standing between a
physics change and a silently invalidated leaderboard.

The loop is training's, not the sandbox's: build the 61-D observation with the
actor's joint-velocity slot one control step old, run the policy, drive the BAM
servos (`arena.actuator.Servos`) once per physics substep and once more after
the four substeps, then call `mj_forward` — mirroring mjlab's `sim.forward()`.

Two of those drives are training's own behaviour rather than an idealised loop
(mjlab 1.3.0), and every policy trained under them:

- The fifth drive of a control step. After the substeps, mjlab's `step()`
  (envs/manager_based_rl_env.py) resets the environments that ended and calls
  `scene.write_data_to_sim()` before `sim.forward()` whenever any of them did —
  nearly every step at training's batch size — and that write runs every
  environment's actuator once more on the same target: one more delay-ring
  push, lag draw, friction write, torque write and voltage-sag update.
- The drive at reset. The reset clears the joint targets to 0 rad
  (entity/data.py, `clear_state`), and the reset's own `scene.write_data_to_sim()`
  runs the actuator once on them before `sim.forward()` (`reset()` and the reset
  block of `step()`), which backfills the command-delay ring with zeros: the
  first substeps of a run drive toward 0 rad, not toward the policy's target.
  Training's reset drive reads the forces the previous episode left behind,
  which a single run cannot copy; here a forward pass on the reset pose runs
  first, so the drive reads that pose's own forces — a consistent state.

A stage's troupe shares one physics (`arena.course.compile_stage`): at each
control step every duck observes the same state and its policy acts on its own
command, then each of the four substeps drives every duck's servos before its
one `mj_step`, and every duck's servos are driven a fifth time before the
forward pass. A lone duck, on a lane or a stage, is a troupe of one.
"""

import zlib
from collections.abc import Sequence
from dataclasses import dataclass

import mujoco
import numpy as np

from .actuator import Servos
from .constants import (
    ACTION_SCALE,
    CTRL_DT,
    DECIMATION,
    DEFAULT_POSE,
    JOINT_NAMES,
    NUM_JOINTS,
    OBS_SIZE,
    TRACE_WIDTH,
)
from .course import compile_course, compile_stage, duck_prefix, ramp_dir
from .manifest import Manifest
from .timeline import Start, Timeline

_WORLD_DOWN = np.array([0.0, 0.0, -1.0])


@dataclass(frozen=True)
class RunOutcome:
    seed: int
    status: str  # "finish" | "fall" | "timeout"
    time_s: float | None
    progress_m: float
    # Where the start line landed in course coordinates, after settling. Exposed
    # so a test can assert the clock and the start line agree.
    start_progress_m: float
    # (frames, TRACE_WIDTH) float32 on a lane; (ducks, frames, TRACE_WIDTH) on a stage.
    trace: np.ndarray
    # The untimed settle before the trace: the reset pose, then a frame per
    # settle step, so a replay can start where the simulation did. Shaped as the
    # trace is, with settle steps + 1 frames.
    settle: np.ndarray


@dataclass(frozen=True)
class Performer:
    """One duck of a stage's troupe: its policy, its rig, where it starts, and what it is asked."""

    policy: object  # anything with .act(obs) -> action (arena.policy.Policy)
    rig: str
    start: Start
    timeline: Timeline


@dataclass(frozen=True)
class _Addresses:
    qpos: np.ndarray
    dof: np.ndarray
    act: np.ndarray
    gyro: int
    trunk: int
    # The qpos address of the trunk's free joint: position, then quaternion.
    free: int
    stand_key: int

    @classmethod
    def of(cls, model, keyframe: str, prefix: str) -> "_Addresses":
        """The duck whose names carry `prefix` (arena.course.duck_prefix)."""
        trunk = int(model.body(f"{prefix}trunk_base").id)
        return cls(
            qpos=np.array([int(model.joint(prefix + n).qposadr[0]) for n in JOINT_NAMES]),
            dof=np.array([int(model.joint(prefix + n).dofadr[0]) for n in JOINT_NAMES]),
            act=np.array([int(model.actuator(prefix + n).id) for n in JOINT_NAMES]),
            gyro=int(model.sensor(f"{prefix}imu_ang_vel").adr[0]),
            trunk=trunk,
            free=int(model.jnt_qposadr[model.body_jntadr[trunk]]),
            stand_key=int(model.key(keyframe).id),
        )


def seed_rng(event_id: str, seed: int) -> np.random.Generator:
    """A generator that is identical in every process.

    Python's hash() is salted per process, so it must never appear here: a run
    that is not reproducible cannot be verified, and verification is the whole
    point of running server-side.
    """
    return np.random.default_rng([zlib.crc32(event_id.encode()), seed])


def _streams(event_id: str, seed: int, k: int) -> tuple[np.random.Generator, np.random.Generator]:
    """Duck k's start perturbation and servo command delays, each its own stream.

    Duck 0 keeps a lone duck's — the perturbation `seed_rng`, the delays marked by
    a trailing 1 — so a troupe of one is the run it always was. Every other duck's
    are marked 2 and 3, then its index.
    """
    crc = zlib.crc32(event_id.encode())
    if k == 0:
        return seed_rng(event_id, seed), np.random.default_rng([crc, seed, 1])
    return np.random.default_rng([crc, seed, 2, k]), np.random.default_rng([crc, seed, 3, k])


def _observe(model, data, adr, last_action, command, joint_vel) -> np.ndarray:
    obs = np.empty(OBS_SIZE, dtype=np.float32)
    obs[0:3] = data.sensordata[adr.gyro : adr.gyro + 3]
    # Projected gravity: world -z rotated into the trunk frame. xmat is
    # body->world, so its transpose takes a world vector into the body frame.
    rotation = data.xmat[adr.trunk].reshape(3, 3)
    obs[3:6] = rotation.T @ _WORLD_DOWN
    obs[6:20] = data.qpos[adr.qpos] - DEFAULT_POSE
    obs[20:34] = joint_vel
    obs[34:48] = last_action
    obs[48:61] = command
    return obs


def _perturb(data, adr, manifest, rng, yaw_deg: float) -> None:
    """The start's noise on every joint, and the trunk's heading: the duck's own yaw plus noise."""
    start = manifest.start
    data.qpos[adr.qpos] += rng.uniform(-start.joint_rad, start.joint_rad, NUM_JOINTS)
    yaw = np.radians(yaw_deg + rng.uniform(-start.yaw_deg, start.yaw_deg))
    data.qpos[adr.free + 3 : adr.free + 7] = [np.cos(yaw / 2), 0.0, 0.0, np.sin(yaw / 2)]


def _record(frame: np.ndarray, data, adr) -> None:
    frame[0:7] = data.qpos[adr.free : adr.free + 7]
    frame[7:TRACE_WIDTH] = data.qpos[adr.qpos]


class _Duck:
    """One robot between control steps: where it sits in the model, its servos
    and its policy, and the two things its next observation carries over."""

    def __init__(self, data, adr, servos, policy):
        self.adr, self.servos, self.policy = adr, servos, policy
        self.last_action = np.zeros(NUM_JOINTS, dtype=np.float32)
        # The actor's joint-velocity observation is one control step old — a fixed
        # lag in training (delay_min_lag = delay_max_lag = 1 on its joint_vel term),
        # not a randomisation; the first step uses the reset state's qvel.
        self.prev_qvel = data.qvel[adr.dof].copy()

    def act(self, model, data, command: np.ndarray) -> np.ndarray:
        """Observe, act, and return the target its servos are driven toward this control step.

        The observation's joint velocity is the one recorded a control step ago,
        matching training (mjlab resamples the observation before the servo
        updates its own delayed target, so the two delays are independent). The
        qvel kept for the NEXT step's observation is read here, before any of
        this step's substeps run.
        """
        obs = _observe(model, data, self.adr, self.last_action, command, self.prev_qvel)
        self.prev_qvel = data.qvel[self.adr.dof].copy()
        self.last_action = self.policy.act(obs)
        return DEFAULT_POSE + self.last_action * ACTION_SCALE


def _step(model, data, ducks: Sequence[_Duck], commands: Sequence[np.ndarray]) -> None:
    """One control step of the shared physics: every duck observes the same
    state and acts on its own command; then each substep drives every duck's
    servos before its one mj_step, and every duck's servos are driven once more
    after them (training's post-reset write, see the module docstring) before
    the forward pass."""
    targets = [duck.act(model, data, command) for duck, command in zip(ducks, commands)]
    for _ in range(DECIMATION):
        for duck, target in zip(ducks, targets):
            duck.servos.drive(data, target)
        mujoco.mj_step(model, data)
    for duck, target in zip(ducks, targets):
        duck.servos.drive(data, target)
    mujoco.mj_forward(model, data)


class _Sim:
    """One run's simulation between control steps: the physics, and every duck on it."""

    def __init__(self, model, data, ducks: list[_Duck]):
        self.model, self.data, self.ducks = model, data, ducks

    def step(self, commands: Sequence[np.ndarray]) -> None:
        _step(self.model, self.data, self.ducks, commands)

    def record(self, frames: np.ndarray) -> None:
        """This step's frame of every duck, into `frames`, (ducks, TRACE_WIDTH)."""
        for duck, frame in zip(self.ducks, frames):
            _record(frame, self.data, duck.adr)


def _start(manifest: Manifest, model, policies, yaws_deg, seed: int, commands) -> tuple[_Sim, np.ndarray]:
    """Every run's opening, lane or stage: training's reset of every duck on
    `model` (one policy and one yaw per duck, in duck order), then the untimed
    settle, each duck on its command. Returns the simulation where the clock
    starts, and the settle's frames, (ducks, settle steps + 1, TRACE_WIDTH)."""
    data = mujoco.MjData(model)
    adrs = [_Addresses.of(model, manifest.start.keyframe, duck_prefix(k)) for k in range(len(policies))]
    streams = [_streams(manifest.id, seed, k) for k in range(len(policies))]

    # A fresh Servos per duck every run, constructed BEFORE the reset below: the
    # compiled model is shared across an evaluation's runs (evaluate.py
    # compiles once), Servos writes model.dof_frictionloss / model.dof_damping,
    # and its construction resets them — so nothing in this run sees the
    # friction state the run before it left on the shared model.
    servos = [Servos(model, adr.dof, adr.act, delays) for adr, (_, delays) in zip(adrs, streams)]

    # Training's reset (module docstring): the perturbed pose, a forward pass so
    # the reset drive reads that pose's own forces (training's would read the
    # previous episode's), the servos driven once toward the cleared 0 rad
    # targets, then the forward pass that picks up their torques.
    mujoco.mj_resetDataKeyframe(model, data, adrs[0].stand_key)
    for adr, (perturbation, _), yaw_deg in zip(adrs, streams, yaws_deg):
        _perturb(data, adr, manifest, perturbation, yaw_deg)
    mujoco.mj_forward(model, data)
    for each in servos:
        each.drive(data, np.zeros(NUM_JOINTS))
    mujoco.mj_forward(model, data)

    sim = _Sim(model, data, [_Duck(data, adr, each, policy) for adr, each, policy in zip(adrs, servos, policies)])
    # Settle with the policies running and the clock stopped: nobody is timed on
    # standing up.
    settle_steps = round(manifest.start.settle_s / CTRL_DT)
    settle = np.empty((len(policies), settle_steps + 1, TRACE_WIDTH), dtype=np.float32)
    sim.record(settle[:, 0])
    for step in range(settle_steps):
        sim.step(commands)
        sim.record(settle[:, step + 1])
    return sim, settle


def run_once(manifest: Manifest, policy, seed: int, model=None, command=None) -> RunOutcome:
    # Converted once per run, not per step. The manifest holds an immutable tuple
    # so a loaded event cannot be mutated in place by anything downstream.
    #
    # `command` overrides it for one run, which is how the speed sweep works
    # (see evaluate.py). The event still owns the shape of the command; a caller
    # only gets to say how fast.
    command = np.asarray(manifest.command if command is None else command, dtype=np.float64)
    model = model if model is not None else compile_course(manifest)
    sim, settle = _start(manifest, model, [policy], [0.0], seed, [command])
    data, adr = sim.data, sim.ducks[0].adr

    direction = ramp_dir(manifest.course.slope_deg)
    start_progress = float(direction @ data.qpos[0:3])
    max_steps = round(manifest.time_limit_s / CTRL_DT)
    fall_steps_needed = round(manifest.termination.fall_hold_s / CTRL_DT)

    frames = np.empty((1, max_steps, TRACE_WIDTH), dtype=np.float32)
    tipped_for = 0
    status = "timeout"
    time_s = None
    progress = 0.0
    written = 0

    for step in range(max_steps):
        sim.step([command])
        sim.record(frames[:, written])
        written += 1

        if not np.all(np.isfinite(data.qpos)):
            status = "fall"  # a solver explosion is a fall, not a mystery
            break

        # Fall is judged BEFORE finish, and the order matters. Reaching the fall
        # branch means the robot has been tipped for fall_hold_s — 0.3 s, fifteen
        # straight steps — so a step where both fire is a robot that was already
        # collapsing and slid over the line. That is not a win.
        #
        # This does not penalise a sprinter falling past the tape: such a robot
        # has tipped_for == 0 at the crossing step, so finish still wins there.
        rotation = data.xmat[adr.trunk].reshape(3, 3)
        gravity_z = float((rotation.T @ _WORLD_DOWN)[2])
        tipped_for = tipped_for + 1 if gravity_z > manifest.termination.fall_gravity_z else 0
        if tipped_for >= fall_steps_needed:
            status = "fall"
            break

        progress = float(direction @ data.qpos[0:3]) - start_progress
        if progress >= manifest.course.length_m:
            status = "finish"
            time_s = (step + 1) * CTRL_DT
            break

    return RunOutcome(
        seed=seed,
        status=status,
        time_s=time_s,
        progress_m=progress,
        start_progress_m=start_progress,
        trace=frames[0, :written].copy(),
        settle=settle[0],
    )


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


def _commands(cast: Sequence[Performer], t: float) -> list[np.ndarray]:
    return [np.asarray(p.timeline.command_at(t), dtype=np.float64) for p in cast]


def run_stage(manifest: Manifest, cast: Sequence[Performer], seed: int) -> RunOutcome:
    """Play a troupe on a stage: no line to cross, and no fall stops the performance.

    Every duck plays its own timeline on the shared physics: the settle plays
    its first keyframe; timed step k plays its command at k * CTRL_DT. Only a
    simulation MuJoCo had to reset ends a performance early, the whole troupe's
    since the physics is one: a solver explosion is not a performance, and the
    trace stops before it.
    """
    model = compile_stage(manifest, [(p.rig, p.start) for p in cast])
    policies, yaws_deg = [p.policy for p in cast], [p.start.yaw_deg for p in cast]
    sim, settle = _start(manifest, model, policies, yaws_deg, seed, _commands(cast, 0.0))
    steps = round(cast[0].timeline.duration_s / CTRL_DT)
    frames = np.empty((len(cast), steps, TRACE_WIDTH), dtype=np.float32)
    status, time_s, written = "finish", steps * CTRL_DT, 0
    for step in range(steps):
        sim.step(_commands(cast, step * CTRL_DT))
        if _reset_by_mujoco(sim.data):
            status, time_s = "fall", None
            break
        sim.record(frames[:, written])
        written += 1
    return RunOutcome(
        seed=seed,
        status=status,
        time_s=time_s,
        progress_m=0.0,
        start_progress_m=0.0,  # a stage has no line
        trace=frames[:, :written].copy(),
        settle=settle,
    )
```

- [ ] **Step 5: Hand the troupe of one to its callers**

`arena/evaluate.py`:
- Replace the imports `from .runner import run_once, run_stage` and `from .timeline import Timeline, constant_timeline` with:

```python
from .runner import Performer, run_once, run_stage
from .timeline import Start, Timeline, constant_timeline
```

- In `Evaluation`, replace:

```python
    trace: np.ndarray
    # The trace seed's untimed settle, from the reset pose (see RunOutcome).
    settle: np.ndarray
```

with:

```python
    # (frames, TRACE_WIDTH) for a race; (ducks, frames, TRACE_WIDTH) for a stage.
    trace: np.ndarray
    # The trace seed's untimed settle, from the reset pose, shaped as the trace (see RunOutcome).
    settle: np.ndarray
```

- In `_evaluate_stage`, replace the docstring and the `run_stage` line with:

```python
    """One performance by the entry's policy alone, at the centre: its timeline, or the event's
    command for the whole time limit."""
```

```python
    outcome = run_stage(manifest, (Performer(policy, manifest.rig, Start(), timeline),), seed)
```

`arena/cli.py`: replace `_print_stage` with:

```python
def _print_stage(manifest, result, timeline, name: str | None) -> None:
    played = result.trace.shape[1] * CTRL_DT
    what = f"{name} ({len(timeline.times)} keyframes)" if timeline else "the event's default command"
    if result.seeds_finished:
        print(f"stage: {played:.2f} s played, {what}")
    else:
        print(f"stage: stopped at {played:.2f} s, the simulation diverged; {what}")
    for k, done in enumerate(stage.summaries(result.trace, manifest.termination)):
        fell = "no" if done["fell_at"] is None else f"at {done['fell_at']:.2f} s"
        print(f"duck {k}: fell {fell} · seated {done['seated_s']:.1f} s · standing {done['standing_s']:.1f} s")
```

`arena/workshop/evaluations.py`:
- Replace `from ..stage import summary as stage_summary` with `from ..stage import summaries`.
- Replace `body["stage"] = stage_summary(result.trace, event.termination)` with:

```python
        body["stage"] = summaries(result.trace, event.termination)[0]
```

Then check that the lone-duck path is gone:
- `grep -rn "run_stage(" arena` must list only `arena/evaluate.py` and the definition in `arena/runner.py`.
- `grep -rn "stage_summary\|stage.summary(" arena` must print nothing.

- [ ] **Step 6: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_run_stage.py tests/test_course.py tests/test_runner.py tests/test_evaluate_stage.py tests/test_cli.py tests/test_stage.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests --ignore=tests/workshop`
Expected: PASS. This run includes the golden run (`run_once` now plays a troupe of one) and every stage entry stored with a 3-D trace (`test_routes_submit`, `test_recover`).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add arena/course.py arena/runner.py arena/evaluate.py arena/cli.py arena/workshop/evaluations.py tests/legacy_stage.py tests/test_run_stage.py tests/test_course.py tests/test_runner.py tests/test_evaluate_stage.py tests/test_cli.py
/usr/bin/git commit -m "Several ducks share one physics on the stage, each with its own rig, place, policy and timeline, and a troupe of one plays bit for bit as a lone duck did"
```

- [ ] **Step 8: The old runner's copy goes, its proof kept in history**

`tests/legacy_stage.py` has done its job: the commit above proves, test run included, that a troupe of one plays bit for bit as the lone duck did. A frozen copy of deleted code is not kept. In `tests/test_run_stage.py`:

1. Delete `from tests import legacy_stage`.
2. Delete `test_a_troupe_of_one_plays_bit_for_bit_as_a_lone_duck_did`.
3. In `test_duck_0_keeps_a_lone_ducks_streams_and_the_others_have_their_own`, replace the two lines

```python
    lone = legacy_stage.run_stage(talent, walker, timeline, seed=1)
    assert np.array_equal(troupe.settle[0, 0], lone.settle[0])
```

with

```python
    lone = run_stage(talent, alone(walker, timeline), seed=1)
    assert np.array_equal(troupe.settle[0, 0], lone.settle[0, 0])
```

Then delete `tests/legacy_stage.py`.

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_run_stage.py`
Expected: PASS. `grep -rn "legacy_stage" arena tests` prints nothing.

```bash
/usr/bin/git rm -q tests/legacy_stage.py
/usr/bin/git add tests/test_run_stage.py
/usr/bin/git commit -m "The lone duck's old runner leaves the tests: the troupe path played it bit for bit, and history keeps the proof"
```

---

### Task 5: Borrowed policies are fetched, and a troupe plays

**Files:**
- Create: `arena/cast.py`, `tests/test_cast.py`
- Modify: `arena/hub_fetch.py`, `arena/evaluate.py`, `arena/timeline.py`, `arena/web/routes_submit.py`, `arena/recover.py`, `arena/cli.py`, `arena/workshop/evaluations.py`, `arena/workshop/app.py`, `arena/workshop/challenges.py`
- Test: `tests/test_hub_fetch.py`, `tests/test_cast.py`, `tests/test_evaluate_stage.py`, `tests/test_routes_submit.py`, `tests/test_recover.py`, `tests/test_cli.py`, `tests/test_timeline.py`, `tests/workshop/test_performance.py`, `tests/workshop/test_evaluations.py`

**Interfaces:**
- Consumes:
  - Task 1: `Stage.size_m` and `Stage.max_ducks` (through `load_troupe`).
  - Task 2: `SELF`, `Start` (`to_dict()`), `Duck`, `Troupe` (`references()`), `load_troupe(path, event, *, allow_local=False)`, `solo`, `split_reference`.
  - Task 3: `stage.summaries`, `trace.decode` (3-D), and the `X-Duck-Count` header.
  - Task 4: `Performer(policy, rig, start, timeline)` and `run_stage(manifest, cast, seed)`.
- Produces:
  - `arena/hub_fetch.py`:
    - `FetchedPolicy.troupe: Troupe | None`, which replaces `.timeline`;
    - `FetchedPolicy.rig: str | None`;
    - `FetchedPolicy.borrowed: dict[str, FetchedPolicy]`;
    - `fetch_references(troupe, event, download=…, info=…) -> dict[str, FetchedPolicy]`;
    - `hub_name(fetched) -> str` and `first_duck(troupe, reference) -> str`;
    - `check_manifest`, which on a stage takes legs or rollers per duck.
  - `arena/cast.py`: `Cast(performers, record)`, `cast_of(event, troupe, star, rig, borrowed) -> Cast`, `duck_record(policy, rig, duck) -> dict`, `borrowed_source(fetched, policy) -> dict`, and `load_borrowed(troupe, references) -> dict[str, tuple[FetchedPolicy, Policy]]`.
  - `arena/evaluate.py`: `evaluate(manifest, policy, cast: tuple[Performer, ...] | None = None)`.
  - `arena/timeline.py`: `load_timeline` is gone.

- [ ] **Step 1: Write the failing tests for the fetch, the cast and the evaluation**

`tests/test_hub_fetch.py`, the existing tests:

1. In `test_a_stage_entry_brings_its_timeline_from_the_pinned_revision`, replace the two `fetched.timeline` lines with:

```python
    assert fetched.troupe.duration_s == 4.0
    assert fetched.troupe.ducks[0].timeline.command_at(2.0)[0] == 1.0
    assert fetched.borrowed == {}
```

2. In `test_a_stage_entry_without_a_timeline_plays_the_events_command`, replace the assertion with `assert (fetched.troupe, fetched.timeline_sha256) == (None, None)`.
3. In `test_a_race_never_reads_a_timeline`, replace `assert fetched.timeline is None` with `assert fetched.troupe is None`.

Then add, right after `PERFORMANCE = {…}`:

```python
SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40
ROLLER = "bob/microduck-roller@" + "b" * 40
ROLLERS = GOOD_MANIFEST | {"robot": {"model": "microduck", "accessories": ["rollers"]}}


def _troupe(*policies):
    """A v2 performance: one duck per policy, in a row across the stage, 0.6 m apart."""
    return {"timeline_version": 2, "duration_s": 4.0, "ducks": [
        {"policy": policy, "start": {"x": 0.0, "y": -0.9 + 0.6 * k, "yaw": 0}, "keyframes": [{"t": 0.0}]}
        for k, policy in enumerate(policies)]}
```

Add these rows to the `parametrize` list of `test_a_timeline_the_arena_will_not_play_is_refused_before_the_weights`:

```python
    (_troupe(SITTER), "ducks[0].policy"),
    # An entry's troupe names policies on the Hub: a checkpoint of the author's machine is the workshop's.
    (_troupe("self", "local:got_a_talent/first@1"), "publish it first"),
```

Then append to the file:

```python
def test_on_a_stage_the_entry_stands_on_its_own_rig(tmp_path):
    """A race is run on its event's rig; on a stage each duck brings its own."""
    assert _fetch(tmp_path, ROLLERS, event_id="got-a-talent").rig == "rollers"
    assert _fetch(tmp_path, GOOD_MANIFEST, event_id="got-a-talent").rig == "legs"
    assert _fetch(tmp_path, None, event_id="got-a-talent").rig is None


def test_on_a_stage_a_robot_that_is_neither_legs_nor_rollers_is_refused(tmp_path):
    with pytest.raises(FetchError, match=r"robot 'flyduck' with accessories \[\] is neither"):
        _fetch(tmp_path, GOOD_MANIFEST | {"robot": {"model": "flyduck"}}, event_id="got-a-talent")


class _Hub:
    """A fake Hub of several repos, {repo: {file: content}}; an ONNX's content is None. A repo answers
    at whatever revision is asked, a size is declared only when set in `sizes`, and every download is
    kept as (repo, file, revision)."""

    def __init__(self, tmp_path, repos):
        self.tmp_path, self.repos, self.sizes, self.downloads = tmp_path, repos, {}, []

    def info(self, repo_id, revision):
        if repo_id not in self.repos:
            raise RuntimeError("404 Client Error: Repository Not Found")
        files = list(self.repos[repo_id])
        return files, revision or "sha-of-main", {f: self.sizes.get((repo_id, f)) for f in files}

    def download(self, repo_id, filename, revision):
        self.downloads.append((repo_id, filename, revision))
        content = self.repos[repo_id][filename]
        path = self.tmp_path / repo_id.replace("/", "--") / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("weights" if content is None else content if isinstance(content, str) else json.dumps(content))
        return str(path)

    def fetch(self):
        return fetch_policy("alice/walker", event=load_event("got-a-talent"), download=self.download, info=self.info)


def test_a_troupe_brings_each_borrowed_policy_once_at_its_commit(tmp_path):
    hub = _Hub(tmp_path, {
        "alice/walker": {"policy.onnx": None, "timeline.json": _troupe("self", SITTER, ROLLER, SITTER)},
        # A borrowed repo's own timeline.json is another performance: never read.
        "pollen-robotics/microduck-sitter": {"policy.onnx": None, "manifest.json": GOOD_MANIFEST,
                                             "timeline.json": "{not json"},
        "bob/microduck-roller": {"roller.onnx": None, "manifest.json": ROLLERS},
    })
    fetched = hub.fetch()
    assert list(fetched.borrowed) == [SITTER, ROLLER]
    sitter, roller = fetched.borrowed[SITTER], fetched.borrowed[ROLLER]
    assert (sitter.repo_id, sitter.revision, sitter.filename) == ("pollen-robotics/microduck-sitter", "a" * 40, "policy.onnx")
    assert roller.url == "https://huggingface.co/bob/microduck-roller/resolve/" + "b" * 40 + "/roller.onnx"
    assert (fetched.rig, sitter.rig, roller.rig) == (None, "legs", "rollers")
    assert (sitter.troupe, sitter.borrowed) == (None, {})
    # The entry's timeline first, then each borrowed policy once, and the entry's weights last.
    assert hub.downloads == [
        ("alice/walker", "timeline.json", "sha-of-main"),
        ("pollen-robotics/microduck-sitter", "manifest.json", "a" * 40),
        ("pollen-robotics/microduck-sitter", "policy.onnx", "a" * 40),
        ("bob/microduck-roller", "manifest.json", "b" * 40),
        ("bob/microduck-roller", "roller.onnx", "b" * 40),
        ("alice/walker", "policy.onnx", "sha-of-main"),
    ]


@pytest.mark.parametrize("sitter, reason", [
    (None, "could not read pollen-robotics/microduck-sitter: 404"),
    ({"README.md": "hello"}, "has no .onnx file"),
    ({"policy.onnx": None, "manifest.json": GOOD_MANIFEST | {"kind": "episodic"}}, "kind is 'episodic'"),
    ({"policy.onnx": None, "manifest.json": GOOD_MANIFEST | {"robot": {"model": "flyduck"}}}, "robot 'flyduck'"),
])
def test_a_borrowed_policy_is_refused_naming_the_first_duck_that_plays_it(tmp_path, sitter, reason):
    repos = {"alice/walker": {"policy.onnx": None, "timeline.json": _troupe("self", ROLLER, SITTER, SITTER)},
             "bob/microduck-roller": {"policy.onnx": None}}
    if sitter is not None:
        repos["pollen-robotics/microduck-sitter"] = sitter
    hub = _Hub(tmp_path, repos)
    with pytest.raises(FetchError) as refused:
        hub.fetch()
    assert str(refused.value).startswith("ducks[2]: pollen-robotics/microduck-sitter: ")
    assert reason in str(refused.value)
    assert ("alice/walker", "policy.onnx", "sha-of-main") not in hub.downloads, "the entry's weights wait for its troupe"


def test_a_borrowed_policy_over_the_size_cap_is_refused_before_its_weights(tmp_path):
    from arena.policy import MAX_MODEL_BYTES

    hub = _Hub(tmp_path, {"alice/walker": {"policy.onnx": None, "timeline.json": _troupe("self", SITTER)},
                          "pollen-robotics/microduck-sitter": {"policy.onnx": None}})
    hub.sizes[("pollen-robotics/microduck-sitter", "policy.onnx")] = MAX_MODEL_BYTES + 1
    with pytest.raises(FetchError, match=r"^ducks\[1\]: pollen-robotics/microduck-sitter: .*larger than"):
        hub.fetch()
    assert [name for repo, name, _ in hub.downloads if repo == "pollen-robotics/microduck-sitter"] == []
```

Create `tests/test_cast.py`:

```python
"""A troupe becomes what the runner plays and what the run keeps: each duck its policy, its rig, its
place and its sound, a borrowed one credited to its author."""

import hashlib
from pathlib import Path

import pytest

from arena.assets import ASSET_ROOT
from arena.cast import borrowed_source, cast_of, load_borrowed
from arena.hub_fetch import FetchedPolicy
from arena.manifest import load_event
from arena.policy import PolicyError
from arena.timeline import SELF, Duck, Start, Timeline, Troupe, constant_timeline

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40
ROLLER = "bob/microduck-roller@" + "b" * 40
STILL = Timeline(2.0, (0.0,), ((0.0,) * 13,))
QUACK = Timeline(2.0, (0.0, 1.0), ((0.0,) * 13,) * 2, ((0.0, 0.0), (1.0, 0.0)))


class _Policy:
    """Stands in for a loaded ONNX: a cast only hands it to the runner, and credits its sha256."""

    def __init__(self, sha256):
        self.sha256 = sha256


def _fetched(repo_id, revision, rig=None, manifest=None, path=Path("/tmp/x.onnx")):
    return FetchedPolicy(repo_id=repo_id, filename="policy.onnx", revision=revision, path=path,
                         url=f"https://huggingface.co/{repo_id}/resolve/{revision}/policy.onnx",
                         manifest=manifest, rig=rig)


@pytest.fixture(scope="module")
def talent():
    return load_event("got-a-talent")


def test_each_duck_plays_its_policy_on_its_rig_from_its_place(talent):
    star, sitter, roller = _Policy("s" * 64), _Policy("t" * 64), _Policy("r" * 64)
    troupe = Troupe(2.0, (
        Duck(SELF, Start(), QUACK),
        Duck(ROLLER, Start(0.4, -0.6, 90.0), STILL),
        Duck(SELF, Start(0.0, 0.6, 0.0), STILL),
        Duck(SITTER, Start(-0.4, 0.0, 180.0), STILL),
    ))
    borrowed = {SITTER: (_fetched("pollen-robotics/microduck-sitter", "a" * 40), sitter),
                ROLLER: (_fetched("bob/microduck-roller", "b" * 40, rig="rollers"), roller)}
    performers = cast_of(talent, troupe, star, None, borrowed).performers
    assert [p.policy for p in performers] == [star, roller, star, sitter]
    # One policy per distinct file: both copies of the entry's own play the one loaded once.
    assert performers[0].policy is performers[2].policy
    # A manifest that names no robot stands on the event's rig.
    assert [p.rig for p in performers] == ["legs", "rollers", "legs", "legs"]
    assert [(p.start, p.timeline) for p in performers] == [(d.start, d.timeline) for d in troupe.ducks]


def test_the_entrys_own_ducks_stand_on_its_manifests_rig(talent):
    troupe = Troupe(2.0, (Duck(SELF, Start(), STILL), Duck(SELF, Start(0.0, 0.6, 0.0), STILL)))
    cast = cast_of(talent, troupe, _Policy("s" * 64), "rollers", {})
    assert [p.rig for p in cast.performers] == ["rollers", "rollers"]
    assert [d["rig"] for d in cast.record] == ["rollers", "rollers"]


def test_the_record_places_each_duck_says_how_it_sounds_and_credits_a_borrowed_one(talent):
    troupe = Troupe(2.0, (Duck(SELF, Start(), QUACK), Duck(SITTER, Start(0.0, 0.6, 90.0), STILL)))
    sitter = _fetched("pollen-robotics/microduck-sitter", "a" * 40, manifest={"name": "Sitter"})
    cast = cast_of(talent, troupe, _Policy("s" * 64), None, {SITTER: (sitter, _Policy("t" * 64))})
    assert cast.record == (
        {"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
         "sound": {"triggers": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}},
        {"policy": {"repo_id": "pollen-robotics/microduck-sitter", "filename": "policy.onnx",
                    "revision": "a" * 40,
                    "url": "https://huggingface.co/pollen-robotics/microduck-sitter/resolve/" + "a" * 40 + "/policy.onnx",
                    "model_sha256": "t" * 64, "user": "pollen-robotics", "policy_name": "Sitter"},
         "rig": "legs", "start": {"x": 0.0, "y": 0.6, "yaw": 90.0}, "sound": None},
    )


def test_a_borrowed_policy_without_a_name_goes_by_its_repos():
    assert borrowed_source(_fetched("bob/microduck-roller", "b" * 40), _Policy("r" * 64))["policy_name"] == "roller"


def test_a_stage_entry_without_a_timeline_is_its_own_duck_alone_on_the_events_command(talent):
    star = _Policy("s" * 64)
    cast = cast_of(talent, None, star, None, {})
    (performer,) = cast.performers
    assert (performer.policy, performer.rig, performer.start) == (star, "legs", Start())
    assert performer.timeline == constant_timeline(talent.command, talent.time_limit_s)
    assert cast.record == ({"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0}, "sound": None},)


def test_each_borrowed_policy_is_loaded_beside_the_repo_it_came_from():
    troupe = Troupe(2.0, (Duck(SELF, Start(), STILL), Duck(SITTER, Start(0.0, 0.6, 0.0), STILL)))
    sitter = _fetched("pollen-robotics/microduck-sitter", "a" * 40, path=REFERENCE)
    ((fetched, policy),) = load_borrowed(troupe, {SITTER: sitter}).values()
    assert fetched is sitter
    assert policy.sha256 == hashlib.sha256(REFERENCE.read_bytes()).hexdigest()


def test_a_borrowed_file_that_does_not_load_names_the_first_duck_that_plays_it(tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not a model")
    troupe = Troupe(2.0, (Duck(SELF, Start(), STILL), Duck(SITTER, Start(0.0, 0.6, 0.0), STILL),
                          Duck(SITTER, Start(0.0, -0.6, 0.0), STILL)))
    with pytest.raises(PolicyError, match=r"^ducks\[1\]: pollen-robotics/microduck-sitter: not a loadable ONNX model"):
        load_borrowed(troupe, {SITTER: _fetched("pollen-robotics/microduck-sitter", "a" * 40, path=junk)})
```

`tests/test_evaluate_stage.py`:

1. Add `from arena.runner import Performer` after the `arena.policy` import, and change `from arena.timeline import Timeline` to `from arena.timeline import Start, Timeline`. Every other import stays as it is: `ASSET_ROOT` feeds the walker fixture, and Task 4 already added `TRACE_WIDTH`.

2. Replace `test_a_timeline_sets_the_performance_and_its_length` and `test_a_race_refuses_a_timeline` (Task 4 changed only their shape assertions) with:

```python
def test_a_cast_plays_every_duck_for_the_length_of_its_timeline(talent, walker):
    timeline = Timeline(2.0, (0.0, 1.0), (STILL, (1.0,) + (0.0,) * 12))
    cast = (Performer(walker, "legs", Start(), timeline), Performer(walker, "legs", Start(0.0, 0.6, 90.0), timeline))
    result = evaluate(talent, walker, cast)
    assert result.trace.shape == (2, 100, TRACE_WIDTH)
    assert result.score == pytest.approx(2.0)


def test_a_race_refuses_a_cast(walker):
    with pytest.raises(ValueError, match="race"):
        evaluate(load_event("sprint-2m"), walker, (Performer(walker, "legs", Start(), Timeline(2.0, (0.0,), (STILL,))),))
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_hub_fetch.py tests/test_cast.py tests/test_evaluate_stage.py`
Expected: FAIL, with `ERROR collecting tests/test_cast.py` and `ModuleNotFoundError: No module named 'arena.cast'`.

- [ ] **Step 3: Implement the fetch, the cast and the evaluation**

`arena/hub_fetch.py`:

1. Append this paragraph to the module docstring, after "…A race never reads it.":

```
A stage entry's timeline.json may hold a troupe (version 2) whose other ducks play policies of other
repos, each pinned to a full commit. Each one is read once, at that commit, under the entry's own
rules (the ONNX picked, the declared size capped, the manifest checked), after the entry's timeline
and before the entry's weights. Its own timeline.json is never read: in a troupe, every duck plays
the keyframes the entry gives it. A refusal names the first duck that plays it. On a stage each duck
stands on its own rig, legs or rollers, as its manifest says; a race keeps its event's.
```

2. Replace the imports with:

```python
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from .constants import NUM_JOINTS, OBS_SIZE
from .manifest import RIGS
from .policy import MAX_MODEL_BYTES
from .timeline import LOCAL, TimelineError, Troupe, load_troupe, split_reference
```

3. Replace the `FetchedPolicy` dataclass with the following, and add the two functions after it:

```python
@dataclass(frozen=True)
class FetchedPolicy:
    repo_id: str
    filename: str
    revision: str
    path: Path
    url: str
    # The repo's manifest.json, parsed, or None when it has none.
    manifest: dict | None = None
    # A stage entry's performance (its timeline.json at the same revision), checked: one duck or a
    # troupe. None when the repo has none (the event's own command plays), for a race, which never
    # reads it, and for a borrowed policy, whose own timeline.json no troupe plays.
    troupe: Troupe | None = None
    # The sha256 of that file's bytes: the same weights with another timeline, or beside other
    # ducks, are another entry.
    timeline_sha256: str | None = None
    # The rig its manifest describes (rig_of), or None without one: the event's rig applies.
    rig: str | None = None
    # What a stage entry's other ducks play, by reference, each read at its pinned commit.
    borrowed: dict[str, "FetchedPolicy"] = field(default_factory=dict)


def hub_name(fetched: FetchedPolicy) -> str:
    """The name a Hub policy goes by when nobody typed one: its manifest's, else its repo's."""
    named = str((fetched.manifest or {}).get("name") or "").strip()
    return named or fetched.repo_id.rsplit("/", 1)[-1].removeprefix("microduck-")


def first_duck(troupe: Troupe, reference: str) -> str:
    """How a refusal names a borrowed policy: the first duck that plays it, then its repo."""
    k = next(k for k, duck in enumerate(troupe.ducks) if duck.policy == reference)
    return f"ducks[{k}]: {split_reference(reference)[0]}"
```

4. In `check_manifest`, add "On a stage the robot is each duck's own: legs or rollers." as the docstring's last sentence. Then replace its rig check (the `if robot.get("model") is not None and rig_of(manifest) != event.rig:` block) with:

```python
    if robot.get("model") is not None:
        said = f"robot {robot['model']!r} with accessories {robot.get('accessories') or []}"
        # A race is run on its event's rig. On a stage each duck stands on its own, legs or rollers,
        # beside the others.
        if event.course.kind == "stage":
            if rig_of(manifest) not in RIGS:
                raise FetchError(f"{MANIFEST}: {said} is neither of the robots {event.title} stages, legs or rollers")
        elif rig_of(manifest) != event.rig:
            raise FetchError(f"{MANIFEST}: {said} is not the {event.rig} robot {event.title} races")
```

5. Replace everything from `def _read_timeline` to the end of the file with:

```python
def _read_troupe(repo_id: str, revision: str, download, event) -> tuple[Troupe, str]:
    try:
        path = Path(download(repo_id, TIMELINE, revision))
    except Exception as exc:
        raise FetchError(f"could not download {repo_id}/{TIMELINE}: {exc}") from exc
    try:
        troupe = load_troupe(path, event)
    except TimelineError as exc:
        raise FetchError(f"{repo_id}/{TIMELINE} cannot be played: {exc}") from exc
    return troupe, hashlib.sha256(path.read_bytes()).hexdigest()


def _checked(repo_id: str, wanted: str | None, revision: str | None, event, download, info):
    """Everything about a repo but its weights: the commit its listing comes from, the ONNX picked,
    its declared size within the cap, its manifest checked. Returns the listing, that commit, the
    ONNX's name and the manifest (or None)."""
    try:
        files, sha, sizes = info(repo_id, revision)
    except FetchError:
        raise
    except Exception as exc:
        raise FetchError(f"could not read {repo_id}: {exc}") from exc
    # Every file is read at the commit the listing came from, so the manifest
    # checked and the weights raced are one publication, not two.
    pinned = sha or revision or "main"

    filename = _pick(list(files), wanted, repo_id)

    # Refused BEFORE downloading anything: a declared size over the cap costs
    # nothing to reject. A missing (None) size is not evidence of a large
    # file, so it is not grounds for refusal — `load_policy` still checks the
    # actual bytes once they exist, downstream.
    size = (sizes or {}).get(filename)
    if size is not None and size > MAX_MODEL_BYTES:
        raise FetchError(
            f"{repo_id}/{filename} is {size} bytes, larger than the "
            f"{MAX_MODEL_BYTES} byte limit"
        )

    manifest = _read_manifest(repo_id, pinned, download) if MANIFEST in files else None
    if manifest is not None and event is not None:
        check_manifest(manifest, event)  # before the weights: a refusal costs one small file
    return files, pinned, filename, manifest


def _weights(repo_id: str, filename: str, pinned: str, manifest: dict | None, download,
             **performance) -> FetchedPolicy:
    """The weights at the commit checked, completing the FetchedPolicy; `performance` is a stage
    entry's troupe, its timeline's sha256 and its borrowed policies."""
    try:
        path = Path(download(repo_id, filename, pinned))
    except Exception as exc:
        raise FetchError(f"could not download {repo_id}/{filename}: {exc}") from exc
    return FetchedPolicy(
        repo_id=repo_id,
        filename=filename,
        revision=pinned,
        path=path,
        url=f"https://huggingface.co/{repo_id}/resolve/{pinned}/{filename}",
        manifest=manifest,
        rig=rig_of(manifest) if manifest is not None else None,
        **performance,
    )


def fetch_policy(
    repo_ref: str,
    revision: str | None = None,
    event=None,
    download=_default_download,
    info=_default_info,
) -> FetchedPolicy:
    repo_id, wanted = parse_repo_ref(repo_ref)
    files, pinned, filename, manifest = _checked(repo_id, wanted, revision, event, download, info)
    if event is None or event.course.kind != "stage" or TIMELINE not in files:
        return _weights(repo_id, filename, pinned, manifest, download)
    # Before the weights too: a performance the Arena will not play costs one small file, and a
    # borrowed policy it cannot have costs that policy's files, never the entry's weights.
    troupe, timeline_sha256 = _read_troupe(repo_id, pinned, download, event)
    borrowed = fetch_references(troupe, event, download, info)
    return _weights(repo_id, filename, pinned, manifest, download,
                    troupe=troupe, timeline_sha256=timeline_sha256, borrowed=borrowed)


def fetch_references(troupe: Troupe, event, download=_default_download, info=_default_info) -> dict[str, FetchedPolicy]:
    """Every policy a troupe borrows, by reference: read once however many ducks play it, at its pinned
    commit, under the entry's own rules, its weights last. Its own timeline.json is never read. A
    refusal names the first duck that plays it."""
    borrowed = {}
    for reference in troupe.references():
        if reference.startswith(LOCAL):
            continue  # a checkpoint of the workshop's own machine: it plays from there, never the Hub
        repo_id, commit = split_reference(reference)
        try:
            _, pinned, filename, manifest = _checked(repo_id, None, commit, event, download, info)
            borrowed[reference] = _weights(repo_id, filename, pinned, manifest, download)
        except FetchError as exc:
            raise FetchError(f"{first_duck(troupe, reference)}: {exc}") from exc
    return borrowed
```

Create `arena/cast.py`:

```python
"""Who performs on a stage: every duck of a troupe, the policy it plays and the rig it stands on.

A troupe (arena/timeline.py) names each duck's policy: "self", the entered repo's own, or another
repo's, pinned to a commit and read by arena/hub_fetch.py. A cast is that troupe made playable and
recordable: one Performer per duck for the runner, and one entry per duck for `RunRecord.cast` —
whose policy it plays (a borrowed one credited to its author), its rig, where it starts on the stage
and how it is heard (arena.timeline.sound_of).

Each distinct policy is one Policy, shared by every duck that plays it: three copies of "self" run
one ONNX session, which keeps nothing from one call to the next.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from .hub_fetch import FetchedPolicy, first_duck, hub_name
from .manifest import Manifest
from .policy import Policy, PolicyError, load_policy
from .runner import Performer
from .timeline import SELF, Duck, Troupe, constant_timeline, solo, sound_of


@dataclass(frozen=True)
class Cast:
    performers: tuple[Performer, ...]
    # RunRecord.cast, in duck order.
    record: tuple[dict, ...]


def borrowed_source(fetched: FetchedPolicy, policy: Policy) -> dict:
    """How a run credits a borrowed duck: the repo at its commit, the weights' sha256, the author (the
    repo's owner) and the policy's name. Credit only: votes and points are the entrant's."""
    return {
        "repo_id": fetched.repo_id,
        "filename": fetched.filename,
        "revision": fetched.revision,
        "url": fetched.url,
        "model_sha256": policy.sha256,
        "user": fetched.repo_id.split("/", 1)[0],
        # Capped as an entry's own name is: another author's text, on a shared board.
        "policy_name": hub_name(fetched)[:80],
    }


def load_borrowed(troupe: Troupe | None, references: Mapping[str, FetchedPolicy]) -> dict[str, tuple[FetchedPolicy, Policy]]:
    """Every borrowed policy loaded, once however many ducks play it, beside the repo it came from. A
    file that does not load is refused as a fetch is, naming the first duck that plays it. A stage
    entry without a timeline borrows nothing."""
    borrowed = {}
    for reference, fetched in references.items():
        try:
            borrowed[reference] = (fetched, load_policy(fetched.path))
        except PolicyError as exc:
            raise PolicyError(f"{first_duck(troupe, reference)}: {exc}") from exc
    return borrowed


def duck_record(policy, rig: str, duck: Duck) -> dict:
    """How a run keeps one duck: whose policy it plays (`policy`, as the caller credits it), its rig,
    where it starts and how it is heard."""
    return {"policy": policy, "rig": rig, "start": duck.start.to_dict(), "sound": sound_of(duck.timeline)}


def cast_of(event: Manifest, troupe: Troupe | None, star: Policy, rig: str | None,
            borrowed: Mapping[str, tuple[FetchedPolicy, Policy]]) -> Cast:
    """A stage entry's cast. `star` plays every "self" duck, on `rig` (its manifest's, or None for the
    event's); each borrowed duck plays its own loaded policy, on its manifest's rig or the event's.
    Without a troupe the entry plays alone at the centre: the event's own command, for its whole
    time limit."""
    troupe = troupe or solo(constant_timeline(event.command, event.time_limit_s))
    performers, record = [], []
    for duck in troupe.ducks:
        if duck.policy == SELF:
            policy, duck_rig, credit = star, rig or event.rig, SELF
        else:
            fetched, policy = borrowed[duck.policy]
            duck_rig, credit = fetched.rig or event.rig, borrowed_source(fetched, policy)
        performers.append(Performer(policy, duck_rig, duck.start, duck.timeline))
        record.append(duck_record(credit, duck_rig, duck))
    return Cast(tuple(performers), tuple(record))
```

`arena/evaluate.py`:

1. In the module docstring, replace "it plays the entry's command timeline once, on one seed," with "it plays the entry's cast once (every duck of its troupe, arena/cast.py), on one seed,".
2. Change the imports to `from .runner import Performer, run_once, run_stage` and `from .timeline import Start, constant_timeline`.
3. Replace the head of `evaluate`, up to and including the race guard (`if timeline is not None: raise ValueError(...)`), with:

```python
def evaluate(manifest: Manifest, policy, cast: tuple[Performer, ...] | None = None) -> Evaluation:
    if manifest.course.kind == "stage":
        return _evaluate_stage(manifest, policy, cast)
    if cast is not None:
        raise ValueError(f"{manifest.id} is a race: it races the entry alone, on the event's command")
```

4. Replace `_evaluate_stage`'s signature, its docstring and every line before `seed = manifest.seeds[0]` with:

```python
def _evaluate_stage(manifest: Manifest, policy, cast: tuple[Performer, ...] | None) -> Evaluation:
    """One performance: the cast, or the entry alone at the centre on the event's command for the
    whole time limit."""
    if cast is None:
        cast = (Performer(policy, manifest.rig, Start(), constant_timeline(manifest.command, manifest.time_limit_s)),)
```

The next line, `seed = manifest.seeds[0]`, stays as it is. Replace Task 4's `outcome = run_stage(manifest, (Performer(policy, manifest.rig, Start(), timeline),), seed)` with `outcome = run_stage(manifest, cast, seed)`. The rest of the function stays.

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_hub_fetch.py tests/test_cast.py tests/test_evaluate_stage.py`
Expected: PASS, every test.

- [ ] **Step 5: Write the failing tests for every caller**

`tests/test_routes_submit.py`:

1. Change `from arena.timeline import Timeline` to:

```python
from arena.timeline import SELF, Duck, Start, Timeline, Troupe, solo
```

2. Replace the `_TIMELINES` comment with `# A repo id registered here also carries this timeline.json, as (Troupe, sha256).`.
3. Replace `_fetched` with:

```python
def _fetched(path=REFERENCE, repo_id="alice/walker", filename="policy.onnx", revision="rev1", **more):
    return FetchedPolicy(repo_id=repo_id, filename=filename, revision=revision, path=path,
                         url=f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}", **more)
```

4. In the `hub` fixture's `fetch`, replace the last three lines with:

```python
        troupe, digest = _TIMELINES.get(repo_id, (None, None))
        return _fetched(path=_HUB[repo_id], repo_id=repo_id, revision=revision or "rev1",
                        troupe=troupe, timeline_sha256=digest)
```

5. Replace `performance` with:

```python
def performance(seconds, sit_at=None):
    """A one-duck performance of `seconds` standing, sitting from `sit_at` when given."""
    stand, sit = (0.0,) * 13, (1.0,) + (0.0,) * 12
    if sit_at is None:
        return solo(Timeline(seconds, (0.0,), (stand,)))
    return solo(Timeline(seconds, (0.0, sit_at), (stand, sit)))
```

6. In `test_a_stage_entry_keeps_the_sound_its_timeline_makes`, wrap `pulled` in `solo(...)`.
7. Append:

```python
SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40


def _troupe(seconds=1.0):
    """The entry's own duck at the centre, and the sitter borrowed beside it."""
    still = Timeline(seconds, (0.0,), ((0.0,) * 13,))
    return Troupe(seconds, (Duck(SELF, Start(), still), Duck(SITTER, Start(0.0, 0.6, 90.0), still)))


def _with_a_borrowed(monkeypatch, path=REFERENCE):
    lent = _fetched(path=path, repo_id="pollen-robotics/microduck-sitter", revision="a" * 40)
    monkeypatch.setattr("arena.web.routes_submit._fetch_from_hub", lambda repo_id, revision, event: _fetched(
        troupe=_troupe(), timeline_sha256="e" * 64, borrowed={SITTER: lent}))


def test_a_troupe_plays_its_borrowed_ducks_beside_the_entrys_own(api, monkeypatch):
    _with_a_borrowed(monkeypatch)
    response = api.post("/api/events/got-a-talent/submit", data={"repo_id": "alice/walker"})
    assert response.status_code == 200, response.text
    body = response.json()
    trace = api.get(f"/api/runs/{body['run_id']}/trace")
    assert (trace.headers["X-Duck-Count"], trace.headers["X-Frame-Count"]) == ("2", "50")


def test_a_borrowed_policy_that_does_not_load_is_a_400_naming_its_duck(api, monkeypatch, tmp_path, store_dir):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not a model")
    _with_a_borrowed(monkeypatch, path=junk)
    response = api.post("/api/events/got-a-talent/submit", data={"repo_id": "alice/walker"})
    assert response.status_code == 400
    assert response.json()["detail"].startswith("ducks[1]: pollen-robotics/microduck-sitter: not a loadable ONNX model")
    assert list(store_dir.rglob("*.json")) == []
```

`tests/test_recover.py`:

1. In `test_recover_plays_a_stage_entry_with_its_timeline_at_the_listed_revision`, change the import to `from arena.timeline import Timeline, solo`. In the fake, replace `timeline=Timeline(…),` with `troupe=solo(Timeline(2.0, (0.0, 1.0), ((0.0,) * 13,) * 2, ((0.0, 1.0), (0.0, 0.0)))),`.
2. Append:

```python
SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40
TALENT_LISTED = (listing(("alice/talent", "rev7")),
                 manifests({"alice/talent": arena_manifest(arena={"event": "got-a-talent"})}))


def test_recover_plays_a_troupe_with_its_borrowed_policies(tmp_path, monkeypatch):
    from arena import trace as trace_codec
    from arena.assets import ASSET_ROOT
    from arena.hub_fetch import FetchedPolicy
    from arena.manifest import load_event
    from arena.recover import recover
    from arena.store import LocalStore
    from arena.timeline import SELF, Duck, Start, Timeline, Troupe

    walker = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
    still = Timeline(1.0, (0.0,), ((0.0,) * 13,))

    def fetch_policy(repo_id, revision=None, event=None):
        return FetchedPolicy(
            repo_id=repo_id, filename="policy.onnx", revision=revision, path=walker,
            url=f"https://huggingface.co/{repo_id}/resolve/{revision}/policy.onnx",
            troupe=Troupe(1.0, (Duck(SELF, Start(), still), Duck(SITTER, Start(0.0, 0.6, 90.0), still))),
            timeline_sha256="t" * 64,
            borrowed={SITTER: FetchedPolicy(
                repo_id="pollen-robotics/microduck-sitter", filename="policy.onnx", revision="a" * 40, path=walker,
                url="https://huggingface.co/pollen-robotics/microduck-sitter/resolve/" + "a" * 40 + "/policy.onnx")},
        )

    monkeypatch.setattr("arena.hub_fetch.fetch_policy", fetch_policy)
    store = LocalStore(tmp_path)
    [record] = recover(store, [load_event("got-a-talent")], reader=TALENT_LISTED)
    assert trace_codec.decode(store.trace(record.run_id)).shape[:2] == (2, 50)

```

`tests/test_cli.py` (Task 4 already made `test_score_on_a_stage_summarises_the_performance` read one line per duck): append

```python
SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40


def _troupe(tmp_path):
    """The entry's own duck at the centre, and the sitter borrowed twice, one on each side."""
    path = tmp_path / "timeline.json"
    path.write_text(json.dumps({"timeline_version": 2, "duration_s": 1.0, "ducks": [
        {"policy": "self", "keyframes": [{"t": 0.0}]},
        {"policy": SITTER, "start": {"x": 0.0, "y": 0.6, "yaw": 90}, "keyframes": [{"t": 0.0}]},
        {"policy": SITTER, "start": {"x": 0.0, "y": -0.6, "yaw": -90}, "keyframes": [{"t": 0.0}]},
    ]}))
    return path


def _lend(monkeypatch):
    """Stands in for the Hub: the sitter is the reference walker's weights at its commit. Returns what
    was asked of it, the troupe's references per call."""
    from pathlib import Path

    from arena.hub_fetch import FetchedPolicy

    asked = []

    def fetch_references(troupe, event):
        asked.append(troupe.references())
        return {SITTER: FetchedPolicy(
            repo_id="pollen-robotics/microduck-sitter", filename="policy.onnx", revision="a" * 40,
            path=Path(REFERENCE),
            url="https://huggingface.co/pollen-robotics/microduck-sitter/resolve/" + "a" * 40 + "/policy.onnx")}

    monkeypatch.setattr("arena.cli.fetch_references", fetch_references)
    return asked


def test_score_plays_a_troupe_with_its_borrowed_policies_from_the_hub(tmp_path, capsys, monkeypatch):
    asked = _lend(monkeypatch)
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_troupe(tmp_path))]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert asked == [(SITTER,)], "a policy two ducks play is fetched once"
    assert lines[0] == "stage: 1.00 s played, timeline.json (3 ducks)"
    assert [line.split(":")[0] for line in lines[1:]] == ["duck 0", "duck 1", "duck 2"]


def test_a_borrowed_policy_the_hub_refuses_exits_1_naming_its_duck(tmp_path, capsys, monkeypatch):
    from arena.hub_fetch import FetchError

    def refuse(troupe, event):
        raise FetchError("ducks[1]: pollen-robotics/microduck-sitter: could not read pollen-robotics/microduck-sitter: 404")

    monkeypatch.setattr("arena.cli.fetch_references", refuse)
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_troupe(tmp_path))]) == 1
    assert "ducks[1]: pollen-robotics/microduck-sitter" in capsys.readouterr().err
```

`tests/workshop/test_performance.py`: after `SINGS`, add:

```python
TROUPE = json.dumps({"timeline_version": 2, "duration_s": 2.0, "ducks": [
    {"policy": "self", "keyframes": [{"t": 0.0}]},
    {"policy": "self", "start": {"x": 0.0, "y": 0.6, "yaw": 90},
     "keyframes": [{"t": 0.0}, {"t": 1.0, "triggers": [1, 0]}]},
]}) + "\n"
# A troupe whose second duck is a checkpoint of this machine, not published yet.
BORROWS = json.dumps({"timeline_version": 2, "duration_s": 2.0, "ducks": [
    {"policy": "self", "keyframes": [{"t": 0.0}]},
    {"policy": "local:got_a_talent/first@1", "start": {"x": 0.0, "y": 0.6, "yaw": 0}, "keyframes": [{"t": 0.0}]},
]}) + "\n"
```

Append:

```python
def test_a_troupe_of_the_checkpoint_itself_plays_every_duck(stage, checkout):
    stage.timeline.write_text(TROUPE)
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    assert frames(evaluated(stage, run)) == 2 * 100  # two ducks, duck-major, 2 s each at 50 Hz


def test_the_page_saves_a_troupe_naming_a_checkpoint_of_this_machine(stage):
    saved = stage.post(f"{URL}/timeline", json={"text": BORROWS})
    assert saved.status_code == 200, saved.text
    assert stage.timeline.read_text() == BORROWS


def test_a_duck_playing_another_policy_is_not_played_here(stage, checkout):
    stage.timeline.write_text(BORROWS)
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    assert "ducks[1].policy" in evaluated(stage, run)["error"]


def test_a_troupe_naming_a_checkpoint_of_this_machine_is_not_published(stage, checkout, fakes):
    stage.timeline.write_text(BORROWS)
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and looks around."}
    refused = stage.post(f"{URL}/jobs/{run.name}/publish", json=body)
    assert refused.status_code == 400 and "publish it first" in refused.json()["detail"]
    assert fakes.calls("publish") == []
```

`tests/workshop/test_evaluations.py`: in `test_any_failure_while_measuring_is_stored_and_the_worker_moves_on`, rename the fake's parameter: `def breaks(event, policy, cast=None):`.

`tests/test_timeline.py`: Task 2 kept its v1 cases on `load_timeline`. Move them to the loader that stays:

1. Remove `load_timeline,` from the `from arena.timeline import (…)` list. `load_troupe` and `from arena.manifest import load_event` are already imported there, by Task 2.
2. Delete `test_a_lone_timeline_is_version_1`: `test_a_troupe_is_version_1_or_2` covers the version now. In `test_a_malformed_timeline_is_refused_with_where`, delete the first `with pytest.raises(…): load_timeline(…)` block and the comment line under it, keeping the `load_troupe` block.
3. Replace the two lines `LIMIT_S = 20.0` and `# Its time limit is LIMIT_S: a troupe and a lone timeline are refused at the same length.` with the following. Keep `TALENT = load_event("got-a-talent")` (Task 2's), which stays below it.

```python
def load(path) -> Timeline:
    """A v1 file as the Arena reads it: a troupe of one, whose duck carries the timeline."""
    return load_troupe(path, TALENT).ducks[0].timeline
```

   `load` is defined above `TALENT` but only called in tests, so the name is bound by then.
4. Rewrite every remaining call. Run: `sed -i '' -E 's/load_timeline\((.*), LIMIT_S\)/load(\1)/' tests/test_timeline.py`. Then `grep -n "load_timeline\|LIMIT_S" tests/test_timeline.py` must print nothing.

- [ ] **Step 6: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py`
Expected: FAIL.
- routes_submit and recover: `AttributeError: 'FetchedPolicy' object has no attribute 'timeline'`.
- The CLI troupe test: exit 1, because `load_timeline` refuses a version 2 file.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop/test_performance.py`
Expected: FAIL. The four new tests fail: `load_timeline` refuses a version 2 file, so the save and the publish give the wrong refusal, and the evaluation stores the wrong error.

- [ ] **Step 7: Switch every caller to the troupe and its cast**

`arena/web/routes_submit.py`:

1. Change the imports:

```python
from ..cast import cast_of, load_borrowed
from ..hub_fetch import FetchedPolicy, FetchError, fetch_policy, hub_name, parse_repo_ref
```

Delete `from ..timeline import sound_of`.

2. Delete `_hub_name`. In `_enter`, change `policy_name=_label(name, _hub_name(fetched)),` to `policy_name=_label(name, hub_name(fetched)),`.
3. Replace `_evaluate` with:

```python
def _evaluate(manifest, policy, command_vx: float | None, cast):
    if command_vx is None:
        return evaluate(manifest, policy, cast)
    return evaluate_at(manifest, policy, command_vx)
```

4. In `_enter`, the comment on the fetch becomes:

```python
        # Offloaded to a worker thread: this is a network call. On a stage it also reads every
        # policy the troupe borrows, each at its commit.
```

5. After `return _answer(kept, manifest.course.kind, _page_url(request, kept.run_id), already=True)`, add:

```python

    cast = None
    if manifest.course.kind == "stage":
        try:
            # Every borrowed policy's session too, off the event loop: each loaded once however
            # many ducks play it, and one that does not load is refused naming its first duck.
            borrowed = await run_in_threadpool(load_borrowed, fetched.troupe, fetched.borrowed)
        except PolicyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        cast = cast_of(manifest, fetched.troupe, policy, fetched.rig, borrowed)
```

6. In the `run_in_threadpool(_evaluate, …)` call, replace the last argument `fetched.timeline` with `cast.performers if cast else None`.
7. In the `RunRecord(...)`, replace `sound=sound_of(fetched.timeline) if fetched.timeline else None,` with `sound=cast.record[0]["sound"] if cast else None,`. This is the star's sound, until Task 6 keeps the whole cast.

`arena/recover.py`, in `recover`:

1. Replace `from .timeline import sound_of` with `from .cast import cast_of, load_borrowed`.
2. Replace the two lines `policy = load_policy(fetched.path)` and `result = evaluate(event, policy, fetched.timeline)` with:

```python
            policy = load_policy(fetched.path)
            # A stage plays its troupe, borrowed policies included. One that left the Hub has refused
            # the fetch above: that run cannot be raced again, and the store keeps none of it.
            cast = (cast_of(event, fetched.troupe, policy, fetched.rig, load_borrowed(fetched.troupe, fetched.borrowed))
                    if event.course.kind == "stage" else None)
            result = evaluate(event, policy, cast.performers if cast else None)
```

3. Replace `sound=sound_of(fetched.timeline) if fetched.timeline else None,` with `sound=cast.record[0]["sound"] if cast else None,`.

`arena/cli.py`:

1. Replace the imports `from .timeline import TimelineError, load_timeline, sound_of` with:

```python
from .cast import cast_of, load_borrowed
from .hub_fetch import FetchError, fetch_references
from .timeline import TimelineError, load_troupe
```

2. Replace `_print_stage` with:

```python
def _print_stage(manifest, result, troupe, name: str | None) -> None:
    played = result.trace.shape[1] * CTRL_DT
    if troupe is None:
        what = "the event's default command"
    elif len(troupe.ducks) == 1:
        what = f"{name} ({len(troupe.ducks[0].timeline.times)} keyframes)"
    else:
        what = f"{name} ({len(troupe.ducks)} ducks)"
    if result.seeds_finished:
        print(f"stage: {played:.2f} s played, {what}")
    else:
        print(f"stage: stopped at {played:.2f} s, the simulation diverged; {what}")
    for k, done in enumerate(stage.summaries(result.trace, manifest.termination)):
        fell = "no" if done["fell_at"] is None else f"at {done['fell_at']:.2f} s"
        print(f"duck {k}: fell {fell} · seated {done['seated_s']:.1f} s · standing {done['standing_s']:.1f} s")
```

3. In `_cmd_score`, replace everything from `timeline = None` down to `_print_stage(…)` (the stage branch) with:

```python
    cast = None
    if manifest.course.kind == "stage":
        troupe = load_troupe(Path(args.timeline), manifest) if args.timeline else None
        # "self" is the ONNX given here; every other duck's policy comes from the Hub, at its commit.
        references = fetch_references(troupe, manifest) if troupe else {}
        cast = cast_of(manifest, troupe, policy, None, load_borrowed(troupe, references))
        result = evaluate(manifest, policy, cast.performers)
        _print_stage(manifest, result, troupe, Path(args.timeline).name if args.timeline else None)
```

The `elif args.timeline:` and `else:` branches stay as they are.

4. In the `RunRecord(...)`, replace `sound=sound_of(timeline) if timeline else None,` with `sound=cast.record[0]["sound"] if cast else None,`.
5. In `main`, change the caught exceptions to `except (ManifestError, PolicyError, TimelineError, FetchError) as exc:`.

`arena/workshop/evaluations.py`:

1. Add this sentence to the module docstring's last paragraph: `A troupe plays here when every duck is the checkpoint itself ("self").`
2. Replace `from ..timeline import load_timeline, sound_of` with:

```python
from ..cast import cast_of
from ..timeline import SELF, load_troupe
```

3. Before `_measure`, add:

```python
def _own(troupe):
    """`troupe`, when every duck plays the checkpoint itself: the workshop plays no other policy."""
    for k, duck in enumerate(troupe.ducks if troupe else ()):
        if duck.policy != SELF:
            raise EvaluationError(f'ducks[{k}].policy: the workshop plays only this checkpoint ("self"), not {duck.policy!r}')
    return troupe
```

4. In `_measure`, replace the two lines `timeline = load_timeline(…) if key else None` and `result = evaluate(event, load_policy(onnx), timeline)` with:

```python
    policy = load_policy(onnx)
    # On a stage the challenge's timeline.json, which may name a checkpoint of this machine: saved and
    # played here, never entered.
    troupe = load_troupe(timeline_file(challenge), event, allow_local=True) if key else None
    cast = cast_of(event, _own(troupe), policy, None, {}) if event.course.kind == "stage" else None
    result = evaluate(event, policy, cast.performers if cast else None)
```

5. Replace `"sound": sound_of(timeline) if timeline else None,` with `"sound": cast.record[0]["sound"] if cast else None,`. Leave the `"stage"` lines as Task 4 left them.

`arena/workshop/challenges.py`:

1. Change the import to `from ..timeline import load_troupe`.
2. In `save_timeline`, replace `load_timeline(candidate, load_event(challenge.event).time_limit_s)` with:

```python
        # A duck may be a checkpoint of this machine: the page saves and plays it, publishing resolves it.
        load_troupe(candidate, load_event(challenge.event), allow_local=True)
```

`arena/workshop/app.py`:

1. Change the import to `from ..timeline import TimelineError, load_troupe`.
2. In `publish_route`, replace `load_timeline(timeline, load_event(challenge.event).time_limit_s)` with `load_troupe(timeline, load_event(challenge.event))`. An entry takes Hub policies only, so a `local:` duck is refused here with the loader's "publish it first".

`arena/timeline.py`: delete the function `load_timeline`. Task 2 left it as a wrapper that nothing inside the module calls.

Then check that nothing is left behind. `grep -rn --include="*.py" "load_timeline\|fetched\.timeline\|_hub_name" arena tests` must print nothing.

- [ ] **Step 8: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_hub_fetch.py tests/test_cast.py tests/test_evaluate_stage.py tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py tests/test_timeline.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS, the count at least the start's + 4.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests --ignore=tests/workshop`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add arena tests
/usr/bin/git commit -m "A Got a Talent troupe plays: every borrowed policy is fetched at its pinned commit under the entry's own rules, each duck stands on its own rig, and a refusal names the duck"
```

---

### Task 6: A run keeps its cast

**Files:**
- Modify: `arena/store.py`, `arena/web/routes_submit.py`, `arena/recover.py`, `arena/cli.py`, `arena/web/routes_read.py`, `arena/web/routes_vote.py`, `arena/workshop/evaluations.py`
- Test: `tests/test_store.py`, `tests/test_routes_submit.py`, `tests/test_recover.py`, `tests/test_cli.py`, `tests/test_routes_read.py`, `tests/test_routes_vote.py`, `tests/workshop/test_performance.py`, `tests/workshop/test_evaluations.py`

**Interfaces:**
- Consumes: Task 5's `Cast.record`.
- Produces:
  - `lone_cast(sound: dict | None = None) -> tuple[dict, ...]` in `arena/store.py`.
  - `RunRecord.cast: tuple[dict, ...]`, defaulting to `lone_cast()`, which replaces `RunRecord.sound`.
  - JSON keys: every board row and the run detail carry `"cast"`. The ballot carries `"cast"`: one list per lane, in lane order, each duck's `"policy"` reduced to `"self"` or `"borrowed"`. The workshop evaluation carries `"cast"`, a list, or null on a race. The key `"sound"` disappears from all of them.

- [ ] **Step 1: Write the failing tests**

`tests/test_store.py`: after `make_record`, add:

```python
# A borrowed duck's credit, as arena.cast.borrowed_source writes it.
WALKER = {"repo_id": "yan/microduck-walker", "filename": "policy.onnx", "revision": "b" * 40,
          "url": "https://huggingface.co/yan/microduck-walker/resolve/" + "b" * 40 + "/policy.onnx",
          "model_sha256": "w" * 64, "user": "yan", "policy_name": "walker"}
# What a run recorded before troupes, or a race, holds: one duck, no rig or place of its own.
ALONE = {"policy": "self", "rig": None, "start": None, "sound": None}
```

Replace `test_a_record_keeps_its_sound_and_an_older_one_has_none` and `test_a_run_recorded_by_0_4_4_keeps_its_triggers` with:

```python
def test_a_record_keeps_its_cast():
    cast = ({"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
             "sound": {"voice": {"pitch": 0.3}, "song": [[1.0, 0.5, 69, 0.7, 0.9, 0.0]]}},
            {"policy": WALKER, "rig": "rollers", "start": {"x": 0.4, "y": -0.6, "yaw": 90.0}, "sound": None})
    record = make_record(event_id="got-a-talent", cast=cast)
    assert RunRecord.from_dict(record.to_dict()) == record
    assert "sound" not in record.to_dict()


def test_a_race_is_one_duck_with_no_rig_or_place_of_its_own():
    assert make_record().cast == (ALONE,)


def test_a_run_recorded_before_troupes_is_a_cast_of_one_drawn_centred():
    sound = {"voice": {"pitch": 0.3}, "song": [[1.0, 0.5, 69, 0.7, 0.9, 0.0]]}
    raw = make_record(event_id="got-a-talent").to_dict()
    del raw["cast"]
    raw["sound"] = sound
    assert RunRecord.from_dict(raw).cast == ({**ALONE, "sound": sound},)
    raw["sound"] = None
    assert RunRecord.from_dict(raw).cast == (ALONE,)
    del raw["sound"]  # recorded before sounds existed
    assert RunRecord.from_dict(raw).cast == (ALONE,)


def test_a_run_recorded_by_0_4_4_keeps_its_triggers():
    """0.4.4 kept a performance's triggers under their own key, and the Space's log holds two such runs."""
    raw = make_record(event_id="got-a-talent").to_dict()
    del raw["cast"]
    raw["triggers"] = [[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]]
    assert RunRecord.from_dict(raw).cast == ({**ALONE, "sound": {"triggers": [[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]]}},)
    raw["triggers"] = None
    assert RunRecord.from_dict(raw).cast == (ALONE,)
```

`tests/test_routes_read.py`:

1. Change the import to `from tests.test_store import ALONE, WALKER, make_record`.
2. Replace `test_a_board_row_says_how_its_duck_sounds_on_the_stage` with:

```python
def test_a_board_row_and_its_run_page_carry_the_cast(client):
    """A lane on a stage is a board row: the event page, the run page and the clip put any row on it,
    every duck in its place, and the run page credits the borrowed ones."""
    api, app = client
    cast = ({"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
             "sound": {"triggers": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}},
            {"policy": WALKER, "rig": "rollers", "start": {"x": 0.4, "y": -0.6, "yaw": 90.0}, "sound": None})
    troupe = record_run(app, event_id="got-a-talent", user="ann", cast=cast)
    record_run(app, event_id="got-a-talent", user="bob")
    rows = {row["user"]: row for row in api.get("/api/events/got-a-talent/leaderboard").json()["rows"]}
    assert (rows["ann"]["cast"], rows["bob"]["cast"]) == (list(cast), [ALONE])
    assert "sound" not in rows["ann"]
    detail = api.get(f"/api/runs/{troupe.run_id}").json()
    assert detail["cast"] == list(cast)
    assert next(row for row in detail["board"] if row["you"])["cast"] == list(cast)
```

`tests/test_routes_vote.py`:

1. Change the import to `from tests.test_store import ALONE, WALKER, make_record`.
2. Replace `test_a_ballot_says_how_each_lanes_duck_sounds` with:

```python
def test_a_ballot_carries_each_lanes_cast_and_never_whose_policies(client):
    """A ballot is judged blind: every duck's place, rig and sound, and of its policy only whether it
    is the entry's own."""
    api, app = client
    ann = enter(app, "ann", cast=(
        {"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
         "sound": {"triggers": [[0.0, 1.0, 0.0]]}},
        {"policy": WALKER, "rig": "rollers", "start": {"x": 0.4, "y": -0.6, "yaw": 90.0}, "sound": None},
    ))
    bob = enter(app, "bob")
    body = api.get("/api/events/got-a-talent/ballot").json()
    entry = app.state.ballot_book.get(body["ballot"])
    casts = {ann.run_id: [ann.cast[0], {**ann.cast[1], "policy": "borrowed"}], bob.run_id: [ALONE]}
    assert body["cast"] == [casts[run_id] for run_id in entry.run_ids]
    assert "sound" not in body
```

`tests/test_routes_submit.py`:

0. Add `import hashlib` with the standard imports at the top.
1. In `test_a_stage_entry_keeps_the_sound_its_timeline_makes`, replace the assertion with:

```python
    assert _stored(api, "got-a-talent", body["run_id"]).cast == ({
        "policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
        "sound": {"triggers": [[0.0, 0.0, 0.0], [0.5, 1.0, 0.0], [1.0, 0.0, 0.0]]},
    },)
```

2. Replace `test_a_race_and_a_still_performance_keep_no_sound` with:

```python
def test_a_race_is_one_duck_of_its_events_rig_and_a_still_performance_makes_no_sound(api):
    race = submit(api).json()
    assert _stored(api, "sprint-2m", race["run_id"]).cast == ({"policy": "self", "rig": None, "start": None, "sound": None},)
    _TIMELINES["alice/best_alpha_walking"] = (performance(1.0), "d" * 64)
    still = submit(api, event="got-a-talent").json()
    assert _stored(api, "got-a-talent", still["run_id"]).cast[0]["sound"] is None
```

3. At the end of `test_a_troupe_plays_its_borrowed_ducks_beside_the_entrys_own`, add:

```python
    assert _stored(api, "got-a-talent", body["run_id"]).cast[1] == {
        "policy": {"repo_id": "pollen-robotics/microduck-sitter", "filename": "policy.onnx", "revision": "a" * 40,
                   "url": "https://huggingface.co/pollen-robotics/microduck-sitter/resolve/" + "a" * 40 + "/policy.onnx",
                   "model_sha256": hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
                   "user": "pollen-robotics", "policy_name": "sitter"},
        "rig": "legs", "start": {"x": 0.0, "y": 0.6, "yaw": 90.0}, "sound": None,
    }
```

`tests/test_recover.py`:

1. In `test_recover_plays_a_stage_entry_with_its_timeline_at_the_listed_revision`, replace `assert record.sound == {…}` with:

```python
    assert record.cast[0]["sound"] == {"triggers": [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]}
```

2. At the end of `test_recover_plays_a_troupe_with_its_borrowed_policies`, add:

```python
    assert [duck["policy"] if duck["policy"] == "self" else duck["policy"]["user"] for duck in record.cast] == [
        "self", "pollen-robotics"]
```

`tests/test_cli.py`:

1. In `test_score_records_how_a_performance_sounds`, replace its last line with:

```python
    assert record.cast[0]["sound"] == {"triggers": [[0.0, 0.0, 0.0], [0.5, 0.0, 1.0]]}
```

2. Append:

```python
def test_score_records_a_troupe_crediting_its_borrowed_ducks(tmp_path, capsys, monkeypatch):
    from arena.store import LocalStore

    _lend(monkeypatch)
    store = tmp_path / "store"
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_troupe(tmp_path)),
                 "--store", str(store)]) == 0
    [record] = LocalStore(store).runs("got-a-talent")
    assert [duck["policy"] if duck["policy"] == "self" else duck["policy"]["repo_id"] for duck in record.cast] == [
        "self", "pollen-robotics/microduck-sitter", "pollen-robotics/microduck-sitter"]
    assert [duck["start"]["yaw"] for duck in record.cast] == [0.0, 90.0, -90.0]
```

`tests/workshop/test_performance.py`:

1. In `test_a_stage_checkpoint_plays_the_challenges_timeline`, replace `assert body["sound"] is None` with:

```python
    assert body["cast"] == [{"policy": "self", "rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0}, "sound": None}]
```

2. In `test_a_checkpoint_replays_with_the_sound_its_timeline_makes` and `test_a_checkpoint_replays_with_the_song_its_timeline_sings`, replace `evaluated(stage, run)["sound"]` with `evaluated(stage, run)["cast"][0]["sound"]`.
3. Replace the body of `test_a_troupe_of_the_checkpoint_itself_plays_every_duck` after `run = make_run(…)` with:

```python
    body = evaluated(stage, run)
    assert frames(body) == 2 * 100  # two ducks, duck-major, 2 s each at 50 Hz
    assert [(duck["start"], duck["sound"]) for duck in body["cast"]] == [
        ({"x": 0.0, "y": 0.0, "yaw": 0.0}, None),
        ({"x": 0.0, "y": 0.6, "yaw": 90.0}, {"triggers": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}),
    ]
```

`tests/workshop/test_evaluations.py`: in `test_a_checkpoint_is_exported_by_a_dry_run_publish_and_raced`, after the `seeds_total` assertion, add `assert body["cast"] is None  # a race: one duck, nothing to place or hear`.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_store.py`
Expected: FAIL with `TypeError: RunRecord.__init__() got an unexpected keyword argument 'cast'`.

- [ ] **Step 3: Implement**

`arena/store.py`:

1. Change `from dataclasses import dataclass` to `from dataclasses import dataclass, field`.
2. Before `class RunRecord`, add:

```python
def lone_cast(sound: dict | None = None) -> tuple[dict, ...]:
    """The cast of a run whose one duck has no rig or place of its own: a race, raced on its event's
    rig, or a performance recorded before troupes, which the site draws centred as it always did."""
    return ({"policy": "self", "rig": None, "start": None, "sound": sound},)
```

3. Replace the `sound` field and its comment with:

```python
    # Who performed, duck by duck, as arena.cast.Cast.record gives it: whose policy each plays ("self",
    # or a borrowed repo, credited), its rig, where it started on the stage, and how it is heard
    # (arena.timeline.sound_of). Never simulated again: the replay draws, sings and credits from it.
    cast: tuple[dict, ...] = field(default_factory=lone_cast)
```

4. In `to_dict`, replace `"sound": self.sound,` with `"cast": list(self.cast),`.
5. In `from_dict`, replace the `sound=…` line and its comment with:

```python
            # .get, not [..]: a run recorded before troupes has no cast. Its one duck is heard as the
            # run was: its "sound", or, for two runs of 2026-10-12 recorded by 0.4.4, the triggers
            # kept alone under their own key. An append-only log never rewrites them.
            cast=tuple(raw["cast"]) if raw.get("cast") else lone_cast(
                raw.get("sound") or ({"triggers": raw["triggers"]} if raw.get("triggers") else None)
            ),
```

`arena/web/routes_submit.py`:

1. Import `lone_cast`: `from ..store import RunRecord, Withdrawal, lone_cast, new_id`.
2. Replace `sound=cast.record[0]["sound"] if cast else None,` with `cast=cast.record if cast else lone_cast(),`.

`arena/recover.py`:

1. Change the import to `from .store import RunRecord, lone_cast, new_id`.
2. Make the same replacement as in routes_submit.

`arena/cli.py`:

1. Change the import to `from .store import LocalStore, RunRecord, lone_cast, new_id`.
2. Make the same replacement as in routes_submit.

`arena/web/routes_read.py`:

1. In `_board_row`, replace the `"sound"` entry and its comment with:

```python
        # Who performs, duck by duck (arena.cast): a lane is a board row, so the row carries each
        # duck's place, its rig, what the replay sings and opens its beak from, and whose policy it
        # plays. A race's row is one duck of the event's rig.
        "cast": record.cast,
```

2. In `run_detail`'s returned dict, after `"livery": record.livery,`, add:

```python
        # Every duck, credited: the page names each borrowed policy's author and links its repo.
        "cast": record.cast,
```

`arena/web/routes_vote.py`:

1. Before `issue_ballot`, add:

```python
def _anonymous(cast) -> list[dict]:
    """A lane's cast as a ballot shows it: every duck's place, rig and sound, and of its policy only
    whether it is the entry's own. Never who made it: a ballot is judged blind."""
    return [{**duck, "policy": "self" if duck["policy"] == "self" else "borrowed"} for duck in cast]
```

2. Replace the `"sound"` line and its comment in the ballot with:

```python
        # Each lane's ducks, in lane order: the performance itself, never who made it.
        "cast": [_anonymous(r.cast) for r in picked],
```

`arena/workshop/evaluations.py`: replace `"sound": cast.record[0]["sound"] if cast else None,` with `"cast": list(cast.record) if cast else None,`.

Then check that nothing is left behind. `grep -rn --include="*.py" "\.sound\b\|\"sound\":" arena` must list only `arena/cast.py` (the record's `"sound"` key) and `arena/store.py` (`lone_cast`'s `"sound"` key).

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_store.py tests/test_routes_read.py tests/test_routes_vote.py tests/test_routes_submit.py tests/test_recover.py tests/test_cli.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests --ignore=tests/workshop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena tests
/usr/bin/git commit -m "A run keeps its cast, duck by duck: boards, run pages and workshop evaluations serve it, a ballot shows it without saying whose policies, and an older run reads as one duck drawn centred"
```

---

### Task 7: The booth names the troupe

**Files:**
- Modify: `arena/commentary/context.py`
- Test: `tests/test_commentary_context.py`

**Interfaces:**
- Consumes: Task 6's `RunRecord.cast`, and `tests.test_store.WALKER`.
- Produces: a result fact `run#/troupe`, present only when the cast has two or more ducks: "The performance has N ducks: …". The other facts are unchanged, the participant's included.

The fact is the writer's input, and nothing more. Owner's rule of 2026-10-12: nothing checks what Peter and Ray then say about it. The only check is `label()`, as on the participant's name. It decides whether a submitter's policy name may be quoted in a fact at all.

- [ ] **Step 1: Write the failing tests**

In `tests/test_commentary_context.py`, change the import to `from tests.test_store import WALKER, make_record`. Then append:

```python
ON_STAGE = {"rig": "legs", "start": {"x": 0.0, "y": 0.0, "yaw": 0.0}, "sound": None}


def troupe_run(*policies, policy_name="sitter"):
    """xia's performance, one duck per policy in order: "self" or a borrowed duck's credit."""
    return make_record(
        user="xia", event_id="got-a-talent", policy_name=policy_name, score=20.0, seeds_finished=1,
        per_seed=(SeedResult(seed=1, status="finish", time_s=20.0),), submitted_at="2026-09-11T10:00:00Z",
        cast=tuple({**ON_STAGE, "policy": policy} for policy in policies),
    )


def facts_of(record):
    return {f.ref: f for f in result_facts(record, load_event("got-a-talent"), [record], [])}


def test_a_troupe_is_named_in_order_each_borrowed_duck_by_its_author_and_policy():
    facts = facts_of(troupe_run("self", WALKER, "self"))
    assert facts["run#/troupe"].text == (
        "The performance has 3 ducks: @xia's sitter (the star), @yan's walker and @xia's sitter again.")
    assert facts["run#/troupe"].kind == "result"
    # The participant is still the entrant alone: votes and points are theirs.
    assert facts["run#/participant"].text == "The participant is @xia, performing a policy named sitter."


def test_a_pair_and_a_borrowed_policy_played_twice():
    assert facts_of(troupe_run("self", "self"))["run#/troupe"].text == (
        "The performance has 2 ducks: @xia's sitter (the star) and @xia's sitter again.")
    assert facts_of(troupe_run("self", WALKER, WALKER))["run#/troupe"].text == (
        "The performance has 3 ducks: @xia's sitter (the star), @yan's walker and @yan's walker again.")


def test_a_name_that_is_not_a_label_is_left_out_of_the_troupe():
    record = troupe_run("self", {**WALKER, "policy_name": "<b>walker</b>"}, policy_name="sitter_v2")
    assert facts_of(record)["run#/troupe"].text == (
        "The performance has 2 ducks: @xia's policy (the star) and @yan's policy.")


def test_one_duck_is_told_as_it_always_was():
    assert "run#/troupe" not in facts_of(stage_run())
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_commentary_context.py`
Expected: FAIL with `KeyError: 'run#/troupe'`.

- [ ] **Step 3: Implement**

In `arena/commentary/context.py`, after `_points`, add:

```python
def _troupe(record: RunRecord) -> Fact | None:
    """Who performs when more than one duck does, in order: each by its author and its policy's name,
    the entry's own first as the star, a policy already named "again". A name that is not a label goes
    unsaid, as the participant's does. None for one duck: the participant fact says it all."""
    if len(record.cast) < 2:
        return None
    seen, ducks = set(), []
    for k, duck in enumerate(record.cast):
        source = duck["policy"]
        if source == "self":
            who, name, which = record.user, record.policy_name, "self"
        else:
            who, name, which = source["user"], source["policy_name"], (source["repo_id"], source["revision"])
        said = f"@{who}'s {name}" if label(name) else f"@{who}'s policy"
        if k == 0:
            said += " (the star)"
        elif which in seen:
            said += " again"
        seen.add(which)
        ducks.append(said)
    listed = ", ".join(ducks[:-1]) + " and " + ducks[-1]
    return Fact("run#/troupe", f"The performance has {len(ducks)} ducks: {listed}.", "result")
```

In `result_facts`:

1. Replace the docstring's first sentence with: "The run itself: the event, who ran, what the clock says (on a stage, how long the performance lasts, and who performs when a troupe does), where it stands and what it earned."
2. Before `if note:`, add:

```python
    troupe = _troupe(record)
    if troupe:
        facts.append(troupe)
```

- [ ] **Step 4: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_commentary_context.py tests/test_commentary.py tests/test_commentary_generator.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add arena/commentary/context.py tests/test_commentary_context.py
/usr/bin/git commit -m "The booth hears who performs: a troupe's ducks named in order, each borrowed one by its author and its policy, the entrant's own as the star"
```

---

### Task 8: Two or more ducks sing as a chorus

**Files:**
- Modify: `app/voice/src/lib.rs`, `app/public/sound/microduck-voice.wasm` (rebuilt), `app/src/live/voice.js`, `app/src/duck-voice.js`
- Test: `app/src/live/voice.test.js`, `app/src/duck-voice.test.js`

**Interfaces:**
- Consumes: the `sounds` crate at e597877: `Stream::choral(p: &Personality, variant: u32)` (sounds/src/stream.rs: the "chorale" tag, vibrato ×0.30, quackiness ×0.35, jitter ×0.30, breath ×0.15, no wobble).
- Produces:
  - wasm: `song(seed: u32, pitch, brightness, buzz, vibrato, breath, seconds: f64, choral: u32, variant: u32) -> usize`. `choral` 1 renders through `Stream::choral(&tuned, variant)`; otherwise `Stream::new(&tuned, "song", 0)` as today, and `variant` is ignored.
  - `app/src/live/voice.js` `loadCalls(...)`: `song(seed, voice, notes, seconds, { choral = false, variant = 0 } = {})`.
  - `app/src/duck-voice.js`: `songSamples(calls, sound, duration, { choral = false, variant = 0 } = {})` and `choirOf(ducks)`. `choirOf` is true when two or more of `ducks` (`[{ sound }]`) have a `song`.

- [ ] **Step 1: Write the failing tests**

In `app/src/live/voice.test.js`, add before `describe("windGust", () => {` (the `power` helper above is reused):

```js
describe("loadCalls: the chorus", () => {
  const notes = [[0, 1, 69, 1, 0.9, 0]];

  it("sings a part of a chorus in the robot's choral voice: its own per part, still on its note", async () => {
    const calls = await loadCalls(wasm);
    const solo = calls.song(28, {}, notes, 1.2);
    const first = calls.song(28, {}, notes, 1.2, { choral: true, variant: 0 });
    const second = calls.song(28, {}, notes, 1.2, { choral: true, variant: 1 });
    for (const take of [solo, first, second]) {
      expect(take).toHaveLength(57600);
      expect(take.every(Number.isFinite)).toBe(true);
    }
    expect(first).not.toEqual(solo);
    expect(second).not.toEqual(first);
    const held = first.subarray(0.2 * 48000, 0.8 * 48000);
    expect(power(held, 440)).toBeGreaterThan(10 * power(held, 415.3));
    expect(power(held, 440)).toBeGreaterThan(10 * power(held, 466.2));
  });

  it("sings solo unless asked for a part, whatever the variant", async () => {
    const calls = await loadCalls(wasm);
    expect(calls.song(28, {}, notes, 1.2, { choral: false, variant: 3 })).toEqual(calls.song(28, {}, notes, 1.2));
  });
});
```

In `app/src/duck-voice.test.js`:

1. Replace the import line with:

```js
import { DUCK_SEED, callSamples, choirOf, mouthTrack, songSamples, voiceEvents } from "./duck-voice.js";
```

2. Replace the end of the file, from `  it("is nothing without a song", () => {` to the last `});`, with:

```js
  it("is nothing without a song", () => {
    expect(songSamples(synth([]), pulls([[0, 1, 0]]), 20)).toBeNull();
    expect(songSamples(synth([]), null, 20)).toBeNull();
  });

  it("sings the duck's own part of a chorus when asked, and solo otherwise", () => {
    const asked = [];
    const record = { song: (seed, voice, notes, seconds, part) => (asked.push(part), new Float32Array(48000)) };
    songSamples(record, { song: [note(0, 1)] }, 20, { choral: true, variant: 2 });
    songSamples(record, { song: [note(0, 1)] }, 20);
    expect(asked).toEqual([{ choral: true, variant: 2 }, { choral: false, variant: 0 }]);
  });
});

describe("choirOf", () => {
  const sings = { sound: { song: [note(0, 1)] } };
  const quacks = { sound: pulls([[0, 1, 0]]) };

  it("makes a chorus of two or more singers, whatever the others do", () => {
    expect(choirOf([sings, quacks, sings])).toBe(true);
  });

  it("leaves a lone singer solo, and a silent troupe without a chorus", () => {
    expect(choirOf([sings, quacks, { sound: null }])).toBe(false);
    expect(choirOf([sings])).toBe(false);
    expect(choirOf([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/live/voice.test.js src/duck-voice.test.js`
Expected: FAIL in four tests:
- "sings a part of a chorus…" fails with `expected Float32Array[…] to not deeply equal Float32Array[…]`, because the old wasm ignores the extra arguments and sings solo;
- the `songSamples` part test fails with `[undefined, undefined]`;
- the two `choirOf` tests fail with `choirOf is not a function`.

- [ ] **Step 3: Implement the synth**

In `app/voice/src/lib.rs`:

1. Replace the doc comment's last three lines,

```rust
//! The stage duck's song is the robot's singing voice, `Stream`, driven note by note as its
//! chorale drives it. All three sing in a voice the performance tunes: five knobs over the seed's
//! personality, each a position within [0, 1] on a trait's range.
```

with:

```rust
//! The stage duck's song is the robot's singing voice, `Stream`, driven note by note as its
//! chorale drives it: solo when one duck of a troupe sings, a part of a chorus when two or more do.
//! All three sing in a voice the performance tunes: five knobs over the seed's personality, each a
//! position within [0, 1] on a trait's range.
```

2. Replace `song`'s doc comment, signature and first lines, from `/// The whole song, `seconds` long from the performance's t = 0, in the tuned voice: the robot's` through `    let mut voice = Stream::new(&tuned(seed, pitch, brightness, buzz, vibrato, breath), "song", 0);`, with:

```rust
/// The whole song, `seconds` long from the performance's t = 0, in the tuned voice: the robot's
/// `Stream`, driven by the chorale's loop. A lone singer is untamed (a solo has no chord to sour).
/// With `choral` 1 the duck sings part `variant` of a chorus through `Stream::choral`, which tames
/// its vibrato, buzz, jitter and breath so the chord stays in tune. A note sounds for its first
/// [`SUSTAIN`] and lets go; between notes the voice is silent at the last pitch, mouth and vowel, as
/// the robot's live chorale leaves it. No speaker rolloff: a page plays on full-range speakers.
/// Returns the length, at least one sample.
#[unsafe(no_mangle)]
pub extern "C" fn song(
    seed: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
    seconds: f64,
    choral: u32,
    variant: u32,
) -> usize {
    let notes: Vec<[f64; 6]> = NOTES.with_borrow(|n| {
        n.chunks_exact(6)
            .map(|c| [c[0], c[1], c[2], c[3], c[4], c[5]])
            .collect()
    });
    let p = tuned(seed, pitch, brightness, buzz, vibrato, breath);
    let mut voice = if choral == 1 {
        Stream::choral(&p, variant)
    } else {
        Stream::new(&p, "song", 0)
    };
```

The rest of `song` (the first-note aim, the block loop, `keep(out)`) is unchanged.

3. Rebuild, from `app/voice`:

```bash
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/microduck_voice.wasm ../public/sound/microduck-voice.wasm
```

Expected: the build succeeds with no warnings, and the `.wasm` changes (about 52 KB).

- [ ] **Step 4: Implement the page's side**

In `app/src/live/voice.js`, replace the doc comment of `loadCalls` and its `song` method, from `/** The stage duck's voice in the robot's synthesiser, tuned by a performance's `voice` knobs:` to the end of `loadCalls`, with:

```js
/** The stage duck's voice in the robot's synthesiser, tuned by a performance's `voice` knobs:
 * `chirp(seed, variant, voice)` is RT's quack, `wheee(seed, variant, segment, voice)` LT's ride
 * (0 its start, 1 its loop), and `song(seed, voice, notes, seconds, { choral, variant })` the whole
 * song from t = 0, its notes as arena/timeline.py sound_of stores them: solo, or with `choral` the
 * duck's part `variant` of a chorus. Each is a copy, kept however many calls follow. */
export async function loadCalls(fetcher = fetch) {
  const { memory, chirp, wheee, notes, song, samples } = await voiceExports(fetcher);
  const copy = (length) => new Float32Array(memory.buffer, samples(), length).slice();
  return {
    chirp: (seed, variant, voice) => copy(chirp(seed, variant, ...knobs(voice))),
    wheee: (seed, variant, segment, voice) => copy(wheee(seed, variant, segment, ...knobs(voice))),
    song(seed, voice, written, seconds, { choral = false, variant = 0 } = {}) {
      // Asked for first: making room may grow the memory, which detaches older views of it.
      const room = notes(written.length);
      new Float64Array(memory.buffer, room, written.length * 6).set(written.flat());
      return copy(song(seed, ...knobs(voice), seconds, choral ? 1 : 0, variant));
    },
  };
}
```

In `app/src/duck-voice.js`:

1. In the header comment, replace

```js
// a call playing when one starts is cut, and LT still held when it ends rides again. Pure: the
// viewer and the clip hear the same sounds from it.
```

with:

```js
// a call playing when one starts is cut, and LT still held when it ends rides again. A troupe where
// two or more ducks sing is a chorus: each sings its part in the robot's choral voice. Pure: the
// viewer and the clip hear the same sounds from it.
```

2. Replace `songSamples` and its doc comment (the end of the file) with:

```js
/**
 * The song as one take from the performance's t = 0, in the voice it tunes, to its last release —
 * or to `duration`, where a cut-short trace stops it, faded. In a chorus (choirOf) it is the duck's
 * part `variant`. Never empty; null without a song.
 */
export function songSamples(calls, sound, duration, { choral = false, variant = 0 } = {}) {
  if (!sound?.song) return null;
  const [start, length] = sound.song.at(-1);
  const seconds = Math.max(1 / SAMPLE_RATE, Math.min(duration, start + length + TAIL_S));
  return fadeOut(calls.song(DUCK_SEED, sound.voice ?? {}, sound.song, seconds, { choral, variant }));
}

/**
 * Whether a troupe sings as a chorus: two or more of its ducks have a song. In a chord the
 * robot tames vibrato, buzz, jitter and breath, which would sour the tuning (sounds::Stream::choral);
 * a lone singer keeps them.
 */
export function choirOf(ducks) {
  return ducks.filter((duck) => duck.sound?.song).length > 1;
}
```

`stage-voice.js` and `clip/soundtrack.js` still call `songSamples(calls, sound, duration)` and sing solo until Tasks 9 and 12.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/voice/src/lib.rs app/public/sound/microduck-voice.wasm app/src/live/voice.js app/src/live/voice.test.js app/src/duck-voice.js app/src/duck-voice.test.js
/usr/bin/git commit -m "When two or more ducks sing, each sings its part of a chorus in the robot's choral voice, and a lone singer stays solo"
```

---

### Task 9: The stage voices every duck

**Files:**
- Modify: `app/src/stage-voice.js` (rewritten), `app/src/duck-voice.js`, `app/src/viewer.js`
- Test: `app/src/stage-voice.test.js` (rewritten), `app/src/duck-voice.test.js`

**Interfaces:**
- Consumes: Task 8's `songSamples(calls, sound, duration, { choral, variant })` and `choirOf(ducks)`; today's `voiceEvents` and `callSamples`.
- Produces:
  - `createStageVoice(loadCalls, opts)` returns `{ set(ducks, duration), follow(seconds), dispose() }`. `ducks` is `[{ sound }]` in duck order; `[]` is silence.
  - Each duck has its own speaker: its song as one take and its calls one at a time, under today's rules. Its song is sung with `{ choral: choirOf(ducks), variant: <its index> }`.
  - Every source goes through gain 0.6, then one limiter, then the destination.
  - `limiter(context)` in `app/src/duck-voice.js`: a `DynamicsCompressorNode` (threshold −3, knee 0, ratio 20, attack 0.001, release 0.1), unconnected.
  - The viewer calls `voice?.set(talent ? lanes : [], player.duration)`.

- [ ] **Step 1: Write the failing tests**

Replace `app/src/stage-voice.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { createStageVoice } from "./stage-voice.js";

const calls = {
  chirp: () => new Float32Array(4800), // 0.1 s
  wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000),
  song: (seed, voice, notes, seconds) => new Float32Array(Math.max(1, Math.round(seconds * 48000))),
};
/** One A4 from 1 s to 2 s: its take is 2.2 s long, release included. */
const song = { song: [[1, 1, 69, 0.7, 0.9, 0]] };
const settle = () => new Promise((done) => setTimeout(done));

/** A context whose sources log their starts and stops, and whose nodes log what they feed (`wiring`). */
function fakeContext(log, wiring = []) {
  const listeners = [];
  const node = (name) => ({ name, connect: (to) => wiring.push([name, to.name]) });
  return {
    state: "running",
    addEventListener: (type, listener) => listeners.push(listener),
    removeEventListener: (type, listener) => listeners.splice(listeners.indexOf(listener), 1),
    changeState(state) {
      this.state = state;
      for (const listener of [...listeners]) listener();
    },
    destination: { name: "speakers" },
    resume: async () => log.push(["resume"]),
    close: async () => {},
    createGain: () => ({ ...node("gain"), gain: { value: 1 } }),
    createDynamicsCompressor: () => ({
      ...node("limiter"), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
    }),
    createBuffer: (channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource() {
      const source = {
        ...node("source"),
        buffer: null,
        start: (when, offset) => log.push(["start", source.buffer.length, offset]),
        stop: () => log.push(["stop"]),
      };
      return source;
    },
  };
}

/** A stage voice for a troupe whose ducks sound as `sounds`, in duck order. */
async function voiceWith(sounds, { duration = 5, muted = () => false, state = "running", synth = calls } = {}) {
  const log = [];
  const wiring = [];
  const context = fakeContext(log, wiring);
  context.state = state;
  const voice = createStageVoice(async () => synth, { makeContext: () => context, muted });
  voice.set(sounds.map((sound) => ({ sound })), duration);
  await settle();
  return { voice, log, wiring, context };
}

describe("createStageVoice", () => {
  it("starts a quack as the clock crosses it, once, and lets it end", async () => {
    const { voice, log } = await voiceWith([{ triggers: [[0, 0, 0], [1, 1, 0]] }]);
    voice.follow(0.98);
    voice.follow(1.0);
    voice.follow(1.02);
    voice.follow(1.2);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
    expect(log[0][1]).toBe(4800);
    expect(log[0][2]).toBeCloseTo(0);
  });

  it("resumes a wheee from where a jump lands inside it", async () => {
    const { voice, log } = await voiceWith([{ triggers: [[0, 0, 0], [1, 0, 1], [3, 0, 0]] }]);
    voice.follow(0);
    voice.follow(2);
    expect(log).toEqual([["start", 96000, 1]]);
  });

  it("starts again from the top when the replay loops", async () => {
    const { voice, log } = await voiceWith([{ triggers: [[0, 0, 1], [2, 0, 0]] }]);
    voice.follow(0.5);
    voice.follow(0.52);
    voice.follow(0.02);
    expect(log.filter(([what]) => what === "start").map(([, , offset]) => offset)).toEqual([0.5, expect.closeTo(0.02)]);
  });

  it("stays silent when the Arena is muted, and stops when the replay pauses", async () => {
    const wheee = { triggers: [[0, 0, 1], [2, 0, 0]] };
    const muted = await voiceWith([wheee], { muted: () => true });
    muted.voice.follow(0.5);
    expect(muted.log).toEqual([]);
    const { voice, log } = await voiceWith([wheee]);
    voice.follow(0.5);
    voice.follow(null);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
  });

  it("cuts a wheee the moment it is muted, and takes it up where the replay is once it is not", async () => {
    let quiet = false;
    const { voice, log } = await voiceWith([{ triggers: [[0, 0, 1], [2, 0, 0]] }], { muted: () => quiet });
    voice.follow(0.5);
    quiet = true;
    voice.follow(0.52);
    voice.follow(0.54);
    quiet = false;
    voice.follow(0.56);
    expect(log).toEqual([["start", 96000, 0.5], ["stop"], ["start", 96000, 0.56]]);
  });

  it("sings the song as one take on the replay's clock, with a quack between notes beside it", async () => {
    const { voice, log } = await voiceWith([{ ...song, triggers: [[0, 0, 0], [2.1, 1, 0]] }]);
    for (let step = 0; step < 10; step++) voice.follow(2 + step * 0.02);
    expect(log).toEqual([["start", 105600, 2], ["start", 4800, expect.closeTo(0, 5)]]);
  });

  it("starts both the quack and the song a jump lands inside, and stops both when the loop comes round", async () => {
    const { voice, log } = await voiceWith([{ ...song, triggers: [[0, 0, 0], [2.05, 1, 0]] }]);
    voice.follow(2.1);
    voice.follow(0.3);
    expect(log).toEqual([
      ["start", 4800, expect.closeTo(0.05, 5)],
      ["start", 105600, 2.1],
      ["stop"],
      ["stop"],
      ["start", 105600, 0.3],
    ]);
  });

  it("restarts the song where a jump lands, and lets it go past its end", async () => {
    const { voice, log } = await voiceWith([song]);
    voice.follow(1.5);
    voice.follow(0.2); // the loop came round
    voice.follow(3); // scrubbed past the song
    expect(log).toEqual([["start", 105600, 1.5], ["stop"], ["start", 105600, 0.2], ["stop"]]);
  });

  it("never loads the synth for a troupe that makes no sound", async () => {
    let loads = 0;
    const voice = createStageVoice(async () => (loads++, calls), { makeContext: () => fakeContext([]), muted: () => false });
    voice.set([{ sound: { triggers: [[0, 0.2, 0]] } }, { sound: null }], 5); // the beaks open, nothing is heard
    voice.set([], 0);
    await settle();
    expect(loads).toBe(0);
  });

  describe("a troupe", () => {
    it("gives each duck its own speaker: two ducks quack at once, each one call at a time", async () => {
      const { voice, log } = await voiceWith([
        { triggers: [[0, 0, 0], [1, 1, 0]] },
        { triggers: [[0, 0, 0], [1, 1, 0], [1.05, 0, 1]] }, // its wheee cuts its own quack
      ]);
      voice.follow(1.0);
      voice.follow(1.06);
      expect(log).toEqual([["start", 4800, 0], ["start", 2400, 0], ["stop"], ["start", 189600, expect.closeTo(0.01, 5)]]);
    });

    it("sings every song as a part of a chorus when two ducks sing, each part its duck's place", async () => {
      const asked = [];
      const synth = { ...calls, song: (seed, voice, notes, seconds, part) => (asked.push(part), calls.song(seed, voice, notes, seconds)) };
      const { voice, log } = await voiceWith([song, { triggers: [[0, 1, 0]] }, song], { synth });
      expect(asked).toEqual([{ choral: true, variant: 0 }, { choral: true, variant: 2 }]);
      voice.follow(1.5);
      expect(log).toEqual([["start", 105600, 1.5], ["start", 105600, 1.5]]);
    });

    it("leaves a lone singer solo", async () => {
      const asked = [];
      const synth = { ...calls, song: (seed, voice, notes, seconds, part) => (asked.push(part), calls.song(seed, voice, notes, seconds)) };
      await voiceWith([{ triggers: [[0, 1, 0]] }, song], { synth });
      expect(asked).toEqual([{ choral: false, variant: 1 }]);
    });

    it("mixes every duck through one limiter before the speakers, so a chorus never clips", async () => {
      const { voice, wiring } = await voiceWith([song, song, song]);
      voice.follow(1.5);
      expect(wiring).toEqual([
        ["limiter", "speakers"],
        ["gain", "limiter"],
        ["source", "gain"],
        ["source", "gain"],
        ["source", "gain"],
      ]);
    });

    it("falls silent for every duck where a cut-short performance stops", async () => {
      const { voice, log } = await voiceWith([song, { triggers: [[0, 0, 0], [1.6, 1, 0]] }], { duration: 1.5 });
      for (let at = 1.2; at < 1.7; at += 0.02) voice.follow(at);
      // The song's take ends where the trace does, and the quack due after it never comes.
      expect(log.filter(([what]) => what === "start")).toEqual([["start", 72000, 1.2]]);
    });
  });

  describe("on a page the browser keeps silent until a gesture", () => {
    const suspended = async () => {
      const made = await voiceWith([{ triggers: [[0, 1, 0]] }], { duration: 1, state: "suspended" });
      for (const at of [0.02, 0.04, 0.06]) made.voice.follow(at);
      return made;
    };

    it("never asks the context to resume from a frame", async () => {
      const { voice, log } = await suspended();
      expect(log).toEqual([]);
      voice.dispose();
    });

    it("resumes it inside the first gesture, once", async () => {
      const { voice, log } = await suspended();
      window.dispatchEvent(new Event("pointerdown"));
      expect(log).toEqual([["resume"]]);
      voice.dispose();
    });

    it("plays the sound that is due from its offset on the first frame after the context runs", async () => {
      const { voice, log, context } = await suspended();
      context.changeState("running");
      voice.follow(0.08);
      expect(log).toEqual([["start", 4800, 0.08]]);
      window.dispatchEvent(new Event("pointerdown"));
      expect(log).toHaveLength(1);
      voice.dispose();
    });

    it("stops listening for gestures once disposed", async () => {
      const { voice, log } = await suspended();
      voice.dispose();
      window.dispatchEvent(new Event("pointerdown"));
      window.dispatchEvent(new Event("keydown"));
      expect(log).toEqual([]);
    });
  });

  it("forgets the sounds of lanes that have left the stage", async () => {
    const log = [];
    let release;
    const slow = new Promise((done) => { release = done; });
    const voice = createStageVoice(() => slow, { makeContext: () => fakeContext(log), muted: () => false });
    voice.set([{ sound: { ...song, triggers: [[0, 1, 0]] } }], 1);
    voice.set([], 0);
    release(calls);
    await settle();
    voice.follow(0.02);
    expect(log).toEqual([]);
  });
});
```

In `app/src/duck-voice.test.js`, add `limiter` to the import from `./duck-voice.js` (which becomes `import { DUCK_SEED, callSamples, choirOf, limiter, mouthTrack, songSamples, voiceEvents } from "./duck-voice.js";`). Then add at the end of the file:

```js
describe("limiter", () => {
  it("limits hard and fast, just under full scale", () => {
    const param = () => ({ value: null });
    const node = { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() };
    expect(limiter({ createDynamicsCompressor: () => node })).toBe(node);
    expect(Object.fromEntries(Object.entries(node).map(([name, { value }]) => [name, value]))).toEqual({
      threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1,
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/stage-voice.test.js src/duck-voice.test.js`
Expected: FAIL.
- 15 of the 19 stage-voice tests fail, because today's `set` reads a list of ducks as a performer with no sound and plays nothing.
- The limiter test fails with `limiter is not a function`.

- [ ] **Step 3: Implement**

In `app/src/duck-voice.js`, add after `choirOf`:

```js
/**
 * The limiter the troupe sings through, on `context`: hard and fast, just under full scale, so a
 * chorus of ducks never clips while one duck at the synth's own level passes under it. The stage
 * and the clip's soundtrack each end their mix with one.
 */
export function limiter(context) {
  const node = context.createDynamicsCompressor();
  node.threshold.value = -3;
  node.knee.value = 0;
  node.ratio.value = 20;
  node.attack.value = 0.001;
  node.release.value = 0.1;
  return node;
}
```

Replace `app/src/stage-voice.js` with:

```js
// The troupe's voices on a live stage: each duck's song as one take from t = 0 and its calls one at a
// time (duck-voice.js), played on the replay's own clock. Each duck has its own speaker, as each
// robot does; two or more singers sing their parts as a chorus, and the whole troupe goes through one
// limiter, so a chorus never clips. A jump — the loop coming round, a scrub, new lanes — stops what
// plays and starts what the new time is inside, from where it is: a wheee resumes mid-ride, a song
// mid-phrase. Nothing waits on a sound: no Web Audio, a muted Arena or a context the browser keeps
// suspended until a gesture (the first click or key resumes it) leave the replay playing in silence.

import { callSamples, choirOf, limiter, songSamples, voiceEvents } from "./duck-voice.js";
import { SAMPLE_RATE } from "./live/score.js";

/** A step longer than this between two frames is a jump, not playback. */
const JUMP_S = 0.25;
/** The voice under the replay, as the vote's cues sit (sound.js: 0.4–0.6). */
const GAIN = 0.6;

export function createStageVoice(loadCalls, { makeContext = () => new AudioContext(), muted }) {
  let loaded = null;
  let context = null;
  let output = null;
  // One speaker per duck, in duck order: its calls, and its song as one clip (0).
  let speakers = [];
  let version = 0;
  let last = 0;

  // A suspended context only starts from a resume() asked inside a gesture.
  const gestures = ["pointerdown", "keydown"];
  function resume() {
    context.resume().catch(() => {});
  }
  function stopWaitingForGesture() {
    for (const type of gestures) window.removeEventListener(type, resume, true);
    context?.removeEventListener("statechange", onStateChange);
  }
  function onStateChange() {
    if (context.state === "running") stopWaitingForGesture();
  }

  function halt(part) {
    if (part.source) {
      try {
        part.source.stop();
      } catch {
        // Already ended: nothing to stop.
      }
    }
    part.source = null;
    part.playing = -1;
  }

  function silence() {
    for (const speaker of speakers) {
      halt(speaker.calling);
      halt(speaker.singing);
    }
    speakers = [];
  }

  /** Has `part` play clip `index` (-1: nothing) from `offset` seconds into `buffer`, unless it already does and the clock did not jump. */
  function steer(part, index, jumped, buffer, offset) {
    if (index === part.playing && !jumped) return;
    halt(part);
    if (index < 0 || context.state !== "running") return;
    try {
      part.source = context.createBufferSource();
      part.source.buffer = buffer;
      part.source.connect(output);
      part.source.start(0, offset);
      part.playing = index;
    } catch {
      part.source = null;
    }
  }

  function bufferOf(samples) {
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  return {
    /** The troupe now on the stage, in duck order: how each duck sounds (duck-voice.js), and how many seconds their traces perform. */
    set(ducks, duration) {
      silence();
      const mine = ++version;
      const heard = ducks.map(({ sound }) => ({ sound, events: voiceEvents(sound, duration) }));
      if (!heard.some(({ sound, events }) => events.length || sound?.song)) return;
      // Two or more singers sing as a chorus, each its part: its place in the troupe.
      const choral = choirOf(ducks);
      loaded ??= loadCalls();
      loaded.then((calls) => {
        if (mine !== version) return;
        if (!context) {
          context = makeContext();
          const limit = limiter(context);
          limit.connect(context.destination);
          output = context.createGain();
          output.gain.value = GAIN;
          output.connect(limit);
          if (context.state !== "running") {
            for (const type of gestures) window.addEventListener(type, resume, true);
            context.addEventListener("statechange", onStateChange);
          }
        }
        speakers = heard.map(({ sound, events }, index) => {
          const sung = songSamples(calls, sound, duration, { choral, variant: index });
          return {
            clips: events.map((event) => {
              const samples = callSamples(calls, event, sound.voice);
              return { start: event.start, end: event.start + samples.length / SAMPLE_RATE, buffer: bufferOf(samples) };
            }),
            song: sung && { end: sung.length / SAMPLE_RATE, buffer: bufferOf(sung) },
            calling: { playing: -1, source: null },
            singing: { playing: -1, source: null },
          };
        });
      }).catch(() => {});
    },

    /** Called every frame with the replay's time, or null while it does not play. */
    follow(seconds) {
      const jumped = seconds === null || seconds < last || seconds - last > JUMP_S;
      if (seconds !== null) last = seconds;
      const live = seconds !== null && !muted();
      for (const { clips, song, calling, singing } of speakers) {
        const call = live ? clips.findIndex((clip) => clip.start <= seconds && seconds < clip.end) : -1;
        steer(calling, call, jumped, clips[call]?.buffer, seconds - clips[call]?.start);
        steer(singing, live && song && seconds < song.end ? 0 : -1, jumped, song?.buffer, seconds);
      }
    },

    dispose() {
      silence();
      version++;
      stopWaitingForGesture();
      context?.close().catch(() => {});
    },
  };
}
```

In `app/src/viewer.js`, in `setLanes`, replace

```js
    player = new Player(lanes.map((lane) => lane.trace), playerOptions);
    // What a lane's trace holds is what it performed: a cut-short performance falls silent with it.
    const performer = talent ? lanes[0] : null;
    voice?.set(performer?.sound ?? null, performer ? frameCount(performer.trace) * CTRL_DT : 0);
```

with:

```js
    player = new Player(lanes.map((lane) => lane.trace), playerOptions);
    // Every duck on the stage sounds for as long as the troupe's traces perform: a cut-short
    // performance falls silent with them. A race makes no sound.
    voice?.set(talent ? lanes : [], player.duration);
```

The stage still shows one lane until Task 11, so for now the troupe is that one duck.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/stage-voice.js app/src/stage-voice.test.js app/src/duck-voice.js app/src/duck-voice.test.js app/src/viewer.js
/usr/bin/git commit -m "The stage voices every duck of a troupe on its own speaker, all of them through one limiter, two singers as a chorus"
```

---

### Task 10: Pages hand the stage every duck

**Files:**
- Create: `app/src/cast.js`, `app/src/cast.test.js`
- Modify: `app/src/replay.js`, `app/src/api.js`, `app/src/race.js`, `app/src/run.js`, `app/src/vote.js`, `app/src/share.js`
- Test: `app/src/replay.test.js`, `app/src/api.test.js`, `app/src/run.test.js`, `app/src/share.test.js`, `app/src/vote.solo.test.js`
- Not touched: `app/src/clip/main.js` (Task 12) and `app/src/workshop/job.js` (Task 13). `home.js` builds no lanes: it plays the clip's MP4.

**Interfaces:**
- Consumes, from Tasks 3 and 6:
  - traces sent duck-major, with `X-Duck-Count` (absent = 1);
  - `cast` on board rows and on the run detail (top level), and `ballot.cast[lane]` with policies `"self"` or `"borrowed"`.
  - A cast entry is `{ policy, rig, start, sound }`, with `rig` null meaning the event's rig and `start` null meaning centred.
- Produces:
  - `splitDucks(values, ducks)` in `app/src/replay.js`: `Float32Array[]` views, duck-major.
  - `getTrace(runId)`, `getSettle(runId)` and `getBallotTrace(ballot, lane)` return `Promise<Float32Array[]>`, one per duck.
  - In `app/src/cast.js`:
    - `stageDucks(cast, traces, settles, { livery, eventRig, lead = 0 })` returns `[{ trace, lead, sound, rig, livery, start, star }]`. With `settles`, `trace` is `leadIn(settles[k], traces[k], lead)`. `rig` falls back to `eventRig`. A `"self"` duck takes `livery`, a borrowed one `"classic"`. `star` is true for duck 0.
    - `replayLane(event, cast, traces, lane)`: on a stage it returns `{ ...lane, ducks: stageDucks(…) }`, on a lane `{ ...lane, trace: traces[0] }`.
    - `featured(cast)`: the distinct borrowed policy dicts, in duck order.
  - `featuring(cast)` in `app/src/run.js`: a `<span>` "featuring @user · name, …" whose links go to `https://huggingface.co/<repo_id>/tree/<revision>`, or null.
  - Stage entries handed to `viewer.setLanes` are `{ runId?, name?, tier?, colour?, livery, ducks }`. Race entries are unchanged (`trace` = duck 0's trace) and carry no `sound`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/cast.test.js`:

```js
import { describe, expect, it } from "vitest";
import { featured, replayLane, stageDucks } from "./cast.js";
import { TRACE_WIDTH, frameCount } from "./replay.js";

const STAGE = { id: "got-a-talent", course: "stage", rig: "legs" };
const SPRINT = { id: "sprint-2m", course: "lane", rig: "legs" };
/** A borrowed policy as arena/cast.py borrowed_source records it. */
const borrowed = (user, name) => ({
  repo_id: `${user}/microduck-${name}`, filename: "policy.onnx", revision: "a".repeat(40),
  url: `https://huggingface.co/${user}/microduck-${name}/resolve/${"a".repeat(40)}/policy.onnx`,
  model_sha256: "f".repeat(64), user, policy_name: name,
});
const walker = borrowed("bob", "walker");
const frames = (count, value) => new Float32Array(count * TRACE_WIDTH).fill(value);
const SINGS = { song: [[0, 1, 69, 0.7, 0.9, 0]] };

describe("stageDucks", () => {
  const cast = [
    { policy: "self", rig: null, start: { x: 0, y: 0, yaw: 0 }, sound: SINGS },
    { policy: walker, rig: "rollers", start: { x: 0.4, y: -0.6, yaw: 90 }, sound: null },
    { policy: "self", rig: null, start: { x: -0.4, y: 0.6, yaw: 0 }, sound: null },
  ];
  const traces = [frames(3, 0), frames(3, 1), frames(3, 2)];

  it("draws every duck in duck order, the star first, each on its own trace, rig and place, singing its own sound", () => {
    expect(stageDucks(cast, traces, null, { livery: "purple", eventRig: "legs" })).toEqual([
      { trace: traces[0], lead: 0, sound: SINGS, rig: "legs", livery: "purple", start: cast[0].start, star: true },
      { trace: traces[1], lead: 0, sound: null, rig: "rollers", livery: "classic", start: cast[1].start, star: false },
      { trace: traces[2], lead: 0, sound: null, rig: "legs", livery: "purple", start: cast[2].start, star: false },
    ]);
  });

  it("dresses the author's own ducks in the entry's livery on an anonymous ballot too", () => {
    const ballot = cast.map((duck) => ({ ...duck, policy: duck.policy === "self" ? "self" : "borrowed" }));
    expect(stageDucks(ballot, traces, null, { livery: "classic", eventRig: "legs" }).map((duck) => duck.livery))
      .toEqual(["classic", "classic", "classic"]);
  });

  it("keeps a run recorded before troupes as it was: one duck, on the event's rig, with no place of its own", () => {
    const [star] = stageDucks([{ policy: "self", rig: null, start: null, sound: null }], [frames(2, 0)], null, { livery: "purple", eventRig: "legs" });
    expect(star).toMatchObject({ rig: "legs", livery: "purple", start: null, star: true });
  });

  it("plays each duck's settle first, every duck in step", () => {
    const settles = [frames(2, 10), frames(2, 11), frames(2, 12)];
    const ducks = stageDucks(cast, traces, settles, { livery: "purple", eventRig: "legs", lead: 2 });
    for (const [k, duck] of ducks.entries()) {
      expect(frameCount(duck.trace)).toBe(5);
      expect(duck.trace[0]).toBe(10 + k);
      expect(duck.trace[2 * TRACE_WIDTH]).toBe(k);
      expect(duck.lead).toBe(2);
    }
  });
});

describe("replayLane", () => {
  const lane = { runId: "r1", tier: "ghost", livery: "purple", name: "alice" };

  it("puts a stage's whole performance in its lane, every duck of its cast", () => {
    const cast = [{ policy: "self", rig: null, start: null, sound: null }, { policy: walker, rig: "rollers", start: null, sound: null }];
    const traces = [frames(2, 0), frames(2, 1)];
    const made = replayLane(STAGE, cast, traces, lane);
    expect(made).toMatchObject(lane);
    expect(made.ducks.map((duck) => [duck.trace, duck.rig, duck.livery])).toEqual([[traces[0], "legs", "purple"], [traces[1], "rollers", "classic"]]);
    expect(made.trace).toBeUndefined();
  });

  it("races a lane's one duck, as it always has", () => {
    const trace = frames(2, 0);
    expect(replayLane(SPRINT, [{ policy: "self", rig: null, start: null, sound: null }], [trace], lane)).toEqual({ ...lane, trace });
  });
});

describe("featured", () => {
  it("credits each borrowed policy once, in the order the troupe brings them", () => {
    const roller = borrowed("carol", "roller");
    const cast = [{ policy: "self" }, { policy: walker }, { policy: roller }, { policy: { ...walker } }, { policy: "self" }];
    expect(featured(cast)).toEqual([walker, roller]);
  });

  it("credits nobody when every duck is the author's own", () => {
    expect(featured([{ policy: "self" }, { policy: "self" }])).toEqual([]);
  });
});
```

In `app/src/replay.test.js`:

1. Replace the import of `./replay.js` with:

```js
import { CTRL_DT, Player, TRACE_WIDTH, applyFrame, frameAt, frameCount, leadIn, splitDucks, standing } from "./replay.js";
```

2. Add before `describe("leadIn", () => {`:

```js
describe("splitDucks", () => {
  it("cuts a troupe's frames into one trace per duck, in duck order, without copying", () => {
    const values = Float32Array.from([...traceOf(2), ...traceOf(2).map((v) => v + 100)]);
    const [first, second] = splitDucks(values, 2);
    expect(frameCount(first)).toBe(2);
    expect(frameCount(second)).toBe(2);
    expect(first[0]).toBe(0);
    expect(second[0]).toBe(100);
    expect(second.buffer).toBe(values.buffer);
  });

  it("hands a lane its one duck whole", () => {
    const values = traceOf(3);
    expect(splitDucks(values, 1)).toEqual([values]);
  });
});
```

In `app/src/api.test.js`:

1. Replace the head of `respondWith`,

```js
function respondWith({ ok = true, status = 200, statusText = "OK", body, bytes }) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    statusText,
    json: async () => {
```

with:

```js
function respondWith({ ok = true, status = 200, statusText = "OK", body, bytes, headers = {} }) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    json: async () => {
```

2. Replace the tests `"returns a Float32Array on success"` and `"fetches a run's settle the way it fetches its trace"` with:

```js
  it("returns one duck's Float32Array when the server counts no ducks: a lane's", async () => {
    const source = new Float32Array([1.5, 2.5, 3.5]);
    respondWith({ bytes: source.buffer });
    const ducks = await getTrace("01OK");
    expect(ducks).toHaveLength(1);
    expect(ducks[0]).toBeInstanceOf(Float32Array);
    expect([...ducks[0]]).toEqual([1.5, 2.5, 3.5]);
  });

  it("cuts a troupe's trace into its ducks, in duck order", async () => {
    respondWith({ bytes: new Float32Array([1, 2, 3, 4, 5, 6]).buffer, headers: { "X-Duck-Count": "3" } });
    expect((await getTrace("01OK")).map((duck) => [...duck])).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("fetches a run's settle the way it fetches its trace", async () => {
    respondWith({ bytes: new Float32Array([0.5, 0.25]).buffer, headers: { "X-Duck-Count": "2" } });
    const settles = await getSettle("01OK");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/01OK/settle");
    expect(settles.map((duck) => [...duck])).toEqual([[0.5], [0.25]]);
  });
```

3. Replace the test `"returns a Float32Array fetched over the ballot-scoped url"` with:

```js
  it("returns every duck of a lane, fetched over the ballot-scoped url", async () => {
    const source = new Float32Array([1.5, 2.5, 3.5, 4.5]);
    respondWith({ bytes: source.buffer, headers: { "X-Duck-Count": "2" } });
    const ducks = await getBallotTrace("tok.mac", 2);
    expect(ducks.map((duck) => [...duck])).toEqual([[1.5, 2.5], [3.5, 4.5]]);
    expect(fetch.mock.calls[0][0]).toBe("/api/ballots/tok.mac/lanes/2/trace");
  });
```

In `app/src/run.test.js`, change the import to `import { featuring, receiptCard, replayLine, runHall, verdict } from "./run.js";`. Then add at the end:

```js
describe("a troupe's credits", () => {
  const walker = { repo_id: "bob/microduck-walker", filename: "policy.onnx", revision: "a".repeat(40), user: "bob", policy_name: "walker" };
  const roller = { ...walker, repo_id: "carol/microduck-roller", user: "carol", policy_name: "roller" };

  it("features each borrowed policy once, linked to its repo at the commit that performed", () => {
    const credits = featuring([{ policy: "self" }, { policy: walker }, { policy: roller }, { policy: walker }]);
    expect(credits.textContent).toBe("featuring @bob · walker, @carol · roller");
    expect([...credits.querySelectorAll("a")].map((a) => a.href)).toEqual([
      `https://huggingface.co/bob/microduck-walker/tree/${"a".repeat(40)}`,
      `https://huggingface.co/carol/microduck-roller/tree/${"a".repeat(40)}`,
    ]);
  });

  it("credits nobody when every duck is the author's own", () => {
    expect(featuring([{ policy: "self" }, { policy: "self" }])).toBeNull();
  });
});
```

In `app/src/share.test.js`, replace the head of `describe("postText for a performance", …)`,

```js
describe("postText for a performance", () => {
  it("shares a performance as one", () => {
    const stageRun = { event: { title: "MicroDuck Got a Talent", course: "stage" }, seeds_total: 1, seeds_finished: 1,
      score: 20, receipts: [{ points: 100 }], per_seed: [], run_id: "r1", rank: 1, on_board: true, policy_url: null };
    const text = postText(stageRun, { origin: "https://arena.test", network: "linkedin" });
```

with:

```js
describe("postText for a performance", () => {
  const duck = { policy: "self", rig: null, start: null, sound: null };
  const stageRun = { event: { title: "MicroDuck Got a Talent", course: "stage" }, seeds_total: 1, seeds_finished: 1,
    score: 20, receipts: [{ points: 100 }], per_seed: [], run_id: "r1", rank: 1, on_board: true, policy_url: null, cast: [duck] };

  it("shares a performance as one", () => {
    const text = postText(stageRun, { origin: "https://arena.test", network: "linkedin" });
```

Then, in the same describe, add after the test `"shares a performance as one"`:

```js
  it("shares a troupe as robot ducks", () => {
    const troupe = { ...stageRun, cast: [duck, duck, duck] };
    const text = postText(troupe, { origin: "https://arena.test", network: "linkedin" });
    expect(text).toContain("I coded robot ducks to perform. On MicroDuck Got a Talent they gave a 20.00 s performance (+100 pts).");
    expect(text).toContain("Watch them: https://arena.test/r/r1");
    expect(postText({ ...troupe, seeds_finished: 0, receipts: [] }, { origin: "https://arena.test", network: "linkedin" }))
      .toContain("Their performance on MicroDuck Got a Talent was cut short.");
  });
```

Replace `app/src/vote.solo.test.js` with:

```js
import { expect, it, vi } from "vitest";
import { renderVote } from "./vote.js";
import { createViewer } from "./viewer.js";
import { getBallotTrace } from "./api.js";

vi.mock("./viewer.js", () => ({ createViewer: vi.fn() }));
vi.mock("./api.js", () => ({
  getMe: vi.fn(async () => ({ signed_in: false })),
  getBallot: vi.fn(async () => {
    const duck = { policy: "self", rig: null, start: null, sound: null };
    // The second performance is a troupe: the author's duck and a borrowed roller.
    const cast = [[duck], [duck, { ...duck, policy: "borrowed", rig: "rollers" }], [duck]];
    return { state: "ballot", ballot: "test", lanes: 3, cast, cast_today: 0, per_day: 20 };
  }),
  getBallotTrace: vi.fn(async (_, lane) => (lane === 1 ? [new Float32Array([1]), new Float32Array([10])] : [new Float32Array([lane])])),
  castVote: vi.fn(),
}));

it("plays MicroDuck Got a Talent ballot entries one at a time and lets the viewer watch each performance", async () => {
  const viewer = { setLanes: vi.fn() };
  createViewer.mockResolvedValue(viewer);
  const root = document.createElement("div");
  const event = { id: "got-a-talent", title: "MicroDuck Got a Talent", rig: "legs", course: "stage" };
  await renderVote(root, { event, state: {} });
  expect(getBallotTrace).toHaveBeenCalledTimes(3);
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => duck.trace[0])).toEqual([0]);
  const buttons = root.querySelectorAll('[aria-label="Watch performances individually"] button');
  expect(buttons).toHaveLength(3);
  buttons[2].click();
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => duck.trace[0])).toEqual([2]);
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelectorAll('.vote-pick')).toHaveLength(3);
  // A troupe takes the stage whole, every duck in the ballot's one livery, each on its own rig.
  buttons[1].click();
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => [duck.trace[0], duck.livery, duck.rig])).toEqual([
    [1, "classic", "legs"], [10, "classic", "rollers"],
  ]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/cast.test.js src/replay.test.js src/api.test.js src/run.test.js src/share.test.js src/vote.solo.test.js`
Expected: FAIL.
- `cast.test.js` cannot import `./cast.js`.
- `splitDucks` and `featuring` are not functions.
- The api tests get a bare `Float32Array`, not one per duck.
- The troupe's share text says "a robot duck".
- The ballot's lane has no `ducks`.

- [ ] **Step 3: Implement the fetch**

In `app/src/replay.js`, add after `frameCount`:

```js
/**
 * A troupe's trace or settle as the server sends it, every duck's frames one after the other,
 * cut into one per duck, in duck order: views, no copy. A lane's is its one duck.
 */
export function splitDucks(values, ducks) {
  const length = values.length / ducks;
  return Array.from({ length: ducks }, (_, k) => values.subarray(k * length, (k + 1) * length));
}
```

In `app/src/api.js`:

1. After the header comment, add:

```js

import { splitDucks } from "./replay.js";
```

2. Replace `frames`, `getTrace` and `getSettle` (from `async function frames(path) {` through the end of `getSettle`) with:

```js
async function frames(path) {
  const response = await fetch(path);
  // Same contract as every other call: the server's own sentence, not a status.
  if (!response.ok) throw new Error(await detailFrom(response));
  // Raw little-endian float32 from the server, 21 values per frame, one duck after the other: a
  // stage sends every duck of its troupe (X-Duck-Count), a lane its one duck.
  const ducks = Number(response.headers.get("X-Duck-Count") ?? 1);
  return splitDucks(new Float32Array(await response.arrayBuffer()), ducks);
}

/** A run's trace, one per duck, in duck order: a lane's is its one duck. */
export function getTrace(runId) {
  return frames(`/api/runs/${runId}/trace`);
}

/** The untimed settle before a run's trace, from the reset pose, one per duck; empty for a run stored before settles were recorded. */
export function getSettle(runId) {
  return frames(`/api/runs/${runId}/settle`);
}
```

3. Replace

```js
/** One lane's replay. Addressed through the ballot, so no run id is exposed. */
export const ballotTraceUrl = (ballot, lane) => `/api/ballots/${ballot}/lanes/${lane}/trace`;

export async function getBallotTrace(ballot, lane) {
  const response = await fetch(ballotTraceUrl(ballot, lane));
  if (!response.ok) throw new Error(await detailFrom(response));
  return new Float32Array(await response.arrayBuffer());
}
```

with:

```js
/** One lane's replay, one trace per duck. Addressed through the ballot, so no run id is exposed. */
export const ballotTraceUrl = (ballot, lane) => `/api/ballots/${ballot}/lanes/${lane}/trace`;

export const getBallotTrace = (ballot, lane) => frames(ballotTraceUrl(ballot, lane));
```

- [ ] **Step 4: Implement the troupe's lanes**

Create `app/src/cast.js`:

```js
// A performance's troupe on the page: the record's `cast` (arena/store.py RunRecord.cast; a board
// row and a run carry it, a ballot lane carries it anonymous, every policy "self" or "borrowed")
// beside the traces the server sends for it, one per duck. Duck 0 is the star: the entry's own
// policy, the one the followspot follows.

import { isStage } from "./format.js";
import { leadIn } from "./replay.js";

/**
 * Every duck of a performance as the stage draws it, in duck order: its trace (after `lead` frames
 * of its settle when `settles` are given, as a clip plays it), how it sounds, the rig it stands on
 * (the event's when the cast names none), its livery, and where its author placed it — null for a
 * run recorded before troupes, which the stage centres on its own path. A duck of the author's own
 * policy wears the entry's livery; a borrowed one the plain `classic`, so the colours stay the
 * author's.
 */
export function stageDucks(cast, traces, settles, { livery, eventRig, lead = 0 }) {
  return cast.map((duck, k) => ({
    trace: settles ? leadIn(settles[k], traces[k], lead) : traces[k],
    lead,
    sound: duck.sound,
    rig: duck.rig ?? eventRig,
    livery: duck.policy === "self" ? livery : "classic",
    start: duck.start,
    star: k === 0,
  }));
}

/**
 * One run as a lane of the viewer, from its traces (api.js, one per duck): on a stage its
 * performance, every duck of its cast; on a lane the one duck that raced. `lane` is what the page
 * draws it with: run id, name, tier, colour, livery.
 */
export function replayLane(event, cast, traces, lane) {
  return isStage(event)
    ? { ...lane, ducks: stageDucks(cast, traces, null, { livery: lane.livery, eventRig: event.rig }) }
    : { ...lane, trace: traces[0] };
}

/** The policies a troupe borrowed from the Hub, each once, in the order its ducks first bring them. */
export function featured(cast) {
  const policies = new Map();
  for (const { policy } of cast) {
    if (policy !== "self") policies.set(`${policy.repo_id}@${policy.revision}`, policy);
  }
  return [...policies.values()];
}
```

In `app/src/race.js`:

1. After `import { boardsheetMarkup, podium, wireBoardsheet } from "./boardsheet.js";` add `import { replayLane } from "./cast.js";`.
2. Replace

```js
  const names = new Map(); // run id -> whose run it is, for the plate over its duck
  const sounds = new Map(); // run id -> how its performance sounds
```

with:

```js
  const names = new Map(); // run id -> whose run it is, for the plate over its duck
  const casts = new Map(); // run id -> every duck it put on the stage (cast.js)
```

3. Replace the body of `race` from `const lanes = runIds.map((runId, i) => ({` through the `viewer.setLanes(…)` line with:

```js
    const lanes = runIds.map((runId, i) => replayLane(event, casts.get(runId), published[i], {
      runId,
      tier: tiers.get(runId) ?? "ghost",
      // A published run keeps the colourway it raced in.
      livery: liveries.get(runId) ?? "classic",
      // The plate over the duck: the viewer builds one for a lane with a name.
      name: names.get(runId),
    }));
    // A stage plays one performance at a time, its whole troupe.
    viewer.setLanes(arrangeLanes(board, isStage(event) ? lanes.slice(0, 1) : lanes), event);
```

4. Replace `        sounds.set(row.run_id, row.sound);` with `        casts.set(row.run_id, row.cast);`.

In `app/src/run.js`:

1. After `import { boardsheetMarkup, wireBoardsheet } from "./boardsheet.js";` add `import { featured, replayLane } from "./cast.js";`.
2. Add after `receiptCard`, before the doc comment of `runHall`:

```js
/**
 * The policies a troupe borrowed, each credited to its author and linked to its repo at the commit
 * that performed: they earn nothing from it, but they are named. Null when every duck is the
 * author's own.
 */
export function featuring(cast) {
  const policies = featured(cast);
  if (!policies.length) return null;
  const line = el("span", null, "featuring ");
  policies.forEach((policy, i) => {
    const link = el("a", null, `@${policy.user} · ${policy.policy_name}`);
    link.href = `https://huggingface.co/${policy.repo_id}/tree/${policy.revision}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (i) line.append(", ");
    line.append(link);
  });
  return line;
}

```

3. Replace `  $("byline").append(who, ` · ${run.policy_name} · ${run.submitted_at.slice(0, 10)}`);` with:

```js
  $("byline").append(who, ` · ${run.policy_name}`);
  const credits = featuring(run.cast);
  if (credits) $("byline").append(" · ", credits);
  $("byline").append(` · ${run.submitted_at.slice(0, 10)}`);
```

4. In `race`, replace

```js
    const lanes = runIds.map((id, i) => ({
      runId: id,
      trace: fetched[i],
      tier: tiers.get(id) ?? "ghost",
      livery: byId.get(id).livery,
      sound: byId.get(id).sound,
      // The plate over the duck.
      name: byId.get(id).user,
    }));
```

with:

```js
    const lanes = runIds.map((id, i) => replayLane(run.event, byId.get(id).cast, fetched[i], {
      runId: id,
      tier: tiers.get(id) ?? "ghost",
      livery: byId.get(id).livery,
      // The plate over the duck.
      name: byId.get(id).user,
    }));
```

In `app/src/vote.js`:

1. After `import { castVote, getBallot, getBallotTrace, getMe } from "./api.js";` add `import { replayLane } from "./cast.js";`.
2. Replace

```js
    const entries = traces.map((trace, lane) => ({
      runId: null,
      trace,
      // Every performer wears the same livery on an anonymous ballot.
      tier: "leader",
      livery: "classic",
      colour: LANE_COLORS[lane % LANE_COLORS.length],
      sound: ballot.sound[lane],
    }));
```

with:

```js
    const entries = traces.map((duckTraces, lane) => replayLane(event, ballot.cast[lane], duckTraces, {
      runId: null,
      // Every performer wears the same livery on an anonymous ballot, every duck of a troupe too.
      tier: "leader",
      livery: "classic",
      colour: LANE_COLORS[lane % LANE_COLORS.length],
    }));
```

In `app/src/share.js`, in `postText`:

1. Replace

```js
  const stage = isStage(run.event);
  let result;
  if (stage) {
    result = run.seeds_finished === 0
      ? `Its performance on ${run.event.title} was cut short.`
      : `On ${run.event.title} it gave a ${run.score.toFixed(2)} s performance${points}.`;
```

with:

```js
  const stage = isStage(run.event);
  // A troupe is shared as the robot ducks it is.
  const troupe = stage && run.cast.length > 1;
  let result;
  if (stage) {
    result = run.seeds_finished === 0
      ? `${troupe ? "Their" : "Its"} performance on ${run.event.title} was cut short.`
      : `On ${run.event.title} ${troupe ? "they" : "it"} gave a ${run.score.toFixed(2)} s performance${points}.`;
```

2. Replace

```js
    `I coded a robot duck to ${stage ? "perform" : "walk"}. ${result}`,
    `${stage ? "Watch it" : "Beat it"}: ${origin}/r/${run.run_id}`,
```

with:

```js
    `I coded ${troupe ? "robot ducks" : "a robot duck"} to ${stage ? "perform" : "walk"}. ${result}`,
    `${troupe ? "Watch them" : stage ? "Watch it" : "Beat it"}: ${origin}/r/${run.run_id}`,
```

Then: `grep -rn -e "row.sound" -e "ballot.sound" -e "get(id).sound" -e "sounds.get" app/src` must print nothing: no page reads a `sound` from a payload any more (the clip's `lane.sound` goes in Task 12, `workshop/job.js`'s `body.sound` in Task 13).

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/src/cast.js app/src/cast.test.js app/src/replay.js app/src/replay.test.js app/src/api.js app/src/api.test.js app/src/race.js app/src/run.js app/src/run.test.js app/src/vote.js app/src/vote.solo.test.js app/src/share.js app/src/share.test.js
/usr/bin/git commit -m "Every page fetches each duck of a performance and hands the stage the whole troupe; the run page credits the policies it borrowed"
```

---

### Task 11: The stage draws a troupe

**Files:**
- Modify: `app/src/talent-stage.js`, `app/src/viewer.js`
- Test: `app/src/talent-stage.test.js`, `app/src/viewer.test.js`

**Interfaces:**
- Consumes:
  - Task 1's event summary for a stage: `size_m` [depth along x, width along y];
  - a stage entry `{ name, livery, ducks: [{ trace, lead, sound, rig, livery, start, star }] }`, the shape of Task 10's `stageDucks`;
  - `workshop/job.js`'s current call, which hands a stage the race-shaped entry `{ trace, sound, tier, livery, name }`.
- Produces:
  - `stageLayout(event)` reads `event.size_m`: `{ width: size_m[1], depth: size_m[0], centre: 0, juryZ, audienceZ }`. There is no fallback.
  - `placeStageDuck(rig, duck, centre)`: a duck with `start` is drawn at its trace's own position, turned as `placeStagePerformer` turns a performer. A duck with `start` null (or absent) is centred on its own path, as today.
  - `stageCameraPose(seconds, subjects, aspect, fov, depth)`. `subjects` holds every duck's smoothed place, the star first.
    - Every shot frames the middle of the troupe's bounding box, its fit distance growing with the box's half diagonal.
    - The low-front shot (14–18 s) frames the star alone.
    - With one subject, the result is exactly today's.
  - `stageLanes(entries)` in `app/src/viewer.js`: one lane per duck, in duck order, `opacity` 1, the entry's `name` on the star alone. An entry without `ducks` is a troupe of one: `{ ...entry, star: true }`.
  - The viewer loads both rigs, `legs` and `rollers`. A lane's rig is `entry.rig ?? rigName`.
  - The followspot follows `subjects[0]`, the star, since the lanes are in duck order.

- [ ] **Step 1: Write the failing tests**

In `app/src/talent-stage.test.js`:

1. Replace the imports of `./talent-stage.js`, `./replay.js` and `./rig.js` and the `subjects` constant (lines 5–9) with:

```js
import { buildTalentStage, stageCameraPose, stageLayout, placeStageDuck, placeStagePerformer, stageCameraTarget } from "./talent-stage.js";
import { applyFrame } from "./replay.js";
import { meshNames, buildRigTree, STAND, TRUNK_HEIGHT } from "./rig.js";

const STAGE = { id: "got-a-talent", course: "stage", size_m: [2.6, 3.8] };
const subjects = [new Vector3(0.4, 0.14, 0.1)];
```

2. Replace the test `"holds its last shot past the cycle…"`, the end of its describe, and the whole `describe("theatre layout", …)` with:

```js
  it("holds its last shot past the cycle: a clip's outro ends on the crane, not back on the opening", () => {
    const subject = [new Vector3(0, 0.14, 0)];
    const end = stageCameraPose(24, subject, 16 / 9, 42);
    const after = stageCameraPose(25.5, subject, 16 / 9, 42);
    expect(after.shot).toBe("crane");
    expect(after.position).toEqual(end.position);
  });
  it("frames a lone performer exactly as it always has", () => {
    // Taken from the camera before troupes, for the performer above.
    const before = [
      [16 / 9, 4, [0.22570329630569386, 0.29702503451609114, -1.0532500891160745], [0.4, 0.18, 0.1]],
      [16 / 9, 8, [-0.42583949082768935, 0.35399089951391566, -0.7020673712856054], [0.4, 0.18, 0.1]],
      [16 / 9, 12, [3.7055501813912617, 1.161959192494971, 0.644469571681202], [0.4, 0.33, -0.15]],
      [16 / 9, 16, [0.7610272280823642, 0.24792066517393552, -0.9714635177655214], [0.4, 0.18, 0.1]],
      [9 / 16, 4, [-0.9158909874814564, 0.3787024028692959, -1.38], [0.4, 0.18, 0.1]],
      [9 / 16, 20, [-2.2931488880415913, 4.862977596065165, -11.231835275359844], [0.4, 0.83, 0.1]],
    ];
    for (const [aspect, time, position, target] of before) {
      const pose = stageCameraPose(time, subjects, aspect, 42);
      pose.position.forEach((value, i) => expect(value).toBeCloseTo(position[i], 9));
      pose.target.forEach((value, i) => expect(value).toBeCloseTo(target[i], 9));
    }
  });
});

describe("the broadcast camera on a troupe", () => {
  // Four ducks spread over the stage, the star first.
  const troupe = [new Vector3(0.2, 0.14, 0.1), new Vector3(-1.3, 0.14, -0.7), new Vector3(1.4, 0.14, 0.7), new Vector3(0.9, 0.14, -0.8)];

  it.each([16 / 9, 9 / 16])("keeps every duck in frame at aspect %s, but in the star's close-up", aspect => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    for (let time = 0; time <= 24; time += 0.25) {
      const pose = stageCameraPose(time, troupe, aspect, 42, 2.6);
      if (pose.shot === "low-front") continue;
      camera.position.set(...pose.position);
      camera.lookAt(new Vector3(...pose.target));
      camera.updateMatrixWorld();
      for (const duck of troupe) {
        for (const height of [-0.14, 0.23]) {
          const projected = duck.clone().add(new Vector3(0, height, 0)).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.9);
          expect(Math.abs(projected.y)).toBeLessThan(0.9);
        }
      }
    }
  });
  it("closes in on the star alone in the low front shot, as on a lone performer", () => {
    for (const time of [14, 16, 17.9]) {
      expect(stageCameraPose(time, troupe, 16 / 9, 42)).toEqual(stageCameraPose(time, troupe.slice(0, 1), 16 / 9, 42));
    }
  });
  it("frames ducks all on one spot as that one duck", () => {
    const stacked = [troupe[0], troupe[0].clone(), troupe[0].clone()];
    for (let time = 0; time <= 24; time += 0.5) {
      expect(stageCameraPose(time, stacked, 16 / 9, 42)).toEqual(stageCameraPose(time, troupe.slice(0, 1), 16 / 9, 42));
    }
  });
});

describe("theatre layout", () => {
  it("builds the theatre round the event's own floor, centred on the physics' origin", () => {
    const layout = stageLayout({ ...STAGE, size_m: [3, 5] });
    expect(layout).toMatchObject({ width: 5, depth: 3, centre: 0 });
    expect(layout.juryZ).toBeLessThan(-layout.depth / 2);
    expect(layout.audienceZ).toBeLessThan(layout.juryZ - 0.5);
  });
});
```

3. In `"seats four official judges…"`, replace `buildTalentStage({ id: "got-a-talent" }, { kinematics, geometries }, reachy)` with `buildTalentStage(STAGE, { kinematics, geometries }, reachy)`.

4. Add before `it("rejects gait sway and vertical bounce while following deliberate travel, even when seeking", () => {`:

```js
describe("a troupe's places", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const frame = (x, y) => [x, y, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND];
  const trunkAt = (rig, trace) => {
    applyFrame(rig, trace.subarray(0, 21));
    return rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  };

  it("draws a placed duck where its trace says: x towards the audience at -Z, y to its right at -X", () => {
    const rig = buildRigTree(kinematics);
    const trace = Float32Array.from([...frame(0.4, -0.6), ...frame(0.5, -0.6)]);
    placeStageDuck(rig, { trace, start: { x: 0.4, y: -0.6, yaw: 90 } }, 0);
    const at = trunkAt(rig, trace);
    expect(at.x).toBeCloseTo(0.6);
    expect(at.z).toBeCloseTo(-0.4);
    const forward = new Vector3(1, 0, 0).applyQuaternion(rig.placer.quaternion);
    expect(forward.z).toBeCloseTo(-1);
  });

  it("centres a run recorded before troupes on its own path, as it always was", () => {
    const rig = buildRigTree(kinematics);
    const trace = Float32Array.from([...frame(1, 0.3), ...frame(2, 0.3)]);
    placeStageDuck(rig, { trace, start: null }, 0);
    const at = trunkAt(rig, trace);
    expect(at.x).toBeCloseTo(0);
    expect(at.z).toBeCloseTo(0.5);
  });
});

```

In `app/src/viewer.test.js`, change the import to `import { cameraPose, dragPose, stageLanes, travelPose } from "./viewer.js";`. Then add at the end:

```js
describe("stageLanes", () => {
  const trace = new Float32Array(21);
  const duck = { trace, lead: 0, sound: null, rig: "legs", livery: "purple", start: { x: 0, y: 0, yaw: 0 }, star: false };

  it("puts every duck of the performance on the stage in duck order, each on its own rig, the star alone named", () => {
    const ducks = [{ ...duck, star: true }, { ...duck, rig: "rollers", livery: "classic", start: { x: 0.4, y: -0.6, yaw: 90 } }, duck];
    const lanes = stageLanes([{ runId: "r1", name: "alice", livery: "purple", tier: "ghost", colour: "#ff7a2f", ducks }]);
    expect(lanes.map((lane) => [lane.rig, lane.livery, lane.start, lane.name, lane.opacity])).toEqual([
      ["legs", "purple", duck.start, "alice", 1],
      ["rollers", "classic", { x: 0.4, y: -0.6, yaw: 90 }, undefined, 1],
      ["legs", "purple", duck.start, undefined, 1],
    ]);
  });

  it("takes a workshop checkpoint's lane as a troupe of one, drawn centred on the event's rig", () => {
    const [lane] = stageLanes([{ trace, sound: null, tier: "trial", livery: "classic", name: "checkpoint 500" }]);
    expect(lane).toMatchObject({ trace, star: true, opacity: 1, name: "checkpoint 500" });
    expect(lane.start).toBeUndefined();
    expect(lane.rig).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/talent-stage.test.js src/viewer.test.js`
Expected: FAIL.
- `placeStageDuck` and `stageLanes` are not functions.
- The layout reads no `size_m`: `expected { width: 3.8, depth: 2.6, … } to match object { width: 5, depth: 3, centre: +0 }`.
- Both troupe-framing tests find ducks out of frame: `expected 10.88… to be less than 0.9`.

- [ ] **Step 3: Implement the stage**

In `app/src/talent-stage.js`:

1. Add `Box3` to the `three` import: `  AdditiveBlending, AmbientLight, Box3, BoxGeometry, CanvasTexture, CircleGeometry, Color,`.

2. Replace `stageLayout` with:

```js
/** The theatre round the event's own floor (arena/manifest.py Stage.size_m): its depth runs along
 * the physics' x, towards the audience at -Z, its width along y, across X. Its centre is the
 * physics' origin, which a troupe's places are measured from. */
export function stageLayout(event) {
  const [depth, width] = event.size_m;
  return { width, depth, centre: 0, juryZ: -depth / 2 - 0.5, audienceZ: -depth / 2 - 1.25 };
}
```

3. Add before `// A symmetric 2.4 s Hann window removes gait sway without introducing lag.`:

```js
// A duck of a troupe stands where its trace says: the trace is in the stage's frame, its origin
// the stage's centre, turned as placeStagePerformer turns a performer to face the audience. A run
// recorded before troupes has no place of its own and is centred on its own path, as it always was.
export function placeStageDuck(rig, duck, centre) {
  if (!duck.start) {
    placeStagePerformer(rig, duck.trace, centre);
    return;
  }
  rig.placer.rotation.set(0, Math.PI / 2, 0);
  rig.placer.position.set(centre, 0, 0);
}

```

4. Replace the head of `stageCameraPose`, from `// The broadcast clock keeps moving during clip titles, even while replay time` through `  let shot, angle, distance, elevation;`, with:

```js
// Where a troupe stands, from each duck's smoothed place: the middle of their extent, and how far
// its corners reach from it. One duck is its own middle, with no spread.
function troupeFrame(subjects) {
  if (!subjects.length) return { middle: new Vector3(0, 0.14, 0), spread: 0 };
  const box = new Box3().setFromPoints(subjects);
  const middle = box.getCenter(new Vector3());
  return { middle, spread: Math.hypot(box.max.x - middle.x, box.max.z - middle.z) };
}

// The broadcast clock keeps moving during clip titles, even while replay time
// is held at zero. Each camera moves within its shot; cuts are instantaneous.
// `subjects` are the ducks' places, the star first: every shot frames the whole
// troupe, backed off to hold its spread, but the low front shot, the star's close-up.
export function stageCameraPose(seconds, subjects, aspect, fov, depth = 2.6) {
  // One cycle of shots; a clip runs past it (titles and outro around a 20 s performance), and
  // there the last shot holds rather than cutting back to the opening.
  const time = Math.min(Math.max(0, seconds), 24);
  const { middle, spread } = troupeFrame(time >= 14 && time < 18 ? subjects.slice(0, 1) : subjects);
  const target = middle.clone();
  target.y = Math.max(0.14, target.y) + 0.04;
  const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, aspect));
  const fit = (0.32 + spread) / Math.sin(halfFov) * 1.18;
  let shot, angle, distance, elevation;
```

The shots below are unchanged. The followspot in `pose` already follows `subjects[0]`.

- [ ] **Step 4: Implement the viewer**

In `app/src/viewer.js`:

1. Replace the import of `./talent-stage.js` with:

```js
import { buildTalentStage, stageCameraPose, placeStageDuck, stageCameraTarget } from "./talent-stage.js";
```

2. Replace

```js
export function placeLane(rig, laneZ) {
  rig.placer.position.z = laneZ;
  rig.placer.rotation.set(0, 0, 0);
}
```

with:

```js
export function placeLane(rig, laneZ) {
  rig.placer.position.z = laneZ;
  rig.placer.rotation.set(0, 0, 0);
}

/**
 * The lanes a stage draws: one per duck of the performance it plays (cast.js stageDucks), in duck
 * order, the star first. Every duck is drawn solid, and the plate over the star alone names the
 * entry. The workshop's checkpoint replay hands its one duck as the entry itself. Pure, so it is
 * testable.
 */
export function stageLanes(entries) {
  return entries.flatMap((entry) => (entry.ducks ?? [{ ...entry, star: true }])
    .map((duck) => ({ ...duck, opacity: 1, name: duck.star ? entry.name : undefined })));
}
```

3. In `createViewer`, replace

```js
  // `rigName` and not `rig`, because setLanes below names each lane's built
  // tree `rig` — the two would shadow, and it would work by accident today
  // only because nothing reads the parameter after this line.
  //
  // The rig is fixed for the life of this viewer, which matches the page: one
  // race page shows one event, and an event declares one rig. The crowd is
  // always on foot, in its own lighter model.
  const [{ kinematics, geometries }, spectators, reachy, branding] = await Promise.all([
    loadAssets(rigName),
    loadAssets("legs", CROWD_MODEL),
    loadGlb("reachy-mini/reachy-mini.glb"),
    loadGymBranding(),
  ]);
```

with:

```js
  // `rigName` and not `rig`, because setLanes below names each lane's built
  // tree `rig` — the two would shadow.
  //
  // A race's lanes all stand on `rigName`, which matches the page: one race
  // page shows one event, and an event declares one rig. A stage's troupe may
  // mix legs and rollers, each duck on its own, so both rigs are loaded. The
  // crowd is always on foot, in its own lighter model.
  const [legs, rollers, spectators, reachy, branding] = await Promise.all([
    loadAssets("legs"),
    loadAssets("rollers"),
    loadAssets("legs", CROWD_MODEL),
    loadGlb("reachy-mini/reachy-mini.glb"),
    loadGymBranding(),
  ]);
  const rigs = { legs, rollers };
```

4. In `setLanes`, replace `    if (talent) entries = entries.slice(0, 1);` with `    if (talent) entries = stageLanes(entries);`.

5. In the `lanes = entries.map((entry, i) => {` callback, replace

```js
      const tier = entry.tier ?? "ghost";
      const rig = buildRigTree(kinematics);
```

with:

```js
      const tier = entry.tier ?? "ghost";
      // A duck of a troupe stands on its own rig; a race's lanes on the event's.
      const { kinematics, geometries } = rigs[entry.rig ?? rigName];
      const rig = buildRigTree(kinematics);
```

6. Replace `      if (talent) placeStagePerformer(rig, entry.trace, stage.layout.centre);` with `      if (talent) placeStageDuck(rig, entry, stage.layout.centre);`.

7. In `draw`, replace

```js
          lanes.length ? [stageCameraTarget(lanes[0].trace, player.time, lanes[0].rig.placer)] : [],
```

with:

```js
          lanes.map((lane) => stageCameraTarget(lane.trace, player.time, lane.rig.placer)),
```

Each lane is now one duck, so `mouthTrack(entry.sound, …)` and `jawPivot` give every duck its own beak, and the shadow disc and the nameplate stay per lane. The stage's `pose` receives every duck's trunk, the star first, which keeps the followspot on the star. Task 9's `voice?.set(talent ? lanes : [], player.duration)` now hands over the whole troupe.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/src/talent-stage.js app/src/talent-stage.test.js app/src/viewer.js app/src/viewer.test.js
/usr/bin/git commit -m "The stage draws a troupe: each duck on its own rig and in its place, the camera framing them all and the followspot on the star"
```

---

### Task 12: The clip performs a troupe

**Files:**
- Modify: `app/src/replay.js`, `app/src/cast.js`, `app/src/clip/main.js`, `app/src/clip/score.js`, `app/src/clip/soundtrack.js`
- Test: `app/src/replay.test.js`, `app/src/cast.test.js`, `app/src/clip/score.test.js`, `app/src/clip/soundtrack.test.js`

**Interfaces:**
- Consumes:
  - Task 8's `choirOf` and `songSamples(…, { choral, variant })`;
  - Task 9's `limiter(context)`;
  - Task 10's `getTrace`/`getSettle` (one array per duck), `stageDucks` and `featured`;
  - Task 11's stage entries.
- Produces:
  - `standing(settles)` in `app/src/replay.js` takes every duck's settle and returns them trimmed together, by the most frames any duck spends rising.
  - `clipScore({ run, plan, trace, ducks })`, where `ducks` is `[{ sound }]` in duck order and `[]` for a race.
    - A call cue is `{ at, call, voice, gain }`, one track per duck.
    - A song cue is `{ at, song: { sound, duration, part: { choral, variant } }, gain }`, one per singing duck.
  - `renderSoundtrack` renders each part through `songSamples` and ends the mix with `limiter(context)`.
  - `credit(run)` in `app/src/cast.js` returns `"@user · name"` for one duck, and `"@user · name · N ducks"` for a troupe, followed by `", featuring @a · x, @b · y"` when it borrowed.

- [ ] **Step 1: Write the failing tests**

In `app/src/replay.test.js`, replace `describe("standing", …)` with:

```js
describe("standing", () => {
  // A roller-sprint-2m settle's first frames, from the run log.
  const roller = settleOf([0.12, 0.1268, 0.1327, 0.1357, 0.1359, 0.1337, 0.1294]);
  const walker = settleOf([0.12, 0.1174, 0.115, 0.1151, 0.1151, 0.1151, 0.1151]);

  it("drops the frames the solver spends lifting the roller rig's wheels out of the floor", () => {
    expect(standing([roller]).map((settle) => [...settle])).toEqual([[...roller.subarray(4 * TRACE_WIDTH)]]);
  });

  it("keeps every frame of a walking duck dropping onto the floor", () => {
    expect(standing([walker])).toEqual([walker]);
  });

  it("keeps a troupe in step: every duck loses the frames its roller needs", () => {
    const [legs, wheels] = standing([walker, roller]);
    expect([...legs]).toEqual([...walker.subarray(4 * TRACE_WIDTH)]);
    expect([...wheels]).toEqual([...roller.subarray(4 * TRACE_WIDTH)]);
  });

  it("keeps a run stored without a settle empty", () => {
    expect(standing([new Float32Array(0)]).map(frameCount)).toEqual([0]);
  });
});
```

In `app/src/cast.test.js`, change the import to `import { credit, featured, replayLane, stageDucks } from "./cast.js";`. Then add at the end:

```js
describe("credit", () => {
  const run = { user: "alice", policy_name: "sitter" };

  it("names the author and the star's policy for a lone duck", () => {
    expect(credit({ ...run, cast: [{ policy: "self" }] })).toBe("@alice · sitter");
  });

  it("counts a troupe's ducks, featuring each borrowed policy once", () => {
    const roller = borrowed("carol", "roller");
    const cast = [{ policy: "self" }, { policy: walker }, { policy: "self" }, { policy: roller }, { policy: walker }];
    expect(credit({ ...run, cast })).toBe("@alice · sitter · 5 ducks, featuring @bob · walker, @carol · roller");
  });

  it("features nobody in a troupe of the author's own", () => {
    expect(credit({ ...run, cast: [{ policy: "self" }, { policy: "self" }, { policy: "self" }] })).toBe("@alice · sitter · 3 ducks");
  });
});
```

In `app/src/clip/score.test.js`:

1. Give every `clipScore` call its troupe, a race's being none:
   - `clipScore({ run: { run_id: "R1", event, seeds_finished: 5 }, plan, trace })` becomes `clipScore({ run: { run_id: "R1", event, seeds_finished: 5 }, plan, trace, ducks: [] })`;
   - `clipScore({ run: { run_id: "R2", event, seeds_finished: 0 }, plan, trace })` becomes `clipScore({ run: { run_id: "R2", event, seeds_finished: 0 }, plan, trace, ducks: [] })`;
   - in the `quiet` call, `      plan, trace,` becomes `      plan, trace, ducks: [],`;
   - `const score = clipScore({ run, plan, trace });` becomes `const score = clipScore({ run, plan, trace, ducks: [{ sound: null }] });`;
   - `const voice = clipScore({ run, plan, trace: new Float32Array(21 * 276), sound }).cues.filter((cue) => cue.call);` becomes `const voice = clipScore({ run, plan, trace: new Float32Array(21 * 276), ducks: [{ sound }] }).cues.filter((cue) => cue.call);`;
   - `const score = clipScore({ run, plan: clipPlan(250, 20, 26), trace: new Float32Array(21 * 276), sound: null });` becomes `const score = clipScore({ run, plan: clipPlan(250, 20, 26), trace: new Float32Array(21 * 276), ducks: [{ sound: null }] });`.
2. Replace the end of the file, from `    const cues = clipScore({ run, plan, trace: new Float32Array(21 * 276), sound }).cues;` to the last `});`, with:

```js
    const cues = clipScore({ run, plan, trace: new Float32Array(21 * 276), ducks: [{ sound }] }).cues;
    const sung = cues.find((cue) => cue.song);
    expect(sung.at).toBeCloseTo(3 + 0.52);
    expect(sung.song).toEqual({ sound, duration: expect.closeTo(5), part: { choral: false, variant: 0 } });
    expect(cues.find((cue) => cue.call).voice).toEqual({ pitch: 1 });
  });

  it("puts every duck of a troupe on the tape, each its calls in its own voice, two singers as a chorus", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const plan = clipPlan(250, 20, 26); // a 5 s performance after 26 frames of settle
    const singer = { sound: { song: [[0.5, 1, 69, 0.7, 0.9, 0]] } };
    const caller = { sound: { voice: { pitch: 0 }, triggers: [[0, 0, 0], [2, 1, 0]] } };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const cues = clipScore({ run, plan, trace: new Float32Array(21 * 276), ducks: [singer, caller, singer] }).cues;
    expect(cues.filter((cue) => cue.song).map((cue) => [cue.at, cue.song.part])).toEqual([
      [expect.closeTo(3 + 0.52), { choral: true, variant: 0 }],
      [expect.closeTo(3 + 0.52), { choral: true, variant: 2 }],
    ]);
    expect(cues.filter((cue) => cue.call).map((cue) => [cue.at, cue.voice])).toEqual([[expect.closeTo(3 + 0.52 + 2), { pitch: 0 }]]);
  });

  it("leaves a troupe's lone singer solo", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const singer = { sound: { song: [[0.5, 1, 69, 0.7, 0.9, 0]] } };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const cues = clipScore({ run, plan: clipPlan(250, 20, 26), trace: new Float32Array(21 * 276), ducks: [{ sound: null }, singer] }).cues;
    expect(cues.filter((cue) => cue.song).map((cue) => cue.song.part)).toEqual([{ choral: false, variant: 1 }]);
  });
});
```

In `app/src/clip/soundtrack.test.js`:

1. Replace `fakeContext`'s head, from `function fakeContext(log) {` through `createGain()`'s closing brace, with:

```js
/** An offline context whose sources log their starts, and whose nodes log what they feed (`wiring`). */
function fakeContext(log, wiring = []) {
  return class {
    constructor(channels, length) {
      this.length = length;
      this.destination = { name: "speakers" };
    }
    createDynamicsCompressor() {
      return {
        name: "limiter", threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
        connect: (to) => wiring.push(["limiter", to.name]),
      };
    }
    createGain() {
      return { name: "gain", gain: {}, connect: (to) => wiring.push(["gain", to.name]) };
    }
```

2. In `"renders the song from the robot's synth…"`, make the cue `{ at: 0.3, song: { sound, duration: 1, part: { choral: false, variant: 0 } }, gain: 1 }`.

3. Add as the describe's last test:

```js
  it("sings a troupe's chorus, each duck its own part, every voice through the limiter", async () => {
    const asked = [];
    const wiring = [];
    const calls = {
      song: (seed, voice, notes, seconds, part) => (asked.push(part), new Float32Array(Math.round(seconds * 48000))),
    };
    const sound = { song: [[0.5, 1, 69, 0.7, 0.9, 0]] };
    const cues = [0, 1].map((variant) => ({ at: 0.3, song: { sound, duration: 1, part: { choral: true, variant } }, gain: 1 }));
    await renderSoundtrack({ crowd: null, cues }, 2, {
      Context: fakeContext([], wiring),
      load: () => { throw new Error("a song cue fetched a file"); },
      calls: async () => calls,
    });
    expect(asked).toEqual([{ choral: true, variant: 0 }, { choral: true, variant: 1 }]);
    expect(wiring).toEqual([["limiter", "speakers"], ["gain", "limiter"], ["gain", "limiter"]]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run src/replay.test.js src/cast.test.js src/clip/score.test.js src/clip/soundtrack.test.js`
Expected: FAIL.
- `standing` takes one settle, not a list: `settle.subarray is not a function`.
- `credit is not a function`.
- `clipScore` still reads `sound`, so it voices no duck (`expected [] to deeply equal …`).
- The chorus cues reach the synth without their part (`[undefined, undefined]`).

- [ ] **Step 3: Implement**

In `app/src/replay.js`, replace `standing` and its doc comment with:

```js
/** The first frames of a settle in which the trunk only rises. */
function rising(settle) {
  let f = 0;
  while (f + 1 < frameCount(settle) && frameAt(settle, f + 1)[2] > frameAt(settle, f)[2]) f++;
  return f;
}

/**
 * Every duck's settle (api.js getSettle) from where the ducks stand on the
 * floor. The roller rig spawns at the walking rig's height on its longer,
 * wheeled legs, so its reset pose has the wheels 2 cm deep and the solver lifts
 * the trunk out over the first steps; a walking duck drops onto the floor
 * instead, and keeps every frame. A troupe shares one physics, so every duck
 * loses the frames its slowest roller needs, and the ducks stay in step.
 */
export function standing(settles) {
  const cut = Math.max(...settles.map(rising));
  return settles.map((settle) => settle.subarray(cut * TRACE_WIDTH));
}
```

In `app/src/cast.js`, add at the end:

```js

/**
 * Who performs, as a clip's caption says it: the author and the star's policy, then for a troupe
 * how many ducks, featuring the policies it borrowed.
 */
export function credit(run) {
  const who = `@${run.user} · ${run.policy_name}`;
  if (run.cast.length === 1) return who;
  const guests = featured(run.cast).map((policy) => `@${policy.user} · ${policy.policy_name}`);
  return `${who} · ${run.cast.length} ducks${guests.length ? `, featuring ${guests.join(", ")}` : ""}`;
}
```

In `app/src/clip/score.js`:

1. Replace `import { voiceEvents } from "../duck-voice.js";` with `import { choirOf, voiceEvents } from "../duck-voice.js";`.
2. Replace the lines from `export function clipScore({ run, plan, trace, sound }) {` through the end of the `voice` constant with:

```js
/**
 * `trace` is the author's lane, settle included; `ducks` the stage's troupe in duck order (cast.js
 * stageDucks), each with how it sounds, and none for a race.
 */
export function clipScore({ run, plan, trace, ducks }) {
  const sounds = run.event.clip.sounds;
  const verdict = run.seeds_finished > 0 ? "pass" : "fail";
  const start = plan.intro / plan.fps;
  const end = plan.tapeEnd / plan.fps;
  const context = { start, end, verdict };
  // The performance starts on the tape after the settle; its length is the author's trace, cut short or not.
  const performed = start + plan.settle * CTRL_DT;
  const length = (plan.steps - plan.settle) * CTRL_DT;
  // Every duck's calls and song, as on the stage: two or more singers sing their parts as a chorus.
  const choral = choirOf(ducks);
  const voice = ducks.flatMap(({ sound }, index) => [
    ...voiceEvents(sound, length).map((call) => ({ at: performed + call.start, call, voice: sound.voice, gain: GAINS.voice })),
    // A song is one take from the performance's start, the duck's part of the chorus or solo.
    ...(sound?.song ? [{ at: performed, song: { sound, duration: length, part: { choral, variant: index } }, gain: GAINS.voice }] : []),
  ]);
```

In `app/src/clip/soundtrack.js`:

1. Replace the header comment with:

```js
// The whole soundtrack in one offline render: the stadium's voices under a
// continuous direction, every cue at its instant — every duck of a troupe
// beside the others — and the troupe's limiter at the end so no sample reaches
// ±1 (the live programme refuses a clip that clips). No segments, no smoothing
// afterwards, no mixing left to ffmpeg.
```

2. Replace `import { callSamples, songSamples } from "../duck-voice.js";` with `import { callSamples, limiter, songSamples } from "../duck-voice.js";`.
3. Replace

```js
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(context.destination);
```

with:

```js
  const limit = limiter(context);
  limit.connect(context.destination);
```

4. Replace `songSamples(synth, cue.song.sound, cue.song.duration)` with `songSamples(synth, cue.song.sound, cue.song.duration, cue.song.part)`.
5. Replace the three remaining uses of the old node, `gain.connect(limiter);`, `scheduleOla(context, limiter, start);` and `crowd.connect(limiter);`, with `limit`.

In `app/src/clip/main.js`:

1. After `import { getRun, getSettle, getTrace } from "../api.js";` add `import { credit, stageDucks } from "../cast.js";`.
2. In `letter`, replace

```js
  $("top-participant").textContent = who;
  $("intro-line").textContent = who;
```

with:

```js
  // The captions credit a troupe whole; the recorder's tag keeps to its author.
  for (const id of ["top-participant", "intro-line"]) $(id).textContent = credit(run);
```

3. In `main`, replace everything from `  const [traces, settles] = await Promise.all([` through `  const score = clipScore({ run, plan, trace: replays[0], sound: lanes[0].sound });` with:

```js
  // One trace and one settle per duck: a race's lane has one, a stage's troupe every duck.
  const [traces, settles] = await Promise.all([
    Promise.all(lanes.map((lane) => getTrace(lane.run_id))),
    Promise.all(lanes.map((lane) => getSettle(lane.run_id).then(standing))),
  ]);
  // Every lane from where its ducks stand, all in step.
  const settle = Math.max(...settles.map(([first]) => frameCount(first)));
  const replays = lanes.map((_, i) => leadIn(settles[i][0], traces[i][0], settle));
  // A stage plays the author's performance alone: every duck of its troupe from its settle. Each
  // beak moves on the stage; the clip's soundtrack plays the voices.
  const stage = isStage(run.event);
  const ducks = stage
    ? stageDucks(lanes[0].cast, traces[0], settles[0], { livery: lanes[0].livery, eventRig: run.event.rig, lead: settle })
    : [];
  const config = run.event.clip;
  const camera = { ...config.camera, distance: DISTANCE[layout] };
  const viewer = await createViewer($("stage"), { rig: run.event.rig, manual: true, camera });
  viewer.setLanes(
    lanes
      .map((lane, i) => ({
        runId: lane.run_id,
        livery: lane.livery,
        colour: LANE_COLORS[i % LANE_COLORS.length],
        opacity: 1,
        name: `@${lane.user}`,
        ...(stage ? { ducks } : { trace: replays[i] }),
      }))
      // The camera stands beyond the last lane: reversed, the author's duck is
      // the one in the foreground, still in the colour its page gives it.
      .reverse(),
    run.event,
    { loop: false },
  );
  const plan = clipPlan(frameCount(traces[0][0]), config.tape_max_s, settle);
  const score = clipScore({ run, plan, trace: replays[0], ducks });
```

`viewer.spot(lanes.length - 1)` still finds the star on a stage, because a stage has one clip lane and the viewer's lane 0 is duck 0.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

Then run `cd app && npx vite build`. The clip page has no unit test, so the build is what catches a bad import in `clip/main.js`.
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/src/replay.js app/src/replay.test.js app/src/cast.js app/src/cast.test.js app/src/clip/main.js app/src/clip/score.js app/src/clip/score.test.js app/src/clip/soundtrack.js app/src/clip/soundtrack.test.js
/usr/bin/git commit -m "A troupe's clip shows every duck in step, sings every part and call through the limiter, and credits the troupe in its caption"
```

---

### Task 13: The workshop plays a troupe

**Files:**
- Create: `arena/workshop/troupe.py`, `tests/workshop/test_troupe.py`
- Modify: `arena/workshop/evaluations.py`, `arena/workshop/publishing.py`, `arena/workshop/challenges.py`, `arena/workshop/tickets.py`, `arena/workshop/app.py`, `app/src/workshop/api.js`, `app/src/workshop/job.js`, `app/public/workshop.css`, `app/src/viewer.js`
- Test: `tests/workshop/conftest.py`, `tests/workshop/test_performance.py`, `app/src/workshop/job.test.js`, `app/src/viewer.test.js`

**Interfaces:**
- Consumes: Task 2's `load_troupe(path, event, *, allow_local=True)`, `Troupe.references()`, `Duck.policy/.start/.timeline`, `Start.to_dict()`, `solo`, `split_local`, `SELF`, `LOCAL`, `TimelineError`; Task 3's `stage.summaries`; Task 4's `runner.Performer`; Task 5's `evaluate(manifest, policy, cast)`, `hub_fetch.fetch_references(troupe, event)` and `FetchedPolicy.path/.rig`; the existing `timeline.sound_of`; Task 10's `splitDucks(values, ducks)` (app/src/replay.js) and `stageDucks(cast, traces, settles, { livery, eventRig, lead })` (app/src/cast.js); Task 11's stage lane entry `{ name, livery, ducks }`.
- Produces:
  - `arena/workshop/troupe.py`: `local_policy(run, n)`, `resolve_local(root, policy) -> (Run, int, Challenge)` (a `TimelineError` when the checkout holds no such checkpoint), `candidates(root) -> [{"policy", "label", "rig"}]`, `performers_for(root, troupe, star_onnx, star_rig, event)`, and `timeline_key(root, challenge)` (moved here from challenges.py).
  - `arena/workshop/publishing.py`: `export(root, run, n) -> Path`, `exported(run, n)`, `onnx_of(run, n)` (moved from evaluations.py).
  - A stored evaluation: `"format": 2`, `"ducks"` (the count), `"cast"` (every duck: `{"policy", "rig", "start", "sound"}`, a local duck's `policy` its `local:` string), and `"stage"` as a list of per-duck summaries.
  - `GET /api/workshop/challenges/{event}/performers` → `{"performers": candidates(root)}` (409 on a race).
  - The workshop's `api.getCheckpoint` returns `traces` (one Float32Array per duck) instead of `trace`.

- [ ] **Step 1: Write the failing tests**

`tests/workshop/conftest.py`: move the `stage` fixture and its two constants here from `tests/workshop/test_performance.py`, unchanged. After `SPRINT = """…"""` add:

```python
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
```

After the `workshop` fixture add:

```python
@pytest.fixture
def stage(checkout, fakes, hub):
    """The workshop on a checkout that also holds MicroDuck Got a Talent, its timeline committed."""
    folder = checkout / "src" / "microduck_challenges" / "got_a_talent"
    folder.mkdir()
    (folder / "challenge.toml").write_text(TALENT)
    (folder / "timeline.json").write_text(TWO_SECONDS)
    git(checkout, "add", "-A")
    git(checkout, "commit", "-qm", "the stage")
    client = reopen(checkout, hub)
    client.timeline = folder / "timeline.json"
    return client
```

In `store_evaluation`, import `FORMAT` (`from arena.workshop.evaluations import FORMAT`, beside the other `arena.workshop` imports at the top) and add `"format": FORMAT,` after `"runner_version": RUNNER_VERSION,`.

`tests/workshop/test_performance.py`:
- delete `TALENT`, `TWO_SECONDS` and the `stage` fixture;
- import `TWO_SECONDS` from `tests.workshop.conftest`;
- drop the imports this leaves unused (`pytest`, `git`, `reopen` if nothing else uses them);
- in `test_a_stage_checkpoint_plays_the_challenges_timeline`, replace `assert set(body["stage"]) == {"fell_at", "seated_s", "standing_s"}` with:

```python
    assert [set(duck) for duck in body["stage"]] == [{"fell_at", "seated_s", "standing_s"}]
```

Create `tests/workshop/test_troupe.py`:

```python
"""A troupe in the workshop: beside the star, a checkpoint of any training in the checkout, a policy
published from one, or any Hub reference joins the performance, on its own rig and in its own place,
and Save and play plays them all."""

import base64
import hashlib
import json
import os
import time

import pytest

from arena.constants import TRACE_WIDTH
from arena.hub_fetch import FetchedPolicy
from arena.timeline import TimelineError
from arena.workshop import troupe
from arena.workshop.evaluations import evaluate_checkpoint, stored
from arena.workshop.runs import find_runs
from arena.workshop.troupe import local_policy, resolve_local, timeline_key
from tests.workshop.conftest import REFERENCE, make_run

URL = "/api/workshop/challenges/got-a-talent"
TASK = "Mjlab-GotATalent-MicroDuck"
BBB = "b" * 40
REF = f"pollen-robotics/microduck-roller@{'c' * 40}"


def troupe_text(*ducks) -> str:
    """A 2 s troupe: the star at the centre, then each of `ducks`, a (policy, x, y, yaw)."""
    others = [{"policy": policy, "start": {"x": x, "y": y, "yaw": yaw}, "keyframes": [{"t": 0.0}]}
              for policy, x, y, yaw in ducks]
    return json.dumps({"timeline_version": 2, "duration_s": 2.0,
                       "ducks": [{"policy": "self", "keyframes": [{"t": 0.0}]}, *others]}) + "\n"


def runs(checkout):
    """The star's training on the stage, and a 2 m Sprint training whose walker may join it."""
    return (make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent"),
            make_run(checkout, "walker", checkpoints=(1,)))


def talent(stage):
    return stage.app.state.workshop.challenges["got-a-talent"]


def play(stage, checkout, star, n=1):
    """What Save and play stores for the star's checkpoint n, with the troupe timeline.json holds."""
    (run,) = (r for r in find_runs(checkout, TASK) if r.path == star)
    return evaluate_checkpoint(checkout, run, n, talent(stage))


def test_a_local_duck_is_a_checkpoint_of_any_challenge_named_by_its_folder_and_run(stage, checkout):
    _, walker = runs(checkout)
    (run,) = find_runs(checkout, "Mjlab-Sprint2m-MicroDuck")
    policy = local_policy(run, 1)
    assert policy == f"local:sprint_2m/{walker.name}@1"
    found, n, challenge = resolve_local(checkout, policy)
    assert (found.path, n, challenge.event) == (walker, 1, "sprint-2m")
    for gone in (f"local:sprint_2m/{walker.name}@7", "local:sprint_2m/2026-01-01_00-00-00_nope@1"):
        with pytest.raises(TimelineError, match="no such checkpoint"):
            resolve_local(checkout, gone)


def test_plus_duck_offers_every_checkpoint_then_every_published_policy_with_its_rig(stage, checkout):
    star, walker = runs(checkout)
    (walker / "workshop").mkdir()
    (walker / "workshop" / "published.json").write_text(json.dumps([
        {"checkpoint": 1, "repo": "alice/microduck-walker", "revision": BBB, "at": "2026-10-13T10:00:00+00:00"}]))
    assert stage.get(f"{URL}/performers").json() == {"performers": [
        {"policy": f"local:got_a_talent/{star.name}@1", "label": f"got_a_talent · {star.name} · 1", "rig": "legs"},
        {"policy": f"local:sprint_2m/{walker.name}@1", "label": f"sprint_2m · {walker.name} · 1", "rig": "legs"},
        {"policy": f"alice/microduck-walker@{BBB}", "label": "alice/microduck-walker@bbbbbbb", "rig": "legs"},
    ]}
    assert stage.get("/api/workshop/challenges/sprint-2m/performers").status_code == 409


def test_the_page_saves_a_troupe_naming_a_checkpoint_of_this_machine(stage, checkout):
    _, walker = runs(checkout)
    text = troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0))
    saved = stage.post(f"{URL}/timeline", json={"text": text})
    assert saved.status_code == 200, saved.text
    assert stage.timeline.read_text() == text


def test_a_troupe_plays_the_star_a_copy_of_it_and_a_checkpoint_exported_once(stage, checkout, fakes):
    star, walker = runs(checkout)
    local = f"local:sprint_2m/{walker.name}@1"
    stage.timeline.write_text(troupe_text((local, 0.0, 0.5, 90), ("self", 0.0, -0.5, -90)))
    body = play(stage, checkout, star)
    assert body["ducks"] == 3
    assert len(base64.b64decode(body["trace_b64"])) == 4 * TRACE_WIDTH * 100 * 3  # 2 s of each duck
    assert [(duck["policy"], duck["rig"], duck["start"]) for duck in body["cast"]] == [
        ("self", "legs", {"x": 0.0, "y": 0.0, "yaw": 0.0}),
        (local, "legs", {"x": 0.0, "y": 0.5, "yaw": 90.0}),
        ("self", "legs", {"x": 0.0, "y": -0.5, "yaw": -90.0}),
    ]
    assert [set(duck) for duck in body["stage"]] == [{"fell_at", "seated_s", "standing_s"}] * 3
    # The walker's checkpoint is exported into its own run, as its own evaluation would be, and once.
    assert (walker / "workshop" / "model_1.onnx").is_file()
    play(stage, checkout, star)
    assert len(fakes.calls("publish")) == 2  # the star's export and the walker's


def test_a_hub_reference_plays_what_the_arena_fetches_on_the_rig_its_manifest_names(stage, checkout, monkeypatch):
    star, _ = runs(checkout)
    asked = []

    def fetch(wanted, event):
        asked.append(wanted.references())
        repo, revision = REF.split("@")
        return {REF: FetchedPolicy(repo_id=repo, filename="policy.onnx", revision=revision, path=REFERENCE,
                                   url=f"https://huggingface.co/{repo}/resolve/{revision}/policy.onnx", rig="rollers")}

    monkeypatch.setattr(troupe, "fetch_references", fetch)
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    body = play(stage, checkout, star)
    assert asked == [(REF,)]
    assert [(duck["policy"], duck["rig"]) for duck in body["cast"]] == [("self", "legs"), (REF, "rollers")]


def test_a_troupe_naming_a_checkpoint_this_checkout_does_not_hold_fails_and_says_which(stage, checkout):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@7", 0.0, 0.5, 0)))
    body = play(stage, checkout, star)
    assert "no such checkpoint" in body["error"] and f"{walker.name}@7" in body["error"]


def test_a_troupe_plays_again_once_a_local_ducks_checkpoint_file_changes(stage, checkout):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    key = timeline_key(checkout, talent(stage))
    assert key != hashlib.sha256(stage.timeline.read_bytes()).hexdigest()
    play(stage, checkout, star)
    (run,) = find_runs(checkout, TASK)
    assert stored(run, 1, key) is not None
    later = time.time() - 30
    os.utime(walker / "model_1.pt", (later, later))  # the walker's run, pulled again from its job
    assert stored(run, 1, timeline_key(checkout, talent(stage))) is None
    # Without a local duck the key is the text's alone, as before troupes.
    stage.timeline.write_text(troupe_text())
    assert timeline_key(checkout, talent(stage)) == hashlib.sha256(stage.timeline.read_bytes()).hexdigest()


def test_an_evaluation_stored_before_troupes_is_measured_again(stage, checkout):
    """0.4 stored one trace and one summary: the page now reads every duck's."""
    star, _ = runs(checkout)
    play(stage, checkout, star)
    (run,) = find_runs(checkout, TASK)
    cache = star / "workshop" / "model_1.json"
    older = json.loads(cache.read_text())
    del older["format"]
    cache.write_text(json.dumps(older))
    assert stored(run, 1, timeline_key(checkout, talent(stage))) is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/workshop/test_troupe.py`
Expected: FAIL at collection: `ImportError: cannot import name 'FORMAT' from 'arena.workshop.evaluations'` (from conftest). Once that exists, `ModuleNotFoundError: No module named 'arena.workshop.troupe'`.

- [ ] **Step 3: Move the export into `publishing.py`**

In `arena/workshop/publishing.py`:

1. Add this paragraph at the end of the module docstring:

```
The workshop's evaluations export a checkpoint with the same command and `--dry-run` (`export`): it
bakes the observation normaliser in and checks the 61 → 14 shape exactly as the real publish will.
The ONNX it writes is kept beside its checkpoint, and played again.
```

2. Add `import threading` and `from pathlib import Path` to the imports, keeping them sorted.

3. After `preview`, add:

```python
# The evaluations' export stages under ./publish-workshop-evaluation/.
EXPORT = "workshop-evaluation"
# One export at a time: they all stage in that one folder, and the evaluator and a page's Save and
# play (a troupe's local ducks included) may export at the same time.
_exporting = threading.Lock()


def onnx_of(run, n: int) -> Path:
    """Where checkpoint n's ONNX is kept once exported: beside its stored evaluation."""
    return run.path / "workshop" / f"model_{n}.onnx"


def exported(run, n: int) -> bool:
    """Whether checkpoint n's ONNX is already exported from the checkpoint file as it is."""
    try:
        return onnx_of(run, n).stat().st_mtime >= (run.path / f"model_{n}.pt").stat().st_mtime
    except OSError:
        return False


def export(root, run, n: int) -> Path:
    """Checkpoint n's ONNX, exported once by `publish --dry-run`. `--allow-dirty`: an export publishes
    nothing. A failure raises PublishError with the command's whole output."""
    onnx = onnx_of(run, n)
    with _exporting:
        if exported(run, n):
            return onnx
        out = root / f"publish-{EXPORT}"
        # A previous, failed export may have left this: never move whatever happens to be sitting in
        # it into a checkpoint's slot as if this run had just produced it.
        shutil.rmtree(out, ignore_errors=True)
        try:
            _run(root, ["publish", "--run", str(run.path), "--checkpoint", str(n), "--repo",
                        f"local/microduck-{EXPORT}", "--name", EXPORT, "--dry-run", "--allow-dirty"])
            onnx.parent.mkdir(exist_ok=True)
            shutil.move(out / "policy.onnx", onnx)
        finally:
            shutil.rmtree(out, ignore_errors=True)
    return onnx
```

- [ ] **Step 4: Create `arena/workshop/troupe.py`**

```python
"""A stage challenge's troupe, as the workshop plays it, and the ducks "+ duck" offers.

Besides "self" (the checkpoint on the training's page, the star) and Hub references pinned to a
commit, a workshop's timeline may name a checkpoint of this machine that is not published yet:
`local:<folder>/<run>@<n>`, checkpoint n of logs/rsl_rl/<folder>/<run>/, from any challenge in the
checkout. The Arena never reads that form: Publish & compete replaces it with the commit the
checkpoint was published at.

A local duck plays its checkpoint exported exactly as its own evaluation exports it (the same kept
ONNX), on the rig of its challenge's event. A reference plays what the Arena fetches for it, on the
rig its manifest names.
"""

import hashlib

from ..hub_fetch import fetch_references
from ..manifest import load_event
from ..policy import load_policy
from ..runner import Performer
from ..timeline import LOCAL, SELF, TimelineError, load_troupe, split_local
from .challenges import Challenge, is_stage, open_challenges, timeline_file
from .publishing import export, published
from .runs import LOGS, Run, find_runs


def local_policy(run, n: int) -> str:
    """How a timeline names checkpoint n of `run`: its folder under logs/rsl_rl/, its directory, n."""
    return f"{LOCAL}{run.path.parent.name}/{run.id}@{n}"


def resolve_local(root, policy: str) -> tuple[Run, int, Challenge]:
    """The run, the checkpoint and the challenge a `local:` duck names; a TimelineError when this
    checkout holds no such checkpoint (a run deleted, a name mistyped)."""
    folder, run_id, n = split_local(policy)
    path = root / LOGS / folder / run_id
    for challenge in open_challenges(root):
        for run in find_runs(root, challenge.task):
            if run.path == path and n in run.checkpoints:
                return run, n, challenge
    raise TimelineError(f"{policy!r}: this checkout has no such checkpoint")


def candidates(root) -> list[dict]:
    """What "+ duck" offers, each with the rig it performs on: every checkpoint of every run of every
    challenge in the checkout, then every policy published from those runs (their published.json)."""
    checkpoints, policies = [], []
    for challenge in open_challenges(root):
        rig = load_event(challenge.event).rig
        for run in find_runs(root, challenge.task):
            checkpoints += [{"policy": local_policy(run, n), "label": f"{challenge.folder} · {run.id} · {n}", "rig": rig}
                            for n in run.checkpoints]
            policies += [{"policy": f"{e['repo']}@{e['revision']}", "label": f"{e['repo']}@{e['revision'][:7]}", "rig": rig}
                         for e in published(run)]
    return checkpoints + policies


def performers_for(root, troupe, star_onnx, star_rig, event) -> tuple[Performer, ...]:
    """The runner's cast for `troupe` on `event`: "self" plays the star's ONNX on its rig, a local duck
    its checkpoint exported, a reference what the Arena fetches. One ONNX session per distinct
    policy: two copies of the star share one."""
    played = {SELF: (load_policy(star_onnx), star_rig)}
    for policy in troupe.references():
        if policy.startswith(LOCAL):
            run, n, challenge = resolve_local(root, policy)
            played[policy] = (load_policy(export(root, run, n)), load_event(challenge.event).rig)
    # fetch_references leaves the local forms alone, and names a refusal by the troupe's own numbers.
    for policy, fetched in fetch_references(troupe, event).items():
        played[policy] = (load_policy(fetched.path), fetched.rig or event.rig)
    return tuple(Performer(*played[duck.policy], duck.start, duck.timeline) for duck in troupe.ducks)


def timeline_key(root, challenge) -> str | None:
    """Which performance a challenge's checkpoints play: on a stage, the sha256 of its timeline.json
    and of the size and time of each checkpoint file a local duck names; None on a race, or on a
    stage without one, which plays the event's own command.

    The text names a local checkpoint, not its bytes, and a run pulled again from its Hugging Face
    job rewrites the file under the same name. A stat, not a hash: the pages ask for this every few
    seconds. A timeline without a local duck keys on its text alone, as before troupes."""
    if not is_stage(challenge):
        return None
    path = timeline_file(challenge)
    try:
        digest = hashlib.sha256(path.read_bytes())
    except FileNotFoundError:
        return None
    try:
        troupe = load_troupe(path, load_event(challenge.event), allow_local=True)
    except TimelineError:
        return digest.hexdigest()  # it cannot play: its evaluation stores why, under its text
    for policy in troupe.references():
        if policy.startswith(LOCAL):
            folder, run_id, n = split_local(policy)
            try:
                stat = (root / LOGS / folder / run_id / f"model_{n}.pt").stat()
                digest.update(f"{policy} {stat.st_size} {stat.st_mtime_ns}".encode())
            except FileNotFoundError:
                digest.update(f"{policy} missing".encode())  # a key that changes once it appears
    return digest.hexdigest()
```

- [ ] **Step 5: `evaluations.py` plays the whole troupe**

Replace `arena/workshop/evaluations.py` with the file below. It supersedes Tasks 5 and 6's edits to the file and keeps what they added: the body's `cast` and `ducks`, and the troupe played through `evaluate(event, policy, cast)`. Task 5's all-"self" refusal and `EvaluationError` go. From `tests/workshop/test_performance.py`, delete two of Task 5's tests: `test_a_duck_playing_another_policy_is_not_played_here` (a duck playing another policy plays now) and `test_the_page_saves_a_troupe_naming_a_checkpoint_of_this_machine` (`tests/workshop/test_troupe.py` holds its successor under the same name).

```python
"""Every checkpoint, evaluated: exported as `publish` would, then played with the Arena's own evaluator.

The export is publishing.export. `arena.evaluate` is the code the Space runs, on this machine's
MuJoCo: the score is indicative — only the Space times an entry, and replays drift apart between
machines after a few seconds.

A worker evaluates every checkpoint of the open challenges' runs, one at a time: the newest run first,
its checkpoints in order, so a training's tickets fill in as it goes. A result is stored next to its
checkpoint, per Arena runner version and per FORMAT, trace included, so a page replays it at once. A
checkpoint that cannot be measured — a failed export, a policy that does not load, a race that breaks,
a duck the troupe cannot cast — is stored as a failure, with the checkpoint file's modification time,
and tried again only once that file changes. A checkpoint file younger than FRESH_S waits: a local
training may still be writing it.

On a stage, each checkpoint plays the challenge's timeline.json with its whole troupe, the checkpoint
as the star ("self"). `troupe.timeline_key` names that performance: an edit, or a local duck's
checkpoint file rewritten, makes every stored evaluation stale. Every ONNX exported is kept beside its
checkpoint and played again, so a stale checkpoint costs a performance, not an export.
"""

import base64
import json
import os
import tempfile
import time

from ..cast import duck_record
from ..constants import RUNNER_VERSION
from ..evaluate import evaluate
from ..manifest import load_event
from ..policy import load_policy
from ..stage import summaries
from ..timeline import constant_timeline, load_troupe, solo
from ..trace import as_ducks
from .challenges import timeline_file
from .publishing import PublishError, export
from .runs import find_runs
from .troupe import performers_for, timeline_key

FRESH_S = 30.0
IDLE_S = 5.0
# What a stored evaluation holds. 2: every duck's trace, duck-major, with the cast and a stage summary
# per duck. A body of another form is measured again, as one of another runner version is.
FORMAT = 2


def _path(run, n: int):
    return run.path / "workshop" / f"model_{n}.json"


def _mtime(run, n: int) -> float:
    return (run.path / f"model_{n}.pt").stat().st_mtime


def stored(run, n: int, timeline: str | None) -> dict | None:
    """The stored evaluation of checkpoint n on this runner version, played with this timeline — a
    result, or a failure still true of the checkpoint file as it is — or None: never evaluated,
    stale, or unreadable."""
    try:
        body = json.loads(_path(run, n).read_text())
    except (OSError, ValueError):
        return None  # missing, or corrupt (a crash mid-write): as good as never evaluated
    if not isinstance(body, dict) or (body.get("runner_version"), body.get("format")) != (RUNNER_VERSION, FORMAT):
        return None
    if body.get("timeline") != timeline:
        return None  # played with another timeline: stale, a failure included
    if "error" in body:
        try:
            return body if body.get("mtime") == _mtime(run, n) else None
        except OSError:
            return None
    return body


def summary(run, timeline: str | None) -> dict[int, dict]:
    """What each evaluated checkpoint of `run` shows on its ticket, without its trace."""
    keep = ("score", "seeds_finished", "seeds_total", "command_vx")
    found = {}
    for n in run.checkpoints:
        body = stored(run, n, timeline)
        if body is not None:
            row = {"status": "failed"} if "error" in body else {"status": "evaluated", **{k: body[k] for k in keep}}
            if "stage" in body:
                row["stage"] = body["stage"]
            found[n] = row
    return found


def _write(run, n: int, body: dict) -> None:
    """Atomically: a reader (a ticket, a replay) must never see a half-written file. The temp file is
    unique to this write, so two writers of the same checkpoint never race on one temp name."""
    path = _path(run, n)
    path.parent.mkdir(exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(dir=path.parent, delete=False, prefix=path.name, suffix=".tmp")
    try:
        tmp.write(json.dumps(body).encode())
    finally:
        tmp.close()
    os.replace(tmp.name, path)


def _measure(root, run, n: int, challenge, key: str | None) -> dict:
    onnx = export(root, run, n)
    event = load_event(challenge.event)
    body = {"checkpoint": n}
    if event.course.kind == "stage":
        # Without a timeline.json, the troupe of one the event plays: its own command for its time limit.
        troupe = (load_troupe(timeline_file(challenge), event, allow_local=True) if key
                  else solo(constant_timeline(event.command, event.time_limit_s)))
        cast = performers_for(root, troupe, onnx, event.rig, event)
        result = evaluate(event, cast[0].policy, cast)
        # A duck's policy as the timeline names it: "self", a Hub reference, or a local checkpoint.
        body["cast"] = [duck_record(duck.policy, performer.rig, duck) for duck, performer in zip(troupe.ducks, cast)]
        body["stage"] = summaries(result.trace, event.termination)
    else:
        result = evaluate(event, load_policy(onnx))
        body["cast"] = None  # a race: one duck, nothing to place or hear
    return body | {
        "score": result.score,
        "command_vx": result.command_vx,
        "seeds_finished": result.seeds_finished,
        "seeds_total": len(result.per_seed),
        "per_seed": [{"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in result.per_seed],
        "trace_seed": result.trace_seed,
        # Duck-major, as the Arena serves a trace: the page cuts it into `ducks` traces.
        "ducks": len(as_ducks(result.trace)),
        "trace_b64": base64.b64encode(result.trace.astype("<f4").tobytes()).decode("ascii"),
        "runner_version": result.runner_version,
        "format": FORMAT,
        "timeline": key,
    }


def evaluate_checkpoint(root, run, n: int, challenge) -> dict:
    """Measure checkpoint n with the challenge's timeline as it is now, store what came of it, and
    return that body."""
    mtime = _mtime(run, n)
    key = timeline_key(root, challenge)
    try:
        body = _measure(root, run, n, challenge, key)
    except Exception as exc:  # noqa: BLE001 — stored, so the worker moves on to the next checkpoint
        error = str(exc) if isinstance(exc, PublishError) else f"{type(exc).__name__}: {exc}"
        body = {"checkpoint": n, "error": error, "mtime": mtime, "runner_version": RUNNER_VERSION,
                "format": FORMAT, "timeline": key}
    _write(run, n, body)
    return body


def next_checkpoint(root, challenges, now: float | None = None):
    """(challenge, run, n) to evaluate next, or None: the newest run first, its checkpoints in order."""
    now = time.time() if now is None else now
    keys = {c.event: timeline_key(root, c) for c in challenges}
    runs = sorted(((c, r) for c in challenges for r in find_runs(root, c.task)), key=lambda cr: cr[1].id, reverse=True)
    for challenge, run in runs:
        for n in run.checkpoints:
            if stored(run, n, keys[challenge.event]) is not None:
                continue
            try:
                if now - _mtime(run, n) < FRESH_S:
                    continue
            except OSError:
                continue  # gone while we looked
            return challenge, run, n
    return None


def evaluate_next(ws) -> bool:
    """Evaluate one checkpoint; False when none is waiting."""
    found = next_checkpoint(ws.root, list(ws.challenges.values()))
    if found is None:
        return False
    challenge, run, n = found
    evaluate_checkpoint(ws.root, run, n, challenge)
    return True


def evaluate_forever(ws) -> None:
    while not ws.stopping.is_set():
        try:
            if not evaluate_next(ws):
                ws.stopping.wait(IDLE_S)
        except Exception as exc:  # noqa: BLE001 — one bad run must not stop the worker for the others
            print(f"[workshop] evaluation: {type(exc).__name__}: {exc}", flush=True)
            ws.stopping.wait(IDLE_S)
```

- [ ] **Step 6: The challenge, the tickets and the routes**

`arena/workshop/challenges.py`:
- delete `timeline_key` (now `troupe.timeline_key`) and the `import hashlib` it alone used;
- replace `save_timeline` with the version below (`load_troupe` is already imported from `..timeline`, since Task 5):

```python
def save_timeline(challenge: Challenge, text: str) -> None:
    """Write the page's timeline.json as typed, once the Arena's own loader has read it — a duck of
    this machine (`local:`) allowed, which Publish & compete resolves. A refusal (TimelineError, which
    says where) leaves the file as it was."""
    with tempfile.TemporaryDirectory() as tmp:
        candidate = Path(tmp) / TIMELINE  # so a refusal names timeline.json, not a temp file
        candidate.write_text(text, encoding="utf-8")
        load_troupe(candidate, load_event(challenge.event), allow_local=True)
    path = timeline_file(challenge)
    # A temp file unique to this save: two writers of the same timeline never race on one temp name.
    staged = tempfile.NamedTemporaryFile(dir=path.parent, delete=False, prefix=f".{TIMELINE}", suffix=".tmp")
    try:
        staged.write(text.encode("utf-8"))
    finally:
        staged.close()
    os.replace(staged.name, path)
```

`arena/workshop/tickets.py`: the key is computed once per challenge and handed down.
- Replace `from .challenges import timeline_key` with `from .troupe import timeline_key`.
- Replace `_checkpoints` with:

```python
def _checkpoints(run, voted: bool, key: str | None) -> tuple[list[dict], int | None]:
    done = summary(run, key) if run else {}
    rows = [{"n": n, **done.get(n, {"status": "queued"})} for n in (run.checkpoints if run else ())]
    finishers = [r for r in rows if r["status"] == "evaluated" and r["seeds_finished"] > 0]
    # A voted event is not a clock: its best is the public's to say.
    best = None if voted or not finishers else min(finishers, key=lambda r: (r["score"], r["n"]))["n"]
    return rows, best
```

- In `_ticket`, change the signature to `def _ticket(source_, voted: bool, key: str | None) -> dict:` and its call to `rows, best = _checkpoints(run, voted, key)`.
- Replace `tickets`, `ticket`, and the `_ticket` line of `ticket_detail` with:

```python
def tickets(ws, challenge) -> list[dict]:
    voted, key = _voted(challenge), timeline_key(ws.root, challenge)
    return [_ticket(s, voted, key) for s in _sources(ws, challenge)]


def ticket(ws, challenge, ticket_id: str) -> dict | None:
    found = source(ws, challenge, ticket_id)
    return _ticket(found, _voted(challenge), timeline_key(ws.root, challenge)) if found else None
```

```python
        **_ticket(found, _voted(challenge), timeline_key(ws.root, challenge)),
```

`arena/workshop/app.py`:
- Remove `timeline_key` from the `.challenges` import.
- Change the evaluations import to `from .evaluations import evaluate_checkpoint, evaluate_forever, stored`.
- Change the publishing import to `from .publishing import PublishError, exported, preview, publish, repo_for`.
- Add `from .troupe import candidates, timeline_key`.
- In `checkpoint`, replace `body = stored(run, n, timeline_key(challenge))` with `body = stored(run, n, timeline_key(ws.root, challenge))`.
- After `post_timeline`, add:

```python
@router.get("/challenges/{event}/performers")
def performers(event: str, request: Request) -> dict:
    """What "+ duck" offers on a stage's plan: every checkpoint and every published policy of the checkout."""
    ws = _workshop(request)
    _stage_or_409(ws, event)
    return {"performers": candidates(ws.root)}
```

Check that nothing is left behind: `grep -rn "EvaluationError\|timeline_key(challenge)\|import.*exported.*evaluations\|evaluations import.*exported" arena tests` prints nothing.

- [ ] **Step 7: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/workshop/test_troupe.py tests/workshop/test_performance.py tests/workshop/test_evaluations.py`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS, every test. Report the count.

- [ ] **Step 8: The training's page plays every duck and says what each did**

`app/src/workshop/job.test.js`:

1. In the hoisted `api` mock, replace the `getCheckpoint` line with:

```js
  getCheckpoint: vi.fn(async (event, id, n) => ({ checkpoint: n, score: 5.62, ducks: 1, traces: [new Float32Array(8)],
    cast: [{ policy: "self", rig: null, start: null, sound: null }] })),
```

2. In "a stage's training page edits its performance and says what the checkpoint did", replace `stage: { fell_at: null, seated_s: 7.9, standing_s: 11.5 }` with `stage: [{ fell_at: null, seated_s: 7.9, standing_s: 11.5 }]`.

3. In "a Save and play's fresh evaluation counts even while the ticket row still says queued", replace the `api.getCheckpoint.mockResolvedValue(…)` call with:

```js
  api.getCheckpoint.mockResolvedValue({ checkpoint: 500, ducks: 1, traces: [new Float32Array(8)],
    cast: [{ policy: "self", rig: "legs", start: { x: 0, y: 0, yaw: 0 }, sound: null }],
    stage: [{ fell_at: 3.2, seated_s: 1, standing_s: 2 }] });
```

4. After "a race has no performance to edit", add:

```js
  it("plays a troupe's every duck on its own rig, and says what each did", async () => {
    api.getJob.mockResolvedValue({ ...JOB, best: null,
      checkpoints: [{ n: 500, status: "evaluated", score: 2, seeds_finished: 1, seeds_total: 1, command_vx: 0 }] });
    api.getCheckpoint.mockResolvedValueOnce({
      checkpoint: 500, ducks: 2, traces: [new Float32Array(21), new Float32Array(21)],
      cast: [
        { policy: "self", rig: "legs", start: { x: 0, y: 0, yaw: 0 }, sound: null },
        { policy: `pollen-robotics/microduck-roller@${"c".repeat(40)}`, rig: "rollers", start: { x: 0.5, y: 0, yaw: 180 }, sound: null },
      ],
      stage: [{ fell_at: null, seated_s: 1, standing_s: 0.5 }, { fell_at: 0.8, seated_s: 0, standing_s: 0.2 }],
    });
    const root = document.createElement("div");
    await open(root, TALENT);
    await settle();
    root.querySelector(".ckpts .bars i").click();
    await settle();
    const [[lane]] = viewer.setLanes.mock.lastCall;
    expect(lane.name).toBe("checkpoint 500");
    expect(lane.ducks.map((duck) => duck.rig)).toEqual(["legs", "rollers"]);
    expect(root.querySelector(".score__value").textContent).toBe("1 of 2 fell");
    expect(root.querySelector(".score__seeds").textContent).toBe(
      "★ · no fall · seated 1.00 s · standing 0.50 s\n1 · fell at 0.80 s · seated 0.00 s · standing 0.20 s");
  });

  it("says why a checkpoint cannot play: the last line of what failed", async () => {
    api.getJob.mockResolvedValue({ ...JOB, best: null, checkpoints: [{ n: 500, status: "failed" }] });
    api.getCheckpoint.mockResolvedValueOnce({ checkpoint: 500,
      error: "[publish] exporting checkpoint 500\nTimelineError: 'local:sprint_2m/2026-09-25_10-00-00_first@7': this checkout has no such checkpoint\n" });
    const root = document.createElement("div");
    await open(root, TALENT);
    await settle();
    root.querySelector(".ckpts .bars i").click();
    await settle();
    expect(root.querySelector(".score__value").textContent).toBe("Failed");
    expect(root.querySelector(".score__seeds").textContent).toBe(
      "TimelineError: 'local:sprint_2m/2026-09-25_10-00-00_first@7': this checkout has no such checkpoint");
  });
```

Run: `cd app && npx vitest run src/workshop/job.test.js`
Expected: FAIL. The stage tests fail on `toFixed` of undefined: a summary is now a list per duck. The troupe test fails on the lane's `ducks`, and the reason test because nothing shows the error.

`app/src/workshop/api.js`: add `import { splitDucks } from "../replay.js";` and replace `getCheckpoint` with:

```js
/** A checkpoint's stored evaluation, its trace cut into one Float32Array per duck as the viewer takes them; `{checkpoint, error}` when it failed. */
export async function getCheckpoint(event, id, n) {
  const body = await json(`${jobUrl(event, id)}/checkpoints/${n}`);
  if (body.error) return body;
  const { trace_b64: encoded, ...evaluation } = body;
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return { ...evaluation, traces: splitDucks(new Float32Array(bytes.buffer), evaluation.ducks) };
}
```

`app/src/workshop/job.js`:

1. Add `import { stageDucks } from "../cast.js";` after the `../brightness.js` import.

2. In `drawScore`, replace the `if (stage && done) { … }` block (the branch that sets "No fall" / "Fell at") with:

```js
    if (stage && done) {
      const at = (s) => `${s.toFixed(2)} s`;
      const fell = done.filter((duck) => duck.fell_at != null);
      const posture = (duck) => `seated ${at(duck.seated_s)} · standing ${at(duck.standing_s)}`;
      if (done.length === 1) {
        value.textContent = fell.length ? `Fell at ${at(fell[0].fell_at)}` : "No fall";
        seeds.textContent = posture(done[0]);
      } else {
        // A troupe: how many fell, then a line per duck, the star first, numbered as the plan numbers them.
        value.textContent = fell.length ? `${fell.length} of ${done.length} fell` : "No fall";
        seeds.textContent = done.map((duck, i) =>
          `${i || "★"} · ${duck.fell_at == null ? "no fall" : `fell at ${at(duck.fell_at)}`} · ${posture(duck)}`).join("\n");
      }
    } else if (!row || row.status === "queued") {
```

(the `else if` chain after it is unchanged).

3. Replace `play` with:

```js
  async function play(body) {
    if (!(await stadium) || left || selected !== body.checkpoint) return;
    const name = `checkpoint ${body.checkpoint}`;
    // A stage's lane is its troupe, each duck where its trace puts it. The workshop keeps no settle,
    // so nothing leads in.
    viewer.setLanes([stage
      ? { name, livery: "classic", ducks: stageDucks(body.cast, body.traces, null, { livery: "classic", eventRig: event.rig, lead: 0 }) }
      : { trace: body.traces[0], tier: "trial", livery: "classic", name }], event);
  }
```

4. In `pick`, replace the `if (!body) { … }` block with:

```js
    if (!body) {
      try {
        body = await api.getCheckpoint(event.id, job.id, n);
        // One that could not be played says why. A failed export says it in its whole output, whose
        // last line is the reason.
        if (body.error) throw new Error(body.error.trim().split("\n").at(-1));
      } catch (error) {
        if (selected === n) { // a checkpoint picked since owns the score
          unplayable = error.message;
          drawScore();
        }
        return;
      }
      evaluations.set(n, body);
      drawScore(); // the ticket row may still say queued; the fetch just answered for it
    }
```

`app/public/workshop.css`: after `.score .figure-value { font-size: 2.6rem; }` add:

```css
/* A troupe's score: a line per duck. */
.score__seeds { white-space: pre-line; }
```

Every page now hands a stage `{ name, livery, ducks }`, the training's page included, so `stageLanes` loses the fallback Task 11 kept for it. In `app/src/viewer.js`, replace

```js
  return entries.flatMap((entry) => (entry.ducks ?? [{ ...entry, star: true }])
    .map((duck) => ({ ...duck, opacity: 1, name: duck.star ? entry.name : undefined })));
```

with

```js
  return entries.flatMap((entry) => entry.ducks
    .map((duck) => ({ ...duck, opacity: 1, name: duck.star ? entry.name : undefined })));
```

and, in its doc comment, delete the sentence "The workshop's checkpoint replay hands its one duck as the entry itself.". In `app/src/viewer.test.js`, delete the test "takes a workshop checkpoint's lane as a troupe of one, drawn centred on the event's rig".

Run: `cd app && npx vitest run src/workshop/job.test.js src/viewer.test.js`
Expected: PASS.

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add arena/workshop/troupe.py arena/workshop/evaluations.py arena/workshop/publishing.py arena/workshop/challenges.py arena/workshop/tickets.py arena/workshop/app.py tests/workshop/conftest.py tests/workshop/test_performance.py tests/workshop/test_troupe.py app/src/workshop/api.js app/src/workshop/job.js app/src/workshop/job.test.js app/public/workshop.css app/src/viewer.js app/src/viewer.test.js
/usr/bin/git commit -m "The workshop plays a whole troupe: a checkpoint of any training, a published policy or a Hub reference joins the star on its own rig, and the training's page says what each duck did"
```

---

### Task 14: The workshop places the ducks

**Files:**
- Create: `app/src/workshop/placement.js`, `app/src/workshop/placement.test.js`
- Modify: `arena/web/routes_read.py`, `app/src/workshop/performance.js`, `app/src/workshop/job.js`, `app/src/workshop/api.js`, `app/public/workshop.css`
- Test: `tests/test_routes_read.py`, `app/src/workshop/performance.test.js`, `app/src/workshop/job.test.js`

**Interfaces:**
- Consumes: Task 1's stage `event_summary` keys `size_m` and `max_ducks`; Task 2's `EDGE_MARGIN_M` and `MIN_SPACING_M`; Task 13's `GET /api/workshop/challenges/{event}/performers`.
- Produces:
  - A stage's `event_summary` also serves `"edge_margin_m"` and `"min_spacing_m"`.
  - `placementPlan(event, { read, write, performers }) -> { el, refresh }` and `formatTimeline(value) -> string` in `app/src/workshop/placement.js`.
  - `api.getPerformers(event) -> Promise<[{ policy, label, rig }]>`.
  - `performancePanel({ guide, event }, { load, save, onSaved, performers })`.

**Decisions:**
- The server serves the two margins. The plan then refuses a spot with the loader's own numbers, not a copy of them, as `walls` does for a lane.
- A v1 text is rewritten as the v2 troupe of one the loader already reads it as, the first time the plan changes its duck (a move, a turn, or + duck). v1 has no place for a `start`. The rewrite is the same performance, it shows in the box, and it never flips back. A click that moves nothing writes nothing.
- The plan writes the whole text back with `formatTimeline`: the file, each duck, and each list of keyframes or notes one entry per line, anything smaller on its key's line. That is the layout an author writes. A plain `JSON.stringify(…, 2)` would put each number of every `twist` on its own line.

- [ ] **Step 1: Write the failing tests**

`tests/test_routes_read.py`: add `from arena.timeline import EDGE_MARGIN_M, MIN_SPACING_M` to the imports, and after `test_a_stage_event_is_served_without_a_lane_or_a_sweep`:

```python
def test_a_stage_serves_where_a_duck_may_start(client):
    """The workshop's plan refuses a spot with the loader's own numbers, not copies of them."""
    api, _ = client
    talent = next(e for e in api.get("/api/events").json()["events"] if e["id"] == "got-a-talent")
    assert (talent["edge_margin_m"], talent["min_spacing_m"]) == (EDGE_MARGIN_M, MIN_SPACING_M)
```

Create `app/src/workshop/placement.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { formatTimeline, placementPlan } from "./placement.js";

const TALENT = { id: "got-a-talent", size_m: [2.6, 3.8], max_ducks: 4, edge_margin_m: 0.3, min_spacing_m: 0.3 };
const SOLO = '{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}, {"t": 2.0, "twist": [1, 0, 0]}], "voice": {"pitch": 0.3}}\n';
const TROUPE = JSON.stringify({ timeline_version: 2, duration_s: 20, ducks: [
  { policy: "self", keyframes: [{ t: 0 }] },
  { policy: `pollen-robotics/microduck-walker@${"c".repeat(40)}`, start: { x: 0.4, y: -0.6, yaw: 90 }, keyframes: [{ t: 0 }] },
] });
const FOUR = JSON.stringify({ timeline_version: 2, duration_s: 20,
  ducks: [0, 0.5, 1, 1.5].map((y) => ({ policy: "self", start: { x: 0, y, yaw: 0 }, keyframes: [{ t: 0 }] })) });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The stage point (x, y), as a pointer finds it on a plan drawn 1 px a centimetre (380 × 260, and the audience's 30 below). */
const at = (x, y) => ({ clientX: 190 + y * 100, clientY: 130 + x * 100 });
const press = (node, x, y) => node.dispatchEvent(new MouseEvent("pointerdown", { ...at(x, y), bubbles: true }));
const drag = (x, y) => window.dispatchEvent(new MouseEvent("pointermove", at(x, y)));
const release = () => window.dispatchEvent(new MouseEvent("pointerup"));

function open(text, performers = async () => []) {
  let current = text;
  const write = vi.fn((value) => { current = value; });
  const plan = placementPlan(TALENT, { read: () => current, write, performers });
  plan.el.querySelector("svg").getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 290 });
  const edit = (value) => {
    current = value;
    plan.refresh();
  };
  return { plan, write, edit, ducks: () => [...plan.el.querySelectorAll(".placement__duck")] };
}

describe("the placement plan", () => {
  it("draws each duck where its start puts it, the audience at the bottom, the star apart", () => {
    const { ducks } = open(TROUPE);
    const [star, other] = ducks();
    expect(star.classList.contains("placement__duck--star")).toBe(true);
    expect(star.textContent).toBe("★");
    expect(star.getAttribute("transform")).toBe("translate(0 0)");
    expect(other.textContent).toBe("1");
    // 0.4 m towards the audience (down the plan), 0.6 m to the audience's left (left on the plan).
    expect(other.getAttribute("transform")).toBe("translate(-60 40)");
  });

  it("moves a duck where it is dropped and writes its start into the text", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(-0.2, 0.5);
    release();
    const written = JSON.parse(write.mock.lastCall[0]);
    expect(written.ducks[1].start).toEqual({ x: -0.2, y: 0.5, yaw: 90 });
    expect(written.ducks[0]).toEqual(JSON.parse(TROUPE).ducks[0]);
    expect(ducks()[1].getAttribute("transform")).toBe("translate(50 -20)");
  });

  it("turns a spot the loader would refuse magenta and does not take it", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(0.1, -0.2); // 0.22 m from the star: closer than 0.3 m
    expect(ducks()[1].classList.contains("placement__duck--refused")).toBe(true);
    drag(1.1, -0.6); // |x| at most 2.6 / 2 - 0.3 m
    expect(ducks()[1].classList.contains("placement__duck--refused")).toBe(true);
    release();
    expect(write).not.toHaveBeenCalled();
    expect(ducks()[1].getAttribute("transform")).toBe("translate(-60 40)");
    expect(ducks()[1].classList.contains("placement__duck--refused")).toBe(false);
  });

  it("takes a duck on the margin, as the loader does", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(0.4, -1.6); // |y| = 3.8 / 2 - 0.3 m exactly, which floats put a hair past 1.9 - 0.3
    release();
    expect(JSON.parse(write.mock.lastCall[0]).ducks[1].start).toEqual({ x: 0.4, y: -1.6, yaw: 90 });
  });

  it("turns a duck with its dot", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__handle"), 0.4, -0.35);
    drag(0.4, -1.2); // straight to the audience's left of the duck
    release();
    expect(JSON.parse(write.mock.lastCall[0]).ducks[1].start).toEqual({ x: 0.4, y: -0.6, yaw: -90 });
  });

  it("makes a v1 text the troupe of one it is once its duck moves, and writes nothing for a click", () => {
    const { ducks, write } = open(SOLO);
    press(ducks()[0].querySelector(".placement__body"), 0, 0);
    release();
    expect(write).not.toHaveBeenCalled();
    press(ducks()[0].querySelector(".placement__body"), 0, 0);
    drag(0.5, 0.3);
    release();
    expect(write.mock.lastCall[0]).toBe(`{
  "timeline_version": 2,
  "duration_s": 20,
  "ducks": [
    {
      "policy": "self",
      "start": {"x": 0.5, "y": 0.3, "yaw": 0},
      "keyframes": [
        {"t": 0},
        {"t": 2, "twist": [1, 0, 0]}
      ],
      "voice": {"pitch": 0.3}
    }
  ]
}
`);
  });

  it("moves the markers when the text changes, and greys the plan out while it is not JSON", () => {
    const { plan, ducks, edit, write } = open(SOLO);
    edit(TROUPE);
    expect(ducks()).toHaveLength(2);
    expect(ducks()[1].getAttribute("transform")).toBe("translate(-60 40)");
    edit(TROUPE.slice(0, -2));
    expect(plan.el.classList.contains("placement--off")).toBe(true);
    expect(ducks()).toHaveLength(2); // the last plan, greyed
    expect(plan.el.querySelector(".placement__add").hidden).toBe(true);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(-0.5, 0.5);
    release();
    expect(write).not.toHaveBeenCalled();
    edit(TROUPE);
    expect(plan.el.classList.contains("placement--off")).toBe(false);
  });

  it("adds the duck chosen on the nearest free spot, a keyframe at 0, up to the event's cap", async () => {
    const local = "local:sprint_2m/2026-09-25_10-00-00_first@1500";
    const { plan, write, edit } = open(SOLO, async () => [
      { policy: local, label: "sprint_2m · 2026-09-25_10-00-00_first · 1500", rig: "legs" },
      { policy: `alice/microduck-roll@${"b".repeat(40)}`, label: "alice/microduck-roll@bbbbbbb", rig: "rollers" },
    ]);
    await flush();
    const add = plan.el.querySelector(".placement__add");
    expect([...add.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Your trainings", "Published"]);
    expect([...add.options].map((option) => option.textContent)).toEqual([
      "+ duck", "This checkpoint again", "sprint_2m · 2026-09-25_10-00-00_first · 1500 · legs", "alice/microduck-roll@bbbbbbb · rollers"]);
    add.value = local;
    add.dispatchEvent(new Event("change"));
    const written = JSON.parse(write.mock.lastCall[0]);
    expect(written.ducks.map((duck) => duck.policy)).toEqual(["self", local]);
    // Beside the star, touching distance: the nearest spot the loader takes.
    expect(written.ducks[1]).toEqual({ policy: local, start: { x: 0, y: -0.3, yaw: 0 }, keyframes: [{ t: 0 }] });
    expect(add.value).toBe("");
    edit(FOUR);
    expect(add.hidden).toBe(true);
  });

  it("writes a timeline as an author lays one out", () => {
    expect(formatTimeline({ timeline_version: 2, duration_s: 20, ducks: [{ policy: "self", start: { x: 0, y: 0, yaw: 0 },
      song: [{ t: 1, note: "C4", for: 0.5 }], keyframes: [{ t: 0, twist: [1, 0, 0] }] }] })).toBe(`{
  "timeline_version": 2,
  "duration_s": 20,
  "ducks": [
    {
      "policy": "self",
      "start": {"x": 0, "y": 0, "yaw": 0},
      "song": [
        {"t": 1, "note": "C4", "for": 0.5}
      ],
      "keyframes": [
        {"t": 0, "twist": [1, 0, 0]}
      ]
    }
  ]
}`);
  });
});
```

Replace `app/src/workshop/performance.test.js` with:

```js
import { describe, expect, it, vi } from "vitest";
import { performancePanel } from "./performance.js";

const TEXT = '{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}]}\n';
const TALENT = { id: "got-a-talent", size_m: [2.6, 3.8], max_ducks: 4, edge_margin_m: 0.3, min_spacing_m: 0.3 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const edit = (box, value) => {
  const text = box.querySelector("textarea");
  text.value = value;
  text.dispatchEvent(new Event("input"));
};
const panel = (on, guide = "#") => performancePanel({ guide, event: TALENT },
  { load: async () => ({ text: TEXT }), save: vi.fn(), onSaved: vi.fn(), performers: async () => [], ...on });

describe("the performance panel", () => {
  it("shows the file, and Save and play only once it is changed", async () => {
    const box = panel({}, "https://arena.test/#/e/got-a-talent/guide");
    await flush();
    expect(box.querySelector("textarea").value).toBe(TEXT);
    expect(box.querySelector(".performance__save").hidden).toBe(true);
    expect(box.querySelector(".performance a").href).toBe("https://arena.test/#/e/got-a-talent/guide");
    edit(box, TEXT.replace("20.0", "12.0"));
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });

  it("is disabled until the file has loaded, so a save can never overwrite what the author never saw", async () => {
    let settle;
    const box = panel({ load: () => new Promise((resolve) => { settle = resolve; }) });
    expect(box.querySelector("textarea").disabled).toBe(true);
    expect(box.querySelector(".placement").classList.contains("placement--off")).toBe(true);
    settle({ text: TEXT });
    await flush();
    expect(box.querySelector("textarea").disabled).toBe(false);
    expect(box.querySelector(".placement").classList.contains("placement--off")).toBe(false);
  });

  it("stays disabled when the load fails, and shows the error", async () => {
    const box = panel({ load: async () => { throw new Error("timeline.json: could not be read"); } });
    await flush();
    expect(box.querySelector("textarea").disabled).toBe(true);
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    expect(box.querySelector(".performance__why").textContent).toContain("could not be read");
  });

  it("saves, then plays: the button goes until the next change", async () => {
    const save = vi.fn(async (text) => ({ text }));
    const onSaved = vi.fn();
    const box = panel({ save, onSaved });
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
    const box = panel({ save });
    await flush();
    edit(box, TEXT.replace("20.0", "25.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    expect(box.querySelector(".performance__why").textContent).toContain("longer than this event's 20 s");
    expect(box.querySelector("textarea").value).toContain("25.0");
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });

  it("hides the refusal once the text is edited back to the saved file", async () => {
    const save = vi.fn(async () => { throw new Error("duration_s: 25 s is longer than this event's 20 s"); });
    const box = panel({ save });
    await flush();
    edit(box, TEXT.replace("20.0", "25.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    edit(box, TEXT);
    expect(box.querySelector(".performance__why").hidden).toBe(true);
  });

  it("places the ducks above the text: a drag rewrites the text, an edit of it moves the plan", async () => {
    const box = panel({});
    await flush();
    const plan = box.querySelector(".placement");
    expect(plan.nextElementSibling.classList.contains("terminal")).toBe(true);
    box.querySelector(".placement svg").getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 290 });
    box.querySelector(".placement__body").dispatchEvent(new MouseEvent("pointerdown", { clientX: 190, clientY: 130, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 240, clientY: 130 }));
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(JSON.parse(box.querySelector("textarea").value).ducks[0].start).toEqual({ x: 0, y: 0.5, yaw: 0 });
    expect(box.querySelector(".performance__save").hidden).toBe(false);
    edit(box, "{");
    expect(plan.classList.contains("placement--off")).toBe(true);
  });
});
```

`app/src/workshop/job.test.js`: in the hoisted `api` mock, add `getPerformers: vi.fn(async () => []),`. Change `TALENT` to:

```js
const TALENT = { id: "got-a-talent", title: "MicroDuck Got a Talent", category: "showcase", course: "stage",
  metric: "votes", rig: "legs", time_limit_s: 20, vote: { ballot_min: 2 },
  size_m: [2.6, 3.8], max_ducks: 4, edge_margin_m: 0.3, min_spacing_m: 0.3 };
```

In "a stage's training page edits its performance and says what the checkpoint did", after `expect(api.getTimeline).toHaveBeenCalledWith("got-a-talent");` add:

```js
    expect(root.querySelector(".performance .placement")).not.toBeNull();
    expect(api.getPerformers).toHaveBeenCalledWith("got-a-talent");
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_read.py`
Expected: FAIL with `KeyError: 'edge_margin_m'`.

Run: `cd app && npx vitest run src/workshop/placement.test.js`
Expected: FAIL with `Failed to resolve import "./placement.js"`.

- [ ] **Step 3: Serve the margins**

`arena/web/routes_read.py`: add `from ..timeline import EDGE_MARGIN_M, MIN_SPACING_M` to the imports. In `event_summary`, add these two keys to the stage branch Task 1 added (the one serving `size_m` and `max_ducks`), after `max_ducks`:

```python
            # Where a duck may start, as arena.timeline refuses it: the workshop's placement plan
            # turns a spot magenta with the loader's own numbers rather than copies of them.
            "edge_margin_m": EDGE_MARGIN_M,
            "min_spacing_m": MIN_SPACING_M,
```

- [ ] **Step 4: Create `app/src/workshop/placement.js`**

```js
// The stage from above, over the performance's text. A marker for each duck where its `start` puts
// it: the star (ducks[0], "self") a ★ in orange, the others numbered as the text lists them. The
// audience is at the bottom, so the plan's right is the stage's y and its down the stage's x: the
// timeline's own frame (x towards the audience, y to the audience's right, yaw 0 facing the audience).
// Drag a marker to move its duck, its dot to turn it. A spot the Arena's loader would refuse — nearer
// the stage's edge, or another duck, than the event allows — turns magenta and is not taken. The text
// stays the one truth: a move rewrites that duck's `start` in it, an edit of it moves the markers,
// and while it is not JSON the plan is greyed out. "+ duck" puts another policy on a free spot.

import { el } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";
const CM = 100; // the plan is drawn in centimetres: SVG text wants sizes well above 1
const AUDIENCE_CM = 30; // the strip under the stage that says where the audience sits
const HANDLE_M = 0.25; // how far in front of its duck the dot that turns it stands
// The loader's own tolerance (arena/timeline.py _EPS_M): in floats 1.9 - 0.3 < 1.6, and a duck on the margin is taken.
const EPS_M = 1e-9;
const DOT_CM = 6;

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const listsObjects = (value) => Array.isArray(value) && value.some(isObject);
const finite = (value) => (Number.isFinite(value) ? value : 0);

function inline(value) {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (isObject(value)) return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(", ")}}`;
  return JSON.stringify(value);
}

/**
 * A timeline as the plan writes it back: the file, each duck, and each list of keyframes or notes one
 * entry a line, as an author lays one out; anything smaller on the line of its key.
 */
export function formatTimeline(value, indent = "") {
  const inner = `${indent}  `;
  if (listsObjects(value)) return `[\n${value.map((item) => inner + formatTimeline(item, inner)).join(",\n")}\n${indent}]`;
  if (!isObject(value) || !Object.values(value).some(listsObjects)) return inline(value);
  const lines = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatTimeline(item, inner)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The JSON object the text holds, or null while it holds none. */
function parse(text) {
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** Where each duck starts, as the loader reads it: a v1 file's one duck, and a start left out, at the centre facing the audience. */
function startsOf(raw) {
  if (!Array.isArray(raw.ducks)) return [{ x: 0, y: 0, yaw: 0 }];
  return raw.ducks.map((duck) => ({ x: finite(duck?.start?.x), y: finite(duck?.start?.y), yaw: finite(duck?.start?.yaw) }));
}

/** The text as a troupe: a v1 file becomes the v2 troupe of one the loader reads it as, its keyframes, voice and song the star's. */
function asTroupe(raw) {
  if (Array.isArray(raw.ducks)) return raw;
  const star = { policy: "self", ...raw };
  delete star.timeline_version;
  delete star.duration_s;
  return { timeline_version: 2, duration_s: raw.duration_s, ducks: [star] };
}

/** `duck` with its new start, written right after its policy, where an author reads it first. */
const placed = (duck, start) => Object.assign({ policy: duck.policy, start: null }, duck, { start });

function shape(tag, className, attributes, text) {
  const node = document.createElementNS(SVG, tag);
  if (className) node.setAttribute("class", className);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function placementPlan(event, { read, write, performers }) {
  const [depth, width] = event.size_m;
  // Where a duck's centre may stand, and how near another: the loader's own numbers (arena/timeline.py).
  const room = { x: depth / 2 - event.edge_margin_m, y: width / 2 - event.edge_margin_m };
  const spacing = event.min_spacing_m;
  const view = { left: (-width * CM) / 2, top: (-depth * CM) / 2, width: width * CM, height: depth * CM + AUDIENCE_CM };

  const box = el("div", "placement");
  const svg = shape("svg", "placement__stage", { viewBox: `${view.left} ${view.top} ${view.width} ${view.height}` });
  svg.append(
    shape("rect", "placement__floor", { x: view.left, y: view.top, width: view.width, height: depth * CM }),
    shape("rect", "placement__room", { x: round(-room.y * CM, 1), y: round(-room.x * CM, 1),
      width: round(2 * room.y * CM, 1), height: round(2 * room.x * CM, 1) }),
    shape("text", "placement__audience", { x: 0, y: (depth * CM) / 2 + AUDIENCE_CM * 0.7 }, "AUDIENCE"),
  );
  const add = el("select", "quiet placement__add");
  add.append(new Option("+ duck", ""), new Option("This checkpoint again", "self"));
  const bar = el("div", "placement__bar");
  bar.append(el("p", "hint", "Drag a duck to move it, its dot to turn it."), add);
  box.append(svg, bar);

  let troupe = null; // the text's JSON object; null while the text holds none
  let starts = []; // where each duck starts, as last read: a greyed plan keeps them
  let moving = null; // { index, turn, spot } while a marker is dragged

  const refused = (spot, index) => Math.abs(spot.x) > room.x + EPS_M || Math.abs(spot.y) > room.y + EPS_M
    || starts.some((other, j) => j !== index && Math.hypot(other.x - spot.x, other.y - spot.y) < spacing - EPS_M);

  function marker(spot, index) {
    const star = index === 0;
    const node = shape("g", `placement__duck${star ? " placement__duck--star" : ""}${refused(spot, index) ? " placement__duck--refused" : ""}`, {
      "data-duck": index,
      transform: `translate(${round(spot.y * CM, 1)} ${round(spot.x * CM, 1)})`,
    });
    // Facing yaw is (cos, sin) on the stage's (x, y): (sin, cos) on the plan's (right, down).
    const yaw = (spot.yaw * Math.PI) / 180;
    const dot = { cx: round(Math.sin(yaw) * HANDLE_M * CM, 1), cy: round(Math.cos(yaw) * HANDLE_M * CM, 1) };
    node.append(
      shape("line", "placement__heading", { x1: 0, y1: 0, x2: dot.cx, y2: dot.cy }),
      // Half the spacing across: two ducks' circles may touch, never overlap.
      shape("circle", "placement__body", { r: (spacing * CM) / 2 }),
      shape("text", "", { x: 0, y: 0 }, star ? "★" : String(index)),
      shape("circle", "placement__handle", { ...dot, r: DOT_CM }),
    );
    return node;
  }

  function draw() {
    box.classList.toggle("placement--off", !troupe);
    add.hidden = !troupe || starts.length >= event.max_ducks;
    svg.querySelectorAll(".placement__duck").forEach((node) => node.remove());
    starts.forEach((spot, index) => svg.append(marker(moving?.index === index ? moving.spot : spot, index)));
  }

  function refresh() {
    troupe = parse(read());
    if (troupe) starts = startsOf(troupe);
    draw();
  }

  function rewrite(raw) {
    write(`${formatTimeline(raw)}\n`);
    refresh();
  }

  /** The stage point under the pointer: the plan keeps its viewBox's proportions, so its box maps straight onto it. */
  function pointAt(pointer) {
    const frame = svg.getBoundingClientRect();
    return {
      x: (view.top + ((pointer.clientY - frame.top) / frame.height) * view.height) / CM,
      y: (view.left + ((pointer.clientX - frame.left) / frame.width) * view.width) / CM,
    };
  }

  function move(pointer) {
    const target = pointAt(pointer);
    const from = starts[moving.index];
    moving.spot = moving.turn
      ? { ...from, yaw: Math.round((Math.atan2(target.y - from.y, target.x - from.x) * 180) / Math.PI) }
      : { ...from, x: round(target.x, 2), y: round(target.y, 2) };
    draw();
  }

  function drop() {
    window.removeEventListener("pointermove", move);
    const { index, spot } = moving;
    const from = starts[index];
    moving = null;
    if (refused(spot, index) || (spot.x === from.x && spot.y === from.y && spot.yaw === from.yaw)) {
      draw();
      return;
    }
    const raw = asTroupe(troupe);
    raw.ducks[index] = placed(raw.ducks[index], spot);
    rewrite(raw);
  }

  svg.addEventListener("pointerdown", (pointer) => {
    const duck = troupe && pointer.target.closest(".placement__duck");
    if (!duck) return;
    pointer.preventDefault();
    const index = Number(duck.getAttribute("data-duck"));
    moving = { index, turn: pointer.target.classList.contains("placement__handle"), spot: starts[index] };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop, { once: true });
  });

  /** The free spot nearest the centre, on a grid of the spacing: beside the others rather than before or behind them. */
  function freeSpot() {
    const [rows, columns] = [Math.floor(room.x / spacing), Math.floor(room.y / spacing)];
    const spots = [];
    for (let i = -rows; i <= rows; i += 1) {
      for (let j = -columns; j <= columns; j += 1) spots.push({ x: round(i * spacing, 2), y: round(j * spacing, 2), yaw: 0 });
    }
    spots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || Math.abs(a.x) - Math.abs(b.x));
    return spots.find((spot) => !refused(spot, -1));
  }

  add.addEventListener("change", () => {
    const raw = asTroupe(troupe);
    raw.ducks.push({ policy: add.value, start: freeSpot(), keyframes: [{ t: 0 }] });
    add.value = "";
    rewrite(raw);
  });

  performers().then((found) => {
    for (const [label, mine] of [["Your trainings", true], ["Published", false]]) {
      const group = el("optgroup");
      group.label = label;
      group.append(...found.filter((p) => p.policy.startsWith("local:") === mine).map((p) => new Option(`${p.label} · ${p.rig}`, p.policy)));
      if (group.children.length) add.append(group);
    }
  });

  refresh();
  return { el: box, refresh };
}
```

- [ ] **Step 5: Put the plan above the text**

Replace `app/src/workshop/performance.js` with:

```js
// A stage challenge's performance, timeline.json, edited on the training's page: the file as it is, in
// the Arena's terminal box, under a plan of the stage that places its ducks, and one button once it
// changed. Saving goes through the Arena's own loader first; the checkpoint on the stage then plays
// the new moves. A refusal says where the file is wrong, and the text stays as typed.

import { el } from "./dom.js";
import { placementPlan } from "./placement.js";

export function performancePanel({ guide, event }, { load, save, onSaved, performers }) {
  const box = el("section", "performance");
  box.innerHTML = `
    <div class="section-label"><p class="eyebrow">Your performance</p>
      <a class="hint" target="_blank" rel="noopener">What the numbers mean ↗</a></div>
    <div class="terminal">
      <div class="terminal-bar mono-label">timeline.json</div>
      <textarea class="terminal-body performance__text" spellcheck="false" rows="14" disabled></textarea>
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
    if (text.value === saved) why.hidden = true;
  };
  const refuse = (error) => {
    why.textContent = error.message;
    why.hidden = false;
  };
  // The plan reads the text and writes it as a hand would: the box stays the one truth.
  const plan = placementPlan(event, {
    read: () => text.value,
    write: (value) => {
      text.value = value;
      changed();
    },
    performers,
  });
  $(".terminal").before(plan.el);
  text.addEventListener("input", () => {
    changed();
    plan.refresh();
  });
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
    text.disabled = false;
    changed();
    plan.refresh();
  }, refuse);
  return box;
}
```

`app/src/workshop/api.js`: after `saveTimeline`, add:

```js
export const getPerformers = (event) => json(`${challengeUrl(event)}/performers`).then((body) => body.performers);
```

`app/src/workshop/job.js`: replace the `performancePanel(…)` call's first two lines so that it reads:

```js
    $(".ckpts").after(performancePanel({ guide: `${status.arena}/${eventGuideHref(event.id)}`, event }, {
      load: () => api.getTimeline(event.id),
      save: (text) => api.saveTimeline(event.id, text),
      performers: () => api.getPerformers(event.id),
```

(`onSaved` stays as it is).

`app/public/workshop.css`: after the `.performance__text` rule add:

```css
/* The placement plan: the stage from above, over the performance's text, the audience at the bottom. */
.placement { margin: 0 0 12px; }
.placement--off { opacity: 0.45; pointer-events: none; }
.placement__stage { display: block; width: 100%; height: auto; touch-action: none; user-select: none; }
.placement__floor { fill: var(--warm-paper); stroke: var(--ink); stroke-width: 2; }
.placement__room { fill: none; stroke: var(--ink-70); stroke-dasharray: 6 4; }
.placement__audience { font-family: var(--mono); font-size: 14px; letter-spacing: 0.16em; fill: var(--ink-70); text-anchor: middle; }
.placement__duck { cursor: grab; }
.placement__body { fill: var(--paper); stroke: var(--ink); stroke-width: 2; }
.placement__duck--star .placement__body { fill: var(--orange); }
/* The charter has no red: magenta is its hot signal. */
.placement__duck--refused .placement__body { fill: var(--magenta); }
.placement__duck text { font-family: var(--display); font-size: 15px; fill: var(--ink); text-anchor: middle;
  dominant-baseline: central; pointer-events: none; }
.placement__heading { stroke: var(--ink); stroke-width: 2; }
.placement__handle { fill: var(--cyan); stroke: var(--ink); stroke-width: 1.5; }
.placement__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin-top: 6px; }
```

- [ ] **Step 6: Run them to see them pass**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/test_routes_read.py`
Expected: PASS.

Run: `cd app && npx vitest run src/workshop/placement.test.js`
Expected: PASS.

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add arena/web/routes_read.py tests/test_routes_read.py app/src/workshop/placement.js app/src/workshop/placement.test.js app/src/workshop/performance.js app/src/workshop/performance.test.js app/src/workshop/job.js app/src/workshop/job.test.js app/src/workshop/api.js app/public/workshop.css
/usr/bin/git commit -m "The workshop places the ducks on a plan of the stage: drag to move, a dot to turn, a spot the Arena would refuse is never taken, and + duck adds any training's checkpoint or published policy"
```

---

### Task 15: One click publishes the whole troupe

**Files:**
- Modify: `arena/workshop/publishing.py`, `arena/workshop/troupe.py`, `arena/workshop/tickets.py`, `arena/workshop/app.py`, `app/src/workshop/publish.js`, `app/src/workshop/job.js`
- Test: `tests/workshop/fake_uv.py`, `tests/workshop/conftest.py`, `tests/workshop/test_troupe.py`, `app/src/workshop/publish.test.js`, `app/src/workshop/job.test.js`, `tests/workshop/test_performance.py`

**Interfaces:**
- Consumes: Task 13's `resolve_local`, `troupe.py` and `published`; Task 2's `load_troupe(…, allow_local=True)`.
- Produces:
  - `publish_policy(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> {"repo", "revision"}`.
  - `published_at(run, checkpoint) -> "owner/repo@revision" | None` in `publishing.py`.
  - `local_ducks(root, troupe) -> [(policy, first duck index, run, n, challenge)]` and `resolved(text, on_hub) -> str` in `troupe.py`.
  - The publish route answers `{"publishing": {"done": k, "of": m}}` while local ducks remain, and today's entry once the star is entered.
  - `publishPanel`'s `onPublish(values, onProgress)`, where `onProgress({ done, of })` reports each step.

**Decisions:**
- **Progress: one call per step, made by the page.** Each POST publishes at most one local duck (a minute) and says how far it got; the call that finds every local duck on the Hub enters the star. This needs no stream, no background thread and no status endpoint. Each call is a plain JSON POST under the same `ws.publishing` lock and the same error path. The published.json reuse the spec asks for (a failed click resumes) is the mechanism itself.
- A duck's repo is `repo_for(user, f"{entry name} duck {k}")`, with k the first duck that names it ("my talent duck 1" → `alice/microduck-my-talent-duck-1`). Its description is the entry's, so its Hub card says which performance it was published for. It publishes under its own challenge's event (for `--twist-help`), with the entry's `allow_dirty`.
- Reuse: the newest published.json entry of that very run and checkpoint, entered or not.
- The resolved copy is written only when the troupe has a local duck. Otherwise the star publishes the challenge's own file, byte for byte, as today.

- [ ] **Step 1: Write the failing tests**

`tests/workshop/fake_uv.py`: add to the docstring, after "…with `--enter`, the line an entry prints (FAKE_UV_ENTER_REFUSED=1: the refusal, exit 3).":

```
A call's `--timeline` file is read as the call runs and logged with it: the workshop's resolved
copy is a temp file, gone once the call returns.
```

and replace `main`'s log line with:

```python
    timeline = flag(argv, "--timeline")
    with open(os.environ["FAKE_UV_LOG"], "a") as log:
        log.write(json.dumps({"argv": argv, "cwd": os.getcwd(),
                              "timeline": Path(timeline).read_text() if timeline else None}) + "\n")
```

`tests/workshop/conftest.py`: in the `fakes` fixture, after `calls`, add:

```python
    def timelines():
        """The text of each `publish --timeline` file, in call order, as the call read it."""
        rows = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return [row["timeline"] for row in rows if row["argv"][2] == "publish" and row["timeline"] is not None]
```

and return `SimpleNamespace(bin=bin_dir, gpu=gpu, calls=calls, timelines=timelines)`.

`tests/workshop/test_troupe.py`: add `AAA = "a" * 40` beside `BBB`, then at the end of the file:

```python
def publish(stage, star, **fields):
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and sings.", **fields}
    return stage.post(f"{URL}/jobs/{star.name}/publish", json=body)


def test_one_click_publishes_each_local_duck_then_enters_the_star_naming_them_by_their_commits(stage, checkout, fakes):
    star, walker = runs(checkout)
    local = f"local:sprint_2m/{walker.name}@1"
    text = troupe_text((local, 0.0, 0.5, 90), (local, 0.0, -0.5, -90))
    stage.timeline.write_text(text)
    assert publish(stage, star).json() == {"publishing": {"done": 1, "of": 2}}
    (duck,) = fakes.calls("publish")
    assert duck[3:7] == ["--run", str(walker), "--checkpoint", "1"]
    assert duck[duck.index("--repo") + 1] == "alice/microduck-my-talent-duck-1"
    assert {"--no-private", "--force"} <= set(duck) and "--enter" not in duck and "--timeline" not in duck
    entered = publish(stage, star).json()
    assert entered["page_url"] == "http://arena.test/#/r/fakerun1"
    last = fakes.calls("publish")[-1]
    assert last[3:7] == ["--run", str(star), "--checkpoint", "1"] and "--enter" in last
    sent = json.loads(fakes.timelines()[-1])
    named = f"alice/microduck-my-talent-duck-1@{AAA}"
    assert [d["policy"] for d in sent["ducks"]] == ["self", named, named]
    assert stage.timeline.read_text() == text  # the author's own file keeps its local forms
    (remembered,) = json.loads((walker / "workshop" / "published.json").read_text())
    assert (remembered["checkpoint"], remembered["repo"], remembered["revision"]) == (1, "alice/microduck-my-talent-duck-1", AAA)
    assert "entered" not in remembered
    # A duck published for a troupe is a policy, not an entry: its own training still says so.
    (walker_ticket,) = stage.get("/api/workshop/challenges/sprint-2m/jobs").json()["jobs"]
    assert walker_ticket["published"] is None


def test_a_duck_published_before_is_reused_from_its_runs_published_json(stage, checkout, fakes):
    star, walker = runs(checkout)
    (walker / "workshop").mkdir()
    (walker / "workshop" / "published.json").write_text(json.dumps([
        {"checkpoint": 1, "repo": "alice/microduck-walker", "revision": BBB,
         "entered": "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", "page_url": "http://arena.test/#/r/w",
         "at": "2026-10-13T10:00:00+00:00"}]))
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    assert publish(stage, star).status_code == 200
    (only,) = fakes.calls("publish")
    assert "--enter" in only
    assert [d["policy"] for d in json.loads(fakes.timelines()[-1])["ducks"]] == ["self", f"alice/microduck-walker@{BBB}"]


def test_a_failed_entry_keeps_its_ducks_published_and_the_next_click_reuses_them(stage, checkout, fakes, monkeypatch):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    monkeypatch.setenv("FAKE_UV_ENTER_REFUSED", "1")
    assert publish(stage, star).json() == {"publishing": {"done": 1, "of": 2}}
    refused = publish(stage, star)
    assert refused.status_code == 400 and "did not enter it" in refused.json()["detail"]
    monkeypatch.delenv("FAKE_UV_ENTER_REFUSED")
    assert publish(stage, star).status_code == 200
    assert ["--enter" in call for call in fakes.calls("publish")] == [False, True, True]  # the duck once


def test_the_preview_of_a_troupe_publishes_no_duck(stage, checkout, fakes):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    assert publish(stage, star, dry_run=True).status_code == 200
    (only,) = fakes.calls("publish")
    assert "--dry-run" in only


def test_a_troupe_naming_a_checkpoint_this_checkout_does_not_hold_publishes_nothing(stage, checkout, fakes):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@7", 0.0, 0.5, 0)))
    refused = publish(stage, star)
    assert refused.status_code == 400 and "no such checkpoint" in refused.json()["detail"]
    assert fakes.calls("publish") == []
```

`app/src/workshop/publish.test.js`: after "shows the whole output of a failure, and the same button tries again", add:

```js
  it("says which duck of a troupe it is publishing, then shows the entry", async () => {
    const on = handlers();
    let finish;
    on.onPublish.mockImplementationOnce((values, onProgress) => new Promise((resolve) => {
      onProgress({ done: 1, of: 3 });
      finish = resolve;
    }));
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "It sits and sings.");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(p.el.querySelector(".publish__status").textContent).toBe("Publishing duck 2/3…");
    finish({ entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", page_url: "http://arena.test/#/r/x" });
    await flush();
    expect(p.el.querySelector(".result").hidden).toBe(false);
  });
```

`app/src/workshop/job.test.js`: after "keeps what is typed while the page redraws every few seconds", add:

```js
  it("publishes a troupe call by call until the star is entered", async () => {
    api.getJob.mockResolvedValue(JOB);
    api.publishJob
      .mockResolvedValueOnce({ publishing: { done: 1, of: 2 } })
      .mockResolvedValueOnce({ repo: "alice/microduck-first", revision: "a".repeat(40), env: null,
        entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", page_url: "http://arena.test/#/r/x" });
    const root = document.createElement("div");
    const page = await open(root);
    await settle();
    const words = root.querySelector(".publish textarea");
    words.value = "It leans into every step.";
    words.dispatchEvent(new Event("input"));
    root.querySelector(".publish__go").click();
    // vi.waitFor steps the fake clock 50 ms at a time: well before the next poll.
    await vi.waitFor(() => expect(root.querySelector(".publish .result").hidden).toBe(false));
    expect(api.publishJob).toHaveBeenCalledTimes(2);
    expect(api.publishJob.mock.calls[1]).toEqual(api.publishJob.mock.calls[0]);
    page.leave();
  });
```

From `tests/workshop/test_performance.py`, delete Task 5's `test_a_troupe_naming_a_checkpoint_of_this_machine_is_not_published`: from this task on, a checkpoint of this machine is published first, then entered.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/workshop/test_troupe.py`
Expected: FAIL. The five new tests fail: today's route loads the timeline the way an entry does and refuses the local duck with 400 ("…is a checkpoint on your machine: publish it first"). The eight tests from Task 13 pass.

Run: `cd app && npx vitest run src/workshop/publish.test.js`
Expected: FAIL in the new test: `onProgress is not a function`.

- [ ] **Step 3: Publish a policy without entering it**

`arena/workshop/publishing.py`:

1. Replace the whole module docstring (both of its paragraphs) with:

```
Publish a run's checkpoint with `uv run publish`, which also enters it on the Arena.

The workshop writes no manifest, uploads nothing and calls no Arena itself: `publish --run
--enter` does all three, exactly as from a shell. The preview of the Hub card is the same command
with `--dry-run`. The real one prints the commit it made and the entry's time and page, which the
workshop opens and remembers next to the run. A troupe's ducks that are checkpoints of this machine
are published first, without `--enter` (`publish_policy`), and remembered next to their own run with
no entry line.
```

2. After `_run`, add:

```python
# Public, or the Arena cannot read it; --force because publishing a name again is a new commit on the
# same repo, and the Arena pins the commit it raced.
_PUBLIC = ["--no-private", "--force"]
```

3. Replace `published`'s docstring with `"""Every policy published from this run, oldest first: its entries, and the ducks a troupe published from it (no `entered`, no `page_url`)."""`, and add after `_remember`:

```python
def published_at(run, checkpoint: int) -> str | None:
    """The newest policy published from checkpoint n of this run, entered or not, as a timeline names
    it ("owner/repo@revision"); None when it never was."""
    for entry in reversed(published(run)):
        if entry.get("checkpoint") == checkpoint:
            return f"{entry['repo']}@{entry['revision']}"
    return None
```

4. In `publish`, replace the comment and the `args +=` line:

```python
    # Public, or the Arena cannot read it; --force because publishing a name again is a new commit on the
    # same repo, and the Arena pins the commit it raced. No --livery (every workshop entry wears
    # the default) and no --speed (a race is always swept).
    args += ["--no-private", "--force", "--enter", "--arena", arena]
```

with:

```python
    # No --livery (every workshop entry wears the default) and no --speed (a race is always swept).
    args += [*_PUBLIC, "--enter", "--arena", arena]
```

5. After `publish`, add:

```python
def publish_policy(root, run, checkpoint, repo, name, description, event_id, allow_dirty) -> dict:
    """Publish checkpoint n to `repo` without entering it: a duck that a troupe's entry names by this
    commit. Remembered in the run's published.json like an entry, with no `entered` nor `page_url`:
    a published policy, not an entry."""
    args = publish_args(run, checkpoint, repo, name, description, load_event(event_id), allow_dirty)
    output = _run(root, [*args, *_PUBLIC])
    commit = _COMMIT.search(output)
    if not commit:
        raise PublishError(output + "\n[workshop] publish printed no commit for the troupe to name")
    _remember(run, {"checkpoint": checkpoint, "repo": repo, "revision": commit.group(1),
                    "at": datetime.now(UTC).isoformat(timespec="seconds")})
    return {"repo": repo, "revision": commit.group(1)}
```

`arena/workshop/tickets.py`: replace the `"published"` line of `_ticket` with:

```python
        # The newest entry: a duck published for a troupe is a policy, not an entry.
        "published": next((e for e in reversed(published(run)) if "entered" in e), None) if run else None,
```

- [ ] **Step 4: The troupe's local ducks, and the timeline the Arena reads**

`arena/workshop/troupe.py`: add `import json` to the imports, and at the end:

```python
def local_ducks(root, troupe) -> list[tuple[str, int, Run, int, Challenge]]:
    """Each checkpoint of this machine the troupe names, once, in the order its ducks name them: the
    `local:` policy, the first duck that names it, and its run, checkpoint and challenge."""
    found = []
    for policy in troupe.references():
        if policy.startswith(LOCAL):
            first = next(k for k, duck in enumerate(troupe.ducks) if duck.policy == policy)
            found.append((policy, first, *resolve_local(root, policy)))
    return found


def resolved(text: str, on_hub: dict[str, str]) -> str:
    """A timeline's text as the Arena reads it: each `local:` duck named instead by the
    "owner/repo@revision" its checkpoint was published at."""
    raw = json.loads(text)
    for duck in raw["ducks"]:
        duck["policy"] = on_hub.get(duck["policy"], duck["policy"])
    return json.dumps(raw, indent=2) + "\n"
```

- [ ] **Step 5: The route publishes duck by duck, the star last**

`arena/workshop/app.py`:
- add `import tempfile` to the imports;
- add `TIMELINE` to the `.challenges` import;
- keep the `load_troupe` import from `..timeline` (Task 5 put it there);
- change the publishing import to `from .publishing import PublishError, exported, preview, publish, publish_policy, published_at, repo_for`;
- change the troupe import to `from .troupe import candidates, local_ducks, resolved, timeline_key`.

Replace `publish_route` with:

```python
@router.post("/challenges/{event}/jobs/{ticket_id}/publish")
async def publish_route(event: str, ticket_id: str, body: PublishRequest, request: Request) -> dict:
    """Publish & compete: one click, which may take several calls. A troupe's ducks that are
    checkpoints of this machine go first, one call each: each is published to a repo of its own
    without entering, or reused from its run's published.json, and the call answers how far it got.
    The call that finds them all on the Hub publishes the star with a copy of the timeline that names
    them by their commits, and enters it. timeline.json itself keeps its local forms, so the author
    keeps iterating, and a failed entry leaves the published ducks for the next click to reuse."""
    ws = _workshop(request)
    challenge = _challenge_or_404(ws, event)
    found = source(ws, challenge, ticket_id)
    if found is None:
        raise HTTPException(status_code=404, detail=f"No training {ticket_id} for {event}.")
    run = found[3]
    if run is None:
        raise HTTPException(status_code=409, detail=f"{ticket_id} has no checkpoint yet.")
    if body.checkpoint not in run.checkpoints:
        raise HTTPException(status_code=400, detail=f"{run.id} has no model_{body.checkpoint}.pt")
    if not body.name.strip() or not body.description.strip():
        raise HTTPException(status_code=400, detail="A name and a word for the commentators are both needed.")
    if run.provenance.get("dirty") and not body.allow_dirty:
        raise HTTPException(
            status_code=400,
            detail="This run started from uncommitted changes, so the code it records is not what "
                   "trained it. Train again from the workshop (it commits first), or publish anyway.",
        )
    # A stage publishes its performance beside the weights; one the Arena would refuse is never uploaded.
    timeline = timeline_file(challenge) if is_stage(challenge) and timeline_file(challenge).exists() else None
    ducks = []
    if timeline is not None:
        try:
            ducks = local_ducks(ws.root, load_troupe(timeline, load_event(challenge.event), allow_local=True))
        except TimelineError as exc:
            raise HTTPException(status_code=400, detail=f"Your performance cannot be published: {exc}") from exc
    user = await run_in_threadpool(_hub_user, ws)
    if not user:
        raise HTTPException(status_code=400, detail="Log in to Hugging Face first.")
    repo = repo_for(user, body.name)
    description = body.description.strip()
    args = (ws.root, run, body.checkpoint, repo, body.name, description, challenge.event, body.allow_dirty)
    env = code_url(ws.root, run.provenance.get("commit"))
    if not ws.publishing.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A publish is already running.")
    try:
        if body.dry_run:
            return {"repo": repo, **await run_in_threadpool(preview, *args, timeline=timeline)}
        on_hub = {policy: published_at(duck_run, n) for policy, _, duck_run, n, _ in ducks}
        waiting = [duck for duck in ducks if on_hub[duck[0]] is None]
        if waiting:
            _, first, duck_run, n, duck_challenge = waiting[0]
            name = f"{body.name} duck {first}"
            await run_in_threadpool(publish_policy, ws.root, duck_run, n, repo_for(user, name), name,
                                    description, duck_challenge.event, body.allow_dirty)
            return {"publishing": {"done": len(ducks) - len(waiting) + 1, "of": len(ducks) + 1}}
        with tempfile.TemporaryDirectory() as tmp:
            if ducks:
                timeline = Path(tmp) / TIMELINE
                timeline.write_text(resolved(timeline_file(challenge).read_text(encoding="utf-8"), on_hub),
                                    encoding="utf-8")
            entered = await run_in_threadpool(publish, *args, arena=ws.arena, code_url=env, timeline=timeline)
    except PublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        ws.publishing.release()
    ws.open_browser(entered["page_url"])  # the entry's page on the Arena, where its reveal plays
    return {**entered, "env": env}
```

Run: `uv run --no-config --frozen --extra dev pytest -q -p no:cacheprovider tests/workshop/test_troupe.py tests/workshop/test_publishing.py tests/workshop/test_performance.py`
Expected: PASS.

- [ ] **Step 6: The page calls again until the star is entered**

`app/src/workshop/publish.js`:

1. Replace the first two lines of the header comment with:

```js
// Publish & compete: the checkpoint the page has chosen goes to the user's Hugging Face account and is
// entered on the Arena by `uv run publish --enter`; a troupe's ducks of this machine go first, one at a
// time, and the page says which. A name, and a word for the commentators, are both
```

(the rest of the comment is unchanged).

2. In the `.publish__go` click handler, replace `const done = await onPublish(values());` with:

```js
      const done = await onPublish(values(), ({ done: published, of }) => say(`Publishing duck ${published + 1}/${of}…`));
```

`app/src/workshop/job.js`: replace the `onPublish` line of `publishPanel(…)` with:

```js
    // A troupe publishes its ducks of this machine one call at a time, the star last: until the star's
    // entry comes back, each answer says how far it got.
    onPublish: async (values, onProgress) => {
      for (;;) {
        const done = await api.publishJob(event.id, job.id, values);
        if (!done.publishing) return done;
        onProgress(done.publishing);
      }
    },
```

- [ ] **Step 7: Run them to see them pass**

Run: `cd app && npx vitest run src/workshop/publish.test.js`
Expected: PASS.

Run: `cd app && npx vitest run src/workshop/job.test.js`
Expected: PASS.

Run: `uv run --no-config --frozen --extra dev pytest -q -m "not network" -p no:cacheprovider tests/workshop`
Expected: PASS, every test. Report the count.

Run: `cd app && npm test`
Expected: PASS, apart from the 4 known `brightness.test.js` failures.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add arena/workshop/publishing.py arena/workshop/troupe.py arena/workshop/tickets.py arena/workshop/app.py tests/workshop/fake_uv.py tests/workshop/conftest.py tests/workshop/test_troupe.py tests/workshop/test_performance.py app/src/workshop/publish.js app/src/workshop/publish.test.js app/src/workshop/job.js app/src/workshop/job.test.js
/usr/bin/git commit -m "One click publishes a whole troupe: each checkpoint of this machine goes to a repo of its own first, or is reused, then the star enters with a timeline naming them by their commits"
```

---

### Task 16: The guide teaches troupes and placement

**Files:**
- Modify: `docs/guides/challenges/got-a-talent.md`
- Modify (other repo, `~/Projects/HuggingFace/microduck-challenges`, local `main`): `README.md`, `src/microduck_challenges/got_a_talent/AGENTS.md`

The only test that reads the guide is `app/src/guides.test.js`. Its "keeps each challenge's help within its own context" allows no `#/` link besides `#/guides/train-a-policy`. The two sections therefore add no links, and no in-page `#anchor` either, since the hash router would take it for a route. `tests/test_bundle_frontend.py` does not read the docs.

- [ ] **Step 1: The Arena's guide**

In `docs/guides/challenges/got-a-talent.md`, right before `## Judging` (after the paragraph ending "An entry without a timeline stands still for 20 s."), insert:

````markdown
### Troupe

A performance can put up to **4 ducks** on the stage. They share one physics: they can bump into
each other, push each other over, or hold each other up. Each duck has its own policy, place,
keyframes, voice and song. Such a file is `"timeline_version": 2`, with a `ducks` list where version 1
has `keyframes`:

```json
{"timeline_version": 2, "duration_s": 20.0,
 "ducks": [
   {"policy": "self", "start": {"x": 0.0, "y": 0.0, "yaw": 0},
    "voice": {"pitch": 0.2},
    "song": [{"t": 2.0, "note": "C4", "for": 0.5}],
    "keyframes": [{"t": 0.0}, {"t": 3.0, "twist": [1, 0, 0]}]},
   {"policy": "pollen-robotics/microduck-got-a-talent-reference@<its 40-character commit>",
    "start": {"x": 0.4, "y": -0.6, "yaw": 90},
    "keyframes": [{"t": 0.0}]}
 ]}
```

- `policy` says who performs:
  - `"self"` is the policy you enter, the star: the followspot follows it. The first duck is always
    `"self"`, and any other duck may be `"self"` again.
  - Any public policy on the Hub joins as `"owner/repo@<commit>"`, pinned to its full 40-character
    commit (a repo's commit history on the Hub lists them). A branch name would make a performance
    nobody could play again. Only that repo's policy comes along, never its own `timeline.json`.
- A duck's `keyframes` are commands for its own policy, under the rules above, and each policy reads
  them its own way: a walker trained for the 2 m Sprint reads `twist` as a speed, not as a sit flag.
  No policy sees the other ducks, so any published policy joins as it is.
- Legs and rollers mix: each duck stands on the robot its policy's manifest names.
- `voice` and `song` belong to their duck. When two or more ducks sing, they sing the way the robot
  sings in a choir: in a chord, vibrato, buzz and breath fight the tuning, so the choir holds them
  back and those three knobs are heard much less. A duck singing alone sounds as described above.
  Each duck still makes one sound at a time.
- `duration_s` is the troupe's: every duck performs for the same time. A fall stops no one; if the
  physics itself breaks down, the whole troupe stops together.
- A version 1 file is a troupe of one: the star, at the centre, facing the audience, with the file's
  keyframes, voice and song.

Votes and points go to you, the entrant, never to the authors of the policies you borrow. Their
names and policies are credited on your performance's page and in its clip ("featuring @x ·
walker"), and never on the anonymous ballot. Any change to the file, a duck's policy or place
included, makes it another performance.

In the workshop, a duck can also be a checkpoint of one of your trainings that is not published
yet, of any challenge: `"local:<challenge folder>/<run>@<checkpoint>"`. The Arena refuses that form.
**Publish and compete** publishes each such checkpoint to a repo of its own first, then enters the
star with a copy of your timeline that names them by their commits. Your own `timeline.json` keeps
the local names.

### Placement

A duck's `start` is where it stands when the performance begins, in the stage's own frame:

- the origin is the centre of the stage, and distances are in metres;
- `x` points towards the audience, and `y` to the audience's right (the duck's left when it faces
  the audience);
- `yaw` is the way the duck faces, in degrees within ±180: 0 faces the audience, 90 faces the
  audience's right, 180 turns its back to them.

A `start` you leave out is `{"x": 0, "y": 0, "yaw": 0}`. The stage is 2.6 m deep along `x` and 3.8 m
wide along `y`. Every start stays at least **0.3 m** inside its edge, so `x` within ±1.0 m and `y`
within ±1.6 m. Two ducks start at least **0.3 m** apart, centre to centre. As with a single duck, the
Arena shakes each start a little: the joints by ±0.01 rad and the heading by ±2°.

On a training's page, the workshop draws the stage from above, over your performance's text, with
the audience at the bottom. Each duck is a marker numbered as `ducks` lists it, the star a ★. Drag a
marker to move its duck, and its dot to turn it. A spot the Arena would refuse turns magenta, and
the duck goes back to where it was. A move rewrites that duck's `start` in the text, and an edit of
the text moves the markers. Moving the duck of a version 1 file turns it into the version 2 troupe
of one it already is. **+ duck** adds a checkpoint of one of your trainings, one of your published
policies, or the star again, on a free spot. For any other policy, paste its `owner/repo@<commit>`
into the text.
````

- [ ] **Step 2: Check the page renders**

Run: `cd app && npx vitest run src/guides.test.js`
Expected: PASS. Then read the two sections back once:
- every code fence is closed;
- the headings go `###` under `## Your performance`;
- no link was added;
- a performance is never called a "show" in them.

- [ ] **Step 3: Commit the Arena's guide**

```bash
/usr/bin/git add docs/guides/challenges/got-a-talent.md
/usr/bin/git commit -m "The Got a Talent guide teaches troupes and placement: up to four ducks with their own policies pinned to a commit, the choir, the credits, and the stage's frame and margins"
```

- [ ] **Step 4: The challenges' README and agent guide**

In `~/Projects/HuggingFace/microduck-challenges` (local `main`, which already holds the unpushed 97a1edc and 441dd89):

`README.md`: after the line ending `[Got a Talent guide](https://pollen-robotics-microduck-arena.hf.space/#/e/got-a-talent/guide)).`, add:

```markdown
A performance can also be a troupe of up to 4 ducks in one physics. Each duck has its own policy
(yours, or any public one on the Hub pinned to a commit, on legs or rollers), place, keyframes,
voice and song: see the guide's Troupe and Placement sections.
```

In the same file, replace "On MicroDuck Got a Talent, a training's page also edits `timeline.json`, your performance, and plays it with the checkpoint you pick." with:

```markdown
On MicroDuck Got a Talent, a training's page also edits `timeline.json`, your performance, places
its ducks on a plan of the stage, and plays it with the checkpoint you pick. Publish and compete
publishes every duck of a troupe in one click.
```

`src/microduck_challenges/got_a_talent/AGENTS.md`:

1. After the paragraph ending "Offer it to the user when the performance wants sound; never add it without asking.", insert:

```markdown
A performance can also be a **troupe** of up to 4 ducks in one shared physics. The star is this
folder's policy (`"self"`); the others are any policy, the user's or a public one pinned to a full
commit, on legs or rollers. Each duck has its own place, keyframes, voice and song, and each duck's
keyframes are commands for its own policy. The Arena's
[Got a Talent guide](https://pollen-robotics-microduck-arena.hf.space/#/e/got-a-talent/guide) has the
format and the rules in its Troupe and Placement sections. Offer it when the user wants company on
stage; never add a duck, nor borrow someone's policy, without asking.
```

2. Replace "(`stage`: `fell_at`, `seated_s`, `standing_s`)." with "(`stage`: `fell_at`, `seated_s` and `standing_s` for each duck, the star first)."

3. In "### Editing the timeline", step 3, replace "edits `timeline.json` on a training's page and plays it with the checkpoint the user picks." with "edits `timeline.json` on a training's page, places a troupe's ducks on a plan of the stage, and plays it with the checkpoint the user picks."

```bash
cd ~/Projects/HuggingFace/microduck-challenges
/usr/bin/git add README.md src/microduck_challenges/got_a_talent/AGENTS.md
/usr/bin/git commit -m "Got a Talent: a performance can be a troupe of up to four ducks, placed on the stage, as the Arena's guide teaches"
```

Do not push.

- [ ] **Step 5: The challenge's check reads a troupe's star (microduck-challenges)**

`src/microduck_challenges/got_a_talent/check.py` and `tests/test_got_a_talent.py` call `load_timeline` and `evaluate(event, policy, timeline)`, which Task 5 removed, and `report` reads a 2-D trace. Their tests run against the Arena wheel the challenges lock (0.4.5), so nothing breaks today. They break at the 0.5.0 relock. Adapt them now and test them against the worktree's code, with `PYTHONPATH` pointing at the worktree so its `arena` package shadows the installed wheel.

In `tests/test_got_a_talent.py`:

1. Change `from arena.timeline import Timeline, load_timeline` to `from arena.timeline import Timeline, load_troupe`.
2. In `test_the_reference_timeline_plays_on_the_arena` and `test_the_reference_timeline_stays_inside_what_training_saw`, replace `timeline = load_timeline(TIMELINE, load_event("got-a-talent").time_limit_s)` with:

```python
    timeline = load_troupe(TIMELINE, load_event("got-a-talent")).ducks[0].timeline
```

3. After `test_check_plays_the_stage_and_fails_a_walker`, add:

```python
def test_check_reads_a_troupes_star_alone(tmp_path, capsys):
    """A troupe's other ducks are other policies: the check plays the star alone, on its own keyframes."""
    import json

    from microduck_challenges.got_a_talent import check

    reference = json.loads(TIMELINE.read_text())
    troupe = tmp_path / "timeline.json"
    troupe.write_text(json.dumps({"timeline_version": 2, "duration_s": reference["duration_s"], "ducks": [
        {"policy": "self", "keyframes": reference["keyframes"]},
        {"policy": "local:got_a_talent/first@1", "start": {"x": 0.0, "y": 0.6, "yaw": 0}, "keyframes": [{"t": 0.0}]},
    ]}))
    assert check.main([str(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"), "--timeline", str(troupe)]) == 1
    out = capsys.readouterr().out.splitlines()
    assert len(out) == 9 + 2  # the star's keyframes, the fall line, the verdict
```

Run, from `~/Projects/HuggingFace/microduck-challenges`, in the foreground with `timeout: 600000`:

`PYTHONPATH=/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/talent-troupe uv run --no-config --frozen --group workshop pytest -q tests/test_got_a_talent.py`

Expected: FAIL. Every test that imports `check` fails with `ImportError: cannot import name 'load_timeline' from 'arena.timeline'`. That `arena` is the worktree's, so the test file's own `load_troupe` imports fine.

In `src/microduck_challenges/got_a_talent/check.py`:

1. In the module docstring, replace "Plays the stage the way the Arena scores an entry (arena.evaluate, with this folder's timeline.json by default), then checks the performance against the timeline, keyframe by keyframe:" with:

```
Plays the stage the way the Arena scores an entry (arena.evaluate, with this
folder's timeline.json by default; for a troupe, the star alone on its own
keyframes, since the other ducks are other policies), then checks the
performance against the star's timeline, keyframe by keyframe:
```

2. Replace the imports `from arena.evaluate import evaluate` … `from arena.timeline import Timeline, TimelineError, load_timeline` with:

```python
from arena.cast import cast_of
from arena.evaluate import evaluate
from arena.manifest import load_event
from arena.policy import PolicyError, load_policy
from arena.timeline import Timeline, TimelineError, load_troupe, solo
```

3. In `main`, replace the `try:` block and the `report(...)` line with:

```python
    try:
        # The workshop's own file may name checkpoints of this machine; only the star plays here.
        timeline = load_troupe(Path(args.timeline), event, allow_local=True).ducks[0].timeline
        policy = load_policy(Path(args.onnx))
        result = evaluate(event, policy, cast_of(event, solo(timeline), policy, None, {}).performers)
    except (TimelineError, PolicyError) as exc:
        print(f"{exc}", file=sys.stderr)
        return 1
    lines, passed, head_error = report(result.trace[0], timeline, event.termination)
```

Run the same command again. Expected: PASS, every test of the file.

Commit, in that repo only:

```bash
/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges add src/microduck_challenges/got_a_talent/check.py tests/test_got_a_talent.py
/usr/bin/git -C /Users/nicolasrabault/Projects/HuggingFace/microduck-challenges commit -m "Got a Talent's check reads a troupe: the star alone, on its own keyframes, as Arena 0.5.0 plays it"
```

This commit needs Arena 0.5.0. Under the 0.4.5 lock, `check` no longer imports. It stays local and ships only together with the 0.5.0 relock, never before it.

---

### Task 17: Seen and heard on this Mac

Nothing is committed in this task, and everything stays in the scratchpad. The aim is to observe a real troupe before calling it done. Reading public Hub repos is allowed; nothing is written anywhere but the scratchpad.

The cast, pinned:

| Duck | Policy | Rig | Role |
| --- | --- | --- | --- |
| 0 | `self` = the Got a Talent reference's `policy.onnx` (pollen-robotics/microduck-got-a-talent-reference @ 0454fe8a848526338ba6edf72b8358fbf51d6b21) | legs | the star: sits, stands, looks around, sings |
| 1 | `self` again | legs | sings the second part |
| 2 | `cdeplanne/microduck-alpha-walking@546ce51ebe77ab6740e71e6d32120f7f71738465` | legs | walks across the back of the stage, quacks |
| 3 | `cdeplanne/microduck-roller@0d53e6a1e0fe65196f5dca2a0ffcd7f9455ad767` | rollers | rolls across the other way, wheees |

The reference reads `twist[0]` as a sit flag (1 = sit) and follows the four head commands. The walker and the roller read `twist` as `[vx, vy, wz]` in m/s and rad/s.

- [ ] **Step 1: The star's weights, downloaded read-only**

From the worktree:

```bash
.venv/bin/python -c "from huggingface_hub import hf_hub_download as d; print(d('pollen-robotics/microduck-got-a-talent-reference', 'policy.onnx', revision='0454fe8a848526338ba6edf72b8358fbf51d6b21', local_dir='$SCRATCH/troupe-check'))"
```

Expected: the path `$SCRATCH/troupe-check/policy.onnx`.

- [ ] **Step 2: The troupe, scored into a scratch store**

Write `$SCRATCH/troupe-check/troupe.json`:

```json
{"timeline_version": 2, "duration_s": 12.0,
 "ducks": [
   {"policy": "self", "start": {"x": 0.4, "y": -0.4, "yaw": 0},
    "voice": {"pitch": 0.6},
    "song": [{"t": 2.0, "note": "E5", "for": 1.5}, {"t": 4.0, "note": "G5", "for": 1.5, "vowel": "oo"}],
    "keyframes": [{"t": 0.0}, {"t": 6.0, "twist": [1, 0, 0]}, {"t": 8.0, "head": [0, 0, 0.6, 0]}, {"t": 10.0}]},
   {"policy": "self", "start": {"x": 0.4, "y": 0.4, "yaw": 0},
    "voice": {"pitch": 0.3},
    "song": [{"t": 2.0, "note": "C5", "for": 1.5}, {"t": 4.0, "note": "E5", "for": 1.5, "vowel": "oo"}],
    "keyframes": [{"t": 0.0}, {"t": 7.0, "twist": [1, 0, 0]}, {"t": 10.0}]},
   {"policy": "cdeplanne/microduck-alpha-walking@546ce51ebe77ab6740e71e6d32120f7f71738465",
    "start": {"x": -0.4, "y": -1.4, "yaw": 90},
    "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [0.2, 0, 0]}, {"t": 9.0, "triggers": [1, 0]}, {"t": 9.3}]},
   {"policy": "cdeplanne/microduck-roller@0d53e6a1e0fe65196f5dca2a0ffcd7f9455ad767",
    "start": {"x": -0.9, "y": 1.4, "yaw": -90},
    "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [0.3, 0, 0], "triggers": [0, 1]}, {"t": 5.0}]}
 ]}
```

Expected sounds:
- from 2.0 s: duck 0 and duck 1 sing E5 over C5, then G5 over E5 on "oo", as a chorus (two singers);
- from 1.0 s to 5.0 s: the roller's wheee, on its own speaker, beside the chorus;
- at 9.0 s: the walker's quack.

Score it, from the worktree:

```bash
.venv/bin/arena score $SCRATCH/troupe-check/policy.onnx --event got-a-talent \
  --timeline $SCRATCH/troupe-check/troupe.json --store $SCRATCH/troupe-check/store --user alice --name troupe-check
```

Expected: one summary line per duck, and `recorded <run_id>`. Note the run id. Duck 2 should not have fallen; duck 0 and duck 1 should have been seated at some point. If a duck fell, note it and go on: no fall stops a performance.

- [ ] **Step 3: A solo v1 performance beside it, to compare with today**

Write `$SCRATCH/troupe-check/solo.json`:

```json
{"timeline_version": 1, "duration_s": 8.0,
 "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [0.2, 0, 0]}, {"t": 6.0}]}
```

```bash
.venv/bin/arena score arena/assets/policies/BEST_alpha_walking.onnx --event got-a-talent \
  --timeline $SCRATCH/troupe-check/solo.json --store $SCRATCH/troupe-check/store --user alice --name solo-check
```

Expected: one summary line and `recorded <run_id>`. Note this second run id.

- [ ] **Step 4: Serve it**

- API: `<worktree>/.venv/bin/arena serve --store $SCRATCH/troupe-check/store --user alice --port 8001`, started by its ABSOLUTE path with `run_in_background`, since it is a server and not a test. Confirm it serves the worktree's code: `curl -s http://127.0.0.1:8001/api/events | grep max_ducks` prints a match.
- Front-end: write `$SCRATCH/troupe-check/vite.config.js`. It spreads the worktree's `app/vite.config.js`, sets `root` to the worktree's `app`, `server.port` to 5180 and proxies `/api` to `http://127.0.0.1:8001`. Run `npx vite --config $SCRATCH/troupe-check/vite.config.js` from the worktree's `app`, also in the background. Restart vite after any source edit.
- Open `http://localhost:5180`, not `127.0.0.1`.

- [ ] **Step 5: Four ducks on the clip page**

Use Puppeteer from `/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer`, with a 1920×1080 viewport and `deviceScaleFactor: 1`. Open `http://localhost:5180/clip.html?run=<troupe run_id>&layout=landscape`. Wait for `window.clip.ready`. Then, for each of t = 0.5 s, 3.0 s, 7.5 s and 11.5 s:
- compute `i = clip.plan.intro + Math.round((clip.plan.settle + t / 0.02) / clip.plan.stride)`;
- call `clip.draw(i)`;
- take a screenshot.

Expected:
- four ducks on the stage, each where its start put it at 0.5 s: the two sitters at the front, the walker and the roller at the back, the roller on wheels;
- the two singers' beaks open at 3.0 s;
- the walker moving to the audience's right and the roller to the left;
- the followspot on duck 0;
- every duck in frame in every shot.

Then open the solo run the same way at t = 0.5 s and 5.0 s. Expected: one duck framed as on main today, centred on its own path.

Send the six captures to the owner.

- [ ] **Step 6: The chorus, in the clip's soundtrack**

On the troupe's clip page, run `len = await clip.soundtrack()`. Read it back in 1 MiB slices with `clip.chunk(offset, size)` (base64) and write `$SCRATCH/troupe-check/soundtrack.f32`. Then:

```bash
ffmpeg -y -loglevel error -f f32le -ar 48000 -ac 2 -i $SCRATCH/troupe-check/soundtrack.f32 $SCRATCH/troupe-check/soundtrack.wav
```

Expected:
- the sounds of Step 2, each offset by the tape's start plus the settle;
- two voices in tune, with the roller's wheee beside them;
- no clipping: the peak sample magnitude is at most 1.0. Check with `ffmpeg -i $SCRATCH/troupe-check/soundtrack.wav -af volumedetect -f null - 2>&1 | grep max_volume`, which should print a value at or below 0.0 dB.

Send the WAV to the owner.

- [ ] **Step 7: The voices, live on the run page**

Launch Puppeteer with `--autoplay-policy=no-user-gesture-required`. Before any page script runs (`evaluateOnNewDocument`), wrap `AudioBufferSourceNode.prototype.start` so that it records `[performance.now(), buffer.length, offset]` in `window.__starts`. Open `http://localhost:5180/#/r/<troupe run_id>` and wait 14 s.

Expected:
- `__starts` holds two song takes (one per singer, each about 5.7 s long: last note end 5.5 s + 0.2 s);
- one wheee take for the roller from about 1.0 s;
- one quack for the walker at about 9.0 s;
- the page credits the two borrowed ducks ("featuring @cdeplanne · …");
- there are no console errors.

- [ ] **Step 8: Stop the servers, and report to the owner**

Kill both background servers. Report:
- the per-duck summary lines;
- the six captures;
- the soundtrack WAV;
- the start log.

Ask the owner to look and listen. The workshop's plan, play and one-click publish are exercised end to end in the finishing session (spec section 7), on a real Got a Talent training.

---

### Task 18: Version 0.5.0

**Files:**
- Modify: `pyproject.toml` (`version`), `uv.lock` (the `microduck-arena` package's version line)

- [ ] **Step 1: Full suite**

Run the two Python calls and `cd app && npm test` from Global Constraints.
Expected: every pass count is at least the starting count plus the new tests; the 4 known brightness failures are the only failures.

- [ ] **Step 2: Bump**

In `pyproject.toml`, change `version = "0.4.5"` to `version = "0.5.0"`. In `uv.lock`, change the `version = "0.4.5"` line under `name = "microduck-arena"` to `"0.5.0"`. Check that nothing else moved with `/usr/bin/git diff --stat`, which should show 2 files and 2 lines.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add pyproject.toml uv.lock
/usr/bin/git commit -m "Version 0.5.0: a Got a Talent entry puts a troupe on the stage, several ducks with their own policies in one physics"
```

Stop here. Next comes the finishing session (spec section 7): a local Got a Talent training whose performance is a troupe of 4 that sings and dances. The release steps after it each wait for the owner's yes, and are listed under "Not in this plan".
