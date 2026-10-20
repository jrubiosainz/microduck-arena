// A cup's match on the tug's rope: which of its two entrants pulls from which end in each bout.

import { SIDES } from "./tug.js";

/**
 * Bout `k` of `match` as a lane of the viewer, from its two traces and settles (west first): each
 * entrant on the end of the string the bout gave it, in its livery, under its on-air name.
 */
export function boutLane(match, k, traces, settles) {
  const [west, east] = match.bouts[k].a_side === SIDES[0] ? [match.a, match.b] : [match.b, match.a];
  return {
    tug: "bout",
    ducks: [west, east].map(({ livery, name }, side) => ({ trace: traces[side], settle: settles[side], livery, name })),
  };
}
