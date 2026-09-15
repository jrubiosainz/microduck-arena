import { describe, expect, it } from "vitest";
import { noProfile, profile } from "./player.js";

const ann = {
  user: "ann",
  points: 655,
  rank: 1,
  publications: [
    { run_id: "r3", event_id: "hill-climb-1m5", event_title: "1.5 m Hill Climb", rank: 2,
      score: 50.0, seeds_finished: 0, seeds_total: 5, policy_name: "hill", on_board: true,
      withdrawn: false, submitted_at: "2026-09-03T11:00:00Z", seen: false },
    { run_id: "r2", event_id: "sprint-2m", event_title: "2 m Sprint", rank: 1, score: 20.0,
      seeds_finished: 5, seeds_total: 5, policy_name: "v2", on_board: true, withdrawn: false,
      submitted_at: "2026-09-03T10:00:00Z", seen: true },
    { run_id: "r1", event_id: "sprint-2m", event_title: "2 m Sprint", rank: 1, score: 30.0,
      seeds_finished: 5, seeds_total: 5, policy_name: "v1", on_board: false, withdrawn: true,
      submitted_at: "2026-09-03T09:00:00Z", seen: true },
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

  it("lists every publication newest first, linking to each run's page", () => {
    const el = profile(ann, { user: "ann" });
    expect(el.querySelector("h3.eyebrow").textContent).toBe("Publications");
    const items = [...el.querySelectorAll(".profile-results a")];
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["#/r/r3", "#/r/r2", "#/r/r1"]);
    // A DNF says so rather than printing the time limit as an achieved time.
    expect(items[0].textContent).toContain("#2 · DNF");
    expect(items[1].textContent).toContain("#1 · 20.000s");
    // The owner sees a dot on a result never opened; a withdrawn run says so.
    expect(items[0].classList.contains("unread")).toBe(true);
    expect(items[1].classList.contains("unread")).toBe(false);
    expect(items[2].classList.contains("withdrawn")).toBe(true);
    expect(items[2].textContent).toContain("withdrawn");
    // Another viewer never sees the dot.
    expect(profile(ann, { user: "bob" }).querySelector(".unread")).toBeNull();
  });
});

describe("a voted event's best row", () => {
  it("says how many votes it earned, not a finish time", () => {
    const player = {
      user: "ann",
      points: 100,
      rank: 1,
      publications: [
        { event_id: "swag-contest", event_title: "Swag Contest", rank: 1, score: 18.46,
          seeds_finished: 5, seeds_total: 5, policy_name: "swagbot", run_id: "r9",
          submitted_at: "2026-09-10T10:00:00Z", votes: 43 },
      ],
    };
    const item = profile(player).querySelector(".profile-results a");
    expect(item.textContent).toContain("#1 · 43 votes");
    expect(item.textContent).not.toContain("18.46");
  });

  it("says 'no votes yet' rather than printing a bare zero", () => {
    const player = {
      user: "ann",
      points: 0,
      rank: 3,
      publications: [
        { event_id: "swag-contest", event_title: "Swag Contest", rank: 2, score: 18.46,
          seeds_finished: 5, seeds_total: 5, policy_name: "swagbot", run_id: "r9",
          submitted_at: "2026-09-10T10:00:00Z", votes: 0 },
      ],
    };
    const item = profile(player).querySelector(".profile-results a");
    expect(item.textContent).toContain("#2 · no votes yet");
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
