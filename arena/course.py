"""Build the MuJoCo model for an event.

Mirrors buildPhysicsXml() in the sandbox's app/src/game/game.js: strip visual
geoms, prune the meshes they were the only user of, pin the timestep, inject a
floor and a STAND keyframe. Differences, all deliberate: a lane or an open
stage instead of a square arena, and no ball, props or terrain — nothing in an
official run may depend on scenery. The vendored MJCF still describes the sandbox's
position-servo robot; `compile_course` converts the 14 actuated joints to the
torque motors `arena.actuator` drives, so the built XML and the compiled
model disagree on purpose.

A stage holds a troupe (`compile_stage`): one robot per duck in one model, so
they share one physics and can push each other. A tug of war (`compile_tug`) is
a troupe in a ring cut by a pit, tied by a string at the neck: to the other
duck in a bout.
"""

import dataclasses
import functools
import math
import xml.etree.ElementTree as ET
from collections.abc import Sequence

import mujoco
import numpy as np

from .actuator import ARMATURE, FORCE_LIMIT, SOLIMP_FRICTION, SOLREF_FRICTION
from .assets import ASSET_ROOT
from .constants import DEFAULT_POSE, JOINT_NAMES, TIMESTEP
from .manifest import Manifest
from .timeline import Start

SPAWN_HEIGHT_M = 0.12  # matches the trunk_base pos in the vendored MJCF

RIG_XML = {
    "legs": ("legs", "robot_allcollisions.xml"),
    "rollers": ("rollers", "robot_allcollisions_rollers.xml"),
}

WALL_THICKNESS_M = 0.05

STRING_SITE = "string_end"  # on each duck's trunk_base (prefixed for duck 1), at the neck's base
STRING = "string"  # the spatial tendon
PLATFORM_OVERRUN_M = 20.0  # the platforms run this far past the ring: nobody walks off the world

RING_ROPES_M = (0.06, 0.12, 0.18)  # the ropes' axes over the canvas, bottom to top
RING_ROPE_RADIUS_M = 0.006
RING_POST_RADIUS_M = 0.022
RING_POST_TOP_M = 0.23


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


@functools.cache
def string_offset(rig: str = "legs") -> tuple[float, float, float]:
    """Where the string is tied, in the trunk's frame: the base of the neck, the `neck` body's
    pos in the rig's MJCF. The neck's hinge turns about that point, so it never moves on the
    trunk."""
    rig_dir, xml_name = RIG_XML[rig]
    root = ET.parse(ASSET_ROOT / "robot" / rig_dir / xml_name).getroot()
    x, y, z = (float(v) for v in root.find(".//body[@name='neck']").get("pos").split())
    return x, y, z


def ring_ropes(course) -> list[tuple[str, tuple[float, float, float], tuple[float, float, float]]]:
    """A tug's ring ropes, `(name, from, to)` in MJCF coordinates: west, east, north, south, each
    bottom to top (`rope_<side>_<k>`), a side running post to post at the ring's edge."""
    h = course.ring_m / 2
    sides = {
        "west": ((-h, -h), (-h, h)),
        "east": ((h, -h), (h, h)),
        "north": ((-h, h), (h, h)),
        "south": ((-h, -h), (h, -h)),
    }
    return [
        (f"rope_{side}_{k}", (*start, z), (*end, z))
        for side, (start, end) in sides.items()
        for k, z in enumerate(RING_ROPES_M)
    ]


def ring_posts(course) -> list[tuple[str, tuple[float, float, float], tuple[float, float, float]]]:
    """A tug's four corner posts, `(name, from, to)` as `ring_ropes`: from the canvas up to
    RING_POST_TOP_M at the ring's corners."""
    h = course.ring_m / 2
    corners = {"nw": (-h, h), "ne": (h, h), "sw": (-h, -h), "se": (h, -h)}
    return [(f"post_{corner}", (x, y, 0.0), (x, y, RING_POST_TOP_M)) for corner, (x, y) in corners.items()]


def backstops(course) -> list[tuple[str, tuple[float, float, float], tuple[float, float, float]]]:
    """A tug's four backstops, `(name, pos, half_extents)` as `wall_boxes`: a wall flush behind each
    side's ropes, up to the top rope. It closes the 5.4 cm under the bottom rope and the 4.8 cm
    between two, which a duck's foot or hand would slip through. The four overlap at the corners."""
    h = course.ring_m / 2
    r = RING_ROPE_RADIUS_M
    t = WALL_THICKNESS_M
    top = RING_ROPES_M[-1] + r
    reach, along = h + r + t / 2, h + r + t
    return [
        ("backstop_west", (-reach, 0.0, top / 2), (t / 2, along, top / 2)),
        ("backstop_east", (reach, 0.0, top / 2), (t / 2, along, top / 2)),
        ("backstop_north", (0.0, reach, top / 2), (along, t / 2, top / 2)),
        ("backstop_south", (0.0, -reach, top / 2), (along, t / 2, top / 2)),
    ]


