# Identity and Hub-hosted policies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in with Hugging Face to race a policy; publishing writes the `.onnx` to the author's own public Hub repo and the board records a link to it.

**Architecture:** A signed opaque session cookie names a server-side session holding the HF username and OAuth token — the token never reaches the browser. `Test` and `Publish` require that session; watching does not. `Publish` races first, then commits `policy.onnx` + `manifest.json` to `<user>/microduck-<slug>` using the session's token, then records a run whose `source` is a Hub link. The Space stores no weights on that path. A repo id is also accepted as intake, which makes the 13 already-published community policies raceable.

**Tech Stack:** FastAPI, `huggingface_hub` (`HfApi.create_repo` / `create_commit` / `hf_hub_download`), stdlib `hmac`/`secrets` for cookies (no new dependency), vanilla ES modules + vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-arena-identity-and-policy-hosting-design.md`

## Global Constraints

- OAuth scope is **`contribute-repos`** and nothing wider. Never `write-repos`, never `manage-repos`.
- Repos created for authors are **public**, named `<user>/microduck-<slug>`, tagged **`microduck-policy`** and **`microduck`**.
- The written `manifest.json` declares `obs_len: 61`, `action_len: 14`, `action_scale: 1.0`, `entry_pose: "standing"`, `model_api: 1`, `robot.control_hz: 50`.
- The upload cap becomes **64 MiB** (`64 * 1024 * 1024`). It is raised, never removed.
- **`manifest.json` prose is never parsed.** No regex against free-text trained ranges.
- **`RUNNER_VERSION` is not touched by this plan.** Stage 4 of the spec (wider sweeps) is excluded and gets its own plan and its own bump.
- The OAuth access token is **never sent to the browser** and never written to disk.
- `ARENA_DEV_USER` must keep working with no OAuth configured at all — every local run depends on it.
- Python: `uv run pytest`. Frontend: `cd app && npx vitest run`. Both must be green before each commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `arena/web/session.py` (new) | Signed opaque cookie values, and the in-memory session table. No HTTP, no OAuth. |
| `arena/web/oauth.py` (new) | The HF OAuth endpoints as pure functions: authorize URL, token exchange, userinfo. No FastAPI. |
| `arena/web/routes_auth.py` (new) | `/login`, `/login/callback`, `/logout`, `/api/me`. |
| `arena/hub_publish.py` (new) | Commit a policy to an author's repo. Takes an API client so it is testable offline. |
| `arena/hub_fetch.py` (new) | Resolve a repo id to a local `.onnx`, size-checked. |
| `arena/web/config.py` | Gains the OAuth settings and `oauth_enabled`. |
| `arena/web/routes_submit.py` | Gains the session gate, the Hub-publish step, and repo-id intake. |
| `arena/web/routes_read.py` | The download route redirects for Hub records. |
| `arena/store.py` | `RunRecord.source` gains the `hub` shape; `offers_download` moves here. |
| `arena/policy.py` | The cap. |
| `app/src/session.js` (new) | `getMe()`, and the pure "what should the panel show" decision. |
| `app/src/race.js` | The three-state panel. |
| `app/src/submit.js` | The mirrored cap. |
| `app/src/board.js` | Uses `offers_download` from the API instead of deciding locally. |

---

### Task 1: Signed session cookies, and a session table

**Files:**
- Create: `arena/web/session.py`
- Test: `tests/test_session.py`

**Interfaces:**
- Produces: `sign(value: str, secret: str) -> str`, `unsign(signed: str, secret: str) -> str | None`, `Sessions` with `.create(username: str, token: str | None, ttl_s: float) -> str`, `.get(sid: str) -> Session | None`, `.drop(sid: str) -> None`, and `Session` (frozen dataclass: `username: str`, `token: str | None`, `expires_at: float`).

- [ ] **Step 1: Write the failing test**

```python
import time

import pytest

from arena.web.session import Sessions, sign, unsign


def test_a_signed_value_round_trips():
    assert unsign(sign("abc", "k"), "k") == "abc"


def test_a_tampered_value_is_rejected_not_repaired():
    signed = sign("abc", "k")
    assert unsign(signed[:-1] + ("X" if signed[-1] != "X" else "Y"), "k") is None


def test_a_value_signed_with_another_key_is_rejected():
    assert unsign(sign("abc", "k1"), "k2") is None


def test_a_value_with_no_signature_is_rejected():
    # The whole point: an attacker sets the cookie to a plain session id.
    assert unsign("abc", "k") is None


def test_comparison_is_constant_time():
    # hmac.compare_digest, not ==. Asserted by inspecting the source rather
    # than by timing, which would be flaky.
    import inspect

    from arena.web import session

    assert "compare_digest" in inspect.getsource(session.unsign)


def test_a_session_is_retrievable_by_its_id():
    sessions = Sessions()
    sid = sessions.create("alice", "hf_tok", ttl_s=60)
    found = sessions.get(sid)
    assert found.username == "alice"
    assert found.token == "hf_tok"


def test_session_ids_are_unguessable_and_unique():
    sessions = Sessions()
    ids = {sessions.create("alice", None, ttl_s=60) for _ in range(50)}
    assert len(ids) == 50
    assert all(len(i) >= 32 for i in ids)


def test_an_expired_session_is_gone_not_merely_stale():
    sessions = Sessions()
    sid = sessions.create("alice", "hf_tok", ttl_s=-1)
    assert sessions.get(sid) is None
    # And it is evicted, so a long-lived process does not accumulate them.
    assert sid not in sessions._by_id


def test_dropping_a_session_forgets_the_token():
    sessions = Sessions()
    sid = sessions.create("alice", "hf_tok", ttl_s=60)
    sessions.drop(sid)
    assert sessions.get(sid) is None


def test_an_unknown_session_id_is_none_not_an_error():
    assert Sessions().get("nope") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_session.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.web.session'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Sessions, and the cookie that names one.

The cookie carries an OPAQUE session id, never the OAuth token. The token grants
`contribute-repos` on someone's Hugging Face account, so it stays in this
process's memory and is never serialised to a browser or to disk.

