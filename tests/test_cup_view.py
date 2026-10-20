import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from arena.cup import airs_at, cup_view, ends_at, revealed_at
from arena.cupworker import running_order
from tests.test_cupworker import drawn_cup, played_cup

# With 10 s clips each match takes 11.6 s of the show (its shutter, then its clip): AIRS(i) is when match i starts
# airing, REVEAL(i), 10 s later, when its clip has finished.
START, START_ISO = datetime(2026, 10, 30, 17, tzinfo=UTC), "2026-10-30T17:00:00Z"
AIRS = lambda i: START + timedelta(milliseconds=1600 + 11600 * i)
REVEAL = lambda i: START + timedelta(milliseconds=11600 * (i + 1))


def test_the_running_order_is_each_match_after_its_shutter():
    cup = played_cup(4)
    order = running_order(cup, {m.match_id: 41.24 for m in cup.matches}, START)
    assert order["starts_at"] == START_ISO and len(order["segments"]) == 14
    assert order["segments"][:2] == [
        {"kind": "shutter", "at_ms": 0, "duration_ms": 1600, "next": {"match_id": "tug-of-war-0001-000", "title": "Group A"}},
        {"kind": "match", "at_ms": 1600, "duration_ms": 41240, "match_id": "tug-of-war-0001-000"}]
    timed = replace(cup, order=order)
    assert airs_at(timed, "tug-of-war-0001-006") == START + timedelta(milliseconds=6 * 42840 + 1600)
    assert revealed_at(timed, "tug-of-war-0001-006") == START + timedelta(milliseconds=7 * 42840) == ends_at(timed)
    assert revealed_at(cup, "tug-of-war-0001-006") is None and airs_at(cup, "tug-of-war-0001-006") is None
    assert revealed_at(timed, "nope") is None and airs_at(timed, "nope") is None


def test_the_running_order_names_no_duck():
    """/api/live serves five minutes ahead: a shutter naming a knockout's ducks would tell who qualified."""
    cup = played_cup(6)
    order = running_order(cup, {m.match_id: 10.0 for m in cup.matches}, START)
    assert [s["next"]["title"] for s in order["segments"] if s["kind"] == "shutter"] == \
        ["Group A", "Group B"] * 3 + ["Semi-final 1", "Semi-final 2", "Final"]
    text = json.dumps(order)
    assert not any(e.user in text or e.policy_name in text for e in cup.entrants)


def test_before_the_start_only_the_field_is_public():
    cup = played_cup(4, starts_at=START_ISO)
    for now in (datetime(2026, 10, 30, 14, 59, tzinfo=UTC), datetime(2026, 10, 30, 15, 30, tzinfo=UTC), START - timedelta(seconds=1)):
        view = cup_view(cup, now)
        assert set(view) == {"event_id", "number", "state", "close_at", "premiere_at", "starts_at", "entrants"}
        assert cup.secret not in json.dumps(view) and "tug-of-war-0001-" not in json.dumps(view)
    assert [e["user"] for e in view["entrants"]] == ["p0", "p1", "p2", "p3"]
    assert [cup_view(cup, t)["state"] for t in (datetime(2026, 10, 30, 14, 59, tzinfo=UTC), START - timedelta(seconds=1))] == ["open", "ready"]
    assert cup_view(replace(cup, order=None), START)["state"] == "drawn"


def test_a_match_is_public_from_its_reveal():
    """Not while its clip airs: from the moment the clip has finished."""
    cup = played_cup(4, starts_at=START_ISO)
    assert "winner" not in cup_view(cup, AIRS(0))["matches"][0]
    early = cup_view(cup, REVEAL(0) - timedelta(milliseconds=1))
    assert "winner" not in early["matches"][0] and early["groups"][0]["table"][0]["played"] == 0
    view = cup_view(cup, REVEAL(0))
    assert view["state"] == "airing" and view["groups"][0]["name"] == "A"
    first, second = view["matches"][:2]
    assert (first["winner"], first["wins"], len(first["bouts"])) == (0, [2, 0], 2)
    assert "winner" not in second and "bouts" not in second and second["a"] == 1
    table = {row["entrant"]: row for row in view["groups"][0]["table"]}
    assert (table[0]["played"], table[0]["won"], table[0]["bouts_for"], table[1]["played"]) == (1, 1, 2, 0)


def test_the_champion_and_the_secret_wait_for_the_final():
    cup = played_cup(4, starts_at=START_ISO)
    before = cup_view(cup, REVEAL(6) - timedelta(milliseconds=1))
    assert before["champion"] is None and "secret" not in before and cup.secret not in json.dumps(before)
    assert before["matches"][6]["a"] == 0
    after = cup_view(cup, REVEAL(6))
    assert (after["champion"], after["secret"]) == (0, cup.secret)
    assert [row["played"] for row in after["groups"][0]["table"]] == [3, 3, 3, 3]   # the final of two group-mates is not the group's
    assert cup_view(cup, ends_at(cup))["state"] == "aired"


def test_a_knockout_pair_waits_for_the_round_before_it():
    cup = played_cup(6, starts_at=START_ISO)   # 6 group matches, semis 6 and 7, final 8
    early = cup_view(cup, REVEAL(5) - timedelta(milliseconds=1))["matches"][6:]
    assert [(m["a"], m["b"], m["title"]) for m in early] == [(None, None, "Semi-final 1"), (None, None, "Semi-final 2"), (None, None, "Final")]
    assert [m["a"] is not None for m in cup_view(cup, REVEAL(5))["matches"][6:]] == [True, True, False]
    assert cup_view(cup, REVEAL(7) - timedelta(milliseconds=1))["matches"][8]["a"] is None
    assert cup_view(cup, REVEAL(7))["matches"][8]["a"] is not None


def test_only_the_next_reveal_is_timed():
    """A tug clip grows with each bout: the whole timetable would tell at the start how every match went."""
    cup = played_cup(4, starts_at=START_ISO)
    assert [m["reveal_at"] for m in cup_view(cup, START)["matches"]] == ["2026-10-30T17:00:12Z"] + [None] * 6
    # 11.6 s, 23.2 s and 34.8 s, rounded up to the second
    assert [m["reveal_at"] for m in cup_view(cup, REVEAL(1))["matches"]] == \
        ["2026-10-30T17:00:12Z", "2026-10-30T17:00:24Z", "2026-10-30T17:00:35Z", None, None, None, None]


def test_a_skipped_cup_says_so():
    assert cup_view(replace(drawn_cup(3), groups=(), skipped=True), START)["state"] == "skipped"
