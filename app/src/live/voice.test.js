import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_RATE, prepare, synthesize } from "./score.js";
import { createVoice, loadTones, windGust } from "./voice.js";

describe("loadTones", () => {
  it("reads the two raw float32 files", async () => {
    const bytes = new Float32Array(28800).fill(0.5).buffer;
    const fetcher = async (url) => ({ ok: url.includes("commentator-"), arrayBuffer: async () => bytes });
    const tones = await loadTones(fetcher);
    expect(tones.peter).toHaveLength(28800);
    expect(tones.ray[0]).toBe(0.5);
    await expect(loadTones(async () => ({ ok: false }))).rejects.toThrow("No voice for peter");
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
  const tone = (name) => {
    const bytes = readFileSync(`public/sound/commentator-${name}.f32`);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  };
  const tones = { peter: tone("peter"), ray: tone("ray") };
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

  it("sings the plan's stereo samples from the join offset", () => {
    const context = fakeContext();
    createVoice(context, tones).start(plan, 1234);
    const [{ buffer, when, offset }] = context.starts;
    expect(when).toBe(0);
    expect(offset).toBe(1.234);
    expect(buffer.sampleRate).toBe(SAMPLE_RATE);
    expect(buffer.length).toBe((plan.duration_ms * SAMPLE_RATE) / 1000);
    const pcm = synthesize(plan, tones);
    for (const channel of [0, 1]) {
      const planar = buffer.getChannelData(channel);
      expect(planar.findIndex((sample, i) => sample !== pcm[i * 2 + channel])).toBe(-1);
    }
    expect(buffer.getChannelData(0).some((sample) => sample !== 0)).toBe(true);
  });

  it("clamps a join past the plan's end to the end", () => {
    const context = fakeContext();
    createVoice(context, tones).start(plan, 99999);
    expect(context.starts[0].offset).toBe(plan.duration_ms / 1000);
  });

  it("breathes the wind twice across the shutter", () => {
    const context = fakeContext();
    createVoice(context, tones).gust(7.5);
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
