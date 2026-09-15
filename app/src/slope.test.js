// The replayed duck must stand on the ramp that is drawn under it.
//
// A trace frame carries WORLD coordinates that already include the course's
// slope. Anything that tilts the duck's placer applies the slope a SECOND time,
// and the duck climbs away from the ramp — the further along, the worse. That
// shipped, and this is what would have caught it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Euler, Group, Vector3 } from "three";
import { buildCourse } from "./course.js";
import { applyFrame } from "./replay.js";
import { buildRigTree } from "./rig.js";
import { standOnCourse } from "./thumbnail.js";
import { attachCourse, cameraSideOffset, placeLane } from "./viewer.js";

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

describe("a still's duck on a slope", () => {
  it("stands ON the ramp rather than at height zero beneath it", () => {
    // The opposite mistake to the replay's: a still has no trace, so it must
    // inherit the course's tilt — and the first version placed it in world
    // space at y=0, sinking it into a hill that had already climbed.
    const course = buildCourse(HILL, 2);
    const rig = buildRigTree(kinematics);
    standOnCourse(rig, course, 0.5, 0);
    course.updateMatrixWorld(true);

    const p = new Vector3().setFromMatrixPosition(rig.placer.matrixWorld);
    const tan = Math.tan((HILL.slope_deg * Math.PI) / 180);
    // On the surface: its height is the ramp's height at its own x.
    expect(p.y).toBeCloseTo(p.x * tan, 4);
    expect(p.y).toBeGreaterThan(0.05);
  });

  it("leans with the hill, which is what the replay must not do", () => {
    const course = buildCourse(HILL, 2);
    const rig = buildRigTree(kinematics);
    standOnCourse(rig, course, 0.5, 0);
    course.updateMatrixWorld(true);
    const e = new Euler().setFromRotationMatrix(rig.placer.matrixWorld);
    expect(e.z).toBeCloseTo((HILL.slope_deg * Math.PI) / 180, 4);
  });

  it("sits flat on a flat course", () => {
    const course = buildCourse({ ...HILL, slope_deg: 0 }, 2);
    const rig = buildRigTree(kinematics);
    standOnCourse(rig, course, 0.5, 0);
    course.updateMatrixWorld(true);
    const p = new Vector3().setFromMatrixPosition(rig.placer.matrixWorld);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(0.5, 6);
  });
});

describe("the wall toggle across a re-race", () => {
  const WALLS = [{ name: "wall_left", pos: [1, 0.425, 0.075], half: [1.5, 0.025, 0.075] }];
  const EVENT = { length_m: 2, walls: WALLS };

  it("a rebuilt course remembers that the walls were showing", () => {
    // setLanes rebuilds the course on every re-race and a fresh wall group
    // starts hidden, so this is the page's own builder being exercised — not a
    // model of it rebuilt in the test.
    const scene = new Group();
    attachCourse(scene, EVENT, 1, true);
    const rebuilt = attachCourse(scene, EVENT, 2, true);
    expect(rebuilt.getObjectByName("walls").visible).toBe(true);
  });

  it("and remembers equally that they were hidden", () => {
    const scene = new Group();
    expect(attachCourse(scene, EVENT, 1, false).getObjectByName("walls").visible).toBe(false);
  });

  it("puts the course in the scene", () => {
    const scene = new Group();
    const course = attachCourse(scene, EVENT, 1, false);
    expect(course.parent).toBe(scene);
  });

  it("does not fall over on an event with no walls at all", () => {
    const scene = new Group();
    expect(() => attachCourse(scene, { length_m: 2 }, 1, true)).not.toThrow();
  });
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
