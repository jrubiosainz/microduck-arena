"""The grid is a pure function of the pool and the cycle number; the clock
only says which part of it to serve."""

import json
from itertools import pairwise

from arena.live import HEAD, SHUTTER_MS, Entry, Programme, cycle, pool, slots_for
from arena.store import LocalStore, Withdrawal
from tests.test_store import make_record


def entry(run_id, at="2026-09-10T10:00:00Z", replay_ms=8000, booth_ms=20000, user="alice"):
    return Entry(run_id, user, "2 m Sprint", at, replay_ms, booth_ms)


def test_the_pool_is_ready_clips_of_open_events_that_are_not_withdrawn(tmp_path):
    store = LocalStore(tmp_path)
    for run_id, event in (("A", "sprint-2m"), ("B", "sprint-2m"), ("C", "sprint-2m"), ("D", "highest-jump")):
        store.append(make_record(run_id=run_id, event_id=event, user=run_id.lower()), b"t")
    clip = lambda seconds: json.dumps({"layouts": {"landscape": {"seconds": seconds}}}).encode()
    store.put_clip("A", {"clip.json": clip(8.0), "commentary.json": json.dumps({"plan": {"duration_ms": 20000}}).encode()})
    store.put_clip("B", {"clip.json": clip(13.8)})
    store.put_clip("C", {"clip.json": clip(8.0)})
    store.put_clip("D", {"clip.json": clip(8.0)})
    store.withdraw(Withdrawal(run_id="C", event_id="sprint-2m", user="c",
                              withdrawn_at="2026-09-14T12:00:00Z"))
    entries = {e.run_id: e for e in pool(store)}
    assert set(entries) == {"A", "B"}
    assert entries["A"] == Entry("A", "a", "2 m Sprint", "2026-09-03T10:00:00Z", 8000, 20000)
    assert entries["B"].booth_ms is None and entries["B"].replay_ms == 13800


def test_a_cycle_opens_on_the_three_newest_and_shuffles_the_rest_by_its_number():
    entries = [entry(f"R{i}", at=f"2026-09-{i + 1:02d}T10:00:00Z") for i in range(8)]
    first = cycle(entries, 0)
    assert [e.run_id for e in first[:HEAD]] == ["R7", "R6", "R5"]
    assert sorted(e.run_id for e in first[HEAD:]) == ["R0", "R1", "R2", "R3", "R4"]
    assert cycle(entries, 0) == first
    # Deterministic, so this either always holds or never does; if seeds 0 and
    # 1 happen to shuffle five items alike, compare cycle 2 instead.
    assert [e.run_id for e in cycle(entries, 1)[HEAD:]] != [e.run_id for e in first[HEAD:]]
    assert cycle(entries[:2], 4) == sorted(entries[:2], key=lambda e: e.submitted_at, reverse=True)


def test_slots_are_shutter_replay_and_a_booth_only_with_a_commentary():
    slots = slots_for([entry("A"), entry("B", booth_ms=None)], 1_000_000)
    assert [s["kind"] for s in slots] == ["shutter", "replay", "shutter", "booth", "shutter", "replay"]
    assert slots[0] == {"kind": "shutter", "at_ms": 1_000_000, "duration_ms": SHUTTER_MS,
                        "next": {"run_id": "A", "event": "2 m Sprint", "user": "alice"}}
    assert slots[1] == {"kind": "replay", "at_ms": 1_001_600, "duration_ms": 8000, "run_id": "A"}
    assert slots[2]["next"] is None
    assert slots[3] == {"kind": "booth", "at_ms": 1_011_200, "duration_ms": 20000, "run_id": "A"}
    for a, b in pairwise(slots):
        assert b["at_ms"] == a["at_ms"] + a["duration_ms"]
    assert all(s["duration_ms"] % 40 == 0 for s in slots)


class Clock:
    def __init__(self, ms):
        self.ms = ms

    def __call__(self):
        return self.ms


def test_the_programme_extends_to_the_horizon_and_serves_a_window_around_now():
    clock = Clock(10_000_000)
    entries = [entry("A"), entry("B", booth_ms=None)]
    programme = Programme(lambda: entries, clock)
    assert programme.origin_ms == 10_000_000
    slots = programme.slots()
    assert slots[0]["at_ms"] == 10_000_000
    assert slots[-1]["at_ms"] + slots[-1]["duration_ms"] >= 10_000_000 + 300_000
    # One cycle of these two is 40.8 s; the window is a minute back, five ahead.
    clock.ms += 400_000
    later = programme.slots()
    assert later[0]["at_ms"] >= clock.ms - 60_000 - 21_600
    assert all(s["at_ms"] <= clock.ms + 300_000 for s in later)
    assert later[-1]["at_ms"] + later[-1]["duration_ms"] >= clock.ms + 300_000


def test_invalidate_keeps_the_slot_playing_now_and_rebuilds_the_future():
    clock = Clock(10_000_000)
    entries = [entry("A"), entry("B", booth_ms=None)]
    programme = Programme(lambda: entries, clock)
    before = programme.slots()
    clock.ms += 5_000  # inside A's replay (1 600 + 8 000)
    entries.append(entry("C", at="2026-09-20T10:00:00Z"))
    programme.invalidate()
    after = programme.slots()
    current = next(s for s in before if s["at_ms"] <= clock.ms < s["at_ms"] + s["duration_ms"])
    assert current in after
    following = [s for s in after if s["at_ms"] >= current["at_ms"] + current["duration_ms"]]
    assert following[0]["at_ms"] == current["at_ms"] + current["duration_ms"]
    # The rebuilt future opens on the newest run, C.
    assert following[0]["kind"] == "shutter" and following[0]["next"]["run_id"] == "C"


def test_an_empty_pool_is_off_air_until_something_lands():
    clock = Clock(10_000_000)
    entries = []
    programme = Programme(lambda: entries, clock)
    assert programme.slots() == []
    entries.append(entry("A"))
    assert programme.slots()[0]["at_ms"] == 10_000_000
