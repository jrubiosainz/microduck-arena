# Arena Local App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `uv run arena serve` opens the Arena in a browser on localhost — leaderboard, submit a policy by upload and watch it race, and a head-to-head replay of the podium — with no Hugging Face account, no OAuth and no network.

**Architecture:** One FastAPI process serves both a small REST API over the existing engine and the built frontend bundle. The frontend is vanilla JS + Vite + three.js: it renders the leaderboard from JSON and replays stored pose traces through a three.js rig built from the robot's kinematics. Physics never runs in the browser — traces come from the server, already simulated.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, `uv`; Vite, vanilla ES modules, three.js, vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-microduck-arena-design.md`

This plan covers spec stages 4–5 for **local operation only**. A later plan adds deployment: HF OAuth, `HubStore`, repo-id intake, rate limits and subprocess isolation. Per the spec's *Running it locally* section, that split is deliberate — none of those are needed to try the Arena, and the engine must work without them.

## Global Constraints

Copied from the spec and from the engine this builds on. **Every task's requirements implicitly include this section.**

- **Everything is private.** No public dataset, no publishing, no telemetry. Storage is a local directory.
- **It must run with no network and no HF account.** Identity comes from `ARENA_DEV_USER`; OAuth is a later plan and must not be assumed to exist.
- **Physics never runs in the browser.** The frontend replays stored traces. No MuJoCo WASM, no onnxruntime-web.
- Trace layout, 21 float32 per frame at 50 Hz: `trunk position(3), trunk quaternion(4, MJCF w,x,y,z order), joint angles(14 in JOINT_NAMES order)`.
- `JOINT_NAMES` order is fixed and comes from `arena.constants`: `left_hip_yaw, left_hip_roll, left_hip_pitch, left_knee, left_ankle, neck_pitch, head_pitch, head_yaw, head_roll, right_hip_yaw, right_hip_roll, right_hip_pitch, right_knee, right_ankle`.
- **MJCF quaternions are `(w, x, y, z)`; three.js is `(x, y, z, w)`.** Every conversion is `q.set(m[1], m[2], m[3], m[0])`. Getting this wrong yields a duck that is subtly, plausibly mis-rotated rather than obviously broken.
- **MJCF is Z-up, three.js is Y-up.** One root group with `rotation.x = -Math.PI / 2` fixes it; nothing else compensates.
- `CTRL_DT = 0.02` — a trace frame is 20 ms of simulated time.
- All Python commands run through `uv run`. Frontend commands run in `app/`.

## Existing engine surface this builds on

Already implemented and tested (93 tests). Do not reimplement any of it.

| From | Use |
| --- | --- |
| `arena.manifest` | `load_event(id)`, `all_events()`, `ManifestError`, `Manifest` |
| `arena.policy` | `load_policy(path)`, `PolicyError`, `MAX_MODEL_BYTES` |
| `arena.evaluate` | `evaluate(manifest, policy) -> Evaluation` |
| `arena.store` | `LocalStore(root)`, `RunRecord`, `new_run_id` |
| `arena.index` | `leaderboard(records) -> list[Row]` with `.rank`, `.record` |
| `arena.trace` | `encode(arr) -> bytes`, `decode(bytes) -> np.ndarray` float32 |
| `arena.constants` | `JOINT_NAMES`, `CTRL_DT`, `TRACE_WIDTH`, `RUNNER_VERSION` |

## File structure

```
arena/web/__init__.py        (empty)
arena/web/config.py          ArenaConfig: where the store is, who the dev user is
arena/web/app.py             create_app(): wiring, static mount, error handlers
arena/web/routes_read.py     GET events / leaderboard / run / trace
arena/web/routes_submit.py   POST submit (upload)
arena/cli.py                 gains the `serve` subcommand

app/package.json             vite + three + vitest
app/vite.config.js           build to dist/, dev proxy for /api
app/index.html
app/src/main.js              entry: routing between board and replay
app/src/api.js               fetch wrappers, trace decoding
app/src/format.js            pure display helpers (time, seeds, rank)
app/src/board.js             leaderboard table + lane checkboxes
app/src/rig.js               kinematics.json -> three.js tree; setJoint
app/src/replay.js            trace frame -> rig pose; Player (play/pause/scrub)
app/src/viewer.js            scene, camera, lanes, render loop
app/src/submit.js            upload dialog + result
app/public/robot/kinematics.json   vendored
app/public/robot/microduck.glb     vendored
```

---

### Task 1: Web config, app factory, and `arena serve`

**Files:**
- Modify: `pyproject.toml`
- Create: `arena/web/__init__.py`
- Create: `arena/web/config.py`
- Create: `arena/web/app.py`
- Modify: `arena/cli.py`
- Test: `tests/test_web_config.py`
- Test: `tests/test_web_app.py`

**Interfaces:**
- Consumes: `arena.store.LocalStore`
- Produces:
  - `@dataclass(frozen=True) ArenaConfig: store_dir: Path, dev_user: str, frontend_dir: Path | None`
  - `ArenaConfig.from_env(store_dir=None, dev_user=None) -> ArenaConfig`
  - `create_app(config: ArenaConfig) -> FastAPI`, with `app.state.config` and `app.state.store`
  - `GET /api/health -> {"ok": True, "user": <dev_user>, "events": <count>}`
  - CLI: `arena serve [--store DIR] [--user NAME] [--host H] [--port N]`

The spec's route table also lists `GET /api/me`. Locally there is nothing to
authenticate, so the current user is reported by `/api/health` instead of a
dedicated route; the deployment plan adds `/api/me` when OAuth gives it something
to say.

- [ ] **Step 1: Add the dependencies**

In `pyproject.toml`, replace the `dependencies` list with:

```toml
dependencies = [
    "mujoco>=3.2",
    "onnxruntime>=1.18",
    "numpy>=1.26",
    "huggingface-hub>=0.24",
    "fastapi>=0.115",
    "uvicorn>=0.30",
    "python-multipart>=0.0.9",
]
```

`python-multipart` is required for file upload in Task 4; FastAPI raises at import of the form parser without it. Add `httpx>=0.27` to the `dev` extra — `fastapi.testclient.TestClient` needs it:

```toml
dev = ["pytest>=8.0", "ruff>=0.6", "onnx>=1.16", "httpx>=0.27"]
```

- [ ] **Step 2: Write the failing config test**

`tests/test_web_config.py`:

```python
from arena.web.config import ArenaConfig


def test_explicit_values_win(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    assert config.store_dir == tmp_path
    assert config.dev_user == "coralie"


def test_store_dir_comes_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_STORE", str(tmp_path / "board"))
    assert ArenaConfig.from_env().store_dir == tmp_path / "board"


def test_dev_user_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("ARENA_DEV_USER", "coralie")
    assert ArenaConfig.from_env().dev_user == "coralie"


def test_there_is_always_a_user(monkeypatch):
    """Running locally must never require configuration to work.

    A submission with no attribution would be unrankable, so the default is a
    name rather than None.
    """
    monkeypatch.delenv("ARENA_DEV_USER", raising=False)
    assert ArenaConfig.from_env().dev_user == "local"


def test_the_store_directory_is_created_on_demand(tmp_path):
    target = tmp_path / "nested" / "board"
    config = ArenaConfig.from_env(store_dir=target)
    config.ensure_store()
    assert target.is_dir()


def test_frontend_dir_is_none_when_not_built(tmp_path, monkeypatch):
    """A missing bundle is a reportable state, not a crash — the API still works."""
    monkeypatch.setenv("ARENA_FRONTEND", str(tmp_path / "absent"))
    assert ArenaConfig.from_env().frontend_dir is None
```

- [ ] **Step 3: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_web_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.web'`

- [ ] **Step 4: Write the config module**

`arena/web/__init__.py`:

```python
"""The local web app: a small REST API over the engine, plus the frontend."""
```

`arena/web/config.py`:

```python
"""Where the app keeps things, and who it thinks you are.

Everything defaults to working with no configuration at all: a store under the
working directory and a user called "local". That is the point — trying the
Arena must not require an account, a token or a network.
"""

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_STORE = Path("arena-board")
DEFAULT_USER = "local"


@dataclass(frozen=True)
class ArenaConfig:
    store_dir: Path
    dev_user: str
    frontend_dir: Path | None

    @classmethod
    def from_env(
        cls,
        store_dir: Path | None = None,
        dev_user: str | None = None,
        frontend_dir: Path | None = None,
    ) -> "ArenaConfig":
        store = Path(store_dir or os.environ.get("ARENA_STORE") or DEFAULT_STORE)
        user = dev_user or os.environ.get("ARENA_DEV_USER") or DEFAULT_USER

        candidate = frontend_dir or os.environ.get("ARENA_FRONTEND")
        if candidate is None:
            candidate = Path(__file__).resolve().parents[2] / "app" / "dist"
        candidate = Path(candidate)
        # A missing bundle is reported by the app, not raised here: the API is
        # useful on its own and `arena serve` should say "run npm run build"
        # rather than traceback.
        resolved = candidate if (candidate / "index.html").is_file() else None

        return cls(store_dir=store, dev_user=user, frontend_dir=resolved)

    def ensure_store(self) -> Path:
        self.store_dir.mkdir(parents=True, exist_ok=True)
        return self.store_dir
```

- [ ] **Step 5: Run the config test**

Run: `uv run --extra dev pytest tests/test_web_config.py -v`
Expected: PASS, 6 tests

- [ ] **Step 6: Write the failing app test**

`tests/test_web_app.py`:

```python
from fastapi.testclient import TestClient

from arena.web.app import create_app
from arena.web.config import ArenaConfig


def client_for(tmp_path, **overrides):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie", **overrides)
    return TestClient(create_app(config))


def test_health_reports_the_user_and_event_count(tmp_path):
    body = client_for(tmp_path).get("/api/health").json()
    assert body["ok"] is True
    assert body["user"] == "coralie"
    # Three events ship with the engine: sprint, roller sprint, hill climb.
    assert body["events"] == 3


def test_the_store_is_created_when_the_app_starts(tmp_path):
    target = tmp_path / "made-on-boot"
    config = ArenaConfig.from_env(store_dir=target, dev_user="coralie")
    TestClient(create_app(config))
    assert target.is_dir()


def test_a_missing_frontend_is_reported_not_fatal(tmp_path):
    """The API must work before anyone has run a frontend build."""
    app_client = client_for(tmp_path, frontend_dir=tmp_path / "no-bundle-here")
    assert app_client.get("/api/health").status_code == 200
    root = app_client.get("/")
    assert root.status_code == 503
    assert "npm run build" in root.text


def test_the_frontend_is_served_when_present(tmp_path):
    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "index.html").write_text("<!doctype html><title>arena</title>")
    served = client_for(tmp_path, frontend_dir=bundle).get("/")
    assert served.status_code == 200
    assert "arena" in served.text
```

- [ ] **Step 7: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_web_app.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.web.app'`

- [ ] **Step 8: Write the app factory**

`arena/web/app.py`:

```python
"""The FastAPI app.

One process serves the API and the built frontend, so `arena serve` is the only
command needed and the local setup is the same code path that will run in a
Space later.
"""

from fastapi import FastAPI
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from ..manifest import all_events
from ..store import LocalStore
from .config import ArenaConfig

NO_BUNDLE = (
    "The frontend has not been built yet.\n\n"
    "    cd app && npm install && npm run build\n\n"
    "The API is available meanwhile at /api/health.\n"
)


def create_app(config: ArenaConfig) -> FastAPI:
    app = FastAPI(title="Microduck Arena", docs_url="/api/docs")
    app.state.config = config
    app.state.store = LocalStore(config.ensure_store())

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "user": config.dev_user, "events": len(all_events())}

    if config.frontend_dir is None:
        @app.get("/")
        def no_frontend() -> PlainTextResponse:
            return PlainTextResponse(NO_BUNDLE, status_code=503)
    else:
        index = config.frontend_dir / "index.html"

        @app.get("/")
        def frontend_index() -> FileResponse:
            return FileResponse(index)

        # Mounted last so /api routes always win.
        app.mount("/", StaticFiles(directory=config.frontend_dir), name="frontend")

    return app
```

Note on ordering: the `StaticFiles` mount at `/` is added after every API route, and FastAPI matches routes in registration order, so `/api/*` is never shadowed. Task 2 registers its routes before this mount by calling its own `include_router` inside `create_app` — see Task 2 Step 4.

- [ ] **Step 9: Run the app test**

Run: `uv run --extra dev pytest tests/test_web_app.py -v`
Expected: PASS, 4 tests

