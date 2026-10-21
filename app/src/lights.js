// Red light, green light: what the light shows at a moment of a race, and how far round its caller
// has turned. The schedule is the event's `lights` (arena/manifest.py Lights), the same on every
// seed, so the replay's own clock is all it takes: phase k is green for green_s[k], then red for
// red_s[k], and the cycle repeats until the time limit — as arena/runner.py _LightSteps judges it,
// on whole control steps.

import { CTRL_DT } from "./replay.js";

const smooth = (x) => x * x * (3 - 2 * x);
const steps = (seconds) => Math.round(seconds / CTRL_DT);
const sum = (values) => values.reduce((a, b) => a + b, 0);

/**
 * The light `seconds` into the race. `red` is the light; `facing` is how far round the caller
 * is, 0 with its back to the lanes and 1 facing them: it turns round over `turn_s` once the light
 * goes red, and back again once it goes green. `watching` is when a duck can be caught — from
 * the moment the caller faces the lanes to the end of the red. Before the start, the caller
 * counts with its back turned.
 */
export function lightAt(lights, seconds) {
  const green = lights.green_s.map(steps);
  const red = lights.red_s.map(steps);
  const turn = steps(lights.turn_s);
  const cycle = sum(green) + sum(red);
  if (!(seconds >= 0) || cycle === 0) return { red: false, facing: 0, watching: false };
  const clock = seconds / CTRL_DT;
  // The step whose frame a replay shows at `seconds`, safe from a boundary's rounding.
  const step = Math.floor(clock + 1e-6);
  const turned = (start) => (turn > 0 ? smooth(Math.min(1, Math.max(0, clock - start) / turn)) : 1);
  const lap = Math.floor(step / cycle);
  let start = lap * cycle;
  for (let k = 0; k < green.length; k++) {
    if (step < start + green[k]) {
      // The race's first green follows no red: the caller has its back turned already.
      return { red: false, facing: k === 0 && lap === 0 ? 0 : 1 - turned(start), watching: false };
    }
    start += green[k];
    if (step < start + red[k]) return { red: true, facing: turned(start), watching: step >= start + turn };
    start += red[k];
  }
  return { red: false, facing: 0, watching: false };
}
