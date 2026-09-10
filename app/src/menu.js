// The race programme: every event, with the time that currently stands.
//
// A fixture list rather than a row of cards. Each line carries what makes one
// race different from another and who holds it — the standing record is the
// reason to open a race, so it belongs on the way in.

import { getEvents, getLeaderboard } from "./api.js";
import { formatEventFacts, formatScore } from "./format.js";
import { raceHref } from "./router.js";
import { wordmark } from "./wordmark.js";

// The rules of the competition, repeated the way a cabinet's marquee repeats
// them. Content, not filler: these three sentences are what makes a time here
// worth comparing to another.
const MARQUEE = [
  "Five perturbed starts per entry",
  "The server does the timing",
  "Nothing is published until you say so",
];

function marquee() {
  const box = document.createElement("div");
  box.className = "marquee";
  const track = document.createElement("div");
  track.className = "marquee__track";
  // Twice through, so the translate can loop at -50% with no visible seam.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const phrase of MARQUEE) {
      const run = document.createElement("span");
      run.className = "marquee__run";
      const text = document.createElement("b");
      text.textContent = phrase;
      const star = document.createElement("span");
      star.className = "marquee__star";
      star.textContent = "\u2605";
      run.append(text, star);
      track.append(run);
    }
  }
  box.append(track);
  return box;
}

export async function renderMenu(root) {
  root.innerHTML = "";
  const header = document.createElement("header");
  header.className = "hero";
  header.append(wordmark());
  const blurb = document.createElement("p");
  blurb.className = "hero__blurb";
  blurb.textContent =
    "Enter a policy in a race. It runs on our clock, over five perturbed starts, and the time you get is the time everyone gets.";
  header.append(blurb);
  root.append(header);
  root.append(marquee());

  const list = document.createElement("ul");
  list.className = "programme";
  root.append(list);

  const events = await getEvents();
  const boards = await Promise.all(
    events.map((event) => getLeaderboard(event.id).catch(() => ({ rows: [] }))),
  );

  events.forEach((event, i) => {
    const rows = boards[i].rows;
    const leader = rows.find((row) => row.seeds_finished > 0);

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "fixture";
    link.href = raceHref(event.id);

    const name = document.createElement("span");
    name.className = "fixture__name";
    name.textContent = event.title;

    const spec = document.createElement("span");
    spec.className = "fixture__spec";
    spec.textContent = formatEventFacts(event)
      .filter((fact) => fact.label !== "commanded")
      .map((fact) => fact.value)
      .join(", ");

    const standing = document.createElement("span");
    standing.className = "fixture__standing";
    if (leader) {
      const time = document.createElement("span");
      time.className = "fixture__time";
      time.textContent = formatScore(leader.score, { finished: leader.seeds_finished });
      const who = document.createElement("span");
      who.className = "fixture__who";
      who.textContent = leader.policy_name;
      standing.append(time, who);
    } else {
      // An empty race is an invitation, not a blank.
      standing.className += " fixture__standing--open";
      const star = document.createElement("img");
      star.src = "/star-yellow.webp";
      star.alt = "";
      const words = document.createElement("span");
      words.textContent = rows.length ? "no finisher yet" : "be the first";
      standing.append(star, words);
    }

    link.append(name, spec, standing);
    item.append(link);
    list.append(item);
  });
}
