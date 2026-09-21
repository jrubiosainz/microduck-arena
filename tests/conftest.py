import pytest


@pytest.fixture(autouse=True)
def _isolated_broadcasts(tmp_path, monkeypatch):
    """Point ARENA_BROADCASTS at a per-test directory, so a test that builds an
    app never opens the one real /tmp/arena-broadcasts and leaks booths into
    another test's grid.

    Also turns the reserve off by default: `with TestClient(...)` fires startup
    hooks, and unlike the clip worker — which merely blocks on an empty queue —
    the reserve's loop calls the Hugging Face router the instant it starts. A
    test that wants the booth on sets ARENA_COMMENTARY itself.
    """
    monkeypatch.setenv("ARENA_BROADCASTS", str(tmp_path / "broadcasts"))
    monkeypatch.setenv("ARENA_COMMENTARY", "0")
