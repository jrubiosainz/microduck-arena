"""Launching: every training starts from a commit, on this machine's NVIDIA GPU or on Hugging Face
Jobs; any number of HF jobs run at once, one training at most on this machine."""

import json
import threading

import pytest

from arena.workshop.hub import HubUnreachable
from arena.workshop.watch import watch_once
from tests.workshop.conftest import SPRINT, edit_by_hand, git, make_run, reopen, wait_for

SPRINT_URL = "/api/workshop/challenges/sprint-2m"
TASK = "Mjlab-Sprint2m-MicroDuck"
LOCAL = {"name": "first", "where": "local", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3},
         "params": {"forward_reward": 3.5}}
HF = LOCAL | {"where": "hf-jobs"}
TOML = ("src", "microduck_challenges", "sprint_2m", "challenge.toml")


def launch(client, body, url=SPRINT_URL):
    return client.post(f"{url}/train", json=body)


def ended(client, ticket_id="first", url=SPRINT_URL):
    body = client.get(f"{url}/jobs/{ticket_id}").json()
    return body if body["state"] in ("done", "failed", "stopped") else None


def live(client, name="first", task=TASK):
    return client.app.state.workshop.trainings[(task, name)]


def test_a_launch_commits_the_settings_then_trains_here(workshop, fakes, checkout):
    fakes.gpu()
    response = launch(workshop, LOCAL)
    assert response.status_code == 200, response.text
    assert (response.json()["id"], response.json()["where"]) == ("first", "local")
    body = wait_for(lambda: ended(workshop))
    assert body["state"] == "done"
    toml = checkout.joinpath(*TOML).read_text()
    assert "num_envs       = 512" in toml and "value = 3.5" in toml and "# the first training, as is" in toml
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m: run first"
    assert git(checkout, "status", "--porcelain") == ""
    (train,) = fakes.calls("train")
    assert train == ["run", "--no-sync", "train", TASK, "--env.scene.num-envs", "512",
                     "--agent.max-iterations", "50", "--agent.seed", "3", "--agent.logger", "tensorboard",
                     "--agent.run-name", "first"]
    assert [c["n"] for c in body["checkpoints"]] == [0, 1]
    assert [step for step, _ in body["curve"]] == [1, 2]


def test_on_hf_jobs_it_submits_the_job_and_brings_the_run_back(workshop, fakes):
    launch(workshop, HF)
    body = wait_for(lambda: ended(workshop))
    assert body["where"] == "hf-jobs" and body["state"] == "done" and body["run_id"]
    (train,) = fakes.calls("train")
    assert train[-6:] == ["--hf-jobs", "--no-wandb", "--namespace", "alice", "--ckpt-repo",
                          "alice/mjlab-sprint2m-microduck-first"]
    assert ["run", "--no-sync", "hf", "download", "alice/mjlab-sprint2m-microduck-first",
            "--local-dir", "logs/rsl_rl", "--quiet"] in fakes.calls("hf")
    assert any("fetched the checkpoints" in line for line in body["log"])


def test_a_launch_reads_challenge_toml_as_it_is_now(workshop, fakes, checkout):
    """A hand edit committed while the workshop runs: its bounds are the ones checked, its values the
    ones kept."""
    fakes.gpu()
    edit_by_hand(checkout)
    response = launch(workshop, LOCAL | {"recipe": {"num_envs": 4096, "max_iterations": 10, "seed": 1},
                                         "params": {"forward_reward": 7.5}})
    assert response.status_code == 200, response.text
    toml = checkout.joinpath(*TOML).read_text()
    assert "max_iterations = 10" in toml and "value = 7.5" in toml and "max   = 8.0" in toml
    assert git(checkout, "log", "-1", "--format=%s") == "longer strides"  # nothing changed: no commit


