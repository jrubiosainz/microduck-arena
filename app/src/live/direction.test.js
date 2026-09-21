import { describe, expect, it } from "vitest";
import { direct, shotsFor } from "./direction.js";

const cue = (speaker, start_ms, end_ms) => ({ speaker, start_ms, end_ms });
const plan = {
  duration_ms: 40000,
  captions: [
    cue("peter", 800, 4000), cue("ray", 4500, 12000), cue("ray", 12000, 15000),
    cue("peter", 15500, 24000), cue("ray", 24500, 30000), cue("peter", 30500, 33000),
  ],
};

describe("shotsFor", () => {
  it("covers the whole plan without gaps, in order", () => {
    const shots = shotsFor(plan);
    expect(shots[0].start_ms).toBe(0);
    expect(shots.at(-1).end_ms).toBe(plan.duration_ms);
    for (const [a, b] of shots.slice(1).map((s, i) => [shots[i], s])) expect(b.start_ms).toBe(a.end_ms);
  });

  it("holds every shot at least five seconds and gives the duo most of the programme", () => {
    const shots = shotsFor(plan);
    for (const s of shots) expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(5000);
    const duo = shots.filter((s) => s.shot === "duo").reduce((sum, s) => sum + s.end_ms - s.start_ms, 0);
    expect(duo).toBeGreaterThan(plan.duration_ms / 2);
  });

  it("never cuts to a close shot before ten seconds wide, never inside the partner's line", () => {
    const shots = shotsFor(plan);
    const close = shots.filter((s) => s.shot !== "duo");
    expect(close.length).toBeGreaterThan(0);
    expect(close[0].start_ms).toBeGreaterThanOrEqual(10000);
    for (const s of close) {
      for (const c of plan.captions) {
        if (c.start_ms < s.end_ms && c.end_ms > s.start_ms) expect(c.speaker).toBe(s.shot);
      }
    }
  });

  it("keeps a single-caption plan on the duo", () => {
    expect(shotsFor({ duration_ms: 6000, captions: [cue("peter", 800, 5000)] })).toEqual([
      { shot: "duo", start_ms: 0, end_ms: 6000 },
    ]);
  });
});

describe("direct", () => {
  it("frames the duo from the front and a close shot toward the speaker's side", () => {
    const cameraAt = direct(plan);
    const wide = cameraAt(0);
    expect(wide.shot).toBe("duo");
    expect(wide.target[2]).toBeCloseTo(0.12);
    expect(wide.position[1]).toBeLessThan(wide.target[1]); // in front, toward the auditorium
    const close = shotsFor(plan).find((s) => s.shot !== "duo");
    const framing = cameraAt(close.start_ms + 100);
    expect(framing.shot).toBe(close.shot);
    const dx = framing.target[0] - wide.target[0];
    expect(Math.sign(dx)).toBe(close.shot === "peter" ? -1 : 1);
  });

  it("backs off for a narrow aspect and eases within a shot", () => {
    const cameraAt = direct(plan);
    const wide = cameraAt(0, 16 / 9);
    const tall = cameraAt(0, 9 / 16);
    const distance = (f) => Math.hypot(...f.position.map((v, i) => v - f.target[i]));
    expect(distance(tall)).toBeGreaterThan(distance(wide));
    expect(distance(cameraAt(4000))).toBeLessThan(distance(wide));
  });
});
