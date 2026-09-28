"""Launching commits the knobs and trains — here with a GPU, on HF Jobs without one — and an HF run
is brought back into logs/ so Test and Publish find it where they find a local one."""

import pytest

from tests.workshop.conftest import SPRINT, git, make_run, wait_for

LAUNCH = {"name": "first", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3}, "params": {"forward_reward": 3.5}}


def _finished(workshop):
    body = workshop.get("/api/workshop/train?since=0").json()
    return body if body["state"] in ("finished", "failed", "stopped") else None


def test_launch_commits_the_recipe_and_knobs_then_trains_here(workshop, fakes, checkout):
    fakes.gpu()
    assert workshop.post("/api/workshop/train", json=LAUNCH).status_code == 200
    body = wait_for(lambda: _finished(workshop))
    assert body["state"] == "finished" and body["mode"] == "local"
    toml = (checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml").read_text()
    assert "num_envs       = 512" in toml and "value = 3.5" in toml and "# the first training, as is" in toml
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m: run first"
    assert git(checkout, "status", "--porcelain") == ""
    (train,) = fakes.calls("train")
    assert train == ["run", "--no-sync", "train", "Mjlab-Sprint2m-MicroDuck", "--env.scene.num-envs", "512",
                     "--agent.max-iterations", "50", "--agent.seed", "3", "--agent.logger", "tensorboard",
                     "--agent.run-name", "first"]
    (run,) = workshop.get("/api/workshop/runs").json()["runs"]
    assert run["name"] == "first" and run["checkpoints"] == [0, 1] and run["dirty"] is False
    points = workshop.get(f"/api/workshop/runs/{run['id']}/curve").json()["points"]
    assert [step for step, _ in points] == [1, 2]


def test_without_a_gpu_it_trains_on_hf_jobs_and_brings_the_run_back(workshop, fakes, checkout):
    workshop.post("/api/workshop/train", json=LAUNCH)
    body = wait_for(lambda: _finished(workshop))
    assert body["mode"] == "hf-jobs" and body["state"] == "finished"
    assert body["ckpt_repo"] == "alice/mjlab-sprint2m-microduck-first" and body["job_id"] == "fakejob42"
    (train,) = fakes.calls("train")
    assert train[-6:] == ["--hf-jobs", "--no-wandb", "--namespace", "alice", "--ckpt-repo",
                          "alice/mjlab-sprint2m-microduck-first"]
    assert ["run", "--no-sync", "hf", "download", "alice/mjlab-sprint2m-microduck-first",
            "--local-dir", "logs/rsl_rl", "--quiet"] in fakes.calls("hf")
    assert [r["name"] for r in workshop.get("/api/workshop/runs").json()["runs"]] == ["first"]
    assert any("fetched the checkpoints" in line for line in body["log"])


def test_an_hf_run_appears_only_once_pulled(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: any("[job] id:" in l for l in workshop.get("/api/workshop/train?since=0").json()["log"]))
    assert workshop.get("/api/workshop/runs").json()["runs"] == []
    assert workshop.post("/api/workshop/train/pull").status_code == 200
    (run,) = workshop.get("/api/workshop/runs").json()["runs"]
    assert run["checkpoints"] == [0, 1]
    workshop.post("/api/workshop/train/stop")


def test_hf_jobs_needs_a_hugging_face_login_and_nothing_is_touched_without_one(workshop, hub, checkout, fakes):
    hub.user = None
    response = workshop.post("/api/workshop/train", json=LAUNCH)
    assert response.status_code == 400 and "log" in response.json()["detail"].lower()
    assert (checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml").read_text() == SPRINT
    assert fakes.calls("train") == []


def test_a_second_launch_while_one_runs_is_refused(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    again = workshop.post("/api/workshop/train", json=LAUNCH | {"name": "second"})
    assert again.status_code == 409
    workshop.post("/api/workshop/train/stop")


def test_a_run_name_already_on_disk_is_refused(workshop, fakes, checkout):
    fakes.gpu()
    make_run(checkout, "first")
    assert workshop.post("/api/workshop/train", json=LAUNCH).status_code == 409


@pytest.mark.parametrize("name", ["", "First", "a b", "x" * 41, "-lead"])
def test_a_run_name_must_be_a_plain_slug(workshop, fakes, name):
    fakes.gpu()
    assert workshop.post("/api/workshop/train", json=LAUNCH | {"name": name}).status_code == 400


def test_a_knob_out_of_range_is_refused_and_nothing_is_written(workshop, fakes, checkout):
    fakes.gpu()
    response = workshop.post("/api/workshop/train", json=LAUNCH | {"params": {"forward_reward": 50.0}})
    assert response.status_code == 400 and "between" in response.json()["detail"]
    assert (checkout / "src" / "microduck_challenges" / "sprint_2m" / "challenge.toml").read_text() == SPRINT


def test_stop_ends_a_local_training(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    assert workshop.post("/api/workshop/train/stop").status_code == 200
    assert wait_for(lambda: _finished(workshop))["state"] == "stopped"


def test_stop_cancels_the_hf_job_it_follows(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post("/api/workshop/train", json=LAUNCH)
    wait_for(lambda: workshop.get("/api/workshop/train?since=0").json()["job_id"])
    workshop.post("/api/workshop/train/stop")
    assert hub.cancelled == [("fakejob42", "alice")]
    assert wait_for(lambda: _finished(workshop))["state"] == "stopped"


def test_a_failed_training_says_so_with_its_code(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_RC", "3")
    workshop.post("/api/workshop/train", json=LAUNCH)
    body = wait_for(lambda: _finished(workshop))
    assert (body["state"], body["returncode"]) == ("failed", 3)


def test_the_log_is_read_from_an_offset(workshop, fakes):
    fakes.gpu()
    workshop.post("/api/workshop/train", json=LAUNCH)
    whole = wait_for(lambda: _finished(workshop))
    assert whole["log"][0].startswith("$ uv run --no-sync train")
    tail = workshop.get(f"/api/workshop/train?since={whole['next'] - 1}").json()
    assert tail["log"] == whole["log"][-1:]


def test_nothing_launched_yet(workshop):
    assert workshop.get("/api/workshop/train?since=0").json() == {"state": None}
    assert workshop.post("/api/workshop/train/stop").status_code == 409
