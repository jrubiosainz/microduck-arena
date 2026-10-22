import dataclasses

import mujoco
import numpy as np
import pytest

import arena.duel
from arena.assets import ASSET_ROOT
from arena.cli import main
from arena.constants import CTRL_DT, NUM_JOINTS, TRACE_WIDTH
from arena.duel import (
    TAIL_S,
    Bout,
    Match,
    Played,
    compile_duel,
    deck_boxes,
    load_duel,
    load_duel_by_id,
    play_bout,
    play_match,
    record_bout,
    record_match,
    standings,
)
from arena.duel_watch import create_duel_app
from arena.manifest import ManifestError, all_events, load_event
from arena.policy import load_policy

REFERENCE = str(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")

# A well-formed duel, as TOML sections, unaligned so a test can .replace() one
# value. Tests override one entry to build a specific malformation.
GOOD = {
    "root": 'id="probe"\ntitle="Probe"\nrig="legs"\nkind="perpetual"\n'
            'time_limit_s=1.0\nseeds=[1]\n',
    "command": '[command]\nvel=[0.3,0,0]\nhead=[0,0,0,0]\nbody=[0,0,0,0,0,0]\n',
    "start": '[start]\nkeyframe="STAND"\nsettle_s=0.5\nsetback_m=0.25\n'
             '[start.perturbation]\njoint_rad=0.01\nyaw_deg=2.0\n',
    "decks": '[decks]\ngap_m=0.5\nlength_m=2.0\nwidth_m=0.8\nwall_height_m=0.15\n'
             'pit_depth_m=0.6\n',
    "rope": '[rope]\nslack_m=0.015\ntimeconst_s=0.022\nharness_height_m=0.025\n',
    "referee": '[referee]\ndrop_m=0.1\nmargin_m=0.05\n',
}


def write_duel(tmp_path, **overrides):
    """Write a duel that is well-formed except for the sections overridden."""
    sections = GOOD | overrides
    path = tmp_path / "probe.toml"
    path.write_text("".join(sections[key] for key in GOOD))
    return path


def _replaced(section: str, old: str, new: str) -> dict:
    assert old in GOOD[section], f"{old!r} is not in GOOD[{section!r}]"
    return {section: GOOD[section].replace(old, new)}


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


@pytest.fixture(scope="module")
def tug():
    return load_duel_by_id("tug-of-war")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


def placed(duel, xs, **changes):
    """The duel's model with duck k's trunk starting at xs[k] along x (None: where it was)."""
    duel = dataclasses.replace(duel, **changes)
    model = compile_duel(duel)
    key = model.key_qpos[model.key(duel.start.keyframe).id]
    for k, x in enumerate(xs):
        if x is not None:
            key[arena.duel._free(model, k)] = x
    return duel, model


def test_the_tug_of_war_loads(tug):
    assert tug.id == "tug-of-war"
    assert tug.rig == "legs"
    assert tug.seeds == (1, 2, 3)
    assert tug.command[:3] == (0.3, 0.0, 0.0)
    assert tug.command[3:] == (0.0,) * 10
    assert tug.start.keyframe == "STAND"
    assert tug.start_x_m == pytest.approx(0.5)
    assert tug.decks.pit_depth_m > tug.referee.drop_m


def test_a_duel_is_not_an_event(tug):
    """Nothing on the programme, the boards or the store can reach a duel by accident."""
    assert tug.id not in {event.id for event in all_events()}
    with pytest.raises(ManifestError, match="no such event"):
        load_event(tug.id)


def test_the_probe_is_well_formed(tmp_path):
    duel = load_duel(write_duel(tmp_path))
    assert duel.id == "probe"
    assert duel.time_limit_s == 1.0
    assert duel.decks.wall_height_m == 0.15
    assert duel.rope.slack_m == 0.015


def test_an_unknown_duel_is_refused():
    with pytest.raises(ManifestError, match="no such duel: 'nope'"):
        load_duel_by_id("nope")


@pytest.mark.parametrize(
    "overrides, match",
    [
        ({"root": GOOD["root"] + 'colour="red"\n'}, r"unknown keys \['colour'\]"),
        (_replaced("decks", "pit_depth_m=0.6", "pit_depth_m=0.6\nmoat_m=1.0"),
         r"\[decks\]: unknown keys \['moat_m'\]"),
        (_replaced("rope", "slack_m=0.015", "slack_m=0.015\nknot=true"),
         r"\[rope\]: unknown keys \['knot'\]"),
        ({"decks": ""}, "missing 'decks'"),
        ({"root": GOOD["root"] + "rope=1\n", "rope": ""}, "rope must be a table"),
        (_replaced("decks", "gap_m=0.5", "gap_m=true"), "gap_m must be a positive number"),
        (_replaced("decks", "gap_m=0.5", "gap_m=0"), "gap_m must be a positive number"),
        (_replaced("root", "time_limit_s=1.0", "time_limit_s=nan"), "time_limit_s must be"),
        (_replaced("rope", "slack_m=0.015", "slack_m=-0.01"), "slack_m must be a number of at least 0"),
        (_replaced("rope", "timeconst_s=0.022", "timeconst_s=0.005"), "two physics steps"),
        (_replaced("decks", "pit_depth_m=0.6", "pit_depth_m=0.2"), "deeper than"),
        (_replaced("start", "setback_m=0.25", "setback_m=2.0"), "shorter than the decks"),
        (_replaced("start", 'keyframe="STAND"', 'keyframe=""'), "keyframe must be a name"),
        (_replaced("start", "yaw_deg=2.0", "yaw_deg=-2.0"), r"\[start.perturbation\]: yaw_deg"),
        (_replaced("root", "seeds=[1]", "seeds=[]"), "seeds must be a list"),
        (_replaced("root", "seeds=[1]", "seeds=[true]"), "seeds must be a list"),
        (_replaced("root", "seeds=[1]", "seeds=[1, 1]"), "duplicate seeds"),
        (_replaced("root", 'rig="legs"', 'rig="wheels"'), "unknown rig"),
        (_replaced("root", 'kind="perpetual"', 'kind="forever"'), "unknown kind"),
        (_replaced("command", "vel=[0.3,0,0]", "vel=[0.3,0]"), "vel must have 3 values"),
    ],
)
def test_a_malformed_duel_is_refused(tmp_path, overrides, match):
    with pytest.raises(ManifestError, match=match):
        load_duel(write_duel(tmp_path, **overrides))


def test_the_model_holds_two_ducks_the_decks_and_a_rope(tug):
    model = compile_duel(tug)
    assert model.body("trunk_base").id != model.body("duck1/trunk_base").id
    assert model.nu == 2 * NUM_JOINTS

    rope = model.tendon("rope").id
    assert model.tendon_limited[rope]
    assert model.tendon_range[rope][1] == pytest.approx(2 * tug.start_x_m + tug.rope.slack_m)

    assert model.geom("floor").pos[2] == pytest.approx(-tug.decks.pit_depth_m)
    for name, pos, half in deck_boxes(tug.decks):
        geom = model.geom(name)
        np.testing.assert_allclose(geom.pos, pos)
        np.testing.assert_allclose(geom.size, half)
    for k, side in enumerate((-1, 1)):
        deck = model.geom(f"deck{k}")
        inner_edge = deck.pos[0] - side * deck.size[0]
        assert inner_edge == pytest.approx(side * tug.decks.gap_m / 2)
        assert deck.pos[2] + deck.size[2] == pytest.approx(0.0)


def test_no_walls_means_only_the_decks(tug):
    names = [name for name, _, _ in deck_boxes(dataclasses.replace(tug.decks, wall_height_m=0.0))]
    assert names == ["deck0", "deck1"]


def test_the_ducks_start_back_to_back_across_the_pit(tug):
    """Each faces away from the pit, so its command's forward walk is a pull."""
    model = compile_duel(tug)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key(tug.start.keyframe).id)
    mujoco.mj_forward(model, data)
    for k, (prefix, side) in enumerate((("", -1), ("duck1/", 1))):
        harness = data.site_xpos[model.site(f"{prefix}harness").id]
        assert harness[0] == pytest.approx(side * tug.start_x_m)
        facing = data.xmat[model.body(f"{prefix}trunk_base").id].reshape(3, 3)[:, 0]
        np.testing.assert_allclose(facing, (side, 0.0, 0.0), atol=1e-9)
    assert data.ten_length[model.tendon("rope").id] == pytest.approx(2 * tug.start_x_m)


