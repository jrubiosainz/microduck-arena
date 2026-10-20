"""Notable facts: what a commentator would dig out of the log about a run.

Every detector is a pure function of the records and of the run's own
timestamp, so a commentary written a week after the publish says exactly what
one written that minute would. Scores rank the candidates; the writer sees the
top few, one per angle.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise

from ..index import Row, by_user, leaderboard, sort_key
from ..manifest import Manifest
from ..points import Receipt, counting, standings
from ..store import RunRecord
from .context import NOTABLE_GAP_CM, Fact, measure

THRESHOLDS_S = (5, 6, 8, 10, 12, 15, 20, 25, 30, 40)


@dataclass(frozen=True)
class Situation:
    """A run and the world as it stood the moment it was published."""

    record: RunRecord
    manifest: Manifest
    events: dict[str, Manifest]  # every OPEN event, by id
    # The counting runs of every open event submitted at or before the record,
    # the record included, oldest first.
    runs: tuple[RunRecord, ...]

    @property
    def user(self) -> str:
        return self.record.user

    @property
    def timed(self) -> bool:
        return self.manifest.metric != "votes"

    def on_event(self, event_id: str | None = None) -> list[RunRecord]:
        event_id = event_id or self.record.event_id
        return [r for r in self.runs if r.event_id == event_id]

    def mine(self, event_id: str | None = None) -> list[RunRecord]:
        runs = self.on_event(event_id) if event_id else self.runs
        return [r for r in runs if r.user == self.user]

    def board(self, event_id: str | None = None, before: bool = False) -> list[Row]:
        """One row per person, as the board stood after the record — or just
        before it, with the record taken out."""
        runs = [r for r in self.on_event(event_id) if not (before and r.run_id == self.record.run_id)]
        return leaderboard(runs, entrant=by_user)


def situation(record: RunRecord, all_runs, withdrawn: frozenset[str],
              events: dict[str, Manifest]) -> Situation:
    stamp = (record.submitted_at, record.run_id)
    runs = tuple(
        r for r in counting(all_runs, withdrawn)
        if r.event_id in events and (r.submitted_at, r.run_id) <= stamp
    )
    return Situation(record, events[record.event_id], events, runs)


def _clean(record: RunRecord) -> bool:
    return record.seeds_finished == len(record.per_seed)


def _ago(earlier: str, later: str) -> tuple[int, str]:
    """Whole days between two log timestamps, and the words for them."""
    parse = lambda stamp: datetime.fromisoformat(stamp)
    days = (parse(later) - parse(earlier)).days
    return days, "earlier today" if days == 0 else "a day ago" if days == 1 else f"{days} days ago"


def first_runs(s: Situation) -> list[Fact]:
    if len(s.mine()) == 1:
        return [Fact("notable#/first-ever", f"This is @{s.user}'s first publication in the arena.",
                     "notable", ("first-run",), score=0.9)]
    if len(s.mine(s.record.event_id)) == 1:
        return [Fact("notable#/first-on-event",
                     f"This is @{s.user}'s first publication on the {s.manifest.title}.",
                     "notable", ("first-run",), score=0.6)]
    return []


def busy_day(s: Situation) -> list[Fact]:
    day = s.record.submitted_at[:10]
    n = sum(1 for r in s.mine() if r.submitted_at[:10] == day)
    if n >= 3:
        return [Fact("notable#/busy-day", f"This is @{s.user}'s publication number {n} today.",
                     "notable", ("busy",), score=0.5)]
    return []


def milestone(s: Situation) -> list[Fact]:
    r = s.record
    if s.manifest.metric != "mean_finish_time" or not _clean(r):
        return []
    limit = next((t for t in THRESHOLDS_S if r.score < t), None)
    if limit is None:
        return []
    field = [x.score for x in s.on_event() if _clean(x) and x.run_id != r.run_id]
    own = [x.score for x in s.mine(r.event_id) if _clean(x) and x.run_id != r.run_id]
    title = s.manifest.title
    if field and min(field) >= limit:
        return [Fact("notable#/record", f"At {r.score:.2f} s this is the first run under {limit} s "
                     f"ever recorded on the {title}.", "notable", ("record", "milestone"), score=0.85)]
    if own and min(own) >= limit:
        return [Fact("notable#/milestone", f"At {r.score:.2f} s this is @{s.user}'s first run under "
                     f"{limit} s on the {title}.", "notable", ("milestone",), score=0.6)]
    return []


def personal_best(s: Situation) -> list[Fact]:
    r = s.record
    if not s.timed or r.seeds_finished == 0:
        return []
    earlier = [x for x in s.mine(r.event_id) if x.run_id != r.run_id]
    if not earlier:
        return []
    best = min(earlier, key=sort_key)
    unit = measure(s.manifest)[1]
    margin = abs(best.score - r.score)
    if best.seeds_finished == 0 or sort_key(r) >= sort_key(best) or margin < 0.005:
        return []
    big = margin >= (NOTABLE_GAP_CM if unit == "cm" else 0.1 * abs(best.score))
    return [Fact("notable#/personal-best",
                 f"@{s.user} beats their previous best on the {s.manifest.title}, {best.score:.2f} {unit}, "
                 f"by {margin:.2f} {unit}.", "notable", ("pb", "big-margin") if big else ("pb",),
                 score=0.8 if big else 0.6)]


def climb(s: Situation) -> list[Fact]:
    r = s.record
    if not s.timed or r.seeds_finished == 0:
        return []
    before = {row.record.user: row.rank for row in s.board(before=True)}
    after = {row.record.user: row.rank for row in s.board()}
    was, now = before.get(s.user), after.get(s.user)
    if was is None or now is None or now >= was:
        return []
    passed = [u for u in after if u != s.user and after[u] > before.get(u, after[u])]
    text = f"@{s.user} climbs from rank {was} to rank {now} on the {s.manifest.title}"
    text += f", passing {', '.join(f'@{u}' for u in passed[:3])}." if passed else "."
    tags = ("climb", "podium") if now <= 3 else ("climb",)
    return [Fact("notable#/climb", text, "notable", tags,
                 score=min(0.9, 0.5 + 0.1 * (was - now)))]


def dnf_streaks(s: Situation) -> list[Fact]:
    r = s.record
    if not s.timed or r.seeds_finished > 0:
        return []
    earlier = [x for x in s.mine(r.event_id) if x.run_id != r.run_id]
    clean = 0
    for x in reversed(earlier):
        if not _clean(x):
            break
        clean += 1
    title = s.manifest.title
    if clean >= 3:
        return [Fact("notable#/first-dnf", f"@{s.user} did not finish after {clean} clean runs in a "
                     f"row on the {title}.", "notable", ("dnf-streak",), score=0.6)]
    dnfs = 1
    for x in reversed(earlier):
        if x.seeds_finished > 0:
            break
        dnfs += 1
    if dnfs >= 2:
        return [Fact("notable#/dnf-streak", f"This is @{s.user}'s DNF number {dnfs} in a row on "
                     f"the {title}.", "notable", ("dnf-streak",), score=0.5)]
    return []


def leads_events(s: Situation) -> list[Fact]:
    led = []
    for event_id, manifest in s.events.items():
        if manifest.metric == "votes":
            continue
        board = s.board(event_id)
        if board and board[0].record.user == s.user and board[0].record.seeds_finished > 0:
            led.append(manifest.title)
    if len(led) >= 2:
        return [Fact("notable#/leads-events", f"@{s.user} now leads {len(led)} events at once: "
                     f"{', '.join(led)}.", "notable", ("lead", "dominant"), score=0.8)]
    return []


def regular(s: Situation) -> list[Fact]:
    timed = [event_id for event_id, m in s.events.items() if m.metric != "votes"]
    if len(timed) >= 3 and all(s.mine(event_id) for event_id in timed):
        return [Fact("notable#/regular", f"@{s.user} has published on every open event.",
                     "notable", ("regular",), score=0.5)]
    return []


def rivalry(s: Situation) -> list[Fact]:
    if not s.timed:
        return []
    runs = s.on_event()
    holders: list[str] = []
    for i in range(len(runs)):
        board = leaderboard(runs[: i + 1], entrant=by_user)
        top = board[0].record.user if board and board[0].record.seeds_finished > 0 else None
        if top and (not holders or holders[-1] != top):
            holders.append(top)
    others = Counter(
        b if a == s.user else a
        for a, b in pairwise(holders)
        if s.user in (a, b)
    )
    if not others:
        return []
    other, swaps = others.most_common(1)[0]
    if swaps < 2:
        return []
    return [Fact("notable#/rivalry", f"@{s.user} and @{other} have traded the lead of the "
                 f"{s.manifest.title} {swaps} times.", "notable", ("rivalry",), score=0.7)]


def opponents(s: Situation) -> list[Fact]:
    """The ducks drawn in the clip: the three ranked just under the author."""
    r = s.record
    if not s.timed or r.seeds_finished == 0:
        return []
    before = {row.record.user: row for row in s.board(before=True)}
    after = s.board()
    me = next((i for i, row in enumerate(after) if row.record.user == s.user), None)
    if me is None:
        return []
    word, unit = measure(s.manifest)
    out = []
    for row in after[me + 1 : me + 4]:
        user = row.record.user
        held = before.get(user)
        if held is None or row.rank <= held.rank:
            continue
        days, ago = _ago(held.record.submitted_at, r.submitted_at)
        out.append(Fact(
            f"notable#/opponent/{user}",
            f"@{user} drops from rank {held.rank} to rank {row.rank} on the {s.manifest.title}; "
            f"their best {word} there, {held.record.score:.2f} {unit}, was published {ago}.",
            "notable", ("rivalry", "displaced"), score=min(0.8, 0.4 + days / 60),
        ))
    return out


DETECTORS = (first_runs, busy_day, milestone, personal_best, climb, dnf_streaks, leads_events,
             regular, rivalry, opponents)


def notable_facts(s: Situation) -> list[Fact]:
    found = [fact for detect in DETECTORS for fact in detect(s)]
    return sorted(found, key=lambda f: -f.score)


def _season(user: str, s: Situation, ladder: dict) -> str:
    runs = [r for r in s.runs if r.user == user]
    events = len({r.event_id for r in runs})
    card = ladder[user]
    return (f"{card.points} points this season, rank {card.rank} of {len(ladder)} on the points "
            f"ladder, from {len(runs)} publication{'s' if len(runs) > 1 else ''} on {events} "
            f"event{'s' if events > 1 else ''}")


def profiles(s: Situation, earned: list[Receipt]) -> list[Fact]:
    """The season of the author, and of whoever this board measures them against: the leader
    ahead of them, or the runner-up behind. Offered with every run, beside the picked angles,
    so the booth can give a player's numbers when it chooses to."""
    ladder = {card.user: card for card in standings(earned)}
    facts = [Fact("notable#/profile", f"@{s.user} has {_season(s.user, s, ladder)}.", "notable",
                  ("profile",))]
    board = s.board() if s.timed else []
    others = [row.record.user for row in board if row.record.user != s.user]
    if others and others[0] in ladder:
        rival = others[0]
        place = "who leads" if board[0].record.user == rival else "next on"
        facts.append(Fact(f"notable#/profile/{rival}", f"@{rival}, {place} this board, has "
                          f"{_season(rival, s, ladder)}.", "notable", ("profile",)))
    return facts


def pick(facts: list[Fact], limit: int = 4) -> list[Fact]:
    """The best few, no two on the same angle (their first tag)."""
    chosen: list[Fact] = []
    for fact in facts:
        if any(fact.tags[:1] == c.tags[:1] for c in chosen):
            continue
        chosen.append(fact)
        if len(chosen) == limit:
            break
    return chosen
