import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { LANE_SPACING, TIER_MARKER, buildCourse, buildMarker, laneOffsetZ, buildWalls } from "./course.js";

describe("laneOffsetZ", () => {
  it("centres a single lane", () => {
    expect(laneOffsetZ(0, 1)).toBe(0);
  });

  it("spreads lanes symmetrically about the centre", () => {
    expect(laneOffsetZ(0, 3)).toBeCloseTo(-LANE_SPACING, 12);
    expect(laneOffsetZ(1, 3)).toBeCloseTo(0, 12);
    expect(laneOffsetZ(2, 3)).toBeCloseTo(LANE_SPACING, 12);
  });

  it("separates lanes along z, never along the direction of travel", () => {
    // The bug this replaces put lanes on x — the forward axis — so a
    // head-to-head raced in single file instead of side by side.
    const offsets = [0, 1, 2].map((i) => laneOffsetZ(i, 3));
    expect(new Set(offsets).size).toBe(3);
  });
});

describe("buildCourse", () => {
  it("puts the start line at 0 and the finish at the course length", () => {
    const course = buildCourse({ length_m: 2, width_m: 0.8 });
    expect(course.getObjectByName("start").position.x).toBeCloseTo(0, 12);
    expect(course.getObjectByName("finish").position.x).toBeCloseTo(2, 12);
  });

  it("lays the ground flat and centres it between the lines", () => {
    const ground = buildCourse({ length_m: 2, width_m: 0.8 }).getObjectByName("ground");
    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect(ground.position.x).toBeCloseTo(1, 12);
  });

  it("is level when the event is flat", () => {
    expect(buildCourse({ length_m: 2, slope_deg: 0 }).rotation.z).toBe(0);
  });

  it("climbs toward the finish when the event has a slope", () => {
    // The hill climb's ground must actually tilt: replaying a climb on a flat
    // floor would show the duck ascending through nothing.
    const course = buildCourse({ length_m: 1.5, slope_deg: 8 });
    course.updateMatrixWorld(true);
    const forward = new Vector3(1, 0, 0).applyQuaternion(course.quaternion);
    expect(forward.y).toBeGreaterThan(0);
    expect(forward.y).toBeCloseTo(Math.sin((8 * Math.PI) / 180), 6);
  });

  it("widens the ground as lanes are added", () => {
    const one = buildCourse({ length_m: 2, width_m: 0.8 }, 1);
    const four = buildCourse({ length_m: 2, width_m: 0.8 }, 4);
    const width = (c) => c.getObjectByName("ground").geometry.parameters.height;
    expect(width(four)).toBeGreaterThan(width(one));
  });
});

describe("buildMarker", () => {
  it("lays the ring flat on the ground", () => {
    expect(buildMarker("trial").rotation.x).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("gives each tier its own colour", () => {
    const colour = (tier) => buildMarker(tier).material.color.getHex();
    expect(colour("trial")).toBe(TIER_MARKER.trial);
    expect(colour("leader")).toBe(TIER_MARKER.leader);
    expect(colour("ghost")).toBe(TIER_MARKER.ghost);
    expect(new Set(["trial", "leader", "ghost"].map(colour)).size).toBe(3);
  });

  it("holds a ghost's ring back so the two that matter read first", () => {
    expect(buildMarker("ghost").material.opacity).toBeLessThan(
      buildMarker("trial").material.opacity,
    );
  });

  it("falls back to the ghost treatment for an unknown tier", () => {
    expect(buildMarker("nonsense").material.color.getHex()).toBe(TIER_MARKER.ghost);
  });

  it("sits just above the ground, not inside it", () => {
    const marker = buildMarker("leader");
    expect(marker.position.y).toBeGreaterThan(0);
    expect(marker.position.y).toBeLessThan(0.02);
  });
});

describe("the lane walls", () => {
  // Exactly what arena/course.py serves for sprint-2m, pinned there against the
  // compiled MuJoCo model. Nothing here recomputes them.
  const WALLS = [
    { name: "wall_left", pos: [1.0, 0.425, 0.075], half: [1.5, 0.025, 0.075] },
    { name: "wall_right", pos: [1.0, -0.425, 0.075], half: [1.5, 0.025, 0.075] },
  ];

  it("is hidden until asked for", () => {
    // Two grey slabs around every replay would be worse than the problem.
    expect(buildWalls(WALLS).visible).toBe(false);
  });

  it("converts MJCF axes to three.js ones", () => {
    // MJCF +y is three -z. Getting this wrong draws the walls across the lane
    // instead of along it, which would look deliberate and be wrong.
    const [left, right] = buildWalls(WALLS).children;
    expect(left.position.x).toBeCloseTo(1.0, 6);
    expect(left.position.y).toBeCloseTo(0.075, 6); // MJCF z -> three y
    expect(left.position.z).toBeCloseTo(-0.425, 6); // MJCF y -> three -z
    expect(right.position.z).toBeCloseTo(0.425, 6);
  });

  it("doubles the half-extents, mapping them the same way", () => {
    const [left] = buildWalls(WALLS).children;
    const { width, height, depth } = left.geometry.parameters;
    expect(width).toBeCloseTo(3.0, 6); // 2 * 1.5 along the lane
    expect(height).toBeCloseTo(0.15, 6); // 2 * 0.075, the wall's height
    expect(depth).toBeCloseTo(0.05, 6); // 2 * 0.025, its thickness
  });

  it("is the length of the lane plus its overrun, not the lane alone", () => {
    // 3.0 for a 2 m course: the physics wall runs 0.5 m past the finish, and
    // drawing it shorter would show a gap the robot cannot actually pass.
    const [left] = buildWalls(WALLS).children;
    expect(left.geometry.parameters.width).toBeGreaterThan(2.0);
  });

  it("draws nothing when an event serves no walls", () => {
    expect(buildWalls().children).toHaveLength(0);
    expect(buildWalls([]).children).toHaveLength(0);
  });

  it("rides with the course, so it tilts with a slope", () => {
    const course = buildCourse({ length_m: 1.5, slope_deg: 8, walls: WALLS }, 1);
    const group = course.children.find((c) => c.name === "walls");
    expect(group).not.toBeNull();
    expect(group.parent).toBe(course);
  });
});
