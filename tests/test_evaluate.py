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
)
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once


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


# Baseline, measured at RUNNER_VERSION 2 (the speed sweep). At version 1 — one
# pinned command at 0.25 m/s — the same policy and the same physics scored
# 18.216 s; the sweep finds it 0.40 m/s and 11.724 s. The gap is the whole
# reason the sweep exists, so keep the old number here as the contrast.
GOLDEN_SCORE_S = 11.724
GOLDEN_COMMAND_VX = 0.40
PINNED_SCORE_S = 18.216  # what version 1 reported, at the event's declared vx


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


def test_the_scan_covers_exactly_the_range_the_event_declares():
    manifest = load_event("sprint-2m")
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    result = evaluate(manifest, policy)
    assert tuple(p.command_vx for p in result.scan) == manifest.sweep.speeds()
    # Not just "some speeds": a range wide enough to hold a policy well faster
    # than today's reference, whose own optimum is 0.40.
    assert len(result.scan) >= 20
    # 2.5x and not 3x: 3 * 0.4 is 1.2000000000000002 in binary floating point,
    # which is the same accumulation error Sweep.speeds() carries its epsilon for.
    assert result.scan[-1].command_vx >= 2.5 * GOLDEN_COMMAND_VX


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
    """Two places record the same number, so they must not drift apart. The
    Dockerfile runs arena.golden; the suite runs the assertions above."""
    from arena import golden

    assert golden.SCORE_S == GOLDEN_SCORE_S
    assert golden.COMMAND_VX == GOLDEN_COMMAND_VX
    assert golden.EVENT_ID == "sprint-2m"


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
