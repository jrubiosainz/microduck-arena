import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def record_run(app, **overrides):
    record = make_record(**overrides)
    trace = np.zeros((5, 21), dtype=np.float32)
    app.state.store.append(record, encode(trace))
    return record


def test_events_lists_the_whole_programme_open_and_planned(client):
    """Pinned on WHICH events are raceable, not on how many exist. A test that
    counts events fails every time one is added, which teaches people to edit
    the number rather than read the assertion."""
    api, _ = client
    events = api.get("/api/events").json()["events"]
    by_status = {e["id"]: e["status"] for e in events}

    assert {i for i, s in by_status.items() if s == "open"} == {
        "sprint-2m",
        "roller-sprint-2m",
        "hill-climb-1m5",
    }
    # Planned events are on the programme too — the menu draws them as cards.
    assert {i for i, s in by_status.items() if s == "planned"}


def test_an_event_carries_what_the_page_needs_to_describe_it(client):
    api, _ = client
    sprint = next(e for e in api.get("/api/events").json()["events"] if e["id"] == "sprint-2m")
    assert sprint["title"] == "2 m Sprint"
    assert sprint["rig"] == "legs"
    assert sprint["length_m"] == 2.0
    # The frontend sizes the drawn course from this, so it has to be served.
    assert sprint["width_m"] == 0.8
    assert sprint["time_limit_s"] == 50.0
    assert sprint["seeds"] == 5
    # The page advertises the sweep, because "commanded 0.25 m/s" stopped being
    # true of the score the moment the harness started searching for the speed.
    assert sprint["sweep_lo"] == 0.20
    assert sprint["sweep_hi"] == 1.20
    assert sprint["sweep_step"] == 0.05
    assert sprint["sweep_count"] == 21
    assert "command_vx" not in sprint, "an event no longer pins one speed"
    assert sprint["slope_deg"] == 0.0


def test_the_hill_reports_its_slope(client):
    api, _ = client
    hill = next(
        e for e in api.get("/api/events").json()["events"] if e["id"] == "hill-climb-1m5"
    )
    assert hill["slope_deg"] == 8.0


def test_an_empty_leaderboard_is_an_empty_list_not_an_error(client):
    api, _ = client
    body = api.get("/api/events/sprint-2m/leaderboard").json()
    assert body["rows"] == []
    assert body["event"]["id"] == "sprint-2m"


def test_the_leaderboard_ranks_recorded_runs(client):
    """The slower run is recorded FIRST, deliberately.

    Runs are read back in run-id order, which is insertion order, so recording
    the winner first would let a route that returned records untouched pass this
    test by accident. Recording bob first means insertion order and rank order
    disagree, and only real ranking satisfies the assertion.
    """
    api, app = client
    record_run(app, user="bob", score=25.0, seeds_finished=4)
    record_run(app, user="alice", score=18.2, seeds_finished=5)

    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert [r["user"] for r in rows] == ["alice", "bob"]
    assert [r["rank"] for r in rows] == [1, 2]
    assert rows[0]["score"] == 18.2
    assert rows[0]["seeds_finished"] == 5
    assert rows[0]["seeds_total"] == 1  # make_record ships one seed result
    assert rows[0]["run_id"]


def test_only_the_best_run_of_an_entrant_is_returned(client):
    """Same person, same policy name: the better run replaces the worse one."""
    api, app = client
    record_run(app, user="alice", score=30.0)
    record_run(app, user="alice", score=19.0)
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert len(rows) == 1
    assert rows[0]["score"] == 19.0


def test_two_policies_from_one_user_both_appear(client):
    """The reported bug: submitting a second policy showed only one row.

    The app runs as a single local user, so ranking per PERSON collapsed every
    submission into one line and the head-to-head replay had nothing to race.
    """
    api, app = client
    record_run(app, user="coralie", policy_name="walker-v1", score=22.0)
    record_run(app, user="coralie", policy_name="walker-v2", score=19.0)

    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert [r["policy_name"] for r in rows] == ["walker-v2", "walker-v1"]
    assert [r["rank"] for r in rows] == [1, 2]


def test_runs_are_scoped_to_their_event(client):
    api, app = client
    record_run(app, user="alice", event_id="sprint-2m")
    record_run(app, user="bob", event_id="roller-sprint-2m")
    assert [r["user"] for r in api.get("/api/events/sprint-2m/leaderboard").json()["rows"]] == [
        "alice"
    ]
    assert [
        r["user"] for r in api.get("/api/events/roller-sprint-2m/leaderboard").json()["rows"]
    ] == ["bob"]


def test_an_unknown_event_is_a_404_with_a_reason(client):
    api, _ = client
    response = api.get("/api/events/nope/leaderboard")
    assert response.status_code == 404
    assert "no such event" in response.json()["detail"]


