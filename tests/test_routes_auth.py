import pytest
from fastapi.testclient import TestClient

from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.session import COOKIE_NAME, sign, unsign


@pytest.fixture
def local(tmp_path, monkeypatch):
    for key in ("OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "SPACE_HOST"):
        monkeypatch.delenv(key, raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app, base_url="https://testserver"), app


@pytest.fixture
def spaced(tmp_path, monkeypatch):
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    monkeypatch.setenv("OAUTH_SCOPES", "openid profile contribute-repos")
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app, base_url="https://testserver"), app


def test_with_no_oauth_the_dev_user_is_always_signed_in(local):
    """The local path. No account, no network, and you can still race."""
    api, _ = local
    body = api.get("/api/me").json()
    assert body["signed_in"] is True
    assert body["user"] == "coralie"
    assert body["oauth_enabled"] is False
    # No token, so nothing can be written to anyone's Hub namespace.
    assert body["can_publish_to_hub"] is False


def test_me_is_never_cached_because_its_body_is_per_user(local):
    """The one response whose body varies per user. Behind any shared cache,
    one person's identity could be served back to someone else."""
    api, _ = local
    response = api.get("/api/me")
    assert response.headers["cache-control"] == "no-store"


def test_on_a_space_you_start_signed_out(spaced):
    api, _ = spaced
    body = api.get("/api/me").json()
    assert body["signed_in"] is False
    assert body["user"] is None
    assert body["oauth_enabled"] is True


def test_login_redirects_to_the_provider_and_sets_a_state_cookie(spaced):
    api, _ = spaced
    response = api.get("/login", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    assert location.startswith("https://huggingface.co/oauth/authorize?")
    assert "contribute-repos" in location
    # The state is remembered in a signed cookie so the callback can verify it.
    assert "arena_oauth_state" in response.cookies


def test_login_with_no_oauth_configured_is_a_404_not_a_broken_redirect(local):
    api, _ = local
    assert api.get("/login", follow_redirects=False).status_code == 404


def test_a_callback_with_a_forged_state_is_refused(spaced):
    """Without this check the callback accepts a code from anywhere."""
    api, _ = spaced
    api.cookies.set("arena_oauth_state", sign("realstate", "csecret"))
    response = api.get("/login/callback?code=c&state=forged", follow_redirects=False)
    assert response.status_code == 400
    assert "state" in response.json()["detail"].lower()


def test_a_callback_with_no_state_cookie_is_refused(spaced):
    api, _ = spaced
    response = api.get("/login/callback?code=c&state=whatever", follow_redirects=False)
    assert response.status_code == 400


def test_a_successful_callback_signs_you_in_under_your_hub_name(spaced, monkeypatch):
    api, _app = spaced
    monkeypatch.setattr(
        "arena.web.routes_auth._exchange", lambda settings, code: "hf_tok"
    )
    monkeypatch.setattr(
        "arena.web.routes_auth._username", lambda settings, token: "alice"
    )
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/"

    body = api.get("/api/me").json()
    assert body["signed_in"] is True
    assert body["user"] == "alice"
    assert body["can_publish_to_hub"] is True


def test_the_oauth_token_never_reaches_the_browser(spaced, monkeypatch):
    """It grants contribute-repos on someone's account. It stays server-side."""
    api, _ = spaced
    monkeypatch.setattr(
        "arena.web.routes_auth._exchange", lambda settings, code: "hf_SECRETTOKEN"
    )
    monkeypatch.setattr(
        "arena.web.routes_auth._username", lambda settings, token: "alice"
    )
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert "hf_SECRETTOKEN" not in str(response.cookies)
    assert "hf_SECRETTOKEN" not in response.text
    assert "hf_SECRETTOKEN" not in api.get("/api/me").text


def test_a_failed_exchange_says_why_and_signs_nobody_in(spaced, monkeypatch):
    from arena.web.oauth import OAuthError

    api, _ = spaced

    def boom(settings, code):
        raise OAuthError("invalid_grant: code expired")

    monkeypatch.setattr("arena.web.routes_auth._exchange", boom)
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert response.status_code == 400
    assert "invalid_grant" in response.json()["detail"]
    assert api.get("/api/me").json()["signed_in"] is False


def test_logout_forgets_the_session(spaced, monkeypatch):
    api, app = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert api.get("/api/me").json()["signed_in"] is True

    # Keep the pre-logout cookie: logout must invalidate the session it names,
    # not just clear the browser's copy of the cookie.
    signed_cookie = api.cookies.get(COOKIE_NAME)
    sid = unsign(signed_cookie, "csecret")

    api.post("/logout")
    assert api.get("/api/me").json()["signed_in"] is False
    # The server-side session is actually gone, not merely unreferenced by the
    # client's (now-cleared) cookie jar.
    assert app.state.sessions.get(sid) is None

    # Replaying the pre-logout signed cookie must not sign you back in — if it
    # did, a stolen cookie would outlive the logout it was supposed to survive.
    api.cookies.set(COOKIE_NAME, signed_cookie)
    assert api.get("/api/me").json()["signed_in"] is False


def test_a_cookie_naming_an_unknown_session_is_simply_signed_out(spaced):
    api, _ = spaced
    api.cookies.set(COOKIE_NAME, sign("no-such-session", "csecret"))
    assert api.get("/api/me").json()["signed_in"] is False


def test_both_cookies_survive_the_spaces_iframe(spaced):
    """A Space is embedded from huggingface.co as an iframe over <name>.hf.space —
    two different registrable domains, so every cookie this app sets is a
    third-party one. A Lax cookie is never sent in that context, so the state
    cookie would not come back on the callback and signing in could not work at
    all. Asserted on both cookies, and on Secure staying with them: SameSite=None
    without Secure is rejected outright by browsers."""
    api, _ = spaced

    login = api.get("/login", follow_redirects=False)
    state_cookie = login.headers["set-cookie"]
    assert "samesite=none" in state_cookie.lower()
    assert "secure" in state_cookie.lower()
    assert "httponly" in state_cookie.lower()


def test_the_session_cookie_is_also_cross_site_and_secure(spaced, monkeypatch):
    api, _ = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)

    session_cookie = response.headers["set-cookie"]
    assert "samesite=none" in session_cookie.lower()
    assert "secure" in session_cookie.lower()
    assert "httponly" in session_cookie.lower()


