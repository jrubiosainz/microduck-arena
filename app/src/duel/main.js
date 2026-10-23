// The duel's page: the match `arena duel A B --watch` has just played
// (arena/duel_watch.py), bout by bout, in the Arena's own stadium — the hall,
// the stands and their crowd, the jury on its dais — round the duel's decks and
// pit (duel-venue.js). The server answers only what it played: the page reads
// the match once, fetches each bout's frames as it comes to it, and plays the
// bouts in their order, the next a moment after the last has ended, until the
// visitor picks one or pauses.

import { MIN } from "../brightness.js";
import { followKeyFor, offerOrbit, wireDeck } from "../deck.js";
import { splitDucks } from "../replay.js";
import { footer } from "../signage.js";
import { createViewer, PLATE_HEIGHT, PLATE_LIFT } from "../viewer.js";
import { el } from "../workshop/dom.js";
import { boutClock, boutEvent, boutLanes, boutTimes, verdict } from "./bouts.js";
import { duelHall, strip } from "./hall.js";

// How long a finished bout's last frame holds before the next bout plays.
const NEXT_MS = 2500;
// The stamp's centre across the picture, as a fraction of its width, kept this
// far in from either side so a stamp over a duck at the edge stays whole.
const STAMP_INSET = 0.2;
// The stamp's foot, in metres above the winner's trunk: 4 cm clear of the top of
// the nameplate floating over it, so the stamp leaves the winner's name and head
// in view. Kept between these fractions of the picture's height, so its top
// never leaves the picture nor its foot sinks into the pit; and its top this
// many pixels under the clock's and the verdict's feet, which on a phone's short
// picture reach down to a winner that has lunged back to the picture's edge.
const STAMP_LIFT = PLATE_LIFT + PLATE_HEIGHT / 2 + 0.04;
const STAMP_FOOT = [0.25, 0.7];
const STAMP_CLEAR = 6;

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

async function failed(response) {
  return new Error((await response.text()).trim() || `${response.status} ${response.statusText}`);
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw await failed(response);
  return response.json();
}

/** A bout's settle or trace, one per deck: little-endian float32, deck 0's frames, then deck 1's. */
async function frames(path) {
  const response = await fetch(path);
  if (!response.ok) throw await failed(response);
  return splitDucks(new Float32Array(await response.arrayBuffer()), Number(response.headers.get("X-Duck-Count")));
}

