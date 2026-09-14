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
        host = (space_host or env.get("SPACE_HOST") or "").strip()
        # ALL three required, or nothing. A half-set environment producing a login button
        # that cannot complete is worse than no button. A malformed redirect_uri like
        # "https:///login/callback" is exactly that broken state.
        if not client_id or not client_secret or not host:
            return None
        provider = (env.get("OPENID_PROVIDER_URL") or "https://huggingface.co").rstrip("/")
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
