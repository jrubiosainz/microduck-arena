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
"""

MUJOCO_VERSION = "3.10.0"

EVENT_ID = "sprint-2m"
POLICY = "BEST_alpha_walking.onnx"
# The full-sweep score, and the commanded speed the sweep chose for it. Both,
# because a score can be reproduced by luck from a different speed.
SCORE_S = 11.792
COMMAND_VX = 0.40
# Generous enough for the last bits of floating-point difference between
# machines, tight enough that a solver change cannot slip through: the 3.13
# regression was a factor of two.
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
    result = evaluate(load_event(EVENT_ID), load_policy(ASSET_ROOT / "policies" / POLICY))
    if abs(result.score - SCORE_S) > SCORE_S * TOLERANCE:
        raise AssertionError(
            f"golden run drifted: {result.score:.3f}s at {result.command_vx:.2f} m/s, "
            f"expected {SCORE_S}s at {COMMAND_VX} m/s"
        )
    return result.score


if __name__ == "__main__":
    print(f"golden run holds: {check():.3f}s")
