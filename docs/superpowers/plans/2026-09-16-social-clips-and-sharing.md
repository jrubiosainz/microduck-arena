# Social Clips and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every published run gets a landscape and a vertical clip rendered in the Space by a background worker, and the publication page shares the result on X, LinkedIn, Instagram and TikTok with the clips downloadable.

**Architecture:** A Python worker drives a headless Chromium over the DevTools protocol against a second Vite page, `clip.html`, that reuses the arena's three.js viewer in a manual, frame-stepped mode and renders the whole soundtrack (synthesised crowd plus cues) in one `OfflineAudioContext` pass; ffmpeg encodes H.264 and muxes the PCM. Clip state is three write-once files per run in the store, served by two API routes, plus an Open Graph route `/r/<id>`. The run page grows a share row under the points.

**Tech Stack:** Python 3.13, FastAPI, `websockets` (sync client), Chromium headless + SwiftShader, ffmpeg (libx264, aac), three.js 0.169, Vite 5, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-09-16-social-clips-and-sharing-design.md`

## Global Constraints

- Python `>=3.13,<3.14`; `mujoco==3.12.0`, `onnxruntime==1.29.0`, `numpy==2.5.2` are never touched. New dependency: `websockets>=13`.
- The store is append-only: no file is ever rewritten. Clip state is the presence of `clips/<run_id>/pending.json`, `clip.json`, `failed.json`.
- Clips: 25 fps, landscape 1920×1080, vertical 1080×1920, H.264 `libx264 -preset medium -crf 23 -pix_fmt yuv420p`, AAC 192k 48 kHz stereo, `-metadata crowdMixed=true -movflags +faststart+use_metadata_tags`.
- Sound cues live in `app/public/sound/`, each with a row in `app/public/sound/PROVENANCE.md`. Code ported from Duck Jam carries a header naming its source file and commit `2d35443b`.
- Copy is English, in the site's voice. Tests stay at the minimum the spec lists; the theatre and the render are checked by eye.
- Never `git push`: a push to `main` deploys the production Space. Work on branch `social-clips`.
- Run Python with `uv run --frozen` (the local uv mirror rewrites `uv.lock` otherwise), except the one task that adds `websockets`.
- Frontend tests: `cd app && npx vitest run`. Known pre-existing: 4 `brightness.test.js` failures under Node 25; ignore them.

## File Structure

**Python**
- `arena/manifest.py` — `ClipCamera`, `ClipConfig`, `[clip]` parsing and defaults; `Manifest.clip`.
- `arena/store.py` — `Store` protocol + `LocalStore` + `HubStore`: `mark_clip_pending`, `put_clip`, `fail_clip`, `clip_state`, `clip_file`, `pending_clips`.
- `arena/recorder.py` — new: Chrome discovery and launch, the DevTools client, `record_run` (one run, all layouts, ffmpeg).
- `arena/clips.py` — new: `CLIP_VERSION`, `ClipRenderer` (queue, worker thread, drain, availability, manifest assembly).
- `arena/web/config.py` — `origin`, `public_origin`, `clip_parallel`.
- `arena/web/app.py` — `app.state.clips`, startup drain, the unfurl router.
- `arena/web/routes_read.py` — `event_summary["clip"]`, `safe_stem`, `GET /runs/{id}/clip`, `GET /runs/{id}/clip/{name}`.
- `arena/web/routes_unfurl.py` — new: `GET /r/{run_id}`.
- `arena/web/routes_submit.py` — mark pending + enqueue after append.
- `arena/cli.py` — `arena clip`.
- `scripts/probe_capture.py` — new: the capture measurement.
- `Dockerfile`, `pyproject.toml`, `uv.lock`.

**Frontend**
- `app/src/viewer.js` — `manual`, `camera`, `frame(seconds)`, nameplates; `cameraPose` pure.
- `app/src/plate.js` — new: `nameplate` (port of Duck Jam `dome/web/features/replay/plate.mjs`).
- `app/src/clip/plan.js` — new: `clipPlan` pure.
- `app/src/clip/score.js` — new: `clipScore`, `jingleFile` pure.
- `app/src/clip/direction.js`, `app/src/clip/stadium.js` — ports of Duck Jam `design/sound/stadium-direction.mjs`, `stadium.mjs`.
- `app/src/clip/soundtrack.js` — new: `renderSoundtrack` (one offline pass).
- `app/src/clip/main.js` — new: the clip page.
- `app/clip.html`, `app/public/clip.css` — new: the frame.
- `app/vite.config.js` — the second entry.
- `app/src/share.js` — new: `postText`, `intentUrl`, `shareStrip`, `wireShare`.
- `app/src/api.js` — `getClip`, `clipFileUrl`.
- `app/src/run.js`, `app/src/reveal.js`, `app/public/race.css` — the share row.
- `app/public/sound/` — `round-0..4.wav`, `microduck-fall.wav`, `MICRODUCK-LICENSE.txt`, `PROVENANCE.md`.

**Tests**
- `tests/test_manifest.py`, `tests/test_clips.py` (new), `tests/test_routes_read.py`.
- `app/src/viewer.test.js` (new, pure `cameraPose`), `app/src/clip/plan.test.js`, `app/src/clip/score.test.js`, `app/src/share.test.js` (all new).

---

### Task 0: Branch

**Files:** none.

- [ ] **Step 1: Create the branch and worktree**

```bash
cd /Users/nicolasrabault/Projects/HuggingFace/microduck-arena
git worktree add -b social-clips .claude/worktrees/clips main
cd .claude/worktrees/clips && cd app && npm ci && cd ..
```

Every later step runs inside `.claude/worktrees/clips`.

---

### Task 1: `[clip]` in the event manifest

**Files:**
- Modify: `arena/manifest.py` (dataclasses after `Vote`, parsing before `return Manifest(`, the `clip=` field)
- Modify: `arena/web/routes_read.py:27-65` (`event_summary`)
- Test: `tests/test_manifest.py`

**Interfaces:**
- Produces: `ClipCamera(kind, back, height, side, target_height, fov, position, target)`, `ClipConfig(tape_max_s, sounds, jingle, camera)` with `.to_dict()`, `Manifest.clip: ClipConfig`, constants `CAMERA_KINDS`, `SOUND_SOURCES`, `JINGLES`; `event_summary(m)["clip"] == m.clip.to_dict()`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_manifest.py`:

```python
def test_an_event_without_a_clip_section_gets_the_defaults():
    clip = load_event("sprint-2m").clip
    assert clip.tape_max_s == 12.0
    assert clip.sounds == ("crowd", "jingle", "verdict")
    assert clip.jingle is None
    assert clip.camera.kind == "chase"
    assert clip.camera.side is None
    assert clip.to_dict() == {
        "tape_max_s": 12.0,
        "sounds": ["crowd", "jingle", "verdict"],
        "jingle": None,
        "camera": {"kind": "chase", "back": 0.35, "height": 0.34, "side": None,
                   "target_height": 0.12, "fov": 42.0},
    }


def test_a_clip_section_pins_the_tape_a_fixed_camera_and_the_jingle(tmp_path):
    path = write_manifest(
        tmp_path,
        clip='[clip]\ntape_max_s=6.0\nsounds=["crowd"]\njingle="round-3"\n'
             '[clip.camera]\nkind="fixed"\nposition=[1.0,0.6,2.2]\ntarget=[1.0,0.1,0.0]\nfov=40\n',
    )
    clip = load_manifest(path).clip
    assert clip.tape_max_s == 6.0
    assert clip.sounds == ("crowd",)
    assert clip.jingle == "round-3"
    assert clip.camera.to_dict() == {
        "kind": "fixed", "position": [1.0, 0.6, 2.2], "target": [1.0, 0.1, 0.0], "fov": 40.0
    }


@pytest.mark.parametrize(
    "section, said",
    [
        ('[clip]\nsounds=["crowd","organ"]\n', "unknown sound source"),
        ('[clip]\njingle="round-9"\n', "unknown jingle"),
        ('[clip]\ntape_max_s=0\n', "tape_max_s must be positive"),
        ('[clip]\nfoo=1\n', "unknown keys"),
        ('[clip]\n[clip.camera]\nkind="drone"\n', "unknown camera kind"),
        ('[clip]\n[clip.camera]\nkind="fixed"\nfov=40\n', "needs position and target"),
        ('[clip]\n[clip.camera]\nkind="chase"\nposition=[0,0,0]\n', "unknown keys"),
    ],
)
def test_a_malformed_clip_section_is_refused(tmp_path, section, said):
    with pytest.raises(ManifestError, match=said):
        load_manifest(write_manifest(tmp_path, clip=section))
```

`write_manifest` builds from `GOOD`'s keys only, so add `"clip": ""` to `GOOD` (an empty section string is a valid absence).

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run --frozen pytest tests/test_manifest.py -q`
Expected: FAIL — `AttributeError: 'Manifest' object has no attribute 'clip'` and `TypeError` on the `clip=` keyword.

- [ ] **Step 3: Implement the dataclasses and the parser**

In `arena/manifest.py`, after the `Vote` dataclass:

```python
CAMERA_KINDS = ("chase", "fixed")
# The sound sources a clip can draw on (app/src/clip/score.js). A name here is
# a function there; an event lists the ones it wants.
SOUND_SOURCES = ("crowd", "jingle", "verdict")
# The five variants of Duck Jam's round-drop jingle in app/public/sound/.
JINGLES = tuple(f"round-{i}" for i in range(5))


@dataclass(frozen=True)
class ClipCamera:
    """Where the clip's camera stands.

    `chase` is the viewer's own camera — behind the leader, trackside, the
    side offset widening with the lanes — with its constants exposed. `fixed`
    is an absolute position and target, for events whose picture is a jump or
    a stand rather than a run down a lane.
    """

    kind: str = "chase"
    back: float = 0.35
    height: float = 0.34
    side: float | None = None  # None: the viewer's cameraSideOffset
    target_height: float = 0.12
    fov: float = 42.0
    position: tuple[float, float, float] | None = None
    target: tuple[float, float, float] | None = None

    def to_dict(self) -> dict:
        if self.kind == "fixed":
            return {"kind": "fixed", "position": list(self.position),
                    "target": list(self.target), "fov": self.fov}
        return {"kind": "chase", "back": self.back, "height": self.height, "side": self.side,
                "target_height": self.target_height, "fov": self.fov}


@dataclass(frozen=True)
class ClipConfig:
    """How this event's clip is framed and scored. Every field has a default,
    so an event with no [clip] section renders as the sprint does."""

    tape_max_s: float = 12.0
    sounds: tuple[str, ...] = SOUND_SOURCES
    jingle: str | None = None  # None: picked from the event id
    camera: ClipCamera = ClipCamera()

    def to_dict(self) -> dict:
        return {"tape_max_s": self.tape_max_s, "sounds": list(self.sounds),
                "jingle": self.jingle, "camera": self.camera.to_dict()}
```

Add `clip: ClipConfig = ClipConfig()` to `Manifest` after `vote`. Then the parser, before `load_manifest`:

```python
def _refuse_unknown(raw: dict, allowed: set[str], where: str) -> None:
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ManifestError(f"{where}: unknown keys {unknown}")


def _triple(raw: dict, key: str, where: str) -> tuple[float, float, float]:
    values = _require(raw, key, where)
    if len(values) != 3:
        raise ManifestError(f"{where}: {key} must have 3 values, got {len(values)}")
    return tuple(float(v) for v in values)


def _camera(raw: dict | None, where: str) -> ClipCamera:
    if raw is None:
        return ClipCamera()
    kind = raw.get("kind", "chase")
    if kind not in CAMERA_KINDS:
        raise ManifestError(f"{where}: unknown camera kind {kind!r}, expected one of {CAMERA_KINDS}")
    if kind == "fixed":
        _refuse_unknown(raw, {"kind", "position", "target", "fov"}, where)
        if "position" not in raw or "target" not in raw:
            raise ManifestError(f"{where}: a fixed camera needs position and target")
        return ClipCamera(kind="fixed", position=_triple(raw, "position", where),
                          target=_triple(raw, "target", where), fov=float(raw.get("fov", 42.0)))
    _refuse_unknown(raw, {"kind", "back", "height", "side", "target_height", "fov"}, where)
    default = ClipCamera()
    return ClipCamera(
        back=float(raw.get("back", default.back)),
        height=float(raw.get("height", default.height)),
        side=None if raw.get("side", "auto") == "auto" else float(raw["side"]),
        target_height=float(raw.get("target_height", default.target_height)),
        fov=float(raw.get("fov", default.fov)),
    )


def _clip(raw: dict | None, where: str) -> ClipConfig:
    if raw is None:
        return ClipConfig()
    _refuse_unknown(raw, {"tape_max_s", "sounds", "jingle", "camera"}, where)
    tape = float(raw.get("tape_max_s", 12.0))
    if tape <= 0:
        raise ManifestError(f"{where}: tape_max_s must be positive")
    sounds = tuple(raw.get("sounds", SOUND_SOURCES))
    for name in sounds:
        if name not in SOUND_SOURCES:
            raise ManifestError(f"{where}: unknown sound source {name!r}, expected among {SOUND_SOURCES}")
    jingle = raw.get("jingle")
    if jingle is not None and jingle not in JINGLES:
        raise ManifestError(f"{where}: unknown jingle {jingle!r}, expected one of {JINGLES}")
    return ClipConfig(tape_max_s=tape, sounds=sounds, jingle=jingle,
                      camera=_camera(raw.get("camera"), f"{where}.camera"))
```

In `load_manifest`, pass `clip=_clip(raw.get("clip"), "[clip]")` to `Manifest(...)`.

In `routes_read.event_summary`, add `"clip": manifest.clip.to_dict(),` after `"sweep_count"`.

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_manifest.py tests/test_routes_read.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add arena/manifest.py arena/web/routes_read.py tests/test_manifest.py
git commit -m "Manifest: a [clip] section per event — tape ceiling, camera, sound sources, jingle — with defaults"
```

---

### Task 2: Clip files in the store

**Files:**
- Modify: `arena/store.py` (`Store` protocol, `LocalStore` after `seen`, `HubStore` after `seen`)
- Test: `tests/test_clips.py` (new)

**Interfaces:**
- Produces, on `Store`:
  - `mark_clip_pending(run_id: str, user: str, event_id: str, queued_at: str) -> None`
  - `put_clip(run_id: str, files: dict[str, bytes]) -> None` — `files` holds `clip.json` and the media; refuses when `clip.json` already exists.
  - `fail_clip(run_id: str, failed_at: str, reason: str) -> None`
  - `clip_state(run_id: str) -> tuple[str, dict | None]` — `("ready", manifest)`, `("failed", None)`, `("pending", None)`, `("none", None)`.
  - `clip_file(run_id: str, name: str) -> Path`
  - `pending_clips() -> list[str]`
- Constant `CLIP_MEDIA = ("landscape.mp4", "vertical.mp4", "poster.png")`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_clips.py`:

```python
"""Clips: three write-once files per run, and a worker that owes one per publish."""

import json

from arena.store import LocalStore


def test_clip_state_is_read_by_presence(tmp_path):
    store = LocalStore(tmp_path)
    assert store.clip_state("R1") == ("none", None)
    assert store.pending_clips() == []

    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    assert store.clip_state("R1") == ("pending", None)
    assert store.pending_clips() == ["R1"]
    pending = json.loads((tmp_path / "clips" / "R1" / "pending.json").read_text())
    assert pending == {"run_id": "R1", "user": "alice", "event_id": "sprint-2m",
                       "queued_at": "2026-09-16T10:00:00Z"}

    manifest = {"run_id": "R1", "version": 1, "layouts": {}}
    store.put_clip("R1", {"clip.json": json.dumps(manifest).encode(),
                          "landscape.mp4": b"mp4", "poster.png": b"png"})
    assert store.clip_state("R1") == ("ready", manifest)
    assert store.clip_file("R1", "landscape.mp4").read_bytes() == b"mp4"
    # Ready is final: the pending marker stays on disk and no longer counts.
    assert store.pending_clips() == []


def test_a_failed_clip_is_its_own_file_and_leaves_the_queue(tmp_path):
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R2", "bob", "sprint-2m", "2026-09-16T10:00:00Z")
    store.fail_clip("R2", "2026-09-16T10:05:00Z", "ffmpeg exited 1")
    assert store.clip_state("R2") == ("failed", None)
    assert store.pending_clips() == []
    failed = json.loads((tmp_path / "clips" / "R2" / "failed.json").read_text())
    assert failed["reason"] == "ffmpeg exited 1"


def test_a_clip_is_never_written_twice(tmp_path):
    import pytest

    store = LocalStore(tmp_path)
    store.put_clip("R3", {"clip.json": b"{}"})
    with pytest.raises(FileExistsError):
        store.put_clip("R3", {"clip.json": b"{}"})
```

- [ ] **Step 2: Run to see them fail**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: FAIL — `AttributeError: 'LocalStore' object has no attribute 'clip_state'`.

- [ ] **Step 3: Implement on the protocol, `LocalStore` and `HubStore`**

In `arena/store.py`, near the top after `_TAIL_BITS`:

```python
# The media a ready clip holds beside its clip.json (arena/clips.py writes them,
# routes_read.py serves them by these exact names).
CLIP_MEDIA = ("landscape.mp4", "vertical.mp4", "poster.png")
```

Add to the `Store` protocol:

```python
    def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None: ...
    def put_clip(self, run_id: str, files: dict[str, bytes]) -> None: ...
    def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None: ...
    def clip_state(self, run_id: str) -> tuple[str, dict | None]: ...
    def clip_file(self, run_id: str, name: str) -> Path: ...
    def pending_clips(self) -> list[str]: ...
```

Add to `LocalStore` after `seen`:

```python
    # ── clips: pending.json, then clip.json + media, or failed.json ──────────
    #
    # Three files rather than one state file that changes: this store never
    # rewrites, and a state read by presence needs no lock. `clip_state` is the
    # one place the precedence lives: ready beats failed beats pending.

    def _clip_dir(self, run_id: str) -> Path:
        return self.root / "clips" / run_id

    def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None:
        path = self._clip_dir(run_id) / "pending.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"run_id": run_id, "user": user, "event_id": event_id, "queued_at": queued_at}, indent=2
        ))

    def put_clip(self, run_id: str, files: dict[str, bytes]) -> None:
        folder = self._clip_dir(run_id)
        if (folder / "clip.json").exists():
            raise FileExistsError(f"clip {run_id} already rendered at {folder}")
        folder.mkdir(parents=True, exist_ok=True)
        # Media first, clip.json last: state is read off clip.json, so a write
        # that dies part-way leaves a pending clip, never a ready one with a
        # missing file.
        for name, blob in files.items():
            if name != "clip.json":
                (folder / name).write_bytes(blob)
        (folder / "clip.json").write_bytes(files["clip.json"])

    def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None:
        path = self._clip_dir(run_id) / "failed.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"run_id": run_id, "failed_at": failed_at, "reason": reason}, indent=2
        ))

    def clip_state(self, run_id: str) -> tuple[str, dict | None]:
        folder = self._clip_dir(run_id)
        if (folder / "clip.json").is_file():
            return "ready", json.loads((folder / "clip.json").read_text())
        if (folder / "failed.json").is_file():
            return "failed", None
        if (folder / "pending.json").is_file():
            return "pending", None
        return "none", None

    def clip_file(self, run_id: str, name: str) -> Path:
        return self._clip_dir(run_id) / name

    def pending_clips(self) -> list[str]:
        directory = self.root / "clips"
        if not directory.is_dir():
            return []
        return sorted(
            folder.name for folder in directory.iterdir()
            if folder.is_dir() and self.clip_state(folder.name)[0] == "pending"
        )
