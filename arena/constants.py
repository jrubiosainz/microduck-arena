"""The policy interface: joint order, default pose, observation/action sizes,
and control rates — shared with training and the sandbox.

Transcribed from pollen-robotics/microduck-simulator, app/src/game/constants.js.
A mismatch here does not crash: it makes a policy behave differently than it does
in the sandbox, which is far harder to notice. Keep this module boring.

As of RUNNER_VERSION 4 the physics behind these numbers no longer matches the
sandbox's own position servos (see the comment above RUNNER_VERSION below); the
interface they describe still must.
"""

import numpy as np

JOINT_NAMES: tuple[str, ...] = (
    "left_hip_yaw",
    "left_hip_roll",
    "left_hip_pitch",
    "left_knee",
    "left_ankle",
    "neck_pitch",
    "head_pitch",
    "head_yaw",
    "head_roll",
    "right_hip_yaw",
    "right_hip_roll",
    "right_hip_pitch",
    "right_knee",
    "right_ankle",
)

# The STAND keyframe from mjlab's scene_walk.xml, in JOINT_NAMES order.
DEFAULT_POSE = np.array(
    [
        0.0, -0.08726646259971647, -0.457924, -0.004940, 0.452984,
        0.3490658503988659, 0.3490658503988659, 0.0, 0.0,
        0.0, 0.08726646259971647, 0.457924, 0.004940, -0.452984,
    ],
    dtype=np.float64,
)

NUM_JOINTS = 14
OBS_SIZE = 61
CMD_SIZE = 13
ACTION_SCALE = 1.0

TIMESTEP = 0.005
DECIMATION = 4
CTRL_DT = TIMESTEP * DECIMATION  # 50 Hz

VEL_FWD = 0.25   # legs, m/s
RVEL_FWD = 0.6   # rollers, m/s

# One trace frame: trunk position(3) + trunk quaternion(4) + joint angles(14).
TRACE_WIDTH = 3 + 4 + NUM_JOINTS

# Bump on ANY change to physics, course geometry, the observation/action path,
# or what a recorded time MEANS. Runs are only ever compared within one
# RUNNER_VERSION; older ones stay in the log and drop off the board rather than
# being silently ranked against numbers measured a different way.
#
# 2: scores come from a speed sweep, not a single pinned command. A v1 time was
#    the policy's pace at exactly the event's declared vx; a v2 time is its best
#    pace over the whole declared range, so v1 times are systematically slower
#    and comparing the two would rank by version rather than by policy.
#
# 3: the physics moved to MuJoCo 3.10.0 (with onnxruntime 1.24.4 and numpy
#    2.4.1), the versions mjlab trains with, so the Arena can be installed next
#    to mjlab-microduck in a challenges checkout. The reference walker was
#    re-measured on it (arena/golden.py); v2 times were made by a different
#    solver and are not comparable.
#
# 4: the Arena drives the robot with the BAM XL330 servo model training uses
#    (arena/actuator.py) — nominal values, training's per-substep command
#    delay, and its one-control-step joint-velocity lag — run at the points
#    training runs it (arena/runner.py: once more after each control step's
#    substeps, and once at reset on 0 rad targets), instead of the MJCF
#    position servos the sandbox uses. v3 times were made by a different
#    actuator and are not comparable.
#
# 5: a race's finish is timed to the physics step that crosses the line (5 ms)
#    instead of the control step it falls in (20 ms), so a five-seed score is
#    to the millisecond rather than to 4 ms. The physics is unchanged, so a v4
#    time is the same run clocked up to 15 ms a seed later, still not
#    comparable.
RUNNER_VERSION = 5