def test_a_bout_is_deterministic(tug, walker):
    duel = dataclasses.replace(tug, time_limit_s=1.0)
    model = compile_duel(duel)
    first = play_bout(duel, model, (walker, walker), seed=1)
    assert first == play_bout(duel, model, (walker, walker), seed=1)
    assert first.end == "bell"


def test_a_bout_takes_two_policies(tug, walker):
    with pytest.raises(ValueError, match="two policies"):
        play_bout(tug, compile_duel(tug), (walker,), seed=1)


def test_a_duck_over_the_pit_falls_in_and_loses(tug):
    duel, model = placed(tug, (None, 0.1))
    bout = play_bout(duel, model, (_ZeroPolicy(), _ZeroPolicy()), seed=1)
    assert (bout.end, bout.winner) == ("pit", 0)
    # It fell during the untimed settle; the referee calls it on the first timed step.
    assert bout.time_s == pytest.approx(CTRL_DT)


def test_both_in_the_pit_is_a_draw(tug):
    duel, model = placed(tug, (-0.1, 0.1))
    bout = play_bout(duel, model, (_ZeroPolicy(), _ZeroPolicy()), seed=1)
    assert (bout.end, bout.winner) == ("pit", None)


@pytest.mark.parametrize("shift, winner", [(-0.1, 0), (0.1, 1), (0.0, None)])
def test_the_bell_goes_to_whoever_has_the_rope(tug, shift, winner):
    """Two ducks standing still: the rope's middle is where they were put."""
    x = tug.start_x_m
    duel, model = placed(tug, (-x + shift, x + shift), time_limit_s=0.2)
    bout = play_bout(duel, model, (_ZeroPolicy(), _ZeroPolicy()), seed=1)
    assert (bout.end, bout.winner) == ("bell", winner)
    assert bout.time_s == pytest.approx(0.2)
    assert bout.rope_mid_m == pytest.approx(shift, abs=0.01)


