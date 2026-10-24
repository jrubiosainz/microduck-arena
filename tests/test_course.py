import dataclasses
import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import pytest

from arena.actuator import ARMATURE, FORCE_LIMIT, SOLIMP_FRICTION, SOLREF_FRICTION
from arena.constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from arena.course import (
    SPAWN_HEIGHT_M,
    build_course_xml,
    compile_course,
    compile_stage,
    duck_prefix,
    ramp_dir,
    ramp_normal,
)
from arena.manifest import load_event
from arena.timeline import Start


def test_course_compiles_and_keeps_14_actuators():
    model = compile_course(load_event("sprint-2m"))
    assert model.nu == 14
    assert model.opt.timestep == TIMESTEP


def test_floor_and_two_lane_walls_exist():
    model = compile_course(load_event("sprint-2m"))
    for name in ("floor", "wall_left", "wall_right"):
        assert model.geom(name).id >= 0, name


def test_stand_keyframe_sets_every_actuated_joint():
    m = load_event("sprint-2m")
    model = compile_course(m)
    data = mujoco.MjData(model)
    key = model.key("STAND")
    mujoco.mj_resetDataKeyframe(model, data, key.id)
    for i, name in enumerate(JOINT_NAMES):
        adr = int(model.joint(name).qposadr[0])
        assert data.qpos[adr] == pytest.approx(DEFAULT_POSE[i]), name


def test_keyframe_spawns_the_trunk_above_the_floor():
    model = compile_course(load_event("sprint-2m"))
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    assert data.qpos[2] == pytest.approx(SPAWN_HEIGHT_M)


def test_visual_geoms_are_stripped_and_meshes_pruned():
    built, assets = build_course_xml(load_event("sprint-2m"))
    root = ET.fromstring(built)
    # Assert the property, not a substring. The vendored MJCF also carries a
    # <default class="visual"> template, which goes dead once the geoms
    # referencing it are gone. The reference implementation leaves that template
    # in place, so this builder must too — the built model stays as close to the
    # MJCF the policies were trained against as possible.
    assert [g for g in root.iter("geom") if g.get("class") == "visual"] == []
    # Only meshes referenced by surviving collision geoms are shipped.
    assert 0 < len(assets) < 20
    for name in assets:
        assert name.endswith(".stl")
        assert name in built


def test_roller_rig_compiles_with_passive_wheels_in_qpos():
    m = dataclasses.replace(load_event("sprint-2m"), id="roller-probe", rig="rollers")
    model = compile_course(m)
    assert model.nu == 14
    assert model.joint("passive_LF_wheel").id >= 0
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    # Wheels start at zero; the named joints still take DEFAULT_POSE.
    assert data.qpos[int(model.joint("passive_LF_wheel").qposadr[0])] == 0.0
    assert data.qpos[int(model.joint("left_knee").qposadr[0])] == pytest.approx(
        DEFAULT_POSE[JOINT_NAMES.index("left_knee")]
    )


def test_flat_ramp_direction_is_plain_x():
    np.testing.assert_allclose(ramp_dir(0.0), [1.0, 0.0, 0.0], atol=1e-12)
    np.testing.assert_allclose(ramp_normal(0.0), [0.0, 0.0, 1.0], atol=1e-12)


def test_sloped_ramp_direction_climbs_and_stays_unit():
    d = ramp_dir(8.0)
    n = ramp_normal(8.0)
    assert d[2] > 0, "a positive slope must climb toward +x"
    assert np.linalg.norm(d) == pytest.approx(1.0)
    assert np.linalg.norm(n) == pytest.approx(1.0)
    assert abs(float(d @ n)) < 1e-12, "direction and normal must be orthogonal"


def test_a_sloped_course_is_tilted_by_the_angle_it_declares():
    """The COMPILED body's rotation must agree with ramp_dir / ramp_normal.

    This is the test that earns its keep. MuJoCo reads `euler` in radians here,
    because the vendored MJCF declares <compiler angle="radian"> and the lane body
    inherits it. A degree value written straight into the attribute tilts the lane
    by 8 radians instead of 8 degrees — it compiles cleanly, `model.nu` is still
    14, and every hill-climb time is silently measured on the wrong slope. Only
    inspecting the compiled geometry catches that; asserting on the pure math
    functions in isolation never will.
    """
    m = load_event("sprint-2m")
    sloped = dataclasses.replace(m, course=dataclasses.replace(m.course, slope_deg=8.0))
    model = compile_course(sloped)
    assert model.nu == 14

    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    mujoco.mj_forward(model, data)

    rotation = data.geom_xmat[model.geom("floor").id].reshape(3, 3)
    # The floor's local +z is the surface normal, its local +x is up-lane.
    np.testing.assert_allclose(rotation @ [0.0, 0.0, 1.0], ramp_normal(8.0), atol=1e-6)
    np.testing.assert_allclose(rotation @ [1.0, 0.0, 0.0], ramp_dir(8.0), atol=1e-6)

    # The floor plane passes through the lane body's origin, so the signed
    # distance from it is normal . position. The duck must spawn above the ramp
    # surface, not buried in it.
    normal = rotation @ np.array([0.0, 0.0, 1.0])
    assert float(normal @ data.qpos[0:3]) == pytest.approx(SPAWN_HEIGHT_M, abs=1e-6)


