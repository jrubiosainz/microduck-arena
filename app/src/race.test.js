import { describe, expect, it } from "vitest";
import {
  arrangeLanes, otherRounds, raceHall, renderCupDaysLeft, renderEventFacts, renderVoteButton,
} from "./race.js";

const event = {
  seeds: 5,
  sweep_count: 5,
  sweep_lo: 0.2,
  sweep_hi: 1.2,
  sweep_step: 0.05,
  length_m: 2,
  slope_deg: 0,
  rig: "legs",
};

describe("renderEventFacts: the caveat under the facts", () => {
  function render() {
    const root = document.createElement("div");
    root.innerHTML = '<dl class="facts" id="facts"></dl>';
    renderEventFacts(root, event);
    return root;
  }

  it("renders a racecaveat paragraph, honestly worded, right after the facts", () => {
    const root = render();
    const facts = root.querySelector("#facts");
    const caveat = root.querySelector(".racecaveat");

    expect(caveat).not.toBeNull();
    expect(caveat.tagName).toBe("P");
    // Sits immediately under the facts it qualifies, not buried elsewhere on
    // the page -- the brief is explicit that placement is part of the point.
    expect(facts.nextElementSibling).toBe(caveat);
    // The actual claim, not just that some caveat exists: a policy tuned on
    // a different course or physics can score worse here without being a
    // worse policy. That is the sentence a trusted board depends on.
    expect(caveat.textContent).toMatch(/measured on this course/i);
    expect(caveat.textContent).toMatch(/do worse here without being worse/i);
  });

  it("still renders every fact alongside the caveat", () => {
    const root = render();
    const facts = root.querySelector("#facts");
    expect(facts.children.length).toBe(4);
    expect(facts.textContent).toMatch(/legs/);
  });

  it("a stage's facts say what it is, and its caveat speaks of performances", () => {
    const root = document.createElement("div");
    root.innerHTML = '<dl id="facts"></dl>';
    const caveat = renderEventFacts(root, { id: "got-a-talent", course: "stage", rig: "legs", time_limit_s: 20 });
    expect([...root.querySelectorAll("dt")].map((n) => n.textContent)).toEqual(["stage", "performance", "rig"]);
    expect(caveat.textContent).toContain("Performances play on this stage");
  });

  it("a tug's caveat speaks of ratings", () => {
    const TUG = { id: "tug-of-war", course: "tug", rig: "legs", ring_m: 3, pit_m: 0.3, bout: { time_limit_s: 45 } };
    const root = document.createElement("div");
    root.innerHTML = '<dl id="facts"></dl>';
    expect(renderEventFacts(root, TUG).textContent).toBe(
      "Ratings are measured in bouts against the reference duck, with this friction and this physics build. A policy tuned elsewhere can " +
      "pull less here without being weaker.",
    );
  });
});


describe("renderVoteButton: the way into the booth, at the top of the entry column", () => {
  // A bare stand-in for the bit of renderRace's template this cares about --
  // no stage, no viewer, no leaderboard fetch, just the node the placement
  // is anchored on.
  function root() {
    const div = document.createElement("div");
    div.innerHTML = '<div class="entry-col"><a class="help-link"></a></div>';
    return div;
  }

  it("tops the entry column when the event takes votes", () => {
    const div = root();
    renderVoteButton(div, { id: "got-a-talent", vote: { ballot_min: 2 } });
    const button = div.querySelector(".vote-button");
    expect(button).not.toBeNull();
    expect(button.getAttribute("href")).toBe("#/v/got-a-talent");
    // The column's first child: detached from the title on purpose (the
    // owner asked for it "plus visible"), not beside a heading elsewhere.
    expect(div.querySelector(".entry-col").firstElementChild).toBe(button);
  });

  it("adds nothing on a timed event", () => {
    const div = root();
    renderVoteButton(div, { id: "sprint-2m" });
    expect(div.querySelector(".vote-button")).toBeNull();
  });
});

