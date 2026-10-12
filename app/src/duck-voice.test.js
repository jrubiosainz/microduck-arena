import { describe, expect, it } from "vitest";
import { CTRL_DT } from "./replay.js";
import { DUCK_SEED, callSamples, mouthTrack, voiceEvents } from "./duck-voice.js";

describe("voiceEvents", () => {
  it("quacks once per press of RT across 0.3, and a release does not cut the quack", () => {
    const track = [[0, 0, 0], [1, 0.2, 0], [2, 1, 0], [2.02, 0, 0], [3, 0.9, 0], [3.1, 0.5, 0]];
    expect(voiceEvents(track, 10)).toEqual([
      { tag: "chirp", variant: 0, start: 2, end: 3 },
      { tag: "chirp", variant: 1, start: 3, end: 10 },
    ]);
  });

  it("rides the wheee while LT holds at 0.3 or more, cut at its release", () => {
    expect(voiceEvents([[0, 0, 0], [1, 0, 0.3], [1.5, 0, 1], [4, 0, 0.29]], 10)).toEqual([
      { tag: "wheee", variant: 0, start: 1, end: 4 },
    ]);
  });

  it("drops a quack during a wheee, and plays one pulled as the wheee is released", () => {
    expect(voiceEvents([[0, 0, 1], [1, 1, 1], [2, 0, 1], [3, 1, 0]], 10)).toEqual([
      { tag: "wheee", variant: 0, start: 0, end: 3 },
      { tag: "chirp", variant: 0, start: 3, end: 10 },
    ]);
  });

  it("decides the wheee before the quack when both are pulled at once", () => {
    expect(voiceEvents([[0, 0, 0], [1, 1, 1]], 5)).toEqual([{ tag: "wheee", variant: 0, start: 1, end: 5 }]);
  });

  it("cuts everything at the end of the performance and plays nothing past it", () => {
    expect(voiceEvents([[0, 0, 1], [6, 1, 0]], 5)).toEqual([{ tag: "wheee", variant: 0, start: 0, end: 5 }]);
  });

  it("goes through the robot's variants in turn: 12 quacks, then the first again", () => {
    const track = [];
    for (let i = 0; i < 13; i++) track.push([2 * i, 1, 0], [2 * i + 1, 0, 0]);
    expect(voiceEvents(track, 100).map((sound) => sound.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
  });

  it("lets a wheee cut a quack still playing", () => {
    expect(voiceEvents([[0, 0, 0], [1, 1, 0], [1.05, 0, 1]], 5)).toEqual([
      { tag: "chirp", variant: 0, start: 1, end: 1.05 },
      { tag: "wheee", variant: 0, start: 1.05, end: 5 },
    ]);
  });

  it("ignores a change on the last step, which float error puts a hair before the end", () => {
    expect(voiceEvents([[0, 0, 0], [0.7, 1, 0]], 35 * CTRL_DT)).toEqual([]);
  });

  it("makes no sound without a track", () => {
    expect(voiceEvents(null, 20)).toEqual([]);
  });
});

describe("mouthTrack", () => {
  it("opens to the harder-pulled trigger like a servo, and holds the start through a lead", () => {
    const open = mouthTrack([[0, 0.5, 0], [1, 0, 1], [2, 0, 0]], 200, 25);
    expect(open[0]).toBeCloseTo(0.5);
    expect(open[24]).toBeCloseTo(0.5); // the lead holds t = 0
    expect(open[75]).toBeLessThan(0.7); // eased at the change, not snapped
    expect(open[90]).toBeGreaterThan(0.99); // and there 0.3 s later
    expect(open[199]).toBeLessThan(0.01);
  });

  it("opens to the harder-pulled trigger when both are pulled", () => {
    for (const value of mouthTrack([[0, 0.4, 0.7]], 3)) expect(value).toBeCloseTo(0.7);
  });

  it("leaves the beak alone without a track", () => {
    expect(mouthTrack(null, 10)).toBeNull();
  });
});

describe("callSamples", () => {
  const calls = {
    chirp: (seed, variant) => new Float32Array(4800).fill(variant + 1),
    wheee: (seed, variant, segment) => new Float32Array(segment ? 9600 : 24000).fill(segment ? 2 : 1),
  };

  it("plays a quack whole unless the next sound cuts it, and fades the cut", () => {
    expect(callSamples(calls, { tag: "chirp", variant: 2, start: 1, end: 5 })).toEqual(new Float32Array(4800).fill(3));
    const cut = callSamples(calls, { tag: "chirp", variant: 2, start: 1, end: 1.05 });
    expect(cut).toHaveLength(2400);
    expect(cut[0]).toBe(3);
    expect(cut[2399]).toBe(0);
  });

  it("rides the wheee's start, then its loop over and over, to the release", () => {
    const ride = callSamples(calls, { tag: "wheee", variant: 0, start: 0, end: 1 });
    expect(ride).toHaveLength(48000);
    expect(ride[23999]).toBe(1);
    expect(ride[24000]).toBe(2);
    expect(ride[24000 + 2 * 9600]).toBe(2);
    expect(ride[47999]).toBe(0);
  });

  it("always gives a sound a sample, however short its stretch", () => {
    expect(callSamples(calls, { tag: "chirp", variant: 0, start: 1, end: 1 + 1e-6 })).toHaveLength(1);
  });

  it("sings in the stage duck's voice", () => {
    const asked = [];
    callSamples({ chirp: (seed) => (asked.push(seed), new Float32Array(1)) }, { tag: "chirp", variant: 0, start: 0, end: 1 });
    expect(asked).toEqual([DUCK_SEED]);
  });
});
