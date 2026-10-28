"""The tickets: one per training of a challenge, gathered from the training followed now, the record
each launch writes, and the run directory — after a restart as before it."""

import json

import pytest

from tests.workshop.conftest import SPRINT, git, make_run, reopen, store_evaluation, wait_for

SPRINT_URL = "/api/workshop/challenges/sprint-2m"
TASK = "Mjlab-Sprint2m-MicroDuck"
LOCAL = {"name": "first", "where": "local", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3},
         "params": {"forward_reward": 3.5}}
HF = LOCAL | {"where": "hf-jobs"}


def jobs(client):
    return client.get(f"{SPRINT_URL}/jobs").json()["jobs"]


def detail(client, ticket_id="first", since=0):
    return client.get(f"{SPRINT_URL}/jobs/{ticket_id}?since={since}").json()


def live(client, name="first"):
    return client.app.state.workshop.trainings[(TASK, name)]


def test_nothing_trained_yet(workshop):
    assert jobs(workshop) == []


def test_a_run_trained_from_a_shell_is_a_ticket_under_its_directory(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0, 1), iterations=2)
    (ticket,) = jobs(workshop)
    assert (ticket["id"], ticket["name"], ticket["where"], ticket["run_id"]) == (run.name, "first", None, run.name)
    assert ticket["state"] == "done" and ticket["progress"] == {"done": 2, "total": 2}
    assert ticket["dirty"] is False and ticket["started"] == "2026-09-28T10:00:00Z"


def test_a_shell_run_short_of_its_iterations_reads_as_stopped(workshop, checkout):
    make_run(checkout, "first", checkpoints=(0,), iterations=50)
    (ticket,) = jobs(workshop)
    assert ticket["state"] == "stopped" and ticket["progress"] == {"done": 0, "total": 50}


def test_tickets_are_newest_first(workshop, checkout):
    make_run(checkout, "old", stamp="2026-09-20_10-00-00")
    make_run(checkout, "new", stamp="2026-09-28_10-00-00")
    assert [t["name"] for t in jobs(workshop)] == ["new", "old"]


