import zlib

import mujoco
import numpy as np
import pytest

from arena import runner
from arena.assets import ASSET_ROOT
from arena.constants import CTRL_DT, DEFAULT_POSE, NUM_JOINTS, TRACE_WIDTH
from arena.course import SPAWN_HEIGHT_M, duck_prefix
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import Performer, run_once, run_stage
from arena.timeline import Start, Timeline, constant_timeline
from tests import legacy_stage

# Commands a float32 observation holds exactly, so a test can read them back from it.
STILL = (0.0,) * 13
WALK = (0.25,) + (0.0,) * 12
SIT = (0.0,) * 12 + (0.25,)
LOOK = (0.0, 0.0, 0.0, -0.25, 0.0, 0.5, 0.0) + (0.0,) * 6


@pytest.fixture(scope="module")
def talent():
    return load_event("got-a-talent")


@pytest.fixture(scope="module")
def walker():
    return load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")


class _ZeroPolicy:
    def act(self, obs):
        return np.zeros(NUM_JOINTS, dtype=np.float32)


class _RecordingPolicy:
    def __init__(self):
        self.observed = []

    def act(self, obs):
        self.observed.append(obs.copy())
        return np.zeros(NUM_JOINTS, dtype=np.float32)


def alone(policy, timeline) -> tuple[Performer, ...]:
    """A lone duck on the legs rig at the centre: what every stage entry was before troupes."""
    return (Performer(policy, "legs", Start(), timeline),)