def test_a_diverged_simulation_is_a_void_bout(tug, monkeypatch):
    monkeypatch.setattr(arena.duel, "_reset_by_mujoco", lambda data: True)
    bout = play_bout(tug, compile_duel(tug), (_ZeroPolicy(), _ZeroPolicy()), seed=1)
    assert bout == Bout(1, None, "void", CTRL_DT, None)


def test_a_match_plays_every_seed_from_both_decks(tug, walker):
    """A policy against itself: the same bout twice, one win each or two draws."""
    duel = dataclasses.replace(tug, time_limit_s=1.0, seeds=(1,))
    match = play_match(duel, walker, walker)
    assert [played.deck0 for played in match.bouts] == [0, 1]
    assert match.bouts[0].bout == match.bouts[1].bout
    assert match.points == (1.0, 1.0)


def test_a_recorded_match_is_the_match_played(tug, walker):
    """Recording reads the physics and writes none of it."""
    duel = dataclasses.replace(tug, time_limit_s=1.0, seeds=(1,))
    match, recorded = record_match(duel, walker, walker)
    assert match == play_match(duel, walker, walker)
    settle = round(duel.start.settle_s / CTRL_DT) + 1
    for played, each in zip(match.bouts, recorded, strict=True):
        assert each.bout == played.bout
        assert each.settle.shape == (2, settle, TRACE_WIDTH)
        # A bout the bell ended has no tail: a frame for every step the referee judged.
        assert each.trace.shape == (2, round(duel.time_limit_s / CTRL_DT), TRACE_WIDTH)
        assert each.trace.dtype == np.float32


