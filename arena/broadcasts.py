"""The dialogues waiting to go out, and the ones that just did.

A broadcast is one conversation written for one airing. It is not a property of
a run and it is not in the store: it is consumed once, kept for twenty airings
so the writer can read what was said, and then forgotten. The store is a dataset
repository on the Space, where every write is a commit; these are far too many
and live far too briefly to belong there.
"""

import json
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from .store import new_id


def utcnow() -> str:
    """The stamp a broadcast is written and aired with."""
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class Broadcast:
    id: str
    run_id: str
    dialogue: dict
    plan: dict
    written_at: str
    aired_at: str | None

    def body(self) -> dict:
        return {"id": self.id, "run_id": self.run_id, "dialogue": self.dialogue,
                "plan": self.plan, "written_at": self.written_at, "aired_at": self.aired_at}


class BroadcastBook:
    """One directory of broadcasts, read fresh every time.

    Reading from disk rather than from memory is what lets a book be built
    wherever it is needed — the worker's thread, the programme's rebuild, a
    route — without any of them owning the others' state.
    """

    def __init__(self, directory: Path, keep: int = 20):
        self.directory = Path(directory)
        self.keep = keep
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, broadcast_id: str) -> Path:
        return self.directory / f"{broadcast_id}.json"

    def _all(self) -> list[Broadcast]:
        found = []
        for path in self.directory.glob("*.json"):
            try:
                body = json.loads(path.read_text())
                found.append(Broadcast(**body))
            except (OSError, ValueError, TypeError):
                # A half-written file from a killed process, or something a hand
                # dropped in: the channel reads around it rather than stopping.
                continue
        found.sort(key=lambda one: one.id)
        return found

    def _write(self, broadcast: Broadcast) -> None:
        self._path(broadcast.id).write_text(
            json.dumps(broadcast.body(), indent=2, ensure_ascii=False))

    def put(self, run_id: str, dialogue: dict, plan: dict, written_at: str) -> Broadcast:
        if plan["duration_ms"] % 40:
            raise ValueError("a plan's duration must be a whole number of 40 ms frames")
        made = Broadcast(new_id(), run_id, dialogue, plan, written_at, None)
        self._write(made)
        return made

    def get(self, broadcast_id: str) -> Broadcast | None:
        try:
            return Broadcast(**json.loads(self._path(broadcast_id).read_text()))
        except (OSError, ValueError, TypeError):
            # No such file, an id too long for the filesystem to even look up,
            # or a half-written body: to whoever asked, all of these are just
            # "no such broadcast".
            return None

    def unaired(self, run_id: str) -> Broadcast | None:
        for one in self._all():
            if one.run_id == run_id and one.aired_at is None:
                return one
        return None

    def runs_stocked(self) -> set[str]:
        return {one.run_id for one in self._all() if one.aired_at is None}

    def mark_aired(self, broadcast_id: str, aired_at: str) -> None:
        one = self.get(broadcast_id)
        if one is None or one.aired_at is not None:
            return
        self._write(replace(one, aired_at=aired_at))

    def recent_aired(self, limit: int = 5) -> list[Broadcast]:
        """Newest last: the writer reads them in the order they went out."""
        aired = [one for one in self._all() if one.aired_at is not None]
        aired.sort(key=lambda one: one.aired_at)
        return aired[-limit:]

    def sweep(self) -> int:
        aired = [one for one in self._all() if one.aired_at is not None]
        aired.sort(key=lambda one: one.aired_at)
        gone = 0
        for one in aired[:-self.keep] if self.keep else aired:
            self._path(one.id).unlink(missing_ok=True)
            gone += 1
        return gone
