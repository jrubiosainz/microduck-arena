import { describe, expect, it } from "vitest";
import { curvePath, renderCurve } from "./curve.js";

describe("the reward curve", () => {
  it("spans the box from the first iteration to the last, low reward at the bottom", () => {
    expect(curvePath([[0, -1], [10, 1]], 100, 50)).toBe("M0.0,50.0 L100.0,0.0");
  });

  it("draws nothing from fewer than two points, and no NaN from a flat line", () => {
    expect(curvePath([[1, 0.5]], 100, 50)).toBe("");
    expect(curvePath([[0, 2], [5, 2]], 100, 50)).not.toMatch(/NaN/);
  });

  it("does not throw on a full-size TensorBoard run", () => {
    const points = Array.from({ length: 200000 }, (_, i) => [i, Math.sin(i)]);
    const path = curvePath(points, 400, 120);
    expect(path.startsWith("M")).toBe(true);
  });

  it("says why there is no curve yet", () => {
    const figure = document.createElement("figure");
    renderCurve(figure, []);
    expect(figure.textContent).toMatch(/No curve yet/);
    renderCurve(figure, [[1, -0.63], [2, -0.52]]);
    expect(figure.textContent).toContain("-0.52 at iteration 2");
  });
});
