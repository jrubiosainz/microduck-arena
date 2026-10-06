// The screen a replay plays on, and nothing under it: a replay always plays and
// the names always ride the ducks, so all that is left is the follow key, on
// the picture itself while the camera has been let go, and the hint that it can
// be. The challenge page, a publication's and a workshop job all build their
// stage from it, so the three carry it the same way.

import { symbol } from "./symbols.js";
import { SWEEP, SWEEP_SECONDS, SWEEP_TURN } from "./sweep.js";

/** The deck's markup, for a page that lays its frame out as a string. */
export const deckMarkup = `
  <div class="deck stage fx-shadow-card">
    <canvas id="stage"></canvas>
    <button id="follow" hidden>Follow the leader</button>
    <div class="orbit-hint" hidden>
      ${symbol("touch_app").outerHTML}
      <p>Drag to turn · <span class="orbit-hint__mouse">scroll</span><span class="orbit-hint__touch">pinch</span> to zoom</p>
    </div>
  </div>`;

// Reviewers took the chase for a video: it moves by itself and nothing says it
// can be taken. So, a moment into every replay, a hand drags the camera from
// side to side, until the visitor has done it once themselves.
const ORBITED = "arena.orbited";
export const HINT_DELAY_MS = 3000;
// Long enough to read the line under the hand once the swing is over.
const HINT_MS = SWEEP_SECONDS * 1000 + 1200;
const FADE_MS = 300;
// (1 - cos πu) / 2, the swing's easing in sweep.js, as a CSS curve.
const EASE_IN_OUT_SINE = "cubic-bezier(0.37, 0, 0.63, 1)";

function orbited() {
  try {
    return localStorage.getItem(ORBITED) !== null;
  } catch {
    // Private windows and blocked site data: shown on every page, as it is to
    // anyone who has not moved the camera yet.
    return false;
  }
}

/**
 * What the viewer's `onChaseChange` should be: the follow key shows only
 * while the camera has been let go, and goes again once it is chasing. Letting
 * it go is the gesture the hint teaches, so it puts the hint away for good.
 */
export const followKeyFor = (root) => (chasing) => {
  root.querySelector("#follow").hidden = chasing;
  if (chasing) return;
  root.querySelector(".orbit-hint").hidden = true;
  try {
    localStorage.setItem(ORBITED, "1");
  } catch {
    // Not remembered: the hint comes back next visit, no worse than that.
  }
};

/** Wire the follow key to a viewer. */
export function wireDeck(root, viewer) {
  root.querySelector("#follow").addEventListener("click", () => viewer.follow());
}

/**
 * Show, a moment from now, that the camera can be moved: a hand drags it to
 * one side and the other while the chase swings with it. Not to a visitor who
 * has moved one before, not on a page since left. Asking for less motion keeps
 * the hand and the camera still; the line still says it.
 */
export function offerOrbit(root, viewer) {
  setTimeout(() => {
    const hint = root.querySelector(".orbit-hint");
    if (orbited() || !hint.isConnected) return;
    hint.hidden = false;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewer.sweep();
      // As far as a real drag goes to turn the camera that much: OrbitControls
      // makes a full turn of a drag the stage's height.
      const reach = (SWEEP_TURN * root.querySelector("#stage").clientHeight) / (2 * Math.PI);
      hint.querySelector(".symbol").animate(
        SWEEP.map(([offset, out]) => ({ offset, translate: `${out * reach}px 0`, easing: EASE_IN_OUT_SINE })),
        SWEEP_SECONDS * 1000,
      );
    }
    hint.animate(
      [{ opacity: 0 }, { opacity: 1, offset: FADE_MS / HINT_MS }, { opacity: 1, offset: 1 - FADE_MS / HINT_MS }, { opacity: 0 }],
      HINT_MS,
    ).finished.then(() => {
      hint.hidden = true;
    });
  }, HINT_DELAY_MS);
}
