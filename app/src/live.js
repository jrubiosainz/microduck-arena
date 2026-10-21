// The channel. One stage every screen composes itself from the grid and the
// shared clock: the clips in a <video>, the booth in three.js, the shutter
// between them. This file owns the DOM, the polling, the sound the browser
// may keep from starting until a click, and the page's states;
// live/channel.js drives the segments from the clock.

import { getLive } from "./api.js";
import { dress, menuHref } from "./router.js";
import { createAmbience } from "./live/ambience.js";
import { createChannel } from "./live/channel.js";
import { createClock } from "./live/clock.js";
import { shouldReload } from "./live/grid.js";
import { createInterlude } from "./live/interlude.js";
import { createReplay } from "./live/replay.js";
import { createShutter } from "./live/shutter.js";
import { createStandby } from "./live/standby.js";
import { createVoice, loadSynth } from "./live/voice.js";
import { isMuted } from "./sound.js";
import { wordmark } from "./wordmark.js";

const POLL_MS = 10_000;
const RECONNECTING_AFTER_MS = 30_000;
const SOUND_WAIT_MS = 1000; // a context not running by then is waiting for the click

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The stage and its chrome, and nothing else on the page. Framed, the same
 * stage is a player on somebody else's page rather than the page itself. */
export function buildStage(root, framed) {
  const page = framed ? el("div", "live live--framed") : el("main", "live");
  page.dataset.liveState = "joining";
  const stage = el("div", "live-stage");
  const bug = el("p", "live-bug", "LIVE");
  const card = el("div", "live-card");
  card.append(wordmark(), el("span", "live-card-word", "OFF AIR"));
  card.hidden = true;
  const join = el("button", "live-join", "JOIN THE LIVE");
  join.type = "button";
  join.hidden = true;
  page.append(stage, bug, card, join);
  // The way back, on the page that IS the channel. Framed, this is a box on
  // the front page and the rest of that page is already the way out.
  if (!framed) {
    const back = el("a", "live-back", "Back to the arena");
    back.href = menuHref;
    page.append(back);
  }
  root.replaceChildren(page);
  return { page, stage, bug, card, join };
}

/**
 * Polls the grid, samples the clock on every answer and hands the grid on.
 * A miss is forgiven for half a minute once the clock is set, since one lost
 * poll is not an outage; before the clock is set, or past that, the page
 * says reconnecting. A poll asked for early takes the place of the one due;
 * paused, the poller asks nothing more until its next poll.
 */
