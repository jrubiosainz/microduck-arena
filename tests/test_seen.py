"""A result its author has opened: one file per run, written once, never rewritten."""

import numpy as np
from fastapi.testclient import TestClient

from arena.store import LocalStore
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record


def test_marking_a_run_seen_is_one_file_and_the_first_visit_stays(tmp_path):
    store = LocalStore(tmp_path)
    assert store.seen() == frozenset()
    store.mark_seen("R1", "alice", "2026-09-15T10:00:00Z")
    store.mark_seen("R1", "alice", "2026-09-15T11:00:00Z")
    assert store.seen() == frozenset({"R1"})
    written = (tmp_path / "seen" / "R1.json").read_text()
    assert "10:00:00Z" in written and "11:00:00Z" not in written


def app_with(tmp_path, dev_user):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user=dev_user)
    app = create_app(config)
    return TestClient(app), app


def record_run(app, **overrides):
    record = make_record(**overrides)
    app.state.store.append(record, encode(np.zeros((5, 21), dtype=np.float32)))
    return record


def test_the_author_marks_a_run_seen_and_the_dot_goes_out(tmp_path):
    api, app = app_with(tmp_path, dev_user="alice")
    run = record_run(app, user="alice")
    me = api.get("/api/me").json()
    # first entry 100 + run 10 + first place 250
    assert (me["points"], me["unseen"]) == (360, 1)
    assert api.get(f"/api/runs/{run.run_id}").json()["seen"] is False

    assert api.post(f"/api/runs/{run.run_id}/seen").json() == {"seen": True}
    assert api.post(f"/api/runs/{run.run_id}/seen").status_code == 200  # a double-click

    assert api.get(f"/api/runs/{run.run_id}").json()["seen"] is True
    assert api.get("/api/me").json()["unseen"] == 0


def test_only_the_author_can_mark_a_run_seen(tmp_path):
    api, app = app_with(tmp_path, dev_user="bob")
    run = record_run(app, user="alice")
    assert api.post(f"/api/runs/{run.run_id}/seen").status_code == 403
    assert app.state.store.seen() == frozenset()
