from fastapi.testclient import TestClient

from arena.web.app import create_app
from arena.web.config import ArenaConfig


def client_for(tmp_path, **overrides):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie", **overrides)
    return TestClient(create_app(config))


def test_health_reports_the_user_and_event_count(tmp_path):
    body = client_for(tmp_path).get("/api/health").json()
    assert body["ok"] is True
    assert body["user"] == "coralie"
    # Three events ship with the engine: sprint, roller sprint, hill climb.
    assert body["events"] == 3


def test_the_store_is_created_when_the_app_starts(tmp_path):
    target = tmp_path / "made-on-boot"
    config = ArenaConfig.from_env(store_dir=target, dev_user="coralie")
    TestClient(create_app(config))
    assert target.is_dir()


def test_a_missing_frontend_is_reported_not_fatal(tmp_path):
    """The API must work before anyone has run a frontend build."""
    app_client = client_for(tmp_path, frontend_dir=tmp_path / "no-bundle-here")
    assert app_client.get("/api/health").status_code == 200
    root = app_client.get("/")
    assert root.status_code == 503
    assert "npm run build" in root.text


def test_the_frontend_is_served_when_present(tmp_path):
    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "index.html").write_text("<!doctype html><title>arena</title>")
    served = client_for(tmp_path, frontend_dir=bundle).get("/")
    assert served.status_code == 200
    assert "arena" in served.text


def test_the_index_is_never_cached(tmp_path):
    """index.html names the hashed bundle.

    A cached copy pins the browser to an old build, so every change looks like
    no change — which is exactly how an hour went missing chasing a render that
    had in fact already been fixed.
    """
    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "index.html").write_text("<!doctype html><title>arena</title>")
    response = client_for(tmp_path, frontend_dir=bundle).get("/")
    assert response.headers["cache-control"] == "no-store"
