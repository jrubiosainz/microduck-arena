import { describe, expect, it } from "vitest";
import { clipPlan } from "./plan.js";
import { clipScore } from "./score.js";

const event = { id: "sprint-2m", length_m: 2, clip: { sounds: ["crowd", "horn", "verdict"] } };
const trace = new Float32Array(200 * 21);
for (let i = 0; i < 200; i++) trace[i * 21] = i / 100; // x from 0 to 2 m

describe("clipScore", () => {
  const plan = clipPlan(200, 12, 0);

  it("sounds the horn at the start, the stamp at the tape end and the victory after it", () => {
    const score = clipScore({ run: { run_id: "R1", event, seeds_finished: 5 }, plan, trace });
    expect(score.cues.map((c) => [c.at, c.file])).toEqual([
      [3, "air-horn.mp3"],
      [7, "stamp.wav"],
      [7.16, "microduck-victory-echo.mp3"],
    ]);
    expect(score.crowd).toMatchObject({ start: 3, end: 7, verdict: "pass" });
    expect(score.crowd.progress[0]).toEqual({ second: 3, value: 0 });
    expect(score.crowd.progress.at(-1).value).toBeGreaterThan(0.9);
  });

  it("falls after a DNF, and only plays the sources the event lists", () => {
    const dnf = clipScore({ run: { run_id: "R2", event, seeds_finished: 0 }, plan, trace });
    expect(dnf.cues.at(-1).file).toBe("microduck-fall.wav");
    expect(dnf.crowd.verdict).toBe("fail");
    const quiet = clipScore({
      run: { run_id: "R3", event: { ...event, clip: { sounds: ["crowd"] } }, seeds_finished: 5 },
      plan, trace,
    });
    expect(quiet.cues).toEqual([]);
  });

  it("a stage's crowd answers the verdict alone: a performance goes down no course", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const plan = clipPlan(1000, 20, 26);
    const trace = new Float32Array(21 * 1026);
    const score = clipScore({ run, plan, trace });
    expect(score.crowd.progress).toEqual([]);
    expect(score.cues.map((cue) => cue.file)).not.toContain("air-horn.mp3");
  });

  it("puts the duck's quack and wheee on the tape after the settle, cut where the performance ends", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const plan = clipPlan(250, 20, 26); // a 5 s performance after 26 frames of settle
    const sound = { triggers: [[0, 0, 0], [1, 1, 0], [1.2, 0, 0], [4, 0, 1]] };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const voice = clipScore({ run, plan, trace: new Float32Array(21 * 276), sound }).cues.filter((cue) => cue.call);
    expect(voice.map((cue) => cue.call)).toEqual([
      { tag: "chirp", variant: 0, start: 1, end: 4 },
      { tag: "wheee", variant: 0, start: 4, end: 5 },
    ]);
    expect(voice[0].at).toBeCloseTo(3 + 0.52 + 1);
    expect(voice[1].at).toBeCloseTo(3 + 0.52 + 4);
  });

  it("a performance that makes no sound adds no voice", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const score = clipScore({ run, plan: clipPlan(250, 20, 26), trace: new Float32Array(21 * 276), sound: null });
    expect(score.cues.some((cue) => cue.call)).toBe(false);
  });

  it("puts the duck's song on the tape at the performance's start, and its calls in its voice", () => {
    const event = { id: "got-a-talent", course: "stage", clip: { tape_max_s: 20, sounds: ["crowd", "verdict"] } };
    const plan = clipPlan(250, 20, 26); // a 5 s performance after 26 frames of settle
    const sound = { voice: { pitch: 1 }, song: [[0.5, 1, 69, 0.7, 0.9, 0]], triggers: [[0, 0, 0], [2, 1, 0]] };
    const run = { run_id: "r1", seeds_finished: 1, event };
    const cues = clipScore({ run, plan, trace: new Float32Array(21 * 276), sound }).cues;
    const sung = cues.find((cue) => cue.song);
    expect(sung.at).toBeCloseTo(3 + 0.52);
    expect(sung.song.sound).toBe(sound);
    expect(sung.song.duration).toBeCloseTo(5);
    expect(cues.find((cue) => cue.call).voice).toEqual({ pitch: 1 });
  });
});
