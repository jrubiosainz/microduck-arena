// The booth's sound: the plan's notes sung by the microduck's own synthesiser
// into one buffer, started at the join offset so every screen sings the same
// sample at the same instant; and the shutter's wind, made in the page.

import { SAMPLE_RATE, synthesize } from "./score.js";

const BREATHS_S = [0, 1.16];

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

/** The robot pad's two calls in its own synthesiser: `chirp(seed, variant)` is
 * RT's quack, `wheee(seed, variant, segment)` LT's ride (0 its start, 1 its
 * loop). Each is a copy, kept however many calls follow. */
export async function loadCalls(fetcher = fetch) {
  const { memory, chirp, wheee, samples } = await voiceExports(fetcher);
  const copy = (length) => new Float32Array(memory.buffer, samples(), length).slice();
  return {
    chirp: (seed, variant) => copy(chirp(seed, variant)),
    wheee: (seed, variant, segment) => copy(wheee(seed, variant, segment)),
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
  let source = null;
  const wind = context.createBuffer(1, Math.round(0.36 * SAMPLE_RATE), SAMPLE_RATE);
  wind.copyToChannel(windGust(), 0);

  function stop() {
    source?.stop();
    source?.disconnect();
    source = null;
  }

  return {
    start(plan, offsetMs) {
      stop();
      // Singing the plan takes a moment; it starts that much further in, so it stays on the clock.
      const began = performance.now();
      const pcm = synthesize(plan, sing);
      const buffer = context.createBuffer(2, pcm.length / 2, SAMPLE_RATE);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) data[i] = pcm[i * 2 + channel];
      }
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0, Math.min(offsetMs + performance.now() - began, plan.duration_ms) / 1000);
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
