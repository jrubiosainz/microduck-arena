import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chapterRule, demoAsked, demoRows, flockBand, flyer, ladder, masthead, pageTexture, playerCard,
  shellOf,
} from "./home.js";

const open = {
  id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", rig: "legs",
  length_m: 2, slope_deg: 0,
  sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
};
const planned = { ...open, id: "best-jump", title: "Best Jump", status: "planned", category: "challenge" };
const held = [{ user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 }];

describe("the masthead", () => {
  it("carries the mark at cover size, the duck, and your locker top right", () => {
    const head = masthead({ signed_in: true, user: "cdeplanne" }, { rank: 2, points: 360 });
    expect(head.querySelector(".wordmark--cover")).not.toBeNull();
    expect(head.querySelector("img.duckhead")).not.toBeNull();
    expect(head.querySelector(".masthead-player .player-card-you")).not.toBeNull();
  });

  it("is the only element on the page wearing the aberration", () => {
    // The charter draws it on a cover. A second one is a printing fault.
    expect(masthead(null).querySelectorAll(".fx-aberration")).toHaveLength(1);
  });
});

describe("the player card", () => {
  it("shows your picture, your handle and where you stand", () => {
    const card = playerCard({ signed_in: true, user: "cdeplanne" }, { rank: 2, points: 360 });
    const link = card.querySelector("a.player-card-you");
    expect(link.getAttribute("href")).toBe("#/p/cdeplanne");
    expect(link.querySelector(".avatar")).not.toBeNull();
    expect(link.querySelector(".player-card-name").textContent).toBe("cdeplanne");
    expect(link.querySelector(".player-card-score").textContent).toBe("#2 · 360 PTS");
  });

  it("leaves the score off until you have published something", () => {
    // "0 PTS" to someone who has not raced yet is a scoreline about nothing.
    const card = playerCard({ signed_in: true, user: "newcomer" }, undefined);
    expect(card.querySelector(".player-card-name").textContent).toBe("newcomer");
    expect(card.querySelector(".player-card-score")).toBeNull();
  });

  it("offers the way in when signed out", () => {
    const card = playerCard({ signed_in: false });
    const link = card.querySelector("a.player-card-in");
    expect(link.textContent).toContain("Sign in");
    // Signed out there is no page of yours to link to.
    expect(card.querySelector(".player-card-you")).toBeNull();
  });

  it("shows nothing at all when the server did not answer", () => {
    // A sign-in link to a server that is not answering is worse than a blank.
    const card = playerCard(null);
    expect(card.querySelector("a")).toBeNull();
    expect(card.textContent).toBe("");
  });
});

describe("the first chapter's band", () => {
  it("is a full-width sheet of grained paper, not a boxed panel", () => {
    // CSS-only, so read the sheet. The regular dot pattern this replaced was
    // the wrong texture, and the box around the scoreboard was a second
    // border fighting the ladder's own.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    );
    const door = css.match(/\n\.door\s*\{([^}]*)\}/);
    expect(door, ".door rule not found in club.css").not.toBeNull();
    expect(door[1], ".door does not span the viewport").toMatch(/width\s*:\s*100vw/);
    expect(door[1], ".door does not break out of the column")
      .toMatch(/margin-left\s*:\s*calc\(50% - 50vw\)/);
    expect(door[1], ".door carries no ground for the grain to sit on")
      .toMatch(/background-color\s*:/);
    // The band's edges must be cut to the same 1° the rules are rotated by,
    // or it reads as a rectangle wedged between two tilted sticks.
    expect(door[1], ".door's edges are square while the rules are tilted")
      .toMatch(/clip-path\s*:\s*polygon/);
    expect(door[1], ".door has no slant to cut its edges by").toMatch(/--slant\s*:/);
    const board = css.match(/\.door-board\s*\{([^}]*)\}/);
    expect(board[1], ".door-board is boxed again").not.toMatch(/border\s*:/);
    expect(board[1], "the regular dot pattern is back").not.toMatch(/radial-gradient/);
  });
});;

