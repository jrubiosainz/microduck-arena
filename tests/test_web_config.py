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
