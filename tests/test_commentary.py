"""From the store to a checked dialogue."""

import json

import pytest

from arena.broadcasts import BroadcastBook
from arena.commentary import (
    compose,
    find_run,
    gather,
    recent_broadcasts,
    used_memories,
)
from arena.commentary.generator import Rejected
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


def test_gather_puts_results_notables_memories_and_recent_runs_in_one_citable_list(tmp_path):
    leader = run("carol", 11.2, "2026-09-10T10:00:00Z", run_id="R0")
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, leader, mine)
    book = BroadcastBook(tmp_path)
    dialogue = {"turns": [{"speaker": "peter", "text": "Eleven two, @carol!"},
                          {"speaker": "ray", "text": "11.20 s, Peter."}],
                "lore_refs": []}
    aired = book.put("R0", dialogue, PLAN, "2026-09-10T11:00:00Z")
    book.mark_aired(aired.id, "2026-09-10T11:05:00Z")

    facts = gather(store, mine, LORE, book)
    kinds = [f.kind for f in facts]
    assert kinds[:5] == ["result"] * 5
    assert "notable" in kinds and "lore" in kinds and kinds[-1] == "recent"
    assert facts[-1].ref == f"recent:{aired.id}"
    assert facts[-1].text == "Earlier on the channel: Eleven two, @carol! 11.20 s, Peter."
    assert facts[-1].identities == ("carol",)
    assert sum(1 for f in facts if f.kind == "lore") <= 2
    assert all(f.ref.startswith("lore:") for f in facts if f.kind == "lore")


def test_compose_writes_with_a_provider_and_carries_the_facts(tmp_path):
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
    assert {f["ref"] for f in written["facts"]} >= {"run#/event", "run#/participant", "run#/result"}
    assert all(set(f) == {"ref", "kind", "text"} for f in written["facts"])


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
