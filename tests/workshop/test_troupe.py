"""A troupe in the workshop: beside the star, a checkpoint of any training in the checkout, a policy
published from one, or any Hub reference joins the performance, on its own rig and in its own place,
and Save and play plays them all."""

import base64
import hashlib
import json
import os
import time

import pytest

from arena import hub_fetch
from arena.constants import TRACE_WIDTH
from arena.hub_fetch import FetchedPolicy, FetchError
from arena.timeline import TimelineError
from arena.workshop import troupe
from arena.workshop.evaluations import RETRY_S, evaluate_checkpoint, evaluate_next, stored
from arena.workshop.runs import find_runs
from arena.workshop.troupe import local_policy, resolve_local, timeline_key
from tests.workshop.conftest import REFERENCE, make_run

URL = "/api/workshop/challenges/got-a-talent"
TASK = "Mjlab-GotATalent-MicroDuck"
AAA = "a" * 40
BBB = "b" * 40
REF = f"pollen-robotics/microduck-roller@{'c' * 40}"


def troupe_text(*ducks) -> str:
    """A 2 s troupe: the star at the centre, then each of `ducks`, a (policy, x, y, yaw)."""
    others = [{"policy": policy, "start": {"x": x, "y": y, "yaw": yaw}, "keyframes": [{"t": 0.0}]}
              for policy, x, y, yaw in ducks]
    return json.dumps({"timeline_version": 2, "duration_s": 2.0,
                       "ducks": [{"policy": "self", "keyframes": [{"t": 0.0}]}, *others]}) + "\n"


def runs(checkout):
    """The star's training on the stage, and a 2 m Sprint training whose walker may join it."""
    return (make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent"),
            make_run(checkout, "walker", checkpoints=(1,)))


def talent(stage):
    return stage.app.state.workshop.challenges["got-a-talent"]


def roller() -> FetchedPolicy:
    """What the Arena fetches for REF: the reference walker's weights, on the rig its manifest names."""
    repo, revision = REF.split("@")
    return FetchedPolicy(repo_id=repo, filename="policy.onnx", revision=revision, path=REFERENCE,
                         url=f"https://huggingface.co/{repo}/resolve/{revision}/policy.onnx", rig="rollers")


def offline(wanted, event):
    """The Arena's own fetch, the Hub out of reach: an offline laptop, or a Hub outage."""
    def unreachable(repo_id, revision):
        raise ConnectionError("huggingface.co did not answer")

    return hub_fetch.fetch_references(wanted, event, info=unreachable)


def play(stage, checkout, star, n=1):
    """What Save and play stores for the star's checkpoint n, with the troupe timeline.json holds."""
    (run,) = (r for r in find_runs(checkout, TASK) if r.path == star)
    return evaluate_checkpoint(checkout, run, n, talent(stage))


def test_a_local_duck_is_a_checkpoint_of_any_challenge_named_by_its_folder_and_run(stage, checkout):
    _, walker = runs(checkout)
    (run,) = find_runs(checkout, "Mjlab-Sprint2m-MicroDuck")
    policy = local_policy(run, 1)
    assert policy == f"local:sprint_2m/{walker.name}@1"
    found, n, challenge = resolve_local(checkout, policy)
    assert (found.path, n, challenge.event) == (walker, 1, "sprint-2m")
    for gone in (f"local:sprint_2m/{walker.name}@7", "local:sprint_2m/2026-01-01_00-00-00_nope@1"):
        with pytest.raises(TimelineError, match="no such checkpoint"):
            resolve_local(checkout, gone)


def test_a_local_duck_never_names_a_file_outside_the_checkouts_runs(stage, checkout):
    """`..` is a name like any other: logs/rsl_rl/../.. holds no checkpoint, whatever lies there."""
    runs(checkout)
    escape = "local:../..@1"
    (checkout / "model_1.pt").write_bytes(b"pt")
    with pytest.raises(TimelineError, match="no such checkpoint"):
        resolve_local(checkout, escape)
    stage.timeline.write_text(troupe_text((escape, 0.0, 0.5, 0)))
    key = timeline_key(checkout, talent(stage))
    (checkout / "model_1.pt").write_bytes(b"another")
    assert timeline_key(checkout, talent(stage)) == key