# ── coming back to the page you signed in from ───────────────────────────

def test_login_remembers_where_you_were(spaced):
    api, _ = spaced
    response = api.get("/login?next=%2Fe%2Fsprint-2m", follow_redirects=False)
    assert response.status_code == 307
    assert "arena_oauth_return" in response.cookies


def test_signing_in_lands_back_on_the_race_page(spaced, monkeypatch):
    api, _ = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")

    api.get("/login?next=%2Fe%2Fsprint-2m", follow_redirects=False)
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    # The state cookie the real /login set is overwritten above, so re-sign the
    # return value the same way /login did.
    api.cookies.set("arena_oauth_return", sign("/#/e/sprint-2m", "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert response.headers["location"] == "/#/e/sprint-2m"


def test_signing_in_from_the_menu_still_lands_on_the_menu(spaced, monkeypatch):
    api, _ = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert response.headers["location"] == "/"


@pytest.mark.parametrize(
    "hostile",
    [
        "//evil.com",
        "https://evil.com",
        "http://evil.com",
        "/\\evil.com",
        "/e/../../etc/passwd",
        "javascript:alert(1)",
        "/login",
        "/e/x?a=b",
        "/e/" + "x" * 200,
    ],
)
def test_no_destination_from_the_client_can_name_a_host(spaced, hostile):
    """An open redirect is the whole hazard of remembering where someone was.

    The route never reaches the host position: the server matches it against the
    router's own shape and BUILDS the URL itself, so anything that is not a race
    route becomes the menu.
    """
    from arena.web.routes_auth import return_target

    assert return_target(hostile) == "/"


@pytest.mark.parametrize(
    "forged",
    ["//evil.com", "https://evil.com", "/#//evil.com", "/#/login", "/#/e/x?a=b"],
)
def test_a_forged_return_cookie_lands_on_the_menu(spaced, monkeypatch, forged):
    """Checked again on the way out. The signature proves this server wrote the
    value, not that the value was ever sanitised."""
    api, _ = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    # Signed with the server's own key — i.e. the strongest thing an attacker
    # could achieve short of the key itself.
    api.cookies.set("arena_oauth_return", sign(forged, "csecret"))
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert response.headers["location"] == "/"


def test_an_unsigned_return_cookie_is_ignored(spaced, monkeypatch):
    api, _ = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    api.cookies.set("arena_oauth_return", "/#/e/sprint-2m")
    response = api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert response.headers["location"] == "/"
