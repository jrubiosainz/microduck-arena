// Duck Jam's runway stadium, along both sides of the track: a cyan rail on
// paper posts at each edge, five Pollen-orange cones behind it, three tiers of
// bleachers, and in every seat the robot itself, instanced. Its proportions and
// colours are `stadium()` in Duck Jam's round-01 challenge, verbatim; only the
// track between the rails is the arena's own, at its own width.
//
// The one liberty is the near side. Duck Jam looked at this from a high seat
// 2.6 m to the side, over the top of it; the arena's chase camera stands low at
// the trackside, where Duck Jam's near rail and stand would be — and a rail
// between the lens and the racers hides their feet. So the near side's rail,
// cones and stand back off as one until they are behind the lens
// (attachStadium's `clearance`), and are seen when you orbit.
//
// Course frame throughout (see course.js): +x down the track, +y up, +z the
// camera's side of the track.

import {
  BoxGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OVERRUN } from "./course.js";
import { PALETTE, SHELLS, colour, flat } from "./palette.js";
import { applyFrame } from "./replay.js";
import { STAND, TRUNK_HEIGHT, attachMeshes, buildRigTree } from "./rig.js";

// Duck Jam's stadium, in metres. The lane there ran 0.45 m past each end and
// the stand 0.5; here the ground runs OVERRUN past each end, and the stand,
// posts and seats keep the same margins beyond it.
const TIERS = 3;
const SEATS_PER_TIER = 18;
const TIER_DEPTH = 0.28;
const TIER_HEIGHT = 0.1;
const TIER_RISE = 0.12;
// From the rail to the first tier's face, and from the rail to the cones.
export const GAP = 0.21;
const CONE_OUT = 0.17;
const RAIL_HEIGHT = 0.09;
const RAIL = [0.036, 0.05];
const POST = [0.036, 0.09];
const POSTS = 9;
const CONE = [0.09, 0.16];
const CONES = 5;

/** Each tier's centre distance from the track's axis and its full height, nearest first. */
function tiers(inner) {
  return Array.from({ length: TIERS }, (_, row) => ({
    out: inner + TIER_DEPTH * (row + 0.5),
    height: TIER_HEIGHT + TIER_RISE * row,
  }));
}

/** `n` points from `first` to `last`, the way Duck Jam spaced posts, seats and cones. */
const along = (n, first, last) =>
  Array.from({ length: n }, (_, i) => first + ((last - first) * i) / (n - 1));

export function buildStand(length, inner, side) {
  const stand = new Group();
  stand.name = "stand";
  const width = length + (OVERRUN + 0.1) * 2;
  for (const { out, height } of tiers(inner)) {
    const tier = new Mesh(new BoxGeometry(width, height, TIER_DEPTH), flat(PALETTE.stand));
    tier.position.set(length / 2, height / 2, side * out);
    stand.add(tier);
  }
  return stand;
}

/** Where each spectator stands on `side`: on top of a tier, turned to face the track. */
export function seats(length, inner, side) {
  const xs = along(SEATS_PER_TIER, -OVERRUN + 0.1, length + OVERRUN - 0.1);
  return tiers(inner).flatMap(({ out, height }) =>
    xs.map((x) => ({ x, y: height, z: side * out, yaw: (side * Math.PI) / 2 })),
  );
}

/** The cyan rail along one edge of the track, `edge` from its axis, on its nine paper posts. */
export function buildRail(length, edge, side) {
  const rail = new Group();
  rail.name = "rail";
  const z = side * edge;
  const bar = new Mesh(new BoxGeometry(length + OVERRUN * 2, RAIL[1], RAIL[0]), flat(PALETTE.rail));
  bar.position.set(length / 2, RAIL_HEIGHT, z);
  rail.add(bar);
  for (const x of along(POSTS, -OVERRUN + 0.1, length + OVERRUN - 0.1)) {
    const post = new Mesh(new BoxGeometry(POST[0], POST[1], POST[0]), flat(PALETTE.post));
    post.position.set(x, POST[1] / 2, z);
    rail.add(post);
  }
  return rail;
}

/** Five orange cones behind the rail `edge` from the track's axis. */
export function buildCones(length, edge, side) {
  const cones = new Group();
  cones.name = "cones";
  for (const x of along(CONES, -OVERRUN + 0.15, length + OVERRUN - 0.15)) {
    const cone = new Mesh(new BoxGeometry(CONE[0], CONE[1], CONE[0]), flat(PALETTE.cone));
    cone.position.set(x, CONE[1] / 2, side * (edge + CONE_OUT));
    cones.add(cone);
  }
  return cones;
}

// A spectator is the robot at four fifths, standing, turned to face the track.
// Duck Jam's fidget — a bounce and a sway, each seat at its own point in the
// cycle, a golden angle apart — but brisker and wider: its 7 rad/s over 3.6 cm
// read from Duck Jam's high seat over the near stand, and from the arena's low
// chase, with the crowd smaller and further off, did not read as moving.
const SCALE = 0.8;
const BOUNCE = 0.025;
const SWAY = 0.2;
const TEMPO = 12;
const PHASE_STEP = 2.39996;
const REST = Float32Array.from([0, 0, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND]);