describe("the page texture", () => {
  it("is decorative and lets clicks through", () => {
    const skin = pageTexture();
    // Grain, and no scanlines: over a page of paper and text the lines read
    // as a fault rather than as a screen.
    expect(skin.className).toBe("page-fx fx-grain");
    expect(skin.getAttribute("aria-hidden")).toBe("true");
  });

  it("covers the window rather than the content column", () => {
    // jsdom loads no stylesheet, so the class name above proves nothing about
    // reach. Read the sheet: hung on `.hall` the texture stopped at 1120px and
    // left the cover and the band bare, which is the regression this guards.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    );
    const rule = css.match(/\.page-fx\s*\{([^}]*)\}/);
    expect(rule, ".page-fx rule not found in club.css").not.toBeNull();
    expect(rule[1], ".page-fx is not fixed to the window").toMatch(/position\s*:\s*fixed/);
    expect(rule[1], ".page-fx does not fill the window").toMatch(/inset\s*:\s*0/);
    expect(rule[1], ".page-fx would swallow clicks").toMatch(/pointer-events\s*:\s*none/);
    expect(css, "the texture is back on .hall, where it stops at the column")
      .not.toMatch(/\.hall\s*\{[^}]*--fx-grain-opacity/);
  });
});

describe("the chapter rules", () => {
  it("run the full width of the window, not the content column", () => {
    // A bar that stops at the column reads as an underline on the text rather
    // than as a division of the page. CSS-only, so read the sheet.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    );
    const rule = css.match(/\.chapter-rule\s*\{([^}]*)\}/);
    expect(rule, ".chapter-rule rule not found in club.css").not.toBeNull();
    expect(rule[1], ".chapter-rule does not span the viewport").toMatch(/width\s*:\s*100vw/);
    expect(rule[1], ".chapter-rule does not break out of the column")
      .toMatch(/margin-left\s*:\s*calc\(50% - 50vw\)/);
  });
});

describe("the ladder", () => {
  it("hangs one rung per player, linking to their page", () => {
    const el = ladder([
      { rank: 1, user: "ann", points: 360 },
      { rank: 2, user: "bob", points: 260 },
    ]);
    const rows = [...el.querySelectorAll("a.ladder-row")];
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["#/p/ann", "#/p/bob"]);
    expect(rows[0].querySelector(".ladder-rank").textContent).toBe("1");
    expect(rows[0].querySelector(".ladder-name").textContent).toBe("@ann");
    expect(rows[0].querySelector(".ladder-points").textContent).toBe("360 PTS");
    expect(rows[0].querySelector(".ladder-shell").className).toMatch(/ladder-shell-(cream|graphite|lavender|sky)/);
  });

  it("says so when nobody has published", () => {
    const el = ladder([]);
    expect(el.querySelector("a.ladder-row")).toBeNull();
    expect(el.querySelector(".ladder-empty").textContent).toBe("Nobody has published yet.");
  });
});

describe("shellOf", () => {
  it("is stable per name and one of the four shells", () => {
    expect(shellOf("ann")).toBe(shellOf("ann"));
    for (const user of ["ann", "bob", "cid", "dee", "eve"]) {
      expect(["cream", "graphite", "lavender", "sky"]).toContain(shellOf(user));
    }
  });
});

