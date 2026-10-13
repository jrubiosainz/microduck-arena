// The performer's voice on a live stage: its song as one take from t = 0 and its calls one at a time
// (duck-voice.js), played on the replay's own clock. A jump — the loop coming round, a scrub, new
// lanes — stops what plays and starts what the new time is inside, from where it is: a wheee resumes
// mid-ride, the song mid-phrase. Nothing waits on a sound: no Web Audio, a muted Arena or a context
// the browser keeps suspended until a gesture (the first click or key resumes it) leave the replay
// playing in silence.

import { callSamples, songSamples, voiceEvents } from "./duck-voice.js";
import { SAMPLE_RATE } from "./live/score.js";

/** A step longer than this between two frames is a jump, not playback. */
const JUMP_S = 0.25;
/** The voice under the replay, as the vote's cues sit (sound.js: 0.4–0.6). */
const GAIN = 0.6;

export function createStageVoice(loadCalls, { makeContext = () => new AudioContext(), muted }) {
  let loaded = null;
  let context = null;
  let output = null;
  let clips = [];
  let song = null;
  let version = 0;
  let last = 0;
  // Two parts, each playing one buffer at a time: the calls, and the song (its only clip is 0).
  const calling = { playing: -1, source: null };
  const singing = { playing: -1, source: null };

  // A suspended context only starts from a resume() asked inside a gesture.
  const gestures = ["pointerdown", "keydown"];
  function resume() {
    context.resume().catch(() => {});
  }
  function stopWaitingForGesture() {
    for (const type of gestures) window.removeEventListener(type, resume, true);
    context?.removeEventListener("statechange", onStateChange);
  }
  function onStateChange() {
    if (context.state === "running") stopWaitingForGesture();
  }

  function halt(part) {
    if (part.source) {
      try {
        part.source.stop();
      } catch {
        // Already ended: nothing to stop.
      }
    }
    part.source = null;
    part.playing = -1;
  }

  /** Has `part` play clip `index` (-1: nothing) from `offset` seconds into `buffer`, unless it already does and the clock did not jump. */
  function steer(part, index, jumped, buffer, offset) {
    if (index === part.playing && !jumped) return;
    halt(part);
    if (index < 0 || context.state !== "running") return;
    try {
      part.source = context.createBufferSource();
      part.source.buffer = buffer;
      part.source.connect(output);
      part.source.start(0, offset);
      part.playing = index;
    } catch {
      part.source = null;
    }
  }

  function bufferOf(samples) {
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  return {
    /** The performer now on the stage: how it sounds (duck-voice.js), or null, and how many seconds its trace performs. */
    set(sound, duration) {
      halt(calling);
      halt(singing);
      clips = [];
      song = null;
      const mine = ++version;
      const events = voiceEvents(sound, duration);
      if (!events.length && !sound?.song) return;
      loaded ??= loadCalls();
      loaded.then((calls) => {
        if (mine !== version) return;
        if (!context) {
          context = makeContext();
          output = context.createGain();
          output.gain.value = GAIN;
          output.connect(context.destination);
          if (context.state !== "running") {
            for (const type of gestures) window.addEventListener(type, resume, true);
            context.addEventListener("statechange", onStateChange);
          }
        }
        clips = events.map((event) => {
          const samples = callSamples(calls, event, sound.voice);
          return { start: event.start, end: event.start + samples.length / SAMPLE_RATE, buffer: bufferOf(samples) };
        });
        const sung = songSamples(calls, sound, duration);
        song = sung && { end: sung.length / SAMPLE_RATE, buffer: bufferOf(sung) };
      }).catch(() => {});
    },

    /** Called every frame with the replay's time, or null while it does not play. */
    follow(seconds) {
      const jumped = seconds === null || seconds < last || seconds - last > JUMP_S;
      if (seconds !== null) last = seconds;
      const live = seconds !== null && !muted();
      const call = live ? clips.findIndex((clip) => clip.start <= seconds && seconds < clip.end) : -1;
      steer(calling, call, jumped, clips[call]?.buffer, seconds - clips[call]?.start);
      steer(singing, live && song && seconds < song.end ? 0 : -1, jumped, song?.buffer, seconds);
    },

    dispose() {
      halt(calling);
      halt(singing);
      version++;
      stopWaitingForGesture();
      context?.close().catch(() => {});
    },
  };
}
