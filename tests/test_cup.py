import json
from dataclasses import replace
from datetime import UTC, date, datetime, time

from arena.cup import Cup, Entrant, MatchRecord, closed_cups, cup_times, is_match_id, match_id, parse_match_id
from arena.manifest import CupRules
from arena.match import BoutResult


def entrant(i, rating=None):
    return Entrant(f"p{i}", f"R{i}", f"duck {i}", "classic", float(10 - i if rating is None else rating), "s" * 64,
                   {"kind": "hub", "repo_id": f"p{i}/tug", "filename": "policy.onnx", "revision": "c" * 40, "url": "u"},
                   f"duck {i}")


Z = lambda *a: datetime(*a, tzinfo=UTC)
PARIS = lambda first: CupRules(first, time(18, 0), "Europe/Paris", 2.0, 4)


def test_a_cup_round_trips_through_its_three_files():
    match = MatchRecord("tug-of-war-0001-000", 0, "final", None, 0, 1, (BoutResult(0, 7, "west", "a", "pit", 4.5),), (1, 0), 0, "bouts")
    cup = Cup("tug-of-war", 1, "2026-10-30T15:00:00Z", "2026-10-30T17:00:00Z", "ab" * 16, (entrant(0), entrant(1)),
              ((0, 1),), matches=(match,), order={"starts_at": "2026-10-30T17:00:00Z", "segments": []})
    assert Cup.from_json(cup.draw_json(), cup.matches_json(), json.dumps(cup.order).encode()) == cup
    assert set(json.loads(cup.draw_json())) == {"event_id", "number", "close_at", "premiere_at", "secret", "entrants", "groups", "skipped"}
    assert Cup.from_json(cup.draw_json()) == replace(cup, matches=(), order=None)
    assert entrant(0).view() == {"user": "p0", "policy_name": "duck 0", "name": "duck 0", "livery": "classic", "rating": 10.0, "run_id": "R0"}


def test_a_match_id_names_its_event_cup_and_place():
    assert match_id("tug-of-war", 3, 12) == "tug-of-war-0003-012"
    assert parse_match_id("tug-of-war-0003-012") == ("tug-of-war", 3, 12)
    assert is_match_id("tug-of-war-0003-012") and not is_match_id("01M4Z4YCJ15T56BAXX1RPD")
    assert parse_match_id("01M4Z4YCJ15T56BAXX1RPD") is None and parse_match_id("tug-of-war-3-12") is None


def test_cup_times_follow_paris_across_the_october_change():
    rules = PARIS(date(2026, 10, 23))
    assert cup_times(rules, 1) == (Z(2026, 10, 23, 14), Z(2026, 10, 23, 16))
    assert cup_times(rules, 2) == (Z(2026, 10, 30, 15), Z(2026, 10, 30, 17))


def test_cup_times_in_summer():
    assert cup_times(PARIS(date(2026, 7, 3)), 2) == (Z(2026, 7, 10, 14), Z(2026, 7, 10, 16))


def test_a_cup_closes_at_its_own_instant_across_the_change():
    rules = PARIS(date(2026, 10, 23))
    moments = [(2026, 10, 23, 13, 59, 59), (2026, 10, 23, 14), (2026, 10, 30, 14, 59, 59), (2026, 10, 30, 15)]
    assert [closed_cups(rules, Z(*m)) for m in moments] == [0, 1, 1, 2]
