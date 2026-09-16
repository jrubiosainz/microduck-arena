// The club's front: who is ahead this season, and which round to pick.
//
// The ladder ranks PEOPLE by the points their publications earned; the flyers
// are the events, each carrying the course, its facts and who holds it. The
// race pages behind the flyers are unchanged — this page is the way in.

import { getEvents, getLeaderboard, getMe, getStandings } from "./api.js";
import { formatEventFacts, formatScore } from "./format.js";
import { FLOCK, MICRODUCK, MICRODUCK_RL, STORE } from "./links.js";
import { playerHref, raceHref } from "./router.js";
import { signInHref } from "./session.js";
import { avatar } from "./signage.js";
import { renderThumbnails } from "./thumbnail.js";
import { voteButton } from "./votebutton.js";
import { duckHead, wordmark } from "./wordmark.js";

const SHELLS = ["cream", "graphite", "lavender", "sky"];
const DEMO_ROWS = 15;

/** Which of the four duck shells a player drives: a stable hash of the name. */
export function shellOf(user) {
  let hash = 0;
  for (const char of String(user)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SHELLS[hash & 3];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Padding for `?demo=1`, so the ladder's scroll can be judged against more
 * than three real people.
 *
 * Client-side and pure: no fabricated row reaches the store, the API or
 * another visitor's screen. The handles say `demo-` out loud, because a
 * placeholder that looks like a person is how a screenshot becomes a lie.
 */
export function demoAsked(search, hash) {
  if (new URLSearchParams(String(search || "")).has("demo")) return true;
  // The router addresses pages by hash, so `#/?demo=1` is the spelling a
  // person naturally reaches for — and it leaves `location.search` empty.
  // Reading only one of the two made the switch look broken.
  const query = String(hash || "").split("?")[1];
  return query ? new URLSearchParams(query).has("demo") : false;
}

/**
 * True on the Vite dev server, false in anything built.
 *
 * This is the line that decides who can ever see a fabricated row: the
 * padding is on by default while designing the page and CANNOT be on in the
 * bundle the Space serves. A URL flag was the wrong interface — it asks the
 * one person who needs the padding to know a secret, and its absence looks
 * exactly like a bug.
 */
const IS_DEV = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

export function demoRows(rows, search = location.search, hash = location.hash, dev = IS_DEV) {
  if (!dev && !demoAsked(search, hash)) return rows;
  const padded = [...rows];
  while (padded.length < DEMO_ROWS) {
    const rank = padded.length + 1;
    padded.push({ rank, user: `demo-duck-${rank}`, points: 1000 - rank * 37 });
  }
  return padded.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function ladder(rows) {
  const box = el("div", "ladders fx-shadow-card");
  const list = el("div", "ladder ladder-scroll");
  if (!rows.length) list.append(el("p", "ladder-empty", "Nobody has published yet."));
  for (const row of rows) {
    const rung = el("a", "ladder-row");
    rung.href = playerHref(row.user);
    rung.append(
      el("span", "ladder-rank", String(row.rank)),
      el("span", `ladder-shell ladder-shell-${shellOf(row.user)}`),
      el("span", "ladder-name", `@${row.user}`),
      el("span", "ladder-points", `${row.points} PTS`),
    );
    list.append(rung);
  }
  box.append(list);
  return box;
}

const CATEGORIES = new Set(["race", "challenge", "showcase"]);

/** Who holds this event, at the size a person scans the wall by. */
function leaderLine(event, planned, rows) {
  const line = el("p", "flyer-leader");
  if (planned) {
    line.append(el("span", "flyer-leader-name", "course not built yet"));
    return line;
  }
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

/** One event on the wall: its still, who holds it, and what it is. */
export function flyer(event, rows) {
  const planned = event.status === "planned";
  const known = CATEGORIES.has(event.category);
  const classes = ["challenge-note", "fx-shadow-card"];
  // An unrecognised category keeps the neutral ink shadow the base rule sets,
  // rather than borrowing another category's colour.
  if (known) classes.push(`challenge-note--${event.category}`);
  if (planned) classes.push("challenge-note--planned");
  const note = el("article", classes.join(" "));
  note.append(el("span", "flyer-tape"));
  if (event.vote && !planned) {
    note.append(voteButton(event, { variant: "sticker" }));
  }
  const link = el(planned ? "div" : "a", "challenge-link");
  if (!planned) link.href = raceHref(event.id);
  const facts = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");
  link.append(el("div", "challenge-art"));
  if (known) link.append(el("span", "eyebrow", event.category.toUpperCase()));
  link.append(
    leaderLine(event, planned, rows),
    el("h4", "flyer-title", event.title),
    el("p", "challenge-facts", facts),
  );
  note.append(link);
  return note;
}

/**
 * The front's cover: the mark at hero size on deep ink, the duck beside it.
 * No strip — the strip's job is to be the way back to the front, and this IS
 * the front. Who you are is not up here: a chip in the corner of a cover is
 * the strip again in miniature, and it is `playerCard` below instead.
 */
export function masthead(me, standing) {
  const head = document.createElement("header");
  head.className = "masthead fx-ray-fan";
  const row = el("div", "masthead-row");
  const lockup = el("div", "masthead-lockup");
  // The duck leads, the mark follows — the head reads as the badge on the
  // title rather than as a mascot trailing after it.
  lockup.append(duckHead({ quacks: true }), wordmark({ variant: "cover" }));
  const nav = document.createElement("nav");
  nav.className = "masthead-player";
  nav.setAttribute("aria-label", "Player");
  nav.append(playerCard(me, standing));
  // The mark first in the DOM, so the heading is announced before the handle;
  // the row puts them on one line with the locker pushed to the right.
  row.append(lockup, nav);
  head.append(row);
  return head;
}

/**
 * Who you are, beside the hero, at a size you can read across the room.
 *
 * Signed in: your picture and your handle, linking to your page. Signed out:
 * the charter's one orange button per section, which is the way in. `me` is
 * null when /api/me could not be reached, and then the box is empty — a
 * sign-in link to a server that is not answering is worse than a blank.
 */
export function playerCard(me, standing) {
  const box = el("div", "player-card");
  if (!me) return box;
  if (!me.signed_in) {
    const link = el("a", "player-card-in fx-shadow-card");
    link.href = signInHref();
    link.append(
      el("span", "player-card-glyph", "\u{1F986}"),
      el("span", "player-card-name", "Sign in"),
      el("span", "player-card-score", "with Hugging Face"),
    );
    box.append(link);
    return box;
  }
  const link = el("a", "player-card-you fx-shadow-card");
  link.href = playerHref(me.user);
  link.append(avatar(me.user), el("span", "player-card-name", me.user));
  // The score only exists once you have published something. Saying "0 PTS"
  // to someone who has not raced yet is a scoreline about nothing.
  if (standing) {
    link.append(el("span", "player-card-score", `#${standing.rank} \u00b7 ${standing.points} PTS`));
  }
  box.append(link);
  return box;
}

/**
 * Grain over the WHOLE window, not just the column.
 *
 * Fixed rather than laid out, so the cover and the band carry it too — hanging
 * it on `.hall` stopped it at the content column. It is the first child of the
 * view, so leaving the page takes it away with everything else.
 *
 * Grain only: the charter pairs it with scanlines, but over a page of paper
 * and text the lines read as a fault rather than as a screen, and they were
 * asked for off here.
 */
export function pageTexture() {
  const skin = el("div", "page-fx fx-grain");
  skin.setAttribute("aria-hidden", "true");
  return skin;
}

const FLOCK_LINKS = [
  ["Discover Microduck", MICRODUCK],
  ["Buy Microduck", STORE],
  ["Join the flock", FLOCK, "discord"],
  ["Create policies", MICRODUCK_RL],
];

/** Discord's own mark, in ink. Drawn inline so the strip needs no request. */
function discordMark() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "flock-mark");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.198.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z");
  svg.append(path);
  return svg;
}

/**
 * The yellow band under the cover, as the charter draws it: ink on yellow,
 * separated by stars. It stands still — the scrolling version of this was
 * taken off the page on purpose.
 */
export function flockBand() {
  const band = document.createElement("div");
  band.className = "flock-band";
  const row = el("div", "flock-band-row");
  FLOCK_LINKS.forEach(([text, href, mark], i) => {
    if (i) row.append(el("span", "flock-star", "★"));
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    if (mark === "discord") link.append(discordMark());
    link.append(document.createTextNode(text));
    row.append(link);
  });
  band.append(row);
  return band;
}

/** A slanted rule between chapters, tilting the other way each time. */
export function chapterRule(index) {
  const rule = el("div", `chapter-rule chapter-rule--${index % 2 ? "right" : "left"}`);
  rule.setAttribute("aria-hidden", "true");
  return rule;
}

export async function renderHome(root) {
  const [events, standings, me] = await Promise.all([getEvents(), getStandings(), getMe()]);
  // Your own rung, for the card up top. The REAL standings, never the padded
  // ones — a demo rank beside your name would be a score you did not earn.
  const mine = me?.signed_in ? standings.find((row) => row.user === me.user) : undefined;
  root.replaceChildren(pageTexture(), masthead(me, mine), flockBand());
  const hall = el("main", "hall");
  root.append(hall);

  // The pitch and the season are ONE chapter: what this is, on the left, and
  // who is winning it, on the right. They were two, and a rule between them
  // divided a thing from its own scoreboard.
  const door = el("section", "door fx-grain");

  const pitch = el("div", "door-pitch");
  pitch.append(
    el("p", "eyebrow", "Official competition"),
    el("h2", "hero", "The pinnacle of Microducks athletics."),
    el(
      "p",
      "lede",
      "Train, submit, compete, repeat.",
    ),
  );
  const meet = el("div", "door-meet");
  meet.append(duckHead());
  pitch.append(meet);

  const board = el("div", "door-board");
  const rungs = demoRows(standings);
  board.append(el("h3", "eyebrow", "Season standings"), ladder(rungs));
  // Say so, loudly, whenever a row on screen was invented. A placeholder that
  // looks like a person is how a screenshot becomes a lie.
  if (rungs.length !== standings.length) {
    board.append(el("p", "demo-note", `${rungs.length - standings.length} placeholder rows — not on the live board`));
  }

  door.append(pitch, board);
  // No rule above it: the band runs flush under the yellow strip, whose own
  // bottom border is the line there. A rule plus the hall's top padding put a
  // stripe of bare paper between the two, which was the thing to remove.
  hall.append(door);

  // Only an open event has a board worth asking for.
  const boards = await Promise.all(
    events.map((event) =>
      event.status === "planned"
        ? Promise.resolve({ rows: [] })
        : getLeaderboard(event.id).catch(() => ({ rows: [] })),
    ),
  );
  const rounds = el("section", "chapter");
  const wall = el("div", "cabinets");
  const flyers = events.map((event, i) => flyer(event, boards[i].rows));
  wall.append(...flyers);
  rounds.append(el("h3", "eyebrow", "Pick your round"), wall);
  hall.append(chapterRule(0), rounds);

  // After the wall is on screen: the stills replace the dark frames as they
  // arrive, rather than holding the whole page for WebGL and a 1.3 MB GLB.
  const stills = await renderThumbnails(events);
  events.forEach((event, i) => {
    const url = stills.get(event.id);
    if (!url) return; // no WebGL, or this rig failed — the frame stays dark
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    flyers[i].querySelector(".challenge-art").replaceChildren(img);
  });
}
