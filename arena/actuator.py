"""The BAM XL330 servo model, as training drives it, in numpy.

Derived from Rhoban/bam (better-actuator-models) at rev 62bd8ce12154340be97e06f7f41a0ca8f116d967:
bam/params/xl330/m6.json and bam/dynamixel/actuator.py (constants), bam/actuator.py (control
and torque, current window), bam/mjlab.py (per-substep order, voltage sag, command delay, the m6
friction budget written to dof_frictionloss). Copyright the bam authors, Apache License 2.0 — see
LICENSE.bam next to this file. Vendored rather than depended on: the Space image has no git and
must not install torch, and a pinned copy keeps the math at the revision training uses.

Every per-environment randomisation of training takes its nominal value here; the command delay
keeps training's distribution, drawn from a stream seeded per run so a run stays reproducible.
"""

import math

import mujoco
import numpy as np

# bam/params/xl330/m6.json — the m6-fitted XL330 parameters.
KT = 0.36601349688984386
R = 2.8113923539223227
ARMATURE = 0.0018077432831600838
FRICTION_BASE = 0.004771183165566
FRICTION_STRIBECK = 0.004676345799486616
LOAD_MOTOR = 0.2667860954283698
LOAD_EXTERNAL = 8.515871897059342e-06
LOAD_MOTOR_STRIBECK = 1.0722918395099123e-05
LOAD_EXTERNAL_STRIBECK = 0.08077928978935671
LOAD_MOTOR_QUAD = 0.009972471242139415
LOAD_EXTERNAL_QUAD = 0.004902565732332559
DTHETA_STRIBECK = 2.890372094130307
ALPHA = 8.683259907618984
FRICTION_VISCOUS = 0.005359668274599504

# bam/dynamixel/actuator.py — XL330Actuator's firmware constants (fixed, not fitted).
ERROR_GAIN = (4096 / (2 * np.pi)) / (256 * 885)
MAX_PWM = 1.0
MAX_CURRENT = 1.75  # A, the firmware current limit

# microduck's training config (mjlab_microduck/robot/microduck_constants.py) sets the
# firmware stiffness to 200 (bam's raw XL330 default is 400; microban trains at 125).
KP_FW = 200.0

# Nominal values, never randomised: every per-env randomisation in training becomes
# its middle-of-range value here (globals.md).
VIN_NOMINAL = 7.35   # V, middle of training's U(6.5, 8.2)
VIN_DROP_GAIN = 0.1  # middle of training's U(0, 0.2)
VIN_MIN = 6.0
VIN_MAX = 8.2  # forcerange ceiling uses max(vin_range)
FORCE_LIMIT = VIN_MAX * KT / R

# The command delay is kept exactly as training does: drawn per physics substep,
# uniformly in {3, 4, 5, 6} steps, from a stream seeded per run.
DELAY_STEPS = (3, 6)

SOLREF_FRICTION = (-5.0e4, -2.0e2)
SOLIMP_FRICTION = (0.99, 0.9999, 0.001, 0.5, 2.0)

# MuJoCo constraint-type id for a per-DOF friction constraint; efc_id is the DOF.
_FRICTION_DOF = mujoco.mjtConstraint.mjCNSTR_FRICTION_DOF


def control_torque(q_target: np.ndarray, q: np.ndarray, dq: np.ndarray, vin: float) -> np.ndarray:
    """The firmware position loop plus the DC-motor torque equation.

    duty is the position error through the firmware gain, clamped first to the
    current window (±MAX_CURRENT at vin, shifted by back-EMF) then to the
    physical PWM range; torque follows from the DC-motor equation with back-EMF.
    """
    duty = (q_target - q) * KP_FW * ERROR_GAIN
    center = KT * dq / vin
    span = R * MAX_CURRENT / vin
    duty = np.clip(duty, center - span, center + span)
    duty = np.clip(duty, -MAX_PWM, MAX_PWM)
    return KT * (vin * duty) / R - KT**2 * dq / R


