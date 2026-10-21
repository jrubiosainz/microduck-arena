// One weekly cup. Before the show: when it closes and airs, a countdown, the field by rating and how to
// enter. From the show: the champion, the groups and the knockout, as far as they have aired.
//
// Only what the API's view of the cup says is drawn, never what could be worked out from it: a knockout
// pair arrives once the round before it has aired, a result once its clip has.

import { flipTiles } from "./animation.js";
import { getCup, getMe } from "./api.js";
import { countdown, formatScore } from "./format.js";
import { cupHref, dress, eventGuideHref, liveHref, matchHref, playerHref } from "./router.js";
import { chequer, footer, settleIdentity, signage } from "./signage.js";
import { symbol } from "./symbols.js";

// How often the page asks again while the show airs, or while a show past its time has not started.
const REFRESH_MS = 15000;

const PILLS = {
  open: ["Entries open", "sticker sticker-lime"],
  drawn: ["Entries closed", "sticker"],
  ready: ["Ready", "sticker sticker-cyan"],
  airing: ["Live now", "sticker sticker-magenta"],
  aired: ["Finished", "sticker"],
  skipped: ["No cup", "sticker"],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href, className, text) {
  const node = el("a", className, text);
  node.href = href;
  return node;
}

/** When the countdown ends, in ms: the close while entries are open, then the show's start; null once it is on. */
function countdownEnd(cup) {
  if (cup.state === "open") return Date.parse(cup.close_at);
  if (cup.state === "drawn" || cup.state === "ready") return Date.parse(cup.starts_at ?? cup.premiere_at);
  return null;
}

function setClock(node, left) {
  node.replaceChildren(...(left > 0 ? flipTiles(countdown(left)) : ["Starting soon"]));
}

const when = (iso) => new Date(iso).toLocaleString("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
});

function head(cup) {
  const box = el("header", "cup-head");
  const title = el("div", "cup-title");
  title.append(el("p", "eyebrow", cup.event.title), el("h2", "marquee-title", `${cup.event.title} Cup #${cup.number}`));
  const [pill, look] = PILLS[cup.state];
  box.append(title, el("span", `${look} cup-pill`, pill));
  const nav = el("nav", "cup-nav");
  if (cup.number > 1) nav.append(link(cupHref(cup.event.id, cup.number - 1), "cup-prev", `Cup #${cup.number - 1}`));
  if (cup.number < cup.open) nav.append(link(cupHref(cup.event.id, cup.number + 1), "cup-next", `Cup #${cup.number + 1}`));
  if (nav.children.length) box.append(nav);
  return box;
}

/** Before the show: when, how long until, and while entries are open, how to enter; beside it, who is in. */
function field(cup, nowMs) {
  const intro = el("div", "cup-intro");
  const premiere = `Premiere on the live channel ${when(cup.starts_at ?? cup.premiere_at)}`;
  intro.append(el("p", "cup-when", cup.state === "open" ? `Entries close ${when(cup.close_at)} · ${premiere}` : premiere));
  const left = countdownEnd(cup) - nowMs;
  const board = el("div", "scoreboard cup-clock");
  const clock = el("span", "flip cup-countdown");
  setClock(clock, left);
  board.append(clock);
  if (left > 0) board.append(el("span", "mono-label cup-until", cup.state === "open" ? "until entries close" : "until the premiere"));
  intro.append(board);
  if (cup.state === "open") {
    const enter = el("p", "cup-enter", "How to enter: ");
    enter.append(
      link(eventGuideHref(cup.event.id), null, `train on the ${cup.event.id} challenge`),
      ", then ", el("code", null, "uv run publish --enter"), ". Your latest entry is the one that counts.",
    );
    intro.append(enter);
  }

  const entered = el("div", "cup-entered");
  const count = cup.entrants.length;
  entered.append(el("h3", "eyebrow", count ? `${count} duck${count === 1 ? "" : "s"} entered` : "No duck entered yet"));
  if (count) {
    const list = el("ol", "cup-field");
    cup.entrants.forEach((entrant, i) => {
      const row = el("li", "cup-entrant");
      row.append(
        el("span", "cup-rank", String(i + 1)),
        link(playerHref(entrant.user), "cup-handle", `@${entrant.user}`),
        el("span", "cup-policy", entrant.policy_name),
        el("span", "cup-rating", formatScore(entrant.rating, { metric: cup.event.metric })),
      );
      list.append(row);
    });
    entered.append(list);
  }

  const box = el("section", "cup-before");
  box.append(intro, entered);
  return box;
}

/** A duck as the page names it: its policy's name, its player's handle small beside it. */
function duck(entrant) {
  const name = el("span", "cup-duck");
  name.append(el("span", null, entrant.policy_name), el("small", null, `@${entrant.user}`));
  return name;
}

function champion(cup) {
  const final = cup.matches[cup.matches.length - 1];
  const winner = cup.entrants[cup.champion];
  const loser = cup.entrants[final.winner === final.a ? final.b : final.a];
  const [won, lost] = final.winner === final.a ? final.wins : [...final.wins].reverse();
  const by = final.decided_by === "rating" ? "on rating" : `${won}–${lost}`;
  const words = el("span", null, `Champion: @${winner.user} · `);
  words.append(el("b", null, winner.policy_name), `, beat @${loser.user} ${by} in the final`);
  const banner = el("p", "cup-champion");
  banner.append(symbol("emoji_events"), words);
  return banner;
}

/** A revealed group match, as one line to its page. */
function result(cup, match) {
  const name = (i) => el(i === match.winner ? "b" : "span", null, cup.entrants[i].policy_name);
  const line = link(matchHref(match.match_id), "cup-result", "▶ ");
  line.append(name(match.a), ` ${match.wins[0]}–${match.wins[1]} `, name(match.b));
  if (match.decided_by === "rating") line.append(" · on rating");
  return line;
}

