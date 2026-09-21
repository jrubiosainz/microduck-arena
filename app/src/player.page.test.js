// The player page assembled, against fakes. vi.mock is hoisted and applies to
// a whole file, which is why this is its own — and why the same shape caught
// a missing import on the race page's strip.

import { describe, expect, it, vi } from "vitest";

vi.mock("./api.js", () => ({
  getMe: async () => ({ signed_in: true, user: "ann" }),
  getPlayer: async () => ({
    user: "ann",
    points: 100,
    rank: 2,
    publications: [{
      run_id: "r1", event_id: "sprint-2m", event_title: "2 m Sprint", policy_name: "walk",
      score: 10, seeds_finished: 5, seeds_total: 5, rank: 1, on_board: true,
      withdrawn: false, submitted_at: "2026-09-01T00:00:00Z", seen: true, votes: null,
    }],
  }),
}));

const { renderPlayer } = await import("./player.js");

describe("the player page's chrome", () => {
  it("lays the chequer between the strip and the page", async () => {
    const root = document.createElement("div");
    await renderPlayer(root, "ann");
    const order = [...root.children].map((n) => `${n.tagName.toLowerCase()}.${n.className}`);
    expect(order[0]).toMatch(/^header\./);
    expect(order[1]).toBe("div.page-checker");
    expect(order[2]).toMatch(/^main\.hall hall--warm/);
    // The class is what carries the beige ground and the dot field at the
    // foot; without it the page falls back to the hall's lighter paper.
    expect(root.querySelector("main").classList.contains("hall--warm")).toBe(true);
  });
});
