import { describe, expect, it } from "vitest";
import { LANE_CSS } from "../course.js";
import { boutLine } from "./bouts.js";
import { duelHall, strip } from "./hall.js";

// A match as arena/duel_watch.py duel_summary answers it: two seeds, each from
// both decks, the policies swapping decks from one bout to the next.
const summary = {
  id: "tug-of-war",
  title: "Tug of war",
  rig: "legs",
  names: ["alpha", "beta"],
  ctrl_dt: 0.02,
  time_limit_s: 20,
  course: { gap_m: 0.3, pit_depth_m: 0.6, margin_m: 0.05, fall_hold_s: 0.3 },
  points: [2.5, 1.5],
  bouts: [
    { seed: 0, on_deck: ["alpha", "beta"], winner: 0, end: "pit", time_s: 0.42, settle_frames: 51 },
    { seed: 0, on_deck: ["beta", "alpha"], winner: null, end: "bell", time_s: 20, settle_frames: 51 },
    { seed: 1, on_deck: ["alpha", "beta"], winner: 1, end: "bell", time_s: 20, settle_frames: 51 },
    { seed: 1, on_deck: ["beta", "alpha"], winner: null, end: "void", time_s: 3.2, settle_frames: 51 },
  ],
};

describe("strip: the mark over the page", () => {
  it("reads MICRODUCK DUEL, and links nowhere", () => {
    const header = strip();
    expect(header.classList.contains("signage")).toBe(true);
    expect(header.querySelector(".wordmark").textContent).toBe("MicroduckDuel");
    expect(header.querySelector("a")).toBeNull();
  });
});

describe("duelHall: the page's frame", () => {
  it("names the duel over the stage, with its pit and bell", () => {
    const { hall } = duelHall(summary);
    expect(hall.classList.contains("duel")).toBe(true);
    expect(hall.querySelector(".racetitle").textContent).toBe("Tug of war");
    const facts = hall.querySelector(".facts").textContent;
    expect(facts).toContain("30 cm across, 60 cm deep");
    expect(facts).toContain("20 s");
    expect(facts).toContain("4, every seed from both decks");
  });

  it("keeps the score per policy, in its letter and colour, half points and all", () => {
    const rows = [...duelHall(summary).hall.querySelectorAll(".duel-score__row")];
    expect(rows).toHaveLength(2);
    rows.forEach((row, policy) => {
      const chip = row.querySelector(".duel-swatch");
      expect(chip.textContent).toBe(["A", "B"][policy]);
      // jsdom serialises the colour as rgb(); compare through an element given the hex.
      const probe = document.createElement("span");
      probe.style.background = LANE_CSS[policy];
      expect(chip.style.background).toBe(probe.style.background);
      expect(row.querySelector(".duel-who__name").textContent).toBe(summary.names[policy]);
    });
    expect(rows[0].querySelector(".flip").textContent).toBe("2.5");
    expect([...rows[0].querySelectorAll(".flip-digit")].map((tile) => tile.textContent)).toEqual(["2", "5"]);
    expect(rows[1].querySelector(".flip").textContent).toBe("1.5");
  });

  it("lists every bout as a button, with its decks and what came of it", () => {
    const { hall, parts } = duelHall(summary);
    expect(parts.bouts).toHaveLength(summary.bouts.length);
    parts.bouts.forEach((button, k) => {
      expect(button.dataset.bout).toBe(String(k));
      expect(button.querySelector(".duel-bout__seed").textContent).toBe(`Bout ${k + 1} · seed ${summary.bouts[k].seed}`);
      expect(button.querySelector(".duel-bout__how").textContent).toBe(boutLine(summary, summary.bouts[k]));
    });
    const letters = (k) => [...parts.bouts[k].querySelectorAll(".duel-swatch")].map((chip) => chip.textContent);
    expect(letters(0)).toEqual(["A", "B"]);
    expect(letters(1)).toEqual(["B", "A"]);
    expect(hall.querySelector(".duel-bouts").tagName).toBe("OL");
  });

  it("puts the clock, the stamp and the verdict on the stage, the last two hidden till a bout is decided", () => {
    const { parts } = duelHall(summary);
    const { stage } = parts;
    expect(stage.classList.contains("stage")).toBe(true);
    for (const part of [parts.clock, parts.clockLabel, parts.clockTime, parts.call, parts.stamp, parts.line]) {
      expect(stage.contains(part)).toBe(true);
    }
    expect(parts.clockTime.textContent).toBe("0.00 s");
    expect(parts.call.hidden).toBe(true);
    expect(parts.line.hidden).toBe(true);
    expect(parts.line.getAttribute("role")).toBe("status");
    expect(parts.stamp.classList.contains("stamp")).toBe(true);
  });

  it("keeps the deck's follow key, as a way back to ringside", () => {
    const { hall } = duelHall(summary);
    expect(hall.querySelector("#stage").tagName).toBe("CANVAS");
    expect(hall.querySelector("#follow").textContent).toBe("Back to ringside");
    expect(hall.querySelector(".orbit-hint")).not.toBeNull();
  });

  it("offers a pause and a replay, and states the rule with the course's hold and margin", () => {
    const { hall, parts } = duelHall(summary);
    expect(parts.pause.textContent).toBe("Pause");
    expect(parts.replay.textContent).toBe("Replay bout");
    expect([parts.pause.type, parts.replay.type]).toEqual(["button", "button"]);
    const note = hall.querySelector(".duel-note").textContent;
    expect(note).toContain("or stays down 0.3 s, loses the bout");
    expect(note).toContain("and so does one whose action is not a number");
    expect(note).toContain("more than 5 cm their way");
  });
});
