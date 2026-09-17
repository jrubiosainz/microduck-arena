// Points as a shower of stars: one ✦ per point, born around whatever earned
// them, flown to the player chip, and the chip's counter rolled up once they
// have all landed.
//
// Same idiom as the rest of the theatre: race.css owns every duration
// (star-in, star-fly), the JS sequences on animation events, and an
// AbortSignal ends any wait early. Sounds come in clusters, not per star — a
// +250 is two hundred and fifty stars, and that many pops is a wall of noise.

import { ended, flipTiles, rollCounter } from "./animation.js";
import { followCounter, play } from "./sound.js";

const SPAWN_MS = 300; // the whole shower is born within this
const WAIT_MS = 500; // each star lingers this long…
const WAIT_SPREAD_MS = 1000; // …plus up to this much, at random
const MARGIN_PX = 40; // how far around the source a star can be born
const CHORUS_MS = 40; // at most one cue per this, per cue

/**
 * Where each star is born, how long it waits and where it flies. Pure, so it
 * is testable: `from` and `to` are DOMRect-shaped, `random` is injectable.
 */
export function plan(count, from, to, random = Math.random) {
  const cx = to.left + to.width / 2;
  const cy = to.top + to.height / 2;
  return Array.from({ length: count }, (_, i) => {
    const x = from.left - MARGIN_PX + random() * (from.width + 2 * MARGIN_PX);
    const y = from.top - MARGIN_PX + random() * (from.height + 2 * MARGIN_PX);
    return {
      x,
      y,
      dx: cx - x,
      dy: cy - y,
      spawn: (i * SPAWN_MS) / count,
      wait: WAIT_MS + random() * WAIT_SPREAD_MS,
    };
  });
}

const lastCue = new Map();

/** One cue per cluster: a star that pops or lands within CHORUS_MS of the last is silent. */
function chorus(name) {
  const now = performance.now();
  if (now - (lastCue.get(name) ?? -Infinity) < CHORUS_MS) return;
  lastCue.set(name, now);
  play(name);
}

/**
 * Rain `count` stars from around `source` onto `chip`. Resolves once every
 * star has landed, or at once when the signal aborts; the stars are gone
 * either way.
 */
export async function shower(source, chip, count, signal) {
  if (!count || signal?.aborted) return;
  const overlay = document.createElement("div");
  overlay.className = "shower";
  overlay.setAttribute("aria-hidden", "true");
  const stars = plan(count, source.getBoundingClientRect(), chip.getBoundingClientRect()).map(
    (star) => {
      const node = document.createElement("span");
      node.className = "star";
      node.style.setProperty("--x", `${star.x}px`);
      node.style.setProperty("--y", `${star.y}px`);
      node.style.setProperty("--dx", `${star.dx}px`);
      node.style.setProperty("--dy", `${star.dy}px`);
      node.style.setProperty("--spawn", `${star.spawn}ms`);
      node.style.setProperty("--wait", `${star.wait}ms`);
      const glyph = document.createElement("span");
      glyph.textContent = "✦";
      node.append(glyph);
      return node;
    },
  );
  // The glyph pops (star-in) and the star flies (star-fly); both events bubble
  // here, so one listener each serves the whole shower.
  overlay.addEventListener("animationstart", (event) => {
    if (event.animationName === "star-in") chorus("press");
  });
  overlay.addEventListener("animationend", (event) => {
    if (event.animationName !== "star-fly") return;
    chorus("tick");
    event.target.remove();
  });
  overlay.append(...stars);
  document.body.append(overlay);
  try {
    await Promise.all(stars.map((star) => ended(star, "star-fly", "", signal)));
  } finally {
    overlay.remove();
  }
}

/** Roll the chip's counter up by `points`, with the counter's own ticks and a jolt. */
export async function credit(chip, points, signal) {
  const flip = chip.querySelector(".flip");
  if (!flip || !points || signal?.aborted) return;
  const shown = Number([...flip.querySelectorAll(".flip-digit")].map((t) => t.textContent).join(""));
  // The total is in the DOM before the roll, as every counter in the theatre.
  flip.replaceChildren(...flipTiles((shown || 0) + points));
  const silence = followCounter(flip.querySelector(".flip-digit"));
  chip.classList.add("jolt");
  try {
    await Promise.all([ended(chip, "jolt", "", signal), rollCounter(flip, signal)]);
  } finally {
    silence();
    chip.classList.remove("jolt");
  }
}
