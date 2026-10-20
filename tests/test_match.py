import dataclasses
import numpy as np, pytest
from arena.manifest import BoutRules, load_event
from arena.match import BoutResult, bout_seed, play_match
from arena.tug import BoutOutcome
from tests.test_tug import _ZeroPolicy

TUG, SEEDS = load_event("tug-of-war"), (11, 12, 13, 14, 15)

def scripted(monkeypatch, winners):
    """Bout k is won by winners[k] ("a", "b" or None); records who stood west and east."""
    stood = []
    def bout(manifest, west, east, seed, model=None):
        k = len(stood); stood.append((west, east, seed))
        loser = None if winners[k] is None else (1 if (winners[k] == "a") == (west == "A") else 0)
        return BoutOutcome(seed, loser, "draw" if loser is None else "pit", 3.0,
                           np.full((2, 5, 21), k, np.float32), np.zeros((2, 26, 21), np.float32))
    monkeypatch.setattr("arena.match.run_bout", bout)
    return stood

def test_a_bout_seed_is_the_secrets_hash():
    secret = "0123456789abcdef0123456789abcdef"
    assert [bout_seed(secret, "tug-of-war-0001-000", k) for k in (0, 1)] == [4017010484, 4022833236]

def test_first_to_two_sides_swapped_after_each_bout(monkeypatch):
    stood = scripted(monkeypatch, ["a", "b", "a"])
    out = play_match(TUG, "A", "B", SEEDS, (3.0, 4.0), model=object())
    assert stood == [("A", "B", 11), ("B", "A", 12), ("A", "B", 13)]
    assert [(b.k, b.a_side, b.winner) for b in out.bouts] == [(0, "west", "a"), (1, "east", "b"), (2, "west", "a")]
    assert (out.wins, out.winner, out.decided_by, len(out.traces)) == ((2, 1), "a", "bouts", 3)

def test_five_draws_go_to_the_higher_rating_then_to_a(monkeypatch):
    scripted(monkeypatch, [None] * 5)
    out = play_match(TUG, "A", "B", SEEDS, (3.0, 4.0), model=object())
    assert (len(out.bouts), out.wins, out.winner, out.decided_by) == (5, (0, 0), "b", "rating")
    scripted(monkeypatch, [None] * 5)
    assert play_match(TUG, "A", "B", SEEDS, (4.0, 4.0), model=object()).winner == "a"

def test_after_the_last_bout_more_wins_decide(monkeypatch):
    scripted(monkeypatch, ["b", None, None, None, None])
    out = play_match(TUG, "A", "B", SEEDS, (9.0, 1.0), model=object())
    assert (out.wins, out.winner, out.decided_by) == ((0, 1), "b", "bouts")

def test_a_match_takes_one_seed_per_possible_bout_and_a_bout_round_trips():
    with pytest.raises(ValueError, match="max_bouts"):
        play_match(TUG, _ZeroPolicy(), _ZeroPolicy(), SEEDS[:3], (1.0, 1.0))
    result = BoutResult(1, 12, "east", None, "draw", 20.0)
    assert result.to_dict() == {"k": 1, "seed": 12, "a_side": "east", "winner": None, "how": "draw", "time_s": 20.0}
    assert BoutResult.from_dict(result.to_dict()) == result

def test_a_real_match_plays_the_same_twice():
    quick = dataclasses.replace(TUG, bout=BoutRules(1.0, 2, 5))
    one, two = (play_match(quick, _ZeroPolicy(), _ZeroPolicy(), SEEDS, (1.0, 2.0)) for _ in range(2))
    assert one.bouts == two.bouts and 2 <= len(one.bouts) <= 5
    assert one.traces[0][0].shape[0] == 2 and one.traces[0][0].shape[1] <= 50   # a duck may fall before the 1 s limit
    np.testing.assert_array_equal(one.traces[-1][0], two.traces[-1][0])
