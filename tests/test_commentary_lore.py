"""The bible is data the owner edits; the code only checks it and picks from it."""

import json

import pytest

from arena.commentary.context import Fact
from arena.commentary.lore import Lore, Memory, load, select_memories


def test_the_shipped_bible_is_well_formed_and_deep():
    lore = load()
    assert set(lore.characters) == {"peter", "ray"}
    assert lore.characters["peter"]["name"] == "Peter Duckry"
    assert len(lore.characters["ray"]["sheet"]) > 300
    assert len(lore.memories) >= 24
    assert len({m.id for m in lore.memories}) == len(lore.memories)
    assert all(m.tags for m in lore.memories)


def test_a_malformed_bible_is_refused(tmp_path):
    path = tmp_path / "lore.json"
    good = {"characters": {"peter": {"name": "P", "sheet": "s"}, "ray": {"name": "R", "sheet": "s"}},
            "memories": [{"id": "a", "tags": ["hill"], "memory": "Once."}]}
    for broken in (
        {**good, "memories": good["memories"] * 2},                                   # duplicate id
        {**good, "memories": [{"id": "a", "tags": [], "memory": "Once."}]},             # no tags
        {**good, "memories": [{"id": "a", "tags": ["hill"], "memory": "x" * 401}]},     # too long
        {**good, "memories": [{"id": "a", "tags": ["hill"], "memory": "see /tmp/x"}]},  # technical
        {**good, "memories": ["Once."]},                                          # not an object
        {**good, "characters": {"peter": good["characters"]["peter"]}},               # ray missing
        ["a bible that is a list"],                                              # not an object
    ):
        path.write_text(json.dumps(broken))
        with pytest.raises(ValueError):
            load(path)


def test_selection_matches_tags_skips_recent_and_ranks_by_overlap():
    lore = Lore(characters={}, memories=(
        Memory("trophy", ("podium", "first-run"), "The tin trophy."),
        Memory("dance", ("podium",), "The dance."),
        Memory("mud", ("hill", "fall"), "The mud."),
        Memory("bell", ("record", "milestone"), "The bell."),
    ))
    facts = [Fact("run#/board", "...", "result", ("podium",)),
             Fact("notable#/first-ever", "...", "notable", ("first-run",))]
    assert [m.id for m in select_memories(lore, facts, used=set())] == ["trophy", "dance"]
    assert [m.id for m in select_memories(lore, facts, used={"trophy"})] == ["dance"]
    assert select_memories(lore, [Fact("x", "...", "result", ("sprint",))], used=set()) == []
    assert [m.id for m in select_memories(lore, facts, used=set(), limit=1)] == ["trophy"]
