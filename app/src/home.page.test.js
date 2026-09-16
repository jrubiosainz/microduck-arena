// vi.mock is hoisted and applies to the whole file, so this end-to-end test
// lives on its own rather than beside the unit tests that import `flyer` and
// `ladder` directly.

import { describe, expect, it, vi } from "vitest";
import { renderHome } from "./home.js";

vi.mock("./api.js", () => ({
  getEvents: async () => [{
    id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", rig: "legs",
    length_m: 2, slope_deg: 0,
    sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
  }],
  getStandings: async () => [{ rank: 1, user: "ann", points: 360 }],
  getMe: async () => ({ signed_in: false }),
  getLeaderboard: async () => ({ rows: [] }),
}));

// renderThumbnails needs WebGL, which jsdom does not provide. Under jsdom it
// hits its own try/catch (thumbnail.js) and returns an empty Map rather than
// throwing — the documented fallback, confirmed by thumbnail.test.js passing
// unmocked — so no mock of ./thumbnail.js is needed here either.

describe("the whole front page", () => {
  it("is a cover, a band, two chapters and no footer", async () => {
    const root = document.createElement("div");
    await renderHome(root);

    expect(root.querySelector(".masthead .wordmark--cover")).not.toBeNull();
    expect(root.querySelector(".flock-band")).not.toBeNull();
    // The band comes FIRST in the hall, flush under the yellow strip whose own
    // border is the line there. A rule above it put a stripe of bare paper
    // between the two, which is the thing that was removed.
    const hall = [...root.querySelector(".hall").children].map((n) => n.className);
    expect(hall[0]).toMatch(/^door\b/);
    expect(hall[1]).toMatch(/^chapter-rule/);
    expect(hall.filter((c) => c.startsWith("chapter-rule"))).toHaveLength(1);
    expect(root.querySelector(".door-board .ladder-scroll")).not.toBeNull();
    // No WebGL under jsdom, so the rendered duck never lands and the head it
    // stood in for is still there — the fallback, exercised end to end.
    expect(root.querySelector(".door-meet img.duckhead")).not.toBeNull();
    expect(root.querySelector(".door-duck")).toBeNull();
    expect(root.querySelector(".ladder-scroll")).not.toBeNull();
    expect(root.querySelector(".challenge-note--race")).not.toBeNull();
    // The strip and the footer belong to the pages you can come back FROM.
    expect(root.querySelector("header.signage")).toBeNull();
    expect(root.querySelector("footer")).toBeNull();
    // The charter allows one fan and one aberration per page.
    expect(root.querySelectorAll(".fx-ray-fan")).toHaveLength(1);
    expect(root.querySelectorAll(".fx-aberration")).toHaveLength(1);
  });
});
