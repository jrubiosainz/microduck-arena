// The reveal: the author's first look at a result, as a sequence of beats.
//
// `revealFor` and `climbPlan` are pure. `reveal` drives the DOM the page built,
// one act at a time, on design/motion.css's animationend events; aborting the
// signal jumps every wait to its end, and `settle` puts the page in the state
// plain mode renders directly.

import { climb, confetti, flipTiles, rollCounter, slam } from "./animation.js";
import { credit, shower } from "./points.js";
import { followCounter, play } from "./sound.js";

/** Whether this visit reveals: the author, a result never seen, motion allowed. */
export function revealFor(run, me, reducedMotion = false) {
  return Boolean(me?.user) && me.user === run.user && !run.seen && !reducedMotion;
}

/**
 * The board before and after the climb.
 *
 * `board` is the field the server sent, in board order, one row `you`. Before
 * the climb you sit in the last slot and the rows under you stand one place
 * higher — the board as it was before your run — so every row is renumbered to
 * match. The end state is the field as sent. Same array twice when nothing is
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

/** Renumber the rows of the table in `pegRows`; a row a filter has hidden is left alone. */
export function setRanks(pegRows, order) {
  for (const row of order) {
    const cell = pegRows.get(row.run_id)?.querySelector(".rank");
    if (cell) cell.textContent = String(row.rank);
  }
}

/**
 * Play the reveal on a page run.js built.
 *
 * Every box stands in its place from the first frame — the empty scoreboard,
 * the board with you at the bottom, the receipts you have not earned yet —
 * because the page is exactly one window tall and anything that leaves the
 * flow hands its height to the stage, which makes the picture jump mid-beat.
 * So a beat unveils content, it never inserts it.
 *
 * It starts with the replay rather than after it: the author came for the
 * result, not to sit through the run first. In order: the celebration, the
 * stamp, the time, the climb, and the points as showers of stars. `onSeen` is
 * called once, when the theatre ends or is skipped — not when the page is left mid-way
 * (`signal.reason === "leave"`), so the dot stays for a result that was not
 * actually seen.
 */
export async function reveal(parts, show, signal) {
  const { page, chip, chipFlip, facts, scoreboard, stamp, flip, yourScore } = parts;
  const { pegboard, pegRows, cards, share } = parts;
  const { run, plan, receipts, startPoints, score, onSeen } = show;
  const act = (name) => {
    page.dataset.act = name;
  };
  // Only the scrolling fallback needs this: on a page that fits the window it
  // scrolls nothing. Instant, never smooth — `shower` measures the sticker the
  // moment it appears, and a smooth scroll still travelling then spawned every
  // star below the fold.
  const bring = (box) => box.scrollIntoView({ block: "center", behavior: "instant" });
  const unveil = (node) => node.classList.remove("veiled");

  const settle = () => {
    act("rest");
    unveil(stamp);
    flip.replaceChildren(...flipTiles(score));
    unveil(facts);
    unveil(yourScore);
    for (const card of cards) unveil(card);
    unveil(share);
    setRanks(pegRows, plan.end);
    pegboard.replaceChildren(...plan.end.map((row) => pegRows.get(row.run_id)));
    chipFlip.replaceChildren(...flipTiles(startPoints + receipts.reduce((s, r) => s + r.points, 0)));
    chip.classList.remove("jolt");
    if (signal.reason !== "leave") onSeen();
  };

  try {
    if (run.seeds_finished > 0) {
      act("celebrate");
      play("win");
      await confetti(page, 48, signal);
      if (signal.aborted) return;
    }

    // The stamp lands on the corner of the scoreboard, which takes the recoil.
    act("verdict");
    bring(scoreboard);
    unveil(facts);
    unveil(stamp);
    await slam(stamp, { support: scoreboard, signal, contact: () => play("stamp") });
    if (signal.aborted) return;

    // The real number replaces the zeros, then rolls to itself; once it has, it
    // goes up on the board, and only then does the row carrying it climb.
    act("time");
    flip.replaceChildren(...flipTiles(score));
    const tile = flip.querySelector(".flip-digit");
    const silence = tile ? followCounter(tile) : () => {};
    await rollCounter(flip, signal);
    silence();
    if (signal.aborted) return;
    unveil(yourScore);

    if (plan.start !== plan.end) {
      act("climb");
      bring(pegboard);
      play("climb");
      play("chirp");
      setRanks(pegRows, plan.end);
      const rows = plan.end.map((row) => pegRows.get(row.run_id));
      await climb(pegboard, rows, pegRows.get(run.run_id), signal);
      if (signal.aborted) return;
    }

    act("points");
    bring(cards[0] ?? pegboard);
    for (const [i, card] of cards.entries()) {
      unveil(card);
      await shower(card, chip, receipts[i].points, signal);
      if (signal.aborted) return;
      await credit(chip, receipts[i].points, signal);
      if (signal.aborted) return;
    }
  } finally {
    settle();
  }
}
