import pytest
from fastapi.testclient import TestClient

from arena.assets import ASSET_ROOT
from arena.policy import MAX_MODEL_BYTES
from arena.web.app import create_app
from arena.web.config import ArenaConfig

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"


@pytest.fixture
def store_dir(tmp_path):
    return tmp_path / "board"


@pytest.fixture
def api(store_dir):
    config = ArenaConfig.from_env(store_dir=store_dir, dev_user="coralie")
    return TestClient(create_app(config), base_url="https://testserver")


@pytest.fixture
def spaced_api(store_dir, monkeypatch):
    """A Space-like app: OAuth configured, so nobody is signed in by default."""
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    config = ArenaConfig.from_env(store_dir=store_dir, dev_user="coralie")
    return TestClient(create_app(config), base_url="https://testserver")


def sign_in(api, username="alice", token=None):
    """Put a real session in the app's table and hand the client its cookie."""
    from arena.web.session import COOKIE_NAME, sign

    app = api.app
    sid = app.state.sessions.create(username, token, 3600)
    api.cookies.set(COOKIE_NAME, sign(sid, app.state.config.session_secret))


def submit(api, path=REFERENCE, event="sprint-2m", name="walker"):
    with open(path, "rb") as fh:
        return api.post(
            f"/api/events/{event}/submit",
            files={"file": (path.name if hasattr(path, "name") else "p.onnx", fh)},
            data={"name": name},
        )


def test_the_reference_policy_scores_and_is_recorded(api):
    response = submit(api)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["user"] == "coralie"
    assert body["policy_name"] == "walker"
    assert body["seeds_finished"] == 5
    assert body["seeds_total"] == 5
    # v3 (MJCF position servos): 11.724 s at 0.40 m/s. v4 (BAM servos): re-measured.
    assert body["score"] == pytest.approx(7.988, rel=0.02)
    # The submitter is told which speed set the time, not just the time.
    assert body["command_vx"] == pytest.approx(0.55)
    assert len(body["per_seed"]) == 5
    assert body["trace_seed"] in {s["seed"] for s in body["per_seed"]}

    # It is on the board immediately — that is the whole point of submitting.
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert [r["user"] for r in rows] == ["coralie"]
    assert rows[0]["run_id"] == body["run_id"]
    # The score the submitter was told must be the score that got recorded. Without
    # this, a route that returned one number and stored another would pass.
    assert rows[0]["score"] == body["score"]
    assert rows[0]["seeds_finished"] == body["seeds_finished"]


def test_the_replay_of_a_fresh_submission_is_fetchable(api):
    run_id = submit(api).json()["run_id"]
    trace = api.get(f"/api/runs/{run_id}/trace")
    assert trace.status_code == 200
    assert int(trace.headers["x-frame-count"]) > 100
    # And the settle that led into it: the sprint's 0.5 s from the reset pose.
    settle = api.get(f"/api/runs/{run_id}/settle")
    assert settle.status_code == 200
    assert settle.headers["x-frame-count"] == "26"


def test_a_garbage_file_is_rejected_with_its_reason(api, tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    response = submit(api, path=junk)
    assert response.status_code == 400
    assert "not a loadable ONNX model" in response.json()["detail"]


def test_an_oversize_upload_is_refused_before_anything_is_written(api, tmp_path, store_dir):
    """Named for what this can actually prove.

    An earlier name claimed the upload was refused "without being evaluated",
    which the test never checked — only the status code. The size guard does run
    before the temp write and before `load_policy`, but a status assertion cannot
    demonstrate that. What it CAN demonstrate is that no partial state is left
    behind, which is the property that would actually hurt if violated.
    """
    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    response = submit(api, path=fat)
    assert response.status_code == 413
    assert "larger than" in response.json()["detail"]
    assert list(store_dir.rglob("*.json")) == []
    assert list(store_dir.rglob("*.npz")) == []


def test_submitting_to_an_unknown_event_is_a_404(api):
    """Assert our message, not just the status.

    An unmapped path 404s on its own, so a status-only assertion passes whether
    this route exists or not — it did exactly that before the route was written.
    Only the event loader says "no such event".
    """
    response = submit(api, event="nope")
    assert response.status_code == 404
    assert "no such event" in response.json()["detail"]


def test_an_absurd_policy_name_is_truncated(api):
    """Submitter-supplied text on a shared board needs a bound."""
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("p.onnx", fh)},
            data={"name": "x" * 5000},
        )
    assert len(response.json()["policy_name"]) == 80


