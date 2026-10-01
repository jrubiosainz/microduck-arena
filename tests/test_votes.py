import random
from collections import Counter
from datetime import UTC, datetime

from arena.constants import RUNNER_VERSION
from arena.store import Ballot
from arena.votes import (
    cast_today,
    draw,
    first_day,
    impressions,
    pool,
    standings,
    tally,
    window,
)
from tests.test_ballots import make_ballot
from tests.test_store import make_record

NOW = datetime(2026, 9, 15, 12, 0, 0, tzinfo=UTC)


def test_the_window_starts_a_whole_number_of_days_back():
    assert first_day(NOW, 7) == "2026-09-08"


def test_the_window_keeps_what_is_inside_it_and_drops_what_fell_out():
    inside = make_ballot(cast_at="2026-09-09T00:00:00Z")
    edge = make_ballot(cast_at="2026-09-08T12:00:00Z")
    outside = make_ballot(cast_at="2026-09-08T11:59:59Z")
    assert window([inside, edge, outside], NOW, 7) == [inside, edge]


def test_a_tally_counts_winners_and_impressions_count_everyone_shown():
    ballots = [
        make_ballot(candidates=("a", "b"), choice="a"),
        make_ballot(candidates=("a", "c"), choice="c"),
    ]
    assert tally(ballots) == Counter({"a": 1, "c": 1})
    assert impressions(ballots) == Counter({"a": 2, "b": 1, "c": 1})


def test_the_quota_counts_this_voter_on_this_event_today_only():
    mine = [make_ballot(voter="ann", cast_at="2026-09-15T08:00:00Z") for _ in range(3)]
    yesterday = make_ballot(voter="ann", cast_at="2026-09-14T23:00:00Z")
    elsewhere = make_ballot(voter="ann", event_id="other", cast_at="2026-09-15T09:00:00Z")
    someone = make_ballot(voter="bob", cast_at="2026-09-15T09:00:00Z")
    every = mine + [yesterday, elsewhere, someone]
    assert cast_today(every, "ann", "got-a-talent", NOW) == 3


def test_the_pool_is_one_entry_per_person_their_most_recent():
    old = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z")
    new = make_record(user="ann", submitted_at="2026-09-12T10:00:00Z")
    bob = make_record(user="bob", submitted_at="2026-09-11T10:00:00Z")
    assert pool([old, new, bob], frozenset()) == [bob, new]


def test_the_pool_drops_withdrawn_old_physics_and_ducks_that_never_finished():
    gone = make_record(user="ann")
    stale = make_record(user="bob", runner_version=RUNNER_VERSION - 1)
    fell = make_record(user="cid", seeds_finished=0)
    kept = make_record(user="dee")
    assert pool([gone, stale, fell, kept], frozenset({gone.run_id})) == [kept]


def test_the_pool_breaks_a_submitted_at_tie_by_the_later_run_id():
    earlier = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z", run_id="run-aaa")
    later = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z", run_id="run-zzz")
    assert pool([earlier, later], frozenset()) == [later]
    assert pool([later, earlier], frozenset()) == [later]


def test_you_are_never_handed_your_own_duck():
    mine = make_record(user="ann")
    theirs = make_record(user="bob")
    assert pool([mine, theirs], frozenset(), exclude_user="ann") == [theirs]


def test_a_draw_prefers_the_least_shown_and_refuses_a_field_that_is_too_small():
    seen = [make_record(user=f"seen{i}") for i in range(3)]
    fresh = [make_record(user=f"new{i}") for i in range(2)]
    shown = Counter({r.run_id: 10 for r in seen})
    picked = draw(seen + fresh, shown, 2, 4, random.Random(0))
    assert {r.run_id for r in fresh} <= {r.run_id for r in picked}
    assert len(picked) == 4
    assert draw(seen[:1], shown, 2, 4, random.Random(0)) is None


def test_a_draw_shrinks_to_the_field_rather_than_refusing_it():
    field = [make_record(user="ann"), make_record(user="bob")]
    picked = draw(field, Counter(), 2, 4, random.Random(0))
    assert len(picked) == 2


def test_a_draw_shuffles_lane_order_so_a_duck_is_not_always_the_same_colour():
    # Distinct `shown` values make the sort in step 2 fully determine which
    # two survive truncation, regardless of the first shuffle: whatever order
    # the field arrives in, sorting by a unique key always yields the same
    # sequence. So the surviving pair is fixed — [field[0], field[1]] — and the
    # only thing left that can vary their order is the SECOND shuffle. If that
    # shuffle were dropped, `orders` would collapse to one tuple.
    field = [make_record(user=f"u{i}") for i in range(4)]
    shown = Counter({r.run_id: i for i, r in enumerate(field)})
    orders = {
        tuple(r.run_id for r in draw(field, shown, 2, 2, random.Random(seed)))
        for seed in range(20)
    }
    assert orders == {
        (field[0].run_id, field[1].run_id),
        (field[1].run_id, field[0].run_id),
    }


def test_standings_rank_by_votes_then_by_who_published_first():
    ann = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z")
    bob = make_record(user="bob", submitted_at="2026-09-11T10:00:00Z")
    cid = make_record(user="cid", submitted_at="2026-09-09T10:00:00Z")
    ballots = [
        make_ballot(candidates=(ann.run_id, bob.run_id, cid.run_id), choice=bob.run_id)
        for _ in range(2)
    ]
    rows = standings([ann, bob, cid], ballots)
    assert [(r.rank, r.record.user, r.votes, r.shown) for r in rows] == [
        (1, "bob", 2, 2),
        (2, "cid", 0, 2),
        (3, "ann", 0, 2),
    ]


def test_a_run_is_placed_by_votes_among_the_others_entries():
    from arena.votes import placed

    ann = make_record(user="ann", event_id="got-a-talent", submitted_at="2026-09-03T10:00:00Z")
    bob = make_record(user="bob", event_id="got-a-talent", submitted_at="2026-09-04T10:00:00Z")
    ballot = Ballot(ballot_id="b1", event_id="got-a-talent", voter="cid", cast_at="2026-09-05T10:00:00Z",
                    candidates=(ann.run_id, bob.run_id), choice=bob.run_id)
    rank, on_board, rows = placed([ann, bob], bob.run_id, [ballot], frozenset())
    assert (rank, on_board) == (1, True)
    assert [(row.record.user, row.votes) for row in rows] == [("bob", 1), ("ann", 0)]
