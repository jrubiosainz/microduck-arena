"""Test: the checkpoint is exported exactly as `publish` would, then raced by the Arena's own evaluator."""

import json

from arena.constants import TRACE_WIDTH
from tests.workshop.conftest import make_run


def _trial(workshop, run, checkpoint=1):
    return workshop.post(f"/api/workshop/runs/{run.name}/trial", json={"checkpoint": checkpoint})


def test_a_checkpoint_is_exported_by_a_dry_run_publish_and_raced(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    response = _trial(workshop, run)
    assert response.status_code == 200, response.text
    body = response.json()
    # The fake export hands over the Arena's reference walker, which finishes the sprint.
    assert (body["seeds_total"], body["seeds_finished"]) == (5, 5)
    assert body["checkpoint"] == 1 and body["score"] < 50
    import base64

    assert len(base64.b64decode(body["trace_b64"])) % (4 * TRACE_WIDTH) == 0
    (publish,) = fakes.calls("publish")
    assert publish[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert "--dry-run" in publish and "--allow-dirty" in publish
    assert not (checkout / "publish-workshop-trial").exists()
    assert (run / "workshop" / "model_1.onnx").is_file()


def test_the_same_checkpoint_comes_from_the_cache_the_second_time(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    first = _trial(workshop, run).json()
    assert _trial(workshop, run).json() == first
    assert len(fakes.calls("publish")) == 1


def test_a_result_from_another_runner_version_is_measured_again(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    _trial(workshop, run)
    cache = run / "workshop" / "model_1.json"
    cache.write_text(json.dumps(json.loads(cache.read_text()) | {"runner_version": -1}))
    _trial(workshop, run)
    assert len(fakes.calls("publish")) == 2


def test_a_failed_export_shows_its_whole_output(workshop, fakes, checkout, monkeypatch):
    run = make_run(checkout, "first")
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    response = _trial(workshop, run)
    assert response.status_code == 400 and "publish: boom" in response.json()["detail"]


def test_an_unknown_checkpoint_or_run_is_refused(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    assert _trial(workshop, run, checkpoint=7).status_code == 400
    assert workshop.post("/api/workshop/runs/nope/trial", json={"checkpoint": 1}).status_code == 404


def test_a_dirty_run_can_still_be_tested(workshop, fakes, checkout):
    run = make_run(checkout, "first", dirty=True)
    assert _trial(workshop, run).status_code == 200


def test_the_runs_listing_shows_what_was_tested(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    score = _trial(workshop, run).json()["score"]
    (listed,) = workshop.get("/api/workshop/runs").json()["runs"]
    assert set(listed["trials"]) == {"1"}
    assert listed["trials"]["1"]["score"] == score and listed["trials"]["1"]["seeds_finished"] == 5
    assert "trace_b64" not in listed["trials"]["1"]
