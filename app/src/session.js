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

export const signInHref = () => "/login";
