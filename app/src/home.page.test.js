// vi.mock is hoisted and applies to the whole file, so this end-to-end test
// lives on its own rather than beside the unit tests that import `roundCard` and
// `ladder` directly.

import { describe, expect, it, vi } from "vitest";
import { renderHome } from "./home.js";

vi.mock("./api.js", () => ({
  getEvents: async () => [{
    id: "sprint-2m", title: "2 m Sprint", category: "race", rig: "legs",
    length_m: 2, slope_deg: 0,
    sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
  }, {
    id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug", rig: "legs",
    metric: "mean_ground_cm", pit_m: 0.3, bout: { time_limit_s: 45 },
  }],
  getStandings: async () => [{ rank: 1, user: "ann", points: 360 }],
  getMe: () => globalThis.__me,
  getLeaderboard: async () => ({ rows: [] }),
  getCups: async () => ({ next: { number: 1, close_at: "2099-01-02T15:00:00Z", premiere_at: "2099-01-02T17:00:00Z", entrants: [] }, cups: [] }),
}));

/** A stand-in for the sheets index.html carries, which jsdom has none of. */
const sheet = (theme) => {
  let link = document.head.querySelector(`link[data-theme="${theme}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.theme = theme;
    link.disabled = theme !== "race"; // deliberately the wrong way round
    document.head.append(link);
  }
  return link;
};
sheet("club");
sheet("race");

describe("the whole front page", () => {
  it("draws without waiting on /api/me", async () => {
    // That call folds the whole run log for two numbers on one plate. The
    // cover, the band, the ladder and the wall owe it nothing, and used to
    // wait for it before drawing at all — so here it never answers.
    globalThis.__me = new Promise(() => {});
    const root = document.createElement("div");
    renderHome(root); // deliberately not awaited: it cannot finish
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".masthead .wordmark--cover")).not.toBeNull();
    expect(root.querySelector(".flock-band")).not.toBeNull();
    expect(root.querySelector(".ladder-scroll")).not.toBeNull();
    // And the sheet went on with that first element. Flipping it on the way
    // in left the PREVIOUS page wearing the incoming one for the whole wait.
    expect(sheet("club").disabled).toBe(false);
    expect(sheet("race").disabled).toBe(true);
    // And a duck holds the plate meanwhile.
    expect(root.querySelector(".player-card--waiting img.duckhead")).not.toBeNull();
  });

  it("is a cover, a band, two chapters and no footer", async () => {
    globalThis.__me = Promise.resolve({ signed_in: false });
    const root = document.createElement("div");
    await renderHome(root);

    expect(root.querySelector(".masthead .wordmark--cover")).not.toBeNull();
    expect(root.querySelector(".flock-band")).not.toBeNull();
    // The band, then the chequer, then the wall — in that order. A count
    // alone would not see the chequer drift above the band, where it would
    // put a stripe of bare paper under the yellow strip.
    const hall = [...root.querySelector(".hall").children].map((n) => n.className);
    expect(hall[0]).toMatch(/^door\b/);
    expect(hall[1]).toBe("chapter-checker");
    expect(hall[2]).toMatch(/^chapter\b/);
    expect(root.querySelector(".door-board .ladder-scroll")).not.toBeNull();
    expect(root.querySelector('a[href="#/guides/points"]')).toBeNull();
    // The channel beside the standings, on one row under the pitch, and
    // nowhere else on the page: two stages would poll and draw twice.
    expect(root.querySelector(".door-row > .door-meet .tv-stage")).not.toBeNull();
    expect(root.querySelector(".door-row > .door-board .ladder-scroll")).not.toBeNull();
    expect(root.querySelectorAll(".tv-stage")).toHaveLength(1);
    expect(root.querySelector(".door-squad")).toBeNull();
    expect(root.querySelector(".round-cards .round-card .round-card__num").textContent).toBe("#01");
    // The strip and the footer belong to the pages you can come back FROM.
    expect(root.querySelector("header.signage")).toBeNull();
    expect(root.querySelector("footer")).toBeNull();
    // The charter allows one fan and one aberration per page.
    expect(root.querySelectorAll(".fx-ray-fan")).toHaveLength(1);
    expect(root.querySelectorAll(".fx-aberration")).toHaveLength(1);
  });

  it("pins the next cup's countdown on the versus card, and on no other", async () => {
    globalThis.__me = Promise.resolve({ signed_in: false });
    const root = document.createElement("div");
    await renderHome(root);
    const corners = root.querySelectorAll(".round-card .round-card__cup");
    expect(corners).toHaveLength(1);
    expect(corners[0].matches("a.sticker.sticker-lime")).toBe(true);
    expect(corners[0].getAttribute("href")).toBe("#/c/tug-of-war/1");
    expect(corners[0].textContent).toMatch(/^Cup #1 · in \d+d \d+h$/);
  });
});
