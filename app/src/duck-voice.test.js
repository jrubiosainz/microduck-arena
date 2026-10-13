import { describe, expect, it } from "vitest";
import { CTRL_DT } from "./replay.js";
import { DUCK_SEED, callSamples, choirOf, limiter, mouthTrack, songSamples, voiceEvents } from "./duck-voice.js";

const pulls = (triggers) => ({ triggers });
/** A note as arena/timeline.py sound_of stores it: [t, for, midi, level, open, formant]. */
const note = (t, length, open = 0.9) => [t, length, 69, 0.7, open, 0];

describe("voiceEvents", () => {
  it("quacks once per press of RT across 0.3, and a release does not cut the quack", () => {
    const track = [[0, 0, 0], [1, 0.2, 0], [2, 1, 0], [2.02, 0, 0], [3, 0.9, 0], [3.1, 0.5, 0]];
    expect(voiceEvents(pulls(track), 10)).toEqual([
      { tag: "chirp", variant: 0, start: 2, end: 3 },
      { tag: "chirp", variant: 1, start: 3, end: 10 },
    ]);
  });

  it("rides the wheee while LT holds at 0.3 or more, cut at its release", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [1, 0, 0.3], [1.5, 0, 1], [4, 0, 0.29]]), 10)).toEqual([
      { tag: "wheee", variant: 0, start: 1, end: 4 },
    ]);
  });

  it("drops a quack during a wheee, and plays one pulled as the wheee is released", () => {
    expect(voiceEvents(pulls([[0, 0, 1], [1, 1, 1], [2, 0, 1], [3, 1, 0]]), 10)).toEqual([
      { tag: "wheee", variant: 0, start: 0, end: 3 },
      { tag: "chirp", variant: 0, start: 3, end: 10 },
    ]);
  });

  it("decides the wheee before the quack when both are pulled at once", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [1, 1, 1]]), 5)).toEqual([{ tag: "wheee", variant: 0, start: 1, end: 5 }]);
  });

  it("cuts everything at the end of the performance and plays nothing past it", () => {
    expect(voiceEvents(pulls([[0, 0, 1], [6, 1, 0]]), 5)).toEqual([{ tag: "wheee", variant: 0, start: 0, end: 5 }]);
  });

  it("goes through the robot's variants in turn: 12 quacks, then the first again", () => {
    const track = [];
    for (let i = 0; i < 13; i++) track.push([2 * i, 1, 0], [2 * i + 1, 0, 0]);
    expect(voiceEvents(pulls(track), 100).map((sound) => sound.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
  });

  it("lets a wheee cut a quack still playing", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [1, 1, 0], [1.05, 0, 1]]), 5)).toEqual([
      { tag: "chirp", variant: 0, start: 1, end: 1.05 },
      { tag: "wheee", variant: 0, start: 1.05, end: 5 },
    ]);
  });

  it("ignores a change on the last step, which float error puts a hair before the end", () => {
    expect(voiceEvents(pulls([[0, 0, 0], [0.7, 1, 0]]), 35 * CTRL_DT)).toEqual([]);
  });

  it("makes no sound without a sound, nor with a song alone", () => {
    expect(voiceEvents(null, 20)).toEqual([]);
    expect(voiceEvents({ song: [note(1, 1)] }, 20)).toEqual([]);
  });

  it("hears no call inside a note: a quack pulled there is dropped, and RT still held after it does not quack", () => {
    expect(voiceEvents({ song: [note(1, 1)], triggers: [[0, 0, 0], [1.5, 1, 0]] }, 5)).toEqual([]);
  });

  it("cuts a quack or a wheee where a note starts", () => {
    expect(voiceEvents({ song: [note(1, 0.5)], triggers: [[0, 0, 0], [0.9, 1, 0], [0.95, 0, 0]] }, 5)).toEqual([
      { tag: "chirp", variant: 0, start: 0.9, end: 1 },
    ]);
  });

  it("starts the wheee again where a note ends while LT is still held, not between two notes in a row", () => {
    expect(voiceEvents({ song: [note(1, 0.5), note(1.5, 0.5)], triggers: [[0, 0, 1]] }, 3)).toEqual([
      { tag: "wheee", variant: 0, start: 0, end: 1 },
      { tag: "wheee", variant: 1, start: 2, end: 3 },
    ]);
  });

  it("quacks between two notes, cut by the next one", () => {
    expect(voiceEvents({ song: [note(0, 1), note(2, 1)], triggers: [[0, 0, 0], [1.5, 1, 0], [1.6, 0, 0]] }, 5)).toEqual([
      { tag: "chirp", variant: 0, start: 1.5, end: 2 },
    ]);
  });
});

