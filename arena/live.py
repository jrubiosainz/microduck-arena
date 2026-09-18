"""The channel's programme: an infinite grid every screen reads its place in.

Nothing is broadcast. The grid is a list of slots at absolute wall-clock
milliseconds, built cycle after cycle from the ready clips; a screen reads the
server's clock once, finds the slot that contains now, and plays it from the
right offset. Two screens agree because they read the same grid and the same
clock, not because a stream was pushed at them.
"""

import random
import threading
from dataclasses import dataclass

from .broadcasts import BroadcastBook, utcnow
from .manifest import all_events

SHUTTER_MS = 1600
HORIZON_MS = 5 * 60_000  # how far ahead the grid is built and served
BEHIND_MS = 60_000  # how far back it is served, so a late poll still finds now
KEEP_MS = 120_000  # slots older than this are forgotten
HEAD = 3  # the newest runs open every cycle


@dataclass(frozen=True)
class Entry:
    run_id: str
    user: str
    event_title: str
    submitted_at: str
    replay_ms: int


def pool(store) -> list[Entry]:
    """Every run of an open event with a ready clip, not withdrawn."""
    withdrawn = {w.run_id for w in store.withdrawals()}
    entries = []
    for manifest in all_events():
        if manifest.status != "open":
            continue
        for record in store.runs(manifest.id):
            if record.run_id in withdrawn:
                continue
            state, clip = store.clip_state(record.run_id)
            if state != "ready":
                continue
            replay_ms = round(clip["layouts"]["landscape"]["seconds"] * 1000)
            # A length that is not a whole number of frames cannot be laid on
            # the grid; such a run stays off the programme rather than
            # breaking the channel for everyone.
            if replay_ms % 40:
                continue
            entries.append(Entry(record.run_id, record.user, manifest.title,
                                 record.submitted_at, replay_ms))
    return entries


def cycle(entries: list[Entry], k: int) -> list[Entry]:
    """One pass over the pool: the newest runs first, the rest shuffled by the
    cycle number, so every screen computes the same order."""
    newest = sorted(entries, key=lambda e: (e.submitted_at, e.run_id), reverse=True)
    head, rest = newest[:HEAD], newest[HEAD:]
    random.Random(k).shuffle(rest)
    return head + rest


def slots_for(entries: list[Entry], start_ms: int, book: BroadcastBook,
              claimed: set[str] | None = None) -> list[dict]:
    slots: list[dict] = []
    at = start_ms
    # One waiting dialogue is one booth. `claimed` carries the broadcasts the
    # slots already laid are using, so a rebuild cannot hand a screen's playing
    # booth to a second slot in the future: a broadcast is unaired right up to
    # the moment its slot ends.
    claimed = set() if claimed is None else set(claimed)

    def add(slot: dict) -> None:
        nonlocal at
        if slot["duration_ms"] % 40:
            raise ValueError(f"{slot['kind']} for {slot.get('run_id')} is not a whole number of frames")
        slots.append({**slot, "at_ms": at})
        at += slot["duration_ms"]

    for entry in entries:
        add({"kind": "shutter", "duration_ms": SHUTTER_MS,
             "next": {"run_id": entry.run_id, "event": entry.event_title, "user": entry.user}})
        add({"kind": "replay", "duration_ms": entry.replay_ms, "run_id": entry.run_id})
        waiting = book.unaired(entry.run_id)
        if waiting is not None and waiting.id not in claimed:
            claimed.add(waiting.id)
            add({"kind": "shutter", "duration_ms": SHUTTER_MS, "next": None})
            add({"kind": "booth", "duration_ms": waiting.plan["duration_ms"],
                 "run_id": entry.run_id, "broadcast": waiting.id})
    return slots


class Programme:
    """The grid, built lazily as far as the horizon, rebuilt from the slot
    playing now whenever the pool changes."""

    def __init__(self, source, now_ms, book):
        self._source = source
        self._now = now_ms
        self._book = book
        self._lock = threading.Lock()
        self.origin_ms = now_ms()
        self._slots: list[dict] = []
        self._cursor = self.origin_ms  # where the next cycle starts
        self._cycle = 0

    def _claimed(self) -> set[str]:
        return {slot["broadcast"] for slot in self._slots if slot["kind"] == "booth"}

    def _extend(self, until_ms: int) -> None:
        # A process nobody read from for days leaves the cursor far behind, and
        # every cycle built from there is pruned the moment it is built: start
        # at the edge of the window that is actually served.
        self._cursor = max(self._cursor, until_ms - HORIZON_MS - BEHIND_MS)
        while self._cursor < until_ms:
            entries = cycle(self._source(), self._cycle)
            if not entries:
                return
            self._slots.extend(slots_for(entries, self._cursor, self._book, self._claimed()))
            self._cursor = self._slots[-1]["at_ms"] + self._slots[-1]["duration_ms"]
            self._cycle += 1

    def _mark_aired(self, now: int) -> None:
        """A booth whose slot has ended has been heard, wherever a screen was.
        The server knows the grid and the clock; no screen reports anything."""
        for slot in self._slots:
            if slot["kind"] != "booth" or slot["at_ms"] + slot["duration_ms"] > now:
                continue
            self._book.mark_aired(slot["broadcast"], utcnow())

    def slots(self) -> list[dict]:
        now = self._now()
        with self._lock:
            self._extend(now + HORIZON_MS)
            # Before the prune below: a booth whose slot has ended is dropped
            # from `self._slots` after KEEP_MS, and marking after that would
            # lose it — the broadcast would stay unaired for ever and be laid
            # again.
            self._mark_aired(now)
            self._slots = [s for s in self._slots if s["at_ms"] + s["duration_ms"] > now - KEEP_MS]
            return [s for s in self._slots
                    if s["at_ms"] + s["duration_ms"] > now - BEHIND_MS and s["at_ms"] <= now + HORIZON_MS]

    def invalidate(self) -> None:
        """Keep what is playing, forget the future; the next read rebuilds it
        from a fresh pool. A restart is the same thing with nothing kept."""
        now = self._now()
        with self._lock:
            kept = [s for s in self._slots if s["at_ms"] <= now]
            self._slots = kept
            self._cursor = (kept[-1]["at_ms"] + kept[-1]["duration_ms"]) if kept else now
