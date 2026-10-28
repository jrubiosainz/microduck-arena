import itertools

from websockets.exceptions import ConnectionClosedError

from arena.broadcasts import BroadcastBook
from arena.commentary.generator import Rejected
from arena.commentary.stock import RETRY_S, CommentaryStock
from arena.live import Entry

PLAN = {"duration_ms": 4000, "captions": [], "notes": [], "gestures": []}


def entries(*run_ids):
    # Descending submitted_at: cycle() plays newest first, so this keeps the
    # cycle order the same as the order the runs are listed in here.
    return [Entry(run_id, "nicolas", "Sprint", f"2026-09-{20 - i:02d}", 8000, "20260918T000000Z")
            for i, run_id in enumerate(run_ids)]


class FakeTab:
    def __init__(self):
        self.prepared = []

    def prepare(self, dialogue):
        self.prepared.append(dialogue)
        return PLAN


def written(run_id):
    return {"run_id": run_id, "turns": [{"speaker": "peter", "text": "Well.", "fact_refs": []}],
            "lore_refs": [], "model": "m", "usage": {},
            "brief": {"facts": [], "direction": {}, "model": "m"}}


def stock(tmp_path, pool_entries, compose, *, keep=20, **kw):
    book = BroadcastBook(tmp_path, keep=keep)
    ticks = itertools.count(0, 60)
    return CommentaryStock(
        book=book, tab=FakeTab(), compose=compose,
        pool=lambda: pool_entries, log=lambda *_: None,
        now=lambda: next(ticks), clock=lambda: "2026-09-18T09:00:00Z", **kw), book


def test_it_wants_the_next_runs_that_have_nothing_waiting(tmp_path):
    worker, book = stock(tmp_path, entries("a", "b", "c"), lambda run_id: written(run_id),
                         depth=2)
    assert worker.wanted() == ["a", "b"]
    book.put("a", {"run_id": "a", "turns": [], "lore_refs": []}, PLAN, "2026-09-18T09:00:00Z")
    assert worker.wanted() == ["b", "c"]


def test_it_wants_nothing_once_every_run_is_stocked(tmp_path):
    worker, book = stock(tmp_path, entries("a"), lambda run_id: written(run_id), depth=8)
    book.put("a", {"run_id": "a", "turns": [], "lore_refs": []}, PLAN, "2026-09-18T09:00:00Z")
    assert worker.wanted() == []
    assert worker.turn() is None


def test_a_turn_writes_a_broadcast_for_the_run_that_needs_one(tmp_path):
    worker, book = stock(tmp_path, entries("a", "b"), lambda run_id: written(run_id))
    assert worker.turn() == "a"
    waiting = book.unaired("a")
    assert waiting is not None
    assert waiting.plan == PLAN
    assert waiting.dialogue["turns"][0]["text"] == "Well."
    assert waiting.dialogue["brief"] == {"facts": [], "direction": {}, "model": "m"}


def test_a_landed_dialogue_is_logged_as_a_refused_one_is(tmp_path):
    said = []
    worker = CommentaryStock(
        book=BroadcastBook(tmp_path), tab=FakeTab(), compose=written,
        pool=lambda: entries("a"), log=said.append, clock=lambda: "2026-09-18T09:00:00Z")
    assert worker.turn() == "a"
    assert said == ["commentary: a written"]


def test_a_refusal_costs_a_turn_and_no_broadcast(tmp_path):
    def refuse(run_id):
        raise Rejected("the dialogue must be 3 to 6 turns")

    worker, book = stock(tmp_path, entries("a", "b"), refuse)
    assert worker.turn() is None
    assert book.unaired("a") is None


def test_a_refusal_lets_the_next_turn_take_the_next_run(tmp_path):
    seen = []

    def refuse_first(run_id):
        seen.append(run_id)
        if len(seen) == 1:
            raise Rejected("no")
        return written(run_id)

    worker, _book = stock(tmp_path, entries("a", "b"), refuse_first)
    worker.turn()
    assert worker.turn() == "b"
    assert seen == ["a", "b"]


def test_the_hourly_cap_stops_the_turns(tmp_path):
    worker, book = stock(tmp_path, entries("a", "b", "c"), lambda run_id: written(run_id),
                         depth=8, per_hour=2)
    assert worker.turn() == "a"
    assert worker.turn() == "b"
    assert worker.turn() is None
    assert book.unaired("c") is None


def test_the_cap_counts_refusals_too(tmp_path):
    def refuse(run_id):
        raise Rejected("no")

    worker, _ = stock(tmp_path, entries("a", "b", "c"), refuse, per_hour=2)
    worker.turn()
    worker.turn()
    assert worker.attempts_left() == 0


def test_a_landed_broadcast_tells_the_programme(tmp_path):
    told = []
    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        book=book, tab=FakeTab(), compose=lambda run_id: written(run_id),
        pool=lambda: entries("a"), log=lambda *_: None, landed=lambda: told.append(True),
        now=lambda: 0.0, clock=lambda: "2026-09-18T09:00:00Z")
    worker.turn()
    assert told == [True]


def test_a_broken_browser_costs_one_turn_and_is_logged(tmp_path):
    said = []

    class DeadTab:
        def prepare(self, dialogue):
            raise RuntimeError("no Chrome found: set $CHROME")

    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        book=book, tab=DeadTab(), compose=lambda run_id: written(run_id),
        pool=lambda: entries("a"), log=lambda line: said.append(line),
        now=lambda: 0.0, clock=lambda: "2026-09-18T09:00:00Z")
    assert worker.turn() is None
    assert any("no Chrome" in line for line in said)


