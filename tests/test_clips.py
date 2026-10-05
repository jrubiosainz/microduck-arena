"""Clips: three write-once files per run, rendered by an HF Job launched per publish."""

import base64
import io
import json
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena import recorder
from arena.clips import (
    CLIP_VERSION,
    JOB_TRIES,
    RETRY_S,
    ClipJobs,
    ClipRenderer,
    clip_manifest,
)
from arena.recorder import RenderedLayout, RenderedRun, ffmpeg_args
from arena.store import LocalStore, Withdrawal
from arena.trace import encode as encode_trace
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_routes_submit import (  # noqa: F401 — hub is an autouse fixture
    REFERENCE,
    hub,
    submit,
)
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


class FakeJobs:
    """The Jobs API as ClipJobs uses it: launches are recorded, and each job's
    stage, message and log are the test's to set."""

    def __init__(self, refuse=0, left=()):
        self.launched = []
        self.stage = {}
        self.message = {}
        self.logs = {}
        self.refuse = refuse
        self.left = list(left)

    def run_job(self, **job):
        if self.refuse:
            self.refuse -= 1
            raise RuntimeError("402 Payment Required")
        job_id = f"J{len(self.launched) + 1}"
        self.launched.append({"id": job_id, **job})
        self.stage[job_id] = "SCHEDULING"
        return SimpleNamespace(id=job_id)

    def inspect_job(self, *, job_id, namespace=None):
        return SimpleNamespace(status=SimpleNamespace(stage=self.stage[job_id],
                                                      message=self.message.get(job_id)))

    def fetch_job_logs(self, *, job_id, namespace=None, tail=None):
        return self.logs.get(job_id, [])[-tail:]

    def list_jobs(self, *, status=None, labels=None, namespace=None):
        return self.left


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def jobs_for(store, api, **options):
    return ClipJobs(store, space_id="pollen-robotics/microduck-arena", dataset="pollen-robotics/runs",
                    token="hf_x", api=api, log=lambda _: None, **options)


def written(store, run_id):
    """What a clip job leaves behind when its render succeeds."""
    store.put_clip(run_id, {"clip.json": json.dumps({"run_id": run_id, "layouts": {}}).encode()})


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


def test_a_clip_job_renders_its_run_and_records_a_failure(tmp_path):
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    store.mark_clip_pending("R2", "bob", "sprint-2m", "2026-09-16T10:01:00Z")
    asked = []

    def render(origin, run_id, parallel, budget_s, gpu, on_progress):
        asked.append(gpu)
        if run_id == "R2":
            raise RuntimeError("ffmpeg exited 1")
        return rendered()

    said = []
    renderer = ClipRenderer(store, "http://127.0.0.1:1", tmp_path, gpu=True, render=render,
                            log=said.append)
    assert renderer.render_one("R1") is True
    assert renderer.render_one("R2") is False
    assert asked == [True, True]
    state, manifest = store.clip_state("R1")
    assert state == "ready" and manifest["run_id"] == "R1"
    assert store.clip_file("R1", "vertical.mp4").read_bytes() == b"mp4"
    assert store.clip_state("R2")[1]["reason"] == "RuntimeError: ffmpeg exited 1"
    assert any("RuntimeError: ffmpeg exited 1" in line for line in said)



