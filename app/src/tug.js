// The tug of war's arithmetic, as the server's (arena/tug.py): where a string is tied, where
// the marker stands, how hard the bench's winch pulls, and the lanes the viewer plays; and the tug
// drawn: its course, the string and the winch.
// Frames are MJCF (z up); `toThree` carries a point to the scene.

import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Path, PlaneGeometry, Shape,
  ShapeGeometry, SRGBColorSpace, Vector2, Vector3,
} from "three";
import { OVERRUN, TRACK } from "./course.js";
import { PALETTE, flat } from "./palette.js";
import { CTRL_DT, frameCount, leadIn } from "./replay.js";

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

/** The marker's x: the middle of the two string ends. */
export const markerX = (westFrame, eastFrame, offset) =>
  (stringEnd(westFrame, offset)[0] + stringEnd(eastFrame, offset)[0]) / 2;

/** The winch's pull in newtons `t` seconds into the timed run, never below 0, never above the top. */
export function benchForce({ ramp_n_per_s: ramp, top_n: top, jerks }, t) {
  const pull = ramp * t + jerks.reduce((sum, [amp, hz, phase]) => sum + amp * Math.sin(2 * Math.PI * hz * t + phase), 0);
  return Math.min(top, Math.max(0, pull));
}

/** The dial at a lane's frame `index`: nothing during the `lead` frames of settle, then the winch from the clock's start. */
export const forceAt = (profile, index, lead) =>
  index < lead ? 0 : benchForce(profile, (index - lead) * CTRL_DT);

/** The lanes of an entry for `viewer.setLanes`: a bench's one duck, a bout's two (west first), each settle led in. */
export function tugDucks(entry) {
  const ducks = entry.tug === "bench" ? [entry] : entry.ducks;
  const lead = Math.max(...ducks.map((duck) => (duck.settle ? frameCount(duck.settle) : 0)));
  return ducks.map(({ trace, settle, livery, name }) => ({
    trace: leadIn(settle ?? new Float32Array(0), trace, lead),
    lead,
    livery,
    name,
  }));
}

/** The floor under a point `x` along the lane: the pit's, deep, over the pit; the platforms' either side. */
export const floorUnder = ({ pit_m, pit_depth_m }, x) => (Math.abs(x) < pit_m / 2 ? -pit_depth_m : 0);

/** Both string ends, MJCF, of one frame per duck: the second is the duck's, or the winch on the bench. */
export const tugEnds = (event, frames) => [
  stringEnd(frames[0], event.string_offset),
  frames[1] ? stringEnd(frames[1], event.string_offset) : event.winch,
];

// The marker's red, and the needle's: the site's recording dot (club.css).
const RED = 0xff3b30;