def test_a_training_waits_for_a_commit(workshop, fakes, checkout):
    fakes.gpu()
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    response = launch(workshop, LOCAL)
    assert response.status_code == 409 and "Commit" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_this_machine_trains_only_with_an_nvidia_gpu(workshop, fakes, checkout):
    response = launch(workshop, LOCAL)
    assert response.status_code == 400 and "NVIDIA" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_hf_jobs_need_a_login_and_nothing_is_touched_without_one(workshop, hub, checkout, fakes):
    hub.user = None
    response = launch(workshop, HF)
    assert response.status_code == 400 and "log in" in response.json()["detail"].lower()
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_hf_jobs_say_when_the_hub_is_unreachable_and_touch_nothing(workshop, hub, checkout, fakes):
    hub.reachable = False
    response = launch(workshop, HF)
    assert response.status_code == 503 and "unreachable" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT and fakes.calls("train") == []


def test_several_hf_jobs_run_at_once(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    assert launch(workshop, HF).status_code == 200
    assert launch(workshop, HF | {"name": "second"}).status_code == 200
    states = {t["id"]: t["state"] for t in workshop.get(f"{SPRINT_URL}/jobs").json()["jobs"]}
    assert states == {"first": "running", "second": "running"}


def test_one_training_at_a_time_on_this_machine(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, LOCAL)
    again = launch(workshop, LOCAL | {"name": "second"})
    assert again.status_code == 409 and "this machine" in again.json()["detail"]
    assert launch(workshop, HF | {"name": "third"}).status_code == 200


def test_a_run_name_already_used_is_refused(workshop, fakes, checkout):
    fakes.gpu()
    make_run(checkout, "first")
    assert launch(workshop, LOCAL).status_code == 409


@pytest.mark.parametrize("name", ["", "First", "a b", "x" * 41, "-lead", "first-", "a--b"])
def test_a_run_name_must_be_a_plain_slug(workshop, fakes, name):
    fakes.gpu()
    assert launch(workshop, LOCAL | {"name": name}).status_code == 400


def test_a_training_runs_somewhere_the_workshop_knows(workshop, fakes):
    assert launch(workshop, LOCAL | {"where": "moon"}).status_code == 400


def test_a_knob_out_of_range_is_refused_and_nothing_is_written(workshop, fakes, checkout):
    fakes.gpu()
    response = launch(workshop, LOCAL | {"params": {"forward_reward": 50.0}})
    assert response.status_code == 400 and "between" in response.json()["detail"]
    assert checkout.joinpath(*TOML).read_text() == SPRINT


def test_an_unknown_challenge_is_404(workshop):
    assert launch(workshop, LOCAL, url="/api/workshop/challenges/moon-landing").status_code == 404


def test_the_same_run_name_in_two_challenges_does_not_mix(workshop, fakes, checkout, hub):
    """Review focus: the tickets of one challenge never show another's training."""
    hill = checkout / "src" / "microduck_challenges" / "hill_climb_1m5"
    hill.mkdir()
    (hill / "challenge.toml").write_text(SPRINT.replace('"sprint-2m"', '"hill-climb-1m5"')
                                         .replace(TASK, "Mjlab-HillClimb1m5-MicroDuck"))
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "the hill")
    fakes.gpu()
    both = reopen(checkout, hub)
    hill_url = "/api/workshop/challenges/hill-climb-1m5"
    assert launch(both, LOCAL).status_code == 200
    wait_for(lambda: ended(both))
    assert launch(both, HF, url=hill_url).status_code == 200
    wait_for(lambda: ended(both, url=hill_url))
    sprint_jobs = both.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    hill_jobs = both.get(f"{hill_url}/jobs").json()["jobs"]
    assert [(t["id"], t["where"]) for t in sprint_jobs] == [("first", "local")]
    assert [(t["id"], t["where"]) for t in hill_jobs] == [("first", "hf-jobs")]


def test_stop_ends_a_local_training(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, LOCAL)
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert wait_for(lambda: ended(workshop))["state"] == "stopped"


