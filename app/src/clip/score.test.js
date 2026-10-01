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
});
