// Display helpers, kept pure and separate so they are unit-testable without a
// DOM. Everything the page shows a human goes through here.

export function formatScore(value, { finished, metric } = {}) {
  // A DNF is scored at the event's time limit. Printing that number would read
  // as an achieved time, so say what actually happened instead.
  if (finished === 0) return "DNF";
  // A tug's rating is the mean ground it won from the reference duck, in centimetres.
  if (metric === "mean_ground_cm") return `${value.toFixed(1)} cm`;
  return `${value.toFixed(3)}s`;
}

/** A voted entry's rating: its votes per ballot shown on, with the server's head start. */
export function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

/** Time left, in the largest units that matter, seconds rounded up: "0:05", "1:02:05", "1d 01:01:01". */
export function countdown(ms) {
  const total = Math.ceil(ms / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const [days, hours, minutes, seconds] = [Math.floor(total / 86400), Math.floor(total / 3600) % 24,
    Math.floor(total / 60) % 60, total % 60];
  if (days) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
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

/** Whether an event is the tug of war: two ducks pull on a string, a duck rated in centimetres won from the reference. */
export const isTug = (event) => event?.course === "tug";

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
  if (isTug(event)) {
    return [
      { label: "course", value: `${event.ring_m} m ring, ${event.pit_m} m pit` },
      { label: "bout", value: `up to ${event.bout.time_limit_s} s` },
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

/** `words` with its first letter in capitals. */
export const capitalised = (words) => words[0].toUpperCase() + words.slice(1);
