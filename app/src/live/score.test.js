import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitCaption } from "./captions.js";
import { SAMPLE_RATE, VOICES, poseAt, prepare, prepareCall, singCaption } from "./score.js";
import { loadSynth } from "./voice.js";

const round3 = (value) => Math.round(value * 1000) / 1000;

const dialogue = {
  run_id: "01TESTRUN",
  turns: [
    { speaker: "peter", text: "Twelve point four seconds! That is a sprint, Ray, that is a sprint." },
    { speaker: "ray", text: "It is a number, Peter. A good one; I will grant you that much, and no more, not one inch more." },
    { speaker: "peter", text: "Grant it louder!" },
  ],
};

describe("prepare", () => {
  it("is deterministic for the same dialogue", () => {
    expect(prepare(dialogue)).toEqual(prepare(dialogue));
    expect(prepare(dialogue, 7)).not.toEqual(prepare(dialogue, 8));
  });

  it("times captions in order, in chunks of at most 84 characters, named after the voice", () => {
    const plan = prepare(dialogue);
    expect(plan.version).toBe(2);
    expect(plan.run_id).toBe("01TESTRUN");
    expect(plan.sample_rate).toBe(SAMPLE_RATE);
    expect(plan.channels).toBe(2);
    expect(plan.captions[0].start_ms).toBe(800);
    for (const [i, cue] of plan.captions.entries()) {
      expect(cue.text.length).toBeLessThanOrEqual(84);
      expect(cue.name).toBe(VOICES[cue.speaker].name);
      expect(cue.end_ms).toBeGreaterThan(cue.start_ms);
      if (i) expect(cue.start_ms).toBeGreaterThanOrEqual(plan.captions[i - 1].end_ms);
    }
    // Three turns, the second long enough to split in two captions.
    expect(plan.captions.map((c) => c.speaker)).toEqual(["peter", "ray", "ray", "peter"]);
  });

  it("ends on a frame boundary after the last caption and its pause", () => {
    const plan = prepare(dialogue);
    const last = plan.captions.at(-1).end_ms;
    expect(plan.duration_ms % 40).toBe(0);
    expect(plan.duration_ms).toBeGreaterThanOrEqual(last + 500);
    expect(plan.duration_ms).toBeLessThan(last + 540);
  });

  it("sings every note inside its speaker's caption, one at a time", () => {
    const plan = prepare(dialogue);
    expect(plan.notes.length).toBeGreaterThan(20);
    for (const [i, note] of plan.notes.entries()) {
      const inside = plan.captions.some(
        (c) => c.speaker === note.speaker && c.start_ms <= note.start_ms && note.end_ms <= c.end_ms,
      );
      expect(inside).toBe(true);
      if (i) expect(note.start_ms).toBeGreaterThanOrEqual(plan.notes[i - 1].end_ms);
      expect(note.end_ms - note.start_ms).toBeGreaterThanOrEqual(95);
      expect(Number.isInteger(note.variant)).toBe(true);
      expect(note.contour[0][0]).toBe(0);
      expect(note.contour.at(-1)[0]).toBe(1);
      expect(note.emphasis).toBeGreaterThan(0);
      expect(note.emphasis).toBeLessThanOrEqual(0.95);
    }
  });

  it("keeps every pitch inside the speaker's band: nothing too low, nothing too high", () => {
    const plan = prepare(dialogue);
    for (const note of plan.notes) {
      const [low, high] = VOICES[note.speaker].range;
      for (const [, pitch] of note.contour) {
        expect(pitch).toBeGreaterThanOrEqual(round3(low * 0.92));
        expect(pitch).toBeLessThanOrEqual(round3(high * 1.1));
      }
    }
  });

  it("talks in many gestures: struck and held, trilled and glided, never one note", () => {
    const plan = prepare(dialogue);
    expect(plan.notes.some((n) => n.held)).toBe(true);
    expect(plan.notes.some((n) => !n.held)).toBe(true);
    expect(plan.notes.some((n) => n.warble[1] > 1)).toBe(true);
    expect(plan.notes.some((n) => n.contour.length > 2)).toBe(true);
    const pitches = new Set(plan.notes.map((n) => n.contour[0][1]));
    expect(pitches.size).toBeGreaterThan(plan.notes.length / 2);
    const lengths = new Set(plan.notes.map((n) => n.end_ms - n.start_ms));
    expect(lengths.size).toBeGreaterThan(plan.notes.length / 3);
  });

  it("reads a number out one steady beep per digit, the same pitch for the same digit", () => {
    const plan = prepare({ run_id: "01DIGITS", turns: [
      { speaker: "ray", text: "Rank 1 of 1, 360 points" },
      { speaker: "peter", text: "Wow" },
    ] });
    const beeps = plan.notes.filter((n) => n.speaker === "ray" && n.end_ms - n.start_ms === 95 && n.held);
    const pitch = (n) => n.contour[0][1];
    expect(beeps).toHaveLength(5);
    expect(pitch(beeps[0])).toBe(pitch(beeps[1]));
    expect(pitch(beeps[3])).toBeGreaterThan(pitch(beeps[2]));
    expect(pitch(beeps[4])).toBeLessThan(pitch(beeps[0]));
  });

  it("ends a question on a rise", () => {
    const plan = prepare({ run_id: "01ASKING", turns: [
      { speaker: "peter", text: "Did you see that, Ray?" },
      { speaker: "ray", text: "No." },
    ] });
    const last = plan.notes.filter((n) => n.speaker === "peter").at(-1);
    expect(last.contour.at(-1)[1]).toBeGreaterThan(last.contour[0][1] * 1.15);
  });

  it("gives both ducks beats through the whole plan and glances during every turn", () => {
    const plan = prepare(dialogue);
    for (const speaker of ["peter", "ray"]) {
      const beats = plan.gestures.filter((g) => g.kind === "beat" && g.speaker === speaker);
      expect(beats[0].start_ms).toBe(0);
      expect(beats.at(-1).end_ms).toBe(plan.duration_ms);
      const looks = plan.gestures.filter((g) => g.kind === "look" && g.speaker === speaker);
      expect(looks.length).toBeGreaterThan(0);
      // Peter looks right, toward Ray; Ray looks left.
      for (const look of looks) expect(Math.sign(look.yaw)).toBe(speaker === "peter" ? 1 : -1);
    }
  });

  it("refuses what it cannot time", () => {
    const turn = (speaker, text) => ({ speaker, text });
    expect(() => prepare({ run_id: "", turns: dialogue.turns })).toThrow("Invalid commentary");
    expect(() => prepare({ run_id: "x", turns: dialogue.turns.slice(0, 1) })).toThrow("Invalid commentary");
    expect(() => prepare({ run_id: "x", turns: Array(7).fill(0).map((_, i) => turn(i % 2 ? "ray" : "peter", "Yes.")) })).toThrow("Invalid commentary");
    expect(() => prepare({ run_id: "x", turns: [turn("peter", "One."), turn("peter", "Two.")] })).toThrow("Invalid commentary turn");
    expect(() => prepare({ run_id: "x", turns: [turn("peter", "One."), turn("bob", "Two.")] })).toThrow("Invalid commentary turn");
  });
});