def test_a_followed_training_shows_its_progress_from_its_log(workshop, fakes, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    wait_for(lambda: live(workshop).progress)
    (ticket,) = jobs(workshop)
    assert ticket["state"] == "running" and ticket["progress"] == {"done": 1, "total": 2}


def test_the_log_is_read_from_an_offset(workshop, fakes):
    fakes.gpu()
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    whole = wait_for(lambda: (body := detail(workshop))["state"] == "done" and body)
    assert whole["log"][0].startswith("$ uv run --no-sync train") and whole["following"] is True
    assert detail(workshop, since=whole["next"] - 1)["log"] == whole["log"][-1:]


def test_after_a_restart_a_recorded_hf_job_keeps_its_ticket(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    reopened = reopen(checkout, hub)
    (ticket,) = jobs(reopened)
    assert (ticket["id"], ticket["where"], ticket["state"], ticket["run_id"]) == ("first", "hf-jobs", "running", None)
    body = detail(reopened)
    assert body["log"] == [] and body["following"] is False
    assert body["recipe"] == HF["recipe"] and body["params"] == HF["params"]


def test_after_a_restart_a_running_hf_job_can_still_be_stopped(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    reopened = reopen(checkout, hub)
    assert reopened.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 200
    assert hub.cancelled == [("fakejob42", "alice")]
    assert jobs(reopened)[0]["state"] == "stopped"


def test_a_cancel_the_hub_refuses_says_so_in_its_words(workshop, fakes, checkout, hub, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    cancel = hub.cancel_job

    def down(job_id, namespace):
        raise RuntimeError("Hub is down")

    hub.cancel_job = down
    reopened = reopen(checkout, hub)
    response = reopened.post(f"{SPRINT_URL}/jobs/first/stop")
    assert response.status_code == 502 and "Hub is down" in response.json()["detail"]
    assert jobs(reopened)[0]["state"] == "running"
    hub.cancel_job = cancel


def test_a_stop_without_a_network_says_the_hub_is_unreachable(workshop, fakes, checkout, monkeypatch):
    import httpx2
    from huggingface_hub import HfApi

    from arena.workshop.hub import Hub

    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)

    def offline(self, **kwargs):
        raise httpx2.ConnectError("[Errno 8] nodename nor servname provided, or not known")

    monkeypatch.setattr(HfApi, "cancel_job", offline)
    response = reopen(checkout, Hub()).post(f"{SPRINT_URL}/jobs/first/stop")
    assert response.status_code == 503 and "unreachable" in response.json()["detail"]


def test_a_local_training_whose_workshop_closed_reads_as_stopped(workshop, fakes, checkout, hub, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    wait_for(lambda: live(workshop).progress)
    (ticket,) = jobs(reopen(checkout, hub))
    assert ticket["state"] == "stopped" and ticket["progress"] == {"done": 1, "total": 50}


def test_a_local_training_that_ended_says_how_after_a_restart(workshop, fakes, checkout, hub, monkeypatch):
    fakes.gpu()
    monkeypatch.setenv("FAKE_UV_TRAIN_RC", "3")
    workshop.post(f"{SPRINT_URL}/train", json=LOCAL)
    record = checkout / "logs" / "workshop-jobs.json"
    wait_for(lambda: json.loads(record.read_text())[0].get("ended"))
    assert jobs(reopen(checkout, hub))[0]["state"] == "failed"


def test_an_hf_launch_that_ended_before_its_job_id_reads_failed_after_a_restart(workshop, fakes, checkout, hub, monkeypatch):
    """No job id, nothing for the Hub to be asked of: the record says how the launch ended."""
    monkeypatch.setenv("FAKE_UV_FAIL_TRAIN", "1")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    record = checkout / "logs" / "workshop-jobs.json"
    assert wait_for(lambda: json.loads(record.read_text())[0].get("ended")) == "failed"
    reopened = reopen(checkout, hub)
    assert jobs(reopened)[0]["state"] == "failed"
    assert reopened.get("/api/workshop/status").json()["challenges"][0]["running"] == 0
    assert reopened.post(f"{SPRINT_URL}/jobs/first/stop").status_code == 409


def test_an_hf_job_whose_id_never_came_reads_failed(workshop, checkout):
    """The workshop closed before `train --hf-jobs` printed the job's id: nothing to follow it by."""
    (checkout / "logs").mkdir()
    (checkout / "logs" / "workshop-jobs.json").write_text(json.dumps([{
        "task": TASK, "name": "first", "where": "hf-jobs", "recipe": HF["recipe"], "started": "2026-09-30T09:00:00+00:00",
        "ckpt_repo": "alice/mjlab-sprint2m-microduck-first", "namespace": "alice", "job_id": None}]))
    assert jobs(workshop)[0]["state"] == "failed"


def test_a_recorded_name_is_not_reused_before_its_run_is_fetched(workshop, fakes, checkout, hub, monkeypatch):
    """The name is also the checkpoint repo's: a second job under it would upload into the first's."""
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: live(workshop).job_id)
    assert reopen(checkout, hub).post(f"{SPRINT_URL}/train", json=HF).status_code == 409


@pytest.mark.parametrize("junk", [
    '{"first": "not a list"}',
    '[1, "two", {"no": "name"}]',
    '[{"name": "legacy", "ckpt_repo": "alice/x", "namespace": "alice", "job_id": "j0"}]',  # before tasks
    f'[{{"task": "{TASK}", "name": "x", "ended": "finished"}}]',  # no "where"
    f'[{{"task": "{TASK}", "name": "y", "where": "local", "recipe": {{"num_envs": 1}}}}]',  # recipe without max_iterations
    f'[{{"task": "{TASK}", "name": "z", "where": "local", "ended": "done"}}]',  # "done" is not a training's ended state
    f'[{{"task": "{TASK}", "name": ["a"], "where": "local"}}]',  # name is not a string
    f'[{{"task": "{TASK}", "name": "x", "where": "hf-jobs", "job_id": "j1"}}]',  # hf-jobs without namespace/ckpt_repo
])
def test_an_older_or_hand_edited_jobs_file_keeps_only_what_reads_as_a_job(workshop, fakes, checkout, junk, monkeypatch):
    """Review focus: never a 500, and a launch still works."""
    (checkout / "logs").mkdir()
    (checkout / "logs" / "workshop-jobs.json").write_text(junk)
    assert jobs(workshop) == []
    assert workshop.get("/api/workshop/status").status_code == 200
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    assert workshop.post(f"{SPRINT_URL}/train", json=HF).status_code == 200
    assert [t["name"] for t in jobs(workshop)] == ["first"]


def test_a_launch_keeps_an_older_raw_entry_in_the_file(workshop, fakes, checkout):
    """A record `recorded_jobs` leaves out may still hold the id of a Hugging Face job that is
    billed regardless: a launch must not erase it from the file."""
    (checkout / "logs").mkdir()
    legacy = {"name": "legacy", "ckpt_repo": "alice/x", "namespace": "alice", "job_id": "j0"}
    (checkout / "logs" / "workshop-jobs.json").write_text(json.dumps([legacy]))
    fakes.gpu()
    assert workshop.post(f"{SPRINT_URL}/train", json=LOCAL).status_code == 200
    raw = json.loads((checkout / "logs" / "workshop-jobs.json").read_text())
    assert legacy in raw


def test_updating_a_record_that_was_never_launched_writes_nothing(checkout):
    """A job id, an ended state, a stage: none of these is a launch. With no record yet to update,
    there is nothing to write — not even a partial one, which would never read as a job anyway."""
    from arena.workshop.jobs import recorded_jobs, remember_job

    remember_job(checkout, TASK, "ghost", job_id="j9")
    assert recorded_jobs(checkout) == []
    assert not (checkout / "logs" / "workshop-jobs.json").exists()


def test_an_unknown_ticket_is_404(workshop):
    assert workshop.get(f"{SPRINT_URL}/jobs/nope").status_code == 404
    assert workshop.post(f"{SPRINT_URL}/jobs/nope/stop").status_code == 404


def test_the_best_checkpoint_is_the_fastest_that_finishes(workshop, checkout):
    run = make_run(checkout, "first", checkpoints=(0, 1, 2, 3), iterations=4)
    store_evaluation(run, 0, score=50.0, finished=0)
    store_evaluation(run, 1, score=6.1)
    store_evaluation(run, 2, score=5.4)
    (ticket,) = jobs(workshop)
    assert ticket["best"] == 2
    assert [(c["n"], c["status"]) for c in ticket["checkpoints"]] == [
        (0, "evaluated"), (1, "evaluated"), (2, "evaluated"), (3, "queued")]
    assert ticket["checkpoints"][2]["score"] == 5.4 and "trace_b64" not in ticket["checkpoints"][2]


def test_a_voted_event_has_no_best(checkout, fakes, hub):
    talent = checkout / "src" / "microduck_challenges" / "got_a_talent"
    talent.mkdir()
    (talent / "challenge.toml").write_text(SPRINT.replace('"sprint-2m"', '"got-a-talent"')
                                           .replace(TASK, "Mjlab-GotATalent-MicroDuck"))
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "MicroDuck Got a Talent")
    run = make_run(checkout, "first", checkpoints=(0,), task="Mjlab-GotATalent-MicroDuck")
    store_evaluation(run, 0, score=12.0)
    (ticket,) = reopen(checkout, hub).get("/api/workshop/challenges/got-a-talent/jobs").json()["jobs"]
    assert ticket["best"] is None and ticket["checkpoints"][0]["status"] == "evaluated"


def add_tug(checkout):
    folder = checkout / "src" / "microduck_challenges" / "tug_of_war"
    folder.mkdir()
    (folder / "challenge.toml").write_text(SPRINT.replace('"sprint-2m"', '"tug-of-war"').replace(TASK, "Mjlab-TugOfWar-MicroDuck"))
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "Tug of War")


def test_the_best_tug_checkpoint_is_the_strongest(checkout, fakes, hub):
    add_tug(checkout)
    run = make_run(checkout, "first", checkpoints=(0, 1, 2), task="Mjlab-TugOfWar-MicroDuck")
    for n, rating in ((0, 2.0), (1, 5.5), (2, 4.0)):
        store_evaluation(run, n, score=rating)
    (ticket,) = reopen(checkout, hub).get("/api/workshop/challenges/tug-of-war/jobs").json()["jobs"]
    assert ticket["best"] == 1
