"""A Hugging Face job still runs and bills after the workshop that launched it is gone: its record is
kept up to date from the Hub, and its checkpoints still come back."""

import json

from arena.workshop.watch import watch_once
from tests.workshop.conftest import reopen, wait_for

SPRINT_URL = "/api/workshop/challenges/sprint-2m"
TASK = "Mjlab-Sprint2m-MicroDuck"
HF = {"name": "first", "where": "hf-jobs", "recipe": {"num_envs": 512, "max_iterations": 50, "seed": 3}, "params": {}}
DOWNLOAD = ["run", "--no-sync", "hf", "download", "alice/mjlab-sprint2m-microduck-first", "--local-dir", "logs/rsl_rl", "--quiet"]


def launched(workshop, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json=HF)
    wait_for(lambda: workshop.app.state.workshop.trainings[(TASK, "first")].job_id)


def ticket(client):
    (found,) = client.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    return found


def test_after_a_restart_a_running_job_is_asked_and_pulled(workshop, fakes, checkout, hub, monkeypatch):
    launched(workshop, monkeypatch)
    reopened = reopen(checkout, hub)
    ws = reopened.app.state.workshop
    pulls = len(fakes.calls("hf"))
    watch_once(ws, now=1000.0)
    assert hub.asked == ["fakejob42"] and fakes.calls("hf")[pulls:] == [DOWNLOAD]
    assert ticket(reopened)["state"] == "running" and ticket(reopened)["run_id"]

    watch_once(ws, now=1030.0)  # under a minute: not asked again
    assert hub.asked == ["fakejob42"]

    hub.stages["fakejob42"] = "COMPLETED"
    watch_once(ws, now=1100.0)  # ended: asked, and pulled once more
    assert hub.asked == ["fakejob42", "fakejob42"] and fakes.calls("hf")[pulls:] == [DOWNLOAD, DOWNLOAD]
    assert ticket(reopened)["state"] == "done"

    watch_once(ws, now=5000.0)  # nothing more to ask of an ended job
    assert hub.asked == ["fakejob42", "fakejob42"]


def test_a_job_this_workshop_follows_is_left_to_its_training(workshop, fakes, hub, monkeypatch):
    launched(workshop, monkeypatch)
    watch_once(workshop.app.state.workshop, now=1000.0)
    assert hub.asked == []


def test_the_record_keeps_what_the_hub_said(workshop, fakes, checkout, hub, monkeypatch):
    launched(workshop, monkeypatch)
    hub.stages["fakejob42"] = "ERROR"
    watch_once(reopen(checkout, hub).app.state.workshop, now=1000.0)
    (record,) = json.loads((checkout / "logs" / "workshop-jobs.json").read_text())
    assert (record["stage"], record["asked"], record["pulled"]) == ("ERROR", 1000.0, 1000.0)
    assert ticket(reopen(checkout, hub))["state"] == "failed"


def test_an_unreachable_hub_leaves_the_tickets_as_they_were(workshop, fakes, checkout, hub, monkeypatch):
    """Review focus: the tickets never ask the network, and a watcher that cannot reach the Hub
    changes nothing but when it asks next."""
    launched(workshop, monkeypatch)
    reopened = reopen(checkout, hub)
    hub.reachable = False
    watch_once(reopened.app.state.workshop, now=1000.0)
    assert ticket(reopened)["state"] == "running"
    hub.job_stage = lambda job_id, namespace: (_ for _ in ()).throw(AssertionError("a ticket asked the Hub"))
    assert reopened.get(f"{SPRINT_URL}/jobs").status_code == 200


def test_the_ticket_links_the_jobs_page(workshop, fakes, monkeypatch):
    launched(workshop, monkeypatch)
    assert ticket(workshop)["job_url"] == "https://huggingface.co/jobs/alice/fakejob42"


def test_a_local_training_has_no_job_page_and_is_not_watched(workshop, fakes, hub):
    fakes.gpu()
    workshop.post(f"{SPRINT_URL}/train", json=HF | {"where": "local"})
    wait_for(lambda: ticket(workshop)["state"] == "done")
    watch_once(workshop.app.state.workshop, now=1000.0)
    assert hub.asked == [] and ticket(workshop)["job_url"] is None