- [ ] **Step 10: Add the `serve` subcommand**

In `arena/cli.py`, add this function next to the other `_cmd_*` functions:

```python
def _cmd_serve(args) -> int:
    import uvicorn

    from .web.app import create_app
    from .web.config import ArenaConfig

    config = ArenaConfig.from_env(store_dir=args.store, dev_user=args.user)
    config.ensure_store()
    print(f"store  {config.store_dir}")
    print(f"user   {config.dev_user}")
    if config.frontend_dir is None:
        print("frontend  NOT BUILT — run: cd app && npm install && npm run build")
    else:
        print(f"frontend  {config.frontend_dir}")
    print(f"\n  http://{args.host}:{args.port}\n")
    uvicorn.run(create_app(config), host=args.host, port=args.port, log_level="warning")
    return 0
```

`uvicorn` is imported inside the function so `arena score` and `arena board` keep working — and keep starting fast — without it.

Then register the subcommand in `main`, immediately before `args = parser.parse_args(argv)`:

```python
    serve = subs.add_parser("serve", help="run the Arena locally in a browser")
    serve.add_argument("--store", default=None, help="run log directory")
    serve.add_argument("--user", default=None, help="name to attribute submissions to")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.set_defaults(func=_cmd_serve)
```

- [ ] **Step 11: Verify the CLI wiring by hand**

Run: `uv run arena serve --help`
Expected: the help text lists `--store`, `--user`, `--host`, `--port`.

Run: `uv run arena --help`
Expected: `events`, `score`, `board` and `serve` all listed.

Then start it for real and check the API answers:

```bash
uv run arena serve --store /tmp/arena-try --user coralie &
sleep 3
curl -s localhost:8000/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/
kill %1
```

Expected: `{"ok":true,"user":"coralie","events":3}` and `503` for `/` (no bundle yet — that is correct at this point).

- [ ] **Step 12: Run the whole suite and commit**

Run: `uv run --extra dev pytest -q && uv run ruff check .`
Expected: 103 passing (93 + 10 new), ruff clean.

```bash
git add pyproject.toml uv.lock arena/web/ arena/cli.py tests/test_web_config.py tests/test_web_app.py
git commit -m "arena serve: one process, no account, no network

Config defaults to a local store and a user called local, because trying the
Arena must not require setting anything up. A missing frontend bundle reports
how to build it instead of crashing."
```

---

### Task 2: Read-only API — events and leaderboard

**Files:**
- Create: `arena/web/routes_read.py`
- Modify: `arena/web/app.py`
- Test: `tests/test_routes_read.py`

**Interfaces:**
- Consumes: `ArenaConfig`, `app.state.store`, `arena.manifest.all_events`, `arena.index.leaderboard`
- Produces:
  - `router: APIRouter` with `GET /api/events` and `GET /api/events/{event_id}/leaderboard`
  - `event_summary(manifest) -> dict` — the JSON shape the frontend renders
  - Event JSON: `{id, title, rig, length_m, slope_deg, time_limit_s, seeds, command_vx}`
  - Leaderboard JSON: `{event: <event JSON>, rows: [{rank, user, policy_name, score, seeds_finished, seeds_total, run_id, submitted_at}]}`

- [ ] **Step 1: Write the failing test**

`tests/test_routes_read.py`:

```python
import pytest
from fastapi.testclient import TestClient

from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record

import numpy as np


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def record_run(app, **overrides):
    record = make_record(**overrides)
    trace = np.zeros((5, 21), dtype=np.float32)
    app.state.store.append(record, encode(trace))
    return record


def test_events_lists_all_three(client):
    api, _ = client
    body = api.get("/api/events").json()
    assert {e["id"] for e in body["events"]} == {
        "sprint-2m",
        "roller-sprint-2m",
        "hill-climb-1m5",
    }


def test_an_event_carries_what_the_page_needs_to_describe_it(client):
    api, _ = client
    sprint = next(e for e in api.get("/api/events").json()["events"] if e["id"] == "sprint-2m")
    assert sprint["title"] == "2 m Sprint"
    assert sprint["rig"] == "legs"
    assert sprint["length_m"] == 2.0
    assert sprint["time_limit_s"] == 50.0
    assert sprint["seeds"] == 5
    assert sprint["command_vx"] == 0.25
    assert sprint["slope_deg"] == 0.0


def test_the_hill_reports_its_slope(client):
    api, _ = client
    hill = next(
        e for e in api.get("/api/events").json()["events"] if e["id"] == "hill-climb-1m5"
    )
    assert hill["slope_deg"] == 8.0


def test_an_empty_leaderboard_is_an_empty_list_not_an_error(client):
    api, _ = client
    body = api.get("/api/events/sprint-2m/leaderboard").json()
    assert body["rows"] == []
    assert body["event"]["id"] == "sprint-2m"


def test_the_leaderboard_ranks_recorded_runs(client):
    """The slower run is recorded FIRST, deliberately.

    Runs are read back in run-id order, which is insertion order, so recording
    the winner first would let a route that returned records untouched pass this
    test by accident. Recording bob first means insertion order and rank order
    disagree, and only real ranking satisfies the assertion.
    """
    api, app = client
    record_run(app, user="bob", score=25.0, seeds_finished=4)
    record_run(app, user="alice", score=18.2, seeds_finished=5)

    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert [r["user"] for r in rows] == ["alice", "bob"]
    assert [r["rank"] for r in rows] == [1, 2]
    assert rows[0]["score"] == 18.2
    assert rows[0]["seeds_finished"] == 5
    assert rows[0]["seeds_total"] == 1  # make_record ships one seed result
    assert rows[0]["run_id"]


def test_only_the_best_run_per_user_is_returned(client):
    api, app = client
    record_run(app, user="alice", score=30.0)
    record_run(app, user="alice", score=19.0)
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert len(rows) == 1
    assert rows[0]["score"] == 19.0


def test_runs_are_scoped_to_their_event(client):
    api, app = client
    record_run(app, user="alice", event_id="sprint-2m")
    record_run(app, user="bob", event_id="roller-sprint-2m")
    assert [r["user"] for r in api.get("/api/events/sprint-2m/leaderboard").json()["rows"]] == [
        "alice"
    ]
    assert [
        r["user"] for r in api.get("/api/events/roller-sprint-2m/leaderboard").json()["rows"]
    ] == ["bob"]


def test_an_unknown_event_is_a_404_with_a_reason(client):
    api, _ = client
    response = api.get("/api/events/nope/leaderboard")
    assert response.status_code == 404
    assert "no such event" in response.json()["detail"]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_routes_read.py -v`
Expected: FAIL — `/api/events` returns 404 because no such route exists yet.

- [ ] **Step 3: Write the routes**

`arena/web/routes_read.py`:

```python
"""Read-only endpoints: what events exist, and who is winning them.

These shape engine objects into the JSON the page renders. No ranking, scoring
or selection logic lives here — `arena.index.leaderboard` owns all of it, so the
web layer and the CLI can never disagree about who is first.
"""

from fastapi import APIRouter, HTTPException, Request

from ..index import leaderboard
from ..manifest import ManifestError, Manifest, all_events, load_event

router = APIRouter(prefix="/api")


def event_summary(manifest: Manifest) -> dict:
    return {
        "id": manifest.id,
        "title": manifest.title,
        "rig": manifest.rig,
        "length_m": manifest.course.length_m,
        "slope_deg": manifest.course.slope_deg,
        "time_limit_s": manifest.time_limit_s,
        "seeds": len(manifest.seeds),
        "command_vx": manifest.command[0],
    }


def _event_or_404(event_id: str) -> Manifest:
    try:
        return load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/events")
def list_events() -> dict:
    return {"events": [event_summary(m) for m in all_events()]}


@router.get("/events/{event_id}/leaderboard")
def event_leaderboard(event_id: str, request: Request) -> dict:
    manifest = _event_or_404(event_id)
    rows = leaderboard(request.app.state.store.runs(manifest.id))
    return {
        "event": event_summary(manifest),
        "rows": [
            {
                "rank": row.rank,
                "user": row.record.user,
                "policy_name": row.record.policy_name,
                "score": row.record.score,
                "seeds_finished": row.record.seeds_finished,
                "seeds_total": len(row.record.per_seed),
                "run_id": row.record.run_id,
                "submitted_at": row.record.submitted_at,
            }
            for row in rows
        ],
    }
```

- [ ] **Step 4: Wire the router into the app**

In `arena/web/app.py`, add the import at the top:

```python
from .routes_read import router as read_router
```

Then in `create_app`, immediately after the `health` endpoint and **before** the frontend block:

```python
    app.include_router(read_router)
```

The position matters: the `StaticFiles` mount at `/` is registered last, so API routes always match first.

- [ ] **Step 5: Run the test**

Run: `uv run --extra dev pytest tests/test_routes_read.py -v`
Expected: PASS, 8 tests

- [ ] **Step 6: Run the suite and commit**

Run: `uv run --extra dev pytest -q && uv run ruff check .`
Expected: 111 passing, ruff clean.

```bash
git add arena/web/routes_read.py arena/web/app.py tests/test_routes_read.py
git commit -m "Serve events and leaderboards as JSON

Shaping only — arena.index owns the ranking, so the web layer and the CLI
cannot disagree about who is first."
```

---

### Task 3: Run detail and the browser-friendly trace endpoint

The stored trace is a compressed `.npz` of float16, which a browser cannot read. This endpoint is the bridge: it decodes server-side and streams raw float32, which JavaScript reads in one line as a `Float32Array`.

**Files:**
- Modify: `arena/web/routes_read.py`
- Test: `tests/test_routes_trace.py`

**Interfaces:**
- Consumes: `arena.trace.decode`, `app.state.store`
- Produces:
  - `GET /api/runs/{run_id}` → `{run_id, event_id, user, policy_name, score, seeds_finished, per_seed: [{seed, status, time_s}], trace_seed, submitted_at, runner_version, frames}`
  - `GET /api/runs/{run_id}/trace` → `application/octet-stream`, little-endian float32, `TRACE_WIDTH` (21) values per frame, frame count = `len(bytes) / 4 / 21`
  - Response header `X-Frame-Count` on the trace response

- [ ] **Step 1: Write the failing test**

`tests/test_routes_trace.py`:

```python
import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.constants import TRACE_WIDTH
from arena.evaluate import SeedResult
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def a_trace(frames=7):
    """A trace whose every value is distinct, so a transpose or stride bug shows."""
    return np.arange(frames * TRACE_WIDTH, dtype=np.float32).reshape(frames, TRACE_WIDTH)


def test_run_detail_reports_the_per_seed_breakdown(client):
    api, app = client
    record = make_record(
        user="alice",
        per_seed=(
            SeedResult(seed=1, status="finish", time_s=18.46),
            SeedResult(seed=2, status="fall", time_s=None),
        ),
    )
    # 9, not the fixture's default: `frames` has to be derived from the stored
    # trace, and a hardcoded default would pass an assertion on the default.
    app.state.store.append(record, encode(a_trace(frames=9)))

    body = api.get(f"/api/runs/{record.run_id}").json()
    assert body["user"] == "alice"
    assert body["frames"] == 9
    assert [s["status"] for s in body["per_seed"]] == ["finish", "fall"]
    assert body["per_seed"][0]["time_s"] == 18.46
    assert body["per_seed"][1]["time_s"] is None


def test_the_trace_round_trips_as_float32(client):
    api, app = client
    record = make_record()
    original = a_trace(frames=11)
    app.state.store.append(record, encode(original))

    response = api.get(f"/api/runs/{record.run_id}/trace")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-frame-count"] == "11"

    restored = np.frombuffer(response.content, dtype="<f4").reshape(-1, TRACE_WIDTH)
    assert restored.shape == (11, TRACE_WIDTH)
    # float16 storage is lossy; these values are small integers so they survive.
    np.testing.assert_allclose(restored, original, rtol=0, atol=1e-2)


def test_the_trace_byte_length_matches_the_frame_count(client):
    api, app = client
    record = make_record()
    app.state.store.append(record, encode(a_trace(frames=13)))
    content = api.get(f"/api/runs/{record.run_id}/trace").content
    assert len(content) == 13 * TRACE_WIDTH * 4


def test_an_unknown_run_is_a_404(client):
    """Assert our message, not just the status.

    FastAPI 404s an unmapped path all by itself with `{"detail": "Not Found"}`,
    so a status-only assertion passes whether the route exists or not — it did
    exactly that before these routes were written. Only our own handler says
    "no such run", so checking the detail is what distinguishes a working route
    from a deleted one.
    """
    for path in ("/api/runs/01NOPE", "/api/runs/01NOPE/trace"):
        response = api.get(path)
        assert response.status_code == 404, path
        assert "no such run" in response.json()["detail"], path
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_routes_trace.py -v`
Expected: FAIL — both run routes 404 because they do not exist.

