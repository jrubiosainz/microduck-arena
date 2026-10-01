import hashlib
import json

import pytest

from arena.hub_fetch import FetchError, check_manifest, fetch_policy, parse_repo_ref, rig_of
from arena.manifest import load_event


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


GOOD_MANIFEST = {
    "obs_len": 61,
    "action_len": 14,
    "kind": "perpetual",
    "name": "walker",
    "robot": {"model": "microduck", "accessories": []},
}


def _fetch(tmp_path, manifest, event_id="sprint-2m", revision=None, downloads=None, timeline=None):
    """fetch_policy against a fake Hub holding policy.onnx and, unless None, this manifest and this
    timeline.json."""
    files = (["README.md", "policy.onnx"] + ([] if manifest is None else ["manifest.json"])
             + ([] if timeline is None else ["timeline.json"]))
    manifest_path = tmp_path / "manifest.json"
    if manifest is not None:
        manifest_path.write_text(manifest if isinstance(manifest, str) else json.dumps(manifest))
    timeline_path = tmp_path / "timeline.json"
    if timeline is not None:
        timeline_path.write_text(timeline if isinstance(timeline, str) else json.dumps(timeline))
    seen = [] if downloads is None else downloads

    def download(repo_id, filename, rev):
        seen.append((filename, rev))
        return {"manifest.json": str(manifest_path), "timeline.json": str(timeline_path)}.get(filename, "/tmp/x.onnx")

    return fetch_policy(
        "alice/walker", revision=revision, event=load_event(event_id),
        info=lambda repo_id, rev: (files, f"sha-of-{rev or 'main'}", {}), download=download,
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


@pytest.mark.parametrize("field", ["obs_len", "action_len", "kind", "robot"])
@pytest.mark.parametrize("absent", ["missing", "null"])
def test_a_field_the_manifest_does_not_declare_is_not_checked(tmp_path, field, absent):
    """Only a declared disagreement refuses: real repos (HannesVonEssen/microduck-climb,
    q2p/microduck-beak-throw) publish a manifest with no obs_len or no kind."""
    manifest = {k: v for k, v in GOOD_MANIFEST.items() if k != field} | ({field: None} if absent == "null" else {})
    assert _fetch(tmp_path, manifest).manifest == manifest


def test_a_robot_that_names_no_model_is_not_checked(tmp_path):
    manifest = GOOD_MANIFEST | {"robot": {"accessories": []}}
    assert _fetch(tmp_path, manifest).manifest == manifest


@pytest.mark.parametrize(
    "robot,event_id,field",
    [
        ("microduck", "sprint-2m", "robot"),
        (["microduck"], "sprint-2m", "robot"),
        ({"model": "microduck", "accessories": 3}, "sprint-2m", "accessories"),
        ({"model": "microduck", "accessories": "rollers"}, "roller-sprint-2m", "accessories"),
    ],
)
def test_a_robot_of_the_wrong_shape_is_refused_naming_it(tmp_path, robot, event_id, field):
    with pytest.raises(FetchError, match=field):
        _fetch(tmp_path, GOOD_MANIFEST | {"robot": robot}, event_id=event_id)


def test_a_manifest_that_cannot_be_read_is_refused(tmp_path):
    def download(repo_id, filename, rev):
        return str(tmp_path)  # a directory: reading it fails with an OSError

    with pytest.raises(FetchError, match="could not read alice/walker/manifest.json"):
        fetch_policy("alice/walker", event=load_event("sprint-2m"), download=download,
                     info=lambda repo_id, rev: (["policy.onnx", "manifest.json"], "sha", {}))


def test_a_manifest_that_is_not_utf8_is_refused(tmp_path):
    def download(repo_id, filename, rev):
        path = tmp_path / "manifest.json"
        path.write_bytes(b'{"kind": "\xff"}')
        return str(path)

    with pytest.raises(FetchError, match="could not read alice/walker/manifest.json"):
        fetch_policy("alice/walker", event=load_event("sprint-2m"), download=download,
                     info=lambda repo_id, rev: (["policy.onnx", "manifest.json"], "sha", {}))


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


PERFORMANCE = {"timeline_version": 1, "duration_s": 4.0,
               "keyframes": [{"t": 0.0}, {"t": 2.0, "twist": [1, 0, 0]}]}


def test_a_stage_entry_brings_its_timeline_from_the_pinned_revision(tmp_path):
    downloads = []
    fetched = _fetch(tmp_path, None, event_id="got-a-talent", revision="abc123", downloads=downloads,
                     timeline=PERFORMANCE)
    assert fetched.timeline.duration_s == 4.0
    assert fetched.timeline.command_at(2.0)[0] == 1.0
    assert fetched.timeline_sha256 == hashlib.sha256((tmp_path / "timeline.json").read_bytes()).hexdigest()
    assert downloads == [("timeline.json", "sha-of-abc123"), ("policy.onnx", "sha-of-abc123")]


def test_a_stage_entry_without_a_timeline_plays_the_events_command(tmp_path):
    fetched = _fetch(tmp_path, None, event_id="got-a-talent")
    assert (fetched.timeline, fetched.timeline_sha256) == (None, None)


@pytest.mark.parametrize("content, reason", [
    ("{not json", "not a JSON file"),
    ({**PERFORMANCE, "duration_s": 25.0}, "longer than this event's 20 s"),
    ({**PERFORMANCE, "keyframes": [{"t": 0.0, "head": [0, 0, 1]}]}, "keyframes[0].head"),
])
def test_a_timeline_the_arena_will_not_play_is_refused_before_the_weights(tmp_path, content, reason):
    downloads = []
    with pytest.raises(FetchError) as refused:
        _fetch(tmp_path, None, event_id="got-a-talent", downloads=downloads, timeline=content)
    assert "alice/walker/timeline.json" in str(refused.value)
    assert reason in str(refused.value)
    assert "policy.onnx" not in [name for name, _ in downloads]


def test_a_race_never_reads_a_timeline(tmp_path):
    downloads = []
    fetched = _fetch(tmp_path, None, event_id="sprint-2m", downloads=downloads, timeline="{not json")
    assert fetched.timeline is None
    assert "timeline.json" not in [name for name, _ in downloads]
