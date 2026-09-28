import pytest

from arena.hub_fetch import FetchError, fetch_policy, parse_repo_ref


@pytest.mark.parametrize(
    "text,expected",
    [
        ("alice/walker", ("alice/walker", None)),
        ("alice/walker:sub/dir/policy.onnx", ("alice/walker", "sub/dir/policy.onnx")),
        ("  alice/walker  ", ("alice/walker", None)),
        ("https://huggingface.co/alice/walker", ("alice/walker", None)),
        ("https://huggingface.co/alice/walker/tree/main", ("alice/walker", None)),
        # /blob/ and /resolve/ name a FILE, not a directory: the filename the
        # user pointed at must survive, not get silently discarded in favour
        # of whatever `_pick` would guess later.
        (
            "https://huggingface.co/alice/walker/blob/main/alpha.onnx",
            ("alice/walker", "alpha.onnx"),
        ),
        (
            "https://huggingface.co/alice/walker/resolve/main/alpha.onnx",
            ("alice/walker", "alpha.onnx"),
        ),
        (
            "https://huggingface.co/alice/walker/blob/main/sub/dir/x.onnx",
            ("alice/walker", "sub/dir/x.onnx"),
        ),
    ],
)
def test_a_repo_reference_is_parsed_from_what_people_actually_paste(text, expected):
    assert parse_repo_ref(text) == expected


@pytest.mark.parametrize("bad", ["", "  ", "notarepo", "a/b/c/d", "../../etc"])
def test_an_unusable_reference_is_refused_with_a_readable_reason(bad):
    with pytest.raises(FetchError):
        parse_repo_ref(bad)


