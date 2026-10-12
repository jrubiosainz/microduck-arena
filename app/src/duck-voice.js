// The real pad's two triggers on the stage: what the duck's beak and voice do when a performance
// pulls RT or LT (arena/timeline.py reads them; a run, a board row, a ballot lane and a workshop
// evaluation carry them as a track of [t, rt, lt] at each change). The rules are microduck's own,
// padd's and robotd's at e597877: the beak opens to the harder-pulled trigger; RT quacks as it
// crosses PULL on the way up; LT rides the wheee while at or over PULL and its release cuts it; one
// sound at a time, a new quack cutting the last and a quack during a wheee dropped. Pure: the
// viewer and the clip hear the same sounds from it.

import { SAMPLE_RATE } from "./live/score.js";
import { CTRL_DT } from "./replay.js";

/** The voice every performer sings in: a seed of the robot's `sounds` crate, picked by ear. */
export const DUCK_SEED = 28;
/** Where a trigger counts as pulled: padd's SOUND_THRESHOLD. */
export const PULL = 0.3;
/** The beak's travel, closed to wide open: duck-control's −5° to +30°. */
export const MOUTH_TRAVEL = (35 * Math.PI) / 180;
/** How fast the beak follows its trigger: a servo's ease, not a snap. */
const MOUTH_TAU_S = 0.06;
/** A cut sound fades out over this, so it stops without a click. */
const FADE_S = 0.005;
/** The variants of each call in the robot's bank (sounds::variant_count). */
const VARIANTS = { chirp: 12, wheee: 6 };

/** The change a track holds at `t`: its last at or before it. */
function pulledAt(track, t) {
  let held = track[0];
  for (const point of track) {
    if (point[0] > t + 1e-9) break;
    held = point;
  }
  return held;
}

/**
 * The beak's opening, 0 closed to 1 wide open, at each 50 Hz frame of a lane whose trace starts
 * `lead` frames before the performance (a clip's settle, which holds the opening at t = 0). Null
 * without a track, so the lane keeps its beak as the rig made it.
 */
export function mouthTrack(track, frames, lead = 0) {
  if (!track) return null;
  const out = new Float32Array(frames);
  const follow = 1 - Math.exp(-CTRL_DT / MOUTH_TAU_S);
  let open = Math.max(...pulledAt(track, 0).slice(1));
  for (let f = 0; f < frames; f++) {
    const [, rt, lt] = pulledAt(track, Math.max(0, f - lead) * CTRL_DT);
    open += (Math.max(rt, lt) - open) * follow;
    out[f] = open;
  }
  return out;
}

/**
 * Every sound a track makes before `duration` seconds, in order: { tag, variant, start, end }, `end`
 * being where it is cut — the next sound, LT's release, the end of the performance. A quack's own
 * recording may end sooner. The k-th quack plays variant k mod 12 and the k-th wheee k mod 6, so a
 * performance always sounds the same.
 */
export function voiceEvents(track, duration) {
  if (!track) return [];
  const sounds = [];
  const count = { chirp: 0, wheee: 0 };
  const begin = (tag, start) => {
    const last = sounds.at(-1);
    if (last && last.end > start) last.end = start;
    sounds.push({ tag, variant: count[tag]++ % VARIANTS[tag], start, end: duration });
  };
  let rt = 0;
  let riding = false;
  for (const [t, pulledRt, pulledLt] of track) {
    if (t >= duration - 1e-9) break;
    // robotd's order: the wheee first, then the one-shots, which see the ride this instant started.
    if (pulledLt >= PULL && !riding) begin("wheee", t);
    if (pulledLt < PULL && riding) sounds.at(-1).end = t;
    riding = pulledLt >= PULL;
    if (pulledRt >= PULL && rt < PULL && !riding) begin("chirp", t);
    rt = pulledRt;
  }
  return sounds;
}

/**
 * The samples a sound plays, from the robot's synth (`calls`, live/voice.js loadCalls): the quack as
 * recorded, the wheee's start then its loop over and over; cut at its `end`, with a short fade.
 */
export function callSamples(calls, { tag, variant, start, end }, seed = DUCK_SEED) {
  const room = Math.max(1, Math.round((end - start) * SAMPLE_RATE));
  let whole = tag === "chirp" ? calls.chirp(seed, variant) : calls.wheee(seed, variant, 0);
  if (tag === "chirp" && whole.length <= room) return whole;
  if (tag === "wheee") {
    const ride = calls.wheee(seed, variant, 1);
    const grown = new Float32Array(Math.max(room, whole.length));
    grown.set(whole);
    for (let at = whole.length; at < room; at += ride.length) grown.set(ride.subarray(0, room - at), at);
    whole = grown;
  }
  const cut = whole.slice(0, room);
  const fade = Math.min(room, Math.round(FADE_S * SAMPLE_RATE));
  for (let i = 0; i < fade; i++) cut[room - 1 - i] *= i / fade;
  return cut;
}