def test_stop_cancels_the_hf_job_it_follows(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id)
    workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert hub.cancelled == [("fakejob42", "alice")]
    assert wait_for(lambda: ended(workshop))["state"] == "stopped"


def test_stop_cancels_the_resubmitted_job_not_the_dead_first_one(workshop, fakes, hub, monkeypatch):
    """train --hf-jobs resubmits after a volume-mount failure, printing a fresh [job] id: each time;
    only the last one is still alive to cancel."""
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    monkeypatch.setenv("FAKE_UV_RESUBMIT", "1")
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id == "fakejob43")
    workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert hub.cancelled == [("fakejob43", "alice")]


def test_the_record_keeps_the_resubmitted_jobs_id(workshop, fakes, checkout, monkeypatch):
    """After a restart, the record's id is the only way to the job still billed."""
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    monkeypatch.setenv("FAKE_UV_RESUBMIT", "1")
    launch(workshop, HF)
    record = checkout / "logs" / "workshop-jobs.json"
    assert wait_for(lambda: json.loads(record.read_text())[0].get("job_id") == "fakejob43")


def test_a_stopped_hf_job_is_written_down_as_cancelled(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id)
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    (record,) = json.loads((checkout / "logs" / "workshop-jobs.json").read_text())
    assert record["stage"] == "CANCELED"
    assert wait_for(lambda: ended(workshop))["state"] == "stopped"
    watch_once(workshop.app.state.workshop, now=1000.0)
    assert hub.asked == []  # nothing left to ask of it


def test_a_stop_while_the_hub_is_unreachable_says_so_and_keeps_following(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    real_cancel_job = hub.cancel_job
    attempts = []

    def unreachable_once(job_id, namespace):
        attempts.append(job_id)
        if len(attempts) == 1:
            raise HubUnreachable("https://huggingface.co did not answer within 5 s")
        return real_cancel_job(job_id, namespace)

    hub.cancel_job = unreachable_once
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id)
    response = workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert response.status_code == 503 and "unreachable" in response.json()["detail"]
    assert workshop.get(f"{SPRINT_URL}/jobs/first").json()["state"] == "running"
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert hub.cancelled == [("fakejob42", "alice")]


def test_a_cancel_that_fails_502s_and_keeps_following(workshop, fakes, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    real_cancel_job = hub.cancel_job
    attempts = []

    def flaky_cancel(job_id, namespace):
        attempts.append(job_id)
        if len(attempts) == 1:
            raise RuntimeError("Hub is down")
        return real_cancel_job(job_id, namespace)

    hub.cancel_job = flaky_cancel
    launch(workshop, HF)
    wait_for(lambda: live(workshop).job_id)
    response = workshop.post(f"{SPRINT_URL}/jobs/first/stop")
    assert response.status_code == 502 and "cancel" in response.json()["detail"].lower()
    assert workshop.get(f"{SPRINT_URL}/jobs/first").json()["state"] == "running"
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert hub.cancelled == [("fakejob42", "alice")]


def test_a_failed_training_says_so(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_RC", "3")
    launch(workshop, LOCAL)
    assert wait_for(lambda: ended(workshop))["state"] == "failed"


def test_a_training_that_ended_cannot_be_stopped(workshop, fakes):
    fakes.gpu()
    launch(workshop, LOCAL)
    wait_for(lambda: ended(workshop))
    assert workshop.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 409


def test_two_launches_close_together_only_one_wins(workshop, fakes, monkeypatch):
    """Without the lock both could pass the one-local-training rule before either is recorded."""
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "5")
    results, lock = [], threading.Lock()

    def go(name):
        result = launch(workshop, LOCAL | {"name": name})
        with lock:
            results.append(result)

    threads = [threading.Thread(target=go, args=(name,)) for name in ("first", "second")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status_code for r in results) == [200, 409]
    wait_for(lambda: fakes.calls("train"))
    assert len(fakes.calls("train")) == 1
