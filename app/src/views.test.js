import { describe, expect, it } from "vitest";
import { MODES, modeIsUseful, visibleRows } from "./views.js";

const field = (n, mineAt = []) =>
  Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    run_id: `R${i + 1}`,
    user: mineAt.includes(i) ? "alice" : `someone${i}`,
    score: 10 + i,
    seeds_finished: 5,
  }));

describe("visibleRows", () => {
  it("shows everything in all", () => {
    expect(visibleRows(field(12), { mode: "all" })).toHaveLength(12);
  });

  it("shows the five leaders in top", () => {
    const shown = visibleRows(field(12), { mode: "top" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("adds your best when you are outside the five", () => {
    const shown = visibleRows(field(12, [8]), { mode: "top", me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 9]);
  });

  it("adds only your BEST, not all of your runs", () => {
    const shown = visibleRows(field(12, [7, 8, 9]), { mode: "top", me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 8]);
  });

  it("does not duplicate you when you are already in the five", () => {
    const shown = visibleRows(field(12, [2]), { mode: "top", me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("shows your runs and the podium in mine", () => {
    const shown = visibleRows(field(12, [7, 9]), { mode: "mine", me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3, 8, 10]);
  });

  it("NEVER renumbers a rank", () => {
    // The rule that matters: a view that renumbered 1..n would tell someone
    // they were third when they were eleventh.
    for (const mode of MODES) {
      for (const row of visibleRows(field(12, [10]), { mode, me: "alice" })) {
        expect(row.rank).toBe(Number(row.run_id.slice(1)));
      }
    }
  });

  it("keeps the rows in their ranked order", () => {
    const shown = visibleRows(field(12, [9]), { mode: "top", me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([...shown.map((r) => r.rank)].sort((a, b) => a - b));
  });

  it("always keeps a trial, whatever the mode", () => {
    // It is the run you just asked for; hiding it would make Test look broken.
    const rows = [...field(9), { rank: 0, run_id: null, user: "you", provisional: true }];
    for (const mode of MODES) {
      expect(visibleRows(rows, { mode, me: "nobody" }).some((r) => r.provisional)).toBe(true);
    }
  });

  it("is harmless when nobody is signed in", () => {
    expect(visibleRows(field(12), { mode: "top" }).map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(visibleRows(field(12), { mode: "mine" }).map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("copes with a field smaller than the cut", () => {
    expect(visibleRows(field(2), { mode: "top" })).toHaveLength(2);
    expect(visibleRows([], { mode: "top" })).toHaveLength(0);
  });

  it("falls back to top on a mode it does not know", () => {
    expect(visibleRows(field(12), { mode: "nonsense" }).map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("modeIsUseful", () => {
  it("says mine is pointless when nobody is signed in", () => {
    expect(modeIsUseful("mine", null)).toBe(false);
    expect(modeIsUseful("mine", "alice")).toBe(true);
    expect(modeIsUseful("top", null)).toBe(true);
  });
});
