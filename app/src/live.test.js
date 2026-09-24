import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStage, openSound, renderLive } from "./live.js";

// The booth needs WebGL, which jsdom has not: the page is tested with a
// segment that shows a bare canvas. `gate` holds its loading open for the
// test that leaves the page while it loads.
const gate = vi.hoisted(() => ({ open: Promise.resolve(), last: null }));
vi.mock("./live/interlude.js", () => ({
  createInterlude: async (stage) => {
    await gate.open;
    const canvas = document.createElement("canvas");
    canvas.className = "live-booth";
    canvas.hidden = true;
    stage.append(canvas);
    gate.last = {
      failed: false, size: null,
      prepare() {}, show() { canvas.hidden = false; }, play() { canvas.hidden = false; }, seek() {},
      stop() { canvas.hidden = true; }, muted() {}, resize(w, h) { this.size = [w, h]; }, dispose: vi.fn(),
    };
    return gate.last;
  },
}));
vi.mock("./live/voice.js", () => ({
  createVoice: vi.fn(() => ({ start() {}, stop() {}, muted() {}, gust() {} })),
  loadTones: async () => ({}),
}));
vi.mock("./live/ambience.js", () => ({ createAmbience: async () => ({ start() {}, stop() {}, muted() {} }) }));

// jsdom has no media pipeline: play, load and buffered are stubbed on the
// page's two videos, as in replay.test.js.
function stubMedia(root) {
  for (const video of root.querySelectorAll("video")) {
    video.load = vi.fn();
    video.pause = vi.fn();
    video.play = vi.fn(() => Promise.resolve());
    for (const [name, value] of [["buffered", { length: 1, start: () => 0, end: () => 30 }],
                                 ["currentTime", 0], ["playbackRate", 1], ["error", null]]) {
      if (!Object.getOwnPropertyDescriptor(video, name)) {
        Object.defineProperty(video, name, { value, writable: true, configurable: true });
      }
    }
  }
}

/** A browser's sound: running from the start (a kiosk), or only once `start` says the context runs. */
function fakeSound({ running = false } = {}) {
  let resolve;
  const audio = { context: { currentTime: 0 }, voice: { start() {}, stop() {}, muted() {}, gust() {} }, ambience: {} };
  const opened = new Promise((r) => { resolve = r; });
  const sound = {
    running,
    start() { sound.running = true; resolve(audio); },
    ask: vi.fn(),
    open: vi.fn(() => { if (sound.running) resolve(audio); return opened; }),
    close: vi.fn(),
  };
  return sound;
}

const shown = (root) => [...root.querySelectorAll("video.live-video")].find((v) => !v.hidden) ?? null;

const grid = {
  version: 1, now_ms: 5000, build: "b",
  slots: [
    { kind: "shutter", at_ms: 4000, duration_ms: 1600, next: { run_id: "A", event: "2 m Sprint", user: "carol" } },
    { kind: "replay", at_ms: 5600, duration_ms: 8000, run_id: "A", clip: "20260916T100500Z" },
    { kind: "shutter", at_ms: 13600, duration_ms: 1600, next: null },
    { kind: "booth", at_ms: 15200, duration_ms: 20000, run_id: "A" },
  ],
};
const empty = { version: 1, now_ms: 5000, build: "b", slots: [] };

describe("buildStage", () => {
  it("is one stage with a bug, a card wearing the wordmark, a join button, and nothing else", () => {
    const root = document.createElement("div");
    const { page, stage, bug, card, join } = buildStage(root);
    expect(root.children).toHaveLength(1);
    expect(page.matches("main.live")).toBe(true);
    expect(stage.matches(".live-stage")).toBe(true);
    expect(bug.textContent).toBe("LIVE");
    expect(card.hidden).toBe(true);
    expect(card.querySelector(".wordmark")).not.toBeNull();
    expect(card.querySelector(".live-card-word").textContent).toBe("OFF AIR");
    expect(join.hidden).toBe(true);
    expect(join.textContent).toBe("JOIN THE LIVE");
  });

  it("is a plain box wearing the framed class, never a second main", () => {
    const { page } = buildStage(document.createElement("div"), true);
    expect(page.matches("div.live.live--framed")).toBe(true);
  });
});