- [ ] **Step 3: Add the routes**

Append to `arena/web/routes_read.py`. Add these imports at the top of the file:

```python
from fastapi.responses import Response

from ..manifest import ManifestError, Manifest, all_events, load_event
from ..store import RunRecord
from ..trace import decode
```

(The `manifest` import line replaces the existing one — it is unchanged apart from being listed here for context.)

Then the routes:

```python
def _find_run(store, run_id: str) -> RunRecord:
    """Scan every event for a run id.

    Run ids are globally unique, so the id alone addresses a run and the URL
    needs no event. With one small local store, scanning is cheaper than
    maintaining an index; the deployed version gets the in-memory index instead.
    """
    for manifest in all_events():
        for record in store.runs(manifest.id):
            if record.run_id == run_id:
                return record
    raise HTTPException(status_code=404, detail=f"no such run: {run_id!r}")


@router.get("/runs/{run_id}")
def run_detail(run_id: str, request: Request) -> dict:
    store = request.app.state.store
    record = _find_run(store, run_id)
    frames = decode(store.trace(run_id)).shape[0]
    return {
        "run_id": record.run_id,
        "event_id": record.event_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "score": record.score,
        "seeds_finished": record.seeds_finished,
        "per_seed": [
            {"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in record.per_seed
        ],
        "trace_seed": record.trace_seed,
        "submitted_at": record.submitted_at,
        "runner_version": record.runner_version,
        "frames": frames,
    }


@router.get("/runs/{run_id}/trace")
def run_trace(run_id: str, request: Request) -> Response:
    """Raw little-endian float32, TRACE_WIDTH values per frame.

    The stored form is compressed float16 npz, which a browser cannot read. This
    decodes it server-side so the frontend is one `new Float32Array(buffer)` away
    from a replay — no numpy-in-JavaScript, no base64 bloat.
    """
    store = request.app.state.store
    _find_run(store, run_id)  # 404 before touching the trace file
    trace = decode(store.trace(run_id))
    payload = np.ascontiguousarray(trace, dtype="<f4").tobytes()
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={"X-Frame-Count": str(trace.shape[0]), "Cache-Control": "no-store"},
    )
```

Add `import numpy as np` to the top of the file.

- [ ] **Step 4: Run the test**

Run: `uv run --extra dev pytest tests/test_routes_trace.py -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the suite and commit**

Run: `uv run --extra dev pytest -q && uv run ruff check .`
Expected: 115 passing, ruff clean.

```bash
git add arena/web/routes_read.py tests/test_routes_trace.py
git commit -m "Stream traces as raw float32 for the browser

Stored traces are compressed float16 npz, which a browser cannot read. Decode
server-side and hand JavaScript something it can wrap in a Float32Array."
```

---

### Task 4: Submit a policy by upload

**Files:**
- Create: `arena/web/routes_submit.py`
- Modify: `arena/web/app.py`
- Test: `tests/test_routes_submit.py`

**Interfaces:**
- Consumes: `arena.policy.load_policy`/`PolicyError`/`MAX_MODEL_BYTES`, `arena.evaluate.evaluate`, `arena.store`, `ArenaConfig.dev_user`
- Produces:
  - `router: APIRouter` with `POST /api/events/{event_id}/submit`
  - Request: `multipart/form-data` with `file` (the `.onnx`) and optional `name`
  - Response 200: `{run_id, score, seeds_finished, seeds_total, per_seed: [...], trace_seed, user, policy_name}`
  - Response 400: `{detail: "<the PolicyError message>"}`
  - Response 404 for an unknown event, 413 for an oversize file

- [ ] **Step 1: Write the failing test**

`tests/test_routes_submit.py`:

```python
import pytest
from fastapi.testclient import TestClient

from arena.assets import ASSET_ROOT
from arena.policy import MAX_MODEL_BYTES
from arena.web.app import create_app
from arena.web.config import ArenaConfig

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"


@pytest.fixture
def store_dir(tmp_path):
    return tmp_path / "board"


@pytest.fixture
def api(store_dir):
    config = ArenaConfig.from_env(store_dir=store_dir, dev_user="coralie")
    return TestClient(create_app(config))


def submit(api, path=REFERENCE, event="sprint-2m", name="walker"):
    with open(path, "rb") as fh:
        return api.post(
            f"/api/events/{event}/submit",
            files={"file": (path.name if hasattr(path, "name") else "p.onnx", fh)},
            data={"name": name},
        )


def test_the_reference_policy_scores_and_is_recorded(api):
    response = submit(api)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["user"] == "coralie"
    assert body["policy_name"] == "walker"
    assert body["seeds_finished"] == 5
    assert body["seeds_total"] == 5
    assert body["score"] == pytest.approx(18.216, rel=0.02)
    assert len(body["per_seed"]) == 5
    assert body["trace_seed"] in {s["seed"] for s in body["per_seed"]}

    # It is on the board immediately — that is the whole point of submitting.
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert [r["user"] for r in rows] == ["coralie"]
    assert rows[0]["run_id"] == body["run_id"]
    # The score the submitter was told must be the score that got recorded. Without
    # this, a route that returned one number and stored another would pass.
    assert rows[0]["score"] == body["score"]
    assert rows[0]["seeds_finished"] == body["seeds_finished"]


def test_the_replay_of_a_fresh_submission_is_fetchable(api):
    run_id = submit(api).json()["run_id"]
    trace = api.get(f"/api/runs/{run_id}/trace")
    assert trace.status_code == 200
    assert int(trace.headers["x-frame-count"]) > 100


def test_a_garbage_file_is_rejected_with_its_reason(api, tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    response = submit(api, path=junk)
    assert response.status_code == 400
    assert "not a loadable ONNX model" in response.json()["detail"]


def test_an_oversize_upload_is_refused_before_anything_is_written(api, tmp_path, store_dir):
    """Named for what this can actually prove.

    An earlier name claimed the upload was refused "without being evaluated",
    which the test never checked — only the status code. The size guard does run
    before the temp write and before `load_policy`, but a status assertion cannot
    demonstrate that. What it CAN demonstrate is that no partial state is left
    behind, which is the property that would actually hurt if violated.
    """
    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    response = submit(api, path=fat)
    assert response.status_code == 413
    assert "larger than" in response.json()["detail"]
    assert list(store_dir.rglob("*.json")) == []
    assert list(store_dir.rglob("*.npz")) == []


def test_submitting_to_an_unknown_event_is_a_404(api):
    """Assert our message, not just the status.

    An unmapped path 404s on its own, so a status-only assertion passes whether
    this route exists or not — it did exactly that before the route was written.
    Only the event loader says "no such event".
    """
    response = submit(api, event="nope")
    assert response.status_code == 404
    assert "no such event" in response.json()["detail"]


def test_an_absurd_policy_name_is_truncated(api):
    """Submitter-supplied text on a shared board needs a bound."""
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("p.onnx", fh)},
            data={"name": "x" * 5000},
        )
    assert len(response.json()["policy_name"]) == 80


def test_the_policy_name_defaults_to_the_filename(api):
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("my-sprinter.onnx", fh)},
        )
    assert response.json()["policy_name"] == "my-sprinter"


def test_nothing_is_recorded_when_a_submission_is_rejected(api, tmp_path):
    """The board stays empty — and for the right reason.

    Asserting only that the board is empty passes if the submission failed for
    ANY reason, including the route not existing at all, which is how this test
    passed before the route was written. Pinning the 400 and its message first
    makes the empty board mean "rejected cleanly, recorded nothing" rather than
    "something went wrong somewhere".
    """
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"nope")
    rejected = submit(api, path=junk)
    assert rejected.status_code == 400
    assert "not a loadable ONNX model" in rejected.json()["detail"]
    assert api.get("/api/events/sprint-2m/leaderboard").json()["rows"] == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --extra dev pytest tests/test_routes_submit.py -v`
Expected: FAIL — the submit route 404s because it does not exist.

- [ ] **Step 3: Allow FastAPI's argument-default idiom past ruff**

`File(...)` and `Form(...)` as argument defaults trip flake8-bugbear's B008
(mutable default argument). It is FastAPI's documented pattern — the framework
resolves them per request through its dependency system, so nothing is shared —
and this allowlist is ruff's own recommendation for FastAPI code, not a
suppression of the check. Append to `pyproject.toml`:

```toml
[tool.ruff.lint.flake8-bugbear]
extend-immutable-calls = ["fastapi.Depends", "fastapi.File", "fastapi.Form"]
```

- [ ] **Step 4: Write the submit route**

`arena/web/routes_submit.py`:

```python
"""Accepting a policy and racing it.

The upload is written to a temporary file and handed to the same `load_policy`
the CLI uses, so a submission is validated exactly as the engine validates it and
a rejection carries the engine's own wording. Nothing is recorded unless the
evaluation completes: a rejected file leaves the board untouched.
"""

import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import trace as trace_codec
from ..evaluate import evaluate
from ..manifest import ManifestError, load_event
from ..policy import MAX_MODEL_BYTES, PolicyError, load_policy
from ..store import RunRecord, new_run_id

router = APIRouter(prefix="/api")


def _load_and_evaluate(path: Path, manifest):
    """The blocking half of a submission, in one call so it takes one thread hop."""
    policy = load_policy(path)
    return policy, evaluate(manifest, policy)


@router.post("/events/{event_id}/submit")
async def submit(
    event_id: str,
    request: Request,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
) -> dict:
    try:
        manifest = load_event(event_id)
    except ManifestError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    payload = await file.read()
    if len(payload) > MAX_MODEL_BYTES:
        # Checked before writing anything: an oversize upload should cost nothing.
        raise HTTPException(
            status_code=413,
            detail=f"model is {len(payload)} bytes, larger than the "
            f"{MAX_MODEL_BYTES} byte limit",
        )

    config = request.app.state.config
    store = request.app.state.store

    with tempfile.TemporaryDirectory() as work:
        path = Path(work) / "submitted.onnx"
        path.write_bytes(payload)
        try:
            # Offloaded to a worker thread. Both steps are CPU-bound — an ONNX
            # session load plus five simulated runs, about a second in total —
            # and this is an `async def` handler, so doing them inline would
            # block the whole event loop: a leaderboard poll or a trace fetch
            # for a replay open in another tab would stall until the race
            # finished. FastAPI only auto-threads plain `def` handlers.
            policy, result = await run_in_threadpool(_load_and_evaluate, path, manifest)
        except PolicyError as exc:
            # 400, not 500: the file is the problem, and the message is written
            # to be read by the person who uploaded it.
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Capped: this is submitter-supplied text that ends up on a shared board, and
    # nothing downstream bounds it. 80 characters is generous for a policy name.
    label = ((name or "").strip() or Path(file.filename or "policy.onnx").stem)[:80]
    record = RunRecord(
        run_id=new_run_id(),
        event_id=manifest.id,
        submitted_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        user=config.dev_user,
        policy_name=label,
        source={"kind": "upload", "filename": file.filename},
        model_sha256=policy.sha256,
        score=result.score,
        seeds_finished=result.seeds_finished,
        per_seed=result.per_seed,
        trace_seed=result.trace_seed,
        runner_version=result.runner_version,
    )
    store.append(record, trace_codec.encode(result.trace))

    return {
        "run_id": record.run_id,
        "user": record.user,
        "policy_name": record.policy_name,
        "score": record.score,
        "seeds_finished": record.seeds_finished,
        "seeds_total": len(record.per_seed),
        "per_seed": [
            {"seed": s.seed, "status": s.status, "time_s": s.time_s} for s in record.per_seed
        ],
        "trace_seed": record.trace_seed,
    }
```

Note the `submitted_at` format is `"%Y-%m-%dT%H:%M:%SZ"` — zero-padded ISO-8601 ending in `Z`. `arena/index.py` breaks a full tie by comparing this as a plain string, so an offset form like `+00:00` would sort incorrectly against `Z` values. Do not switch it to `isoformat()`.

- [ ] **Step 5: Wire the router**

In `arena/web/app.py`, add the import:

```python
from .routes_submit import router as submit_router
```

and in `create_app`, next to the existing `include_router` call and before the frontend block:

```python
    app.include_router(submit_router)