def test_a_published_policy_can_be_downloaded(client):
    """The point of the whole feature: race someone else's weights yourself."""
    api, app = client
    record = make_record(user="alice", policy_name="sprinter", model_stored=True)
    app.state.store.append(record, encode(np.zeros((5, 21), "f4")), b"the-onnx-bytes")

    response = api.get(f"/api/runs/{record.run_id}/policy")
    assert response.status_code == 200, response.text
    assert response.content == b"the-onnx-bytes"
    assert response.headers["content-disposition"] == (
        'attachment; filename="alice-sprinter.onnx"'
    )
    # The checksum travels with the file, so a download can be verified against
    # the record without trusting the store.
    assert response.headers["x-model-sha256"] == record.model_sha256


def test_downloading_a_run_recorded_before_policies_were_kept_404s(client):
    api, app = client
    record = record_run(app, user="alice")

    response = api.get(f"/api/runs/{record.run_id}/policy")
    assert response.status_code == 404
    # A real explanation, not FastAPI's bare 404: this run's weights are gone
    # for good and the person asking should know why.
    assert "before policies were kept" in response.json()["detail"]


def test_downloading_an_unknown_run_404s_with_the_run_id(client):
    api, _ = client
    response = api.get("/api/runs/NOPE/policy")
    assert response.status_code == 404
    # Distinguishes "no such run" from "run exists, no weights" — without this,
    # FastAPI's own 404 for an unrouted path would satisfy a status-only check.
    assert "no such run" in response.json()["detail"]


def test_the_leaderboard_says_which_rows_offer_a_download(client):
    api, app = client
    app.state.store.append(
        make_record(user="alice", score=12.0, model_stored=True),
        encode(np.zeros((5, 21), "f4")),
        b"onnx",
    )
    record_run(app, user="bob", score=13.0)

    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert {r["user"]: r["model_stored"] for r in rows} == {"alice": True, "bob": False}


@pytest.mark.parametrize(
    "policy_name,expected",
    [
        ("sprinter", "alice-sprinter.onnx"),
        # Path traversal, quote injection into the header, and unicode all have
        # to come out as a plain filename. This text is submitter-supplied and
        # lands in a Content-Disposition header and a person's filesystem.
        ("../../etc/passwd", "alice-etc-passwd.onnx"),
        ('a"; filename="evil', "alice-a-filename-evil.onnx"),
        ("run/../..", "alice-run.onnx"),
        # A dot in the stem is dropped rather than kept, which also rules out
        # `policy.onnx.exe` reaching someone's downloads folder.
        ("walker-v1.2", "alice-walker-v1-2.onnx"),
        ("evil.onnx.exe", "alice-evil-onnx-exe.onnx"),
        ("🦆", "alice.onnx"),
        ("", "alice.onnx"),
    ],
)
def test_a_download_filename_is_sanitised_not_trusted(policy_name, expected):
    from arena.web.routes_read import policy_filename

    assert policy_filename(policy_name, "alice") == expected


def test_a_download_filename_is_capped():
    from arena.web.routes_read import policy_filename

    name = policy_filename("x" * 500, "alice")
    assert len(name) <= 65
    assert name.endswith(".onnx")


def test_the_download_route_redirects_to_the_hub_for_a_hub_record(client):
    api, app = client
    record = make_record(
        user="alice",
        source={
            "kind": "hub",
            "repo_id": "alice/microduck-walker",
            "filename": "policy.onnx",
            "revision": "rev123",
            "url": "https://huggingface.co/alice/microduck-walker/resolve/rev123/policy.onnx",
        },
    )
    app.state.store.append(record, encode(np.zeros((5, 21), "f4")))

    response = api.get(f"/api/runs/{record.run_id}/policy", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == record.source["url"]


def test_a_local_upload_record_is_still_served_from_the_store(client):
    """The CLI and every pre-existing run. Both paths keep working."""
    api, app = client
    record = make_record(user="alice", model_stored=True)
    app.state.store.append(record, encode(np.zeros((5, 21), "f4")), b"the-onnx")
    response = api.get(f"/api/runs/{record.run_id}/policy")
    assert response.status_code == 200
    assert response.content == b"the-onnx"


def test_the_programme_is_served_in_its_declared_order(client):
    """Sorted once on the server, so every client reads the same programme."""
    api, _ = client
    events = api.get("/api/events").json()["events"]
    assert [e["id"] for e in events[:3]] == [
        "sprint-2m",
        "roller-sprint-2m",
        "hill-climb-1m5",
    ]
    assert [e["order"] for e in events] == sorted(e["order"] for e in events)
