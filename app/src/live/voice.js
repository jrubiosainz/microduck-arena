// The booth's sound: the plan's notes sung by the microduck's own synthesiser,
// one mono buffer per caption sung shortly before it plays, each started on the
// context's clock from the join offset so every screen sings the same sample at
// the same instant; and the shutter's wind, made in the page.

import { SAMPLE_RATE, singCaption } from "./score.js";

const BREATHS_S = [0, 1.16];
/** A caption is sung this long before it plays: one caption's work at a time, never a whole match's when a screen
 * joins it, which held a phone's page for seconds. */
export const SING_AHEAD_MS = 2000;

async function voiceExports(fetcher) {
  const response = await fetcher("/sound/microduck-voice.wasm");
  if (!response.ok) throw new Error("No voice");
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  return instance.exports;
}

/** The robot's synthesiser, built from app/voice: `sing(seed, note)` renders
 * one note's syllable with that seed's microduck personality. The samples are
 * a view into the synth's memory, good until the next call. */
export async function loadSynth(fetcher = fetch) {
  const { memory, contour, syllable, samples } = await voiceExports(fetcher);
  return (seed, note) => {
    // Asked for first: making room may grow the memory, which detaches older views of it.
    const points = contour(note.contour.length);
    new Float32Array(memory.buffer, points, note.contour.length * 2).set(note.contour.flat());
    const length = syllable(
      seed, note.variant, (note.end_ms - note.start_ms) / 1000, note.held ? 1 : 0,
      note.warble[0], note.warble[1], note.buzz,
    );
    return new Float32Array(memory.buffer, samples(), length);
  };
}

/** The knobs a performance's voice may set, in the order the synth takes them; a knob left out is NaN, the seed's own. */
const KNOBS = ["pitch", "brightness", "buzz", "vibrato", "breath"];
const knobs = (voice = {}) => KNOBS.map((name) => voice[name] ?? NaN);

/** The stage duck's voice in the robot's synthesiser, tuned by a performance's `voice` knobs:
 * `chirp(seed, variant, voice)` is RT's quack, `wheee(seed, variant, segment, voice)` LT's ride
 * (0 its start, 1 its loop), and `song(seed, voice, notes, seconds, { choral, variant })` the whole
 * song from t = 0, its notes as arena/timeline.py sound_of stores them: solo, or with `choral` the
 * duck's part `variant` of a chorus. Each is a copy, kept however many calls follow. */
export async function loadCalls(fetcher = fetch) {
  const { memory, chirp, wheee, notes, song, samples } = await voiceExports(fetcher);
  const copy = (length) => new Float32Array(memory.buffer, samples(), length).slice();
  return {
    chirp: (seed, variant, voice) => copy(chirp(seed, variant, ...knobs(voice))),
    wheee: (seed, variant, segment, voice) => copy(wheee(seed, variant, segment, ...knobs(voice))),
    song(seed, voice, written, seconds, { choral = false, variant = 0 } = {}) {
      // Asked for first: making room may grow the memory, which detaches older views of it.
      const room = notes(written.length);
      new Float64Array(memory.buffer, room, written.length * 6).set(written.flat());
      return copy(song(seed, ...knobs(voice), seconds, choral ? 1 : 0, variant));
    },
  };
}

/** 0.36 s of pink noise between 180 and 4 200 Hz, faded in over 0.1 s and out
 * over the last 0.22 s, peaking at -1 dBFS. Pure, so it is testable. */
export function windGust(random = Math.random, rate = SAMPLE_RATE) {
  const length = Math.round(0.36 * rate);
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, low = 0, high = 0, peak = 0;
  const lowK = (2 * Math.PI * 4200) / rate;
  const highK = (2 * Math.PI * 180) / rate;
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    // Pink, Kellet's three-pole approximation.
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = b0 + b1 + b2 + white * 0.1848;
    low += lowK * (pink - low);
    high += highK * (low - high);
    const t = i / rate;
    const fade = Math.min(t / 0.1, 1, Math.max(0, (0.36 - t) / 0.22));
    out[i] = (low - high) * fade;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const gain = 10 ** (-1 / 20) / (peak || 1);
  for (let i = 0; i < length; i++) out[i] *= gain;
  out[0] = out[length - 1] = 0;
  return out;
}

export function createVoice(context, sing) {
  const gain = context.createGain();
  gain.connect(context.destination);
  let sources = [];
  let timers = []; // a caption's singing, each due SING_AHEAD_MS before it plays
  const wind = context.createBuffer(1, Math.round(0.36 * SAMPLE_RATE), SAMPLE_RATE);
  wind.copyToChannel(windGust(), 0);

  function stop() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    for (const source of sources) {
      source.stop();
      source.disconnect();
    }
    sources = [];
  }

  return {
    start(plan, offsetMs) {
      stop();
      // Every caption from the same instant: the plan's 0 on the context's clock.
      const zero = context.currentTime - offsetMs / 1000;
      // Only what is still to be said is sung, a caption at a time, straight
      // into the buffer it plays from: the memory held is the speech, not the
      // plan's length. A call voices a whole match.
      const say = (caption) => {
        const buffer = context.createBuffer(1, ((caption.end_ms - caption.start_ms) * SAMPLE_RATE) / 1000, SAMPLE_RATE);
        singCaption(plan, caption, sing, buffer.getChannelData(0));
        // Singing takes a moment: a caption already due starts that much
        // further in, so it stays on the clock.
        const at = (context.currentTime - zero) * 1000;
        if (caption.end_ms <= at) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.start(zero + Math.max(caption.start_ms, at) / 1000, Math.max(0, at - caption.start_ms) / 1000);
        sources.push(source);
      };
      for (const caption of plan.captions) {
        if (caption.end_ms <= offsetMs) continue;
        const due = caption.start_ms - offsetMs - SING_AHEAD_MS;
        if (due > 0) timers.push(setTimeout(() => say(caption), due));
        else say(caption);
      }
    },
    stop,
    muted(flag) {
      gain.gain.value = flag ? 0 : 1;
    },
    /** Two breaths with the shutter's sweeps, from `atSeconds` on the context's clock. */
    gust(atSeconds) {
      for (const breath of BREATHS_S) {
        const burst = context.createBufferSource();
        burst.buffer = wind;
        burst.connect(gain);
        burst.start(atSeconds + breath);
      }
    },
  };
}