```

- [ ] **Step 6: Run the test**

Run: `uv run --extra dev pytest tests/test_routes_submit.py -v`
Expected: PASS, 8 tests. It takes a few seconds — each submission runs a real five-seed evaluation.

- [ ] **Step 7: Run the suite and commit**

Run: `uv run --extra dev pytest -q && uv run ruff check .`
Expected: 123 passing, ruff clean.

```bash
git add arena/web/routes_submit.py arena/web/app.py tests/test_routes_submit.py
git commit -m "Accept an uploaded policy and race it

Validated by the same load_policy the CLI uses, so a rejection carries the
engine's own wording. Nothing reaches the board unless the run completes."
```

---

### Task 5: Frontend scaffold, served by the app

**Files:**
- Create: `app/package.json`
- Create: `app/vite.config.js`
- Create: `app/index.html`
- Create: `app/src/main.js`
- Create: `app/src/api.js`
- Create: `app/src/format.js`
- Create: `app/src/format.test.js`
- Create: `app/.gitignore`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the REST API from Tasks 2–4
- Produces:
  - `app/dist/` — the built bundle `ArenaConfig` discovers
  - `api.js`: `getEvents()`, `getLeaderboard(eventId)`, `getRun(runId)`, `getTrace(runId) -> Float32Array`, `submitPolicy(eventId, file, name)`
  - `format.js`: `formatScore(seconds)`, `formatSeeds(finished, total)`, `formatEventLine(event)`

Vanilla ES modules, not React: this is a table and a canvas, and a framework would be the largest dependency in the project for no gain. three.js arrives in Task 7 because the replay genuinely needs it.

- [ ] **Step 1: Create the scaffold**

`app/package.json`:

```json
{
  "name": "arena-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "devDependencies": {
    "jsdom": "^25.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "three": "^0.169.0"
  }
}
```

`app/vite.config.js`:

```javascript
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  // jsdom so the rendered leaderboard table is testable, not only the pure
  // row-building rules behind it. The table IS the product surface here.
  test: { environment: "jsdom" },
  // `npm run dev` serves the UI on 5173 with hot reload and forwards the API to
  // `arena serve` on 8000, so the frontend can be iterated on without a rebuild.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
```

`app/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Microduck Arena</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`app/.gitignore`:

```
node_modules/
dist/
```

Append to the repo's root `.gitignore`:

```
app/node_modules/
app/dist/
```

- [ ] **Step 2: Write the failing format test**

`app/src/format.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { formatEventLine, formatScore, formatSeeds } from "./format.js";

describe("formatScore", () => {
  it("shows three decimals and a unit", () => {
    expect(formatScore(18.216)).toBe("18.216s");
  });

  it("pads so a column of times lines up", () => {
    expect(formatScore(9.5)).toBe("9.500s");
  });

  it("marks a policy that never finished rather than printing the cap", () => {
    // A DNF is scored at the time limit; showing "50.000s" would read as a time.
    expect(formatScore(50.0, { finished: 0 })).toBe("DNF");
  });
});

describe("formatSeeds", () => {
  it("reads as a fraction", () => {
    expect(formatSeeds(5, 5)).toBe("5/5");
    expect(formatSeeds(0, 5)).toBe("0/5");
  });
});

describe("formatEventLine", () => {
  it("describes a flat course", () => {
    expect(
      formatEventLine({ length_m: 2, rig: "legs", slope_deg: 0, command_vx: 0.25 }),
    ).toBe("2 m · legs · 0.25 m/s commanded");
  });

  it("mentions the slope only when there is one", () => {
    expect(
      formatEventLine({ length_m: 1.5, rig: "legs", slope_deg: 8, command_vx: 0.25 }),
    ).toBe("1.5 m · legs · 8° slope · 0.25 m/s commanded");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd app && npm install && npm test`
Expected: FAIL — `Failed to resolve import "./format.js"`

- [ ] **Step 4: Write the frontend modules**

`app/src/format.js`:

```javascript
// Display helpers, kept pure and separate so they are unit-testable without a
// DOM. Everything the page shows a human goes through here.

export function formatScore(seconds, { finished } = {}) {
  // A DNF is scored at the event's time limit. Printing that number would read
  // as an achieved time, so say what actually happened instead.
  if (finished === 0) return "DNF";
  return `${seconds.toFixed(3)}s`;
}

export function formatSeeds(finished, total) {
  return `${finished}/${total}`;
}

export function formatEventLine(event) {
  const parts = [`${event.length_m} m`, event.rig];
  if (event.slope_deg) parts.push(`${event.slope_deg}° slope`);
  parts.push(`${event.command_vx} m/s commanded`);
  return parts.join(" · ");
}
```

`app/src/api.js`:

```javascript
// Every call the page makes. Errors surface the server's own message, which for
// a rejected policy is the same sentence the robot's daemon would give.

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body.detail) detail = body.detail;
    } catch {
      // Non-JSON error body; the status line is the best we have.
    }
    throw new Error(detail);
  }
  return response.json();
}

export const getEvents = () => json("/api/events").then((b) => b.events);
export const getLeaderboard = (eventId) => json(`/api/events/${eventId}/leaderboard`);
export const getRun = (runId) => json(`/api/runs/${runId}`);

export async function getTrace(runId) {
  const response = await fetch(`/api/runs/${runId}/trace`);
  if (!response.ok) throw new Error(`trace ${response.status}`);
  // Raw little-endian float32 from the server, 21 values per frame.
  return new Float32Array(await response.arrayBuffer());
}

export function submitPolicy(eventId, file, name) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  return json(`/api/events/${eventId}/submit`, { method: "POST", body: form });
}
```

`app/src/main.js`:

```javascript
import { getEvents } from "./api.js";
import { formatEventLine } from "./format.js";

const root = document.querySelector("#app");

async function boot() {
  root.textContent = "loading…";
  try {
    const events = await getEvents();
    root.innerHTML = "<h1>Microduck Arena</h1>";
    const list = document.createElement("ul");
    for (const event of events) {
      const item = document.createElement("li");
      item.textContent = `${event.title} — ${formatEventLine(event)}`;
      list.append(item);
    }
    root.append(list);
  } catch (error) {
    root.textContent = `could not reach the API: ${error.message}`;
  }
}

boot();
```

- [ ] **Step 5: Run the test and build**

Run: `cd app && npm test`
Expected: PASS, 6 tests.

Run: `cd app && npm run build`
Expected: `dist/index.html` and a hashed JS bundle written.

- [ ] **Step 6: Verify the app serves the bundle**

Run:
```bash
uv run arena serve --store /tmp/arena-try &
sleep 3
curl -s localhost:8000/ | head -c 200
curl -s -o /dev/null -w 'index=%{http_code}\n' localhost:8000/
kill %1
```
Expected: HTML containing `Microduck Arena`, status `200` (no longer 503 — the bundle now exists).

- [ ] **Step 7: Commit**

```bash
git add app/ .gitignore
git commit -m "Frontend scaffold: Vite, no framework

A table and a canvas do not need React; three.js arrives with the replay,
which genuinely needs it. Display helpers are pure so they are testable
without a DOM."
```

---

### Task 6: The leaderboard page

**Files:**
- Create: `app/src/board.js`
- Create: `app/src/board.test.js`
- Modify: `app/src/main.js`
- Create: `app/src/style.css`
- Modify: `app/index.html`

**Interfaces:**
- Consumes: `api.js`, `format.js`
- Produces:
  - `renderBoard(container, { event, rows }, { onSelectionChange }) -> void`
  - `selectedRunIds(container) -> string[]` — which lanes are ticked
  - `buildRows(rows) -> Array<{rank, user, policy, score, seeds, runId, dnf}>` — pure, testable

- [ ] **Step 1: Write the failing test**

`app/src/board.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { buildRows, DEFAULT_LANES, renderBoard } from "./board.js";

const row = (over = {}) => ({
  rank: 1,
  user: "alice",
  policy_name: "walker",
  score: 18.216,
  seeds_finished: 5,
  seeds_total: 5,
  run_id: "01AAA",
  submitted_at: "2026-09-03T10:00:00Z",
  ...over,
});

describe("buildRows", () => {
  it("carries the display strings the table needs", () => {
    const [built] = buildRows([row()]);
    expect(built.rank).toBe(1);
    expect(built.user).toBe("alice");
    expect(built.policy).toBe("walker");
    expect(built.score).toBe("18.216s");
    expect(built.seeds).toBe("5/5");
    expect(built.runId).toBe("01AAA");
    expect(built.dnf).toBe(false);
  });

  it("marks a row that never finished", () => {
    const [built] = buildRows([row({ score: 50, seeds_finished: 0 })]);
    expect(built.score).toBe("DNF");
    expect(built.dnf).toBe(true);
  });

  it("preselects the podium and nothing beyond it", () => {
    const rows = buildRows(
      [1, 2, 3, 4, 5].map((n) => row({ rank: n, run_id: `run-${n}`, user: `u${n}` })),
    );
    expect(rows.filter((r) => r.selected).map((r) => r.runId)).toEqual([
      "run-1",
      "run-2",
      "run-3",
    ]);
    expect(DEFAULT_LANES).toBe(3);
  });

  it("preselects everyone when the board is smaller than the podium", () => {
    const rows = buildRows([row({ rank: 1, run_id: "a" }), row({ rank: 2, run_id: "b" })]);
    expect(rows.every((r) => r.selected)).toBe(true);
  });

  it("does not preselect a DNF into a racing lane", () => {
    // A lane showing a duck that never finished is a confusing default.
    const rows = buildRows([
      row({ rank: 1, run_id: "a" }),
      row({ rank: 2, run_id: "b", score: 50, seeds_finished: 0 }),
    ]);
    expect(rows.find((r) => r.runId === "b").selected).toBe(false);
  });

  it("returns an empty list for an empty board", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("renderBoard", () => {
  const event = { id: "sprint-2m", title: "2 m Sprint" };

  function render(rows) {
    const container = document.createElement("div");
    renderBoard(container, { event, rows }, {});
    return container;
  }

  it("draws one row per entry", () => {
    const container = render([row({ rank: 1, run_id: "a" }), row({ rank: 2, run_id: "b" })]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("ticks the lane box for a preselected row and not for a DNF", () => {
    const container = render([
      row({ rank: 1, run_id: "a" }),
      row({ rank: 2, run_id: "b", score: 50, seeds_finished: 0 }),
    ]);
    const boxes = [...container.querySelectorAll("input[type=checkbox]")];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(boxes.map((b) => b.dataset.runId)).toEqual(["a", "b"]);
  });

  it("marks a DNF row so it can be dimmed", () => {
    const container = render([row({ score: 50, seeds_finished: 0 })]);
    expect(container.querySelector("tbody tr").classList.contains("dnf")).toBe(true);
  });

  it("shows the time and seeds in the row", () => {
    const text = render([row()]).querySelector("tbody tr").textContent;
    expect(text).toContain("18.216s");
    expect(text).toContain("5/5");
    expect(text).toContain("alice");
  });

  it("says why an empty board is empty, naming the event", () => {
    const container = render([]);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".empty").textContent).toContain("2 m Sprint");
  });

  it("reports the ticked run ids when a lane box is toggled", () => {
    const container = document.createElement("div");
    const seen = [];
    renderBoard(
      container,
      { event, rows: [row({ rank: 1, run_id: "a" }), row({ rank: 2, run_id: "b" })] },
      { onSelectionChange: (ids) => seen.push(ids) },
    );
    const [, second] = container.querySelectorAll("input[type=checkbox]");
    second.checked = false;
    second.dispatchEvent(new Event("change"));
    expect(seen).toEqual([["a"]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `Failed to resolve import "./board.js"`

- [ ] **Step 3: Write the board module**

`app/src/board.js`:

```javascript
// The leaderboard table, and which runs are queued into replay lanes.
//
// buildRows is pure so the selection rules are testable: the podium is
// preselected, but a DNF never is, because a lane showing a duck that never
// finished reads as a bug rather than a result.

import { formatScore, formatSeeds } from "./format.js";

export const DEFAULT_LANES = 3;

export function buildRows(rows) {
  let lanes = 0;
  return rows.map((row) => {
    const dnf = row.seeds_finished === 0;
    const selected = !dnf && lanes < DEFAULT_LANES;
    if (selected) lanes += 1;
    return {
      rank: row.rank,
      user: row.user,
      policy: row.policy_name,
      score: formatScore(row.score, { finished: row.seeds_finished }),
      seeds: formatSeeds(row.seeds_finished, row.seeds_total),
      runId: row.run_id,
      dnf,
      selected,
    };
  });
}

