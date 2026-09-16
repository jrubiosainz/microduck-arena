import { describe, expect, it } from "vitest";
import { cameraPose } from "./viewer.js";

describe("cameraPose", () => {
  it("chases the leader from behind and trackside by default, exactly as before", () => {
    expect(cameraPose(null, 1.2, 1.15)).toEqual({
      position: [1.2 - 0.35, 0.34, 1.15],
      target: [1.2, 0.12, 0],
    });
  });

  it("takes an event's chase constants and a pinned side", () => {
    const spec = { kind: "chase", back: 0.5, height: 0.6, side: 2, target_height: 0.2, fov: 40 };
    expect(cameraPose(spec, 0, 1.15)).toEqual({ position: [-0.5, 0.6, 2], target: [0, 0.2, 0] });
  });

  it("backs a chase off by a distance factor for a narrower frame", () => {
    expect(cameraPose({ kind: "chase", distance: 2 }, 1, 1.15).position).toEqual([1 - 0.7, 0.68, 2.3]);
  });

  it("holds a fixed camera where the event put it", () => {
    const spec = { kind: "fixed", position: [1, 0.6, 2.2], target: [1, 0.1, 0], fov: 40 };
    expect(cameraPose(spec, 5, 1.15)).toEqual({ position: [1, 0.6, 2.2], target: [1, 0.1, 0] });
  });
});
