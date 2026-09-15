"""The training-environment link — mostly a list of things that must be refused."""

import pytest

from arena.envlink import ALLOWED_HOSTS, MAX_LENGTH, EnvLinkError, normalise_env_url


@pytest.mark.parametrize(
    "value",
    [
        "https://github.com/me/training-env",
        "https://gitlab.com/me/env",
        "https://huggingface.co/datasets/me/env",
        "https://sub.github.com/me/env",
    ],
)
def test_a_link_to_an_allowed_host_is_kept(value):
    assert normalise_env_url(value) == value


@pytest.mark.parametrize("value", ["", "   ", None])
def test_no_link_is_not_an_error(value):
    """The field is optional, and leaving it blank must not fail a submission."""
    assert normalise_env_url(value) is None


def test_the_suffix_attack_is_refused():
    """The reason this module exists. `github.com.evil.com` reads as GitHub to a
    person, and any check of the form `"github.com" in host` waves it through."""
    with pytest.raises(EnvLinkError, match="github.com.evil.com"):
        normalise_env_url("https://github.com.evil.com/me/env")


@pytest.mark.parametrize(
    "value",
    [
        "https://evilgithub.com/x",
        "https://evil.com/github.com",
        "https://evil.com/?u=https://github.com/x",
        "https://github.evil.com/x",
    ],
)
def test_a_host_that_merely_mentions_an_allowed_one_is_refused(value):
    with pytest.raises(EnvLinkError):
        normalise_env_url(value)


@pytest.mark.parametrize(
    "value",
    ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "//github.com/x"],
)
def test_a_non_https_scheme_is_refused(value):
    """A javascript: link on a button that looks official is the whole hazard."""
    with pytest.raises(EnvLinkError):
        normalise_env_url(value)


def test_http_is_refused_rather_than_upgraded():
    """Silently changing where someone said to send people is worse than saying
    it was not accepted."""
    with pytest.raises(EnvLinkError, match="https"):
        normalise_env_url("http://github.com/me/env")


def test_credentials_in_a_link_are_refused():
    with pytest.raises(EnvLinkError, match="username or password"):
        normalise_env_url("https://user:secret@github.com/me/env")


def test_a_lookalike_host_that_is_not_ascii_is_refused():
    """`gıthub.com` uses a dotless i. It renders almost identically and is a
    different domain."""
    with pytest.raises(EnvLinkError, match="ASCII"):
        normalise_env_url("https://gıthub.com/me/env")


def test_the_host_is_lowercased_and_the_path_is_not():
    """Hosts are case-insensitive; paths are not, and GitHub repo names are
    case-sensitive in their display."""
    assert normalise_env_url("https://GITHUB.com/Me/Env") == "https://github.com/Me/Env"


def test_a_fragment_is_dropped():
    """Nothing after # reaches a server, so storing it stores noise."""
    assert normalise_env_url("https://github.com/me/env#readme") == "https://github.com/me/env"


def test_a_query_is_kept():
    assert normalise_env_url("https://github.com/me/env?tab=readme") == (
        "https://github.com/me/env?tab=readme"
    )


def test_an_over_long_link_is_refused_with_its_length():
    long = "https://github.com/" + "x" * MAX_LENGTH
    with pytest.raises(EnvLinkError, match=str(len(long))):
        normalise_env_url(long)


def test_the_allowlist_is_the_three_she_asked_for():
    assert set(ALLOWED_HOSTS) == {"github.com", "gitlab.com", "huggingface.co"}