// Which colour a part of the spectator is painted: Duck Jam's `paintOf`.
const PAINT = [
  [/jaw|mouth|face_part/, PALETTE.face],
  [/foot|sole/, PALETTE.feet],
  [/xl330|bearing|pcb|speaker|support|np_f970|lens|noenoeil/, PALETTE.dark],
];
const paintOf = (name, shell) =>
  /shell/.test(name) ? shell : (PAINT.find(([re]) => re.test(name))?.[1] ?? PALETTE.frame);

/**
 * The ducks in the seats, on whatever clock `pose` is given.
 *
 * One rig per shell colour, posed once and fused into a single geometry with
 * its parts' paint baked into the vertices, then drawn as one InstancedMesh
 * per side of the track: ten draws for the whole stadium. A side to itself,
 * with a sphere round its seats, so the near stand — behind the chase camera,
 * seen only when orbiting — is culled with the rest of what is out of frame
 * instead of costing its vertices every frame. What a spectator costs is
 * decided upstream — the crowd's lighter model (viewer.js) and the skin filter
 * (rig.js) — and the geometries handed in are the viewer's own, so nothing
 * downloads and none of them may be disposed of here.
 */
export function crowd(kinematics, geometries, placed) {
  const group = new Group();
  group.name = "crowd";
  const bodies = new Map(SHELLS.map((shell) => [shell, fused(kinematics, geometries, shell)]));
  const flocks = [];
  for (const side of [-1, 1]) {
    SHELLS.forEach((shell, s) => {
      const mine = placed
        .map((seat, i) => i)
        .filter((i) => i % SHELLS.length === s && Math.sign(placed[i].z) === side);
      if (!mine.length) return;
      const mesh = new InstancedMesh(
        bodies.get(shell),
        new MeshLambertMaterial({ vertexColors: true, toneMapped: false }),
        mine.length,
      );
      mesh.userData.shell = shell;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      group.add(mesh);
      flocks.push({ seats: mine, mesh });
    });
  }

  const seat = new Object3D();
  function pose(seconds) {
    for (const { seats: mine, mesh } of flocks) {
      mine.forEach((i, k) => {
        const phase = seconds * TEMPO + i * PHASE_STEP;
        const { x, y, z, yaw } = placed[i];
        seat.position.set(x, y + BOUNCE * (1 + Math.sin(phase)), z);
        seat.rotation.set(0, yaw + SWAY * Math.sin(phase * 0.7), 0);
        seat.scale.setScalar(SCALE);
        seat.updateMatrix();
        mesh.setMatrixAt(k, seat.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  pose(0);
  // The bounds three culls by, once: a seat's fidget stays within the margin.
  for (const { mesh } of flocks) {
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += BOUNCE * 2 + 0.1;
  }

  return {
    group,
    pose,
    dispose() {
      for (const geometry of bodies.values()) geometry.dispose();
      for (const { mesh } of flocks) {
        mesh.material.dispose();
        mesh.dispose();
      }
    },
  };
}

/** One shell colour's rig at rest, as a single painted geometry in the placer's frame. */
function fused(kinematics, geometries, shell) {
  const rig = buildRigTree(kinematics);
  attachMeshes(rig, kinematics, geometries, { skin: true });
  applyFrame(rig, REST);
  rig.placer.updateMatrixWorld(true);
  const parts = [];
  rig.placer.traverse((node) => {
    if (!node.isMesh) return;
    const part = node.geometry.clone().applyMatrix4(node.matrixWorld);
    const { r, g, b } = colour(paintOf(node.name, shell));
    const count = part.attributes.position.count;
    const paint = new Float32Array(count * 3);
    for (let v = 0; v < count; v += 1) paint.set([r, g, b], v * 3);
    part.setAttribute("color", new BufferAttribute(paint, 3));
    node.material.dispose();
    parts.push(part);
  });
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

/**
 * Hang the stadium on a built course, sized from the ground the course actually
 * drew — so a wider arena pushes it out, and a slope tilts it, without a second
 * copy of either sum. `clearance` is how far out on +z, the camera's side, the
 * near stand may start; its rail and cones keep their places in front of it.
 * Duck Jam's own distance is kept wherever it already clears. Returns the
 * crowd, for the render loop to pose and the next re-race to dispose.
 */
export function attachStadium(course, { kinematics, geometries }, clearance) {
  const { width, height: span } = course.getObjectByName("ground").geometry.parameters;
  const length = width - OVERRUN * 2;
  const edge = { [-1]: span / 2, [1]: Math.max(span / 2, clearance - GAP) };
  const placed = [];
  for (const side of [-1, 1]) {
    course.add(buildRail(length, edge[side], side), buildCones(length, edge[side], side));
    course.add(buildStand(length, edge[side] + GAP, side));
    placed.push(...seats(length, edge[side] + GAP, side));
  }
  const audience = crowd(kinematics, geometries, placed);
  course.add(audience.group);
  return audience;
}
