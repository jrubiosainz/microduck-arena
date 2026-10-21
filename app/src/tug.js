// The tug of war's arithmetic, as the server's (arena/tug.py): where a string is tied, which end
// of it a rated entry holds, and the lanes the viewer plays; and the tug drawn: its course and the
// string.
// Frames are MJCF (z up); `toThree` carries a point to the scene.

import {
  BoxGeometry, CanvasTexture, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, Path, PlaneGeometry, SRGBColorSpace,
  Shape, ShapeGeometry, Vector2, Vector3,
} from "three";
import { OVERRUN } from "./course.js";
import { PALETTE, flat } from "./palette.js";
import { frameCount, leadIn } from "./replay.js";

/** An MJCF point (x, y, z up) in the three.js scene (y up). */
export const toThree = ([x, y, z]) => [x, z, -y];

/** Where a duck's string is tied: `offset` in the trunk's frame, turned by the trunk's
 * quaternion (frame[3:7] = w, x, y, z) and carried to its position. */
export function stringEnd(frame, offset) {
  const [w, ux, uy, uz] = [frame[3], frame[4], frame[5], frame[6]];
  const [vx, vy, vz] = offset;
  const t = [2 * (uy * vz - uz * vy), 2 * (uz * vx - ux * vz), 2 * (ux * vy - uy * vx)];
  return [
    frame[0] + vx + w * t[0] + (uy * t[2] - uz * t[1]),
    frame[1] + vy + w * t[1] + (uz * t[0] - ux * t[2]),
    frame[2] + vz + w * t[2] + (ux * t[1] - uy * t[0]),
  ];
}

/** The two ends of the string, by `entrySide`'s index (arena/tug.py's SIDES). */
export const SIDES = ["west", "east"];

/** Which end of the string, 0 west and 1 east, the entry holds on a bout's seed: west on an odd one. */
export const entrySide = (seed) => 1 - (seed % 2);

/** The other duck of every bout. */
const REFERENCE = { livery: "charcoal", name: "Reference" };

/** How an entry's bout ended, in its own words (arena/tug.py's seed statuses). */
export const BOUT_WORDS = { won: "won the pull", lost: "lost the pull", draw: "draw", pit_won: "pulled it in", pit_lost: "dragged in" };

/**
 * A rated run's bout as a lane of the viewer, from its two traces (west first) and, for a clip, their
 * settles: the entry, `lane`'s livery and name, on its end of the string, the reference duck on the
 * other, in `classic` when the entry wears the reference's `charcoal`.
 */
export function ratingLane(traces, settles, { traceSeed, livery, name }) {
  const side = entrySide(traceSeed);
  const duck = (k, who) => ({ trace: traces[k], ...(settles && { settle: settles[k] }), ...who });
  const ducks = [];
  ducks[side] = duck(side, { livery, name });
  ducks[1 - side] = duck(1 - side, { ...REFERENCE, livery: livery === REFERENCE.livery ? "classic" : REFERENCE.livery });
  return { tug: "bout", ducks };
}

/** The lanes of an entry for `viewer.setLanes`: a bout's two ducks (west first), each settle led in;
 * none for a run stopped before its first timed step and handed over without its settle, which has no frame to draw. */
export function tugDucks(entry) {
  const ducks = entry.ducks;
  const lead = Math.max(...ducks.map((duck) => (duck.settle ? frameCount(duck.settle) : 0)));
  if (!lead && !frameCount(ducks[0].trace)) return [];
  return ducks.map(({ trace, settle, livery, name }) => ({
    trace: leadIn(settle ?? new Float32Array(0), trace, lead),
    lead,
    livery,
    name,
  }));
}

/** The floor under a point `x` along the lane: the pit's, deep, over the pit; the platforms' either side. */
export const floorUnder = ({ pit_m, pit_depth_m }, x) => (Math.abs(x) < pit_m / 2 ? -pit_depth_m : 0);

/** Both string ends, MJCF, of one frame per duck. */
export const tugEnds = (event, frames) => frames.map((frame) => stringEnd(frame, event.string_offset));

// The marker's red: the site's recording dot (club.css).
const RED = 0xff3b30;

const corners = (x0, y0, x1, y1) => [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];

// The ring, at a duck's scale (a wrestler's ring, 1.2 m tall for 1.8 m wrestlers, at a 25 cm duck's):
// its canvas is the floor the ducks stand on, the hall's floor RING_RISE under it (the viewer lowers
// the hall, its stands and its jury by that much); its apron runs APRON past the ropes.
export const RING_RISE = 0.14;
const APRON = 0.06;
const POST_RADIUS = 0.016;
// The ropes, bottom to top, the top one as high as the walls: VHS cyan, paper, VHS magenta.
const ROPES = [PALETTE.rail, PALETTE.paper, PALETTE.magenta];
const ROPE_RADIUS = 0.005;
// How many times its top rope's height a camera's sight line to the lane must cross a long side at,
// for that side's ropes to show whole (openRing).
const ROPES_CLEAR = 1.5;

