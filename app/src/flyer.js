// One event as a sheet of paper: its still, what kind of event it is, its
// name, and who holds it.
//
// Its own module because two views draw it — the front page's wall, and the
// strip of other rounds under a race. It was home.js's until the second
// caller arrived, and a race page importing a page to get at one component is
// how a view ends up dragging a whole other view's imports behind it.

import { formatEventFacts, formatScore } from "./format.js";
import { raceHref } from "./router.js";
import { voteButton } from "./votebutton.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const CATEGORIES = new Set(["race", "showcase"]);

/** Who holds this event, at the size a person scans the wall by. */
function leaderLine(event, rows) {
  const line = el("p", "flyer-leader");
  const star = el("img", "challenge-star");
  star.src = "/star-yellow.webp";
  star.alt = "";
  const leader = rows.find((row) => row.seeds_finished > 0);
  if (!leader) {
    line.append(star, el("span", "flyer-leader-name", rows.length ? "no finisher yet" : "be the first"));
    return line;
  }
  // A voted event is held by whoever collected the most votes THIS WEEK, so
  // the line says votes. A time would be the wrong fact about it.
  const held = event.vote
    ? (leader.votes ? `${leader.votes} votes` : "no votes yet")
    : formatScore(leader.score, { finished: leader.seeds_finished });
  line.append(star, el("span", "flyer-leader-name", leader.user), el("span", "flyer-leader-score", held));
  return line;
}

/**
 * One event on the wall: its still, who holds it, and what it is.
 *
 * The workshop pins the same sheet on its own wall: there `rows` is null (the sheet is about
 * training, not results: no leader line), `href` leads to the challenge's workshop page, and
 * `corner` is what sits in the top corner instead of VOTE HERE (null: nothing).
 */
export function flyer(event, rows, { href = raceHref(event.id), corner } = {}) {
  const known = CATEGORIES.has(event.category);
  const classes = ["challenge-note", "fx-shadow-card"];
  // An unrecognised category keeps the neutral ink shadow the base rule sets,
  // rather than borrowing another category's colour.
  if (known) classes.push(`challenge-note--${event.category}`);
  const note = el("article", classes.join(" "));
  note.append(el("span", "flyer-tape"));
  const sticker = corner !== undefined ? corner : event.vote ? voteButton(event, { variant: "sticker" }) : null;
  if (sticker) note.append(sticker);
  const link = el("a", "challenge-link");
  link.href = href;
  const facts = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");
  link.append(el("div", "challenge-art"));
  if (known) link.append(el("span", "eyebrow", event.category.toUpperCase()));
  link.append(el("h4", "flyer-title", event.title));
  if (rows !== null) link.append(leaderLine(event, rows));
  link.append(el("p", "challenge-facts", facts));
  note.append(link);
  return note;
}
