import re

from arena.assets import ASSET_ROOT
from arena.cli import main

REFERENCE = str(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


def test_events_lists_the_sprint(capsys):
    assert main(["events"]) == 0
    assert "sprint-2m" in capsys.readouterr().out


def test_score_prints_per_seed_and_a_score(capsys):
    assert main(["score", REFERENCE, "--event", "sprint-2m"]) == 0
    out = capsys.readouterr().out
    assert "seed 1" in out
    assert "score" in out


def test_score_records_a_run_and_board_shows_it(tmp_path, capsys):
    """The board must show the same number the run produced, at rank 1.

    Note what this deliberately does NOT do: assert `"1" in out`. That passes on
    the "1" inside "18.216s" no matter what rank is printed, and it never checks
    that the board's score matches the one `score` reported — so a formatting bug
    that mangled the number would sail through.
    """
    store = str(tmp_path)
    assert main(["score", REFERENCE, "--event", "sprint-2m",
                 "--user", "alice", "--name", "walker", "--store", store]) == 0
    scored = capsys.readouterr().out
    seconds = re.search(r"score (\d+\.\d+)s", scored)
    assert seconds, f"no score line in: {scored!r}"

    assert main(["board", "--event", "sprint-2m", "--store", store]) == 0
    out = capsys.readouterr().out
    assert "walker" in out
    assert seconds.group(1) in out, "board score differs from the score just run"
    assert re.search(r"^\s*1\s+alice\b", out, re.MULTILINE), f"alice not at rank 1: {out!r}"


def test_board_on_an_empty_store_says_so(tmp_path, capsys):
    assert main(["board", "--event", "sprint-2m", "--store", str(tmp_path)]) == 0
    assert "no runs" in capsys.readouterr().out.lower()


def test_a_rejected_policy_exits_nonzero_with_the_reason(tmp_path, capsys):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"nope")
    assert main(["score", str(junk), "--event", "sprint-2m"]) == 1
    assert "not a loadable ONNX model" in capsys.readouterr().err


def test_an_unknown_event_exits_nonzero(capsys):
    assert main(["score", REFERENCE, "--event", "nope"]) == 1
    assert "no such event" in capsys.readouterr().err


def test_serve_wires_the_config_from_its_arguments(monkeypatch, tmp_path):
    """The one command a user runs, and the only untested path into create_app."""
    import uvicorn

    captured = {}

    def fake_run(app, host, port, log_level):
        captured.update(app=app, host=host, port=port)

    monkeypatch.setattr(uvicorn, "run", fake_run)
    assert main(
        ["serve", "--store", str(tmp_path), "--user", "coralie", "--host", "0.0.0.0", "--port", "9111"]
    ) == 0

    assert captured["host"] == "0.0.0.0"
    assert captured["port"] == 9111
    config = captured["app"].state.config
    assert config.dev_user == "coralie"
    assert config.store_dir == tmp_path
    assert tmp_path.is_dir()  # ensure_store ran


def test_board_lists_a_users_policies_separately_by_default(tmp_path, capsys):
    """Matches the local page: locally you are comparing policies, not people."""
    store = str(tmp_path)
    for name in ("walker-v1", "walker-v2"):
        assert main(["score", REFERENCE, "--event", "sprint-2m",
                     "--user", "coralie", "--name", name, "--store", store]) == 0
    capsys.readouterr()

    assert main(["board", "--event", "sprint-2m", "--store", store]) == 0
    out = capsys.readouterr().out
    assert "walker-v1" in out
    assert "walker-v2" in out


def test_board_can_use_the_public_one_row_per_person_rule(tmp_path, capsys):
    store = str(tmp_path)
    for name in ("walker-v1", "walker-v2"):
        assert main(["score", REFERENCE, "--event", "sprint-2m",
                     "--user", "coralie", "--name", name, "--store", store]) == 0
    capsys.readouterr()

    assert main(["board", "--event", "sprint-2m", "--store", store,
                 "--rank-by", "user"]) == 0
    out = capsys.readouterr().out
    rows = [line for line in out.splitlines() if "coralie" in line]
    assert len(rows) == 1


def test_commentary_dry_run_prints_facts_memories_and_the_dialogue(tmp_path, capsys, monkeypatch):
    import json

    from arena.store import LocalStore
    from tests.test_store import make_record

    store = LocalStore(tmp_path)
    record = make_record(user="alice", score=12.4, submitted_at="2026-09-11T10:00:00Z")
    store.append(record, b"trace")

    def provider(messages, max_tokens):
        content = [
            {"speaker": "peter", "text": "12.40 s for alice, Ray!", "fact_refs": [1, 2]},
            {"speaker": "ray", "text": "12.40 s, every seed finished, Peter.", "fact_refs": [2]},
            {"speaker": "peter", "text": "A throne, my friend.", "fact_refs": [3]},
        ]
        return {"content": json.dumps(content), "finish_reason": "stop", "model": "fake/model",
                "prompt_tokens": 10, "completion_tokens": 10}

    monkeypatch.setattr("arena.commentary.router_provider", lambda model, token: provider)
    monkeypatch.setattr("arena.commentary.hub_token", lambda config: "token")
    assert main(["commentary", record.run_id, "--store", str(tmp_path), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "[0] The event is the 2 m Sprint" in out
    assert "This dialogue: " in out
    assert "Peter Duckry: 12.40 s for alice, Ray!" in out
    assert "Ray Quackson: 12.40 s, every seed finished, Peter." in out
    assert "fake/model" in out
    # A dry run writes nothing: no broadcast reaches the book.
    assert not list((tmp_path / "broadcasts").glob("*.json"))


def test_commentary_without_a_token_says_so(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr("arena.commentary.hub_token", lambda config: None)
    assert main(["commentary", "R1", "--store", str(tmp_path), "--dry-run"]) == 1
    assert "token" in capsys.readouterr().err