```

Add to `HubStore` after `seen`. The snapshot must skip the media:

```python
    def snapshot(self, fresh: bool = False) -> LocalStore:
        ...
        # The clips' media stay out of the snapshot — a boot would otherwise
        # download every video ever rendered. clip_file fetches one on demand.
        self._snapshot = LocalStore(Path(snapshot_download(
            self.repo_id, repo_type="dataset", ignore_patterns=["*.mp4", "*.png"]
        )))
```

and:

```python
    def _commit_clip_files(self, run_id: str, files: dict[str, bytes], message: str) -> None:
        from huggingface_hub import CommitOperationAdd

        self.api.create_commit(
            repo_id=self.repo_id,
            repo_type="dataset",
            commit_message=message,
            operations=[
                CommitOperationAdd(path_in_repo=f"clips/{run_id}/{name}", path_or_fileobj=blob)
                for name, blob in files.items()
            ],
        )
        self._snapshot = None

    def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None:
        body = {"run_id": run_id, "user": user, "event_id": event_id, "queued_at": queued_at}
        self._commit_clip_files(
            run_id, {"pending.json": json.dumps(body, indent=2).encode()}, f"clip pending {run_id}"
        )

    def put_clip(self, run_id: str, files: dict[str, bytes]) -> None:
        if self.api.file_exists(self.repo_id, f"clips/{run_id}/clip.json", repo_type="dataset"):
            raise FileExistsError(f"clip {run_id} already rendered in {self.repo_id}")
        self._commit_clip_files(run_id, files, f"clip {run_id}")

    def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None:
        body = {"run_id": run_id, "failed_at": failed_at, "reason": reason}
        self._commit_clip_files(
            run_id, {"failed.json": json.dumps(body, indent=2).encode()}, f"clip failed {run_id}"
        )

    def clip_state(self, run_id: str) -> tuple[str, dict | None]:
        return self.snapshot().clip_state(run_id)

    def clip_file(self, run_id: str, name: str) -> Path:
        from huggingface_hub import hf_hub_download

        # One file, cached by the Hub cache: the second read costs nothing.
        return Path(hf_hub_download(self.repo_id, f"clips/{run_id}/{name}", repo_type="dataset"))

    def pending_clips(self) -> list[str]:
        return self.snapshot().pending_clips()
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_clips.py tests/test_store.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add arena/store.py tests/test_clips.py
git commit -m "Store: a clip per run as three write-once files, its media kept out of the Hub snapshot"
```

---

### Task 3: Vendored sounds, the crowd engine, the nameplate

**Files:**
- Create: `app/public/sound/round-0.wav` … `round-4.wav`, `app/public/sound/microduck-fall.wav`, `app/public/sound/MICRODUCK-LICENSE.txt`
- Modify: `app/public/sound/PROVENANCE.md`
- Create: `app/src/clip/direction.js`, `app/src/clip/stadium.js`, `app/src/plate.js`
- Test: `app/src/clip/direction.test.js` (new)

**Interfaces:**
- Produces: `stadiumDirection({start, end, progress, verdict}) → (second) → {action, joy, encouragement, sadness, impact}` (direction.js); `prepareStadium(Ctor)`, `StadiumAmbience`, `renderStadium` (stadium.js); `nameplate(text, colour, background) → {sprite, pixels, ratio, dispose()}` (plate.js).

- [ ] **Step 1: Copy the sounds and their licence**

```bash
DJ=/Users/nicolasrabault/Projects/HuggingFace/duckJam
for i in 0 1 2 3 4; do cp "$DJ/design/sound/variants/round-$i.wav" app/public/sound/; done
cp "$DJ/design/sound/microduck-fall.wav" app/public/sound/
cp "$DJ/design/sound/MICRODUCK-LICENSE.txt" app/public/sound/
```

- [ ] **Step 2: Extend PROVENANCE.md**

In `app/public/sound/PROVENANCE.md`: change the `commit` row to `2d35443b` and the `vendored` row to today's UTC timestamp; rename the heading `## The seven cues` to `## The cues`; add these rows to the table:

```markdown
| `round-0.wav` … `round-4.wav` | 1.2 s | The clip's title card: an event's jingle, one variant per event (`hash(event.id) mod 5`, or `[clip] jingle`). | CC0-1.0 |
| `microduck-fall.wav` | 0.58 s | The clip's outro after a DNF stamp: the duck's own falling note. | Apache-2.0 (see below) |
```

Correct the `microduck-victory.wav` row's licence to `Apache-2.0 (see below)` and add a closing section:

```markdown
## The microduck voice

`microduck-victory.wav` and `microduck-fall.wav` are not `build-kit.mjs` cues: Duck Jam
renders them with the robot's own Rust synthesiser from
[pollen-robotics/microduck, sounds](https://github.com/pollen-robotics/microduck/tree/e597877c5a9460f4c3837dc3cdab088705212c5d/sounds),
revision `e597877c5a9460f4c3837dc3cdab088705212c5d`, then modifies the recipe (victory) or the
audio (fall). That synthesiser is Apache-2.0 — `MICRODUCK-LICENSE.txt` beside them is its
licence — so these two files travel with it, not with the CC0 dedication above.
```

- [ ] **Step 3: Port the crowd engine and its direction**

```bash
mkdir -p app/src/clip
cp "$DJ/design/sound/stadium-direction.mjs" app/src/clip/direction.js
cp "$DJ/design/sound/stadium.mjs" app/src/clip/stadium.js
```

Edit `app/src/clip/direction.js`: prepend

```js
// Ported unchanged from Duck Jam, design/sound/stadium-direction.mjs at 2d35443b.
```

Edit `app/src/clip/stadium.js`: prepend the same line naming `design/sound/stadium.mjs`, and change its import to `import { stadiumDirection } from './direction.js';`.

- [ ] **Step 4: Write the failing test for the port**

Create `app/src/clip/direction.test.js`:

```js
import { describe, expect, it } from "vitest";
import { stadiumDirection } from "./direction.js";

describe("stadiumDirection", () => {
  it("plays through the tape and turns to joy at a pass", () => {
    const at = stadiumDirection({ start: 1, end: 6, verdict: "pass" });
    expect(at(0.5).action).toBe(0);
    expect(at(4).action).toBeGreaterThan(0.3);
    expect(at(7).joy).toBeGreaterThan(0.5);
    expect(at(7).sadness).toBe(0);
  });

  it("encourages when progress rises", () => {
    const at = stadiumDirection({
      start: 1, end: 6, verdict: "pass",
      progress: [{ second: 2, value: 0.1 }, { second: 3, value: 0.5 }],
    });
    expect(at(3.8).encouragement).toBeGreaterThan(at(2.5).encouragement);
  });
});
```

- [ ] **Step 5: Run it**

Run: `cd app && npx vitest run src/clip/direction.test.js`
Expected: PASS (the port is unchanged; the test proves it loads under Vite).

- [ ] **Step 6: Port the nameplate**

Create `app/src/plate.js`:

```js
// A name in a box, hung over a duck's head. Ported from Duck Jam,
// dome/web/features/replay/plate.mjs at 2d35443b — the nameplate only.

import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from "three";

/** Texture pixels per CSS pixel: enough that a duck walking up to the camera stays crisp. */
const TEXTURE = 3;
/** The box around a name, in CSS pixels: padding then border. */
const PLATE = { pad: [2, 7], border: 2 };

/** What the browser resolves for an element wearing these classes — the charter's own answer. */
function faceOf(classes) {
  const probe = document.createElement("span");
  probe.className = classes;
  probe.style.cssText = "position:absolute;visibility:hidden;left:-9999px";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const face = {
    font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    size: parseFloat(style.fontSize),
    line: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5,
    tracking: parseFloat(style.letterSpacing) || 0,
  };
  probe.remove();
  return face;
}

function sheet(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * TEXTURE);
  canvas.height = Math.ceil(height * TEXTURE);
  const paper = canvas.getContext("2d");
  paper.scale(TEXTURE, TEXTURE);
  return { canvas, paper };
}

function measured(paper, face, text) {
  paper.font = face.font;
  try {
    paper.letterSpacing = `${face.tracking}px`;
  } catch {
    // The tracking is the charter's polish, not its meaning.
  }
  return paper.measureText(text).width;
}

/**
 * A name in a box, hung by its bottom edge so it floats over a duck's head.
 * `pixels` is its height in CSS pixels and `ratio` its width over height, so
 * the caller can scale the sprite to a height in metres.
 */
export function nameplate(text, colour, background) {
  const face = faceOf("mono-label");
  const { pad, border } = PLATE;
  const probe = sheet(1, 1).paper;
  const width = measured(probe, face, text) + 2 * (pad[1] + border);
  const height = face.line + 2 * (pad[0] + border);
  const { canvas, paper } = sheet(width, height);
  paper.fillStyle = background;
  paper.fillRect(0, 0, width, height);
  paper.strokeStyle = colour;
  paper.lineWidth = border;
  paper.strokeRect(border / 2, border / 2, width - border, height - border);
  measured(paper, face, text);
  paper.fillStyle = colour;
  paper.textAlign = "center";
  paper.textBaseline = "middle";
  paper.fillText(text, width / 2, height / 2);

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false }));
  sprite.center.set(0.5, 0);
  return {
    sprite,
    pixels: height,
    ratio: width / height,
    dispose() {
      map.dispose();
      sprite.material.dispose();
    },
  };
}
```

- [ ] **Step 7: Run the whole frontend suite, then commit**

Run: `cd app && npx vitest run`
Expected: everything passes except the 4 known `brightness.test.js` failures.

```bash
git add app/public/sound app/src/clip/direction.js app/src/clip/stadium.js app/src/clip/direction.test.js app/src/plate.js
git commit -m "Vendor the clip's cues and crowd: five jingles, the falling note, the stadium engine, the nameplate"
```

---

### Task 4: The viewer's manual mode, camera spec and nameplates

**Files:**
- Modify: `app/src/viewer.js` (imports, `createViewer` signature, `setLanes`, `clearScene`, `tick`, the return object)
- Create: `app/src/lanes.js`
- Modify: `app/src/run.js:18-39` (import `lanesFor` instead of defining it)
- Test: `app/src/viewer.test.js` (new)

**Interfaces:**
- Produces: `cameraPose(spec, lead, sideOffset) → { position: [x,y,z], target: [x,y,z] }` (pure, exported); `createViewer(canvas, { onChaseChange, rig, manual = false, camera = null })` — with `manual` the viewer starts no animation loop and no controls, and the returned object gains `frame(seconds)`; `setLanes` entries may carry `name` (string) and `nameColour` (CSS colour) to hang a nameplate; `lanesFor(run)` and `RIVALS` from `lanes.js`.
- Consumes: `nameplate` from Task 3.

- [ ] **Step 1: Write the failing test for the pure camera rule**

Create `app/src/viewer.test.js`:

```js
import { describe, expect, it } from "vitest";
import { cameraPose } from "./viewer.js";

describe("cameraPose", () => {
  it("chases the leader from behind and trackside by default, exactly as before", () => {
    expect(cameraPose(null, 1.2, 1.15)).toEqual({
      position: [1.2 - 0.35, 0.34, 1.15],
      target: [1.2, 0.12, 0],
    });
  });

  it("takes an event's chase constants and a pinned side", () => {
    const spec = { kind: "chase", back: 0.5, height: 0.6, side: 2, target_height: 0.2, fov: 40 };
    expect(cameraPose(spec, 0, 1.15)).toEqual({ position: [-0.5, 0.6, 2], target: [0, 0.2, 0] });
  });

  it("backs a chase off by a distance factor for a narrower frame", () => {
    expect(cameraPose({ kind: "chase", distance: 2 }, 1, 1.15).position).toEqual([1 - 0.7, 0.68, 2.3]);
  });

  it("holds a fixed camera where the event put it", () => {
    const spec = { kind: "fixed", position: [1, 0.6, 2.2], target: [1, 0.1, 0], fov: 40 };
    expect(cameraPose(spec, 5, 1.15)).toEqual({ position: [1, 0.6, 2.2], target: [1, 0.1, 0] });
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npx vitest run src/viewer.test.js`
Expected: FAIL — `cameraPose` is not exported. (viewer.js imports three, which loads under jsdom; only WebGL is unavailable, and this test never creates a renderer.)

