// Three views, addressed by hash so the browser's own back button works and
// "back to the races" is an ordinary link rather than a piece of state.

const SEGMENT = "([A-Za-z0-9._-]+)";
const RACE = new RegExp(`^/e/${SEGMENT}/?$`);
const PLAYER = new RegExp(`^/p/${SEGMENT}/?$`);
const VOTE = new RegExp(`^/v/${SEGMENT}/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const race = path.match(RACE);
  if (race) return { view: "race", eventId: race[1] };
  const player = path.match(PLAYER);
  if (player) return { view: "player", user: player[1] };
  const vote = path.match(VOTE);
  if (vote) return { view: "vote", eventId: vote[1] };
  return { view: "menu" };
}

export const raceHref = (eventId) => `#/e/${eventId}`;
export const playerHref = (user) => `#/p/${user}`;
export const voteHref = (eventId) => `#/v/${eventId}`;
export const menuHref = "#/";

/**
 * Which placement sheet a view wears. Both are the club, in Duck Jam's paper
 * and ink; they differ only in what they place. A race page and a voting booth
 * both have a stage, so both wear the trackside sheet.
 */
export const themeFor = (view) => (view === "race" || view === "vote" ? "race" : "club");
