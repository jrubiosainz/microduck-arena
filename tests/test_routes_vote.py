import dataclasses
import re
import threading
import time
from datetime import UTC, datetime

import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.manifest import load_event
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.routes_vote import BALLOT_TTL_S, BallotBook
from tests.test_store import make_record


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def enter(app, user, **overrides):
    record = make_record(user=user, event_id="got-a-talent", policy_name=user, **overrides)
    app.state.store.append(record, encode(np.zeros((5, 21), dtype=np.float32)))
    return record


def _capped(event_id: str, per_day: int):
    """The real manifest, with its vote.per_day lowered for a test."""
    manifest = load_event(event_id)
    return dataclasses.replace(manifest, vote=dataclasses.replace(manifest.vote, per_day=per_day))


# --- BallotBook: the in-memory table a token stands for --------------------


def test_a_ballot_book_entry_round_trips():
    book = BallotBook()
    token = book.issue("got-a-talent", "ann", ["a", "b"])
    entry = book.get(token)
    assert (entry.event_id, entry.voter, entry.run_ids) == ("got-a-talent", "ann", ("a", "b"))
    assert entry.spent is False


def test_a_minted_token_is_safe_as_a_filename():
    book = BallotBook()
    token = book.issue("got-a-talent", "ann", ["a", "b"])
    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_a_garbage_token_returns_none_and_never_raises():
    book = BallotBook()
    assert book.get("not-a-real-token") is None
    assert book.get("") is None


def test_a_ballot_book_entry_expires(monkeypatch):
    book = BallotBook()
    token = book.issue("got-a-talent", "ann", ["a", "b"])
    later = time.time() + BALLOT_TTL_S + 1
    monkeypatch.setattr("arena.web.routes_vote.time.time", lambda: later)
    assert book.get(token) is None


def test_spending_a_ballot_marks_it_without_evicting_it():
    book = BallotBook()
    token = book.issue("got-a-talent", "ann", ["a", "b"])
    book.spend(token)
    entry = book.get(token)
    assert entry is not None
    assert entry.spent is True


def test_issuing_sweeps_every_expired_entry_first():
    """A ballot a voter never returns to must not sit forever.

    Unlike a session id, a ballot token is looked up again only if its voter
    votes or opens a lane — most never are — so `get()`'s own per-token
    eviction is not enough on its own. `issue()` sweeps the whole table.
    """
    book = BallotBook()
    now = 1_000_000.0
    for i in range(1000):
        book.issue("got-a-talent", f"voter-{i}", ["a", "b"], now=now)
    assert len(book._by_token) == 1000

    later = now + BALLOT_TTL_S + 1
    fresh = book.issue("got-a-talent", "late-voter", ["a", "b"], now=later)
    assert len(book._by_token) == 1
    assert book.get(fresh, now=later) is not None


def test_issue_genuinely_honours_its_own_ttl():
    """A parameter the body ignores is a lie; this pins that it is not one."""
    book = BallotBook()
    now = 1_000_000.0
    token = book.issue("got-a-talent", "ann", ["a", "b"], ttl_s=10.0, now=now)
    assert book.get(token, now=now + 9) is not None
    assert book.get(token, now=now + 11) is None


# --- The routes --------------------------------------------------------


def test_an_event_that_takes_no_votes_has_no_ballot(client):
    api, _ = client
    assert api.get("/api/events/sprint-2m/ballot").status_code == 404


def test_a_field_too_small_is_a_state_and_not_an_error(client):
    api, app = client
    enter(app, "ann")
    body = api.get("/api/events/got-a-talent/ballot").json()
    assert body == {"state": "too-few", "have": 1, "need": 2}


def test_issuing_a_ballot_is_never_cached(client):
    api, app = client
    enter(app, "ann")
    enter(app, "bob")
    resp = api.get("/api/events/got-a-talent/ballot")
    assert resp.headers["cache-control"] == "no-store"


def test_a_ballot_never_holds_your_own_duck(client):
    api, app = client
    own = enter(app, "coralie")
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/got-a-talent/ballot").json()
    assert body["state"] == "ballot"
    assert body["lanes"] == 2
    entry = app.state.ballot_book.get(body["ballot"])
    assert own.run_id not in entry.run_ids


def test_the_client_response_never_carries_a_run_id(client):
    """The whole point of the token: nothing it decodes to reaches the wire."""
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/got-a-talent/ballot").json()
    entry = app.state.ballot_book.get(body["ballot"])
    for run_id in entry.run_ids:
        assert run_id not in body["ballot"]
        assert run_id != body["ballot"]


def test_a_ballot_says_how_each_lanes_duck_sounds(client):
    api, app = client
    ann = enter(app, "ann", sound={"triggers": [[0.0, 1.0, 0.0]]})
    bob = enter(app, "bob")
    body = api.get("/api/events/got-a-talent/ballot").json()
    entry = app.state.ballot_book.get(body["ballot"])
    sounds = {ann.run_id: ann.sound, bob.run_id: None}
    assert body["sound"] == [sounds[run_id] for run_id in entry.run_ids]


