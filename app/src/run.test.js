import { describe, expect, it } from "vitest";
import { runHall } from "./run.js";

describe("a publication's frame", () => {
  it("puts the stage in the same deck as the challenge page, keys included", () => {
    const page = runHall();
    expect(page.querySelector(".run-top > .deck > .stage > canvas#stage")).not.toBeNull();
    expect([...page.querySelectorAll(".deck > .controls button")].map((b) => b.id)).toEqual([
      "playpause", "follow", "walls", "names",
    ]);
  });

  it("hangs the challenge page's board sheet under the picture, and no legend", () => {
    const page = runHall();
    expect(page.querySelector(".run-board > .boardsheet > .boardtop")).not.toBeNull();
    expect(page.querySelector(".run-board > .boardsheet > #board")).not.toBeNull();
    expect(page.querySelector(".pegboard")).toBeNull();
    expect(page.querySelector(".key")).toBeNull();
    expect(page.querySelector(".run-top > #facts")).not.toBeNull();
  });
});
