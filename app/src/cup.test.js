import { describe, expect, it } from "vitest";
import { cupCorner, cupDaysLeft, cupPage } from "./cup.js";

const event = { id: "tug-of-war", title: "Tug of War", metric: "mean_ground_cm" };
const four = ["Tank", "Lean", "Grip", "Sway"].map((name, i) => ({ user: `p${i}`, policy_name: name, livery: "classic", rating: 50 - 5 * i, run_id: `R${i}` }));
const open = { event, number: 1, open: 1, min_entrants: 4, state: "open", close_at: "2026-10-30T15:00:00Z",
  premiere_at: "2026-10-30T17:00:00Z", starts_at: null, entrants: four };
const done = (i, a, b) => ({ match_id: `tug-of-war-0001-00${i}`, index: i, round: i < 6 ? "group" : "final", group: i < 6 ? "A" : null,
  a, b, title: "t", wins: [2, 0], winner: a, bouts: [], decided_by: "bouts" });
const pairs = [[0, 3], [1, 2], [0, 2], [3, 1], [0, 1], [2, 3], [0, 1]];
const aired = { ...open, open: 2, state: "aired", starts_at: "2026-10-30T17:00:00Z", champion: 0,
  groups: [{ name: "A", table: [0, 1, 2, 3].map((entrant) => ({ entrant, played: 3, won: 3 - entrant, lost: entrant, bouts_for: 6 - 2 * entrant, bouts_against: 2 * entrant })) }],
  matches: pairs.map(([a, b], i) => done(i, a, b)) };

describe("the cup page", () => {
  it("before the show: the countdown to close, the field by rating and how to enter", () => {
    const page = cupPage(open, Date.parse("2026-10-28T12:00:00Z"));
    expect(page.querySelector("h2").textContent).toBe("Tug of War Cup #1");
    expect(page.querySelector(".cup-pill").textContent).toBe("Entries open");
    expect(page.querySelector(".cup-countdown").textContent).toBe("2d 03:00:00");
    expect(page.querySelector(".cup-until").textContent).toBe("until entries close");
    const rows = page.querySelectorAll(".cup-entrant");
    expect(rows).toHaveLength(4);
    expect(rows[0].querySelector("a").getAttribute("href")).toBe("#/p/p0");
    expect(rows[0].textContent).toContain("Tank");
    expect(page.querySelector(".cup-enter").textContent).toContain("uv run publish --enter");
    expect(page.querySelector(".cup-groups")).toBeNull();
  });

  it("between close and the show it counts to the premiere, then says it is starting soon", () => {
    const drawn = { ...open, state: "drawn", open: 2 };
    expect(cupPage(drawn, Date.parse("2026-10-30T16:00:00Z")).querySelector(".cup-countdown").textContent).toBe("1:00:00");
    const late = cupPage(drawn, Date.parse("2026-10-30T17:05:00Z"));
    expect(late.querySelector(".cup-countdown").textContent).toBe("Starting soon");
    expect(late.querySelector(".cup-enter")).toBeNull();
    expect(late.querySelector(".cup-pill").textContent).toBe("Entries closed");
  });

  it("a week with too few ducks says why there is no cup", () => {
    const page = cupPage({ ...open, state: "skipped", open: 2, entrants: four.slice(0, 3) }, Date.parse("2026-10-31T12:00:00Z"));
    expect(page.querySelector(".cup-pill").textContent).toBe("No cup");
    expect(page.textContent).toContain("No cup this week: fewer than 4 ducks entered.");
    expect(page.querySelector(".cup-countdown")).toBeNull();
  });

  it("once aired: the champion, the group table, the bracket, every aired match a link", () => {
    const page = cupPage(aired, Date.parse("2026-10-30T18:00:00Z"));
    expect(page.querySelector(".cup-pill").textContent).toBe("Finished");
    expect(page.querySelector(".cup-champion").textContent).toContain("Tank");
    expect(page.querySelectorAll(".cup-group tr.cup-q")).toHaveLength(2);
    const leader = page.querySelector(".cup-group tr.cup-q").textContent;
    expect(leader).toContain("Tank"); // the policy's name
    expect(leader).toContain("@p0"); // and the player's handle
    expect(page.querySelectorAll(".cup-round")).toHaveLength(1);
    expect(page.querySelectorAll('a[href^="#/m/"]')).toHaveLength(7);
  });

  it("mid-show a knockout match nobody has reached says so and links nowhere", () => {
    const airing = { ...aired, state: "airing", champion: null, matches: [...aired.matches.slice(0, 6),
      { match_id: "tug-of-war-0001-006", index: 6, round: "final", group: null, a: null, b: null, title: "Final" }] };
    const page = cupPage(airing, Date.parse("2026-10-30T17:01:00Z"));
    expect(page.querySelector(".cup-round").textContent).toContain("To be decided");
    expect(page.querySelectorAll('a[href^="#/m/"]')).toHaveLength(6);
    expect(page.querySelector(".cup-champion")).toBeNull();
    expect(page.querySelector('a[href="#/live"]')).not.toBeNull();
  });
});

