// Who the server thinks you are, and what the entry panel should therefore show.
//
// Kept pure and separate from the DOM so the rule is testable: three states, and
// the difference between them decides whether the dropzone exists at all.

/**
 * Which of the three panels to render.
 *
 * `no-hub` is deliberately its own state rather than being folded into
 * `signed-out`: on a Space you can be signed in and still lack a Hub token, and
 * in that case you can race but not publish. Locally there is no OAuth at all
 * and no token by design, which is `ready` — a sign-in button there is a dead
 * end.
 */
export function panelState(me) {
  if (!me || !me.signed_in) return "signed-out";
  if (me.oauth_enabled && !me.can_publish_to_hub) return "no-hub";
  return "ready";
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
