import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The booth needs WebGL, which jsdom has not: stood in with a bare recorder,
// as in live.test.js. The fetches are stood in too, keyed on the broadcast id
// and on a desk segment's address in its cup's show.
const state = vi.hoisted(() => ({ booths: [], broadcasts: new Map(), shows: new Map() }));
vi.mock("./booth.js", () => ({
  createBooth: async () => {
    const booth = { prepare: vi.fn(), draw: vi.fn(() => null), resize: vi.fn(), dispose: vi.fn() };
    state.booths.push(booth);
    return booth;
  },
}));
vi.mock("../api.js", () => ({
  getBroadcast: vi.fn((id) => Promise.resolve(state.broadcasts.get(id) ?? null)),
  getShow: vi.fn((event, number, segment) => Promise.resolve(state.shows.get(`${event}/${number}/${segment}`) ?? null)),
  clipUrl: (runId, name, version) => `/api/runs/${runId}/clip/${name}?v=${version}`,
}));

import { getShow } from "../api.js";
import { createInterlude } from "./interlude.js";

const desk = {
  kind: "desk", at_ms: 0, duration_ms: 12000,
  show: { event: "tug-of-war", number: 1, segment: "intro-tug-of-war-0001-002" },
};
// A desk segment's file, as the show route serves it: the cup screen's view rides with the dialogue.
const segment = {
  dialogue: { turns: [{ speaker: "peter", text: "Group B, Ray." }] },
  plan: { duration_ms: 12000, captions: [] },
  screen: { title: "Tug of War · Cup #1", stage: "Groups · round 1 of 3", groups: [], knockout: [], next: null, champion: null },
};

