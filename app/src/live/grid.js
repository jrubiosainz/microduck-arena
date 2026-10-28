// Where a position falls in the grid, and how a video is kept on it. Pure.

export function slotAt(slots, ms) {
  return slots.find((s) => s.at_ms <= ms && ms < s.at_ms + s.duration_ms) ?? null;
}

export function slotAfter(slots, slot) {
  const end = slot.at_ms + slot.duration_ms;
  return slots.find((s) => s.at_ms === end) ?? null;
}

/** The servo, in seconds of media: a small error is left alone, a
 * larger one is chased at 3 % speed, past a second the video seeks — but
 * only to media it has buffered. Forced (joining, or after a stall), it
 * seeks to the clock wherever that is: the browser buffers a few seconds
 * ahead of where a clip plays, so a screen joining a match clip past them
 * would otherwise play it from the start, behind its call. */
export function correction(current, target, ranges, force = false) {
  const error = target - current;
  if (force || Math.abs(error) > 1) {
    return force || ranges.some(([start, end]) => target >= start && target < end)
      ? { rate: 1, time: target }
      : { rate: 1 };
  }
  return { rate: Math.abs(error) < 0.25 ? 1 : error > 0 ? 1.03 : 0.97 };
}

/** A page that has run for days reloads after a deploy, at the next shutter. */
export function shouldReload(started, current) {
  return current !== started;
}
