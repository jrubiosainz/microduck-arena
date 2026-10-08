"""The commentators' bible: who they are, the scenes they can play, and what they remember.

Editorial fiction lives here and only here. The owner edits the JSON; this
module checks it at load and draws, for one run, a few of the memories that
could resonate with its facts, leaving out any the recent broadcasts already
used. The prompt never sees the whole bible: a memory offered every time is a
memory told every time.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from .context import Fact, technical_text

LORE_PATH = Path(__file__).with_name("lore.json")
MEMORY_CHARS = 400


@dataclass(frozen=True)
class Memory:
    id: str
    tags: tuple[str, ...]
    memory: str


@dataclass(frozen=True)
class Lore:
    characters: dict[str, dict]
    scenes: tuple[str, ...]
    memories: tuple[Memory, ...]


def load(path: Path = LORE_PATH) -> Lore:
    raw = json.loads(Path(path).read_text())
    # A ValueError, not the TypeError ruff would prefer, here and below: every
    # malformed bible fails one way, so the boot catches the lot in one clause.
    if not isinstance(raw, dict):
        raise ValueError("lore: the bible must be an object")  # noqa: TRY004
    characters = raw.get("characters")
    if not isinstance(characters, dict) or set(characters) != {"peter", "ray"}:
        raise ValueError("lore: characters must be exactly peter and ray")
    for speaker, sheet in characters.items():
        if not isinstance(sheet, dict) or not sheet.get("name") or not sheet.get("sheet"):
            raise ValueError(f"lore: {speaker} needs a name and a sheet")
    scenes = raw.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("lore: the bible needs its scenes")
    for scene in scenes:
        if (not isinstance(scene, str) or not 0 < len(scene) <= MEMORY_CHARS
                or not scene.isprintable() or technical_text(scene)):
            raise ValueError("lore: a scene must be short, printable prose")
    if len(set(scenes)) != len(scenes):
        raise ValueError("lore: scenes must be unique")
    memories = []
    for entry in raw.get("memories", []):
        if not isinstance(entry, dict):
            raise ValueError("lore: every memory must be an object")  # noqa: TRY004 — see above
        ident, tags, memory = entry.get("id"), entry.get("tags"), entry.get("memory")
        if not isinstance(ident, str) or not ident or not isinstance(tags, list) or not tags:
            raise ValueError(f"lore: memory {ident!r} needs an id and tags")
        if (not isinstance(memory, str) or not 0 < len(memory) <= MEMORY_CHARS
                or not memory.isprintable() or technical_text(memory)):
            raise ValueError(f"lore: memory {ident!r} must be short, printable prose")
        memories.append(Memory(ident, tuple(tags), memory))
    if len({m.id for m in memories}) != len(memories):
        raise ValueError("lore: memory ids must be unique")
    return Lore(characters, tuple(scenes), tuple(memories))


def select_memories(lore: Lore, facts: list[Fact], used: set[str], rng,
                    limit: int = 2) -> list[Memory]:
    """A few memories whose tags meet the facts', drawn at random, none the
    recent broadcasts told. Drawn, not ranked: the reserve writes several runs
    ahead of the air, so a ranked pick offered the same two memories to every
    dialogue until one of them aired."""
    wanted = {tag for fact in facts for tag in fact.tags}
    fitting = [memory for memory in lore.memories
               if memory.id not in used and set(memory.tags) & wanted]
    return rng.sample(fitting, min(limit, len(fitting)))