function follow({ api, clock, onGrid, onState }) {
  let timer = null;
  let lastGood = Date.now();
  let stopped = false;
  let paused = false;
  async function poll() {
    clearTimeout(timer);
    paused = false;
    const before = Date.now();
    let grid = null;
    try {
      grid = await api.getLive();
    } catch {
      // A lost poll is a state, not a failure; only the fetch is caught, so
      // anything wrong in what follows stays loud.
    }
    if (stopped) return;
    if (grid) {
      const after = Date.now();
      clock.sample(before, grid.now_ms, after);
      lastGood = after;
      onGrid(grid);
      onState(grid.slots.length ? "live" : "off-air");
    } else if (!clock.ready || Date.now() - lastGood >= RECONNECTING_AFTER_MS) {
      onState("reconnecting");
    }
    if (!paused) timer = setTimeout(poll, POLL_MS);
  }
  const started = poll();
  return {
    started,
    poll,
    pause() {
      paused = true;
      clearTimeout(timer);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * The booth's sound, on one context kept for the page's life. The browser
 * lets the context run at once (a kiosk, OBS), late (a slow device) or only
 * after a click; a refused resume() leaves its promise pending rather than
 * rejecting it, so the promise is not what is waited on: the state is
 * followed, and `ask` is the click's way of resuming with a gesture in hand.
 */
export function openSound(synth) {
  const context = new AudioContext();
  let opened = null;
  const ask = () => context.resume().catch(() => {});
  // Neither a synth that would not load nor a context that was not running is a
  // verdict for the page's life: the attempt is forgotten, so the next ask
  // starts a fresh one.
  const forget = () => { opened = null; };
  return {
    ask,
    get running() {
      return context.state === "running";
    },
    /** The voice and the room tone once the context runs, or null while it does not. */
    open() {
      return (opened ??= (async () => {
        ask();
        while (context.state === "suspended") {
          await new Promise((resolve) => context.addEventListener("statechange", resolve, { once: true }));
        }
        if (context.state !== "running") return null;
        return { context, voice: createVoice(context, await synth()), ambience: await createAmbience(context) };
      })().then((audio) => {
        if (!audio) forget();
        return audio;
      }, (error) => {
        forget();
        throw error;
      }));
    },
    close() {
      context.close();
    },
  };
}

export async function renderLive(root, state, { api = { getLive }, synth = loadSynth, sound: createSound = openSound, framed = false } = {}) {
  // Only the full page wears the channel's sheet. Framed, this is a box on
  // the front page, which is wearing the club's and must keep it.
  if (!framed) dress("live");
  const { page, stage, card, join } = buildStage(root, framed);
  const controller = new AbortController();
  const { signal } = controller;
  // Torn down from the first moment, since the router may leave the page
  // while the booth still loads; each resource joins as it is made.
  const disposers = [];
  const onTeardown = (dispose) => disposers.push(dispose);
  state.teardown = () => {
    controller.abort();
    while (disposers.length) disposers.pop()();
  };
  const setState = (value) => {
    page.dataset.liveState = value;
    card.hidden = value !== "off-air";
  };

  const clock = createClock();
  const shutter = createShutter(stage);
  const replay = createReplay(stage, { onRefused: () => { join.hidden = false; } });
  const standby = createStandby(stage);
  const sound = createSound(synth);
  onTeardown(() => sound.close());
  let audio = null;
  const interlude = await createInterlude(stage, { audio: () => audio });
  if (signal.aborted) {
    interlude.dispose();
    return;
  }
  onTeardown(() => interlude.dispose());
  const channel = createChannel({
    clock, segments: { replay, booth: interlude, standby }, shutter, onState: setState,
    onReload: () => location.reload(),
    gust: () => audio?.voice.gust(audio.context.currentTime),
  });
  onTeardown(() => channel.stop());
  let build = null;
  const poller = follow({
    api, clock, onState: setState,
    onGrid: (grid) => {
      channel.update(grid);
      if (build === null) build = grid.build;
      else if (shouldReload(build, grid.build)) channel.reloadAtNextShutter();
    },
  });
  onTeardown(() => poller.stop());

  let admitted = false;
  // Sound the page could not reach — a synth that would not load, a context the
  // phone is holding for a call — is never the page's last word: the picture
  // plays on, and the button is the way to ask for it again.
  function withheld() {
    admitted = false;
    join.hidden = false;
  }
  /** Ask for the sound once; it joins the picture whenever the browser lets it. */
  function admit() {
    if (admitted) return;
    admitted = true;
    sound.open().then((opened) => {
      if (signal.aborted) return;
      if (!opened) {
        withheld();
        return;
      }
      audio = opened;
      interlude.muted(isMuted());
      replay.muted(isMuted());
      // The button came up for a context that now runs; a clip the browser
      // still refuses raises it again on the rejoin.
      join.hidden = true;
      channel.rejoin();
    }, () => {
      if (signal.aborted) return;
      withheld();
    });
  }

  // The button stands in front of the picture, and the picture never waits
  // on the sound: a browser that withholds sound shows the button over a
  // channel that plays on, and the click asks again with a gesture in hand.
  // Only a reader who asked for less motion has the channel wait for the click.
  let held = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (held) {
    join.hidden = false;
    channel.halt();
  } else if (framed) {
    // A player on somebody else's page opens no sound of its own: the clips
    // play muted under the button, which is how the channel is asked for.
    replay.muted(true);
    join.hidden = false;
  } else {
    admit();
    const verdict = setTimeout(() => { if (!sound.running) join.hidden = false; }, SOUND_WAIT_MS);
    onTeardown(() => clearTimeout(verdict));
  }
  join.addEventListener("click", () => {
    join.hidden = true;
    held = false;
    channel.resume();
    channel.rejoin();
    if (!audio) {
      admit();
      sound.ask();
    }
  }, { signal });

  const watcher = new ResizeObserver(() => {
    const width = page.clientWidth;
    page.style.setProperty("--stage-px", String(width));
    interlude.resize(width, page.clientHeight);
  });
  watcher.observe(page);
  onTeardown(() => watcher.disconnect());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      poller.pause();
      channel.halt();
    } else {
      poller.poll();
      if (!held) channel.resume();
    }
  }, { signal });

  // The next frame is asked for before this one ticks, so a tick that throws
  // (a caption that fits no line) cannot stop the channel.
  let frame = requestAnimationFrame(function loop() {
    frame = requestAnimationFrame(loop);
    channel.tick();
  });
  onTeardown(() => cancelAnimationFrame(frame));
  await poller.started;
}
