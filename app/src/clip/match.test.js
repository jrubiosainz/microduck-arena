import { describe, expect, it } from "vitest";
import { boutAt, matchPlan, matchWords, scoreAt } from "./match.js";

describe("matchPlan", () => {
  const full = { settle: 26, steps: 2250 };
  it("chains three 45 s bouts between the title and the outro: a 142 s clip", () => {
    const plan = matchPlan([0, 1, 2].map((k) => ({ k, ...full })));
    expect(plan.frames).toBe(3552);
    expect(plan.seconds).toBeCloseTo(142.08);
    expect(plan.bouts).toEqual([{ k: 0, tape_start_s: 3.52, tape_end_s: 48.52 },
      { k: 1, tape_start_s: 49.04, tape_end_s: 94.04 }, { k: 2, tape_start_s: 94.56, tape_end_s: 139.56 }]);
  });
  it("keeps the longest match, five full bouts, under four minutes", () => {
    expect(matchPlan([0, 1, 2, 3, 4].map((k) => ({ k, ...full }))).seconds).toBeCloseTo(233.12);
  });
  const small = () => matchPlan([{ k: 0, settle: 2, steps: 4 }, { k: 1, settle: 2, steps: 6 }]);   // tape frames 75-77, then 78-81
  it("finds the bout and its step for every frame", () => {
    const plan = small();
    expect([0, 76, 78, 81, plan.frames - 1].map((i) => boutAt(plan, i))).toEqual([
      { bout: 0, step: 0 }, { bout: 0, step: 2 }, { bout: 1, step: 0 }, { bout: 1, step: 6 }, { bout: 1, step: 7 }]);
  });
  it("counts a bout on the bug once its tape has ended", () => {
    const plan = small(), match = { bouts: [{ winner: "a" }, { winner: "b" }] };
    expect([77, 78, plan.frames - 1].map((i) => scoreAt(plan, match, i))).toEqual([[0, 0], [1, 0], [1, 1]]);
  });
  it("says who meets whom and who won", () => {
    const match = { cup: 3, title: "Final · Tank vs Lean", event: { title: "Tug of War" },
      a: { name: "Tank" }, b: { name: "Lean" }, winner: "a", wins: [2, 1] };
    expect(matchWords(match)).toEqual({ title: "Tug of War · Cup #3", line: "Final · Tank vs Lean", outro: "Tank wins 2–1" });
  });
});
