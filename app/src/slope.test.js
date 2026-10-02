// The replayed duck must stand on the ramp that is drawn under it.
//
// A trace frame carries WORLD coordinates that already include the course's
// slope. Anything that tilts the duck's placer applies the slope a SECOND time,
// and the duck climbs away from the ramp — the further along, the worse. That
// shipped, and this is what would have caught it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Group, Vector3 } from "three";
import { buildCourse, buildMarker } from "./course.js";
import { applyFrame } from "./replay.js";
import { buildRigTree } from "./rig.js";
import { attachCourse, cameraSideOffset, placeLane, placeMarker, feetPosition } from "./viewer.js";

const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
const HILL = { length_m: 1.5, width_m: 0.8, slope_deg: 8, rig: "legs" };

// Real frames from hill-climb-1m5 seed 1: MJCF (x, y, z) with the trunk
// upright. The physics puts the trunk a constant 0.1182 m above the ramp.
const FRAMES = [
  [-0.0357, -0.0116, 0.114, 0.1191],
  [0.2261, -0.3583, 0.15, 0.1182],
  [0.2002, -0.3564, 0.1467, 0.1186],
];

function trunkWorld(frame, laneZ = 0) {
  const rig = buildRigTree(kinematics);
  placeLane(rig, laneZ);
  const f = new Float32Array(21);
  f[0] = frame[0];
  f[1] = frame[1];
  f[2] = frame[2];
  f[3] = 1;
  applyFrame(rig, f);
  rig.placer.updateMatrixWorld(true);
  return new Vector3().setFromMatrixPosition(rig.bodies.get("trunk_base").matrixWorld);
}

describe("a replayed duck on a slope", () => {
  it("stands the same height above the drawn ramp as the physics says", () => {
    const tan = Math.tan((HILL.slope_deg * Math.PI) / 180);
    for (const frame of FRAMES) {
      const p = trunkWorld(frame);
      const above = p.y - p.x * tan;
      // 1 mm: this caught a 33 mm error, and a looser bound would not have.
      expect(above).toBeCloseTo(frame[3], 3);
    }
  });

  it("stands on the ramp the course builder actually draws", () => {
    // Not merely on `x * tan(slope)` computed here — on the mesh itself, so the
    // two cannot drift apart without this failing.
    const course = buildCourse(HILL, 1);
    course.updateMatrixWorld(true);
    const along = new Vector3(1.0, 0, 0).applyMatrix4(course.matrixWorld);

    const p = trunkWorld([along.x, 0, along.y + 0.1182]);
    expect(p.y - along.y).toBeCloseTo(0.1182, 3);
  });

  it("is unaffected by which lane it is in", () => {
    // The lateral offset is along z; a slope must not leak into it.
    const middle = trunkWorld(FRAMES[1], 0);
    const outer = trunkWorld(FRAMES[1], 0.45);
    expect(outer.y).toBeCloseTo(middle.y, 6);
    expect(outer.x).toBeCloseTo(middle.x, 6);
    expect(outer.z - middle.z).toBeCloseTo(0.45, 6);
  });

  it("leaves a flat course exactly where the trace puts it", () => {
    const p = trunkWorld([1.0, 0, 0.12]);
    expect(p.x).toBeCloseTo(1.0, 6);
    expect(p.y).toBeCloseTo(0.12, 6);
  });
});

describe("a replayed duck's follow-spot on a slope", () => {
  it.each(["kinematics.json", "kinematics_rollers.json"])("tracks articulated feet and lateral drift for %s", (file) => {
    const rig = buildRigTree(JSON.parse(readFileSync(`public/robot/${file}`, "utf8")));
    placeLane(rig, 0.85);
    const course = buildCourse(HILL, 3);
    const marker = buildMarker("trial");
    for (const lateral of [-0.3, 0.2]) {
      const frame = new Float32Array(21);
      frame.set([1.2, lateral, 0.3, 1, 0, 0, 0]);
      frame[9] = -0.4;
      applyFrame(rig, frame);
      const feet = feetPosition(rig, new Vector3());
      const left = rig.joints.get("left_ankle").body.getWorldPosition(new Vector3());
      const right = rig.joints.get("right_ankle").body.getWorldPosition(new Vector3());
      expect(feet.distanceTo(left.add(right).multiplyScalar(0.5))).toBeLessThan(1e-9);
      placeMarker(marker, course, feet, HILL.slope_deg);
      const center = marker.getWorldPosition(new Vector3());
      expect(center.x).toBeCloseTo(feet.x, 6);
      expect(center.z).toBeCloseTo(feet.z, 6);
    }
  });

  it("lies on the drawn ramp under its duck, not at height zero beneath the hill", () => {
    const course = buildCourse(HILL, 1);
    const marker = buildMarker("gold");
    placeMarker(marker, course, new Vector3(1.2, 0.3, 0.27), HILL.slope_deg);
    course.updateMatrixWorld(true);
    const p = new Vector3().setFromMatrixPosition(marker.matrixWorld);
    const tan = Math.tan((HILL.slope_deg * Math.PI) / 180);
    // Within a millimetre: the ring floats 4 mm off the ramp, tilted with it.
    expect(Math.abs(p.x - 1.2)).toBeLessThan(1e-3);
    expect(p.y).toBeCloseTo(1.2 * tan, 2);
    expect(p.y).toBeGreaterThan(0.15);
    expect(p.z).toBeCloseTo(0.27, 6);
    const normal = new Vector3(0, 0, 1).transformDirection(marker.matrixWorld);
    const angle = HILL.slope_deg * Math.PI / 180;
    expect(normal.x).toBeCloseTo(-Math.sin(angle), 6);
    expect(normal.y).toBeCloseTo(Math.cos(angle), 6);
  });
});

it("attaches the floor without rendering collision walls", () => {
  const scene = new Group();
  const course = attachCourse(scene, { length_m: 2, walls: [{ pos: [1, 0.425, 0.075], half: [1.5, 0.025, 0.075] }] }, 1);
  expect(course.parent).toBe(scene);
  expect(course.getObjectByName("walls")).toBeUndefined();
});

describe("the camera's side offset", () => {
  it("backs away as the arena widens", () => {
    // Three lanes now span 2.6 m rather than 1.35, and a fixed offset left the
    // outer two out of frame.
    expect(cameraSideOffset(3, 0.85)).toBeGreaterThan(cameraSideOffset(1, 0.85));
    expect(cameraSideOffset(3, 0.85)).toBeGreaterThan(1.275); // past the outer wall
  });

  it("never comes closer than the framing that always worked for one lane", () => {
    expect(cameraSideOffset(1, 0.1)).toBeGreaterThanOrEqual(1.15);
    expect(cameraSideOffset(0, 0.85)).toBeGreaterThanOrEqual(1.15);
  });

  it("clears the outermost wall at every lane count", () => {
    for (const lanes of [1, 2, 3, 4, 5]) {
      expect(cameraSideOffset(lanes, 0.85)).toBeGreaterThan((lanes * 0.85) / 2);
    }
  });
});
