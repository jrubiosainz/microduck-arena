import { describe, expect, it, vi } from "vitest";
import { INDICATIVE, formatTrial, renderResult, renderRuns } from "./trial.js";

const run = {
  id: "2026-09-28_10-00-00_first", name: "first", started: "2026-09-28T10:00:00Z", dirty: false,
  checkpoints: [0, 1000, 2999],
  trials: { 1000: { score: 3.2, seeds_finished: 5, seeds_total: 5, command_vx: 0.6 } },
};

describe("choosing what to test", () => {
  it("says what to do when there is no run yet", () => {
    const zone = document.createElement("div");
    renderRuns(zone, [], null, { onSelect: vi.fn(), onTest: vi.fn() });
    expect(zone.textContent).toMatch(/No run yet/);
  });

  it("lists every checkpoint, with the score of those already tested", () => {
    const zone = document.createElement("div");
    renderRuns(zone, [run], null, { onSelect: vi.fn(), onTest: vi.fn() });
    const chips = [...zone.querySelectorAll(".checkpoint")].map((b) => b.textContent);
    expect(chips).toHaveLength(3);
    expect(chips[1]).toContain("3.20 s");
  });

  it("selects a checkpoint, then tests it", () => {
    const zone = document.createElement("div");
    const onSelect = vi.fn();
    const onTest = vi.fn();
    renderRuns(zone, [run], null, { onSelect, onTest });
    zone.querySelectorAll(".checkpoint")[2].click();
    expect(onSelect).toHaveBeenCalledWith({ run, checkpoint: 2999 });
    renderRuns(zone, [run], { run, checkpoint: 2999 }, { onSelect, onTest });
    expect(zone.querySelector(".checkpoint[aria-pressed=true]").textContent).toContain("2999");
    zone.querySelector(".trial__go").click();
    expect(onTest).toHaveBeenCalled();
  });
});

describe("a test's result", () => {
  it("is a time, how many starts finished, at which speed — and indicative", () => {
    expect(formatTrial({ score: 3.2, seeds_finished: 5, seeds_total: 5, command_vx: 0.6 }))
      .toBe("3.20 s · 5/5 finished · best at 0.60 m/s");
    const zone = document.createElement("div");
    renderResult(zone, { checkpoint: 1000, score: 3.2, seeds_finished: 5, seeds_total: 5, command_vx: 0.6, per_seed: [] });
    expect(zone.textContent).toContain(INDICATIVE);
    expect(zone.textContent).toContain("checkpoint 1000");
  });
});
