"""The grid is a pure function of the pool and the cycle number; the clock
only says which part of it to serve."""

import hashlib
import json
from itertools import pairwise

import numpy as np
from fastapi.testclient import TestClient

from arena.broadcasts import BroadcastBook
from arena.live import HEAD, KEEP_MS, SHUTTER_MS, Entry, Programme, cycle, pool, slots_for
from arena.store import LocalStore, Withdrawal
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record
from tests.test_withdraw import sign_in, spaced  # noqa: F401 — spaced is a fixture


def entry(run_id, at="2026-09-10T10:00:00Z", replay_ms=8000, user="alice"):
    return Entry(run_id, user, "2 m Sprint", at, replay_ms)


def test_the_pool_is_ready_clips_of_open_events_that_are_not_withdrawn(tmp_path):
    store = LocalStore(tmp_path)
    for run_id, event in (("A", "sprint-2m"), ("B", "sprint-2m"), ("C", "sprint-2m"),
                          ("D", "highest-jump"), ("E", "sprint-2m")):
        store.append(make_record(run_id=run_id, event_id=event, user=run_id.lower()), b"t")
    clip = lambda seconds: json.dumps({"layouts": {"landscape": {"seconds": seconds}}}).encode()
    # A commentary file sitting in the clip folder is not read by the pool at
    # all any more: whether one is there changes nothing about what plays.
    store.put_clip("A", {"clip.json": clip(8.0),
                         "commentary.json": json.dumps({"plan": {"duration_ms": 20000}}).encode()})
    store.put_clip("B", {"clip.json": clip(13.8)})
    store.put_clip("C", {"clip.json": clip(8.0)})
    store.put_clip("D", {"clip.json": clip(8.0)})
    # A replay that is not a whole number of 40 ms frames cannot be laid on
    # the grid: E stays off the programme, like a run with no clip.
    store.put_clip("E", {"clip.json": clip(8.033)})
    store.withdraw(Withdrawal(run_id="C", event_id="sprint-2m", user="c",
                              withdrawn_at="2026-09-14T12:00:00Z"))
    entries = {e.run_id: e for e in pool(store)}
    assert set(entries) == {"A", "B"}
    assert entries["A"] == Entry("A", "a", "2 m Sprint", "2026-09-03T10:00:00Z", 8000)
    assert entries["B"].replay_ms == 13800


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


def test_slots_are_shutter_replay_and_a_booth_only_with_a_broadcast_waiting(tmp_path):
    book = BroadcastBook(tmp_path)
    made = book.put("A", {"run_id": "A", "turns": [], "lore_refs": []},
                    {"duration_ms": 20000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    slots = slots_for([entry("A"), entry("B")], 1_000_000, book)
    assert [s["kind"] for s in slots] == ["shutter", "replay", "shutter", "booth", "shutter", "replay"]
    assert slots[0] == {"kind": "shutter", "at_ms": 1_000_000, "duration_ms": SHUTTER_MS,
                        "next": {"run_id": "A", "event": "2 m Sprint", "user": "alice"}}
    assert slots[1] == {"kind": "replay", "at_ms": 1_001_600, "duration_ms": 8000, "run_id": "A"}
    assert slots[2]["next"] is None
    assert slots[3] == {"kind": "booth", "at_ms": 1_011_200, "duration_ms": 20000,
                        "run_id": "A", "broadcast": made.id}
    for a, b in pairwise(slots):
        assert b["at_ms"] == a["at_ms"] + a["duration_ms"]
    assert all(s["duration_ms"] % 40 == 0 for s in slots)


def test_a_run_with_no_broadcast_gets_a_replay_and_no_booth(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    entries = [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)]
    laid = slots_for(entries, 0, book)
    assert [slot["kind"] for slot in laid] == ["shutter", "replay"]


def test_a_run_with_a_broadcast_gets_its_booth_at_the_plan_s_length(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 41400, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    entries = [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)]
    laid = slots_for(entries, 0, book)
    assert [slot["kind"] for slot in laid] == ["shutter", "replay", "shutter", "booth"]
    booth = laid[3]
    assert booth["duration_ms"] == 41400
    assert booth["broadcast"] == made.id
    assert booth["run_id"] == "run-a"


def test_one_broadcast_is_laid_once_even_when_the_run_comes_round_twice(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
             {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
             "2026-09-18T09:00:00Z")
    entry = Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)
    laid = slots_for([entry, entry], 0, book)
    assert [slot["kind"] for slot in laid] == [
        "shutter", "replay", "shutter", "booth", "shutter", "replay"]


def test_a_playing_booth_is_never_handed_to_a_second_slot(tmp_path):
    """The bug this guards: a broadcast stays unaired until its slot ends, so a
    rebuild that re-reads the book would lay the playing booth again."""
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, slots_for

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    entries = [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)]
    again = slots_for(entries, 0, book, claimed={made.id})
    assert [slot["kind"] for slot in again] == ["shutter", "replay"]


def test_invalidate_does_not_let_the_playing_booth_be_relaid_in_the_future(tmp_path):
    """The test above proves `slots_for` honours a claimed set; this proves
    `_extend` actually passes one through. Without `self._claimed()` in that
    call, `invalidate()` would re-offer to a future slot the booth a screen
    is playing right now — a broadcast stays unaired until its slot ends."""
    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    at = [1_000_000]
    programme = Programme(lambda: [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)],
                          lambda: at[0], book)
    first = programme.slots()
    booth = next(s for s in first if s["kind"] == "booth")
    at[0] = booth["at_ms"] + booth["duration_ms"] // 2  # now sits inside the playing booth
    programme.invalidate()
    after = programme.slots()
    booths = [s for s in after if s["kind"] == "booth" and s.get("broadcast") == made.id]
    assert len(booths) == 1