def test_the_fourteen_servos_are_torque_motors():
    for event_id in ("sprint-2m", "roller-sprint-2m"):
        model = compile_course(load_event(event_id))
        for name in JOINT_NAMES:
            act = model.actuator(name)
            assert model.actuator_gaintype[act.id] == mujoco.mjtGain.mjGAIN_FIXED, event_id
            assert model.actuator_gainprm[act.id][0] == pytest.approx(1.0), event_id
            assert model.actuator_biastype[act.id] == mujoco.mjtBias.mjBIAS_NONE, event_id
            assert model.actuator_forcerange[act.id] == pytest.approx(
                (-FORCE_LIMIT, FORCE_LIMIT)
            ), event_id
            assert model.actuator_ctrllimited[act.id] == 0, event_id


def test_the_fourteen_joints_carry_bams_parameters():
    model = compile_course(load_event("sprint-2m"))
    for name in JOINT_NAMES:
        dof = int(model.joint(name).dofadr[0])
        assert model.dof_armature[dof] == pytest.approx(ARMATURE), name
        assert model.dof_damping[dof] == pytest.approx(0.0), name
        assert model.dof_frictionloss[dof] == pytest.approx(0.0), name
        assert model.dof_solref[dof] == pytest.approx(SOLREF_FRICTION), name
        assert model.dof_solimp[dof] == pytest.approx(SOLIMP_FRICTION), name


def test_passive_wheels_are_untouched():
    m = dataclasses.replace(load_event("roller-sprint-2m"), id="roller-probe")
    model = compile_course(m)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    for name in ("passive_LF_wheel", "passive_LR_wheel", "passive_RF_wheel", "passive_RR_wheel"):
        joint = model.joint(name)
        dof = int(joint.dofadr[0])
        assert model.dof_damping[dof] == pytest.approx(0.0), name
        assert model.dof_frictionloss[dof] == pytest.approx(0.0), name
        assert model.dof_armature[dof] == pytest.approx(1e-4), name
        with pytest.raises(KeyError):
            model.actuator(name)
        assert data.qpos[int(joint.qposadr[0])] == pytest.approx(0.0), name


def test_the_keyframe_holds_no_control():
    model = compile_course(load_event("sprint-2m"))
    key = model.key("STAND")
    np.testing.assert_allclose(model.key_ctrl[key.id], np.zeros(14))


def test_the_solver_is_trainings():
    model = compile_course(load_event("sprint-2m"))
    assert model.opt.integrator == mujoco.mjtIntegrator.mjINT_IMPLICITFAST
    assert model.opt.iterations == 10
    assert model.opt.ls_iterations == 20


def test_the_served_walls_are_the_walls_the_physics_compiles():
    """One arithmetic, two consumers. The viewer draws what this serves, so if
    it ever disagreed with the compiled model the page would be showing a wall
    where the robot hits nothing — or worse, nothing where it hits a wall."""
    import mujoco

    from arena.course import compile_course, wall_boxes
    from arena.manifest import load_event

    for event_id in ("sprint-2m", "roller-sprint-2m", "hill-climb-1m5", "red-light-green-light-15m"):
        manifest = load_event(event_id)
        model = compile_course(manifest)
        for name, pos, half in wall_boxes(manifest.course):
            geom = model.geom(name)
            assert model.geom_pos[geom.id] == pytest.approx(pos), f"{event_id}/{name} pos"
            assert model.geom_size[geom.id] == pytest.approx(half), f"{event_id}/{name} size"
            assert model.geom_type[geom.id] == mujoco.mjtGeom.mjGEOM_BOX


def test_a_stage_is_an_open_flat_floor():
    model = compile_course(load_event("got-a-talent"))
    assert model.geom("floor").id >= 0
    for wall in ("wall_left", "wall_right"):
        with pytest.raises(KeyError):
            model.geom(wall)
    np.testing.assert_array_equal(model.body("course").quat, [1.0, 0.0, 0.0, 0.0])
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    np.testing.assert_allclose(data.qpos[0:3], [0.0, 0.0, SPAWN_HEIGHT_M])


def test_a_stage_compiles_the_lanes_robot_and_solver():
    """The same robot in every event: only the floor around it differs.

    The static `course` body is left out of the mass/inertia comparison: its
    mass is the lane's wall boxes (a stage has none of them), and no dynamics
    reads it — the body carries no joint, so it never enters the mass matrix.
    """
    stage = compile_course(load_event("got-a-talent"))
    lane = compile_course(load_event("sprint-2m"))
    course = lane.body("course").id
    assert stage.body("course").id == course
    keep = np.arange(lane.nbody) != course
    for field in ("body_mass", "body_inertia"):
        np.testing.assert_array_equal(getattr(stage, field)[keep], getattr(lane, field)[keep], err_msg=field)
    for field in ("jnt_range", "dof_armature", "dof_damping", "actuator_forcerange"):
        np.testing.assert_array_equal(getattr(stage, field), getattr(lane, field), err_msg=field)
    np.testing.assert_array_equal(stage.key("STAND").qpos, lane.key("STAND").qpos)
    assert stage.opt.timestep == lane.opt.timestep
    assert stage.opt.integrator == lane.opt.integrator
    assert (stage.opt.iterations, stage.opt.ls_iterations) == (lane.opt.iterations, lane.opt.ls_iterations)


