// The shared clock: the server's now_ms against a local before and after. The
// sample with the smallest round trip has the least room for error; every
// screen that samples the same server lands within its round trip of the same
// programme position. The estimate is kept over a short window.

const WINDOW = 5;

export function estimateClock(samples) {
  const best = samples.reduce((a, b) => (b.after - b.before < a.after - a.before ? b : a));
  return { offset: best.server - (best.before + best.after) / 2 };
}

export function createClock(now = () => Date.now()) {
  const samples = [];
  let offset = 0;
  return {
    get ready() {
      return samples.length > 0;
    },
    sample(before, server, after) {
      samples.push({ before, server, after });
      if (samples.length > WINDOW) samples.shift();
      offset = estimateClock(samples).offset;
    },
    position() {
      return now() + offset;
    },
  };
}
