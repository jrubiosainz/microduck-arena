"""A troupe in the workshop: beside the star, a checkpoint of any training in the checkout, a policy
published from one, or any Hub reference joins the performance, on its own rig and in its own place,
and Save and play plays them all."""

import base64
import hashlib
import json
import os
import time

import pytest

from arena.constants import TRACE_WIDTH
from arena.hub_fetch import FetchedPolicy
from arena.timeline import TimelineError
from arena.workshop import troupe
from arena.workshop.evaluations import evaluate_checkpoint, stored
from arena.workshop.runs import find_runs
from arena.workshop.troupe import local_policy, resolve_local, timeline_key
from tests.workshop.conftest import REFERENCE, make_run

URL = "/api/workshop/challenges/got-a-talent"
TASK = "Mjlab-GotATalent-MicroDuck"
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
        repo, revision = REF.split("@")
        return {REF: FetchedPolicy(repo_id=repo, filename="policy.onnx", revision=revision, path=REFERENCE,
                                   url=f"https://huggingface.co/{repo}/resolve/{revision}/policy.onnx", rig="rollers")}

    monkeypatch.setattr(troupe, "fetch_references", fetch)
    stage.timeline.write_text(troupe_text((REF, 0.5, 0.0, 180)))
    body = play(stage, checkout, star)
    assert asked == [(REF,)]
    assert [(duck["policy"], duck["rig"]) for duck in body["cast"]] == [("self", "legs"), (REF, "rollers")]


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
