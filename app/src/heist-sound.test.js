import { describe, expect, it } from "vitest";
import { GIANT_RATE, heistCues, createHeistSound } from "./heist-sound.js";
import { TRACE_WIDTH } from "./replay.js";

/** A trace of `frames` frames, the trunk going from x 0 to `to`. */
function walk(frames, to) {
  const trace = new Float32Array(frames * TRACE_WIDTH);
  for (let i = 0; i < frames; i++) trace[i * TRACE_WIDTH] = (to * i) / Math.max(1, frames - 1);
  return trace;
}

const T = [[0.6, 1.6], [4.2, 2.0]];
const at2 = (cues) => cues.map(({ at, kind, lane }) => [Number(at.toFixed(2)), kind, lane]);

describe("heistCues", () => {
  it("quacks where each red begins and falls where a duck goes out, in race order", () => {
    const lanes = [
      { trace: walk(300, 6.05), caught: null }, // crossed
      { trace: walk(150, 2.0), caught: 50 }, // caught on the first red's first watched step, then collapsed
      { trace: walk(120, 1.5), caught: null }, // fell
    ];
    expect(at2(heistCues(T, lanes, 6, 60))).toEqual([[0.6, "quack", null], [1, "fall", 1], [2.38, "fall", 2], [4.2, "quack", null]]);
  });
  it("never falls for a duck out of time, every lane out of time included", () => {
    expect(heistCues([], [{ trace: walk(3000, 2), caught: null }, { trace: walk(3000, 0.01), caught: null }], 6, 60)).toEqual([]);
  });
  it("counts a clip lane's frames after its lead-in", () => {
    expect(at2(heistCues([], [{ trace: walk(145, 1.5), caught: null, lead: 25 }], 6, 60))).toEqual([[2.38, "fall", 0]]);
  });
});

const calls = { chirp: () => new Float32Array(4800) }; // 0.1 s
const settle = () => new Promise((done) => setTimeout(done));

/** A context whose sources log their starts and stops. */
function fakeContext(log) {
  const listeners = [];
  const node = (name) => ({ name, connect() {} });
  return {
    state: "running",
    addEventListener: (type, listener) => listeners.push(listener),
    removeEventListener: (type, listener) => listeners.splice(listeners.indexOf(listener), 1),
    changeState(state) {
      this.state = state;
      for (const listener of [...listeners]) listener();
    },
    destination: { name: "speakers" },
    resume: async () => log.push(["resume"]),
    close: async () => {},
    decodeAudioData: async () => ({ length: 57600 }),
    createGain: () => ({ ...node("gain"), gain: { value: 1 } }),
    createDynamicsCompressor: () => ({ ...node("limiter"), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
    createWaveShaper: () => node("ceiling"),
    createBuffer: (channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource() {
      const source = {
        ...node("source"),
        buffer: null,
        playbackRate: { value: 1 },
        start: (when, offset) => log.push(["start", source.buffer.length, offset, source.playbackRate.value]),
        stop: () => log.push(["stop"]),
      };
      return source;
    },
  };
}

async function soundWith(cues, { muted = () => false, state = "running" } = {}) {
  const log = [];
  const loaded = [];
  const context = fakeContext(log);
  context.state = state;
  const sound = createHeistSound(async () => calls, {
    makeContext: () => context,
    muted,
    load: async (file) => { loaded.push(file); return new ArrayBuffer(8); },
  });
  sound.set(cues);
  await settle();
  return { sound, log, loaded, context };
}

describe("createHeistSound", () => {
  it("quacks as the clock crosses a red's onset, once, slowed to the giant's rate", async () => {
    const { sound, log } = await soundWith([{ at: 0.6, kind: "quack", lane: null }]);
    [0.58, 0.6, 0.62].forEach((s) => sound.follow(s));
    expect(log.filter(([what]) => what === "start")).toEqual([["start", 4800, 0, GIANT_RATE]]);
  });
  it("plays the fall's recording where a duck goes out", async () => {
    const { sound, log, loaded } = await soundWith([{ at: 1, kind: "fall", lane: 1 }]);
    expect(loaded).toEqual(["microduck-fall.wav"]);
    [0.98, 1].forEach((s) => sound.follow(s));
    expect(log[0]).toEqual(["start", 57600, 0, 1]);
  });
  it("is silent while the Arena is muted or the page hushed", async () => {
    const { sound, log } = await soundWith([{ at: 0.6, kind: "quack", lane: null }], { muted: () => true });
    [0.6, 0.62].forEach((s) => sound.follow(s));
    expect(log).toEqual([]);
  });
  it("waits for a gesture while the browser keeps its context suspended, then plays from where the clock is", async () => {
    const { sound, log, context } = await soundWith([{ at: 0.6, kind: "quack", lane: null }], { state: "suspended" });
    sound.follow(0.6);
    expect(log).toEqual([]);
    window.dispatchEvent(new Event("pointerdown"));
    expect(log).toEqual([["resume"]]);
    context.changeState("running");
    sound.follow(0.64);
    expect(log.at(-1)).toEqual(["start", 4800, expect.closeTo(0.04 * GIANT_RATE, 5), GIANT_RATE]);
  });
  it("starts again from where the clock lands when the replay jumps back", async () => {
    const { sound, log } = await soundWith([{ at: 0.6, kind: "quack", lane: null }]);
    [0.6, 3, 0.65].forEach((s) => sound.follow(s));
    expect(log.filter(([what]) => what === "start").map(([, , offset]) => offset)).toEqual([0, expect.closeTo(0.05 * GIANT_RATE, 5)]);
  });
  it("makes no context and loads nothing for a replay without cues", async () => {
    const asked = [];
    const spy = (name) => () => { asked.push(name); };
    const sound = createHeistSound(spy("loadCalls"), { makeContext: spy("makeContext"), muted: () => false, load: spy("load") });
    sound.set([]);
    await settle();
    sound.follow(1);
    sound.dispose();
    expect(asked).toEqual([]);
  });
});
