import { describe, expect, it } from "vitest";
import { cameraFor, renderDuckPortrait, renderThumbnails } from "./thumbnail.js";

describe("cameraFor", () => {
  it("pulls back and aims further down a longer course", () => {
    const short = cameraFor(1);
    const long = cameraFor(5);
    expect(long.position[2]).toBeGreaterThan(short.position[2]);
    expect(long.target[0]).toBeGreaterThan(short.target[0]);
  });

  it("never produces NaN from a missing length", () => {
    // A NaN in a camera position renders nothing, silently.
    const { position, target } = cameraFor(undefined);
    expect(position.every(Number.isFinite)).toBe(true);
    expect(target.every(Number.isFinite)).toBe(true);
  });
});

describe("renderThumbnails", () => {
  it("returns an empty map rather than throwing when WebGL is unavailable", async () => {
    // jsdom has no WebGL, which is exactly the degraded case that must not take
    // the menu down with it — the cards keep their SVG diagrams.
    const events = [{ id: "sprint-2m", rig: "legs", length_m: 2, slope_deg: 0 }];
    await expect(renderThumbnails(events)).resolves.toBeInstanceOf(Map);
  });

  it("leaves every card without a thumbnail rather than some", async () => {
    const events = [
      { id: "a", rig: "legs", length_m: 2, slope_deg: 0 },
      { id: "b", rig: "rollers", length_m: 2, slope_deg: 0 },
    ];
    const out = await renderThumbnails(events);
    expect(out.size).toBe(0);
  });
});

describe("the duck's portrait", () => {
  it("answers null rather than throwing where there is no WebGL", async () => {
    // jsdom has no WebGL, which is also a real browser on a machine with it
    // disabled. A picture of the duck is a nicety; the contract is that it
    // can never take the page with it, and the caller keeps the head.
    await expect(renderDuckPortrait()).resolves.toBeNull();
  });
});
