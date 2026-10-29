"""Sock Heist's venue: the giant microduck's nest woven from socks, and the loose socks on its
floor.

Run headless from the repository root, in Blender 5.2.2:

    blender -b -P scripts/sock_heist_venue.py -- app/public/venue [--render <dir>]

It writes `sock-nest.glb` (one mesh `nest`) and `socks.glb` (meshes `sock_0` ... `sock_4`): glTF
Y up, metres, vertex colours on one plain material. It prints the giant's seated pose, the joint
angles and the trunk height the site seats it with. With `--render` it also sits the racers' own
microduck, GIANT_SCALE times their size, in the nest, stands four life-size racers on the start
line, lays socks between the finish line and the nest and renders four views for the owner.

The nest's sizes come from the seated giant: its inside fits the giant's footprint plus 10 % and
its rim rises over the giant's folded legs. The socks are a person's socks. Everything random is
drawn from random.Random(0), so a rebuild gives the same files.
"""

import argparse
import json
import random
import sys
from dataclasses import dataclass
from functools import cache
from math import ceil, cos, hypot, pi, radians, sin, tan, tau
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from arena.constants import DEFAULT_POSE, JOINT_NAMES

ROBOT = ROOT / "app" / "public" / "robot"
# The racers' standing pose.
STAND = dict(zip(JOINT_NAMES, DEFAULT_POSE.tolist()))

GIANT_SCALE = 4.5
FOLD = 0.95  # how far into its range each hip pitch and knee folds for the giant to sit
FOOTPRINT_MARGIN = 1.1
NEST_TRIANGLES = 6000

# The render's layout, as the site lays the race out (app/src/giant.js): a 6 m lane, four lanes
# 0.95 m apart, the giant's and the nest's centre GIANT_BEHIND_M past the finish line, the loose
# socks SOCKS_PER_M per metre across the lanes, between SOCK_FIELD metres past the line.
LENGTH_M = 6.0
LANES = (-1.425, -0.475, 0.475, 1.425)
EDGE_M = 1.9
GIANT_BEHIND_M = 1.7
SOCK_FIELD = (0.15, 0.95)
SOCKS_PER_M = 7
# The race camera at the start, as app/src/viewer.js poses it: #3's [clip.camera] (2.1 m back,
# 0.86 m up, a 42° lens) looking at the start line 0.12 m up, backed off and raised by packChase
# until the four lanes and its 0.3 m margin fit across a 16:9 picture.
CHASE_BACK_M, CHASE_HEIGHT_M, CHASE_FOV, CHASE_TARGET_M, PACK_MARGIN_M = 2.1, 0.86, 42, 0.12, 0.3

PALETTE = {
    "lime": "#c8ff2e",
    "white": "#ffffff",
    "charcoal": "#2b2d33",
    "red": "#ff2b2b",
    "sky": "#87ceeb",
}


@dataclass(frozen=True)
class Sock:
    """One sock model: its lengths along the centreline, its colour and the second colour of its
    cuff, stripes, heel and toe, its stripes (spans along the leg, in metres from the cuff), and
    its curl: how far it wanders either way as it lies, in radians per metre, and from where."""

    leg: float
    foot: float
    colour: str
    second: str
    stripes: tuple[tuple[float, float], ...]
    curl: tuple[float, float]


SOCKS = (
    Sock(0.10, 0.21, "charcoal", "lime", (), (2.5, 0.0)),  # an ankle sock
    Sock(0.22, 0.22, "white", "red", ((0.06, 0.08), (0.10, 0.12)), (2.0, 1.3)),  # a sports sock
    Sock(0.40, 0.23, "lime", "charcoal", (), (2.2, 2.6)),  # a knee sock, the longest
    Sock(0.17, 0.21, "red", "white", (), (2.8, 4.0)),
    Sock(0.28, 0.22, "sky", "white", (), (2.4, 5.2)),
)
RADIUS = 0.035  # a sock laid flat is twice this wide
FLAT = 0.5  # a sock lying down keeps this much of its height
HEEL_TURN = radians(45)  # how far the foot turns from the leg
BEND = 0.09  # the length of the heel's soft turn
HEEL_BULGE = 0.7  # how far the heel's cup stands out, in radii
CURL_WAVE = 1.0  # the length of a sock's curl, longer than the sock: a gentle bend
CUFF_BAND = 0.035
CUFF_FLARE = 1.15  # the cuff's rib, wider than the leg
CUFF_STEP = 0.012  # how short the cuff's rib narrows to the leg, with Detail.rib
TOE_BAND = 0.055
TOE_LENGTH = 0.9  # the toe cap's length, in radii