- [ ] **Step 3: Implement `cameraPose`, `manual`, `frame` and the nameplates**

In `app/src/viewer.js`, add the import `import { nameplate } from "./plate.js";` and, after `placeLane`:

```js
// A nameplate's height in metres and how far above the trunk it floats. Tuned
// by eye on the clip page; the publication page hangs none.
const PLATE_HEIGHT = 0.05;
const PLATE_LIFT = 0.16;

/**
 * Where the camera stands and what it looks at, for one frame.
 *
 * `null` is the chase camera the publication and race pages always had:
 * behind the leader, trackside, the side offset widening with the arena. An
 * event's `[clip.camera]` spec overrides its constants or fixes the camera
 * outright; `distance` scales a chase's offsets, which is how the vertical
 * clip fits the same picture in a narrower frame. Pure, so it is testable.
 */
export function cameraPose(spec, lead, sideOffset) {
  if (spec?.kind === "fixed") return { position: [...spec.position], target: [...spec.target] };
  const back = spec?.back ?? 0.35;
  const height = spec?.height ?? 0.34;
  const side = spec?.side ?? sideOffset;
  const distance = spec?.distance ?? 1;
  return {
    position: [lead - back * distance, height * distance, side * distance],
    target: [lead, spec?.target_height ?? 0.12, 0],
  };
}
```

Change the signature and the parts that differ in manual mode:

```js
export async function createViewer(
  canvas,
  { onChaseChange, rig: rigName = "legs", manual = false, camera: spec = null } = {},
) {
```

- `renderer.setPixelRatio(manual ? 1 : Math.min(devicePixelRatio, 2));` — a clip is exactly its layout's pixels.
- `const camera = new PerspectiveCamera(spec?.fov ?? 42, 1, 0.02, 100);`
- Controls only when interactive:

```js
  const controls = manual ? null : new OrbitControls(camera, canvas);
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.25;
    controls.maxDistance = 8;
    controls.target.set(0, 0.12, 0);
    controls.addEventListener("start", () => {
      if (!chase) return;
      chase = false;
      onChaseChange?.(false);
    });
  }
```

(`let chase = true;` must be declared before this block.)

- In `clearScene`, dispose plates: inside the loop add `lane.plate?.dispose(); if (lane.plate) scene.remove(lane.plate.sprite);`.
- In `setLanes`, after the marker:

```js
      // The duck's name, hung over its head in its lane's colour: the clip
      // has four ducks and no legend, so the name rides the duck.
      let plate = null;
      if (entry.name) {
        plate = nameplate(entry.name, entry.nameColour ?? "#faf8f2", "#08080c");
        plate.sprite.scale.set(PLATE_HEIGHT * plate.ratio, PLATE_HEIGHT, 1);
        scene.add(plate.sprite);
      }
      return { ...entry, rig, marker, plate, tier };
```

- Split `tick` into `draw` and the loop:

```js
  const _target = new Vector3();
  const _trunk = new Vector3();
  let raf = null;

  function draw() {
    const indices = player.frameIndices();
    lanes.forEach((lane, i) => {
      const frame = frameAt(lane.trace, indices[i]);
      applyFrame(lane.rig, frame);
      // Keep the marker under its duck. frame[0] is MJCF +x, which is three +x.
      if (lane.marker) lane.marker.position.x = frame[0];
      if (lane.plate) {
        lane.rig.bodies.get("trunk_base").getWorldPosition(_trunk);
        lane.plate.sprite.position.set(_trunk.x, _trunk.y + PLATE_LIFT, _trunk.z);
      }
    });

    if (chase && lanes.length) {
      // Follow the leader along +x, the direction of travel, from behind and
      // slightly to one side so the gait is visible rather than end-on.
      const lead = Math.max(...lanes.map((lane, i) => frameAt(lane.trace, indices[i])[0]));
      const pose = cameraPose(spec, lead, sideOffset);
      camera.position.set(...pose.position);
      _target.set(...pose.target);
      if (controls) controls.target.copy(_target);
      else camera.lookAt(_target);
    }
    controls?.update();
    renderer.render(scene, camera);
  }

  function tick(now) {
    player.advance(now);
    draw();
    raf = requestAnimationFrame(tick);
  }

  /** Manual mode: pose every lane at `seconds` and render once. */
  function frame(seconds) {
    player.seek(seconds);
    draw();
  }
```

- Start the loop only when interactive: `if (!manual) raf = requestAnimationFrame(tick);`
- Return `frame` in the object, and in `dispose` use `controls?.dispose()`.

Create `app/src/lanes.js` and move `RIVALS` and `lanesFor` there from `run.js`:

```js
// The lanes a publication's stage shows: this run first, then the ducks
// ranked just under it. Shared by the publication page and the clip page, so
// the video races exactly the ducks the page does.

/** How many of the ducks ranked just under this run race beside it. */
export const RIVALS = 3;

export function lanesFor(run) {
  const at = run.board.findIndex((row) => row.you);
  return [run.board[at], ...run.board.slice(at + 1, at + 1 + RIVALS)];
}
```

In `run.js`, delete `RIVALS` and `lanesFor`, and add `import { lanesFor } from "./lanes.js";`.

- [ ] **Step 4: Run the suite and the build**

Run: `cd app && npx vitest run && npm run build`
Expected: `viewer.test.js` passes; the build succeeds.

- [ ] **Step 5: Check the publication page still behaves**

Run: `cd .. && uv run --frozen arena serve --store ~/arena-board --user nicolas --port 8001`, open `http://127.0.0.1:8001/#/r/<any run id from ~/arena-board/runs>`, confirm the chase camera, the orbit on drag and the reveal are unchanged. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app/src/viewer.js app/src/viewer.test.js app/src/lanes.js app/src/run.js
git commit -m "Viewer: a manual mode that renders one frame on demand, a camera spec, a nameplate per lane"
```

---

### Task 5: The clip page

**Files:**
- Create: `app/src/clip/plan.js`, `app/src/clip/score.js`, `app/src/clip/soundtrack.js`, `app/src/clip/main.js`, `app/clip.html`, `app/public/clip.css`
- Modify: `app/vite.config.js`
- Test: `app/src/clip/plan.test.js`, `app/src/clip/score.test.js` (new)

**Interfaces:**
- Produces: `clipPlan(authorFrames, tapeMaxS)`, `stepAt(plan, i)`, `actAt(plan, i)`; `clipScore({ run, plan, trace })`, `jingleFile(eventId, pinned)`; `renderSoundtrack(score, seconds, { Context, load })`; the page's `window.clip = { plan, score, layout, draw(i), soundtrack(), chunk(offset, size), triangles, ready, error }`.
- Consumes: `createViewer` manual mode and `lanesFor` (Task 4), `stadium.js`/`direction.js` (Task 3), `run.event.clip` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `app/src/clip/plan.test.js`:

```js
import { describe, expect, it } from "vitest";
import { actAt, clipPlan, stepAt } from "./plan.js";

describe("clipPlan", () => {
  it("is a second of title, the tape at one clip frame per two trace frames, and a 2.5 s outro", () => {
    const plan = clipPlan(200, 12);
    expect(plan).toMatchObject({ fps: 25, stride: 2, steps: 200, intro: 25, tape: 100, outro: 63 });
    expect(plan.frames).toBe(188);
    expect(plan.seconds).toBeCloseTo(7.52);
    expect(plan.tapeEnd).toBe(125);
    expect(plan.poster).toBe(25 + 60);
  });

  it("cuts a long tape at the event's ceiling", () => {
    expect(clipPlan(5000, 12)).toMatchObject({ steps: 600, tape: 300 });
  });

  it("shows step 0 under the title, the tape at speed, and holds the last step in the outro", () => {
    const plan = clipPlan(200, 12);
    expect(stepAt(plan, 0)).toBe(0);
    expect(stepAt(plan, 25)).toBe(0);
    expect(stepAt(plan, 26)).toBe(2);
    expect(stepAt(plan, 124)).toBe(198);
    expect(stepAt(plan, 187)).toBe(199);
    expect([actAt(plan, 0), actAt(plan, 25), actAt(plan, 125)]).toEqual(["intro", "tape", "outro"]);
  });
});
```

Create `app/src/clip/score.test.js`:

```js
import { describe, expect, it } from "vitest";
import { clipPlan } from "./plan.js";
import { clipScore, jingleFile } from "./score.js";

const event = { id: "sprint-2m", length_m: 2, clip: { sounds: ["crowd", "jingle", "verdict"], jingle: null } };
const trace = new Float32Array(200 * 21);
for (let i = 0; i < 200; i++) trace[i * 21] = i / 100; // x from 0 to 2 m

describe("jingleFile", () => {
  it("is the same variant for the same event, and the pinned one when pinned", () => {
    expect(jingleFile("sprint-2m")).toBe(jingleFile("sprint-2m"));
    expect(jingleFile("sprint-2m")).toMatch(/^round-[0-4]\.wav$/);
    expect(jingleFile("sprint-2m", "round-3")).toBe("round-3.wav");
  });
});

