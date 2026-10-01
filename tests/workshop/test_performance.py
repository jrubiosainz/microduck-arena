"""A stage challenge's performance is its folder's timeline.json: the training's page edits it, every
checkpoint plays it, an edit replays the chosen checkpoint at once, and Publish sends it with --timeline."""

import base64
import hashlib
import json
import os
import threading
import time

import pytest

from arena.constants import TRACE_WIDTH
from arena.workshop import evaluations
from arena.workshop.evaluations import evaluate_checkpoint, evaluate_next, next_checkpoint
from arena.workshop.runs import find_runs
from tests.workshop.conftest import git, make_run, reopen

TALENT = """\
event = "got-a-talent"
task  = "Mjlab-GotATalent-MicroDuck"
kind  = "perpetual"

[recipe]
num_envs       = 4096
max_iterations = 3000
seed           = 1

[params.head_reward]
label = "Follow the head moves"
value = 0.75
min   = 0.0
max   = 2.0
"""
TWO_SECONDS = '{"timeline_version": 1, "duration_s": 2.0, "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [1, 0, 0]}]}\n'
THREE_SECONDS = '{"timeline_version": 1, "duration_s": 3.0, "keyframes": [{"t": 0.0}]}\n'
URL = "/api/workshop/challenges/got-a-talent"
TASK = "Mjlab-GotATalent-MicroDuck"


@pytest.fixture
def stage(checkout, fakes, hub, monkeypatch):
    """The workshop on a checkout that also holds MicroDuck Got a Talent, its timeline committed."""
    folder = checkout / "src" / "microduck_challenges" / "got_a_talent"
    folder.mkdir()
    (folder / "challenge.toml").write_text(TALENT)
    (folder / "timeline.json").write_text(TWO_SECONDS)
    git(checkout, "add", "-A")
    git(checkout, "commit", "-qm", "the stage")
    monkeypatch.setenv("HF_TOKEN", "hf_from_the_launcher")
    client = reopen(checkout, hub)
    client.timeline = folder / "timeline.json"
    return client


def frames(body) -> int:
    return len(base64.b64decode(body["trace_b64"])) // (4 * TRACE_WIDTH)


def evaluated(client, run, n=1):
    while evaluate_next(client.app.state.workshop):
        pass
    return client.get(f"{URL}/jobs/{run.name}/checkpoints/{n}").json()


def test_a_stage_checkpoint_plays_the_challenges_timeline(stage, checkout):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    body = evaluated(stage, run)
    assert frames(body) == 100  # 2 s at 50 Hz: the timeline's length, not the event's 20 s
    assert body["timeline"] == hashlib.sha256(TWO_SECONDS.encode()).hexdigest()
    assert set(body["stage"]) == {"fell_at", "seated_s", "standing_s"}
    assert (body["seeds_finished"], body["seeds_total"]) == (1, 1)


def test_two_threads_evaluating_the_same_checkpoint_never_race_on_one_temp_file(stage, checkout, monkeypatch):
    """The worker and the checkpoint route right after Save and play can both measure the same stale
    checkpoint at once: each write must use its own temp file, never a name the other is also using."""
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    evaluated(stage, run)  # exports the ONNX once, so both threads go straight to evaluate()

    # Widen the race: both threads finish measuring together, then both pause right before replacing
    # the stored file — long enough that, with a shared temp name, one thread's replace would steal
    # the file out from under the other's.
    barrier = threading.Barrier(2)
    real_measure = evaluations._measure

    def synced_measure(*args):
        body = real_measure(*args)
        barrier.wait(timeout=5)
        return body

    real_replace = os.replace

    def slow_replace(src, dst):
        time.sleep(0.05)
        real_replace(src, dst)

    monkeypatch.setattr(evaluations, "_measure", synced_measure)
    monkeypatch.setattr(os, "replace", slow_replace)

    (found,) = find_runs(checkout, TASK)
    challenge = stage.app.state.workshop.challenges["got-a-talent"]
    results, errors = [], []

    def go():
        try:
            results.append(evaluate_checkpoint(checkout, found, 1, challenge))
        except Exception as exc:  # noqa: BLE001 — collected, so both threads are accounted for below
            errors.append(exc)

    threads = [threading.Thread(target=go) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert len(results) == 2
    stored_body = json.loads((run / "workshop" / "model_1.json").read_text())
    assert stored_body["checkpoint"] == 1
    assert stored_body["timeline"] == hashlib.sha256(TWO_SECONDS.encode()).hexdigest()


def test_the_page_reads_and_saves_the_timeline_and_the_checkpoint_replays_without_a_new_export(stage, checkout, fakes):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    evaluated(stage, run)
    assert stage.get(f"{URL}/timeline").json() == {"text": TWO_SECONDS}
    saved = stage.post(f"{URL}/timeline", json={"text": THREE_SECONDS})
    assert saved.status_code == 200, saved.text
    assert stage.timeline.read_text() == THREE_SECONDS
    body = stage.get(f"{URL}/jobs/{run.name}/checkpoints/1").json()
    assert frames(body) == 150
    assert len(fakes.calls("publish")) == 1  # the ONNX exported once is played again


def test_a_timeline_the_arena_refuses_is_not_saved_and_says_where(stage):
    refused = stage.post(f"{URL}/timeline", json={"text": THREE_SECONDS.replace("3.0", "25.0")})
    assert refused.status_code == 400
    assert "longer than this event's 20 s" in refused.json()["detail"]
    assert stage.timeline.read_text() == TWO_SECONDS


def test_a_race_has_no_timeline(stage):
    assert stage.get("/api/workshop/challenges/sprint-2m/timeline").status_code == 409


def test_a_timeline_broken_by_hand_fails_the_evaluation_until_it_is_fixed(stage, checkout):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    stage.timeline.write_text("{")
    body = evaluated(stage, run)
    assert "timeline.json" in body["error"]
    stage.timeline.write_text(TWO_SECONDS)
    found = next_checkpoint(checkout, list(stage.app.state.workshop.challenges.values()))
    assert (found[1].id, found[2]) == (run.name, 1)


def test_a_stage_publishes_its_timeline(stage, checkout, fakes):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and looks around."}
    done = stage.post(f"{URL}/jobs/{run.name}/publish", json=body)
    assert done.status_code == 200, done.text
    (published,) = [argv for argv in fakes.calls("publish") if "--enter" in argv]
    assert published[published.index("--timeline") + 1] == str(stage.timeline)


def test_a_broken_timeline_is_never_published(stage, checkout, fakes):
    run = make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    stage.timeline.write_text("{")
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and looks around."}
    refused = stage.post(f"{URL}/jobs/{run.name}/publish", json=body)
    assert refused.status_code == 400 and "not a JSON file" in refused.json()["detail"]
    assert fakes.calls("publish") == []
