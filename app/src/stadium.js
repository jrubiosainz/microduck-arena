// The runway stadium, along both sides of the track: a cyan rail on
// paper posts at each edge, five Pollen-orange cones behind it, six tiers of
// bleachers, and in every seat the robot itself, instanced. The track between
// the rails is the arena's own, at its own width.
//
// The near side is laid for a viewer on a high seat 2.6 m to the side, looking
// over the top of it; the arena's chase camera stands low at the trackside,
// where that near rail and stand would be — and a rail between the lens and
// the racers hides their feet. So the near side's rail, cones and stand back
// off as one until they are behind the lens (attachStadium's `clearance`), and
// are seen when you orbit.
//
// Course frame throughout (see course.js): +x down the track, +y up, +z the
// camera's side of the track.

import {
  BoxGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Sphere,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OVERRUN } from "./course.js";
import { PALETTE, SHELLS, colour, flat } from "./palette.js";
import { crowdStanding } from "./crowd-behaviour.js";
import { crowdBubbles } from "./crowd-bubbles.js";
import { applyFrame } from "./replay.js";
import { STAND, TRUNK_HEIGHT, attachMeshes, buildRigTree } from "./rig.js";

// The stadium, in metres. The ground runs OVERRUN past each end of the lane,
// and the stand, posts, seats and cones are laid against the ground's ends.
const TIERS = 6;
const SEATS_PER_TIER = 18;
const TIER_DEPTH = 0.28;
const TIER_HEIGHT = 0.1;
const TIER_RISE = 0.12;
// From the rail to the first tier's face, and from the rail to the cones.
export const GAP = 0.21;
// Room for the judging desk and chairs in front of the raised far stand.
export const JURY_APRON = 0.9;
const JURY_STAND_LIFT = 0.30;
const CONE_OUT = 0.17;
const RAIL_HEIGHT = 0.09;
const RAIL = [0.036, 0.05];
const POST = [0.036, 0.09];
const POSTS = 9;
const CONE = [0.09, 0.16];
const CONES = 5;

/** Each tier's centre distance from the track's axis and its full height, nearest first. */
function tiers(inner, side) {
  return Array.from({ length: TIERS }, (_, row) => ({
    out: inner + TIER_DEPTH * (row + 0.5),
    height: TIER_HEIGHT + (side === -1 ? JURY_STAND_LIFT : 0) + TIER_RISE * row,
  }));
}

/** `n` points from `first` to `last`, evenly, as posts, seats and cones are spaced. */
const along = (n, first, last) =>
  Array.from({ length: n }, (_, i) => first + ((last - first) * i) / (n - 1));

export function buildStand(length, inner, side) {
  const stand = new Group();
  stand.name = "stand";
  const width = length + (OVERRUN + 0.1) * 2;
  const wood = flat(0xc99960);
  const steel = flat(0x244950);
  const trim = flat(0xf6be55);
  const structure = new Map([[wood, []], [steel, []], [trim, []]]);
  function detail(w, h, d, x, y, z, material) {
    const geometry = new BoxGeometry(w, h, d);
    geometry.translate(x, y, side * z);
    structure.get(material).push(geometry);
  }
  const rows = tiers(inner, side);
  // Thin timber decks on an open steel frame, rather than solid concrete blocks.
  for (const { out, height } of rows) {
    const tier = new Mesh(new BoxGeometry(width, 0.035, TIER_DEPTH), wood);
    tier.name = "tier";
    tier.position.set(length / 2, height - 0.0175, side * out);
    stand.add(tier);
    detail(width, 0.014, 0.018, length / 2, height - 0.007, out - TIER_DEPTH / 2, trim);
    detail(width, 0.045, 0.035, length / 2, height - 0.06, out - 0.08, steel);
    for (const x of along(4, length / 2 - width / 2 + 0.06, length / 2 + width / 2 - 0.06)) {
      detail(0.035, height - 0.035, 0.06, x, (height - 0.035) / 2, out, steel);
    }
    // Separate planks make the timber surfaces readable between spectators.
    detail(width, 0.002, 0.006, length / 2, height + 0.001, out, steel);
  }
  const back = rows.at(-1);
  for (const x of along(7, length / 2 - width / 2, length / 2 + width / 2)) {
    detail(0.018, 0.24, 0.018, x, back.height + 0.12, back.out + 0.13, steel);
  }
  detail(width, 0.024, 0.024, length / 2, back.height + 0.24, back.out + 0.13, trim);
  // Small access steps at both ends of the front platform.
  const steps = Math.round(rows[0].height / 0.1);
  for (const x of [length / 2 - width / 2 + 0.11, length / 2 + width / 2 - 0.11]) {
    for (let step = 1; step < steps; step++) {
      const h = rows[0].height * step / steps;
      detail(0.20, h, 0.1, x, h / 2, inner - (steps - step) * 0.1 + 0.05, wood);
      detail(0.20, 0.012, 0.014, x, h, inner - (steps - step) * 0.1, trim);
    }
  }
  for (const [material, parts] of structure) {
    if (parts.length) stand.add(new Mesh(mergeGeometries(parts), material));
    parts.forEach((part) => part.dispose());
  }
  return stand;
}

