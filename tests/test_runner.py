import dataclasses

import mujoco
import numpy as np
import pytest

from arena import runner
from arena.actuator import Servos
from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, DECIMATION, NUM_JOINTS, TIMESTEP, TRACE_WIDTH
from arena.course import compile_course, ramp_dir
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import _Addresses, _step, run_once, seed_rng

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"
# A command the reference walker finishes the sprint at on every seed: at 0.30
# m/s it finishes each of seeds 1-10 in 14.1-14.9 s. At the event's declared
# 0.25 m/s it sits on a balance edge — since training's reset and fifth
# actuator writes joined the runner it falls on seeds 1, 6 and 10 of them —
# so a test that needs a finish does not run on that edge.
STEADY_VX = 0.30


@pytest.fixture(scope="module")
def sprint():
    return load_event("sprint-2m")


@pytest.fixture(scope="module")
def walker():
    return load_policy(REFERENCE)


def test_seed_rng_is_stable_across_processes(sprint):
    # Must NOT depend on hash(), which is salted per process.
    a = seed_rng("sprint-2m", 1).standard_normal(4)
    b = seed_rng("sprint-2m", 1).standard_normal(4)
    np.testing.assert_array_equal(a, b)


def test_seed_rng_differs_by_seed_and_by_event():
    same_event = seed_rng("sprint-2m", 1).standard_normal(4)
    other_seed = seed_rng("sprint-2m", 2).standard_normal(4)
    other_event = seed_rng("roller-sprint-2m", 1).standard_normal(4)
    assert not np.array_equal(same_event, other_seed)
    assert not np.array_equal(same_event, other_event)


def test_reference_policy_finishes_the_sprint(sprint, walker):
    outcome = run_once(sprint, walker, seed=1, command=sprint.command_at(STEADY_VX))
    assert outcome.status == "finish", f"walker did not finish: {outcome.status}"
    assert outcome.time_s is not None
    # The reference walker tracks about half of its commanded 0.30 m/s, so 2 m
    # takes it roughly 14.5 s (at the declared 0.25 m/s, which this test used
    # before, about 44% — roughly 18.5 s). The band is wide enough not to be
    # brittle and tight enough that a broken observation layout cannot pass it.
    assert 10.0 < outcome.time_s < 30.0


def test_trace_shape_matches_the_clock(sprint, walker):
    outcome = run_once(sprint, walker, seed=1, command=sprint.command_at(STEADY_VX))
    assert outcome.trace.ndim == 2
    assert outcome.trace.shape[1] == TRACE_WIDTH
    assert outcome.trace.shape[0] == pytest.approx(outcome.time_s / CTRL_DT, abs=1)
    assert outcome.trace.dtype == np.float32


def test_the_run_is_deterministic(sprint, walker):
    first = run_once(sprint, walker, seed=3)
    second = run_once(sprint, walker, seed=3)
    assert first.status == second.status
    assert first.time_s == second.time_s
    np.testing.assert_array_equal(first.trace, second.trace)


def test_different_seeds_give_different_traces(sprint, walker):
    a = run_once(sprint, walker, seed=1)
    b = run_once(sprint, walker, seed=2)
    assert not np.array_equal(a.trace, b.trace), "perturbation had no effect"


def test_a_fall_beats_a_finish_on_the_same_step(sprint, walker):
    """A robot already collapsing does not get credited with the win.

    Crafted so both conditions are true on the very first clocked step, which is
    the only way to test the precedence deterministically: fall_gravity_z = -1.5
    sits above the upright value (about -1.0), so the robot counts as tipped from
    the first step; fall_hold_s = 0 removes the debounce; and length_m = 0 puts
    the finish line under its feet. The order of the two checks is then the only
    thing that decides the outcome — this test returns "finish" if they are
    swapped back.
    """
    both = dataclasses.replace(
        sprint,
        course=dataclasses.replace(sprint.course, length_m=0.0),
        termination=dataclasses.replace(
            sprint.termination, fall_gravity_z=-1.5, fall_hold_s=0.0
        ),
    )
    outcome = run_once(both, walker, seed=1)
    assert outcome.status == "fall"
    assert outcome.time_s is None


def test_a_limp_policy_falls(sprint):
    """A policy that commands the zero action collapses; that must be a fall."""
    outcome = run_once(sprint, _ZeroPolicy(), seed=1)
    assert outcome.status == "fall"
    assert outcome.time_s is None
    assert outcome.progress_m < sprint.course.length_m


def test_an_unreachable_finish_line_times_out(sprint, walker):
    long_course = dataclasses.replace(
        sprint,
        course=dataclasses.replace(sprint.course, length_m=500.0),
        time_limit_s=3.0,
    )
    outcome = run_once(long_course, walker, seed=1)
    assert outcome.status == "timeout"
    assert outcome.time_s is None
    assert outcome.trace.shape[0] == pytest.approx(3.0 / CTRL_DT, abs=1)


