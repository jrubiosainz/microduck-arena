// The Arena's own header, worn by the workshop: the cover and its yellow band on the home, the strip
// on every other page. The account sits where the Arena puts the player, and it is the way in: "Log
// in" starts Hugging Face's browser login, whose page the server opens.

import { FLOCK, MICRODUCK_RL } from "../links.js";
import { avatar, pendingIdentity } from "../signage.js";
import { duckHead, wordmark } from "../wordmark.js";
import { el } from "./dom.js";
import { homeHref } from "./routes.js";

const profile = (user) => `https://huggingface.co/${encodeURIComponent(user)}`;
const CARD = { waiting: ["Waiting…", "for huggingface.co"], unreachable: ["Check again", "Hugging Face unreachable"], out: ["Log in", "to Hugging Face"] };
const CHIP = { waiting: "Waiting for huggingface.co…", unreachable: "Hugging Face unreachable · Check again", out: "Log in to Hugging Face" };

function outLink(className, text, href) {
  const link = el("a", className, text);
  Object.assign(link, { href, target: "_blank", rel: "noopener" });
  return link;
}

/** Under the card: the login page while it waits (in case no tab opened), or why a login failed. */
function aside(state) {
  if (state.phase === "waiting" && state.url) return [outLink("account-note", "Open huggingface.co", state.url)];
  return state.error ? [el("p", "account-note account-note--bad", state.error)] : [];
}

/** The account on the home's cover, as the Arena's player card, in each of its phases. */
export function accountCard(state, { onLogIn, onRetry }) {
  if (state.phase === "checking") return pendingIdentity("player-card");
  const box = el("div", "player-card");
  if (state.phase === "in") {
    const link = outLink("player-card-you fx-shadow-card", undefined, profile(state.user));
    link.append(avatar(state.user), el("span", "player-card-name", state.user));
    box.append(link);
    return box;
  }
  const [name, under] = CARD[state.phase];
  const button = el("button", "player-card-in fx-shadow-card");
  button.type = "button";
  button.dataset.phase = state.phase;
  const head = duckHead();
  head.classList.add("player-card-duck");
  button.append(head, el("span", "player-card-name", name), el("span", "player-card-score", under));
  button.disabled = state.phase === "waiting";
  button.addEventListener("click", state.phase === "unreachable" ? onRetry : onLogIn);
  box.append(button, ...aside(state));
  return box;
}

/** The account on the strip: the Arena's profile chip, or its orange sign-in sticker. */
export function accountChip(state, { onLogIn, onRetry }) {
  if (state.phase === "checking") return pendingIdentity("profile-chip");
  if (state.phase === "in") {
    const link = outLink("profile-chip", undefined, profile(state.user));
    link.append(avatar(state.user), el("span", "", state.user));
    return link;
  }
  const button = el("button", state.phase === "out" ? "sticker sticker-orange" : "sticker", CHIP[state.phase]);
  button.type = "button";
  button.disabled = state.phase === "waiting";
  if (state.error) button.title = state.error;
  button.addEventListener("click", state.phase === "unreachable" ? onRetry : onLogIn);
  return button;
}

/** The home's cover: the duck, MICRODUCK / WORKSHOP, and the account in `slot`. */
export function masthead(slot) {
  const head = el("header", "masthead fx-ray-fan");
  const row = el("div", "masthead-row");
  const lockup = el("div", "masthead-lockup");
  lockup.append(duckHead({ quacks: true }), wordmark({ variant: "cover", word: "Workshop" }));
  const nav = el("nav", "masthead-player");
  nav.setAttribute("aria-label", "Account");
  nav.append(slot);
  row.append(lockup, nav);
  head.append(row);
  return head;
}

/** The yellow band under the cover: back to the Arena, the community, the training code. */
export function band(arena) {
  const strip_ = el("div", "flock-band");
  const row = el("div", "flock-band-row");
  [["Back to the Arena", `${arena}/`], ["Join the flock", FLOCK], ["Create policies", MICRODUCK_RL]].forEach(([text, href], i) => {
    if (i) row.append(el("span", "flock-star", "★"));
    row.append(outLink("", text, href));
  });
  strip_.append(row);
  return strip_;
}

/** Every other page's strip: the mark, which is the way home, and the account in `slot`. */
export function strip(slot) {
  const header = el("header", "signage");
  const brand = el("div", "club-brand");
  const title = wordmark({ word: "Workshop" });
  const home = el("a");
  home.href = homeHref;
  home.append(...title.childNodes);
  title.append(home);
  brand.append(duckHead(), title);
  const nav = el("nav", "site-nav");
  nav.setAttribute("aria-label", "Account");
  nav.append(slot);
  header.append(brand, nav);
  return header;
}