/** The skirt's print, `length` by `height` metres: the Arena's name and the event's in Anton, beak
 * yellow and Pollen orange on ink, a yellow trim along the apron's edge. */
function skirtPrint(length, height) {
  const canvas = document.createElement("canvas");
  canvas.height = 128;
  canvas.width = Math.round((canvas.height * length) / height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101018";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(0, 0, canvas.width, 12);
  ctx.font = '400 42px "Anton"';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = ["MICRODUCK ARENA", "TUG OF WAR"];
  const panels = 2 * Math.round(length / 1.2);
  for (let i = 0; i < panels; i += 1) {
    ctx.fillStyle = i % 2 ? "#ff7a2f" : "#ffd23f";
    ctx.fillText(words[i % 2], ((i + 0.5) * canvas.width) / panels, 70);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

/**
 * The tug's course, centred on its pit, in course.js's axes: a wrestling ring round the lane. Its
 * canvas, at the floor the ducks stand on, is cut open over the pit, between the walls; its body
 * runs down to the pit's floor, the `ground` a stadium is laid round, with a line across it under
 * the string's middle at the start. The served walls are drawn as the ring's ropes, three on each
 * side at their places, the top one at their height, tied to a padded post at each of their ends
 * and run across the lane's ends too; a printed skirt on the long sides and steps at a corner.
 */
export function buildTugCourse({ length_m, width_m, pit_m, pit_depth_m, walls }) {
  const course = new Group();
  course.name = "course";
  const add = (name, geometry, material, position) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    course.add(mesh);
    return mesh;
  };
  const ink = flat(PALETTE.ink);
  // Where the ropes run (the walls' middles), the top rope's height and the walls' ends; the ring's
  // half length and half width, apron included.
  const [{ pos, half }] = walls;
  const ropeZ = Math.abs(pos[1]);
  const top = half[2] * 2;
  const ends = half[0];
  const [x, z] = [ends + APRON, ropeZ + half[1] + APRON];

  const outline = new Shape(corners(-x, -z, x, z));
  outline.holes.push(new Path(corners(-pit_m / 2, -width_m / 2, pit_m / 2, width_m / 2)));
  const body = new ExtrudeGeometry(outline, { depth: pit_depth_m, bevelEnabled: false });
  body.rotateX(-Math.PI / 2).translate(0, -pit_depth_m, 0);
  add("ring", body, [flat(PALETTE.canvas), ink], [0, 0, 0]);
  const ground = add("ground", new PlaneGeometry(length_m + OVERRUN * 2, width_m), ink, [0, -pit_depth_m, 0]);
  ground.rotation.x = -Math.PI / 2;
  add("centre_line", new BoxGeometry(0.02, 0.002, width_m), flat(PALETTE.paper), [0, 0.001 - pit_depth_m, 0]);

  const skirt = new MeshBasicMaterial({ map: skirtPrint(x * 2, RING_RISE) });
  for (const side of [-1, 1]) {
    add("skirt", new PlaneGeometry(x * 2, RING_RISE), skirt, [0, -RING_RISE / 2, side * (z + 0.001)]).rotation.y = side > 0 ? 0 : Math.PI;
  }

  const height = (i) => (top * (i + 1)) / ROPES.length;
  const cord = (length) => new CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, length, 8);
  ROPES.forEach((paint, i) => {
    const across = flat(paint);
    for (const side of [-1, 1]) add("rope", cord(ropeZ * 2), across, [side * ends, height(i), 0]).rotation.x = Math.PI / 2;
  });
  // Each long side's ropes on their own, in their own paint: openRing fades them.
  for (const side of [-1, 1]) {
    const ropes = new Group();
    ropes.name = "ropes";
    ropes.position.z = side * ropeZ;
    ropes.userData.top = top;
    ROPES.forEach((paint, i) => {
      const along = new Mesh(cord(ends * 2), Object.assign(flat(paint), { transparent: true }));
      along.position.y = height(i);
      along.rotation.z = Math.PI / 2;
      ropes.add(along);
    });
    course.add(ropes);
  }
  const pad = flat(PALETTE.cone);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add("post", new CylinderGeometry(POST_RADIUS, POST_RADIUS, top + 0.04, 12), ink, [sx * ends, (top + 0.04) / 2, sz * ropeZ]);
      // The turnbuckles' pad, on the post's side facing the ring's middle.
      const cover = add("pad", new BoxGeometry(0.03, top + 0.01, 0.03), pad, [sx * (ends - 0.012), (top + 0.01) / 2 + 0.008, sz * (ropeZ - 0.012)]);
      cover.rotation.y = Math.PI / 4;
    }
  }
  // Three steel steps up to the apron, at the near east corner.
  const steel = flat(PALETTE.stand);
  for (let step = 1; step <= 3; step += 1) {
    const h = (RING_RISE * step) / 3;
    add("step", new BoxGeometry(0.06, h, 0.18), steel, [x + 0.03 + (3 - step) * 0.06, h / 2 - RING_RISE, z - 0.12]);
  }
  return course;
}

