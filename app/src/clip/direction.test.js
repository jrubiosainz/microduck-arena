import { describe, expect, it } from "vitest";
import { stadiumDirection } from "./direction.js";

describe("stadiumDirection", () => {
  it("plays through the tape and turns to joy at a pass", () => {
    const at = stadiumDirection({ start: 1, end: 6, verdict: "pass" });
    expect(at(0.5).action).toBe(0);
    expect(at(4).action).toBeGreaterThan(0.3);
    expect(at(7).joy).toBeGreaterThan(0.5);
    expect(at(7).sadness).toBe(0);
  });

  it("encourages when progress rises", () => {
    const at = stadiumDirection({
      start: 1, end: 6, verdict: "pass",
      progress: [{ second: 2, value: 0.1 }, { second: 3, value: 0.5 }],
    });
    expect(at(3.8).encouragement).toBeGreaterThan(at(2.5).encouragement);
  });

  it("waits quietly under the title, surges at the start, and settles back into the race", () => {
    const at = stadiumDirection({ start: 3, end: 12, verdict: "pass" });
    expect(at(2.9).encouragement).toBe(0);
    expect(at(3.4).encouragement).toBeGreaterThan(0.8);
    expect(at(3.4).action).toBeGreaterThan(0.7);
    expect(at(7).encouragement).toBe(0);
    expect(at(7).action).toBeCloseTo(0.45);
  });

  it("is at full joy as the duck crosses the line, and only rises until the outro ends", () => {
    const at = stadiumDirection({ start: 3, end: 12, verdict: "pass" });
    expect(at(12).joy).toBe(1);
    let last = 0;
    for (let s = 11; s <= 14.5; s += 0.05) {
      expect(at(s).joy).toBeGreaterThanOrEqual(last);
      last = at(s).joy;
    }
  });
});