@dataclass(frozen=True)
class Detail:
    """How finely a sock is swept: sides round the tube, steps round the heel, the longest step
    along it, the rings of its toe cap, and whether the cuff's rib narrows sharply to the leg
    (rib) or tapers to the next ring."""

    sides: int
    bend: int
    step: float
    toe: int
    rib: bool


FINE = Detail(sides=8, bend=4, step=0.06, toe=2, rib=True)  # a loose sock, instanced
COARSE = Detail(sides=6, bend=2, step=0.2, toe=1, rib=False)  # a sock of the nest


class Soup:
    """Vertices, faces and a colour per face corner, gathered before they become one mesh."""

    def __init__(self):
        self.verts: list[Vector] = []
        self.faces: list[tuple[int, ...]] = []
        self.colours: list[tuple[float, ...]] = []

    def add(self, other: "Soup"):
        base = len(self.verts)
        self.verts += other.verts
        self.faces += [tuple(base + i for i in face) for face in other.faces]
        self.colours += other.colours

    def face(self, indices: tuple[int, ...], colours: list[tuple[float, ...]]):
        self.faces.append(indices)
        self.colours += colours

    @property
    def triangles(self) -> int:
        return sum(len(face) - 2 for face in self.faces)


def srgb(name: str) -> tuple[float, float, float, float]:
    code = PALETTE[name]
    return (*(int(code[k : k + 2], 16) / 255 for k in (1, 3, 5)), 1.0)


def link(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.scene.collection.objects.link(obj)
    return obj


@cache
def kinematics() -> dict:
    return json.loads((ROBOT / "kinematics.json").read_text())


@cache
def part_meshes() -> dict[str, bpy.types.Mesh]:
    """microduck.glb's part meshes by file name, in the rig's own frame. The GLB holds the raw MJCF
    meshes, Z up, and the site hangs them as they are under its one Y-up root (app/src/rig.js); the
    glTF importer took them for Y up and turned them, so they are turned back."""
    bpy.ops.import_scene.gltf(filepath=str(ROBOT / "microduck.glb"))
    material = racer_material()
    meshes = {}
    for obj in list(bpy.context.selected_objects):
        mesh = obj.data
        mesh.transform(Matrix.Rotation(-pi / 2, 4, "X"))
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=pi / 5)  # rig.js's crease
        mesh.materials.append(material)
        meshes[obj["meshFile"]] = mesh
        bpy.data.objects.remove(obj)
    return meshes


def racer_material() -> bpy.types.Material:
    """Each part takes its kinematics colour, carried as its object's colour."""
    material = bpy.data.materials.new("racer")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = 0.55
    links.new(nodes.new("ShaderNodeObjectInfo").outputs["Color"], shader.inputs["Base Color"])
    return material


def racer(angles: dict[str, float]) -> bpy.types.Object:
    """A microduck assembled as app/src/rig.js assembles it: an empty per body of kinematics.json at
    its pos and quat (w, x, y, z) under its parent, a hinge turning on top of the body's rest
    orientation about its axis, and each geom a linked copy of its part mesh at its own pos and
    quat. Blender is Z up like the MJCF, so the root needs none of rig.js's turn to Y up."""
    meshes = part_meshes()
    root = link(bpy.data.objects.new("racer", None))
    bodies = {}
    for body in kinematics()["bodies"]:
        empty = link(bpy.data.objects.new(body["name"], None))
        empty.parent = bodies.get(body["parent"], root)
        empty.location = body["pos"]
        empty.rotation_mode = "QUATERNION"
        rotation = Quaternion(body["quat"])
        joint = body["joint"]
        if joint:
            rotation = rotation @ Quaternion(joint["axis"], angles.get(joint["name"], 0.0))
        empty.rotation_quaternion = rotation
        bodies[body["name"]] = empty
        for geom in body["geoms"]:
            part = link(bpy.data.objects.new(geom["mesh"], meshes[geom["mesh"]]))
            part.parent = empty
            part.location = geom["pos"]
            part.rotation_mode = "QUATERNION"
            part.rotation_quaternion = Quaternion(geom["quat"])
            part.color = geom["color"]
    return root


