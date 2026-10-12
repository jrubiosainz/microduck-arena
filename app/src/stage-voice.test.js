import { describe, expect, it } from "vitest";
import { createStageVoice } from "./stage-voice.js";

const calls = {
  chirp: () => new Float32Array(4800), // 0.1 s
  wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000),
};

function fakeContext(log) {
  return {
    state: "running",
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

async function voiceWith(sounds, { muted = () => false } = {}) {
  const log = [];
  const context = fakeContext(log);
  const voice = createStageVoice(async () => calls, { makeContext: () => context, muted });
  voice.set(sounds);
  await new Promise((done) => setTimeout(done));
  return { voice, log, context };
}

describe("createStageVoice", () => {
  it("starts a quack as the clock crosses it, once, and lets it end", async () => {
    const { voice, log } = await voiceWith([{ tag: "chirp", variant: 0, start: 1, end: 5 }]);
    voice.follow(0.98);
    voice.follow(1.0);
    voice.follow(1.02);
    voice.follow(1.2);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
    expect(log[0][1]).toBe(4800);
    expect(log[0][2]).toBeCloseTo(0);
  });

  it("resumes a wheee from where a jump lands inside it", async () => {
    const { voice, log } = await voiceWith([{ tag: "wheee", variant: 0, start: 1, end: 3 }]);
    voice.follow(0);
    voice.follow(2);
    expect(log).toEqual([["start", 96000, 1]]);
  });

  it("starts again from the top when the replay loops", async () => {
    const { voice, log } = await voiceWith([{ tag: "wheee", variant: 0, start: 0, end: 2 }]);
    voice.follow(0.5);
    voice.follow(0.52);
    voice.follow(0.02);
    expect(log.filter(([what]) => what === "start").map(([, , offset]) => offset)).toEqual([0.5, expect.closeTo(0.02)]);
  });

  it("stays silent when the Arena is muted, and stops when the replay pauses", async () => {
    const muted = await voiceWith([{ tag: "wheee", variant: 0, start: 0, end: 2 }], { muted: () => true });
    muted.voice.follow(0.5);
    expect(muted.log).toEqual([]);
    const { voice, log } = await voiceWith([{ tag: "wheee", variant: 0, start: 0, end: 2 }]);
    voice.follow(0.5);
    voice.follow(null);
    expect(log.map(([what]) => what)).toEqual(["start", "stop"]);
  });

  it("asks a suspended context to resume and plays once it runs", async () => {
    const { voice, log, context } = await voiceWith([{ tag: "chirp", variant: 0, start: 0, end: 1 }]);
    context.state = "suspended";
    voice.follow(0.02);
    expect(log).toEqual([["resume"]]);
    context.state = "running";
    voice.follow(0.04);
    expect(log.at(-1)[0]).toBe("start");
  });

  it("forgets the sounds of lanes that have left the stage", async () => {
    const log = [];
    let release;
    const slow = new Promise((done) => { release = done; });
    const voice = createStageVoice(() => slow, { makeContext: () => fakeContext(log), muted: () => false });
    voice.set([{ tag: "chirp", variant: 0, start: 0, end: 1 }]);
    voice.set([]);
    release(calls);
    await new Promise((done) => setTimeout(done));
    voice.follow(0.02);
    expect(log).toEqual([]);
  });
});