function groups(cup) {
  const box = el("div", "cup-groups");
  for (const group of cup.groups) {
    const card = el("div", "cup-group");
    const table = el("table");
    table.append(el("caption", "eyebrow", `Group ${group.name}`));
    const header = el("tr");
    header.append(...["Duck", "P", "W–L", "Bouts"].map((word) => el("th", null, word)));
    table.append(header);
    group.table.forEach((row, i) => {
      // The top two go through to the knockout.
      const line = el("tr", i < 2 ? "cup-q" : null);
      const cell = el("td");
      cell.append(duck(cup.entrants[row.entrant]));
      line.append(cell, el("td", null, String(row.played)), el("td", null, `${row.won}–${row.lost}`),
        el("td", null, `${row.bouts_for}–${row.bouts_against}`));
      table.append(line);
    });
    card.append(table);
    const played = cup.matches.filter((m) => m.group === group.name && m.wins);
    if (played.length) {
      const results = el("div", "cup-results");
      results.append(...played.map((m) => result(cup, m)));
      card.append(results);
    }
    box.append(card);
  }
  return box;
}

/** A knockout match: nobody yet, then its pair, then its score and the way to its page. */
function tie(cup, match) {
  const box = el("div", "cup-tie");
  if (match.a == null) {
    box.append(el("span", "cup-tbd", "To be decided"));
    return box;
  }
  [match.a, match.b].forEach((i, side) => {
    const row = el("div", i === match.winner ? "cup-side cup-won" : "cup-side");
    row.append(duck(cup.entrants[i]));
    if (match.wins) row.append(el("span", "cup-wins", String(match.wins[side])));
    box.append(row);
  });
  if (match.wins) {
    const play = link(matchHref(match.match_id), "cup-play", "▶");
    play.setAttribute("aria-label", `Watch ${match.title}`);
    box.append(play);
  }
  return box;
}

function bracket(cup) {
  const box = el("div", "cup-bracket");
  const knockout = cup.matches.filter((m) => !m.group);
  for (const round of new Set(knockout.map((m) => m.round))) {
    const ties = el("div", "cup-ties");
    ties.append(...knockout.filter((m) => m.round === round).map((m) => tie(cup, m)));
    const column = el("div", "cup-round");
    column.append(el("h4", "eyebrow", round[0].toUpperCase() + round.slice(1)), ties);
    box.append(column);
  }
  return box;
}

function show(cup) {
  const box = el("section", "cup-show");
  if (cup.state === "airing") box.append(link(liveHref, "sticker sticker-magenta cup-live", "Watch it live"));
  if (cup.champion != null) box.append(champion(cup));
  box.append(el("h3", "eyebrow", "Groups · the top two go through"), groups(cup),
    el("h3", "eyebrow", "Knockout"), bracket(cup));
  return box;
}

/** The page for one cup as the API tells it at `nowMs`. */
export function cupPage(cup, nowMs) {
  const page = el("div", "cup");
  page.append(head(cup));
  if (cup.state === "skipped") {
    page.append(el("p", "lede", `No cup this week: fewer than ${cup.min_entrants} ducks entered.`));
  } else if (cup.state === "airing" || cup.state === "aired") {
    page.append(show(cup));
  } else {
    page.append(field(cup, nowMs));
  }
  return page;
}

/**
 * Draw cup `number` of `eventId`, then keep it current: the countdown moves every second and asks again at
 * zero; a show on air, or late, is asked for every 15 s.
 */
export async function renderCup(root, eventId, number, state) {
  const identity = getMe();
  let cup = await getCup(eventId, number);
  // The sheet goes on with the first element, as a player's page does.
  dress("cup");
  root.replaceChildren(signage(undefined), chequer("page-checker"));
  const hall = el("main", "hall hall--warm");
  root.append(hall, footer());

  const leaving = new AbortController();
  let timer = null;
  state.teardown = () => {
    leaving.abort();
    clearTimeout(timer);
  };
  async function refresh() {
    cup = await getCup(eventId, number).catch(() => cup);
    if (!leaving.signal.aborted) draw();
  }
  function draw() {
    hall.replaceChildren(cupPage(cup, Date.now()));
    const end = countdownEnd(cup);
    if (cup.state === "airing" || (end != null && end <= Date.now())) {
      timer = setTimeout(refresh, REFRESH_MS);
    } else if (end != null) {
      const clock = hall.querySelector(".cup-countdown");
      // Each tick lands as the second shown changes.
      const tick = () => {
        const left = end - Date.now();
        if (left <= 0) return refresh();
        setClock(clock, left);
        timer = setTimeout(tick, left % 1000 || 1000);
      };
      timer = setTimeout(tick, (end - Date.now()) % 1000 || 1000);
    }
  }
  draw();
  settleIdentity(root, await identity);
}

/** What a versus card's corner says: the cup on now or next, and how soon. */
export function cupCorner(eventId, { next, cups }, nowMs) {
  const cup = cups.find((c) => ["drawn", "ready", "airing"].includes(c.state)) ?? next;
  return { text: `Cup #${cup.number} · ${soon(cup, nowMs)}`, href: cupHref(eventId, cup.number) };
}

function soon(cup, nowMs) {
  if (cup.state === "airing") return "live now";
  const minutes = Math.ceil((Date.parse(cup.starts_at ?? cup.premiere_at) - nowMs) / 60000);
  if (minutes <= 0) return "starting soon";
  const [days, hours, rest] = [Math.floor(minutes / 1440), Math.floor(minutes / 60) % 24, minutes % 60];
  if (days) return `in ${days}d ${hours}h`;
  return hours ? `in ${hours}h ${rest}m` : `in ${rest}m`;
}
