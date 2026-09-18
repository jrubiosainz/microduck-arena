import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStage, renderLive } from "./live.js";

describe("buildStage", () => {
  it("is one stage with a bug, a card and a join button, and nothing else", () => {
    const root = document.createElement("div");
    const { page, stage, bug, card, join } = buildStage(root);
    expect(root.children).toHaveLength(1);
    expect(page.matches("main.live")).toBe(true);
    expect(stage.matches(".live-stage")).toBe(true);
    expect(bug.textContent).toBe("LIVE");
    expect(card.hidden).toBe(true);
    expect(join.hidden).toBe(true);
    expect(join.textContent).toBe("JOIN THE LIVE");
  });
});

describe("renderLive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is off air on an empty grid and keeps polling", async () => {
    const root = document.createElement("div");
    const state = {};
    const api = { getLive: vi.fn(async () => ({ version: 1, now_ms: 5000, build: "b", slots: [] })) };
    await renderLive(root, state, { api });
    const page = root.querySelector("main.live");
    expect(page.dataset.liveState).toBe("off-air");
    expect(page.querySelector(".live-card").hidden).toBe(false);
    expect(page.querySelector(".live-card").textContent).toBe("OFF AIR");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.getLive).toHaveBeenCalledTimes(2);
    state.teardown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.getLive).toHaveBeenCalledTimes(2);
  });

  it("forgives a lost poll for half a minute once the clock is set", async () => {
    const root = document.createElement("div");
    const grid = { version: 1, now_ms: 5000, build: "b", slots: [{ at_ms: 0, duration_ms: 60_000 }] };
    let up = true;
    const api = { getLive: vi.fn(async () => { if (!up) throw new Error("down"); return grid; }) };
    await renderLive(root, {}, { api });
    const page = root.querySelector("main.live");
    expect(page.dataset.liveState).toBe("live");
    up = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.dataset.liveState).toBe("live");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.dataset.liveState).toBe("live");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.dataset.liveState).toBe("reconnecting");
    up = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.dataset.liveState).toBe("live");
  });

  it("says reconnecting when the grid cannot be read", async () => {
    const root = document.createElement("div");
    const api = { getLive: vi.fn(async () => { throw new Error("down"); }) };
    await renderLive(root, {}, { api });
    expect(root.querySelector("main.live").dataset.liveState).toBe("reconnecting");
  });
});
