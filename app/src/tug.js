// The tug of war's arithmetic, as the server's (arena/tug.py): which end of the string a rated
// entry holds, and the lanes the viewer plays; the string drawn as it was recorded, its seventeen
// points a frame, not a line between two necks; and how a tug is framed. Its venue is tug-venue.js.
// Frames are MJCF (z up); `toThree` carries a point to the scene.

import { BufferGeometry, CatmullRomCurve3, CylinderGeometry, Group, Mesh, TubeGeometry, Vector3 } from "three";
import { PALETTE, flat } from "./palette.js";
import { TRACE_WIDTH, frameCount, leadIn } from "./replay.js";

/** An MJCF point (x, y, z up) in the three.js scene (y up). */
export const toThree = ([x, y, z]) => [x, z, -y];

/** The floats of one frame of the string: its 17 points, west to east, x, y, z each. */
export const STRING_WIDTH = 51;

/** The string's middle point, where the marker is tied. */
export const MIDDLE = 8;

/** Frame `f` of a string: a view, no copy. */
export const stringAt = (string, f) => string.subarray(f * STRING_WIDTH, (f + 1) * STRING_WIDTH);

/** The two ends of the string, by `entrySide`'s index (arena/tug.py's SIDES). */
export const SIDES = ["west", "east"];

/** Which end of the string, 0 west and 1 east, the entry holds on a bout's seed: west on an odd one. */
export const entrySide = (seed) => 1 - (seed % 2);

/** The other duck of every bout. */
const REFERENCE = { livery: "charcoal", name: "Reference" };

/** How an entry's bout ended, in its own words (arena/tug.py's seed statuses). */
export const BOUT_WORDS = { won: "won the pull", lost: "lost the pull", draw: "draw", pit_won: "pulled it in", pit_lost: "dragged in",
  fault: "faulted" };

/**
 * A rated run's bout as a lane of the viewer, from its two traces (west first) and, for a clip, their
 * settles: the entry, `lane`'s livery and name, on its end of the string, the reference duck on the
 * other, in `classic` when the entry wears the reference's `charcoal`; and the bout's `string`, its
 * settle given with the ducks'.
 */
export function ratingLane(traces, settles, string, { traceSeed, livery, name }) {
  const side = entrySide(traceSeed);
  const duck = (k, who) => ({ trace: traces[k], ...(settles && { settle: settles[k] }), ...who });
  const ducks = [];
  ducks[side] = duck(side, { livery, name });
  ducks[1 - side] = duck(1 - side, { ...REFERENCE, livery: livery === REFERENCE.livery ? "classic" : REFERENCE.livery });
  return { tug: "bout", ducks, string };
}

/** The lanes of an entry for `viewer.setLanes`: a bout's two ducks (west first), each settle led in;
 * none for a run stopped before its first timed step and handed over without its settle, which has no frame to draw. */
export function tugDucks(entry) {
  const ducks = entry.ducks;
  const lead = Math.max(...ducks.map((duck) => (duck.settle ? frameCount(duck.settle) : 0)));
  if (!lead && !frameCount(ducks[0].trace)) return [];
  return ducks.map(({ trace, settle, livery, name }) => ({
    trace: leadIn(settle ?? new Float32Array(0), trace, lead, TRACE_WIDTH),
    lead,
    livery,
    name,
  }));
}

/**
 * A lane's string from where its ducks stand, `lead` frames before its trace, as tugDucks leads their
 * settles in: its settle's last `lead` frames (a clip cuts the ducks' settles at their start, replay.js
 * standing), its first frame held when shorter or absent, then its trace.
 */
export function tugString({ string: { settle, trace } }, lead) {
  const kept = settle ? settle.subarray(Math.max(0, settle.length - lead * STRING_WIDTH)) : new Float32Array(0);
  return leadIn(kept, trace, lead, STRING_WIDTH);
}

// The marker's red: the site's recording dot (club.css).
const RED = 0xff3b30;

// A cylinder's axis, before it is turned along the string.
const AXIS = new Vector3(0, 1, 0);

/** The string, an 8 mm rope in ink (it reads against the ring's canvas and the stands behind it), with a
 * red ribbon tied round its middle point, along it and wider than it: it shows wherever the string lies,
 * on the canvas too, where a ribbon hanging from it sank out of sight. `update` lays it through one frame
 * of its points (stringAt), `dispose` frees it. */
export function buildString() {
  const group = new Group();
  const rope = new Mesh(new BufferGeometry(), flat(PALETTE.ink));
  rope.name = "string";
  const marker = new Mesh(new CylinderGeometry(0.006, 0.006, 0.04, 12), flat(RED));
  marker.name = "marker";
  group.add(rope, marker);
  const knots = Array.from({ length: STRING_WIDTH / 3 }, () => new Vector3());
  const along = new Vector3();
  return {
    group,
    update(points) {
      knots.forEach((knot, k) => knot.set(...toThree(points.subarray(3 * k, 3 * k + 3))));
      rope.geometry.dispose();
      rope.geometry = new TubeGeometry(new CatmullRomCurve3(knots), 64, 0.004, 6);
      marker.position.copy(knots[MIDDLE]);
      marker.quaternion.setFromUnitVectors(AXIS, along.subVectors(knots[MIDDLE + 1], knots[MIDDLE - 1]).normalize());
    },
    dispose() {
      for (const part of [rope, marker]) {
        part.geometry.dispose();
        part.material.dispose();
      }
      group.removeFromParent();
    },
  };
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