class Clock:
    def __init__(self, ms):
        self.ms = ms

    def __call__(self):
        return self.ms


def test_the_programme_extends_to_the_horizon_and_serves_a_window_around_now(tmp_path):
    book = BroadcastBook(tmp_path)
    clock = Clock(10_000_000)
    entries = [entry("A"), entry("B")]
    programme = Programme(lambda: entries, clock, book)
    assert programme.origin_ms == 10_000_000
    slots = programme.slots()
    assert slots[0]["at_ms"] == 10_000_000
    assert slots[-1]["at_ms"] + slots[-1]["duration_ms"] >= 10_000_000 + 300_000
    # Neither run has a broadcast waiting, so one cycle of these two is just
    # their shutters and replays: 19.2 s.
    clock.ms += 400_000
    later = programme.slots()
    assert later[0]["at_ms"] >= clock.ms - 60_000 - 21_600
    assert all(s["at_ms"] <= clock.ms + 300_000 for s in later)
    assert later[-1]["at_ms"] + later[-1]["duration_ms"] >= clock.ms + 300_000


def test_invalidate_keeps_the_slot_playing_now_and_rebuilds_the_future(tmp_path):
    book = BroadcastBook(tmp_path)
    clock = Clock(10_000_000)
    entries = [entry("A"), entry("B")]
    programme = Programme(lambda: entries, clock, book)
    before = programme.slots()
    clock.ms += 5_000  # inside the first-laid entry's replay (1 600 + 8 000)
    entries.append(entry("C", at="2026-09-20T10:00:00Z"))
    programme.invalidate()
    after = programme.slots()
    current = next(s for s in before if s["at_ms"] <= clock.ms < s["at_ms"] + s["duration_ms"])
    assert current in after
    following = [s for s in after if s["at_ms"] >= current["at_ms"] + current["duration_ms"]]
    assert following[0]["at_ms"] == current["at_ms"] + current["duration_ms"]
    # The rebuilt future opens on the newest run, C.
    assert following[0]["kind"] == "shutter" and following[0]["next"]["run_id"] == "C"


def test_an_idle_gap_is_not_built_cycle_by_cycle(tmp_path):
    """An hour nobody read through is an hour of slots pruned as they are
    built, the pool read once per cycle, all under the lock."""
    book = BroadcastBook(tmp_path)
    clock = Clock(10_000_000)
    entries = [entry("A"), entry("B")]
    reads = []

    def source():
        reads.append(clock.ms)
        return entries

    programme = Programme(source, clock, book)
    programme.slots()
    read_once = len(reads)
    clock.ms += 3_600_000
    served = programme.slots()
    # Neither run ever has a broadcast waiting, so one cycle of these two is
    # 19.2 s and an hour is ~188 of them; the six minutes of window this read
    # has to serve are about nineteen.
    assert len(reads) - read_once <= 24
    assert len(served) <= 84
    assert served[0]["at_ms"] >= clock.ms - 60_000
    assert served[-1]["at_ms"] + served[-1]["duration_ms"] >= clock.ms + 300_000


def test_an_empty_pool_is_off_air_until_something_lands(tmp_path):
    book = BroadcastBook(tmp_path)
    clock = Clock(10_000_000)
    entries = []
    programme = Programme(lambda: entries, clock, book)
    assert programme.slots() == []
    entries.append(entry("A"))
    assert programme.slots()[0]["at_ms"] == 10_000_000


def test_a_booth_whose_slot_has_passed_is_marked_aired(tmp_path):
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, Programme

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    at = [1_000_000]
    programme = Programme(lambda: [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)],
                          lambda: at[0], book)
    programme.slots()
    assert book.get(made.id).aired_at is None

    at[0] += 60_000
    programme.slots()
    assert book.get(made.id).aired_at is not None


def test_a_booth_is_marked_aired_even_though_its_slot_would_have_been_pruned(tmp_path):
    """KEEP_MS is 120 000. A jump past the booth's end by more than that would
    let `slots()` prune the slot before it is marked, if `_mark_aired` ran
    after the prune instead of before it."""
    from arena.broadcasts import BroadcastBook
    from arena.live import Entry, Programme

    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    at = [1_000_000]
    programme = Programme(lambda: [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)],
                          lambda: at[0], book)
    programme.slots()
    assert book.get(made.id).aired_at is None

    at[0] += KEEP_MS + 60_000  # past the booth's end, and past KEEP_MS beyond that
    programme.slots()
    assert book.get(made.id).aired_at is not None