def test_voting_records_the_whole_field_and_pays_the_voter(client):
    api, app = client
    for name in ("ann", "bob", "cid"):
        enter(app, name)
    body = api.get("/api/events/got-a-talent/ballot").json()
    result = api.post("/api/events/got-a-talent/vote", json={"ballot": body["ballot"], "lane": 1})

    assert result.json() == {"points": 2, "cast_today": 1}
    [ballot] = app.state.ballots.since("2000-01-01")
    assert ballot.voter == "coralie"
    assert len(ballot.candidates) == 3
    assert ballot.choice == ballot.candidates[1]
    assert ballot.ballot_id == body["ballot"]


def test_voting_twice_with_one_ballot_changes_nothing(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/got-a-talent/ballot").json()
    payload = {"ballot": body["ballot"], "lane": 0}
    api.post("/api/events/got-a-talent/vote", json=payload)
    again = api.post("/api/events/got-a-talent/vote", json=payload)

    assert again.json() == {"points": 0, "cast_today": 1}
    assert len(app.state.ballots.since("2000-01-01")) == 1


def test_a_replay_across_utc_midnight_does_not_double_count(client, monkeypatch):
    """The log's own day-sharding cannot catch this; `spent` on the token does."""
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    token = api.get("/api/events/got-a-talent/ballot").json()["ballot"]

    times = iter(
        [
            datetime(2026, 1, 1, 23, 59, 59, tzinfo=UTC),
            datetime(2026, 1, 2, 0, 0, 1, tzinfo=UTC),
        ]
    )

    class _Clock:
        @staticmethod
        def now(tz=None):
            return next(times)

    monkeypatch.setattr("arena.web.routes_vote.datetime", _Clock)

    payload = {"ballot": token, "lane": 0}
    first = api.post("/api/events/got-a-talent/vote", json=payload)
    second = api.post("/api/events/got-a-talent/vote", json=payload)

    assert first.json() == {"points": 2, "cast_today": 1}
    # cast_today legitimately resets at UTC midnight — the ballot landed on
    # the DAY BEFORE this "today". What must not happen is a second ballot
    # on disk: the token is spent, and that is what the assertion below pins.
    assert second.json() == {"points": 0, "cast_today": 0}
    assert len(app.state.ballots.since("2000-01-01")) == 1


def test_a_ballot_issued_for_someone_else_is_refused(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    stolen = app.state.ballot_book.issue("got-a-talent", "someone-else", ["a", "b"])
    refused = api.post("/api/events/got-a-talent/vote", json={"ballot": stolen, "lane": 0})
    assert refused.status_code == 400


def test_a_lane_outside_the_ballot_is_refused(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/got-a-talent/ballot").json()
    refused = api.post("/api/events/got-a-talent/vote", json={"ballot": body["ballot"], "lane": 7})
    assert refused.status_code == 400


def test_the_daily_quota_closes_the_gate(client, monkeypatch):
    api, app = client
    monkeypatch.setattr("arena.web.routes_vote.load_event", lambda event_id: _capped(event_id, 2))
    for name in ("ann", "bob", "cid"):
        enter(app, name)
    for _ in range(2):
        body = api.get("/api/events/got-a-talent/ballot").json()
        api.post("/api/events/got-a-talent/vote", json={"ballot": body["ballot"], "lane": 0})

    gate = api.get("/api/events/got-a-talent/ballot").json()
    assert gate == {"state": "quota", "cast_today": 2, "per_day": 2}


def test_the_quota_check_and_the_write_are_one_critical_section(client, monkeypatch):
    """Four concurrent votes against a cap of one must record exactly one ballot."""
    api, app = client
    monkeypatch.setattr("arena.web.routes_vote.load_event", lambda event_id: _capped(event_id, 1))
    for name in ("ann", "bob", "cid", "dan", "eve"):
        enter(app, name)

    tokens = [api.get("/api/events/got-a-talent/ballot").json()["ballot"] for _ in range(4)]
    results: list = []
    lock = threading.Lock()

    def vote(token: str) -> None:
        result = api.post("/api/events/got-a-talent/vote", json={"ballot": token, "lane": 0})
        with lock:
            results.append(result)

    threads = [threading.Thread(target=vote, args=(t,)) for t in tokens]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 4
    assert len(app.state.ballots.since("2000-01-01")) == 1
    assert sum(1 for r in results if r.json().get("points") == 2) == 1


def test_a_lanes_trace_is_served_without_ever_naming_a_run(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/got-a-talent/ballot").json()
    trace = api.get(f"/api/ballots/{body['ballot']}/lanes/0/trace")
    assert trace.status_code == 200
    assert trace.headers["X-Frame-Count"] == "5"
    assert api.get(f"/api/ballots/{body['ballot']}/lanes/9/trace").status_code == 400


def test_a_lane_whose_trace_is_missing_404s_not_500s(client):
    api, app = client
    token = app.state.ballot_book.issue("got-a-talent", "coralie", ("ghost-run", "ghost-run-2"))
    missing = api.get(f"/api/ballots/{token}/lanes/0/trace")
    assert missing.status_code == 404
