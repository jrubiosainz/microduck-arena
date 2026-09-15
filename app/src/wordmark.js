// The site's mark, in the Pollen microduck page's own treatment.
//
// MICRODUCK in its yellow, ARENA in its orange, stacked. The values are the
// page's, read from it rather than guessed, and they are the charter's too:
// #FFD23F and #FF7A2F. The chromatic offset that page puts behind it is not
// here — the mark lives in the strip over the door, beside a handle and a
// picture, where two ghosts read as a printing fault rather than as a device.

export function wordmark() {
  const el = document.createElement("h1");
  el.className = "wordmark";
  const solid = document.createElement("span");
  solid.className = "wordmark__solid";
  solid.textContent = "Microduck";
  const arena = document.createElement("span");
  arena.className = "wordmark__arena";
  arena.textContent = "Arena";
  el.append(solid, arena);
  return el;
}

/** The duck head that sits in the corner of the Pollen page, and now of this one. */
export function duckHead() {
  const img = document.createElement("img");
  img.className = "duckhead";
  img.src = "/duck-head-mark.webp";
  // Decorative: the wordmark beside it already names the page, and announcing
  // "duck head" after "Microduck Arena" is noise in a screen reader.
  img.alt = "";
  return img;
}
