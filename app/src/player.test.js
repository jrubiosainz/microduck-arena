import { describe, expect, it } from "vitest";
import { noProfile, profile } from "./player.js";

const ann = {
  user: "ann",
  points: 655,
  rank: 1,
  best: [
    { event_id: "sprint-2m", event_title: "2 m Sprint", rank: 1, score: 20.0, seeds_finished: 5,
      seeds_total: 5, policy_name: "v2", run_id: "r2", submitted_at: "2026-09-03T10:00:00Z" },
    { event_id: "hill-climb-1m5", event_title: "1.5 m Hill Climb", rank: 2, score: 50.0,
      seeds_finished: 0, seeds_total: 5, policy_name: "hill", run_id: "r3",
      submitted_at: "2026-09-03T11:00:00Z" },
  ],
};

describe("a player's profile", () => {
  it("shows the picture, the name, the points and the rank", () => {
    const el = profile(ann);
    expect(el.querySelector(".profile-header .avatar img").getAttribute("src"))
      .toBe("https://huggingface.co/api/avatars/ann");
    expect(el.querySelector("h2").textContent).toBe("ann");
    expect(el.querySelector(".eyebrow").textContent).toBe("Player");
    const stickers = [...el.querySelectorAll(".profile-summary .sticker")].map((s) => s.textContent);
    expect(stickers).toEqual(["✦ 655 points", "#1"]);
  });

  it("lists the best publication per event, linking into each race", () => {
    const el = profile(ann);
    expect(el.querySelector("h3.eyebrow").textContent).toBe("Best publications");
    const items = [...el.querySelectorAll(".profile-results a")];
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["#/e/sprint-2m", "#/e/hill-climb-1m5"]);
    expect(items[0].textContent).toContain("2 m Sprint");
    expect(items[0].textContent).toContain("#1 · 20.000s");
    expect(items[0].textContent).toContain("v2");
    // A DNF says so rather than printing the time limit as an achieved time.
    expect(items[1].textContent).toContain("#2 · DNF");
  });
});

describe("a name nobody has published under", () => {
  it("says so and points home", () => {
    const el = noProfile("nobody");
    expect(el.textContent).toContain("No publication yet");
    expect(el.textContent).toContain("nobody");
    expect(el.querySelector("a").getAttribute("href")).toBe("#/");
  });
});