The table is in memory on purpose. It costs a restart logging everyone out,
which for an 8-hour session on a Space that sleeps anyway is not worth a
database — and it means a leaked token has the lifetime of a process.
"""

import base64
import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass

COOKIE_NAME = "arena_session"


def _mac(value: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), value.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def sign(value: str, secret: str) -> str:
    return f"{value}.{_mac(value, secret)}"


def unsign(signed: str, secret: str) -> str | None:
    """The value, or None. Never raises: this reads attacker-controlled input."""
    value, _, mac = str(signed or "").rpartition(".")
    if not value or not mac:
        return None
    # compare_digest, not ==: a plain comparison leaks how much of the MAC
    # matched through its timing, one byte at a time.
    if not hmac.compare_digest(mac, _mac(value, secret)):
        return None
    return value


@dataclass(frozen=True)
class Session:
    username: str
    token: str | None
    expires_at: float


class Sessions:
    def __init__(self) -> None:
        self._by_id: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, username: str, token: str | None, ttl_s: float) -> str:
        sid = secrets.token_urlsafe(32)
        with self._lock:
            self._by_id[sid] = Session(username, token, time.time() + ttl_s)
        return sid

    def get(self, sid: str) -> Session | None:
        with self._lock:
            found = self._by_id.get(sid)
            if found is None:
                return None
            if found.expires_at <= time.time():
                # Evicted, not just reported stale, so a long-lived process
                # does not accumulate dead sessions holding dead tokens.
                del self._by_id[sid]
                return None
            return found

    def drop(self, sid: str) -> None:
        with self._lock:
            self._by_id.pop(sid, None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_session.py -v`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add arena/web/session.py tests/test_session.py
git commit -m "Sessions in memory, and a cookie that carries only an id"
```

---

### Task 2: The OAuth exchange, as pure functions

**Files:**
- Create: `arena/web/oauth.py`
- Test: `tests/test_oauth.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `OAuthSettings` (frozen dataclass: `client_id`, `client_secret`, `provider_url`, `redirect_uri`, `scopes: str`), `OAuthSettings.from_env(env: dict, space_host: str | None) -> OAuthSettings | None`, `authorize_url(settings, state: str) -> str`, `exchange_code(settings, code: str, post) -> str` returning the access token, `userinfo(settings, token: str, get) -> str` returning the username.

- [ ] **Step 1: Write the failing test**

```python
import pytest

from arena.web.oauth import OAuthSettings, authorize_url, exchange_code, userinfo

SETTINGS = OAuthSettings(
    client_id="cid",
    client_secret="csecret",
    provider_url="https://huggingface.co",
    redirect_uri="https://example.hf.space/login/callback",
    scopes="openid profile contribute-repos",
)


def test_no_oauth_configured_is_none_not_a_crash():
    # Every local run. The app must start with no OAuth at all.
    assert OAuthSettings.from_env({}, None) is None


def test_settings_come_from_the_variables_hf_injects():
    settings = OAuthSettings.from_env(
        {
            "OAUTH_CLIENT_ID": "cid",
            "OAUTH_CLIENT_SECRET": "csecret",
            "OPENID_PROVIDER_URL": "https://huggingface.co",
            "OAUTH_SCOPES": "openid profile contribute-repos",
        },
        "example.hf.space",
    )
    assert settings.client_id == "cid"
    assert settings.redirect_uri == "https://example.hf.space/login/callback"
    assert settings.scopes == "openid profile contribute-repos"


def test_a_client_id_without_a_secret_is_not_configured():
    # A half-set environment must not produce a broken login button.
    assert (
        OAuthSettings.from_env({"OAUTH_CLIENT_ID": "cid"}, "example.hf.space") is None
    )


def test_the_authorize_url_carries_state_and_the_redirect():
    url = authorize_url(SETTINGS, "st4te")
    assert url.startswith("https://huggingface.co/oauth/authorize?")
    assert "client_id=cid" in url
    assert "state=st4te" in url
    assert "response_type=code" in url
    # URL-encoded, not raw: a raw redirect_uri would truncate at the "?".
    assert "redirect_uri=https%3A%2F%2Fexample.hf.space%2Flogin%2Fcallback" in url


def test_the_secret_never_appears_in_the_authorize_url():
    assert "csecret" not in authorize_url(SETTINGS, "st4te")


def test_exchanging_a_code_posts_basic_auth_and_returns_the_token():
    seen = {}

    def post(url, data, headers):
        seen.update(url=url, data=data, headers=headers)
        return {"access_token": "hf_abc"}

    assert exchange_code(SETTINGS, "the-code", post) == "hf_abc"
    assert seen["url"] == "https://huggingface.co/oauth/token"
    assert seen["data"]["grant_type"] == "authorization_code"
    assert seen["data"]["code"] == "the-code"
    assert seen["data"]["redirect_uri"] == SETTINGS.redirect_uri
    # Basic base64(client_id:client_secret), per the Hub's documented flow.
    import base64

    expected = base64.b64encode(b"cid:csecret").decode()
    assert seen["headers"]["Authorization"] == f"Basic {expected}"
    # The secret goes in the header, not the form body.
    assert "client_secret" not in seen["data"]


def test_a_token_response_without_a_token_is_an_error_with_the_reason():
    def post(url, data, headers):
        return {"error": "invalid_grant", "error_description": "code expired"}

    with pytest.raises(OAuthError) as caught:
        exchange_code(SETTINGS, "stale", post)
    assert "invalid_grant" in str(caught.value)


def test_userinfo_returns_the_username_and_sends_the_bearer_token():
    seen = {}

    def get(url, headers):
        seen.update(url=url, headers=headers)
        return {"preferred_username": "alice", "name": "Alice A"}

    assert userinfo(SETTINGS, "hf_abc", get) == "alice"
    assert seen["url"] == "https://huggingface.co/oauth/userinfo"
    assert seen["headers"]["Authorization"] == "Bearer hf_abc"


def test_userinfo_falls_back_to_sub_when_there_is_no_username():
    def get(url, headers):
        return {"sub": "12345"}

    assert userinfo(SETTINGS, "hf_abc", get) == "12345"


def test_userinfo_with_no_identity_at_all_is_an_error():
    with pytest.raises(OAuthError):
        userinfo(SETTINGS, "hf_abc", lambda url, headers: {})
```

Add `from arena.web.oauth import OAuthError` to the imports at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_oauth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.web.oauth'`

- [ ] **Step 3: Write minimal implementation**

```python
"""The Hugging Face OAuth flow, with the HTTP handed in.

No FastAPI and no requests library here: `exchange_code` and `userinfo` take the
callable that performs the request, so the whole exchange is testable without a
network and without mocking a client library's internals.

Scopes are whatever HF says they are. `OAUTH_SCOPES` is injected by the Space
from the README's `hf_oauth_scopes`, so this file does not hard-code
`contribute-repos` — the README is the single place that decides it.
"""

import base64
from dataclasses import dataclass
from urllib.parse import urlencode


class OAuthError(Exception):
    """The provider refused, with a reason fit to show a human."""


@dataclass(frozen=True)
class OAuthSettings:
    client_id: str
    client_secret: str
    provider_url: str
    redirect_uri: str
    scopes: str

    @classmethod
    def from_env(cls, env: dict, space_host: str | None) -> "OAuthSettings | None":
        client_id = (env.get("OAUTH_CLIENT_ID") or "").strip()
        client_secret = (env.get("OAUTH_CLIENT_SECRET") or "").strip()
        # BOTH, or nothing. A half-set environment producing a login button that
        # cannot complete is worse than no button.
        if not client_id or not client_secret:
            return None
        provider = (env.get("OPENID_PROVIDER_URL") or "https://huggingface.co").rstrip("/")
        host = (space_host or env.get("SPACE_HOST") or "").strip()
        return cls(
            client_id=client_id,
            client_secret=client_secret,
            provider_url=provider,
            redirect_uri=f"https://{host}/login/callback",
            scopes=(env.get("OAUTH_SCOPES") or "openid profile").strip(),
        )


def authorize_url(settings: OAuthSettings, state: str) -> str:
    query = urlencode(
        {
            "client_id": settings.client_id,
            "redirect_uri": settings.redirect_uri,
            "scope": settings.scopes,
            "response_type": "code",
            "state": state,
        }
    )
    return f"{settings.provider_url}/oauth/authorize?{query}"


def exchange_code(settings: OAuthSettings, code: str, post) -> str:
    basic = base64.b64encode(
        f"{settings.client_id}:{settings.client_secret}".encode()
    ).decode()
    body = post(
        f"{settings.provider_url}/oauth/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.redirect_uri,
        },
        {"Authorization": f"Basic {basic}"},
    )
    token = (body or {}).get("access_token")
    if not token:
        reason = (body or {}).get("error") or "no access_token in the response"
        detail = (body or {}).get("error_description")
        raise OAuthError(f"{reason}{f': {detail}' if detail else ''}")
    return token


def userinfo(settings: OAuthSettings, token: str, get) -> str:
    body = get(
        f"{settings.provider_url}/oauth/userinfo",
        {"Authorization": f"Bearer {token}"},
    )
    name = (body or {}).get("preferred_username") or (body or {}).get("sub")
    if not name:
        raise OAuthError("the provider returned no username")
    return str(name)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_oauth.py -v`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add arena/web/oauth.py tests/test_oauth.py
git commit -m "The HF OAuth exchange, with the HTTP handed in so it is testable"
```

---

### Task 3: Config learns about OAuth

**Files:**
- Modify: `arena/web/config.py`
- Test: `tests/test_web_config.py`

**Interfaces:**
- Consumes: `OAuthSettings.from_env` (Task 2).
- Produces: `ArenaConfig.oauth: OAuthSettings | None`, `ArenaConfig.oauth_enabled -> bool`, `ArenaConfig.session_secret: str`, `ArenaConfig.session_ttl_s: float`.

- [ ] **Step 1: Write the failing test**

```python
def test_oauth_is_absent_by_default(tmp_path, monkeypatch):
    for key in ("OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "SPACE_HOST"):
        monkeypatch.delenv(key, raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.oauth is None
    assert config.oauth_enabled is False


def test_oauth_is_picked_up_from_the_spaces_variables(tmp_path, monkeypatch):
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    monkeypatch.setenv("OAUTH_SCOPES", "openid profile contribute-repos")
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.oauth_enabled is True
    assert config.oauth.redirect_uri == "https://example.hf.space/login/callback"


def test_the_session_secret_is_random_when_nothing_supplies_one(tmp_path, monkeypatch):
    monkeypatch.delenv("OAUTH_CLIENT_SECRET", raising=False)
    a = ArenaConfig.from_env(store_dir=tmp_path).session_secret
    b = ArenaConfig.from_env(store_dir=tmp_path).session_secret
    # Random per config, so cookies from a previous process are worthless.
    assert a != b
    assert len(a) >= 32


def test_the_session_secret_prefers_the_oauth_client_secret(tmp_path, monkeypatch):
    """So a Space's cookies survive its own workers, without a new secret to set."""
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.session_secret == "csecret"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_web_config.py -v -k oauth or session_secret`
Expected: FAIL with `AttributeError: 'ArenaConfig' object has no attribute 'oauth'`

- [ ] **Step 3: Write minimal implementation**

In `arena/web/config.py`, add the import and the fields:

```python
import secrets