def test_a_recorded_fall_runs_on_past_the_referee(tug):
    """The frame the bout was decided on is the first with the loser drop_m down,
    and the tail follows it into the pit. No settle, so it falls on the clock."""
    duel, model = placed(tug, (None, 0.1), start=dataclasses.replace(tug.start, settle_s=0.0))
    each = record_bout(duel, model, (_ZeroPolicy(), _ZeroPolicy()), seed=1)
    assert (each.bout.end, each.bout.winner) == ("pit", 0)
    decided = round(each.bout.time_s / CTRL_DT) - 1
    assert decided > 5
    assert each.trace.shape[1] == decided + 1 + round(TAIL_S / CTRL_DT)
    heights = each.trace[1, :, 2]
    assert heights[decided] < -duel.referee.drop_m
    assert np.all(heights[:decided] >= -duel.referee.drop_m)
    assert heights[-1] < -duel.decks.pit_depth_m / 2


def test_a_recorded_void_bout_stops_before_mujocos_reset(tug, monkeypatch):
    monkeypatch.setattr(arena.duel, "_reset_by_mujoco", lambda data: True)
    each = record_bout(tug, compile_duel(tug), (_ZeroPolicy(), _ZeroPolicy()), seed=1)
    assert each.bout.end == "void"
    assert each.trace.shape == (2, 0, TRACE_WIDTH)


def _bout(winner, end="pit"):
    return Bout(seed=1, winner=winner, end=end, time_s=1.0, rope_mid_m=0.0)


def test_a_played_bout_names_the_winner_as_the_match_does():
    assert Played(_bout(0), deck0=0).winner == 0
    assert Played(_bout(0), deck0=1).winner == 1
    assert Played(_bout(1), deck0=1).winner == 0
    assert Played(_bout(None), deck0=1).winner is None


def test_points_are_a_win_each_and_half_a_draw():
    match = Match((Played(_bout(0), 0), Played(_bout(0), 1), Played(_bout(None, "void"), 0),
                   Played(_bout(1), 0)))
    assert match.points == (1.5, 2.5)


def test_standings_count_every_bout():
    a_beats_b = Match((Played(_bout(0), 0), Played(_bout(1), 1)))
    a_draws_c = Match((Played(_bout(None), 0), Played(_bout(None, "bell"), 1)))
    c_beats_b = Match((Played(_bout(1), 0), Played(_bout(None), 1)))
    table = standings(["a", "b", "c"], {(0, 1): a_beats_b, (0, 2): a_draws_c, (1, 2): c_beats_b})
    assert [(row.name, row.won, row.drawn, row.lost, row.points) for row in table] == [
        ("a", 2, 2, 0, 3.0),
        ("c", 1, 3, 0, 2.5),
        ("b", 0, 1, 3, 0.5),
    ]


def test_standings_break_a_tie_on_wins_then_name():
    """All three on 2 points: the two with a win ahead of the one with four draws,
    and those two by name."""
    split = Match((Played(_bout(0), 0), Played(_bout(0), 1)))
    drawn = Match((Played(_bout(None), 0), Played(_bout(None), 1)))
    table = standings(["b", "c", "a"], {(0, 1): split, (0, 2): drawn, (1, 2): drawn})
    assert {row.points for row in table} == {2.0}
    assert [row.name for row in table] == ["b", "c", "a"]


@pytest.fixture
def probe(tmp_path, monkeypatch):
    write_duel(tmp_path)
    monkeypatch.setattr(arena.duel, "DUELS_DIR", tmp_path)


def test_duel_prints_every_bout_and_the_score(probe, capsys):
    assert main(["duel", REFERENCE, REFERENCE, "--duel", "probe"]) == 0
    out = capsys.readouterr().out
    assert out.count("seed 1  ") == 2
    assert "BEST_alpha_walking (1) 1–1 BEST_alpha_walking (2)" in out


