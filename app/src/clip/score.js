// What the clip sounds like, decided before a frame is drawn: the crowd's
// direction and every cue at its instant. Pure. Each sound source is a
// function here and a name in the event's [clip] sounds.

import { CTRL_DT, frameAt } from "../replay.js";

/** Cue gains, measured on a real render: through the stadium's reverb the horn
 * sits 5 dB over the crowd's surge, the victory level with the crowd's cheer,
 * and the fall — over a crowd gone quiet — just over the stamp. */
const GAINS = { horn: 0.1, stamp: 0.6, victory: 0.8, fall: 0.15 };
/** How often the crowd learns where the duck is, in seconds of tape. */
const PROGRESS_EVERY_S = 0.5;

function fnv(text) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

/** The author's progress down the course, sampled through the tape. */
function progress(trace, plan, lengthM, start) {
  const samples = [];
  for (let t = 0; t <= plan.steps * CTRL_DT; t += PROGRESS_EVERY_S) {
    const step = Math.min(plan.steps - 1, Math.round(t / CTRL_DT));
    const value = Math.max(0, Math.min(1, frameAt(trace, step)[0] / lengthM));
    samples.push({ second: start + t, value });
  }
  return samples;
}

/** A cue in the `room` rings round the stadium with the crowd; the others go straight to the mix. */
const SOURCES = {
  horn: ({ start }) => [{ at: start, file: "foghorn.wav", gain: GAINS.horn, room: true }],
  verdict: ({ end, verdict }) => [
    { at: end, file: "stamp.wav", gain: GAINS.stamp, room: false },
    verdict === "pass"
      ? { at: end + 0.16, file: "microduck-victory.wav", gain: GAINS.victory, room: true }
      : { at: end + 0.16, file: "microduck-fall.wav", gain: GAINS.fall, room: true },
  ],
};

export function clipScore({ run, plan, trace }) {
  const sounds = run.event.clip.sounds;
  const verdict = run.seeds_finished > 0 ? "pass" : "fail";
  const start = plan.intro / plan.fps;
  const end = plan.tapeEnd / plan.fps;
  const context = { start, end, verdict };
  return {
    // The same run always sounds the same, whichever layout renders it.
    seed: fnv(run.run_id),
    crowd: sounds.includes("crowd")
      ? { start, end, verdict, progress: progress(trace, plan, run.event.length_m, start) }
      : null,
    cues: sounds.flatMap((name) => SOURCES[name]?.(context) ?? []),
  };
}
