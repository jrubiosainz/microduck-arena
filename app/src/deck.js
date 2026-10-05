// The screen a replay plays on, and nothing under it: a replay always plays and
// the names always ride the ducks, so all that is left is the follow key, on
// the picture itself while the camera has been let go. The challenge page, a
// publication's and a workshop job all build their stage from it, so the three
// carry it the same way.

/** The deck's markup, for a page that lays its frame out as a string. */
export const deckMarkup = `
  <div class="deck stage fx-shadow-card">
    <canvas id="stage"></canvas>
    <button id="follow" hidden>Follow the leader</button>
  </div>`;

/**
 * What the viewer's `onChaseChange` should be: the follow key shows only
 * while the camera has been let go, and goes again once it is chasing.
 */
export const followKeyFor = (root) => (chasing) => {
  root.querySelector("#follow").hidden = chasing;
};

/** Wire the follow key to a viewer. */
export function wireDeck(root, viewer) {
  root.querySelector("#follow").addEventListener("click", () => viewer.follow());
}
