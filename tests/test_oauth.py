import pytest

from arena.web.oauth import OAuthError, OAuthSettings, authorize_url, exchange_code, userinfo

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


def test_credentials_without_a_host_is_not_configured():
    # Missing host produces a malformed redirect_uri like "https:///login/callback".
    # That's a login button which cannot complete. No button is better than a broken one.
    assert (
        OAuthSettings.from_env(
            {
                "OAUTH_CLIENT_ID": "cid",
                "OAUTH_CLIENT_SECRET": "csecret",
            },
            None,
        )
        is None
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
