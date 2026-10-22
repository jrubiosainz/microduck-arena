// Display helpers, kept pure and separate so they are unit-testable without a
// DOM. Everything the page shows a human goes through here.

export function formatScore(seconds, { finished } = {}) {
  // A DNF is scored at the event's time limit. Printing that number would read
  // as an achieved time, so say what actually happened instead.
  if (finished === 0) return "DNF";
  return `${seconds.toFixed(3)}s`;
}

/** A voted entry's rating: its votes per ballot shown on, with the server's head start. */
export function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

export function formatSeeds(finished, total) {
  return `${finished}/${total}`;
}

/**
 * The commanded forward speed a run was scored at.
 *
 * A DNF has no meaningful speed — the harness scored the attempt that got
 * furthest, which is a diagnostic and not a result — so it prints as a dash
 * rather than inviting the number to be read as "it walked at 0.9 m/s".
 */
export function formatSpeed(vx, { finished } = {}) {
  if (finished === 0 || !vx) return "—";
  return `${vx.toFixed(2)}`;
}

/** Whether an event is a stage: an open floor that plays each entry's timeline once, with no lane,
 * no line and no speed. The event summary says so in `course`. */
export const isStage = (event) => event?.course === "stage";

/**
 * The event's parameters as labelled pairs.
 *
 * Four distinct measurements, so they are shown as four labelled values rather
 * than joined into one string with separators — the label says what the number
 * means, which a bare "2 m · legs · 0.25 m/s" leaves you to infer.
 *
 * The last one is the SWEEP, not a single commanded speed. The harness tries
 * every speed in this range and keeps each policy's best, so there is no one
 * number to report — and printing the event's nominal command here would say
 * the score was measured at a speed it very likely was not.
 */
export function formatEventFacts(event) {
  // A stage plays a performance, never a race: no distance, no surface to climb, no sweep.
  if (isStage(event)) {
    return [
      { label: "stage", value: "open floor" },
      { label: "performance", value: `up to ${event.time_limit_s} s` },
      { label: "rig", value: event.rig },
    ];
  }
  return [
    { label: "distance", value: `${event.length_m} m` },
    { label: "surface", value: event.slope_deg ? `${event.slope_deg}° climb` : "flat" },
    { label: "rig", value: event.rig },
    {
      label: "speed sweep",
      value: `${event.sweep_lo.toFixed(2)}–${event.sweep_hi.toFixed(2)} m/s · ${event.sweep_count}`,
    },
  ];
}
