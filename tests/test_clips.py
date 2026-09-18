"""Clips: three write-once files per run, and a worker that owes one per publish."""

import base64
import io
import json
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena import recorder
from arena.clips import CLIP_VERSION, ClipRenderer, clip_manifest
from arena.recorder import RenderedLayout, RenderedRun, ffmpeg_args
from arena.store import LocalStore, Withdrawal
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
    assert store.pending_clips() == []
    # The reason comes back with the state: a page that shows a failed clip
    # has to be able to say why, and re-reading the file is the store's job.
    state, failed = store.clip_state("R2")
    assert state == "failed"
    assert failed["reason"] == "ffmpeg exited 1"
    assert failed["failed_at"] == "2026-09-16T10:05:00Z"


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

    def render(origin, run_id, parallel, budget_s, on_progress=None):
        if run_id == "R2":
            raise RuntimeError("ffmpeg exited 1")
        return rendered()

    said = []
    worker = ClipRenderer(store, "http://127.0.0.1:1", tmp_path, render=render, log=said.append)
    worker.drain()
    assert [item[2] for item in sorted(worker.queue.queue)] == ["R1", "R2"]
    while not worker.queue.empty():
        worker.render_one(worker.queue.get()[-1])
    state, manifest = store.clip_state("R1")
    assert state == "ready" and manifest["run_id"] == "R1"
    assert store.clip_file("R1", "vertical.mp4").read_bytes() == b"mp4"
    assert store.clip_state("R2")[1]["reason"] == "RuntimeError: ffmpeg exited 1"
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
    assert [item[2] for item in app.state.clips.queue.queue] == [run_id]


def test_a_backfill_owes_every_run_without_a_clip_behind_the_fresh_ones(tmp_path):
    store = LocalStore(tmp_path)
    old = make_record(user="alice", submitted_at="2026-09-10T10:00:00Z")
    newer = make_record(user="bob", submitted_at="2026-09-12T10:00:00Z")
    done = make_record(user="carol", submitted_at="2026-09-13T10:00:00Z")
    gone = make_record(user="dave", submitted_at="2026-09-14T10:00:00Z")
    for record in (old, newer, done, gone):
        store.append(record, encode_trace(np.zeros((5, 21), dtype=np.float32)))
    store.put_clip(done.run_id, {"clip.json": b"{}"})
    store.withdraw(Withdrawal(run_id=gone.run_id, event_id="sprint-2m", user="dave",
                              withdrawn_at="2026-09-15T00:00:00Z"))
    store.mark_clip_pending("R9", "erin", "sprint-2m", "2026-09-16T10:00:00Z")

    worker = ClipRenderer(store, "http://127.0.0.1:1", tmp_path, backfill=True)
    worker.drain()
    # The fresh publish first, then the log newest first; the rendered and the
    # withdrawn are not owed.
    assert [item[2] for item in sorted(worker.queue.queue)] == ["R9", newer.run_id, old.run_id]

    quiet = ClipRenderer(store, "http://127.0.0.1:1", tmp_path)
    quiet.drain()
    assert [item[2] for item in sorted(quiet.queue.queue)] == ["R9"]


def app_with_run(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="alice", clip_worker=False)
    app = create_app(config)
    record = make_record(user="alice", policy_name="walker v2")
    app.state.store.append(record, encode_trace(np.zeros((5, 21), dtype=np.float32)))
    return TestClient(app), app, record


