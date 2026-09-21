// The strip of other rounds, rendered end to end against fakes.
//
// It exists because the strip shipped invisible: `getEvents` was used and
// never imported, the ReferenceError went into a `catch(() => {})`, and
// nothing on the page or in the console said so. Every unit around it passed.
// Only calling the function that fetches would have caught it, so this calls
// it — vi.mock is hoisted and applies to a whole file, which is why this is
// its own.

import { describe, expect, it, vi } from "vitest";

const event = (id, title, status = "open", category = "race") => ({
  id, title, status, category, rig: "legs",
  seeds: 5, sweep_count: 5, sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05,
  length_m: 2, slope_deg: 0,
});

const PROGRAMME = [
  event("sprint-2m", "2 m Sprint"),
  event("roller-sprint-2m", "2 m Roller Sprint"),
  event("hill-climb-1m5", "1.5 m Hill Climb"),
  event("swag-contest", "Swag Contest", "open", "showcase"),
  event("highest-jump", "Highest Jump", "planned", "challenge"),
];

const asked = [];
vi.mock("./api.js", () => ({
  getEvents: async () => PROGRAMME,
  getLeaderboard: async (id) => {
    asked.push(id);
    return { rows: [{ user: "ann", score: 3.216, seeds_finished: 5 }] };
  },
}));
// No WebGL here, which is also what a real browser with it disabled gives.
vi.mock("./thumbnail.js", () => ({ renderThumbnails: async () => new Map() }));

const { keepRacing } = await import("./race.js");

describe("keepRacing", () => {
  it("hangs the strip before the footer, not after it", async () => {
    // `footer.before(strip) ?? root.append(strip)` shipped once: before()
    // answers undefined, so the ?? fired on success too and moved the strip
    // past the footer, where it read as part of the site's chrome.
    const root = document.createElement("div");
    root.append(document.createElement("main"), document.createElement("footer"));
    await keepRacing(root, PROGRAMME[0]);
    const kinds = [...root.children].map((n) => n.tagName.toLowerCase() + "." + n.className);
    expect(kinds).toEqual(["main.", "section.rounds-on", "footer."]);
  });

  it("asks for a board per open card and none for a planned one", async () => {
    asked.length = 0;
    const root = document.createElement("div");
    root.append(document.createElement("footer"));
    await keepRacing(root, PROGRAMME[0]);
    // Every other round is on the wall; only the open ones cost a board.
    expect(asked).toEqual(["roller-sprint-2m", "hill-climb-1m5", "swag-contest"]);
    expect(root.querySelectorAll(".rounds-on .challenge-note")).toHaveLength(4);
  });

  it("appends when there is no footer to sit before", async () => {
    const root = document.createElement("div");
    await keepRacing(root, PROGRAMME[0]);
    expect(root.querySelector(".rounds-on")).not.toBeNull();
  });
});