def test_a_mark_that_cannot_be_written_does_not_take_the_grid_down(tmp_path, monkeypatch):
    """The mark happens inside the read every screen is waiting on, so a full
    or read-only disk there would answer /api/live with a 500 for all of them.
    It costs the mark instead: the broadcast stays unaired and may be laid
    once more, which is a repeat, not an outage."""
    book = BroadcastBook(tmp_path)
    made = book.put("run-a", {"run_id": "run-a", "turns": [], "lore_refs": []},
                    {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
                    "2026-09-18T09:00:00Z")
    at = [1_000_000]
    programme = Programme(lambda: [Entry("run-a", "nicolas", "Sprint", "2026-09-18", 8000)],
                          lambda: at[0], book)
    programme.slots()

    def full_disk(_broadcast):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(book, "_write", full_disk)
    at[0] += 60_000  # past the booth's end: this read is the one that marks it
    assert programme.slots()
    assert book.get(made.id).aired_at is None


def ready(app, run_id, user="alice", seconds=8.0):
    app.state.store.append(make_record(run_id=run_id, user=user), encode(np.zeros((5, 21), "f4")))
    app.state.store.put_clip(run_id, {"clip.json": json.dumps({"layouts": {"landscape": {"seconds": seconds}}}).encode()})


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
    ready(app, "A")
    app.state.broadcasts.put("A", {"run_id": "A", "turns": [], "lore_refs": []},
                             {"duration_ms": 20000, "captions": [], "notes": [], "gestures": []},
                             "2026-09-18T09:00:00Z")
    app.state.programme.invalidate()
    body = api.get("/api/live").json()
    assert [s["kind"] for s in body["slots"][:4]] == ["shutter", "replay", "shutter", "booth"]
    assert body["slots"][0]["at_ms"] <= body["now_ms"]


def test_a_broadcast_is_served_by_its_id(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    api = TestClient(app)
    made = app.state.broadcasts.put(
        "run-a", {"run_id": "run-a", "turns": [{"speaker": "peter", "text": "Well.",
                                                "fact_refs": []}], "lore_refs": []},
        {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []},
        "2026-09-18T09:00:00Z")
    answer = api.get(f"/api/live/broadcast/{made.id}")
    assert answer.status_code == 200
    assert answer.json()["plan"]["duration_ms"] == 4000
    assert answer.json()["dialogue"]["turns"][0]["text"] == "Well."


def test_an_unknown_broadcast_is_a_404(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    api = TestClient(create_app(config))
    assert api.get("/api/live/broadcast/nope").status_code == 404


def test_an_id_the_filesystem_cannot_even_look_up_is_a_404_not_a_500(tmp_path):
    """The book's own lookup can raise for an id no filesystem will accept as
    a filename; the route must still answer the page's contract — gone is
    404, never 500."""
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    api = TestClient(create_app(config))
    assert api.get(f"/api/live/broadcast/{'a' * 300}").status_code == 404


def test_an_app_holds_a_broadcast_book(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    assert isinstance(app.state.broadcasts, BroadcastBook)


def test_the_broadcast_book_lives_where_arena_broadcasts_says(tmp_path, monkeypatch):
    home = tmp_path / "elsewhere"
    monkeypatch.setenv("ARENA_BROADCASTS", str(home))
    config = ArenaConfig.from_env(store_dir=tmp_path / "store", dev_user="coralie")
    app = create_app(config)
    assert app.state.broadcasts.directory == home


def test_an_app_holds_a_reserve(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    assert app.state.commentary is not None


def test_the_reserve_is_closed_when_the_app_stops(tmp_path, monkeypatch):
    """`arena serve` on a developer machine is stopped with a Ctrl-C, and the
    reserve's Chrome and its profile directory would outlive it."""
    import arena.commentary as booth
    from arena import recorder

    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "index.html").write_text("<!doctype html><title>arena</title>")
    (bundle / "plan.html").write_text("<!doctype html><title>plan</title>")
    monkeypatch.setenv("ARENA_COMMENTARY", "1")  # conftest turns the booth off
    monkeypatch.setattr(booth, "hub_token", lambda config: "a token")
    monkeypatch.setattr(recorder, "find_chrome", lambda: "/chrome")
    app = create_app(ArenaConfig.from_env(store_dir=tmp_path / "store", frontend_dir=bundle))
    assert app.state.commentary.available

    class Reserve:
        def __init__(self):
            self.stopped = False

        def start(self):
            pass

        def stop(self):
            self.stopped = True

    # Stood in after the wiring, so no thread and no browser is started here;
    # the hooks read app.state when they run.
    app.state.commentary = Reserve()
    with TestClient(app):
        pass
    assert app.state.commentary.stopped


def test_the_reserve_is_not_available_when_writing_is_off(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_COMMENTARY", "0")
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    assert app.state.booth_off == "ARENA_COMMENTARY=0"
    assert not app.state.commentary.available


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