def friction_budget(mot: np.ndarray, ext: np.ndarray, dq: np.ndarray) -> np.ndarray:
    """The m6 load-dependent friction budget, written to dof_frictionloss each substep.

    mot and ext are the motor-side and external-side torque already acting on the
    joint (the previous substep's actuator torque, and the bias/constraint torque
    net of friction); dq sets the Stribeck coefficient.

    The Stribeck coefficient goes through the C library's scalar exp/pow, one
    element at a time, not numpy's ufuncs: numpy may dispatch those to
    CPU-specific SIMD kernels whose rounding differs between CPUs, and this
    model is chaotic enough that one ulp here changes a run within seconds.
    """
    s = np.array([math.exp(-math.pow(abs(v) / DTHETA_STRIBECK, ALPHA)) for v in dq])
    fl = FRICTION_BASE + s * FRICTION_STRIBECK
    fl = fl + np.abs(ext * LOAD_EXTERNAL - mot * LOAD_MOTOR)
    fl = fl + s * np.abs(ext * LOAD_EXTERNAL_STRIBECK - mot * LOAD_MOTOR_STRIBECK)
    drive = np.abs(mot) > np.abs(ext)
    quad = np.where(drive, LOAD_EXTERNAL_QUAD * ext**2, LOAD_MOTOR_QUAD * mot**2)
    return fl + s * quad


class Servos:
    """Drives a set of BAM XL330 servos, one physics substep at a time.

    Call `drive` wherever training runs the actuator (arena/runner.py): before
    each `mj_step`, once more after a control step's substeps, and once at
    reset on the cleared 0 rad targets. The compiled model is shared across
    every run of an evaluation, and this class writes `model.dof_frictionloss`
    / `model.dof_damping` on every drive, so construction resets them: a run
    must never inherit the friction state left behind by the run before it.
    """

    def __init__(self, model, dof: np.ndarray, act_ids: np.ndarray, rng: np.random.Generator):
        self.model = model
        self.dof = dof
        self.act_ids = act_ids
        # The joints' own qpos addresses, derived from each actuator's joint
        # transmission (actuator_trnid's first column) rather than passed in
        # separately: one address per actuator, in act_ids order, matching dof.
        self.qpos = model.jnt_qposadr[model.actuator_trnid[act_ids, 0]]
        self.rng = rng
        self.prev_tau = np.zeros(len(dof))
        self.targets = None  # ring of the last DELAY_STEPS[1] + 1 substep targets
        model.dof_frictionloss[dof] = 0
        model.dof_damping[dof] = FRICTION_VISCOUS

    def drive(self, data, target: np.ndarray) -> None:
        model, dof, act_ids = self.model, self.dof, self.act_ids
        depth = DELAY_STEPS[1] + 1
        if self.targets is None:
            self.targets = [target.copy() for _ in range(depth)]  # backfill on reset
        self.targets.append(target.copy())
        self.targets.pop(0)
        lag = int(self.rng.integers(DELAY_STEPS[0], DELAY_STEPS[1] + 1))
        q_target = self.targets[-1 - lag]

        # data.qpos directly, as training reads it (mjlab's actuator.py), NOT
        # data.actuator_length: mj_step computes the transmission length during
        # its own forward pass, BEFORE integrating qpos/qvel, so reading it once
        # mj_step returns lags data.qpos by that step's qvel*dt — exactly the
        # staleness this class cannot have, since it runs once per substep.
        q = data.qpos[self.qpos]
        dq = data.qvel[dof]
        vin = max(VIN_NOMINAL - VIN_DROP_GAIN * np.abs(self.prev_tau).sum(), VIN_MIN)
        tau = control_torque(q_target, q, dq, vin)

        nefc = data.nefc
        fric = data.efc_type[:nefc] == _FRICTION_DOF
        qfrc_fric = np.zeros(model.nv)
        np.add.at(qfrc_fric, data.efc_id[:nefc][fric], data.efc_force[:nefc][fric])
        ext = -data.qfrc_bias[dof] + data.qfrc_constraint[dof] - qfrc_fric[dof]
        mot = data.qfrc_actuator[dof]
        model.dof_frictionloss[dof] = friction_budget(mot, ext, dq)
        model.dof_damping[dof] = FRICTION_VISCOUS

        self.prev_tau = tau
        data.ctrl[act_ids] = tau