def joint_body(name: str) -> dict:
    return next(b for b in kinematics()["bodies"] if (b["joint"] or {}).get("name") == name)


def head_turned() -> float:
    """head_yaw's own lower limit: round over the shoulder, the face back at the lanes."""
    return joint_body("head_yaw")["joint"]["range"][0]


@cache
def sitting() -> dict[str, float]:
    """STAND with the legs folded under the lowered trunk, as a duck sits on its nest: each hip
    pitch and knee FOLD of the way to the end of its range, the left toward its upper end and the
    right, mirrored as at STAND, toward its lower; each ankle at knee - hip, which keeps the foot
    level as it is at STAND. The head and neck stay as at STAND."""
    pose = dict(STAND)
    for side, end in (("left", 1), ("right", 0)):
        hip, knee = (
            FOLD * joint_body(f"{side}_{joint}")["joint"]["range"][end]
            for joint in ("hip_pitch", "knee")
        )
        pose |= {f"{side}_hip_pitch": hip, f"{side}_knee": knee, f"{side}_ankle": knee - hip}
    return pose


@dataclass(frozen=True)
class Measure:
    """A racer in a pose, its trunk where kinematics.json puts it: its world box in Blender axes
    (Z up), and the top of its legs, the meshes its hip pitch joints carry."""

    lo: Vector
    hi: Vector
    legs: float

    @property
    def size(self) -> tuple[float, float, float]:
        """Width, height and depth, in glTF axes: along the lane, up, across it."""
        x, y, z = self.hi - self.lo
        return x, z, y

    @property
    def footprint(self) -> float:
        """How far the racer reaches from its own vertical axis: its box's farthest corner."""
        return max(hypot(x, y) for x in (self.lo.x, self.hi.x) for y in (self.lo.y, self.hi.y))

    @property
    def trunk(self) -> float:
        """The trunk's height once the racer rests on the floor."""
        root = next(b for b in kinematics()["bodies"] if b["parent"] is None)
        return root["pos"][2] - self.lo.z


def racer_box(angles: dict[str, float]) -> Measure:
    duck = racer(angles)
    bpy.context.view_layer.update()
    hips = {joint_body(f"{side}_hip_pitch")["name"] for side in ("left", "right")}
    legs = {p for b in duck.children_recursive if b.name in hips for p in b.children_recursive}
    points, leg_points = [], []
    for part in duck.children_recursive:
        if part.type == "MESH":
            co = np.empty(len(part.data.vertices) * 3)
            part.data.vertices.foreach_get("co", co)
            world = np.array(part.matrix_world)
            points.append(co.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3])
            if part in legs:
                leg_points.append(points[-1])
    points = np.concatenate(points)
    measure = Measure(
        Vector(points.min(0)), Vector(points.max(0)), float(np.concatenate(leg_points)[:, 2].max())
    )
    bpy.data.batch_remove([duck, *duck.children_recursive])
    return measure


def length(sock: Sock) -> float:
    return sock.leg + BEND + sock.foot


def integral(values: np.ndarray, s: np.ndarray) -> np.ndarray:
    return np.concatenate([[0.0], np.cumsum((values[1:] + values[:-1]) / 2 * np.diff(s))])


@cache
def centreline_table(sock: Sock) -> np.ndarray:
    """The flat sock's centreline from its cuff, as rows (s, a, b): it runs along a, curling gently
    either way, and turns HEEL_TURN softly over the heel's BEND, the turn's rate rising and falling
    like a sine, toward b."""
    s = np.linspace(0.0, length(sock), 241)
    heel = np.sin(pi * np.clip((s - sock.leg) / BEND, 0, 1)) * pi / 2 / BEND  # integrates to 1
    amount, start = sock.curl
    heading = integral(HEEL_TURN * heel + amount * np.sin(tau * s / CURL_WAVE + start), s)
    return np.stack([s, integral(np.cos(heading), s), integral(np.sin(heading), s)], 1)


