import os

import pytest

from arena.store import HubStore, LocalStore
from arena.web.config import ArenaConfig


def test_explicit_values_win(tmp_path):
    config = ArenaConfig.from_env(store_dir=tmp_path, dev_user="coralie")
    assert config.store_dir == tmp_path
    assert config.dev_user == "coralie"


def test_store_dir_comes_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_STORE", str(tmp_path / "board"))
    assert ArenaConfig.from_env().store_dir == tmp_path / "board"


def test_dev_user_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("ARENA_DEV_USER", "coralie")
    assert ArenaConfig.from_env().dev_user == "coralie"


def test_there_is_always_a_user(monkeypatch):
    """Running locally must never require configuration to work.

    A submission with no attribution would be unrankable, so the default is a
    name rather than None.
    """
    monkeypatch.delenv("ARENA_DEV_USER", raising=False)
    assert ArenaConfig.from_env().dev_user == "local"


def test_the_store_directory_is_created_on_demand(tmp_path):
    target = tmp_path / "nested" / "board"
    config = ArenaConfig.from_env(store_dir=target)
    config.ensure_store()
    assert target.is_dir()


def test_frontend_dir_is_none_when_not_built(tmp_path, monkeypatch):
    """A missing bundle is a reportable state, not a crash — the API still works."""
    monkeypatch.setenv("ARENA_FRONTEND", str(tmp_path / "absent"))
    assert ArenaConfig.from_env().frontend_dir is None


def test_local_ranking_is_per_policy_by_default():
    """Locally you compare policies, not people — see arena/index.py."""
    from arena.index import by_policy

    config = ArenaConfig.from_env(dev_user="coralie")
    assert config.rank_by == "policy"
    assert config.entrant is by_policy


def test_ranking_can_be_switched_to_the_public_rule(monkeypatch):
    from arena.index import by_user

    monkeypatch.setenv("ARENA_RANK_BY", "user")
    config = ArenaConfig.from_env()
    assert config.rank_by == "user"
    assert config.entrant is by_user


def test_an_unknown_ranking_is_refused_loudly(monkeypatch):
    """A typo must not silently fall back to a different leaderboard."""
    import pytest

    monkeypatch.setenv("ARENA_RANK_BY", "vibes")
    with pytest.raises(ValueError, match="ARENA_RANK_BY"):
        ArenaConfig.from_env()


def test_no_dataset_means_the_local_filesystem(tmp_path, monkeypatch):
    monkeypatch.delenv("ARENA_DATASET", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.dataset_repo is None
    assert isinstance(config.build_store(), LocalStore)
    assert "local filesystem" in config.store_description()


def test_a_dataset_and_a_token_give_a_durable_store(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_DATASET", "someone/arena-runs")
    monkeypatch.setenv("HF_TOKEN", "hf_pretend")
    config = ArenaConfig.from_env(store_dir=tmp_path)
    store = config.build_store()
    assert isinstance(store, HubStore)
    assert store.repo_id == "someone/arena-runs"
    assert "durable" in config.store_description()


def test_a_dataset_without_a_token_falls_back_and_says_so_loudly(tmp_path, monkeypatch):
    """A Space that boots with a working board and a loud warning beats one that
    crash-loops on a missing secret. But the warning has to be unmissable: this
    is the configuration where every published run is silently lost on restart."""
    monkeypatch.setenv("ARENA_DATASET", "someone/arena-runs")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert isinstance(config.build_store(), LocalStore)
    described = config.store_description()
    assert "EPHEMERAL" in described
    assert "HF_TOKEN" in described
    assert "someone/arena-runs" in described


def test_blank_environment_variables_count_as_unset(tmp_path, monkeypatch):
    """Spaces render an unset secret as an empty string, not an absent variable.
    Treating "" as a repo id would build a HubStore pointed at nothing."""
    monkeypatch.setenv("ARENA_DATASET", "   ")
    monkeypatch.setenv("HF_TOKEN", "")
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.dataset_repo is None
    assert config.hf_token is None
    assert isinstance(config.build_store(), LocalStore)


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


def test_recovery_is_off_unless_a_deployment_asks_for_it(tmp_path, monkeypatch):
    """A spec requirement, not caution: the engine and the web layer must both
    work on a developer machine with no Hugging Face account and NO NETWORK.
    A boot that reached out to the Hub by default would break every local run."""
    monkeypatch.delenv("ARENA_RECOVER", raising=False)
    assert ArenaConfig.from_env(store_dir=tmp_path).recover_on_boot is False


@pytest.mark.parametrize("value,expected", [("1", True), ("true", True), ("yes", True),
                                            ("0", False), ("", False), ("maybe", False)])
def test_the_recovery_switch_reads_only_affirmative_values(tmp_path, monkeypatch, value, expected):
    """"maybe" must not enable a network call. Anything not clearly a yes is a no."""
    monkeypatch.setenv("ARENA_RECOVER", value)
    assert ArenaConfig.from_env(store_dir=tmp_path).recover_on_boot is expected


def test_a_missing_token_names_the_other_secrets_it_can_see(tmp_path, monkeypatch):
    """The realistic failure is a token that exists under another name. Telling
    the owner only "HF_TOKEN is not set" while they are looking at the secret
    they just created is true and useless."""
    monkeypatch.setenv("ARENA_DATASET", "someone/runs")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setenv("microduck_token", "hf_pretend")
    described = ArenaConfig.from_env(store_dir=tmp_path).store_description()
    assert "microduck_token" in described
    assert "rename it to HF_TOKEN" in described


def test_the_hint_never_prints_a_secret_value(tmp_path, monkeypatch):
    """Names only. A startup banner is logged, and logs get shared."""
    monkeypatch.setenv("ARENA_DATASET", "someone/runs")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setenv("microduck_token", "hf_thismustnotappear")
    assert "hf_thismustnotappear" not in ArenaConfig.from_env(store_dir=tmp_path).store_description()


def test_no_hint_when_there_is_nothing_token_shaped_to_suggest(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_DATASET", "someone/runs")
    for key in list(os.environ):
        if "TOKEN" in key.upper() or "SECRET" in key.upper():
            monkeypatch.delenv(key, raising=False)
    described = ArenaConfig.from_env(store_dir=tmp_path).store_description()
    assert "EPHEMERAL" in described
    assert "rename it" not in described


def test_a_local_deployment_keeps_its_ballots_beside_its_runs(tmp_path):
    from arena.store import LocalBallots

    config = ArenaConfig.from_env(store_dir=tmp_path)
    ballots = config.build_ballots()
    assert isinstance(ballots, LocalBallots)
    assert ballots.root == tmp_path


def test_commentary_is_on_by_default_and_has_a_switch_and_a_model(tmp_path, monkeypatch):
    monkeypatch.delenv("ARENA_COMMENTARY", raising=False)
    monkeypatch.delenv("ARENA_COMMENTARY_MODEL", raising=False)
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.commentary_enabled is True
    assert config.commentary_model == "deepseek-ai/DeepSeek-V3-0324"
    monkeypatch.setenv("ARENA_COMMENTARY", "0")
    monkeypatch.setenv("ARENA_COMMENTARY_MODEL", "org/other:provider")
    config = ArenaConfig.from_env(store_dir=tmp_path)
    assert config.commentary_enabled is False
    assert config.commentary_model == "org/other:provider"