describe("prepareCall", () => {
  const call = {
    id: "tug-of-war-0001-003",
    duration_ms: 20000,
    lines: [
      { at_ms: 2000, speaker: "peter", text: "The marker slides west!" },
      { at_ms: 9000, by_ms: 20000, speaker: "ray", text: "And into the pit." },
    ],
  };

  it("starts each caption at its line's moment", () => {
    const plan = prepareCall(call);
    expect(plan.version).toBe(2);
    expect(plan.run_id).toBe(call.id);
    expect(plan.duration_ms).toBe(20000);
    expect(plan.gestures).toEqual([]);
    expect(plan.captions.find((c) => c.speaker === "peter").start_ms).toBe(2000);
    expect(plan.captions.find((c) => c.speaker === "ray").start_ms).toBe(9000);
    for (const note of plan.notes) {
      expect(plan.captions.some((c) => c.speaker === note.speaker && c.start_ms <= note.start_ms && note.end_ms <= c.end_ms)).toBe(true);
    }
  });

  it("pushes a line that would overlap the one before", () => {
    const plan = prepareCall({
      ...call,
      lines: [
        { at_ms: 1000, speaker: "peter", text: "The marker slides west, and it keeps on sliding, Ray!" },
        { at_ms: 1200, by_ms: 2000, speaker: "ray", text: "Slowly." },
      ],
    });
    const peter = plan.captions.filter((c) => c.speaker === "peter");
    // Even a line to be heard by a time it can no longer make never starts over the one before.
    expect(plan.captions.find((c) => c.speaker === "ray").start_ms).toBe(peter.at(-1).end_ms);
  });

  it("hears a bout's last line whole by its by_ms, so the next bout's first line starts on its moment", () => {
    // The rehearsal's match 002: each bout ends on its tape's last frame, 520 ms before the next
    // bout's tape and 2540 ms before the clip's end.
    const rehearsal = {
      id: "tug-of-war-0001-002",
      duration_ms: 75040,
      lines: [
        { at_ms: 3520, speaker: "peter", text: "Backpedal and Sway start the first bout, both ducks steady." },
        { at_ms: 48520, by_ms: 49040, speaker: "ray", text: "Time expires, marker favors Backpedal, who takes the bout." },
        { at_ms: 49040, speaker: "peter", text: "Bout two begins with Backpedal leading one bout to nil." },
        { at_ms: 66080, speaker: "ray", text: "Sway is dangerously close to the pit now." },
        { at_ms: 72500, by_ms: 75040, speaker: "peter", text: "Sway drops into the pit, Backpedal wins the match." },
      ],
    };
    const plan = prepareCall(rehearsal);
    // The same lines with nothing to be heard by and room for all: each one's natural length.
    const natural = prepareCall({ ...rehearsal, duration_ms: 120000, lines: rehearsal.lines.map(({ by_ms, ...line }) => line) });
    expect(plan.captions.map((c) => c.text)).toEqual(rehearsal.lines.map((line) => line.text));
    for (const [i, caption] of plan.captions.entries()) {
      expect(caption.end_ms - caption.start_ms).toBe(natural.captions[i].end_ms - natural.captions[i].start_ms);
      if (i) expect(caption.start_ms).toBeGreaterThanOrEqual(plan.captions[i - 1].end_ms);
    }
    expect(plan.captions[1].end_ms).toBe(49040);
    expect(plan.captions[2].start_ms).toBe(49040);
    expect(plan.captions[3].start_ms).toBe(66080);
    expect(plan.captions[4].end_ms).toBe(75040);
  });

  it("breaks a word too long for a caption line where the line ends, so a duck's long name is still said", () => {
    // A policy name may be 80 characters, and a call names its duck exactly as printed.
    const text = "tug-of-war-ppo-legs-reference-2026-10-20-seed3 pulls west!";
    const plan = prepareCall({ ...call, lines: [{ at_ms: 2000, speaker: "peter", text }] });
    expect(plan.captions.map((c) => c.text)).toEqual(["tug-of-war-ppo-legs-reference-2026-10-20-s eed3 pulls west!"]);
    expect(splitCaption(plan.captions[0].text, (line) => line.length, 42)).toEqual([
      "tug-of-war-ppo-legs-reference-2026-10-20-s", "eed3 pulls west!"]);
    expect(prepare({ run_id: "x", turns: [{ speaker: "peter", text: "x".repeat(80) }, { speaker: "ray", text: "Two." }] })
      .captions[0].text).toBe(`${"x".repeat(42)} ${"x".repeat(38)}`);
  });

  it("keeps every caption and note inside the clip", () => {
    const plan = prepareCall({
      ...call,
      lines: [{ at_ms: 19000, speaker: "peter", text: "The marker slides west, and it keeps on sliding, Ray, to the edge!" }],
    });
    expect(plan.captions[0].start_ms).toBe(19000);
    for (const item of [...plan.captions, ...plan.notes]) expect(item.end_ms).toBeLessThanOrEqual(20000);
  });

  it("is deterministic and refuses what it cannot time", () => {
    expect(prepareCall(call)).toEqual(prepareCall(call));
    const [first, second] = call.lines;
    for (const bad of [
      { ...call, lines: [{ ...first, at_ms: 20000 }] },
      { ...call, lines: [first, { ...second, by_ms: 20040 }] },
      { ...call, lines: [first, { ...second, by_ms: 9000 }] },
      { ...call, lines: [second, first] },
      { ...call, duration_ms: 20010 },
      { ...call, lines: [{ ...first, speaker: "paul" }] },
      { ...call, lines: [] },
    ]) {
      expect(() => prepareCall(bad)).toThrow("Invalid call");
    }
  });
});

