// Who the server thinks you are, and what the entry panel should therefore show.
//
// Kept pure and separate from the DOM so the rule is testable: two states, and
// the difference between them decides whether the dropzone exists at all.

/**
 * Which of the two panels to render: signed out, or ready to race.
 *
 * Locally there is no OAuth at all and ARENA_DEV_USER is always signed in,
 * which is `ready` — a sign-in button there is a dead end.
 */
export function panelState(me) {
  return me && me.signed_in ? "ready" : "signed-out";
}

/**
 * Where the sign-in link points, carrying the route to come back to.
 *
 * The browser never sends a URL fragment to the server, so without this the
 * callback cannot know which race page you left and always lands on the menu.
 * Only the ROUTE travels — never a URL — and the server matches it against the
 * router's own shape before building the redirect itself, so nothing sent from
 * here can name a host.
 */
export function signInHref(hash = typeof location === "undefined" ? "" : location.hash) {
  const route = String(hash || "").replace(/^#/, "");
  return route ? `/login?next=${encodeURIComponent(route)}` : "/login";
}
