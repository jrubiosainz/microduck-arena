import { describe, expect, it } from "vitest";
import { receiptCard, replayLine, runHall, verdict } from "./run.js";

const STAGE = { title: "MicroDuck Got a Talent", course: "stage", metric: "votes" };

describe("a receipt", () => {
  it("is a small card, not a sticker to press: the points over what they were for", () => {
    const card = receiptCard({ act: "first_event", points: 100 });
    expect(card.tagName).not.toBe("BUTTON");
    expect(card.classList.contains("receipt")).toBe(true);
    expect(card.classList.contains("sticker")).toBe(false);
    expect(card.querySelector(".receipt-points").textContent).toBe("+100");
    expect(card.querySelector(".mono-label").textContent).toBe("first entry");
  });

  it("wears its act's colour on its edge", () => {
    expect(receiptCard({ act: "podium", points: 250 }).classList.contains("receipt-magenta")).toBe(true);
    expect(receiptCard({ act: "run", points: 10 }).classList.contains("receipt-cyan")).toBe(true);
  });
});

describe("a publication's frame", () => {
  it("puts the stage in the same deck as the challenge page, keys included", () => {
    const page = runHall();
    expect(page.querySelector(".run-top > .deck > .stage > canvas#stage")).not.toBeNull();
    expect([...page.querySelectorAll(".deck > .controls button")].map((b) => b.id)).toEqual([
      "playpause", "follow", "names",
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

describe("a performance's scoreboard", () => {
  it("says its length and that it was performed, or cut short", () => {
    expect(verdict({ event: STAGE, seeds_finished: 1, seeds_total: 1 })).toEqual({ label: "length", stamp: "PERFORMED" });
    expect(verdict({ event: STAGE, seeds_finished: 0, seeds_total: 1 })).toEqual({ label: "length", stamp: "CUT SHORT" });
  });
  it("keeps a race's time and seeds", () => {
    expect(verdict({ event: { course: "lane" }, seeds_finished: 4, seeds_total: 5 })).toEqual({ label: "time", stamp: "FINISHED 4/5" });
  });
  it("replays the whole performance, at no speed and no seed", () => {
    expect(replayLine({ event: STAGE, command_vx: 0, seeds_finished: 1, per_seed: [], trace_seed: 1 })).toBe("replay: the whole performance");
  });
});