def test_the_policy_name_defaults_to_the_filename(api):
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("my-sprinter.onnx", fh)},
        )
    assert response.json()["policy_name"] == "my-sprinter"


def test_nothing_is_recorded_when_a_submission_is_rejected(api, tmp_path):
    """The board stays empty — and for the right reason.

    Asserting only that the board is empty passes if the submission failed for
    ANY reason, including the route not existing at all, which is how this test
    passed before the route was written. Pinning the 400 and its message first
    makes the empty board mean "rejected cleanly, recorded nothing" rather than
    "something went wrong somewhere".
    """
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"nope")
    rejected = submit(api, path=junk)
    assert rejected.status_code == 400
    assert "not a loadable ONNX model" in rejected.json()["detail"]
    assert api.get("/api/events/sprint-2m/leaderboard").json()["rows"] == []


def try_it(api, path=REFERENCE, event="sprint-2m", name="trial", command_vx=None):
    data = {"name": name}
    if command_vx is not None:
        data["command_vx"] = command_vx
    with open(path, "rb") as fh:
        return api.post(
            f"/api/events/{event}/try",
            files={"file": (getattr(path, "name", "p.onnx"), fh)},
            data=data,
        )


def test_a_trial_scores_the_policy_without_recording_it(api, store_dir):
    """The point of a trial: measure against the standing board, publish nothing."""
    response = try_it(api)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["policy_name"] == "trial"
    assert body["seeds_finished"] == 5
    # v3 (MJCF position servos): 11.724 s at 0.40 m/s. v4 (BAM servos): re-measured.
    assert body["score"] == pytest.approx(7.988, rel=0.02)
    assert body["command_vx"] == pytest.approx(0.55)

    # Nothing on the board, and nothing on disk.
    assert api.get("/api/events/sprint-2m/leaderboard").json()["rows"] == []
    assert list(store_dir.rglob("*.json")) == []
    assert list(store_dir.rglob("*.npz")) == []


def test_a_trial_returns_a_watchable_trace_inline(api):
    """A trial is kept nowhere, so its trace has to travel in the response."""
    import base64

    from arena.constants import TRACE_WIDTH

    body = try_it(api).json()
    raw = base64.b64decode(body["trace_b64"])
    assert len(raw) % (TRACE_WIDTH * 4) == 0
    frames = len(raw) // (TRACE_WIDTH * 4)
    # v3 (MJCF position servos): ~11.7 s at 50 Hz, ~585 frames. v4 (BAM
    # servos): ~8.0 s, ~399 frames. Bounded on both sides against the event's
    # own limits and not the fixture default: below the finish time it would
    # not be a finish, and 50 s at 50 Hz is the hard ceiling.
    assert 350 < frames < 450


def test_a_trial_and_a_submission_give_the_same_time(api):
    """Why publishing can re-run instead of trusting the browser's numbers.

    Runs are deterministic, so re-evaluating on submit costs a second and
    returns the identical score — which is what lets a trial button exist
    without weakening "the server does the timing".
    """
    trialled = try_it(api).json()["score"]
    published = submit(api).json()["score"]
    assert trialled == published


