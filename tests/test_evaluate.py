import platform

import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import RUNNER_VERSION
from arena.evaluate import (
    ScanPoint,
    SeedResult,
    evaluate,
    finalists,
    mean_finish_time,
    pick_trace_seed,
    seed_row,
)
from arena.golden import PLATFORM
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once
from arena.tug import BoutOutcome, reference_duck
from tests.test_tug import bout_trace


def _results(*pairs):
    return tuple(
        SeedResult(seed=s, status="finish" if t is not None else "fall", time_s=t)
        for s, t in pairs
    )


def test_mean_counts_a_dnf_at_the_time_limit():
    per_seed = _results((1, 20.0), (2, 20.0), (3, None))
    # (20 + 20 + 45) / 3
    assert mean_finish_time(per_seed, 45.0) == pytest.approx(85.0 / 3)


def test_mean_of_all_finishers_is_the_plain_mean():
    assert mean_finish_time(_results((1, 10.0), (2, 20.0)), 45.0) == pytest.approx(15.0)


def test_a_steady_policy_beats_a_brilliant_flaky_one():
    steady = mean_finish_time(_results((1, 25.0), (2, 25.0), (3, 25.0)), 45.0)
    # Brief's brief used 15.0/15.0 here, which ties steady exactly ((15+15+45)/3
    # == (25+25+25)/3 == 25.0) rather than losing to it — an arithmetic slip in
    # the source, not a tolerance issue. 20.0/20.0 keeps the "faster on the runs
    # that finish, but the DNF still costs more than that speed buys back" shape
    # while actually landing flaky above steady.
    flaky = mean_finish_time(_results((1, 20.0), (2, 20.0), (3, None)), 45.0)
    assert steady < flaky


def test_trace_seed_is_the_lower_median_finisher():
    # Finishers 10, 20, 30 -> median 20 -> seed 2.
    assert pick_trace_seed(_results((1, 10.0), (2, 20.0), (3, 30.0))) == 2
    # Even count 10, 20 -> the faster of the middle two -> seed 1.
    assert pick_trace_seed(_results((1, 10.0), (2, 20.0))) == 1
    # Non-finishers are ignored when choosing.
    assert pick_trace_seed(_results((1, None), (2, 20.0), (3, 30.0))) == 2


def test_trace_seed_falls_back_to_the_first_seed_when_nobody_finishes():
    assert pick_trace_seed(_results((7, None), (8, None))) == 7


def test_evaluating_the_reference_policy_scores_and_carries_the_trace_seeds_replay():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)

    assert result.event_id == "sprint-2m"
    assert len(result.per_seed) == len(manifest.seeds)
    assert 0 <= result.seeds_finished <= len(manifest.seeds)
    assert result.runner_version == RUNNER_VERSION
    assert result.trace.shape[1] == 21
    assert result.trace_seed in manifest.seeds
    assert result.score == pytest.approx(
        mean_finish_time(result.per_seed, manifest.time_limit_s)
    )
    replay = run_once(
        manifest, policy, result.trace_seed, command=manifest.command_at(result.command_vx)
    )
    np.testing.assert_array_equal(result.trace, replay.trace)
    np.testing.assert_array_equal(result.settle, replay.settle)


def test_evaluate_is_deterministic():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    first, second = evaluate(manifest, policy), evaluate(manifest, policy)
    assert first.score == second.score
    assert first.command_vx == second.command_vx
    assert first.per_seed == second.per_seed
    assert first.scan == second.scan
    np.testing.assert_array_equal(first.trace, second.trace)


