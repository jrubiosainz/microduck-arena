import mujoco
import numpy as np
import pytest

from arena import actuator as A
from arena.actuator import Servos


def test_torque_is_bams_law_inside_the_limits():
    q_target, q, dq, vin = np.array([0.01]), np.array([0.0]), np.array([0.0]), 7.35
    duty = 0.01 * A.KP_FW * A.ERROR_GAIN
    expected = A.KT * vin * duty / A.R
    assert A.control_torque(q_target, q, dq, vin) == pytest.approx([expected])


def test_the_current_limit_caps_a_large_error():
    dq, vin = np.array([0.0]), 7.35
    # 5.0 rad is far past the ~1.16 rad error at which the current window
    # (span = R*MAX_CURRENT/vin ≈ 0.669) starts clipping the raw duty (a 1 rad
    # error alone gives duty ≈ 0.576, still inside the window).
    tau = A.control_torque(np.array([5.0]), np.array([0.0]), dq, vin)
    # duty is clamped to KT*dq/vin + R*MAX_CURRENT/vin, so torque = KT*R*MAX_CURRENT/R = KT*MAX_CURRENT at dq=0
    assert tau == pytest.approx([A.KT * A.MAX_CURRENT])


def test_back_emf_brakes_a_moving_joint_with_no_error():
    dq = np.array([5.0])
    tau = A.control_torque(np.array([0.0]), np.array([0.0]), dq, 7.35)
    assert tau == pytest.approx([-A.KT**2 * 5.0 / A.R])


def test_friction_budget_at_rest_with_no_load_is_base_plus_stribeck():
    fl = A.friction_budget(np.zeros(1), np.zeros(1), np.zeros(1))
    assert fl == pytest.approx([A.FRICTION_BASE + A.FRICTION_STRIBECK])


def test_friction_budget_quadratic_term_follows_the_driving_side():
    mot, ext, dq = np.array([0.5]), np.array([0.1]), np.zeros(1)
    fl = A.friction_budget(mot, ext, dq)
    lin = abs(0.1 * A.LOAD_EXTERNAL - 0.5 * A.LOAD_MOTOR) + abs(0.1 * A.LOAD_EXTERNAL_STRIBECK - 0.5 * A.LOAD_MOTOR_STRIBECK)
    assert fl == pytest.approx([A.FRICTION_BASE + A.FRICTION_STRIBECK + lin + A.LOAD_EXTERNAL_QUAD * 0.1**2])


def test_force_limit_is_the_top_of_the_voltage_range():
    assert A.FORCE_LIMIT == pytest.approx(8.2 * A.KT / A.R)


# --- Servos: a tiny one-hinge, one-motor MuJoCo model built in the test ---

_TINY_XML = """
<mujoco>
  <worldbody>
    <body>
      <joint name="j" type="hinge" axis="0 0 1"/>
      <geom type="sphere" size="0.01"/>
    </body>
  </worldbody>
  <actuator>
    <motor name="j" joint="j" gear="1 0 0 0 0 0"/>
  </actuator>
</mujoco>
"""


def _tiny_servo():
    spec = mujoco.MjSpec.from_string(_TINY_XML)
    model = spec.compile()
    dof = np.array([model.joint("j").dofadr[0]])
    act_ids = np.array([model.actuator("j").id])
    return model, dof, act_ids


def _reference_tau(ring, lag, prev_tau):
    """Mirrors Servos.drive's math with q=dq=0 (no mj_step is ever called)."""
    q_target = ring[-1 - lag]
    vin = max(A.VIN_NOMINAL - A.VIN_DROP_GAIN * abs(float(prev_tau)), A.VIN_MIN)
    return float(A.control_torque(q_target, np.zeros(1), np.zeros(1), vin)[0])


def test_delay_backfills_then_lags():
    model, dof, act_ids = _tiny_servo()
    data = mujoco.MjData(model)
    rng = np.random.default_rng(0)
    peek = np.random.default_rng(0)  # same stream: know each draw ahead of the assert
    servos = Servos(model, dof, act_ids, rng)

    targets = [np.array([0.05 + 0.01 * i]) for i in range(10)]
    ring = [targets[0].copy() for _ in range(A.DELAY_STEPS[1] + 1)]  # backfilled, as Servos does
    prev_tau = 0.0

    for i, target in enumerate(targets):
        servos.drive(data, target)
        ring.append(target.copy())
        ring.pop(0)
        lag = int(peek.integers(A.DELAY_STEPS[0], A.DELAY_STEPS[1] + 1))
        expected = _reference_tau(ring, lag, prev_tau)
        assert data.ctrl[act_ids] == pytest.approx([expected]), f"substep {i}"
        if i == 0:
            # First substep: the ring was backfilled with the first target, so
            # whichever lag is drawn, the delayed target IS the first target.
            assert ring[-1 - lag] == pytest.approx(targets[0])
        prev_tau = expected


def test_lag_stays_within_three_to_six():
    model, dof, act_ids = _tiny_servo()
    data = mujoco.MjData(model)
    rng = np.random.default_rng(0)
    peek = np.random.default_rng(0)
    servos = Servos(model, dof, act_ids, rng)

    targets = [np.array([0.01 * ((i % 7) + 1)]) for i in range(1000)]
    ring = [targets[0].copy() for _ in range(A.DELAY_STEPS[1] + 1)]
    prev_tau = 0.0

    for target in targets:
        servos.drive(data, target)
        ring.append(target.copy())
        ring.pop(0)
        lag = int(peek.integers(A.DELAY_STEPS[0], A.DELAY_STEPS[1] + 1))
        assert lag in (3, 4, 5, 6)
        # The target actually applied is the ring entry the drawn lag selects.
        expected = _reference_tau(ring, lag, prev_tau)
        assert data.ctrl[act_ids] == pytest.approx([expected])
        prev_tau = expected


def test_voltage_sags_with_load_and_floors():
    model, dof, act_ids = _tiny_servo()
    data = mujoco.MjData(model)
    rng = np.random.default_rng(0)
    servos = Servos(model, dof, act_ids, rng)

    # A huge target saturates the current limiter (q=dq=0 throughout, since
    # mj_step is never called), so the ring being uniform means the applied
    # target is the same regardless of the drawn lag, and tau1 is pinned to
    # KT*MAX_CURRENT independently of vin.
    big_target = np.array([5.0])
    servos.drive(data, big_target)
    tau1 = data.ctrl[act_ids].copy()
    assert tau1 == pytest.approx([A.KT * A.MAX_CURRENT])

    servos.drive(data, big_target)
    tau2 = data.ctrl[act_ids].copy()

    vin2 = max(A.VIN_NOMINAL - A.VIN_DROP_GAIN * np.abs(tau1).sum(), A.VIN_MIN)
    expected2 = A.control_torque(big_target, np.zeros(1), np.zeros(1), vin2)
    assert tau2 == pytest.approx(expected2)


def test_construction_resets_the_models_friction():
    model, dof, act_ids = _tiny_servo()
    model.dof_frictionloss[dof] = 9.9
    model.dof_damping[dof] = 9.9
    rng = np.random.default_rng(0)

    Servos(model, dof, act_ids, rng)

    assert model.dof_frictionloss[dof] == pytest.approx([0.0])
    assert model.dof_damping[dof] == pytest.approx([A.FRICTION_VISCOUS])
