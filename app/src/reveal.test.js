import { describe, expect, it } from "vitest";
import { climbPlan, revealFor } from "./reveal.js";

const run = { user: "ann", seen: false };

describe("revealFor", () => {
  it("reveals only to the author, once, with motion allowed", () => {
    expect(revealFor(run, { user: "ann" })).toBe(true);
    expect(revealFor(run, { user: "bob" })).toBe(false);
    expect(revealFor({ ...run, seen: true }, { user: "ann" })).toBe(false);
    expect(revealFor(run, { user: "ann" }, true)).toBe(false);
    expect(revealFor(run, null)).toBe(false);
  });
});

describe("climbPlan", () => {
  const row = (rank, you = false) => ({ rank, run_id: `R${rank}`, you });

  it("starts you at the bottom of the window, the rows under you one place up", () => {
    const board = [row(5), row(6), row(7, true), row(8), row(9)];
    const { start, end } = climbPlan(board);
    expect(start.map((r) => [r.run_id, r.rank])).toEqual([
      ["R5", 5], ["R6", 6], ["R8", 7], ["R9", 8], ["R7", 9],
    ]);
    expect(end).toBe(board);
  });

  it("has nothing to climb when nobody is under you", () => {
    const board = [row(1), row(2, true)];
    const { start, end } = climbPlan(board);
    expect(start).toBe(end);
  });
});
