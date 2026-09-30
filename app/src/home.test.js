import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flyer } from "./flyer.js";
import {
  demoAsked, demoRows, flockBand, ladder, liveFrame, masthead, pageTexture, playerCard,
} from "./home.js";

const open = {
  id: "sprint-2m", title: "2 m Sprint", category: "race", rig: "legs",
  length_m: 2, slope_deg: 0,
  sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
};
const held = [{ user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 }];

describe("the masthead", () => {
  it("keeps the way out off the cover", () => {
    // It belongs on the page about you, not beside a mark every visitor sees.
    const head = masthead({ signed_in: true, user: "ann", oauth_enabled: true }, null);
    expect(head.querySelector(".sign-out")).toBeNull();
  });

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

  it("offers the way in when signed out, under the site's own duck", () => {
    const card = playerCard({ signed_in: false });
    const link = card.querySelector("a.player-card-in");
    expect(link.textContent).toContain("Sign in");
    // The mark, not the emoji: an emoji duck is a mallard from whatever font
    // the machine happens to have, beside the head that IS this site's mark.
    const head = link.querySelector("img.duckhead.player-card-duck");
    expect(head.getAttribute("src")).toBe("/duck-head-mark.webp");
    expect(head.getAttribute("alt")).toBe("");
    // Nothing else in the masthead may size this duck. The cover's own is
    // sized by `.masthead-lockup .duckhead`; while that rule said
    // `.masthead .duckhead` the two were the same specificity, source order
    // decided, and the plate's duck stayed the size of the mark's. Asserting
    // the plate's rule EXISTS was not enough — it existed and lost.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css, "the plate's duck has no size of its own")
      .toMatch(/\.player-card-in \.duckhead\s*\{[^}]*width/);
    expect(css, "a masthead-wide rule can still reach the plate's duck")
      .not.toMatch(/\.masthead \.duckhead\s*\{/);
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
    // The clip-path that cuts the bottom edge also trims the dot layer, which
    // is inset -6% and turned 2.5°.
    expect(door[1], "the dot layer's corners are not kept off the page")
      .toMatch(/clip-path:\s*polygon/);

    // The dot field, as pollen-robotics.com/microduck draws it. Each of these
    // is a thing that was asked for by name and that a later tidy-up would
    // quietly undo: orange rather than ink, tilted rather than square, and
    // masked so the dots sit only at the top.
    const dots = css.match(/\.door::after\s*\{([^}]*)\}/);
    expect(dots, ".door::after rule not found in club.css").not.toBeNull();
    // Declarations only. A comment explaining why a property is NOT used must
    // not read as that property being used — which is exactly what happened.
    const dotRules = dots[1].replace(/\/\*[\s\S]*?\*\//g, "");
    // The recipe itself lives on .hall, because the foot of a player's page
    // wears it too and a recipe copied twice is a recipe that drifts.
    expect(css, "the dots are not built from the orange token")
      .toMatch(/--dots:[\s\S]*?color-mix\(in srgb, var\(--orange\)/);
    expect(dotRules, "the band does not use the shared dot field")
      .toMatch(/var\(--dots\)/);
    expect(dotRules, "the dots sit square instead of leaning with the page")
      .toMatch(/rotate\(calc\(-1 \* var\(--rotate-2-5\)\)\)/);
    // The fade must stay a background layer. `mask-image` resolves through
    // `mask-mode`, which browsers have differed on, and it put the dots at
    // the wrong end of the band once already.
    // `to top` puts the gradient's 0% at the BOTTOM edge, so the dots gather
    // along the band's lower edge against the tilted rule. Flipping this to
    // `to bottom` moves the whole field to the other end of the band.
    expect(css, "the wash does not clear at the edge the dots gather on")
      .toMatch(/--dots-wash-up:\s*linear-gradient\(to top, transparent 0%, var\(--warm-paper\)/);
    expect(dotRules, "the band does not paint the wash over the dots")
      .toMatch(/background-image:\s*var\(--dots-wash-up\), var\(--dots\)/);
    expect(dotRules, "the fade went back to being a mask").not.toMatch(/mask-image/);
    // The wash must sit BEHIND the text. Painted over it, it faded the title
    // to a ghost and swallowed every ladder row after the first.
    expect(dotRules, "the wash paints over the band's own content")
      .toMatch(/z-index\s*:\s*-1/);
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

describe("the chapter chequer", () => {
  it("runs the full width of the window, in orange on beige", () => {
    // A band that stops at the column reads as an underline on the text
    // rather than as a division of the page. And the gradient must stay a
    // repeating PATTERN — a colour ramp is what the charter forbids.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    );
    const band = css.match(/\.chapter-checker\s*\{([^}]*)\}/);
    expect(band, ".chapter-checker rule not found in club.css").not.toBeNull();
    // Wider than the window, because it leans: at exactly 100vw a 1° turn
    // opens a triangle of bare paper at each edge of the screen.
    expect(band[1], "the chequer does not lean as the rule it replaced did")
      .toMatch(/rotate\s*:\s*calc\(-1 \* var\(--rotate-1-0\)\)/);
    expect(band[1], "the chequer is not wide enough to hide the turn's corners")
      .toMatch(/width\s*:\s*10[1-9]vw/);
    expect(band[1], "the chequer is not pulled back by half its excess")
      .toMatch(/margin-left\s*:\s*calc\(50% - 54vw\)/);
    expect(band[1], "the chequer is not beige under its squares")
      .toMatch(/background-color\s*:\s*var\(--warm-paper\)/);
    expect(band[1], "the squares are not orange").toMatch(/var\(--orange\)/);
    expect(band[1], "the squares do not repeat on a grid").toMatch(/background-size\s*:/);
  });

  it("is met by a band cut to the same angle", () => {
    // Its ends sit about 1vw above and below its own box, and the band above
    // has a horizontal bottom edge — so warm paper showed beneath the end
    // that lifts. No amount of moving either one fixes that: the two edges
    // have to be parallel, which is what the band's clip-path is for.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const door = css.match(/\n\.door \{([^}]*)\}/);
    expect(door[1], "the band's bottom edge is square under a leaning chequer")
      .toMatch(/clip-path:\s*polygon/);
    expect(css, "the slant is not declared where both sides can read it")
      .toMatch(/\.hall \{[^}]*--slant:/);
    // And the stripes below have to overshoot the chequer's box by the same
    // measure: at the end that lifts, its lower edge is half a slant above
    // that box, and stripes starting at the box left a white gap under it.
    const stripes = css.match(/\.chapter--wall::after \{([^}]*)\}/);
    expect(stripes[1], "the stripes stop short of the chequer's raised end")
      .toMatch(/top:\s*calc\(-1 \* \(var\(--space-title-to-grid-max\) \+ 0\.5 \* var\(--slant\)\)\)/);
    // And their top edge leans too. Raising a horizontal edge to meet the end
    // that lifts only pushes it over the end that dips, and the stripes spill
    // onto the warm paper there. Both edges have to be parallel to the
    // chequer, not merely offset from it.
    expect(stripes[1], "the stripes' top edge is square under a leaning chequer")
      .toMatch(/clip-path:\s*polygon\(0 var\(--slant\), 100% 0/);
    const band = css.match(/\.chapter-checker\s*\{([^}]*)\}/);
    expect(band[1], "the chequer does not lean, so the cut would be wrong")
      .toMatch(/rotate:\s*calc\(-1 \* var\(--rotate-1-0\)\)/);
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
    // No "@": the handle is the name here, not a mention of one.
    expect(rows[0].querySelector(".ladder-name").textContent).toBe("ann");
    expect(rows[0].querySelector(".ladder-points").textContent).toBe("360 PTS");
    // The colour square is gone: it hashed the handle to one of four shells
    // and stood for nothing a reader could act on.
    expect(rows[0].querySelector(".ladder-shell")).toBeNull();
  });

  it("says so when nobody has published", () => {
    const el = ladder([]);
    expect(el.querySelector("a.ladder-row")).toBeNull();
    expect(el.querySelector(".ladder-empty").textContent).toBe("Nobody has published yet.");
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

const voted = {
  ...open,
  id: "swag-contest",
  title: "MicroDuck Got a Talent",
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
    expect(shadowOf("showcase")).toContain("challenge-note--showcase");
  });

  it("swings on its tape rather than sliding, and only where motion is wanted", () => {
    // CSS-only. The pivot must be the tape's own position from components.css
    // (left: calc(50% - 32px); top: -12px), or the sheet turns about its
    // middle and reads as a spinning tile instead of hanging paper.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const note = css.match(/\n\.challenge-note \{([^}]*)\}/);
    expect(note[1], "the flyer does not pivot on its tape")
      .toMatch(/transform-origin:\s*50% -12px/);
    // Every bit of the swing lives inside the reduced-motion guard.
    const guarded = [...css.matchAll(
      /@media \(prefers-reduced-motion: no-preference\) \{\n([\s\S]*?)\n\}/g,
    )].map(([, body]) => body).join("\n");
    // Matched loosely on purpose: the hover may be one selector or a list of
    // them, and pinning the exact shape of the selector is pinning the
    // formatting, not the behaviour.
    expect(guarded, "the flyer's hover swing is not behind the media query")
      .toMatch(/\.challenge-note:has\(\.challenge-link\):hover/);
    expect(guarded, "the hover does not rotate the sheet")
      .toMatch(/rotate:\s*calc\(-1 \* var\(--rotate-2-5\)\)/);
    const unguarded = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{\n[\s\S]*?\n\}/g,
      "",
    );
    expect(unguarded, "a flyer hover transition escapes the media query")
      .not.toMatch(/\.challenge-note[^{]*:hover/);
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
  it("puts the event's title above the leader's handle", () => {
    const note = flyer(open, [
      { user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 },
    ]);
    const order = [...note.querySelectorAll(".flyer-leader, .flyer-title")]
      .map((n) => n.className);
    expect(order).toEqual(["flyer-title", "flyer-leader"]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("cdeplanne");
    expect(note.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
  });

  it("shows the still above the caption, polaroid-fashion", () => {
    const note = flyer(open, []);
    const parts = [...note.querySelector(".challenge-link").children].map((n) => n.className);
    expect(parts.indexOf("challenge-art")).toBeLessThan(parts.indexOf("flyer-title"));
  });
});

describe("the flock band", () => {
  it("carries the four ways out, in order, each opening safely", () => {
    const band = flockBand();
    const links = [...band.querySelectorAll("a")];
    // Order is the point: discover it, buy it, join the people, train a
    // policy. A set comparison would let them be shuffled.
    expect(links.map((a) => a.textContent)).toEqual([
      "Discover Microduck",
      "Buy Microduck",
      "Join the flock",
      "Create policies",
    ]);
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs[0]).toContain("pollen-robotics.com/microduck");
    expect(hrefs[1]).toContain("store.pollen-robotics.com");
    expect(hrefs[2]).toContain("discord.com");
    // The RL repo, where a policy is trained — not this Space's own source.
    expect(hrefs[3]).toBe("https://github.com/pollen-robotics/microduck_rl");
    for (const a of links) {
      expect(a.getAttribute("rel")).toBe("noopener");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("puts Discord's mark on the Discord link and nowhere else", () => {
    const band = flockBand();
    const marks = [...band.querySelectorAll("svg.flock-mark")];
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("a").getAttribute("href")).toContain("discord.com");
    // Decorative: the word beside it already says what the link is.
    expect(marks[0].getAttribute("aria-hidden")).toBe("true");
  });

  it("gives the Discord mark its own size, not the stylesheet's", () => {
    // An <svg> with a viewBox and no dimensions fills its container. Clicking
    // a round disables club.css a moment before the new page replaces the
    // DOM, and for that moment the mark filled the window.
    const mark = flockBand().querySelector("svg.flock-mark");
    expect(mark.getAttribute("width")).toBe("15");
    expect(mark.getAttribute("height")).toBe("15");
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
  it("guards the MOVEMENT only, and lets the beak open either way", () => {
    // The rule this pins changed on purpose. prefers-reduced-motion asks for
    // less movement, not for less to look at: with it on the head stops
    // tilting, and the mouth still opens. So the tilt and the transitions
    // must be inside the guard and the opacity swap must not.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../public/club.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const guarded = [...css.matchAll(
      /@media \(prefers-reduced-motion: no-preference\) \{\n([\s\S]*?)\n\}/g,
    )].map(([, body]) => body).join("\n");
    const unguarded = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{\n[\s\S]*?\n\}/g,
      "",
    );

    expect(guarded, "the duck's transitions are not behind the media query")
      .toMatch(/\.duck \.duckhead \{[^}]*transition\s*:/);
    expect(guarded, "the head's tilt is not behind the media query")
      .toMatch(/\.duck:hover \.duckhead \{[^}]*rotate\s*:/);
    // No movement escapes: nothing outside the guard rotates or translates
    // anything on hover of the duck.
    expect(unguarded, "the duck moves even where movement was refused")
      .not.toMatch(/\.duck:hover[^{]*\{[^}]*(rotate|translate|transition)\s*:/);
  });
});


describe("the channel's frame", () => {
  it("is a stage to mount the channel in, with a button as the way into it", () => {
    const frame = liveFrame();
    expect(frame.matches("div.season-live")).toBe(true);
    // Through the charter's shadow primitive, not a literal box-shadow.
    expect(frame.className).toContain("fx-shadow-card");
    expect(frame.querySelector(".season-live-stage")).not.toBeNull();
    // A button that says what it does, not an invisible link across the whole
    // picture: that one took a click anywhere on the channel and left the
    // front page for a page with no way back.
    const door = frame.querySelector("a.season-live-full");
    expect(door.getAttribute("href")).toBe("#/live");
    expect(door.textContent).toBe("Full screen");
    expect(frame.querySelector(".season-live-door")).toBeNull();
  });
});
