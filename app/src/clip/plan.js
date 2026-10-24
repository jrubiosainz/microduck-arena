// The clip's frame plan: a title over the waiting ducks while the camera travels
// to the chase, the tape at speed, an outro while the rest of the race runs on.
// Pure, so the recorder's expectations and the page's drawing are pinned by one
// test.

import { CTRL_DT } from "../replay.js";

export const FPS = 25;
const INTRO_S = 3;
/** The camera's travel to the chase, inside the intro: it settles before the start. */
const TRAVEL_S = 2.4;
const OUTRO_S = 2.5;
/** Trace frames per clip frame: the trace is 50 Hz, the clip 25 fps. */
export const STRIDE = Math.round(1 / FPS / CTRL_DT);

/**
 * `authorFrames` is the author's trace length; `tapeMaxS` the event's ceiling;
 * `settle` the frames of untimed settle the lanes play first (leadIn), so the
 * tape starts where the simulation did. A run longer than the ceiling — a
 * timeout — is cut there and stamped anyway: the verdict is the record's, not
 * the tape's. `speed` is the event's time-lapse: the tape plays that many times
 * faster than life, a whole number so every clip frame lands on a trace step.
 */
export function clipPlan(authorFrames, tapeMaxS, settle, speed = 1) {
  const stride = STRIDE * speed;
  const steps = settle + Math.max(1, Math.min(authorFrames, Math.round(tapeMaxS / CTRL_DT)));
  const intro = FPS * INTRO_S;
  const tape = Math.ceil(steps / stride);
  const outro = Math.round(FPS * OUTRO_S);
  const frames = intro + tape + outro;
  return {
    fps: FPS,
    stride,
    speed,
    settle,
    steps,
    intro,
    travel: FPS * TRAVEL_S,
    tape,
    outro,
    frames,
    seconds: frames / FPS,
    tapeEnd: intro + tape,
    poster: intro + Math.floor(tape * 0.6),
  };
}

/** The trace step clip frame `i` shows. The clock runs on through the outro:
 * the author's lane holds its last frame, as the player holds any finished
 * lane, while the rivals still racing go on. */
export function stepAt(plan, i) {
  if (i < plan.intro) return 0;
  return (i - plan.intro) * plan.stride;
}

/** How far through its travel to the chase the camera is at clip frame `i`, 0 to 1. */
export function travelAt(plan, i) {
  return Math.min(1, i / plan.travel);
}

export function actAt(plan, i) {
  return i < plan.intro ? "intro" : i < plan.tapeEnd ? "tape" : "outro";
}
