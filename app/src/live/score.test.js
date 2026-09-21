import { describe, expect, it } from "vitest";
import { SAMPLE_RATE, VOICES, poseAt, prepare, synthesize } from "./score.js";

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
    expect(plan.version).toBe(1);
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

  it("sings every note inside its speaker's caption", () => {
    const plan = prepare(dialogue);
    expect(plan.notes.length).toBeGreaterThan(20);
    for (const note of plan.notes) {
      const inside = plan.captions.some(
        (c) => c.speaker === note.speaker && c.start_ms <= note.start_ms && note.end_ms <= c.end_ms,
      );
      expect(inside).toBe(true);
      expect(note.rate).toBeGreaterThanOrEqual(0.97);
      expect(note.rate).toBeLessThan(1.04);
      expect(note.emphasis).toBeGreaterThan(0);
      expect(note.emphasis).toBeLessThanOrEqual(0.95);
    }
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
    expect(() => prepare({ run_id: "x", turns: [turn("peter", "x".repeat(43)), turn("ray", "Two.")] })).toThrow("Caption word is too long");
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

describe("synthesize", () => {
  const tone = new Float32Array(28800).map((_, i) => Math.sin(i / 20));
  it("fills exactly the plan's duration in stereo at 48 kHz, silent outside the notes", () => {
    const plan = prepare(dialogue);
    const pcm = synthesize(plan, { peter: tone, ray: tone });
    expect(pcm.length).toBe(plan.duration_ms * 96);
    expect(pcm[0]).toBe(0);
    expect(pcm[pcm.length - 1]).toBe(0);
    const note = plan.notes[0];
    const at = Math.round(((note.start_ms + note.end_ms) / 2) * 48) * 2;
    expect(pcm[at]).not.toBe(0);
    expect(pcm[at]).toBe(pcm[at + 1]);
    expect(pcm.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(1);
  });

  it("refuses a missing or short tone", () => {
    const plan = prepare(dialogue);
    expect(() => synthesize(plan, { peter: tone })).toThrow("Missing native voice: ray");
    expect(() => synthesize(plan, { peter: tone, ray: new Float32Array(10) })).toThrow("too short");
  });
});
