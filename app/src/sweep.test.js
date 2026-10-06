import { describe, expect, it } from "vitest";
import { SWEEP_SECONDS, sweepAt } from "./sweep.js";

describe("sweepAt", () => {
  it("rests before the swing and once it is over", () => {
    for (const seconds of [-1, 0, SWEEP_SECONDS, SWEEP_SECONDS + 1, Infinity]) expect(sweepAt(seconds)).toBe(0);
  });

  it("goes out to one side, across to the other and home", () => {
    expect(sweepAt(SWEEP_SECONDS / 4)).toBeCloseTo(1, 9);
    expect(sweepAt(SWEEP_SECONDS / 2)).toBeCloseTo(0, 9);
    expect(sweepAt((SWEEP_SECONDS * 3) / 4)).toBeCloseTo(-1, 9);
  });

  it("eases into every turn, as a hand dragging it would", () => {
    const step = SWEEP_SECONDS / 1000;
    expect(Math.abs(sweepAt(step))).toBeLessThan(0.001);
    expect(sweepAt(SWEEP_SECONDS / 4 - step)).toBeCloseTo(1, 4);
  });
});
