from arena.constants import RUNNER_VERSION
from arena.points import RUNS_PER_DAY, SCHEDULE, counting, receipts
from tests.test_store import make_record


def acts(rs, act):
    return [r for r in rs if r.act == act]


def test_counting_applies_the_boards_filter_and_orders_by_time():
    old = make_record(user="alice", runner_version=RUNNER_VERSION - 1)
    gone = make_record(user="alice", submitted_at="2026-09-03T11:00:00Z")
    late = make_record(user="alice", submitted_at="2026-09-03T12:00:00Z")
    early = make_record(user="alice", submitted_at="2026-09-03T09:00:00Z")
    kept = counting([old, gone, late, early], withdrawn=frozenset({gone.run_id}))
    assert kept == [early, late]


def test_first_publication_on_an_event_pays_once_per_event():
    a1 = make_record(user="alice", event_id="sprint-2m", submitted_at="2026-09-03T09:00:00Z")
    a2 = make_record(user="alice", event_id="sprint-2m", submitted_at="2026-09-03T10:00:00Z")
    a3 = make_record(user="alice", event_id="hill-climb-1m5", submitted_at="2026-09-03T11:00:00Z")
    firsts = acts(receipts([a2, a3, a1], frozenset()), "first_event")
    assert [(r.event_id, r.run_id, r.points) for r in firsts] == [
        ("sprint-2m", a1.run_id, SCHEDULE["first_event"]),
        ("hill-climb-1m5", a3.run_id, SCHEDULE["first_event"]),
    ]


def test_a_run_pays_ten_capped_at_three_per_utc_day_across_events():
    day = [
        make_record(user="alice", event_id="sprint-2m", submitted_at=f"2026-09-03T1{i}:00:00Z")
        for i in range(3)
    ] + [make_record(user="alice", event_id="hill-climb-1m5", submitted_at="2026-09-03T14:00:00Z")]
    tomorrow = make_record(user="alice", submitted_at="2026-09-04T08:00:00Z")
    runs = acts(receipts(day + [tomorrow], frozenset()), "run")
    assert len(runs) == RUNS_PER_DAY + 1
    assert {r.run_id for r in runs} == {d.run_id for d in day[:3]} | {tomorrow.run_id}
    assert all(r.points == SCHEDULE["run"] for r in runs)


def test_beating_your_own_best_pays_once_per_event_on_the_first_improvement():
    worse = make_record(user="alice", score=30.0, submitted_at="2026-09-03T09:00:00Z")
    better = make_record(user="alice", score=25.0, submitted_at="2026-09-03T10:00:00Z")
    same = make_record(user="alice", score=25.0, submitted_at="2026-09-03T11:00:00Z")
    best = make_record(user="alice", score=20.0, submitted_at="2026-09-03T12:00:00Z")
    own = acts(receipts([worse, better, same, best], frozenset()), "own_best")
    assert [(r.run_id, r.points) for r in own] == [(better.run_id, SCHEDULE["own_best"])]


def test_a_single_run_never_pays_own_best():
    only = make_record(user="alice")
    assert acts(receipts([only], frozenset()), "own_best") == []


def test_withdrawn_and_old_runner_runs_pay_nothing():
    gone = make_record(user="alice")
    old = make_record(user="bob", runner_version=RUNNER_VERSION - 1)
    assert receipts([gone, old], frozenset({gone.run_id})) == []


def test_receipts_carry_the_runs_own_timestamp():
    run = make_record(user="alice", submitted_at="2026-09-03T09:30:00Z")
    assert {r.at for r in receipts([run], frozenset())} == {"2026-09-03T09:30:00Z"}
