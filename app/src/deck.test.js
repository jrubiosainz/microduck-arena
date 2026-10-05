import { describe, expect, it, vi } from "vitest";
import { deckMarkup, followKeyFor, wireDeck } from "./deck.js";

function stage() {
  const root = document.createElement("div");
  root.innerHTML = deckMarkup;
  const viewer = { follow: vi.fn() };
  wireDeck(root, viewer);
  return { root, viewer };
}

describe("the deck a replay plays on", () => {
  it("is the picture alone, the follow key riding it", () => {
    const { root } = stage();
    const deck = root.querySelector(".deck.stage");
    expect([...deck.children].map((n) => n.id)).toEqual(["stage", "follow"]);
  });

  it("shows the follow key only once the camera has been let go, and hands it back", () => {
    const { root, viewer } = stage();
    const follow = root.querySelector("#follow");
    expect(follow.hidden).toBe(true);
    followKeyFor(root)(false);
    expect(follow.hidden).toBe(false);
    follow.click();
    expect(viewer.follow).toHaveBeenCalledTimes(1);
    followKeyFor(root)(true);
    expect(follow.hidden).toBe(true);
  });
});
