// What the clip sounds like, decided before a frame is drawn: the crowd's
// direction and every cue at its instant. Pure. Each sound source is a
// function here and a name in the event's [clip] sounds.

import { CTRL_DT, frameAt } from "../replay.js";

/** Cue gains, starting where Duck Jam had them; tuned by ear on a real render. */
const GAINS = { jingle: 0.5, stamp: 0.6, voice: 0.4 };
const JINGLES = 5;
/** How often the crowd learns where the duck is, in seconds of tape. */
const PROGRESS_EVERY_S = 0.5;

function fnv(text) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

/** An event's jingle: the variant its id hashes to, unless its manifest pins one. */
export function jingleFile(eventId, pinned = null) {
  return pinned ? `${pinned}.wav` : `round-${fnv(eventId) % JINGLES}.wav`;
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

const SOURCES = {
  jingle: ({ run }) => [{ at: 0, file: jingleFile(run.event.id, run.event.clip.jingle), gain: GAINS.jingle }],
  verdict: ({ end, verdict }) => [
    { at: end, file: "stamp.wav", gain: GAINS.stamp },
    { at: end + 0.16, file: verdict === "pass" ? "microduck-victory.wav" : "microduck-fall.wav", gain: GAINS.voice },
  ],
};

export function clipScore({ run, plan, trace }) {
  const sounds = run.event.clip.sounds;
  const verdict = run.seeds_finished > 0 ? "pass" : "fail";
  const start = plan.intro / plan.fps;
  const end = plan.tapeEnd / plan.fps;
  const context = { run, end, verdict };
  return {
    // The same run always sounds the same, whichever layout renders it.
    seed: fnv(run.run_id),
    crowd: sounds.includes("crowd")
      ? { start, end, verdict, progress: progress(trace, plan, run.event.length_m, start) }
      : null,
    cues: sounds.flatMap((name) => SOURCES[name]?.(context) ?? []),
  };
}
