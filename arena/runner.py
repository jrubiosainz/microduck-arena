"""Run one policy, on one event, at one seed.

No queue, no storage, no HTTP: this narrowness is what makes the determinism and
golden-run tests possible, and those tests are the only thing standing between a
physics change and a silently invalidated leaderboard.

The loop is the sandbox's controlStep(), verbatim in effect: build the 61-D
observation, run the policy, write ctrl = DEFAULT_POSE + action, step physics
four times.
"""

import zlib
from dataclasses import dataclass

import mujoco
import numpy as np

from .constants import (
    ACTION_SCALE,
    CTRL_DT,
    DECIMATION,
    DEFAULT_POSE,
    JOINT_NAMES,
    NUM_JOINTS,
    OBS_SIZE,
    TRACE_WIDTH,
)
from .course import compile_course, ramp_dir
from .manifest import Manifest

_WORLD_DOWN = np.array([0.0, 0.0, -1.0])


@dataclass(frozen=True)
class RunOutcome:
    seed: int
    status: str  # "finish" | "fall" | "timeout"
    time_s: float | None
    progress_m: float
    # Where the start line landed in course coordinates, after settling. Exposed
    # so a test can assert the clock and the start line agree.
    start_progress_m: float
    trace: np.ndarray  # (frames, TRACE_WIDTH) float32


@dataclass(frozen=True)
class _Addresses:
    qpos: np.ndarray
    dof: np.ndarray
    gyro: int
    trunk: int
    stand_key: int

    @classmethod
    def of(cls, model, keyframe: str) -> "_Addresses":
        return cls(
            qpos=np.array([int(model.joint(n).qposadr[0]) for n in JOINT_NAMES]),
            dof=np.array([int(model.joint(n).dofadr[0]) for n in JOINT_NAMES]),
            gyro=int(model.sensor("imu_ang_vel").adr[0]),
            trunk=int(model.body("trunk_base").id),
            stand_key=int(model.key(keyframe).id),
        )


def seed_rng(event_id: str, seed: int) -> np.random.Generator:
    """A generator that is identical in every process.

    Python's hash() is salted per process, so it must never appear here: a run
    that is not reproducible cannot be verified, and verification is the whole
    point of running server-side.
    """
    return np.random.default_rng([zlib.crc32(event_id.encode()), seed])


def _observe(model, data, adr, last_action, command) -> np.ndarray:
    obs = np.empty(OBS_SIZE, dtype=np.float32)
    obs[0:3] = data.sensordata[adr.gyro : adr.gyro + 3]
    # Projected gravity: world -z rotated into the trunk frame. xmat is
    # body->world, so its transpose takes a world vector into the body frame.
    rotation = data.xmat[adr.trunk].reshape(3, 3)
    obs[3:6] = rotation.T @ _WORLD_DOWN
    obs[6:20] = data.qpos[adr.qpos] - DEFAULT_POSE
    obs[20:34] = data.qvel[adr.dof]
    obs[34:48] = last_action
    obs[48:61] = command
    return obs


def _perturb(model, data, adr, manifest, seed) -> None:
    rng = seed_rng(manifest.id, seed)
    start = manifest.start
    data.qpos[adr.qpos] += rng.uniform(-start.joint_rad, start.joint_rad, NUM_JOINTS)
    yaw = np.radians(rng.uniform(-start.yaw_deg, start.yaw_deg))
    data.qpos[3:7] = [np.cos(yaw / 2), 0.0, 0.0, np.sin(yaw / 2)]
    mujoco.mj_forward(model, data)


def _step(model, data, policy, adr, command, last_action) -> np.ndarray:
    obs = _observe(model, data, adr, last_action, command)
    action = policy.act(obs)
    data.ctrl[:] = DEFAULT_POSE + action * ACTION_SCALE
    for _ in range(DECIMATION):
        mujoco.mj_step(model, data)
    return action


def run_once(manifest: Manifest, policy, seed: int, model=None, command=None) -> RunOutcome:
    model = model if model is not None else compile_course(manifest)
    data = mujoco.MjData(model)
    adr = _Addresses.of(model, manifest.start.keyframe)

    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    _perturb(model, data, adr, manifest, seed)

    # Converted once per run, not per step. The manifest holds an immutable tuple
    # so a loaded event cannot be mutated in place by anything downstream.
    #
    # `command` overrides it for one run, which is how the speed sweep works
    # (see evaluate.py). The event still owns the shape of the command; a caller
    # only gets to say how fast.
    command = np.asarray(manifest.command if command is None else command, dtype=np.float64)
    last_action = np.zeros(NUM_JOINTS, dtype=np.float32)

    # Settle with the policy running and the clock stopped: nobody is timed on
    # standing up.
    for _ in range(round(manifest.start.settle_s / CTRL_DT)):
        last_action = _step(model, data, policy, adr, command, last_action)

    direction = ramp_dir(manifest.course.slope_deg)
    start_progress = float(direction @ data.qpos[0:3])
    max_steps = round(manifest.time_limit_s / CTRL_DT)
    fall_steps_needed = round(manifest.termination.fall_hold_s / CTRL_DT)

    frames = np.empty((max_steps, TRACE_WIDTH), dtype=np.float32)
    tipped_for = 0
    status = "timeout"
    time_s = None
    progress = 0.0
    written = 0

    for step in range(max_steps):
        last_action = _step(model, data, policy, adr, command, last_action)

        frames[written, 0:3] = data.qpos[0:3]
        frames[written, 3:7] = data.qpos[3:7]
        frames[written, 7:TRACE_WIDTH] = data.qpos[adr.qpos]
        written += 1

        if not np.all(np.isfinite(data.qpos)):
            status = "fall"  # a solver explosion is a fall, not a mystery
            break

        # Fall is judged BEFORE finish, and the order matters. Reaching the fall
        # branch means the robot has been tipped for fall_hold_s — 0.3 s, fifteen
        # straight steps — so a step where both fire is a robot that was already
        # collapsing and slid over the line. That is not a win.
        #
        # This does not penalise a sprinter falling past the tape: such a robot
        # has tipped_for == 0 at the crossing step, so finish still wins there.
        rotation = data.xmat[adr.trunk].reshape(3, 3)
        gravity_z = float((rotation.T @ _WORLD_DOWN)[2])
        tipped_for = tipped_for + 1 if gravity_z > manifest.termination.fall_gravity_z else 0
        if tipped_for >= fall_steps_needed:
            status = "fall"
            break

        progress = float(direction @ data.qpos[0:3]) - start_progress
        if progress >= manifest.course.length_m:
            status = "finish"
            time_s = (step + 1) * CTRL_DT
            break

    return RunOutcome(
        seed=seed,
        status=status,
        time_s=time_s,
        progress_m=progress,
        start_progress_m=start_progress,
        trace=frames[:written].copy(),
    )
