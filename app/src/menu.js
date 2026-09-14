// The race programme: every event, as a card.
//
// A grid rather than a fixture list. Each card carries a drawing of its own
// course, what makes it different, and who holds it — the standing record is
// the reason to open a race, so it belongs on the way in.
//
// Planned events are on the grid too, and marked. They have a course file and
// a page, but their physics is still the sprint's, so the engine refuses to
// race them: a time recorded under one of their names would be a sprint time
// wearing it.

import { getEvents, getLeaderboard } from "./api.js";
import { courseArt } from "./coursecard.js";
import { renderThumbnails } from "./thumbnail.js";
import { formatEventFacts, formatScore } from "./format.js";
import { raceHref } from "./router.js";
import { duckHead, wordmark } from "./wordmark.js";

export async function renderMenu(root) {
  root.innerHTML = "";
  const header = document.createElement("header");
  header.className = "hero";
  const top = document.createElement("div");
  top.className = "hero__top";
  top.append(wordmark(), duckHead());
  header.append(top);
  const blurb = document.createElement("p");
  blurb.className = "hero__blurb";
  blurb.textContent =
    "Enter a policy in a race. It runs on our clock, over five perturbed starts, and the time you get is the time everyone gets.";
  header.append(blurb);
  root.append(header);

  const grid = document.createElement("ul");
  grid.className = "programme";
  root.append(grid);

  const events = await getEvents();
  // Only an open event has a board worth asking for. A planned one would
  // answer with an empty list, at the cost of a request per card.
  const boards = await Promise.all(
    events.map((event) =>
      event.status === "planned"
        ? Promise.resolve({ rows: [] })
        : getLeaderboard(event.id).catch(() => ({ rows: [] })),
    ),
  );

  const cards = events.map((event, i) => {
    const el = card(event, boards[i].rows);
    grid.append(el);
    return el;
  });

  // Rendered AFTER the grid is on screen, not before: the cards appear with
  // their diagrams immediately and the stills replace them when they are ready.
  // Waiting on WebGL and a 1.3 MB GLB before showing anything would trade a
  // whole page for a picture.
  const stills = await renderThumbnails(events);
  events.forEach((event, i) => {
    const url = stills.get(event.id);
    if (!url) return; // no WebGL, or this rig failed — the diagram stands
    const frame = cards[i].querySelector(".card__frame");
    const img = document.createElement("img");
    img.className = "card__art";
    img.src = url;
    img.alt = "";
    frame.replaceChildren(img);
  });
}

/** One programme card: its course, its name, and the time that stands on it. */
export function card(event, rows) {
  const planned = event.status === "planned";
  const leader = rows.find((row) => row.seeds_finished > 0);

  const item = document.createElement("li");
  const box = document.createElement(planned ? "div" : "a");
  box.className = planned ? "card card--planned" : "card";
  if (!planned) box.href = raceHref(event.id);

  const art = document.createElement("div");
  art.className = "card__frame";
  art.innerHTML = courseArt(event);

  const name = document.createElement("h3");
  name.className = "card__name";
  name.textContent = event.title;

  const spec = document.createElement("p");
  spec.className = "card__spec";
  spec.textContent = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");

  const standing = document.createElement("p");
  standing.className = "card__standing";
  if (planned) {
    // Said plainly on the card, not only in a tooltip: the reason this one
    // cannot be entered is that its course does not exist yet.
    standing.className += " card__standing--planned";
    standing.textContent = "course not built yet";
  } else if (leader) {
    const star = document.createElement("img");
    star.src = "/star-yellow.webp";
    star.alt = "";
    star.className = "card__star";
    const who = document.createElement("span");
    who.className = "card__who";
    who.textContent = leader.user;
    const time = document.createElement("span");
    time.className = "card__time";
    time.textContent = formatScore(leader.score, { finished: leader.seeds_finished });
    standing.append(star, who, time);
  } else {
    // An empty race is an invitation, not a blank.
    standing.className += " card__standing--open";
    const star = document.createElement("img");
    star.src = "/star-yellow.webp";
    star.alt = "";
    star.className = "card__star";
    const words = document.createElement("span");
    words.textContent = rows.length ? "no finisher yet" : "be the first";
    standing.append(star, words);
  }

  box.append(art, name, spec, standing);
  item.append(box);
  return item;
}
