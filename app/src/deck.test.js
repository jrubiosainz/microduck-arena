import { describe, expect, it, vi } from "vitest";
import { deckMarkup, followKeyFor, wireDeck } from "./deck.js";

function stage() {
  const root = document.createElement("div");
  root.innerHTML = deckMarkup;
  const viewer = {
    player: { playing: true, toggle() { this.playing = !this.playing; } },
    follow: vi.fn(),
    setNamesVisible: (visible) => visible,
  };
  return { root, viewer, deck: wireDeck(root, viewer) };
}

describe("the deck under a replay", () => {
  it("is one chassis: the picture, then the three keys and the hint", () => {
    const { root } = stage();
    expect(root.querySelector(".deck > .stage > canvas#stage")).not.toBeNull();
    expect([...root.querySelectorAll(".deck > .controls button")].map((b) => b.id)).toEqual([
      "playpause", "follow", "names",
    ]);
    expect(root.querySelector(".deck > .controls #stage-hint")).not.toBeNull();
  });

  it("toggles the names, saying so in the label and in aria-pressed", () => {
    const { root } = stage();
    for (const [id, thing] of [["names", "names"]]) {
      const key = root.querySelector(`#${id}`);
      expect(key.textContent).toBe(`Show ${thing}`);
      key.click();
      expect(key.textContent).toBe(`Hide ${thing}`);
      expect(key.getAttribute("aria-pressed")).toBe("true");
      key.click();
      expect(key.textContent).toBe(`Show ${thing}`);
      expect(key.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("pauses and plays the replay, and a fresh replay reads Pause again", () => {
    const { root, deck } = stage();
    const key = root.querySelector("#playpause");
    key.click();
    expect(key.textContent).toBe("Play");
    key.click();
    expect(key.textContent).toBe("Pause");
    key.click();
    deck.reset();
    expect(key.textContent).toBe("Pause");
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
