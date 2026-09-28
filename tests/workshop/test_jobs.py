"""A Hugging Face job outlives the workshop: each launch is written down under logs/, so a reopened
workshop can still fetch the job's checkpoints or stop it."""

import json

from fastapi.testclient import TestClient

from arena.workshop.app import create_workshop_app
from arena.workshop.challenges import open_challenges
from tests.workshop.conftest import ADDRESS, PORT, git, wait_for

LAUNCH = {"name": "first", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3}}
REPO = "alice/mjlab-sprint2m-microduck-first"


def _job_id(workshop):
    return workshop.get("/api/workshop/train?since=0").json()["job_id"]


def _ended(workshop):
    return workshop.get("/api/workshop/train?since=0").json()["state"] in ("finished", "failed", "stopped")


def _reopened(checkout, hub):
    """The workshop closed and opened again on the same checkout: nothing left in memory."""
    app = create_workshop_app(checkout, open_challenges(checkout)[0], "http://arena.test", hub, PORT,
                              open_browser=lambda url: None)
    return TestClient(app, base_url=ADDRESS)


def test_an_hf_launch_is_written_down_where_git_does_not_look(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _job_id(workshop))
    (job,) = json.loads((checkout / "logs" / "workshop-jobs.json").read_text())
    assert {k: job[k] for k in ("name", "ckpt_repo", "namespace", "job_id")} == {
        "name": "first", "ckpt_repo": REPO, "namespace": "alice", "job_id": "fakejob42"}
    assert job["started"].startswith("20")
    assert git(checkout, "status", "--porcelain") == ""
    workshop.post("/api/workshop/train/stop")


def test_the_record_keeps_the_resubmitted_jobs_id(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    monkeypatch.setenv("FAKE_UV_RESUBMIT", "1")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _job_id(workshop) == "fakejob43")
    (job,) = _reopened(checkout, hub).get("/api/workshop/jobs").json()["jobs"]
    assert job["job_id"] == "fakejob43"
    workshop.post("/api/workshop/train/stop")


def test_a_training_on_this_machine_is_not_recorded(workshop, fakes):
    fakes.gpu()
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _ended(workshop))
    assert workshop.get("/api/workshop/jobs").json() == {"jobs": []}


def test_jobs_are_listed_newest_first(workshop, fakes):
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _ended(workshop))
    workshop.post("/api/workshop/train", json=LAUNCH | {"name": "second"})
    wait_for(lambda: _ended(workshop))
    assert [j["name"] for j in workshop.get("/api/workshop/jobs").json()["jobs"]] == ["second", "first"]


def test_after_a_restart_the_job_can_still_be_fetched_and_stopped(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _job_id(workshop))
    reopened = _reopened(checkout, hub)
    assert reopened.get("/api/workshop/train?since=0").json() == {"state": None}
    (job,) = reopened.get("/api/workshop/jobs").json()["jobs"]
    assert (job["name"], job["ckpt_repo"], job["job_id"]) == ("first", REPO, "fakejob42")

    assert reopened.get("/api/workshop/runs").json()["runs"] == []
    pulled = reopened.post("/api/workshop/jobs/first/pull")
    assert pulled.status_code == 200, pulled.text
    assert ["run", "--no-sync", "hf", "download", REPO, "--local-dir", "logs/rsl_rl", "--quiet"] in fakes.calls("hf")
    (run,) = reopened.get("/api/workshop/runs").json()["runs"]
    assert run["name"] == "first" and run["checkpoints"] == [0, 1]

    assert reopened.post("/api/workshop/jobs/first/stop").status_code == 200
    assert hub.cancelled == [("fakejob42", "alice")]
    workshop.post("/api/workshop/train/stop")  # the first workshop's process, still following it


def test_a_cancel_the_hub_refuses_says_so_in_its_words(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _job_id(workshop))
    cancel = hub.cancel_job

    def down(job_id, namespace):
        raise RuntimeError("Hub is down")

    hub.cancel_job = down
    response = _reopened(checkout, hub).post("/api/workshop/jobs/first/stop")
    assert response.status_code == 502 and "Hub is down" in response.json()["detail"]
    hub.cancel_job = cancel
    workshop.post("/api/workshop/train/stop")


def test_a_fetch_that_fails_returns_its_output(workshop, fakes, monkeypatch):
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _ended(workshop))
    monkeypatch.setenv("FAKE_UV_FAIL_HF", "1")
    response = workshop.post("/api/workshop/jobs/first/pull")
    assert response.status_code == 502 and "hf: boom" in response.json()["detail"]


def test_a_job_never_launched_here_is_not_found(workshop):
    assert workshop.post("/api/workshop/jobs/nope/pull").status_code == 404
    assert workshop.post("/api/workshop/jobs/nope/stop").status_code == 404


def test_a_recorded_jobs_name_is_not_reused_before_its_run_is_fetched(workshop, fakes, checkout, hub, monkeypatch):
    """The name is also the checkpoint repo's: a second job under it would upload into the first's."""
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: _job_id(workshop))
    assert _reopened(checkout, hub).post("/api/workshop/train", json=LAUNCH).status_code == 409
    workshop.post("/api/workshop/train/stop")
