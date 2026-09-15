// The theatre's primitives, ported from Duck Jam (dome/web/shared/animation.mjs).
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
