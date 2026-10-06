// The swing that shows the chase camera can be moved: the viewer turns the
// camera through it (viewer.js sweep) while the deck's hand plays the same
// points (deck.js offerOrbit). Out to one side, across to the other and home;
// each point is how far through the swing, then how far the drag is out, -1 to
// 1, and it eases into every turn, as a hand would.

export const SWEEP = [[0, 0], [0.25, 1], [0.75, -1], [1, 0]];
export const SWEEP_SECONDS = 2.4;
export const SWEEP_TURN = (25 * Math.PI) / 180;

/** Where the swing is `seconds` into it, -1 to 1; 0 before and after. Pure. */
export function sweepAt(seconds) {
  const u = seconds / SWEEP_SECONDS;
  const next = SWEEP.findIndex(([at]) => at > u);
  if (next < 1) return 0;
  const [[from, a], [to, b]] = [SWEEP[next - 1], SWEEP[next]];
  return a + ((b - a) * (1 - Math.cos((Math.PI * (u - from)) / (to - from)))) / 2;
}
