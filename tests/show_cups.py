"""A cup played without physics, for the show's tests: the higher rating wins unless the match is an upset."""

from arena.cup import (
    GROUP_NAMES,
    Cup,
    Entrant,
    MatchRecord,
    cup_times,
    first_knockout,
    group_fixtures,
    group_table,
    iso,
    match_id,
    round_name,
)
from arena.match import BoutResult
from tests.test_cupworker import TUG as MANIFEST


def played_cup(entrants=6, number=1, groups=((0, 2, 4), (1, 3, 5)), upsets=frozenset()) -> Cup:
    ducks = tuple(Entrant(f"p{k}", f"R{k}", f"puller {k}", "classic", 50.0 - 5.0 * k, "0" * 64, {}, f"puller {k}")
                  for k in range(entrants))
    matches: list[MatchRecord] = []

    def play(round_, group, a, b):
        index = len(matches)
        a_wins = (ducks[a].rating > ducks[b].rating) != (index in upsets)
        side = "a" if a_wins else "b"
        other = "b" if a_wins else "a"
        pattern = (side, side) if index % 2 == 0 else (side, other, side)
        bouts = tuple(BoutResult(k, k, ("west", "east")[k % 2], winner, "pit", 6.5) for k, winner in enumerate(pattern))
        wins = (2, len(pattern) - 2) if a_wins else (len(pattern) - 2, 2)
        matches.append(MatchRecord(match_id("tug-of-war", number, index), index, round_, group, a, b, bouts, wins,
                                   a if a_wins else b, "bouts"))

    fixtures = [group_fixtures(group) for group in groups]
    rounds = max(len(f) // (len(g) // 2) for f, g in zip(fixtures, groups))
    for r in range(rounds):
        for name, group, pairs in zip(GROUP_NAMES, groups, fixtures):
            half = len(group) // 2
            for a, b in pairs[r * half:(r + 1) * half]:
                play("group", name, a, b)
    tables = [group_table(group, [m for m in matches if m.group == name], [d.rating for d in ducks])
              for name, group in zip(GROUP_NAMES, groups)]
    pairs = first_knockout(tables)
    while True:
        first = len(matches)
        for a, b in pairs:
            play(round_name(len(pairs)), None, a, b)
        if len(pairs) == 1:
            break
        winners = [m.winner for m in matches[first:]]
        pairs = list(zip(winners[0::2], winners[1::2]))
    close, premiere = cup_times(MANIFEST.cup, number)
    return Cup("tug-of-war", number, iso(close), iso(premiere), "0" * 32, ducks,
               tuple(tuple(group) for group in groups), matches=tuple(matches))
