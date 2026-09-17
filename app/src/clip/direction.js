// Ported from Duck Jam, design/sound/stadium-direction.mjs at 2d35443b, trimmed
// to what soundtrack.js uses: `stadiumTransitions`, the reference's explicit-
// target easing for live playback, has no caller here and is dropped. Changed
// here: the crowd surges at the start horn and never settles back — it builds
// with the duck's progress — and a verdict is in its voice just before the line,
// as a real crowd sees it coming.
// Shared playback-time direction. Progress must come from the challenge, never
// from elapsed time or a guess about what a robot's coordinates mean.
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }

/** Return intentions at replay seconds (also usable directly by OfflineAudioContext).
 * `end` is the last visible trace frame. `progress` is a time-ordered array of
 * {second, value}, with challenge-normalized values in [0, 1]: the crowd's
 * excitement builds with it. A pass/fail verdict is full 0.2 s before end;
 * missing evidence means no result emotion.
 */
export function stadiumDirection({ start = 0, end = 0, progress = [], verdict = null } = {}) {
  if (!Number.isFinite(end) || end < 0) throw new RangeError('Invalid trace end')
  if (!Number.isFinite(start) || start < 0 || start > end) throw new RangeError('Invalid trace start')
  if (![null, 'pass', 'fail'].includes(verdict)) throw new RangeError('Invalid verdict')
  const samples = progress.map(sample => ({ ...sample }))
  for (let i = 0; i < samples.length; i++) {
    const { second, value } = samples[i]
    if (!Number.isFinite(second) || second < 0 || second > end ||
        !Number.isFinite(value) || value < 0 || value > 1 ||
        (i > 0 && second <= samples[i - 1].second)) throw new RangeError('Invalid progress sample')
  }
  /** How far down the course the duck is, between the samples either side. */
  const along = second => {
    const next = samples.findIndex(sample => sample.second > second)
    if (next === 0) return 0
    if (next === -1) return samples.at(-1)?.value ?? 0
    const [a, b] = [samples[next - 1], samples[next]]
    return a.value + (b.value - a.value) * (second - a.second) / (b.second - a.second)
  }
  return second => {
    if (!Number.isFinite(second)) throw new RangeError('Invalid playback time')
    const elapsed = second - end
    const result = verdict ? smooth((elapsed + .8) / .6) * (1 - smooth((elapsed - 2.6) / 5)) : 0
    const sadness = verdict === 'fail' ? result : 0
    // The horn: up in a quarter second, then held and building until the tape
    // ends — or until a fall silences it.
    const hype = end > start
      ? smooth((second - start) / .25) * (1 - smooth(elapsed / 5)) * (1 - sadness) : 0
    const near = along(second)
    const joy = verdict === 'pass' ? Math.max(result, .6 * near * near * hype) : 0
    return {
      action: Math.max((.8 + .2 * near) * hype, .9 * joy, .15 * sadness),
      joy, encouragement: Math.max((.9 + .1 * near) * hype, .6 * joy), sadness,
      impact: (verdict === 'fail' ? .45 : 1) * result * (1 - smooth((elapsed - 2.6) / 2.2)),
    }
  }
}
