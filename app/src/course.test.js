import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { LANE_SPACING, TIER_MARKER, buildCourse, buildMarker, laneOffsetZ } from "./course.js";

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
