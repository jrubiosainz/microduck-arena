// The theatre's primitives.
//
// Every beat sequences on `animationend`, never on a timer: design/motion.css
// owns the durations, and reduced motion sets them all to zero without a second
// code path. An AbortSignal ends any wait early, so a skipped reveal never
// leaves a promise hanging.

/** The digits of a value as split-flap tiles; anything else sits between them. */
export function flipTiles(value) {
  return [...String(value)].map((c) => {
    const span = document.createElement("span");
    if (/\d/.test(c)) span.className = "flip-digit";
    span.textContent = c;
    return span;
  });
}

/**
 * Resolves when `name` ends on `node` (or its `pseudo` element), or when the
 * signal aborts — or one frame later, if no such animation is running at all.
 *
 * Subscribe, THEN add the class that starts the animation. The last clause is
 * the theatre's safety net: a stylesheet the browser kept from a previous
 * build, or a rule that never matched, must not hold a beat forever. An
 * animation that has not begun a frame after its class landed is over as far
 * as the sequence is concerned, and the page simply shows its end state.
 */
export const ended = (node, name, pseudo = "", signal) =>
  new Promise((there) => {
    const finish = () => {
      node.removeEventListener("animationend", done);
      signal?.removeEventListener("abort", finish);
      there();
    };
    const done = (event) => {
      if (event.target !== node || event.animationName !== name || event.pseudoElement !== pseudo) {
        return;
      }
      finish();
    };
    if (signal?.aborted) return there();
    node.addEventListener("animationend", done);
    signal?.addEventListener("abort", finish, { once: true });
    if (typeof node.getAnimations !== "function") return;
    // This node's own `pseudo`, not a sibling's: a tile's ::before rolls under
    // the same name as its ::after.
    requestAnimationFrame(() => {
      const running = node
        .getAnimations({ subtree: Boolean(pseudo) })
        .some(({ animationName, effect }) =>
          animationName === name && effect.target === node && (effect.pseudoElement ?? "") === pseudo);
      if (!running) finish();
    });
  });

/** The stamp comes down on its support; `contact` fires at the moment of impact. */
export async function slam(node, { support = null, contact = () => {}, signal } = {}) {
  node.hidden = false;
  if (signal?.aborted) return;
  // Subscribe before adding classes, including when reduced motion ends both phases at once.
  const landed = ended(node, "stamp-contact", "", signal).then(() => {
    if (!signal?.aborted) contact();
  });
  const settled = ended(node, "stamp-slam", "", signal);
  const jolted = support === null ? null : ended(support, "jolt", "", signal);
  node.classList.add("stamp-slam");
  support?.classList.add("jolt", "stamp-impact");
  try {
    await Promise.all([landed, settled, jolted]);
  } finally {
    node.classList.remove("stamp-slam");
    support?.classList.remove("jolt", "stamp-impact");
  }
}

/** Seeded, so the confetti falls the same way every time. */
function spread(count) {
  let state = 7;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, () => ({
    x: random(),
    lag: random(),
    sway: (random() - 0.5) * 2,
  }));
}

export async function confetti(root, count = 48, signal) {
  const layer = document.createElement("div");
  layer.className = "confetti-fall";
  layer.setAttribute("aria-hidden", "true");
  const strips = spread(count).map((piece) => {
    const strip = document.createElement("span");
    strip.className = "confetti-piece";
    strip.style.setProperty("--confetti-x", `${(piece.x * 100).toFixed(1)}%`);
    strip.style.setProperty("--confetti-lag", piece.lag.toFixed(2));
    strip.style.setProperty("--confetti-sway", `${Math.round(piece.sway * 40)}px`);
    return strip;
  });
  layer.replaceChildren(...strips);
  root.append(layer);
  await Promise.all(strips.map((strip) => ended(strip, "confetti-fall", "", signal)));
  layer.remove();
}

/**
 * Roll every tile of a `.flip` to the digit it already shows. The number is in
 * the DOM before the theatre starts; the roll is drawn on the tiles' faces.
 */
export async function rollCounter(flip, signal) {
  if (signal?.aborted) return;
  const tiles = [...flip.querySelectorAll(".flip-digit")];
  const done = tiles.map((tile) => ended(tile, "flip-roll", "::after", signal));
  for (const tile of tiles) {
    const from = (Number(tile.textContent) + 1) % 10;
    tile.style.setProperty("--flip-from", from);
    tile.style.setProperty("--flip-to", from + 9);
    tile.classList.add("flip-roll");
  }
  await Promise.all(done);
  for (const tile of tiles) {
    tile.classList.remove("flip-roll");
    tile.style.removeProperty("--flip-from");
    tile.style.removeProperty("--flip-to");
  }
}

/**
 * The pegboard climb, design/motion.css's `.rank-climb` beat.
 *
 * `rows` are the board's row elements in their FINAL order; `climber` is
 * the one that moves up. Call with the DOM still in the starting order: this
 * measures where each row was, reorders the DOM, measures where each is, and
 * animates every moved row from the one to the other. Ends on the climber's
 * peg-drop. A climber that does not move ends at once.
 */
export async function climb(pegboard, rows, climber, signal) {
  const was = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
  pegboard.replaceChildren(...rows);
  const moved = rows.filter((row) => row.getBoundingClientRect().top !== was.get(row));
  if (signal?.aborted || !moved.includes(climber)) return;
  // The displaced rows drop one peg each, bottom-most first, so the last to
  // fall has cleared its peg before the climber lands on it.
  const displaced = moved.filter((row) => row !== climber).reverse();
  const landed = ended(climber, "peg-drop", "", signal);
  for (const row of moved) {
    row.style.setProperty("--peg-dy", `${was.get(row) - row.getBoundingClientRect().top}px`);
  }
  displaced.forEach((row, order) => {
    row.style.setProperty("--peg-order", order);
    row.classList.add("rank-shuffle");
  });
  climber.classList.add("rank-climb");
  try {
    await landed;
  } finally {
    for (const row of moved) {
      row.classList.remove("rank-climb", "rank-shuffle");
      row.style.removeProperty("--peg-dy");
      row.style.removeProperty("--peg-order");
    }
  }
}