describe("an open event's flyer", () => {
  it("links into the race and names it", () => {
    const el = flyer(open, held);
    expect(el.matches("article.challenge-note")).toBe(true);
    expect(el.querySelector("a.challenge-link").getAttribute("href")).toBe("#/e/sprint-2m");
    expect(el.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
    expect(el.querySelector(".eyebrow").textContent).toBe("RACE");
  });

  it("leaves the art frame empty until the still lands", () => {
    const frame = flyer(open, held).querySelector(".challenge-art");
    expect(frame).not.toBeNull();
    expect(frame.childElementCount).toBe(0);
  });

  it("states the course facts without the sweep", () => {
    expect(flyer(open, held).querySelector(".challenge-facts").textContent).toBe("2 m · flat · legs");
  });

  it("shows who holds it and in what time", () => {
    const standing = flyer(open, held).querySelector(".flyer-leader");
    expect(standing.querySelector(".challenge-star")).not.toBeNull();
    expect(standing.textContent).toContain("cdeplanne");
    expect(standing.textContent).toContain("9.456s");
  });

  it("invites an entry when nobody has finished", () => {
    expect(flyer(open, []).textContent).toContain("be the first");
    const dnf = [{ user: "a", policy_name: "p", score: 50, seeds_finished: 0 }];
    expect(flyer(open, dnf).textContent).toContain("no finisher yet");
  });
});

describe("a planned event's flyer", () => {
  it("is on the wall but is not a link", () => {
    const el = flyer(planned, []);
    expect(el.querySelector("a.challenge-link")).toBeNull();
    expect(el.querySelector("div.challenge-link")).not.toBeNull();
    expect(el.classList.contains("challenge-note--planned")).toBe(true);
  });

  it("says why it cannot be entered and never invites one", () => {
    const el = flyer(planned, []);
    expect(el.textContent).toContain("course not built yet");
    expect(el.textContent).not.toContain("be the first");
  });
});

const voted = {
  ...open,
  id: "swag-contest",
  title: "Swag Contest",
  metric: "votes",
  vote: { ballot_min: 2, ballot_max: 4, window_days: 7, per_day: 20 },
};

describe("a votable flyer", () => {
  it("wears a vote button and links to the booth", () => {
    const note = flyer(voted, []);
    expect(note.querySelector(".vote-button--sticker").textContent).toBe("VOTE HERE");
    expect(note.querySelector(".vote-button--sticker").getAttribute("href")).toBe("#/v/swag-contest");
  });

  it("counts the week's votes instead of a time", () => {
    const note = flyer(voted, [{ user: "cdeplanne", votes: 43, seeds_finished: 5 }]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("43 votes");
  });

  it("says so when nothing has been voted for yet", () => {
    const note = flyer(voted, [{ user: "cdeplanne", votes: 0, seeds_finished: 5 }]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("no votes yet");
  });

  it("hides the button on a planned round -- there is no booth to send anyone to yet", () => {
    const note = flyer({ ...voted, status: "planned" }, []);
    expect(note.querySelector(".vote-button")).toBeNull();
  });

  it("leaves a timed flyer alone", () => {
    const note = flyer(open, held);
    expect(note.querySelector(".vote-button")).toBeNull();
  });
});

describe("the flyer's category", () => {
  it("labels the event with its own category, not 'Race'", () => {
    expect(flyer({ ...open, category: "showcase" }, []).querySelector(".eyebrow").textContent)
      .toBe("SHOWCASE");
  });

  it("colours the offset shadow by category", () => {
    const shadowOf = (category) => flyer({ ...open, category }, []).className;
    expect(shadowOf("race")).toContain("challenge-note--race");
    expect(shadowOf("challenge")).toContain("challenge-note--challenge");
    expect(shadowOf("showcase")).toContain("challenge-note--showcase");
  });

  it("uses the charter's shadow primitive rather than its own box-shadow", () => {
    expect(flyer(open, []).className).toContain("fx-shadow-card");

    // The className check above would still pass with a literal box-shadow
    // re-added alongside fx-shadow-card. Read the sheet's own source and
    // scope the check to the rules this branch owns (the challenge-note
    // family) — club.css still carries three PRE-EXISTING literal
    // box-shadow declarations (.profile-duck, .profile-summary
    // .sticker:active, .profile-results a), all on the player page, which
    // this branch never touched, so a blanket search of the file would trip
    // on those.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css");
    const css = readFileSync(cssPath, "utf8");
    const noteRules = [...css.matchAll(/([^{}]*\.challenge-note[^{}]*)\{([^}]*)\}/g)];
    expect(noteRules.length).toBeGreaterThan(0);
    for (const [, selector, body] of noteRules) {
      expect(
        body,
        `${selector.trim()} declares a literal box-shadow — use fx-shadow-card instead`,
      ).not.toMatch(/box-shadow\s*:/);
    }
  });

  it("renders an unrecognised category without a label and without throwing", () => {
    // One malformed manifest must not take the whole wall down. The server is
    // where an unknown category is rejected; the page degrades.
    const note = flyer({ ...open, category: "parade" }, []);
    expect(note.className).not.toMatch(/challenge-note--/);
    expect(note.querySelector(".eyebrow")).toBeNull();
  });
});

describe("the polaroid caption", () => {
  it("puts the leader's handle above the event's title", () => {
    const note = flyer(open, [
      { user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 },
    ]);
    const order = [...note.querySelectorAll(".flyer-leader, .flyer-title")]
      .map((n) => n.className);
    expect(order).toEqual(["flyer-leader", "flyer-title"]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("cdeplanne");
    expect(note.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
  });

  it("shows the still above the caption, polaroid-fashion", () => {
    const note = flyer(open, []);
    const parts = [...note.querySelector(".challenge-link").children].map((n) => n.className);
    expect(parts.indexOf("challenge-art")).toBeLessThan(parts.indexOf("flyer-leader"));
  });
});

describe("the flock band", () => {
  it("carries the four ways out, each opening safely", () => {
    const band = flockBand();
    const hrefs = [...band.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(4);
    expect(hrefs.some((h) => h.includes("discord.com"))).toBe(true);
    expect(hrefs.some((h) => h.includes("github.com/pollen-robotics/microduck-arena"))).toBe(true);
    expect(hrefs.some((h) => h.includes("store.pollen-robotics.com"))).toBe(true);
    expect(hrefs.some((h) => h.includes("pollen-robotics.com/microduck"))).toBe(true);
    for (const a of band.querySelectorAll("a")) {
      expect(a.getAttribute("rel")).toBe("noopener");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("does not move", () => {
    // A scrolling marquee was taken off this page on purpose, and must never
    // come back in any form. jsdom never loads club.css, so a check on the
    // rendered DOM (class names, computed style) cannot see an `animation`
    // declared in the stylesheet — it would pass right through a marquee
    // re-added there. Read the sheet's own source instead: no @keyframes may
    // exist anywhere in it, and no rule touching .flock-band may declare an
    // `animation` or `animation-name` property.
    // A plain `new URL(relative, import.meta.url)` resolves against jsdom's
    // window.URL here, not Node's, and silently lands on a fake
    // http://localhost origin instead of this file's real path — so the path
    // is built with node:path against this file's own directory instead.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css");
    const css = readFileSync(cssPath, "utf8");
    expect(css, "a @keyframes block exists in club.css — the marquee is back").not.toMatch(/@keyframes/);
    const flockRules = [...css.matchAll(/([^{}]*\.flock-band[^{}]*)\{([^}]*)\}/g)];
    expect(flockRules.length).toBeGreaterThan(0);
    for (const [, selector, body] of flockRules) {
      expect(
        body,
        `${selector.trim()} declares an animation — the marquee is back`,
      ).not.toMatch(/animation(-name)?\s*:/);
    }
  });
});

describe("the demo padding", () => {
  it("is asked for either side of the hash, since the router addresses by hash", () => {
    // `#/?demo=1` is the spelling a person reaches for on a hash-routed page,
    // and it leaves location.search empty. Reading only search made the
    // switch look broken to the one person who needed it.
    expect(demoAsked("?demo=1", "#/")).toBe(true);
    expect(demoAsked("", "#/?demo=1")).toBe(true);
    expect(demoAsked("", "#/e/sprint-2m?demo")).toBe(true);
    expect(demoAsked("", "#/")).toBe(false);
    expect(demoAsked("", "")).toBe(false);
    expect(demoAsked("?other=1", "#/?other=1")).toBe(false);
  });

  it("pads from the hash spelling too", () => {
    expect(demoRows([], "", "#/?demo=1", false).length).toBe(15);
  });

  it("pads on the dev server with no flag at all", () => {
    // The flag was the wrong interface: it asked the one person who needed the
    // padding to know a secret, and its absence looked exactly like a bug.
    // Designing the page is the case that needs it, so that is the default.
    expect(demoRows([], "", "#/", true).length).toBe(15);
  });

  it("can never pad in a build, whatever the URL says", () => {
    // This is the line that keeps an invented handle off the live board.
    const real = [{ rank: 1, user: "ann", points: 360 }];
    expect(demoRows(real, "", "#/", false)).toBe(real);
  });

  it("leaves the real standings alone without ?demo", () => {
    const real = [{ rank: 1, user: "ann", points: 360 }];
    expect(demoRows(real, "", "#/", false)).toBe(real);
    expect(demoRows(real, "?foo=1", "#/?foo=1", false)).toBe(real);
  });

  it("pads past the frame's ten rungs so the scroll can be exercised", () => {
    const padded = demoRows([{ rank: 1, user: "ann", points: 360 }], "?demo=1", "#/", false);
    expect(padded.length).toBeGreaterThan(10);
    expect(padded[0]).toEqual({ rank: 1, user: "ann", points: 360 });
  });

  it("makes its placeholders obviously fake and correctly ranked", () => {
    const padded = demoRows([], "?demo=1", "#/", false);
    expect(padded.every((r) => r.user.startsWith("demo-"))).toBe(true);
    expect(padded.map((r) => r.rank)).toEqual(padded.map((_, i) => i + 1));
    // Points must fall with rank, or the frame shows a board that ranks wrong.
    for (let i = 1; i < padded.length; i += 1) {
      expect(padded[i].points).toBeLessThan(padded[i - 1].points);
    }
  });
});

describe("the ladder frame", () => {
  it("scrolls its rungs inside a border that stays put", () => {
    const el = ladder([{ rank: 1, user: "ann", points: 360 }]);
    // The bordered box is the frame; the scroller is inside it, or the border
    // scrolls away with the rows. It also carries the charter's card-shadow
    // primitive (fx-shadow-card) rather than a literal box-shadow.
    expect(el.className).toBe("ladders fx-shadow-card");
    expect(el.querySelector(".ladder-scroll .ladder-row")).not.toBeNull();

    // The DOM checks above pass just as well with the scrolling removed —
    // jsdom never loads club.css, so nothing above can see whether
    // .ladder-scroll actually scrolls. Read the sheet's own source, as the
    // marquee test above does: the scroller must declare a capped height and
    // overflow-y, and the frame around it must declare neither — that split
    // is what keeps the border still while the rows inside it move.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css");
    const css = readFileSync(cssPath, "utf8");
    const rule = (selector) => css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`));
    const scroll = rule("ladder-scroll");
    const frame = rule("ladders");
    expect(scroll, ".ladder-scroll rule not found in club.css").not.toBeNull();
    expect(frame, ".ladders rule not found in club.css").not.toBeNull();
    expect(scroll[1], ".ladder-scroll does not declare overflow-y").toMatch(/overflow-y\s*:/);
    expect(scroll[1], ".ladder-scroll does not cap its height").toMatch(/max-height\s*:/);
    expect(frame[1], ".ladders declares overflow-y — the border would scroll with the rows").not.toMatch(/overflow-y\s*:/);
    expect(frame[1], ".ladders declares max-height — the border would scroll with the rows").not.toMatch(/max-height\s*:/);
  });
});

describe("the duck's motion", () => {
  it("keeps every hover transition behind prefers-reduced-motion", () => {
    // The charter requires every motion to sit behind
    // `@media (prefers-reduced-motion: no-preference)`. jsdom never loads
    // club.css and never evaluates media queries, so nothing rendered can
    // tell an unguarded transition from a guarded one — read the sheet's
    // own source, as the marquee and ladder-frame tests above do.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css");
    const css = readFileSync(cssPath, "utf8");
    const guardedBlocks = [
      ...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{\n([\s\S]*?)\n\}/g),
    ].map(([, body]) => body);
    expect(guardedBlocks.length).toBeGreaterThan(0);
    const guarded = guardedBlocks.join("\n");

    expect(guarded, "the duck's hover transitions are not behind the media query")
      .toMatch(/\.duck \.duckhead \{[^}]*transition\s*:/);
    expect(guarded, "the duck-quack's transition is not behind the media query")
      .toMatch(/\.duck-quack \{[^}]*transition\s*:/);
    expect(guarded, "the duck's hover rule is not behind the media query")
      .toMatch(/\.duck:hover \.duckhead/);
    expect(guarded, "the duck-quack's hover rule is not behind the media query")
      .toMatch(/\.duck:hover \.duck-quack/);

    // And nothing duck-related escapes into the unguarded rest of the sheet.
    const unguarded = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{\n[\s\S]*?\n\}/g,
      "",
    );
    expect(unguarded, "a .duck:hover rule exists outside the media query").not.toMatch(/\.duck:hover/);
  });
});

describe("the chapter rules", () => {
  it("alternates the sense of the tilt from one rule to the next", () => {
    // The charter: "réunir le sens des rotations d'un élément au suivant".
    expect(chapterRule(0).className).toContain("chapter-rule--left");
    expect(chapterRule(1).className).toContain("chapter-rule--right");
    expect(chapterRule(2).className).toContain("chapter-rule--left");
  });

  it("is decorative, so a screen reader does not announce a line", () => {
    expect(chapterRule(0).getAttribute("aria-hidden")).toBe("true");
  });
});
