// Shared clock for the audience, its speech bubbles and its recorded voices.
const random = (n) =>
  ((Math.imul(n + 71, 1664525) + 1013904223) >>> 0) / 4294967296;
const smooth = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
export function olaAt(seconds) {
  const cycle = Math.floor(Math.max(0, seconds) / 28);
  const start = cycle * 28 + 3 + random(cycle * 9137) * 5;
  return {
    cycle,
    start,
    phase: seconds - start,
    reverse: random(cycle * 731 + 41) > 0.5,
  };
}
export function standAmount(seconds, position) {
  const wave = olaAt(seconds);
  const t = wave.phase - (wave.reverse ? 1 - position : position) * 3.6;
  return smooth(t / 0.55) * (1 - smooth((t - 1.25) / 0.7));
}
function speechAt(seconds, slot, count) {
  const period = Math.floor(seconds / 5.5);
  const seed = period * 9283 + slot * 1379;
  const age = seconds - period * 5.5 - .6 - random(seed) * 2.8;
  if (!count || random(seed + 947) < .3) return null;
  return {
    seat: Math.floor(random(seed + 337) * count),
    word: random(seed + 1987) < .5 ? "GO!" : "QUACK!",
    age,
  };
}
export function bubbleAt(seconds, slot, count) {
  const cue = speechAt(seconds, slot, count);
  if (!cue || cue.age < 0 || cue.age > 1.8) return null;
  return { seat: cue.seat, word: cue.word,
    opacity: smooth(cue.age / .15) * (1 - smooth((cue.age - 1.5) / .3)) };
}

// The same emotions drive the soundtrack and the fraction of standing fans.
// Seat thresholds are scattered, with slow individual changes between cheers.
export function crowdStanding(seconds, positions, mood = {}) {
  // Average the last .6 seconds of reactions, even when rendering out of order.
  // A sudden cheer can never replace a seated pose in a single frame.
  const samples = Array.from({ length: 13 }, (_, i) => {
    const time = seconds - i * .05;
    const { joy = 0, encouragement = 0, sadness = 0 } =
      typeof mood === "function" ? mood(time) : mood;
    return { time, fraction: Math.min(1, .06 + .32 * encouragement + .94 * joy) * (1 - sadness) };
  });
  const amounts = positions.map((position, i) => {
    const threshold = .08 + .62 * random(i * 9283 + 191);
    const reaction = samples.reduce((sum, { time, fraction }) => {
      const drift = .04 * Math.sin(time * .65 + i * 2.39996);
      return sum + smooth((fraction - threshold + drift) / .26) * smooth(time / .6);
    }, 0) / samples.length;
    return Math.max(standAmount(seconds, position), reaction);
  });
  for (let slot = 0; slot < 3; slot++) {
    const cue = speechAt(seconds, slot, positions.length);
    if (!cue) continue;
    const rise = smooth((cue.age + .5) / .5) * (1 - smooth((cue.age - 1.8) / .5));
    amounts[cue.seat] = Math.max(amounts[cue.seat], rise);
  }
  return amounts;
}

// Nasal duck chorus: an elongated OU rising into an open A, with vibrato.
export function scheduleOla(context, destination, at) {
  const nodes = [];
  for (let i = 0; i < 4; i++) {
    const start = at + i * 0.45,
      end = start + 3.8;
    const voice = context.createOscillator(),
      vibrato = context.createOscillator();
    const depth = context.createGain(),
      envelope = context.createGain();
    voice.type = "sawtooth";
    voice.frequency.setValueAtTime(185 + i * 23, start);
    voice.frequency.linearRampToValueAtTime(285 + i * 19, start + 1.8);
    voice.frequency.linearRampToValueAtTime(155 + i * 17, end);
    vibrato.frequency.value = 8 + i;
    depth.gain.value = 12;
    vibrato.connect(depth);
    depth.connect(voice.frequency);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(0.055, start + 0.2);
    envelope.gain.setValueAtTime(0.055, end - 0.6);
    envelope.gain.linearRampToValueAtTime(0, end);
    envelope.connect(destination);
    for (const [ou, aa] of [
      [350, 850],
      [880, 1250],
    ]) {
      const formant = context.createBiquadFilter();
      formant.type = "bandpass";
      formant.Q.value = 5;
      formant.frequency.setValueAtTime(ou, start);
      formant.frequency.linearRampToValueAtTime(aa, start + 2.4);
      voice.connect(formant);
      formant.connect(envelope);
      nodes.push(formant);
    }
    voice.start(start);
    voice.stop(end);
    vibrato.start(start);
    vibrato.stop(end);
    nodes.push(voice, vibrato, depth, envelope);
  }
  return () =>
    nodes.forEach((node) => {
      if (node.stop) {
        try {
          node.stop();
        } catch {}
      }
      node.disconnect();
    });
}
