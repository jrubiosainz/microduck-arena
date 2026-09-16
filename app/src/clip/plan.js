// The clip's frame plan: a title card, the tape at speed, an outro on the last
// frame. Pure, so the recorder's expectations and the page's drawing are
// pinned by one test.

import { CTRL_DT } from "../replay.js";

export const FPS = 25;
const INTRO_S = 1;
const OUTRO_S = 2.5;
/** Trace frames per clip frame: the trace is 50 Hz, the clip 25 fps. */
export const STRIDE = Math.round(1 / FPS / CTRL_DT);

/**
 * `authorFrames` is the author's trace length; `tapeMaxS` the event's ceiling.
 * A run longer than the ceiling — a timeout — is cut there and stamped anyway:
 * the verdict is the record's, not the tape's.
 */
export function clipPlan(authorFrames, tapeMaxS) {
  const steps = Math.max(1, Math.min(authorFrames, Math.round(tapeMaxS / CTRL_DT)));
  const intro = FPS * INTRO_S;
  const tape = Math.ceil(steps / STRIDE);
  const outro = Math.round(FPS * OUTRO_S);
  const frames = intro + tape + outro;
  return {
    fps: FPS,
    stride: STRIDE,
    steps,
    intro,
    tape,
    outro,
    frames,
    seconds: frames / FPS,
    tapeEnd: intro + tape,
    poster: intro + Math.floor(tape * 0.6),
  };
}

/** The trace step clip frame `i` shows. */
export function stepAt(plan, i) {
  if (i < plan.intro) return 0;
  return Math.min(plan.steps - 1, (i - plan.intro) * plan.stride);
}

export function actAt(plan, i) {
  return i < plan.intro ? "intro" : i < plan.tapeEnd ? "tape" : "outro";
}