def centreline(sock: Sock, s: float) -> tuple[float, float]:
    along, a, b = centreline_table(sock).T
    return float(np.interp(s, along, a)), float(np.interp(s, along, b))


def span(sock: Sock) -> tuple[float, float]:
    """Where a flat sock lies along a: the middle of its reach, and its reach with the tube's
    ends."""
    a = centreline_table(sock)[:, 1]
    return (a.min() + a.max()) / 2, a.max() - a.min() + 2 * RADIUS


def stations(sock: Sock, detail: Detail) -> list[float]:
    """Where the tube's rings go along the centreline: round the heel, at the cuff's, the toe's and
    the stripes' edges, where the cuff's rib narrows with detail.rib, and never further apart
    than detail.step."""
    end = length(sock)
    marks = {0.0, CUFF_BAND, end - TOE_BAND, end}
    if detail.rib:
        marks.add(CUFF_BAND + CUFF_STEP)
    marks |= {sock.leg + BEND * k / detail.bend for k in range(detail.bend + 1)}
    marks |= {edge for stripe in sock.stripes for edge in stripe}
    marks = sorted(marks)
    out = [marks[0]]
    for s in marks[1:]:
        steps = ceil((s - out[-1]) / detail.step)
        out += [out[-1] + (s - out[-1]) * k / steps for k in range(1, steps + 1)]
    return out


def flat(a: float, b: float) -> tuple[Vector, Vector]:
    """A sock's own frame: lying on the floor, its centreline in the plane z = 0."""
    return Vector((a, b, 0.0)), Vector((0, 0, 1))


def sock_soup(sock: Sock, detail: Detail, place=flat) -> Soup:
    """A sock lying on something: a tube of detail.sides swept round its centreline, set in the
    world by place(a, b) -> (point, up), and flattened to FLAT of its height along up. The cuff is
    a wider rib round an opening, dark inside; the heel's outer side bulges into a cup; the toe is
    a rounded cap. The cuff, the stripes, the heel's cup and the toe take the second colour."""
    end = length(sock)
    colour, second = srgb(sock.colour), srgb(sock.second)
    along = stations(sock, detail)
    points, ups = zip(*(place(*centreline(sock, s)) for s in along))
    last = len(points) - 1
    tangents = [
        (points[min(k + 1, last)] - points[max(k - 1, 0)]).normalized() for k in range(len(points))
    ]
    heel = [place(*centreline(sock, sock.leg + BEND * f))[0] for f in (0, 0.5, 1)]
    outward = (heel[1] - (heel[0] + heel[2]) / 2).normalized()

    # Each ring: its centre, its tangent, its up, its radius and where it is along the sock.
    rings = [
        (p, t, u, RADIUS * (CUFF_FLARE if s <= CUFF_BAND else 1.0), s)
        for p, t, u, s in zip(points, tangents, ups, along)
    ]
    for k in range(1, detail.toe + 1):
        angle = pi / 2 * k / (detail.toe + 1)
        toe = points[-1] + tangents[-1] * RADIUS * TOE_LENGTH * sin(angle)
        rings.append((toe, tangents[-1], ups[-1], RADIUS * cos(angle), end))

    soup = Soup()
    loops = []
    for centre, tangent, up, radius, s in rings:
        normal = (up - tangent * up.dot(tangent)).normalized()
        binormal = tangent.cross(normal)
        cup = sin(pi * (s - sock.leg) / BEND) if sock.leg < s < sock.leg + BEND else 0.0
        loop = []
        for j in range(detail.sides):
            # Half a side round from up, so that the flattened sock has a face, not an edge, on top.
            around = tau * (j + 0.5) / detail.sides
            direction = normal * cos(around) + binormal * sin(around)
            loop.append(len(soup.verts))
            bulge = 1 + HEEL_BULGE * cup * max(0.0, direction.dot(outward)) ** 2
            squashed = normal * FLAT * cos(around) + binormal * sin(around)
            soup.verts.append(centre + squashed * radius * bulge)
        loops.append(loop)

    def paint(s: float, facing: Vector) -> tuple[float, ...]:
        if s < CUFF_BAND or s > end - TOE_BAND or any(a < s < b for a, b in sock.stripes):
            return second
        if sock.leg < s < sock.leg + BEND and facing.dot(outward) > -0.2:
            return second
        return colour

    for k in range(len(loops) - 1):
        s = (rings[k][4] + rings[k + 1][4]) / 2
        axis = (rings[k][0] + rings[k + 1][0]) / 2
        for j in range(detail.sides):
            quad = (loops[k][j - 1], loops[k][j], loops[k + 1][j], loops[k + 1][j - 1])
            facing = sum((soup.verts[i] for i in quad), Vector()) / 4 - axis
            soup.face(quad, [paint(s, facing.normalized())] * 4)
    tip = len(soup.verts)
    soup.verts.append(points[-1] + tangents[-1] * RADIUS * TOE_LENGTH)
    for j in range(detail.sides):
        soup.face((loops[-1][j - 1], loops[-1][j], tip), [second] * 3)
    opening = len(soup.verts)
    soup.verts.append(points[0] + tangents[0] * RADIUS * 0.6)
    inside = (*(c * 0.3 for c in colour[:3]), 1.0)
    for j in range(detail.sides):
        soup.face((loops[0][j], loops[0][j - 1], opening), [second, second, inside])
    return soup


