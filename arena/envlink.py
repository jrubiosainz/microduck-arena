"""The optional link to a policy's training environment.

Submitter-supplied, shown on a shared board as a button that will look official
to whoever clicks it. That makes it a phishing surface, so this does not
sanitise a URL — it REFUSES anything that is not one of a few known hosts.
Filtering out the bad shapes is a losing game; naming the good hosts is not.

https only, and the host must BE one of the allowed hosts or a subdomain of one.
`github.com.evil.com` is the attack this exists for: it reads as GitHub to a
person and is not, and a naive `"github.com" in host` would wave it through.
"""

from urllib.parse import urlsplit, urlunsplit

# What she asked for: somewhere a training environment can actually live.
ALLOWED_HOSTS = ("github.com", "gitlab.com", "huggingface.co")
MAX_LENGTH = 300


class EnvLinkError(ValueError):
    """The link cannot be accepted, with a reason fit to show its author."""


def _host_is_allowed(host: str) -> bool:
    host = host.lower()
    # Exact, or a subdomain — never a suffix match, which "github.com.evil.com"
    # would pass.
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in ALLOWED_HOSTS)


def normalise_env_url(raw: str | None) -> str | None:
    """The link to store, or None for "no link". Raises EnvLinkError on a bad one."""
    value = (raw or "").strip()
    if not value:
        return None
    if len(value) > MAX_LENGTH:
        raise EnvLinkError(f"that link is {len(value)} characters, longer than {MAX_LENGTH}")

    parts = urlsplit(value)
    if parts.scheme.lower() != "https":
        # http is refused rather than upgraded: silently changing where someone
        # said to send people is worse than telling them it was not accepted.
        raise EnvLinkError("links must start with https://")
    if parts.username or parts.password:
        raise EnvLinkError("links must not carry a username or password")
    host = (parts.hostname or "").lower()
    if not host:
        raise EnvLinkError("that link has no host")
    try:
        # An internationalised host that is not pure ASCII can read like a
        # familiar one while being another domain entirely.
        host.encode("ascii")
    except UnicodeEncodeError as exc:
        raise EnvLinkError("links must use a plain ASCII host") from exc
    if not _host_is_allowed(host):
        allowed = ", ".join(ALLOWED_HOSTS)
        raise EnvLinkError(f"links are limited to {allowed} — {host} is not one of them")

    # Rebuilt from the parsed parts, so nothing unparsed survives into storage.
    return urlunsplit(("https", host + (f":{parts.port}" if parts.port else ""),
                       parts.path, parts.query, ""))
