import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_RATE, prepare, synthesize } from "./score.js";
import { createVoice, loadCalls, loadSynth, windGust } from "./voice.js";

const wasm = async (url) => ({ ok: url === "/sound/microduck-voice.wasm", arrayBuffer: async () => readFileSync(`public${url}`) });

describe("loadSynth", () => {
  it("sings a note for exactly its length, at -6 dBFS, silent at both ends", async () => {
    const sing = await loadSynth(wasm);
    const note = { start_ms: 100, end_ms: 350, variant: 7, contour: [[0, 1], [0.5, 1.8], [1, 0.9]], held: false, warble: [12, 1], buzz: 0.5 };
    const samples = sing(142, note);
    expect(samples).toHaveLength(12000);
    expect(Math.abs(samples[0])).toBe(0);
    expect(Math.abs(samples.at(-1))).toBe(0);
    expect(samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeCloseTo(10 ** (-6 / 20), 3);
    await expect(loadSynth(async () => ({ ok: false }))).rejects.toThrow("No voice");
  });
});

describe("loadCalls", () => {
  it("quacks and wheees in the robot's own voice, the same every time", async () => {
    const calls = await loadCalls(wasm);
    const quack = calls.chirp(28, 3);
    expect(quack.length).toBeGreaterThan(0.05 * 48000);
    expect(quack.length).toBeLessThan(0.6 * 48000);
    expect(quack.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(1);
    expect(calls.chirp(28, 4)).not.toEqual(quack);
    const start = calls.wheee(28, 0, 0);
    const ride = calls.wheee(28, 0, 1);
    expect(start.length).toBeGreaterThan(0.5 * 48000);
    expect(ride.length).toBeGreaterThan(1.2 * 48000);
    // A copy each: the calls made since did not overwrite the first quack.
    expect(calls.chirp(28, 3)).toEqual(quack);
    await expect(loadCalls(async () => ({ ok: false }))).rejects.toThrow("No voice");
  });
});

/** Goertzel: the power of `samples` at `hz`. */
function power(samples, hz) {
  const k = 2 * Math.cos((2 * Math.PI * hz) / 48000);
  let s1 = 0;
  let s2 = 0;
  for (const x of samples) {
    const s0 = x + k * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}
const crossings = (samples) => samples.reduce((n, x, i) => n + (i > 0 && (samples[i - 1] < 0) !== (x < 0) ? 1 : 0), 0);
const peak = (samples) => samples.reduce((top, x) => Math.max(top, Math.abs(x)), 0);

describe("loadCalls: the song and the tuned voice", () => {
  it("sings each note at its pitch, A4 at 440 Hz and A5 at 880 Hz, for exactly the length asked", async () => {
    const calls = await loadCalls(wasm);
    const sung = calls.song(28, {}, [[0, 0.5, 69, 1, 0.9, 0], [0.5, 0.5, 81, 1, 0.9, 0]], 1.2);
    expect(sung).toHaveLength(57600);
    const a4 = sung.subarray(0.1 * 48000, 0.4 * 48000);
    const a5 = sung.subarray(0.6 * 48000, 0.9 * 48000);
    expect(power(a4, 440)).toBeGreaterThan(10 * power(a4, 415.3));
    expect(power(a4, 440)).toBeGreaterThan(10 * power(a4, 466.2));
    expect(power(a5, 880)).toBeGreaterThan(10 * power(a5, 830.6));
    expect(power(a5, 880)).toBeGreaterThan(10 * power(a5, 932.3));
  });

  it("is silent before the first note and after the last one's release", async () => {
    const calls = await loadCalls(wasm);
    const sung = calls.song(28, {}, [[0.5, 0.5, 69, 1, 0.9, 0]], 1.5);
    expect(peak(sung.subarray(0, 0.45 * 48000))).toBeLessThan(1e-3);
    expect(peak(sung.subarray(0.6 * 48000, 0.9 * 48000))).toBeGreaterThan(0.1);
    expect(peak(sung.subarray(1.3 * 48000))).toBeLessThan(1e-3);
  });

  it("never returns an empty song", async () => {
    const calls = await loadCalls(wasm);
    expect(calls.song(28, {}, [[0, 1, 69, 1, 0.9, 0]], 0)).toHaveLength(1);
  });

  it("tunes the quack and the wheee: a low pitch is low, a high one high, an absent knob the seed's own", async () => {
    const calls = await loadCalls(wasm);
    // No breath in either: its noise crosses zero at any pitch and would blur the comparison.
    const low = calls.chirp(28, 0, { pitch: 0, breath: 0 });
    const high = calls.chirp(28, 0, { pitch: 1, breath: 0 });
    expect(crossings(high) / high.length).toBeGreaterThan(2 * (crossings(low) / low.length));
    expect(calls.chirp(28, 0, {})).toEqual(calls.chirp(28, 0));
    expect(calls.chirp(28, 0, { buzz: 0 })).not.toEqual(calls.chirp(28, 0));
    expect(calls.wheee(28, 0, 1, { vibrato: 1 })).not.toEqual(calls.wheee(28, 0, 1));
  });
});

describe("windGust", () => {
  const seeded = (seed) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  it("is 0.36 s at -1 dBFS, silent at both ends, faded in over 0.1 s", () => {
    const gust = windGust(seeded(1040));
    expect(gust).toHaveLength(17280);
    expect(gust[0]).toBe(0);
    expect(gust.at(-1)).toBe(0);
    expect(Math.max(...gust.map(Math.abs))).toBeCloseTo(10 ** (-1 / 20), 3);
    const early = Math.max(...gust.subarray(0, 240).map(Math.abs));
    expect(early).toBeLessThan(0.3);
    expect(windGust(seeded(1040))).toEqual(gust);
  });
});

describe("createVoice", () => {
  const voice = loadSynth(wasm);
  const plan = prepare({
    run_id: "01TESTRUN",
    turns: [
      { speaker: "peter", text: "Twelve point four seconds!" },
      { speaker: "ray", text: "It is a number, Peter." },
    ],
  });
  /** A context whose buffers are planar arrays and whose sources record every start. */
  const fakeContext = () => {
    const starts = [];
    return {
      starts,
      destination: {},
      createGain: () => ({ gain: { value: 1 }, connect() {} }),
      createBuffer(channels, length, sampleRate) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          length, sampleRate,
          getChannelData: (channel) => data[channel],
          copyToChannel: (samples, channel) => data[channel].set(samples),
        };
      },
      createBufferSource() {
        const source = {
          buffer: null, connect() {}, stop() {}, disconnect() {},
          start(when, offset) { starts.push({ buffer: source.buffer, when, offset }); },
        };
        return source;
      },
    };
  };

  it("sings the plan's stereo samples from the join offset, plus the time it took to sing them", async () => {
    const context = fakeContext();
    const sing = await voice;
    const began = performance.now();
    createVoice(context, sing).start(plan, 1234);
    const took = performance.now() - began;
    const [{ buffer, when, offset }] = context.starts;
    expect(when).toBe(0);
    expect(offset).toBeGreaterThan(1.234);
    expect(offset).toBeLessThanOrEqual(1.234 + took / 1000);
    expect(buffer.sampleRate).toBe(SAMPLE_RATE);
    expect(buffer.length).toBe((plan.duration_ms * SAMPLE_RATE) / 1000);
    const pcm = synthesize(plan, sing);
    for (const channel of [0, 1]) {
      const planar = buffer.getChannelData(channel);
      expect(planar.findIndex((sample, i) => sample !== pcm[i * 2 + channel])).toBe(-1);
    }
    expect(buffer.getChannelData(0).some((sample) => sample !== 0)).toBe(true);
  });

  it("clamps a join past the plan's end to the end", async () => {
    const context = fakeContext();
    createVoice(context, await voice).start(plan, 99999);
    expect(context.starts[0].offset).toBe(plan.duration_ms / 1000);
  });

  it("breathes the wind twice across the shutter", async () => {
    const context = fakeContext();
    createVoice(context, await voice).gust(7.5);
    expect(context.starts).toHaveLength(2);
    expect(context.starts[0].when).toBe(7.5);
    expect(context.starts[1].when).toBeCloseTo(8.66, 10);
    for (const { buffer } of context.starts) {
      expect(buffer.length).toBe(17280);
      const peak = buffer.getChannelData(0).reduce((top, sample) => Math.max(top, Math.abs(sample)), 0);
      expect(peak).toBeCloseTo(10 ** (-1 / 20), 3);
    }
  });
});