describe("clipScore", () => {
  const plan = clipPlan(200, 12);

  it("cues the jingle on the title, the stamp at the tape end and the victory after it", () => {
    const score = clipScore({ run: { run_id: "R1", event, seeds_finished: 5 }, plan, trace });
    expect(score.cues.map((c) => [c.at, c.file])).toEqual([
      [0, jingleFile("sprint-2m")],
      [5, "stamp.wav"],
      [5.16, "microduck-victory.wav"],
    ]);
    expect(score.crowd).toMatchObject({ start: 1, end: 5, verdict: "pass" });
    expect(score.crowd.progress[0]).toEqual({ second: 1, value: 0 });
    expect(score.crowd.progress.at(-1).value).toBeGreaterThan(0.9);
  });

  it("falls after a DNF, and only plays the sources the event lists", () => {
    const dnf = clipScore({ run: { run_id: "R2", event, seeds_finished: 0 }, plan, trace });
    expect(dnf.cues.at(-1).file).toBe("microduck-fall.wav");
    expect(dnf.crowd.verdict).toBe("fail");
    const quiet = clipScore({
      run: { run_id: "R3", event: { ...event, clip: { sounds: ["crowd"], jingle: null } }, seeds_finished: 5 },
      plan, trace,
    });
    expect(quiet.cues).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd app && npx vitest run src/clip`
Expected: FAIL — modules not found.

- [ ] **Step 3: The plan**

Create `app/src/clip/plan.js`:

```js
// The clip's frame plan: a title card, the tape at speed, an outro on the last
// frame. Pure, so the recorder's expectations and the page's drawing are
// pinned by one test.

import { CTRL_DT } from "../replay.js";

export const FPS = 25;
const INTRO_S = 1;
const OUTRO_S = 2.5;
/** Trace frames per clip frame: the trace is 50 Hz, the clip 25 fps. */
export const STRIDE = Math.round(1 / FPS / CTRL_DT);

/**
 * `authorFrames` is the author's trace length; `tapeMaxS` the event's ceiling.
 * A run longer than the ceiling — a timeout — is cut there and stamped anyway:
 * the verdict is the record's, not the tape's.
 */
export function clipPlan(authorFrames, tapeMaxS) {
  const steps = Math.max(1, Math.min(authorFrames, Math.round(tapeMaxS / CTRL_DT)));
  const intro = FPS * INTRO_S;
  const tape = Math.ceil(steps / STRIDE);
  const outro = Math.round(FPS * OUTRO_S);
  const frames = intro + tape + outro;
  return {
    fps: FPS,
    stride: STRIDE,
    steps,
    intro,
    tape,
    outro,
    frames,
    seconds: frames / FPS,
    tapeEnd: intro + tape,
    poster: intro + Math.floor(tape * 0.6),
  };
}

/** The trace step clip frame `i` shows. */
export function stepAt(plan, i) {
  if (i < plan.intro) return 0;
  return Math.min(plan.steps - 1, (i - plan.intro) * plan.stride);
}

export function actAt(plan, i) {
  return i < plan.intro ? "intro" : i < plan.tapeEnd ? "tape" : "outro";
}
```

- [ ] **Step 4: The score**

Create `app/src/clip/score.js`:

```js
// What the clip sounds like, decided before a frame is drawn: the crowd's
// direction and every cue at its instant. Pure. Each sound source is a
// function here and a name in the event's [clip] sounds.

import { CTRL_DT, frameAt } from "../replay.js";

/** Cue gains, starting where Duck Jam had them; tuned by ear on a real render. */
const GAINS = { jingle: 0.5, stamp: 0.6, voice: 0.4 };
const JINGLES = 5;
/** How often the crowd learns where the duck is, in seconds of tape. */
const PROGRESS_EVERY_S = 0.5;

function fnv(text) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

/** An event's jingle: the variant its id hashes to, unless its manifest pins one. */
export function jingleFile(eventId, pinned = null) {
  return pinned ? `${pinned}.wav` : `round-${fnv(eventId) % JINGLES}.wav`;
}

/** The author's progress down the course, sampled through the tape. */
function progress(trace, plan, lengthM, start) {
  const samples = [];
  for (let t = 0; t < plan.steps * CTRL_DT; t += PROGRESS_EVERY_S) {
    const step = Math.min(plan.steps - 1, Math.round(t / CTRL_DT));
    const value = Math.max(0, Math.min(1, frameAt(trace, step)[0] / lengthM));
    samples.push({ second: start + t, value });
  }
  return samples;
}

const SOURCES = {
  jingle: ({ run }) => [{ at: 0, file: jingleFile(run.event.id, run.event.clip.jingle), gain: GAINS.jingle }],
  verdict: ({ end, verdict }) => [
    { at: end, file: "stamp.wav", gain: GAINS.stamp },
    { at: end + 0.16, file: verdict === "pass" ? "microduck-victory.wav" : "microduck-fall.wav", gain: GAINS.voice },
  ],
};

export function clipScore({ run, plan, trace }) {
  const sounds = run.event.clip.sounds;
  const verdict = run.seeds_finished > 0 ? "pass" : "fail";
  const start = plan.intro / plan.fps;
  const end = plan.tapeEnd / plan.fps;
  const context = { run, end, verdict };
  return {
    // The same run always sounds the same, whichever layout renders it.
    seed: fnv(run.run_id),
    crowd: sounds.includes("crowd")
      ? { start, end, verdict, progress: progress(trace, plan, run.event.length_m, start) }
      : null,
    cues: sounds.flatMap((name) => SOURCES[name]?.(context) ?? []),
  };
}
```

- [ ] **Step 5: Run the two tests**

Run: `cd app && npx vitest run src/clip`
Expected: PASS.

- [ ] **Step 6: The soundtrack in one pass**

Create `app/src/clip/soundtrack.js`:

```js
// The whole soundtrack in one offline render: the stadium's voices under a
// continuous direction, every cue at its instant, a limiter at the end so no
// sample reaches ±1 (the live programme refuses a clip that clips). No
// segments, no smoothing afterwards, no mixing left to ffmpeg.

import { stadiumDirection } from "./direction.js";
import { StadiumAmbience, prepareStadium } from "./stadium.js";

const RATE = 48000;
/** The stadium's own volume scale (0–100). */
const CROWD_VOLUME = 30;
/** Scheduling horizon, from renderStadium: keeps the engine's active nodes bounded. */
const BATCH_S = 0.5;

const fetchWav = (file) => fetch(`/sound/${file}`).then((response) => response.arrayBuffer());

function interleave(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const pcm = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    pcm[2 * i] = left[i];
    pcm[2 * i + 1] = right[i];
  }
  return pcm;
}

/** Interleaved stereo float32 at 48 kHz, exactly `seconds` long. */
export async function renderSoundtrack(score, seconds, { Context = OfflineAudioContext, load = fetchWav } = {}) {
  const context = new Context(2, Math.ceil(seconds * RATE), RATE);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(context.destination);

  const cues = await Promise.all(
    score.cues.map(async (cue) => ({ ...cue, buffer: await context.decodeAudioData(await load(cue.file)) })),
  );
  for (const cue of cues) {
    const source = context.createBufferSource();
    source.buffer = cue.buffer;
    const gain = context.createGain();
    gain.gain.value = cue.gain;
    source.connect(gain);
    gain.connect(limiter);
    source.start(cue.at);
  }

  if (!score.crowd) return interleave(await context.startRendering());

  await prepareStadium(Context);
  const engine = new StadiumAmbience(context, {
    direction: stadiumDirection(score.crowd),
    seed: score.seed,
    volume: CROWD_VOLUME,
    destination: limiter,
  });
  // renderStadium's batching: schedule half a second ahead, suspending one
  // render quantum before each horizon, because Chrome rounds suspension
  // times to block boundaries.
  const end = seconds - 0.09;
  const queue = (time) => {
    engine.scheduleUntil(Math.min(time, end));
    if (time >= end) engine.stop(end);
  };
  queue(BATCH_S);
  const pauses = [];
  for (let time = BATCH_S; time < seconds; time += BATCH_S) {
    pauses.push(context.suspend(time - 128 / RATE).then(() => {
      queue(time + BATCH_S);
      return context.resume();
    }));
  }
  try {
    const [buffer] = await Promise.all([context.startRendering(), ...pauses]);
    return interleave(buffer);
  } finally {
    engine.dispose();
  }
}
```

- [ ] **Step 7: The page**

Create `app/src/clip/main.js`:

```js
// The clip: the page the recorder photographs one frame at a time. It draws
// nothing on a clock of its own — the recorder asks for frame i, gets it, and
// asks for the soundtrack once. ?run=<id>&layout=landscape|vertical&frame=N.

import { getRun, getTrace } from "../api.js";
import { LANE_COLORS, LANE_CSS } from "../course.js";
import { formatScore } from "../format.js";
import { lanesFor } from "../lanes.js";
import { CTRL_DT, frameCount } from "../replay.js";
import { createViewer } from "../viewer.js";
import { actAt, clipPlan, stepAt } from "./plan.js";
import { clipScore } from "./score.js";
import { renderSoundtrack } from "./soundtrack.js";

/** How much further back the camera stands in a portrait frame. Tuned by eye. */
const VERTICAL_DISTANCE = 1.6;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const layout = params.get("layout") === "vertical" ? "vertical" : "landscape";
document.documentElement.dataset.layout = layout;

function clock(step) {
  const seconds = step * CTRL_DT;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  const cc = String(Math.floor((seconds % 1) * 100)).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}

/** The words on the frame, from the run and nothing else. */
function letter(run) {
  const who = `@${run.user} · ${run.policy_name}`;
  const earned = run.receipts.reduce((sum, r) => sum + r.points, 0);
  const dnf = run.seeds_finished === 0;
  for (const id of ["top-title", "intro-title"]) $(id).textContent = run.event.title;
  $("top-participant").textContent = who;
  $("intro-line").textContent = who;
  $("osd-rec").textContent = `REC · ${who}`;
  $("osd-event").textContent = run.event.title.toUpperCase();
  $("fig-time").textContent = formatScore(run.score, { finished: run.seeds_finished });
  $("fig-place").textContent = run.on_board && !run.withdrawn ? `#${run.rank}` : "—";
  $("fig-points").textContent = earned > 0 ? `+${earned}` : "—";
  $("weights").textContent = run.policy_url ? run.policy_url.replace(/^https?:\/\//, "") : "";
  const stamp = $("stamp");
  stamp.textContent = dnf ? "DNF" : `FINISHED ${run.seeds_finished}/${run.seeds_total}`;
  stamp.classList.add(dnf ? "stamp-fail" : "stamp-pass");
}

function base64(bytes) {
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result.split(",")[1]);
    reader.readAsDataURL(new Blob([bytes]));
  });
}

async function main() {
  const run = await getRun(params.get("run"));
  const lanes = lanesFor(run);
  const traces = await Promise.all(lanes.map((lane) => getTrace(lane.run_id)));
  const config = run.event.clip;
  const camera = layout === "vertical" ? { ...config.camera, distance: VERTICAL_DISTANCE } : config.camera;
  const viewer = await createViewer($("stage"), { rig: run.event.rig, manual: true, camera });
  viewer.setLanes(
    lanes.map((lane, i) => ({
      runId: lane.run_id,
      trace: traces[i],
      livery: lane.livery,
      colour: LANE_COLORS[i % LANE_COLORS.length],
      opacity: 1,
      name: `@${lane.user}`,
      nameColour: LANE_CSS[i % LANE_CSS.length],
    })),
    run.event,
    { loop: false },
  );
  const plan = clipPlan(frameCount(traces[0]), config.tape_max_s);
  const score = clipScore({ run, plan, trace: traces[0] });
  letter(run);

  /** Frame `i` of the plan. Returns the trace step it drew. */
  function draw(i) {
    const act = actAt(plan, i);
    const step = stepAt(plan, i);
    viewer.frame(step * CTRL_DT);
    $("osd-clock").textContent = clock(step);
    $("intro").hidden = act !== "intro";
    $("stamp").hidden = act !== "outro";
    $("sheet").hidden = !(act === "outro" || layout === "vertical");
    return step;
  }

  let pcm = null;
  window.clip = {
    plan,
    score,
    layout,
    draw,
    ready: true,
    error: null,
    /** Renders the whole soundtrack; resolves to its byte length. */
    async soundtrack() {
      pcm = new Uint8Array((await renderSoundtrack(score, plan.seconds)).buffer);
      return pcm.byteLength;
    },
    /** One slice of it, base64, for a transfer in bounded pieces. */
    chunk(offset, size) {
      return base64(pcm.subarray(offset, Math.min(offset + size, pcm.byteLength)));
    },
  };
  draw(Number(params.get("frame") ?? plan.poster));
}

main().catch((jammed) => {
  $("jam").hidden = false;
  $("jam-why").textContent = jammed.message;
  window.clip = { error: jammed.message, ready: true };
  throw jammed;
});
```

- [ ] **Step 8: The frame**

Create `app/clip.html`:

```html
<!doctype html>
<html lang="en" data-layout="landscape">
  <head>
    <meta charset="utf-8" />
    <title>Clip — Microduck Arena</title>
    <link rel="stylesheet" href="/design/tokens.css" />
    <link rel="stylesheet" href="/design/effects.css" />
    <link rel="stylesheet" href="/design/components.css" />
    <link rel="stylesheet" href="/clip.css" />
  </head>
  <body>
    <div class="frame">
      <section class="band band-top">
        <p class="eyebrow">Microduck Arena</p>
        <h1 class="marquee-title" id="top-title">Event</h1>
        <p class="participant" id="top-participant"></p>
      </section>

      <div class="screen fx-scanlines fx-scanlines-screen">
        <canvas id="stage" aria-label="The run against the ducks ranked under it"></canvas>
        <p class="crt-osd crt-osd-rec mono-label"><b>●</b> <span id="osd-rec">REC</span></p>
        <p class="crt-osd crt-osd-clock mono-label" id="osd-clock">00:00.00</p>
        <p class="crt-osd osd-event mono-label" id="osd-event"></p>
        <div class="stamp fx-tilt-2-5" id="stamp" hidden></div>
      </div>

      <section class="band band-bottom" id="sheet" hidden>
        <div class="figures">
          <div class="figure"><span class="figure-value" id="fig-time">—</span><span class="mono-label">time</span></div>
          <div class="figure"><span class="figure-value" id="fig-place">—</span><span class="mono-label">place</span></div>
          <div class="figure"><span class="figure-value" id="fig-points">—</span><span class="mono-label">points</span></div>
        </div>
        <p class="mono-label weights" id="weights"></p>
      </section>

      <section class="card" id="intro">
        <p class="eyebrow">Microduck Arena</p>
        <h1 class="marquee-title" id="intro-title">Event</h1>
        <p class="mono-label" id="intro-line"></p>
      </section>

      <div class="jam" id="jam" hidden>
        <div class="stamp stamp-fail fx-tilt-2-5">The tape jammed</div>
        <p class="mono-label" id="jam-why"></p>
      </div>
    </div>
    <script type="module" src="/src/clip/main.js"></script>
  </body>
</html>
```

Create `app/public/clip.css`:

```css
/* The clip: the frame the recorder photographs. ?layout=landscape is
   1920 × 1080, ?layout=vertical is 1080 × 1920, and the recorder sets the
   viewport to the same. Only placement lives here: colour, type and the
   stamp are the design system's. */
* { box-sizing: border-box; border-radius: 0; }
html { font-size: 28px; }
html, body { margin: 0; background: var(--deep-ink); color: var(--paper); font-family: var(--body); }
.frame { position: relative; overflow: hidden; display: flex; flex-direction: column; }
[data-layout="landscape"] .frame { width: 1920px; height: 1080px; }
[data-layout="vertical"] .frame { width: 1080px; height: 1920px; }

/* The screen: the stage fills it, the OSD sits in its corners, scanlines on ::after. */
.screen { position: relative; flex: 1; min-height: 0; background: var(--deep-ink); }
.screen canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.screen .crt-osd { z-index: 2; }
.crt-osd b { color: var(--magenta); font-weight: inherit; }
.osd-event { left: 18px; bottom: 14px; color: var(--yellow); }
[data-layout="vertical"] .osd-event { display: none; }
.screen::after { z-index: 3; }

/* The stamp lands on the screen at the outro, over the last thing the duck did. */
.screen .stamp { position: absolute; right: 6%; top: 10%; z-index: 4; }

/* The bands: the marquee above, the figures below. Vertical has room for both
   for the whole tape; landscape shows the figures only at the outro. */
.band { position: relative; z-index: 5; padding: 36px 54px; background: var(--ink); }
.band-top .eyebrow { color: var(--sky); }
.band-top .marquee-title { margin-top: 4px; }
.participant { font-size: 1.7rem; line-height: 1.2; margin: 12px 0 0; overflow-wrap: anywhere; }
.band-bottom .figures { grid-template-columns: repeat(3, 1fr); gap: 18px; }
.band-bottom .weights { overflow-wrap: anywhere; margin: 12px 0 0; color: var(--sky); }
[data-layout="landscape"] .band-top { display: none; }
[data-layout="landscape"] .band-bottom { position: absolute; left: 0; right: 0; bottom: 0; }

/* The title card: full frame, for the first second. */
.card { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; justify-content: center; padding: 0 9%; background: var(--ink); }
.card .eyebrow { color: var(--sky); }
.card .marquee-title { margin: 8px 0 0; font-size: var(--type-hero-title-size); }
.card .mono-label { margin: 28px 0 0; color: var(--paper); }

/* The tape jammed: the frame says why rather than going blank. */
.jam { position: absolute; inset: 0; z-index: 7; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 18px; background: var(--deep-ink); }

/* Last, so hiding beats every display above. */
[hidden] { display: none; }
```

- [ ] **Step 9: The second Vite entry**

In `app/vite.config.js`:

```js
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Two pages: the app, and the clip the recorder photographs.
    rollupOptions: { input: { main: page("index.html"), clip: page("clip.html") } },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  test: { environment: "jsdom" },
});
```

- [ ] **Step 10: Build and look at the page in a browser**

Run: `cd app && npm run build && ls dist/clip.html && cd .. && uv run --frozen arena serve --store ~/arena-board --user nicolas --port 8001`

Open `http://127.0.0.1:8001/clip.html?run=<run id>&layout=landscape&frame=0` (title card), `&frame=60` (the tape: four named ducks, the OSD), `&frame=170` (the stamp and the figures), and the same three with `layout=vertical`. In the console: `await window.clip.soundtrack()` returns a byte length after a few seconds. Fix what looks wrong (nameplate height and lift in `viewer.js`, `VERTICAL_DISTANCE`) before moving on. Stop the server.

- [ ] **Step 11: Commit**

```bash
git add app/clip.html app/public/clip.css app/vite.config.js app/src/clip
git commit -m "The clip page: the arena's stage frame by frame, its plan, its score, and the soundtrack in one pass"
```

---

### Task 6: Chrome over the DevTools protocol, and the capture measurement

**Files:**
- Create: `arena/recorder.py` (the Chrome part; Task 7 adds the render)
- Create: `scripts/probe_capture.py`
- Modify: `pyproject.toml` (add `"websockets>=13"`), `uv.lock`

**Interfaces:**
- Produces: `find_chrome() -> str | None`; `class Chrome(binary, nice=10)` with `tab(width, height) -> Tab`, `close()`, context manager; `class Tab` with `navigate(url)`, `wait_ready(timeout_s)`, `evaluate(expression, await_promise=False)`, `send(method, params=None)`, `close()`; `niced(args, nice) -> list[str]`; `ffmpeg_available() -> bool`.

- [ ] **Step 1: Add the dependency**

In `pyproject.toml` `dependencies`, after `"httpx>=0.27,<1",`: `"websockets>=13",` with the comment `# The recorder's DevTools client (arena/recorder.py).` Then:

Run: `uv lock && uv sync && git diff --stat uv.lock`
Expected: `uv.lock` gains `websockets`; if the diff rewrites unrelated URLs (the local mirror), keep only the `websockets` hunks (`git add -p uv.lock`).

- [ ] **Step 2: The Chrome driver**

Create `arena/recorder.py`:

