// What the clip sounds like, decided before a frame is drawn: the crowd's
// direction and every cue at its instant. Pure. Each sound source is a
// function here and a name in the event's [clip] sounds.

import { voiceEvents } from "../duck-voice.js";
import { isStage } from "../format.js";
import { CTRL_DT, frameAt } from "../replay.js";

/** Cue gains, measured on a real render: the horn 5 dB over the crowd's surge,
 * the victory level with the crowd's cheer, and the fall — over a crowd gone
 * quiet — just over the stamp, and the duck's voice at the synth's own level, under the limiter. */
const GAINS = { horn: 2, stamp: 0.6, victory: 7, fall: 0.45, voice: 1 };
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

const SOURCES = {
  // Nicolas's samples carry their own stadium echo.
  horn: ({ start }) => [{ at: start, file: "air-horn.mp3", gain: GAINS.horn }],
  verdict: ({ end, verdict }) => [
    { at: end, file: "stamp.wav", gain: GAINS.stamp },
    verdict === "pass"
      ? { at: end + 0.16, file: "microduck-victory-echo.mp3", gain: GAINS.victory }
      : { at: end + 0.16, file: "microduck-fall.wav", gain: GAINS.fall },
  ],
};

export function clipScore({ run, plan, trace, sound }) {
  const sounds = run.event.clip.sounds;
  const verdict = run.seeds_finished > 0 ? "pass" : "fail";
  const start = plan.intro / plan.fps;
  const end = plan.tapeEnd / plan.fps;
  const context = { start, end, verdict };
  // The performance starts on the tape after the settle; its length is the author's trace, cut short or not.
  const performed = start + plan.settle * CTRL_DT;
  const voice = voiceEvents(sound, (plan.steps - plan.settle) * CTRL_DT)
    .map((call) => ({ at: performed + call.start, call, gain: GAINS.voice }));
  return {
    // The same run always sounds the same, whichever layout renders it.
    seed: fnv(run.run_id),
    crowd: sounds.includes("crowd")
      // A stage has no course to go down: its crowd answers the verdict alone.
      ? { start, end, verdict, progress: isStage(run.event) ? [] : progress(trace, plan, run.event.length_m, start) }
      : null,
    cues: [...sounds.flatMap((name) => SOURCES[name]?.(context) ?? []), ...voice],
  };
}