def test_a_trial_rejects_a_bad_file_with_the_same_wording_as_a_submission(api, tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    response = try_it(api, path=junk)
    assert response.status_code == 400
    assert "not a loadable ONNX model" in response.json()["detail"]


def test_a_trial_on_an_unknown_event_is_a_404(api):
    response = try_it(api, event="nope")
    assert response.status_code == 404
    assert "no such event" in response.json()["detail"]


def test_an_oversize_trial_is_refused_too(api, tmp_path):
    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    assert try_it(api, path=fat).status_code == 413


def test_a_submission_remembers_its_livery(api):
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("p.onnx", fh)},
            data={"name": "purple-runner", "livery": "purple"},
        )
    assert response.json()["livery"] == "purple"

    # And the board serves it, so a replay can be drawn in the right colours.
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert rows[0]["livery"] == "purple"


def test_a_submission_without_a_livery_races_in_the_default(api):
    assert submit(api).json()["livery"] == "classic"


def test_a_trial_reports_the_livery_it_was_asked_for(api):
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/try",
            files={"file": ("p.onnx", fh)},
            data={"livery": "blue"},
        )
    assert response.json()["livery"] == "blue"


def test_an_absurd_livery_is_capped_rather_than_stored_whole(api):
    """Submitter-supplied text again. The viewer falls back for a name it does
    not know, so this only has to stay bounded."""
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("p.onnx", fh)},
            data={"livery": "z" * 500},
        )
    assert len(response.json()["livery"]) == 32


def test_a_trial_can_pin_one_speed_instead_of_sweeping(api):
    """What the sidebar's speed picker asks for: try this policy at this speed."""
    body = try_it(api, command_vx="0.30").json()
    assert body["command_vx"] == pytest.approx(0.30)
    # 0.30 is a real, slower result for this walker, not the sweep's 0.55 answer
    # — so this proves the pin took effect rather than being ignored.
    # v3 (MJCF position servos): 15.2 s. v4 (BAM servos): re-measured.
    assert body["score"] == pytest.approx(14.136, rel=0.05)
    assert body["seeds_finished"] == 5


def test_a_pinned_trial_is_faster_than_a_swept_one(api):
    """Why the pin exists at all: five runs instead of thirty-odd."""
    import time

    start = time.monotonic()
    try_it(api, command_vx="0.40")
    pinned = time.monotonic() - start

    start = time.monotonic()
    try_it(api)
    swept = time.monotonic() - start

    # Generous factor: this asserts the shape (one speed vs the whole range),
    # not a performance budget that a loaded CI box could fail on.
    assert pinned < swept / 2, f"pinned {pinned:.2f}s vs swept {swept:.2f}s"


def test_a_pinned_trial_at_the_sweeps_own_answer_agrees_with_it(api):
    """The two paths share the scoring code, so pinning the sweep's own answer
    must reproduce its number exactly. If these drift, one of them has its own
    arithmetic."""
    swept = try_it(api).json()
    pinned = try_it(api, command_vx=str(swept["command_vx"])).json()
    assert pinned["score"] == pytest.approx(swept["score"])
    assert pinned["per_seed"] == swept["per_seed"]


def test_a_speed_outside_the_events_range_is_clamped_not_rejected(api):
    """The picker is built from the event's range, so an out-of-range value is a
    stale page rather than an attack. Clamping keeps it usable."""
    body = try_it(api, command_vx="9.9").json()
    assert body["command_vx"] == pytest.approx(1.20)  # sprint-2m's sweep ceiling


def test_an_unparseable_speed_falls_back_to_the_sweep(api):
    body = try_it(api, command_vx="fast please").json()
    # The sweep's own answer for this policy, which is what "I don't know what
    # you asked for" should give you. v3 (MJCF position servos): 0.40. v4 (BAM
    # servos): re-measured.
    assert body["command_vx"] == pytest.approx(0.55)