from .oauth import OAuthSettings

# HF's own default is 8 hours. Matching it means the cookie and the token expire
# together, so there is no window where the session outlives its own token.
DEFAULT_SESSION_TTL_S = 8 * 60 * 60
```

Add to the dataclass:

```python
    oauth: OAuthSettings | None = None
    # Signs the session cookie. Defaults to the OAuth client secret, which every
    # Space already has and never changes across its workers; falls back to a
    # per-process random value locally, so cookies from a previous process are
    # worthless rather than replayable.
    session_secret: str = ""
    session_ttl_s: float = DEFAULT_SESSION_TTL_S

    @property
    def oauth_enabled(self) -> bool:
        return self.oauth is not None
```

In `from_env`, before the `return cls(...)`:

```python
        oauth = OAuthSettings.from_env(dict(os.environ), os.environ.get("SPACE_HOST"))
        secret = (os.environ.get("OAUTH_CLIENT_SECRET") or "").strip() or secrets.token_urlsafe(32)
```

and pass `oauth=oauth, session_secret=secret` into `cls(...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_web_config.py -v`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add arena/web/config.py tests/test_web_config.py
git commit -m "Config learns about OAuth, and where the cookie secret comes from"
```

---

### Task 4: The auth routes

**Files:**
- Create: `arena/web/routes_auth.py`
- Modify: `arena/web/app.py`
- Test: `tests/test_routes_auth.py`

**Interfaces:**
- Consumes: `Sessions`, `sign`, `unsign`, `COOKIE_NAME` (Task 1); `authorize_url`, `exchange_code`, `userinfo`, `OAuthError` (Task 2); `ArenaConfig.oauth`, `.session_secret`, `.session_ttl_s` (Task 3).
- Produces: `router` mounted by `create_app`; `current_user(request) -> Session | None`; `app.state.sessions: Sessions`. `GET /api/me` returns `{"signed_in": bool, "user": str | None, "can_publish_to_hub": bool, "oauth_enabled": bool}`.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from fastapi.testclient import TestClient

from arena.web.app import create_app
from arena.web.config import ArenaConfig
from arena.web.session import COOKIE_NAME, sign


@pytest.fixture
def local(tmp_path, monkeypatch):
    for key in ("OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "SPACE_HOST"):
        monkeypatch.delenv(key, raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


@pytest.fixture
def spaced(tmp_path, monkeypatch):
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    monkeypatch.setenv("OAUTH_SCOPES", "openid profile contribute-repos")
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    app = create_app(config)
    return TestClient(app), app


def test_with_no_oauth_the_dev_user_is_always_signed_in(local):
    """The local path. No account, no network, and you can still race."""
    api, _ = local
    body = api.get("/api/me").json()
    assert body["signed_in"] is True
    assert body["user"] == "coralie"
    assert body["oauth_enabled"] is False
    # No token, so nothing can be written to anyone's Hub namespace.
    assert body["can_publish_to_hub"] is False


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
    api, app = spaced
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
    api, _ = spaced
    monkeypatch.setattr("arena.web.routes_auth._exchange", lambda s, c: "hf_tok")
    monkeypatch.setattr("arena.web.routes_auth._username", lambda s, t: "alice")
    api.cookies.set("arena_oauth_state", sign("st4te", "csecret"))
    api.get("/login/callback?code=c&state=st4te", follow_redirects=False)
    assert api.get("/api/me").json()["signed_in"] is True

    api.post("/logout")
    assert api.get("/api/me").json()["signed_in"] is False


def test_a_cookie_naming_an_unknown_session_is_simply_signed_out(spaced):
    api, _ = spaced
    api.cookies.set(COOKIE_NAME, sign("no-such-session", "csecret"))
    assert api.get("/api/me").json()["signed_in"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_routes_auth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.web.routes_auth'`

- [ ] **Step 3: Write minimal implementation**

Create `arena/web/routes_auth.py`:

```python
"""Signing in, and who the server thinks you are.

Two identity paths, and the split is the original spec's requirement: with OAuth
configured the session names a real Hugging Face user and carries their token;
with no OAuth at all — every local run — `ARENA_DEV_USER` is treated as
permanently signed in and there is no token, so nothing can be written to
anyone's Hub namespace.

`current_user` is the one place either path is resolved, so no route has to know
which world it is in.
"""

import secrets

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .oauth import OAuthError, authorize_url, exchange_code, userinfo
from .session import COOKIE_NAME, Session, sign, unsign

STATE_COOKIE = "arena_oauth_state"
router = APIRouter()


def _exchange(settings, code: str) -> str:
    """Wrapped so tests can replace the network without mocking httpx."""

    def post(url, data, headers):
        return httpx.post(url, data=data, headers=headers, timeout=20).json()

    return exchange_code(settings, code, post)


def _username(settings, token: str) -> str:
    def get(url, headers):
        return httpx.get(url, headers=headers, timeout=20).json()

    return userinfo(settings, token, get)


def current_user(request: Request) -> Session | None:
    """The signed-in user, or None. The only resolver either path goes through."""
    config = request.app.state.config
    if not config.oauth_enabled:
        # Local: ARENA_DEV_USER is always signed in, and has no token.
        return Session(username=config.dev_user, token=None, expires_at=float("inf"))
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        return None
    sid = unsign(raw, config.session_secret)
    if not sid:
        return None
    return request.app.state.sessions.get(sid)


@router.get("/api/me")
def me(request: Request) -> dict:
    config = request.app.state.config
    session = current_user(request)
    return {
        "signed_in": session is not None,
        "user": session.username if session else None,
        # Publishing to the author's own repo needs their OAuth token. The local
        # path has none, so it publishes to the local store instead.
        "can_publish_to_hub": bool(session and session.token),
        "oauth_enabled": config.oauth_enabled,
    }


@router.get("/login")
def login(request: Request) -> RedirectResponse:
    config = request.app.state.config
    if not config.oauth_enabled:
        raise HTTPException(status_code=404, detail="this deployment has no OAuth")
    state = secrets.token_urlsafe(24)
    response = RedirectResponse(authorize_url(config.oauth, state))
    # Signed, and short-lived: this is the only thing that ties the callback to
    # a login this server actually started.
    response.set_cookie(
        STATE_COOKIE,
        sign(state, config.session_secret),
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=True,
    )
    return response


@router.get("/login/callback")
def callback(request: Request, code: str = "", state: str = "") -> RedirectResponse:
    config = request.app.state.config
    if not config.oauth_enabled:
        raise HTTPException(status_code=404, detail="this deployment has no OAuth")

    expected = unsign(request.cookies.get(STATE_COOKIE, ""), config.session_secret)
    if not expected or not state or state != expected:
        raise HTTPException(status_code=400, detail="the OAuth state did not match")
    if not code:
        raise HTTPException(status_code=400, detail="the provider returned no code")

    try:
        token = _exchange(config.oauth, code)
        username = _username(config.oauth, token)
    except OAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    sid = request.app.state.sessions.create(username, token, config.session_ttl_s)
    response = RedirectResponse("/")
    response.set_cookie(
        COOKIE_NAME,
        sign(sid, config.session_secret),
        max_age=int(config.session_ttl_s),
        httponly=True,
        samesite="lax",
        secure=True,
    )
    response.delete_cookie(STATE_COOKIE)
    return response


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    config = request.app.state.config
    raw = request.cookies.get(COOKIE_NAME)
    if raw:
        sid = unsign(raw, config.session_secret)
        if sid:
            request.app.state.sessions.drop(sid)
    response.delete_cookie(COOKIE_NAME)
    return {"signed_in": False}
```

In `arena/web/app.py`, add the import, the session table, and the router **before** the `StaticFiles` mount:

```python
from .routes_auth import router as auth_router
from .session import Sessions
```

```python
    app.state.sessions = Sessions()
```

```python
    app.include_router(auth_router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_routes_auth.py -v`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_auth.py arena/web/app.py tests/test_routes_auth.py
git commit -m "Sign in with Hugging Face, with the token kept server-side"
```

---

### Task 5: Racing requires a session

**Files:**
- Modify: `arena/web/routes_submit.py`
- Test: `tests/test_routes_submit.py`

**Interfaces:**
- Consumes: `current_user` (Task 4).
- Produces: `_require_session(request) -> Session` raising 401; both `/try` and `/submit` take `request: Request` and record `session.username`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_routes_submit.py`:

```python
@pytest.fixture
def spaced_api(store_dir, monkeypatch):
    """A Space-like app: OAuth configured, so nobody is signed in by default."""
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("SPACE_HOST", "example.hf.space")
    config = ArenaConfig.from_env(store_dir=store_dir, dev_user="coralie")
    return TestClient(create_app(config))


def sign_in(api, username="alice", token="hf_tok"):
    """Put a real session in the app's table and hand the client its cookie."""
    from arena.web.session import COOKIE_NAME, sign

    app = api.app
    sid = app.state.sessions.create(username, token, 3600)
    api.cookies.set(COOKIE_NAME, sign(sid, app.state.config.session_secret))


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


def test_a_signed_out_refusal_records_nothing(spaced_api, store_dir):
    try_it(spaced_api)
    assert list(store_dir.rglob("*.json")) == []


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_routes_submit.py -v -k signed`
Expected: FAIL — `try` returns 200 rather than 401

- [ ] **Step 3: Write minimal implementation**

In `arena/web/routes_submit.py`:

```python
from .routes_auth import current_user
from .session import Session
```

```python
def _require_session(request: Request) -> Session:
    """Racing costs CPU and publishing writes to a namespace. Both need a name.

    Watching does not: the board, the replays and the downloads are open to
    anyone who can open the page.
    """
    session = current_user(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Please sign in to race a policy.")
    return session
```

Add `request: Request` to `try_policy`'s signature, call `session = _require_session(request)` first, and use `session.username` in place of `config.dev_user` in `submit`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_routes_submit.py -v`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_submit.py tests/test_routes_submit.py
git commit -m "Racing needs a name; watching still needs nothing"
```

---

### Task 6: The three-state entry panel

**Files:**
- Create: `app/src/session.js`, `app/src/session.test.js`
- Modify: `app/src/race.js`, `app/src/api.js`

**Interfaces:**
- Consumes: `GET /api/me` (Task 4).
- Produces: `getMe()` in `api.js`; `panelState(me) -> "signed-out" | "ready" | "no-hub"` and `signInHref()` in `session.js`.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from "vitest";
import { panelState } from "./session.js";

describe("panelState", () => {
  it("asks for a sign-in when OAuth is on and nobody is signed in", () => {
    expect(panelState({ signed_in: false, oauth_enabled: true })).toBe("signed-out");
  });

  it("is ready when signed in with a Hub token", () => {
    expect(
      panelState({ signed_in: true, oauth_enabled: true, can_publish_to_hub: true }),
    ).toBe("ready");
  });

  it("is ready locally, where there is no OAuth and no token", () => {
    // The local run: ARENA_DEV_USER is signed in and publishes to the local
    // store. A sign-in button here would be a dead end.
    expect(
      panelState({
        signed_in: true,
        oauth_enabled: false,
        can_publish_to_hub: false,
        user: "coralie",
      }),
    ).toBe("ready");
  });

  it("distinguishes signed-in-without-a-token on a Space", () => {
    // Publishing needs the token. Racing does not, so this is its own state
    // rather than being lumped in with signed-out.
    expect(
      panelState({ signed_in: true, oauth_enabled: true, can_publish_to_hub: false }),
    ).toBe("no-hub");
  });

  it("treats a missing or failed /api/me as signed out rather than crashing", () => {
    expect(panelState(null)).toBe("signed-out");
    expect(panelState(undefined)).toBe("signed-out");
    expect(panelState({})).toBe("signed-out");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/session.test.js`
Expected: FAIL — cannot resolve `./session.js`

- [ ] **Step 3: Write minimal implementation**

`app/src/session.js`:

```javascript
// Who the server thinks you are, and what the entry panel should therefore show.
//
// Kept pure and separate from the DOM so the rule is testable: three states, and
// the difference between them decides whether the dropzone exists at all.

/**
 * Which of the three panels to render.
 *
 * `no-hub` is deliberately its own state rather than being folded into
 * `signed-out`: on a Space you can be signed in and still lack a Hub token, and
 * in that case you can race but not publish. Locally there is no OAuth at all
 * and no token by design, which is `ready` — a sign-in button there is a dead
 * end.
 */
export function panelState(me) {
  if (!me || !me.signed_in) return "signed-out";
  if (me.oauth_enabled && !me.can_publish_to_hub) return "no-hub";
  return "ready";
}

export const signInHref = () => "/login";
```

In `app/src/api.js`:

```javascript
/** Who the server thinks you are. Never throws: a failure means signed out. */
export async function getMe() {
  try {
    return await json("/api/me");
  } catch {
    return null;
  }
}
```

In `app/src/race.js`, replace the static `<aside class="entry">` contents with a container the code fills per state, and render it from `getMe()`. The signed-out branch:

```javascript
  function renderEntry(me) {
    const state = panelState(me);
    if (state === "signed-out") {
      entry.innerHTML = `
        <p class="entry__lead">Sign in to race a policy.</p>
        <a class="entry__signin" href="${signInHref()}" target="_blank" rel="noopener">
          Sign in with Hugging Face
        </a>
        <p class="entry__consent">
          Watching costs nothing — the board, the replays and the downloads are
          open. Signing in is only needed to test or publish.
        </p>
      `;
      return;
    }
    // ... the existing controls, plus `me.user` shown, and Publish disabled
    // with an explanation when state === "no-hub".
  }
```

Per HF's documented warning, the sign-in link uses `target="_blank"` because a Space runs inside an iframe and some browsers drop the cookie otherwise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add app/src/session.js app/src/session.test.js app/src/race.js app/src/api.js
git commit -m "The entry panel is a sign-in button until you are signed in"
```

---

### Task 7: The cap rises to 64 MiB

**Files:**
- Modify: `arena/policy.py:18`, `app/src/submit.js:10`
- Test: `tests/test_policy.py`

**Interfaces:**
- Produces: `MAX_MODEL_BYTES = 64 * 1024 * 1024`.

- [ ] **Step 1: Write the failing test**

```python
def test_the_cap_admits_the_largest_real_community_policy():
    """Measured: juicenv/duckwing-v80-roller-skating is 8.4 MB, and the old
    4 MiB cap rejected it. The cap is raised, not removed — an unbounded upload
    to a shared 2-vCPU Space is a denial-of-service vector."""
    from arena.policy import MAX_MODEL_BYTES

    assert MAX_MODEL_BYTES == 64 * 1024 * 1024
    assert MAX_MODEL_BYTES > 8_409_525


def test_an_oversize_model_is_still_refused_with_its_size(tmp_path):
    from arena.policy import MAX_MODEL_BYTES, PolicyError, load_policy

    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    with pytest.raises(PolicyError, match="larger than"):
        load_policy(fat)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_policy.py -v -k cap or oversize`
Expected: FAIL — `assert 4194304 == 67108864`

- [ ] **Step 3: Write minimal implementation**

`arena/policy.py`:

```python
# 64 MiB. Raised from 4 MiB, which rejected real community policies — the
# roller-skating one on the Hub is 8.4 MB. Raised rather than removed: an
# unbounded upload to a shared 2-vCPU Space is a denial-of-service vector, not
# a feature.
MAX_MODEL_BYTES = 64 * 1024 * 1024
```

`app/src/submit.js`:

```javascript
const MAX_BYTES = 64 * 1024 * 1024; // mirrors arena.policy.MAX_MODEL_BYTES
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_policy.py -v && cd app && npx vitest run src/submit.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add arena/policy.py app/src/submit.js tests/test_policy.py
git commit -m "Raise the model cap to 64 MiB: 4 MiB rejected real policies"
```

---

### Task 8: Commit a policy to its author's repo

**Files:**
- Create: `arena/hub_publish.py`
- Test: `tests/test_hub_publish.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `slugify(name: str) -> str`, `policy_manifest(name: str, rig: str) -> dict`, `publish_policy(api, username: str, name: str, blob: bytes, rig: str) -> PublishedPolicy`, and `PublishedPolicy` (frozen dataclass: `repo_id: str`, `filename: str`, `revision: str`, `url: str`).

- [ ] **Step 1: Write the failing test**

```python
import json

import pytest

from arena.hub_publish import (
    POLICY_FILENAME,
    PublishedPolicy,
    policy_manifest,
    publish_policy,
    slugify,
)


class FakeApi:
    """Records what would have been sent. No network, no huggingface_hub."""

    def __init__(self, create_error=None, commit_error=None):
        self.created = []
        self.commits = []
        self._create_error = create_error
        self._commit_error = commit_error

    def create_repo(self, repo_id, repo_type=None, private=None, exist_ok=None):
        if self._create_error:
            raise self._create_error
        self.created.append((repo_id, repo_type, private, exist_ok))

    def create_commit(self, repo_id, repo_type=None, operations=None, commit_message=None):
        if self._commit_error:
            raise self._commit_error
        self.commits.append((repo_id, repo_type, operations, commit_message))

        class Result:
            oid = "abc123def456"

        return Result()


@pytest.mark.parametrize(
    "name,expected",
    [
        ("walker v1", "walker-v1"),
        ("Rough Walk E", "rough-walk-e"),
        ("../../etc/passwd", "etc-passwd"),
        ("a" * 100, "a" * 60),
        ("🦆", "policy"),
        ("", "policy"),
        ("  spaced  ", "spaced"),
    ],
)
def test_a_repo_slug_is_derived_safely_from_a_submitted_name(name, expected):
    """This becomes a path segment in someone's Hub namespace, so it is
    sanitised rather than trusted."""
    assert slugify(name) == expected


def test_the_repo_is_public_and_named_after_the_author_and_the_policy():
    api = FakeApi()
    published = publish_policy(api, "alice", "Rough Walk E", b"onnx", rig="legs")
    assert published.repo_id == "alice/microduck-rough-walk-e"
    repo_id, repo_type, private, exist_ok = api.created[0]
    assert repo_id == "alice/microduck-rough-walk-e"
    assert repo_type == "model"
    # Public, or nobody else could ever download it — see the spec.
    assert private is False
    # Republishing the same name must be a new commit, not an error.
    assert exist_ok is True


def test_it_commits_the_onnx_and_a_manifest_and_returns_the_revision():
    api = FakeApi()
    published = publish_policy(api, "alice", "walker", b"the-onnx", rig="legs")
    assert published.filename == POLICY_FILENAME == "policy.onnx"
    assert published.revision == "abc123def456"
    assert published.url == (
        "https://huggingface.co/alice/microduck-walker/resolve/abc123def456/policy.onnx"
    )

    _, _, operations, message = api.commits[0]
    paths = {op.path_in_repo for op in operations}
    assert paths == {"policy.onnx", "manifest.json", "README.md"}
    assert "walker" in message


def test_the_committed_manifest_declares_the_contract_the_community_declares():
    api = FakeApi()
    publish_policy(api, "alice", "walker", b"onnx", rig="legs")
    _, _, operations, _ = api.commits[0]
    manifest_op = next(op for op in operations if op.path_in_repo == "manifest.json")
    manifest = json.loads(bytes(manifest_op.path_or_fileobj).decode())
    assert manifest["obs_len"] == 61
    assert manifest["action_len"] == 14
    assert manifest["action_scale"] == 1.0
    assert manifest["entry_pose"] == "standing"
    assert manifest["model_api"] == 1
    assert manifest["robot"]["control_hz"] == 50


def test_the_manifest_names_the_rig_the_policy_was_scored_on():
    assert policy_manifest("w", "legs")["robot"]["model"] == "microduck"
    assert (
        policy_manifest("w", "rollers")["robot"]["model"] == "microduck passive rollers"
    )


def test_the_readme_carries_the_tags_the_ecosystem_searches_by():
    """14 repos are already discoverable under `microduck-policy`. Joining that
    convention is the point; inventing a new tag would not be."""
    api = FakeApi()
    publish_policy(api, "alice", "walker", b"onnx", rig="legs")
    _, _, operations, _ = api.commits[0]
    readme = next(op for op in operations if op.path_in_repo == "README.md")
    text = bytes(readme.path_or_fileobj).decode()
    assert "microduck-policy" in text
    assert "- microduck\n" in text
    assert "onnx" in text


def test_a_refused_repo_creation_raises_with_the_hubs_own_reason():
    from arena.hub_publish import HubPublishError

    api = FakeApi(create_error=RuntimeError("403 Forbidden"))
    with pytest.raises(HubPublishError, match="403 Forbidden"):
        publish_policy(api, "alice", "walker", b"onnx", rig="legs")


def test_a_failed_commit_raises_rather_than_returning_a_bad_link():
    from arena.hub_publish import HubPublishError

    api = FakeApi(commit_error=RuntimeError("network is unreachable"))
    with pytest.raises(HubPublishError, match="unreachable"):
        publish_policy(api, "alice", "walker", b"onnx", rig="legs")


def test_a_commit_with_no_revision_is_an_error_not_a_dangling_url():
    from arena.hub_publish import HubPublishError

    class NoOid(FakeApi):
        def create_commit(self, **kwargs):
            super().create_commit(**kwargs)

            class Result:
                oid = None

            return Result()

    with pytest.raises(HubPublishError, match="revision"):
        publish_policy(NoOid(), "alice", "walker", b"onnx", rig="legs")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_hub_publish.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.hub_publish'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Publish a policy to its AUTHOR's Hugging Face repo.

The Space keeps no weights. Publishing writes `policy.onnx` to
`<user>/microduck-<slug>` with the author's own OAuth token and records a link,
so the policy is attributed to them, versioned by them, and downloadable onto a
real duck by anyone.

Two conventions are copied from what is already on the Hub rather than invented:
`policy.onnx` at the repo root, and a `manifest.json` declaring the contract.
14 repos already carry the `microduck-policy` tag; joining that is the point.

`api` is handed in — an `HfApi` in production, a recorder in tests — so none of
this needs a network to be tested.
"""

import json
import re
from dataclasses import dataclass

from .constants import ACTION_SCALE, CTRL_DT, NUM_JOINTS, OBS_SIZE

POLICY_FILENAME = "policy.onnx"
MANIFEST_FILENAME = "manifest.json"
# The tag the ecosystem already searches by, plus the broader one.
TAGS = ("microduck-policy", "microduck", "onnx", "robotics")
_UNSAFE = re.compile(r"[^a-z0-9]+")
# MJCF rig name -> the string the community manifests use.
RIG_MODEL = {"legs": "microduck", "rollers": "microduck passive rollers"}


class HubPublishError(Exception):
    """Writing to the author's repo failed, with a reason fit to show them."""


@dataclass(frozen=True)
class PublishedPolicy:
    repo_id: str
    filename: str
    revision: str
    url: str


def slugify(name: str) -> str:
    """A safe repo-name segment from a submitted policy name.

    This lands in someone's Hub namespace as a path, so it is sanitised rather
    than trusted: no dots, no slashes, no traversal, and a length bound.
    """
    slug = _UNSAFE.sub("-", str(name or "").lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:60].strip("-")
    return slug or "policy"


def policy_manifest(name: str, rig: str) -> dict:
    """The contract, in the shape the community already declares it."""
    return {
        "schema_version": 2,
        "model_api": 1,
        "name": name,
        "kind": "perpetual",
        "obs_len": OBS_SIZE,
        "action_len": NUM_JOINTS,
        "action_scale": ACTION_SCALE,
        "entry_pose": "standing",
        "robot": {
            "model": RIG_MODEL.get(rig, "microduck"),
            "control_hz": round(1.0 / CTRL_DT),
        },
        "published_by": "microduck-arena",
    }


def _readme(name: str, slug: str) -> bytes:
    tags = "\n".join(f"- {tag}" for tag in TAGS)
    return (
        f"---\nlibrary_name: onnx\ntags:\n{tags}\n---\n\n"
        f"# microduck-{slug}\n\n"
        f"`{POLICY_FILENAME}` is a Microduck policy: 61-value observation in, 14 joint\n"
        f"targets out, 50 Hz. Published from the Microduck Arena.\n\n"
        f"See `{MANIFEST_FILENAME}` for the full contract.\n"
    ).encode()


def publish_policy(api, username: str, name: str, blob: bytes, rig: str) -> PublishedPolicy:
    from huggingface_hub import CommitOperationAdd

    slug = slugify(name)
    repo_id = f"{username}/microduck-{slug}"
    try:
        # public, and exist_ok: republishing a name is a new commit on the same
        # repo, which is how version history comes for free.
        api.create_repo(repo_id, repo_type="model", private=False, exist_ok=True)
    except Exception as exc:  # the Hub's own wording is the useful part
        raise HubPublishError(f"could not create {repo_id}: {exc}") from exc

    manifest = json.dumps(policy_manifest(name, rig), indent=2).encode()
    try:
        result = api.create_commit(
            repo_id=repo_id,
            repo_type="model",
            operations=[
                CommitOperationAdd(path_in_repo=POLICY_FILENAME, path_or_fileobj=blob),
                CommitOperationAdd(path_in_repo=MANIFEST_FILENAME, path_or_fileobj=manifest),
                CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=_readme(name, slug)),
            ],
            commit_message=f"Publish {name} from the Microduck Arena",
        )
    except Exception as exc:
        raise HubPublishError(f"could not write to {repo_id}: {exc}") from exc

    revision = getattr(result, "oid", None)
    if not revision:
        # Without a revision the recorded link cannot be pinned, and an
        # unpinned link silently changes what a leaderboard row points at.
        raise HubPublishError(f"{repo_id}: the commit returned no revision")

    return PublishedPolicy(
        repo_id=repo_id,
        filename=POLICY_FILENAME,
        revision=revision,
        url=f"https://huggingface.co/{repo_id}/resolve/{revision}/{POLICY_FILENAME}",
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_hub_publish.py -v`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add arena/hub_publish.py tests/test_hub_publish.py
git commit -m "Commit a published policy to its author's own Hub repo"
```

---

### Task 9: Publish records a link, not a file

**Files:**
- Modify: `arena/web/routes_submit.py`, `arena/store.py`, `arena/web/routes_read.py`
- Test: `tests/test_routes_submit.py`, `tests/test_store.py`, `tests/test_routes_read.py`

**Interfaces:**
- Consumes: `publish_policy`, `PublishedPolicy`, `HubPublishError` (Task 8); `_require_session` (Task 5).
- Produces: `RunRecord.offers_download -> bool`; leaderboard rows and `/api/runs/{id}` carry `offers_download` and `policy_url: str | None`; `source = {"kind": "hub", "repo_id", "filename", "revision", "url"}`.

- [ ] **Step 1: Write the failing test**

```python
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
    sign_in(spaced_api, username="alice")
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
    sign_in(spaced_api, username="alice")
    with open(REFERENCE, "rb") as fh:
        response = spaced_api.post(
            "/api/events/sprint-2m/submit", files={"file": ("w.onnx", fh)}
        )
    assert response.status_code == 502
    assert "403 Forbidden" in response.json()["detail"]
    assert list(store_dir.rglob("*.json")) == []


def test_a_policy_that_fails_validation_never_reaches_the_hub(spaced_api, tmp_path, monkeypatch):
    """Race first, publish second: nothing is written to someone's namespace
    until the harness has confirmed the file is a working policy."""
    reached = []
    monkeypatch.setattr(
        "arena.web.routes_submit._publish_to_hub",
        lambda *a, **k: reached.append(True),
    )
    sign_in(spaced_api, username="alice")
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    with open(junk, "rb") as fh:
        response = spaced_api.post(
            "/api/events/sprint-2m/submit", files={"file": ("junk.onnx", fh)}
        )
    assert response.status_code == 400
    assert reached == []


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
```

Add to `tests/test_store.py`:

```python
def test_offers_download_covers_both_hosting_paths():
    """`model_stored` stopped matching its name once policies moved to the Hub:
    a Hub run offers a download while storing nothing here. One rule, one place."""
    assert make_record(model_stored=True).offers_download is True
    assert make_record(model_stored=False).offers_download is False
    assert (
        make_record(
            model_stored=False,
            source={"kind": "hub", "repo_id": "a/b", "url": "https://x/y"},
        ).offers_download
        is True
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_routes_submit.py tests/test_store.py -v -k hub or offers`
Expected: FAIL with `AttributeError: 'RunRecord' object has no attribute 'offers_download'`

- [ ] **Step 3: Write minimal implementation**

In `arena/store.py`, on `RunRecord`:

```python
    @property
    def offers_download(self) -> bool:
        """Whether the board should show a download link for this run.

        `model_stored` says whether the SPACE holds the bytes, which stopped
        being the same question when publishing moved to the author's own Hub
        repo: those runs offer a download and store nothing here. Keeping the
        rule in one place stops the API and the frontend disagreeing about it.
        """
        return bool(self.model_stored or (self.source or {}).get("kind") == "hub")
```

In `arena/web/routes_submit.py`:

```python
from ..hub_publish import HubPublishError, publish_policy


def _publish_to_hub(token: str, username: str, name: str, blob: bytes, rig: str):
    """Wrapped so tests replace one function rather than the Hub client."""
    from huggingface_hub import HfApi

    return publish_policy(HfApi(token=token), username, name, blob, rig)
```

In `submit`, after the evaluation and before the record is built:

```python
    published = None
    if session.token:
        try:
            published = _publish_to_hub(
                session.token, session.username, label, payload, manifest.rig
            )
        except HubPublishError as exc:
            # 502, not 500: the Hub refused, and the message is the Hub's. And
            # nothing is recorded — a row pointing at a repo that does not exist
            # is worse than an error.
            raise HTTPException(status_code=502, detail=str(exc)) from exc
```

Then the record's `source` and storage depend on it:

```python
    if published is not None:
        source = {
            "kind": "hub",
            "repo_id": published.repo_id,
            "filename": published.filename,
            "revision": published.revision,
            "url": published.url,
        }
    else:
        source = {"kind": "upload", "filename": file.filename}
```

with `model_stored=published is None` and `store.append(record, trace, payload if published is None else None)`.

In `arena/web/routes_read.py`, replace the `model_stored` check in `run_policy`:

```python
    source = record.source or {}
    if source.get("kind") == "hub" and source.get("url"):
        # The weights live with their author. Redirect rather than proxy: the
        # Hub serves them faster than this Space can, and a proxied download
        # would put every byte through a 2-vCPU container.
        return RedirectResponse(source["url"])
    if not record.model_stored:
        raise HTTPException(...)  # unchanged
```

and add `"offers_download": row.record.offers_download` and `"policy_url": (row.record.source or {}).get("url")` to the leaderboard rows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest -q`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_submit.py arena/store.py arena/web/routes_read.py tests/
git commit -m "Publishing writes to the author's repo and records a link"
```

---

### Task 10: The board links to the Hub

**Files:**
- Modify: `app/src/board.js`
- Test: `app/src/board.test.js`

**Interfaces:**
- Consumes: `offers_download` and `policy_url` on leaderboard rows (Task 9).
- Produces: `buildRows` sets `policyUrl` from the API's fields rather than deciding locally.

- [ ] **Step 1: Write the failing test**

```javascript
describe("policy downloads across both hosting paths", () => {
  it("links to the Hub when that is where the policy lives", () => {
    const [built] = buildRows([
      row({
        offers_download: true,
        policy_url: "https://huggingface.co/alice/microduck-walker/resolve/rev/policy.onnx",
      }),
    ]);
    expect(built.policyUrl).toBe(
      "https://huggingface.co/alice/microduck-walker/resolve/rev/policy.onnx",
    );
  });

  it("links to this server for a locally stored policy", () => {
    const [built] = buildRows([row({ offers_download: true, policy_url: null })]);
    expect(built.policyUrl).toBe("/api/runs/01AAA/policy");
  });

  it("offers nothing when the server says there is nothing", () => {
    // The rule lives in arena/store.py; the frontend must not re-derive it.
    const [built] = buildRows([row({ offers_download: false })]);
    expect(built.policyUrl).toBeNull();
  });

  it("offers nothing for a trial, which is stored nowhere at all", () => {
    const [built] = buildRows([
      row({ provisional: true, offers_download: true, run_id: null }),
    ]);
    expect(built.policyUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/board.test.js`
Expected: FAIL — `policyUrl` is `/api/runs/01AAA/policy` where the Hub URL is expected

- [ ] **Step 3: Write minimal implementation**

In `app/src/board.js`, replace the `policyUrl` derivation:

```javascript
      // Whether a download exists is the SERVER's decision (see
      // RunRecord.offers_download): a Hub-published policy offers one while the
      // Space stores nothing. Re-deriving that here would give the two sides a
      // chance to disagree.
      policyUrl:
        !row.provisional && row.offers_download && row.run_id
          ? row.policy_url || `/api/runs/${row.run_id}/policy`
          : null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add app/src/board.js app/src/board.test.js
git commit -m "The board links wherever the policy actually lives"
```

---

### Task 11: Race a policy already on the Hub

**Files:**
- Create: `arena/hub_fetch.py`
- Modify: `arena/web/routes_submit.py`
- Test: `tests/test_hub_fetch.py`, `tests/test_routes_submit.py`

**Interfaces:**
- Consumes: `MAX_MODEL_BYTES` (Task 7), `_require_session` (Task 5).
- Produces: `parse_repo_ref(text: str) -> tuple[str, str | None]`, `fetch_policy(repo_ref: str, download=..., info=...) -> FetchedPolicy`, `FetchedPolicy` (frozen dataclass: `repo_id`, `filename`, `revision`, `path`, `url`). Both `/try` and `/submit` accept `repo_id` as a form field in place of `file`.

- [ ] **Step 1: Write the failing test**

```python
import pytest

from arena.hub_fetch import FetchError, fetch_policy, parse_repo_ref


@pytest.mark.parametrize(
    "text,expected",
    [
        ("alice/walker", ("alice/walker", None)),
        ("alice/walker:sub/dir/policy.onnx", ("alice/walker", "sub/dir/policy.onnx")),
        ("  alice/walker  ", ("alice/walker", None)),
        ("https://huggingface.co/alice/walker", ("alice/walker", None)),
        ("https://huggingface.co/alice/walker/tree/main", ("alice/walker", None)),
    ],
)
def test_a_repo_reference_is_parsed_from_what_people_actually_paste(text, expected):
    assert parse_repo_ref(text) == expected


@pytest.mark.parametrize("bad", ["", "  ", "notarepo", "a/b/c/d", "../../etc"])
def test_an_unusable_reference_is_refused_with_a_readable_reason(bad):
    with pytest.raises(FetchError):
        parse_repo_ref(bad)


def test_it_prefers_policy_onnx_at_the_root():
    """11 of the 13 real repos call it exactly that."""
    listing = ["README.md", "legacy/policy.onnx", "policy.onnx"]
    result = fetch_policy(
        "alice/walker",
        info=lambda repo_id: (listing, "rev1"),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "policy.onnx"
    assert result.revision == "rev1"


def test_it_falls_back_to_the_only_onnx_when_the_name_differs():
    """q2p/microduck-beak-throw ships beak_throw.onnx, not policy.onnx."""
    result = fetch_policy(
        "alice/walker",
        info=lambda repo_id: (["README.md", "beak_throw.onnx"], "rev1"),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "beak_throw.onnx"


def test_several_candidate_onnx_files_must_be_named_explicitly():
    """Guessing between alpha_stand.onnx and beak_throw.onnx would silently
    race the wrong policy."""
    with pytest.raises(FetchError, match="which"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id: (["alpha_stand.onnx", "beak_throw.onnx"], "rev1"),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_an_explicit_filename_is_honoured_even_when_ambiguous():
    result = fetch_policy(
        "alice/walker:beak_throw.onnx",
        info=lambda repo_id: (["alpha_stand.onnx", "beak_throw.onnx"], "rev1"),
        download=lambda repo_id, filename, revision: "/tmp/x.onnx",
    )
    assert result.filename == "beak_throw.onnx"


def test_a_repo_with_no_onnx_says_so():
    with pytest.raises(FetchError, match="no .onnx"):
        fetch_policy(
            "alice/walker",
            info=lambda repo_id: (["README.md", "model.pt"], "rev1"),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_a_named_file_that_is_absent_says_so():
    with pytest.raises(FetchError, match="nope.onnx"):
        fetch_policy(
            "alice/walker:nope.onnx",
            info=lambda repo_id: (["policy.onnx"], "rev1"),
            download=lambda repo_id, filename, revision: "/tmp/x.onnx",
        )


def test_a_private_or_missing_repo_is_a_readable_refusal():
    def boom(repo_id):
        raise RuntimeError("401 Client Error")

    with pytest.raises(FetchError, match="401"):
        fetch_policy("alice/walker", info=boom, download=lambda *a: "/tmp/x")
```

And the one test that touches the network, marked so it can be skipped:

```python
@pytest.mark.network
def test_a_real_community_policy_races_here():
    """The premise of the whole feature, and it was measured before the design
    existed: RemiFabre/microduck-rough-walk-e scores 27.180s over five seeds."""
    from arena.evaluate import evaluate
    from arena.hub_fetch import fetch_policy
    from arena.manifest import load_event
    from arena.policy import load_policy

    fetched = fetch_policy("RemiFabre/microduck-rough-walk-e")
    result = evaluate(load_event("sprint-2m"), load_policy(fetched.path))
    assert result.seeds_finished == 5
    assert result.score == pytest.approx(27.180, rel=0.05)
```

Register the marker in `pyproject.toml` under `[tool.pytest.ini_options]`:

```toml
markers = ["network: needs the Hugging Face Hub; skip with -m 'not network'"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_hub_fetch.py -v -m "not network"`
Expected: FAIL with `ModuleNotFoundError: No module named 'arena.hub_fetch'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Fetch a policy that is already on the Hub.

13 of the 14 repos tagged `microduck-policy` ship an `.onnx`, and 11 call it
`policy.onnx` at the root — so that name is preferred, a single differently
named `.onnx` is accepted, and anything ambiguous is refused rather than
guessed. Racing the wrong file out of a repo that holds two would be a silent
wrong answer on a leaderboard.

`info` and `download` are handed in so the selection rules are testable without
a network.
"""

from dataclasses import dataclass
from pathlib import Path

from .policy import MAX_MODEL_BYTES

PREFERRED = "policy.onnx"


class FetchError(Exception):
    """The reference cannot be resolved, with a reason fit to show a human."""


@dataclass(frozen=True)
class FetchedPolicy:
    repo_id: str
    filename: str
    revision: str
    path: Path
    url: str


def parse_repo_ref(text: str) -> tuple[str, str | None]:
    """`owner/name`, optionally `owner/name:path/to/file.onnx`. URLs allowed."""
    raw = str(text or "").strip()
    for prefix in ("https://huggingface.co/", "http://huggingface.co/", "hf.co/"):
        if raw.startswith(prefix):
            raw = raw[len(prefix) :]
    # A pasted URL may carry /tree/main or /blob/main.
    for marker in ("/tree/", "/blob/", "/resolve/"):
        if marker in raw:
            raw = raw.split(marker, 1)[0]
    repo, _, filename = raw.partition(":")
    parts = [p for p in repo.strip("/").split("/") if p]
    if len(parts) != 2 or any(p in (".", "..") for p in parts):
        raise FetchError(
            f"{text!r} is not a repo id — expected owner/name, "
            "optionally owner/name:policy.onnx"
        )
    return "/".join(parts), (filename.strip() or None)


def _default_info(repo_id: str):
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo_id)
    return [s.rfilename for s in (info.siblings or [])], info.sha


def _default_download(repo_id: str, filename: str, revision: str):
    from huggingface_hub import hf_hub_download

    return hf_hub_download(repo_id, filename, revision=revision)


def _pick(files: list[str], wanted: str | None, repo_id: str) -> str:
    onnx = [f for f in files if f.endswith(".onnx")]
    if wanted:
        if wanted not in files:
            raise FetchError(f"{repo_id} has no {wanted}")
        return wanted
    if not onnx:
        raise FetchError(f"{repo_id} has no .onnx file")
    if PREFERRED in onnx:
        return PREFERRED
    if len(onnx) == 1:
        return onnx[0]
    listed = ", ".join(sorted(onnx)[:6])
    raise FetchError(
        f"{repo_id} has several .onnx files — say which one, "
        f"as {repo_id}:<file>. Found: {listed}"
    )


def fetch_policy(repo_ref: str, download=_default_download, info=_default_info) -> FetchedPolicy:
    repo_id, wanted = parse_repo_ref(repo_ref)
    try:
        files, revision = info(repo_id)
    except FetchError:
        raise
    except Exception as exc:
        raise FetchError(f"could not read {repo_id}: {exc}") from exc

    filename = _pick(list(files), wanted, repo_id)
    try:
        path = Path(download(repo_id, filename, revision))
    except Exception as exc:
        raise FetchError(f"could not download {repo_id}/{filename}: {exc}") from exc

    size = path.stat().st_size
    if size > MAX_MODEL_BYTES:
        raise FetchError(
            f"{repo_id}/{filename} is {size} bytes, larger than the "
            f"{MAX_MODEL_BYTES} byte limit"
        )

    return FetchedPolicy(
        repo_id=repo_id,
        filename=filename,
        revision=revision or "main",
        path=path,
        url=f"https://huggingface.co/{repo_id}/resolve/{revision or 'main'}/{filename}",
    )
```

In `routes_submit.py`, make `file` optional and accept `repo_id`, resolving exactly one of them:

```python
    if (file is None) == (not repo_id):
        raise HTTPException(
            status_code=400,
            detail="Send either a .onnx file or a repo id, not both and not neither.",
        )
```

A repo-id entry records `source = {"kind": "hub", ...}` from the `FetchedPolicy` and stores no weights — the policy already lives with its author, and there is nothing to publish.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_hub_fetch.py -v -m "not network"` then `uv run pytest tests/test_hub_fetch.py -v -m network`
Expected: PASS, 12 offline tests; the network test scores 27.180 s

- [ ] **Step 5: Commit**

```bash
git add arena/hub_fetch.py arena/web/routes_submit.py tests/test_hub_fetch.py pyproject.toml
git commit -m "Race a policy that is already on the Hub, by repo id"
```

---

### Task 12: Turn it on, and say what the board measures

**Files:**
- Modify: `README.md`, `app/src/race.js`, `app/src/style.css`
- Test: manual, on the real Space

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add the OAuth front matter**

In `README.md`, inside the existing front matter:

```yaml
hf_oauth: true
hf_oauth_scopes:
  - contribute-repos
```

- [ ] **Step 2: Put the caveat on the page**

In `race.js`, under the event facts:

```javascript
  // Measured, and not hideable: HannesVonEssen/microduck-running falls at every
  // speed from 1.0 to 3.0 here while its own eval files are indexed by friction
  // and backlash conditions that are not ours. Saying this is the difference
  // between a fair board and one people think is broken.
  const caveat = document.createElement("p");
  caveat.className = "racecaveat";
  caveat.textContent =
    "Times are measured on this course, with this friction and this " +
    "physics build. A policy tuned elsewhere can do worse here without " +
    "being worse.";
```

- [ ] **Step 3: Flip the Space's ranking to per-person**

Once OAuth is live, real usernames make one row per person the right rule:

```bash
uv run python -c "
from huggingface_hub import HfApi
HfApi().add_space_variable('pollen-robotics/microduck-arena', 'ARENA_RANK_BY', 'user',
    description='Real usernames now, so one row per person')
"
```

- [ ] **Step 4: Deploy and verify on the real Space**

```bash
uv run pytest -q && cd app && npx vitest run && cd ..
uv run python scripts/deploy_space.py
```

Then, against the running Space:
- `GET /api/me` reports `oauth_enabled: true`, `signed_in: false`.
- **Verify OAuth works on a PRIVATE Space** — the spec flags this as unverified and the docs do not say. If it does not, report that rather than working around it: the Space's visibility becomes a decision.
- Signed out, the panel shows only the sign-in button, and the board and replay still work.
- Signed in, publishing a policy creates `<your-user>/microduck-<slug>`, public and tagged, and the board's `.onnx` link resolves to the Hub.

- [ ] **Step 5: Commit**

```bash
git add README.md app/src/race.js app/src/style.css
git commit -m "Turn OAuth on, and say on the page what the board measures"
```

---

## Self-review

**Spec coverage.** Sign-in gating → Tasks 4, 5, 6. `contribute-repos` → Tasks 2, 12. Publish to the author's repo → Tasks 8, 9. Public repos → Task 8. One repo per policy name → Task 8. Repo-id intake → Task 11. 64 MiB → Task 7. `ARENA_RANK_BY` → Task 12. The three-state panel → Task 6. Download redirect → Task 9. The "measures our course" caveat → Task 12. OAuth-on-a-private-Space risk → Task 12, step 4, as an explicit verification rather than an assumption.

**Deliberately excluded**, per the spec's staging: wider sweeps and `official_speed_probe`. They change what a recorded time means and need their own `RUNNER_VERSION` bump and their own plan.

**Not covered by any task, and named rather than hidden:** rate limiting. A signed-in user can queue races at ~11 s of CPU each. The spec lists it as a known gap for a private org Space; if it becomes real, the first mitigation is one race at a time per session.

**Type consistency.** `Session` is `username`/`token`/`expires_at` throughout. `PublishedPolicy` is `repo_id`/`filename`/`revision`/`url`; `FetchedPolicy` adds `path`. `offers_download` is a property on `RunRecord` and a field on API rows — the same name in both. `panelState` returns exactly the three strings `signed-out`/`ready`/`no-hub`, matched in Task 6's tests.