def test_the_settle_is_recorded_from_the_reset_pose(sprint, walker):
    """The untimed settle has its own frames, so a replay can start where the
    simulation did: frame 0 is the keyframe before any step, then one frame per
    settle step, the last one control step before the first clocked frame."""
    outcome = run_once(sprint, walker, seed=1)
    steps = round(sprint.start.settle_s / CTRL_DT)
    assert outcome.settle.shape == (steps + 1, TRACE_WIDTH)
    assert outcome.settle.dtype == np.float32
    key = compile_course(sprint).key(sprint.start.keyframe)
    np.testing.assert_allclose(outcome.settle[0, 0:3], key.qpos[0:3], atol=1e-6)
    assert np.linalg.norm(outcome.trace[0, 0:3] - outcome.settle[-1, 0:3]) < 0.02


def test_the_clock_starts_on_the_start_line(sprint, walker):
    """The first clocked frame sits on the start line.

    Note the duck is already moving by then: the pinned forward command runs
    during the settle, so it has walked ~10 cm before the clock starts. The start
    line is therefore defined where it *is* at that moment, not at the world
    origin — which is exactly what start_progress_m records.
    """
    outcome = run_once(sprint, walker, seed=1)
    direction = ramp_dir(sprint.course.slope_deg)
    first_frame = float(direction @ outcome.trace[0, :3])
    # One control step of travel at most, since the frame is recorded after a step.
    assert abs(first_frame - outcome.start_progress_m) < 0.02


def test_a_longer_settle_does_not_inflate_the_time(sprint, walker):
    """Settling is not timed, so extending it must not change the recorded time.

    Both runs enter the clocked phase already at walking speed from their own
    start line, so the times should agree closely. If settling were timed, the
    longer settle would add its extra 1.5 s to the clock — 0.75 s below is
    half that: loose enough for run-to-run noise, tight enough that a 1.5 s
    leak would still fail it.

    A short course (0.3 m), not the full sprint: the reference walker sits on
    a real balance edge over the full ~18-20 s course at sprint-2m's own
    declared 0.25 m/s (re-measured at runner v4, after the Servos-
    construction-order and qpos-vs-stale-actuator_length fixes — 4 of 10
    seeds sampled failed the finish/finish precondition on the full course),
    which drowns out the property this test actually pins — that settling
    longer adds no TIME — under whether the walker finishes at all. Measured
    on this short course over seeds 1-10: 10/10 finish both ways, max
    |Δt| 0.42 s (0.24 s before training's reset and fifth actuator writes
    joined the runner).
    """
    short = dataclasses.replace(sprint, course=dataclasses.replace(sprint.course, length_m=0.3))
    long_settle = dataclasses.replace(short, start=dataclasses.replace(short.start, settle_s=2.0))
    brief = run_once(short, walker, seed=1)
    extended = run_once(long_settle, walker, seed=1)
    assert brief.status == extended.status == "finish"
    assert abs(extended.time_s - brief.time_s) < 0.75


def test_model_can_be_supplied_to_avoid_recompiling(sprint, walker):
    model = compile_course(sprint)
    steady = sprint.command_at(STEADY_VX)
    a = run_once(sprint, walker, seed=1, model=model, command=steady)
    b = run_once(sprint, walker, seed=1, command=steady)
    assert a.time_s is not None
    assert a.time_s == b.time_s


def test_a_run_does_not_depend_on_the_run_before_it(sprint, walker):
    """The compiled model is shared across an evaluation's runs, and the BAM
    servos write model.dof_frictionloss / model.dof_damping every substep —
    so a run sharing that model must start exactly as fresh as one that
    doesn't, whatever ran on it before."""
    shared_model = compile_course(sprint)
    run_once(sprint, walker, seed=2, model=shared_model)
    reused = run_once(sprint, walker, seed=1, model=shared_model)
    fresh = run_once(sprint, walker, seed=1)
    assert np.array_equal(reused.trace, fresh.trace)
    assert np.array_equal(reused.settle, fresh.settle)


def test_a_roller_run_does_not_depend_on_the_run_before_it(walker):
    """Same property as above, on the roller rig this time: sprint-2m's legs
    start out of contact, so its version of this test cannot see a stale
    model.dof_frictionloss/dof_damping change anything during the reset
    forward pass — the roller rig's passive wheels are touching the floor from
    the reset pose, so they can. A short time_limit_s keeps it cheap; the
    divergence, when present, shows up within the first few steps."""
    roller = dataclasses.replace(load_event("roller-sprint-2m"), time_limit_s=2.0)
    shared_model = compile_course(roller)
    run_once(roller, walker, seed=2, model=shared_model)
    reused = run_once(roller, walker, seed=1, model=shared_model)
    fresh = run_once(roller, walker, seed=1)
    assert np.array_equal(reused.trace, fresh.trace)
    assert np.array_equal(reused.settle, fresh.settle)


