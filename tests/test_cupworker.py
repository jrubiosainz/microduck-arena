import hashlib
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

import arena
from arena import cupworker
from arena.constants import RUNNER_VERSION
from arena.cup import Cup, cup_times, draw_groups, iso
from arena.cupworker import all_cups, compute_matches, entrants_at, load_cup, load_entrant
from arena.manifest import BoutRules, load_event
from arena.match import BoutResult, MatchOutcome, bout_seed
from arena.policy import load_policy
from arena.store import LocalStore
from arena.trace import decode
from tests.test_cup import entrant
from tests.test_store import make_record

WALKER = Path(arena.__file__).parent / "assets/policies/BEST_alpha_walking.onnx"
# Cup #1 pinned to 2026-10-30: the owner sets the shipped date at release, and no test moves with it.
TUG = replace(load_event("tug-of-war"), cup=replace(load_event("tug-of-war").cup, first=date(2026, 10, 30)))


def fake_play(manifest, a, b, seeds, ratings, model=None):
    """No physics: the higher rating wins 2-0 on two-frame traces."""
    side = "a" if ratings[0] >= ratings[1] else "b"
    bouts = tuple(BoutResult(k, seeds[k], ("west", "east")[k], side, "pit", 4.0) for k in range(2))
    trace = (np.zeros((2, 2, 21), np.float32), np.zeros((2, 3, 21), np.float32))
    return MatchOutcome(bouts, (trace, trace), (2, 0) if side == "a" else (0, 2), side, "bouts")


def drawn_cup(n, number=1, secret="ab" * 16):
    close, premiere = cup_times(TUG.cup, number)
    ducks = tuple(entrant(i, rating=n - i) for i in range(n))
    return Cup("tug-of-war", number, iso(close), iso(premiere), secret, ducks,
               tuple(tuple(g) for g in draw_groups(ducks, secret)))


def played_cup(n, number=1):
    with patch("arena.cupworker.play_match", fake_play), patch("arena.cupworker.compile_tug", lambda *_: None):
        return compute_matches(TUG, drawn_cup(n, number), lambda e: e.user)[0]


def test_a_cup_is_read_back_from_its_files(tmp_path):
    store = LocalStore(tmp_path)
    assert load_cup(store, "tug-of-war", 1) is None and all_cups(store) == []
    cup = Cup("tug-of-war", 1, "2026-10-30T15:00:00Z", "2026-10-30T17:00:00Z", "ab" * 16,
              tuple(entrant(i) for i in range(4)), ((0, 1, 2, 3),))
    store.put_cup_files("tug-of-war", 1, {"draw.json": cup.draw_json()})
    assert load_cup(store, "tug-of-war", 1) == cup and all_cups(store) == [cup]


def test_entrants_are_each_players_latest_entry_at_close():
    run = lambda user, at, score, **o: make_record(event_id="tug-of-war", user=user, submitted_at=at, score=score, **o)
    old, new = run("ann", "2026-10-20T09:00:00Z", 3.0), run("ann", "2026-10-29T09:00:00Z", 4.0)
    gone, kept = run("bob", "2026-10-29T10:00:00Z", 6.0), run("bob", "2026-10-28T10:00:00Z", 2.0)
    late = run("cat", "2026-10-30T15:00:01Z", 9.0)
    stale = run("cat", "2026-10-20T09:00:00Z", 9.0, runner_version=RUNNER_VERSION - 1)
    edge = run("dan", "2026-10-30T15:00:00Z", 5.0)
    got = entrants_at([old, new, gone, kept, late, stale, edge], frozenset({gone.run_id}), datetime(2026, 10, 30, 15, tzinfo=UTC))
    assert [(e.user, e.run_id, e.rating) for e in got] == [("dan", edge.run_id, 5.0), ("ann", new.run_id, 4.0), ("bob", kept.run_id, 2.0)]
    assert (got[0].source, got[0].model_sha256, got[0].livery) == (edge.source, edge.model_sha256, edge.livery)


