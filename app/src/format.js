// Display helpers, kept pure and separate so they are unit-testable without a
// DOM. Everything the page shows a human goes through here.

export function formatScore(seconds, { finished } = {}) {
  // A DNF is scored at the event's time limit. Printing that number would read
  // as an achieved time, so say what actually happened instead.
  if (finished === 0) return "DNF";
  return `${seconds.toFixed(3)}s`;
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

/**
 * The choices in the trial speed picker.
 *
 * Built from the event's own declared sweep rather than a hardcoded list, so
 * an event with a different range gets the right picker for free — the same
 * reason the sweep lives in the manifest at all.
 *
 * The first choice is the sweep itself, and it is the default: it is the
 * measurement the board uses, so "what would this score" and "what does the
 * picker do by default" should be the same question. An explicit speed is for
 * looking at ONE behaviour, and it is much quicker because it skips the scan.
 */
export function speedChoices(event) {
  const choices = [{ value: "", label: `Sweep all ${event.sweep_count} — find the best` }];
  // Rebuilt by stepping, not by dividing the range, so this lands on exactly
  // the speeds the harness scans. The epsilon is the same one the manifest
  // carries: stepping 0.05 twenty times from 0.20 arrives at 1.2000000000000002,
  // and without it the fastest speed the event offers goes missing.
  for (let vx = event.sweep_lo; vx <= event.sweep_hi + 1e-9; vx += event.sweep_step) {
    const value = vx.toFixed(2);
    choices.push({ value, label: `${value} m/s` });
  }
  return choices;
}
