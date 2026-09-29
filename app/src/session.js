// Where the sign-in link points, carrying the route to come back to.

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