def test_publishing_honours_a_pinned_speed(api):
    """Reversed deliberately. This test previously asserted the opposite — that a
    published time is always the full sweep — on the reasoning that letting
    entrants choose a speed ranks whoever guessed best.

    The arithmetic does not support that fear: the sweep already keeps the BEST
    time across every speed in the range, including the one you would have
    pinned, so pinning can only match or lose to sweeping. It is self-penalising.
    Here, 0.25 m/s scores ~18.2 s where the sweep finds ~8.0 s at 0.55 — the
    submitter is recorded slower for having pinned, which is the whole point.

    v3 (MJCF position servos): 18.216 s pinned, 11.724 s swept. v4 (BAM
    servos): re-measured; 0.25 m/s still lands near 18.2 s by coincidence, not
    because the physics agrees (arena/golden.py, arena/evaluate.py).
    """
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("w.onnx", fh)},
            data={"name": "pinned", "command_vx": "0.25"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["command_vx"] == pytest.approx(0.25)
    assert body["score"] == pytest.approx(18.208, rel=0.02)
    assert body["score"] > 7.988, "pinning must not be able to beat the sweep here"


def test_publishing_without_a_speed_still_sweeps(api):
    """The default is unchanged, and it is the comparable measurement."""
    response = submit(api, name="swept")
    assert response.status_code == 200, response.text
    body = response.json()
    # v3 (MJCF position servos): 0.40 m/s, 11.724 s. v4 (BAM servos): re-measured.
    assert body["command_vx"] == pytest.approx(0.55)
    assert body["score"] == pytest.approx(7.988, rel=0.02)


def test_testing_a_policy_signed_out_is_refused(spaced_api):
    response = try_it(spaced_api)
    assert response.status_code == 401
    assert "sign in" in response.json()["detail"].lower()


def test_publishing_signed_out_is_refused(spaced_api):
    with open(REFERENCE, "rb") as fh:
        response = spaced_api.post(
            "/api/events/sprint-2m/submit", files={"file": ("w.onnx", fh)}
        )
    assert response.status_code == 401


def test_a_signed_out_publish_is_refused_and_records_nothing(spaced_api, store_dir):
    """`try` never persists anything either way, so it can't tell this test
    apart from a gate that was never wired in. `submit` does persist, so this
    has to go through `submit` to be a claim that can actually fail."""
    with open(REFERENCE, "rb") as fh:
        response = spaced_api.post(
            "/api/events/sprint-2m/submit", files={"file": ("w.onnx", fh)}
        )
    assert response.status_code == 401
    assert list(store_dir.rglob("*.json")) == []
    assert list(store_dir.rglob("*.npz")) == []


def test_a_signed_in_run_is_recorded_under_the_hub_username(spaced_api):
    sign_in(spaced_api, username="alice")
    with open(REFERENCE, "rb") as fh:
        body = spaced_api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("w.onnx", fh)},
            data={"name": "walker"},
        ).json()
    # Not "guest", and not anything the browser supplied.
    assert body["user"] == "alice"


def test_the_local_path_still_needs_no_session_at_all(api):
    """With no OAuth configured, ARENA_DEV_USER races. This is the local run."""
    response = submit(api)
    assert response.status_code == 200
    assert response.json()["user"] == "coralie"


def test_a_hub_published_run_stores_no_weights_and_records_a_link(spaced_api, store_dir, monkeypatch):
    from arena.hub_publish import PublishedPolicy

    published = PublishedPolicy(
        repo_id="alice/microduck-walker",
        filename="policy.onnx",
        revision="rev123",
        url="https://huggingface.co/alice/microduck-walker/resolve/rev123/policy.onnx",
    )
    monkeypatch.setattr(
        "arena.web.routes_submit._publish_to_hub", lambda *a, **k: published
    )
    sign_in(spaced_api, username="alice", token="hf_tok")
    with open(REFERENCE, "rb") as fh:
        body = spaced_api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("w.onnx", fh)},
            data={"name": "walker"},
        ).json()

    assert body["policy_url"] == published.url
    # The whole point: the Space holds no weights on this path.
    assert not (store_dir / "models").exists()

    rows = spaced_api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert rows[0]["offers_download"] is True
    assert rows[0]["policy_url"] == published.url


