// The strip over the door: the arena's mark on the left, the player on the
// right. Every page wears it, races included — the mark is how you get back to
// the front, so a race needs no back link of its own. Under every page, the
// same strip on deep ink: Duck Jam's footer, with the two doors out of the
// arena — the community, and the robot itself.

import { flipTiles } from "./animation.js";
import { signOut } from "./api.js";
import { FLOCK, POLLEN, STORE } from "./links.js";
import { menuHref, playerHref } from "./router.js";
import { signInHref } from "./session.js";
import { duckHead, wordmark } from "./wordmark.js";

/**
 * The Hub's picture for a handle, or a duck.
 *
 * The server keeps only the username, so the picture is asked of the Hub
 * directly by handle — nothing to store, nothing to go stale. A handle the Hub
 * does not know (the local dev user, say) answers 404, and the duck stands in.
 */
export function avatar(user) {
  const box = document.createElement("span");
  box.className = "avatar";
  const img = document.createElement("img");
  img.src = `https://huggingface.co/api/avatars/${encodeURIComponent(user)}`;
  img.alt = "";
  // setAttribute, not the property: jsdom does not reflect referrerPolicy.
  img.setAttribute("referrerpolicy", "no-referrer");
  img.addEventListener("error", () => img.replaceWith("🦆"), { once: true });
  box.append(img);
  return box;
}

/**
 * Who you are, top-right: your picture, your name, your points, and a dot while a result of yours waits to be opened.
 * Signed in: your page. Signed out: the door in.
 * `me` is null when /api/me could not be reached, and then there is nothing
 * honest to show — a sign-in link to a server that is not answering is worse
 * than a blank.
 */
export function chip(me) {
  if (!me) return document.createElement("span");
  if (!me.signed_in) {
    const link = document.createElement("a");
    // Orange, the carrying accent: signing in is the one thing this strip is
    // asking of anyone who has not.
    link.className = "sticker sticker-orange";
    link.href = signInHref();
    link.textContent = "Sign in with Hugging Face";
    return link;
  }
  const link = document.createElement("a");
  link.className = me.unseen > 0 ? "profile-chip unread" : "profile-chip";
  link.href = playerHref(me.user);
  const name = document.createElement("span");
  name.textContent = me.user;
  // The points as split-flap tiles even at rest, so a reveal can roll them up
  // in place. The star before them is the sheet's, not a tile.
  const points = document.createElement("span");
  points.className = "flip chip-points";
  points.append(...flipTiles(me.points ?? 0));
  link.append(avatar(me.user), name, points);
  return link;
}

/**
 * The chequer: orange on beige, the finish line.
 *
 * Here rather than on either page because both wear one — the front page
 * between its chapters, a player's under the strip — and the decision worth
 * keeping in one place is that it is decorative and says nothing to a reader.
 * Each page dresses it through its own class.
 */
export function chequer(className) {
  const band = document.createElement("div");
  band.className = className;
  band.setAttribute("aria-hidden", "true");
  return band;
}

/**
 * The way out, beside whoever you are.
 *
 * Null unless OAuth is what signed you in. Locally `current_user` answers with
 * ARENA_DEV_USER on every request whatever the cookie says, so a sign-out
 * there would clear a cookie nobody reads and leave you signed in — a control
 * that reports success and changes nothing is worse than none.
 *
 * The page is reloaded rather than re-rendered: the session is what every
 * view's fetch depends on, and reloading is the one way to be sure none of
 * them is still holding the old one.
 */
export function signOutButton(me) {
  if (!me?.signed_in || !me.oauth_enabled) return null;
  const button = document.createElement("button");
  button.className = "sign-out";
  button.type = "button";
  button.title = "Sign out";
  button.setAttribute("aria-label", "Sign out");
  button.textContent = "\u23FB";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await signOut();
    } finally {
      location.reload();
    }
  });
  return button;
}

export function signage(me) {
  const header = document.createElement("header");
  header.className = "signage";

  const brand = document.createElement("div");
  brand.className = "club-brand";
  // The link goes inside the heading rather than around it: the whole mark is
  // the way home, and an <a> wrapping an <h1> is not a heading a screen reader
  // will announce as one.
  const title = wordmark();
  const home = document.createElement("a");
  home.href = menuHref;
  home.append(...title.childNodes);
  title.append(home);
  brand.append(duckHead(), title);

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Player");
  nav.append(chip(me));
  const out = signOutButton(me);
  if (out) nav.append(out);

  header.append(brand, nav);
  return header;
}

function outLink(className, href, text) {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = text;
  return link;
}

export function footer() {
  const strip = document.createElement("footer");
  strip.className = "signage signage-end";

  const maker = document.createElement("span");
  maker.className = "mono-label";
  maker.append(outLink("", POLLEN, "POLLEN ROBOTICS"));

  const stickers = document.createElement("div");
  stickers.className = "signage-stickers fx-tilt-alternate";
  stickers.append(
    outLink("sticker sticker-cyan fx-tilt-1-5", FLOCK, "Join the flock"),
    outLink("sticker fx-tilt-1-5", STORE, "Get your real microduck"),
  );

  strip.append(maker, stickers);
  return strip;
}
