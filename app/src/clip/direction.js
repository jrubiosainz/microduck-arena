// Ported from Duck Jam, design/sound/stadium-direction.mjs at 2d35443b, trimmed
// to what soundtrack.js uses: `stadiumTransitions`, the reference's explicit-
// target easing for live playback, has no caller here and is dropped. Changed
// here: the crowd surges at the start horn, and a verdict is at full voice as the
// duck reaches the line — Duck Jam's 1.4 s rise put the cheer a second late.
// Shared playback-time direction. Progress must come from the challenge, never
// from elapsed time or a guess about what a robot's coordinates mean.
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }

/** Return intentions at replay seconds (also usable directly by OfflineAudioContext).
 * `end` is the last visible trace frame. `progress` is a time-ordered array of
 * {second, value}, with challenge-normalized values in [0, 1]. Only increases
 * between already observed samples elicit encouragement. A stale signal fades.
 * A pass/fail verdict begins at end; missing evidence means no result emotion.
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
  return second => {
    if (!Number.isFinite(second)) throw new RangeError('Invalid playback time')
    const elapsed = second - end
    const play = end > start ? smooth(second - start) * (1 - smooth(elapsed / 5)) : 0
    // The horn: up in a quarter second, held a little over a second, settled by +3.7 s.
    const since = second - start
    const launch = end > start ? smooth(since / .25) * (1 - smooth((since - 1.2) / 2.5)) : 0
    let encouragement = 0
    for (let i = 1; i < samples.length && samples[i].second <= second; i++) {
      const age = second - samples[i].second
      const increase = Math.max(0, samples[i].value - samples[i - 1].value)
      encouragement = Math.max(encouragement,
        Math.min(1, increase * 4) * smooth(age / .8) * (1 - smooth((age - 1) / 3)))
    }
    encouragement = Math.max(encouragement * play, .9 * launch)
    // Up over the last 0.3 s before the line: a voice hears the intention only as
    // its phrase begins, so the phrases starting at the line already carry it.
    const result = verdict && second >= end - .3
      ? smooth((elapsed + .3) / .3) * (1 - smooth((elapsed - 2.6) / 5)) : 0
    const joy = verdict === 'pass' ? result : 0
    const sadness = verdict === 'fail' ? result : 0
    return {
      action: Math.max(.45 * play, .8 * launch, .9 * joy, .15 * sadness),
      joy, encouragement: Math.max(encouragement, .6 * joy), sadness,
      impact: (verdict === 'fail' ? .45 : 1) * result * (1 - smooth((elapsed - 2.6) / 2.2)),
    }
  }
}
