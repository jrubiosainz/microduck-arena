// The performer's voice on a live stage: the sounds duck-voice.js lists, played on the replay's own
// clock, one at a time as on the robot. A jump — the loop coming round, a scrub, new lanes — stops
// what plays and starts what the new time is inside, from where it is: a wheee resumes mid-ride.
// Nothing waits on a sound: no Web Audio, a context the browser keeps suspended or a muted Arena
// leave the replay playing in silence.

import { callSamples } from "./duck-voice.js";
import { isMuted } from "./sound.js";

const RATE = 48000;
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
        }
        clips = sounds.map((sound) => {
          const samples = callSamples(calls, sound);
          const buffer = context.createBuffer(1, samples.length, RATE);
          buffer.copyToChannel(samples, 0);
          return { start: sound.start, end: sound.start + samples.length / RATE, buffer };
        });
      }).catch(() => {});
    },

    /** Called every frame with the replay's time, or null while it does not play. */
    follow(seconds) {
      const jumped = seconds === null || seconds < last || seconds - last > JUMP_S;
      if (seconds !== null) last = seconds;
      const active = seconds === null || muted()
        ? -1
        : clips.findIndex((clip) => clip.start <= seconds && seconds < clip.end);
      if (active === playing && !jumped) return;
      stop();
      if (active < 0) return;
      if (context.state !== "running") {
        context.resume().catch(() => {});
        return;
      }
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
      context?.close().catch(() => {});
    },
  };
}