def test_duck_0_has_a_lone_ducks_names_and_the_others_a_prefix():
    assert [duck_prefix(k) for k in range(3)] == ["", "duck1/", "duck2/"]


def test_a_troupe_of_one_compiles_to_a_lone_ducks_stage():
    """Every array of the model is the one a stage always compiled, so a troupe of one plays as a lone duck did."""
    talent = load_event("got-a-talent")
    lone, troupe = compile_course(talent), compile_stage(talent, [("legs", Start())])
    assert (troupe.nq, troupe.nbody, troupe.ngeom, troupe.nu) == (lone.nq, lone.nbody, lone.ngeom, lone.nu)
    for field in dir(lone):
        value = getattr(lone, field)
        if isinstance(value, np.ndarray):
            np.testing.assert_array_equal(getattr(troupe, field), value, err_msg=field)
    assert troupe.opt.integrator == lone.opt.integrator
    assert (troupe.opt.iterations, troupe.opt.ls_iterations) == (lone.opt.iterations, lone.opt.ls_iterations)


def test_duck_0_is_built_in_its_own_rig():
    model = compile_stage(load_event("got-a-talent"), [("rollers", Start())])
    assert model.joint("passive_LF_wheel").id >= 0


LAYOUT = [("legs", Start()), ("rollers", Start(0.4, -0.6, 90.0)), ("legs", Start(-0.5, 0.7, -45.0))]


def test_a_troupe_is_one_model_with_every_duck_under_its_prefix():
    model = compile_stage(load_event("got-a-talent"), LAYOUT)
    assert model.nu == 3 * 14
    for k, (rig, _) in enumerate(LAYOUT):
        prefix = duck_prefix(k)
        for name in JOINT_NAMES:
            assert model.joint(prefix + name).id >= 0, prefix + name
            assert model.actuator(prefix + name).id >= 0, prefix + name
        assert model.sensor(f"{prefix}imu_ang_vel").id >= 0
        assert model.body(f"{prefix}trunk_base").id >= 0
    assert model.joint("duck1/passive_LF_wheel").id >= 0
    with pytest.raises(KeyError):
        model.joint("duck2/passive_LF_wheel")
    assert model.nkey == 1 and model.key_qpos.shape == (1, model.nq)
    np.testing.assert_array_equal(model.key_ctrl[0], np.zeros(model.nu))


def test_the_keyframe_holds_every_duck_at_its_start():
    model = compile_stage(load_event("got-a-talent"), LAYOUT)
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    for k, (_, start) in enumerate(LAYOUT):
        prefix = duck_prefix(k)
        free = int(model.joint(f"{prefix}trunk_base_freejoint").qposadr[0])
        half = np.radians(start.yaw_deg) / 2
        np.testing.assert_allclose(
            data.qpos[free : free + 7], [start.x, start.y, SPAWN_HEIGHT_M, np.cos(half), 0, 0, np.sin(half)],
            atol=1e-12, err_msg=prefix,
        )
        for i, name in enumerate(JOINT_NAMES):
            assert data.qpos[model.joint(prefix + name).qposadr[0]] == DEFAULT_POSE[i], prefix + name
    assert data.qpos[model.joint("duck1/passive_LF_wheel").qposadr[0]] == 0.0


def test_every_ducks_servos_are_torque_motors_with_bams_parameters():
    """The grafted robots are converted exactly as a lone duck's."""
    model = compile_stage(load_event("got-a-talent"), LAYOUT)
    for k in range(len(LAYOUT)):
        for name in JOINT_NAMES:
            act, dof = model.actuator(duck_prefix(k) + name).id, int(model.joint(duck_prefix(k) + name).dofadr[0])
            assert model.actuator_gaintype[act] == mujoco.mjtGain.mjGAIN_FIXED
            assert model.actuator_gainprm[act][0] == pytest.approx(1.0)
            assert model.actuator_biastype[act] == mujoco.mjtBias.mjBIAS_NONE
            assert model.actuator_forcerange[act] == pytest.approx((-FORCE_LIMIT, FORCE_LIMIT))
            assert model.actuator_ctrllimited[act] == 0
            assert model.dof_armature[dof] == pytest.approx(ARMATURE)
            assert model.dof_damping[dof] == pytest.approx(0.0)
            assert model.dof_frictionloss[dof] == pytest.approx(0.0)
            assert model.dof_solref[dof] == pytest.approx(SOLREF_FRICTION)
            assert model.dof_solimp[dof] == pytest.approx(SOLIMP_FRICTION)
