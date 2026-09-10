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
    return TestClient(create_app(config))


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
    assert body["score"] == pytest.approx(11.724, rel=0.02)
    # The submitter is told which speed set the time, not just the time.
    assert body["command_vx"] == pytest.approx(0.40)
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
    assert body["score"] == pytest.approx(11.724, rel=0.02)
    assert body["command_vx"] == pytest.approx(0.40)

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
    # ~11.7 s at 50 Hz, so ~585 frames. Bounded on both sides against the
    # event's own limits and not the fixture default: below the finish time it
    # would not be a finish, and 50 s at 50 Hz is the hard ceiling.
    assert 500 < frames < 700


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
    # 0.30 is a real, slower result for this walker, not the sweep's 0.40 answer
    # — so this proves the pin took effect rather than being ignored.
    assert body["score"] == pytest.approx(15.2, rel=0.05)
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
    """The two paths share the scoring code, so pinning 0.40 must reproduce the
    sweep's number exactly. If these drift, one of them has its own arithmetic."""
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
    # you asked for" should give you.
    assert body["command_vx"] == pytest.approx(0.40)


def test_publishing_always_sweeps_and_ignores_a_pinned_speed(api):
    """The board's integrity rule. A submitter who pins a speed they happen to
    be good at must not get that number recorded."""
    with open(REFERENCE, "rb") as fh:
        response = api.post(
            "/api/events/sprint-2m/submit",
            files={"file": ("w.onnx", fh)},
            data={"name": "sneaky", "command_vx": "0.25"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    # 0.25 would have scored 18.2s. The sweep's answer is what got recorded.
    assert body["command_vx"] == pytest.approx(0.40)
    assert body["score"] == pytest.approx(11.724, rel=0.02)
