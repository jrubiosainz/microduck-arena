// What the duel's page (duel/main.js) makes of the match `arena duel A B --watch`
// played (arena/duel_watch.py duel_summary): each bout as the viewer's event and
// lanes, its clock, and what the referee said of it, in words. Pure, so it is
// testable; the page itself needs WebGL.
//
// A bout's `winner` is a deck, 0 at -x, as arena/duel.py keeps it, and
// `on_deck[d]` names who stood on deck d; the match's two policies are `names`,
// A then B, and swap decks from one bout to the next. Deck 0 is the left one
// from where the camera stands (duel-venue.js duelCamera).

import { LANE_COLORS, LANE_CSS } from "../course.js";
import { frameAt, frameCount, leadIn } from "../replay.js";

// A's colours and B's, on the ducks and on the page: the Arena's first two
// lanes', each in the livery that goes with it — cream for A, sky for B.
const LIVERIES = ["classic", "blue"];
export const LETTERS = ["A", "B"];

/** Which of the match's policies stood on deck `d` of `bout`: 0 for A, 1 for B. */
export const policyOn = (summary, bout, d) => summary.names.indexOf(bout.on_deck[d]);

/** A policy's colour on the page, as a CSS colour: its ducks' lane colour. */
export const policyColour = (policy) => LANE_CSS[policy];

/**
 * Where a bout's horn and its decision fall in its replay's seconds. The replay
 * opens on the settle (replay.js leadIn), whose last frame is the bout's start,
 * and its trace's frame f is the bout (f + 1) control steps in, so the bout's
 * second `s` is the replay's (settle frames - 1) * ctrl_dt + s.
 */
export function boutTimes(summary, bout) {
  const start = (bout.settle_frames - 1) * summary.ctrl_dt;
  return { horn_s: Math.max(0, start), decided_s: Math.max(0, start + bout.time_s) };
}

/**
 * The viewer's event for bout `k` (viewer.js setLanes): `duel` is the course
 * the venue is built from (duel-venue.js), and the horn, the decision, the
 * winner and how it ended set the crowd's direction over the replay. Given the
 * bout's `lanes` (boutLanes), `span` is the stretch of the course they cover
 * (boutSpan), which the venue's camera keeps in the picture.
 */
export function boutEvent(summary, k, lanes = null) {
  const bout = summary.bouts[k];
  return {
    course: "duel",
    id: summary.id,
    title: summary.title,
    rig: summary.rig,
    duel: summary.course,
    ...boutTimes(summary, bout),
    winner: bout.winner,
    end: bout.end,
    span: lanes ? boutSpan(lanes) : null,
  };
}

/**
 * How far along x a bout's ducks go, in their traces' world frame, whose
 * origin is the middle of the pit: [the farthest either trunk goes to -x, the
 * farthest to +x], settle and all; null with no frames to go by.
 */
export function boutSpan(lanes) {
  let low = Infinity;
  let high = -Infinity;
  for (const { trace } of lanes) {
    for (let f = 0; f < frameCount(trace); f++) {
      const x = frameAt(trace, f)[0];
      low = Math.min(low, x);
      high = Math.max(high, x);
    }
  }
  return low <= high ? [low, high] : null;
}

/**
 * Bout `k`'s two lanes, deck 0's duck first, as the viewer takes them: each
 * from its settle, so both ducks are seen to drop onto their decks and stand
 * before the horn. `settles` and `traces` are by deck, as the server sends
 * them. Both are drawn solid: neither is anyone's ghost.
 */
export function boutLanes(summary, k, settles, traces) {
  const bout = summary.bouts[k];
  return [0, 1].map((d) => {
    const policy = policyOn(summary, bout, d);
    return {
      trace: leadIn(settles[d], traces[d], bout.settle_frames),
      name: bout.on_deck[d],
      livery: LIVERIES[policy],
      colour: LANE_COLORS[policy],
      opacity: 1,
    };
  });
}

const seconds = (s) => `${s.toFixed(2)} s`;

/**
 * A bout in a line of the match's list, its policies by letter: who won, and
 * how — `pit` when a duck dropped off its deck, `fall` when one went down by
 * the fall rule, `fault` when one's action was not a number, `bell` at the time
 * limit, and `void` when the simulation diverged.
 */
export function boutLine(summary, bout) {
  const letter = (d) => LETTERS[policyOn(summary, bout, d)];
  const at = seconds(bout.time_s);
  if (bout.end === "void") return `Void at ${at}: the simulation diverged`;
  const won = bout.winner === 0 || bout.winner === 1;
  if (bout.end === "pit") {
    return won
      ? `${letter(bout.winner)} won: ${letter(1 - bout.winner)} into the pit at ${at}`
      : `Both into the pit at ${at}: a draw`;
  }
  if (bout.end === "fall") {
    return won
      ? `${letter(bout.winner)} won: ${letter(1 - bout.winner)} down at ${at}`
      : `Both down at ${at}: a draw`;
  }
  if (bout.end === "fault") {
    return won
      ? `${letter(bout.winner)} won: ${letter(1 - bout.winner)} faulted at ${at}`
      : `Both faulted at ${at}: a draw`;
  }
  return won ? `${letter(bout.winner)} won at the bell` : "A draw at the bell";
}

/**
 * What the stage says once the referee has decided a bout: a stamp — the
 * winner's, in its colour, over the deck it won from, or a draw's or a void's
 * in the middle — and the verdict in full, with the policies' names.
 */
export function verdict(summary, bout) {
  const won = bout.winner === 0 || bout.winner === 1;
  if (bout.end === "void") {
    return { stamp: "Void", colour: null, deck: null, line: "Void: the simulation diverged, so nobody won it" };
  }
  if (!won) {
    const draws = {
      pit: "Both fell into the pit: a draw",
      fall: "Both went down: a draw",
      fault: "Both faulted, their actions not numbers: a draw",
    };
    return { stamp: "Draw", colour: null, deck: null, line: draws[bout.end] ?? "A draw at the bell" };
  }
  const [winner, loser] = [bout.on_deck[bout.winner], bout.on_deck[1 - bout.winner]];
  const wins = {
    pit: `${winner} wins: ${loser} fell into the pit`,
    fall: `${winner} wins: ${loser} went down`,
    fault: `${winner} wins: ${loser} faulted, its action not a number`,
  };
  return {
    stamp: "Wins",
    colour: policyColour(policyOn(summary, bout, bout.winner)),
    deck: bout.winner,
    line: wins[bout.end] ?? `${winner} wins at the bell`,
  };
}

/**
 * The bout's clock at the replay's second `t`: nothing before the horn, then
 * the seconds since it, stopped where the referee decided the bout — the tail
 * after a fall is the pit, not the pull.
 */
export function boutClock(summary, bout, t) {
  const { horn_s } = boutTimes(summary, bout);
  return Math.min(bout.time_s, Math.max(0, t - horn_s));
}

/** A point total as the scoreboard shows it: whole, or with its half. */
export const points = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
