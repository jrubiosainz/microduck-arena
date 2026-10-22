import random
from collections import Counter
from datetime import UTC, datetime

import pytest

from arena.constants import RUNNER_VERSION
from arena.store import Ballot
from arena.votes import (
    cast_today,
    deal,
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


def in_a_row(field, ballots, rng, dealt=frozenset()):
    """`ballots` fields dealt one after the other to one voter, as the booth asks for them."""
    fields = []
    for _ in range(ballots):
        picked, dealt = deal(field, dealt, 2, 4, rng)
        fields.append({r.run_id for r in picked})
    return fields


def test_a_deal_comes_from_what_is_left_in_the_deck_and_refuses_a_field_that_is_too_small():
    seen = [make_record(user=f"seen{i}") for i in range(3)]
    fresh = [make_record(user=f"new{i}") for i in range(2)]
    dealt = {r.run_id for r in seen}
    picked, _ = deal(seen + fresh, dealt, 2, 4, random.Random(0))
    assert {r.run_id for r in fresh} <= {r.run_id for r in picked}
    assert len(picked) == 4
    assert deal(seen[:1], dealt, 2, 4, random.Random(0)) is None


def test_a_series_of_ballots_walks_a_voter_through_every_entry_before_repeating_one():
    # The Space on 2026-10-22, when the draw sorted on exposure: four entries published that day,
    # shown about 11 times against the others' 80, took all four lanes of every ballot.
    field = [make_record(user=f"u{i}") for i in range(16)]
    assert len(set().union(*in_a_row(field, 4, random.Random(0)))) == 16


def test_an_entry_not_dealt_yet_comes_back_once_not_until_it_catches_up():
    # The owner on the Space on 2026-10-22, when the draw sorted on what each voter had seen: the
    # five entries they had seen 3 times against the others' 13 to 20 filled ballot after ballot.
    often = [make_record(user=f"often{i}") for i in range(12)]
    rarely = [make_record(user=f"rare{i}") for i in range(4)]
    fields = in_a_row(often + rarely, 4, random.Random(0), {r.run_id for r in often})
    assert max(sum(r.run_id in field for field in fields) for r in rarely) <= 2


def test_a_voters_second_round_mixes_who_meets_whom():
    # Seen in the booth on 2026-10-22: entries shown together gained a showing together, so a
    # sort on exposure kept them together, and a voter's fifth ballot was their first again.
    field = [make_record(user=f"u{i}") for i in range(16)]
    fields = in_a_row(field, 8, random.Random(0))
    met = {(a, b) for picked in fields for a in picked for b in picked if a < b}
    # One round is four ballots of six pairs each: a second round that repeats the first adds none.
    assert len(met) > 24


def test_a_round_that_does_not_divide_evenly_opens_the_next_with_its_spare():
    # Fifteen entries in fours: the fourth ballot deals the last three and one of the next round,
    # which is then not dealt again while that round lasts.
    field = [make_record(user=f"u{i}") for i in range(15)]
    fields = in_a_row(field, 7, random.Random(0))
    assert len(set().union(*fields[:4])) == 15
    [spare] = fields[3] & set().union(*fields[:3])
    assert all(spare not in picked for picked in fields[4:7])


def test_a_withdrawn_entry_leaves_the_deck_and_a_new_one_joins_it():
    old = [make_record(user=f"u{i}") for i in range(6)]
    new = make_record(user="new")
    dealt = {r.run_id for r in old[:4]}
    picked, after = deal(old[1:] + [new], dealt, 2, 4, random.Random(0))
    assert {r.run_id for r in picked} >= {old[4].run_id, old[5].run_id, new.run_id}
    assert old[0].run_id not in after


def test_a_deal_shrinks_to_the_field_rather_than_refusing_it():
    field = [make_record(user="ann"), make_record(user="bob")]
    picked, _ = deal(field, set(), 2, 4, random.Random(0))
    assert len(picked) == 2


def test_a_deal_shuffles_lane_order_so_a_duck_is_not_always_the_same_colour():
    # Two of four dealt already leaves exactly two in the deck, so which two survive truncation
    # is fixed — [field[0], field[1]] — and the only thing left that can vary their order is the
    # SECOND shuffle. If that shuffle were dropped, `orders` would collapse to one tuple.
    field = [make_record(user=f"u{i}") for i in range(4)]
    dealt = {field[2].run_id, field[3].run_id}
    orders = {
        tuple(r.run_id for r in deal(field, dealt, 2, 2, random.Random(seed))[0])
        for seed in range(20)
    }
    assert orders == {
        (field[0].run_id, field[1].run_id),
        (field[1].run_id, field[0].run_id),
    }


def four_lane_ballots(entry, shown: int, won: int) -> list:
    """`shown` four-lane ballots naming `entry`, `won` of them won by it and the rest by a filler."""
    return [
        make_ballot(candidates=(entry.run_id, "f1", "f2", "f3"),
                    choice=entry.run_id if i < won else "f1")
        for i in range(shown)
    ]


def test_standings_rank_by_how_often_an_entry_wins_not_by_how_many_votes_it_piled_up():
    judged_less = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z")
    shown_more = make_record(user="bob", submitted_at="2026-09-09T10:00:00Z")
    ballots = four_lane_ballots(judged_less, 20, 10) + four_lane_ballots(shown_more, 80, 12)
    rows = standings([shown_more, judged_less], ballots)
    assert [(r.record.user, r.votes, r.shown) for r in rows] == [("ann", 10, 20), ("bob", 12, 80)]


def test_two_lucky_ballots_do_not_outrank_a_week_of_judging():
    lucky = make_record(user="ann", submitted_at="2026-09-10T10:00:00Z")
    judged = make_record(user="bob", submitted_at="2026-09-11T10:00:00Z")
    ballots = four_lane_ballots(lucky, 2, 2) + four_lane_ballots(judged, 82, 31)
    rows = standings([lucky, judged], ballots)
    assert [r.record.user for r in rows] == ["bob", "ann"]
    # 31 wins in 82 four-lane ballots, plus a head start at the average share of a quarter.
    assert rows[0].rate == pytest.approx((31 + 5) / (82 + 20))


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
