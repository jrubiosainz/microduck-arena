"""What a performance on a stage did, read off its trace.

A stage never stops a run for a fall (`arena.runner.run_stage`): whatever
happens is part of the performance. So what happened is read afterwards, from
the trace: when the event's fall rule first held, and when the duck was seated
or standing. `arena score` summarises a stage run with these; a challenge can
check its own choreography with them.

A trace frame is the state after one control step: trunk position (0:3),
trunk quaternion w, x, y, z (3:7), then the joint angles in JOINT_NAMES order.
"""

import numpy as np

from .constants import CTRL_DT
from .manifest import Termination

# Trunk heights measured on the robot: about 0.06 m seated, 0.115 m standing.
SEATED_Z_M = 0.07
STANDING_Z_M = 0.10
UPRIGHT_DEG = 20.0


def _cos_tilt(trace: np.ndarray) -> np.ndarray:
    """The trunk's up axis against the world's, per frame: R[2, 2] of the quaternion."""
    x, y = trace[:, 4], trace[:, 5]
    return 1.0 - 2.0 * (x * x + y * y)


def tilt_deg(trace: np.ndarray) -> np.ndarray:
    return np.degrees(np.arccos(np.clip(_cos_tilt(trace), -1.0, 1.0)))


def seated(trace: np.ndarray) -> np.ndarray:
    return trace[:, 2] < SEATED_Z_M


def standing(trace: np.ndarray) -> np.ndarray:
    return (trace[:, 2] > STANDING_Z_M) & (tilt_deg(trace) <= UPRIGHT_DEG)


def fell_at(trace: np.ndarray, termination: Termination) -> float | None:
    """When the fall rule first held, where a lane would have stopped the run, or None.

    `arena.runner.run_once`'s rule: projected gravity's z (-R[2, 2]) above
    `fall_gravity_z` for `fall_hold_s` straight control steps, timed at the step
    that completes the hold.
    """
    tipped = -_cos_tilt(trace) > termination.fall_gravity_z
    needed = round(termination.fall_hold_s / CTRL_DT)
    run = 0
    for frame, is_tipped in enumerate(tipped):
        run = run + 1 if is_tipped else 0
        if run >= needed:
            return (frame + 1) * CTRL_DT
    return None


def summary(trace: np.ndarray, termination: Termination) -> dict:
    """What a performance did: when the fall rule first held (or None), and how long it sat and stood."""
    return {
        "fell_at": fell_at(trace, termination),
        "seated_s": float(seated(trace).sum() * CTRL_DT),
        "standing_s": float(standing(trace).sum() * CTRL_DT),
    }


def summaries(trace: np.ndarray, termination: Termination) -> list[dict]:
    """`summary` of each duck of a troupe's (ducks, frames, TRACE_WIDTH) trace, in duck order."""
    return [summary(duck, termination) for duck in trace]