# Baseline, measured at RUNNER_VERSION 4 (BAM XL330 servos, arena/actuator.py,
# on MuJoCo 3.10.0 — see arena/golden.py). At version 3 — same sweep, MJCF
# position servos, one arm64/x86 number good to 0.37% — the same policy scored
# 11.792 s at 0.40 m/s; at version 2 — same sweep, MuJoCo 3.12.0 — 11.724 s at
# 0.40 m/s; at version 1 — one pinned command at 0.25 m/s — 18.216 s. Kept as
# the contrast: the sweep, the physics, and now the actuator have each moved
# it.
#
# v4's BAM servos are chaotically sensitive to arithmetic: an arm64 run and an
# x86_64 run of the same policy/seed/command diverge after 1-3 s, so the
# baseline is per-platform rather than one number (own copy here, kept in
# sync with arena.golden.BASELINES by the cross-check test below).
# Darwin-arm64: this Mac — 7.988 s at 0.55 m/s before training's reset and
# fifth actuator writes joined the runner (arena/runner.py), 8.672 s at 0.50
# since. Linux-x86_64: HF Jobs, Intel Xeon Platinum 8375C and AMD EPYC 7R13,
# identical — 8.556 s at 0.50 on Intel before those writes and the libm
# exp/pow (arena/golden.py), 9.404 s at 0.45 since — the Space runs x86_64. At
# version 5, the finishes clocked to the substep: 8.666 s and 9.392 s. On a
# platform with no baseline the tests that need one skip, and
# arena.golden.check() refuses.
GOLDEN_BASELINES = {
    "Darwin-arm64": (8.666, 0.50),
    "Linux-x86_64": (9.392, 0.45),
}
GOLDEN_SCORE_S, GOLDEN_COMMAND_VX = GOLDEN_BASELINES.get(PLATFORM, (None, None))
needs_golden = pytest.mark.skipif(
    GOLDEN_SCORE_S is None, reason=f"no golden baseline measured on {PLATFORM}"
)
# Re-measured at version 4, at the same command version 1 used (0.25 m/s, the
# event's declared vx), on arm64 (this suite only runs on the Mac — this
# number, and every other v4 pin in this test file, tests/test_routes_submit.py,
# and tests/test_hub_fetch.py, is an arm64 measurement): 24.856 s, seed 1
# falling and counted at the 50 s limit, the other four finishing in 18.1-19.0
# s. Before training's reset and fifth actuator writes joined the runner it was
# 18.208 s with all five finishing — close to version 1's 18.216 s by
# coincidence, not because the physics agreed. At version 5, the finishes
# clocked to the substep: 24.853 s.
PINNED_SCORE_S = 24.853


@needs_golden
def test_golden_run_reference_policy_holds_its_time():
    """Guards against a physics or harness change silently invalidating the board.

    If this fails, either the change was intended — bump RUNNER_VERSION and
    re-baseline this number in the same commit — or it is a regression. It must
    never be adjusted casually: every recorded time depends on it.
    """
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)
    assert result.seeds_finished == len(manifest.seeds), "the walker should finish every seed"
    assert result.score == pytest.approx(GOLDEN_SCORE_S, rel=0.02)
    # The winning command is pinned too. A score can be reproduced by accident
    # from a different speed; both together cannot.
    assert result.command_vx == pytest.approx(GOLDEN_COMMAND_VX)


def _scan(*pairs):
    return tuple(
        ScanPoint(
            command_vx=vx,
            status="finish" if t is not None else "fall",
            time_s=t,
            progress_m=2.0 if t is not None else progress,
        )
        for vx, t, progress in pairs
    )


def test_finalists_are_the_fastest_scanned_speeds():
    scan = _scan((0.2, 30.0, 0), (0.3, 12.0, 0), (0.4, 15.0, 0), (0.5, None, 1.1))
    assert finalists(scan, 2) == [0.3, 0.4]
    assert finalists(scan, 1) == [0.3]


def test_finalists_break_a_tie_on_the_lower_command():
    scan = _scan((0.5, 12.0, 0), (0.3, 12.0, 0))
    assert finalists(scan, 1) == [0.3]


def test_a_short_shortlist_is_topped_up_with_the_near_misses():
    """Measured on the hill climb: one of eighteen scanned speeds finished, and
    that one was a fluke it repeated on 1 seed out of 5. Scoring only the scan's
    finishers would have taken the fluke and never tried the speeds that got
    nearly as far — with the seed budget for them already paid for."""
    scan = _scan((0.2, None, 0.3), (0.3, 12.0, 0), (0.4, None, 1.6), (0.5, None, 0.9))
    # The finisher leads; the two that got furthest fill the rest.
    assert finalists(scan, 3) == [0.3, 0.4, 0.5]
    # Never a duplicate, even though 0.3 is both the finisher and high-progress.
    assert len(set(finalists(scan, 4))) == 4


def test_asking_for_more_finalists_than_there_are_speeds_is_not_an_error():
    scan = _scan((0.2, 30.0, 0), (0.3, 12.0, 0))
    assert sorted(finalists(scan, 9)) == [0.2, 0.3]


