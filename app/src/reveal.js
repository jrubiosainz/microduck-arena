// The reveal: the author's first look at a result, as a sequence of beats.
//
// `revealFor` and `climbPlan` are pure. `reveal` drives the DOM the page built,
// one act at a time, on design/motion.css's animationend events; aborting the
// signal jumps every wait to its end, and `settle` puts the page in the state
// plain mode renders directly.

import { climb, confetti, ended, flipTiles, fly, rollCounter, slam } from "./animation.js";
import { cue, followCounter } from "./sound.js";

/** Whether this visit reveals: the author, a result never seen, motion allowed. */
export function revealFor(run, me, reducedMotion = false) {
  return Boolean(me?.user) && me.user === run.user && !run.seen && !reducedMotion;
}

/**
 * The pegboard before and after the climb.
 *
 * `board` is the window the server sent, in board order, one row `you`. Before
 * the climb you sit in the last slot and the rows under you stand one place
 * higher — the board as it was before your run — so every row is renumbered to
 * match. The end state is the window as sent. Same array twice when nothing is
 * under you: there is nothing to climb.
 */
export function climbPlan(board) {
  const at = board.findIndex((row) => row.you);
  const under = board.slice(at + 1);
  if (!under.length) return { start: board, end: board };
  const start = [
    ...board.slice(0, at),
    ...under.map((row) => ({ ...row, rank: row.rank - 1 })),
    { ...board[at], rank: under[under.length - 1].rank },
  ];
  return { start, end: board };
}

export function setRanks(pegRows, order) {
  for (const row of order) {
    pegRows.get(row.run_id).querySelector(".pegboard-rank").textContent = String(row.rank);
  }
}

/**
 * Play the reveal on a page run.js built.
 *
 * `raced` resolves when the author's lane reaches its last frame. `onSeen` is
 * called once, when the theatre ends or is skipped — not when the page is left
 * mid-way (`signal.reason === "leave"`), so the dot stays for a result that was
 * not actually seen.
 */
export async function reveal(parts, show, signal) {
  const { page, chip, chipFlip, score, stamp, crt, flip } = parts;
  const { boardBox, pegboard, pegRows, pointsBox, stickers } = parts;
  const { run, plan, receipts, raced, startPoints, onSeen } = show;
  const act = (name) => {
    page.dataset.act = name;
  };
  let total = startPoints;

  const settle = () => {
    act("rest");
    score.hidden = stamp.hidden = boardBox.hidden = pointsBox.hidden = false;
    for (const sticker of stickers) sticker.hidden = false;
    setRanks(pegRows, plan.end);
    pegboard.replaceChildren(...plan.end.map((row) => pegRows.get(row.run_id)));
    chipFlip.replaceChildren(...flipTiles(startPoints + receipts.reduce((s, r) => s + r.points, 0)));
    chip.classList.remove("jolt");
    if (signal.reason !== "leave") onSeen();
  };

  try {
    act("race");
    await raced;
    if (signal.aborted) return;

    if (run.seeds_finished > 0) {
      act("celebrate");
      cue("win");
      await confetti(page, 48, signal);
      if (signal.aborted) return;
    }

    act("verdict");
    score.hidden = false;
    score.scrollIntoView({ block: "center", behavior: "smooth" });
    await slam(stamp, { support: crt, signal, contact: () => cue("stamp") });
    if (signal.aborted) return;

    act("time");
    const tile = flip.querySelector(".flip-digit");
    const silence = tile ? followCounter(tile) : () => {};
    await rollCounter(flip, signal);
    silence();
    if (signal.aborted) return;

    boardBox.hidden = false;
    if (plan.start !== plan.end) {
      act("climb");
      boardBox.scrollIntoView({ block: "center", behavior: "smooth" });
      cue("climb");
      cue("chirp");
      setRanks(pegRows, plan.end);
      const rows = plan.end.map((row) => pegRows.get(row.run_id));
      await climb(pegboard, rows, pegRows.get(run.run_id), signal);
      if (signal.aborted) return;
    }

    act("points");
    pointsBox.hidden = false;
    pointsBox.scrollIntoView({ block: "center", behavior: "smooth" });
    for (const [i, sticker] of stickers.entries()) {
      sticker.hidden = false;
      await fly(sticker, chip, signal);
      if (signal.aborted) return;
      total += receipts[i].points;
      chipFlip.replaceChildren(...flipTiles(total));
      // The class was removed one iteration ago; fly()'s measurement in between
      // flushed that removal, which is what lets adding it again restart the beat.
      chip.classList.add("jolt");
      await Promise.all([ended(chip, "jolt", "", signal), rollCounter(chipFlip, signal)]);
      chip.classList.remove("jolt");
      if (signal.aborted) return;
    }
  } finally {
    settle();
  }
}
