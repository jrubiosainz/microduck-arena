from fastapi.testclient import TestClient

from arena.manifest import all_events
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
    # The count of what is on the programme, not a fixed 3: health reports the
    # size of the programme, and the programme grows.
    assert body["events"] == len(all_events())
    assert body["events"] >= 3


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


def test_a_local_app_starts_without_reaching_for_the_hub(tmp_path, monkeypatch):
    """The whole local contract in one test: no account, no OAuth, no network.

    If a startup hook ever begins calling the Hub unconditionally, this fails —
    `arena.recover.recover` is replaced by something that records the attempt,
    and a local boot must not make it.
    """
    import arena.recover

    monkeypatch.delenv("ARENA_RECOVER", raising=False)
    attempts = []
    monkeypatch.setattr(arena.recover, "recover", lambda *a, **k: attempts.append(True))

    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    with TestClient(create_app(config)) as client:
        assert client.get("/api/health").status_code == 200
    assert attempts == []


def test_the_booth_says_why_it_is_off(tmp_path, monkeypatch):
    """The boot says the booth is off in one line, and must not blame the wrong
    thing: a bible nobody can load is not a missing token."""
    import arena.commentary as booth
    import arena.commentary.lore as bible

    def booted():
        return create_app(ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie"))

    def unreadable():
        raise ValueError("lore: characters must be exactly peter and ray")

    monkeypatch.setenv("ARENA_COMMENTARY", "0")
    assert booted().state.booth_off == "ARENA_COMMENTARY=0"

    monkeypatch.setenv("ARENA_COMMENTARY", "1")
    monkeypatch.setattr(booth, "hub_token", lambda config: None)
    assert booted().state.booth_off == "no Hub token"

    monkeypatch.setattr(booth, "hub_token", lambda config: "a token")
    assert booted().state.booth_off is None

    monkeypatch.setattr(bible, "load", unreadable)
    assert booted().state.booth_off == ("the commentators' bible does not load: "
                                        "lore: characters must be exactly peter and ray")