def test_a_publish_owes_a_clip_only_where_jobs_can_run(tmp_path, monkeypatch):
    # Off a Space there is no image for a job to run: nothing is owed.
    monkeypatch.delenv("SPACE_ID", raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie", clip_worker=False)
    app = create_app(config)
    assert app.state.clips.available is False
    api = TestClient(app)
    run_id = submit(api, REFERENCE).json()["run_id"]
    assert app.state.store.clip_state(run_id) == ("none", None)
    # Withdrawn: otherwise re-submitting the identical policy is the same user
    # re-entering the same ONNX, which comes back as this run, unraced — no
    # second publish to owe a clip for.
    assert api.post(f"/api/runs/{run_id}/withdraw").status_code == 200

    monkeypatch.setattr(app.state.clips, "available", True)
    run_id = submit(api, REFERENCE).json()["run_id"]
    assert app.state.store.clip_state(run_id) == ("pending", None)
    assert app.state.clips.progress(run_id) == {"ahead": 0}



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

    jobs = jobs_for(store, FakeJobs(), backfill=True)
    jobs.drain()
    # The fresh publish first, then the log newest first; the rendered and the
    # withdrawn are not owed.
    assert [item[2] for item in sorted(jobs.queue.queue)] == ["R9", newer.run_id, old.run_id]

    quiet = jobs_for(store, FakeJobs())
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
    # Every media URL carries the render it belongs to: the files are cached
    # for a year as immutable, and a clip rendered again on a new stage would
    # otherwise play as the old one for everyone who had watched it once.
    assert body["poster"] == f"{url}/poster.png?v=20260916T100500Z"
    assert body["layouts"]["vertical"] == {
        "url": f"{url}/vertical.mp4?v=20260916T100500Z", "width": 1080, "height": 1920,
        "seconds": 7.52
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
            f'{record.run_id}/clip/poster.png?v=20260916T100500Z">') in page
    assert (f'<meta property="og:video" content="https://arena.hf.space/api/runs/'
            f'{record.run_id}/clip/landscape.mp4?v=20260916T100500Z">') in page
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


def test_a_performance_is_described_as_one():
    from arena.manifest import load_event
    from arena.web.routes_unfurl import describe

    talent = load_event("got-a-talent")
    played = make_record(user="eve", event_id="got-a-talent", score=20.0, seeds_finished=1)
    assert describe(played, None, talent) == "@eve's duck gave a 20.00 s performance on MicroDuck Got a Talent."
    cut = make_record(user="eve", event_id="got-a-talent", score=20.0, seeds_finished=0)
    assert describe(cut, None, talent) == "@eve's duck performed on MicroDuck Got a Talent; the performance was cut short."



def test_the_jobs_say_where_a_clip_stands(tmp_path):
    """A place on the list, then a job's stage and frames read off its log:
    never off the store, which knows only that a clip is owed."""
    store = LocalStore(tmp_path)
    api = FakeJobs()
    jobs = jobs_for(store, api, running=1)
    assert jobs.progress("R1") is None

    jobs.enqueue("R1")
    jobs.enqueue("R2")
    # A backfill joins behind whatever a player just published, so the position
    # a page shows is the pop order, not the order things were put in.
    jobs.enqueue("R0", priority=1)
    jobs.enqueue("R3")
    jobs.enqueue("R1")
    assert jobs.progress("R1") == {"ahead": 0}
    assert jobs.progress("R3") == {"ahead": 2}
    assert jobs.progress("R0") == {"ahead": 3}

    # Launched: off the list, so the line behind it counts from the front again.
    jobs.tick()
    assert jobs.progress("R1") == {"stage": "opening", "done": 0, "total": 0}
    assert jobs.progress("R2") == {"ahead": 0}
    api.stage["J1"] = "RUNNING"
    api.logs["J1"] = ["clip: rendering R1", "clip: soundtrack 0/0", "clip: frames 300/880",
                      "clip: frames 310/880", "a line of Chrome's own"]
    jobs.tick()
    assert jobs.progress("R1") == {"stage": "frames", "done": 310, "total": 880}
    # Ended with its clip written: the store answers for it now.
    written(store, "R1")
    api.stage["J1"] = "COMPLETED"
    jobs.tick()
    assert jobs.progress("R1") is None
    assert jobs.progress("R2") == {"stage": "opening", "done": 0, "total": 0}



def test_a_clip_job_logs_its_steps_for_the_space_to_read(tmp_path):
    store = LocalStore(tmp_path)

    def render(origin, run_id, parallel, budget_s, gpu, on_progress):
        on_progress("opening", 0, 0)
        on_progress("soundtrack", 0, 0)
        for done in range(1, 377):
            on_progress("frames", done, 376)
        return rendered()

    said = []
    ClipRenderer(store, "http://127.0.0.1:1", tmp_path, render=render, log=said.append).render_one("R1")
    steps = [line for line in said if line.startswith("clip: ") and "/" in line]
    assert steps[:3] == ["clip: opening 0/0", "clip: soundtrack 0/0", "clip: frames 1/376"]
    # Every twentieth frame, and the last: a log the Space reads, not one per frame.
    assert steps[3] == "clip: frames 21/376" and steps[-1] == "clip: frames 376/376"
    assert len(steps) < 30



def test_the_clip_route_follows_a_job_and_says_why_one_failed(tmp_path):
    api, app, record = app_with_run(tmp_path)
    store = app.state.store
    url = f"/api/runs/{record.run_id}/clip"
    store.mark_clip_pending(record.run_id, "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    jobs = FakeJobs()
    app.state.clips = jobs_for(store, jobs)
    app.state.clips.enqueue(record.run_id)
    app.state.clips.tick()
    jobs.stage["J1"] = "RUNNING"
    jobs.logs["J1"] = ["clip: frames 310/880"]
    app.state.clips.tick()
    assert api.get(url).json() == {
        "state": "rendering", "stage": "frames", "done": 310, "total": 880
    }

    store.fail_clip(record.run_id, "2026-09-16T10:05:00Z", "TimeoutError: timed out in 60.0s")
    jobs.stage["J1"] = "ERROR"
    app.state.clips.tick()
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
    the store still says `none` for a run being rendered right now. Only the
    jobs know; a page that trusted the store alone showed no clip row at all
    while the clip was being made — the same silence as a render that failed."""
    api, app, record = app_with_run(tmp_path)
    url = f"/api/runs/{record.run_id}/clip"
    assert app.state.store.clip_state(record.run_id) == ("none", None)

    app.state.clips = jobs_for(app.state.store, FakeJobs())
    app.state.clips.enqueue(record.run_id, priority=1)
    assert api.get(url).json() == {"state": "queued", "ahead": 0}
    app.state.clips.tick()
    assert api.get(url).json() == {
        "state": "rendering", "stage": "opening", "done": 0, "total": 0
    }


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
    store by hand. A boot is a new job; it is worth one more render."""
    store = LocalStore(tmp_path)
    store.mark_clip_pending("P1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    store.fail_clip("F1", "2026-09-16T10:05:00Z", "TimeoutError: timed out in 736.5s")
    store.put_clip("R1", {"clip.json": b"{}"})

    jobs = jobs_for(store, FakeJobs())
    jobs.drain()
    # Behind what is owed, never in front of it: a fresh publish waits for
    # nobody's retry.
    assert [(item[0], item[-1]) for item in sorted(jobs.queue.queue)] == [(0, "P1"), (1, "F1")]


def test_each_layout_gets_a_browser_of_its_own(tmp_path, monkeypatch):
    """Two tabs in one browser means one of them is always the background tab,
    and a backgrounded renderer stops committing frames. Measured on the Space
    over seven clips: every landscape layout — the tab that was opened first —
    stalled once or twice on its screenshot, and no vertical one ever did.
    Chrome's own anti-backgrounding flags did not change it; being the only tab
    in a browser is what takes the question away."""
    opened = []

    class FakeChrome:
        def __init__(self, binary, nice=10, gpu=False):
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


def test_a_longer_clip_gets_as_much_time_per_frame_as_a_race():
    """The 900 s budget was sized on a race's longest clip, 451 frames. A 20 s performance on the
    stage has 651, and the first one on the Space failed at frame 649: it was slow at a race's
    pace, not stuck. A longer clip gets the same time per frame; a race's keeps the whole budget."""
    assert recorder.budget_for(900.0, 451) == 900.0
    assert recorder.budget_for(900.0, 321) == 900.0
    assert recorder.budget_for(900.0, 651) == pytest.approx(900.0 * 651 / 451)


def test_a_clip_job_runs_this_spaces_image_and_writes_to_its_dataset(tmp_path):
    store = LocalStore(tmp_path)
    api = FakeJobs()
    jobs = jobs_for(store, api)
    jobs.enqueue("R1")
    jobs.tick()
    job = api.launched[0]
    # The same code and browser as the Space, on a GPU, paid by the Space's owner.
    assert job["image"] == "hf.co/spaces/pollen-robotics/microduck-arena"
    assert job["command"] == ["arena", "clip", "R1", "--store", "/tmp/arena-board"]
    assert job["env"] == {"ARENA_DATASET": "pollen-robotics/runs", "ARENA_COMMENTARY": "0",
                          "ARENA_CLIP_GPU": "1"}
    assert job["secrets"] == {"HF_TOKEN": "hf_x"}
    assert job["flavor"] == "t4-small" and job["namespace"] == "pollen-robotics"
    assert job["labels"] == {"arena": "clip", "run": "R1"}

    cpu = FakeJobs()
    on_cpu = jobs_for(store, cpu, flavor="cpu-upgrade", namespace="Nico-robot")
    on_cpu.enqueue("R2")
    on_cpu.tick()
    assert cpu.launched[0]["env"]["ARENA_CLIP_GPU"] == "0"
    assert cpu.launched[0]["namespace"] == "Nico-robot"


def test_no_more_jobs_run_at_once_than_allowed(tmp_path):
    store = LocalStore(tmp_path)
    api = FakeJobs()
    jobs = jobs_for(store, api, running=2)
    for run_id in ("R1", "R2", "R3"):
        jobs.enqueue(run_id)
    jobs.tick()
    assert [job["labels"]["run"] for job in api.launched] == ["R1", "R2"]
    assert jobs.progress("R3") == {"ahead": 0}
    written(store, "R1")
    api.stage["J1"] = "COMPLETED"
    jobs.tick()
    assert [job["labels"]["run"] for job in api.launched] == ["R1", "R2", "R3"]


def test_a_refused_launch_leaves_the_run_on_the_list_until_later(tmp_path):
    """When the jobs stop working, nothing is rendered elsewhere: the run stays
    owed, in its place, and the launch is tried again later."""
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    api, clock = FakeJobs(refuse=1), Clock()
    said = []
    jobs = ClipJobs(store, space_id="o/s", dataset="o/d", token="t", api=api, log=said.append,
                    now=clock)
    jobs.enqueue("R1")
    jobs.tick()
    assert api.launched == [] and jobs.progress("R1") == {"ahead": 0}
    assert any("402 Payment Required" in line for line in said)
    clock.t = RETRY_S - 1
    jobs.tick()
    assert api.launched == []
    clock.t = RETRY_S
    jobs.tick()
    assert [job["labels"]["run"] for job in api.launched] == ["R1"]
    assert store.clip_state("R1") == ("pending", None)


def test_a_job_that_ended_without_a_clip_is_launched_again_then_failed(tmp_path):
    """Neither file written: the machine ended the job, not the render. Owed
    again a few times, then failed with the job's own last word."""
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    api = FakeJobs()
    landed = []
    jobs = jobs_for(store, api, landed=landed.append)
    jobs.enqueue("R1")
    for attempt in range(1, JOB_TRIES + 1):
        jobs.tick()
        api.stage[f"J{attempt}"] = "ERROR"
        api.message[f"J{attempt}"] = "image pull failed"
    jobs.tick()
    assert len(api.launched) == JOB_TRIES
    state, failed = store.clip_state("R1")
    assert state == "failed"
    assert failed["reason"] == f"job J{JOB_TRIES} ended ERROR: image pull failed"
    assert landed == ["R1"] * JOB_TRIES
    assert jobs.progress("R1") is None


def test_a_boot_takes_over_the_jobs_a_previous_process_left_running(tmp_path):
    """A redeploy does not end the jobs it launched: the next boot follows them
    instead of rendering the same clips a second time."""
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    store.mark_clip_pending("R2", "bob", "sprint-2m", "2026-09-16T10:01:00Z")
    api = FakeJobs(left=[SimpleNamespace(id="J0", labels={"arena": "clip", "run": "R1"})])
    api.stage["J0"] = "RUNNING"
    jobs = jobs_for(store, api)
    jobs.drain()
    jobs.tick()
    assert [job["labels"]["run"] for job in api.launched] == ["R2"]
    written(store, "R1")
    api.stage["J0"] = "COMPLETED"
    jobs.tick()
    assert jobs.progress("R1") is None and store.clip_state("R1")[0] == "ready"


def test_the_list_is_read_again_off_the_markers(tmp_path):
    """A clip owed by another process, or marked by hand, is launched without
    waiting for a boot: the pending markers are the list."""
    store = LocalStore(tmp_path)
    api, clock = FakeJobs(), Clock()
    jobs = jobs_for(store, api, now=clock)
    jobs.tick()
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    jobs.tick()
    assert api.launched == []
    clock.t = RETRY_S
    jobs.tick()
    assert [job["labels"]["run"] for job in api.launched] == ["R1"]


def test_a_clip_rendered_meanwhile_is_not_launched_again(tmp_path):
    store = LocalStore(tmp_path)
    api = FakeJobs()
    jobs = jobs_for(store, api)
    jobs.enqueue("R1")
    written(store, "R1")
    jobs.tick()
    assert api.launched == []


def test_a_restored_run_owes_a_clip_like_any_publication(tmp_path, monkeypatch):
    from arena import recover as recover_module

    record = make_record(user="apirrone")
    monkeypatch.setattr(recover_module, "recover", lambda store, events, on_event=None: [record])
    monkeypatch.setenv("ARENA_RECOVER", "1")
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path, clip_worker=False))
    monkeypatch.setattr(app.state.clips, "available", True)
    with TestClient(app):
        for _ in range(100):
            if app.state.clips.progress(record.run_id):
                break
            time.sleep(0.05)
    assert app.state.store.clip_state(record.run_id) == ("pending", None)
    assert app.state.clips.progress(record.run_id) == {"ahead": 0}


def test_a_boot_that_cannot_see_its_jobs_still_reads_the_list(tmp_path):
    """Listing the jobs left running can be refused (a token without job.read):
    what is owed is still owed, read off the markers."""
    store = LocalStore(tmp_path)
    store.mark_clip_pending("R1", "alice", "sprint-2m", "2026-09-16T10:00:00Z")
    api = FakeJobs()

    def refused(**_):
        raise RuntimeError("403 Forbidden: missing permissions: job.read")

    api.list_jobs = refused
    said = []
    jobs = ClipJobs(store, space_id="o/s", dataset="o/d", token="t", api=api, log=said.append)
    jobs.drain()
    assert jobs.progress("R1") == {"ahead": 0}
    assert any("job.read" in line for line in said)


def test_the_jobs_are_launched_with_their_own_token_and_render_with_the_spaces(tmp_path):
    """The token that launches jobs never enters one: the job writes to the
    dataset with the Space's own."""
    jobs = ClipJobs(LocalStore(tmp_path), space_id="o/s", dataset="o/d", token="hf_dataset",
                    jobs_token="hf_jobs", log=lambda _: None)
    assert jobs.api.token == "hf_jobs"
    api = FakeJobs()
    jobs.api = api
    jobs.enqueue("R1")
    jobs.tick()
    assert api.launched[0]["secrets"] == {"HF_TOKEN": "hf_dataset"}