/** Where each spectator stands on `side`: on top of a tier, turned to face the track. */
export function seats(length, inner, side) {
  const xs = along(SEATS_PER_TIER, -OVERRUN + 0.1, length + OVERRUN - 0.1);
  return tiers(inner, side).flatMap(({ out, height }) =>
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

// Full-scale spectators sit between waves; the shared clock controls standing.
// A small sway keeps resting spectators alive without bouncing them off seats.
const SWAY = 0.05;
// A sphere this wide, this far above its seat, holds a whole spectator, standing
// and cheering: what `cull` tests against a camera's frustum.
const SEAT_REACH = 0.3;
const SEAT_LIFT = 0.1;
const TEMPO = 12;
const PHASE_STEP = 2.39996;
const REST = Float32Array.from([0, 0, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND]);
const sitting = [...STAND];
sitting[2] = -1.3; sitting[3] = 1.5; sitting[4] = -0.2;
sitting[11] = 1.3; sitting[12] = -1.5; sitting[13] = 0.2;
const SIT = Float32Array.from([0, 0, 0.055, 1, 0, 0, 0, ...sitting]);

// Which colour a part of the spectator is painted.
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
 * with a sphere round its seats, so a stand wholly out of frame is culled.
 * That sphere is metres wide, though, and holds the chase camera: the near
 * stand behind the lens, the stage's audience while the camera faces the
 * stage, would still cost their vertices on every render — so `cull` keeps,
 * for the camera about to render, only the seats it can see, and `restore`
 * gives every seat back (the viewer calls both around each render). What a
 * spectator costs is decided upstream — the crowd's lighter model (viewer.js)
 * and the skin filter (rig.js) — and the geometries handed in are the
 * viewer's own, so nothing downloads and none of them may be disposed of here.
 */
export function crowd(kinematics, geometries, placed) {
  const group = new Group();
  group.name = "crowd";
  const bodies = new Map(SHELLS.map((shell) => [shell, fused(kinematics, geometries, shell)]));
  const minX = Math.min(...placed.map(s => s.x)), maxX = Math.max(...placed.map(s => s.x));
  const positions = placed.map(s => (s.x - minX) / Math.max(.01, maxX - minX));
  const bubbles = crowdBubbles(placed);
  const morph = { morphTargetInfluences: [0] };
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
  function pose(seconds, mood) {
    const amounts = crowdStanding(seconds, positions, mood);
    bubbles.pose(seconds, amounts);
    for (const { seats: mine, mesh } of flocks) {
      mine.forEach((i, k) => {
        const phase = seconds * TEMPO + i * PHASE_STEP;
        const cheerPhase = seconds * TEMPO * 2.2 + i * PHASE_STEP;
        const { x, y, z, yaw } = placed[i];
        const standing = amounts[i];
        morph.morphTargetInfluences[0] = standing;
        mesh.setMorphAt(k, morph);
        const bounce = (1 - standing) * .003 * (1 + Math.sin(phase))
          + standing * (.01 + .018 * (1 + Math.sin(cheerPhase)));
        const sway = (1 - standing) * SWAY * Math.sin(phase * .7)
          + standing * .18 * Math.sin(cheerPhase * .7);
        seat.position.set(x, y + bounce, z);
        seat.rotation.set(standing * .06 * Math.sin(cheerPhase * .8), yaw + sway, 0);
        seat.updateMatrix();
        mesh.setMatrixAt(k, seat.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.morphTexture.needsUpdate = true;
    }
  }
  pose(0);
  // The bounds three culls by, once: a seat's fidget stays within the margin.
  for (const { mesh } of flocks) {
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 0.15;
  }

  // Measured on clip frames under SwiftShader, the Space's renderer: a sixth
  // (sprint) to two fifths (roller hall, whose screen feeds render the crowd
  // too) of a frame's CPU, the frames byte for byte the same.
  const frustum = new Frustum();
  const seen = new Matrix4();
  const at = new Matrix4();
  const reach = new Sphere(new Vector3(), SEAT_REACH);
  const kept = flocks.map(({ mesh }) => ({
    count: mesh.count,
    matrices: mesh.instanceMatrix.array.slice(),
    morphs: mesh.morphTexture.image.data.slice(),
  }));
  let culled = false;
  /** Each flock packs the seats `camera` can see at its front and draws only those. */
  function cull(camera) {
    seen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(seen);
    flocks.forEach(({ mesh }, f) => {
      const matrices = mesh.instanceMatrix.array;
      const morphs = mesh.morphTexture.image.data;
      const row = (morphs.length * 16) / matrices.length;
      kept[f].matrices.set(matrices);
      kept[f].morphs.set(morphs);
      let shown = 0;
      for (let k = 0; k < mesh.count; k += 1) {
        at.fromArray(matrices, k * 16).premultiply(mesh.matrixWorld);
        reach.center.setFromMatrixPosition(at).y += SEAT_LIFT;
        if (!frustum.intersectsSphere(reach)) continue;
        matrices.copyWithin(shown * 16, k * 16, k * 16 + 16);
        morphs.copyWithin(shown * row, k * row, (k + 1) * row);
        shown += 1;
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.morphTexture.needsUpdate = true;
    });
    culled = true;
  }
  /** Every seat back where `pose` left it. */
  function restore() {
    if (!culled) return;
    flocks.forEach(({ mesh }, f) => {
      mesh.count = kept[f].count;
      mesh.instanceMatrix.array.set(kept[f].matrices);
      mesh.morphTexture.image.data.set(kept[f].morphs);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.morphTexture.needsUpdate = true;
    });
    culled = false;
  }

  return {
    group,
    bubbles: bubbles.group,
    pose,
    cull,
    restore,
    dispose() {
      bubbles.dispose();
      for (const geometry of bodies.values()) geometry.dispose();
      for (const { mesh } of flocks) {
        mesh.material.dispose();
        mesh.dispose();
      }
    },
  };
}

/** One shell colour's rig at rest, as a single painted geometry in the placer's frame. */
function fused(kinematics, geometries, shell, frame = SIT) {
  const rig = buildRigTree(kinematics);
  attachMeshes(rig, kinematics, geometries, { skin: true });
  applyFrame(rig, frame);
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
  if (frame === SIT) {
    const standing = fused(kinematics, geometries, shell, REST);
    geometry.morphAttributes.position = [standing.attributes.position.clone()];
    geometry.morphAttributes.normal = [standing.attributes.normal.clone()];
    standing.dispose();
  }
  return geometry;
}

/**
 * Hang the stadium on a built course, sized from the ground the course actually
 * drew — so a wider arena pushes it out, without a second
 * copy of either sum. `clearance` is how far out on +z, the camera's side, the
 * near stand may start; its rail and cones keep their places in front of it.
 * The stadium's own distance is kept wherever it already clears. A `roped`
 * course (a tug's ring) is its own barrier: no rail, no cones. Returns the
 * crowd, for the render loop to pose and the next re-race to dispose.
 */
export function attachStadium(course, { kinematics, geometries }, clearance, roped = false) {
  const { width, height: span } = course.getObjectByName("ground").geometry.parameters;
  const length = width - OVERRUN * 2;
  const edge = { [-1]: span / 2, [1]: Math.max(span / 2, clearance - GAP) };
  const stadium = new Group();
  stadium.name = "stadium";
  // The room stays level; only the competition surface follows the slope.
  stadium.quaternion.copy(course.quaternion).invert();
  course.add(stadium);
  const placed = [];
  for (const side of [-1, 1]) {
    if (!roped) stadium.add(buildRail(length, edge[side], side), buildCones(length, edge[side], side));
    const inner = edge[side] + (side === -1 ? JURY_APRON : GAP);
    stadium.add(buildStand(length, inner, side));
    placed.push(...seats(length, inner, side));
  }
  const audience = crowd(kinematics, geometries, placed);
  stadium.add(audience.group, audience.bubbles);
  return {
    group: stadium,
    pose: audience.pose,
    crowd: audience,
    dispose() {
      audience.dispose();
      const materials = new Set();
      stadium.traverse((node) => {
        if (!node.isMesh || node.isInstancedMesh) return;
        node.geometry.dispose();
        materials.add(node.material);
      });
      materials.forEach((material) => material.dispose());
      stadium.removeFromParent();
    },
  };
}
