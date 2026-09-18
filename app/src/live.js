// The channel's page. Every screen reads the programme grid from the server,
// samples the shared clock against each answer, and says which state it is
// in: live when the grid has something to play, off air when it is empty,
// reconnecting when the grid cannot be read. This file owns the DOM, the
// polling and those states.

import { getLive } from "./api.js";
import { createClock } from "./live/clock.js";

const POLL_MS = 10_000;
const RECONNECTING_AFTER_MS = 30_000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The stage and its chrome, and nothing else on the page. */
export function buildStage(root) {
  const page = el("main", "live");
  page.dataset.liveState = "joining";
  const stage = el("div", "live-stage");
  const bug = el("p", "live-bug", "LIVE");
  const card = el("div", "live-card", "OFF AIR");
  card.hidden = true;
  const join = el("button", "live-join", "JOIN THE LIVE");
  join.type = "button";
  join.hidden = true;
  page.append(stage, bug, card, join);
  root.replaceChildren(page);
  return { page, stage, bug, card, join };
}

/**
 * Polls the grid and samples the clock on every answer. A miss is forgiven
 * for half a minute once the clock is set, since one lost poll is not an
 * outage; before the clock is set, or past that, the page says reconnecting.
 */
function follow({ api, clock, onState }) {
  let timer = null;
  let lastGood = Date.now();
  let stopped = false;
  async function poll() {
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
      onState(grid.slots.length ? "live" : "off-air");
    } else if (!clock.ready || Date.now() - lastGood >= RECONNECTING_AFTER_MS) {
      onState("reconnecting");
    }
    timer = setTimeout(poll, POLL_MS);
  }
  const started = poll();
  return {
    started,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export async function renderLive(root, state, { api = { getLive } } = {}) {
  const { page, card } = buildStage(root);
  const clock = createClock();
  const poller = follow({
    api,
    clock,
    onState(value) {
      page.dataset.liveState = value;
      card.hidden = value !== "off-air";
    },
  });
  state.teardown = poller.stop;
  await poller.started;
}
