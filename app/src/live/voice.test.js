import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_RATE, VOICES, prepare, prepareCall } from "./score.js";
import { SING_AHEAD_MS, createVoice, loadCalls, loadSynth, windGust } from "./voice.js";

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

describe("loadCalls: the chorus", () => {
  const notes = [[0, 1, 69, 1, 0.9, 0]];

  it("sings a part of a chorus in the robot's choral voice: its own per part, still on its note", async () => {
    const calls = await loadCalls(wasm);
    const solo = calls.song(28, {}, notes, 1.2);
    const first = calls.song(28, {}, notes, 1.2, { choral: true, variant: 0 });
    const second = calls.song(28, {}, notes, 1.2, { choral: true, variant: 1 });
    for (const take of [solo, first, second]) {
      expect(take).toHaveLength(57600);
      expect(take.every(Number.isFinite)).toBe(true);
    }
    expect(first).not.toEqual(solo);
    expect(second).not.toEqual(first);
    const held = first.subarray(0.2 * 48000, 0.8 * 48000);
    expect(power(held, 440)).toBeGreaterThan(10 * power(held, 415.3));
    expect(power(held, 440)).toBeGreaterThan(10 * power(held, 466.2));
  });

  it("sings solo unless asked for a part, whatever the variant", async () => {
    const calls = await loadCalls(wasm);
    expect(calls.song(28, {}, notes, 1.2, { choral: false, variant: 3 })).toEqual(calls.song(28, {}, notes, 1.2));
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

/** The whole plan sung into one interleaved stereo buffer, as the live page did
 * before it sang by caption: the reference the voice must still sound like. */
function wholePlan(plan, sing) {
  const audio = new Float32Array((plan.duration_ms * SAMPLE_RATE) / 1000 * 2);
  for (const note of plan.notes) {
    const samples = sing(VOICES[note.speaker].seed, note);
    const start = note.start_ms * 48;
    for (let i = 0; i < samples.length; i++) {
      audio[(start + i) * 2] = audio[(start + i) * 2 + 1] = samples[i] * note.emphasis;
    }
  }
  return audio;
}

describe("createVoice", () => {
  const voice = loadSynth(wasm);
  const plan = prepare({
    run_id: "01TESTRUN",
    turns: [
      { speaker: "peter", text: "Twelve point four seconds!" },
      { speaker: "ray", text: "It is a number, Peter." },
    ],
  });
  // A match's call: lines far apart over a long clip, one of them long enough for two captions.
  const call = prepareCall({
    id: "tug-of-war-0001-003",
    duration_ms: 60000,
    lines: [
      { at_ms: 2000, speaker: "peter", text: "The marker slides west, and it keeps on sliding, Ray, all the way to the edge of the pit!" },
      { at_ms: 30000, speaker: "ray", text: "Into the pit." },
      { at_ms: 58000, speaker: "peter", text: "Time is nearly up, and nobody has let go of the rope yet!" },
    ],
  });
  /** A context whose buffers are planar arrays and whose sources record every start and stop. */
  const fakeContext = () => {
    const starts = [];
    const stopped = [];
    return {
      starts,
      stopped,
      currentTime: 3,
      destination: {},
      createGain: () => ({ gain: { value: 1 }, connect() {} }),
      createBuffer(channels, length, sampleRate) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          length, sampleRate, numberOfChannels: channels,
          getChannelData: (channel) => data[channel],
          copyToChannel: (samples, channel) => data[channel].set(samples),
        };
      },
      createBufferSource() {
        const source = {
          buffer: null, connect() {}, disconnect() {},
          start(when, offset) { starts.push({ buffer: source.buffer, when, offset }); },
          stop() { stopped.push(source.buffer); },
        };
        return source;
      },
    };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sings each caption shortly before it plays, never a whole match's at once", async () => {
    vi.useFakeTimers();
    const context = fakeContext();
    createVoice(context, await voice).start(call, 0);
    // When each caption sung so far starts, in ms of the plan: the plan's 0 is the context's 3 s.
    const started = () => context.starts.map(({ when }) => Math.round((when - 3) * 1000));
    expect(call.captions.map((c) => c.start_ms)).toEqual([2000, 8264, 30000, 58000]);
    expect(started()).toEqual([2000]);
    vi.advanceTimersByTime(8264 - SING_AHEAD_MS - 1);
    expect(started()).toEqual([2000]);
    vi.advanceTimersByTime(1);
    expect(started()).toEqual([2000, 8264]);
    vi.advanceTimersByTime(30000 - 8264);
    expect(started()).toEqual([2000, 8264, 30000]);
    vi.runAllTimers();
    expect(started()).toEqual([2000, 8264, 30000, 58000]);
  });

  it("sings each caption in mono, all on the context's clock from one instant, a caption sung late from that much further in", async () => {
    vi.useFakeTimers();
    const context = fakeContext();
    const sing = await voice;
    // Singing takes the context's clock a millisecond a note.
    const slow = (seed, note) => {
      context.currentTime += 0.001;
      return sing(seed, note);
    };
    createVoice(context, slow).start(plan, 1234);
    vi.runAllTimers();
    const zero = 3 - 1.234; // the plan's 0 on the context's clock
    expect(context.starts).toHaveLength(plan.captions.length);
    for (const [{ buffer, when, offset }, caption] of context.starts.map((start, i) => [start, plan.captions[i]])) {
      expect(buffer.numberOfChannels).toBe(1);
      expect(buffer.sampleRate).toBe(SAMPLE_RATE);
      expect(buffer.length).toBe(((caption.end_ms - caption.start_ms) * SAMPLE_RATE) / 1000);
      expect(when - offset).toBeCloseTo(zero + caption.start_ms / 1000, 9);
      if (caption.start_ms <= 1234) {
        // The caption the screen joins inside starts once it is sung, from where the plan has got to by then.
        expect(offset).toBeGreaterThan((1234 - caption.start_ms) / 1000);
      } else {
        expect(offset).toBe(0);
      }
    }
  });

  it("sounds exactly as the whole plan sung at once, the booth's and a match's call alike", async () => {
    vi.useFakeTimers();
    const sing = await voice;
    for (const sung of [plan, call]) {
      const context = fakeContext();
      createVoice(context, sing).start(sung, 0);
      vi.runAllTimers();
      const whole = wholePlan(sung, sing);
      const heard = new Float32Array(sung.duration_ms * 48);
      for (const [{ buffer }, caption] of context.starts.map((start, i) => [start, sung.captions[i]])) {
        heard.set(buffer.getChannelData(0), caption.start_ms * 48);
      }
      expect(heard.findIndex((sample, i) => sample !== whole[i * 2] || sample !== whole[i * 2 + 1])).toBe(-1);
      expect(heard.some((sample) => sample !== 0)).toBe(true);
    }
  });

  it("holds only the speech: a long call with three lines is sung into no more than its captions", async () => {
    vi.useFakeTimers();
    const context = fakeContext();
    createVoice(context, await voice).start(call, 0);
    vi.runAllTimers();
    const held = context.starts.reduce((sum, { buffer }) => sum + buffer.length, 0);
    const spoken = call.captions.reduce((sum, c) => sum + (c.end_ms - c.start_ms) * 48, 0);
    expect(held).toBe(spoken);
    expect(held).toBeLessThan((call.duration_ms * 48) / 4);
  });

  it("sings nothing of a caption already over, and nothing at all for a join past the plan's end", async () => {
    vi.useFakeTimers();
    const sing = await voice;
    const context = fakeContext();
    createVoice(context, sing).start(call, 31000);
    vi.runAllTimers();
    expect(context.starts.map(({ buffer }) => buffer.length)).toEqual(
      call.captions.filter((c) => c.end_ms > 31000).map((c) => (c.end_ms - c.start_ms) * 48));
    const late = fakeContext();
    createVoice(late, sing).start(plan, 99999);
    vi.runAllTimers();
    expect(late.starts).toEqual([]);
  });

  it("stops every caption it scheduled, and sings none of those still to come", async () => {
    vi.useFakeTimers();
    const context = fakeContext();
    const speaker = createVoice(context, await voice);
    speaker.start(call, 0);
    vi.advanceTimersByTime(7000);
    expect(context.starts).toHaveLength(2);
    speaker.stop();
    expect(context.stopped).toEqual(context.starts.map(({ buffer }) => buffer));
    vi.runAllTimers();
    expect(context.starts).toHaveLength(2);
    speaker.stop();
    expect(context.stopped).toHaveLength(2);
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
