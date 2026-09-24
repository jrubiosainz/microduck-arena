// Views addressed by hash so the browser's own back button works and
// "back to the races" is an ordinary link rather than a piece of state.

const SEGMENT = "([A-Za-z0-9._-]+)";
const RACE = new RegExp(`^/e/${SEGMENT}/?$`);
const PLAYER = new RegExp(`^/p/${SEGMENT}/?$`);
const VOTE = new RegExp(`^/v/${SEGMENT}/?$`);
const RUN = new RegExp(`^/r/${SEGMENT}/?$`);
const LIVE = /^\/live\/?$/;
const GUIDE = new RegExp(`^/guides(?:/${SEGMENT})?/?(?:\\?(.*))?$`);
const EVENT_GUIDE = new RegExp(`^/e/${SEGMENT}/guide/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const eventGuide = path.match(EVENT_GUIDE);
  if (eventGuide) return { view: "guides", eventId: eventGuide[1], section: null };
  const guide = path.match(GUIDE);
  if (guide) return {
    view: "guides", guideId: guide[1] || "index",
    section: new URLSearchParams(guide[2]).get("section"),
  };
  const race = path.match(RACE);
  if (race) return { view: "race", eventId: race[1] };
  const player = path.match(PLAYER);
  if (player) return { view: "player", user: player[1] };
  const vote = path.match(VOTE);
  if (vote) return { view: "vote", eventId: vote[1] };
  const run = path.match(RUN);
  if (run) return { view: "run", runId: run[1] };
  if (LIVE.test(path)) return { view: "live" };
  return { view: "menu" };
}

export const raceHref = (eventId) => `#/e/${eventId}`;
export const eventGuideHref = (eventId) => `#/e/${encodeURIComponent(eventId)}/guide`;
export const playerHref = (user) => `#/p/${user}`;
export const voteHref = (eventId) => `#/v/${eventId}`;
export const runHref = (runId) => `#/r/${runId}`;
export const menuHref = "#/";
export const liveHref = "#/live";
export const guideHref = (id = "index", section = null) =>
  `#/guides${id === "index" ? "" : `/${encodeURIComponent(id)}`}${section ? `?section=${encodeURIComponent(section)}` : ""}`;

/**
 * Which placement sheet a view wears. The club for the front and a player,
 * the trackside sheet for anything with a stage, and the channel's own for
 * the live page, which is nothing but a stage.
 */
export const themeFor = (view) =>
  view === "live" ? "live" : ["race", "vote", "run"].includes(view) ? "race" : "club";

/**
 * Wear one view's placement sheet and take the others off.
 *
 * Called by each view at the moment it first writes to the page, never
 * before: a view's own fetches sit between the click and its first element,
 * and flipping the sheet on the way in left the PREVIOUS page on screen
 * wearing the incoming one for the whole of that wait. Every rule the old
 * page relied on vanished at once — which is how a 15px Discord mark came to
 * fill the window for half a second.
 *
 * All the sheets dress the same tokens; they differ only in what they place,
 * which is why they cannot be worn together.
 */
export function dress(view) {
  const wanted = themeFor(view);
  for (const link of document.querySelectorAll("link[data-theme]")) {
    link.disabled = link.dataset.theme !== wanted;
  }
}