def test_it_prefers_policy_onnx_at_the_root():
    """11 of the 13 real repos call it exactly that."""
    listing = ["README.md", "legacy/policy.onnx", "policy.onnx"]
    result = fetch_policy(
        "alice/walker",
        info=lambda repo_id, revision: (listing, "rev1", {}),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "policy.onnx"
    assert result.revision == "rev1"


def test_it_falls_back_to_the_only_onnx_when_the_name_differs():
    """q2p/microduck-beak-throw ships beak_throw.onnx, not policy.onnx."""
    result = fetch_policy(
        "alice/walker",
        info=lambda repo_id, revision: (["README.md", "beak_throw.onnx"], "rev1", {}),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "beak_throw.onnx"


def test_several_candidate_onnx_files_must_be_named_explicitly():
    """Guessing between alpha_stand.onnx and beak_throw.onnx would silently
    race the wrong policy."""
    with pytest.raises(FetchError, match="which"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id, revision: (["alpha_stand.onnx", "beak_throw.onnx"], "rev1", {}),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_an_explicit_filename_is_honoured_even_when_ambiguous():
    result = fetch_policy(
        "alice/walker:beak_throw.onnx",
        info=lambda repo_id, revision: (["alpha_stand.onnx", "beak_throw.onnx"], "rev1", {}),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "beak_throw.onnx"


def test_a_repo_with_no_onnx_says_so():
    with pytest.raises(FetchError, match="no .onnx"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id, revision: (["README.md", "model.pt"], "rev1", {}),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_a_named_file_that_is_absent_says_so():
    with pytest.raises(FetchError, match="nope.onnx"):
        fetch_policy(
            "alice/walker:nope.onnx",
            info=lambda repo_id, revision: (["policy.onnx"], "rev1", {}),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_a_private_or_missing_repo_is_a_readable_refusal():
    def boom(repo_id, revision):
        raise RuntimeError("401 Client Error")

    with pytest.raises(FetchError, match="401"):
        fetch_policy("alice/walker", info=boom, download=lambda *a: "/tmp/x")


def test_a_declared_oversize_file_is_refused_without_downloading():
    """The whole point: refuse before spending the bandwidth. A repo can hold
    anything, and the Hub already declares a size without needing a download."""
    from arena.policy import MAX_MODEL_BYTES

    calls = []
    with pytest.raises(FetchError, match="larger than"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id, revision: (
                ["policy.onnx"],
                "rev1",
                {"policy.onnx": MAX_MODEL_BYTES + 1},
            ),
            download=lambda *a: calls.append(a) or "/tmp/x.onnx",
        )
    assert calls == []


def test_a_repo_that_declines_to_report_a_size_still_downloads():
    """None is not evidence of a large file — refusing on it would reject a
    repo for saying nothing, which is not what it did."""
    calls = []
    result = fetch_policy(
        "alice/walker",
        info=lambda repo_id, revision: (["policy.onnx"], "rev1", {"policy.onnx": None}),
        download=lambda repo_id, filename, revision: calls.append(filename) or "/tmp/x.onnx",
    )
    assert result.filename == "policy.onnx"
    assert calls == ["policy.onnx"]


@pytest.mark.network
def test_a_real_community_policy_races_here():
    """The premise of the whole feature: fetch a real Hub repo and race it here.

    v3 (MJCF position servos): RemiFabre/microduck-rough-walk-e scored 27.180s,
    5/5 seeds finished. v4 (BAM servos): 0/5 — at zero yaw command it turns
    left into the lane wall, where it stalls until the time limit at slow
    speeds and falls at fast ones. That is a real property of this third-party
    policy under the corrected physics. This test's job is the
    fetch-and-evaluate pipeline, not a quality bar for a policy the Arena does
    not own, so neither seeds_finished nor the score is asserted: a 0/5 policy
    scores the 50 s limit, and a pin there would match any failing policy.
    """
    from arena.constants import RUNNER_VERSION
    from arena.evaluate import evaluate
    from arena.hub_fetch import fetch_policy
    from arena.manifest import load_event
    from arena.policy import load_policy

    fetched = fetch_policy("RemiFabre/microduck-rough-walk-e")
    result = evaluate(load_event("sprint-2m"), load_policy(fetched.path))
    assert len(result.per_seed) == 5
    assert result.runner_version == RUNNER_VERSION


import json

from arena.hub_fetch import check_manifest, rig_of
from arena.manifest import load_event

GOOD_MANIFEST = {
    "obs_len": 61,
    "action_len": 14,
    "kind": "perpetual",
    "name": "walker",
    "robot": {"model": "microduck", "accessories": []},
}


def _fetch(tmp_path, manifest, event_id="sprint-2m", revision=None, downloads=None):
    """fetch_policy against a fake Hub holding policy.onnx and, unless None, this manifest."""
    files = ["README.md", "policy.onnx"] + ([] if manifest is None else ["manifest.json"])
    manifest_path = tmp_path / "manifest.json"
    if manifest is not None:
        manifest_path.write_text(manifest if isinstance(manifest, str) else json.dumps(manifest))
    seen = [] if downloads is None else downloads

    def download(repo_id, filename, rev):
        seen.append((filename, rev))
        return str(manifest_path) if filename == "manifest.json" else "/tmp/x.onnx"

    return fetch_policy(
        "alice/walker",
        revision=revision,
        event=load_event(event_id),
        info=lambda repo_id, rev: (files, f"sha-of-{rev or 'main'}", {}),
        download=download,
    )


def test_a_matching_manifest_is_read_and_kept(tmp_path):
    assert _fetch(tmp_path, GOOD_MANIFEST).manifest == GOOD_MANIFEST


def test_a_repo_without_a_manifest_is_still_accepted(tmp_path):
    """Not every community repo has one; the ONNX is validated regardless."""
    assert _fetch(tmp_path, None).manifest is None


def test_a_revision_pins_every_file_and_the_link(tmp_path):
    downloads = []
    fetched = _fetch(tmp_path, GOOD_MANIFEST, revision="abc123", downloads=downloads)
    assert fetched.revision == "sha-of-abc123"
    assert downloads == [("manifest.json", "sha-of-abc123"), ("policy.onnx", "sha-of-abc123")]
    assert fetched.url.endswith("/resolve/sha-of-abc123/policy.onnx")


@pytest.mark.parametrize(
    "change,field",
    [
        ({"obs_len": 48}, "obs_len"),
        ({"action_len": 12}, "action_len"),
        ({"kind": "episodic"}, "kind"),
        ({"robot": {"model": "microduck", "accessories": ["rollers"]}}, "robot"),
        ({"robot": {"model": "flyduck"}}, "robot"),
    ],
)
def test_a_manifest_that_disagrees_with_the_event_is_refused_by_field(tmp_path, change, field):
    downloads = []
    with pytest.raises(FetchError, match=field):
        _fetch(tmp_path, GOOD_MANIFEST | change, downloads=downloads)
    assert [name for name, _ in downloads] == ["manifest.json"], "refused before the ONNX is fetched"


def test_a_roller_manifest_enters_the_roller_sprint(tmp_path):
    rollers = GOOD_MANIFEST | {"robot": {"model": "microduck", "accessories": ["rollers"]}}
    assert _fetch(tmp_path, rollers, event_id="roller-sprint-2m").manifest == rollers


def test_a_manifest_that_is_not_json_is_refused(tmp_path):
    with pytest.raises(FetchError, match="not valid JSON"):
        _fetch(tmp_path, "{nope")


@pytest.mark.parametrize(
    "robot,rig",
    [
        ({"model": "microduck", "accessories": []}, "legs"),
        ({"model": "microduck"}, "legs"),
        ({"model": "microduck", "accessories": ["rollers"]}, "rollers"),
        # What this Arena's own publisher wrote before `uv run publish` took over.
        ({"model": "microduck passive rollers"}, "rollers"),
        ({"model": "flyduck"}, None),
        ({}, None),
    ],
)
def test_the_rig_is_read_from_both_vocabularies(robot, rig):
    assert rig_of({"robot": robot}) == rig


def test_check_manifest_is_silent_when_everything_agrees():
    check_manifest(GOOD_MANIFEST, load_event("sprint-2m"))
