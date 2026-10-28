import { SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";
import { BOOTH_TURN } from "./direction.js";
import { booth, standScreen } from "./set.js";

describe("booth", () => {
  it("is the booth's set, turned by a sixth of a turn, with every piece named", () => {
    const set = booth({ screen: document.createElement("canvas") });
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

  it("stands a cup screen in place of the pegboard, and the pegboard back", () => {
    const canvas = document.createElement("canvas");
    const set = booth({ screen: canvas });
    const standing = () => new Set(set.children.filter((mesh) => mesh.visible).map((mesh) => mesh.name));
    const pegboard = ["pegboard", "pegboard frame", "peg hole"];
    const screen = ["cup screen", "cup screen frame"];
    expect(pegboard.every((piece) => standing().has(piece))).toBe(true);
    expect(screen.some((piece) => standing().has(piece))).toBe(false);

    standScreen(set, true);
    expect(screen.every((piece) => standing().has(piece))).toBe(true);
    expect(pegboard.some((piece) => standing().has(piece))).toBe(false);
    const glass = set.getObjectByName("cup screen");
    expect(glass.geometry.parameters).toMatchObject({ width: 0.445, height: 0.008, depth: 0.177 });
    expect(glass.position.toArray()).toEqual([0, 0.372, 0.31]);
    expect(glass.material[3].map.image).toBe(canvas);
    expect(glass.material[3].map.colorSpace).toBe(SRGBColorSpace);

    standScreen(set, false);
    expect(pegboard.every((piece) => standing().has(piece))).toBe(true);
    expect(screen.some((piece) => standing().has(piece))).toBe(false);
  });
});