export function renderBoard(container, { event, rows }, { onSelectionChange } = {}) {
  const built = buildRows(rows);
  container.innerHTML = "";

  if (built.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `No runs yet on ${event.title}. Submit a policy to open the board.`;
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "board";
  table.innerHTML =
    "<thead><tr><th>lane</th><th>#</th><th>who</th><th>policy</th>" +
    "<th class='num'>time</th><th class='num'>seeds</th></tr></thead>";
  const body = document.createElement("tbody");

  for (const row of built) {
    const tr = document.createElement("tr");
    if (row.dnf) tr.classList.add("dnf");

    const lane = document.createElement("input");
    lane.type = "checkbox";
    lane.checked = row.selected;
    lane.dataset.runId = row.runId;
    lane.addEventListener("change", () => onSelectionChange?.(selectedRunIds(container)));

    const cell = (text, className) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    };

    const laneCell = document.createElement("td");
    laneCell.append(lane);
    tr.append(
      laneCell,
      cell(row.rank),
      cell(row.user),
      cell(row.policy),
      cell(row.score, "num"),
      cell(row.seeds, "num"),
    );
    body.append(tr);
  }

  table.append(body);
  container.append(table);
}

export function selectedRunIds(container) {
  return [...container.querySelectorAll("input[type=checkbox]:checked")].map(
    (box) => box.dataset.runId,
  );
}
```

`app/src/style.css`:

```css
:root {
  color-scheme: light dark;
  --ink: #1a1a1a;
  --dim: #6b6b6b;
  --line: #d8d8d8;
  --ground: #fbfbf9;
  --accent: #e8b400;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #ececec;
    --dim: #9a9a9a;
    --line: #333;
    --ground: #151515;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
}
#app { max-width: 1000px; margin: 0 auto; padding: 24px 20px 64px; }
h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
.tagline { color: var(--dim); margin: 0 0 24px; }
.events { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.events button {
  font: inherit; padding: 6px 12px; cursor: pointer;
  background: transparent; color: var(--ink);
  border: 1px solid var(--line); border-radius: 999px;
}
.events button[aria-current="true"] { border-color: var(--accent); background: var(--accent); color: #1a1a1a; }
.event-line { color: var(--dim); margin: 0 0 16px; }
table.board { width: 100%; border-collapse: collapse; }
table.board th, table.board td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
table.board th { font-weight: 600; color: var(--dim); font-size: 13px; }
table.board .num { text-align: right; font-variant-numeric: tabular-nums; }
table.board tr.dnf { color: var(--dim); }
.empty { color: var(--dim); }
```

Add the stylesheet to `app/index.html`, in `<head>` after the `<title>`:

```html
    <link rel="stylesheet" href="/src/style.css" />
```

- [ ] **Step 4: Wire the page together**

Replace `app/src/main.js` entirely:

```javascript
import { getEvents, getLeaderboard } from "./api.js";
import { renderBoard } from "./board.js";
import { formatEventLine } from "./format.js";

const root = document.querySelector("#app");

const state = { events: [], current: null };

function shell() {
  root.innerHTML = `
    <h1>Microduck Arena</h1>
    <p class="tagline">Race a policy. The clock is ours, not your browser's.</p>
    <nav class="events" id="events"></nav>
    <p class="event-line" id="event-line"></p>
    <div id="board"></div>
  `;
}

function renderEventTabs() {
  const nav = document.querySelector("#events");
  nav.innerHTML = "";
  for (const event of state.events) {
    const button = document.createElement("button");
    button.textContent = event.title;
    button.setAttribute("aria-current", String(event.id === state.current));
    button.addEventListener("click", () => selectEvent(event.id));
    nav.append(button);
  }
}

async function selectEvent(eventId) {
  state.current = eventId;
  renderEventTabs();
  const event = state.events.find((e) => e.id === eventId);
  document.querySelector("#event-line").textContent = formatEventLine(event);
  const board = document.querySelector("#board");
  board.textContent = "loading…";
  try {
    const data = await getLeaderboard(eventId);
    // Drop a response that arrived after the user moved on. Without this, a
    // slow fetch for event A can resolve once B is already selected and paint
    // A's rows under B's heading — wrong data under a correct-looking title,
    // which is worse than a visible error.
    if (state.current !== eventId) return;
    renderBoard(board, data, {});
  } catch (error) {
    if (state.current === eventId) {
      board.textContent = `could not load the board: ${error.message}`;
    }
  }
}

async function boot() {
  shell();
  try {
    state.events = await getEvents();
    await selectEvent(state.events[0].id);
  } catch (error) {
    root.textContent = `could not reach the API: ${error.message}`;
  }
}

boot();
```

- [ ] **Step 5: Run the tests and build**

Run: `cd app && npm test && npm run build`
Expected: 18 tests pass (6 format + 6 buildRows + 6 renderBoard); build succeeds.

- [ ] **Step 6: Look at it**

Populate a store and open the page:

```bash
REF=arena/assets/policies/BEST_alpha_walking.onnx
uv run arena score $REF --event sprint-2m --user alice --name walker --store /tmp/arena-try
uv run arena score $REF --event sprint-2m --user bob --name challenger --store /tmp/arena-try
uv run arena serve --store /tmp/arena-try
```

Open `http://127.0.0.1:8000`. Expected: three event tabs, the sprint selected, and alice and bob both at `18.216s 5/5` (same policy, so they tie and the tie breaks on earliest submission). If you have a non-walking policy to hand, submit it too and confirm it shows as `DNF` and dimmed. Take a screenshot for the report.

- [ ] **Step 7: Commit**

```bash
git add app/src/board.js app/src/board.test.js app/src/main.js app/src/style.css app/index.html
git commit -m "The leaderboard page

A DNF shows as DNF rather than the time limit it was scored at, and is never
preselected into a replay lane — a lane showing a duck that never finished
reads as a bug, not a result."
```

---

### Task 7: Vendored browser assets and the three.js rig

**Files:**
- Modify: `scripts/vendor_assets.sh`
- Create: `app/public/robot/kinematics.json` (vendored)
- Create: `app/public/robot/microduck.glb` (vendored)
- Create: `app/src/rig.js`
- Create: `app/src/rig.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `JOINT_NAMES` — the 14 names, in engine order
  - `buildRigTree(kinematics) -> { root, bodies: Map, joints: Map }` — the pose-able skeleton, no meshes
  - `setJoint(rig, name, angle)` — clamped to the joint's MJCF range
  - `loadKinematics(url)`, `attachMeshes(rig, kinematics, glbScene, { color })`
  - `MODEL_DIR = "/robot"`

**The conversion rules this file exists to get right:**
- MJCF quaternion `(w,x,y,z)` → three.js `(x,y,z,w)`: `q.set(m[1], m[2], m[3], m[0])`
- MJCF Z-up → three.js Y-up: one root group with `rotation.x = -Math.PI/2`
- A joint is a local rotation about its own axis, applied *after* the body's rest orientation: `quaternion = baseQuat * axisAngle(axis, angle)`

- [ ] **Step 1: Extend the vendoring script**

In `scripts/vendor_assets.sh`, after the existing `cp` lines and before the `cat > "$DEST/PROVENANCE.md"` block, add:

```bash
# Browser-side rig assets: the kinematic tree and one GLB holding every mesh,
# named exactly as kinematics.json's geom.mesh values.
mkdir -p app/public/robot
cp "$MJLAB/kinematics.json" app/public/robot/
cp "$MJLAB/microduck.glb"   app/public/robot/
```

And add a line to the generated `PROVENANCE.md` body, inside the heredoc after the table:

```
Browser rig assets (\`app/public/robot/kinematics.json\`, \`microduck.glb\`) come from the
same commit. The GLB's mesh names match \`kinematics.json\`'s \`geom.mesh\` values.
```

- [ ] **Step 2: Vendor them**

Run:
```bash
./scripts/vendor_assets.sh ../microduck-simulator
ls -la app/public/robot/
```
Expected: `kinematics.json` (~27 KB) and `microduck.glb` (~1.3 MB).

- [ ] **Step 3: Write the failing test**

`app/src/rig.test.js`:

```javascript
// three.js maths and Object3D work headless, so the rig's tree structure and
// pose maths are unit-testable without a browser or a canvas.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { JOINT_NAMES, attachMeshes, buildRigTree, setJoint } from "./rig.js";

const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));

describe("the vendored kinematics", () => {
  it("declares the 14 actuated joints in the engine's order", () => {
    expect(kinematics.actuated_joints).toEqual(JOINT_NAMES);
  });
});

describe("buildRigTree", () => {
  it("reparents every body onto its declared parent", () => {
    const rig = buildRigTree(kinematics);
    for (const body of kinematics.bodies) {
      const group = rig.bodies.get(body.name);
      expect(group).toBeDefined();
      if (body.parent) expect(group.parent.name).toBe(body.parent);
    }
  });

  it("puts the root under a Z-up to Y-up correction", () => {
    const rig = buildRigTree(kinematics);
    // MJCF is Z-up, three.js is Y-up. Exactly one place compensates.
    expect(rig.root.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("converts MJCF (w,x,y,z) quaternions to three.js (x,y,z,w)", () => {
    const rig = buildRigTree(kinematics);
    const declared = kinematics.bodies.find((b) => b.quat.some((v) => v !== 0 && v !== 1));
    const group = rig.bodies.get(declared.name);
    expect(group.quaternion.w).toBeCloseTo(declared.quat[0], 12);
    expect(group.quaternion.x).toBeCloseTo(declared.quat[1], 12);
    expect(group.quaternion.y).toBeCloseTo(declared.quat[2], 12);
    expect(group.quaternion.z).toBeCloseTo(declared.quat[3], 12);
  });

  it("registers every actuated joint as pose-able", () => {
    const rig = buildRigTree(kinematics);
    for (const name of JOINT_NAMES) expect(rig.joints.has(name)).toBe(true);
  });
});

describe("setJoint", () => {
  it("rotates about the joint axis, on top of the body's rest orientation", () => {
    const rig = buildRigTree(kinematics);
    const joint = rig.joints.get("left_knee");
    const expected = joint.baseQuat
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(joint.axis, 0.3));

    setJoint(rig, "left_knee", 0.3);
    expect(joint.body.quaternion.angleTo(expected)).toBeCloseTo(0, 12);
  });

  it("leaves the body at its rest orientation for a zero angle", () => {
    const rig = buildRigTree(kinematics);
    const joint = rig.joints.get("left_knee");
    setJoint(rig, "left_knee", 0);
    expect(joint.body.quaternion.angleTo(joint.baseQuat)).toBeCloseTo(0, 12);
  });

  it("clamps to the MJCF range instead of bending through the shell", () => {
    const rig = buildRigTree(kinematics);
    const joint = rig.joints.get("left_knee");
    const [low, high] = joint.range;

    setJoint(rig, "left_knee", high + 5);
    const clampedHigh = joint.body.quaternion.clone();
    setJoint(rig, "left_knee", high);
    expect(clampedHigh.angleTo(joint.body.quaternion)).toBeCloseTo(0, 12);

    setJoint(rig, "left_knee", low - 5);
    const clampedLow = joint.body.quaternion.clone();
    setJoint(rig, "left_knee", low);
    expect(clampedLow.angleTo(joint.body.quaternion)).toBeCloseTo(0, 12);
  });

  it("ignores an unknown joint rather than throwing", () => {
    const rig = buildRigTree(kinematics);
    expect(() => setJoint(rig, "tail_wag", 1)).not.toThrow();
  });

  it("normalises the joint axis", () => {
    const rig = buildRigTree(kinematics);
    for (const name of JOINT_NAMES) {
      expect(rig.joints.get(name).axis.length()).toBeCloseTo(1, 12);
    }
  });
});

describe("attachMeshes against the real GLB", () => {
  // Nothing else in this file exercises attachMeshes, which is how a lookup that
  // resolved zero meshes shipped once already. These tests load the actual
  // vendored asset so the naming premise cannot drift unnoticed.
  const glb = readFileSync("public/robot/microduck.glb");

  // Two things GLTFLoader.parse needs that are easy to get wrong under
  // vitest's jsdom environment, verified against the real loader before
  // writing this:
  //  1. onLoad fires through an internal Promise chain (a microtask), even for
  //     a self-contained GLB with no external URIs — never synchronously in
  //     this call stack. So this waits on a Promise, not a variable set by the
  //     callback moments later.
  //  2. GLTFLoader checks `data instanceof ArrayBuffer` against jsdom's realm.
  //     Node's fs.readFileSync gives back a Buffer backed by a *Node-realm*
  //     ArrayBuffer, which fails that check under jsdom and silently falls
  //     through to "treat data as already-parsed JSON" — surfacing as
  //     "Unsupported asset. glTF versions >=2.0 are supported." with no hint
  //     that the bytes were fine. Copying into a same-realm ArrayBuffer (one
  //     built with jsdom's global constructor) fixes it without touching the
  //     real file or the real loader.
  function loadedScene() {
    const buf = new ArrayBuffer(glb.byteLength);
    new Uint8Array(buf).set(glb);
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buf, "", (gltf) => resolve(gltf.scene), reject);
    });
  }

  it("resolves every mesh the kinematics reference", async () => {
    const scene = await loadedScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);

    const wanted = kinematics.bodies.flatMap((b) =>
      (b.geoms ?? []).filter((g) => !g.type || g.type === "mesh").map((g) => g.mesh),
    );
    let attached = 0;
    rig.root.traverse((n) => {
      if (n.isMesh) attached += 1;
    });
    expect(wanted.length).toBeGreaterThan(0);
    expect(attached).toBe(wanted.length);
  });

  it("proves the naming premise this lookup depends on", async () => {
    // GLTFLoader strips dots from node names, so the kinematics' "leg.stl" is
    // node.name "legstl". If a future exporter stops doing that, this test
    // changes and the fallback chain can be revisited — deliberately, not by
    // discovering a blank duck.
    const scene = await loadedScene();
    const names = [];
    scene.traverse((n) => {
      if (n.isMesh) names.push({ name: n.name, meshFile: n.userData?.meshFile });
    });
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.name.includes("."))).toBe(false);
    expect(names.every((n) => typeof n.meshFile === "string" && n.meshFile.endsWith(".stl"))).toBe(
      true,
    );
  });

  it("assembles to a duck-sized object in metres", async () => {
    const scene = await loadedScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);
    rig.placer.updateMatrixWorld(true);

    const size = new Box3().setFromObject(rig.placer).getSize(new Vector3());
    // A Microduck is roughly 12 cm tall. Anything near 100+ would mean the
    // meshes are in millimetres and everything downstream is 1000x off.
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.0);
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.05);
  });
});

describe("the rig is posed in metres", () => {
  it("keeps the trunk within a duck-sized box of its own origin", () => {
    const rig = buildRigTree(kinematics);
    // Catches a millimetre/metre mix-up in the vendored kinematics: a duck is
    // about 12 cm tall, so anything past half a metre means wrong units.
    expect(rig.bodies.get("trunk_base").position.length()).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `Failed to resolve import "./rig.js"`

- [ ] **Step 5: Write the rig**

`app/src/rig.js`:

```javascript
// kinematics.json -> a pose-able three.js tree.
//
// A reduced port of the sandbox's app/src/game/duck.js, keeping only what a
// replay needs: one Group per body, joints as local rotations, meshes from the
// shared GLB. Deliberately left out: the jaw pivot, colour specs, comic-ink
// outlines, and the STL fallback path — none of them matter for watching a
// recorded race, and each would be a thing to keep in sync.
//
// Three conversions have to be exactly right, because getting them wrong yields
// a duck that looks plausible and is subtly wrong:
//   1. MJCF quaternions are (w,x,y,z); three.js is (x,y,z,w).
//   2. MJCF is Z-up; three.js is Y-up. One root group compensates.
//   3. A joint rotates about its own axis on top of the body's rest orientation.

import { Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";

export const MODEL_DIR = "/robot";

// Must match arena.constants.JOINT_NAMES, and therefore trace columns 7..21.
export const JOINT_NAMES = [
  "left_hip_yaw",
  "left_hip_roll",
  "left_hip_pitch",
  "left_knee",
  "left_ankle",
  "neck_pitch",
  "head_pitch",
  "head_yaw",
  "head_roll",
  "right_hip_yaw",
  "right_hip_roll",
  "right_hip_pitch",
  "right_knee",
  "right_ankle",
];

/** MJCF (w,x,y,z) -> three.js (x,y,z,w). */
function setMjcfQuat(target, q) {
  target.set(q[1], q[2], q[3], q[0]);
}

export async function loadKinematics(url = `${MODEL_DIR}/kinematics.json`) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`kinematics fetch ${response.status}`);
  return response.json();
}

export function buildRigTree(kinematics) {
  // placer carries world placement (position along the lane); root carries the
  // Z-up -> Y-up correction, so lane placement never has to think about axes.
  const placer = new Group();
  placer.name = "duck_placer";
  const root = new Group();
  root.name = "duck_root";
  root.rotation.x = -Math.PI / 2;
  placer.add(root);

  const bodies = new Map();
  for (const body of kinematics.bodies) {
    const group = new Group();
    group.name = body.name;
    group.position.set(body.pos[0], body.pos[1], body.pos[2]);
    setMjcfQuat(group.quaternion, body.quat);
    bodies.set(body.name, group);
  }

  for (const body of kinematics.bodies) {
    const group = bodies.get(body.name);
    if (body.parent && bodies.has(body.parent)) bodies.get(body.parent).add(group);
    else root.add(group);
  }

  const joints = new Map();
  for (const body of kinematics.bodies) {
    const joint = body.joint;
    if (!joint || (joint.type && joint.type !== "hinge")) continue;
    joints.set(joint.name, {
      body: bodies.get(body.name),
      axis: new Vector3(...joint.axis).normalize(),
      // The rest orientation. A joint angle multiplies onto this rather than
      // replacing it, or every limb would snap to the axis frame.
      baseQuat: bodies.get(body.name).quaternion.clone(),
      range: joint.range ?? null,
    });
  }

  return { placer, root, bodies, joints };
}

const _rotation = new Quaternion();

export function setJoint(rig, name, angle) {
  const joint = rig.joints.get(name);
  if (!joint) return;
  let value = angle;
  if (joint.range) value = Math.min(joint.range[1], Math.max(joint.range[0], value));
  _rotation.setFromAxisAngle(joint.axis, value);
  joint.body.quaternion.copy(joint.baseQuat).multiply(_rotation);
}

/**
 * Hang the GLB's geometry off the rig. `glbScene` is a loaded GLTF scene whose
 * mesh names are the same strings as kinematics `geom.mesh` (e.g. "leg.stl").
 */
export function attachMeshes(rig, kinematics, glbScene, { color } = {}) {
  // Key by userData.meshFile FIRST. The GLB stores the true filename there as a
  // glTF extra, because GLTFLoader strips dots when it builds node names:
  // "leg.stl" in the file becomes node.name "legstl" in the scene. The
  // kinematics keep the dot, so matching on node.name alone resolves NOTHING —
  // and a geom whose mesh is not found is skipped silently, so the failure is an
  // invisible duck with a clean console rather than an error.
  //
  // The reference implementation (microduck-simulator app/src/game/duck.js:62)
  // has this exact fallback chain for this exact reason. Do not "simplify" it.
  const geometryByName = new Map();
  glbScene.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    for (const key of [node.userData?.meshFile, node.name, node.geometry.name]) {
      if (key && !geometryByName.has(key)) geometryByName.set(key, node.geometry);
    }
  });

  for (const body of kinematics.bodies) {
    const group = rig.bodies.get(body.name);
    for (const geom of body.geoms ?? []) {
      if (geom.type && geom.type !== "mesh") continue;
      const geometry = geometryByName.get(geom.mesh);
      if (!geometry) continue;
      const material = new MeshStandardMaterial({
        color: color ?? (geom.color ? rgbToHex(geom.color) : 0xdddddd),
        roughness: 0.65,
        metalness: 0.05,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
      if (geom.quat) setMjcfQuat(mesh.quaternion, geom.quat);
      group.add(mesh);
    }
  }
}

function rgbToHex([r, g, b]) {
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
```

- [ ] **Step 6: Run the test**

Run: `cd app && npm test`
Expected: PASS, 32 tests (18 prior + 14 new).

If `test_the_vendored_kinematics` fails on the joint order, the vendored `kinematics.json` disagrees with `arena/constants.py` — stop and report it rather than editing `JOINT_NAMES`, because the trace column order depends on that agreement.

- [ ] **Step 7: Commit**

```bash
git add scripts/vendor_assets.sh app/public/robot/ app/src/rig.js app/src/rig.test.js
git commit -m "Build the duck's skeleton in the browser from kinematics.json

A reduced port of the sandbox's rig: bodies, joints, meshes, nothing else.
The three conversions that matter (quaternion order, Z-up to Y-up, joint on
top of rest orientation) each have a test, because getting one wrong yields a
duck that looks plausible and is subtly wrong."
```

---

### Task 8: The replay viewer and head-to-head lanes

**Files:**
- Create: `app/src/replay.js`
- Create: `app/src/replay.test.js`
- Create: `app/src/viewer.js`
- Modify: `app/src/main.js`
- Modify: `app/src/style.css`

**Interfaces:**
- Consumes: `rig.js`, `api.js`, `board.js`
- Produces:
  - `TRACE_WIDTH = 21`, `CTRL_DT = 0.02`
  - `frameCount(trace) -> number`
  - `frameAt(trace, index) -> Float32Array` (a 21-value view, no copy)
  - `applyFrame(rig, frame)` — trunk position + orientation + 14 joints
  - `Player(traces, { onTick })` with `play()`, `pause()`, `seek(t)`, `duration`
  - `createViewer(canvas) -> { setLanes(entries), dispose() }` where an entry is `{runId, trace, label, color}`

- [ ] **Step 1: Write the failing test**

`app/src/replay.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JOINT_NAMES, buildRigTree } from "./rig.js";
import { CTRL_DT, Player, TRACE_WIDTH, applyFrame, frameAt, frameCount } from "./replay.js";

const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));

