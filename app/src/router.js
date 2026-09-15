// Four views, addressed by hash so the browser's own back button works and
// "back to the races" is an ordinary link rather than a piece of state.

const SEGMENT = "([A-Za-z0-9._-]+)";
const RACE = new RegExp(`^/e/${SEGMENT}/?$`);
const PLAYER = new RegExp(`^/p/${SEGMENT}/?$`);
const VOTE = new RegExp(`^/v/${SEGMENT}/?$`);
const RUN = new RegExp(`^/r/${SEGMENT}/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const race = path.match(RACE);
  if (race) return { view: "race", eventId: race[1] };
  const player = path.match(PLAYER);
  if (player) return { view: "player", user: player[1] };
  const vote = path.match(VOTE);
  if (vote) return { view: "vote", eventId: vote[1] };
  const run = path.match(RUN);
  if (run) return { view: "run", runId: run[1] };
  return { view: "menu" };
}

export const raceHref = (eventId) => `#/e/${eventId}`;
export const playerHref = (user) => `#/p/${user}`;
export const voteHref = (eventId) => `#/v/${eventId}`;
export const runHref = (runId) => `#/r/${runId}`;
export const menuHref = "#/";

/**
 * Which placement sheet a view wears. Both are the club, in Duck Jam's paper
 * and ink; they differ only in what they place. A race page, a voting booth
 * and a publication all have a stage, so all three wear the trackside sheet.
 */
export const themeFor = (view) => (["race", "vote", "run"].includes(view) ? "race" : "club");