describe("the home card's cup corner", () => {
  it("the home card counts down to what comes next", () => {
    const cups = (list) => ({ next: { number: 2, close_at: "2026-11-06T15:00:00Z", premiere_at: "2026-11-06T17:00:00Z", entrants: [] }, cups: list });
    const at = (iso) => Date.parse(iso);
    expect(cupCorner("tug-of-war", cups([]), at("2026-11-04T12:00:00Z"))).toEqual({ text: "Cup #2 · in 2d 5h", href: "#/c/tug-of-war/2" });
    expect(cupCorner("tug-of-war", cups([{ number: 1, state: "airing" }]), 0).text).toBe("Cup #1 · live now");
    expect(cupCorner("tug-of-war", cups([{ number: 1, state: "ready", starts_at: "2026-10-30T17:00:00Z" }]), at("2026-10-30T16:40:00Z")).text).toBe("Cup #1 · in 20m");
    expect(cupCorner("tug-of-war", cups([{ number: 1, state: "drawn", premiere_at: "2026-10-30T17:00:00Z" }]), at("2026-10-30T17:05:00Z")).text).toBe("Cup #1 · starting soon");
    expect(cupCorner("tug-of-war", cups([{ number: 1, state: "aired" }]), at("2026-11-06T13:30:00Z")).text).toBe("Cup #2 · in 3h 30m");
  });

  it("points to the oldest cup not yet aired: a late cup airs before the one closed after it", () => {
    const late = { next: { number: 3 }, cups: [{ number: 2, state: "drawn", premiere_at: "2026-11-06T17:00:00Z" },
      { number: 1, state: "drawn", premiere_at: "2026-10-30T17:00:00Z" }] };
    expect(cupCorner("tug-of-war", late, Date.parse("2026-11-06T16:00:00Z"))).toEqual({ text: "Cup #1 · starting soon", href: "#/c/tug-of-war/1" });
  });
});

describe("a versus page's days left", () => {
  const cups = (list) => ({ next: { number: 2, close_at: "2026-11-06T15:00:00Z", premiere_at: "2026-11-06T17:00:00Z", entrants: [] }, cups: list });
  const at = (iso) => Date.parse(iso);

  it("counts whole days to the same cup as the home card, then hours, then the show itself", () => {
    expect(cupDaysLeft("tug-of-war", cups([]), at("2026-10-29T21:00:00Z"))).toEqual({ cup: "Cup #2", left: "7 days left", href: "#/c/tug-of-war/2" });
    expect(cupDaysLeft("tug-of-war", cups([]), at("2026-11-05T12:00:00Z")).left).toBe("1 day left");
    expect(cupDaysLeft("tug-of-war", cups([]), at("2026-11-06T13:30:00Z")).left).toBe("3 hours left");
    expect(cupDaysLeft("tug-of-war", cups([]), at("2026-11-06T16:00:00Z")).left).toBe("1 hour left");
    expect(cupDaysLeft("tug-of-war", cups([]), at("2026-11-06T16:40:00Z")).left).toBe("20 min left");
    expect(cupDaysLeft("tug-of-war", cups([{ number: 1, state: "drawn", premiere_at: "2026-10-30T17:00:00Z" }]), at("2026-10-30T17:05:00Z")))
      .toEqual({ cup: "Cup #1", left: "Starting soon", href: "#/c/tug-of-war/1" });
    expect(cupDaysLeft("tug-of-war", cups([{ number: 1, state: "airing" }]), 0).left).toBe("Live now");
  });
});
