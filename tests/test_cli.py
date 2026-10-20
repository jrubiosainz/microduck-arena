import json
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
    assert "cmd" in out and "m/s" in out


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


def _timeline(tmp_path):
    path = tmp_path / "timeline.json"
    path.write_text(json.dumps({
        "timeline_version": 1, "duration_s": 2.0,
        "keyframes": [{"t": 0.0}, {"t": 1.0, "twist": [1, 0, 0]}],
    }))
    return path


def test_score_on_a_stage_summarises_the_performance(tmp_path, capsys):
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_timeline(tmp_path))]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "stage: 2.00 s played, timeline.json (2 keyframes)"
    # One line per duck: a version 1 timeline is a troupe of one.
    assert len(lines) == 2
    assert re.fullmatch(r"duck 0: fell (no|at \d+\.\d\d s) · seated \d+\.\d s · standing \d+\.\d s", lines[1])


def test_score_on_a_stage_without_a_timeline_plays_the_events_command(capsys):
    assert main(["score", REFERENCE, "--event", "got-a-talent"]) == 0
    assert capsys.readouterr().out.splitlines()[0] == "stage: 20.00 s played, the event's default command"


def test_a_timeline_on_a_race_is_refused(tmp_path, capsys):
    assert main(["score", REFERENCE, "--event", "sprint-2m", "--timeline", str(_timeline(tmp_path))]) == 1
    assert "--timeline is for stage events" in capsys.readouterr().err


def test_a_malformed_timeline_exits_1_with_where(tmp_path, capsys):
    path = tmp_path / "timeline.json"
    path.write_text('{"timeline_version": 1, "duration_s": 2.0, "keyframes": [{"t": 0.5}]}')
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(path)]) == 1
    assert "keyframes[0].t" in capsys.readouterr().err


def test_a_timeline_that_is_not_json_exits_1(tmp_path, capsys):
    path = tmp_path / "timeline.json"
    path.write_text("{nope")
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(path)]) == 1
    assert "not a JSON file" in capsys.readouterr().err


def test_a_stage_run_is_recorded_and_boarded(tmp_path, capsys):
    store = str(tmp_path / "store")
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_timeline(tmp_path)),
                 "--user", "alice", "--store", store]) == 0
    capsys.readouterr()
    assert main(["board", "--event", "got-a-talent", "--store", store]) == 0
    assert re.search(r"^\s*1\s+alice\b.*2\.000s", capsys.readouterr().out, re.MULTILINE)


def test_score_records_how_a_performance_sounds(tmp_path, capsys):
    from arena.store import LocalStore

    timeline = tmp_path / "timeline.json"
    timeline.write_text(json.dumps({"timeline_version": 1, "duration_s": 1.0,
                                    "keyframes": [{"t": 0.0}, {"t": 0.5, "triggers": [0, 1]}]}))
    store = tmp_path / "store"
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(timeline),
                 "--store", str(store)]) == 0
    [record] = LocalStore(store).runs("got-a-talent")
    assert record.cast[0]["sound"] == {"triggers": [[0.0, 0.0, 0.0], [0.5, 0.0, 1.0]]}


SITTER = "pollen-robotics/microduck-sitter@" + "a" * 40


def _troupe(tmp_path):
    """The entry's own duck at the centre, and the sitter borrowed twice, one on each side."""
    path = tmp_path / "timeline.json"
    path.write_text(json.dumps({"timeline_version": 2, "duration_s": 1.0, "ducks": [
        {"policy": "self", "keyframes": [{"t": 0.0}]},
        {"policy": SITTER, "start": {"x": 0.0, "y": 0.6, "yaw": 90}, "keyframes": [{"t": 0.0}]},
        {"policy": SITTER, "start": {"x": 0.0, "y": -0.6, "yaw": -90}, "keyframes": [{"t": 0.0}]},
    ]}))
    return path


def _lend(monkeypatch):
    """Stands in for the Hub: the sitter is the reference walker's weights at its commit. Returns what
    was asked of it, the troupe's references per call."""
    from pathlib import Path

    from arena.hub_fetch import FetchedPolicy

    asked = []

    def fetch_references(troupe, event):
        asked.append(troupe.references())
        return {SITTER: FetchedPolicy(
            repo_id="pollen-robotics/microduck-sitter", filename="policy.onnx", revision="a" * 40,
            path=Path(REFERENCE),
            url="https://huggingface.co/pollen-robotics/microduck-sitter/resolve/" + "a" * 40 + "/policy.onnx")}

    monkeypatch.setattr("arena.cli.fetch_references", fetch_references)
    return asked


def test_score_plays_a_troupe_with_its_borrowed_policies_from_the_hub(tmp_path, capsys, monkeypatch):
    asked = _lend(monkeypatch)
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_troupe(tmp_path))]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert asked == [(SITTER,)], "a policy two ducks play is fetched once"
    assert lines[0] == "stage: 1.00 s played, timeline.json (3 ducks)"
    assert [line.split(":")[0] for line in lines[1:]] == ["duck 0", "duck 1", "duck 2"]


def test_a_borrowed_policy_the_hub_refuses_exits_1_naming_its_duck(tmp_path, capsys, monkeypatch):
    from arena.hub_fetch import FetchError

    def refuse(troupe, event):
        raise FetchError("ducks[1]: pollen-robotics/microduck-sitter: could not read pollen-robotics/microduck-sitter: 404")

    monkeypatch.setattr("arena.cli.fetch_references", refuse)
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_troupe(tmp_path))]) == 1
    assert "ducks[1]: pollen-robotics/microduck-sitter" in capsys.readouterr().err


def test_score_records_a_troupe_crediting_its_borrowed_ducks(tmp_path, capsys, monkeypatch):
    from arena.store import LocalStore

    _lend(monkeypatch)
    store = tmp_path / "store"
    assert main(["score", REFERENCE, "--event", "got-a-talent", "--timeline", str(_troupe(tmp_path)),
                 "--store", str(store)]) == 0
    [record] = LocalStore(store).runs("got-a-talent")
    assert [duck["policy"] if duck["policy"] == "self" else duck["policy"]["repo_id"] for duck in record.cast] == [
        "self", "pollen-robotics/microduck-sitter", "pollen-robotics/microduck-sitter"]
    assert [duck["start"]["yaw"] for duck in record.cast] == [0.0, 90.0, -90.0]


def test_score_rates_a_tug_entry_and_the_board_says_rating(tmp_path, capsys):
    """The format Plan B's ledger reads: five seed lines, then the rating."""
    assert main(["score", REFERENCE, "--event", "tug-of-war", "--store", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert len(re.findall(r"^seed [1-5]: (pit|held) +\d+\.\d\d N( at \d+\.\d\d s)?$", out, re.MULTILINE)) == 5
    assert re.search(r"^rating: \d+\.\d\d N · replay from seed [1-5]$", out, re.MULTILINE)
    assert main(["board", "--event", "tug-of-war", "--store", str(tmp_path)]) == 0
    board = capsys.readouterr().out
    assert "rating" in board and "cmd" not in board and "m/s" not in board  # the tug's command is no speed
