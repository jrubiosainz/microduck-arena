"""Taking an entry off the board — and the two ways that could go wrong."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.index import by_policy, leaderboard
from arena.recover import Candidate, plan
from arena.store import LocalStore, Withdrawal
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.session import COOKIE_NAME, sign
from tests.test_store import make_record


class Event:
    def __init__(self, id, rig):
        self.id, self.rig = id, rig


SPRINT = Event("sprint-2m", "legs")


def a_withdrawal(run_id="R1", **over):
    fields = {
        "run_id": run_id,
        "event_id": "sprint-2m",
        "user": "alice",
        "withdrawn_at": "2026-09-14T12:00:00Z",
    }
    fields.update(over)
    return Withdrawal(**fields)


# ── the log stays append-only ────────────────────────────────────────────

def test_a_withdrawal_adds_a_record_and_deletes_nothing(tmp_path):
    """The property the whole store rests on. A withdrawal that removed the run
    file would make this a read-modify-write log, which is what lets two
    simultaneous submissions contend."""
    store = LocalStore(tmp_path)
    record = make_record(user="alice")
    store.append(record, encode(np.zeros((5, 21), "f4")))

    store.withdraw(a_withdrawal(run_id=record.run_id))

    assert [r.run_id for r in store.runs("sprint-2m")] == [record.run_id]
    assert [w.run_id for w in store.withdrawals()] == [record.run_id]


def test_withdrawing_twice_is_not_an_error(tmp_path):
    """A double-click is a double-click, not a failure worth showing someone."""
    store = LocalStore(tmp_path)
    store.withdraw(a_withdrawal())
    store.withdraw(a_withdrawal())
    assert len(store.withdrawals()) == 1


def test_a_withdrawal_round_trips(tmp_path):
    store = LocalStore(tmp_path)
    original = a_withdrawal(repo_id="alice/microduck-walk", revision="rev1")
    store.withdraw(original)
    assert store.withdrawals() == [original]


# ── the board honours it ─────────────────────────────────────────────────

def test_a_withdrawn_run_leaves_the_board():
    rows = leaderboard([make_record(run_id="R1", user="alice")], withdrawn=frozenset({"R1"}))
    assert rows == []


def test_a_withdrawn_run_does_not_hold_back_a_better_one():
    """It is absent, not merely outranked. If withdrawal only demoted it, a
    withdrawn best run would keep its owner's next-best off the board."""
    runs = [
        make_record(run_id="R1", user="alice", policy_name="w", score=9.0),
        make_record(run_id="R2", user="alice", policy_name="w", score=12.0),
    ]
    rows = leaderboard(runs, entrant=by_policy, withdrawn=frozenset({"R1"}))
    assert [(r.record.run_id, r.record.score) for r in rows] == [("R2", 12.0)]


def test_withdrawing_nothing_changes_nothing():
    runs = [make_record(run_id="R1", user="alice")]
    assert len(leaderboard(runs)) == 1


# ── recovery must not resurrect it ───────────────────────────────────────

def test_recovery_does_not_bring_a_withdrawn_entry_back():
    """The sharp edge. Without this the button works until the next restart:
    the policy is still on the Hub, so the boot reconciliation re-races it."""
    found = [Candidate("alice/microduck-walk", "rev1", "alice", "walk", "legs", "sprint-2m")]
    withdrawn = [a_withdrawal(repo_id="alice/microduck-walk", revision="rev1")]
    assert plan(found, [SPRINT], lambda e: [], withdrawn) == []


def test_republishing_after_a_withdrawal_brings_it_back():
    """A new commit is a new revision, and publishing again should mean
    something. Suppression is keyed on the exact revision withdrawn."""
    found = [Candidate("alice/microduck-walk", "rev2", "alice", "walk", "legs", "sprint-2m")]
    withdrawn = [a_withdrawal(repo_id="alice/microduck-walk", revision="rev1")]
    work = plan(found, [SPRINT], lambda e: [], withdrawn)
    assert [c.revision for c, _ in work] == ["rev2"]


def test_a_withdrawal_of_a_local_upload_suppresses_nothing_on_the_hub():
    """An uploaded run has no repo, so its withdrawal must not accidentally
    suppress a Hub candidate whose repo_id happens to be None."""
    found = [Candidate("alice/microduck-walk", "rev1", "alice", "walk", "legs", "sprint-2m")]
    work = plan(found, [SPRINT], lambda e: [], [a_withdrawal()])
    assert len(work) == 1


# ── only your own, and only from the session ─────────────────────────────

@pytest.fixture
def spaced(tmp_path, monkeypatch):
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    monkeypatch.delenv("ARENA_RECOVER", raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app, base_url="https://testserver"), app


def sign_in(api, app, username):
    sid = app.state.sessions.create(username, 3600)
    api.cookies.set(COOKIE_NAME, sign(sid, app.state.config.session_secret))


def record_run(app, **over):
    record = make_record(**over)
    app.state.store.append(record, encode(np.zeros((5, 21), "f4")))
    return record


def test_you_can_withdraw_your_own_entry(spaced):
    api, app = spaced
    record = record_run(app, user="alice")
    sign_in(api, app, "alice")

    response = api.post(f"/api/runs/{record.run_id}/withdraw")
    assert response.status_code == 200, response.text
    assert response.json()["withdrawn"] == record.run_id
    assert api.get("/api/events/sprint-2m/leaderboard").json()["rows"] == []


def test_you_cannot_withdraw_someone_elses(spaced):
    """The rule that makes the button safe to show on every row."""
    api, app = spaced
    record = record_run(app, user="bob")
    sign_in(api, app, "alice")

    response = api.post(f"/api/runs/{record.run_id}/withdraw")
    assert response.status_code == 403
    assert "bob" in response.json()["detail"]
    assert len(api.get("/api/events/sprint-2m/leaderboard").json()["rows"]) == 1


def test_withdrawing_signed_out_is_refused(spaced):
    api, app = spaced
    record = record_run(app, user="alice")
    response = api.post(f"/api/runs/{record.run_id}/withdraw")
    assert response.status_code == 401
    assert response.json()["detail"] == "Please sign in with Hugging Face."
    assert len(api.get("/api/events/sprint-2m/leaderboard").json()["rows"]) == 1


def test_withdrawing_an_unknown_run_is_a_404(spaced):
    api, app = spaced
    sign_in(api, app, "alice")
    assert api.post("/api/runs/NOPE/withdraw").status_code == 404


def test_ownership_cannot_be_claimed_by_the_request(spaced):
    """Identity comes from the session and nothing else — not a form field, not
    a header, not a query parameter."""
    api, app = spaced
    record = record_run(app, user="bob")
    sign_in(api, app, "alice")

    for attempt in (
        {"data": {"user": "bob"}},
        {"params": {"user": "bob"}},
        {"headers": {"X-User": "bob"}},
    ):
        response = api.post(f"/api/runs/{record.run_id}/withdraw", **attempt)
        assert response.status_code == 403, attempt
