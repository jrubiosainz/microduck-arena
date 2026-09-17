import { describe, expect, it } from "vitest";
import { actAt, clipPlan, stepAt, travelAt } from "./plan.js";

describe("clipPlan", () => {
  it("is three seconds of title, the tape at one clip frame per two trace frames, and a 2.5 s outro", () => {
    const plan = clipPlan(200, 12);
    expect(plan).toMatchObject({ fps: 25, stride: 2, steps: 200, intro: 75, travel: 60, tape: 100, outro: 63 });
    expect(plan.frames).toBe(238);
    expect(plan.seconds).toBeCloseTo(9.52);
    expect(plan.tapeEnd).toBe(175);
    expect(plan.poster).toBe(75 + 60);
  });

  it("cuts a long tape at the event's ceiling", () => {
    expect(clipPlan(5000, 12)).toMatchObject({ steps: 600, tape: 300 });
  });

  it("shows step 0 under the title, the tape at speed, and holds the last step in the outro", () => {
    const plan = clipPlan(200, 12);
    expect(stepAt(plan, 0)).toBe(0);
    expect(stepAt(plan, 75)).toBe(0);
    expect(stepAt(plan, 76)).toBe(2);
    expect(stepAt(plan, 174)).toBe(198);
    expect(stepAt(plan, 237)).toBe(199);
    expect([actAt(plan, 0), actAt(plan, 75), actAt(plan, 175)]).toEqual(["intro", "tape", "outro"]);
  });

  it("travels the camera through the title and settles on the chase before the start", () => {
    const plan = clipPlan(200, 12);
    expect([0, 30, 60, 74, 75, 200].map((i) => travelAt(plan, i))).toEqual([0, 0.5, 1, 1, 1, 1]);
  });
});
