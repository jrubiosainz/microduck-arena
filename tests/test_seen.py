"""A result its author has opened: one file per run, written once, never rewritten."""

import numpy as np  # noqa: F401
from fastapi.testclient import TestClient  # noqa: F401

from arena.store import LocalStore
from arena.trace import encode  # noqa: F401
from arena.web.app import create_app  # noqa: F401
from arena.web.config import ArenaConfig  # noqa: F401
from tests.test_store import make_record  # noqa: F401


def test_marking_a_run_seen_is_one_file_and_the_first_visit_stays(tmp_path):
    store = LocalStore(tmp_path)
    assert store.seen() == frozenset()
    store.mark_seen("R1", "alice", "2026-09-15T10:00:00Z")
    store.mark_seen("R1", "alice", "2026-09-15T11:00:00Z")
    assert store.seen() == frozenset({"R1"})
    written = (tmp_path / "seen" / "R1.json").read_text()
    assert "10:00:00Z" in written and "11:00:00Z" not in written
