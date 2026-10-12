import pytest

from arena.constants import RUNNER_VERSION
from arena.evaluate import SeedResult
from arena.store import LocalStore, RunRecord, new_id


def make_record(**overrides) -> RunRecord:
    fields = {
        "run_id": new_id(),
        "event_id": "sprint-2m",
        "submitted_at": "2026-09-03T10:00:00Z",
        "user": "alice",
        "policy_name": "sprinter-v3",
        "source": {"kind": "repo", "repo_id": "alice/sprinter", "filename": "policy.onnx"},
        "model_sha256": "a" * 64,
        "score": 21.5,
        "seeds_finished": 5,
        "per_seed": (SeedResult(seed=1, status="finish", time_s=21.5),),
        "trace_seed": 1,
        # RUNNER_VERSION and not a literal: a fixture pinned to 1 silently
        # disappears from every leaderboard test the next time it is bumped.
        "runner_version": RUNNER_VERSION,
        "command_vx": 0.4,
    }
    fields.update(overrides)
    return RunRecord(**fields)


def test_run_ids_are_unique_and_sort_by_time():
    ids = [new_id() for _ in range(50)]
    assert len(set(ids)) == 50
    assert ids == sorted(ids), "run ids must sort chronologically"


def test_record_round_trips_through_a_dict():
    record = make_record()
    assert RunRecord.from_dict(record.to_dict()) == record


def test_a_run_keeps_the_timeline_it_played():
    record = make_record(event_id="got-a-talent", timeline_sha256="t" * 64)
    assert RunRecord.from_dict(record.to_dict()).timeline_sha256 == "t" * 64
    old = make_record().to_dict()
    del old["timeline_sha256"]  # a run recorded before timelines existed
    assert RunRecord.from_dict(old).timeline_sha256 is None


def test_append_then_read_back(tmp_path):
    store = LocalStore(tmp_path)
    record = make_record()
    store.append(record, b"trace-bytes")

    assert store.runs("sprint-2m") == [record]
    assert store.trace(record.run_id) == b"trace-bytes"


def test_runs_are_isolated_per_event(tmp_path):
    store = LocalStore(tmp_path)
    sprint = make_record(event_id="sprint-2m")
    roller = make_record(event_id="roller-sprint-2m")
    store.append(sprint, b"a")
    store.append(roller, b"b")

    assert store.runs("sprint-2m") == [sprint]
    assert store.runs("roller-sprint-2m") == [roller]


def test_appending_is_immutable(tmp_path):
    store = LocalStore(tmp_path)
    record = make_record()
    store.append(record, b"a")
    with pytest.raises(FileExistsError):
        store.append(record, b"b")


def test_an_orphaned_trace_blocks_reuse_of_its_run_id(tmp_path):
    """An append that died between its two writes leaves a trace behind.

    Reusing that run_id must fail rather than silently overwrite the orphan —
    otherwise the one mutation this store forbids happens by accident.
    """
    store = LocalStore(tmp_path)
    record = make_record()
    orphan = tmp_path / "traces" / f"{record.run_id}.npz"
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(b"orphan")
    with pytest.raises(FileExistsError):
        store.append(record, b"new")


def test_unknown_event_reads_as_empty(tmp_path):
    assert LocalStore(tmp_path).runs("nope") == []


def test_unknown_trace_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        LocalStore(tmp_path).trace("01JNOPE")


def test_a_record_written_before_liveries_still_loads():
    """The log is append-only, so old files are never rewritten to add a field.

    A record from before liveries existed has no such key; reading it must not
    raise, and it must come back as the robot's default colourway.
    """
    old = make_record().to_dict()
    del old["livery"]
    assert RunRecord.from_dict(old).livery == "classic"


def test_a_livery_round_trips():
    record = make_record(livery="purple")
    assert RunRecord.from_dict(record.to_dict()).livery == "purple"


def test_a_description_survives_the_round_trip_and_an_older_record_has_none():
    record = make_record(description="It leans into every step.")
    assert RunRecord.from_dict(record.to_dict()).description == "It leans into every step."
    older = record.to_dict()
    del older["description"]
    assert RunRecord.from_dict(older).description is None


