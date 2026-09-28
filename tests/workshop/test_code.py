"""Your code: where the checkout stands, and the one button that shares it."""

import pytest

from tests.workshop.conftest import UPSTREAM, git


def _state(workshop):
    return workshop.get("/api/workshop/code").json()


def test_a_fresh_clone_is_not_shared_yet(workshop):
    body = _state(workshop)
    assert body["state"] == "not-shared" and body["fork"] is None
    assert body["fork_page"] == "https://github.com/pollen-robotics/microduck-challenges/fork"


def test_gh_forks_pushes_and_the_code_is_then_shared(workshop, checkout, remotes):
    response = workshop.post("/api/workshop/code/fork", json={})
    assert response.status_code == 200, response.text
    assert git(checkout, "config", "--get", "remote.origin.url") == "https://github.com/alice/microduck-challenges"
    assert git(checkout, "config", "--get", "remote.upstream.url") == "https://github.com/pollen-robotics/microduck-challenges"
    fork = remotes / "alice" / "microduck-challenges"
    assert git(fork, "rev-parse", "main") == git(checkout, "rev-parse", "HEAD")
    assert response.json()["state"] == "shared" and response.json()["fork"] == "alice/microduck-challenges"


def test_without_gh_the_fork_made_on_github_becomes_origin(workshop, checkout, remotes, monkeypatch):
    monkeypatch.setenv("FAKE_GH_LOGGED_OUT", "1")
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    assert workshop.post("/api/workshop/code/fork", json={}).status_code == 400  # gh cannot do it
    response = workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "shared"


def test_an_address_that_is_not_github_is_refused(workshop, monkeypatch):
    monkeypatch.setenv("FAKE_GH_LOGGED_OUT", "1")
    response = workshop.post("/api/workshop/code/fork", json={"url": "https://evil.example/alice/x"})
    assert response.status_code == 400


def test_nothing_is_pushed_to_pollens_repo(workshop, checkout, remotes):
    """Before a fork, origin is still Pollen's: a push (the page never offers one then, but the
    API can be called) must not commit and push the user's work there."""
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    upstream = remotes / "pollen-robotics" / "microduck-challenges"
    before = git(upstream, "rev-parse", "main")
    response = workshop.post("/api/workshop/code/push")
    assert response.status_code == 400
    assert response.json()["detail"] == "Fork first: your code goes to your fork, not Pollen's repo."
    assert git(upstream, "rev-parse", "main") == before
    assert git(checkout, "status", "--porcelain")  # not even committed


@pytest.mark.parametrize("url", [UPSTREAM, "https://github.com/Pollen-Robotics/microduck-challenges.git"])
def test_pollens_own_address_is_not_taken_for_a_fork(workshop, checkout, monkeypatch, url):
    monkeypatch.setenv("FAKE_GH_LOGGED_OUT", "1")
    response = workshop.post("/api/workshop/code/fork", json={"url": url})
    assert response.status_code == 400 and "your fork" in response.json()["detail"]
    assert git(checkout, "config", "--get", "remote.origin.url") == UPSTREAM
    assert git(checkout, "remote") == "origin"  # no upstream: nothing renamed


def test_changes_not_online_are_counted_then_pushed(workshop, checkout, remotes):
    workshop.post("/api/workshop/code/fork", json={})
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    body = _state(workshop)
    assert body["state"] == "changes" and body["changes"] == 1
    pushed = workshop.post("/api/workshop/code/push").json()
    assert pushed["state"] == "shared"
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m: my changes"
    fork = remotes / "alice" / "microduck-challenges"
    assert git(fork, "rev-parse", "main") == git(checkout, "rev-parse", "HEAD")


def test_a_push_that_fails_can_be_retried_with_the_right_url(workshop, checkout, remotes):
    # No bare repo at this address yet: the push fails, exactly as a typo'd URL or a fork that
    # is not ready yet would.
    bad = workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    assert bad.status_code == 400
    assert git(checkout, "config", "--get", "remote.upstream.url") == "https://github.com/pollen-robotics/microduck-challenges"
    assert _state(workshop)["state"] == "not-shared"

    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    retry = workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/microduck-challenges"})
    assert retry.status_code == 200, retry.text
    assert git(checkout, "config", "--get", "remote.origin.url") == "https://github.com/alice/microduck-challenges"
    assert git(checkout, "config", "--get", "remote.upstream.url") == "https://github.com/pollen-robotics/microduck-challenges"
    assert retry.json()["state"] == "shared"


def test_the_code_link_names_the_commit_once_it_is_on_the_fork(workshop, checkout):
    from arena.workshop.code import code_url

    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    assert code_url(checkout, commit) is None
    workshop.post("/api/workshop/code/fork", json={})
    assert code_url(checkout, commit) == f"https://github.com/alice/microduck-challenges/tree/{commit}"


@pytest.mark.parametrize(
    "url,repo",
    [
        ("https://github.com/alice/microduck-challenges", ("alice", "microduck-challenges")),
        ("https://github.com/alice/microduck-challenges.git", ("alice", "microduck-challenges")),
        ("git@github.com:alice/microduck-challenges.git", ("alice", "microduck-challenges")),
        ("https://gitlab.com/alice/x", None),
        (None, None),
    ],
)
def test_github_addresses_are_read_in_both_forms(url, repo):
    from arena.workshop.code import github_repo

    assert github_repo(url) == repo
