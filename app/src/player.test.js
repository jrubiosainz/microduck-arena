import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    // In the header's own row, top right — the two figures this page is read
    // for, not a line of their own under the name that only labels them.
    const summary = el.querySelector(".profile-header > .profile-summary");
    expect(summary, "the figures are not in the header").not.toBeNull();
    const stickers = [...summary.querySelectorAll(".sticker")];
    expect(stickers.map((s) => s.textContent)).toEqual(["✦ 655 points", "#1"]);
    // The standing takes the page's carrying accent; the points the charter's
    // default yellow. Neither is lime or cyan, which name a pass and a signal.
    expect(stickers[1].className).toContain("sticker-orange");
    expect(stickers[0].className).toBe("sticker");
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
    // Each round carries the way to the round itself, shadowed through the
    // charter's primitive rather than a literal box-shadow.
    const gos = folds.map((f) => f.querySelector("a.profile-round__go"));
    expect(gos.map((a) => a.getAttribute("href")))
      .toEqual(["#/e/sprint-2m", "#/e/hill-climb-1m5"]);
    expect(gos[0].className).toContain("fx-shadow-sticker");
    // Every round starts shut: the summary already carries the name and the
    // standing, which is what a reader is scanning for.
    expect(folds.map((f) => f.open)).toEqual([false, false]);
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
        { event_id: "got-a-talent", event_title: "MicroDuck Got a Talent", rank: 1, score: 18.46,
          seeds_finished: 5, seeds_total: 5, policy_name: "talentbot", run_id: "r9",
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
        { event_id: "got-a-talent", event_title: "MicroDuck Got a Talent", rank: 2, score: 18.46,
          seeds_finished: 5, seeds_total: 5, policy_name: "talentbot", run_id: "r9",
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
      pub({ run_id: "none", event_id: "hill-climb-1m5", event_title: "1.5 m Hill Climb",
            rank: null, on_board: false }),
      pub({ run_id: "third", rank: 3 }),
    ]);
    expect(groups.map((g) => g.eventId)).toEqual(["sprint-2m", "hill-climb-1m5"]);
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
      pub({ event_id: "got-a-talent", event_title: "MicroDuck Got a Talent", rank: 1, votes: 12 }),
    ]);
    expect(group.votes).toBe(12);
  });
});

describe("the way to a round from a player's page", () => {
  it("takes the row's own hover off it while the pointer is on the button", () => {
    // Two things cannot both be the thing you are about to press, and the
    // button is the one that will actually happen. CSS-only, so read the
    // sheet — a tidy-up that drops the :not() would put the row's highlight
    // back under the button with nothing to show it had.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css, "the row still lights up under the button")
      .toMatch(/summary:hover:not\(:has\(\.profile-round__go:hover\)\)/);
  });

  it("leaves the page rather than opening the fold", () => {
    // A summary IS the toggle: a click anywhere in it opens the fold. This
    // link has to leave instead, and the two must not both happen.
    const el = profile(ann, { user: "ann" });
    const fold = el.querySelector("details.profile-round");
    expect(fold.open).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fold.querySelector("a.profile-round__go").dispatchEvent(click);
    expect(fold.open, "the fold opened as well as the link firing").toBe(false);
  });
});

describe("the way out of a player's own page", () => {
  const signedIn = { user: "ann", oauth_enabled: true, signed_in: true };

  it("is offered on your own page, beside your figures", () => {
    const summary = profile(ann, signedIn).querySelector(".profile-header .profile-summary");
    const out = summary.querySelector("button.sign-out");
    expect(out.textContent).toBe("Sign out");
  });

  it("is not offered on someone else's page", () => {
    // It is the page ABOUT you that offers to sign you out; bob's does not.
    const other = { ...signedIn, user: "bob" };
    expect(profile(ann, other).querySelector(".sign-out")).toBeNull();
  });

  it("is not offered where OAuth is not what signed you in", () => {
    // Locally the dev user is signed in on every request whatever the cookie
    // says, so signing out would report success and change nothing.
    expect(profile(ann, { ...signedIn, oauth_enabled: false })
      .querySelector(".sign-out")).toBeNull();
    expect(profile(ann).querySelector(".sign-out")).toBeNull();
  });
});
