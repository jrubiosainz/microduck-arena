import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The call's fetch is stood in, keyed on the match id; the replay is a bare
// recorder, since jsdom has no media pipeline.
const state = vi.hoisted(() => ({ calls: new Map() }));
vi.mock("../api.js", () => ({
  getCall: vi.fn((matchId) => Promise.resolve(state.calls.get(matchId) ?? null)),
}));

import { getCall } from "../api.js";
import { DUCKED, clipGain, createCall } from "./call.js";

const captions = [
  { speaker: "peter", name: "Peter Duckry", text: "The marker slides west!", start_ms: 2000, end_ms: 4000 },
  { speaker: "ray", name: "Ray Quackson", text: "Into the pit.", start_ms: 9000, end_ms: 11000 },
];
const plan = { version: 2, run_id: "tug-of-war-0001-003", duration_ms: 20000, captions, notes: [], gestures: [] };
const called = { kind: "replay", at_ms: 0, duration_ms: 20000, run_id: "tug-of-war-0001-003", clip: "v", media: "match", call: true };

describe("createCall", () => {
  let stage, replay, voice, call, context, clock, now;
  beforeEach(() => {
    // jsdom draws no 2D canvas: the captions measure nothing and show each line whole, as jsdom's own null would,
    // without its notice in every test.
    context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // The page's clock stands still unless a test moves it.
    clock = 0;
    now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    stage = document.createElement("div");
    replay = {
      prepare: vi.fn(), show: vi.fn(), play: vi.fn(async () => {}), seek: vi.fn(), stop: vi.fn(),
      muted: vi.fn(), volume: vi.fn(), failed: false,
    };
    voice = { start: vi.fn(), stop: vi.fn(), muted: vi.fn() };
    call = createCall(stage, { replay, audio: () => ({ voice }) });
  });
  afterEach(() => {
    context.mockRestore();
    now.mockRestore();
    state.calls.clear();
    vi.clearAllMocks();
  });
  const panel = () => stage.querySelector(".live-caption");
  const text = () => panel().querySelector(".live-caption-text").textContent;

  it("plays a match without a call as the replay alone", async () => {
    const slot = { kind: "replay", at_ms: 0, duration_ms: 8000, run_id: "A", clip: "v" };
    call.prepare(slot);
    call.show(slot);
    await call.play(slot, 0);
    expect(replay.prepare).toHaveBeenCalledWith(slot);
    expect(replay.show).toHaveBeenCalledWith(slot);
    expect(replay.play).toHaveBeenCalledWith(slot, 0);
    expect(getCall).not.toHaveBeenCalled();
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("voices and captions a called match from the offset it is joined at", async () => {
    state.calls.set(called.run_id, { lines: [], plan });
    call.prepare(called);
    call.prepare(called);
    await call.play(called, 3000);
    expect(getCall).toHaveBeenCalledTimes(1);
    expect(getCall).toHaveBeenCalledWith("tug-of-war-0001-003");
    expect(replay.play).toHaveBeenCalledWith(called, 3000);
    expect(voice.start).toHaveBeenCalledWith(plan, 3000);
    expect(panel().hidden).toBe(false);
    expect(text()).toBe("The marker slides west!");
    expect(replay.volume).toHaveBeenLastCalledWith(DUCKED);

    call.seek(5000);
    expect(replay.seek).toHaveBeenLastCalledWith(5000);
    expect(panel().hidden).toBe(true);
    expect(replay.volume).toHaveBeenLastCalledWith(1);

    call.seek(9500);
    expect(panel().hidden).toBe(false);
    expect(text()).toBe("Into the pit.");
    expect(replay.volume).toHaveBeenLastCalledWith(DUCKED);

    call.stop();
    expect(panel().hidden).toBe(true);
    expect(voice.stop).toHaveBeenCalled();
    expect(replay.stop).toHaveBeenCalled();
    expect(replay.volume).toHaveBeenLastCalledWith(1);
  });

  it("voices a call fetched as the screen joins from where the match has got to once it lands", async () => {
    getCall.mockImplementationOnce(async () => {
      clock += 400; // the round trip
      return { lines: [], plan };
    });
    clock = 1000;
    await call.play(called, 3000);
    expect(replay.play).toHaveBeenCalledWith(called, 3000);
    expect(voice.start).toHaveBeenCalledWith(plan, 3400);
    expect(text()).toBe("The marker slides west!");
  });

  it("ducks the clip's own sound about 10 dB while a line is voiced, and restores it between lines", () => {
    expect([0, 2000, 3999, 4000, 9500, 11000].map((ms) => clipGain(plan, ms))).toEqual([1, DUCKED, DUCKED, 1, DUCKED, 1]);
    expect(20 * Math.log10(DUCKED)).toBeCloseTo(-10);
  });

  it("a call that is not there leaves the match to play", async () => {
    await call.play(called, 3000);
    call.seek(3100);
    expect(replay.play).toHaveBeenCalledWith(called, 3000);
    expect(replay.seek).toHaveBeenLastCalledWith(3100);
    expect(voice.start).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(true);
    expect(replay.volume.mock.calls.every(([gain]) => gain === 1)).toBe(true);
    expect(call.failed).toBe(false);
    replay.failed = true;
    expect(call.failed).toBe(true);
  });

  it("asks again as its match plays for a call that was not there when it was prepared, and only then", async () => {
    // Not served yet, or a network blip: prepared on every frame from 25 s before, it is asked for once.
    call.prepare(called);
    await Promise.resolve();
    call.prepare(called);
    expect(getCall).toHaveBeenCalledTimes(1);
    state.calls.set(called.run_id, { lines: [], plan });
    await call.play(called, 3000);
    expect(getCall).toHaveBeenCalledTimes(2);
    expect(voice.start).toHaveBeenCalledWith(plan, 3000);
    expect(text()).toBe("The marker slides west!");
  });

  it("leaves a call that lands after its match was stopped unvoiced", async () => {
    let land;
    getCall.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));
    const playing = call.play(called, 0);
    call.stop();
    land({ lines: [], plan });
    await playing;
    call.seek(2500);
    expect(voice.start).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(true);
  });

  it("leaves a match whose clip failed to load unvoiced, under the panel that holds over it", async () => {
    state.calls.set(called.run_id, { lines: [], plan });
    replay.failed = true;
    await call.play(called, 3000);
    expect(replay.play).toHaveBeenCalledWith(called, 3000);
    expect(voice.start).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(true);
  });

  it("mutes the clip and the voice together", () => {
    call.muted(true);
    expect(replay.muted).toHaveBeenLastCalledWith(true);
    expect(voice.muted).toHaveBeenLastCalledWith(true);
    call.muted(false);
    expect(replay.muted).toHaveBeenLastCalledWith(false);
    expect(voice.muted).toHaveBeenLastCalledWith(false);
  });
});
