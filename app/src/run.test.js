import { describe, expect, it } from "vitest";
import { receiptCard, runHall } from "./run.js";

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
