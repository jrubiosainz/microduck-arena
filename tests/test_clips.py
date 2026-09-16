"""Clips: three write-once files per run, and a worker that owes one per publish."""

import json

import pytest

from arena.store import LocalStore


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


from pathlib import Path

from arena.recorder import ffmpeg_args


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
    assert args[-1] == "/tmp/out.mp4"