def mesh_object(name: str, soup: Soup, material: bpy.types.Material) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in soup.verts], [], soup.faces)
    mesh.shade_smooth()
    colours = mesh.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    colours.data.foreach_set("color_srgb", [c for corner in soup.colours for c in corner])
    mesh.materials.append(material)
    return link(bpy.data.objects.new(name, mesh))


def venue_material() -> bpy.types.Material:
    """The one plain material of both GLBs: the vertex colours, rough as cotton, no metal, and
    single-sided, as every model here is closed."""
    material = bpy.data.materials.new("socks")
    material.use_backface_culling = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = 0.9
    shader.inputs["Metallic"].default_value = 0.0
    colours = nodes.new("ShaderNodeVertexColor")
    colours.layer_name = "Color"
    links.new(colours.outputs["Color"], shader.inputs["Base Color"])
    return material


def sock(variant: int, material: bpy.types.Material) -> bpy.types.Object:
    """A loose sock lying on the floor, its origin there under its middle."""
    soup = sock_soup(SOCKS[variant], FINE)
    lo, hi = np.min(soup.verts, 0), np.max(soup.verts, 0)
    shift = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]))
    soup.verts = [v - shift for v in soup.verts]
    return mesh_object(f"sock_{variant}", soup, material)


# The heap the nest's socks lie on, in parts of its rim's height: how far its cross-section reaches
# in from its crest and out to its foot. The cross-section is a mound, flat on its crest and flaring
# onto the floor on either side.
INSIDE = 0.2
OUTSIDE = 0.5
ACROSS = 0.15  # the share of socks laid across a row, over those laid along it end to end
FEET_DOWN = 0.7  # the share of socks along a row whose foot hangs down the heap's outside
TOES_UP = 0.2  # the share of socks along the crest's row whose foot rises off the heap
DRAPE = 0.2  # how much every foot rises off the heap per metre it runs: over the next row
SHADE = 0.3  # how much light reaches the socks deep in the heap, between those of the weave
RIM_OVER = 0.05  # how far the rim rises over the giant's folded legs: a look from above the
# lanes, over the rim, meets socks, not knees


@dataclass(frozen=True)
class Heap:
    """The heap's cross-section, sampled by arc length v from inside its inner foot, over its crest
    and out along the floor past its outer foot: radius, height and outward normal at each v."""

    v: np.ndarray
    radius: np.ndarray
    height: np.ndarray
    normal: np.ndarray
    inner_foot: float
    crest: float
    foot: float

    def at(self, v: float) -> tuple[float, float, float, float]:
        radius, height, nr, nz = (
            float(np.interp(v, self.v, values))
            for values in (self.radius, self.height, *self.normal.T)
        )
        length = hypot(nr, nz)
        return radius, height, nr / length, nz / length


