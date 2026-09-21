import { afterEach, describe, expect, it, vi } from "vitest";

// The booth needs WebGL, which jsdom has not: stood in with a bare recorder,
// as in live.test.js. The fetch is stood in too, keyed on the broadcast id.
const state = vi.hoisted(() => ({ booths: [], broadcasts: new Map() }));
vi.mock("./booth.js", () => ({
  createBooth: async () => {
    const booth = { prepare: vi.fn(), draw: vi.fn(() => null), resize: vi.fn(), dispose: vi.fn() };
    state.booths.push(booth);
    return booth;
  },
}));
vi.mock("../api.js", () => ({
  getBroadcast: vi.fn((id) => Promise.resolve(state.broadcasts.get(id) ?? null)),
  clipUrl: (runId, name) => `/api/runs/${runId}/clip/${name}`,
}));

import { createInterlude } from "./interlude.js";

describe("createInterlude", () => {
  afterEach(() => {
    state.booths.length = 0;
    state.broadcasts.clear();
    vi.clearAllMocks();
  });

  it("mounts a run's second airing on its own dialogue instead of the first's", async () => {
    const first = { kind: "booth", at_ms: 0, duration_ms: 1000, run_id: "A", broadcast: "b1" };
    const second = { kind: "booth", at_ms: 1000, duration_ms: 1000, run_id: "A", broadcast: "b2" };
    const dialogue1 = { dialogue: { turns: [{ text: "one" }] }, plan: { duration_ms: 1000, captions: [] } };
    const dialogue2 = { dialogue: { turns: [{ text: "two" }] }, plan: { duration_ms: 1000, captions: [] } };
    state.broadcasts.set("b1", dialogue1);
    state.broadcasts.set("b2", dialogue2);

    const stage = document.createElement("div");
    const interlude = await createInterlude(stage, { audio: () => null });
    const booth = state.booths[0];

    await interlude.show(first);
    expect(booth.prepare).toHaveBeenLastCalledWith(dialogue1, "/api/runs/A/clip/poster.png");

    await interlude.show(second);
    expect(booth.prepare).toHaveBeenCalledTimes(2);
    expect(booth.prepare).toHaveBeenLastCalledWith(dialogue2, "/api/runs/A/clip/poster.png");
  });
});
