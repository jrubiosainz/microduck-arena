// Five views, chosen by the hash. Everything else lives in its view.

import { getEvents } from "./api.js";
import { renderHome } from "./home.js";
import { renderLive } from "./live.js";
import { renderPlayer } from "./player.js";
import { renderRace } from "./race.js";
import { renderRun } from "./run.js";
import { parseRoute, themeFor } from "./router.js";
import { renderVote } from "./vote.js";

const root = document.querySelector("#app");
const state = { events: null, viewer: null, teardown: null };

async function events() {
  if (!state.events) state.events = await getEvents();
  return state.events;
}

/**
 * Enable one view's placement sheet and disable the others'. All dress the
 * same tokens, but each owns the page's own body and column, so they never
 * load together; flipping `disabled` is instant and keeps them all cached.
 */
function dress(theme) {
  for (const link of document.querySelectorAll("link[data-theme]")) {
    link.disabled = link.dataset.theme !== theme;
  }
}

async function show() {
  // Tear the old view's render loop down before building the next one, or two
  // viewers keep animating against the same canvas.
  state.viewer?.dispose();
  state.viewer = null;
  // A reveal in progress is abandoned, not finished, when the page is left.
  state.teardown?.();
  state.teardown = null;

  const route = parseRoute(location.hash);
  dress(themeFor(route.view));
  try {
    if (route.view === "race") {
      const event = (await events()).find((e) => e.id === route.eventId);
      if (!event) {
        // A stale link should land on something useful, not an error.
        location.hash = "#/";
        return;
      }
      await renderRace(root, { event, state });
    } else if (route.view === "vote") {
      const event = (await events()).find((e) => e.id === route.eventId);
      if (!event || !event.vote) {
        location.hash = "#/";
        return;
      }
      await renderVote(root, { event, state });
    } else if (route.view === "run") {
      await renderRun(root, route.runId, state);
    } else if (route.view === "live") {
      await renderLive(root, state);
    } else if (route.view === "player") {
      await renderPlayer(root, route.user);
    } else {
      await renderHome(root);
    }
  } catch (error) {
    const failed = document.createElement("p");
    failed.className = "failed";
    failed.textContent = `Could not reach the API: ${error.message}`;
    root.replaceChildren(failed);
  }
}

addEventListener("hashchange", show);
show();
