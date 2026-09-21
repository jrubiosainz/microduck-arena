import json

import pytest

from arena.broadcasts import BroadcastBook


def dialogue(run_id: str) -> dict:
    return {"run_id": run_id, "turns": [{"speaker": "peter", "text": "Well.", "fact_refs": []}]}


def plan(duration_ms: int = 4000) -> dict:
    return {"duration_ms": duration_ms, "captions": [], "notes": [], "gestures": []}


def test_a_broadcast_is_written_and_read_back(tmp_path):
    book = BroadcastBook(tmp_path)
    written = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    assert written.run_id == "run-a"
    assert written.aired_at is None
    back = book.get(written.id)
    assert back == written


def test_an_unknown_id_is_none(tmp_path):
    assert BroadcastBook(tmp_path).get("nope") is None


def test_an_id_too_long_for_the_filesystem_is_none(tmp_path):
    """An id no filesystem will accept a filename for is still just an id with
    nothing behind it — `get` must not let the lookup itself raise."""
    assert BroadcastBook(tmp_path).get("a" * 300) is None


def test_unaired_gives_the_oldest_for_that_run(tmp_path):
    book = BroadcastBook(tmp_path)
    first = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:01:00Z")
    book.put("run-b", dialogue("run-b"), plan(), "2026-09-18T09:02:00Z")
    assert book.unaired("run-a").id == first.id
    assert book.unaired("run-c") is None


def test_an_aired_broadcast_is_no_longer_unaired(tmp_path):
    book = BroadcastBook(tmp_path)
    first = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    second = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:01:00Z")
    book.mark_aired(first.id, "2026-09-18T09:05:00Z")
    assert book.unaired("run-a").id == second.id
    assert book.get(first.id).aired_at == "2026-09-18T09:05:00Z"


def test_runs_stocked_is_every_run_with_one_waiting(tmp_path):
    book = BroadcastBook(tmp_path)
    a = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    book.put("run-b", dialogue("run-b"), plan(), "2026-09-18T09:01:00Z")
    assert book.runs_stocked() == {"run-a", "run-b"}
    book.mark_aired(a.id, "2026-09-18T09:05:00Z")
    assert book.runs_stocked() == {"run-b"}


def test_recent_aired_is_newest_last_and_leaves_the_unaired_out(tmp_path):
    book = BroadcastBook(tmp_path)
    ids = []
    for minute in range(4):
        made = book.put(f"run-{minute}", dialogue(f"run-{minute}"), plan(),
                        f"2026-09-18T09:0{minute}:00Z")
        ids.append(made.id)
    for minute, made in enumerate(ids[:3]):
        book.mark_aired(made, f"2026-09-18T10:0{minute}:00Z")
    heard = book.recent_aired(limit=2)
    assert [b.id for b in heard] == [ids[1], ids[2]]


def test_sweep_keeps_the_last_twenty_aired_and_never_a_waiting_one(tmp_path):
    book = BroadcastBook(tmp_path, keep=3)
    aired = []
    for i in range(6):
        made = book.put(f"run-{i}", dialogue(f"run-{i}"), plan(), f"2026-09-18T11:{i:02d}:00Z")
        book.mark_aired(made.id, f"2026-09-18T12:{i:02d}:00Z")
        aired.append(made.id)
    waiting = book.put("run-live", dialogue("run-live"), plan(), "2026-09-18T12:10:00Z")

    assert book.sweep("2026-09-18T12:20:00Z") == 3
    assert [book.get(one) is None for one in aired[:3]] == [True, True, True]
    assert [book.get(one) is not None for one in aired[3:]] == [True, True, True]
    assert book.get(waiting.id) is not None
    assert book.sweep("2026-09-18T12:20:00Z") == 0


def test_sweep_drops_a_waiting_broadcast_that_is_too_old_to_be_worth_hearing(tmp_path):
    """Nothing else ever deletes one: a run withdrawn, or one whose event has
    closed, leaves a dialogue that is never laid and never airs. An hour on,
    what it says about the standings is no longer true anyway."""
    book = BroadcastBook(tmp_path)
    stale = book.put("run-gone", dialogue("run-gone"), plan(), "2026-09-18T08:00:00Z")
    fresh = book.put("run-soon", dialogue("run-soon"), plan(), "2026-09-18T09:25:00Z")

    assert book.sweep("2026-09-18T09:30:00Z") == 1
    assert book.get(stale.id) is None
    assert book.get(fresh.id) is not None


def test_a_book_reads_a_directory_another_process_wrote(tmp_path):
    made = BroadcastBook(tmp_path).put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    assert BroadcastBook(tmp_path).get(made.id).run_id == "run-a"


def test_a_plan_that_is_not_whole_frames_is_refused(tmp_path):
    book = BroadcastBook(tmp_path)
    try:
        book.put("run-a", dialogue("run-a"), plan(duration_ms=4010), "2026-09-18T09:00:00Z")
    except ValueError as why:
        assert "40 ms" in str(why)
    else:
        raise AssertionError("a plan of 4010 ms must not be written")


def test_junk_in_the_directory_is_ignored(tmp_path):
    book = BroadcastBook(tmp_path)
    kept = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    (tmp_path / "notes.txt").write_text("not a broadcast")
    (tmp_path / "half.json").write_text("{")
    assert book.runs_stocked() == {"run-a"}
    assert book.get(kept.id) is not None


def test_a_plan_no_slot_could_be_cut_to_is_read_around(tmp_path):
    """Every field is there, so the body itself is fine — but the grid cuts a
    booth's slot to the plan's length, and it does that inside the build every
    screen is waiting on. What the book cannot hand over safely, it does not
    hand over at all."""
    book = BroadcastBook(tmp_path)
    kept = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")
    for broadcast_id, unusable in (("01CRUMB", plan(duration_ms=4010)), ("01EMPTY", {})):
        (tmp_path / f"{broadcast_id}.json").write_text(json.dumps({
            "id": broadcast_id, "run_id": f"run-{broadcast_id}",
            "dialogue": dialogue(f"run-{broadcast_id}"), "plan": unusable,
            "written_at": "2026-09-18T09:00:00Z", "aired_at": None}))
        assert book.get(broadcast_id) is None
        assert book.unaired(f"run-{broadcast_id}") is None
    assert book.runs_stocked() == {"run-a"}
    assert book.get(kept.id) is not None


def test_a_write_the_process_does_not_live_through_leaves_the_book_whole(tmp_path, monkeypatch):
    """Truncating the broadcast in place left a body every reader skipped and
    the sweep — which only ever saw broadcasts it could read — never deleted:
    an orphan for as long as the directory lasts. The body goes down beside the
    file and is renamed onto it, so the only moment a kill can land in leaves
    the old one standing."""
    book = BroadcastBook(tmp_path)
    made = book.put("run-a", dialogue("run-a"), plan(), "2026-09-18T09:00:00Z")

    def killed(_writing, _path):
        raise KeyboardInterrupt("the Space was redeployed")

    monkeypatch.setattr("arena.broadcasts.os.replace", killed)
    with pytest.raises(KeyboardInterrupt):
        book.mark_aired(made.id, "2026-09-18T09:05:00Z")

    assert book.get(made.id).aired_at is None
    assert [path.name for path in tmp_path.glob("*.json")] == [f"{made.id}.json"]
