// The one way into a voting booth, wherever it appears.
//
// The flyer's corner sticker and the race page's panel atop the entry column
// used to be two separate bits of markup. One component now, so the two
// placements cannot drift into looking like different features.

import { voteHref } from "./router.js";

// The icon is a fixed drawing — a box, its lid with a slot, and a folded
// slip going in at an angle — sized per variant by the caller. Three paths,
// all on currentColor, so the ballot always matches the link's own ink.
const BALLOT_ICON = (size) =>
  `<svg viewBox="0 0 28 28" width="${size}" height="${size}" class="vote-button__ballot" ` +
  'aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" ' +
  'd="M5 12h18v12H5z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M4 12 8 7h12l4 5M12 8.4h4"/>' +
  '<path fill="currentColor" d="M13 1l7 3.2-3 6-7-3.2z"/>' +
  "</svg>";

const ICON_SIZE = { sticker: 22, panel: 30 };

/**
 * The button into `event`'s voting booth.
 *
 * Two variants, because the two placements differ in everything but the
 * destination: `"sticker"` is the small, tilted badge tucked into a flyer's
 * corner; `"panel"` is the larger, upright one that sits in normal flow
 * atop the race page's entry column, above Train my own robot.
 */
export function voteButton(event, { variant }) {
  const link = document.createElement("a");
  link.className = `vote-button vote-button--${variant}`;
  link.href = voteHref(event.id);
  link.innerHTML = `<span class="vote-button__label">VOTE HERE</span>${BALLOT_ICON(ICON_SIZE[variant])}`;
  return link;
}
