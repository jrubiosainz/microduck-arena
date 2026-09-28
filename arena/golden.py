"""The physics fingerprint: one policy, one event, one number.

`RUNNER_VERSION` states the rule that runs from different physics are never
compared. It cannot enforce it, because nothing in it notices when the physics
underneath moves — and it does move. MuJoCo's solver changes between minor
versions: the reference walker at the sprint's original pinned command scores
18.2 s under 3.12.0 and 44.9 s under 3.13.0. Same policy, same course, same
code.

That drift reached a container once, through an unpinned `mujoco>=3.2` in
pyproject.toml, and produced an app whose leaderboard would have been quietly
incomparable with every other one. The dependency pins are the fix; this module
is the tripwire, so a pin that gets loosened or a wheel that resolves
differently fails loudly and early instead of a year of times later.

Used by the test suite AND by the Docker build, so an image cannot be built
whose physics does not reproduce the baseline.

Version 3 moved the pins to MuJoCo 3.10.0, the version mjlab trains with, so a
challenges checkout can install this package next to mjlab-microduck. The
walker was re-measured on it; the number below is that measurement.

Version 4 moved the runner itself: the robot is now driven by the BAM XL330
servo model training uses (arena/actuator.py) instead of the MJCF position
servos. That also turned this module's single number into two: the actuator's
per-substep friction/delay model is chaotic enough that an arm64 run and an
x86_64 run of the same policy, seed, and command diverge after 1-3 s of
simulated time (v3's MJCF-servo Mac/x86 gap was 0.37%; v4's BAM-servo gap is
7%). The baseline below is therefore keyed by platform (OS and machine) rather
than being one number: Mac development measures Darwin-arm64; the Space runs
Linux-x86_64, measured on HF Jobs (Intel Xeon 8375C and AMD EPYC 7R13 agree
with each other to 0.14%, so x86_64 itself is not the source of the
divergence — the arm64/x86_64 boundary is).
"""

import platform

MUJOCO_VERSION = "3.10.0"

EVENT_ID = "sprint-2m"
POLICY = "BEST_alpha_walking.onnx"
# This platform's key into BASELINES: the OS and the machine, because the same
# CPU architecture under another OS runs another C library.
PLATFORM = f"{platform.system()}-{platform.machine()}"
# The full-sweep score, and the commanded speed the sweep chose for it, keyed
# by PLATFORM. Both the score and the speed, because a score can be reproduced
# by luck from a different speed. Darwin-arm64: this Mac. Linux-x86_64: HF Jobs
# (Intel Xeon 8375C and AMD EPYC 7R13, 0.14% apart) — the Space runs x86_64.
BASELINES: dict[str, tuple[float, float]] = {
    "Darwin-arm64": (7.988, 0.55),
    "Linux-x86_64": (8.556, 0.50),
}
# The score check only catches gross drift: the 3.13 regression above was
# roughly a factor of two. A pin move can be far smaller and still slip past
# it — 3.12.0 -> 3.10.0 moved this walker 0.58%, well inside this tolerance —
# which is what check_mujoco_version() is for. TOLERANCE applies WITHIN one
# platform's own baseline, not across the arm64/x86_64 split in BASELINES
# above: v3's MJCF servos put the two platforms 0.37% apart, comfortably
# inside 2%, but v4's BAM servos put them 7% apart, which is why the baseline
# became per-platform instead of this number being widened to cover it.
TOLERANCE = 0.02


def check_mujoco_version() -> None:
    import mujoco

    if mujoco.__version__ != MUJOCO_VERSION:
        raise AssertionError(
            f"MuJoCo {mujoco.__version__} is installed, but every recorded time was "
            f"measured with {MUJOCO_VERSION}. Physics differs between minor versions, "
            "so this build would produce times that cannot be compared with the board's. "
            "Either restore the pin in pyproject.toml, or re-baseline arena/golden.py "
            "and bump RUNNER_VERSION in the same commit."
        )


def check() -> float:
    """Re-measure the baseline. Raises with a readable diagnosis on drift."""
    from .assets import ASSET_ROOT
    from .evaluate import evaluate
    from .manifest import load_event
    from .policy import load_policy

    check_mujoco_version()
    try:
        score_s, command_vx = BASELINES[PLATFORM]
    except KeyError:
        raise AssertionError(
            f"no golden baseline for platform {PLATFORM!r}. Runs from different "
            "physics are never compared, and this actuator's chaotic sensitivity to "
            "arithmetic means that includes different platforms (see the module "
            f"docstring): measure the golden run here first, then add {PLATFORM!r} to "
            "BASELINES in the same commit."
        ) from None
    result = evaluate(load_event(EVENT_ID), load_policy(ASSET_ROOT / "policies" / POLICY))
    if abs(result.score - score_s) > score_s * TOLERANCE:
        raise AssertionError(
            f"golden run drifted: {result.score:.3f}s at {result.command_vx:.2f} m/s, "
            f"expected {score_s}s at {command_vx} m/s on {PLATFORM}"
        )
    return result.score


if __name__ == "__main__":
    print(f"golden run holds: {check():.3f}s")
