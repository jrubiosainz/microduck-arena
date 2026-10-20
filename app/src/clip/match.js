// A cup's match on tape: a title over the waiting ducks, its bouts one after the other at speed, each
// from its settle, and an outro on the winner. Pure, as plan.js, whose actAt and travelAt read this
// plan as they read a run's.

import { CTRL_DT } from "../replay.js";
import { FPS, INTRO_S, OUTRO_S, STRIDE, TRAVEL_S } from "./plan.js";

const round3 = (seconds) => Math.round(seconds * 1000) / 1000;

/**
 * `bouts` are the match's bouts in order, each `{k, settle, steps}`: the frames of its settle and of
 * its trace. Each `span` is a bout's clip frames, `from` up to `to`; each of `bouts` says where its
 * trace starts and ends on the tape, in seconds, after its settle.
 */
export function matchPlan(bouts) {
  const intro = FPS * INTRO_S;
  const spans = [];
  let from = intro;
  for (const { k, settle, steps } of bouts) {
    const to = from + Math.ceil((settle + steps) / STRIDE);
    spans.push({ k, from, to, settle, steps });
    from = to;
  }
  const tapeEnd = from;
  const outro = Math.round(FPS * OUTRO_S);
  const frames = tapeEnd + outro;
  return {
    fps: FPS,
    stride: STRIDE,
    intro,
    travel: FPS * TRAVEL_S,
    outro,
    frames,
    seconds: frames / FPS,
    tapeEnd,
    poster: intro + Math.floor((tapeEnd - intro) * 0.6),
    spans,
    bouts: spans.map(({ k, from, settle, steps }) => {
      const start = round3(from / FPS + settle * CTRL_DT);
      return { k, tape_start_s: start, tape_end_s: round3(start + steps * CTRL_DT) };
    }),
  };
}

/** The bout clip frame `i` shows and its step, counted from the bout's settle: the first bout's
 * first step under the title, the last bout's last step through the outro. */
export function boutAt(plan, i) {
  if (i < plan.intro) return { bout: plan.spans[0].k, step: 0 };
  const span = plan.spans.find((one) => i < one.to) ?? plan.spans.at(-1);
  return { bout: span.k, step: Math.min((i - span.from) * plan.stride, span.settle + span.steps - 1) };
}

/** The bouts each side has won, [a, b], on the tapes ended by clip frame `i`. */
export function scoreAt(plan, match, i) {
  const winners = plan.spans.filter((span) => i >= span.to).map((span) => match.bouts[span.k].winner);
  return ["a", "b"].map((side) => winners.filter((winner) => winner === side).length);
}

/** The words on a match's clip: the cup, who meets whom, and who won by how much. */
export function matchWords(match) {
  const [won, lost] = match.winner === "a" ? match.wins : [...match.wins].reverse();
  return {
    title: `${match.event.title} · Cup #${match.cup}`,
    line: match.title,
    outro: `${match[match.winner].name} wins ${won}–${lost}`,
  };
}
