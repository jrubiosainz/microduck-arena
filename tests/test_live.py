"""The grid is a pure function of the pool and the cycle number; the clock
only says which part of it to serve."""

import hashlib
import json
from itertools import pairwise

import numpy as np
from fastapi.testclient import TestClient

from arena.live import HEAD, SHUTTER_MS, Entry, Programme, cycle, pool, slots_for
from arena.store import LocalStore, Withdrawal
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record
from tests.test_withdraw import sign_in, spaced  # noqa: F401 — spaced is a fixture


def entry(run_id, at="2026-09-10T10:00:00Z", replay_ms=8000, booth_ms=20000, user="alice"):
    return Entry(run_id, user, "2 m Sprint", at, replay_ms, booth_ms)


def test_the_pool_is_ready_clips_of_open_events_that_are_not_withdrawn(tmp_path):
    store = LocalStore(tmp_path)
    for run_id, event in (("A", "sprint-2m"), ("B", "sprint-2m"), ("C", "sprint-2m"),
                          ("D", "highest-jump"), ("E", "sprint-2m"), ("F", "sprint-2m")):
        store.append(make_record(run_id=run_id, event_id=event, user=run_id.lower()), b"t")
    clip = lambda seconds: json.dumps({"layouts": {"landscape": {"seconds": seconds}}}).encode()
    store.put_clip("A", {"clip.json": clip(8.0), "commentary.json": json.dumps({"plan": {"duration_ms": 20000}}).encode()})
    store.put_clip("B", {"clip.json": clip(13.8)})
    store.put_clip("C", {"clip.json": clip(8.0)})
    store.put_clip("D", {"clip.json": clip(8.0)})
    # Neither a clip nor a plan that is not a whole number of 40 ms frames can
    # be laid on the grid: E and F stay off the programme.
    store.put_clip("E", {"clip.json": clip(8.033)})
    store.put_clip("F", {"clip.json": clip(8.0),
                         "commentary.json": json.dumps({"plan": {"duration_ms": 20010}}).encode()})
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


def test_no_run_plays_twice_over_a_cycle_boundary():
    """The spec's rule for the shuffle: whatever the pool's size, the run that
    closes a cycle is not the run that opens the next."""
    for size in (2, 3, 8):
        entries = [entry(f"R{i}", at=f"2026-09-{i + 1:02d}T10:00:00Z") for i in range(size)]
        for k in range(20):
            assert cycle(entries, k)[-1].run_id != cycle(entries, k + 1)[0].run_id


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


def test_an_idle_gap_is_not_built_cycle_by_cycle():
    """An hour nobody read through is an hour of slots pruned as they are
    built, the pool read once per cycle, all under the lock."""
    clock = Clock(10_000_000)
    entries = [entry("A"), entry("B", booth_ms=None)]
    reads = []

    def source():
        reads.append(clock.ms)
        return entries

    programme = Programme(source, clock)
    programme.slots()
    read_once = len(reads)
    clock.ms += 3_600_000
    served = programme.slots()
    # One cycle of these two is 40.8 s, so an hour is ~90 of them; the six
    # minutes of window this read has to serve are nine.
    assert len(reads) - read_once <= 12
    assert len(served) <= 60
    assert served[0]["at_ms"] >= clock.ms - 60_000
    assert served[-1]["at_ms"] + served[-1]["duration_ms"] >= clock.ms + 300_000


def test_an_empty_pool_is_off_air_until_something_lands():
    clock = Clock(10_000_000)
    entries = []
    programme = Programme(lambda: entries, clock)
    assert programme.slots() == []
    entries.append(entry("A"))
    assert programme.slots()[0]["at_ms"] == 10_000_000


def ready(app, run_id, user="alice", seconds=8.0, booth_ms=None):
    app.state.store.append(make_record(run_id=run_id, user=user), encode(np.zeros((5, 21), "f4")))
    files = {"clip.json": json.dumps({"layouts": {"landscape": {"seconds": seconds}}}).encode()}
    if booth_ms:
        files["commentary.json"] = json.dumps({"plan": {"duration_ms": booth_ms}}).encode()
    app.state.store.put_clip(run_id, files)


def test_the_route_serves_the_clock_the_build_and_the_window(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    api = TestClient(app)
    empty = api.get("/api/live")
    assert empty.status_code == 200
    assert empty.headers["cache-control"] == "no-store"
    body = empty.json()
    assert body["version"] == 1 and body["slots"] == []
    assert isinstance(body["now_ms"], int) and body["build"]
    ready(app, "A", booth_ms=20000)
    app.state.programme.invalidate()
    body = api.get("/api/live").json()
    assert [s["kind"] for s in body["slots"][:4]] == ["shutter", "replay", "shutter", "booth"]
    assert body["slots"][0]["at_ms"] <= body["now_ms"]


def test_the_build_is_the_hash_of_the_index_it_serves(tmp_path):
    """A page that has run for days reloads when this changes, so it must be
    the bundle's own identity and not merely something truthy."""
    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "index.html").write_text("<!doctype html><title>arena</title>")
    api = TestClient(create_app(ArenaConfig.from_env(store_dir=tmp_path, frontend_dir=bundle)))
    served = api.get("/").content
    assert api.get("/api/live").json()["build"] == hashlib.sha256(served).hexdigest()[:12]


def test_a_landed_clip_and_a_withdrawal_rebuild_the_future(spaced):  # noqa: F811
    api, app = spaced
    ready(app, "A")
    app.state.clips.landed("A")
    assert {s.get("run_id") for s in api.get("/api/live").json()["slots"]} >= {"A"}
    ready(app, "B", user="bob")
    app.state.clips.landed("B")
    assert {s.get("run_id") for s in api.get("/api/live").json()["slots"]} >= {"A", "B"}
    sign_in(api, app, "bob")
    assert api.post("/api/runs/B/withdraw").status_code == 200
    slots = api.get("/api/live").json()["slots"]
    future = [s for s in slots if s["at_ms"] > slots[0]["at_ms"] + slots[0]["duration_ms"]]
    assert "B" not in {s.get("run_id") for s in future}
