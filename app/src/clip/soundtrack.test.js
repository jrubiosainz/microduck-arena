import { describe, expect, it } from "vitest";
import { renderSoundtrack } from "./soundtrack.js";

function fakeContext(log) {
  return class {
    constructor(channels, length) {
      this.length = length;
      this.destination = {};
    }
    createDynamicsCompressor() {
      return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} };
    }
    createGain() {
      return { gain: {}, connect() {} };
    }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { data, copyToChannel: (samples) => data.set(samples) };
    }
    createBufferSource() {
      const node = { connect() {}, start: (at) => log.push({ at, buffer: node.buffer }) };
      return node;
    }
    async decodeAudioData() {
      return { decoded: true };
    }
    async startRendering() {
      const silent = new Float32Array(this.length);
      return { getChannelData: () => silent };
    }
  };
}

describe("renderSoundtrack", () => {
  it("renders a quack from the robot's synth at its instant, with no file to fetch", async () => {
    const log = [];
    const calls = { chirp: () => new Float32Array(480).fill(0.5), wheee: () => new Float32Array(1) };
    const score = { crowd: null, cues: [{ at: 0.5, call: { tag: "chirp", variant: 0, start: 0, end: 1 }, gain: 1 }] };
    const pcm = await renderSoundtrack(score, 1, {
      Context: fakeContext(log),
      load: () => { throw new Error("a voice cue fetched a file"); },
      calls: async () => calls,
    });
    expect(log).toHaveLength(1);
    expect(log[0].at).toBe(0.5);
    expect(log[0].buffer.data).toEqual(new Float32Array(480).fill(0.5));
    expect(pcm).toHaveLength(2 * 48000);
  });

  it("never loads the synth for a clip without a voice", async () => {
    await renderSoundtrack({ crowd: null, cues: [] }, 1, {
      Context: fakeContext([]),
      calls: () => { throw new Error("the synth was loaded"); },
    });
  });

  it("renders the song from the robot's synth at its instant, as long as the performance lets it", async () => {
    const log = [];
    const asked = [];
    const calls = {
      song: (seed, voice, notes, seconds) => (asked.push(seconds), new Float32Array(Math.round(seconds * 48000)).fill(0.25)),
    };
    const sound = { song: [[0.5, 1, 69, 0.7, 0.9, 0]] };
    const score = { crowd: null, cues: [{ at: 0.3, song: { sound, duration: 1 }, gain: 1 }] };
    await renderSoundtrack(score, 2, {
      Context: fakeContext(log),
      load: () => { throw new Error("a song cue fetched a file"); },
      calls: async () => calls,
    });
    expect(asked).toEqual([1]);
    expect(log).toHaveLength(1);
    expect(log[0].at).toBe(0.3);
    expect(log[0].buffer.data).toHaveLength(48000);
  });
});
