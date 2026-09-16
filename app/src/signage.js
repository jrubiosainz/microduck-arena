// The strip over the door: the arena's mark on the left, the player on the
// right. Every page wears it, races included — the mark is how you get back to
// the front, so a race needs no back link of its own. Under every page, the
// same strip on deep ink: Duck Jam's footer, with the two doors out of the
// arena — the community, and the robot itself.

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
 * Who you are, top-right. Signed in: your page. Signed out: the door in.
 * `me` is null when /api/me could not be reached, and then there is nothing
 * honest to show — a sign-in link to a server that is not answering is worse
 * than a blank.
 */
export function chip(me) {
  if (!me) return document.createElement("span");
  if (!me.signed_in) {
    const link = document.createElement("a");
    link.className = "sticker sticker-lavender";
    link.href = signInHref();
    link.textContent = "Sign in with Hugging Face";
    return link;
  }
  const link = document.createElement("a");
  link.className = "profile-chip";
  link.href = playerHref(me.user);
  const name = document.createElement("span");
  name.textContent = me.user;
  link.append(avatar(me.user), name);
  return link;
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
