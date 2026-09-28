"""Run one policy, on one event, at one seed.

No queue, no storage, no HTTP: this narrowness is what makes the determinism and
golden-run tests possible, and those tests are the only thing standing between a
physics change and a silently invalidated leaderboard.

The loop is training's, not the sandbox's: build the 61-D observation with the
actor's joint-velocity slot one control step old, run the policy, drive the BAM
servos (`arena.actuator.Servos`) once per physics substep, and call
`mj_forward` after the four substeps — mirroring mjlab's `sim.forward()`.
"""

import zlib
from dataclasses import dataclass

import mujoco
import numpy as np

from .actuator import Servos
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
    # The untimed settle before the trace: the reset pose, then a frame per
    # settle step, so a replay can start where the simulation did.
    settle: np.ndarray  # (settle steps + 1, TRACE_WIDTH) float32


@dataclass(frozen=True)
class _Addresses:
    qpos: np.ndarray
    dof: np.ndarray
    act: np.ndarray
    gyro: int
    trunk: int
    stand_key: int

    @classmethod
    def of(cls, model, keyframe: str) -> "_Addresses":
        return cls(
            qpos=np.array([int(model.joint(n).qposadr[0]) for n in JOINT_NAMES]),
            dof=np.array([int(model.joint(n).dofadr[0]) for n in JOINT_NAMES]),
            act=np.array([int(model.actuator(n).id) for n in JOINT_NAMES]),
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


def _record(frame: np.ndarray, data, adr) -> None:
    frame[0:3] = data.qpos[0:3]
    frame[3:7] = data.qpos[3:7]
    frame[7:TRACE_WIDTH] = data.qpos[adr.qpos]


def _step(
    model, data, policy, adr, command, last_action, prev_qvel, servos
) -> tuple[np.ndarray, np.ndarray]:
    """One control step: observe, act, drive the servos once per substep.

    `prev_qvel` is the joint velocity recorded one control step ago — the
    actor's observation lags the true qvel by exactly one control step,
    matching training (mjlab resamples the observation before the servo
    updates its own delayed target, so the two delays are independent). The
    qvel this call captures for the NEXT step's observation is read here,
    before any of this step's substeps run.
    """
    obs = _observe(model, data, adr, last_action, command)
    obs[20:34] = prev_qvel
    next_prev_qvel = data.qvel[adr.dof].copy()
    action = policy.act(obs)
    target = DEFAULT_POSE + action * ACTION_SCALE
    for _ in range(DECIMATION):
        servos.drive(data, target)
        mujoco.mj_step(model, data)
    mujoco.mj_forward(model, data)
    return action, next_prev_qvel


def run_once(manifest: Manifest, policy, seed: int, model=None, command=None) -> RunOutcome:
    model = model if model is not None else compile_course(manifest)
    data = mujoco.MjData(model)
    adr = _Addresses.of(model, manifest.start.keyframe)

    # A fresh Servos every run, constructed BEFORE the reset/perturb below: the
    # compiled model is shared across an evaluation's runs (evaluate.py
    # compiles once), and Servos.__init__ resets model.dof_frictionloss /
    # model.dof_damping — so a run must never inherit the friction state left
    # behind by the run before it. _perturb ends with its own mj_forward, which
    # reads those fields to settle contact forces (efc_force, qfrc_constraint)
    # on a rig where a passive part may already be touching the floor at the
    # reset pose (the roller rig's wheels); constructing Servos first means
    # that forward pass runs against this run's own reset friction, not
    # whatever the previous run left on the shared model. The command-delay
    # stream is seeded per run, distinct from the perturbation stream below (a
    # trailing 1 in the seed sequence marks it).
    servos = Servos(
        model, adr.dof, adr.act, np.random.default_rng([zlib.crc32(manifest.id.encode()), seed, 1])
    )

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
    # The actor's joint-velocity observation is one control step old (training's
    # mjlab_microduck randomisation); the first step uses the reset state's qvel.
    prev_qvel = data.qvel[adr.dof].copy()

    # Settle with the policy running and the clock stopped: nobody is timed on
    # standing up.
    settle_steps = round(manifest.start.settle_s / CTRL_DT)
    settle = np.empty((settle_steps + 1, TRACE_WIDTH), dtype=np.float32)
    _record(settle[0], data, adr)
    for step in range(settle_steps):
        last_action, prev_qvel = _step(
            model, data, policy, adr, command, last_action, prev_qvel, servos
        )
        _record(settle[step + 1], data, adr)

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
        last_action, prev_qvel = _step(
            model, data, policy, adr, command, last_action, prev_qvel, servos
        )

        _record(frames[written], data, adr)
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
        settle=settle,
    )
