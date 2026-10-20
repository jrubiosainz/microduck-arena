import { describe, expect, it } from "vitest";
import { boutLane } from "./bouts.js";

describe("boutLane", () => {
  it("puts each side on its end of the rope, west first, under its on-air name", () => {
    const match = { a: { livery: "blue", name: "Tank" }, b: { livery: "purple", name: "Lean" },
      bouts: [{ a_side: "west" }, { a_side: "east" }] };
    expect(boutLane(match, 1, ["tw", "te"], ["sw", "se"])).toEqual({ tug: "bout", ducks: [
      { trace: "tw", settle: "sw", livery: "purple", name: "Lean" },
      { trace: "te", settle: "se", livery: "blue", name: "Tank" }] });
  });
});
