"""Sessions, and the cookie that names one.

The cookie carries an OPAQUE session id, and the session holds a name and an
expiry — nothing else. The Space reads a visitor's identity at sign-in and
writes into no one's Hub namespace, so it keeps no token of theirs at all.

The table is in memory on purpose. It costs a restart logging everyone out,
which for an 8-hour session on a Space that sleeps anyway is not worth a
database.
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
    expires_at: float


class Sessions:
    def __init__(self) -> None:
        self._by_id: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, username: str, ttl_s: float) -> str:
        sid = secrets.token_urlsafe(32)
        with self._lock:
            self._by_id[sid] = Session(username, time.time() + ttl_s)
        return sid

    def get(self, sid: str) -> Session | None:
        with self._lock:
            found = self._by_id.get(sid)
            if found is None:
                return None
            if found.expires_at <= time.time():
                # Evicted, not just reported stale, so a long-lived process
                # does not accumulate dead sessions.
                del self._by_id[sid]
                return None
            return found

    def drop(self, sid: str) -> None:
        with self._lock:
            self._by_id.pop(sid, None)