def pit_boxes(course) -> list[tuple[str, tuple[float, float, float], tuple[float, float, float]]]:
    """The ground of a tug, `(name, pos, half_extents)`: a platform either side of the pit, top
    face at z = 0, and the pit's floor, top face at z = -pit_depth_m.

    No infinite plane: the pit must be a hole. The platforms still run PLATFORM_OVERRUN_M out
    past the ring, so no duck is ever below the floor but in the pit.
    """
    half_y = course.ring_m / 2 + WALL_THICKNESS_M + PLATFORM_OVERRUN_M
    x_out = course.ring_m / 2 + PLATFORM_OVERRUN_M
    half_pit = course.pit_m / 2
    slab = course.pit_depth_m + WALL_THICKNESS_M
    platform = ((x_out - half_pit) / 2, half_y, slab / 2)
    centre = (x_out + half_pit) / 2
    return [
        ("platform_west", (-centre, 0.0, -slab / 2), platform),
        ("platform_east", (centre, 0.0, -slab / 2), platform),
        (
            "pit_floor",
            (0.0, 0.0, -course.pit_depth_m - WALL_THICKNESS_M / 2),
            (half_pit, half_y, WALL_THICKNESS_M / 2),
        ),
    ]


def tug_layout(course, rig: str = "legs") -> list[Start]:
    """Where the ducks start: west facing east, east facing west, each placed so its string
    end sits on y = 0, the two string_m apart and centred on the pit."""
    ox, oy, _ = string_offset(rig)
    half = course.string_m / 2
    return [Start(-half - ox, -oy, 0.0), Start(half + ox, oy, 180.0)]


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
    """A lane tilts by what it declares; a stage and a tug are flat."""
    return course.slope_deg if course.kind == "lane" else 0.0


def _boxes(body: ET.Element, boxes) -> None:
    for name, pos, size in boxes:
        _sub(
            body,
            "geom",
            name=name,
            type="box",
            pos=" ".join(str(v) for v in pos),
            size=" ".join(str(v) for v in size),
        )


def _capsules(body: ET.Element, capsules, radius: float) -> None:
    for name, start, end in capsules:
        _sub(
            body,
            "geom",
            name=name,
            type="capsule",
            fromto=" ".join(str(v) for v in (*start, *end)),
            size=radius,
        )


def _inject_course(root: ET.Element, manifest: Manifest) -> None:
    """The floor inside one static rotated body, plus a lane's two side walls.

    A static body (no joint) leaves qpos untouched, so tilting the whole lane for
    a hill climb costs nothing in the keyframe. The walls are the referee: with wz
    pinned to zero, a policy that pulls to one side scrubs speed against them, so
    straightness is part of the time rather than a separate rule. A stage is the
    same floor with nothing else: an open space to perform in. A tug has no
    plane at all, since its pit must be a hole: its ground is `pit_boxes`, fenced by
    the ring's ropes and posts with a backstop behind them.
    """
    course = manifest.course
    worldbody = root.find("worldbody")
    # euler is RADIANS here: the vendored MJCF declares <compiler angle="radian">,
    # which this body inherits. Writing the degree value straight in would tilt
    # the lane by 8 radians for slope_deg = 8 — geometry that compiles cleanly
    # and is completely wrong.
    pitch = -math.radians(_slope_deg(course))
    body = _sub(worldbody, "body", name="course", euler=f"0 {pitch} 0")
    if course.kind == "tug":
        _boxes(body, pit_boxes(course) + backstops(course))
        _capsules(body, ring_ropes(course), RING_ROPE_RADIUS_M)
        _capsules(body, ring_posts(course), RING_POST_RADIUS_M)
        return

    _sub(body, "geom", name="floor", type="plane", size="0 0 0.05", pos="0 0 0")
    if course.kind == "stage":
        return

    _boxes(body, wall_boxes(course))


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


def _robot(rig: str) -> tuple[ET.Element, dict[str, bytes]]:
    """A rig's MJCF without its visual geoms, and the meshes its collision geoms use."""
    rig_dir, xml_name = RIG_XML[rig]
    robot_dir = ASSET_ROOT / "robot" / rig_dir
    root = ET.parse(robot_dir / xml_name).getroot()

    _strip_visuals(root)

    # meshdir is cleared so the assets dict can be keyed by bare filename.
    compiler = root.find("compiler")
    compiler.set("meshdir", "")

    asset = root.find("asset")
    files = [m.get("file") for m in asset.findall("mesh")]
    return root, {f: (robot_dir / "assets" / f).read_bytes() for f in files}


def build_course_xml(manifest: Manifest) -> tuple[str, dict[str, bytes]]:
    root, assets = _robot(manifest.rig)
    _sub(root, "option", timestep=TIMESTEP)
    _inject_course(root, manifest)
    _inject_keyframe(root, manifest)
    return ET.tostring(root, encoding="unicode"), assets


