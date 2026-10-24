// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lightAt, outAt } from "./lights.js";
import { TRACE_WIDTH } from "./replay.js";

// The shipped event's schedule (arena/events/red-light-green-light-15m.toml).
const SHIPPED = {
  green_s: [0.6, 2.4, 1.6, 3.0, 2.0, 2.8],
  red_s: [1.6, 2.0, 1.4, 2.4, 1.8, 2.2],
  turn_s: 0.4,
  tolerance_m: 0.03,
};
const CYCLE = 23.8;

function expectLight(lights, seconds, { red, facing, watching }) {
  const light = lightAt(lights, seconds);
  expect(light.red).toBe(red);
  expect(light.facing).toBeCloseTo(facing);
  expect(light.watching).toBe(watching);
}

describe("the light", () => {
  it("is green with the caller's back turned before and at the start", () => {
    for (const seconds of [-1, NaN, 0, 0.3, 0.58]) {
      expectLight(SHIPPED, seconds, { red: false, facing: 0, watching: false });
    }
  });

  it("is red on the steps the race judges red, and only on those", () => {
    // Red from step 30 to step 110 (0.6 s to 2.2 s), green to step 230 (4.6 s), red again.
    const red = (seconds) => lightAt(SHIPPED, seconds).red;
    expect([0.58, 0.6, 2.18, 2.2, 4.58, 4.6].map(red)).toEqual([false, true, true, false, false, true]);
    // The cycle's sixth and last red, from 21.6 s to its end.
    expect([21.58, 21.6, CYCLE - 0.02].map(red)).toEqual([false, true, true]);
  });

  it("turns the caller round over turn_s, and only then watches", () => {
    expectLight(SHIPPED, 0.6, { red: true, facing: 0, watching: false });
    expectLight(SHIPPED, 0.8, { red: true, facing: 0.5, watching: false });
    // Nearly round on the turn's last step, and not watching yet.
    expect(lightAt(SHIPPED, 0.98).facing).toBeGreaterThan(0.95);
    expect(lightAt(SHIPPED, 0.98).watching).toBe(false);
    expectLight(SHIPPED, 1.0, { red: true, facing: 1, watching: true });
    expectLight(SHIPPED, 2.18, { red: true, facing: 1, watching: true });
  });

  it("turns the caller back on green, never watching", () => {
    expectLight(SHIPPED, 2.2, { red: false, facing: 1, watching: false });
    expectLight(SHIPPED, 2.4, { red: false, facing: 0.5, watching: false });
    expectLight(SHIPPED, 2.6, { red: false, facing: 0, watching: false });
  });

  it("repeats its schedule until the time limit, turning back from the cycle's last red", () => {
    for (const seconds of [0.9, 3.0, 9.0, 13.3, 20.0, 22.5]) {
      const first = lightAt(SHIPPED, seconds);
      expectLight(SHIPPED, seconds + CYCLE, first);
      expectLight(SHIPPED, seconds + 2 * CYCLE, first);
    }
    expectLight(SHIPPED, CYCLE, { red: false, facing: 1, watching: false });
    expectLight(SHIPPED, CYCLE + 0.4, { red: false, facing: 0, watching: false });
  });

  it("faces the lanes at once when the caller takes no time to turn", () => {
    const instant = { ...SHIPPED, turn_s: 0 };
    expectLight(instant, 0.6, { red: true, facing: 1, watching: true });
    expectLight(instant, 2.2, { red: false, facing: 0, watching: false });
  });
});

describe("outAt", () => {
  // A trace whose trunk walks along x from `from` through each of `xs`, one frame each.
  const walk = (from, ...xs) => {
    const trace = new Float32Array((xs.length + 1) * TRACE_WIDTH);
    [from, ...xs].forEach((x, i) => { trace[i * TRACE_WIDTH] = x; });
    return trace;
  };

  it("leaves a duck that reached the line in, wherever on the floor it set off", () => {
    expect(outAt(walk(0.01, 5, 10, 15.02), 15)).toBeNull();
    expect(outAt(walk(-0.02, 7, 14.99), 15)).toBeNull();
  });

  it("puts a duck whose trace ends short of the line out from its last frame", () => {
    expect(outAt(walk(0, 3, 5.9), 15)).toBe(2);
    expect(outAt(walk(0, 0.35), 15)).toBe(1);
  });

  it("has nothing to say about an empty trace", () => {
    expect(outAt(new Float32Array(0), 15)).toBeNull();
  });
});
