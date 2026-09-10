import { describe, expect, it } from "vitest";
import {
  formatEventFacts,
  formatScore,
  formatSeeds,
  formatSpeed,
  speedChoices,
} from "./format.js";

describe("formatScore", () => {
  it("shows three decimals and a unit", () => {
    expect(formatScore(18.216)).toBe("18.216s");
  });

  it("pads so a column of times lines up", () => {
    expect(formatScore(9.5)).toBe("9.500s");
  });

  it("marks a policy that never finished rather than printing the cap", () => {
    // A DNF is scored at the time limit; showing "50.000s" would read as a time.
    expect(formatScore(50.0, { finished: 0 })).toBe("DNF");
  });
});

describe("formatSeeds", () => {
  it("reads as a fraction", () => {
    expect(formatSeeds(5, 5)).toBe("5/5");
    expect(formatSeeds(0, 5)).toBe("0/5");
  });
});

describe("formatSpeed", () => {
  it("prints the commanded speed the score was set at", () => {
    expect(formatSpeed(0.4, { finished: 5 })).toBe("0.40");
    // Two decimals always, so the column stays aligned down the board.
    expect(formatSpeed(1.2, { finished: 5 })).toBe("1.20");
  });

  it("shows a dash for a run that never finished", () => {
    // Its recorded speed is whichever attempt got furthest — a diagnostic, not
    // a result, and printing it would read as a pace the robot achieved.
    expect(formatSpeed(0.9, { finished: 0 })).toBe("—");
  });

  it("shows a dash rather than 0.00 for a run recorded before the sweep existed", () => {
    // Pre-sweep records default command_vx to 0. Those runs are a different
    // RUNNER_VERSION and never share a board, but the formatter must not
    // invent "0.00 m/s" if one is ever shown.
    expect(formatSpeed(0, { finished: 5 })).toBe("—");
    expect(formatSpeed(undefined, { finished: 5 })).toBe("—");
  });
});

const SPRINT = {
  length_m: 2,
  rig: "legs",
  slope_deg: 0,
  sweep_lo: 0.2,
  sweep_hi: 1.2,
  sweep_step: 0.05,
  sweep_count: 21,
};

describe("formatEventFacts", () => {
  it("labels each measurement instead of joining them into one string", () => {
    expect(formatEventFacts(SPRINT)).toEqual([
      { label: "distance", value: "2 m" },
      { label: "surface", value: "flat" },
      { label: "rig", value: "legs" },
      { label: "speed sweep", value: "0.20–1.20 m/s · 21" },
    ]);
  });

  it("advertises the sweep rather than a single commanded speed", () => {
    // The event no longer pins one speed, so there is no honest single number
    // to show here: every entry is scored at whatever speed suits it.
    const value = formatEventFacts(SPRINT).find((f) => f.label === "speed sweep").value;
    expect(value).toContain("0.20");
    expect(value).toContain("1.20");
    expect(formatEventFacts(SPRINT).map((f) => f.label)).not.toContain("commanded");
  });

  it("names the climb when the course has one", () => {
    const facts = formatEventFacts({ ...SPRINT, length_m: 1.5, slope_deg: 8 });
    expect(facts.find((f) => f.label === "surface").value).toBe("8° climb");
  });

  it("calls a level course flat rather than saying 0°", () => {
    const facts = formatEventFacts({ ...SPRINT, slope_deg: 0 });
    expect(facts.find((f) => f.label === "surface").value).toBe("flat");
  });
});

describe("speedChoices", () => {
  it("offers the sweep first, as the default", () => {
    // The trial should measure what the board measures unless you deliberately
    // ask otherwise, so the sweep is choice zero and its value is empty.
    const [first] = speedChoices(SPRINT);
    expect(first.value).toBe("");
    expect(first.label).toBe("Sweep all 21 — find the best");
  });

  it("lists exactly the speeds the harness actually scans", () => {
    const choices = speedChoices(SPRINT);
    // 21 speeds plus the sweep entry.
    expect(choices).toHaveLength(22);
    expect(choices[1].value).toBe("0.20");
    expect(choices[1].label).toBe("0.20 m/s");
    // The top of the range must be OFFERED. Stepping 0.05 twenty times from
    // 0.20 lands on 1.2000000000000002, so without the epsilon the fastest
    // speed the event declares would be missing from the picker.
    expect(choices.at(-1).value).toBe("1.20");
  });

  it("is built from the event, not from a hardcoded range", () => {
    const rollers = { sweep_lo: 0.3, sweep_hi: 2.0, sweep_step: 0.1, sweep_count: 18 };
    const choices = speedChoices(rollers);
    expect(choices).toHaveLength(19);
    expect(choices[1].value).toBe("0.30");
    expect(choices.at(-1).value).toBe("2.00");
  });
});
