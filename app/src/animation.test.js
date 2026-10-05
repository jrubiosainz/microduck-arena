import { afterEach, describe, expect, it, vi } from "vitest";
import { ended } from "./animation.js";

/** A CSS animation as getAnimations reports it: its name, and the element or pseudo it runs on. */
const animation = (name, target, pseudoElement = null) => ({
  animationName: name,
  effect: { target, pseudoElement },
});

const animationEnd = (name, pseudoElement = "") =>
  Object.assign(new Event("animationend"), { animationName: name, pseudoElement });

describe("ended", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives up a frame later when the awaited pseudo has no animation, even if its sibling has one", async () => {
    // The chip's tiles once hid their ::after: only ::before rolled, and the reveal waited forever.
    vi.stubGlobal("requestAnimationFrame", (fn) => setTimeout(fn, 0));
    const tile = document.createElement("span");
    tile.getAnimations = () => [animation("flip-roll", tile, "::before")];
    await expect(ended(tile, "flip-roll", "::after")).resolves.toBeUndefined();
  });

  it("waits for the awaited pseudo's own animationend", async () => {
    vi.stubGlobal("requestAnimationFrame", (fn) => setTimeout(fn, 0));
    const tile = document.createElement("span");
    tile.getAnimations = () => [
      animation("flip-roll", tile, "::before"),
      animation("flip-roll", tile, "::after"),
    ];
    let done = false;
    const waiting = ended(tile, "flip-roll", "::after").then(() => (done = true));
    await new Promise((there) => setTimeout(there, 5));
    tile.dispatchEvent(animationEnd("flip-roll", "::before"));
    await new Promise((there) => setTimeout(there, 0));
    expect(done).toBe(false);
    tile.dispatchEvent(animationEnd("flip-roll", "::after"));
    await waiting;
    expect(done).toBe(true);
  });
});
