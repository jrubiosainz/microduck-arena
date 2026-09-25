import { describe, expect, it } from "vitest";
import { pegRow, runHall } from "./run.js";

describe("a publication's frame", () => {
  it("puts the stage in the same deck as the challenge page, keys included", () => {
    const page = runHall();
    expect(page.querySelector(".run-top > .deck > .stage > canvas#stage")).not.toBeNull();
    expect([...page.querySelectorAll(".deck > .controls button")].map((b) => b.id)).toEqual([
      "playpause", "follow", "walls", "names",
    ]);
  });

  it("carries no legend of its own: the caption sits alone under the picture", () => {
    const page = runHall();
    expect(page.querySelector(".key")).toBeNull();
    expect(page.querySelector("#legend")).toBeNull();
    expect(page.querySelector(".run-top > #facts")).not.toBeNull();
  });
});

describe("a pegboard row", () => {
  const row = {
    run_id: "r2", user: "alice", policy_name: "walker", rank: 2, score: 11.7, seeds_finished: 5, you: false,
  };

  it("wears its lane's colour while its duck is on the stage", () => {
    expect(pegRow(row, "#ff7a2f").style.getPropertyValue("--lane")).toBe("#ff7a2f");
  });

  it("wears none when it is not", () => {
    expect(pegRow(row).style.getPropertyValue("--lane")).toBe("");
  });
});
