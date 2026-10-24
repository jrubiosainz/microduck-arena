// The duel's page as a detached element (duel/main.js mounts it): the Arena's
// trackside frame — the stage on the left under the duel's name, a column on
// the right — with what a match needs in place of a board. Its own module, as
// race.js's raceHall, so the frame can be exercised as DOM: the rest needs WebGL
// and the server that played the match.

import { deckMarkup } from "../deck.js";
import { duckHead, wordmark } from "../wordmark.js";
import { el } from "../workshop/dom.js";
import { LETTERS, boutLine, points, policyColour, policyOn } from "./bouts.js";

/** The strip over the page: the mark, MICRODUCK DUEL. The server answers nothing else, so nothing links on. */
export function strip() {
  const header = el("header", "signage");
  const brand = el("div", "club-brand");
  brand.append(duckHead(), wordmark({ word: "Duel" }));
  header.append(brand);
  return header;
}

/** A policy's letter on its colour, as the scoreboard and the bouts mark it. */
function swatch(policy) {
  const chip = el("span", "duel-swatch", LETTERS[policy]);
  chip.style.background = policyColour(policy);
  return chip;
}

/** A total in the gym scoreboard's flip tiles: a tile a digit, the point between them in paper. */
function flip(text) {
  const row = el("div", "flip");
  for (const character of text) row.append(el("span", /\d/.test(character) ? "flip-digit" : "", character));
  return row;
}

function facts(summary) {
  const { gap_m: gap, pit_depth_m: depth } = summary.course;
  const cm = (m) => `${Math.round(m * 100)} cm`;
  const list = el("dl", "facts");
  for (const [label, value] of [
    ["pit", `${cm(gap)} across, ${cm(depth)} deep`],
    ["bell", `${summary.time_limit_s} s`],
    ["bouts", `${summary.bouts.length}, every seed from both decks`],
  ]) {
    const pair = el("div");
    pair.append(el("dt", "", label), el("dd", "", value));
    list.append(pair);
  }
  return list;
}

function scoreboard(summary) {
  const board = el("section", "scoreboard duel-score");
  board.setAttribute("aria-label", "Match points");
  board.append(el("span", "mono-label", "Match points"));
  summary.names.forEach((name, policy) => {
    const row = el("div", "duel-score__row");
    const who = el("span", "duel-who");
    who.append(swatch(policy), el("span", "duel-who__name", name));
    who.title = name;
    row.append(who, flip(points(summary.points[policy])));
    board.append(row);
  });
  return board;
}

function boutList(summary) {
  const list = el("ol", "duel-bouts");
  summary.bouts.forEach((bout, k) => {
    const button = el("button", "duel-bout");
    button.type = "button";
    button.dataset.bout = String(k);
    const decks = el("span", "duel-bout__decks");
    decks.title = `${bout.on_deck[0]} on the left deck, ${bout.on_deck[1]} on the right`;
    decks.append(swatch(policyOn(summary, bout, 0)), el("span", "duel-bout__vs", "|"), swatch(policyOn(summary, bout, 1)));
    button.append(
      el("span", "mono-label duel-bout__seed", `Bout ${k + 1} · seed ${bout.seed}`),
      decks,
      el("span", "duel-bout__how", boutLine(summary, bout)),
    );
    const item = el("li");
    item.append(button);
    list.append(item);
  });
  return list;
}

/**
 * The page's frame for `summary` (arena/duel_watch.py duel_summary), and the
 * parts main.js drives: the stage's clock, stamp and verdict, the bouts'
 * buttons, and the transport.
 */
export function duelHall(summary) {
  const hall = el("main", "hall duel");
  const grid = el("div", "racegrid");
  const left = el("div");
  left.append(el("p", "raceeyebrow", "Duel"), el("h2", "racetitle", summary.title), facts(summary));
  left.insertAdjacentHTML("beforeend", deckMarkup);
  const stage = left.querySelector(".deck");
  // The camera stands still for a duel, so letting it go and taking it back is a return, not a chase.
  stage.querySelector("#follow").textContent = "Back to ringside";

  const clock = el("div", "duel-clock");
  const clockLabel = el("span", "mono-label");
  const clockTime = el("span", "duel-clock__time", "0.00 s");
  clock.append(clockLabel, clockTime);
  const call = el("div", "duel-verdict");
  const stamp = el("span", "stamp fx-tilt-2-5");
  call.append(stamp);
  const line = el("p", "duel-line");
  line.setAttribute("role", "status");
  call.hidden = line.hidden = true;
  stage.append(clock, call, line);

  const column = el("div", "entry-col");
  const pause = el("button", "sticker", "Pause");
  const replay = el("button", "sticker sticker-cyan", "Replay bout");
  pause.type = replay.type = "button";
  const transport = el("div", "duel-transport");
  transport.append(pause, replay);
  const bouts = boutList(summary);
  column.append(
    scoreboard(summary),
    el("p", "eyebrow duel-bouts__head", "Bouts"),
    bouts,
    transport,
    el("p", "duel-note", `A duck that drops off its deck, or stays down ${summary.course.fall_hold_s} s, `
      + "loses the bout, and so does one whose action is not a number. "
      + "At the bell, whoever has pulled "
      + `the rope's middle more than ${Math.round(summary.course.margin_m * 100)} cm their way wins it.`),
  );
  grid.append(left, column);
  hall.append(grid);
  return {
    hall,
    parts: {
      stage,
      clock,
      clockLabel,
      clockTime,
      call,
      stamp,
      line,
      bouts: [...bouts.querySelectorAll(".duel-bout")],
      pause,
      replay,
    },
  };
}