describe("createInterlude", () => {
  let context, clock, now;
  beforeEach(() => {
    // jsdom draws no 2D canvas: the captions measure nothing and show each line whole, as jsdom's own null would,
    // without its notice in every test.
    context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // The page's clock stands still unless a test moves it.
    clock = 0;
    now = vi.spyOn(performance, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    context.mockRestore();
    now.mockRestore();
    state.booths.length = 0;
    state.broadcasts.clear();
    state.shows.clear();
    vi.clearAllMocks();
  });

  it("mounts a run's second airing on its own dialogue instead of the first's", async () => {
    const first = { kind: "booth", at_ms: 0, duration_ms: 1000, run_id: "A", broadcast: "b1", clip: "20260916T100500Z" };
    const second = { kind: "booth", at_ms: 1000, duration_ms: 1000, run_id: "A", broadcast: "b2", clip: "20260916T100500Z" };
    const dialogue1 = { dialogue: { turns: [{ text: "one" }] }, plan: { duration_ms: 1000, captions: [] } };
    const dialogue2 = { dialogue: { turns: [{ text: "two" }] }, plan: { duration_ms: 1000, captions: [] } };
    state.broadcasts.set("b1", dialogue1);
    state.broadcasts.set("b2", dialogue2);

    const stage = document.createElement("div");
    const interlude = await createInterlude(stage, { audio: () => null });
    const booth = state.booths[0];

    await interlude.show(first);
    expect(booth.prepare).toHaveBeenLastCalledWith(dialogue1, "/api/runs/A/clip/poster.png?v=20260916T100500Z");

    await interlude.show(second);
    expect(booth.prepare).toHaveBeenCalledTimes(2);
    expect(booth.prepare).toHaveBeenLastCalledWith(dialogue2, "/api/runs/A/clip/poster.png?v=20260916T100500Z");
  });

  it("hands the booth a desk segment's file, cup screen and all, with no poster, and a run's airing its broadcast and poster", async () => {
    const airing = { kind: "booth", at_ms: 12000, duration_ms: 1000, run_id: "A", broadcast: "b1", clip: "20260916T100500Z" };
    const dialogue = { dialogue: { turns: [{ text: "one" }] }, plan: { duration_ms: 1000, captions: [] } };
    state.shows.set("tug-of-war/1/intro-tug-of-war-0001-002", segment);
    state.broadcasts.set("b1", dialogue);
    const interlude = await createInterlude(document.createElement("div"), { audio: () => null });
    const booth = state.booths[0];

    interlude.prepare(desk);
    await interlude.show(desk);
    expect(getShow).toHaveBeenCalledTimes(1);
    expect(getShow).toHaveBeenCalledWith("tug-of-war", 1, "intro-tug-of-war-0001-002");
    // A file that carries a screen stands the cup screen in place of the pegboard.
    expect(booth.prepare).toHaveBeenLastCalledWith(segment, null);

    // A broadcast carries none, so the pegboard is back behind the run's airing.
    await interlude.show(airing);
    expect(booth.prepare).toHaveBeenCalledTimes(2);
    expect(booth.prepare).toHaveBeenLastCalledWith(dialogue, "/api/runs/A/clip/poster.png?v=20260916T100500Z");
  });

  it("sets a desk joined late before its voice starts at the offset", async () => {
    state.shows.set("tug-of-war/1/intro-tug-of-war-0001-002", segment);
    const order = [];
    const voice = { start: vi.fn(() => order.push("voice")), stop: vi.fn(), muted: vi.fn() };
    const ambience = { start: vi.fn(), stop: vi.fn(), muted: vi.fn() };
    const interlude = await createInterlude(document.createElement("div"), { audio: () => ({ voice, ambience }) });
    const booth = state.booths[0];
    booth.prepare.mockImplementation(() => order.push("booth"));

    await interlude.play(desk, 7000);
    expect(booth.prepare).toHaveBeenCalledWith(segment, null);
    expect(voice.start).toHaveBeenCalledWith(segment.plan, 7000);
    expect(order).toEqual(["booth", "voice"]);
    expect(booth.draw).toHaveBeenLastCalledWith(7000);
  });

  it("starts a desk joined late from where the segment has got to once its file lands", async () => {
    const voice = { start: vi.fn(), stop: vi.fn(), muted: vi.fn() };
    const ambience = { start: vi.fn(), stop: vi.fn(), muted: vi.fn() };
    const interlude = await createInterlude(document.createElement("div"), { audio: () => ({ voice, ambience }) });
    getShow.mockImplementationOnce(async () => {
      clock += 400; // the round trip
      return segment;
    });
    await interlude.play(desk, 7000);
    expect(voice.start).toHaveBeenCalledWith(segment.plan, 7400);
    expect(state.booths[0].draw).toHaveBeenLastCalledWith(7400);
  });

  it("draws nothing of the last desk at the next one's offset while the next one's file is on its way", async () => {
    state.shows.set("tug-of-war/1/intro-tug-of-war-0001-002", segment);
    const stage = document.createElement("div");
    const interlude = await createInterlude(stage, { audio: () => null });
    const booth = state.booths[0];
    booth.draw.mockReturnValue({ name: "Peter Duckry", text: "Group B, Ray." });
    await interlude.play(desk, 1000);
    expect(booth.draw).toHaveBeenLastCalledWith(1000);

    // Straight on to the next desk, its file not in yet.
    const next = { ...desk, at_ms: 12000, show: { ...desk.show, segment: "intro-tug-of-war-0001-003" } };
    const following = { ...segment, dialogue: { turns: [{ speaker: "ray", text: "Group C now." }] } };
    let land;
    getShow.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));
    interlude.stop();
    const playing = interlude.play(next, 0);
    booth.draw.mockClear();
    interlude.seek(100);
    expect(booth.draw).not.toHaveBeenCalled();
    expect(stage.querySelector(".live-caption").hidden).toBe(true);

    land(following);
    await playing;
    expect(booth.prepare).toHaveBeenLastCalledWith(following, null);
    expect(booth.draw).toHaveBeenLastCalledWith(0);
  });
});