function traceOf(frames) {
  const data = new Float32Array(frames * TRACE_WIDTH);
  for (let f = 0; f < frames; f++) {
    const at = f * TRACE_WIDTH;
    data[at + 0] = f * 0.1; // x
    data[at + 1] = 0;
    data[at + 2] = 0.12; // z, MJCF up
    data[at + 3] = 1; // quaternion w — upright
    data[at + 7] = 0.05 * f; // first joint angle
  }
  return data;
}

describe("trace geometry", () => {
  it("is 21 values per frame at 50 Hz", () => {
    expect(TRACE_WIDTH).toBe(21);
    expect(CTRL_DT).toBeCloseTo(0.02, 12);
  });

  it("counts frames from the buffer length", () => {
    expect(frameCount(traceOf(9))).toBe(9);
  });

  it("views a frame without copying", () => {
    const trace = traceOf(4);
    const frame = frameAt(trace, 2);
    expect(frame.length).toBe(TRACE_WIDTH);
    expect(frame[0]).toBeCloseTo(0.2, 6);
    expect(frame.buffer).toBe(trace.buffer);
  });
});

describe("applyFrame", () => {
  it("places the trunk from the first three values", () => {
    const rig = buildRigTree(kinematics);
    applyFrame(rig, frameAt(traceOf(3), 1));
    const trunk = rig.bodies.get("trunk_base");
    expect(trunk.position.x).toBeCloseTo(0.1, 6);
    expect(trunk.position.z).toBeCloseTo(0.12, 6);
  });

  it("reads the trunk quaternion in MJCF order", () => {
    const rig = buildRigTree(kinematics);
    const frame = frameAt(traceOf(1), 0);
    // A quarter turn about MJCF z: (w, x, y, z) = (cos45, 0, 0, sin45).
    frame[3] = Math.SQRT1_2;
    frame[4] = 0;
    frame[5] = 0;
    frame[6] = Math.SQRT1_2;
    applyFrame(rig, frame);

    // Component-wise, NOT via angleTo. The trace is float32, so each component
    // carries ~1.2e-8 of truncation, and angleTo's acos has infinite slope at 1
    // — it turns that into a ~3.7e-4 rad angle, which no tight tolerance can
    // survive. Comparing components is both achievable and stricter about the
    // thing under test: a permuted order moves SQRT1_2 to the wrong axis.
    const trunk = rig.bodies.get("trunk_base");
    expect(trunk.quaternion.x).toBeCloseTo(0, 6);
    expect(trunk.quaternion.y).toBeCloseTo(0, 6);
    expect(trunk.quaternion.z).toBeCloseTo(Math.SQRT1_2, 6);
    expect(trunk.quaternion.w).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("drives all 14 joints from columns 7 onward", () => {
    const rig = buildRigTree(kinematics);
    const frame = frameAt(traceOf(1), 0);
    JOINT_NAMES.forEach((_, i) => {
      frame[7 + i] = 0.1;
    });
    applyFrame(rig, frame);

    for (const name of JOINT_NAMES) {
      const joint = rig.joints.get(name);
      // 0.1 rad is inside every joint's range, so nothing is clamped away.
      expect(joint.body.quaternion.angleTo(joint.baseQuat)).toBeGreaterThan(1e-6);
    }
  });
});

describe("Player", () => {
  it("runs as long as its longest trace", () => {
    const player = new Player([traceOf(50), traceOf(120)]);
    expect(player.duration).toBeCloseTo(120 * CTRL_DT, 9);
  });

  it("reports a frame index per lane for a given time", () => {
    const player = new Player([traceOf(50), traceOf(120)]);
    expect(player.frameIndices(0)).toEqual([0, 0]);
    // 0.5 s is inside both lanes, so neither is clamped: floor(0.5 / 0.02) = 25.
    expect(player.frameIndices(0.5)).toEqual([25, 25]);
  });

  it("holds a finished lane on its last frame instead of looping it", () => {
    // The fast duck should stay at the line while the slow one comes in —
    // that is what makes a head-to-head replay readable.
    const player = new Player([traceOf(50), traceOf(120)]);
    expect(player.frameIndices(2.0)).toEqual([49, 100]);
  });

  it("clamps a seek to the timeline", () => {
    const player = new Player([traceOf(50)]);
    player.seek(-5);
    expect(player.time).toBe(0);
    player.seek(999);
    expect(player.time).toBeCloseTo(player.duration, 9);
  });

  it("has a zero duration and no frames for no lanes", () => {
    const player = new Player([]);
    expect(player.duration).toBe(0);
    expect(player.frameIndices(0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `Failed to resolve import "./replay.js"`

- [ ] **Step 3: Write the replay module**

`app/src/replay.js`:

```javascript
// A stored trace, played back through a rig.
//
// The trace is exactly what the server simulated: 21 float32 per frame at
// 50 Hz — trunk position(3), trunk quaternion(4, MJCF w,x,y,z), joint angles(14
// in JOINT_NAMES order). No physics runs here; this is a recording.

import { JOINT_NAMES, setJoint } from "./rig.js";

export const TRACE_WIDTH = 21;
export const CTRL_DT = 0.02; // matches arena.constants.CTRL_DT

export function frameCount(trace) {
  return Math.floor(trace.length / TRACE_WIDTH);
}

/** A view onto one frame — no copy, so this is cheap inside a render loop. */
export function frameAt(trace, index) {
  const start = index * TRACE_WIDTH;
  return trace.subarray(start, start + TRACE_WIDTH);
}

export function applyFrame(rig, frame) {
  const trunk = rig.bodies.get("trunk_base");
  trunk.position.set(frame[0], frame[1], frame[2]);
  // MJCF (w,x,y,z) at columns 3..7 -> three.js (x,y,z,w).
  trunk.quaternion.set(frame[4], frame[5], frame[6], frame[3]);
  for (let j = 0; j < JOINT_NAMES.length; j++) setJoint(rig, JOINT_NAMES[j], frame[7 + j]);
}

export class Player {
  constructor(traces, { onTick } = {}) {
    this.traces = traces;
    this.counts = traces.map(frameCount);
    this.duration = this.counts.length ? Math.max(...this.counts) * CTRL_DT : 0;
    this.time = 0;
    this.playing = false;
    this.onTick = onTick;
    this._last = null;
  }

  /**
   * The frame each lane should show at `t`.
   *
   * A lane that has run out holds its final frame rather than looping: in a
   * head-to-head the winner should wait at the line while the others finish,
   * which is what makes the result legible.
   */
  frameIndices(t = this.time) {
    return this.counts.map((count) =>
      count === 0 ? 0 : Math.min(count - 1, Math.floor(t / CTRL_DT)),
    );
  }

  seek(t) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.onTick?.(this.time);
  }

  play() {
    this.playing = true;
    this._last = null;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  /** Advance by wall-clock milliseconds; call once per animation frame. */
  advance(nowMs) {
    if (!this.playing) {
      this._last = nowMs;
      return;
    }
    if (this._last === null) {
      this._last = nowMs;
      return;
    }
    const dt = (nowMs - this._last) / 1000;
    this._last = nowMs;
    let next = this.time + dt;
    if (next >= this.duration) {
      next = 0; // loop the race, so it can be watched repeatedly
      this._last = nowMs;
    }
    this.time = next;
    this.onTick?.(this.time);
  }
}
```

- [ ] **Step 4: Run the replay test**

Run: `cd app && npm test`
Expected: PASS, 43 tests (32 prior + 11 new).

- [ ] **Step 5: Write the viewer**

`app/src/viewer.js`:

```javascript
// The 3D scene: a lane per entry, all playing the same clock.

import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MODEL_DIR, attachMeshes, buildRigTree, loadKinematics } from "./rig.js";
import { Player, applyFrame, frameAt } from "./replay.js";

export const LANE_COLORS = [0xe8b400, 0x4a9df0, 0xe0563c, 0x59c07a, 0xa579d6];
const LANE_SPACING = 0.55; // metres between lane centres

let assetsPromise = null;

function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      loadKinematics(),
      new GLTFLoader().loadAsync(`${MODEL_DIR}/microduck.glb`),
    ]).then(([kinematics, gltf]) => ({ kinematics, glbScene: gltf.scene }));
  }
  return assetsPromise;
}

export async function createViewer(canvas) {
  const { kinematics, glbScene } = await loadAssets();

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color(0x101010);
  scene.add(new AmbientLight(0xffffff, 0.7));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(1.5, 3, 2);
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(20, 8),
    new MeshStandardMaterial({ color: 0x1c1c1c, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new GridHelper(20, 40, 0x2c2c2c, 0x222222);
  scene.add(grid);

  const camera = new PerspectiveCamera(38, 1, 0.05, 100);

  let lanes = [];
  let player = new Player([]);

  function clearLanes() {
    for (const lane of lanes) scene.remove(lane.rig.placer);
    lanes = [];
  }

  function setLanes(entries) {
    clearLanes();
    lanes = entries.map((entry, i) => {
      const rig = buildRigTree(kinematics);
      attachMeshes(rig, kinematics, glbScene, { color: entry.color ?? LANE_COLORS[i % 5] });
      // Lanes are spread across three.js x; the duck runs along three.js -z
      // after the Z-up correction, so lateral offset is x.
      rig.placer.position.x = (i - (entries.length - 1) / 2) * LANE_SPACING;
      scene.add(rig.placer);
      return { ...entry, rig };
    });
    player = new Player(lanes.map((lane) => lane.trace));
    player.play();
  }

  function resize() {
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 450;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  let raf = null;
  function tick(now) {
    player.advance(now);
    const indices = player.frameIndices();
    lanes.forEach((lane, i) => applyFrame(lane.rig, frameAt(lane.trace, indices[i])));

    // Follow the leader from behind and slightly above.
    const lead = lanes.length
      ? Math.max(...lanes.map((lane, i) => frameAt(lane.trace, indices[i])[0]))
      : 0;
    camera.position.set(0, 0.55, -(lead - 1.1));
    camera.lookAt(0, 0.12, -lead);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  resize();
  addEventListener("resize", resize);
  raf = requestAnimationFrame(tick);

  return {
    setLanes,
    get player() {
      return player;
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      clearLanes();
      renderer.dispose();
    },
  };
}
```

Note on axes: after the rig's `rotation.x = -Math.PI/2`, the duck's forward MJCF +x maps to three.js −z, which is why the camera trails along −z and lanes spread along x.

- [ ] **Step 6: Wire the viewer into the page**

Replace the `selectEvent` function in `app/src/main.js` and add the viewer plumbing. The full new `app/src/main.js`:

```javascript
import { getEvents, getLeaderboard, getTrace } from "./api.js";
import { renderBoard, selectedRunIds } from "./board.js";
import { formatEventLine } from "./format.js";
import { createViewer } from "./viewer.js";

const root = document.querySelector("#app");
const state = { events: [], current: null, viewer: null, traces: new Map() };

// Every await in this file is a point where the user may have switched events,
// and anything painted afterwards would belong to the previous race. Naming the
// check makes a MISSING guard visible: grep `stale(` and count it against the
// awaits. Three separate regressions here were each an await whose guard was
// simply forgotten.
const stale = (eventId) => state.current !== eventId;

function shell() {
  root.innerHTML = `
    <h1>Microduck Arena</h1>
    <p class="tagline">Race a policy. The clock is ours, not your browser's.</p>
    <nav class="events" id="events"></nav>
    <p class="event-line" id="event-line"></p>
    <div class="stage"><canvas id="stage"></canvas></div>
    <div class="controls"><button id="playpause">pause</button></div>
    <div id="board"></div>
  `;
  document.querySelector("#playpause").addEventListener("click", () => {
    const player = state.viewer?.player;
    if (!player) return;
    player.toggle();
    document.querySelector("#playpause").textContent = player.playing ? "pause" : "play";
  });
}

function renderEventTabs() {
  const nav = document.querySelector("#events");
  nav.innerHTML = "";
  for (const event of state.events) {
    const button = document.createElement("button");
    button.textContent = event.title;
    button.setAttribute("aria-current", String(event.id === state.current));
    button.addEventListener("click", () => selectEvent(event.id));
    nav.append(button);
  }
}

async function traceFor(runId) {
  if (!state.traces.has(runId)) state.traces.set(runId, await getTrace(runId));
  return state.traces.get(runId);
}

async function raceLanes(runIds, forEventId = state.current) {
  if (!state.viewer) return;
  const traces = await Promise.all(runIds.map(traceFor));
  // Traces are fetched per lane and can take a moment; if the user switched
  // events meanwhile, these lanes belong to the old race.
  if (stale(forEventId)) return;
  state.viewer.setLanes(runIds.map((runId, i) => ({ runId, trace: traces[i] })));
  document.querySelector("#playpause").textContent = "pause";
}

async function selectEvent(eventId) {
  state.current = eventId;
  renderEventTabs();
  const event = state.events.find((e) => e.id === eventId);
  document.querySelector("#event-line").textContent = formatEventLine(event);

  const board = document.querySelector("#board");
  board.textContent = "loading…";
  try {
    const data = await getLeaderboard(eventId);
    // Drop a response that arrived after the user moved on — see the note in
    // Task 6. Every await here is a point where the selection can have changed,
    // so the guard is repeated after the lane traces load too.
    if (stale(eventId)) return;
    renderBoard(board, data, {
      onSelectionChange: (runIds) => raceLanes(runIds),
    });
    await raceLanes(selectedRunIds(board), eventId);
  } catch (error) {
    // Without this the failure is an unhandled rejection and the page just
    // sits on "loading…" with nothing said. A visible message beats silence.
    if (!stale(eventId)) {
      board.textContent = `could not load the board: ${error.message}`;
    }
    return;
  }

  // The third guard, and the one that was missed: raceLanes above awaits, so by
  // here the selection may have moved on. An unguarded renderSubmit would rebuild
  // the form bound to the OLD event, and the next submission would silently post
  // a policy to a race the user is no longer looking at.
  if (stale(eventId)) return;
}

async function boot() {
  shell();
  try {
    state.events = await getEvents();
    state.viewer = await createViewer(document.querySelector("#stage"));
    await selectEvent(state.events[0].id);
  } catch (error) {
    root.innerHTML = `<h1>Microduck Arena</h1><p>could not start: ${error.message}</p>`;
  }
}

boot();
```

Append to `app/src/style.css`:

```css
.stage { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #101010; }
.stage canvas { display: block; width: 100%; height: 46vh; min-height: 280px; }
.controls { display: flex; gap: 8px; margin: 10px 0 18px; }
.controls button {
  font: inherit; padding: 5px 14px; cursor: pointer;
  background: transparent; color: var(--ink);
  border: 1px solid var(--line); border-radius: 6px;
}
```

- [ ] **Step 7: Run the tests and build**

Run: `cd app && npm test && npm run build`
Expected: 43 tests pass; build succeeds.

- [ ] **Step 8: Watch an actual race**

Self-contained: the same vendored policy entered under two names gives two
finishing lanes to race, with no dependency on any policy outside this repo.
Sibling repositories have moved twice during this project; the vendored copy
cannot.

```bash
REF=arena/assets/policies/BEST_alpha_walking.onnx
S=/tmp/arena-demo
rm -rf $S
uv run arena score $REF --event sprint-2m        --user alice --name walker    --store $S
uv run arena score $REF --event sprint-2m        --user bob   --name challenger --store $S
uv run arena score $REF --event roller-sprint-2m --user carol --name on-wheels  --store $S
uv run arena serve --store $S
```

If you have other policies to hand, add one for a more interesting board — a
non-walking policy will DNF the sprint, and that is worth seeing precisely
because a DNF must render as `DNF`, appear dimmed, and NOT be auto-ticked into a
lane. With only the vendored policy that path goes unexercised, so note in your
report whether you were able to check it.

Open `http://127.0.0.1:8000` and check, reporting what you actually see:

1. The sprint board shows alice AND bob both at `18.216s 5/5` — they ran the same
   policy, so they tie, and the tie breaks on earliest submission putting alice
   first. Both lanes are ticked (two finishers, three lanes available).
2. A duck is visible, upright, and walking — legs moving, not sliding or inverted. **An upside-down or sideways duck means a quaternion or axis conversion is wrong; report it rather than nudging the camera.**
3. Switch to the Roller Sprint tab: carol's single lane runs there, and the board
   for the sprint is replaced rather than merged into it.
4. Ticking and unticking rows adds and removes lanes.
5. `pause` / `play` works.

Take a screenshot of the roller head-to-head for the report.

- [ ] **Step 9: Commit**

```bash
git add app/src/replay.js app/src/replay.test.js app/src/viewer.js app/src/main.js app/src/style.css
git commit -m "Replay a race, and race replays side by side

A finished lane holds its last frame rather than looping, so the winner waits
at the line while the others come in. The trace is a recording: no physics
runs in the browser."
```

---

### Task 9: Submit from the page

**Files:**
- Create: `app/src/submit.js`
- Create: `app/src/submit.test.js`
- Modify: `app/src/main.js`
- Modify: `app/src/style.css`

**Interfaces:**
- Consumes: `api.js` (`submitPolicy`), `format.js`
- Produces:
  - `renderSubmit(container, { event, onSubmitted })` — the form
  - `describeResult(result) -> string` — pure, testable summary line
  - `validateFile(file) -> string | null` — a client-side reason, or null when it looks fine

- [ ] **Step 1: Write the failing test**

`app/src/submit.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { describeResult, validateFile } from "./submit.js";

describe("validateFile", () => {
  it("accepts an onnx file", () => {
    expect(validateFile({ name: "p.onnx", size: 800_000 })).toBeNull();
  });

  it("asks for a file when none was chosen", () => {
    expect(validateFile(null)).toMatch(/choose/i);
  });

  it("names the extension it wants", () => {
    expect(validateFile({ name: "policy.pt", size: 1000 })).toMatch(/\.onnx/);
  });

  it("refuses an oversize file before uploading it", () => {
    // The server enforces this too; catching it here saves a 4 MB round trip.
    expect(validateFile({ name: "big.onnx", size: 5 * 1024 * 1024 })).toMatch(/larger/i);
  });

  it("accepts a file of exactly the limit and refuses one byte more", () => {
    // Pins the boundary against the server's `> MAX_MODEL_BYTES`. A `>=` here
    // would reject a file the server would have accepted.
    const limit = 4 * 1024 * 1024;
    expect(validateFile({ name: "edge.onnx", size: limit })).toBeNull();
    expect(validateFile({ name: "edge.onnx", size: limit + 1 })).toMatch(/larger/i);
  });

  it("accepts an uppercase extension", () => {
    // Windows and some export tools produce .ONNX; rejecting it would be a
    // baffling refusal of a perfectly good file.
    expect(validateFile({ name: "POLICY.ONNX", size: 1000 })).toBeNull();
  });
});

describe("describeResult", () => {
  it("reports the score and how many seeds finished", () => {
    expect(
      describeResult({ score: 18.216, seeds_finished: 5, seeds_total: 5, policy_name: "walker" }),
    ).toBe("walker: 18.216s · 5/5 finished");
  });

  it("says DNF rather than quoting the time limit", () => {
    expect(
      describeResult({ score: 50, seeds_finished: 0, seeds_total: 5, policy_name: "roulade" }),
    ).toBe("roulade: DNF · 0/5 finished");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `Failed to resolve import "./submit.js"`

- [ ] **Step 3: Write the submit module**

`app/src/submit.js`:

```javascript
// The submit form.
//
// Client-side checks exist to save a pointless upload, not to be the gate: the
// server validates every file with the engine's own loader, and its message is
// what gets shown on failure.

import { submitPolicy } from "./api.js";
import { formatScore, formatSeeds } from "./format.js";

const MAX_BYTES = 4 * 1024 * 1024; // mirrors arena.policy.MAX_MODEL_BYTES

export function validateFile(file) {
  if (!file) return "Choose a .onnx policy file first.";
  if (!file.name.toLowerCase().endsWith(".onnx")) return "That is not a .onnx file.";
  if (file.size > MAX_BYTES) {
    return `That file is larger than the ${MAX_BYTES} byte limit.`;
  }
  return null;
}

export function describeResult(result) {
  const score = formatScore(result.score, { finished: result.seeds_finished });
  const seeds = formatSeeds(result.seeds_finished, result.seeds_total);
  return `${result.policy_name}: ${score} · ${seeds} finished`;
}

export function renderSubmit(container, { event, onSubmitted }) {
  container.innerHTML = `
    <form class="submit" id="submit-form">
      <label>policy <input type="file" id="policy-file" accept=".onnx" /></label>
      <label>name <input type="text" id="policy-name" placeholder="optional" /></label>
      <button type="submit" id="submit-go">Race it</button>
      <span class="submit-status" id="submit-status"></span>
    </form>
  `;

  const form = container.querySelector("#submit-form");
  const status = container.querySelector("#submit-status");
  const button = container.querySelector("#submit-go");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = container.querySelector("#policy-file").files[0] ?? null;
    const problem = validateFile(file);
    if (problem) {
      status.textContent = problem;
      status.className = "submit-status bad";
      return;
    }

    button.disabled = true;
    status.className = "submit-status";
    status.textContent = `racing ${event.seeds} seeds…`;
    try {
      const result = await submitPolicy(
        event.id,
        file,
        container.querySelector("#policy-name").value,
      );
      status.textContent = describeResult(result);
      onSubmitted?.(result);
    } catch (error) {
      // The server's wording — the same sentence the robot's daemon gives.
      status.textContent = error.message;
      status.className = "submit-status bad";
    } finally {
      button.disabled = false;
    }
  });
}
```

- [ ] **Step 4: Run the test**

Run: `cd app && npm test`
Expected: PASS, 51 tests (43 prior + 8 new).

- [ ] **Step 5: Wire it into the page**

In `app/src/main.js`, add the import:

```javascript
import { renderSubmit } from "./submit.js";
```

Add a container to `shell()`'s template, between the `controls` div and the `board` div:

```html
    <div id="submit"></div>
```

And at the end of `selectEvent`, after the staleness guard that follows the
`try/catch` (the guard is in the Task 8 listing — do not add `renderSubmit`
above it):

```javascript
  renderSubmit(document.querySelector("#submit"), {
    event,
    onSubmitted: () => selectEvent(eventId),
  });
```

Re-selecting the event after a submission reloads the board and the lanes, so a fresh run appears in a lane next to the record holder without a manual refresh.

Append to `app/src/style.css`:

```css
.submit { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin: 4px 0 22px; }
.submit label { display: flex; gap: 6px; align-items: center; color: var(--dim); }
.submit input[type="text"] { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); }
.submit button { font: inherit; padding: 5px 14px; cursor: pointer; background: var(--accent); color: #1a1a1a; border: 0; border-radius: 6px; }
.submit button:disabled { opacity: 0.55; cursor: progress; }
.submit-status { color: var(--dim); }
.submit-status.bad { color: #d8503c; }
```

- [ ] **Step 6: Submit a policy through the browser**

Run: `cd app && npm run build && cd .. && uv run arena serve --store /tmp/arena-demo`

Open `http://127.0.0.1:8000`, then:

1. Choose `arena/assets/policies/BEST_alpha_walking.onnx` (the repo's own vendored copy, so this always works), name it `browser-test`, and click **Race it**. Expected: a few seconds of "racing 5 seeds…", then `browser-test: 18.216s · 5/5 finished`, and the board reloads with the new row.
2. Submit a junk file (`echo nope > /tmp/junk.onnx`). Expected: the red status line reads `not a loadable ONNX model: …` — the engine's own message — and the board is unchanged.

Report both observed messages verbatim, and screenshot the successful submission.

- [ ] **Step 7: Run everything and commit**

Run: `uv run --extra dev pytest -q && uv run ruff check . && cd app && npm test`
Expected: 123 Python tests, ruff clean, 51 JS tests.

```bash
git add app/src/submit.js app/src/submit.test.js app/src/main.js app/src/style.css
git commit -m "Submit a policy from the page and land in a lane

Client-side checks only save a pointless upload; the server validates with the
engine's loader and its rejection message is what the page shows."
```

---

### Task 10: README, so someone else can run it

**Files:**
- Modify: `README.md`
- Test: none (documentation)

- [ ] **Step 1: Write the README**

Replace `README.md`:

```markdown
# microduck-arena

Race a Microduck policy against every other policy, on a clock you can trust.

Everything here is **private and local**: no Hugging Face account, no OAuth, no
network. Submitted policies are evaluated by the server on a fixed course and
recorded to a directory on your disk.

## Run it

```bash
uv sync
cd app && npm install && npm run build && cd ..
uv run arena serve --store ~/arena-board --user $USER
```

Open <http://127.0.0.1:8000>.

## From the command line

```bash
uv run arena events

# The repo vendors one reference policy, so this works with no setup:
REF=arena/assets/policies/BEST_alpha_walking.onnx
uv run arena score $REF --event sprint-2m
uv run arena score $REF --event sprint-2m --user me --name reference --store ~/arena-board
uv run arena board --event sprint-2m --store ~/arena-board
```

## What a policy has to be

One ONNX file with a **61-D observation input** and a **14-D action output** — the
same contract `robotd` enforces on the real robot, so a policy the Arena accepts
will load there too. A wrong shape is rejected with the reason:

```
observation width is 51, expected 61
```

## The events

| Event | Rig | Course | Command |
| --- | --- | --- | --- |
| `sprint-2m` | legs | 2 m flat | 0.25 m/s forward |
| `roller-sprint-2m` | rollers | 2 m flat | 0.6 m/s forward |
| `hill-climb-1m5` | legs | 1.5 m at 8° | 0.25 m/s forward |

An entry is scored as the **mean finish time over five perturbed starts**, with
any failure to finish counted at the event's time limit — so a policy that is
quick four times and falls once ranks below a steady one. The replay you watch is
the median finishing run, not the best.

Two things about the shipped reference policy are worth knowing before reading
too much into a time: it tracks about 44% of its commanded velocity, and below
roughly 0.2 m/s commanded it does not walk at all. Both are measured; see the
design doc's calibration table.

## Developing

```bash
uv run --extra dev pytest        # engine + API
cd app && npm test               # frontend units
cd app && npm run dev            # UI on :5173, proxying /api to :8000
```

`app/src/rig.js` and the vendored `app/public/robot/` assets come from
[the Microduck sandbox Space](https://huggingface.co/spaces/pollen-robotics/microduck-simulator)
at a pinned commit — see `arena/assets/PROVENANCE.md`. Re-vendoring can change
what a policy scores, so `RUNNER_VERSION` in `arena/constants.py` must be bumped
in the same commit.

## Design

- `docs/superpowers/specs/2026-09-03-microduck-arena-design.md` — the design and every decision behind it
- `docs/probe-results.md` — measured cost of an evaluation
```

- [ ] **Step 2: Verify the README's own instructions**

Follow it literally from a clean state and confirm each command works:

```bash
rm -rf app/dist && cd app && npm install && npm run build && cd ..
uv run arena serve --store /tmp/readme-check --user $USER
```

Expected: the page loads with an empty board and the three event tabs. Report anything in the README that turned out to be wrong and fix it.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: how to run it, and what a policy has to be"
```

---

## What this plan delivers

`uv run arena serve` and a browser: three events, a leaderboard, a head-to-head
replay of the podium with lane checkboxes, and a submit form that races an
uploaded policy and puts it on the board. Private, local, no account.

## Handoff to the deployment plan

Written after this lands. It adds: HF OAuth as a second identity path beside
`ARENA_DEV_USER`; `HubStore` behind configuration with a **private** dataset repo;
repo-id intake beside upload; per-user rate limits; subprocess isolation with a
wall-clock cap for submitted models; and the Dockerfile plus Space metadata.

The timing probe already settled the shape of that plan: a five-seed entry costs
0.73 s measured (2.5–5.2 s estimated on a 2 vCPU Space including a Hub fetch), so
submissions stay synchronous and no job queue is needed.
