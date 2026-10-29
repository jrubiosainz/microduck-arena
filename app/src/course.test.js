import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { LANE_COLORS, LANE_SPACING, TIER_MARKER, buildCourse, buildMarker, laneOffsetZ, laneSpacing } from "./course.js";

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
  it("gives the hill a solid wedge resting on the floor and a distinct surface", () => {
    const hill = buildCourse({ length_m: 1.5, slope_deg: 8 });
    hill.updateMatrixWorld(true);
    const base = hill.getObjectByName("ramp-base");
    expect(base).toBeTruthy();
    const positions = base.geometry.attributes.position;
    const vertices = Array.from({ length: positions.count }, (_, i) =>
      new Vector3().fromBufferAttribute(positions, i).applyMatrix4(base.matrixWorld));
    expect(Math.min(...vertices.map((v) => v.y))).toBeCloseTo(-0.014, 6);
    expect(Math.max(...vertices.map((v) => v.y))).toBeGreaterThan(0.25);
    const flat = buildCourse({ length_m: 1.5 });
    expect(flat.getObjectByName("ramp-base")).toBeUndefined();
    expect(hill.getObjectByName("ground").material.color.getHex()).not.toBe(
      flat.getObjectByName("ground").material.color.getHex(),
    );
  });

  it("puts the start line at 0 and the finish at the course length", () => {
    const course = buildCourse({ length_m: 2, width_m: 0.8 });
    expect(course.getObjectByName("start").position.x).toBeCloseTo(0, 12);
    expect(course.getObjectByName("finish").position.x).toBeCloseTo(2, 12);
  });

  it("lays a checker of paper and ink across the finish", () => {
    const finish = buildCourse({ length_m: 2, width_m: 0.8 }).getObjectByName("finish");
    const tiles = finish.children;
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    const inks = tiles.map((tile) => tile.material.color.getHex());
    expect(new Set(inks).size).toBe(2);
    for (let i = 1; i < inks.length; i += 1) expect(inks[i]).not.toBe(inks[i - 1]);
    const zs = tiles.map((tile) => tile.position.z);
    expect(Math.min(...zs)).toBeLessThan(-0.3);
    expect(Math.max(...zs)).toBeGreaterThan(0.3);
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

  it("runs the ground further past the finish line when asked, the lines and stripes where they were", () => {
    const course = buildCourse({ length_m: 6, width_m: 0.8 }, 4, [], 2.5);
    const ground = course.getObjectByName("ground");
    expect(ground.geometry.parameters.width).toBeCloseTo(0.4 + 6 + 2.5);
    expect(ground.position.x).toBeCloseTo((6 + 2.5 - 0.4) / 2);
    expect(course.getObjectByName("finish").position.x).toBe(6);
    expect(course.getObjectByName("lane-stripe-0").geometry.parameters.width).toBeCloseTo(6 + 0.8);
  });

  it("paints a lane's stripe the colour its duck is given, and the charter's order otherwise", () => {
    const course = buildCourse({ length_m: 2, width_m: 0.8 }, 3, [LANE_COLORS[3], null]);
    const stripe = (i) => course.getObjectByName(`lane-stripe-${i}`).material.color.getHex();
    expect([stripe(0), stripe(1), stripe(2)]).toEqual([LANE_COLORS[3], LANE_COLORS[1], LANE_COLORS[2]]);
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

describe("laneSpacing", () => {
  it("is the course's true width, walls included", () => {
    // It was a fixed 0.45 m while a real course is 0.85 m wide — the lanes were
    // drawn at roughly half their width, which is why truthful walls overlapped.
    const walls = [{ name: "w", pos: [1, 0.425, 0.075], half: [1.5, 0.025, 0.075] }];
    expect(laneSpacing({ width_m: 0.8, walls })).toBeCloseTo(0.85, 6);
  });

  it("falls back sensibly for an event that serves no walls", () => {
    expect(laneSpacing({ width_m: 0.8 })).toBeCloseTo(0.85, 6);
    expect(laneSpacing()).toBeGreaterThan(0.5);
  });
});
