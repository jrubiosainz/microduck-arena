"""Signing in, and who the server thinks you are.

Two identity paths, and the split is the original spec's requirement: with OAuth
configured the session names a real Hugging Face user and carries their token;
with no OAuth at all — every local run — `ARENA_DEV_USER` is treated as
permanently signed in and there is no token, so nothing can be written to
anyone's Hub namespace.

`current_user` is the one place either path is resolved, so no route has to know
which world it is in.
"""

import hmac
import secrets

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .oauth import OAuthError, authorize_url, exchange_code, userinfo
from .session import COOKIE_NAME, Session, sign, unsign

STATE_COOKIE = "arena_oauth_state"

# SameSite=None, and this is a deliberate, load-bearing choice.
#
# A Space is served to the browser as an IFRAME: huggingface.co embeds a page
# from <owner>-<name>.hf.space. Those are different registrable domains, so
# everything this app sets is a THIRD-PARTY cookie, and a browser never sends a
# Lax cookie in that context. With samesite="lax" the state cookie set by
# /login would simply not come back on /login/callback, and signing in would
# fail with "the OAuth state did not match" — or, worse, appear to succeed and
# leave the panel signed out forever.
#
# The trade is real and worth naming: SameSite=None means the cookie travels on
# cross-site requests, which is the surface SameSite exists to narrow. It is
# acceptable here because the cookie is NOT what defends this flow. The OAuth
# `state` parameter is — a random value this server issued, held in its own
# signed cookie, and compared with hmac.compare_digest in the callback. That is
# precisely the attack `state` was designed for. `secure=True` and
# `httponly=True` stay, so the cookie is https-only and unreachable from
# JavaScript.
SAMESITE = "none"
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
def me(request: Request, response: Response) -> dict:
    config = request.app.state.config
    session = current_user(request)
    # The one response whose body varies per user. Behind any shared cache, a
    # cached copy would serve one person's identity to the next visitor.
    response.headers["Cache-Control"] = "no-store"
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
        samesite=SAMESITE,
        secure=True,
    )
    return response


@router.get("/login/callback")
def callback(request: Request, code: str = "", state: str = "") -> RedirectResponse:
    config = request.app.state.config
    if not config.oauth_enabled:
        raise HTTPException(status_code=404, detail="this deployment has no OAuth")

    expected = unsign(request.cookies.get(STATE_COOKIE, ""), config.session_secret)
    if not expected or not state or not hmac.compare_digest(state, expected):
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
        samesite=SAMESITE,
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