def test_two_entrants_with_one_policy_name_air_under_their_handles():
    run = lambda user, name: make_record(event_id="tug-of-war", user=user, policy_name=name, submitted_at="2026-10-29T09:00:00Z")
    got = entrants_at([run("ann", "microduck-tug-of-war"), run("bob", "microduck-tug-of-war"), run("cat", "Tank")],
                      frozenset(), datetime(2026, 10, 30, 15, tzinfo=UTC))
    assert {e.user: e.name for e in got} == {
        "ann": "microduck-tug-of-war (@ann)", "bob": "microduck-tug-of-war (@bob)", "cat": "Tank"}
    assert {e.user: e.policy_name for e in got} == {"ann": "microduck-tug-of-war", "bob": "microduck-tug-of-war", "cat": "Tank"}


def test_an_entrant_is_loaded_from_the_hub_at_its_revision(monkeypatch):
    asked = []
    monkeypatch.setattr(cupworker, "fetch_policy", lambda ref, revision: asked.append((ref, revision)) or SimpleNamespace(path=WALKER))
    assert load_entrant(None, entrant(0)).sha256 == hashlib.sha256(WALKER.read_bytes()).hexdigest()
    assert asked == [("p0/tug:policy.onnx", "c" * 40)]


def test_an_entrant_kept_by_a_local_store_is_loaded_from_it(tmp_path):
    store, blob = LocalStore(tmp_path), WALKER.read_bytes()
    sha = hashlib.sha256(blob).hexdigest()
    store.append(make_record(run_id="R1", model_sha256=sha, model_stored=True), b"t", blob)
    assert load_entrant(store, replace(entrant(0), model_sha256=sha, source={"kind": "local", "path": "/gone.onnx"})).sha256 == sha


def test_groups_play_round_by_round_then_each_knockout_round(monkeypatch):
    calls = []
    monkeypatch.setattr(cupworker, "play_match", lambda m, a, b, seeds, ratings, model=None:
                        calls.append((a, b, seeds, model)) or fake_play(m, a, b, seeds, ratings))
    monkeypatch.setattr(cupworker, "compile_tug", lambda manifest, ducks: "model")
    cup = replace(drawn_cup(6), groups=((0, 2, 4), (1, 3, 5)))
    played, files = compute_matches(TUG, cup, lambda e: e.user)
    assert [(m.a, m.b, m.round, m.group) for m in played.matches] == [
        (2, 4, "group", "A"), (3, 5, "group", "B"), (0, 4, "group", "A"), (1, 5, "group", "B"), (0, 2, "group", "A"),
        (1, 3, "group", "B"), (0, 3, "semi-final", None), (1, 2, "semi-final", None), (0, 1, "final", None)]
    assert [m.match_id for m in played.matches] == [f"tug-of-war-0001-{i:03d}" for i in range(9)]
    assert played.matches[-1].winner == 0
    assert calls[0] == ("p2", "p4", [bout_seed("ab" * 16, "tug-of-war-0001-000", k) for k in range(5)], "model")
    assert sorted(files) == sorted(f"bouts/tug-of-war-0001-{i:03d}-{k}.npz" for i in range(9) for k in range(2))
    assert decode(files["bouts/tug-of-war-0001-000-0.npz"]).shape == (2, 2, 21)


def test_a_cup_plays_on_the_real_physics_and_replays_identically():
    manifest = replace(load_event("tug-of-war"), bout=BoutRules(time_limit_s=1.0, bouts_to_win=2, max_bouts=3))
    walker = load_policy(WALKER)
    first, files = compute_matches(manifest, drawn_cup(4), lambda e: walker)
    again, files_again = compute_matches(manifest, drawn_cup(4), lambda e: walker)
    assert len(first.matches) == 7 and first.matches[-1].round == "final" and first == again
    assert files.keys() == files_again.keys()
    assert all(np.array_equal(decode(files[k]), decode(files_again[k])) for k in files)
