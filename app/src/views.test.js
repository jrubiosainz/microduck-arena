import { describe, expect, it } from "vitest";
import { MODES, TOP_ROWS, modeIsUseful, visibleRows } from "./views.js";

const field = (n, mineAt = []) =>
  Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    run_id: `R${i + 1}`,
    user: mineAt.includes(i) ? "alice" : `someone${i}`,
    score: 10 + i,
    seeds_finished: 5,
  }));

describe("visibleRows", () => {
  it("shows everything when neither narrowing is on", () => {
    // "All" is not a third mode: it is the absence of the other two.
    expect(visibleRows(field(12))).toHaveLength(12);
    expect(visibleRows(field(12), { mine: false, top: false })).toHaveLength(12);
  });

  it("shows the three leaders in top, and only those", () => {
    expect(TOP_ROWS).toBe(3);
    const shown = visibleRows(field(12), { top: true });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("does not add your best to top — that is what mine is for", () => {
    // The two keys compose, so top no longer has to smuggle your row in.
    const shown = visibleRows(field(12, [8]), { top: true, me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shows every one of your runs in mine, and nothing else", () => {
    const shown = visibleRows(field(12, [7, 9]), { mine: true, me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([8, 10]);
  });

  it("takes the UNION when both are on, not the intersection", () => {
    // An intersection would be empty in exactly the case someone turns both
    // on for: the podium, and where you actually are.
    const shown = visibleRows(field(12, [7, 9]), { mine: true, top: true, me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3, 8, 10]);
  });

  it("does not list you twice when you are on the podium", () => {
    const shown = visibleRows(field(12, [1]), { mine: true, top: true, me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("NEVER renumbers a rank", () => {
    // The rule that matters: a view that renumbered 1..n would tell someone
    // they were third when they were eleventh.
    for (const mine of [false, true]) {
      for (const top of [false, true]) {
        for (const row of visibleRows(field(12, [10]), { mine, top, me: "alice" })) {
          expect(row.rank).toBe(Number(row.run_id.slice(1)));
        }
      }
    }
  });

  it("keeps the rows in their ranked order", () => {
    const shown = visibleRows(field(12, [9]), { mine: true, top: true, me: "alice" });
    expect(shown.map((r) => r.rank)).toEqual([...shown.map((r) => r.rank)].sort((a, b) => a - b));
  });

  it("always keeps a trial, whichever keys are on", () => {
    // It is the run you just asked for; hiding it would make Test look broken.
    const rows = [...field(9), { rank: 0, run_id: null, user: "you", provisional: true }];
    for (const mine of [false, true]) {
      for (const top of [false, true]) {
        expect(visibleRows(rows, { mine, top, me: "nobody" }).some((r) => r.provisional)).toBe(true);
      }
    }
  });

  it("is harmless when nobody is signed in", () => {
    expect(visibleRows(field(12), { top: true }).map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(visibleRows(field(12), { mine: true })).toHaveLength(0);
  });

  it("copes with a field smaller than the cut", () => {
    expect(visibleRows(field(2), { top: true })).toHaveLength(2);
    expect(visibleRows([], { top: true })).toHaveLength(0);
  });

  it("names the three keys the header offers", () => {
    expect(MODES).toEqual(["all", "mine", "top"]);
  });
});

describe("modeIsUseful", () => {
  it("says mine is pointless when nobody is signed in", () => {
    expect(modeIsUseful("mine", null)).toBe(false);
    expect(modeIsUseful("mine", "alice")).toBe(true);
    expect(modeIsUseful("top", null)).toBe(true);
  });
});
