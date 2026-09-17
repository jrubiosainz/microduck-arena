// The whole soundtrack in one offline render: the stadium's voices under a
// continuous direction, every cue at its instant — a cue in the `room` through
// the stadium's own reverb and echoes, so it rings round the stands with the
// crowd — and a limiter at the end so no sample reaches ±1 (the live programme
// refuses a clip that clips). No segments, no smoothing afterwards, no mixing
// left to ffmpeg.

import { stadiumDirection } from "./direction.js";
import { StadiumAmbience, prepareStadium } from "./stadium.js";

const RATE = 48000;
/** The stadium's own volume scale (0–100). */
const CROWD_VOLUME = 100;
/** Past the stadium's own ceiling: the bed sat at -45 dBFS at 30, under every cue by 25 dB. */
const CROWD_GAIN = 2;
/** Scheduling horizon, from renderStadium: keeps the engine's active nodes bounded. */
const BATCH_S = 0.5;

const fetchWav = (file) => fetch(`/sound/${file}`).then((response) => response.arrayBuffer());

function interleave(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const pcm = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    pcm[2 * i] = left[i];
    pcm[2 * i + 1] = right[i];
  }
  return pcm;
}

async function stadium(context, score, limiter, Context) {
  await prepareStadium(Context);
  const crowd = context.createGain();
  crowd.gain.value = CROWD_GAIN;
  crowd.connect(limiter);
  return new StadiumAmbience(context, {
    direction: stadiumDirection(score.crowd),
    seed: score.seed,
    volume: CROWD_VOLUME,
    destination: crowd,
  });
}

/** Interleaved stereo float32 at 48 kHz, exactly `seconds` long. */
export async function renderSoundtrack(score, seconds, { Context = OfflineAudioContext, load = fetchWav } = {}) {
  const context = new Context(2, Math.ceil(seconds * RATE), RATE);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(context.destination);

  const cues = await Promise.all(
    score.cues.map(async (cue) => ({ ...cue, buffer: await context.decodeAudioData(await load(cue.file)) })),
  );
  const engine = score.crowd ? await stadium(context, score, limiter, Context) : null;
  for (const cue of cues) {
    const source = context.createBufferSource();
    source.buffer = cue.buffer;
    const gain = context.createGain();
    gain.gain.value = cue.gain;
    source.connect(gain);
    // No crowd, no stands to ring round: the cue goes to the mix dry.
    gain.connect(cue.room && engine ? engine.mix : limiter);
    source.start(cue.at);
  }

  if (!engine) return interleave(await context.startRendering());

  // renderStadium's batching: schedule half a second ahead, suspending one
  // render quantum before each horizon, because Chrome rounds suspension
  // times to block boundaries.
  const end = seconds - 0.09;
  const queue = (time) => {
    engine.scheduleUntil(Math.min(time, end));
    if (time >= end) engine.stop(end);
  };
  queue(BATCH_S);
  const pauses = [];
  for (let time = BATCH_S; time < seconds; time += BATCH_S) {
    pauses.push(context.suspend(time - 128 / RATE).then(() => {
      queue(time + BATCH_S);
      return context.resume();
    }));
  }
  try {
    const [buffer] = await Promise.all([context.startRendering(), ...pauses]);
    return interleave(buffer);
  } finally {
    engine.dispose();
  }
}
