// The title, in the Pollen microduck page's own treatment.
//
// MICRODUCK in its yellow, ARENA in its orange, both carrying the page's
// chromatic offset: a hard black drop shadow with a cyan ghost to the left and
// a magenta one to the right — an offset-print plate that did not quite line
// up. The values are the page's, read from it rather than guessed: #FFD23F,
// #FF7A2F, #2FF0E6, #FF2FA8, and the -1.5deg tilt it gives its own heading.

export function wordmark({ compact = false } = {}) {
  const el = document.createElement("h1");
  el.className = compact ? "wordmark wordmark--compact" : "wordmark";
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
