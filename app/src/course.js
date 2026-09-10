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
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
} from "three";

export const LANE_SPACING = 0.45; // metres between lane centres

// A lane's identity lives in the ground and in its row tab — never in the
// robot's own colours, which carry the shape of the machine.
export const LANE_COLORS = [0xff7a2f, 0x4aa3ff, 0x6ee06e, 0xd47aff, 0xffd23f];
export const LANE_CSS = ["#ff7a2f", "#4aa3ff", "#6ee06e", "#d47aff", "#ffd23f"];
const OVERRUN = 0.4; // ground extends this far past both lines
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
export function buildCourse({ length_m, width_m = 0.8, slope_deg = 0 }, lanes = 1) {
  const course = new Group();
  course.name = "course";
  // Climbing toward +x is a positive rotation about z: it lifts +x into +y.
  course.rotation.z = (slope_deg * Math.PI) / 180;

  const span = Math.max(width_m, lanes * LANE_SPACING + width_m * 0.5);
  const ground = new Mesh(
    new PlaneGeometry(length_m + OVERRUN * 2, span),
    // Back to dark, and fully rough so the scene environment barely touches
    // it. Lightening the floor to help the robots read did the opposite: a
    // flat plane facing up takes all of the sky, and the robots ended up as
    // silhouettes against their own track.
    new MeshStandardMaterial({
      color: 0x22242a,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.15,
    }),
  );
  // PlaneGeometry is built in XY; lay it flat. Not a coordinate-frame fix.
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(length_m / 2, 0, 0);
  ground.name = "ground";
  course.add(ground);

  course.add(line(0, span, 0xf5f5f5, "start"));
  course.add(line(length_m, span, 0xff7a2f, "finish"));

  // One stripe per lane, so a table row can point at its duck.
  //
  // Deliberately quiet. At full brightness and 35 mm these were the loudest
  // thing on the stage, which inverted the hierarchy: the stripes read first
  // and the robots second. The ring travelling under each duck already
  // identifies a lane while it moves, so the stripe only has to be findable.
  for (let i = 0; i < lanes; i += 1) {
    const stripe = new Mesh(
      new BoxGeometry(length_m + OVERRUN * 2, 0.002, 0.02),
      new MeshStandardMaterial({
        color: LANE_COLORS[i % LANE_COLORS.length],
        roughness: 0.8,
        transparent: true,
        opacity: 0.5,
      }),
    );
    stripe.position.set(length_m / 2, 0.002, laneOffsetZ(i, lanes) - LANE_SPACING * 0.42);
    stripe.name = `lane-stripe-${i}`;
    course.add(stripe);
  }

  return course;
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


// Tier colours for the marker under a duck. The trial takes the cyan already
// used for "not published", the leader the accent orange, a ghost stays grey.
export const TIER_MARKER = { trial: 0x50c8ff, leader: 0xff7a2f, ghost: 0x54545e };

/**
 * A ring that sits on the ground under a duck and travels with it.
 *
 * This is how a lane is identified while it is moving: a follow-spot, the way a
 * sports broadcast rings the player it is tracking. It carries the tier colour
 * so the duck you just tested and the one you are chasing are both obvious
 * without touching the robots' own colours.
 */
export function buildMarker(tier = "ghost") {
  const marker = new Mesh(
    new RingGeometry(0.085, 0.115, 32),
    new MeshBasicMaterial({
      color: TIER_MARKER[tier] ?? TIER_MARKER.ghost,
      transparent: true,
      opacity: tier === "ghost" ? 0.4 : 0.95,
    }),
  );
  marker.rotation.x = -Math.PI / 2; // lay the ring flat
  marker.position.y = 0.004;
  marker.name = `marker-${tier}`;
  return marker;
}
