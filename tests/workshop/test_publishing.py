"""Publish and compete: `uv run publish --enter` does the work; the workshop previews it, runs it from
a job's checkpoint, remembers the entry, and opens its page on the Arena."""

import json

from arena.manifest import load_event
from arena.workshop.publishing import SPEED_TWIST, publish_args, slug
from tests.workshop.conftest import git, make_run

AAA = "a" * 40
SPRINT_URL = "/api/workshop/challenges/sprint-2m"


def _publish(workshop, run, ticket_id=None, **fields):
    body = {"checkpoint": 1, "name": "My Walker!", "description": "It leans into every step.", **fields}
    return workshop.post(f"{SPRINT_URL}/jobs/{ticket_id or run.name}/publish", json=body)


def _ticket(workshop):
    (found,) = workshop.get(f"{SPRINT_URL}/jobs").json()["jobs"]
    return found


def test_the_preview_is_a_dry_run_showing_the_hub_card(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run, dry_run=True).json()
    assert body == {"repo": "alice/microduck-my-walker", "readme": "# my-walker\n"}
    (call,) = fakes.calls("publish")
    assert "--dry-run" in call and "--no-private" not in call and "--enter" not in call
    assert not (checkout / "publish-my-walker").exists()
    assert _ticket(workshop)["published"] is None


def test_publishing_enters_it_opens_its_page_and_remembers_it(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run).json()
    (call,) = fakes.calls("publish")
    assert call[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert {"--no-private", "--force", "--enter"} <= set(call)
    assert call[call.index("--arena") + 1] == "http://arena.test"
    # Every workshop entry races in the default colour, and a race is always swept.
    assert "--livery" not in call and "--speed" not in call and "--code-url" not in call
    assert call[call.index("--repo") + 1] == "alice/microduck-my-walker"
    assert "--description=It leans into every step." in call and "--name=my-walker" in call
    assert call[call.index("--twist-help") + 1] == SPEED_TWIST
    assert body["revision"] == AAA and body["env"] is None
    assert body["entered"] == "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s"
    assert body["page_url"] == "http://arena.test/#/r/fakerun1"
    assert workshop.opened == [body["page_url"]]
    published = _ticket(workshop)["published"]
    assert {k: published[k] for k in ("checkpoint", "repo", "revision", "entered", "page_url")} == {
        "checkpoint": 1, "repo": "alice/microduck-my-walker", "revision": AAA,
        "entered": body["entered"], "page_url": body["page_url"]}
    assert json.loads((run / "workshop" / "published.json").read_text())[-1]["at"].startswith("20")


def test_a_name_and_a_word_for_the_commentators_are_both_needed(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    for fields in ({"name": "  "}, {"description": ""}, {"description": "   "}):
        response = _publish(workshop, run, **fields)
        assert response.status_code == 400 and "commentators" in response.json()["detail"]
    assert fakes.calls("publish") == []


def test_the_entry_carries_the_code_once_it_is_on_the_fork(workshop, fakes, checkout, remotes):
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    run = make_run(checkout, "first")
    assert workshop.get(f"{SPRINT_URL}/jobs/{run.name}").json()["code_url"] is None
    workshop.post("/api/workshop/code/push")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    code = f"https://github.com/alice/microduck-challenges/tree/{commit}"
    assert workshop.get(f"{SPRINT_URL}/jobs/{run.name}").json()["code_url"] == code
    body = _publish(workshop, run).json()
    assert body["env"] == code
    (call,) = fakes.calls("publish")
    assert call[call.index("--code-url") + 1] == code


def test_an_entry_the_arena_refuses_shows_the_whole_output_and_is_not_remembered(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_ENTER_REFUSED", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400
    assert "but the Arena did not enter it: 403: not yours" in response.json()["detail"]
    assert workshop.opened == [] and _ticket(workshop)["published"] is None


def test_a_dirty_run_is_refused_unless_published_anyway(workshop, fakes, checkout):
    run = make_run(checkout, "first", dirty=True)
    refused = _publish(workshop, run)
    assert refused.status_code == 400 and "uncommitted" in refused.json()["detail"]
    assert fakes.calls("publish") == []
    assert _publish(workshop, run, allow_dirty=True).status_code == 200
    assert "--allow-dirty" in fakes.calls("publish")[0]


def test_a_job_without_a_run_yet_has_nothing_to_publish(workshop, fakes, monkeypatch):
    monkeypatch.setenv("FAKE_UV_TRAIN_S", "30")
    workshop.post(f"{SPRINT_URL}/train", json={"name": "first", "where": "hf-jobs",
                                              "recipe": {"num_envs": 1, "max_iterations": 2, "seed": 1}})
    response = workshop.post(f"{SPRINT_URL}/jobs/first/publish", json={"checkpoint": 1, "name": "x", "description": "y"})
    assert response.status_code == 409 and "no checkpoint" in response.json()["detail"]


def test_an_unknown_checkpoint_or_job_is_refused(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    assert _publish(workshop, run, checkpoint=7).status_code == 400
    assert _publish(workshop, run, ticket_id="nope").status_code == 404


def test_publishing_needs_a_hugging_face_login(workshop, fakes, checkout, hub):
    hub.user = None
    assert _publish(workshop, make_run(checkout, "first")).status_code == 400


def test_publishing_says_when_the_hub_is_unreachable(workshop, fakes, checkout, hub):
    hub.reachable = False
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 503 and "unreachable" in response.json()["detail"]
    assert fakes.calls("publish") == []


def test_a_failed_publish_shows_its_whole_output(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_FAIL_PUBLISH", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400 and "publish: boom" in response.json()["detail"]
    assert workshop.opened == []


def test_a_publish_while_another_runs_is_refused(workshop, fakes, checkout):
    """Two uploads of one name would race over ./publish-<name>/ and over the Hub repo."""
    run = make_run(checkout, "first")
    publishing = workshop.app.state.workshop.publishing
    publishing.acquire()
    try:
        for fields in ({}, {"dry_run": True}):
            response = _publish(workshop, run, **fields)
            assert response.status_code == 409 and response.json()["detail"] == "A publish is already running."
    finally:
        publishing.release()
    assert fakes.calls("publish") == []
    assert _publish(workshop, run).status_code == 200


def test_no_speed_order_for_an_event_that_does_not_sweep(checkout):
    from arena.workshop.runs import find_runs

    make_run(checkout, "first")
    (run,) = find_runs(checkout, "Mjlab-Sprint2m-MicroDuck")
    talent = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("got-a-talent"), False)
    assert "--twist-help" not in talent
    sprint = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("sprint-2m"), False)
    assert "--twist-help" in sprint


def test_a_description_that_starts_with_a_dash_is_not_taken_for_an_option(workshop, fakes, checkout):
    """`--description -fast` reads as a flag of its own to publish's parser; `--description=-fast` cannot."""
    run = make_run(checkout, "first")
    assert _publish(workshop, run, description="- fast and low").status_code == 200
    (call,) = fakes.calls("publish")
    assert "--description=- fast and low" in call


def test_slugs_are_what_a_hub_repo_name_accepts():
    assert slug("My Walker!") == "my-walker"
    assert slug("  ") == "policy"
