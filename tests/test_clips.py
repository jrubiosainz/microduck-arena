"""Clips: three write-once files per run, and a worker that owes one per publish."""

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.clips import CLIP_VERSION, ClipRenderer, clip_manifest
from arena.recorder import RenderedLayout, RenderedRun, ffmpeg_args
from arena.store import LocalStore
from arena.trace import encode as encode_trace
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_routes_submit import REFERENCE, submit
from tests.test_store import make_record


def test_clip_state_is_read_by_presence(tmp_path):
    store = LocalStore(tmp_path)
    assert store.clip_state("R1") == ("none", None)
    assert store.pending_clips() == []

    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    # Written once: a re-queue after a crash must not re-date the clip.
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T11:00:00Z")
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
    # Written once: a second failure must not erase the first reason.
    store.fail_clip("R2", "2026-09-16T10:06:00Z", "second")
    assert store.clip_state("R2") == ("failed", None)
    assert store.pending_clips() == []
    failed = json.loads((tmp_path / "clips" / "R2" / "failed.json").read_text())
    assert failed["reason"] == "ffmpeg exited 1"


def test_a_clip_is_never_written_twice(tmp_path):
    store = LocalStore(tmp_path)
    store.put_clip("R3", {"clip.json": b"{}"})
    with pytest.raises(FileExistsError):
        store.put_clip("R3", {"clip.json": b"{}"})


def test_the_encode_is_h264_with_the_pcm_muxed_and_the_live_tag_set():
    args = ffmpeg_args(25, Path("/tmp/s.f32"), Path("/tmp/out.mp4"))
    assert args[:2] == ["ffmpeg", "-y"]
    assert ["-f", "image2pipe", "-framerate", "25", "-c:v", "mjpeg", "-i", "-"] == args[4:12]
    assert ["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "/tmp/s.f32"] == args[12:20]
    # Values are unique in the command; flags are not (`-c:v` names the input's
    # mjpeg first), so each value is found and the flag before it is checked.
    for flag, value in (("-c:v", "libx264"), ("-crf", "23"), ("-pix_fmt", "yuv420p"),
                        ("-c:a", "aac"), ("-b:a", "192k"), ("-metadata", "crowdMixed=true"),
                        ("-movflags", "+faststart+use_metadata_tags")):
        assert args[args.index(value) - 1] == flag
    assert "-shortest" in args
    assert args[-1] == "/tmp/out.mp4"


def rendered(seconds=7.52):
    layout = lambda w, h: RenderedLayout(
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

    def render(origin, run_id, parallel, budget_s):
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
    # An absent frontend_dir resolves to None regardless of what this machine
    # has built, so `available` starts False whether or not app/dist exists.
    config = ArenaConfig.from_env(
        store_dir=tmp_path, dev_user="coralie", frontend_dir=tmp_path / "no-bundle",
        clip_worker=False,
    )
    app = create_app(config)
    api = TestClient(app)
    run_id = submit(api, REFERENCE).json()["run_id"]
    assert app.state.store.clip_state(run_id) == ("none", None)

    monkeypatch.setattr(app.state.clips, "available", True)
    run_id = submit(api, REFERENCE).json()["run_id"]
    assert app.state.store.clip_state(run_id) == ("pending", None)
    assert list(app.state.clips.queue.queue) == [run_id]


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
    store.put_clip(record.run_id, {"clip.json": json.dumps(manifest).encode(),
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
    app.state.store.put_clip(record.run_id, {"clip.json": json.dumps(manifest).encode(),
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
