import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.routes_vote import BALLOT_TTL_S, ballot_id, seal, unseal
from tests.test_store import make_record


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def enter(app, user, **overrides):
    record = make_record(user=user, event_id="swag-contest", policy_name=user, **overrides)
    app.state.store.append(record, encode(np.zeros((5, 21), dtype=np.float32)))
    return record


def test_a_seal_round_trips_and_a_forged_one_does_not():
    token = seal("swag-contest", "ann", ["a", "b"], 1000.0, "secret")
    opened = unseal(token, "secret", 1000.0)
    assert (opened.event_id, opened.voter, opened.run_ids) == ("swag-contest", "ann", ("a", "b"))
    assert unseal(token, "other-secret", 1000.0) is None
    assert unseal(token + "x", "secret", 1000.0) is None
    assert unseal("not-a-ballot", "secret", 1000.0) is None


def test_a_seal_expires():
    token = seal("swag-contest", "ann", ["a", "b"], 1000.0, "secret")
    assert unseal(token, "secret", 1000.0 + BALLOT_TTL_S - 1) is not None
    assert unseal(token, "secret", 1000.0 + BALLOT_TTL_S + 1) is None


def test_the_ballot_id_is_the_seals_own_mac():
    token = seal("swag-contest", "ann", ["a", "b"], 1000.0, "secret")
    assert ballot_id(token) == token.rpartition(".")[2]
    assert ballot_id(token) != ballot_id(seal("swag-contest", "ann", ["a", "b"], 1001.0, "secret"))


def test_an_event_that_takes_no_votes_has_no_ballot(client):
    api, _ = client
    assert api.get("/api/events/sprint-2m/ballot").status_code == 404


def test_a_field_too_small_is_a_state_and_not_an_error(client):
    api, app = client
    enter(app, "ann")
    body = api.get("/api/events/swag-contest/ballot").json()
    assert body == {"state": "too-few", "have": 1, "need": 2}


def test_a_ballot_never_holds_your_own_duck(client):
    api, app = client
    enter(app, "coralie")
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    assert body["state"] == "ballot"
    assert body["lanes"] == 2
    opened = unseal(body["ballot"], app.state.config.session_secret, 0.0, ttl_s=float("inf"))
    assert len(opened.run_ids) == 2


def test_voting_records_the_whole_field_and_pays_the_voter(client):
    api, app = client
    for name in ("ann", "bob", "cid"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    result = api.post("/api/events/swag-contest/vote", json={"ballot": body["ballot"], "lane": 1})

    assert result.json() == {"points": 2, "cast_today": 1}
    [ballot] = app.state.ballots.since("2000-01-01")
    assert ballot.voter == "coralie"
    assert len(ballot.candidates) == 3
    assert ballot.choice == ballot.candidates[1]


def test_voting_twice_with_one_ballot_changes_nothing(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    payload = {"ballot": body["ballot"], "lane": 0}
    api.post("/api/events/swag-contest/vote", json=payload)
    again = api.post("/api/events/swag-contest/vote", json=payload)

    assert again.json() == {"points": 0, "cast_today": 1}
    assert len(app.state.ballots.since("2000-01-01")) == 1


def test_a_ballot_issued_for_someone_else_is_refused(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    stolen = seal(
        "swag-contest", "someone-else", ["a", "b"], 0.0, app.state.config.session_secret
    )
    refused = api.post("/api/events/swag-contest/vote", json={"ballot": stolen, "lane": 0})
    assert refused.status_code == 400


def test_a_lane_outside_the_ballot_is_refused(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    refused = api.post("/api/events/swag-contest/vote", json={"ballot": body["ballot"], "lane": 7})
    assert refused.status_code == 400


def test_the_daily_quota_closes_the_gate(client, monkeypatch):
    api, app = client
    monkeypatch.setattr("arena.web.routes_vote.PER_DAY_OVERRIDE", 2)
    for name in ("ann", "bob", "cid"):
        enter(app, name)
    for _ in range(2):
        body = api.get("/api/events/swag-contest/ballot").json()
        api.post("/api/events/swag-contest/vote", json={"ballot": body["ballot"], "lane": 0})

    gate = api.get("/api/events/swag-contest/ballot").json()
    assert gate == {"state": "quota", "cast_today": 2, "per_day": 2}


def test_a_lanes_trace_is_served_without_ever_naming_a_run(client):
    api, app = client
    for name in ("ann", "bob"):
        enter(app, name)
    body = api.get("/api/events/swag-contest/ballot").json()
    trace = api.get(f"/api/ballots/{body['ballot']}/lanes/0/trace")
    assert trace.status_code == 200
    assert trace.headers["X-Frame-Count"] == "5"
    assert api.get(f"/api/ballots/{body['ballot']}/lanes/9/trace").status_code == 400