def test_a_stage_plays_exactly_its_duration(talent, walker):
    outcome = run_stage(talent, alone(walker, constant_timeline(STILL, 3.0)), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape == (1, round(3.0 / CTRL_DT), TRACE_WIDTH)
    assert outcome.settle.shape == (1, round(talent.start.settle_s / CTRL_DT) + 1, TRACE_WIDTH)
    assert outcome.time_s == pytest.approx(3.0)
    assert outcome.progress_m == 0.0 and outcome.start_progress_m == 0.0


def test_a_fall_does_not_stop_a_performance(talent):
    """The same limp policy is a fall on a lane; on a stage it plays to the end."""
    assert run_once(load_event("sprint-2m"), _ZeroPolicy(), seed=1).status == "fall"
    outcome = run_stage(talent, alone(_ZeroPolicy(), constant_timeline(STILL, 3.0)), seed=1)
    assert outcome.status == "finish"
    assert outcome.trace.shape[1] == round(3.0 / CTRL_DT)


def test_each_step_observes_the_command_at_its_time(talent):
    """The settle plays the first keyframe; timed step k plays command_at(k * CTRL_DT).
    A keyframe at 0.3 s is first seen at step 15, although 15 * 0.02 < 0.3 in floating point."""
    first = (0.0,) * 13
    sit = (1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0) + (0.0,) * 6
    look = (0.0, 0.0, 0.0, -0.25, 0.0, 0.0, 0.0) + (0.0,) * 5 + (0.25,)
    timeline = Timeline(1.5, (0.0, 0.3, 1.0), (first, sit, look))
    policy = _RecordingPolicy()
    run_stage(talent, alone(policy, timeline), seed=1)

    settle_steps = round(talent.start.settle_s / CTRL_DT)
    commands = [tuple(float(v) for v in obs[48:61]) for obs in policy.observed]
    assert len(commands) == settle_steps + round(1.5 / CTRL_DT)
    assert set(commands[:settle_steps]) == {first}
    timed = commands[settle_steps:]
    assert timed[14] == first and timed[15] == sit
    assert timed[49] == sit and timed[50] == look
    assert timed[-1] == look


def test_every_duck_plays_its_own_timeline(talent):
    """Two policies, two timelines: each policy only ever reads its own duck's command."""
    star, guest = _RecordingPolicy(), _RecordingPolicy()
    run_stage(talent, (
        Performer(star, "legs", Start(), Timeline(1.0, (0.0, 0.5), (STILL, WALK))),
        Performer(guest, "legs", Start(0.5, 0.0, 0.0), constant_timeline(SIT, 1.0)),
    ), seed=1)
    settle_steps = round(talent.start.settle_s / CTRL_DT)
    assert len(star.observed) == len(guest.observed) == settle_steps + 50
    assert {tuple(float(v) for v in obs[48:61]) for obs in star.observed[settle_steps + 25:]} == {WALK}
    assert {tuple(float(v) for v in obs[48:61]) for obs in guest.observed} == {SIT}


def test_a_stage_run_is_deterministic(talent, walker):
    cast = alone(walker, constant_timeline(STILL, 2.0))
    a = run_stage(talent, cast, seed=1)
    b = run_stage(talent, cast, seed=1)
    assert np.array_equal(a.trace, b.trace)
    assert np.array_equal(a.settle, b.settle)


def test_a_troupe_of_one_plays_bit_for_bit_as_a_lone_duck_did(talent, walker):
    """The troupe path replaced the lone duck's: every performance already published keeps its trace.
    (The settle's first frame starts at x = 0.0 where the lone duck's started at -0.0, the
    keyframe's sign of zero; the two are equal, and the trace that follows is equal to the bit.)"""
    timeline = Timeline(4.0, (0.0, 0.5, 1.5, 2.6), (STILL, WALK, LOOK, SIT))
    before = legacy_stage.run_stage(talent, walker, timeline, seed=1)
    now = run_stage(talent, alone(walker, timeline), seed=1)
    assert (now.status, now.time_s) == (before.status, before.time_s) == ("finish", 4.0)
    assert np.array_equal(now.trace, before.trace[np.newaxis])
    assert now.trace[0].tobytes() == before.trace.tobytes()
    assert np.array_equal(now.settle, before.settle[np.newaxis])


def test_a_mixed_troupe_plays_the_same_twice(talent, walker):
    cast = (
        Performer(walker, "legs", Start(), Timeline(3.0, (0.0, 1.0), (STILL, WALK))),
        Performer(walker, "legs", Start(0.4, -0.6, 90.0), constant_timeline(WALK, 3.0)),
        Performer(walker, "rollers", Start(-0.5, 0.7, -45.0), constant_timeline(STILL, 3.0)),
        Performer(_ZeroPolicy(), "legs", Start(0.0, 1.2, 180.0), constant_timeline(SIT, 3.0)),
    )
    a = run_stage(talent, cast, seed=1)
    b = run_stage(talent, cast, seed=1)
    assert a.status == "finish"
    assert a.trace.shape == (4, round(3.0 / CTRL_DT), TRACE_WIDTH)
    assert a.settle.shape == (4, round(talent.start.settle_s / CTRL_DT) + 1, TRACE_WIDTH)
    assert np.array_equal(a.trace, b.trace)
    assert np.array_equal(a.settle, b.settle)


def test_each_duck_stands_at_its_start_when_the_settle_begins(talent, walker):
    """The first settle frame is the reset pose: each duck's own x and y, the spawn height, and its
    yaw within the event's start perturbation."""
    starts = (Start(), Start(0.4, -0.6, 90.0), Start(-0.5, 0.7, -45.0), Start(0.0, 1.2, 180.0))
    rigs = ("legs", "legs", "rollers", "legs")
    cast = tuple(Performer(walker, rig, start, constant_timeline(STILL, 0.1)) for rig, start in zip(rigs, starts))
    first = run_stage(talent, cast, seed=1).settle[:, 0]
    for k, start in enumerate(starts):
        np.testing.assert_allclose(first[k, 0:3], [start.x, start.y, SPAWN_HEIGHT_M], atol=1e-6, err_msg=k)
        yaw = np.degrees(2 * np.arctan2(first[k, 6], first[k, 3]))
        assert abs((yaw - start.yaw_deg + 180.0) % 360.0 - 180.0) <= talent.start.yaw_deg + 1e-3, k


def test_two_ducks_walked_into_each_other_touch(talent, walker, monkeypatch):
    """One physics: the robots' collision geoms meet like any others."""
    touched, real_step = set(), runner._step

    def watching(model, data, ducks, commands):
        real_step(model, data, ducks, commands)
        trunks = {int(model.body(f"{duck_prefix(k)}trunk_base").id): k for k in range(len(ducks))}
        for pair in zip(data.contact.geom1, data.contact.geom2):
            a, b = (trunks.get(int(model.body_rootid[model.geom_bodyid[g]])) for g in pair)
            if a is not None and b is not None and a != b:
                touched.add((min(a, b), max(a, b)))

    monkeypatch.setattr(runner, "_step", watching)
    run_stage(talent, (
        Performer(walker, "legs", Start(-0.15, 0.0, 0.0), constant_timeline(WALK, 2.0)),
        Performer(walker, "legs", Start(0.15, 0.0, 180.0), constant_timeline(WALK, 2.0)),
    ), seed=1)
    assert touched == {(0, 1)}


def test_duck_0_keeps_a_lone_ducks_streams_and_the_others_have_their_own(talent, walker, monkeypatch):
    """Duck 0's perturbation is seed_rng's and its delays [crc, seed, 1], so a troupe never changes the
    star's start; duck k's are [crc, seed, 2, k] and [crc, seed, 3, k]."""
    delays, real_servos = [], runner.Servos

    def recording(model, dof, act, rng):
        delays.append(rng.bit_generator.state)
        return real_servos(model, dof, act, rng)

    monkeypatch.setattr(runner, "Servos", recording)
    timeline = constant_timeline(STILL, 0.1)
    troupe = run_stage(talent, (
        Performer(walker, "legs", Start(), timeline),
        Performer(walker, "legs", Start(0.5, 0.0, 30.0), timeline),
    ), seed=1)
    crc = zlib.crc32(b"got-a-talent")
    assert delays == [np.random.default_rng(seq).bit_generator.state for seq in ([crc, 1, 1], [crc, 1, 3, 1])]
    lone = legacy_stage.run_stage(talent, walker, timeline, seed=1)
    assert np.array_equal(troupe.settle[0, 0], lone.settle[0])
    noise = np.random.default_rng([crc, 1, 2, 1]).uniform(-talent.start.joint_rad, talent.start.joint_rad, NUM_JOINTS)
    np.testing.assert_array_equal(troupe.settle[1, 0, 7:], (DEFAULT_POSE + noise).astype(np.float32))


def test_a_simulation_mujoco_had_to_reset_ends_the_whole_troupes_performance(talent, walker, monkeypatch, tmp_path):
    """MuJoCo answers a non-finite state by resetting to the model's defaults and carrying on: the
    state stays finite, and only its warning counters say the performance diverged. The physics is
    shared, so every duck's trace stops there."""
    # MuJoCo logs the warning to MUJOCO_LOG.TXT in the working directory.
    monkeypatch.chdir(tmp_path)

    real_step, real_mj_step, calls, armed = runner._step, mujoco.mj_step, [], []

    def counting(*args):
        calls.append(None)
        if len(calls) == 25 + 40:  # the settle's 25 steps, then the 40th timed step
            armed.append(True)
        return real_step(*args)

    def exploding(model, data):
        if armed:
            armed.clear()
            data.qvel[:] = 1e200  # inside MuJoCo's own step, past mjMAXVAL: a solver explosion
        return real_mj_step(model, data)

    monkeypatch.setattr(runner, "_step", counting)
    monkeypatch.setattr(mujoco, "mj_step", exploding)
    outcome = run_stage(talent, (
        Performer(walker, "legs", Start(), constant_timeline(STILL, 3.0)),
        Performer(walker, "rollers", Start(0.5, 0.5, 0.0), constant_timeline(STILL, 3.0)),
    ), seed=1)
    assert (outcome.status, outcome.time_s) == ("fall", None)
    assert outcome.trace.shape == (2, 39, TRACE_WIDTH)  # the steps played before it, never the reset pose
