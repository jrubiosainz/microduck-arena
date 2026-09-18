import { describe, expect, it } from "vitest";
import { createClock, estimateClock } from "./clock.js";

describe("estimateClock", () => {
  it("trusts the sample with the smallest round trip", () => {
    const { offset, uncertainty } = estimateClock([
      { before: 1000, after: 1400, server: 5200 },
      { before: 2000, after: 2040, server: 6030 },
      { before: 3000, after: 3200, server: 7100 },
    ]);
    expect(offset).toBe(6030 - 2020);
    expect(uncertainty).toBe(20);
  });
});

describe("createClock", () => {
  it("is not ready until a sample lands, then positions the programme from the local clock", () => {
    let local = 10_000;
    const clock = createClock(() => local);
    expect(clock.ready).toBe(false);
    clock.sample(10_000, 500_000, 10_100);
    expect(clock.ready).toBe(true);
    expect(clock.position()).toBe(10_000 + (500_000 - 10_050));
    local = 12_000;
    expect(clock.position()).toBe(12_000 + (500_000 - 10_050));
  });

  it("keeps the best of the last five samples", () => {
    let local = 0;
    const clock = createClock(() => local);
    clock.sample(0, 1000, 10); // offset 995, rtt 10
    for (let i = 1; i <= 5; i++) clock.sample(i * 100, 1000 + i * 100 + 50, i * 100 + 60);
    // The first sample has left the window; the offsets of the rest are 1020.
    expect(clock.position()).toBe(1020);
  });
});