/**
 * The ring filmed from ringside, as a studio leaves out the wall its camera looks through: a long
 * side's ropes fade as a camera beyond them comes down low enough for them to cross the ducks. They
 * are whole while its sight line to the lane crosses that side ROPES_CLEAR times as high as the top
 * rope, and gone once it crosses at the top rope's height.
 */
export function openRing(course, camera) {
  const { y, z } = camera.position;
  for (const ropes of course.children) {
    if (ropes.name !== "ropes") continue;
    const side = ropes.position.z;
    const crossing = z * Math.sign(side) > Math.abs(side) ? (y * Math.abs(side)) / Math.abs(z) / ropes.userData.top : Infinity;
    const opacity = Math.min(1, Math.max(0, (crossing - 1) / (ROPES_CLEAR - 1)));
    ropes.visible = opacity > 0;
    for (const along of ropes.children) along.material.opacity = opacity;
  }
}

/**
 * The hall's floor (gym.js's "parquet", a plane laid flat) cut open over the pit, so that the pit is
 * a hole in it rather than under it. Its boards stay where they were: the plane's own texture
 * coordinates are kept, which the floor's texture is repeated for.
 */
export function cutPit(floor, { pit_m, width_m }) {
  floor.updateWorldMatrix(true, false);
  const [a, b] = [-1, 1].map((side) => floor.worldToLocal(new Vector3((side * pit_m) / 2, 0, (side * width_m) / 2)));
  const { width, height } = floor.geometry.parameters;
  const shape = new Shape(corners(-width / 2, -height / 2, width / 2, height / 2));
  shape.holes.push(new Path(corners(a.x, a.y, b.x, b.y)));
  const geometry = new ShapeGeometry(shape);
  const { position, uv } = geometry.attributes;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, position.getX(i) / width + 0.5, position.getY(i) / height + 0.5);
  floor.geometry.dispose();
  floor.geometry = geometry;
}

const UP = new Vector3(0, 1, 0);

/** The string, a 4 mm rope in ink (it reads against the ring's canvas and the stands behind it), with a red
 * ribbon hanging at its middle; `update` ties it to two MJCF ends. */
export function buildString() {
  const group = new Group();
  const rope = new Mesh(new CylinderGeometry(0.002, 0.002, 1, 6), flat(PALETTE.ink));
  rope.name = "string";
  const ribbon = new BoxGeometry(0.012, 0.05, 0.003);
  ribbon.translate(0, -0.025, 0);
  const marker = new Mesh(ribbon, flat(RED));
  marker.name = "marker";
  group.add(rope, marker);
  const from = new Vector3();
  const along = new Vector3();
  return {
    group,
    update(a, b) {
      from.set(...toThree(a));
      along.set(...toThree(b)).sub(from);
      rope.scale.y = along.length();
      rope.position.copy(from).addScaledVector(along, 0.5);
      rope.quaternion.setFromUnitVectors(UP, along.normalize());
      marker.position.copy(rope.position);
    },
  };
}

/** Frees a tug's course once it is off the scene, with the string on it: every geometry, material and
 * the skirt's print. */
export function disposeTugCourse(course) {
  course.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of [node.material].flat()) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

// How far past a duck's trunk the picture keeps room for the rest of it, lying back included.
const DUCK_REACH = 0.15;
// How much of the frame's width a tug's span may fill.
const FILL = 0.9;

/** What a tug's camera holds along the lane at one frame, MJCF x from west to east: from the west duck
 * to the east one, room kept round each. */
export function tugSpan(frames) {
  const xs = frames.map((frame) => frame[0]);
  return [Math.min(...xs) - DUCK_REACH, Math.max(...xs) + DUCK_REACH];
}

/**
 * How far from what it looks at a camera stands for `span` metres along the lane, centred there, to
 * fill at most FILL of a frame `aspect` wide whose vertical field is `fov` degrees, seen from `toward`
 * (the unit vector from what it looks at to the camera). Looked at from behind, the span's nearer end
 * is the one at the frame's edge.
 */
export function tugDistance(span, aspect, fov, [x, , z]) {
  const across = FILL * Math.tan((fov * Math.PI) / 360) * aspect;
  return (span / 2) * (z / Math.hypot(x, z) / across + Math.abs(x));
}

/** A chase `pose` moved out or in along its own direction until `span` metres fit its frame (tugDistance). */
export function tugPose({ position, target }, span, aspect, fov) {
  const away = new Vector3(...position).sub(new Vector3(...target)).normalize();
  const distance = tugDistance(span, aspect, fov, away.toArray());
  return { position: away.multiplyScalar(distance).add(new Vector3(...target)).toArray(), target };
}
