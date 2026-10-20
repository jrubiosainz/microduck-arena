import { describe, expect, it } from "vitest";
import { featuring, flipScore, receiptCard, replayLine, runHall, seedText, verdict } from "./run.js";

const STAGE = { title: "MicroDuck Got a Talent", course: "stage", metric: "votes" };
const TUG = { id: "tug-of-war", title: "Tug of War", course: "tug", metric: "mean_hold_force" };
const tugRun = {
  run_id: "R1", user: "nico", policy_name: "puller", event: TUG, score: 4.2134, seeds_finished: 5, seeds_total: 5,
  trace_seed: 3, rank: 2, on_board: true, withdrawn: false, receipts: [{ act: "run", points: 10 }],
  per_seed: [{ seed: 3, status: "held", time_s: null, force_n: 7 }], cast: [{ policy: "self" }],
};

describe("a receipt", () => {
  it("is a small card, not a sticker to press: the points over what they were for", () => {
    const card = receiptCard({ act: "first_event", points: 100 });
    expect(card.tagName).not.toBe("BUTTON");
    expect(card.classList.contains("receipt")).toBe(true);
    expect(card.classList.contains("sticker")).toBe(false);
    expect(card.querySelector(".receipt-points").textContent).toBe("+100");
    expect(card.querySelector(".mono-label").textContent).toBe("first entry");
  });

  it("wears its act's colour on its edge", () => {
    expect(receiptCard({ act: "podium", points: 250 }).classList.contains("receipt-magenta")).toBe(true);
    expect(receiptCard({ act: "run", points: 10 }).classList.contains("receipt-cyan")).toBe(true);
  });
});

describe("a publication's frame", () => {
  it("puts the stage in the same deck as the challenge page", () => {
    const page = runHall();
    expect(page.querySelector(".run-top > .deck > canvas#stage")).not.toBeNull();
    expect([...page.querySelectorAll(".deck button")].map((b) => b.id)).toEqual(["follow"]);
  });

  it("hangs the challenge page's board sheet under the picture, and no legend", () => {
    const page = runHall();
    expect(page.querySelector(".run-board > .boardsheet > .boardtop")).not.toBeNull();
    expect(page.querySelector(".run-board > .boardsheet > #board")).not.toBeNull();
    expect(page.querySelector(".pegboard")).toBeNull();
    expect(page.querySelector(".key")).toBeNull();
    expect(page.querySelector(".run-top > #facts")).not.toBeNull();
  });
});

describe("a performance's scoreboard", () => {
  it("says its length and that it was performed, or cut short", () => {
    expect(verdict({ event: STAGE, seeds_finished: 1, seeds_total: 1 })).toEqual({ label: "length", stamp: "PERFORMED" });
    expect(verdict({ event: STAGE, seeds_finished: 0, seeds_total: 1 })).toEqual({ label: "length", stamp: "CUT SHORT" });
  });
  it("keeps a race's time and seeds", () => {
    expect(verdict({ event: { course: "lane" }, seeds_finished: 4, seeds_total: 5 })).toEqual({ label: "time", stamp: "FINISHED 4/5" });
  });
  it("replays the whole performance, at no speed and no seed", () => {
    expect(replayLine({ event: STAGE, command_vx: 0, seeds_finished: 1, per_seed: [], trace_seed: 1 })).toBe("replay: the whole performance");
  });
});

describe("a bench run's scoreboard", () => {
  it("is rated in newtons and stamped rated", () => {
    expect(verdict(tugRun)).toEqual({ label: "rating · N", stamp: "RATED" });
  });
  it("replays the median pull", () => {
    expect(replayLine(tugRun)).toBe("replay: seed 3, the median pull");
  });
});

describe("the number the scoreboard flips", () => {
  const race = { event: { course: "lane", metric: "mean_finish_time" }, score: 12.3456, seeds_finished: 5 };

  it("rolls a rating to the hundredth of a newton, from zeros of its own shape", () => {
    expect(flipScore(tugRun)).toBe("4.21");
    expect(flipScore(tugRun, { veiled: true })).toBe("0.00");
  });
  it("keeps a race's time to the millisecond, from the same zeros as ever, and a DNF", () => {
    expect(flipScore(race)).toBe("12.346");
    expect(flipScore(race, { veiled: true })).toBe("00.000");
    expect(flipScore({ ...race, seeds_finished: 0 })).toBe("DNF");
  });
});

describe("a seed's line", () => {
  it("says what the bench's winch was pulling, and how the seed ended when it did not go into the pit", () => {
    expect(seedText({ seed: 3, status: "held", time_s: null, force_n: 7 })).toBe("7.00 N · held on");
    expect(seedText({ seed: 3, status: "pit", time_s: 21.7, force_n: 4.77 })).toBe("4.77 N");
    expect(seedText({ seed: 3, status: "fall", time_s: 1.02, force_n: 0.62 })).toBe("0.62 N · knocked down");
  });
  it("keeps a race's time, or how it ended", () => {
    expect(seedText({ seed: 1, status: "finish", time_s: 12.3456 })).toBe("12.346s");
    expect(seedText({ seed: 2, status: "fall", time_s: null })).toBe("fall");
  });
});

describe("a troupe's credits", () => {
  const walker = { repo_id: "bob/microduck-walker", filename: "policy.onnx", revision: "a".repeat(40), user: "bob", policy_name: "walker" };
  const roller = { ...walker, repo_id: "carol/microduck-roller", user: "carol", policy_name: "roller" };

  it("features each borrowed policy once, linked to its repo at the commit that performed", () => {
    const credits = featuring([{ policy: "self" }, { policy: walker }, { policy: roller }, { policy: walker }]);
    expect(credits.textContent).toBe("featuring @bob · walker, @carol · roller");
    expect([...credits.querySelectorAll("a")].map((a) => a.href)).toEqual([
      `https://huggingface.co/bob/microduck-walker/tree/${"a".repeat(40)}`,
      `https://huggingface.co/carol/microduck-roller/tree/${"a".repeat(40)}`,
    ]);
  });

  it("credits nobody when every duck is the author's own", () => {
    expect(featuring([{ policy: "self" }, { policy: "self" }])).toBeNull();
  });
});
