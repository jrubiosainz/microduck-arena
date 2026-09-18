// The booth's sound: the plan's notes sung from the two microduck tones into
// one buffer, started at the join offset so every screen sings the same
// sample at the same instant; and the shutter's wind, Duck Jam's
// build-wind.mjs made in the page.

import { SAMPLE_RATE, synthesize } from "./score.js";

const BREATHS_S = [0, 1.16];

export async function loadTones(fetcher = fetch) {
  const [peter, ray] = await Promise.all(
    ["peter", "ray"].map(async (name) => {
      const response = await fetcher(`/sound/commentator-${name}.f32`);
      if (!response.ok) throw new Error(`No voice for ${name}`);
      return new Float32Array(await response.arrayBuffer());
    }),
  );
  return { peter, ray };
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

export function createVoice(context, tones) {
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
      const pcm = synthesize(plan, tones);
      const buffer = context.createBuffer(2, pcm.length / 2, SAMPLE_RATE);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) data[i] = pcm[i * 2 + channel];
      }
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0, Math.min(offsetMs, plan.duration_ms) / 1000);
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