describe("poseAt", () => {
  it("is pure in time: the same instant gives the same pose, silence gives rest", () => {
    const plan = prepare(dialogue);
    const a = poseAt(plan, "peter", 5000);
    expect(poseAt(plan, "peter", 5000)).toEqual(a);
    // Between the beats' envelopes at t=0 everything is at rest and the mouth is shut.
    const rest = poseAt(plan, "ray", 0);
    expect(rest.mouth).toBe(0);
    expect(rest.energy).toBe(0);
  });

  it("opens the mouth only while a note of that speaker sings", () => {
    const plan = prepare(dialogue);
    const note = plan.notes.find((n) => n.speaker === "ray");
    const mid = (note.start_ms + note.end_ms) / 2;
    expect(poseAt(plan, "ray", mid).mouth).toBeGreaterThan(0);
    expect(poseAt(plan, "peter", mid).mouth).toBe(0);
  });

  it("turns Peter's head right and Ray's left during a glance", () => {
    const plan = prepare(dialogue);
    for (const speaker of ["peter", "ray"]) {
      const look = plan.gestures.find((g) => g.kind === "look" && g.speaker === speaker);
      const yaw = poseAt(plan, speaker, (look.start_ms + look.end_ms) / 2).yaw;
      expect(Math.sign(yaw)).toBe(speaker === "peter" ? 1 : -1);
    }
  });
});