def test_a_published_model_is_stored_and_read_back(tmp_path):
    store = LocalStore(tmp_path)
    record = make_record(model_stored=True)
    store.append(record, b"trace-bytes", b"onnx-bytes")

    assert store.model(record.model_sha256) == b"onnx-bytes"
    assert store.runs("sprint-2m")[0].model_stored is True


def test_two_runs_of_the_same_weights_share_one_file(tmp_path):
    """Content-addressed, so republishing the same policy under a new name — or
    two people entering the same weights — costs one copy, not two."""
    store = LocalStore(tmp_path)
    store.append(make_record(model_stored=True, policy_name="v1"), b"t1", b"same-onnx")
    store.append(make_record(model_stored=True, policy_name="v2"), b"t2", b"same-onnx")

    models = list((tmp_path / "models").glob("*.onnx"))
    assert len(models) == 1
    assert models[0].read_bytes() == b"same-onnx"
    assert len(store.runs("sprint-2m")) == 2


def test_re_appending_shared_weights_is_not_the_overwrite_the_store_forbids(tmp_path):
    """The run JSON and the trace refuse to be overwritten; the model must NOT,
    or the second person to publish a shared policy gets an error. Safe only
    because the filename is a hash of the contents."""
    store = LocalStore(tmp_path)
    store.append(make_record(model_stored=True), b"t1", b"same-onnx")
    # No raise, and the bytes are untouched.
    store.append(make_record(model_stored=True), b"t2", b"same-onnx")
    assert store.model("a" * 64) == b"same-onnx"


def test_a_run_stored_without_a_model_says_so(tmp_path):
    """Runs recorded before policies were kept. The log is append-only, so those
    files are never coming back and the page must show no link rather than one
    that 404s."""
    store = LocalStore(tmp_path)
    store.append(make_record(), b"trace-bytes")
    assert store.runs("sprint-2m")[0].model_stored is False
    assert not (tmp_path / "models").exists()


def test_a_record_written_before_policies_were_kept_still_loads():
    raw = make_record(model_stored=True).to_dict()
    del raw["model_stored"]
    assert RunRecord.from_dict(raw).model_stored is False


def test_offers_download_covers_both_hosting_paths():
    """`model_stored` stopped matching its name once policies moved to the Hub:
    a Hub run offers a download while storing nothing here. One rule, one place."""
    assert make_record(model_stored=True).offers_download is True
    assert make_record(model_stored=False).offers_download is False
    assert (
        make_record(
            model_stored=False,
            source={"kind": "hub", "repo_id": "a/b", "url": "https://x/y"},
        ).offers_download
        is True
    )


def test_every_store_implements_the_whole_protocol():
    """Shipped broken once, and this is why.

    `Store` is a typing Protocol, so Python enforces nothing at runtime: adding
    `withdraw`/`withdrawals` to the Protocol and to LocalStore left HubStore
    silently incomplete, every test passed because they all use LocalStore, and
    the deployed Space returned 500 on every leaderboard request.

    This asserts the shape of each implementation against the Protocol itself,
    so the next method added to `Store` fails here rather than in production.
    """
    from arena.store import HubStore, Store

    required = [
        name
        for name in dir(Store)
        if not name.startswith("_") and callable(getattr(Store, name, None))
    ]
    assert "withdraw" in required and "withdrawals" in required, required

    for implementation in (LocalStore, HubStore):
        missing = [name for name in required if not hasattr(implementation, name)]
        assert missing == [], f"{implementation.__name__} is missing {missing}"


def test_a_record_keeps_its_triggers_and_an_older_one_has_none():
    record = make_record(event_id="got-a-talent", triggers=[[0.0, 0.0, 0.0], [1.5, 1.0, 0.0]])
    assert RunRecord.from_dict(record.to_dict()) == record
    older = record.to_dict()
    del older["triggers"]
    assert RunRecord.from_dict(older).triggers is None