def test_with_nothing_finishing_the_shortlist_leads_with_the_furthest():
    """Every speed scores the time limit, so what is left to decide is which
    attempt gets replayed — and that should be the best one."""
    scan = _scan((0.2, None, 0.4), (0.3, None, 1.6), (0.4, None, 0.9))
    assert finalists(scan, 3)[0] == 0.3
    assert finalists(scan, 1) == [0.3]


def test_a_progress_tie_goes_to_the_lower_command():
    """Matching how evaluate() breaks a tie on score: same result for less
    asking is the steadier of the two, and it keeps the winner reproducible."""
    scan = _scan((0.7, None, 0.8), (0.3, None, 0.8))
    assert finalists(scan, 1) == [0.3]


@needs_golden
def test_the_scan_covers_exactly_the_range_the_event_declares():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)
    assert tuple(p.command_vx for p in result.scan) == manifest.sweep.speeds()
    # Not just "some speeds": a range wide enough to hold a policy well faster
    # than today's reference, whose own optimum is 0.50.
    assert len(result.scan) >= 20
    # v3: 2.5x and not 3x, because 3 * 0.4 is 1.2000000000000002 in binary
    # floating point — the same accumulation error Sweep.speeds() carries its
    # epsilon for — right at the declared ceiling (1.20), too close to trust.
    # v4: the reference's own optimum moved to 0.55, so even the declared
    # ceiling itself was only 1.2 / 0.55 ~= 2.18x it — a smaller margin than v3
    # had at 3x. 2.0x keeps a safe distance under that boundary rather than
    # asserting right up against it. (Since training's reset and fifth actuator
    # writes joined the runner the optimum is 0.50, 2.4x under the ceiling.)
    assert result.scan[-1].command_vx >= 2.0 * GOLDEN_COMMAND_VX


@needs_golden
def test_the_score_comes_from_a_speed_the_scan_shortlisted():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)
    assert result.command_vx in finalists(result.scan, manifest.sweep.finalists)
    assert result.command_vx == pytest.approx(GOLDEN_COMMAND_VX)


def test_the_sweep_beats_the_command_the_event_used_to_pin():
    """The claim that justifies the whole two-stage scan.

    Version 1 commanded every entry at the event's declared vx and reported the
    result as the policy's time. This runs that exact old measurement — same
    physics, same seeds, same metric — and asserts the sweep finds the reference
    walker substantially faster than its own pinned number. If these ever come
    out equal, the sweep has stopped searching and is scoring the declared speed
    by another route.
    """
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")

    pinned = tuple(
        SeedResult(seed=o.seed, status=o.status, time_s=o.time_s)
        for o in (run_once(manifest, policy, seed) for seed in manifest.seeds)
    )
    pinned_score = mean_finish_time(pinned, manifest.time_limit_s)
    assert pinned_score == pytest.approx(PINNED_SCORE_S, rel=0.02)

    swept = evaluate(manifest, policy)
    assert swept.score < pinned_score * 0.9, "the sweep found nothing the pin missed"
    assert swept.command_vx != manifest.command[0]


def test_the_installed_mujoco_is_the_one_the_baseline_was_measured_with():
    """The guard that was missing when a container resolved MuJoCo 3.13.

    RUNNER_VERSION states that runs from different physics are never compared.
    Nothing enforced it, because nothing noticed the physics moving underneath —
    and it moved by a factor of two on this very policy.
    """
    import mujoco

    from arena import golden

    assert mujoco.__version__ == golden.MUJOCO_VERSION


def test_the_golden_module_agrees_with_this_files_baseline():
    """Two places record the same numbers, so they must not drift apart. The
    Dockerfile runs arena.golden; the suite runs the assertions above. Compares
    the whole per-platform mapping, not just the current platform's entry,
    so a drift on a platform nobody is running today still gets caught."""
    from arena import golden

    assert golden.BASELINES == GOLDEN_BASELINES
    assert golden.EVENT_ID == "sprint-2m"


@needs_golden
def test_the_golden_check_passes_and_returns_the_measured_score():
    from arena import golden

    assert golden.check() == pytest.approx(GOLDEN_SCORE_S, rel=0.02)


