// Two views, addressed by hash so the browser's own back button works and
// "back to the races" is an ordinary link rather than a piece of state.

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const match = path.match(/^\/e\/([A-Za-z0-9._-]+)\/?$/);
  if (match) return { view: "race", eventId: match[1] };
  return { view: "menu" };
}

export const raceHref = (eventId) => `#/e/${eventId}`;
export const menuHref = "#/";