def test_plus_duck_offers_every_checkpoint_then_every_published_policy_with_its_rig(stage, checkout):
    star, walker = runs(checkout)
    (walker / "workshop").mkdir()
    (walker / "workshop" / "published.json").write_text(json.dumps([
        {"checkpoint": 1, "repo": "alice/microduck-walker", "revision": BBB, "at": "2026-10-13T10:00:00+00:00"}]))
    assert stage.get(f"{URL}/performers").json() == {"performers": [
        {"policy": f"local:got_a_talent/{star.name}@1", "label": f"got_a_talent · {star.name} · 1", "rig": "legs"},
        {"policy": f"local:sprint_2m/{walker.name}@1", "label": f"sprint_2m · {walker.name} · 1", "rig": "legs"},
        {"policy": f"alice/microduck-walker@{BBB}", "label": "alice/microduck-walker@bbbbbbb", "rig": "legs"},
    ]}
    assert stage.get("/api/workshop/challenges/sprint-2m/performers").status_code == 409


def test_the_page_saves_a_troupe_naming_a_checkpoint_of_this_machine(stage, checkout):
    _, walker = runs(checkout)
    text = troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0))
    saved = stage.post(f"{URL}/timeline", json={"text": text})
    assert saved.status_code == 200, saved.text
    assert stage.timeline.read_text() == text


def test_a_troupe_plays_the_star_a_copy_of_it_and_a_checkpoint_exported_once(stage, checkout, fakes):
    star, walker = runs(checkout)
    local = f"local:sprint_2m/{walker.name}@1"
    stage.timeline.write_text(troupe_text((local, 0.0, 0.5, 90), ("self", 0.0, -0.5, -90)))
    body = play(stage, checkout, star)
    assert body["ducks"] == 3
    assert len(base64.b64decode(body["trace_b64"])) == 4 * TRACE_WIDTH * 100 * 3  # 2 s of each duck
    assert [(duck["policy"], duck["rig"], duck["start"]) for duck in body["cast"]] == [
        ("self", "legs", {"x": 0.0, "y": 0.0, "yaw": 0.0}),
        (local, "legs", {"x": 0.0, "y": 0.5, "yaw": 90.0}),
        ("self", "legs", {"x": 0.0, "y": -0.5, "yaw": -90.0}),
    ]
    assert [set(duck) for duck in body["stage"]] == [{"fell_at", "seated_s", "standing_s"}] * 3
    # The walker's checkpoint is exported into its own run, as its own evaluation would be, and once.
    assert (walker / "workshop" / "model_1.onnx").is_file()
    play(stage, checkout, star)
    assert len(fakes.calls("publish")) == 2  # the star's export and the walker's


def test_a_hub_reference_plays_what_the_arena_fetches_on_the_rig_its_manifest_names(stage, checkout, monkeypatch):
    star, _ = runs(checkout)
    asked = []

    def fetch(wanted, event):
        asked.append(wanted.references())
        return {REF: roller()}

    monkeypatch.setattr(troupe, "fetch_references", fetch)
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    body = play(stage, checkout, star)
    assert asked == [(REF,)]
    assert [(duck["policy"], duck["rig"]) for duck in body["cast"]] == [("self", "legs"), (REF, "rollers")]


def test_a_hub_policy_out_of_reach_fails_no_checkpoint_and_plays_once_the_hub_is_back(stage, checkout, monkeypatch):
    """An outage is the Hub's state, not the checkpoint's: nothing is stored, and the next pass plays."""
    star, _ = runs(checkout)
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    monkeypatch.setattr(troupe, "fetch_references", offline)
    with pytest.raises(FetchError, match=r"ducks\[1\]: pollen-robotics/microduck-roller"):
        play(stage, checkout, star)
    assert not (star / "workshop" / "model_1.json").exists()
    monkeypatch.setattr(troupe, "fetch_references", lambda wanted, event: {REF: roller()})
    assert "error" not in play(stage, checkout, star)
    (run,) = find_runs(checkout, TASK)
    assert stored(run, 1, timeline_key(checkout, talent(stage))) is not None