describe("mouthTrack", () => {
  it("opens to the harder-pulled trigger like a servo, and holds the start through a lead", () => {
    const open = mouthTrack(pulls([[0, 0.5, 0], [1, 0, 1], [2, 0, 0]]), 200, 25);
    expect(open[0]).toBeCloseTo(0.5);
    expect(open[24]).toBeCloseTo(0.5); // the lead holds t = 0
    expect(open[75]).toBeLessThan(0.7); // eased at the change, not snapped
    expect(open[90]).toBeGreaterThan(0.99); // and there 0.3 s later
    expect(open[199]).toBeLessThan(0.01);
  });

  it("opens to the harder-pulled trigger when both are pulled", () => {
    for (const value of mouthTrack(pulls([[0, 0.4, 0.7]]), 3)) expect(value).toBeCloseTo(0.7);
  });

  it("opens to the sung vowel, a fifth of it in the release, shut between notes, eased like the robot's jaw", () => {
    const open = mouthTrack({ song: [note(1, 5, 0.9)] }, 350);
    expect(open[45]).toBeLessThan(0.01); // 0.9 s, before the note
    expect(open[52]).toBeLessThan(0.7); // eased at the note's start, not snapped
    expect(open[100]).toBeCloseTo(0.9); // 2 s, singing
    expect(open[299]).toBeCloseTo(0.18, 1); // 5.98 s, in the release
    expect(open[349]).toBeLessThan(0.01); // 6.98 s, after it
  });

  it("opens to the larger of the song and the triggers", () => {
    for (const value of mouthTrack({ song: [note(0, 10, 0.35)], triggers: [[0, 0.8, 0]] }, 3)) expect(value).toBeCloseTo(0.8);
  });

  it("leaves the beak alone without a sound", () => {
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

  it("sings in the stage duck's voice, tuned by the performance", () => {
    const asked = [];
    const record = (...args) => (asked.push(args), new Float32Array(1));
    const synth = { chirp: record, wheee: record };
    callSamples(synth, { tag: "chirp", variant: 0, start: 0, end: 1 }, { pitch: 1 });
    callSamples(synth, { tag: "wheee", variant: 3, start: 0, end: 1 }, { buzz: 0 });
    expect(asked).toEqual([
      [DUCK_SEED, 0, { pitch: 1 }],
      [DUCK_SEED, 3, 0, { buzz: 0 }],
      [DUCK_SEED, 3, 1, { buzz: 0 }],
    ]);
  });
});

describe("songSamples", () => {
  const synth = (asked) => ({
    song: (seed, voice, notes, seconds) => {
      asked.push([seed, voice, notes.length, seconds]);
      return new Float32Array(Math.max(1, Math.round(seconds * 48000))).fill(0.5);
    },
  });

  it("sings the whole song in the performer's voice, to its last release", () => {
    const asked = [];
    const sung = songSamples(synth(asked), { voice: { pitch: 1 }, song: [note(1, 1), note(2, 1)] }, 20);
    expect(asked).toEqual([[DUCK_SEED, { pitch: 1 }, 2, expect.closeTo(3.2)]]);
    expect(sung).toHaveLength(153600);
  });

  it("stops where a cut-short performance does, with a fade, and is never empty", () => {
    const sung = songSamples(synth([]), { song: [note(1, 3)] }, 2);
    expect(sung).toHaveLength(96000);
    expect(sung[0]).toBe(0.5);
    expect(sung.at(-1)).toBe(0);
    expect(songSamples(synth([]), { song: [note(1, 3)] }, 0)).toHaveLength(1);
  });

  it("is nothing without a song", () => {
    expect(songSamples(synth([]), pulls([[0, 1, 0]]), 20)).toBeNull();
    expect(songSamples(synth([]), null, 20)).toBeNull();
  });

  it("sings the duck's own part of a chorus when asked, and solo otherwise", () => {
    const asked = [];
    const record = { song: (seed, voice, notes, seconds, part) => (asked.push(part), new Float32Array(48000)) };
    songSamples(record, { song: [note(0, 1)] }, 20, { choral: true, variant: 2 });
    songSamples(record, { song: [note(0, 1)] }, 20);
    expect(asked).toEqual([{ choral: true, variant: 2 }, { choral: false, variant: 0 }]);
  });
});

describe("choirOf", () => {
  const sings = { sound: { song: [note(0, 1)] } };
  const quacks = { sound: pulls([[0, 1, 0]]) };

  it("makes a chorus of two or more singers, whatever the others do", () => {
    expect(choirOf([sings, quacks, sings])).toBe(true);
  });

  it("leaves a lone singer solo, and a silent troupe without a chorus", () => {
    expect(choirOf([sings, quacks, { sound: null }])).toBe(false);
    expect(choirOf([sings])).toBe(false);
    expect(choirOf([])).toBe(false);
  });
});

describe("limiter", () => {
  it("limits hard and fast, just under full scale", () => {
    const param = () => ({ value: null });
    const node = { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() };
    expect(limiter({ createDynamicsCompressor: () => node })).toBe(node);
    expect(Object.fromEntries(Object.entries(node).map(([name, { value }]) => [name, value]))).toEqual({
      threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1,
    });
  });
});