def test_the_clip_route_says_none_queued_then_ready_with_its_files(tmp_path):
    api, app, record = app_with_run(tmp_path)
    store = app.state.store
    url = f"/api/runs/{record.run_id}/clip"
    assert api.get(url).json() == {"state": "none"}
    assert api.get(url).headers["cache-control"] == "no-store"
    assert api.get(f"{url}/landscape.mp4").status_code == 404

    store.mark_clip_pending(record.run_id, "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    # Owed but unknown to this process's worker — a marker left by the run
    # before a restart. Waiting is all the page can honestly be told.
    assert api.get(url).json() == {"state": "queued", "ahead": None}
    app.state.clips.enqueue(record.run_id)
    assert api.get(url).json() == {"state": "queued", "ahead": 0}

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
    # A clip folder is its three media and nothing else: no fourth file is served.
    assert api.get(f"{url}/commentary.json").status_code == 404
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


def test_ready_clips_are_listed_by_run_id(tmp_path):
    store = LocalStore(tmp_path)
    assert store.clips_ready() == []
    store.mark_clip_pending("R2", "bob", "sprint-2m", "2026-09-16T10:00:00Z")
    store.put_clip("R3", {"clip.json": b"{}"})
    store.put_clip("R1", {"clip.json": b"{}"})
    assert store.clips_ready() == ["R1", "R3"]


def test_the_worker_says_where_a_clip_stands(tmp_path):
    """The queue is a place in a line and a render is a fraction: both are read
    off the worker, never off the store, which knows only that one is owed."""
    store = LocalStore(tmp_path)
    worker = ClipRenderer(store, "http://127.0.0.1:1", tmp_path)
    assert worker.progress("R1") is None

    worker.enqueue("R1")
    worker.enqueue("R2")
    # A backfill joins behind whatever a player just published, so the position
    # a page shows is the pop order, not the order things were put in.
    worker.enqueue("R0", priority=1)
    worker.enqueue("R3")
    assert worker.progress("R1") == {"ahead": 0}
    assert worker.progress("R3") == {"ahead": 2}
    assert worker.progress("R0") == {"ahead": 3}

    # In flight: the worker took it off the queue first, so the line behind it
    # counts from the front again.
    assert worker.queue.get()[-1] == "R1"
    worker.step("R1", "soundtrack", 0, 0)
    assert worker.progress("R1") == {"stage": "soundtrack", "done": 0, "total": 0}
    worker.step("R1", "frames", 310, 880)
    assert worker.progress("R1") == {"stage": "frames", "done": 310, "total": 880}
    assert worker.progress("R2") == {"ahead": 0}
    assert worker.progress("R3") == {"ahead": 1}
    # Nothing in flight, and R1 is neither queued nor rendering any more.
    worker.step(None, "")
    assert worker.progress("R1") is None


def test_a_render_reports_its_steps_and_a_failure_clears_them(tmp_path):
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    store.mark_clip_pending("R2", "bob", "sprint-2m", "2026-09-16T10:01:00Z")
    seen = []

    def render(origin, run_id, parallel, budget_s, on_progress=None):
        on_progress("soundtrack", 0, 0)
        on_progress("frames", 188, 376)
        seen.append(dict(worker.progress(run_id)))
        if run_id == "R2":
            raise RuntimeError("ffmpeg exited 1")
        return rendered()

    worker = ClipRenderer(store, "http://127.0.0.1:1", tmp_path, render=render, log=lambda _: None)
    worker.render_one("R1")
    assert seen[-1] == {"stage": "frames", "done": 188, "total": 376}
    # A ready clip is not a render in flight: the store answers for it now.
    assert worker.progress("R1") is None
    worker.render_one("R2")
    assert worker.progress("R2") is None


def test_the_clip_route_follows_a_render_and_says_why_one_failed(tmp_path):
    api, app, record = app_with_run(tmp_path)
    store = app.state.store
    url = f"/api/runs/{record.run_id}/clip"
    store.mark_clip_pending(record.run_id, "alice", "sprint-2m", "2026-09-16T10:00:00Z")

    app.state.clips.step(record.run_id, "frames", 310, 880)
    assert api.get(url).json() == {
        "state": "rendering", "stage": "frames", "done": 310, "total": 880
    }

    store.fail_clip(record.run_id, "2026-09-16T10:05:00Z", "TimeoutError: timed out in 60.0s")
    assert api.get(url).json() == {
        "state": "failed", "reason": "TimeoutError: timed out in 60.0s",
        "failed_at": "2026-09-16T10:05:00Z",
    }


class FakeTab:
    """A page that answers instantly and remembers the deadline it was given.
    `stuck` screenshots never come back, as one did on the Space."""

    def __init__(self, frames=4, stuck=0):
        self.plan = {"fps": 25, "frames": frames, "seconds": frames / 25, "poster": 1}
        self.waited: list[tuple[str, float]] = []
        self.stuck = stuck

    def evaluate(self, expression, await_promise=False, timeout=60.0):
        if expression == "window.clip.plan":
            return self.plan
        if expression == "window.clip.score.crowd":
            return None
        self.waited.append(("draw", timeout))

    def send(self, method, params=None, timeout=60.0):
        self.waited.append((method, timeout))
        if self.stuck:
            self.stuck -= 1
            raise TimeoutError(f"timed out in {timeout:.1f}s")
        return {"data": base64.b64encode(b"jpeg").decode()}


class FakeFfmpeg:
    returncode = 0

    def __init__(self, *_, **__):
        self.stdin = io.BytesIO()

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass


def test_a_slow_frame_waits_on_the_budget_not_on_a_minute(tmp_path, monkeypatch):
    """The render budget is the only deadline. A fixed per-call timeout under it
    kills a render that is slow but advancing — which is how a clip died on the
    Space at 854 s of its 900 — so every call waits on what is left instead."""
    monkeypatch.setattr(recorder.subprocess, "Popen", FakeFfmpeg)
    tab = FakeTab()
    out = tmp_path / "landscape.mp4"
    out.write_bytes(b"mp4")
    drew = []
    rendered_layout, poster = recorder._record_layout(
        tab, tmp_path / "s.f32", out, nice=10, deadline=time.monotonic() + 300.0,
        on_frame=drew.append,
    )
    assert drew == [0, 1, 2, 3]
    assert poster == b"jpeg" and rendered_layout.mp4 == b"mp4"
    # Four frames: a draw and a screenshot each, plus the poster's own PNG shot.
    assert [what for what, _ in tab.waited] == [
        "draw", "Page.captureScreenshot",
        "draw", "Page.captureScreenshot", "Page.captureScreenshot",
        "draw", "Page.captureScreenshot",
        "draw", "Page.captureScreenshot",
    ]
    # A draw waits on the budget. A capture waits on one attempt of it, because
    # a capture is the call that hangs and asking again is what recovers it.
    draws = [left for what, left in tab.waited if what == "draw"]
    shots = [left for what, left in tab.waited if what != "draw"]
    assert all(290.0 < left <= 300.0 for left in draws)
    assert all(left == recorder.CAPTURE_ATTEMPT_S for left in shots)
    assert rendered_layout.timing["stuck_captures"] == 0


def test_a_render_past_its_budget_stops_at_the_next_frame(tmp_path, monkeypatch):
    monkeypatch.setattr(recorder.subprocess, "Popen", FakeFfmpeg)
    out = tmp_path / "landscape.mp4"
    out.write_bytes(b"mp4")
    with pytest.raises(TimeoutError, match="past its budget at frame 0 of 4"):
        recorder._record_layout(
            FakeTab(), tmp_path / "s.f32", out, nice=10, deadline=time.monotonic() - 1.0,
        )


def test_a_run_being_backfilled_is_not_told_it_has_no_clip(tmp_path):
    """The backfill enqueues straight off the log and marks nothing pending, so
    the store still says `none` for a run being photographed right now. Only the
    worker knows; a page that trusted the store alone showed no clip row at all
    while the clip was being made — the same silence as a render that failed."""
    api, app, record = app_with_run(tmp_path)
    url = f"/api/runs/{record.run_id}/clip"
    assert app.state.store.clip_state(record.run_id) == ("none", None)

    app.state.clips.enqueue(record.run_id, priority=1)
    assert api.get(url).json() == {"state": "queued", "ahead": 0}
    app.state.clips.step(record.run_id, "opening", 0, 0)
    assert api.get(url).json() == {
        "state": "rendering", "stage": "opening", "done": 0, "total": 0
    }
    # Off the queue and out of flight with nothing written: owed by nobody.
    assert app.state.clips.queue.get()[-1] == record.run_id
    app.state.clips.step(None, "")
    assert api.get(url).json() == {"state": "none"}


def test_a_screenshot_that_never_comes_back_is_asked_again(tmp_path, monkeypatch):
    """Seen on the Space: a capture hung on a layout's last frame, held the
    socket for the twelve minutes left of the budget and threw away eight
    hundred good frames — while the very next run rendered in under three.
    A stuck compositor is a transient thing, so the frame is asked for again."""
    monkeypatch.setattr(recorder.subprocess, "Popen", FakeFfmpeg)
    out = tmp_path / "landscape.mp4"
    out.write_bytes(b"mp4")
    tab = FakeTab(stuck=2)
    layout, _ = recorder._record_layout(
        tab, tmp_path / "s.f32", out, nice=10, deadline=time.monotonic() + 300.0,
    )
    assert layout.timing["stuck_captures"] == 2
    # Two frames' worth of captures lost and asked again, and every frame drawn.
    assert [what for what, _ in tab.waited].count("Page.captureScreenshot") == 7


def test_a_capture_stuck_for_good_still_fails_the_clip(tmp_path, monkeypatch):
    monkeypatch.setattr(recorder.subprocess, "Popen", FakeFfmpeg)
    out = tmp_path / "landscape.mp4"
    out.write_bytes(b"mp4")
    tab = FakeTab(stuck=99)
    with pytest.raises(TimeoutError, match="timed out in"):
        recorder._record_layout(
            tab, tmp_path / "s.f32", out, nice=10, deadline=time.monotonic() + 300.0,
        )
    assert [what for what, _ in tab.waited].count("Page.captureScreenshot") == recorder.CAPTURE_TRIES


def test_a_failed_clip_is_owed_one_more_go_at_the_next_boot(tmp_path):
    """A failure here is a stuck browser far more often than a broken run, and
    it used to be forever: the marker is written once and the drain skipped it,
    so a transient hang cost a publication its clip until someone went into the
    store by hand. A boot is a new browser; it is worth one more render."""
    store = LocalStore(tmp_path)
    store.mark_clip_pending("P1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    store.fail_clip("F1", "2026-09-16T10:05:00Z", "TimeoutError: timed out in 736.5s")
    store.put_clip("R1", {"clip.json": b"{}"})

    worker = ClipRenderer(store, "http://127.0.0.1:1", tmp_path, render=None, log=lambda _: None)
    worker.drain()
    # Behind what is owed, never in front of it: a fresh publish waits for
    # nobody's retry.
    assert [(item[0], item[-1]) for item in sorted(worker.queue.queue)] == [(0, "P1"), (1, "F1")]


def test_each_layout_gets_a_browser_of_its_own(tmp_path, monkeypatch):
    """Two tabs in one browser means one of them is always the background tab,
    and a backgrounded renderer stops committing frames. Measured on the Space
    over seven clips: every landscape layout — the tab that was opened first —
    stalled once or twice on its screenshot, and no vertical one ever did.
    Chrome's own anti-backgrounding flags did not change it; being the only tab
    in a browser is what takes the question away."""
    opened = []

    class FakeChrome:
        def __init__(self, binary, nice=10):
            self.closed = False
            opened.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.close()

        def close(self):
            self.closed = True

    made = RenderedLayout(mp4=b"mp4", plan={"fps": 25, "frames": 4, "seconds": 0.16},
                          crowd=None, timing={})
    monkeypatch.setattr(recorder, "Chrome", FakeChrome)
    monkeypatch.setattr(recorder, "find_chrome", lambda: "/chrome")
    monkeypatch.setattr(recorder, "ffmpeg_available", lambda: True)
    monkeypatch.setattr(recorder, "_open", lambda *_: FakeTab())
    monkeypatch.setattr(recorder, "_soundtrack", lambda _: b"")
    monkeypatch.setattr(recorder, "_record_layout", lambda *_, **__: (made, b"png"))

    steps = []
    run = recorder.record_run("http://o", "R1", parallel=2,
                              on_progress=lambda stage, *_: steps.append(stage))
    assert len(opened) == len(recorder.SIZES) == 2
    # Every browser is killed, whichever layout finished first.
    assert all(chrome.closed for chrome in opened)
    assert set(run.layouts) == set(recorder.SIZES) and run.poster == b"png"
    assert steps[:2] == ["opening", "soundtrack"]
