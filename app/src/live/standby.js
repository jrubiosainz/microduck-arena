// The wait before a cup's show: the card, and the time left until it starts.
// A segment like the others, though it plays no frames: the time is the slot's
// own length less the offset the channel seeks it to.

import { countdown } from "../format.js";
import { wordmark } from "../wordmark.js";

export function createStandby(stage) {
  const card = document.createElement("div");
  card.className = "live-standby";
  card.hidden = true;
  const label = document.createElement("span");
  label.className = "eyebrow";
  label.textContent = "Starting soon";
  const title = document.createElement("span");
  title.className = "live-standby-title";
  const time = document.createElement("span");
  time.className = "live-standby-time";
  card.append(wordmark(), label, title, time);
  stage.append(card);
  let current = null;

  function seek(offsetMs) {
    time.textContent = countdown(current.duration_ms - offsetMs);
  }

  function play(slot, offsetMs) {
    current = slot;
    title.textContent = slot.cup.title;
    card.hidden = false;
    seek(offsetMs);
  }

  return {
    failed: false,
    prepare() {}, // nothing to load: the card is drawn from the slot
    show(slot) {
      play(slot, 0);
    },
    play,
    seek,
    stop() {
      card.hidden = true;
    },
  };
}
