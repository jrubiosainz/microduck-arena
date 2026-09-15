// The club's front: who is ahead this season, and which round to pick.
//
// The ladder ranks PEOPLE by the points their publications earned; the flyers
// are the events, each carrying the course, its facts and who holds it. The
// race pages behind the flyers are unchanged — this page is the way in.

import { getEvents, getLeaderboard, getMe, getStandings } from "./api.js";
import { formatEventFacts, formatScore } from "./format.js";
import { playerHref, raceHref } from "./router.js";
import { signage } from "./signage.js";
import { renderThumbnails } from "./thumbnail.js";

const SHELLS = ["cream", "graphite", "lavender", "sky"];
const LADDER_ROWS = 10;

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

export function ladder(rows) {
  const box = el("div", "ladders");
  const list = el("div", "ladder");
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

function standingLine(planned, rows) {
  const line = el("p", "challenge-standing");
  if (planned) {
    line.textContent = "course not built yet";
    return line;
  }
  const star = el("img", "challenge-star");
  star.src = "/star-yellow.webp";
  star.alt = "";
  const leader = rows.find((row) => row.seeds_finished > 0);
  if (leader) {
    line.append(
      star,
      el("span", null, leader.user),
      el("span", null, formatScore(leader.score, { finished: leader.seeds_finished })),
    );
  } else {
    line.append(star, el("span", null, rows.length ? "no finisher yet" : "be the first"));
  }
  return line;
}

/** One event on the wall: its course, its facts, and the time that stands on it. */
export function flyer(event, rows) {
  const planned = event.status === "planned";
  const note = el("article", planned ? "challenge-note challenge-note--planned" : "challenge-note");
  note.append(el("span", "flyer-tape"));
  const link = el(planned ? "div" : "a", "challenge-link");
  if (!planned) link.href = raceHref(event.id);
  const facts = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");
  link.append(
    el("span", "eyebrow", "Race"),
    el("h4", "flyer-title", event.title),
    el("div", "challenge-art"),
    el("p", "challenge-facts", facts),
    standingLine(planned, rows),
  );
  note.append(link);
  return note;
}

export async function renderHome(root) {
  const [events, standings, me] = await Promise.all([getEvents(), getStandings(), getMe()]);
  root.replaceChildren(signage(me));
  const hall = el("main", "hall");
  root.append(hall);

  const door = el("section", "door");
  door.append(
    el("p", "eyebrow", "The microduck arena"),
    el("h2", "hero", "Race on a clock you can trust."),
    el(
      "p",
      "lede",
      "Enter a policy in a race. It runs on our clock, over five perturbed starts, and the time you get is the time everyone gets.",
    ),
  );
  hall.append(door);

  const season = el("section", "chapter");
  season.append(el("h3", "eyebrow", "Season standings"), ladder(standings.slice(0, LADDER_ROWS)));
  hall.append(season);

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
  hall.append(rounds);

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
