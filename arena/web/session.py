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
