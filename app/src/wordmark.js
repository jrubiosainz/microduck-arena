// The site's mark, in the Pollen microduck page's own treatment.
//
// MICRODUCK in its yellow, ARENA in its orange, stacked. The values are the
// page's, read from it rather than guessed, and they are the charter's too:
// #FFD23F and #FF7A2F. The chromatic offset that page puts behind it is not
// here — the mark lives in the strip over the door, beside a handle and a
// picture, where two ghosts read as a printing fault rather than as a device.

/**
 * The site's mark. Two variants, one component.
 *
 * `strip` is the small flat mark in the strip over the door, where the
 * chromatic offset would read as a printing fault beside a handle and a
 * picture. `cover` is the front page's, at the charter's hero step and with
 * the aberration the charter draws on its own cover — over deep ink, which is
 * the only ground the charter ever puts a yellow word on.
 */
export function wordmark({ variant = "strip" } = {}) {
  const el = document.createElement("h1");
  el.className = variant === "cover" ? "wordmark wordmark--cover fx-aberration" : "wordmark";
  const solid = document.createElement("span");
  solid.className = "wordmark__solid";
  solid.textContent = "Microduck";
  const arena = document.createElement("span");
  arena.className = "wordmark__arena";
  arena.textContent = "Arena";
  el.append(solid, arena);
  return el;
}

/**
 * The duck head from the Pollen page.
 *
 * `quacks` stacks the open-beak sprite over the closed one and shows it on
 * hover, with a sticker beside it. The two are anchored at the TOP and share
 * a width: the open sprite is 460x333 against the closed one's 454x269, so
 * the extra height is all beak. Anchored any other way the whole skull jumps
 * when the mouth opens.
 *
 * The swap and the sticker are NOT behind prefers-reduced-motion — that
 * setting asks for less movement, not for less to look at. Only the tilt and
 * the transitions are.
 */
export function duckHead({ quacks = false } = {}) {
  const img = document.createElement("img");
  img.className = "duckhead";
  img.src = "/duck-head-mark.webp";
  // Decorative: the wordmark beside it already names the page, and announcing
  // "duck head" after "Microduck Arena" is noise in a screen reader.
  img.alt = "";
  if (!quacks) return img;

  const box = document.createElement("span");
  box.className = "duck";
  const open = document.createElement("img");
  open.className = "duckhead duckhead--open";
  open.src = "/duck-head-mark-open.webp";
  open.alt = "";
  const shout = document.createElement("span");
  shout.className = "duck-quack sticker";
  shout.textContent = "QUACK!";
  shout.setAttribute("aria-hidden", "true");
  box.append(img, open, shout);
  return box;
}