def heap(inner: float, rim: float) -> Heap:
    """The mound under the weave: the socks lying on its crest reach the rim, its inner foot is half
    a sock's width outside the giant's footprint."""
    top = rim - 2 * FLAT * RADIUS
    crest = inner + RADIUS + INSIDE * rim
    x = np.linspace(-1.8, 1.8, 181)
    radius = crest + np.where(x < 0, INSIDE, OUTSIDE) * rim * x
    height = top * np.cos(pi / 2 * np.clip(x, -1, 1)) ** 2
    d_radius, d_height = np.gradient(radius), np.gradient(height)
    v = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(radius), np.diff(height)))])
    normal = np.stack([-d_height, d_radius], 1)
    inner_foot, crest, foot = (float(np.interp(at, x, v)) for at in (-1, 0, 1))
    return Heap(v, radius, height, normal, inner_foot, crest, foot)


def heap_soup(ground: Heap, rng: random.Random, sides: int = 16, rings: int = 8) -> Soup:
    """The heap as a lathe sunk a little under the socks, each of its vertices a sock's colour in
    SHADE, blending across its faces: what shows between the weave's socks is more socks, deeper
    in the dark."""
    soup, shades = Soup(), []
    for v in np.linspace(ground.inner_foot, ground.foot, rings):
        radius, height, nr, nz = ground.at(v)
        radius, height = radius - 0.3 * RADIUS * nr, height - 0.3 * RADIUS * nz
        for j in range(sides):
            angle = tau * j / sides
            soup.verts.append(Vector((radius * cos(angle), radius * sin(angle), height)))
            shades.append((*(c * SHADE for c in srgb(rng.choice(list(PALETTE)))[:3]), 1.0))
    for k in range(rings - 1):
        for j in range(sides):
            a, b = k * sides + j, k * sides + (j + 1) % sides
            quad = (a, a + sides, b + sides, b)
            soup.face(quad, [shades[i] for i in quad])
    return soup


def rim_height(seated: Measure) -> float:
    return GIANT_SCALE * (seated.legs - seated.lo.z) + RIM_OVER


def nest(measure: Measure, material: bpy.types.Material, rng: random.Random) -> bpy.types.Object:
    """Socks woven over a heap in rows, from its crest down to its foot. Along each row its socks
    lie end to end, their feet hanging over the next row or, on the crest, some toes up; a few
    more lie across the rows above the two lowest, over them. Each is a random model, turned a
    little but on the bottom row, either side up. As many socks as the triangle budget carries,
    in as many rows as they fill end to end, shared between the rows by their length."""
    inner = GIANT_SCALE * measure.footprint * FOOTPRINT_MARGIN
    rim = rim_height(measure)
    ground = heap(inner, rim)
    soup = heap_soup(ground, rng)
    costs = [sock_soup(s, COARSE).triangles for s in SOCKS]
    models, spent = [], soup.triangles
    for pick in dealt(rng):
        if spent + costs[pick] > NEST_TRIANGLES:
            break
        models.append(pick)
        spent += costs[pick]
    first, last = ground.crest - RADIUS, ground.foot - RADIUS
    mean = tau * (ground.at((first + last) / 2)[0] + RADIUS)
    reach = (1 - ACROSS) * sum(span(SOCKS[m])[1] for m in models)
    rows = np.linspace(first, last, max(2, round(reach / mean)))
    lengths = [ground.at(v)[0] for v in rows]
    counts = [round(len(models) * length / sum(lengths)) for length in lengths]
    counts[-1] = len(models) - sum(counts[:-1])
    for row, (v, n) in enumerate(zip(rows, counts)):
        bottom = row == len(rows) - 1
        low = row >= len(rows) - 2
        laid = [(SOCKS[models.pop()], not low and rng.random() < ACROSS) for _ in range(n)]
        across = [model for model, over in laid if over]
        along = [model for model, over in laid if not over]
        rho = ground.at(v)[0] + RADIUS
        spans = [span(m)[1] for m in along]
        gap = (tau * rho - sum(spans)) / len(along)
        angle = rng.uniform(0, tau)
        for model, extent in zip(along, spans):
            angle += (extent + gap) / 2 / rho
            place = draped(ground, model, v, angle, rng, crest=row == 0, climb=bottom)
            soup.add(sock_soup(model, COARSE, place))
            angle += (extent + gap) / 2 / rho
        for model in across:
            place = draped(ground, model, v, rng.uniform(0, tau), rng, across=True)
            soup.add(sock_soup(model, COARSE, place))
    # A sock pressed on the floor lies flat on it rather than through it.
    for vert in soup.verts:
        vert.z = max(vert.z, 0.0)
    woven = mesh_object("nest", soup, material)
    woven["socks"], woven["rows"] = sum(counts), len(rows)
    return woven