describe("renderCupDaysLeft: a versus page's days left, atop the entry column", () => {
  it("tops the column, above training, as the way to the cup", () => {
    const div = document.createElement("div");
    div.innerHTML = '<div class="entry-col"><details class="train"></details><a class="help-link"></a></div>';
    const cups = { next: { number: 1, close_at: "2026-10-30T15:00:00Z", premiere_at: "2026-10-30T17:00:00Z", entrants: [] }, cups: [] };
    renderCupDaysLeft(div, { id: "tug-of-war" }, cups, Date.parse("2026-10-22T21:00:00Z"));
    const days = div.querySelector(".entry-col").firstElementChild;
    expect(days.className).toBe("cup-left");
    expect(days.getAttribute("href")).toBe("#/c/tug-of-war/1");
    expect(days.querySelector(".cup-left__cup").textContent).toBe("Cup #1");
    expect(days.querySelector(".cup-left__days").textContent).toBe("7 days left");
  });
});

describe("raceHall: the page's frame", () => {
  const hall = () => raceHall({ ...event, title: "2 m Sprint" });

  it("puts the title INSIDE the stage's column, so the entry column starts level with it", () => {
    // The whole point of the arrangement. With the title above the grid the
    // entry column began below the facts, a heading and a half down the page.
    const column = hall().querySelector(".racegrid > div:first-child");
    const parts = [...column.children].map((n) => n.className);
    expect(parts[0]).toBe("racetitle");
    expect(parts.indexOf("facts")).toBeLessThan(parts.findIndex((c) => c.startsWith("deck")));
  });

  it("offers a way back, to the front page rather than to history", () => {
    // A race page is pasted between people; on a fresh tab history.back()
    // has nowhere to go, and a link always does.
    const back = hall().querySelector("a.raceback");
    expect(back.getAttribute("href")).toBe("#/");
    expect(back.textContent).toBe("Back to the rounds");
  });

  it("frames the stage with the charter's shadow primitive", () => {
    const deck = hall().querySelector(".deck");
    expect(deck.className).toContain("fx-shadow-card");
    expect(deck.classList.contains("stage")).toBe(true);
  });

  it("hangs no bar of keys under the picture: only the follow key, on it", () => {
    const deck = hall().querySelector(".deck");
    expect([...deck.querySelectorAll("button")].map((b) => b.id)).toEqual(["follow"]);
  });

  it("names the kind of event over its title, as its card does", () => {
    const hall = raceHall({ ...event, title: "2 m Sprint", category: "showcase" });
    expect(hall.querySelector(".raceeyebrow").textContent).toBe("SHOWCASE");
    // An event whose category the server did not send draws no empty line.
    expect(raceHall({ ...event, title: "x" }).querySelector(".raceeyebrow")).toBeNull();
  });

  it("hangs no key on the picture: the board's tabs already say which duck is whose", () => {
    expect(hall().querySelector(".key")).toBeNull();
  });

  it("puts the picks and the filters inside the board's own frame, above it", () => {
    // One piece of paper: these controls act on this table and nothing else,
    // and floating them above the sheet made two objects out of one.
    const sheet = hall().querySelector(".boardsheet");
    expect(sheet.querySelector(".boardtop")).not.toBeNull();
    const order = [...sheet.children];
    expect(order.indexOf(sheet.querySelector(".boardtop")))
      .toBeLessThan(order.indexOf(sheet.querySelector("#board")));
  });

  it("puts one box left of the filters, above the column of boxes it ticks", () => {
    // It ticks checkboxes, so it is a checkbox. One, not three: what goes on
    // the stage is now either everything the table is showing or nothing, and
    // anything in between is picked row by row.
    const top = hall().querySelector(".boardtop");
    expect([...top.children].map((n) => n.className)).toEqual(["pickall", "modes"]);
    const all = top.querySelector(".pickall .pickall-box");
    expect(all.type).toBe("checkbox");
    expect(all.checked).toBe(false);
    // Labelled, because what ticking a box on this page means is not something
    // a column of bare boxes can say for itself.
    expect(top.querySelector(".pickall span").textContent).toBe("Put on the stage");
  });

  it("offers All, Mine and Top 3 as what the table lists, opening on Top 3", () => {
    const keys = [...hall().querySelectorAll(".modes button")];
    expect(keys.map((b) => b.dataset.mode)).toEqual(["all", "mine", "top"]);
    expect(keys.map((b) => b.textContent)).toEqual(["All", "Mine", "Top 3"]);
    // Mine and Top compose, so neither can be the one that is always on. The
    // markup opens on Top 3 and renderRace turns the rest on and off from it.
    expect(keys.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
  });

  it("carries no brightness slider", () => {
    // Pinned at the module's minimum instead. If the stage ever looks wrong,
    // brightness.js explains in its own comment why a control was there.
    expect(hall().querySelector("#brightness")).toBeNull();
    expect(hall().querySelector(".bright")).toBeNull();
  });

  it("says a failed withdrawal under the board", () => {
    const hall = raceHall({ id: "sprint-2m", title: "2 m Sprint" });
    const note = hall.querySelector(".boardsheet + #board-note");
    expect(note).not.toBeNull();
    expect(note.getAttribute("role")).toBe("status");
  });
});


describe("otherRounds: the way on, under the board", () => {
  // `event` at the top of this file carries what formatEventFacts reads; the
  // programme is what GET /api/events hands the page, so it carries it too.
  const round = (id, title, category, rig = "legs", extra = {}) => ({
    ...event, id, title, category, rig, ...extra,
  });
  const programme = [
    round("sprint-2m", "2 m Sprint", "race"),
    round("roller-sprint-2m", "2 m Roller Sprint", "race", "rollers"),
    round("hill-climb-1m5", "1.5 m Hill Climb", "race"),
    round("got-a-talent", "MicroDuck Got a Talent", "showcase", "legs", { vote: {} }),
  ];
  const here = programme[0];

  it("leaves out the round you are already on", () => {
    // A card back to this page is a dead end dressed as a way forward.
    const strip = otherRounds(programme, here, new Map());
    const links = [...strip.querySelectorAll("a.round-card__link")].map((a) => a.getAttribute("href"));
    expect(links).not.toContain("#/e/sprint-2m");
    expect(links[0]).toBe("#/e/roller-sprint-2m");
  });

  it("carries EVERY other round, wrapping rather than offering a way to the rest", () => {
    // With the whole programme already here, a "see all" would only send you
    // to a page showing the same thing.
    const strip = otherRounds(programme, here, new Map());
    expect(strip.querySelectorAll(".round-card")).toHaveLength(programme.length - 1);
    expect(strip.querySelector(".rounds-on__all")).toBeNull();
  });

  it("gives each card the holder its board names, and none to a board it has none for", () => {
    const boards = new Map([
      ["roller-sprint-2m", [{ user: "ann", score: 3.216, seeds_finished: 5 }]],
    ]);
    const strip = otherRounds(programme, here, boards);
    const cards = [...strip.querySelectorAll(".round-card")];
    expect(cards[0].querySelector(".round-card__holder").textContent).toBe("@ann");
    expect(cards[1].querySelector(".round-card__score").textContent).toBe("be the first");
  });

  it("numbers each card by the whole programme, so it keeps its number on every wall", () => {
    const strip = otherRounds(programme, here, new Map());
    const numbers = [...strip.querySelectorAll(".round-card__num")].map((n) => n.textContent);
    expect(numbers).toEqual(["#02", "#03", "#04"]);
  });
});


describe("arrangeLanes", () => {
  it("shares leaderboard colours with opaque racers before shuffling their lanes", () => {
    const board = document.createElement("div");
    board.innerHTML = '<table><tbody>' + ["a", "b", "c"].map(id =>
      `<tr><td class="tab"><input data-run-id="${id}"></td></tr>`).join("") + '</tbody></table>';
    const lanes = [{runId:"a", tier:"leader"}, {runId:"b", tier:"ghost"}, {runId:"c", tier:"ghost"}];
    const shuffled = arrangeLanes(board, lanes, () => 0);
    expect(shuffled.map(lane => lane.runId)).toEqual(["b", "c", "a"]);
    for (const lane of shuffled) {
      expect(lane.opacity).toBe(1);
      expect(lane.colour).toBe(board.querySelector(`[data-run-id="${lane.runId}"]`).closest(".tab").style.getPropertyValue("--lane"));
    }
    expect(new Set(shuffled.map(lane => lane.colour)).size).toBe(3);
    const selected = arrangeLanes(board, [lanes.find(lane => lane.runId === "c")], () => 0);
    expect(board.querySelector('[data-run-id="a"]').closest('.tab').style.getPropertyValue('--lane')).toBe('');
    expect(selected[0].colour).toBe(board.querySelector('[data-run-id="c"]').closest('.tab').style.getPropertyValue('--lane'));
  });
});