def test_three_policies_play_a_round_robin(probe, capsys):
    assert main(["duel", REFERENCE, REFERENCE, REFERENCE, "--duel", "probe"]) == 0
    out = capsys.readouterr().out
    assert "points" in out
    assert out.count("1–1") == 3
    assert "seed 1  " not in out


def test_duel_needs_two_policies(capsys):
    assert main(["duel", REFERENCE]) == 1
    assert "two policies" in capsys.readouterr().err


def test_duel_refuses_an_unknown_duel(capsys):
    assert main(["duel", REFERENCE, REFERENCE, "--duel", "nope"]) == 1
    assert "no such duel" in capsys.readouterr().err


@pytest.fixture(scope="module")
def watched(tug, walker):
    """A short match recorded, and its names, as `arena duel --watch` serves one."""
    duel = dataclasses.replace(tug, time_limit_s=0.2, seeds=(1,))
    match, recorded = record_match(duel, walker, _ZeroPolicy())
    return duel, ["walker", "zero"], match, recorded


def test_the_watch_app_serves_the_match(watched, tmp_path):
    from fastapi.testclient import TestClient

    (tmp_path / "duel.html").write_text("<!doctype html><title>duel</title>")
    duel, names, match, recorded = watched
    client = TestClient(create_duel_app(duel, names, match, recorded, tmp_path))
    summary = client.get("/api/duel").json()
    assert summary["names"] == names
    assert summary["points"] == list(match.points)
    assert summary["course"]["rope_length_m"] == pytest.approx(2 * duel.start_x_m + duel.rope.slack_m)
    assert [bout["on_deck"] for bout in summary["bouts"]] == [names, names[::-1]]
    assert [bout["frames"] for bout in summary["bouts"]] == [r.trace.shape[1] for r in recorded]
    for k, each in enumerate(recorded):
        for part, frames in (("trace", each.trace), ("settle", each.settle)):
            sent = client.get(f"/api/duel/bouts/{k}/{part}")
            assert sent.headers["X-Duck-Count"] == "2"
            assert sent.headers["X-Frame-Count"] == str(frames.shape[1])
            got = np.frombuffer(sent.content, dtype="<f4").reshape(frames.shape)
            assert np.array_equal(got, frames)
    assert client.get(f"/api/duel/bouts/{len(recorded)}/trace").status_code == 404
    assert "<title>duel</title>" in client.get("/").text


def test_the_watch_app_says_when_the_page_is_not_built(watched):
    from fastapi.testclient import TestClient

    client = TestClient(create_duel_app(*watched, frontend_dir=None))
    page = client.get("/")
    assert page.status_code == 503
    assert "npm run build" in page.text
    assert client.get("/api/duel").status_code == 200


def test_watch_plays_the_match_then_serves_it(probe, monkeypatch, capsys):
    import arena.workshop.cli

    served = {}
    monkeypatch.setattr(arena.workshop.cli, "serve", lambda app, port: served.update(app=app, port=port))
    assert main(["duel", REFERENCE, REFERENCE, "--duel", "probe", "--watch", "--no-browser",
                 "--port", "8799"]) == 0
    out = capsys.readouterr().out
    assert "BEST_alpha_walking (1) 1–1 BEST_alpha_walking (2)" in out
    assert "http://127.0.0.1:8799/" in out
    assert served["port"] == 8799
    from fastapi.testclient import TestClient

    summary = TestClient(served["app"]).get("/api/duel").json()
    assert summary["id"] == "probe"
    assert len(summary["bouts"]) == 2


def test_watch_shows_one_match(capsys):
    assert main(["duel", REFERENCE, REFERENCE, REFERENCE, "--watch"]) == 1
    assert "two policies" in capsys.readouterr().err


def test_watch_refuses_a_busy_port(capsys):
    import socket

    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        assert main(["duel", REFERENCE, REFERENCE, "--watch", "--port", str(port)]) == 1
    assert "busy" in capsys.readouterr().err
