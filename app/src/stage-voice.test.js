import { describe, expect, it } from "vitest";
import { createStageVoice } from "./stage-voice.js";

const calls = {
  chirp: () => new Float32Array(4800), // 0.1 s
  wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000),
  song: (seed, voice, notes, seconds) => new Float32Array(Math.max(1, Math.round(seconds * 48000))),
};
/** One A4 from 1 s to 2 s: its take is 2.2 s long, release included. */
const song = { song: [[1, 1, 69, 0.7, 0.9, 0]] };

function fakeContext(log) {
  const listeners = [];
  return {
    state: "running",
    addEventListener: (type, listener) => listeners.push(listener),
    removeEventListener: (type, listener) => listeners.splice(listeners.indexOf(listener), 1),
    changeState(state) {
      this.state = state;
      for (const listener of [...listeners]) listener();
    },
    destination: {},
    resume: async () => log.push(["resume"]),
    close: async () => {},
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer: (channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource() {
      const node = {
        buffer: null,
        connect() {},
        start: (when, offset) => log.push(["start", node.buffer.length, offset]),
        stop: () => log.push(["stop"]),
      };
      return node;
    },
  };
}

async function voiceWith(sound, { duration = 5, muted = () => false, state = "running" } = {}) {
  const log = [];
  const context = fakeContext(log);
  context.state = state;
  const voice = createStageVoice(async () => calls, { makeContext: () => context, muted });
  voice.set(sound, duration);
  await new Promise((done) => setTimeout(done));
  return { voice, log, context };
}

describe("createStageVoice", () => {
  it("starts a quack as the clock crosses it, once, and lets it end", async () => {
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 0], [1, 1, 0]] });
    voice.follow(0.98);
    voice.follow(1.0);
    voice.follow(1.02);
    voice.follow(1.2);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
    expect(log[0][1]).toBe(4800);
    expect(log[0][2]).toBeCloseTo(0);
  });

  it("resumes a wheee from where a jump lands inside it", async () => {
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 0], [1, 0, 1], [3, 0, 0]] });
    voice.follow(0);
    voice.follow(2);
    expect(log).toEqual([["start", 96000, 1]]);
  });

  it("starts again from the top when the replay loops", async () => {
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 1], [2, 0, 0]] });
    voice.follow(0.5);
    voice.follow(0.52);
    voice.follow(0.02);
    expect(log.filter(([what]) => what === "start").map(([, , offset]) => offset)).toEqual([0.5, expect.closeTo(0.02)]);
  });

  it("stays silent when the Arena is muted, and stops when the replay pauses", async () => {
    const wheee = { triggers: [[0, 0, 1], [2, 0, 0]] };
    const muted = await voiceWith(wheee, { muted: () => true });
    muted.voice.follow(0.5);
    expect(muted.log).toEqual([]);
    const { voice, log } = await voiceWith(wheee);
    voice.follow(0.5);
    voice.follow(null);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
  });

  it("cuts a wheee the moment it is muted, and takes it up where the replay is once it is not", async () => {
    let quiet = false;
    const { voice, log } = await voiceWith({ triggers: [[0, 0, 1], [2, 0, 0]] }, { muted: () => quiet });
    voice.follow(0.5);
    quiet = true;
    voice.follow(0.52);
    voice.follow(0.54);
    quiet = false;
    voice.follow(0.56);
    expect(log).toEqual([["start", 96000, 0.5], ["stop"], ["start", 96000, 0.56]]);
  });

  it("sings the song as one take on the replay's clock, with a quack between notes beside it", async () => {
    const { voice, log } = await voiceWith({ ...song, triggers: [[0, 0, 0], [2.1, 1, 0]] });
    for (let step = 0; step < 10; step++) voice.follow(2 + step * 0.02);
    expect(log).toEqual([["start", 105600, 2], ["start", 4800, expect.closeTo(0, 5)]]);
  });

  it("starts both the quack and the song a jump lands inside, and stops both when the loop comes round", async () => {
    const { voice, log } = await voiceWith({ ...song, triggers: [[0, 0, 0], [2.05, 1, 0]] });
    voice.follow(2.1);
    voice.follow(0.3);
    expect(log).toEqual([
      ["start", 4800, expect.closeTo(0.05, 5)],
      ["start", 105600, 2.1],
      ["stop"],
      ["stop"],
      ["start", 105600, 0.3],
    ]);
  });

  it("restarts the song where a jump lands, and lets it go past its end", async () => {
    const { voice, log } = await voiceWith(song);
    voice.follow(1.5);
    voice.follow(0.2); // the loop came round
    voice.follow(3); // scrubbed past the song
    expect(log).toEqual([["start", 105600, 1.5], ["stop"], ["start", 105600, 0.2], ["stop"]]);
  });

  it("never loads the synth for a performer who makes no sound", async () => {
    let loads = 0;
    const voice = createStageVoice(async () => (loads++, calls), { makeContext: () => fakeContext([]), muted: () => false });
    voice.set({ triggers: [[0, 0.2, 0]] }, 5); // the beak opens, nothing is heard
    voice.set(null, 0);
    await new Promise((done) => setTimeout(done));
    expect(loads).toBe(0);
  });

  describe("on a page the browser keeps silent until a gesture", () => {
    const suspended = async () => {
      const made = await voiceWith({ triggers: [[0, 1, 0]] }, { duration: 1, state: "suspended" });
      for (const at of [0.02, 0.04, 0.06]) made.voice.follow(at);
      return made;
    };

    it("never asks the context to resume from a frame", async () => {
      const { voice, log } = await suspended();
      expect(log).toEqual([]);
      voice.dispose();
    });

    it("resumes it inside the first gesture, once", async () => {
      const { voice, log } = await suspended();
      window.dispatchEvent(new Event("pointerdown"));
      expect(log).toEqual([["resume"]]);
      voice.dispose();
    });

    it("plays the sound that is due from its offset on the first frame after the context runs", async () => {
      const { voice, log, context } = await suspended();
      context.changeState("running");
      voice.follow(0.08);
      expect(log).toEqual([["start", 4800, 0.08]]);
      window.dispatchEvent(new Event("pointerdown"));
      expect(log).toHaveLength(1);
      voice.dispose();
    });

    it("stops listening for gestures once disposed", async () => {
      const { voice, log } = await suspended();
      voice.dispose();
      window.dispatchEvent(new Event("pointerdown"));
      window.dispatchEvent(new Event("keydown"));
      expect(log).toEqual([]);
    });
  });

  it("forgets the sounds of lanes that have left the stage", async () => {
    const log = [];
    let release;
    const slow = new Promise((done) => { release = done; });
    const voice = createStageVoice(() => slow, { makeContext: () => fakeContext(log), muted: () => false });
    voice.set({ ...song, triggers: [[0, 1, 0]] }, 1);
    voice.set(null, 0);
    release(calls);
    await new Promise((done) => setTimeout(done));
    voice.follow(0.02);
    expect(log).toEqual([]);
  });
});
