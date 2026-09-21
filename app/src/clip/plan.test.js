import { describe, expect, it } from "vitest";
import { actAt, clipPlan, stepAt, travelAt } from "./plan.js";

describe("clipPlan", () => {
  it("is three seconds of title, the settle and the tape at one clip frame per two trace frames, and a 2.5 s outro", () => {
    const plan = clipPlan(200, 12, 26);
    expect(plan).toMatchObject({ fps: 25, stride: 2, settle: 26, steps: 226, intro: 75, travel: 60, tape: 113, outro: 63 });
    expect(plan.frames).toBe(251);
    expect(plan.seconds).toBeCloseTo(10.04);
    expect(plan.tapeEnd).toBe(188);
    expect(plan.poster).toBe(75 + 67);
  });

  it("cuts a long tape at the event's ceiling, past the settle", () => {
    expect(clipPlan(5000, 12, 26)).toMatchObject({ steps: 626, tape: 313 });
  });

  it("shows the reset pose under the title, the settle and the tape at speed, and keeps the race running through the outro", () => {
    const plan = clipPlan(200, 12, 26);
    expect(stepAt(plan, 0)).toBe(0);
    expect(stepAt(plan, 75)).toBe(0);
    expect(stepAt(plan, 76)).toBe(2);
    expect(stepAt(plan, 187)).toBe(224);
    // Past the author's last step: its lane holds there (the player holds a
    // finished lane), the rivals still running go on.
    expect(stepAt(plan, 188)).toBe(226);
    expect(stepAt(plan, 250)).toBe(350);
    expect([actAt(plan, 0), actAt(plan, 75), actAt(plan, 188)]).toEqual(["intro", "tape", "outro"]);
  });

  it("travels the camera through the title and settles on the chase before the start", () => {
    const plan = clipPlan(200, 12, 26);
    expect([0, 30, 60, 74, 75, 200].map((i) => travelAt(plan, i))).toEqual([0, 0.5, 1, 1, 1, 1]);
  });
});
