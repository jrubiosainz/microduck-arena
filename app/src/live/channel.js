// The conductor: on every frame, where the clock says we are in the grid,
// and what that means for the segments. It enters a slot at its offset,
// servos the one playing, keeps the last picture under a shutter's sweep,
// uncovers the next segment at the shutter's midpoint, prefetches one slot
// ahead, and is the one place a reload is allowed to happen.

import { slotAfter, slotAt } from "./grid.js";
import { shutterAt } from "./shutter.js";

const FRESH_MS = 40; // a shutter entered within its first frame gets its wind
// A cup match's clip is served from 30 s before it airs, and a video that
// failed to load is never loaded again: a match slot is prepared from 25 s
// before, which leaves a screen's clock 5 s of slack.
export const PREFETCH_MS = 25_000;

export function createChannel({ clock, segments, shutter, onState, onReload, gust }) {
  let slots = null; // nothing to say until the first grid
  let current = null; // the slot playing
  let previous = null; // the segment kept on screen under a shutter's sweep
  let uncovered = false;
  let announcing = null; // what the last shutter's card named, kept for a segment that fails
  let halted = false;
  let reloading = false;
  let state = null; // what the page was last told, so it hears each state once

  const segmentFor = (slot) => (slot && slot.kind !== "shutter" ? segments[slot.kind] : null);
  const due = (slot, ms) => slot.media !== "match" || slot.at_ms - ms <= PREFETCH_MS;

  function report(value) {
    if (state === value) return;
    state = value;
    onState(value);
  }

  function stopPrevious() {
    previous?.stop();
    previous = null;
  }

  function leave() {
    stopPrevious();
    segmentFor(current)?.stop();
    current = null;
  }

  function enter(slot, offset) {
    if (slot.kind === "shutter") {
      // The picture under the sweep is the segment that was playing.
      previous = segmentFor(current);
      current = slot;
      uncovered = false;
      announcing = slot.next;
      if (offset < FRESH_MS) gust();
      return;
    }
    stopPrevious();
    segmentFor(current)?.stop();
    current = slot;
    segmentFor(slot).play(slot, offset);
  }

  return {
    update(grid) {
      slots = grid.slots;
    },
    tick() {
      if (halted || !slots) return;
      const ms = clock.position();
      const slot = slotAt(slots, ms);
      if (!slot) {
        leave();
        shutter.hide();
        report(slots.length ? "live" : "off-air");
        return;
      }
      const offset = ms - slot.at_ms;
      if (!current || current.at_ms !== slot.at_ms || current.kind !== slot.kind) enter(slot, offset);
      const next = slotAfter(slots, slot);
      if (slot.kind === "shutter") {
        shutter.draw(offset, slot.next);
        if (!shutterAt(offset).destination) {
          if (next && due(next, ms)) segmentFor(next)?.prepare(next);
        } else if (!uncovered) {
          uncovered = true;
          stopPrevious();
          if (reloading) {
            reloading = false;
            onReload();
            return;
          }
          if (next) segmentFor(next)?.show(next);
        }
      } else {
        const segment = segmentFor(slot);
        if (segment.failed) {
          // A clip withdrawn between two grid reads: the panel holds, still
          // announcing it, until the next slot's scheduled time.
          shutter.draw(800, announcing);
        } else {
          shutter.hide();
          segment.seek(offset);
        }
        const after = next && slotAfter(slots, next);
        if (after && due(after, ms)) segmentFor(after)?.prepare(after);
      }
      report("live");
    },
    /** After a refused play: leave, so the next tick enters again with sound allowed. */
    rejoin() {
      leave();
    },
    halt() {
      halted = true;
      leave();
      shutter.hide();
    },
    resume() {
      halted = false;
    },
    reloadAtNextShutter() {
      reloading = true;
    },
    stop() {
      leave();
      shutter.hide();
    },
  };
}
