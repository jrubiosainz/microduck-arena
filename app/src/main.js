// Two views, chosen by the hash. Everything else lives in its view.

import { getEvents } from "./api.js";
import { renderMenu } from "./menu.js";
import { renderRace } from "./race.js";
import { parseRoute } from "./router.js";

const root = document.querySelector("#app");
const state = { events: null, viewer: null };

async function events() {
  if (!state.events) state.events = await getEvents();
  return state.events;
}

async function show() {
  // Tear the old view's render loop down before building the next one, or two
  // viewers keep animating against the same canvas.
  state.viewer?.dispose();
  state.viewer = null;

  const route = parseRoute(location.hash);
  try {
    const all = await events();
    if (route.view === "race") {
      const event = all.find((e) => e.id === route.eventId);
      if (!event) {
        // A stale link should land on something useful, not an error.
        location.hash = "#/";
        return;
      }
      await renderRace(root, { event, state });
    } else {
      await renderMenu(root);
    }
  } catch (error) {
    root.innerHTML = `<p class="failed">Could not reach the API: ${error.message}</p>`;
  }
}

addEventListener("hashchange", show);
show();