describe("renderLive", () => {
  let hidden, reduced;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    reduced = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    globalThis.matchMedia = () => ({ matches: reduced });
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(target) {
        Object.defineProperty(target, "clientWidth", { value: 640, configurable: true });
        Object.defineProperty(target, "clientHeight", { value: 360, configurable: true });
        this.callback();
      }
      disconnect() {}
    };
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  afterEach(() => {
    vi.useRealTimers();
    gate.open = Promise.resolve();
  });
  const options = (getLive, sound = fakeSound({ running: true })) => ({ api: { getLive }, tones: async () => ({}), sound: () => sound });

  it("is off air on an empty grid, keeps polling, and stops with the page", async () => {
    const root = document.createElement("div");
    const state = {};
    const getLive = vi.fn(async () => empty);
    const sound = fakeSound({ running: true });
    await renderLive(root, state, options(getLive, sound));
    const page = root.querySelector("main.live");
    expect(page.dataset.liveState).toBe("off-air");
    expect(page.querySelector(".live-card").hidden).toBe(false);
    expect(page.querySelector(".live-join").hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getLive).toHaveBeenCalledTimes(2);
    state.teardown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getLive).toHaveBeenCalledTimes(2);
    expect(sound.close).toHaveBeenCalledTimes(1);
  });

  it("raises the join button over a picture that plays on when the browser withholds sound, and the click never waits on the sound", async () => {
    const root = document.createElement("div");
    const sound = fakeSound();
    await renderLive(root, {}, options(vi.fn(async () => grid), sound));
    stubMedia(root);
    const join = root.querySelector(".live-join");
    await vi.advanceTimersByTimeAsync(1000);
    expect(join.hidden).toBe(false);
    const video = shown(root);
    expect(video.play).toHaveBeenCalledTimes(1);
    join.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(join.hidden).toBe(true);
    expect(sound.ask).toHaveBeenCalledTimes(1);
    expect(sound.open).toHaveBeenCalledTimes(1);
    // The sound never lands; the clip plays again all the same, on the clock.
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown(root)).toBe(video);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(video.currentTime).toBeGreaterThan(2.4);
  });

  it("lowers the button on its own when a slow context starts late, with no click", async () => {
    const root = document.createElement("div");
    const sound = fakeSound();
    await renderLive(root, {}, options(vi.fn(async () => grid), sound));
    stubMedia(root);
    const join = root.querySelector(".live-join");
    await vi.advanceTimersByTimeAsync(1000);
    expect(join.hidden).toBe(false);
    const video = shown(root);
    sound.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(join.hidden).toBe(true);
    expect(sound.ask).not.toHaveBeenCalled();
    expect(shown(root)).toBe(video);
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("asks again after an open that failed, rather than falling silent for the page's life", async () => {
    const root = document.createElement("div");
    const audio = { context: { currentTime: 0 }, voice: { start() {}, stop() {}, muted() {}, gust() {} }, ambience: {} };
    let attempts = 0;
    const sound = {
      running: true,
      ask: vi.fn(),
      open: vi.fn(async () => {
        if (attempts++ === 0) throw new Error("no voice");
        return audio;
      }),
      close: vi.fn(),
    };
    await renderLive(root, {}, options(vi.fn(async () => grid), sound));
    stubMedia(root);
    const join = root.querySelector(".live-join");
    // The context runs, so nothing else would raise the button: the failure does.
    await vi.advanceTimersByTimeAsync(1000);
    expect(join.hidden).toBe(false);
    join.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sound.open).toHaveBeenCalledTimes(2);
    expect(join.hidden).toBe(true);
  });

  it("keeps the button up when the browser hands back no sound at all, and asks again on the click", async () => {
    const root = document.createElement("div");
    const audio = { context: { currentTime: 0 }, voice: { start() {}, stop() {}, muted() {}, gust() {} }, ambience: {} };
    let attempts = 0;
    const sound = {
      // A context that says it runs and still gives nothing back: a phone that
      // took a call while the page was joining.
      running: true,
      ask: vi.fn(),
      open: vi.fn(async () => (attempts++ === 0 ? null : audio)),
      close: vi.fn(),
    };
    await renderLive(root, {}, options(vi.fn(async () => grid), sound));
    stubMedia(root);
    const join = root.querySelector(".live-join");
    await vi.advanceTimersByTimeAsync(1000);
    expect(join.hidden).toBe(false);
    join.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sound.open).toHaveBeenCalledTimes(2);
    expect(sound.ask).toHaveBeenCalledTimes(1);
    expect(join.hidden).toBe(true);
  });

  it("forgives a lost poll for half a minute once the clock is set", async () => {
    const root = document.createElement("div");
    let up = true;
    const getLive = vi.fn(async () => { if (!up) throw new Error("down"); return grid; });
    await renderLive(root, {}, options(getLive));
    stubMedia(root);
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
    await renderLive(root, {}, options(vi.fn(async () => { throw new Error("down"); })));
    expect(root.querySelector("main.live").dataset.liveState).toBe("reconnecting");
  });

  it("plays the slot the clock is in, cuts at the shutter's midpoint, and announces the next replay", async () => {
    const root = document.createElement("div");
    await renderLive(root, {}, options(vi.fn(async () => grid)));
    stubMedia(root);
    const page = root.querySelector("main.live");
    const panel = page.querySelector(".live-shutter");
    const booth = page.querySelector("canvas.live-booth");
    expect(page.style.getPropertyValue("--stage-px")).toBe("640");
    expect(gate.last.size).toEqual([640, 360]);
    // 5 016 ms: inside the first shutter, past its midpoint, so the next
    // replay's first frame waits underneath and the card announces it.
    await vi.advanceTimersByTimeAsync(20);
    expect(panel.hidden).toBe(false);
    expect(panel.classList.contains("live-shutter-out")).toBe(true);
    expect(panel.querySelector(".live-upnext-event").textContent).toBe("2 m Sprint");
    expect(panel.querySelector(".live-upnext-user").textContent).toBe("@carol");
    let video = shown(root);
    expect(video.getAttribute("src")).toBe("/api/runs/A/clip/landscape.mp4?v=20260916T100500Z");
    expect(video.play).not.toHaveBeenCalled();
    // 5 700 ms: the replay, 100 ms in.
    await vi.advanceTimersByTimeAsync(680);
    expect(panel.hidden).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBeGreaterThanOrEqual(0);
    expect(video.currentTime).toBeLessThan(0.2);
    // 13 700 ms: the next shutter sweeps in over the clip's last picture.
    await vi.advanceTimersByTimeAsync(8000);
    expect(panel.hidden).toBe(false);
    expect(panel.classList.contains("live-shutter-out")).toBe(false);
    expect(shown(root)).toBe(video);
    expect(video.currentTime).toBeGreaterThan(6);
    expect(booth.hidden).toBe(true);
    // 14 500 ms: past the midpoint the clip is gone and the booth waits underneath.
    await vi.advanceTimersByTimeAsync(800);
    expect(shown(root)).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(booth.hidden).toBe(false);
    // 15 300 ms: the booth, uncovered.
    await vi.advanceTimersByTimeAsync(800);
    expect(panel.hidden).toBe(true);
    expect(booth.hidden).toBe(false);
  });

  it("stops everything on a hidden tab, pauses the polls, and rejoins where the clock says on return", async () => {
    const root = document.createElement("div");
    const getLive = vi.fn(async () => grid);
    await renderLive(root, {}, options(getLive));
    stubMedia(root);
    await vi.advanceTimersByTimeAsync(700);
    const video = shown(root);
    expect(video.play).toHaveBeenCalledTimes(1);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20);
    expect(shown(root)).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    // A poll was due at 10 s; hidden, none is made.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(getLive).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20);
    expect(getLive).toHaveBeenCalledTimes(2);
    // 16 740 ms: the booth, 1.5 s in.
    expect(shown(root)).toBeNull();
    expect(root.querySelector("canvas.live-booth").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getLive).toHaveBeenCalledTimes(3);
  });

  it("keeps the button in front of autoplay for a reader who asked for less motion, and starts everything on the click", async () => {
    reduced = true;
    const root = document.createElement("div");
    const sound = fakeSound();
    await renderLive(root, {}, options(vi.fn(async () => grid), sound));
    stubMedia(root);
    const join = root.querySelector(".live-join");
    expect(join.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(700);
    expect(shown(root)).toBeNull();
    expect(sound.open).not.toHaveBeenCalled();
    join.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(join.hidden).toBe(true);
    const video = shown(root);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBeCloseTo(0.12, 1);
    // The gesture let the context run: the sound joins the picture already playing.
    sound.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(sound.open).toHaveBeenCalledTimes(1);
    expect(shown(root)).toBe(video);
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("plays muted behind the button when it is framed on another page, and the click lets the sound in", async () => {
    const root = document.createElement("div");
    const sound = fakeSound({ running: true });
    await renderLive(root, {}, { ...options(vi.fn(async () => grid), sound), framed: true });
    stubMedia(root);
    const join = root.querySelector(".live-join");
    expect(join.hidden).toBe(false);
    // The picture is never held back -- only the sound waits for the ask.
    await vi.advanceTimersByTimeAsync(700);
    const video = shown(root);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(true);
    expect(sound.open).not.toHaveBeenCalled();
    join.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(join.hidden).toBe(true);
    expect(sound.open).toHaveBeenCalledTimes(1);
    expect(shown(root).muted).toBe(false);
  });

  it("tears down what a navigation during the booth's load would otherwise leak", async () => {
    let release;
    gate.open = new Promise((resolve) => { release = resolve; });
    const root = document.createElement("div");
    const state = {};
    const getLive = vi.fn(async () => grid);
    const sound = fakeSound({ running: true });
    const rendering = renderLive(root, state, options(getLive, sound));
    expect(typeof state.teardown).toBe("function");
    state.teardown();
    state.teardown = null;
    release();
    await rendering;
    expect(state.teardown).toBeNull();
    expect(gate.last.dispose).toHaveBeenCalledTimes(1);
    expect(sound.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getLive).not.toHaveBeenCalled();
    expect(shown(root)).toBeNull();
  });
});

describe("openSound", () => {
  class FakeContext {
    constructor() {
      this.state = "suspended";
      this.listeners = [];
      this.resume = vi.fn(async () => {});
      this.close = vi.fn();
      FakeContext.last = this;
    }
    addEventListener(type, listener) {
      this.listeners.push(listener);
    }
    become(state) {
      this.state = state;
      for (const listener of this.listeners.splice(0)) listener();
    }
  }
  beforeEach(() => {
    globalThis.AudioContext = FakeContext;
  });

  it("opens once the browser lets the context run, and only once", async () => {
    const sound = openSound(async () => ({}));
    const context = FakeContext.last;
    let audio = null;
    sound.open().then((opened) => { audio = opened; });
    expect(context.resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(sound.running).toBe(false);
    expect(audio).toBeNull();
    sound.ask();
    expect(context.resume).toHaveBeenCalledTimes(2);
    context.become("running");
    await vi.waitFor(() => expect(audio).not.toBeNull());
    expect(sound.running).toBe(true);
    expect(audio.context).toBe(context);
    expect(await sound.open()).toBe(audio);
    sound.close();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("gives nothing once the context was closed while it waited", async () => {
    const sound = openSound(async () => ({}));
    const opening = sound.open();
    FakeContext.last.become("closed");
    expect(await opening).toBeNull();
  });

  it("forgets an open that failed, so the next one can still find sound", async () => {
    let attempts = 0;
    const sound = openSound(async () => {
      if (attempts++ === 0) throw new Error("no voice");
      return {};
    });
    const failing = sound.open();
    FakeContext.last.become("running");
    await expect(failing).rejects.toThrow("no voice");
    expect(await sound.open()).not.toBeNull();
    expect(attempts).toBe(2);
  });

  it("forgets a context that never ran, so a later ask finds the sound it then has", async () => {
    const sound = openSound(async () => ({}));
    const context = FakeContext.last;
    const interrupted = sound.open();
    context.become("interrupted"); // Safari, on a call taking the audio away
    expect(await interrupted).toBeNull();
    context.become("running");
    expect(await sound.open()).not.toBeNull();
  });
});

describe("the way back off the channel's own page", () => {
  it("is on the page that IS the channel, and not on the framed player", () => {
    // Trapped is what this fixes: #/live draws the stage and nothing else, so
    // without this the only way out was the browser's own back button.
    const page = document.createElement("div");
    buildStage(page, false);
    const back = page.querySelector("a.live-back");
    expect(back.getAttribute("href")).toBe("#/");
    expect(back.textContent).toBe("Back to the arena");

    // Framed, the channel is a box on the front page and the rest of that
    // page is already the way out.
    const framed = document.createElement("div");
    buildStage(framed, true);
    expect(framed.querySelector(".live-back")).toBeNull();
  });
});
