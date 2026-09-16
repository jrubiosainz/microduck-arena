import { describe, expect, it } from "vitest";
import { actAt, clipPlan, stepAt } from "./plan.js";

describe("clipPlan", () => {
  it("is a second of title, the tape at one clip frame per two trace frames, and a 2.5 s outro", () => {
    const plan = clipPlan(200, 12);
    expect(plan).toMatchObject({ fps: 25, stride: 2, steps: 200, intro: 25, tape: 100, outro: 63 });
    expect(plan.frames).toBe(188);
    expect(plan.seconds).toBeCloseTo(7.52);
    expect(plan.tapeEnd).toBe(125);
    expect(plan.poster).toBe(25 + 60);
  });

  it("cuts a long tape at the event's ceiling", () => {
    expect(clipPlan(5000, 12)).toMatchObject({ steps: 600, tape: 300 });
  });

  it("shows step 0 under the title, the tape at speed, and holds the last step in the outro", () => {
    const plan = clipPlan(200, 12);
    expect(stepAt(plan, 0)).toBe(0);
    expect(stepAt(plan, 25)).toBe(0);
    expect(stepAt(plan, 26)).toBe(2);
    expect(stepAt(plan, 124)).toBe(198);
    expect(stepAt(plan, 187)).toBe(199);
    expect([actAt(plan, 0), actAt(plan, 25), actAt(plan, 125)]).toEqual(["intro", "tape", "outro"]);
  });
});