def _motorized(xml: str, assets: dict[str, bytes]) -> mujoco.MjSpec:
    """The spec of `xml` with the 14 servos as BAM torque motors.

    The vendored MJCF still describes MuJoCo position servos; converting to
    motors here, as training's `bam.mjlab.BamActuator.edit_spec` does, is what
    lets `arena.actuator.Servos` drive them with real torque instead of the
    sandbox's position gain.
    """
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
    return spec


def _compiled(spec: mujoco.MjSpec) -> mujoco.MjModel:
    """The model, with training's solver."""
    model = spec.compile()
    model.opt.integrator = mujoco.mjtIntegrator.mjINT_IMPLICITFAST
    model.opt.iterations = 10
    model.opt.ls_iterations = 20
    return model


def compile_course(manifest: Manifest) -> mujoco.MjModel:
    """Compile the event's model with the 14 servos as BAM torque motors."""
    return _compiled(_motorized(*build_course_xml(manifest)))


def duck_prefix(k: int) -> str:
    """Duck k's names in a stage's model. Duck 0's are a lone duck's own, so a
    troupe of one is the model a stage always compiled; another duck's carry its
    index."""
    return f"duck{k}/" if k else ""


def _yaw_quat(yaw_deg: float) -> list[float]:
    half = math.radians(yaw_deg) / 2
    return [math.cos(half), 0.0, 0.0, math.sin(half)]


def compile_stage(manifest: Manifest, layout: Sequence[tuple[str, Start]]) -> mujoco.MjModel:
    """A stage's model for a troupe: one robot per duck, `(rig, start)` in duck order.

    Duck 0 is built as `compile_course` builds a lone duck, from the same XML
    with the same names (in its own rig), so a troupe of one compiles to the
    model a stage always played. Every other duck is its rig's own MJCF,
    motorized the same way and grafted onto the world under its prefix
    (`duck_prefix`): each robot keeps its MJCF's own contact rules, and two
    robots' collision geoms collide like any others. The keyframe holds every
    duck at its start, at the stage's spawn height (the roller rig's 2 cm-deep
    spawn included), turned by its yaw; attaching left the new ducks' part of it
    at the origin.
    """
    return _posed(_compiled(_troupe(manifest, layout)), manifest, layout)


def _troupe(
    manifest: Manifest, layout: Sequence[tuple[str, Start]], string_end=None
) -> mujoco.MjSpec:
    """The troupe's spec: duck 0 from the event's XML, every other duck attached on its frame
    under its prefix. With `string_end`, each duck's trunk_base carries a STRING_SITE there."""

    def tied(robot: mujoco.MjSpec) -> mujoco.MjSpec:
        if string_end is not None:
            robot.body("trunk_base").add_site(name=STRING_SITE, pos=list(string_end))
        return robot

    (rig, _), others = layout[0], layout[1:]
    spec = tied(_motorized(*build_course_xml(dataclasses.replace(manifest, rig=rig))))
    for k, (rig, start) in enumerate(others, start=1):
        root, assets = _robot(rig)
        robot = tied(_motorized(ET.tostring(root, encoding="unicode"), assets))
        frame = spec.worldbody.add_frame(pos=[start.x, start.y, 0.0], quat=_yaw_quat(start.yaw_deg))
        spec.attach(robot, prefix=duck_prefix(k), frame=frame)
    return spec


def _posed(
    model: mujoco.MjModel, manifest: Manifest, layout: Sequence[tuple[str, Start]]
) -> mujoco.MjModel:
    """The keyframe holds every duck of `layout` at its start, standing in DEFAULT_POSE."""
    pose = model.key_qpos[model.key(manifest.start.keyframe).id]
    for k, (_, start) in enumerate(layout):
        prefix = duck_prefix(k)
        trunk = model.body(f"{prefix}trunk_base").id
        free = model.jnt_qposadr[model.body_jntadr[trunk]]
        pose[free : free + 7] = [start.x, start.y, SPAWN_HEIGHT_M, *_yaw_quat(start.yaw_deg)]
        for name, angle in zip(JOINT_NAMES, DEFAULT_POSE):
            pose[model.joint(prefix + name).qposadr[0]] = angle
    return model


def compile_tug(manifest: Manifest) -> mujoco.MjModel:
    """A tug's model: the two ducks of `tug_layout`, tied neck to neck by STRING, which goes slack
    but never stretches past string_m."""
    layout = [(manifest.rig, start) for start in tug_layout(manifest.course, manifest.rig)]
    spec = _troupe(manifest, layout, string_offset(manifest.rig))
    string = spec.add_tendon(name=STRING)
    string.wrap_site(STRING_SITE)
    string.limited = True
    string.range = [0.0, manifest.course.string_m]
    string.wrap_site(duck_prefix(1) + STRING_SITE)
    return _posed(_compiled(spec), manifest, layout)
