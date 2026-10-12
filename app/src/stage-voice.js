// The performer's voice on a live stage: the sounds duck-voice.js lists, played on the replay's own
// clock, one at a time as on the robot. A jump — the loop coming round, a scrub, new lanes — stops
// what plays and starts what the new time is inside, from where it is: a wheee resumes mid-ride.
// Nothing waits on a sound: no Web Audio, a muted Arena or a context the browser keeps suspended
// until a gesture (the first click or key resumes it) leave the replay playing in silence.

import { callSamples } from "./duck-voice.js";
import { SAMPLE_RATE } from "./live/score.js";
import { isMuted } from "./sound.js";

/** A step longer than this between two frames is a jump, not playback. */
const JUMP_S = 0.25;
/** The voice under the replay, as the vote's cues sit (sound.js: 0.4–0.6). */
const GAIN = 0.6;

export function createStageVoice(loadCalls, { makeContext = () => new AudioContext(), muted = isMuted } = {}) {
  let loaded = null;
  let context = null;
  let output = null;
  let clips = [];
  let version = 0;
  let playing = -1;
  let source = null;
  let last = 0;

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

  function stop() {
    if (source) {
      try {
        source.stop();
      } catch {
        // Already ended: nothing to stop.
      }
    }
    source = null;
    playing = -1;
  }

  return {
    /** The sounds of the lane now on the stage (duck-voice.js voiceEvents); [] for none. */
    set(sounds) {
      stop();
      clips = [];
      const mine = ++version;
      if (!sounds.length) return;
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
        clips = sounds.map((sound) => {
          const samples = callSamples(calls, sound);
          const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
          buffer.copyToChannel(samples, 0);
          return { start: sound.start, end: sound.start + samples.length / SAMPLE_RATE, buffer };
        });
      }).catch(() => {});
    },

    /** Called every frame with the replay's time, or null while it does not play. */
    follow(seconds) {
      const jumped = seconds === null || seconds < last || seconds - last > JUMP_S;
      if (seconds !== null) last = seconds;
      const active = seconds === null || !clips.length || muted()
        ? -1
        : clips.findIndex((clip) => clip.start <= seconds && seconds < clip.end);
      if (active === playing && !jumped) return;
      stop();
      if (active < 0) return;
      if (context.state !== "running") return;
      try {
        source = context.createBufferSource();
        source.buffer = clips[active].buffer;
        source.connect(output);
        source.start(0, seconds - clips[active].start);
        playing = active;
      } catch {
        source = null;
      }
    },

    dispose() {
      stop();
      version++;
      stopWaitingForGesture();
      context?.close().catch(() => {});
    },
  };
}
