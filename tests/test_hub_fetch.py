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
        info=lambda repo_id: (listing, "rev1", {}),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "policy.onnx"
    assert result.revision == "rev1"


def test_it_falls_back_to_the_only_onnx_when_the_name_differs():
    """q2p/microduck-beak-throw ships beak_throw.onnx, not policy.onnx."""
    result = fetch_policy(
        "alice/walker",
        info=lambda repo_id: (["README.md", "beak_throw.onnx"], "rev1", {}),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "beak_throw.onnx"


def test_several_candidate_onnx_files_must_be_named_explicitly():
    """Guessing between alpha_stand.onnx and beak_throw.onnx would silently
    race the wrong policy."""
    with pytest.raises(FetchError, match="which"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id: (["alpha_stand.onnx", "beak_throw.onnx"], "rev1", {}),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_an_explicit_filename_is_honoured_even_when_ambiguous():
    result = fetch_policy(
        "alice/walker:beak_throw.onnx",
        info=lambda repo_id: (["alpha_stand.onnx", "beak_throw.onnx"], "rev1", {}),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "beak_throw.onnx"


def test_a_repo_with_no_onnx_says_so():
    with pytest.raises(FetchError, match="no .onnx"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id: (["README.md", "model.pt"], "rev1", {}),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_a_named_file_that_is_absent_says_so():
    with pytest.raises(FetchError, match="nope.onnx"):
        fetch_policy(
            "alice/walker:nope.onnx",
            info=lambda repo_id: (["policy.onnx"], "rev1", {}),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_a_private_or_missing_repo_is_a_readable_refusal():
    def boom(repo_id):
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
            info=lambda repo_id: (
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
        info=lambda repo_id: (["policy.onnx"], "rev1", {"policy.onnx": None}),
        download=lambda repo_id, filename, revision: calls.append(filename) or "/tmp/x.onnx",
    )
    assert result.filename == "policy.onnx"
    assert calls == ["policy.onnx"]


@pytest.mark.network
def test_a_real_community_policy_races_here():
    """The premise of the whole feature: fetch a real Hub repo and race it here.

    v3 (MJCF position servos): RemiFabre/microduck-rough-walk-e scored 27.180s,
    5/5 seeds finished. v4 (BAM servos), before training's reset and fifth
    actuator writes joined the runner: the same policy circled left at zero
    yaw command into the lane wall at the scan's chosen speed, finishing only
    1 of 5 seeds, 43.104s. Since those writes, no scanned speed finishes — up
    to 0.70 m/s it times out short of 1.2 m, above that it falls — and all
    five seeds fall at the scan's pick (0.85 m/s), so the score is the 50 s
    time limit. That is a real property of this third-party policy under the
    corrected physics — this test's job is the fetch-and-evaluate pipeline,
    not a quality bar for a policy the Arena does not own, so seeds_finished
    is intentionally not asserted here.
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
    assert result.score == pytest.approx(50.0, rel=0.05)