def test_a_failed_hub_write_records_nothing_at_all(spaced_api, store_dir, monkeypatch):
    """A board row pointing at a repo that does not exist is worse than an error."""
    from arena.hub_publish import HubPublishError

    def boom(*args, **kwargs):
        raise HubPublishError("could not create alice/microduck-walker: 403 Forbidden")

    monkeypatch.setattr("arena.web.routes_submit._publish_to_hub", boom)
    sign_in(spaced_api, username="alice", token="hf_tok")
    with open(REFERENCE, "rb") as fh:
        response = spaced_api.post(
            "/api/events/sprint-2m/submit", files={"file": ("w.onnx", fh)}
        )
    assert response.status_code == 502
    assert "403 Forbidden" in response.json()["detail"]
    assert list(store_dir.rglob("*.json")) == []


def _fetched(path=REFERENCE, repo_id="alice/walker", filename="policy.onnx", revision="rev1"):
    from arena.hub_fetch import FetchedPolicy

    return FetchedPolicy(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        path=path,
        url=f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}",
    )


def test_a_repo_id_races_without_uploading_anything(api, store_dir, monkeypatch):
    """The whole point: give a reference, upload nothing, and it still scores."""
    fetched = _fetched()
    monkeypatch.setattr(
        "arena.web.routes_submit._fetch_from_hub", lambda repo_id: fetched
    )
    response = api.post(
        "/api/events/sprint-2m/submit",
        data={"repo_id": "alice/walker", "name": "someone else's walker"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # v3 (MJCF position servos): 11.724. v4 (BAM servos): re-measured.
    assert body["score"] == pytest.approx(7.988, rel=0.02)
    assert body["model_stored"] is False
    assert body["offers_download"] is True
    assert body["policy_url"] == fetched.url

    # Nothing was written to the store's model cache: the weights already
    # live with their author.
    assert not (store_dir / "models").exists()

    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert rows[0]["offers_download"] is True
    assert rows[0]["policy_url"] == fetched.url


def test_a_trial_can_race_a_repo_id_too(api, monkeypatch):
    fetched = _fetched()
    monkeypatch.setattr(
        "arena.web.routes_submit._fetch_from_hub", lambda repo_id: fetched
    )
    response = api.post(
        "/api/events/sprint-2m/try",
        data={"repo_id": "alice/walker"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # v3 (MJCF position servos): 11.724. v4 (BAM servos): re-measured.
    assert body["score"] == pytest.approx(7.988, rel=0.02)
    # A trial keeps nothing regardless of where the policy came from.
    assert body["policy_name"] == "policy"


def test_sending_both_a_file_and_a_repo_id_is_refused(api):
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("p.onnx", fh)},
            data={"repo_id": "alice/walker"},
        )
    assert response.status_code == 400
    assert "not both and not neither" in response.json()["detail"]


def test_sending_neither_a_file_nor_a_repo_id_is_refused(api):
    response = api.post("/api/events/sprint-2m/submit")
    assert response.status_code == 400
    assert "not both and not neither" in response.json()["detail"]


def test_an_unresolvable_repo_id_is_refused_with_its_reason(api, store_dir, monkeypatch):
    from arena.hub_fetch import FetchError

    def boom(repo_id):
        raise FetchError(f"{repo_id} has no .onnx file")

    monkeypatch.setattr("arena.web.routes_submit._fetch_from_hub", boom)
    response = api.post(
        "/api/events/sprint-2m/submit",
        data={"repo_id": "alice/empty"},
    )
    assert response.status_code == 400
    assert "has no .onnx file" in response.json()["detail"]
    assert api.get("/api/events/sprint-2m/leaderboard").json()["rows"] == []


def test_a_signed_in_repo_id_race_never_republishes_to_the_hub(spaced_api, monkeypatch):
    """A signed-in user with a Hub token, racing someone ELSE's repo id, must
    not have that policy republished into their own namespace — the weights
    already live with their author, at `fetched`'s repo."""
    fetched = _fetched()
    calls = []
    monkeypatch.setattr(
        "arena.web.routes_submit._fetch_from_hub", lambda repo_id: fetched
    )
    monkeypatch.setattr(
        "arena.web.routes_submit._publish_to_hub",
        lambda *a, **k: calls.append(a) or (_ for _ in ()).throw(
            AssertionError("_publish_to_hub must not be called for a repo_id entry")
        ),
    )
    sign_in(spaced_api, username="alice", token="hf_tok")
    response = spaced_api.post(
        "/api/events/sprint-2m/submit",
        data={"repo_id": "alice/walker", "name": "someone else's walker"},
    )
    assert response.status_code == 200, response.text
    assert calls == []
    body = response.json()
    # The recorded source names the FETCHED repo, not a republished one.
    assert body["policy_url"] == fetched.url


def test_a_policy_that_fails_validation_never_reaches_the_hub(spaced_api, tmp_path, monkeypatch):
    """Race first, publish second: nothing is written to someone's namespace
    until the harness has confirmed the file is a working policy."""
    reached = []
    monkeypatch.setattr(
        "arena.web.routes_submit._publish_to_hub",
        lambda *a, **k: reached.append(True),
    )
    sign_in(spaced_api, username="alice", token="hf_tok")
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    with open(junk, "rb") as fh:
        response = spaced_api.post(
            "/api/events/sprint-2m/submit", files={"file": ("junk.onnx", fh)}
        )
    assert response.status_code == 400
    assert reached == []


def test_a_planned_event_cannot_be_raced(api):
    """Its course is the sprint's, so a time recorded under its name would be a
    sprint time wearing another event's name — a false result on a shared board."""
    with open(REFERENCE, "rb") as fh:
        response = api.post("/api/events/highest-jump/submit", files={"file": ("w.onnx", fh)})
    assert response.status_code == 409
    assert "not open yet" in response.json()["detail"]


def test_a_planned_event_cannot_be_tried_either(api):
    """Both paths go through the same door, so neither can forget the guard."""
    response = try_it(api, event="highest-jump")
    assert response.status_code == 409


def test_a_planned_event_records_nothing(api, store_dir):
    with open(REFERENCE, "rb") as fh:
        api.post("/api/events/hold-your-ground/submit", files={"file": ("w.onnx", fh)})
    assert list(store_dir.rglob("*.json")) == []


def test_an_open_event_is_unaffected(api):
    assert submit(api).status_code == 200


def test_a_training_environment_link_is_recorded_and_served(api):
    with open(REFERENCE, "rb") as fh:
        body = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("w.onnx", fh)},
            data={"name": "linked", "env_url": "https://github.com/me/training-env"},
        ).json()
    assert body["run_id"]
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert rows[0]["env_url"] == "https://github.com/me/training-env"


def test_a_submission_without_a_link_simply_has_none(api):
    submit(api)
    rows = api.get("/api/events/sprint-2m/leaderboard").json()["rows"]
    assert rows[0]["env_url"] is None


def test_a_refused_link_is_a_400_and_costs_no_simulation(api, store_dir, monkeypatch):
    """Checked before racing: a link this server will refuse should not cost
    anyone thirty seconds of physics first — and the refusal says why."""
    import arena.web.routes_submit as routes

    raced = []
    monkeypatch.setattr(routes, "_load_and_evaluate", lambda *a, **k: raced.append(True))

    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("w.onnx", fh)},
            data={"env_url": "https://github.com.evil.com/x"},
        )
    assert response.status_code == 400
    assert "github.com.evil.com" in response.json()["detail"]
    assert raced == []
    assert list(store_dir.rglob("*.json")) == []
