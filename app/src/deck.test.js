import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HINT_DELAY_MS, deckMarkup, followKeyFor, offerOrbit, wireDeck } from "./deck.js";

function stage() {
  const root = document.createElement("div");
  root.innerHTML = deckMarkup;
  const viewer = { follow: vi.fn(), sweep: vi.fn() };
  wireDeck(root, viewer);
  return { root, viewer };
}

describe("the deck a replay plays on", () => {
  it("is the picture alone, the follow key and the hint riding it", () => {
    const { root } = stage();
    const deck = root.querySelector(".deck.stage");
    expect([...deck.children].map((n) => n.id || n.className)).toEqual(["stage", "follow", "orbit-hint"]);
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

describe("the hint that the camera can be moved", () => {
  let stored;
  let reduced;
  let animations;

  beforeEach(() => {
    vi.useFakeTimers();
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
    });
    reduced = false;
    vi.stubGlobal("matchMedia", (query) => ({ matches: reduced && query.includes("reduce") }));
    animations = [];
    Element.prototype.animate = function () {
      let finish;
      const animation = { node: this, finished: new Promise((resolve) => { finish = resolve; }), finish: () => finish() };
      animations.push(animation);
      return animation;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete Element.prototype.animate;
    document.body.replaceChildren();
  });

  function page() {
    const { root, viewer } = stage();
    document.body.append(root);
    return { root, viewer, hint: root.querySelector(".orbit-hint") };
  }

  it("shows a moment into the replay, the camera swinging with the hand, and goes", async () => {
    const { root, viewer, hint } = page();
    offerOrbit(root, viewer);
    expect(hint.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(HINT_DELAY_MS);
    expect(hint.hidden).toBe(false);
    expect(viewer.sweep).toHaveBeenCalledTimes(1);
    expect(animations.map((one) => one.node.className.baseVal ?? one.node.className)).toEqual(["symbol", "orbit-hint"]);
    animations.forEach((one) => one.finish());
    await vi.runAllTimersAsync();
    expect(hint.hidden).toBe(true);
  });

  it("is not shown to someone who has moved a camera before", async () => {
    stored.set("arena.orbited", "1");
    const { root, viewer, hint } = page();
    offerOrbit(root, viewer);
    await vi.advanceTimersByTimeAsync(HINT_DELAY_MS);
    expect(hint.hidden).toBe(true);
    expect(viewer.sweep).not.toHaveBeenCalled();
  });

  it("is put away, and remembered, the moment the camera is let go", async () => {
    const { root, viewer, hint } = page();
    offerOrbit(root, viewer);
    await vi.advanceTimersByTimeAsync(HINT_DELAY_MS);
    followKeyFor(root)(false);
    expect(hint.hidden).toBe(true);
    expect(stored.get("arena.orbited")).toBe("1");
  });

  it("comes back on every page until the camera has been moved, never on a page since left", async () => {
    const { root, viewer } = page();
    const another = (connected) => {
      const next = document.createElement("div");
      next.innerHTML = deckMarkup;
      if (connected) document.body.append(next);
      return next;
    };
    const offer = async (on) => {
      offerOrbit(on, viewer);
      await vi.advanceTimersByTimeAsync(HINT_DELAY_MS);
      return on.querySelector(".orbit-hint").hidden;
    };

    expect(await offer(another(false))).toBe(true);
    expect(await offer(root)).toBe(false);
    const next = another(true);
    expect(await offer(next)).toBe(false);
    expect(viewer.sweep).toHaveBeenCalledTimes(2);

    followKeyFor(next)(false);
    expect(await offer(another(true))).toBe(true);
    expect(viewer.sweep).toHaveBeenCalledTimes(2);
  });

  it("holds the camera and the hand still for someone who asked for less motion", async () => {
    reduced = true;
    const { root, viewer, hint } = page();
    offerOrbit(root, viewer);
    await vi.advanceTimersByTimeAsync(HINT_DELAY_MS);
    expect(hint.hidden).toBe(false);
    expect(viewer.sweep).not.toHaveBeenCalled();
    expect(animations.map((one) => one.node.className)).toEqual(["orbit-hint"]);
  });
});
