"""Build the MuJoCo model for an event.

Mirrors buildPhysicsXml() in the sandbox's app/src/game/game.js: strip visual
geoms, prune the meshes they were the only user of, pin the timestep, inject a
floor and a STAND keyframe. Differences, all deliberate: a lane or an open
stage instead of a square arena, and no ball, props or terrain — nothing in an
official run may depend on scenery. The vendored MJCF still describes the sandbox's
position-servo robot; `compile_course` converts the 14 actuated joints to the
torque motors `arena.actuator` drives, so the built XML and the compiled
model disagree on purpose.
"""

import math
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

from .actuator import ARMATURE, FORCE_LIMIT, SOLIMP_FRICTION, SOLREF_FRICTION
from .assets import ASSET_ROOT
from .constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from .manifest import Manifest

SPAWN_HEIGHT_M = 0.12  # matches the trunk_base pos in the vendored MJCF

RIG_XML = {
    "legs": ("legs", "robot_allcollisions.xml"),
    "rollers": ("rollers", "robot_allcollisions_rollers.xml"),
}

WALL_THICKNESS_M = 0.05


def wall_boxes(course) -> list[tuple[str, tuple[float, float, float], tuple[float, float, float]]]:
    """The lane walls, as `(name, pos, half_extents)` in MJCF coordinates.

    One function, two consumers: it writes the MJCF the physics runs, and it is
    served to the page so the viewer can DRAW those walls rather than recompute
    where they ought to be. The walls are invisible by default and the physics
    is the only thing that feels them, so a second arithmetic in JavaScript
    would be a drawing that could silently disagree with what the robot hits.
    """
    half_t = WALL_THICKNESS_M / 2
    half_h = course.wall_height_m / 2
    half_len = course.length_m / 2 + 0.5  # overrun past the finish line
    y_off = course.width_m / 2 + half_t
    return [
        (name, (half_len - 0.5, y, half_h), (half_len, half_t, half_h))
        for name, y in (("wall_left", y_off), ("wall_right", -y_off))
    ]


def ramp_dir(slope_deg: float) -> np.ndarray:
    """Unit vector up the lane. Progress along the course is a dot with this."""
    t = math.radians(slope_deg)
    return np.array([math.cos(t), 0.0, math.sin(t)])


def ramp_normal(slope_deg: float) -> np.ndarray:
    """Unit vector normal to the lane surface."""
    t = math.radians(slope_deg)
    return np.array([-math.sin(t), 0.0, math.cos(t)])


def _sub(parent: ET.Element, tag: str, **attrs) -> ET.Element:
    return ET.SubElement(parent, tag, {k: str(v) for k, v in attrs.items()})


def _strip_visuals(root: ET.Element) -> None:
    """Remove visual geoms, then the mesh assets nothing references any more.

    Visual meshes are irrelevant to the dynamics — every body carries an explicit
    <inertial>, and visual geoms are contype=0 conaffinity=0 — so dropping them
    cuts the assets dict from ~40 meshes to the ~10 the collision geoms use.
    """
    for parent in root.iter():
        for geom in [g for g in parent.findall("geom") if g.get("class") == "visual"]:
            parent.remove(geom)

    used = {g.get("mesh") for g in root.iter("geom") if g.get("mesh")}
    asset = root.find("asset")
    if asset is None:
        return
    for mesh in list(asset.findall("mesh")):
        name = mesh.get("name") or mesh.get("file", "").removesuffix(".stl")
        if name not in used:
            asset.remove(mesh)


def _slope_deg(course) -> float:
    """A lane tilts by what it declares; a stage is flat."""
    return course.slope_deg if course.kind == "lane" else 0.0