def test_save_and_play_says_which_hub_policy_is_out_of_reach(stage, checkout, monkeypatch):
    star, _ = runs(checkout)
    play(stage, checkout, star)  # exported, and played with the timeline as committed
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    monkeypatch.setattr(troupe, "fetch_references", offline)
    response = stage.get(f"{URL}/jobs/{star.name}/checkpoints/1")
    assert response.status_code == 502
    assert "ducks[1]: pollen-robotics/microduck-roller" in response.json()["detail"]


def test_a_stage_whose_hub_policy_cannot_be_fetched_waits_aside_while_the_races_play(stage, checkout, monkeypatch):
    # The stage's training is the newest: the worker comes to its checkpoint first.
    make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent", stamp="2026-09-29_10-00-00")
    make_run(checkout, "walker", checkpoints=(1,))
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    asked = []

    def fetch(wanted, event):
        asked.append(wanted.references())
        return offline(wanted, event)

    monkeypatch.setattr(troupe, "fetch_references", fetch)
    ws, now = stage.app.state.workshop, time.time()
    with pytest.raises(FetchError, match=r"ducks\[1\]"):
        evaluate_next(ws, now)
    assert evaluate_next(ws, now + 1) is True  # the sprint's checkpoint, meanwhile
    (race,) = find_runs(checkout, "Mjlab-Sprint2m-MicroDuck")
    assert stored(race, 1, None)["seeds_total"] == 5
    assert evaluate_next(ws, now + 2) is False  # nothing else waits, and the Hub is not asked again
    assert asked == [(REF,)]


def test_a_stage_set_aside_is_tried_again_once_its_minute_has_passed(stage, checkout, monkeypatch):
    make_run(checkout, "first", checkpoints=(1,), task=TASK, experiment="got_a_talent")
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    monkeypatch.setattr(troupe, "fetch_references", offline)
    ws, now = stage.app.state.workshop, time.time()
    with pytest.raises(FetchError):
        evaluate_next(ws, now)
    monkeypatch.setattr(troupe, "fetch_references", lambda wanted, event: {REF: roller()})
    assert evaluate_next(ws, now + RETRY_S - 1) is False  # the Hub is back, but its minute is not over
    assert evaluate_next(ws, now + RETRY_S) is True
    (run,) = find_runs(checkout, TASK)
    assert "error" not in stored(run, 1, timeline_key(checkout, talent(stage)))


def test_a_troupe_naming_a_checkpoint_this_checkout_does_not_hold_fails_and_says_which(stage, checkout):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@7", 0.0, 0.5, 0)))
    body = play(stage, checkout, star)
    assert "no such checkpoint" in body["error"] and f"{walker.name}@7" in body["error"]


def test_a_troupe_plays_again_once_a_local_ducks_checkpoint_file_changes(stage, checkout):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    key = timeline_key(checkout, talent(stage))
    assert key != hashlib.sha256(stage.timeline.read_bytes()).hexdigest()
    play(stage, checkout, star)
    (run,) = find_runs(checkout, TASK)
    assert stored(run, 1, key) is not None
    later = time.time() - 30
    os.utime(walker / "model_1.pt", (later, later))  # the walker's run, pulled again from its job
    assert stored(run, 1, timeline_key(checkout, talent(stage))) is None
    # Without a local duck the key is the text's alone, as before troupes.
    stage.timeline.write_text(troupe_text())
    assert timeline_key(checkout, talent(stage)) == hashlib.sha256(stage.timeline.read_bytes()).hexdigest()


def test_an_evaluation_stored_before_troupes_is_measured_again(stage, checkout):
    """0.4 stored one trace and one summary: the page now reads every duck's."""
    star, _ = runs(checkout)
    play(stage, checkout, star)
    (run,) = find_runs(checkout, TASK)
    cache = star / "workshop" / "model_1.json"
    older = json.loads(cache.read_text())
    del older["format"]
    cache.write_text(json.dumps(older))
    assert stored(run, 1, timeline_key(checkout, talent(stage))) is None


