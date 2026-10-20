import tempfile
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from .constants import RUNNER_VERSION
from .course import compile_tug
from .cup import (
    GROUP_NAMES,
    Cup,
    Entrant,
    MatchRecord,
    first_knockout,
    group_fixtures,
    group_table,
    iso,
    match_id,
    round_name,
)
from .hub_fetch import fetch_policy
from .manifest import Manifest, all_events
from .match import bout_seed, play_match
from .policy import Policy, load_policy
from .store import RunRecord, Store
from .trace import encode


def load_cup(store: Store, event_id: str, number: int) -> Cup | None:
    draw = store.cup_file(event_id, number, "draw.json")
    if draw is None:
        return None
    return Cup.from_json(draw, store.cup_file(event_id, number, "matches.json"), store.cup_file(event_id, number, "order.json"))


def all_cups(store: Store) -> list[Cup]:
    return [load_cup(store, event.id, number) for event in all_events() if event.cup for number in store.cup_numbers(event.id)]


def entrants_at(records: Iterable[RunRecord], withdrawn: frozenset[str], close_at: datetime,
                runner_version: int = RUNNER_VERSION) -> list[Entrant]:
    """Each player's latest entry at close, not withdrawn, on the runner; two ducks of one policy name air under their handles."""
    close, latest = iso(close_at), {}
    for record in sorted(records, key=lambda r: (r.submitted_at, r.run_id)):
        if record.submitted_at <= close and record.run_id not in withdrawn and record.runner_version == runner_version:
            latest[record.user] = record
    names = Counter(record.policy_name for record in latest.values())
    ducks = [Entrant(r.user, r.run_id, r.policy_name, r.livery, r.score, r.model_sha256, r.source,
                     r.policy_name if names[r.policy_name] == 1 else f"{r.policy_name} (@{r.user})")
             for r in latest.values()]
    return sorted(ducks, key=lambda e: (-e.rating, e.user))


def load_entrant(store: Store, entrant: Entrant) -> Policy:
    """From the Hub at its pinned revision, or the store's own copy: the two ways an entry records its policy."""
    source = entrant.source
    if source["kind"] == "hub":
        return load_policy(fetch_policy(f"{source['repo_id']}:{source['filename']}", revision=source["revision"]).path)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "policy.onnx"
        path.write_bytes(store.model(entrant.model_sha256))
        return load_policy(path)


def compute_matches(manifest: Manifest, cup: Cup, load: Callable[[Entrant], object]) -> tuple[Cup, dict[str, bytes]]:
    """Every match of the cup in playing order: the groups round by round, then each knockout round from the last."""
    model = compile_tug(manifest, 2)  # one model for every bout of the cup
    ratings = [e.rating for e in cup.entrants]
    policies, matches, files = {}, [], {}

    def play(a: int, b: int, round_: str, group: str | None) -> int:
        mid = match_id(cup.event_id, cup.number, len(matches))
        for i in (a, b):
            if i not in policies:
                policies[i] = load(cup.entrants[i])
        seeds = [bout_seed(cup.secret, mid, k) for k in range(manifest.bout.max_bouts)]
        out = play_match(manifest, policies[a], policies[b], seeds, (ratings[a], ratings[b]), model=model)
        for bout, (trace, settle) in zip(out.bouts, out.traces):
            files[f"bouts/{mid}-{bout.k}.npz"] = encode(trace, settle)
        winner = a if out.winner == "a" else b
        matches.append(MatchRecord(mid, len(matches), round_, group, a, b, out.bouts, out.wins, winner, out.decided_by))
        return winner

    fixtures = [group_fixtures(g) for g in cup.groups]
    per_round = [len(g) // 2 for g in cup.groups]  # a round of an odd group has a bye: still len // 2 matches
    for r in range(max((len(f) // k for f, k in zip(fixtures, per_round)), default=0)):
        for g, (pairs, k) in enumerate(zip(fixtures, per_round)):
            for a, b in pairs[r * k:(r + 1) * k]:
                play(a, b, "group", GROUP_NAMES[g])
    pairs = first_knockout([group_table(g, matches, ratings) for g in cup.groups])
    while pairs:
        winners = [play(a, b, round_name(len(pairs)), None) for a, b in pairs]
        pairs = list(zip(winners[::2], winners[1::2]))
    return replace(cup, matches=tuple(matches)), files
