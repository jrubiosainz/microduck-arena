import { describe, expect, it } from "vitest";
import { actAt, clipPlan, stampAt, stepAt, travelAt } from "./plan.js";

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

describe("stampAt", () => {
  const STAMP = { width: 900, height: 200 };
  const LANDSCAPE = { width: 1920, height: 1080 };
  it("lands the stamp on the duck when it stands whole there", () => {
    expect(stampAt({ x: 0.5, y: 0.6 }, STAMP, LANDSCAPE, 890)).toEqual({ x: 0.5, y: 0.6 });
  });
  it("moves it no further than it takes to keep it inside the screen's edges", () => {
    expect(stampAt({ x: 0.02, y: 0.05 }, STAMP, LANDSCAPE, 890)).toEqual({ x: (36 + 450) / 1920, y: (36 + 100) / 1080 });
    expect(stampAt({ x: 0.99, y: 0.5 }, STAMP, LANDSCAPE, 890).x).toBe((1920 - 36 - 450) / 1920);
  });
  it("keeps it above the figures band where the band covers the screen, and above the screen's bottom where it does not", () => {
    expect(stampAt({ x: 0.3, y: 0.95 }, STAMP, LANDSCAPE, 890).y).toBe((890 - 36 - 100) / 1080);
    expect(stampAt({ x: 0.5, y: 0.99 }, STAMP, { width: 1080, height: 1233 }, 1233).y).toBe((1233 - 36 - 100) / 1233);
  });
});
