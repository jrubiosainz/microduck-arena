"""Who a Hugging Face token belongs to, asked of the Hub itself. The token is never kept.

An entry is credited to whoever's token `publish --enter` sends. The Space reads the name
and the organisations from the Hub's whoami-v2, then drops the token: nothing here stores,
logs or repeats it, and every error below is worded without it.
"""

from dataclasses import dataclass

import httpx

WHOAMI_URL = "https://huggingface.co/api/whoami-v2"
WHOAMI_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class HubUser:
    name: str
    kind: str  # "user"; "org" for an organisation's token
    orgs: frozenset[str]


class TokenRefused(Exception):
    """The Hub does not know this token."""


class HubUnreachable(Exception):
    """The Hub did not say who this is."""


def whoami(token: str) -> HubUser:
    try:
        answer = httpx.get(WHOAMI_URL, headers={"Authorization": f"Bearer {token}"}, timeout=WHOAMI_TIMEOUT_S)
    except httpx.TransportError:
        raise HubUnreachable("huggingface.co did not answer") from None
    if answer.status_code == 401:
        raise TokenRefused
    if answer.status_code != 200:
        raise HubUnreachable(f"huggingface.co answered {answer.status_code}")
    body = answer.json()
    return HubUser(name=body["name"], kind=body.get("type", ""),
                   orgs=frozenset(org["name"] for org in body.get("orgs", [])))
