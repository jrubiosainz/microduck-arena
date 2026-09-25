// The chassis under a replay: the picture on top, the transport under it, one
// ink frame around both — the way a cassette deck is one object. The challenge
// page and a publication's both build their stage from it, so the two carry
// the same keys in the same place.

/** The deck's markup, for a page that lays its frame out as a string. */
export const deckMarkup = `
  <div class="deck fx-shadow-card">
    <div class="stage"><canvas id="stage"></canvas></div>
    <div class="controls">
      <button id="playpause">Pause</button>
      <button id="follow" hidden>Follow the leader</button>
      <button id="walls" aria-pressed="false" title="The lane walls are in the physics whether or not they are drawn">Show walls</button>
      <button id="names" aria-pressed="false" title="Who each duck belongs to, hung over its head">Show names</button>
      <span class="hint" id="stage-hint"></span>
    </div>
  </div>`;

/**
 * What the viewer's `onChaseChange` should be: the follow key shows only
 * while the camera has been let go, and goes again once it is chasing.
 */
export const followKeyFor = (root) => (chasing) => {
  root.querySelector("#follow").hidden = chasing;
};

/** Wire the keys to a viewer. */
export function wireDeck(root, viewer) {
  const playpause = root.querySelector("#playpause");
  playpause.addEventListener("click", () => {
    viewer.player.toggle();
    playpause.textContent = viewer.player.playing ? "Pause" : "Play";
  });
  root.querySelector("#follow").addEventListener("click", () => viewer.follow());

  // The walls are always there for the robot; the key only decides whether
  // you can see them. The names are off to begin with too: four plates over
  // four ducks is a legend nobody asked for until they did. aria-pressed as
  // well as the label, so the state is readable without reading the text.
  const toggle = (id, thing, set) => {
    const key = root.querySelector(`#${id}`);
    let shown = false;
    key.addEventListener("click", () => {
      shown = set(!shown);
      key.setAttribute("aria-pressed", String(shown));
      key.textContent = `${shown ? "Hide" : "Show"} ${thing}`;
    });
  };
  toggle("walls", "walls", (visible) => viewer.setWallsVisible(visible));
  toggle("names", "names", (visible) => viewer.setNamesVisible(visible));

  return {
    /** A fresh replay plays from the top, whatever the last one was doing. */
    reset() {
      playpause.textContent = "Pause";
    },
  };
}