```python
"""Headless Chromium over the DevTools protocol, and one run's clips out of it.

The page does the drawing (app/clip.html); this module opens it at exactly the
layout's size, asks it for one frame at a time, and hands the frames to ffmpeg.
The client is the protocol's JSON over a websocket and nothing more: a call is
a message with an id and the reply that carries the same id.
"""

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

CHROMES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)


def find_chrome() -> str | None:
    """$CHROME, else the first browser at its usual place. None means no clips."""
    named = os.environ.get("CHROME")
    if named:
        return named if Path(named).exists() else None
    return next((path for path in CHROMES if Path(path).exists()), None)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def niced(args: list[str], nice: int) -> list[str]:
    """Under `nice` where there is one: a render never starves an evaluation."""
    return ["nice", "-n", str(nice), *args] if shutil.which("nice") else args


class Tab:
    """One page in the browser, on a websocket of its own so tabs can be driven
    from separate threads without sharing a reader."""

    def __init__(self, endpoint: str, width: int, height: int):
        from websockets.sync.client import connect

        self.socket = connect(endpoint, max_size=None)
        self._id = 0
        target = self._call("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self._call("Target.attachToTarget", {"targetId": target, "flatten": True})[
            "sessionId"
        ]
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
        self.send("Page.enable")

    def _call(self, method: str, params: dict | None = None, session: str | None = None) -> dict:
        self._id += 1
        message = {"id": self._id, "method": method, "params": params or {}}
        if session:
            message["sessionId"] = session
        self.socket.send(json.dumps(message))
        while True:
            reply = json.loads(self.socket.recv())
            # Events carry no id and are not waited on: readiness is polled.
            if reply.get("id") != self._id:
                continue
            if "error" in reply:
                raise RuntimeError(f"{method}: {reply['error'].get('message')}")
            return reply["result"]

    def send(self, method: str, params: dict | None = None) -> dict:
        return self._call(method, params, self.session)

    def evaluate(self, expression: str, await_promise: bool = False):
        result = self.send("Runtime.evaluate", {
            "expression": expression, "awaitPromise": await_promise, "returnByValue": True,
        })
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            raise RuntimeError(details.get("exception", {}).get("description") or details.get("text"))
        return result["result"].get("value")

    def navigate(self, url: str) -> None:
        self.send("Page.navigate", {"url": url})

    def wait_ready(self, timeout_s: float = 60.0) -> None:
        """Until the page has drawn its first frame, or said why it cannot."""
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if self.evaluate("Boolean(window.clip && window.clip.ready)"):
                self.evaluate("document.fonts.ready.then(() => true)", await_promise=True)
                error = self.evaluate("window.clip.error")
                if error:
                    raise RuntimeError(f"the tape jammed: {error}")
                return
            time.sleep(0.1)
        raise TimeoutError("the clip never drew a frame")

    def close(self) -> None:
        self.socket.close()


class Chrome:
    """One headless browser with a profile of its own, killed rather than asked
    to leave: Chrome outlives a SIGTERM."""

    FLAGS = ("--headless=new", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
             "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox",
             "--remote-debugging-port=0")

    def __init__(self, binary: str, nice: int = 10):
        self.profile = tempfile.mkdtemp(prefix="arena-chrome-")
        self.process = subprocess.Popen(
            niced([binary, *self.FLAGS, f"--user-data-dir={self.profile}", "about:blank"], nice),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        self.endpoint = self._endpoint()

    def _endpoint(self, timeout_s: float = 20.0) -> str:
        deadline = time.monotonic() + timeout_s
        said = ""
        while time.monotonic() < deadline:
            line = self.process.stderr.readline()
            if not line:
                if self.process.poll() is not None:
                    break
                continue
            said += line
            if "ws://" in line:
                return line[line.index("ws://"):].split()[0]
        raise RuntimeError(f"Chrome opened no DevTools endpoint: {said.strip()}")

    def tab(self, width: int, height: int) -> Tab:
        return Tab(self.endpoint, width, height)

    def close(self) -> None:
        try:
            self.process.kill()
            self.process.wait(timeout=5)
        finally:
            shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
```

- [ ] **Step 3: The probe**

Create `scripts/probe_capture.py`:

```python
"""Measure what a clip frame costs, three ways, on the real clip page.

    uv run --frozen python scripts/probe_capture.py --origin http://127.0.0.1:8001 \
        --run <run_id> --layout landscape --frames 40

Prints milliseconds per frame for: the page's own draw (JavaScript only), a
PNG screenshot, a JPEG q92 screenshot, an in-page JPEG readback (raster +
encode, no protocol), a VideoFrame readback and a VP9 WebCodecs encode. The
spec's rule: if rasterisation dominates, JPEG screenshots; if the capture
does, WebCodecs.
"""

import argparse
import statistics
import time

from arena.recorder import Chrome, find_chrome

SIZES = {"landscape": (1920, 1080), "vertical": (1080, 1920)}

WEBCODECS = """
(async () => {
  const canvas = document.getElementById("stage");
  const support = await VideoEncoder.isConfigSupported({ codec: "vp09.00.10.08", width: canvas.width, height: canvas.height, bitrate: 12_000_000, framerate: 25 });
  if (!support.supported) return { supported: false };
  let chunks = 0;
  const encoder = new VideoEncoder({ output: () => chunks++, error: (e) => { throw e; } });
  encoder.configure(support.config);
  const t0 = performance.now();
  for (let i = 0; i < %(frames)d; i++) {
    window.clip.draw(%(first)d + i);
    const frame = new VideoFrame(canvas, { timestamp: i * 40000 });
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }
  await encoder.flush();
  return { supported: true, ms: (performance.now() - t0) / %(frames)d, chunks };
})()
"""


def timed(fn, n):
    samples = []
    for _ in range(n):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--layout", default="landscape", choices=SIZES)
    parser.add_argument("--frames", type=int, default=40)
    args = parser.parse_args()
    width, height = SIZES[args.layout]
    with Chrome(find_chrome()) as chrome:
        tab = chrome.tab(width, height)
        tab.navigate(f"{args.origin}/clip.html?run={args.run}&layout={args.layout}&frame=0")
        tab.wait_ready()
        plan = tab.evaluate("window.clip.plan")
        first = plan["intro"] + 5
        i = [first]

        def draw():
            tab.evaluate(f"window.clip.draw({i[0]})")
            i[0] += 1

        print(f"{args.layout} {width}x{height}, {plan['frames']} frames planned")
        print(f"draw only            {timed(draw, args.frames):7.1f} ms")
        print(f"draw + png shot      {timed(lambda: (draw(), tab.send('Page.captureScreenshot', {'format': 'png', 'optimizeForSpeed': True})), args.frames):7.1f} ms")
        print(f"draw + jpeg shot     {timed(lambda: (draw(), tab.send('Page.captureScreenshot', {'format': 'jpeg', 'quality': 92})), args.frames):7.1f} ms")
        print(f"draw + jpeg in page  {timed(lambda: (draw(), tab.evaluate('document.getElementById(\"stage\").toDataURL(\"image/jpeg\", 0.92).length')), args.frames):7.1f} ms")
        print(f"draw + VideoFrame    {timed(lambda: (draw(), tab.evaluate('(() => { const f = new VideoFrame(document.getElementById(\"stage\"), { timestamp: 0 }); f.close(); return 1 })()')), args.frames):7.1f} ms")
        vp9 = tab.evaluate(WEBCODECS % {"frames": args.frames, "first": i[0]}, await_promise=True)
        print(f"draw + vp9 encode    {vp9['ms']:7.1f} ms ({vp9['chunks']} chunks)" if vp9["supported"] else "vp9 encode           unsupported")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Measure**

Run `uv run --frozen arena serve --store ~/arena-board --user nicolas --port 8001` in one terminal, and in another:

```bash
uv run --frozen python scripts/probe_capture.py --origin http://127.0.0.1:8001 --run <run_id> --layout landscape
uv run --frozen python scripts/probe_capture.py --origin http://127.0.0.1:8001 --run <run_id> --layout vertical
```

Record the six numbers per layout in this plan under *Measurements* below. Apply the rule: `draw + jpeg shot` minus `draw + jpeg in page` is the protocol's cost; `draw + VideoFrame` is the raster alone. If `draw + jpeg shot` is within 30 % of `draw + VideoFrame`, rasterisation dominates and Task 7 proceeds as written (JPEG screenshots). Otherwise stop, and re-plan Task 7 around WebCodecs before continuing.

- [ ] **Step 5: Commit**

```bash
git add arena/recorder.py scripts/probe_capture.py pyproject.toml uv.lock
git commit -m "Recorder: Chromium over the DevTools protocol, and a probe that prices a frame three ways"
```

**Measurements** (filled in at execution):

| layout | draw | png shot | jpeg shot | jpeg in page | VideoFrame | vp9 |
| --- | --- | --- | --- | --- | --- | --- |
| landscape | | | | | | |
| vertical | | | | | | |

---

### Task 7: Recording one run — frames to ffmpeg, the soundtrack, the poster

**Files:**
- Modify: `arena/recorder.py` (append)
- Test: `tests/test_clips.py` (append the `ffmpeg_args` test)

**Interfaces:**
- Produces: `SIZES = {"landscape": (1920, 1080), "vertical": (1080, 1920)}`; `ffmpeg_args(fps: int, pcm: Path, out: Path) -> list[str]` (pure); `RenderedLayout(mp4: bytes, plan: dict, crowd: dict | None, timing: dict)`; `RenderedRun(layouts: dict[str, RenderedLayout], poster: bytes)`; `record_run(origin: str, run_id: str, parallel: int = 1, binary: str | None = None) -> RenderedRun`.
- Consumes: `Chrome`, `Tab` (Task 6); the page's `window.clip` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_clips.py`:

```python
from pathlib import Path

from arena.recorder import ffmpeg_args


def test_the_encode_is_h264_with_the_pcm_muxed_and_the_live_tag_set():
    args = ffmpeg_args(25, Path("/tmp/s.f32"), Path("/tmp/out.mp4"))
    assert args[:2] == ["ffmpeg", "-y"]
    assert ["-f", "image2pipe", "-framerate", "25", "-c:v", "mjpeg", "-i", "-"] == args[4:12]
    assert ["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "/tmp/s.f32"] == args[12:20]
    for option in (["-c:v", "libx264"], ["-crf", "23"], ["-pix_fmt", "yuv420p"],
                   ["-c:a", "aac"], ["-b:a", "192k"], ["-metadata", "crowdMixed=true"],
                   ["-movflags", "+faststart+use_metadata_tags"]):
        assert option[1] == args[args.index(option[0]) + 1]
    assert args[-1] == "/tmp/out.mp4"
```

- [ ] **Step 2: Run it**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: FAIL — `ImportError: cannot import name 'ffmpeg_args'`.

- [ ] **Step 3: Implement the render**

Append to `arena/recorder.py` (add `import base64`, `import threading`, `from concurrent.futures import ThreadPoolExecutor`, `from dataclasses import dataclass`, `import platform` to the imports):

```python
SIZES = {"landscape": (1920, 1080), "vertical": (1080, 1920)}
# The soundtrack comes out of the page in pieces this big, base64 over the protocol.
CHUNK = 4 << 20
JPEG_QUALITY = 92


def ffmpeg_args(fps: int, pcm: Path, out: Path) -> list[str]:
    """H.264 at CRF 23 with the page's PCM muxed as AAC, faststart, and the
    `crowdMixed` tag the live programme reads before it decides whether to add
    a crowd of its own."""
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
        "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", str(pcm),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-metadata", "crowdMixed=true", "-movflags", "+faststart+use_metadata_tags",
        str(out),
    ]


@dataclass(frozen=True)
class RenderedLayout:
    mp4: bytes
    plan: dict
    crowd: dict | None
    timing: dict


@dataclass(frozen=True)
class RenderedRun:
    layouts: dict[str, RenderedLayout]
    poster: bytes


def _open(chrome: Chrome, origin: str, run_id: str, layout: str) -> Tab:
    width, height = SIZES[layout]
    tab = chrome.tab(width, height)
    tab.navigate(f"{origin}/clip.html?run={run_id}&layout={layout}&frame=0")
    tab.wait_ready()
    return tab


def _soundtrack(tab: Tab) -> bytes:
    """The whole soundtrack, rendered in the page and carried over in pieces."""
    length = tab.evaluate("window.clip.soundtrack()", await_promise=True)
    pcm = bytearray()
    for offset in range(0, length, CHUNK):
        pcm += base64.b64decode(tab.evaluate(f"window.clip.chunk({offset}, {CHUNK})", await_promise=True))
    return bytes(pcm)


def _record_layout(tab: Tab, pcm_path: Path, out: Path, nice: int) -> tuple[RenderedLayout, bytes]:
    plan = tab.evaluate("window.clip.plan")
    crowd = tab.evaluate("window.clip.score.crowd")
    opened = time.monotonic()
    ffmpeg = subprocess.Popen(niced(ffmpeg_args(plan["fps"], pcm_path, out), nice), stdin=subprocess.PIPE)
    poster = b""
    draw_s = shot_s = 0.0
    for i in range(plan["frames"]):
        asked = time.monotonic()
        tab.evaluate(f"window.clip.draw({i})")
        drawn = time.monotonic()
        shot = tab.send("Page.captureScreenshot", {"format": "jpeg", "quality": JPEG_QUALITY})
        if i == plan["poster"]:
            poster = base64.b64decode(tab.send("Page.captureScreenshot", {"format": "png"})["data"])
        draw_s += drawn - asked
        shot_s += time.monotonic() - drawn
        ffmpeg.stdin.write(base64.b64decode(shot["data"]))
    ffmpeg.stdin.close()
    if ffmpeg.wait() != 0:
        raise RuntimeError(f"ffmpeg exited {ffmpeg.returncode}")
    frames = plan["frames"]
    timing = {
        "draw_ms_per_frame": round(1000 * draw_s / frames, 1),
        "capture_ms_per_frame": round(1000 * shot_s / frames, 1),
        "total_wall_ms": round(1000 * (time.monotonic() - opened)),
        "cores": os.cpu_count(),
        "load": [round(x, 1) for x in os.getloadavg()],
        "machine": f"{platform.system()} {platform.machine()}",
    }
    return RenderedLayout(mp4=out.read_bytes(), plan=plan, crowd=crowd, timing=timing), poster


def record_run(origin: str, run_id: str, parallel: int = 1, binary: str | None = None,
               nice: int = 10) -> RenderedRun:
    """Every layout of one run. One browser; the first tab renders the
    soundtrack every layout shares; tabs are recorded `parallel` at a time.
    The poster is the landscape clip's."""
    binary = binary or find_chrome()
    if binary is None:
        raise RuntimeError("no Chrome found: set $CHROME")
    if not ffmpeg_available():
        raise RuntimeError("no ffmpeg on the PATH")
    with Chrome(binary, nice) as chrome, tempfile.TemporaryDirectory(prefix="arena-clip-") as work:
        work = Path(work)
        tabs = {"landscape": _open(chrome, origin, run_id, "landscape")}
        pcm_path = work / "soundtrack.f32"
        pcm_path.write_bytes(_soundtrack(tabs["landscape"]))
        for layout in SIZES:
            if layout not in tabs:
                tabs[layout] = _open(chrome, origin, run_id, layout)

        def one(layout: str) -> tuple[str, RenderedLayout, bytes]:
            rendered, poster = _record_layout(tabs[layout], pcm_path, work / f"{layout}.mp4", nice)
            tabs[layout].close()
            return layout, rendered, poster

        with ThreadPoolExecutor(max_workers=max(1, parallel)) as pool:
            results = list(pool.map(one, SIZES))
    layouts = {layout: rendered for layout, rendered, _ in results}
    poster = next(poster for layout, _, poster in results if layout == "landscape")
    return RenderedRun(layouts=layouts, poster=poster)
```

- [ ] **Step 4: Run the test**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add arena/recorder.py tests/test_clips.py
git commit -m "Recorder: one run's layouts out of one browser, the soundtrack shared, frames piped to ffmpeg"
```

---

### Task 8: The worker, the config, the app, and the publish hook

**Files:**
- Create: `arena/clips.py`
- Modify: `arena/web/config.py` (fields + `from_env`), `arena/web/app.py` (state + startup), `arena/web/routes_submit.py:365` (after `store.append`), `arena/cli.py:112-127` (`_cmd_serve` passes the origin)
- Test: `tests/test_clips.py` (append)

**Interfaces:**
- Produces: `CLIP_VERSION = 1`; `clip_manifest(run_id, rendered: RenderedRun, rendered_at: str) -> dict`; `class ClipRenderer(store, origin, frontend_dir, parallel=1, render=record_run, log=print)` with `available: bool`, `enqueue(run_id)`, `drain()`, `start()`, `render_one(run_id)`, `queue`; `ArenaConfig.origin`, `.public_origin`, `.clip_parallel`, `.clip_worker`; `app.state.clips`.
- Consumes: `record_run`, `RenderedRun` (Task 7); the store's clip methods (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_clips.py`:

```python
from fastapi.testclient import TestClient

from arena.clips import CLIP_VERSION, ClipRenderer, clip_manifest
from arena.recorder import RenderedLayout, RenderedRun
from arena.web.app import create_app
from arena.web.config import ArenaConfig


def rendered(seconds=7.52):
    layout = lambda w, h: RenderedLayout(  # noqa: E731
        mp4=b"mp4", plan={"fps": 25, "frames": 188, "seconds": seconds},
        crowd={"start": 1.0, "end": 5.0, "verdict": "pass"}, timing={"total_wall_ms": 1},
    )
    return RenderedRun(layouts={"landscape": layout(1920, 1080), "vertical": layout(1080, 1920)},
                       poster=b"png")


def test_the_manifest_carries_the_live_contract_per_layout():
    manifest = clip_manifest("R1", rendered(), "2026-09-16T10:00:00Z")
    assert manifest["version"] == CLIP_VERSION
    assert manifest["poster"] == "poster.png"
    land = manifest["layouts"]["landscape"]
    assert land == {
        "file": "landscape.mp4", "width": 1920, "height": 1080, "fps": 25, "frames": 188,
        "seconds": 7.52, "crowdMixed": True,
        "crowdDirection": {"start": 1.0, "end": 5.0, "verdict": "pass"},
        "timing": {"total_wall_ms": 1},
    }
    assert manifest["layouts"]["vertical"]["width"] == 1080


def test_the_worker_renders_what_is_owed_and_records_a_failure(tmp_path):
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    store.mark_clip_pending("R2", "bob", "sprint-2m", "2026-09-16T10:01:00Z")

    def render(origin, run_id, parallel):
        if run_id == "R2":
            raise RuntimeError("ffmpeg exited 1")
        return rendered()

    said = []
    worker = ClipRenderer(store, "http://127.0.0.1:1", tmp_path, render=render, log=said.append)
    worker.drain()
    assert list(worker.queue.queue) == ["R1", "R2"]
    while not worker.queue.empty():
        worker.render_one(worker.queue.get())
    state, manifest = store.clip_state("R1")
    assert state == "ready" and manifest["run_id"] == "R1"
    assert store.clip_file("R1", "vertical.mp4").read_bytes() == b"mp4"
    assert store.clip_state("R2") == ("failed", None)
    assert any("RuntimeError: ffmpeg exited 1" in line for line in said)


def test_a_publish_owes_a_clip_only_where_a_renderer_exists(tmp_path, monkeypatch):
    from tests.test_routes_submit import REFERENCE, submit

    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie", clip_worker=False)
    app = create_app(config)
    api = TestClient(app)
    run_id = submit(api, REFERENCE).json()["run_id"]
    assert app.state.store.clip_state(run_id) == ("none", None)

    monkeypatch.setattr(app.state.clips, "available", True)
    run_id = submit(api, REFERENCE).json()["run_id"]
    assert app.state.store.clip_state(run_id) == ("pending", None)
    assert list(app.state.clips.queue.queue) == [run_id]
```

- [ ] **Step 2: Run them**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: FAIL — `ModuleNotFoundError: arena.clips`.

- [ ] **Step 3: The worker**

Create `arena/clips.py`:

```python
"""A clip per publish, rendered in the background by one worker.

The publish response never waits for a video. The route marks the run
`pending`, the worker takes runs one at a time, and the store ends up with
`clip.json` and the media or `failed.json` and a reason. A redeploy that kills
a render leaves the marker, and `drain` at the next boot picks it up.
"""

import queue
import threading
import traceback
from datetime import UTC, datetime
from pathlib import Path

from .recorder import SIZES, RenderedRun, ffmpeg_available, find_chrome, record_run

# Written into every clip.json. Bumping it does not re-render older clips.
CLIP_VERSION = 1


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def clip_manifest(run_id: str, rendered: RenderedRun, rendered_at: str) -> dict:
    """What a ready clip says about itself: the live programme's contract per
    layout — size, rate, `crowdMixed`, `crowdDirection` — and the timing that
    prices a render on the machine that made it."""
    layouts = {}
    for name, layout in rendered.layouts.items():
        width, height = SIZES[name]
        layouts[name] = {
            "file": f"{name}.mp4",
            "width": width,
            "height": height,
            "fps": layout.plan["fps"],
            "frames": layout.plan["frames"],
            "seconds": layout.plan["seconds"],
            "crowdMixed": True,
            "crowdDirection": (
                {k: layout.crowd[k] for k in ("start", "end", "verdict")} if layout.crowd else None
            ),
            "timing": layout.timing,
        }
    return {"run_id": run_id, "version": CLIP_VERSION, "rendered_at": rendered_at,
            "poster": "poster.png", "layouts": layouts}


class ClipRenderer:
    def __init__(self, store, origin: str, frontend_dir: Path | None, parallel: int = 1,
                 render=record_run, log=print):
        self.store = store
        self.origin = origin
        self.parallel = parallel
        self.render = render
        self.log = log
        # No Chrome, no ffmpeg or no built clip page is a supported setup — a
        # developer machine — not an error: publishes then owe no clip.
        self.available = bool(
            frontend_dir and (frontend_dir / "clip.html").is_file()
            and find_chrome() and ffmpeg_available()
        )
        self.queue: queue.Queue[str] = queue.Queue()

    def enqueue(self, run_id: str) -> None:
        self.queue.put(run_id)

    def drain(self) -> None:
        """Everything owed and not yet rendered or failed — after a restart."""
        for run_id in self.store.pending_clips():
            self.enqueue(run_id)

    def start(self) -> None:
        self.drain()
        threading.Thread(target=self._work, name="arena-clips", daemon=True).start()

    def _work(self) -> None:
        while True:
            self.render_one(self.queue.get())

    def render_one(self, run_id: str) -> None:
        self.log(f"clip: rendering {run_id}")
        try:
            rendered = self.render(self.origin, run_id, parallel=self.parallel)
            import json

            files = {"clip.json": json.dumps(clip_manifest(run_id, rendered, _now()), indent=2).encode(),
                     "poster.png": rendered.poster,
                     **{f"{name}.mp4": layout.mp4 for name, layout in rendered.layouts.items()}}
            self.store.put_clip(run_id, files)
            wall = max(layout.timing.get("total_wall_ms", 0) for layout in rendered.layouts.values())
            self.log(f"clip: {run_id} ready ({wall / 1000:.0f} s)")
        except Exception as exc:  # noqa: BLE001 — a failed clip must never take the worker down
            self.store.fail_clip(run_id, _now(), f"{type(exc).__name__}: {exc}")
            self.log(f"clip: {run_id} failed ({type(exc).__name__}: {exc})")
            self.log(traceback.format_exc())
```

Move `import json` to the module imports (it is shown inline above only to keep the diff readable — put it at the top).

- [ ] **Step 4: The config**

In `arena/web/config.py`, add to `ArenaConfig` after `session_ttl_s`:

```python
    # Where the clip recorder's own Chrome loads clip.html: this server, on
    # loopback. `arena serve` passes its port; ARENA_ORIGIN overrides.
    origin: str = "http://127.0.0.1:8000"
    # The address a shared link carries. A Space knows its host; locally there
    # is none, and the unfurl route falls back to the request's.
    public_origin: str | None = None
    # Layouts rendered at once. Half the cores: SwiftShader takes every core a
    # frame can get, so a 2-vCPU Space renders one layout at a time.
    clip_parallel: int = 1
    # Whether this process runs the clip worker. `arena clip` turns it off so
    # its one render is not raced by a drain of everything else owed.
    clip_worker: bool = True
```

Extend `from_env` with `origin: str | None = None, clip_worker: bool = True` parameters, and in the return:

```python
            origin=origin or os.environ.get("ARENA_ORIGIN") or "http://127.0.0.1:8000",
            public_origin=(f"https://{host}" if (host := os.environ.get("SPACE_HOST")) else None),
            clip_parallel=int(os.environ.get("ARENA_CLIP_PARALLEL") or max(1, (os.cpu_count() or 2) // 2)),
            clip_worker=clip_worker,
```

In `arena/cli.py` `_cmd_serve`: `config = ArenaConfig.from_env(store_dir=args.store, dev_user=args.user, origin=f"http://127.0.0.1:{args.port}")` and print `clips  {'on' if ... else 'off (no Chrome, ffmpeg or clip page)'}` after the frontend line, reading `create_app`'s renderer — simplest: build the app first, then print `app.state.clips.available`.

- [ ] **Step 5: The app and the publish hook**

In `arena/web/app.py`, after `app.state.sessions = Sessions()`:

```python
    from ..clips import ClipRenderer

    app.state.clips = ClipRenderer(
        app.state.store, config.origin, config.frontend_dir, config.clip_parallel
    )
    if config.clip_worker and app.state.clips.available:
        @app.on_event("startup")
        def _render_owed_clips() -> None:
            # A thread, as recovery is: a render is minutes of CPU and the
            # health check cannot wait for it.
            app.state.clips.start()
```

In `arena/web/routes_submit.py`, after `store.append(record, ...)`:

```python
    clips = request.app.state.clips
    if clips.available:
        # Owed now, rendered later: the response does not wait for a video.
        store.mark_clip_pending(record.run_id, record.user, record.event_id, record.submitted_at)
        clips.enqueue(record.run_id)
```

- [ ] **Step 6: Run everything**

Run: `uv run --frozen pytest -q -m 'not network'`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add arena/clips.py arena/web/config.py arena/web/app.py arena/web/routes_submit.py arena/cli.py tests/test_clips.py
git commit -m "Clips: a background worker owes one per publish, drains at boot, and records what failed"
```

---

### Task 9: The clip routes

**Files:**
- Modify: `arena/web/routes_read.py` (after `run_trace`; `policy_filename` becomes `safe_stem` + wrapper)
- Test: `tests/test_clips.py` (append)

**Interfaces:**
- Produces: `GET /api/runs/{run_id}/clip`, `GET /api/runs/{run_id}/clip/{name}?download=1`; `safe_stem(*parts) -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_clips.py`:

```python
import json as _json

from arena.trace import encode as encode_trace
import numpy as np
from tests.test_store import make_record


def app_with_run(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="alice", clip_worker=False)
    app = create_app(config)
    record = make_record(user="alice", policy_name="walker v2")
    app.state.store.append(record, encode_trace(np.zeros((5, 21), dtype=np.float32)))
    return TestClient(app), app, record


