import { describe, expect, it } from "vitest";
import { correction, shouldReload, slotAfter, slotAt } from "./grid.js";

const slots = [
  { kind: "shutter", at_ms: 1000, duration_ms: 1600, next: { run_id: "A" } },
  { kind: "replay", at_ms: 2600, duration_ms: 8000, run_id: "A" },
  { kind: "shutter", at_ms: 10600, duration_ms: 1600, next: null },
  { kind: "booth", at_ms: 12200, duration_ms: 20000, run_id: "A" },
];

describe("slotAt / slotAfter", () => {
  it("finds the slot containing an instant, or nothing", () => {
    expect(slotAt(slots, 999)).toBeNull();
    expect(slotAt(slots, 1000).kind).toBe("shutter");
    expect(slotAt(slots, 2599).kind).toBe("shutter");
    expect(slotAt(slots, 2600).kind).toBe("replay");
    expect(slotAt(slots, 32199).kind).toBe("booth");
    expect(slotAt(slots, 32200)).toBeNull();
  });

  it("walks to the slot that starts where this one ends", () => {
    expect(slotAfter(slots, slots[0])).toBe(slots[1]);
    expect(slotAfter(slots, slots[3])).toBeNull();
    // A rebuilt grid may not contain the same object; the boundary is what matters.
    expect(slotAfter(slots, { ...slots[1] })).toBe(slots[2]);
  });
});

describe("correction", () => {
  const buffered = [[0, 30]];
  it("leaves a quarter second alone, nudges under a second, seeks beyond", () => {
    expect(correction(10, 10.2, buffered)).toEqual({ rate: 1 });
    expect(correction(10, 10.6, buffered)).toEqual({ rate: 1.03 });
    expect(correction(10, 9.4, buffered)).toEqual({ rate: 0.97 });
    expect(correction(10, 12, buffered)).toEqual({ rate: 1, time: 12 });
  });

  it("seeks into buffered media only, unless forced", () => {
    expect(correction(10, 10.2, buffered, true)).toEqual({ rate: 1, time: 10.2 });
    expect(correction(10, 40, buffered)).toEqual({ rate: 1 });
    // A screen joining a match clip 50 s in: the browser has buffered its first seconds only.
    expect(correction(0, 50, [[0, 13.4]], true)).toEqual({ rate: 1, time: 50 });
  });
});

describe("shouldReload", () => {
  it("reloads only when the build changed", () => {
    expect(shouldReload("abc", "abc")).toBe(false);
    expect(shouldReload("abc", "def")).toBe(true);
  });
});