async function main() {
  const root = document.querySelector("#app");
  let summary;
  try {
    summary = await json("/api/duel");
  } catch (error) {
    root.replaceChildren(el("p", "failed", `The duel's server did not answer (${error.message}). `
      + "This page shows a match that arena duel A.onnx B.onnx --watch has played."));
    return;
  }
  document.title = `${summary.names.join(" v ")} · Microduck duel`;
  const { hall, parts } = duelHall(summary);
  root.replaceChildren(strip(), hall, footer());

  const viewer = await createViewer(hall.querySelector("#stage"), { rig: summary.rig, onChaseChange: followKeyFor(hall) });
  viewer.setBrightness(MIN); // as the Arena's race page
  wireDeck(hall, viewer);
  offerOrbit(hall, viewer);

  const loads = new Map();
  function load(k) {
    if (!loads.has(k)) {
      const loading = Promise.all([frames(`/api/duel/bouts/${k}/settle`), frames(`/api/duel/bouts/${k}/trace`)]);
      // A load that failed is tried again when the bout is next asked for.
      loading.catch(() => loads.delete(k));
      loads.set(k, loading);
    }
    return loads.get(k);
  }

  let current = -1;
  let asked = 0; // the latest show(): an older one that loads late plays nothing
  let next = null; // the timer that plays the next bout
  let held = false; // paused by the visitor, who then says when the match goes on
  let decided = null;

  function wait() {
    clearTimeout(next);
    next = null;
  }

  async function show(k) {
    const mine = ++asked;
    wait();
    let settles, traces;
    try {
      [settles, traces] = await load(k);
    } catch (error) {
      if (mine === asked) {
        parts.line.textContent = `Bout ${k + 1} did not load: ${error.message}`;
        parts.line.hidden = false;
      }
      return;
    }
    if (mine !== asked) return;
    current = k;
    held = false;
    decided = null;
    const lanes = boutLanes(summary, k, settles, traces);
    viewer.setLanes(lanes, boutEvent(summary, k, lanes), { loop: false });
    const bout = summary.bouts[k];
    parts.clockLabel.textContent = `Bout ${k + 1} of ${summary.bouts.length} · seed ${bout.seed}`;
    parts.bouts.forEach((button, b) => button.setAttribute("aria-current", String(b === k)));
    if (k + 1 < summary.bouts.length) load(k + 1).catch(() => {});
  }

  /** The stamp and the verdict, once the referee has decided the bout; gone again on a seek back. */
  function call(bout, now) {
    if (now === decided) return;
    decided = now;
    parts.call.hidden = parts.line.hidden = !now;
    if (!now) return;
    const said = verdict(summary, bout);
    parts.stamp.textContent = said.stamp;
    parts.stamp.classList.toggle("stamp-fail", bout.end === "void");
    parts.stamp.style.color = said.colour ?? "";
    parts.line.textContent = said.line;
    // Over the winner where it stands now, wherever the camera has been taken; a draw's where duel.css puts it.
    if (said.deck === null) {
      parts.call.style.left = parts.call.style.top = "";
      return;
    }
    const { x, y } = viewer.spot(said.deck, STAMP_LIFT);
    const picture = parts.stage.getBoundingClientRect();
    const tall = parts.call.getBoundingClientRect().height;
    const under = (part) => (part.getBoundingClientRect().bottom - picture.top + STAMP_CLEAR + tall) / picture.height;
    const low = Math.min(Math.max(STAMP_FOOT[0], under(parts.clock), under(parts.line)), STAMP_FOOT[1]);
    parts.call.style.left = `${100 * clamp(x, [STAMP_INSET, 1 - STAMP_INSET])}%`;
    parts.call.style.top = `${100 * clamp(y, [low, STAMP_FOOT[1]])}%`;
  }

  function watch() {
    const bout = summary.bouts[current];
    if (bout) {
      const { player } = viewer;
      parts.clockTime.textContent = `${boutClock(summary, bout, player.time).toFixed(2)} s`;
      call(bout, player.duration > 0 && player.time >= boutTimes(summary, bout).decided_s);
      const over = !player.playing && player.time >= player.duration;
      parts.pause.textContent = player.playing ? "Pause" : over ? "Play again" : "Play";
      if (over && !held && next === null && current + 1 < summary.bouts.length) {
        next = setTimeout(() => show(current + 1), NEXT_MS);
      }
    }
    requestAnimationFrame(watch);
  }

  parts.bouts.forEach((button, k) => button.addEventListener("click", () => show(k)));
  parts.pause.addEventListener("click", () => {
    const { player } = viewer;
    if (player.playing) {
      player.playing = false;
      held = true;
      wait();
      return;
    }
    if (player.time >= player.duration) player.seek(0);
    held = false;
    player.play();
  });
  parts.replay.addEventListener("click", () => {
    wait();
    held = false;
    viewer.player.seek(0);
    viewer.player.play();
  });

  // For a shell, or a recorder, to take the picture it wants: a bout, and a moment of it.
  window.duel = {
    summary,
    viewer,
    show,
    get bout() {
      return current;
    },
    /** Hold bout `current` at the replay's second `t`, the match's progress stopped with it. */
    hold(t) {
      held = true;
      wait();
      viewer.player.playing = false;
      viewer.player.seek(t);
    },
  };
  await show(0);
  requestAnimationFrame(watch);
}

main();
