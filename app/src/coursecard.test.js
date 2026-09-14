import { describe, expect, it } from "vitest";
import { courseArt, laneWidth, tilt } from "./coursecard.js";

const sprint = { id: "sprint-2m", title: "2 m Sprint", length_m: 2, slope_deg: 0, rig: "legs" };

describe("tilt", () => {
  it("is the course's own slope", () => {
    expect(tilt(8)).toBe(8);
  });

  it("clamps a steep course so it still fits the frame", () => {
    expect(tilt(75)).toBe(18);
    expect(tilt(-75)).toBe(-18);
  });

  it("treats a missing or unusable slope as flat rather than NaN", () => {
    // A NaN reaches the SVG as the string "NaN" in a transform and silently
    // stops the whole group rendering.
    expect(tilt(undefined)).toBe(0);
    expect(tilt("steep")).toBe(0);
  });
});

describe("laneWidth", () => {
  it("draws a longer course longer", () => {
    expect(laneWidth(5)).toBeGreaterThan(laneWidth(1));
  });

  it("compresses the difference rather than scaling it", () => {
    // 5 m is 5x 1 m; the drawing must not be, or a card is mostly empty track.
    expect(laneWidth(5) / laneWidth(1)).toBeLessThan(2);
  });

  it("never collapses to nothing on a tiny or missing length", () => {
    expect(laneWidth(0)).toBeGreaterThan(50);
    expect(laneWidth(undefined)).toBeGreaterThan(50);
  });
});

describe("courseArt", () => {
  it("describes the course to a screen reader", () => {
    expect(courseArt(sprint)).toContain('aria-label="2 m Sprint: 2 m, flat"');
    expect(courseArt({ ...sprint, slope_deg: 8 })).toContain("8° climb");
  });

  it("tilts the lane for a climb and leaves a flat course level", () => {
    expect(courseArt({ ...sprint, slope_deg: 8 })).toContain("rotate(-8)");
    expect(courseArt(sprint)).toContain("rotate(0)");
  });

  it("draws wheels for a roller rig and feet for legs", () => {
    expect(courseArt({ ...sprint, rig: "rollers" })).toContain("<circle cx=\"-7\"");
    expect(courseArt(sprint)).not.toContain("<circle cx=\"-7\"");
  });

  it("gives each event its own gradient id", () => {
    // Two cards on one page sharing an id would make the second borrow the
    // first's fill — a real bug, and an invisible one.
    expect(courseArt(sprint)).toContain('id="sky-sprint-2m"');
    expect(courseArt({ ...sprint, id: "push" })).toContain('id="sky-push"');
  });

  it("emits no NaN anywhere, whatever the manifest is missing", () => {
    const art = courseArt({ id: "x", title: "X" });
    expect(art).not.toContain("NaN");
  });
});