/**
 * The tug's course, centred on its pit, in course.js's axes: a platform either side of the pit, the
 * lane between the walls, its top the floor the ducks stand on, running OVERRUN past the walls'
 * ends; the pit's sides under the walls; the pit's floor, the `ground` a stadium is laid round; a
 * line across it under the string's middle at the start; and the served walls, see-through.
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
  const track = flat(TRACK);
  const platform = length_m / 2 + OVERRUN - pit_m / 2;
  for (const [name, side] of [["platform_west", -1], ["platform_east", 1]]) {
    add(name, new BoxGeometry(platform, pit_depth_m, width_m), track, [side * (pit_m + platform) / 2, -pit_depth_m / 2, 0]);
  }
  const glass = Object.assign(flat(PALETTE.paper), { transparent: true, opacity: 0.25, depthWrite: false });
  for (const { name, pos, half } of walls) {
    add(name, new BoxGeometry(half[0] * 2, half[2] * 2, half[1] * 2), glass, toThree(pos));
    add("pit_side", new BoxGeometry(pit_m, pit_depth_m, half[1] * 2), track, [0, -pit_depth_m / 2, -pos[1]]);
  }
  const ground = add("ground", new PlaneGeometry(length_m + OVERRUN * 2, width_m), flat(PALETTE.ink), [0, -pit_depth_m, 0]);
  ground.rotation.x = -Math.PI / 2;
  add("centre_line", new BoxGeometry(0.02, 0.002, width_m), flat(PALETTE.paper), [0, 0.001 - pit_depth_m, 0]);
  return course;
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
  const corners = (x0, y0, x1, y1) => [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];
  const shape = new Shape(corners(-width / 2, -height / 2, width / 2, height / 2));
  shape.holes.push(new Path(corners(a.x, a.y, b.x, b.y)));
  const geometry = new ShapeGeometry(shape);
  const { position, uv } = geometry.attributes;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, position.getX(i) / width + 0.5, position.getY(i) / height + 0.5);
  floor.geometry.dispose();
  floor.geometry = geometry;
}

const UP = new Vector3(0, 1, 0);

/** The string, 2 mm thick, with a red ribbon hanging at its middle; `update` ties it to two MJCF ends. */
export function buildString() {
  const group = new Group();
  const rope = new Mesh(new CylinderGeometry(0.001, 0.001, 1, 6), flat(PALETTE.paper));
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

const DRUM = 0.03; // the drum's radius: the string leaves it at its top, the winch's point
const DIAL = 0.08; // the dial's radius
const RIM = DIAL + 0.006; // its steel rim's
const CENTRE = new Vector3(0.06, 0.17, 0); // the dial's centre from the winch's point, three.js axes
const SWEEP = (3 * Math.PI) / 4; // the needle's travel, from nothing to the winch's top
const DIAL_PX = 256;

/**
 * The bench's winch at its point (the event's `winch`, MJCF), standing on the platform: an orange
 * drum across the lane on two cheeks, and over it a dial facing the camera's side, whose needle and
 * reading `setForce` sets to the winch's pull.
 */
export function buildWinch({ winch, bench: { top_n } }) {
  const group = new Group();
  group.name = "winch";
  group.position.set(...toThree(winch));
  const floor = -winch[2];
  const add = (geometry, material, x, y, z) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const steel = flat(PALETTE.stand);
  add(new CylinderGeometry(DRUM, DRUM, 0.1, 24), flat(PALETTE.cone), 0, -DRUM, 0).rotation.x = Math.PI / 2;
  const cheek = 0.02 - DRUM - floor;
  for (const z of [-0.056, 0.056]) add(new BoxGeometry(0.09, cheek, 0.012), steel, 0, floor + cheek / 2, z);
  add(new BoxGeometry(0.2, 0.012, 0.14), steel, 0.04, floor + 0.006, 0);
  const centre = CENTRE;
  add(new BoxGeometry(0.014, centre.y - floor, 0.014), steel, centre.x, (centre.y + floor) / 2, -0.012);
  add(new CylinderGeometry(RIM, RIM, 0.01, 40), steel, centre.x, centre.y, 0).rotation.x = Math.PI / 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = DIAL_PX;
  const ctx = canvas.getContext("2d");
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const face = new MeshBasicMaterial({ map, transparent: true, toneMapped: false });
  add(new PlaneGeometry(DIAL * 2, DIAL * 2), face, centre.x, centre.y, 0.006);
  // At rest the needle leans as far left of upright as the top leans right of it.
  const blade = new BoxGeometry(0.004, DIAL * 0.8, 0.002);
  blade.translate(0, DIAL * 0.4, 0);
  blade.rotateZ(SWEEP / 2);
  const needle = add(blade, flat(RED), centre.x, centre.y, 0.009);
  needle.name = "needle";
  add(new CylinderGeometry(0.007, 0.007, 0.004, 16), flat(PALETTE.dark), centre.x, centre.y, 0.01).rotation.x = Math.PI / 2;

  const mid = DIAL_PX / 2;
  return {
    group,
    setForce(newtons) {
      ctx.clearRect(0, 0, DIAL_PX, DIAL_PX);
      ctx.fillStyle = `#${PALETTE.frame.toString(16)}`;
      ctx.beginPath();
      ctx.arc(mid, mid, mid - 2, 0, 2 * Math.PI);
      ctx.fill();
      // A dot a newton round the needle's arc, clockwise from its rest; the reading under it.
      ctx.fillStyle = `#${PALETTE.dark.toString(16)}`;
      for (let n = 0; n <= top_n; n += 1) {
        const angle = -Math.PI / 2 - SWEEP / 2 + (n / top_n) * SWEEP;
        ctx.beginPath();
        ctx.arc(mid + 100 * Math.cos(angle), mid + 100 * Math.sin(angle), 6, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.font = 'bold 48px "DM Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${newtons.toFixed(2)} N`, mid, mid + 58);
      map.needsUpdate = true;
      needle.rotation.z = -(newtons / top_n) * SWEEP;
    },
  };
}

// How far past a duck's trunk the picture keeps room for the rest of it, lying back included.
const DUCK_REACH = 0.15;
// How much of the frame's width a tug's span may fill.
const FILL = 0.9;

/** What a tug's camera holds along the lane at one frame, MJCF x from west to east: from the west duck,
 * room kept round it, to the dial's far edge on the bench, or to the east duck on a bout. */
export function tugSpan(event, frames) {
  const xs = frames.map((frame) => frame[0]);
  const east = frames.length > 1 ? Math.max(...xs) + DUCK_REACH : event.winch[0] + CENTRE.x + RIM;
  return [Math.min(...xs) - DUCK_REACH, east];
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
