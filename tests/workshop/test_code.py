"""Your code: what is not committed yet, the commit that saves it, your fork, and the push."""

import pytest

from tests.workshop.conftest import UPSTREAM, git

FORK = "https://github.com/alice/microduck-challenges"


def _state(workshop):
    return workshop.get("/api/workshop/code").json()


def _make_fork(remotes):
    fork = remotes / "alice" / "microduck-challenges"
    fork.mkdir(parents=True)
    git(fork.parent, "init", "-q", "--bare", str(fork))
    return fork


def test_a_fresh_clone_is_committed_and_not_in_a_fork(workshop, checkout):
    body = _state(workshop)
    assert body["fork"] is None and body["changes"] == [] and body["identity"] is True
    assert body["commit"] == git(checkout, "rev-parse", "--short=9", "HEAD")


def test_what_is_not_committed_is_listed_by_file(workshop, checkout):
    folder = checkout / "src" / "microduck_challenges" / "sprint_2m"
    (folder / "challenge.toml").write_text((folder / "challenge.toml").read_text() + "# mine\n")
    (folder / "rewards.py").write_text("# mine\n")
    assert _state(workshop)["changes"] == [
        {"status": "M", "path": "src/microduck_challenges/sprint_2m/challenge.toml"},
        {"status": "??", "path": "src/microduck_challenges/sprint_2m/rewards.py"},
    ]


def test_a_commit_takes_everything_with_the_users_message(workshop, checkout):
    (checkout / "src" / "microduck_challenges" / "sprint_2m" / "rewards.py").write_text("# mine\n")
    body = workshop.post("/api/workshop/code/commit", json={"message": "sprint-2m training revision 2026-09-30 09:40"}).json()
    assert body["changes"] == []
    assert git(checkout, "log", "-1", "--format=%s") == "sprint-2m training revision 2026-09-30 09:40"


@pytest.mark.parametrize("message", ["", "   "])
def test_a_commit_needs_a_message(workshop, checkout, message):
    (checkout / "mine.py").write_text("# mine\n")
    response = workshop.post("/api/workshop/code/commit", json={"message": message})
    assert response.status_code == 400 and "message" in response.json()["detail"]
    assert git(checkout, "log", "-1", "--format=%s") == "the challenges"


def test_nothing_to_commit_is_said(workshop):
    response = workshop.post("/api/workshop/code/commit", json={"message": "again"})
    assert response.status_code == 400 and "Nothing to commit" in response.json()["detail"]


def test_without_a_name_on_commits_the_state_says_so(workshop, checkout, monkeypatch, tmp_path):
    git(checkout, "config", "--unset", "user.email")
    monkeypatch.setenv("HOME", str(tmp_path))  # no global identity either
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    assert _state(workshop)["identity"] is False


def test_a_fork_becomes_origin_and_pollens_repo_upstream_without_a_push(workshop, checkout, remotes):
    fork = _make_fork(remotes)
    body = workshop.post("/api/workshop/code/fork", json={"url": FORK}).json()
    assert body["fork"] == "alice/microduck-challenges"
    assert git(checkout, "config", "--get", "remote.origin.url") == FORK
    assert git(checkout, "config", "--get", "remote.upstream.url") == UPSTREAM
    assert git(fork, "branch") == ""  # nothing pushed


def test_a_second_fork_address_replaces_origin(workshop, checkout, remotes):
    workshop.post("/api/workshop/code/fork", json={"url": "https://github.com/alice/typo"})
    body = workshop.post("/api/workshop/code/fork", json={"url": FORK}).json()
    assert git(checkout, "config", "--get", "remote.origin.url") == FORK
    assert git(checkout, "config", "--get", "remote.upstream.url") == UPSTREAM
    assert body["fork"] == "alice/microduck-challenges"


def test_an_address_that_is_not_github_is_refused(workshop):
    response = workshop.post("/api/workshop/code/fork", json={"url": "https://evil.example/alice/x"})
    assert response.status_code == 400


@pytest.mark.parametrize("url", [UPSTREAM, "https://github.com/Pollen-Robotics/microduck-challenges.git"])
def test_pollens_own_address_is_not_taken_for_a_fork(workshop, checkout, url):
    response = workshop.post("/api/workshop/code/fork", json={"url": url})
    assert response.status_code == 400 and "your fork" in response.json()["detail"]
    assert git(checkout, "config", "--get", "remote.origin.url") == UPSTREAM
    assert git(checkout, "remote") == "origin"  # no upstream: nothing renamed


def test_the_push_sends_the_commits_to_the_fork_and_nothing_else(workshop, checkout, remotes):
    fork = _make_fork(remotes)
    workshop.post("/api/workshop/code/fork", json={"url": FORK})
    (checkout / "mine.py").write_text("# mine\n")
    workshop.post("/api/workshop/code/commit", json={"message": "mine"})
    assert _state(workshop)["unpushed"] == 1
    body = workshop.post("/api/workshop/code/push").json()
    assert body["unpushed"] == 0
    assert git(fork, "rev-parse", "main") == git(checkout, "rev-parse", "HEAD")


def test_the_push_commits_nothing(workshop, checkout, remotes):
    _make_fork(remotes)
    workshop.post("/api/workshop/code/fork", json={"url": FORK})
    (checkout / "mine.py").write_text("# mine\n")
    workshop.post("/api/workshop/code/push")
    assert git(checkout, "status", "--porcelain") == "?? mine.py"


def test_nothing_is_pushed_to_pollens_repo(workshop, checkout, remotes):
    upstream = remotes / "pollen-robotics" / "microduck-challenges"
    before = git(upstream, "rev-parse", "main")
    response = workshop.post("/api/workshop/code/push")
    assert response.status_code == 400
    assert response.json()["detail"] == "Fork first: your code goes to your fork, not Pollen's repo."
    assert git(upstream, "rev-parse", "main") == before


def test_a_push_to_a_fork_that_is_not_there_says_gits_words(workshop, checkout):
    workshop.post("/api/workshop/code/fork", json={"url": FORK})  # no bare repo at this address
    response = workshop.post("/api/workshop/code/push")
    assert response.status_code == 400 and "git push" in response.json()["detail"]


def test_the_code_link_names_the_commit_once_it_is_on_the_fork(workshop, checkout, remotes):
    from arena.workshop.code import code_url

    _make_fork(remotes)
    commit = git(checkout, "rev-parse", "--short=9", "HEAD")
    assert code_url(checkout, commit) is None
    workshop.post("/api/workshop/code/fork", json={"url": FORK})
    workshop.post("/api/workshop/code/push")
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