def test_the_clip_route_says_none_pending_then_ready_with_its_files(tmp_path):
    api, app, record = app_with_run(tmp_path)
    store = app.state.store
    url = f"/api/runs/{record.run_id}/clip"
    assert api.get(url).json() == {"state": "none"}
    assert api.get(url).headers["cache-control"] == "no-store"
    assert api.get(f"{url}/landscape.mp4").status_code == 404

    store.mark_clip_pending(record.run_id, "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    assert api.get(url).json() == {"state": "pending"}

    manifest = clip_manifest(record.run_id, rendered(), "2026-09-16T10:05:00Z")
    store.put_clip(record.run_id, {"clip.json": _json.dumps(manifest).encode(),
                                   "landscape.mp4": b"L", "vertical.mp4": b"V", "poster.png": b"P"})
    body = api.get(url).json()
    assert body["state"] == "ready"
    assert body["poster"] == f"{url}/poster.png"
    assert body["layouts"]["vertical"] == {
        "url": f"{url}/vertical.mp4", "width": 1080, "height": 1920, "seconds": 7.52
    }

    inline = api.get(f"{url}/landscape.mp4")
    assert inline.status_code == 200 and inline.content == b"L"
    assert inline.headers["content-type"] == "video/mp4"
    assert "content-disposition" not in inline.headers
    assert inline.headers["cache-control"] == "public, max-age=31536000, immutable"
    saved = api.get(f"{url}/vertical.mp4?download=1")
    assert saved.headers["content-disposition"] == (
        'attachment; filename="microduck-arena-alice-walker-v2-vertical.mp4"'
    )
    assert api.get(f"{url}/poster.png").headers["content-type"] == "image/png"
    assert api.get(f"{url}/clip.json").status_code == 404
    assert api.get("/api/runs/NOPE/clip").status_code == 404
```

- [ ] **Step 2: Run them**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: FAIL — 404 on `/clip` (no route).

- [ ] **Step 3: Implement**

In `arena/web/routes_read.py`, import `from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response` and `from ..store import CLIP_MEDIA, RunRecord`. Replace `policy_filename`'s body:

```python
def safe_stem(*parts: str) -> str:
    """A filename stem a person can find again, from submitter-supplied text.

    Sanitised rather than trusted: a policy called `../../etc/passwd` or one
    with a quote in it must not be able to shape a Content-Disposition header
    or a path. Dots are dropped, so `..` and `policy.onnx.exe` are gone too.
    """
    stem = _SAFE_NAME.sub("-", "-".join(parts))
    stem = re.sub(r"-{2,}", "-", stem).strip("-")[:60].strip("-")
    return stem or "policy"


def policy_filename(policy_name: str, user: str) -> str:
    return f"{safe_stem(user, policy_name)}.onnx"
```

After `run_trace`:

```python
@router.get("/runs/{run_id}/clip")
def run_clip(run_id: str, request: Request) -> JSONResponse:
    """Where this run's clip stands, and its files when it is ready. Polled by
    the publication page while a render is owed, so never cached."""
    store = request.app.state.store
    _find_run(store, run_id)
    state, manifest = store.clip_state(run_id)
    body: dict = {"state": state}
    if state == "ready":
        base = f"/api/runs/{run_id}/clip"
        body["poster"] = f"{base}/{manifest['poster']}"
        body["layouts"] = {
            name: {"url": f"{base}/{layout['file']}", "width": layout["width"],
                   "height": layout["height"], "seconds": layout["seconds"]}
            for name, layout in manifest["layouts"].items()
        }
    return JSONResponse(body, headers={"Cache-Control": "no-store"})


@router.get("/runs/{run_id}/clip/{name}")
def run_clip_file(run_id: str, name: str, request: Request, download: int = 0) -> FileResponse:
    """A clip's file. Streamed from here because the dataset is private; the
    bytes behind a ready clip never change, so cached hard. `download=1` makes
    the answer an attachment with a name worth keeping."""
    store = request.app.state.store
    record = _find_run(store, run_id)
    if name not in CLIP_MEDIA or store.clip_state(run_id)[0] != "ready":
        raise HTTPException(status_code=404, detail=f"no clip file {name!r} for run {run_id}")
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if download and name.endswith(".mp4"):
        stem = safe_stem(record.user, record.policy_name, name.removesuffix(".mp4"))
        headers["Content-Disposition"] = f'attachment; filename="microduck-arena-{stem}.mp4"'
    return FileResponse(
        store.clip_file(run_id, name),
        media_type="video/mp4" if name.endswith(".mp4") else "image/png",
        headers=headers,
    )
```

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_clips.py tests/test_routes_read.py -q`
Expected: PASS, including the existing `policy_filename` tests.

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_read.py tests/test_clips.py
git commit -m "API: a run's clip state and its files, streamed, downloadable under a name worth keeping"
```

---

### Task 10: The unfurl route

**Files:**
- Create: `arena/web/routes_unfurl.py`
- Modify: `arena/web/app.py` (include the router before the static mount)
- Test: `tests/test_clips.py` (append)

**Interfaces:**
- Produces: `GET /r/{run_id}` HTML; `describe(record, place) -> str`.
- Consumes: `ArenaConfig.public_origin` (Task 8), the clip state (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_clips.py`:

```python
def test_a_run_link_unfurls_with_the_poster_once_the_clip_is_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("SPACE_HOST", "arena.hf.space")
    api, app, record = app_with_run(tmp_path)
    page = api.get(f"/r/{record.run_id}", follow_redirects=False)
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/html")
    assert f'<meta property="og:url" content="https://arena.hf.space/r/{record.run_id}">' in page.text
    assert '<meta property="og:title" content="@alice · walker v2 · 2 m Sprint">' in page.text
    assert "og:image" not in page.text
    assert f'url=/#/r/{record.run_id}' in page.text

    manifest = clip_manifest(record.run_id, rendered(), "2026-09-16T10:05:00Z")
    app.state.store.put_clip(record.run_id, {"clip.json": _json.dumps(manifest).encode(),
                                             "landscape.mp4": b"L", "vertical.mp4": b"V",
                                             "poster.png": b"P"})
    page = api.get(f"/r/{record.run_id}").text
    assert (f'<meta property="og:image" content="https://arena.hf.space/api/runs/'
            f'{record.run_id}/clip/poster.png">') in page
    assert '<meta property="og:video:width" content="1920">' in page
    assert '<meta name="twitter:card" content="summary_large_image">' in page
    assert api.get("/r/NOPE").status_code == 404


def test_the_unfurl_escapes_what_a_submitter_typed_and_falls_back_to_the_request_host(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="alice", clip_worker=False)
    app = create_app(config)
    record = make_record(user="alice", policy_name='x"><script>alert(1)</script>')
    app.state.store.append(record, encode_trace(np.zeros((5, 21), dtype=np.float32)))
    page = TestClient(app, base_url="http://testserver").get(f"/r/{record.run_id}").text
    assert "<script>alert" not in page
    assert "&lt;script&gt;" in page
    assert f'content="http://testserver/r/{record.run_id}"' in page
```

- [ ] **Step 2: Run them**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: FAIL — 404 on `/r/...` (the static mount answers).

- [ ] **Step 3: Implement**

Create `arena/web/routes_unfurl.py`:

```python
"""`/r/<run_id>`: the address a shared run travels under.

A hash route cannot carry Open Graph tags, so this page exists for the
crawler: the title, a sentence, the poster and the landscape clip once they
are rendered, then a redirect to the app's own `#/r/<id>`. Everything a
submitter typed is escaped on the way in.
"""

from html import escape

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from ..index import standing
from ..manifest import load_event
from .routes_read import _find_run, _withdrawn

router = APIRouter()


def describe(record, place, title: str) -> str:
    """One sentence for the card."""
    seeds = len(record.per_seed)
    if record.seeds_finished == 0:
        return f"@{record.user}'s duck went down on {title}: 0/{seeds} seeds finished."
    said = (f"@{record.user}'s duck finished {record.seeds_finished}/{seeds} seeds "
            f"in {record.score:.3f} s on {title}")
    return f"{said}, #{place.rank} on the board." if place.on_board else f"{said}."


def _meta(property_: str, content: str, name: bool = False) -> str:
    key = "name" if name else "property"
    return f'<meta {key}="{property_}" content="{escape(content, quote=True)}">'


@router.get("/r/{run_id}", response_class=HTMLResponse)
def unfurl(run_id: str, request: Request) -> HTMLResponse:
    store = request.app.state.store
    record = _find_run(store, run_id)
    title = load_event(record.event_id).title
    place = standing(store.runs(record.event_id), run_id, withdrawn=_withdrawn(store))
    origin = request.app.state.config.public_origin or str(request.base_url).rstrip("/")
    state, manifest = store.clip_state(run_id)
    app_url = f"/#/r/{run_id}"
    tags = [
        _meta("og:type", "video.other"),
        _meta("og:title", f"@{record.user} · {record.policy_name} · {title}"),
        _meta("og:description", describe(record, place, title)),
        _meta("og:url", f"{origin}/r/{run_id}"),
        _meta("twitter:card", "summary_large_image", name=True),
    ]
    if state == "ready":
        land = manifest["layouts"]["landscape"]
        base = f"{origin}/api/runs/{run_id}/clip"
        tags += [
            _meta("og:image", f"{base}/{manifest['poster']}"),
            _meta("og:image:width", str(land["width"])),
            _meta("og:image:height", str(land["height"])),
            _meta("og:video", f"{base}/{land['file']}"),
            _meta("og:video:type", "video/mp4"),
            _meta("og:video:width", str(land["width"])),
            _meta("og:video:height", str(land["height"])),
        ]
    head = "\n".join(tags)
    page = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">\n'
        f"<title>{escape(f'@{record.user} · {record.policy_name} · {title} · Microduck Arena')}</title>\n"
        f"{head}\n"
        f'<meta http-equiv="refresh" content="0; url={app_url}">\n'
        f"</head><body><script>location.replace({app_url!r})</script>\n"
        f'<a href="{app_url}">Open this run</a></body></html>\n'
    )
    # A crawler's re-fetch after the clip lands should be soon.
    return HTMLResponse(page, headers={"Cache-Control": "public, max-age=60"})
```

In `arena/web/app.py`: `from .routes_unfurl import router as unfurl_router` and `app.include_router(unfurl_router)` after the four `/api` routers (still before the static mount).

- [ ] **Step 4: Run the tests**

Run: `uv run --frozen pytest tests/test_clips.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_unfurl.py arena/web/app.py tests/test_clips.py
git commit -m "Unfurl: /r/<id> carries the Open Graph card a pasted link needs, then hands over to the app"
```

---

### Task 11: `arena clip`

**Files:**
- Modify: `arena/cli.py` (new `_cmd_clip`, parser entry)

**Interfaces:**
- Produces: `arena clip <run_id> --store DIR [--parallel N]`.
- Consumes: `ClipRenderer.render_one` (Task 8), `ArenaConfig.from_env(clip_worker=False)`.

- [ ] **Step 1: Implement**

In `arena/cli.py`, after `_cmd_recover`:

```python
def _cmd_clip(args) -> int:
    """Render one run's clips into a local store, by hand.

    The recorder's Chrome needs the clip page and the API, so the app is
    started here on a free loopback port, without its own clip worker — this
    one render must not be raced by a drain of everything else owed.
    """
    import socket
    import threading

    import httpx
    import uvicorn

    from .clips import ClipRenderer
    from .web.app import create_app
    from .web.config import ArenaConfig

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    config = ArenaConfig.from_env(store_dir=args.store, origin=origin, clip_worker=False)
    app = create_app(config)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            if httpx.get(f"{origin}/api/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)

    renderer = ClipRenderer(app.state.store, origin, config.frontend_dir, args.parallel)
    if not renderer.available:
        print("no renderer here: needs a Chrome ($CHROME or the usual paths), ffmpeg, and a built clip.html",
              file=sys.stderr)
        server.should_exit = True
        return 1
    renderer.render_one(args.run_id)
    server.should_exit = True
    state, manifest = app.state.store.clip_state(args.run_id)
    if state != "ready":
        return 1
    for name, layout in manifest["layouts"].items():
        print(f"{name}: {layout['seconds']} s, {layout['timing']['total_wall_ms'] / 1000:.0f} s wall, "
              f"{layout['timing']['capture_ms_per_frame']} ms/frame capture")
    print(f"written under {config.store_dir}/clips/{args.run_id}")
    return 0
```

Add `import time` to the module imports, and in `main`:

```python
    clip = subs.add_parser("clip", help="render one run's social clips into a local store")
    clip.add_argument("run_id")
    clip.add_argument("--store", required=True)
    clip.add_argument("--parallel", type=int, default=None,
                      help="layouts rendered at once; default half the cores")
    clip.set_defaults(func=_cmd_clip)
```

`args.parallel` of `None` must fall back to `config.clip_parallel`: pass `args.parallel or config.clip_parallel`.

- [ ] **Step 2: Try it on a real run**

Run: `uv run --frozen arena clip <run_id> --store ~/arena-board`
Expected: two lines of timing, then the files under `~/arena-board/clips/<run_id>/`. Open both mp4s in a player. If it fails, the reason is in `failed.json` — fix, `rm -r ~/arena-board/clips/<run_id>`, and run again.

- [ ] **Step 3: Commit**

```bash
git add arena/cli.py
git commit -m "CLI: arena clip renders one run's clips into a local store, the app started for it on a free port"
```

---

### Task 12: The share module

**Files:**
- Create: `app/src/share.js`
- Modify: `app/src/api.js` (append `getClip`)
- Test: `app/src/share.test.js` (new)

**Interfaces:**
- Produces: `postText(run, { origin, network })`, `intentUrl(network, text)`, `xLength(text)`, `shareStrip(run, { origin }) → { nav, said, setClip(clip) }`, `wireShare(strip, run, { origin, share, handheld, open, clipboard })`; `getClip(runId)` on `api.js`.
- Consumes: the `/clip` body shape (Task 9): `{ state, poster, layouts: { landscape: { url }, vertical: { url } } }`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/share.test.js`:

```js
import { describe, expect, it } from "vitest";
import { intentUrl, postText, shareStrip, wireShare, xLength } from "./share.js";

const run = {
  run_id: "01M2X", user: "alice", policy_name: "walker v2", score: 2.314,
  seeds_finished: 5, seeds_total: 5, per_seed: [], on_board: true, withdrawn: false, rank: 3,
  receipts: [{ act: "run", points: 10 }, { act: "own_best", points: 25 }],
  policy_url: "https://huggingface.co/alice/microduck-walker-v2",
  event: { id: "sprint-2m", title: "2 m Sprint" },
};
const origin = "https://arena.hf.space";

describe("postText", () => {
  it("says the result, links the run, names the weights, and mentions only on X", () => {
    expect(postText(run, { origin, network: "x" })).toBe(
      "I coded a robot duck to walk. On 2 m Sprint it finished 5/5 seeds in 2.314 s, #3 on the board (+35 pts).\n" +
      "Beat it: https://arena.hf.space/r/01M2X\n" +
      "Weights: huggingface.co/alice/microduck-walker-v2\n" +
      "#MicroduckArena @pollenrobotics @huggingface",
    );
    expect(postText(run, { origin, network: "linkedin" }).split("\n").at(-1)).toBe("#MicroduckArena");
  });

  it("leaves out the place off the board, the points at zero, and the weights without a repo", () => {
    const plain = { ...run, on_board: false, receipts: [], policy_url: null };
    const text = postText(plain, { origin, network: "x" });
    expect(text).toContain("finished 5/5 seeds in 2.314 s.\n");
    expect(text).not.toContain("Weights");
  });

  it("tells a DNF how it ended", () => {
    const fell = { ...run, seeds_finished: 0, per_seed: [{ seed: 1, status: "fall", time_s: null }] };
    expect(postText(fell, { origin, network: "x" })).toContain("finished 0/5 seeds on its feet — it ate the floor.");
    const late = { ...fell, per_seed: [{ seed: 1, status: "timeout", time_s: null }] };
    expect(postText(late, { origin, network: "x" })).toContain("it ran out of time.");
  });

  it("fits X with a long policy name, links counted as 23", () => {
    const long = { ...run, policy_name: "x".repeat(60), policy_url: `https://huggingface.co/alice/microduck-${"x".repeat(60)}` };
    expect(xLength(postText(long, { origin, network: "x" }))).toBeLessThanOrEqual(280);
  });
});

describe("intentUrl", () => {
  it("opens the two composers that take a text", () => {
    expect(intentUrl("x", "a b")).toBe("https://x.com/intent/post?text=a%20b");
    expect(intentUrl("linkedin", "a b")).toBe("https://www.linkedin.com/feed/?shareActive=true&text=a%20b");
  });
});

describe("shareStrip", () => {
  it("is two links, two buttons and two clip stickers that follow the clip's state", () => {
    const strip = shareStrip(run, { origin });
    const items = [...strip.nav.children];
    expect(items.map((el) => el.tagName)).toEqual(["A", "A", "BUTTON", "BUTTON", "A", "A", "P"]);
    expect(items[0].href).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
    expect(items[2].dataset.upload).toBe("instagram");

    strip.setClip({ state: "pending" });
    const clips = strip.nav.querySelectorAll("[data-clip]");
    expect(clips[0].textContent).toBe("Clip · rendering…");
    expect(clips[0].getAttribute("aria-disabled")).toBe("true");
    expect(clips[0].hasAttribute("href")).toBe(false);

    strip.setClip({ state: "ready", layouts: { landscape: { url: "/l.mp4" }, vertical: { url: "/v.mp4" } } });
    expect(clips[1].getAttribute("href")).toBe("/v.mp4?download=1");
    expect(clips[1].hasAttribute("download")).toBe(true);
    expect(clips[1].textContent).toBe("Clip · vertical");

    strip.setClip({ state: "failed" });
    expect(clips[0].hidden && clips[1].hidden).toBe(true);
  });
});

describe("wireShare", () => {
  it("on a laptop, Instagram copies the post and takes the vertical clip", async () => {
    const strip = shareStrip(run, { origin });
    strip.setClip({ state: "ready", layouts: { landscape: { url: "/l.mp4" }, vertical: { url: "/v.mp4" } } });
    const copied = [];
    const opened = [];
    wireShare(strip, run, {
      origin, handheld: false, share: undefined,
      clipboard: { writeText: async (text) => copied.push(text) }, open: (url) => opened.push(url),
    });
    strip.nav.querySelector('[data-upload="instagram"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(copied[0]).toBe(postText(run, { origin, network: "instagram" }));
    expect(opened).toEqual(["/v.mp4?download=1"]);
    expect(strip.said.textContent).toMatch(/^Text copied\. Use the clip download/);
  });

  it("on a phone, hands the text to the share sheet", async () => {
    const strip = shareStrip(run, { origin });
    const shared = [];
    wireShare(strip, run, { origin, handheld: true, share: async (data) => shared.push(data) });
    strip.nav.querySelector('[data-upload="tiktok"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(shared).toEqual([{ text: postText(run, { origin, network: "tiktok" }) }]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd app && npx vitest run src/share.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/src/share.js`:

```js
// Sharing a run: the post, the two composers that take a text, the two
// networks that take uploads only, and the clip downloads. Ported from Duck
// Jam's dome/web/features/results/sharing.mjs at 2d35443b, in the arena's
// words. The row is markup: every link works with no script at all.

export const HASHTAG = "#MicroduckArena";
const MENTIONS = { x: "@pollenrobotics @huggingface" };
// The only two addresses that open a composer with a text in it.
const INTENTS = {
  x: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  linkedin: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
};
const NETWORKS = ["x", "linkedin"];
const UPLOADS = ["instagram", "tiktok"];
const LABELS = { x: "X", linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok" };
const LAYOUTS = ["landscape", "vertical"];
/** The tilt magnitudes the stickers take in turn; the row alternates the sign. */
const TILTS = ["2-5", "1-5", "3-0", "1-0"];

/** The post, the same on every network but for the mentions X gets. */
export function postText(run, { origin, network }) {
  const total = run.seeds_total;
  const earned = run.receipts.reduce((sum, r) => sum + r.points, 0);
  let result;
  if (run.seeds_finished === 0) {
    const fell = run.per_seed.some((s) => s.status === "fall");
    result = `On ${run.event.title} it finished 0/${total} seeds on its feet — ${fell ? "it ate the floor" : "it ran out of time"}.`;
  } else {
    const place = run.on_board && !run.withdrawn ? `, #${run.rank} on the board` : "";
    const points = earned > 0 ? ` (+${earned} pts)` : "";
    result = `On ${run.event.title} it finished ${run.seeds_finished}/${total} seeds in ${run.score.toFixed(3)} s${place}${points}.`;
  }
  const lines = [`I coded a robot duck to walk. ${result}`, `Beat it: ${origin}/r/${run.run_id}`];
  if (run.policy_url) lines.push(`Weights: ${run.policy_url.replace(/^https?:\/\//, "")}`);
  lines.push([HASHTAG, MENTIONS[network]].filter(Boolean).join(" "));
  return lines.join("\n");
}

export const intentUrl = (network, text) => INTENTS[network](text);

/** X's count: every link is 23 characters, whatever its length. */
export const xLength = (text) => text.replace(/(https?:\/\/)?[\w.-]+\.\w+\/\S*/g, "x".repeat(23)).length;

// Each network's mark as one path on its own grid: a row of names all in the
// same sticker face reads as four words, and a player looking for their
// network recognises it. The name stays as the label a screen reader says.
const LOGOS = {
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  instagram: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.2953 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.1466-.2652 2.9095-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.9476-.0063-3.2578-.021-3.6668-.0817-4.9466-.0607-1.2798-.264-2.1478-.5633-2.9109-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.4231-.1651 1.5798-.3611 2.2283-.4171 1.2645-.06 1.6442-.072 4.848-.079 3.2037-.007 3.5834.005 4.849.0608 1.169.0508 1.8053.2445 2.2277.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3611 1.5783.4171 2.2273.0602 1.2645.0739 1.6446.0796 4.848.0058 3.2033-.0055 3.5836-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.5797.3613-2.2273.4174-1.2645.0592-1.6442.0719-4.8487.0788-3.2045.007-3.5832-.0066-4.848-.0602m9.6806-16.234a1.44 1.44 0 1 0 1.4373-1.4415 1.44 1.44 0 0 0-1.4373 1.4415M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.1732 6.1493 3.4026-.0065 6.1573-2.7701 6.1508-6.1733-.0065-3.4032-2.771-6.1565-6.1742-6.1499-3.4032.0067-6.1563 2.7708-6.1498 6.1739M8 12.0077a4 4 0 1 1 4.008 3.9921A4 4 0 0 1 8 12.0077",
  tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
};

const logo = (id) =>
  `<svg class="sticker-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${LOGOS[id]}"></path></svg>`;

function mark(tag, id, tilt) {
  const node = document.createElement(tag);
  node.className = `sticker sticker-mark fx-tilt-${tilt}`;
  node.setAttribute("aria-label", LABELS[id]);
  node.title = LABELS[id];
  node.innerHTML = logo(id);
  return node;
}

/**
 * The row under the points: X and LinkedIn as links, Instagram and TikTok as
 * buttons, one cyan sticker per clip, and the line that says what a press
 * did. `setClip` takes the `/clip` body and dresses the clip stickers for
 * its state.
 */
export function shareStrip(run, { origin }) {
  const nav = document.createElement("nav");
  nav.className = "run-share fx-tilt-alternate";
  nav.setAttribute("aria-label", "Share this run");
  let i = 0;
  const tilt = () => TILTS[i++ % TILTS.length];
  for (const id of NETWORKS) {
    const link = mark("a", id, tilt());
    link.href = intentUrl(id, postText(run, { origin, network: id }));
    link.target = "_blank";
    link.rel = "noopener";
    link.dataset.network = id;
    nav.append(link);
  }
  for (const id of UPLOADS) {
    const button = mark("button", id, tilt());
    button.type = "button";
    button.dataset.upload = id;
    nav.append(button);
  }
  for (const layout of LAYOUTS) {
    const sticker = document.createElement("a");
    sticker.className = `sticker sticker-cyan fx-tilt-${tilt()}`;
    sticker.dataset.clip = layout;
    sticker.textContent = `Clip · ${layout}`;
    nav.append(sticker);
  }
  const said = document.createElement("p");
  said.className = "mono-label run-share-said";
  said.hidden = true;
  nav.append(said);

  function setClip(clip) {
    for (const sticker of nav.querySelectorAll("[data-clip]")) {
      const layout = sticker.dataset.clip;
      sticker.hidden = !["pending", "ready"].includes(clip.state);
      if (clip.state === "ready") {
        sticker.href = `${clip.layouts[layout].url}?download=1`;
        sticker.setAttribute("download", "");
        sticker.removeAttribute("aria-disabled");
        sticker.textContent = `Clip · ${layout}`;
      } else {
        sticker.removeAttribute("href");
        sticker.removeAttribute("download");
        sticker.setAttribute("aria-disabled", "true");
        sticker.textContent = "Clip · rendering…";
      }
    }
  }
  return { nav, said, setClip };
}

/**
 * The presses a link cannot make. Instagram and TikTok have no composer: on a
 * phone the system sheet reaches their apps with the post in hand; on a
 * laptop the honest answer is the post in the clipboard and the vertical
 * clip on the disk. The hooks are the browser's by default and plain objects
 * in a test.
 */
export function wireShare(
  strip,
  run,
  {
    origin,
    share = globalThis.navigator?.share?.bind(globalThis.navigator),
    handheld = globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false,
    open = (url) => window.open(url, "_blank", "noopener"),
    clipboard = globalThis.navigator?.clipboard,
  } = {},
) {
  const tell = (line) => {
    strip.said.textContent = line;
    strip.said.hidden = false;
  };
  for (const button of strip.nav.querySelectorAll("[data-upload]")) {
    const text = postText(run, { origin, network: button.dataset.upload });
    button.addEventListener("click", async () => {
      if (handheld && typeof share === "function") {
        // The text ends with the link; a `url` beside it makes some targets drop the text.
        try {
          await share({ text });
        } catch (error) {
          tell(error.name === "AbortError" ? "Sharing cancelled." : "Sharing unavailable. Copy the text instead.");
        }
        return;
      }
      let copied = false;
      try {
        await clipboard.writeText(text);
        copied = true;
      } catch {
        // A clipboard that refuses: the line says so.
      }
      const tape = strip.nav.querySelector('[data-clip="vertical"]');
      const ready = Boolean(tape && !tape.hidden && tape.getAttribute("href"));
      if (ready) open(tape.getAttribute("href"));
      tell(
        !copied ? "Could not copy. Select the text and copy it yourself."
        : ready ? "Text copied. Use the clip download to attach your video and publish in your app."
        : "Text copied. The clip is still rendering — come back for the download.",
      );
    });
  }
}
```

Append to `app/src/api.js`:

```js
/** Where a run's clip stands: none, pending, failed, or ready with its files. */
export const getClip = (runId) => json(`/api/runs/${runId}/clip`);
```

- [ ] **Step 4: Run the tests**

Run: `cd app && npx vitest run src/share.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/share.js app/src/share.test.js app/src/api.js
git commit -m "Share: the post, the two composers, the two upload-only networks, and the clip stickers"
```

---

### Task 13: The share row on the publication page

**Files:**
- Modify: `app/src/run.js` (imports; after the stickers block; the teardown; the reveal's parts), `app/src/reveal.js:60-86` (`parts.share`, `settle`), `app/public/race.css` (`.run-score` rows; new rules after `.run-receipts`)

**Interfaces:**
- Consumes: `shareStrip`, `wireShare`, `getClip` (Task 12); `reveal(parts, show, signal)` gains `parts.share`.

- [ ] **Step 1: The page**

In `app/src/run.js`: add `import { getClip, getMe, getRun, getTrace, markSeen } from "./api.js";` and `import { shareStrip, wireShare } from "./share.js";`. After the stickers block (`if (!stickers.length) ...`):

```js
  // Sharing, under the points: the row stands there from the first frame,
  // veiled through a reveal like everything else in this column, and the
  // clip stickers follow the render while it is owed.
  const strip = shareStrip(run, { origin: location.origin });
  strip.nav.classList.toggle("veiled", revealing);
  $("points").after(strip.nav);
  wireShare(strip, run, { origin: location.origin });
  const leaving = new AbortController();
  async function followClip() {
    const clip = await getClip(run.run_id).catch(() => ({ state: "none" }));
    if (leaving.signal.aborted) return;
    strip.setClip(clip);
    if (clip.state === "pending") setTimeout(followClip, 5000);
  }
  followClip();
```

Replace the teardown block so `leaving` is aborted on every page exit, reveal or not:

```js
  let theatre, lifetime;
  if (revealing) {
    theatre = new AbortController();
    lifetime = new AbortController();
  }
  state.teardown = () => {
    leaving.abort();
    lifetime?.abort();
    theatre?.abort("leave");
  };
```

Pass `share: strip.nav` in the `parts` object given to `reveal(...)`.

- [ ] **Step 2: The reveal unveils it at rest**

In `app/src/reveal.js`, destructure `share` from `parts` (`const { pegboard, pegRows, stickers, share } = parts;`) and add `unveil(share);` in `settle` after the stickers loop.

- [ ] **Step 3: The sheet**

In `app/public/race.css`, `.run-score { grid-template-rows: auto auto auto; }` and, after the `.run-receipts` rules:

```css
/* Share the run: the four networks as marks, the two clips as cyan stickers,
   and one line under them saying what a press did. Present from the first
   frame and veiled through a reveal, like everything in this column. */
.run-share { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0; }
.run-share .sticker-mark { padding: 8px 12px; line-height: 0; }
.run-share .sticker-logo { width: 22px; height: 22px; fill: currentColor; }
.run-share [aria-disabled="true"] { opacity: 0.55; cursor: default; box-shadow: none; }
.run-share-said { flex-basis: 100%; margin: 0; color: var(--ink-70); }
```

- [ ] **Step 4: Build, test, look**

Run: `cd app && npx vitest run && npm run build && cd .. && uv run --frozen arena serve --store ~/arena-board --user nicolas --port 8001`

Open a run page (`#/r/<run id>`; a run whose clip Task 11 rendered shows the two downloads, any other shows none). Check: the row sits under the points, the page still fits one screen at 1440×900, the X link opens a composer with the text, the Instagram button copies and downloads the vertical clip and the line says so. Force-reload after the CSS change — `race.css` carries no hash. Then `rm ~/arena-board/seen/<run id>.json` and reload as its author: the row is veiled through the reveal and appears at rest. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add app/src/run.js app/src/reveal.js app/public/race.css
git commit -m "Publication page: share the run under the points, the clips following their render"
```

---

### Task 14: The image

**Files:**
- Modify: `Dockerfile:18-29`

- [ ] **Step 1: Chromium and ffmpeg in the runtime stage**

Replace lines 18–29 of the `Dockerfile` with:

```dockerfile
FROM python:3.13-slim

# The clip recorder (arena/recorder.py) photographs the arena's own stage in
# a headless Chromium and encodes it with ffmpeg. That is the one reason this
# image carries a browser and Mesa: MuJoCo still runs headless with no GL of
# its own. fonts-liberation is the fallback face for glyphs Anton and DM Sans
# lack. The version check fails the build on a broken apt layer, before a
# Space boots and renders nothing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && chromium --version && ffmpeg -version | head -1
ENV CHROME=/usr/bin/chromium

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app
```

- [ ] **Step 2: Build it, if Docker is here**

Run: `which docker && docker build -t arena-clips . 2>&1 | tail -5`
Expected: the build succeeds and prints the Chromium and ffmpeg versions in its log. Then a smoke render inside the image:

```bash
docker run --rm -e ARENA_STORE=/tmp/board -v ~/arena-board:/tmp/board arena-clips \
  sh -c 'arena clip <run_id> --store /tmp/board --parallel 1'
```

Expected: the two timing lines. This is the real number for the Space's CPU class; copy it into *Measurements*. Without Docker, this step is done on the Space after deploy (Task 15).

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "Image: chromium and ffmpeg for the clip recorder, checked at build time"
```

---

### Task 15: The real render, tuned, and the record of it

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-social-clips-and-sharing-design.md` (status line), this plan (*Measurements*), `app/src/viewer.js` / `app/src/clip/main.js` / `app/src/clip/score.js` (constants, only if the eye or ear says so)

- [ ] **Step 1: Render a finished run and a DNF**

```bash
uv run --frozen arena clip <finished run id> --store ~/arena-board
uv run --frozen arena clip <DNF run id> --store ~/arena-board
```

- [ ] **Step 2: Inspect the frames and the sound**

```bash
C=~/arena-board/clips/<run id>
ffprobe -v error -show_entries format_tags=crowdMixed:stream=codec_name,width,height,r_frame_rate,duration $C/landscape.mp4
for t in 0.5 2 6 7.5; do ffmpeg -v error -y -ss $t -i $C/landscape.mp4 -frames:v 1 /tmp/frame-$t.png; done
ffmpeg -v error -y -ss 4 -i $C/vertical.mp4 -frames:v 1 /tmp/vertical-4.png
ffmpeg -v error -i $C/landscape.mp4 -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 | grep RMS_level | head -40
```

Look at the four landscape frames and the vertical one (the Read tool shows images): the title card, the tape with four named ducks, the stamp and figures. The RMS lines must show sound in every window and a rise at the verdict. Tune `PLATE_HEIGHT`/`PLATE_LIFT` (viewer.js), `VERTICAL_DISTANCE` (clip/main.js) and the gains (clip/score.js, soundtrack.js) only if a frame or the ear says so; re-render after `rm -r $C`.

- [ ] **Step 3: Record and close**

Fill *Measurements* with the numbers from `clip.json`'s `timing`. Change the spec's status line to `Status: implemented on branch social-clips, awaiting the owner's browser check and the first Space render.` Commit:

```bash
git add docs/superpowers/plans/2026-09-16-social-clips-and-sharing.md docs/superpowers/specs/2026-09-16-social-clips-and-sharing-design.md app/src
git commit -m "Clips: the first real renders, their timing on record, and the constants they settled"
```

- [ ] **Step 4: Hand over**

The branch is not merged and nothing is pushed: merging to `main` deploys the Space. The owner's browser check of the share row and the reveal, and the first render on the Space's cpu-basic hardware (the timing lands in `clip.json`), are theirs.

---

## Self-review against the spec

- **Render in the Space, background worker, drain at boot** — Task 8. **Python recorder, `websockets`** — Tasks 6, 7. **Parallel layouts, one browser, shared soundtrack** — Task 7. **Capture chosen by measurement** — Task 6 (rule stated; Task 7 assumes JPEG and is re-planned if the rule says otherwise). **One-block soundtrack with a limiter** — Task 5 (`soundtrack.js`). **Viewer manual mode, camera spec, nameplates** — Task 4. **Per-event `[clip]`** — Task 1, consumed in Task 5. **Three write-once files, snapshot without media** — Task 2. **Routes `/clip` and `/clip/{name}`, `?download=1`** — Task 9. **Submit marks and enqueues** — Task 8. **Unfurl `/r/<id>`** — Task 10. **Share row, behaviours, post text** — Tasks 12, 13. **CLI** — Task 11. **Image** — Task 14. **Vendored sounds, licences, PROVENANCE correction** — Task 3. **Config variables** — Task 8 (`ARENA_ORIGIN`, `ARENA_CLIP_PARALLEL`, `SPACE_HOST`), Task 6 (`CHROME`). **Tests at the minimum** — every task's tests are the spec's list and no more. **Availability without Chrome** — Task 8 (`available`), Task 11 (the CLI says so).
- Names checked across tasks: `clip_state`/`clip_file`/`pending_clips`/`put_clip`/`fail_clip`/`mark_clip_pending` (2, 8, 9, 10, 11); `record_run`/`RenderedRun`/`RenderedLayout`/`SIZES` (7, 8); `ClipRenderer.render_one`/`enqueue`/`drain`/`start`/`available`/`queue` (8, 11); `clip_manifest` (8, 9, 10); `cameraPose`/`frame`/`name`/`nameColour` (4, 5); `clipPlan`/`stepAt`/`actAt`/`clipScore`/`jingleFile`/`renderSoundtrack` (5); `window.clip.{plan, score, draw, soundtrack, chunk, ready, error}` (5, 6, 7); `shareStrip`/`wireShare`/`postText`/`getClip` (12, 13); `safe_stem` (9).
