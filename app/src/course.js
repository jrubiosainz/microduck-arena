// The visible course: the ground the duck runs on, and the lines it runs between.
//
// Axis mapping, measured rather than assumed (see rig.test.js, which pins it):
//   MJCF +x (forward) -> three.js +x
//   MJCF +y (left)    -> three.js -z
//   MJCF +z (up)      -> three.js +y
// So the duck advances along +x, lanes are separated along z, and a slope that
// climbs toward MJCF +x is a rotation about three.js +z.

import {
  BoxGeometry,
  ExtrudeGeometry,
  Shape,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
} from "three";
import { PALETTE, flat } from "./palette.js";

// Fallback only. The real spacing is the course's own width, below.
export const LANE_SPACING = 0.45;

/**
 * How far apart to draw two lanes, in metres.
 *
 * A real course is `width_m` wide plus its wall thickness, and the physics has
 * no lanes at all — every run is a separate simulation on that same single
 * course. Drawing them side by side is a presentational fiction, so the least
 * it can do is not lie about how wide each one is: at the old fixed 0.45 m the
 * lanes were packed at roughly half their true width, which is why drawing the
 * walls truthfully put the outer ducks inside them.
 *
 * At this spacing neighbouring lanes' walls meet exactly, which is also what a
 * real multi-lane track looks like — and no duck can cross into another's lane,
 * which is true of the physics too.
 */
export function laneSpacing({ width_m = 0.8, walls = [] } = {}) {
  const thickness = walls.length ? walls[0].half[1] * 2 : 0.05;
  return width_m + thickness;
}

// A lane's identity lives in the ground and in its row tab — never in the
// robot's own colours, which carry the shape of the machine.
// The lane's identity, on the stage's stripe and on the table's tab. Five of
// the charter's own colours, in the same order in both lists: Pollen orange,
// sky, lime hi-vis, lavender, beak yellow.
export const LANE_COLORS = [0xff7a2f, 0x8fb8dc, 0xc8ff2e, 0x9d87e8, 0xffd23f];
export const LANE_CSS = ["#ff7a2f", "#8fb8dc", "#c8ff2e", "#9d87e8", "#ffd23f"];
export const OVERRUN = 0.4; // ground extends this far past both lines
const LINE_WIDTH = 0.03;

/** Lateral offset for lane `i` of `n`, in three.js z. */
export function laneOffsetZ(i, n, spacing = LANE_SPACING) {
  return (i - (n - 1) / 2) * spacing;
}

/**
 * Build the course for an event.
 *
 * `lanes` widens the ground so several ducks fit side by side. No walls: the
 * physics has them, but on screen they hide the robot, and the start and finish
 * lines are what actually make a race readable.
 */
