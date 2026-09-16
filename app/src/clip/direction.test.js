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
});
