from arena.constants import RUNNER_VERSION
from arena.points import (
    RUNS_PER_DAY,
    SCHEDULE,
    Card,
    boards_by_user,
    counting,
    receipts,
    standings,
)
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
    assert [(r.event_id, r.source_id, r.points) for r in firsts] == [
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
    assert {r.source_id for r in runs} == {d.run_id for d in day[:3]} | {tomorrow.run_id}
    assert all(r.points == SCHEDULE["run"] for r in runs)


def test_beating_your_own_best_pays_once_per_event_on_the_first_improvement():
    worse = make_record(user="alice", score=30.0, submitted_at="2026-09-03T09:00:00Z")
    better = make_record(user="alice", score=25.0, submitted_at="2026-09-03T10:00:00Z")
    same = make_record(user="alice", score=25.0, submitted_at="2026-09-03T11:00:00Z")
    best = make_record(user="alice", score=20.0, submitted_at="2026-09-03T12:00:00Z")
    own = acts(receipts([worse, better, same, best], frozenset()), "own_best")
    assert [(r.source_id, r.points) for r in own] == [(better.run_id, SCHEDULE["own_best"])]


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


def test_podium_pays_the_top_three_by_user_and_skips_dnf_rows():
    first = make_record(user="ann", score=20.0, submitted_at="2026-09-03T09:00:00Z")
    first_again = make_record(user="ann", score=21.0, policy_name="v2")
    second = make_record(user="bob", score=22.0)
    third = make_record(user="cid", score=23.0)
    fourth = make_record(user="dee", score=24.0)
    dnf = make_record(user="eve", score=50.0, seeds_finished=0)
    podium = acts(receipts([dnf, fourth, third, first_again, second, first], frozenset()), "podium")
    assert [(r.user, r.points, r.source_id) for r in podium] == [
        ("ann", 250, first.run_id),
        ("bob", 150, second.run_id),
        ("cid", 100, third.run_id),
    ]


def test_a_lone_dnf_is_not_a_podium():
    dnf = make_record(user="eve", score=50.0, seeds_finished=0)
    assert acts(receipts([dnf], frozenset()), "podium") == []


def test_podium_is_per_event():
    sprint = make_record(user="ann", event_id="sprint-2m")
    hill = make_record(user="ann", event_id="hill-climb-1m5")
    podium = acts(receipts([sprint, hill], frozenset()), "podium")
    assert sorted(r.event_id for r in podium) == ["hill-climb-1m5", "sprint-2m"]
    assert all(r.points == 250 for r in podium)


def test_boards_by_user_collapse_a_players_policies_to_one_row():
    v1 = make_record(user="ann", policy_name="v1", score=25.0)
    v2 = make_record(user="ann", policy_name="v2", score=20.0)
    bob = make_record(user="bob", score=22.0)
    rows = boards_by_user([v1, v2, bob], frozenset())["sprint-2m"]
    assert [(r.rank, r.record.user, r.record.run_id) for r in rows] == [
        (1, "ann", v2.run_id),
        (2, "bob", bob.run_id),
    ]


def test_standings_sum_receipts_and_rank_by_total():
    ann = make_record(user="ann", score=20.0, submitted_at="2026-09-03T09:00:00Z")
    bob = make_record(user="bob", score=22.0, submitted_at="2026-09-03T10:00:00Z")
    cards = standings(receipts([ann, bob], frozenset()))
    # ann: first_event 100 + run 10 + podium 250; bob: 100 + 10 + 150.
    assert cards == [Card(1, "ann", 360), Card(2, "bob", 260)]


def test_a_tied_total_goes_to_whoever_published_first_then_by_name():
    later = make_record(user="zed", event_id="sprint-2m", submitted_at="2026-09-03T10:00:00Z")
    earlier = make_record(user="amy", event_id="hill-climb-1m5", submitted_at="2026-09-03T09:00:00Z")
    same_time = make_record(user="bea", event_id="roller-sprint-2m",
                            submitted_at="2026-09-03T09:00:00Z")
    cards = standings(receipts([later, earlier, same_time], frozenset()))
    assert [c.user for c in cards] == ["amy", "bea", "zed"]
    assert [c.rank for c in cards] == [1, 2, 3]


def test_standings_of_nothing_is_empty():
    assert standings([]) == []


def test_beating_your_best_on_seeds_alone_pays_own_best():
    flaky = make_record(user="alice", score=20.0, seeds_finished=3,
                        submitted_at="2026-09-03T09:00:00Z")
    steady = make_record(user="alice", score=20.0, seeds_finished=5,
                         submitted_at="2026-09-03T10:00:00Z")
    own = acts(receipts([flaky, steady], frozenset()), "own_best")
    assert [r.source_id for r in own] == [steady.run_id]


def test_withdrawing_the_first_run_moves_first_event_to_the_next():
    first = make_record(user="alice", submitted_at="2026-09-03T09:00:00Z")
    second = make_record(user="alice", submitted_at="2026-09-03T10:00:00Z")
    firsts = acts(receipts([first, second], frozenset({first.run_id})), "first_event")
    assert [r.source_id for r in firsts] == [second.run_id]


def test_a_ballot_pays_its_voter_two_capped_at_the_manifests_per_day():
    from datetime import UTC, datetime

    from arena.manifest import Vote
    from tests.test_ballots import make_ballot

    now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)
    rules = {"swag-contest": Vote(ballot_min=2, ballot_max=4, window_days=7, per_day=2)}
    today = [
        make_ballot(voter="ann", cast_at=f"2026-09-15T0{i}:00:00Z") for i in range(3)
    ]
    yesterday = [make_ballot(voter="ann", cast_at="2026-09-14T09:00:00Z")]

    paid = acts(
        receipts([], frozenset(), ballots=today + yesterday, voted=rules, now=now), "ballot"
    )
    assert [r.points for r in paid] == [SCHEDULE["ballot"]] * 3
    assert {r.user for r in paid} == {"ann"}


def test_a_ballot_on_an_event_that_does_not_take_votes_pays_nothing():
    from datetime import UTC, datetime

    from tests.test_ballots import make_ballot

    now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)
    stray = make_ballot(event_id="sprint-2m", cast_at="2026-09-15T09:00:00Z")
    assert acts(receipts([], frozenset(), ballots=[stray], voted={}, now=now), "ballot") == []


def test_a_voted_events_podium_is_paid_on_votes_not_on_time():
    from datetime import UTC, datetime

    from arena.manifest import Vote
    from tests.test_ballots import make_ballot

    now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)
    rules = {"swag-contest": Vote(ballot_min=2, ballot_max=4, window_days=7, per_day=20)}
    quick = make_record(
        user="ann", event_id="swag-contest", score=10.0, submitted_at="2026-09-14T09:00:00Z"
    )
    slow = make_record(
        user="bob", event_id="swag-contest", score=40.0, submitted_at="2026-09-14T10:00:00Z"
    )
    loved = [
        make_ballot(
            candidates=(quick.run_id, slow.run_id),
            choice=slow.run_id,
            cast_at="2026-09-15T09:00:00Z",
        )
    ]
    rows = boards_by_user([quick, slow], frozenset(), ballots=loved, voted=rules, now=now)
    assert [r.record.user for r in rows["swag-contest"]] == ["bob", "ann"]

    podium = acts(
        receipts([quick, slow], frozenset(), ballots=loved, voted=rules, now=now), "podium"
    )
    assert [(r.user, r.points) for r in podium] == [("bob", 250), ("ann", 150)]
