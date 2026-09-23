import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, Vector3 } from "three";
import { buildRoofBrace } from "./gym.js";

describe("roof braces", () => {
  it.each([-1, 1])("joins the wall post below the roof beam on side %s", (side) => {
    const brace = buildRoofBrace(2, 4, side, new MeshStandardMaterial());
    brace.updateMatrix();
    const half = brace.geometry.parameters.depth / 2;
    const ends = [-half, half].map((z) => new Vector3(0, 0, z).applyMatrix4(brace.matrix));
    const [lower, upper] = ends.sort((a, b) => a.y - b.y);
    expect(lower.x).toBeCloseTo(2);
    expect(lower.y).toBeCloseTo(2.97);
    expect(lower.z).toBeCloseTo(side * (4 - 0.13));
    expect(upper.y).toBeCloseTo(3.87);
    expect(upper.z).toBeCloseTo(side * (4 - 0.13 - 0.9));
    expect(Math.abs(upper.z)).toBeLessThan(Math.abs(lower.z));
    brace.geometry.dispose();
    brace.material.dispose();
  });
});
