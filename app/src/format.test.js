import { describe, expect, it } from "vitest";
import {
  countdown,
  formatEventFacts,
  formatRate,
  formatScore,
  formatSeeds,
  formatSpeed,
  isStage,
  isTug,
} from "./format.js";

const TUG = {
  id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug", metric: "mean_ground_cm", rig: "legs", vote: null,
  length_m: 4, pit_m: 0.3, bout: { time_limit_s: 45, bouts_to_win: 2, max_bouts: 5 },
};

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

describe("formatRate", () => {
  it("reads as a whole percentage", () => {
    expect(formatRate(0.387)).toBe("39%");
    expect(formatRate(0.25)).toBe("25%");
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

const STAGE = { id: "got-a-talent", course: "stage", rig: "legs", time_limit_s: 20 };

describe("a stage's facts", () => {
  it("say what it is, never a distance or a speed", () => {
    expect(formatEventFacts(STAGE)).toEqual([
      { label: "stage", value: "open floor" },
      { label: "performance", value: "up to 20 s" },
      { label: "rig", value: "legs" },
    ]);
  });
  it("isStage reads the course, not the id", () => {
    expect(isStage(STAGE)).toBe(true);
    expect(isStage({ ...STAGE, course: "lane" })).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});

describe("the tug of war counts in centimetres", () => {
  it("prints the mean ground won, one decimal and the unit", () => {
    expect(formatScore(-15.24, { finished: 5, metric: "mean_ground_cm" })).toBe("-15.2 cm");
    expect(formatScore(12.3456, { finished: 5 })).toBe("12.346s");
  });
  it("knows a tug by its course", () => {
    expect([isTug({ course: "tug" }), isTug({ course: "lane" }), isTug(undefined)]).toEqual([true, false, false]);
  });
  it("tells its course, its bout and its rig", () => {
    expect(formatEventFacts(TUG)).toEqual([
      { label: "course", value: "4 m lane, 0.3 m pit" },
      { label: "bout", value: "up to 45 s" },
      { label: "rig", value: "legs" },
    ]);
  });
});

describe("countdown", () => {
  it("counts down in the largest units that matter", () => {
    expect([0, 4_500, 65_000, 3_725_000, 90_061_000].map(countdown)).toEqual(["0:00", "0:05", "1:05", "1:02:05", "1d 01:01:01"]);
  });
});