export function buildCourse({ length_m, width_m = 0.8, slope_deg = 0, walls = [] }, lanes = 1, stripes = []) {
  const course = new Group();
  course.name = "course";
  // Climbing toward +x is a positive rotation about z: it lifts +x into +y.
  course.rotation.z = (slope_deg * Math.PI) / 180;

  const spacing = laneSpacing({ width_m, walls });
  const span = Math.max(width_m, lanes * spacing);
  const ground = new Mesh(
    new PlaneGeometry(length_m + OVERRUN * 2, span),
    // Rubber track stays matte; the painted ramp has a broad satin highlight.
    new MeshStandardMaterial({
      color: slope_deg ? 0x456d7b : 0x22242a,
      roughness: slope_deg ? 0.72 : 1,
      metalness: 0,
      envMapIntensity: slope_deg ? 0.45 : 0.15,
    }),
  );
  // PlaneGeometry is built in XY; lay it flat. Not a coordinate-frame fix.
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(length_m / 2, 0, 0);
  ground.name = "ground";
  course.add(ground);

  if (slope_deg > 0) {
    const angle = course.rotation.z;
    const end = length_m + OVERRUN;
    // In the tilted course frame, the wedge's underside maps to a level floor.
    const bottom = (x) => (-0.014 - x * Math.sin(angle)) / Math.cos(angle);
    const profile = new Shape();
    profile.moveTo(0, -0.004);
    profile.lineTo(end, -0.004);
    profile.lineTo(end, bottom(end));
    profile.lineTo(0, bottom(0));
    profile.closePath();
    const geometry = new ExtrudeGeometry(profile, { depth: span, bevelEnabled: false });
    geometry.translate(0, 0, -span / 2);
    const base = new Mesh(geometry, new MeshStandardMaterial({ color: 0x244b59, roughness: 0.95 }));
    base.name = "ramp-base";
    course.add(base);
    for (const side of [-1, 1]) {
      const edge = new Mesh(new BoxGeometry(end, 0.003, 0.025),
        new MeshStandardMaterial({ color: 0xffc548, roughness: 0.85 }));
      edge.name = "ramp-edge";
      edge.position.set(end / 2, 0.003, side * (span / 2 - 0.016));
      course.add(edge);
    }
  }

  course.add(line(0, span, 0xf5f5f5, "start"));
  course.add(checker(length_m, span));

  // One stripe per lane, so a table row can point at its duck.
  //
  // Deliberately quiet. At full brightness and 35 mm these were the loudest
  // thing on the stage, which inverted the hierarchy: the stripes read first
  // and the robots second. The ring travelling under each duck already
  // identifies a lane while it moves, so the stripe only has to be findable —
  // in its duck's colour when `stripes` gives one, the charter's order otherwise.
  for (let i = 0; i < lanes; i += 1) {
    const stripe = new Mesh(
      new BoxGeometry(length_m + OVERRUN * 2, 0.002, 0.02),
      new MeshStandardMaterial({
        color: stripes[i] ?? LANE_COLORS[i % LANE_COLORS.length],
        roughness: 0.8,
        transparent: true,
        opacity: 0.5,
      }),
    );
    stripe.position.set(length_m / 2, 0.002, laneOffsetZ(i, lanes, spacing) - spacing * 0.42);
    stripe.name = `lane-stripe-${i}`;
    course.add(stripe);
  }

  return course;
}

// The finish: a row of paper and ink tiles across the track, each 12 cm
// along it and 13 across, as many as the span takes.
const TILE = [0.12, 0.13];

function checker(x, span) {
  const finish = new Group();
  finish.name = "finish";
  finish.position.set(x, 0.003, 0);
  const count = Math.round(span / TILE[1]);
  for (let i = 0; i < count; i += 1) {
    const tile = new Mesh(
      new BoxGeometry(TILE[0], 0.002, TILE[1]),
      flat(i % 2 ? PALETTE.paper : PALETTE.ink),
    );
    tile.position.z = (i - (count - 1) / 2) * TILE[1];
    finish.add(tile);
  }
  return finish;
}

function line(x, span, color, name) {
  const mesh = new Mesh(
    new BoxGeometry(LINE_WIDTH, 0.004, span),
    new MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  // Just above the ground so it is never z-fighting with it.
  mesh.position.set(x, 0.003, 0);
  mesh.name = name;
  return mesh;
}


// Tier colours for the marker under a duck, and the charter's, so the key
// beside the board can ink the same three and still name the same rings: the
// trial takes lavender, the leader Pollen orange, a ghost plain paper — dimmed
// to 0.4 below, which is what makes it a ghost.
export const TIER_MARKER = { trial: 0x9d87e8, leader: 0xff7a2f, ghost: 0xfaf8f2 };

/**
 * A ring that sits on the ground under a duck and travels with it.
 *
 * This is how a lane is identified while it is moving: a follow-spot, the way a
 * sports broadcast rings the player it is tracking. It carries the tier colour
 * so the duck you just tested and the one you are chasing are both obvious
 * without touching the robots' own colours.
 *
 * `colour` overrides the tier's own, which is what a ballot needs: on a voting
 * page every duck wears the same livery and the RING is the only thing that
 * tells one lane from another — the signal this ring was already the best at.
 */
export function buildMarker(tier = "ghost", colour = null) {
  const marker = new Mesh(
    new RingGeometry(0.085, 0.115, 32),
    new MeshBasicMaterial({
      color: colour ?? TIER_MARKER[tier] ?? TIER_MARKER.ghost,
      toneMapped: false,
      transparent: true,
      opacity: colour !== null || tier !== "ghost" ? 0.95 : 0.4,
    }),
  );
  marker.rotation.x = -Math.PI / 2; // lay the ring flat
  marker.position.y = 0.004;
  marker.name = `marker-${tier}`;
  return marker;
}