describe("singCaption", () => {
  const voice = loadSynth(async () => ({ ok: true, arrayBuffer: async () => readFileSync("public/sound/microduck-voice.wasm") }));

  it("sings a caption's own notes in mono at 48 kHz, from the caption's start, silent outside them", async () => {
    const plan = prepare(dialogue);
    const [caption] = plan.captions;
    const out = new Float32Array((caption.end_ms - caption.start_ms) * 48);
    singCaption(plan, caption, await voice, out);
    const notes = plan.notes.filter((n) => caption.start_ms <= n.start_ms && n.start_ms < caption.end_ms);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.end_ms <= caption.end_ms)).toBe(true);
    const [note] = notes;
    expect(out[Math.round(((note.start_ms + note.end_ms) / 2 - caption.start_ms) * 48)]).not.toBe(0);
    expect(out.slice(0, (note.start_ms - caption.start_ms) * 48).every((sample) => sample === 0)).toBe(true);
    expect(out.slice((notes.at(-1).end_ms - caption.start_ms) * 48).every((sample) => sample === 0)).toBe(true);
    expect(out.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(0.5);
  });

  it("sings the two commentators in two different voices", async () => {
    const sing = await voice;
    const note = { start_ms: 0, end_ms: 200, variant: 1, contour: [[0, 1], [1, 1]], held: true, warble: [0, 0], buzz: 0 };
    const peter = Array.from(sing(VOICES.peter.seed, note));
    const ray = Array.from(sing(VOICES.ray.seed, note));
    expect(peter).toHaveLength(9600);
    expect(peter).not.toEqual(ray);
    expect(Array.from(sing(VOICES.peter.seed, note))).toEqual(peter);
  });
});
