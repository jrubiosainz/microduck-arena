import { describe, expect, it } from "vitest";
import { plan } from "./points.js";

describe("plan", () => {
  it("births one star per point around the source, each aimed at the chip's centre", () => {
    const from = { left: 100, top: 200, width: 50, height: 20 };
    const to = { left: 900, top: 10, width: 80, height: 40 };
    let seed = 0;
    const random = () => (seed = (seed + 0.37) % 1);
    const stars = plan(3, from, to, random);
    expect(stars).toHaveLength(3);
    for (const star of stars) {
      // Within 40px of the source's box.
      expect(star.x).toBeGreaterThanOrEqual(60);
      expect(star.x).toBeLessThanOrEqual(190);
      expect(star.y).toBeGreaterThanOrEqual(160);
      expect(star.y).toBeLessThanOrEqual(260);
      expect(star.x + star.dx).toBeCloseTo(940);
      expect(star.y + star.dy).toBeCloseTo(30);
      // Half a second, plus up to one more.
      expect(star.wait).toBeGreaterThanOrEqual(500);
      expect(star.wait).toBeLessThan(1500);
    }
    // Born one after the other across the 300 ms spawn window.
    expect(stars.map((star) => star.spawn)).toEqual([0, 100, 200]);
  });
});
