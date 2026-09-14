import json

import pytest

from arena.hub_publish import (
    POLICY_FILENAME,
    policy_manifest,
    publish_policy,
    slugify,
)


class FakeApi:
    """Records what would have been sent. No network, no huggingface_hub."""

    def __init__(self, create_error=None, commit_error=None):
        self.created = []
        self.commits = []
        self._create_error = create_error
        self._commit_error = commit_error

    def create_repo(self, repo_id, repo_type=None, private=None, exist_ok=None):
        if self._create_error:
            raise self._create_error
        self.created.append((repo_id, repo_type, private, exist_ok))

    def create_commit(self, repo_id, repo_type=None, operations=None, commit_message=None):
        if self._commit_error:
            raise self._commit_error
        self.commits.append((repo_id, repo_type, operations, commit_message))

        class Result:
            oid = "abc123def456"

        return Result()


@pytest.mark.parametrize(
    "name,expected",
    [
        ("walker v1", "walker-v1"),
        ("Rough Walk E", "rough-walk-e"),
        ("../../etc/passwd", "etc-passwd"),
        ("a" * 100, "a" * 60),
        ("🦆", "policy"),
        ("", "policy"),
        ("  spaced  ", "spaced"),
    ],
)
def test_a_repo_slug_is_derived_safely_from_a_submitted_name(name, expected):
    """This becomes a path segment in someone's Hub namespace, so it is
    sanitised rather than trusted."""
    assert slugify(name) == expected


def test_the_repo_is_public_and_named_after_the_author_and_the_policy():
    api = FakeApi()
    published = publish_policy(api, "alice", "Rough Walk E", b"onnx", rig="legs")
    assert published.repo_id == "alice/microduck-rough-walk-e"
    repo_id, repo_type, private, exist_ok = api.created[0]
    assert repo_id == "alice/microduck-rough-walk-e"
    assert repo_type == "model"
    # Public, or nobody else could ever download it — see the spec.
    assert private is False
    # Republishing the same name must be a new commit, not an error.
    assert exist_ok is True


def test_it_commits_the_onnx_and_a_manifest_and_returns_the_revision():
    api = FakeApi()
    published = publish_policy(api, "alice", "walker", b"the-onnx", rig="legs")
    assert published.filename == POLICY_FILENAME == "policy.onnx"
    assert published.revision == "abc123def456"
    assert published.url == (
        "https://huggingface.co/alice/microduck-walker/resolve/abc123def456/policy.onnx"
    )

    _, _, operations, message = api.commits[0]
    paths = {op.path_in_repo for op in operations}
    assert paths == {"policy.onnx", "manifest.json", "README.md"}
    assert "walker" in message


def test_the_committed_manifest_declares_the_contract_the_community_declares():
    api = FakeApi()
    publish_policy(api, "alice", "walker", b"onnx", rig="legs")
    _, _, operations, _ = api.commits[0]
    manifest_op = next(op for op in operations if op.path_in_repo == "manifest.json")
    manifest = json.loads(bytes(manifest_op.path_or_fileobj).decode())
    assert manifest["obs_len"] == 61
    assert manifest["action_len"] == 14
    assert manifest["action_scale"] == 1.0
    assert manifest["entry_pose"] == "standing"
    assert manifest["model_api"] == 1
    assert manifest["robot"]["control_hz"] == 50


def test_the_manifest_names_the_rig_the_policy_was_scored_on():
    assert policy_manifest("w", "legs")["robot"]["model"] == "microduck"
    assert (
        policy_manifest("w", "rollers")["robot"]["model"] == "microduck passive rollers"
    )


def test_the_readme_carries_the_tags_the_ecosystem_searches_by():
    """14 repos are already discoverable under `microduck-policy`. Joining that
    convention is the point; inventing a new tag would not be."""
    api = FakeApi()
    publish_policy(api, "alice", "walker", b"onnx", rig="legs")
    _, _, operations, _ = api.commits[0]
    readme = next(op for op in operations if op.path_in_repo == "README.md")
    text = bytes(readme.path_or_fileobj).decode()
    assert "microduck-policy" in text
    assert "- microduck\n" in text
    assert "onnx" in text


def test_the_readme_states_the_contract_from_the_real_constants():
    """This text is committed into other people's public Hub repos, which this
    Space cannot retract. It must read the same constants the manifest and the
    engine use, not a copy typed into the prose by hand."""
    from arena.constants import CTRL_DT, NUM_JOINTS, OBS_SIZE

    api = FakeApi()
    publish_policy(api, "alice", "walker", b"onnx", rig="legs")
    _, _, operations, _ = api.commits[0]
    readme = next(op for op in operations if op.path_in_repo == "README.md")
    text = bytes(readme.path_or_fileobj).decode()
    assert f"{OBS_SIZE}-value observation" in text
    assert f"{NUM_JOINTS} joint" in text
    assert f"{round(1.0 / CTRL_DT)} Hz" in text


def test_a_refused_repo_creation_raises_with_the_hubs_own_reason():
    from arena.hub_publish import HubPublishError

    api = FakeApi(create_error=RuntimeError("403 Forbidden"))
    with pytest.raises(HubPublishError, match="403 Forbidden"):
        publish_policy(api, "alice", "walker", b"onnx", rig="legs")


def test_a_failed_commit_raises_rather_than_returning_a_bad_link():
    from arena.hub_publish import HubPublishError

    api = FakeApi(commit_error=RuntimeError("network is unreachable"))
    with pytest.raises(HubPublishError, match="unreachable"):
        publish_policy(api, "alice", "walker", b"onnx", rig="legs")


def test_a_commit_with_no_revision_is_an_error_not_a_dangling_url():
    from arena.hub_publish import HubPublishError

    class NoOid(FakeApi):
        def create_commit(self, **kwargs):
            super().create_commit(**kwargs)

            class Result:
                oid = None

            return Result()

    with pytest.raises(HubPublishError, match="revision"):
        publish_policy(NoOid(), "alice", "walker", b"onnx", rig="legs")