def test_a_dead_socket_costs_one_turn_and_the_reserve_moves_on(tmp_path):
    """PlanTab.prepare re-raises whatever the websocket raised when a dead
    browser cannot be replaced — ConnectionClosedError here — which is
    neither an OSError nor a RuntimeError. It must still cost one turn, be
    logged, and leave the reserve able to take its next one."""
    said = []

    class FlakyTab:
        def prepare(self, dialogue):
            if dialogue["run_id"] == "a":
                raise ConnectionClosedError(None, None)
            return PLAN

    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        book=book, tab=FlakyTab(), compose=lambda run_id: written(run_id),
        pool=lambda: entries("a", "b"), log=lambda line: said.append(line),
        now=lambda: 0.0, clock=lambda: "2026-09-18T09:00:00Z")
    assert worker.turn() is None
    assert any("ConnectionClosedError" in line for line in said)
    assert worker.turn() == "b"


def test_a_plan_the_book_refuses_costs_one_turn_and_is_logged(tmp_path):
    """duration_ms not a whole number of 40 ms frames is the real, checked
    way a plan can be unusable: BroadcastBook.put raises ValueError over it,
    after compose and prepare have both already run. That must still cost
    one turn, log truthfully that nothing was written, and leave the
    reserve able to take its next turn."""
    said = []

    class BadTab:
        def prepare(self, dialogue):
            if dialogue["run_id"] == "a":
                return {**PLAN, "duration_ms": 4010}
            return PLAN

    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        book=book, tab=BadTab(), compose=lambda run_id: written(run_id),
        pool=lambda: entries("a", "b"), log=lambda line: said.append(line),
        now=lambda: 0.0, clock=lambda: "2026-09-18T09:00:00Z")
    assert worker.turn() is None
    assert any("not written" in line for line in said)
    assert book.unaired("a") is None
    assert worker.turn() == "b"


def test_a_refused_run_waits_before_it_is_tried_again(tmp_path):
    """A refusal is the run's own, so the same run tried again at once mostly buys
    the same refusal, out of the hourly cap every other run shares. Measured: one
    run took more than half of a session's refusals that way."""
    seen, clock = [], [0.0]

    def refuse(run_id):
        seen.append(run_id)
        raise Rejected("no")

    worker = CommentaryStock(
        book=BroadcastBook(tmp_path), tab=FakeTab(), compose=refuse,
        pool=lambda: entries("a", "b"), per_hour=10, log=lambda *_: None,
        now=lambda: clock[0], clock=lambda: "2026-09-18T09:00:00Z")
    worker.turn()
    worker.turn()
    assert seen == ["a", "b"]
    # Both wait: the next turn calls nobody and spends none of the hour's attempts.
    assert worker.wanted() == []
    assert worker.turn() is None
    assert seen == ["a", "b"] and worker.attempts_left() == 8
    clock[0] = RETRY_S + 1
    worker.turn()
    assert seen == ["a", "b", "a"]


def test_the_cursor_rebases_when_wanted_shrinks(tmp_path):
    """The walk is sitting past "a" (the tab just failed on it) when "a" is
    stocked from elsewhere and wanted() drops from three entries to two. The
    cursor must rebase against the new length rather than read past the end
    of it."""
    def compose(run_id):
        if run_id == "a":
            raise RuntimeError("no Chrome")
        return written(run_id)

    worker, book = stock(tmp_path, entries("a", "b", "c"), compose)
    assert worker.turn() is None
    book.put("a", {"run_id": "a", "turns": [], "lore_refs": []}, PLAN, "2026-09-18T09:00:00Z")
    assert worker.wanted() == ["b", "c"]
    assert worker.turn() == "c"


def test_it_sweeps_what_has_aged_out(tmp_path):
    worker, book = stock(tmp_path, entries("a"), lambda run_id: written(run_id), keep=1)
    first = book.put("x", {"run_id": "x", "turns": [], "lore_refs": []}, PLAN, "t")
    second = book.put("y", {"run_id": "y", "turns": [], "lore_refs": []}, PLAN, "t")
    book.mark_aired(first.id, "2026-09-18T10:00:00Z")
    book.mark_aired(second.id, "2026-09-18T10:01:00Z")
    worker.turn()
    assert book.get(first.id) is None
    assert book.get(second.id) is not None


def test_a_store_error_costs_a_turn_and_not_the_whole_reserve(tmp_path, monkeypatch):
    """`wanted()` reads the pool, which on the Space is the Hub, and it runs
    before a single dialogue is composed. One error there — a 429, an expired
    token — must cost one turn and be logged, not end the loop for the life of
    the process while the boot line still says the booth is on."""
    monkeypatch.setattr("arena.commentary.stock.IDLE_S", 0)
    said = []
    reads = []

    def pool():
        reads.append(len(reads))
        if not reads[-1]:
            raise OSError("429 Too Many Requests")
        if reads[-1] > 1:
            worker._stop.set()
        return entries("a")

    book = BroadcastBook(tmp_path)
    worker = CommentaryStock(
        book=book, tab=FakeTab(), compose=lambda run_id: written(run_id),
        pool=pool, log=said.append, now=lambda: 0.0,
        clock=lambda: "2026-09-18T09:00:00Z")
    worker._work()
    assert any("OSError" in line for line in said)
    assert book.unaired("a") is not None


def test_the_booth_never_wants_a_cup_match(tmp_path):
    worker, _ = stock(tmp_path, entries("tug-of-war-0001-008", "a"), lambda run_id: written(run_id))
    assert worker.wanted() == ["a"]
