import dataclasses
import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import pytest

from arena.constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from arena.course import (
    SPAWN_HEIGHT_M,
    build_course_xml,
    compile_course,
    ramp_dir,
    ramp_normal,
)
from arena.manifest import load_event


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
