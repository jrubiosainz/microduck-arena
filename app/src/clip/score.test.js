import { describe, expect, it } from "vitest";
import { clipPlan } from "./plan.js";
import { clipScore, jingleFile } from "./score.js";

const event = { id: "sprint-2m", length_m: 2, clip: { sounds: ["crowd", "jingle", "verdict"], jingle: null } };
const trace = new Float32Array(200 * 21);
for (let i = 0; i < 200; i++) trace[i * 21] = i / 100; // x from 0 to 2 m

describe("jingleFile", () => {
  it("is the same variant for the same event, and the pinned one when pinned", () => {
    expect(jingleFile("sprint-2m")).toBe(jingleFile("sprint-2m"));
    expect(jingleFile("sprint-2m")).toMatch(/^round-[0-4]\.wav$/);
    expect(jingleFile("sprint-2m", "round-3")).toBe("round-3.wav");
  });
});

describe("clipScore", () => {
  const plan = clipPlan(200, 12);

  it("cues the jingle on the title, the stamp at the tape end and the victory after it", () => {
    const score = clipScore({ run: { run_id: "R1", event, seeds_finished: 5 }, plan, trace });
    expect(score.cues.map((c) => [c.at, c.file])).toEqual([
      [0, jingleFile("sprint-2m")],
      [5, "stamp.wav"],
      [5.16, "microduck-victory.wav"],
    ]);
    expect(score.crowd).toMatchObject({ start: 1, end: 5, verdict: "pass" });
    expect(score.crowd.progress[0]).toEqual({ second: 1, value: 0 });
    expect(score.crowd.progress.at(-1).value).toBeGreaterThan(0.9);
  });

  it("falls after a DNF, and only plays the sources the event lists", () => {
    const dnf = clipScore({ run: { run_id: "R2", event, seeds_finished: 0 }, plan, trace });
    expect(dnf.cues.at(-1).file).toBe("microduck-fall.wav");
    expect(dnf.crowd.verdict).toBe("fail");
    const quiet = clipScore({
      run: { run_id: "R3", event: { ...event, clip: { sounds: ["crowd"], jingle: null } }, seeds_finished: 5 },
      plan, trace,
    });
    expect(quiet.cues).toEqual([]);
  });
});
