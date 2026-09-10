import numpy as np
import pytest
from fastapi.testclient import TestClient

from arena.constants import TRACE_WIDTH
from arena.evaluate import SeedResult
from arena.trace import encode
from arena.web.app import create_app
from arena.web.config import ArenaConfig
from tests.test_store import make_record


@pytest.fixture
def client(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def a_trace(frames=7):
    """A trace whose every value is distinct, so a transpose or stride bug shows."""
    return np.arange(frames * TRACE_WIDTH, dtype=np.float32).reshape(frames, TRACE_WIDTH)


def test_run_detail_reports_the_per_seed_breakdown(client):
    api, app = client
    record = make_record(
        user="alice",
        per_seed=(
            SeedResult(seed=1, status="finish", time_s=18.46),
            SeedResult(seed=2, status="fall", time_s=None),
        ),
    )
    # 9, not the fixture's default: `frames` has to be derived from the stored
    # trace, and a hardcoded default would pass an assertion on the default.
    app.state.store.append(record, encode(a_trace(frames=9)))

    body = api.get(f"/api/runs/{record.run_id}").json()
    assert body["user"] == "alice"
    assert body["frames"] == 9
    assert [s["status"] for s in body["per_seed"]] == ["finish", "fall"]
    assert body["per_seed"][0]["time_s"] == 18.46
    assert body["per_seed"][1]["time_s"] is None


def test_the_trace_round_trips_as_float32(client):
    api, app = client
    record = make_record()
    original = a_trace(frames=11)
    app.state.store.append(record, encode(original))

    response = api.get(f"/api/runs/{record.run_id}/trace")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-frame-count"] == "11"

    restored = np.frombuffer(response.content, dtype="<f4").reshape(-1, TRACE_WIDTH)
    assert restored.shape == (11, TRACE_WIDTH)
    # float16 storage is lossy; these values are small integers so they survive.
    np.testing.assert_allclose(restored, original, rtol=0, atol=1e-2)


def test_the_trace_byte_length_matches_the_frame_count(client):
    api, app = client
    record = make_record()
    app.state.store.append(record, encode(a_trace(frames=13)))
    content = api.get(f"/api/runs/{record.run_id}/trace").content
    assert len(content) == 13 * TRACE_WIDTH * 4


def test_an_unknown_run_is_a_404(client):
    """Assert our message, not just the status.

    FastAPI 404s an unmapped path all by itself with `{"detail": "Not Found"}`,
    so a status-only assertion passes whether the route exists or not — it did
    exactly that before these routes were written. Only our own handler says
    "no such run", so checking the detail is what distinguishes a working route
    from a deleted one.
    """
    api, _ = client
    for path in ("/api/runs/01NOPE", "/api/runs/01NOPE/trace"):
        response = api.get(path)
        assert response.status_code == 404, path
        assert "no such run" in response.json()["detail"], path