def _inject_course(root: ET.Element, manifest: Manifest) -> None:
    """The floor inside one static rotated body, plus a lane's two side walls.

    A static body (no joint) leaves qpos untouched, so tilting the whole lane for
    a hill climb costs nothing in the keyframe. The walls are the referee: with wz
    pinned to zero, a policy that pulls to one side scrubs speed against them, so
    straightness is part of the time rather than a separate rule. A stage is the
    same floor with nothing else: an open space to perform in.

    The body has no joint, so its mass never enters the dynamics — but MuJoCo
    still totals it up from density, and a box the size of a wall is not
    negligible. density="0" keeps it what it actually is: pure collision
    geometry, so a lane and a stage report the same (zero) course mass.
    """
    course = manifest.course
    worldbody = root.find("worldbody")
    # euler is RADIANS here: the vendored MJCF declares <compiler angle="radian">,
    # which this body inherits. Writing the degree value straight in would tilt
    # the lane by 8 radians for slope_deg = 8 — geometry that compiles cleanly
    # and is completely wrong.
    pitch = -math.radians(_slope_deg(course))
    body = _sub(worldbody, "body", name="course", euler=f"0 {pitch} 0")

    _sub(body, "geom", name="floor", type="plane", size="0 0 0.05", pos="0 0 0", density="0")
    if course.kind == "stage":
        return

    for name, pos, size in wall_boxes(course):
        _sub(
            body,
            "geom",
            name=name,
            type="box",
            pos=" ".join(str(v) for v in pos),
            size=" ".join(str(v) for v in size),
            density="0",
        )


def _inject_keyframe(root: ET.Element, manifest: Manifest) -> None:
    """The STAND keyframe.

    qpos must cover every joint in document order: the 14 actuated hinges take
    DEFAULT_POSE by name, anything else (the roller rig's four passive wheels)
    starts at zero. Matching by name rather than position is what makes one
    keyframe builder work for both rigs. The 14 servos are torque motors
    driven by `arena.actuator`, so the keyframe holds no command: ctrl is
    zeros.
    """
    slope = _slope_deg(manifest.course)
    spawn = ramp_normal(slope) * SPAWN_HEIGHT_M
    free = f"{spawn[0]} {spawn[1]} {spawn[2]} 1 0 0 0"

    pose_by_name = dict(zip(JOINT_NAMES, DEFAULT_POSE))
    worldbody = root.find("worldbody")
    joints = [pose_by_name.get(j.get("name"), 0.0) for j in worldbody.iter("joint")]

    keyframe = _sub(root, "keyframe")
    _sub(
        keyframe,
        "key",
        name=manifest.start.keyframe,
        qpos=free + " " + " ".join(str(v) for v in joints),
        ctrl=" ".join("0.0" for _ in JOINT_NAMES),
    )


def build_course_xml(manifest: Manifest) -> tuple[str, dict[str, bytes]]:
    rig_dir, xml_name = RIG_XML[manifest.rig]
    robot_dir = ASSET_ROOT / "robot" / rig_dir
    root = ET.parse(robot_dir / xml_name).getroot()

    _strip_visuals(root)

    # meshdir is cleared so the assets dict can be keyed by bare filename.
    compiler = root.find("compiler")
    compiler.set("meshdir", "")

    _sub(root, "option", timestep=TIMESTEP)
    _inject_course(root, manifest)
    _inject_keyframe(root, manifest)

    asset = root.find("asset")
    files = [m.get("file") for m in asset.findall("mesh")]
    assets = {f: (robot_dir / "assets" / f).read_bytes() for f in files}

    return ET.tostring(root, encoding="unicode"), assets


def compile_course(manifest: Manifest) -> mujoco.MjModel:
    """Compile the event's model with the 14 servos as BAM torque motors.

    The vendored MJCF (`build_course_xml`) still describes MuJoCo position
    servos; converting to motors here, as training's `bam.mjlab.BamActuator.
    edit_spec` does, is what lets `arena.actuator.Servos` drive them with real
    torque instead of the sandbox's position gain.
    """
    xml, assets = build_course_xml(manifest)
    spec = mujoco.MjSpec.from_string(xml, assets=assets)
    for act in spec.actuators:
        act.set_to_motor()
        act.forcelimited = True
        act.forcerange = (-FORCE_LIMIT, FORCE_LIMIT)
        act.ctrllimited = False
        act.gear = [1.0, 0, 0, 0, 0, 0]
    for joint in spec.joints:
        if joint.name in JOINT_NAMES:
            joint.armature = ARMATURE
            joint.damping = np.zeros((3, 1))
            joint.frictionloss = 0.0
            joint.solref_friction = SOLREF_FRICTION
            joint.solimp_friction = SOLIMP_FRICTION
    model = spec.compile()
    model.opt.integrator = mujoco.mjtIntegrator.mjINT_IMPLICITFAST
    model.opt.iterations = 10
    model.opt.ls_iterations = 20
    return model
