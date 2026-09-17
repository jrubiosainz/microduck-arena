import { describe, expect, it } from "vitest";
import { stadiumDirection } from "./direction.js";

/** A duck going down the course at a steady pace, sampled every half second. */
const steady = (start, end, reach = 1) => {
  const samples = [];
  for (let second = start; second <= end; second += 0.5) {
    samples.push({ second, value: (reach * (second - start)) / (end - start) });
  }
  return samples;
};

describe("stadiumDirection", () => {
  it("plays through the tape and turns to joy at a pass", () => {
    const at = stadiumDirection({ start: 1, end: 6, verdict: "pass" });
    expect(at(0.5).action).toBe(0);
    expect(at(4).action).toBeGreaterThan(0.3);
    expect(at(7).joy).toBeGreaterThan(0.5);
    expect(at(7).sadness).toBe(0);
  });

  it("waits quietly under the title, and surges at the horn", () => {
    const at = stadiumDirection({ start: 3, end: 12, progress: steady(3, 12), verdict: "pass" });
    expect([at(2.9).action, at(2.9).encouragement, at(2.9).joy]).toEqual([0, 0, 0]);
    expect(at(3.4).encouragement).toBeGreaterThan(0.8);
    expect(at(3.4).action).toBeGreaterThan(0.7);
  });

  it("never settles after the horn: it builds as the duck nears the line", () => {
    const at = stadiumDirection({ start: 3, end: 12, progress: steady(3, 12), verdict: "pass" });
    let last = at(3.4);
    for (let s = 3.5; s <= 11; s += 0.1) {
      const now = at(s);
      for (const intention of ["action", "encouragement", "joy"]) {
        expect(now[intention]).toBeGreaterThanOrEqual(last[intention]);
      }
      last = now;
    }
    expect(at(11).joy).toBeGreaterThan(at(4).joy);
  });

  it("is at full joy just before the duck crosses the line, and only rises until the outro ends", () => {
    const at = stadiumDirection({ start: 3, end: 12, progress: steady(3, 12), verdict: "pass" });
    expect(at(11).joy).toBeLessThan(1);
    expect(at(11.8).joy).toBe(1);
    let last = 0;
    for (let s = 2; s <= 14.5; s += 0.05) {
      expect(at(s).joy).toBeGreaterThanOrEqual(last);
      last = at(s).joy;
    }
  });

  it("falls silent to sadness when the duck falls", () => {
    const at = stadiumDirection({ start: 3, end: 7, progress: steady(3, 7, 0.5), verdict: "fail" });
    expect(at(8).sadness).toBeGreaterThan(0.9);
    expect(at(8).encouragement).toBeLessThan(0.1);
    expect(at(8).joy).toBe(0);
  });
});
