import { describe, expect, it } from "vitest";
import { BOOTH_TURN } from "./direction.js";
import { booth } from "./set.js";

describe("booth", () => {
  it("is the booth's set, turned by a sixth of a turn, with every piece named", () => {
    const set = booth();
    expect(set.rotation.z).toBe(BOOTH_TURN);
    const names = set.children.map((mesh) => mesh.name);
    for (const piece of ["riser", "back wall", "pegboard", "desk top", "CRT cabinet", "CRT glass",
                         "equipment case", "fluorescent tube", "peg hole"]) {
      expect(names).toContain(piece);
    }
    expect(names.filter((n) => n === "peg hole").length).toBeGreaterThan(30);
    const glass = set.getObjectByName("CRT glass");
    expect(glass.geometry.parameters).toMatchObject({ width: 0.108, height: 0.003, depth: 0.076 });
    expect(glass.position.toArray()).toEqual([-0.48, 0.149, 0.19]);
    expect(set.children.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
  });
});