def dealt(rng: random.Random):
    """The sock models in rounds, each a shuffle of all of them: as many of each, and neighbours
    unlike."""
    while True:
        yield from rng.sample(range(len(SOCKS)), len(SOCKS))


def draped(ground: Heap, model: Sock, v: float, angle: float, rng, *, across=False, crest=False,
           climb=False):
    """place(a, b) for a sock of the weave: the middle of its reach on the heap at row v and
    angle, laid along the row or across it, turned a little and either side up, lying on the heap;
    across, it lies over the socks along the row. Its foot hangs down the heap or, on the bottom
    row (climb), lies straight along it and climbs it; the foot rises as it runs, DRAPE per
    metre, to lie over the next row rather than through it; on the crest's row some rise more,
    toes up."""
    turn = 0.0
    if not climb:
        turn = rng.uniform(-0.2, 0.2) + (rng.choice((-pi / 2, pi / 2)) if across else 0.0)
    side = -1 if climb else 1 if rng.random() < FEET_DOWN else -1
    lift = DRAPE + (rng.uniform(0.2, 0.5) if crest and rng.random() < TOES_UP else 0.0)
    rise = RADIUS * (FLAT + (rng.uniform(0.9, 1.3) if across else rng.uniform(0.0, 0.3)))
    middle = span(model)[0]

    def place(a: float, b: float) -> tuple[Vector, Vector]:
        da, db = a - middle, side * b
        radius, height, nr, nz = ground.at(v + da * sin(turn) + db * cos(turn))
        off = rise + lift * max(0.0, b)
        rho = radius + nr * off
        theta = angle + (da * cos(turn) - db * sin(turn)) / rho
        out = Vector((cos(theta), sin(theta), 0.0))
        return out * rho + Vector((0, 0, height + nz * off)), out * nr + Vector((0, 0, nz))

    return place


def export(objects: list[bpy.types.Object], path: Path):
    """A GLB of these objects alone: Y up, modifiers applied, vertex colours, their one material,
    no animation. Each node bears its object's name, which is its mesh's."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
    )


def aim(camera: bpy.types.Object, location, target, fov: float):
    camera.location = location
    camera.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    camera.data.sensor_fit = "VERTICAL"
    camera.data.angle_y = radians(fov)


def render(out: Path, seated: Measure, nest_object, socks: list[bpy.types.Object], rng):
    """The venue on a grey floor, Eevee at 1600 x 900: chase.png from the race camera behind the
    start line, three-quarter.png, close.png on the rim, and turned.png with the head round."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.eevee.taa_render_samples = 64
    world = bpy.data.worlds.new("sky")
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.75, 1)
    scene.world = world
    sun = link(bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")))
    sun.data.energy = 3.5
    sun.data.angle = radians(8)
    sun.rotation_euler = (radians(50), 0, radians(-35))

    plane((0.22, 0.22, 0.23), (4, 0, 0), (30, 20))
    for x in (0.0, LENGTH_M):
        plane((0.9, 0.9, 0.9), (x, 0, 0.001), (0.05, 2 * EDGE_M))

    centre = Vector((LENGTH_M + GIANT_BEHIND_M, 0, 0))
    nest_object.location = centre
    giants = {}
    for name, angles in (("still", sitting()), ("turned", sitting() | {"head_yaw": head_turned()})):
        giant = racer(angles)
        giant.location = centre - Vector((0, 0, GIANT_SCALE * seated.lo.z))
        giant.scale = (GIANT_SCALE,) * 3
        giants[name] = giant
    for y in LANES:
        racer(STAND).location = (0, y, 0)
    for obj in socks:
        obj.hide_render = True
    reach = min(LENGTH_M + SOCK_FIELD[1], centre.x - nest_object.dimensions.x / 2 - 0.05)
    for k in range(round(SOCKS_PER_M * 2 * EDGE_M)):
        loose = link(bpy.data.objects.new(f"loose_{k}", socks[k % len(socks)].data))
        x, y = rng.uniform(LENGTH_M + SOCK_FIELD[0], reach), rng.uniform(-EDGE_M, EDGE_M)
        loose.location = (x, y, 0)
        loose.rotation_euler = (0, 0, rng.uniform(0, tau))

    camera = link(bpy.data.objects.new("camera", bpy.data.cameras.new("camera")))
    scene.camera = camera
    wide = tan(radians(CHASE_FOV) / 2) * 16 / 9
    distance = max(1.0, (max(LANES) + PACK_MARGIN_M) / wide / CHASE_BACK_M)
    chase = Vector((-CHASE_BACK_M * distance, 0, CHASE_HEIGHT_M * distance))
    giant_middle = centre + Vector((0, 0, GIANT_SCALE * (seated.hi.z - seated.lo.z) / 2))
    views = {
        "chase": (chase, (0, 0, CHASE_TARGET_M), CHASE_FOV),
        "three-quarter": (centre + Vector((-2.6, -2.2, 1.3)), centre + Vector((0, 0, 0.4)), 38),
        "close": (centre + Vector((-1.45, -1.0, 0.7)), centre + Vector((-0.5, -0.3, 0.3)), 40),
        "turned": (centre + Vector((-3.3, -1.2, 0.85)), giant_middle, 32),
    }
    for name, (location, target, fov) in views.items():
        for pose, giant in giants.items():
            for part in [giant, *giant.children_recursive]:
                part.hide_render = (pose == "turned") != (name == "turned")
        aim(camera, location, target, fov)
        scene.render.filepath = str(out / f"{name}.png")
        bpy.ops.render.render(write_still=True)


def plane(colour, centre, size):
    """A flat rectangle on the floor, in one plain colour: the floor itself, or a line on it."""
    material = bpy.data.materials.new("plane")
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*colour, 1)
    w, d = size[0] / 2, size[1] / 2
    mesh = bpy.data.meshes.new("plane")
    mesh.from_pydata([(-w, -d, 0), (w, -d, 0), (w, d, 0), (-w, d, 0)], [], [(0, 1, 2, 3)])
    mesh.materials.append(material)
    link(bpy.data.objects.new("plane", mesh)).location = centre


