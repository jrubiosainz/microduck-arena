"""Publish: `uv run publish` does the work; the workshop previews, publishes, and sends the user back to the Arena."""

from arena.manifest import load_event
from arena.workshop.publishing import SPEED_TWIST, publish_args, slug
from tests.workshop.conftest import git, make_run

AAA = "a" * 40


def _publish(workshop, run, **fields):
    body = {"run": run.name, "checkpoint": 1, "name": "My Walker!", "description": "", **fields}
    return workshop.post("/api/workshop/publish", json=body)


def test_the_preview_is_a_dry_run_showing_the_hub_card(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run, dry_run=True).json()
    assert body["repo"] == "alice/microduck-my-walker"
    assert body["readme"] == "# my-walker\n" and body["manifest"]["kind"] == "perpetual"
    (call,) = fakes.calls("publish")
    assert "--dry-run" in call and "--no-private" not in call and "--enter" not in call
    assert not (checkout / "publish-my-walker").exists()


def test_publishing_enters_it_and_opens_its_page(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run).json()
    (call,) = fakes.calls("publish")
    assert call[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert {"--no-private", "--force", "--enter"} <= set(call)
    assert call[call.index("--arena") + 1] == "http://arena.test"
    assert call[call.index("--livery") + 1] == "classic"
    assert "--speed" not in call and "--code-url" not in call
    assert call[call.index("--repo") + 1] == "alice/microduck-my-walker"
    assert "--description=2 m Sprint" in call and "--name=my-walker" in call
    assert call[call.index("--twist-help") + 1] == SPEED_TWIST
    assert body["revision"] == AAA and body["env"] is None
    assert body["entered"] == "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s"
    assert body["page_url"] == "http://arena.test/#/r/fakerun1"
    assert workshop.opened == [body["page_url"]]


def test_a_colour_and_a_speed_go_with_the_entry(workshop, fakes, checkout):
    _publish(workshop, make_run(checkout, "first"), livery="yellow", speed=0.55)
    (call,) = fakes.calls("publish")
    assert call[call.index("--livery") + 1] == "yellow"
    assert call[call.index("--speed") + 1] == "0.55"


def test_the_entry_carries_the_code_once_it_is_shared(workshop, fakes, checkout):
    workshop.post("/api/workshop/code/fork", json={})
    run = make_run(checkout, "first")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    body = _publish(workshop, run).json()
    assert body["env"] == f"https://github.com/alice/microduck-challenges/tree/{commit}"
    (call,) = fakes.calls("publish")
    assert call[call.index("--code-url") + 1] == body["env"]


def test_an_entry_the_arena_refuses_shows_the_whole_output_and_opens_nothing(workshop, fakes, checkout, monkeypatch):
    monkeypatch.setenv("FAKE_UV_ENTER_REFUSED", "1")
    response = _publish(workshop, make_run(checkout, "first"))
    assert response.status_code == 400
    assert "but the Arena did not enter it: 403: not yours" in response.json()["detail"]
    assert workshop.opened == []


def test_a_dirty_run_is_refused_unless_published_anyway(workshop, fakes, checkout):
    run = make_run(checkout, "first", dirty=True)
    refused = _publish(workshop, run)
    assert refused.status_code == 400 and "uncommitted" in refused.json()["detail"]
    assert fakes.calls("publish") == []
    assert _publish(workshop, run, allow_dirty=True).status_code == 200
    assert "--allow-dirty" in fakes.calls("publish")[0]


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
    publishing.acquire()  # a publish in flight
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
    swag = publish_args(run, 1, "alice/microduck-x", "x", "d", load_event("swag-contest"), False)
    assert "--twist-help" not in swag
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
