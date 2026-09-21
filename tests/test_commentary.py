"""From the store to a checked dialogue."""

import json

import pytest

from arena.broadcasts import BroadcastBook
from arena.commentary import (
    briefing,
    callback_fact,
    compose,
    find_run,
    gather,
    recent_broadcasts,
    used_memories,
)
from arena.commentary.generator import CALLBACK, NO_CALLBACK, Rejected, direction
from arena.commentary.lore import load
from arena.store import LocalStore
from tests.test_commentary_context import run

LORE = load()
PLAN = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}


def stored(tmp_path, *records):
    store = LocalStore(tmp_path)
    for record in records:
        store.append(record, b"trace")
    return store


def test_recent_broadcasts_are_the_last_aired_newest_last(tmp_path):
    book = BroadcastBook(tmp_path)
    ids = []
    for minute in range(3):
        made = book.put(f"run-{minute}",
                        {"run_id": f"run-{minute}", "turns": [], "lore_refs": []},
                        PLAN, f"2026-09-18T09:0{minute}:00Z")
        ids.append(made.id)
    book.mark_aired(ids[0], "2026-09-18T10:00:00Z")
    book.mark_aired(ids[1], "2026-09-18T10:01:00Z")

    heard = recent_broadcasts(book, limit=5)
    assert [one.id for one in heard] == [ids[0], ids[1]]


def test_used_memories_are_counted_in_airings(tmp_path):
    book = BroadcastBook(tmp_path)
    aired = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": ["lore:pit"]},
                     PLAN, "2026-09-18T09:00:00Z")
    book.put("run-b", {"run_id": "run-b", "turns": [], "lore_refs": ["lore:rain"]},
             PLAN, "2026-09-18T09:01:00Z")
    book.mark_aired(aired.id, "2026-09-18T10:00:00Z")

    # Only what went out counts: a dialogue still waiting has spent no memory.
    assert used_memories(book) == {"lore:pit"}


CAROL = [
    {"ref": "run#/participant", "kind": "result",
     "text": "The participant is @carol, racing a policy named carol-v1."},
    {"ref": "run#/result", "kind": "result",
     "text": "The mean finish time is 11.20 s, every one of the 5 seeds finished."},
    {"ref": "run#/board", "kind": "result",
     "text": "This run takes the lead of the 2 m Sprint board."},
    {"ref": "run#/points", "kind": "result",
     "text": "This run earned 100 points: a first run on this event (100)."},
    {"ref": "lore:pit", "kind": "lore", "text": "The pit, and what fell in it."},
]


def aired(book, run_id, facts, at):
    made = book.put(run_id, {"turns": [], "lore_refs": [],
                             "brief": {"facts": facts, "direction": {}, "model": "m"}}, PLAN, at)
    book.mark_aired(made.id, at)
    return made


def test_a_callback_is_the_last_other_run_to_air_told_by_its_result_facts(tmp_path):
    book = BroadcastBook(tmp_path)
    carol = aired(book, "R0", CAROL, "2026-09-10T11:00:00Z")
    aired(book, "R1", [], "2026-09-10T11:05:00Z")  # this run's own airing is not a callback

    [fact] = callback_fact(book, "R1")
    assert fact.ref == f"recent:{carol.id}" and fact.kind == "recent"
    assert fact.text == ("Earlier this season: The participant is @carol, racing a policy named "
                         "carol-v1. The mean finish time is 11.20 s, every one of the 5 seeds "
                         "finished.")
    # The board and the points sentences speak in the present tense of "this
    # run": borrowed by a callback they would describe the wrong run, so a
    # callback carries neither.
    assert "board" not in fact.text and "lead" not in fact.text
    assert "points" not in fact.text and "earned" not in fact.text
    assert fact.identities == ("carol",)
    assert callback_fact(BroadcastBook(tmp_path / "empty"), "R1") == []


def test_gather_offers_an_earlier_run_only_to_a_callback(tmp_path):
    leader = run("carol", 11.2, "2026-09-10T10:00:00Z", run_id="R0")
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, leader, mine)
    book = BroadcastBook(tmp_path)
    aired(book, "R0", CAROL, "2026-09-10T11:00:00Z")

    plain = gather(store, mine, LORE, book, callback=False)
    kinds = [f.kind for f in plain]
    assert kinds[:5] == ["result"] * 5
    assert "notable" in kinds and "lore" in kinds and "recent" not in kinds
    assert sum(1 for f in plain if f.kind == "lore") <= 2
    called = gather(store, mine, LORE, book, callback=True)
    assert [f.kind for f in called] == [*kinds, "recent"]


def test_a_callback_the_book_cannot_serve_is_no_callback(tmp_path):
    # From R1 up: R0 is the run that airs below, and a run is never its own callback.
    run_id = next(f"R{i}" for i in range(1, 200) if direction(f"R{i}")["callback"] == CALLBACK)
    store = stored(tmp_path, run("alice", 12.4, "2026-09-11T10:00:00Z", run_id=run_id))
    book = BroadcastBook(tmp_path)
    _, drawn = briefing(store, run_id, lore=LORE, book=book)
    assert drawn["callback"] == NO_CALLBACK
    aired(book, "R0", CAROL, "2026-09-10T11:00:00Z")
    facts, drawn = briefing(store, run_id, lore=LORE, book=book)
    assert drawn["callback"] == CALLBACK and facts[-1].kind == "recent"


def test_compose_writes_with_a_provider_and_carries_its_brief(tmp_path):
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, mine)
    book = BroadcastBook(tmp_path)

    def provider(messages, max_tokens):
        content = [
            {"speaker": "peter", "text": "12.40 s for alice, Ray!", "fact_refs": [1, 2]},
            {"speaker": "ray", "text": "12.40 s, every seed finished, Peter.", "fact_refs": [2]},
            {"speaker": "peter", "text": "A throne, my friend.", "fact_refs": [3]},
        ]
        return {"content": json.dumps(content), "finish_reason": "stop", "model": "m",
                "prompt_tokens": 10, "completion_tokens": 10}

    written = compose(store, "R1", lore=LORE, provider=provider, model="m", book=book)
    assert written["run_id"] == "R1"
    assert [t["speaker"] for t in written["turns"]] == ["peter", "ray", "peter"]
    assert written["turns"][0]["fact_refs"] == ["run#/participant", "run#/result"]
    facts, drawn = briefing(store, "R1", lore=LORE, book=book)
    assert written["brief"] == {
        "facts": [{"ref": f.ref, "kind": f.kind, "text": f.text} for f in facts],
        "direction": drawn, "model": "m"}
    assert "facts" not in written


def test_compose_raises_rejected_and_find_run_raises_lookup(tmp_path):
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, mine)
    book = BroadcastBook(tmp_path)
    with pytest.raises(Rejected):
        compose(store, "R1", lore=LORE, provider=lambda m, n: {
            "content": "no", "finish_reason": "stop", "model": "m",
            "prompt_tokens": 1, "completion_tokens": 1}, model="m", book=book)
    with pytest.raises(LookupError):
        find_run(store, "NOPE")
