import { describe, expect, it } from "vitest";
import { BOUT_HOLD_S, boutAt, matchPlan, matchWords, scoreAt } from "./match.js";
import { actAt } from "./plan.js";

describe("matchPlan", () => {
  const full = { settle: 26, steps: 2250 };
  it("chains three 45 s bouts between the title and the outro, each held 4 s once it ends: a 154 s clip", () => {
    const plan = matchPlan([0, 1, 2].map((k) => ({ k, ...full })));
    expect(plan.frames).toBe(3852);
    expect(plan.seconds).toBeCloseTo(154.08);
    expect(plan.bouts).toEqual([{ k: 0, tape_start_s: 3.52, tape_end_s: 48.52, hold_end_s: 52.52 },
      { k: 1, tape_start_s: 53.04, tape_end_s: 98.04, hold_end_s: 102.04 },
      { k: 2, tape_start_s: 102.56, tape_end_s: 147.56, hold_end_s: 151.56 }]);
  });
  it("makes the longest match, five full bouts, 253 s long", () => {
    expect(matchPlan([0, 1, 2, 3, 4].map((k) => ({ k, ...full }))).seconds).toBeCloseTo(253.12);
  });
  // Tape frames 75-77, held to 177; then 178-181, held to 281; the outro from 282.
  const small = () => matchPlan([{ k: 0, settle: 2, steps: 4 }, { k: 1, settle: 2, steps: 6 }]);
  it("finds the bout and its step for every frame, a bout's last step held until the next bout or the outro", () => {
    const plan = small();
    expect(BOUT_HOLD_S).toBe(4);
    expect([0, 76, 78, 177, 178, 181, 281, plan.frames - 1].map((i) => boutAt(plan, i))).toEqual([
      { bout: 0, step: 0 }, { bout: 0, step: 2 }, { bout: 0, step: 5 }, { bout: 0, step: 5 }, { bout: 1, step: 0 },
      { bout: 1, step: 6 }, { bout: 1, step: 7 }, { bout: 1, step: 7 }]);
    expect([281, 282].map((i) => actAt(plan, i))).toEqual(["tape", "outro"]);
    expect(plan.frames).toBe(282 + 63);
  });
  it("counts a bout on the bug as soon as its tape ends, so its result shows through the hold", () => {
    const plan = small(), match = { bouts: [{ winner: "a" }, { winner: "b" }] };
    expect([77, 78, 177, 181, 182, plan.frames - 1].map((i) => scoreAt(plan, match, i))).toEqual(
      [[0, 0], [1, 0], [1, 0], [1, 0], [1, 1], [1, 1]]);
  });
  it("says who meets whom and who won", () => {
    const match = { cup: 3, title: "Final · Tank vs Lean", event: { title: "Tug of War" },
      a: { name: "Tank" }, b: { name: "Lean" }, winner: "a", wins: [2, 1] };
    expect(matchWords(match)).toEqual({ title: "Tug of War · Cup #3", line: "Final · Tank vs Lean", outro: "Tank wins 2–1" });
  });
  it("says a tie went to the rating, not a score nobody won by", () => {
    const match = { cup: 3, title: "Group A · Tank vs Lean", event: { title: "Tug of War" },
      a: { name: "Tank" }, b: { name: "Lean" }, winner: "b", wins: [1, 1], decided_by: "rating" };
    expect(matchWords(match).outro).toBe("Lean wins on rating");
  });
});
