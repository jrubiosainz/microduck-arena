"""The commentators' bible: who they are, and what they remember.

Editorial fiction lives here and only here. The owner edits the JSON; this
module checks it at load and picks, for one run, the few memories that could
resonate with its facts, leaving out any the recent broadcasts already used.
The prompt never sees the whole bible: a memory offered every time is a memory
told every time.
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
    return Lore(characters, tuple(memories))


def select_memories(lore: Lore, facts: list[Fact], used: set[str], limit: int = 2) -> list[Memory]:
    """The memories whose tags meet the facts', most overlap first, none the
    recent broadcasts told."""
    wanted = {tag for fact in facts for tag in fact.tags}
    scored = [
        (len(set(memory.tags) & wanted), memory)
        for memory in lore.memories
        if memory.id not in used and set(memory.tags) & wanted
    ]
    scored.sort(key=lambda pair: (-pair[0], pair[1].id))
    return [memory for _, memory in scored[:limit]]
