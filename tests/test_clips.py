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
