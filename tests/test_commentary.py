"""From the store to a checked dialogue, and the file the store keeps."""

import json

import pytest

from arena.commentary import (
    commentary_json,
    compose,
    find_run,
    gather,
    recent_commentaries,
    used_memories,
)
from arena.commentary.generator import Rejected
from arena.commentary.lore import load
from arena.store import LocalStore
from tests.test_commentary_context import run

LORE = load()


def stored(tmp_path, *records):
    store = LocalStore(tmp_path)
    for record in records:
        store.append(record, b"trace")
    return store


def commentary(run_id, written_at, turns, lore_refs=(), facts=()):
    return json.dumps({
        "version": 1, "run_id": run_id, "written_at": written_at, "model": "m",
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        "facts": [{"ref": f"run#/{i}", "kind": "result", "text": text} for i, text in enumerate(facts)],
        "dialogue": {"turns": [{"speaker": "peter", "text": t, "fact_refs": []} for t in turns],
                     "lore_refs": list(lore_refs)},
        "plan": {"duration_ms": 20000},
    }).encode()


def test_recent_commentaries_are_the_newest_first_excluding_the_run_itself(tmp_path):
    store = LocalStore(tmp_path)
    for run_id, at in (("A", "2026-09-10T10:00:00Z"), ("B", "2026-09-12T10:00:00Z"),
                       ("C", "2026-09-11T10:00:00Z")):
        store.put_clip(run_id, {"clip.json": b"{}", "commentary.json": commentary(run_id, at, ["hi"], ["x"])})
    store.put_clip("D", {"clip.json": b"{}"})
    assert [c["run_id"] for c in recent_commentaries(store, exclude="C")] == ["B", "A"]
    assert [c["run_id"] for c in recent_commentaries(store, exclude=None, limit=2)] == ["B", "C"]
    assert used_memories(store, exclude="B") == {"x"}
    assert used_memories(store, exclude="B", cooldown=0) == set()


def test_gather_puts_results_notables_memories_and_recent_runs_in_one_citable_list(tmp_path):
    leader = run("carol", 11.2, "2026-09-10T10:00:00Z", run_id="R0")
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, leader, mine)
    store.put_clip("R0", {"clip.json": b"{}", "commentary.json": commentary(
        "R0", "2026-09-10T11:00:00Z", ["Eleven two, Ray!", "11.20 s, Peter."],
        facts=["The event is the 2 m Sprint, a 2 m sprint on foot.", "The participant is @carol."])})
    facts, recent = gather(store, mine, LORE)
    kinds = [f.kind for f in facts]
    assert kinds[:5] == ["result"] * 5
    assert "notable" in kinds and "lore" in kinds and kinds[-1] == "recent"
    assert facts[-1].ref == "recent:R0"
    assert facts[-1].text == ("Earlier this season: The event is the 2 m Sprint, a 2 m sprint on foot. "
                              "The participant is @carol.")
    assert facts[-1].identities == ("carol",)
    assert recent == [{"ref": "recent:R0", "turns": ["Eleven two, Ray!", "11.20 s, Peter."]}]
    assert sum(1 for f in facts if f.kind == "lore") <= 2
    assert all(f.ref.startswith("lore:") for f in facts if f.kind == "lore")


def test_compose_writes_with_a_provider_and_carries_the_facts(tmp_path):
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, mine)

    def provider(messages, max_tokens):
        if max_tokens == 96:
            content = {"grounded": True, "english": True, "personalities": True, "fresh": True}
        else:
            content = [
                {"speaker": "peter", "text": "12.40 s for alice, Ray!", "fact_refs": [1, 2]},
                {"speaker": "ray", "text": "12.40 s, every seed finished, Peter.", "fact_refs": [2]},
                {"speaker": "peter", "text": "A throne, my friend.", "fact_refs": [3]},
            ]
        return {"content": json.dumps(content), "finish_reason": "stop", "model": "m",
                "prompt_tokens": 10, "completion_tokens": 10}

    written = compose(store, "R1", lore=LORE, provider=provider, model="m")
    assert written["run_id"] == "R1"
    assert [t["speaker"] for t in written["turns"]] == ["peter", "ray", "peter"]
    assert written["turns"][0]["fact_refs"] == ["run#/participant", "run#/result"]
    assert {f["ref"] for f in written["facts"]} >= {"run#/event", "run#/participant", "run#/result"}
    assert all(set(f) == {"ref", "kind", "text"} for f in written["facts"])


def test_compose_raises_rejected_and_find_run_raises_lookup(tmp_path):
    mine = run("alice", 12.4, "2026-09-11T10:00:00Z", run_id="R1")
    store = stored(tmp_path, mine)
    with pytest.raises(Rejected):
        compose(store, "R1", lore=LORE, provider=lambda m, n: {
            "content": "no", "finish_reason": "stop", "model": "m",
            "prompt_tokens": 1, "completion_tokens": 1}, model="m")
    with pytest.raises(LookupError):
        find_run(store, "NOPE")


def test_the_file_carries_dialogue_plan_facts_and_provenance():
    written = {"run_id": "R1", "turns": [{"speaker": "peter", "text": "Hi.", "fact_refs": ["run#/event"]}],
               "lore_refs": ["megaphone"], "model": "m", "usage": {"prompt_tokens": 1, "completion_tokens": 2},
               "facts": [{"ref": "run#/event", "kind": "result", "text": "The event."}]}
    plan = {"version": 1, "run_id": "R1", "duration_ms": 4000, "captions": [], "notes": [], "gestures": []}
    body = json.loads(commentary_json(written, plan, "2026-09-17T14:02:11Z"))
    assert body == {
        "version": 1, "run_id": "R1", "written_at": "2026-09-17T14:02:11Z", "model": "m",
        "usage": {"prompt_tokens": 1, "completion_tokens": 2},
        "facts": [{"ref": "run#/event", "kind": "result", "text": "The event."}],
        "dialogue": {"turns": written["turns"], "lore_refs": ["megaphone"]},
        "plan": plan,
    }
    with pytest.raises(ValueError):
        commentary_json(written, {**plan, "duration_ms": 4010}, "2026-09-17T14:02:11Z")