def test_a_wrong_mujoco_version_is_a_readable_refusal_not_a_bare_assert():
    """The message has to tell whoever hits this what to do about it."""
    from arena import golden

    original = golden.MUJOCO_VERSION
    golden.MUJOCO_VERSION = "0.0.1-not-a-real-version"
    try:
        with pytest.raises(AssertionError) as caught:
            golden.check_mujoco_version()
    finally:
        golden.MUJOCO_VERSION = original
    message = str(caught.value)
    assert "cannot be compared" in message
    assert "RUNNER_VERSION" in message
    assert "pyproject.toml" in message


def test_the_baseline_key_names_the_os_and_the_machine():
    """"Darwin-arm64" and "Linux-x86_64", not the machine alone: the same CPU
    architecture under another OS runs another C library, so it is another
    platform with its own baseline."""
    from arena import golden

    assert golden.PLATFORM == f"{platform.system()}-{platform.machine()}"


def test_an_unmeasured_platform_is_a_readable_refusal(monkeypatch):
    """No baseline is never a pass: the message names the platform and says
    what to do."""
    from arena import golden

    monkeypatch.setattr(golden, "PLATFORM", "Plan9-mips")
    with pytest.raises(AssertionError) as caught:
        golden.check()
    message = str(caught.value)
    assert "'Plan9-mips'" in message
    assert "BASELINES" in message


TUG = load_event("tug-of-war")


def test_a_tug_is_rated_by_one_bout_a_seed_against_the_reference(monkeypatch):
    entry, reference, played = object(), object(), []
    bouts = {1: (1, "marker", -0.10, ()), 2: (1, "marker", -0.20, ()), 3: (1, "pit", -0.30, (1,)),
             4: (0, "marker", 0.02, ()), 5: (0, "marker", 0.05, ())}
    def fake(manifest, west, east, seed, model=None):
        played.append((seed, west is entry, {id(west), id(east)} == {id(entry), id(reference)}))
        loser, how, x, pit = bouts[seed]
        trace = bout_trace(x, pit)
        trace[:, :, 10] = seed   # a joint column marks the bout a trace comes from
        return BoutOutcome(seed, loser, how, 45.0, trace, np.zeros((2, 26, 21)))
    monkeypatch.setattr("arena.evaluate.reference_duck", lambda manifest: reference)
    monkeypatch.setattr("arena.evaluate.compile_tug", lambda *args: "model")
    monkeypatch.setattr("arena.evaluate.run_bout", fake)
    result = evaluate(TUG, entry)
    assert played == [(1, True, True), (2, False, True), (3, True, True), (4, False, True), (5, True, True)]
    assert [s.status for s in result.per_seed] == ["won", "lost", "pit_won", "won", "lost"]
    assert [s.score_cm for s in result.per_seed] == pytest.approx([10.0, -20.0, 130.0, 2.0, -5.0])
    assert (result.score, result.trace_seed, result.seeds_finished) == (pytest.approx(23.4), 4, 5)
    assert (result.command_vx, result.scan, result.trace.shape, result.settle.shape) == (-0.3, (), (2, 1, 21), (2, 26, 21))
    assert (result.trace[:, :, 10] == 4).all()


def test_the_reference_against_itself_gains_no_ground_on_the_marker():
    """A pit may still happen: the string's weight hanging in it can draw a stalemate into the
    pit (spec 2026-10-21). Every bout the marker decides stays within 10 cm of the centre line."""
    result = evaluate(TUG, reference_duck(TUG))
    assert all(abs(s.score_cm) < 10.0 for s in result.per_seed if not s.status.startswith("pit"))
    assert result.trace.shape[0] == 2 and result.settle.shape == (2, 26, 21)


def test_a_duck_that_walks_forward_drops_itself_in_and_rates_below_minus_the_bonus():
    with pytest.raises(ValueError, match="against its reference duck"):   # a tug takes no cast
        evaluate(TUG, object(), cast=())
    result = evaluate(TUG, load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"))
    assert {s.status for s in result.per_seed} == {"pit_lost"} and result.score < -TUG.rating.pit_bonus_cm


def test_a_seed_row_carries_centimetres_only_on_a_tug():
    assert seed_row(SeedResult(2, "won", 45.0, 12.5)) == {"seed": 2, "status": "won", "time_s": 45.0, "score_cm": 12.5}
    assert seed_row(SeedResult(1, "finish", 4.9)) == {"seed": 1, "status": "finish", "time_s": 4.9}