def publish(stage, star, **fields):
    body = {"checkpoint": 1, "name": "my talent", "description": "It sits and sings.", **fields}
    return stage.post(f"{URL}/jobs/{star.name}/publish", json=body)


def test_one_click_publishes_each_local_duck_then_enters_the_star_naming_them_by_their_commits(stage, checkout, fakes):
    star, walker = runs(checkout)
    local = f"local:sprint_2m/{walker.name}@1"
    text = troupe_text((local, 0.0, 0.5, 90), (local, 0.0, -0.5, -90))
    stage.timeline.write_text(text)
    assert publish(stage, star).json() == {"publishing": {"done": 1, "of": 2}}
    (duck,) = fakes.calls("publish")
    assert duck[3:7] == ["--run", str(walker), "--checkpoint", "1"]
    assert duck[duck.index("--repo") + 1] == "alice/microduck-my-talent-duck-1"
    assert {"--no-private", "--force"} <= set(duck) and "--enter" not in duck and "--timeline" not in duck
    entered = publish(stage, star).json()
    assert entered["page_url"] == "http://arena.test/#/r/fakerun1"
    last = fakes.calls("publish")[-1]
    assert last[3:7] == ["--run", str(star), "--checkpoint", "1"] and "--enter" in last
    sent = json.loads(fakes.timelines()[-1])
    named = f"alice/microduck-my-talent-duck-1@{AAA}"
    assert [d["policy"] for d in sent["ducks"]] == ["self", named, named]
    assert stage.timeline.read_text() == text  # the author's own file keeps its local forms
    (remembered,) = json.loads((walker / "workshop" / "published.json").read_text())
    assert (remembered["checkpoint"], remembered["repo"], remembered["revision"]) == (1, "alice/microduck-my-talent-duck-1", AAA)
    assert "entered" not in remembered
    # A duck published for a troupe is a policy, not an entry: its own training still says so.
    (walker_ticket,) = stage.get("/api/workshop/challenges/sprint-2m/jobs").json()["jobs"]
    assert walker_ticket["published"] is None


def test_a_duck_published_before_is_reused_from_its_runs_published_json(stage, checkout, fakes):
    star, walker = runs(checkout)
    (walker / "workshop").mkdir()
    (walker / "workshop" / "published.json").write_text(json.dumps([
        {"checkpoint": 1, "repo": "alice/microduck-walker", "revision": BBB,
         "entered": "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", "page_url": "http://arena.test/#/r/w",
         "at": "2026-10-13T10:00:00+00:00"}]))
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    assert publish(stage, star).status_code == 200
    (only,) = fakes.calls("publish")
    assert "--enter" in only
    assert [d["policy"] for d in json.loads(fakes.timelines()[-1])["ducks"]] == ["self", f"alice/microduck-walker@{BBB}"]


def test_a_failed_entry_keeps_its_ducks_published_and_the_next_click_reuses_them(stage, checkout, fakes, monkeypatch):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    monkeypatch.setenv("FAKE_UV_ENTER_REFUSED", "1")
    assert publish(stage, star).json() == {"publishing": {"done": 1, "of": 2}}
    refused = publish(stage, star)
    assert refused.status_code == 400 and "did not enter it" in refused.json()["detail"]
    monkeypatch.delenv("FAKE_UV_ENTER_REFUSED")
    assert publish(stage, star).status_code == 200
    assert ["--enter" in call for call in fakes.calls("publish")] == [False, True, True]  # the duck once


def test_the_preview_of_a_troupe_publishes_no_duck(stage, checkout, fakes):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@1", 0.0, 0.5, 0)))
    assert publish(stage, star, dry_run=True).status_code == 200
    (only,) = fakes.calls("publish")
    assert "--dry-run" in only


def test_a_troupe_naming_a_checkpoint_this_checkout_does_not_hold_publishes_nothing(stage, checkout, fakes):
    star, walker = runs(checkout)
    stage.timeline.write_text(troupe_text((f"local:sprint_2m/{walker.name}@7", 0.0, 0.5, 0)))
    refused = publish(stage, star)
    assert refused.status_code == 400 and "no such checkpoint" in refused.json()["detail"]
    assert fakes.calls("publish") == []