def main():
    parser = argparse.ArgumentParser(prog="sock_heist_venue.py")
    parser.add_argument("out", type=Path)
    parser.add_argument("--render", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(0)
    standing, seated = racer_box(STAND), racer_box(sitting())
    material = venue_material()
    socks = [sock(k, material) for k in range(len(SOCKS))]
    nest_object = nest(seated, material, rng)
    args.out.mkdir(parents=True, exist_ok=True)
    export([nest_object], args.out / "sock-nest.glb")
    export(socks, args.out / "socks.glb")

    width, height, depth = standing.size
    print(f"racer at STAND: {width:.3f} x {height:.3f} x {depth:.3f} m")
    print("giant sitting:", {name: round(angle, 6) + 0.0 for name, angle in sitting().items()})
    width, height, depth = seated.size
    print(
        f"giant seated: {GIANT_SCALE * height:.3f} m tall, {GIANT_SCALE * width:.3f} x "
        f"{GIANT_SCALE * depth:.3f} m, trunk at {seated.trunk:.4f} m on a racer, "
        f"{GIANT_SCALE * seated.trunk:.3f} m on the giant, legs below "
        f"{GIANT_SCALE * (seated.legs - seated.lo.z):.3f} m"
    )
    lo, hi = Vector(nest_object.bound_box[0]), Vector(nest_object.bound_box[6])
    inside = GIANT_SCALE * seated.footprint * FOOTPRINT_MARGIN
    print(
        f"nest: {nest_object['socks']} socks in {nest_object['rows']} rows, "
        f"{triangles(nest_object)} triangles, inside radius {inside:.3f} m, rim "
        f"{rim_height(seated):.3f} m, x {lo.x:.3f}..{hi.x:.3f}, "
        f"y {lo.y:.3f}..{hi.y:.3f}, up {lo.z:.3f}..{hi.z:.3f} m"
    )
    for obj in socks:
        x, y, z = obj.dimensions
        print(f"{obj.name}: {triangles(obj)} triangles, {x:.3f} x {y:.3f} x {z:.3f} m")
    if args.render:
        args.render.mkdir(parents=True, exist_ok=True)
        render(args.render, seated, nest_object, socks, rng)


def triangles(obj: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


main()
