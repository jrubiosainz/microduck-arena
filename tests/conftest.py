import pytest


@pytest.fixture(autouse=True)
def _isolated_broadcasts(tmp_path, monkeypatch):
    """Point ARENA_BROADCASTS at a per-test directory, so a test that builds an
    app never opens the one real /tmp/arena-broadcasts and leaks booths into
    another test's grid."""
    monkeypatch.setenv("ARENA_BROADCASTS", str(tmp_path / "broadcasts"))