def test_the_actor_sees_joint_velocity_one_step_old(sprint):
    """obs[20:34] at control step k must be the qvel recorded before step
    k-1's substeps, not the qvel current at step k. Exercised directly on
    `_step` rather than through run_once, so the property is checked without
    depending on the settle/clock machinery around it."""
    from arena.actuator import Servos

    model = compile_course(sprint)
    data = mujoco.MjData(model)
    adr = _Addresses.of(model, sprint.start.keyframe)
    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    servos = Servos(model, adr.dof, adr.act, np.random.default_rng(0))
    command = np.asarray(sprint.command, dtype=np.float64)
    last_action = np.zeros(NUM_JOINTS, dtype=np.float32)
    prev_qvel = data.qvel[adr.dof].copy()

    policy = _RecordingPolicy()
    qvel_before_first_substeps = data.qvel[adr.dof].copy()
    last_action, prev_qvel = _step(
        model, data, policy, adr, command, last_action, prev_qvel, servos
    )
    qvel_before_second_substeps = data.qvel[adr.dof].copy()
    last_action, prev_qvel = _step(
        model, data, policy, adr, command, last_action, prev_qvel, servos
    )
    _step(model, data, policy, adr, command, last_action, prev_qvel, servos)

    assert len(policy.observed) == 3
    np.testing.assert_array_equal(policy.observed[1][20:34], qvel_before_first_substeps)
    # The reset qvel above is zero, so step 1 alone cannot tell "one step old"
    # from "never updated"; step 2 sees a joint velocity that is not zero.
    assert qvel_before_second_substeps.any()
    np.testing.assert_array_equal(
        policy.observed[2][20:34], qvel_before_second_substeps.astype(np.float32)
    )


def test_a_control_step_drives_the_servos_a_fifth_time_before_its_forward_pass(sprint):
    """Training runs the actuator once per substep and then once more: after
    the substeps, mjlab's step() calls scene.write_data_to_sim() whenever any
    environment reset (nearly every step at training's batch size), then
    sim.forward(). So five drives per control step, the fifth after the last
    mj_step, and the forward pass after the fifth."""
    model = compile_course(sprint)
    data = mujoco.MjData(model)
    adr = _Addresses.of(model, sprint.start.keyframe)
    mujoco.mj_resetDataKeyframe(model, data, adr.stand_key)
    mujoco.mj_forward(model, data)
    servos = _RecordingServos(model, adr.dof, adr.act, np.random.default_rng(0))
    command = np.asarray(sprint.command, dtype=np.float64)

    _step(
        model, data, _RecordingPolicy(), adr, command,
        np.zeros(NUM_JOINTS, dtype=np.float32), data.qvel[adr.dof].copy(), servos,
    )

    times = [time for time, _, _, _ in servos.calls]
    assert times == pytest.approx([k * TIMESTEP for k in range(DECIMATION + 1)])
    # The forward pass ran after the fifth write: the actuator force MuJoCo
    # holds is the torque that write left in ctrl (gear 1).
    np.testing.assert_allclose(data.qfrc_actuator[adr.dof], data.ctrl[adr.act], rtol=0, atol=1e-12)


def test_the_reset_drives_the_servos_toward_the_zero_pose_first(sprint, walker, monkeypatch):
    """Training's reset clears the joint targets to 0 rad (mjlab entity/data.py
    clear_state) and runs the actuator once on them before its forward pass
    (the reset's scene.write_data_to_sim()), which backfills the command-delay
    ring with zeros: the first control step's first substeps drive toward
    0 rad, not toward the policy's target."""
    made = []

    def recording(*args):
        made.append(_RecordingServos(*args))
        return made[-1]

    monkeypatch.setattr(runner, "Servos", recording)
    run_once(dataclasses.replace(sprint, time_limit_s=0.1), walker, seed=1)

    (servos,) = made
    time, target, ring, bias = servos.calls[0]
    assert time == 0.0
    np.testing.assert_array_equal(target, np.zeros(NUM_JOINTS))
    # On the perturbed pose, before any forward pass has computed a force.
    assert not bias.any()
    # The first control step's first drive: the policy's own target goes in,
    # and every older entry — which any lag in 3..6 selects — is 0 rad.
    time, target, ring, _ = servos.calls[1]
    assert time == 0.0
    assert target.any()
    assert all(not entry.any() for entry in ring)


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(14, dtype=np.float32)


class _RecordingServos(Servos):
    """Records, per drive: the simulation time, the target passed in, the
    command-delay ring before it goes in, and the bias force MuJoCo holds."""

    def __init__(self, *args):
        super().__init__(*args)
        self.calls = []

    def drive(self, data, target):
        ring = [] if self.targets is None else [entry.copy() for entry in self.targets]
        self.calls.append((data.time, target.copy(), ring, data.qfrc_bias.copy()))
        super().drive(data, target)


class _RecordingPolicy:
    def __init__(self):
        self.observed = []

    def act(self, obs):
        self.observed.append(obs.copy())
        return np.zeros(NUM_JOINTS, dtype=np.float32)
