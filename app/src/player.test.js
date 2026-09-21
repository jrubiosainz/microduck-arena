import { describe, expect, it } from "vitest";
import { byEvent, noProfile, profile } from "./player.js";

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

  it("folds the publications under the round they were published on", () => {
    const el = profile(ann, { user: "ann" });
    expect(el.querySelector("h3.eyebrow").textContent).toBe("Rounds entered");
    const folds = [...el.querySelectorAll("details.profile-round")];
    // Best standing first: the sprint's #1 before the hill climb's #2.
    expect(folds.map((f) => f.querySelector(".profile-round__name").textContent))
      .toEqual(["2 m Sprint", "1.5 m Hill Climb"]);
    expect(folds.map((f) => f.querySelector(".profile-round__place").textContent))
      .toEqual(["#1", "#2"]);
    expect(folds.map((f) => f.querySelector(".profile-round__count").textContent))
      .toEqual(["2 policies", "1 policy"]);
    // The first is open, so the page says something before anyone clicks.
    expect(folds.map((f) => f.open)).toEqual([true, false]);
    // Every run is still reachable, newest first within its round.
    const items = [...el.querySelectorAll(".profile-results a")];
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["#/r/r2", "#/r/r1", "#/r/r3"]);
    // A DNF says so rather than printing the time limit as an achieved time.
    expect(items[2].textContent).toContain("#2 · DNF");
    expect(items[0].textContent).toContain("#1 · 20.000s");
    // The owner sees a dot on a result never opened; a withdrawn run says so.
    expect(items[2].classList.contains("unread")).toBe(true);
    expect(items[0].classList.contains("unread")).toBe(false);
    expect(items[1].classList.contains("withdrawn")).toBe(true);
    expect(items[1].textContent).toContain("withdrawn");
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

describe("byEvent: the player's rounds, best first", () => {
  const pub = (over) => ({
    run_id: "r", event_id: "sprint-2m", event_title: "2 m Sprint", policy_name: "walk",
    score: 10, seeds_finished: 5, rank: 3, on_board: true, withdrawn: false,
    submitted_at: "2026-09-01T00:00:00Z", seen: true, votes: null, ...over,
  });

  it("gathers a player's runs under the event they were published on", () => {
    const groups = byEvent([
      pub({ run_id: "a", rank: 2 }),
      pub({ run_id: "b", event_id: "hill-climb-1m5", event_title: "1.5 m Hill Climb", rank: 1 }),
      pub({ run_id: "c", rank: 5 }),
    ]);
    expect(groups.map((g) => g.eventId)).toEqual(["hill-climb-1m5", "sprint-2m"]);
    expect(groups[1].publications.map((p) => p.run_id)).toEqual(["a", "c"]);
  });

  it("heads each round with the BEST standing on it, not the newest", () => {
    const groups = byEvent([
      pub({ run_id: "new", rank: 7, submitted_at: "2026-09-09T00:00:00Z" }),
      pub({ run_id: "old", rank: 2, submitted_at: "2026-09-01T00:00:00Z" }),
    ]);
    expect(groups[0].best).toBe(2);
  });

  it("ignores a rank that is not a standing any more", () => {
    // A withdrawn run keeps the rank it had when it was pulled, and an entry
    // that never placed carries none. Counting either would make a player
    // look better here than on the board everyone else reads.
    const groups = byEvent([
      pub({ run_id: "gone", rank: 1, withdrawn: true }),
      pub({ run_id: "unplaced", rank: 1, on_board: false }),
      pub({ run_id: "real", rank: 4 }),
    ]);
    expect(groups[0].best).toBe(4);
  });

  it("sorts an event where nothing placed LAST, not first", () => {
    // A null rank compared as a number sorts before every real one, which
    // would put the round a player never placed on at the top of their page.
    const groups = byEvent([
      pub({ run_id: "none", event_id: "rough-ground", event_title: "Rough Ground",
            rank: null, on_board: false }),
      pub({ run_id: "third", rank: 3 }),
    ]);
    expect(groups.map((g) => g.eventId)).toEqual(["sprint-2m", "rough-ground"]);
    expect(groups[1].best).toBeNull();
  });

  it("breaks a tie on the most recent publication", () => {
    const groups = byEvent([
      pub({ run_id: "a", rank: 1, submitted_at: "2026-09-01T00:00:00Z" }),
      pub({ run_id: "b", event_id: "hill-climb-1m5", event_title: "Hill", rank: 1,
            submitted_at: "2026-09-09T00:00:00Z" }),
    ]);
    expect(groups.map((g) => g.eventId)).toEqual(["hill-climb-1m5", "sprint-2m"]);
  });

  it("carries the votes behind a voted event's rank", () => {
    // "#1" beside a time would name the wrong thing on a board ranked by
    // votes.
    const [group] = byEvent([
      pub({ event_id: "swag-contest", event_title: "Swag Contest", rank: 1, votes: 12 }),
    ]);
    expect(group.votes).toBe(12);
  });
});
