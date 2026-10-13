"""Every checkpoint is evaluated: exported exactly as `publish` would, then raced by the Arena's own
evaluator, one at a time, newest run first; the result is stored and replayed at once."""

import base64
import json
import os
import threading
import time

from arena.constants import TRACE_WIDTH
from arena.workshop.evaluations import evaluate_next, next_checkpoint
from tests.workshop.conftest import make_run, store_evaluation

SPRINT_URL = "/api/workshop/challenges/sprint-2m"


def state(client):
    return client.app.state.workshop


def picked(client):
    found = next_checkpoint(state(client).root, list(state(client).challenges.values()))
    return (found[1].id, found[2]) if found else None


def rows(client):
    (ticket,) = client.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    return [(c["n"], c["status"]) for c in ticket["checkpoints"]]


def test_a_checkpoint_is_exported_by_a_dry_run_publish_and_raced(workshop, fakes, checkout):
    run = make_run(checkout, "first", checkpoints=(1,))
    assert evaluate_next(state(workshop)) is True
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/1").json()
    # The fake export hands over the Arena's reference walker, which finishes the sprint.
    assert (body["seeds_total"], body["seeds_finished"]) == (5, 5)
    assert body["checkpoint"] == 1 and body["score"] < 50
    assert len(base64.b64decode(body["trace_b64"])) % (4 * TRACE_WIDTH) == 0
    assert body["ducks"] == 1  # a race is one duck
    (publish,) = fakes.calls("publish")
    assert publish[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert "--dry-run" in publish and "--allow-dirty" in publish
    assert not (checkout / "publish-workshop-evaluation").exists()
    assert (run / "workshop" / "model_1.onnx").is_file()
    assert rows(workshop) == [(1, "evaluated")]
    assert evaluate_next(state(workshop)) is False  # nothing left


def test_the_newest_run_goes_first_its_checkpoints_in_order(workshop, checkout):
    old = make_run(checkout, "old", stamp="2026-09-20_10-00-00")
    new = make_run(checkout, "new", stamp="2026-09-28_10-00-00")
    order = []
    while (found := picked(workshop)) is not None:
        order.append(found)
        store_evaluation(new if found[0] == new.name else old, found[1])
    assert order == [(new.name, 0), (new.name, 1), (old.name, 0), (old.name, 1)]


def test_a_checkpoint_still_being_written_waits(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,), age_s=0)
    assert picked(workshop) is None
    old = time.time() - 60
    os.utime(run / "model_0.pt", (old, old))
    assert picked(workshop) == (run.name, 0)


def test_a_failed_export_is_stored_and_tried_again_only_once_the_file_changes(workshop, fakes, checkout, monkeypatch):
    run = make_run(checkout, "first", checkpoints=(0,))
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    assert evaluate_next(state(workshop)) is True
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/0").json()
    assert body["checkpoint"] == 0 and "publish: boom" in body["error"]
    assert rows(workshop) == [(0, "failed")]
    assert picked(workshop) is None
    older = time.time() - 120
    os.utime(run / "model_0.pt", (older, older))
    assert picked(workshop) == (run.name, 0)


def test_any_failure_while_measuring_is_stored_and_the_worker_moves_on(workshop, fakes, checkout, monkeypatch):
    """One checkpoint that breaks the evaluator must not keep the worker on it forever."""
    from arena.workshop import evaluations

    def breaks(event, policy, timeline=None):
        raise FloatingPointError("the simulation diverged")

    run = make_run(checkout, "first", checkpoints=(0,))
    monkeypatch.setattr(evaluations, "evaluate", breaks)
    assert evaluate_next(state(workshop)) is True
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/0").json()
    assert "FloatingPointError: the simulation diverged" in body["error"]
    assert rows(workshop) == [(0, "failed")] and picked(workshop) is None


def test_a_result_from_another_runner_version_is_measured_again(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,))
    store_evaluation(run, 0)
    assert picked(workshop) is None
    cache = run / "workshop" / "model_0.json"
    cache.write_text(json.dumps(json.loads(cache.read_text()) | {"runner_version": -1}))
    assert picked(workshop) == (run.name, 0)


def test_a_corrupt_store_is_measured_again_and_breaks_nothing(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,))
    (run / "workshop").mkdir()
    (run / "workshop" / "model_0.json").write_text("{not json")
    assert rows(workshop) == [(0, "queued")]
    assert picked(workshop) == (run.name, 0)


def test_a_checkpoint_not_evaluated_yet_is_404(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0,))
    response = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/0")
    assert response.status_code == 404 and "not evaluated yet" in response.json()["detail"]
    assert workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/7").status_code == 404


def test_a_stale_staging_dir_is_not_reused(workshop, fakes, checkout, monkeypatch):
    run = make_run(checkout, "first", checkpoints=(1,))
    stale = checkout / "publish-workshop-evaluation"
    stale.mkdir()
    (stale / "policy.onnx").write_bytes(b"not a real model")
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    evaluate_next(state(workshop))
    assert not stale.exists()
    monkeypatch.delenv("FAKE_UV_FAIL_PUBLISH")
    older = time.time() - 120
    os.utime(run / "model_1.pt", (older, older))
    evaluate_next(state(workshop))
    body = workshop.get(f"{SPRINT_URL}/jobs/{run.name}/checkpoints/1").json()
    assert (body["seeds_total"], body["seeds_finished"]) == (5, 5)


def test_a_dirty_run_is_evaluated_too(workshop, fakes, checkout):
    make_run(checkout, "first", checkpoints=(1,), dirty=True)
    evaluate_next(state(workshop))
    assert rows(workshop) == [(1, "evaluated")]


def test_the_evaluator_and_its_threads_stop_with_the_app(checkout, fakes, hub):
    from fastapi.testclient import TestClient

    from arena.workshop.app import create_workshop_app
    from arena.workshop.challenges import open_challenges
    from tests.workshop.conftest import ADDRESS, PORT

    app = create_workshop_app(checkout, open_challenges(checkout), "http://arena.test", hub, PORT)
    with TestClient(app, base_url=ADDRESS):
        assert "workshop-evaluator" in {t.name for t in threading.enumerate()}
    assert app.state.workshop.stopping.is_set()
