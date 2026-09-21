"""The dialogues waiting to go out, and the ones that just did.

A broadcast is one conversation written for one airing. It is not a property of
a run and it is not in the store: it is consumed once, kept for twenty airings,
and then forgotten. It is kept so that the memories' cooldown, a callback's one
fact and the direction it drew can be read from what went out, and so that a
repetition can be looked into after the fact. The store is a dataset
repository on the Space, where every write is a commit; these are far too many
and live far too briefly to belong there.
"""

import json
import os
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .store import new_id

# How old an unaired broadcast may be before the book throws it away instead of
# ever playing it. A dialogue is written minutes ahead of its slot and a whole
# cycle — twenty clips — is about a quarter of an hour, so an hour is already
# several cycles late: what such a dialogue says about the standings and the
# records was true of a board that has since moved. `keep` bounds the aired
# ones; this bounds the rest, which nothing else ever would — a run that leaves
# the pool, withdrawn or with its event closed, is never laid and never airs.
# It is also what makes a restart cost one refill rather than putting
# yesterday's dialogues on air out of the same directory.
STALE_S = 3600


def stamp(at: datetime) -> str:
    """How a broadcast's moments are written: UTC, to the second, and ordered
    by plain text comparison, which is how the book compares them."""
    return at.isoformat(timespec="seconds").replace("+00:00", "Z")


def utcnow() -> str:
    """The stamp a broadcast is written and aired with."""
    return stamp(datetime.now(UTC))


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

    def _read(self, path: Path) -> Broadcast | None:
        """The broadcast at `path`, when it is one the grid could actually lay.

        A booth's slot is as long as its plan says, so a plan that is not a
        whole number of 40 ms frames — or not a number, or not there at all —
        is no more usable than a half-written file from a killed process or
        something a hand dropped in the directory. All of them are read around
        rather than handed out, because the alternative is the channel
        stopping for every screen over one bad file.
        """
        try:
            one = Broadcast(**json.loads(path.read_text()))
            if one.plan["duration_ms"] % 40:
                return None
        except (OSError, ValueError, TypeError, KeyError):
            return None
        return one

    def _all(self) -> list[Broadcast]:
        found = [one for one in map(self._read, self.directory.glob("*.json")) if one is not None]
        found.sort(key=lambda one: one.id)
        return found

    def _write(self, broadcast: Broadcast) -> None:
        # Written beside the file it becomes and then renamed over it, which is
        # one atomic step: a process killed mid-write leaves no truncated
        # broadcast, which every reader would skip and the sweep would never
        # delete, and no reader ever sees half a body.
        path = self._path(broadcast.id)
        writing = path.with_suffix(".writing")
        writing.write_text(json.dumps(broadcast.body(), indent=2, ensure_ascii=False))
        os.replace(writing, path)

    def put(self, run_id: str, dialogue: dict, plan: dict, written_at: str) -> Broadcast:
        if plan["duration_ms"] % 40:
            raise ValueError("a plan's duration must be a whole number of 40 ms frames")
        made = Broadcast(new_id(), run_id, dialogue, plan, written_at, None)
        self._write(made)
        return made

    def get(self, broadcast_id: str) -> Broadcast | None:
        # No such file, an id too long for the filesystem to even look up, a
        # half-written body, a plan no slot can be cut to: to whoever asked,
        # all of these are just "no such broadcast".
        return self._read(self._path(broadcast_id))

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
        try:
            self._write(replace(one, aired_at=aired_at))
        except OSError:
            # A full or read-only disk costs the mark, not the channel: this is
            # called while the grid is being read, and every screen asking for
            # the programme would otherwise be answered with a 500. The
            # broadcast stays unaired, so the worst of it is that it may be
            # laid again — and the sweep still throws it away in the end.
            return

    def recent_aired(self, limit: int = 5) -> list[Broadcast]:
        """Newest last, the order they went out."""
        aired = [one for one in self._all() if one.aired_at is not None]
        aired.sort(key=lambda one: one.aired_at)
        return aired[-limit:]

    def sweep(self, now: str) -> int:
        """What the book owes nobody any more: the aired ones behind `keep`, and
        the unaired ones too old to be worth hearing. `now` is the caller's, the
        way a broadcast's other moments are."""
        found = self._all()
        aired = [one for one in found if one.aired_at is not None]
        aired.sort(key=lambda one: one.aired_at)
        stale = stamp(datetime.fromisoformat(now) - timedelta(seconds=STALE_S))
        forgotten = aired[:-self.keep] if self.keep else aired
        forgotten += [one for one in found
                      if one.aired_at is None and one.written_at < stale]
        for one in forgotten:
            self._path(one.id).unlink(missing_ok=True)
        return len(forgotten)
