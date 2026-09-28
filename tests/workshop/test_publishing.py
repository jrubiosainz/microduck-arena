"""Publish: `uv run publish` does the work; the workshop previews, publishes, and sends the user back to the Arena."""

from urllib.parse import parse_qs, urlsplit

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
    assert "--dry-run" in call and "--no-private" not in call
    assert not (checkout / "publish-my-walker").exists()


def test_publishing_is_public_pins_the_commit_and_opens_the_arena(workshop, fakes, checkout):
    run = make_run(checkout, "first")
    body = _publish(workshop, run).json()
    (call,) = fakes.calls("publish")
    assert call[3:7] == ["--run", str(run), "--checkpoint", "1"]
    assert {"--no-private", "--force"} <= set(call)
    assert call[call.index("--repo") + 1] == "alice/microduck-my-walker"
    assert call[call.index("--description") + 1] == "2 m Sprint"
    assert call[call.index("--twist-help") + 1] == SPEED_TWIST
    assert body["revision"] == AAA and body["env"] is None
    link = urlsplit(body["arena_url"])
    assert (link.scheme, link.netloc, link.fragment) == ("http", "arena.test", "/e/sprint-2m")
    assert parse_qs(link.query) == {"repo": ["alice/microduck-my-walker"], "revision": [AAA]}
    assert workshop.opened == [body["arena_url"]]


def test_the_arena_link_carries_the_code_once_it_is_shared(workshop, fakes, checkout):
    workshop.post("/api/workshop/code/fork", json={})
    run = make_run(checkout, "first")
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    body = _publish(workshop, run).json()
    assert body["env"] == f"https://github.com/alice/microduck-challenges/tree/{commit}"
    assert parse_qs(urlsplit(body["arena_url"]).query)["env"] == [body["env"]]


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


def test_slugs_are_what_a_hub_repo_name_accepts():
    assert slug("My Walker!") == "my-walker"
    assert slug("  ") == "policy"
