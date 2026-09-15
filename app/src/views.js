// Which rows of the board to show.
//
// Filtering only — never re-ranking. A row's `rank` is the place it holds in
// the whole field, and a view that renumbered 1..n would quietly tell someone
// they were third when they were eleventh. Every mode here narrows the list and
// leaves every rank exactly as the server computed it.

export const MODES = ["top", "mine", "all"];

/** How many of the leaders each mode keeps. */
const LEADERS = { top: 5, mine: 0, all: Infinity };

/**
 * The rows to render.
 *
 * - `top`  — the five leaders, plus your own best if it is not among them
 * - `mine` — your runs only, plus the three leaders for context
 * - `all`  — everything
 *
 * A provisional row (a trial you just ran, published nowhere) always survives:
 * it is the run you are looking at, and hiding it behind a filter would make
 * the Test button appear to do nothing.
 */
export function visibleRows(rows, { mode = "top", me = null } = {}) {
  if (!MODES.includes(mode)) mode = "top";
  const mine = (row) => Boolean(me) && row.user === me;

  if (mode === "all") return rows.slice();

  const keep = new Set();
  rows.forEach((row, i) => {
    if (row.provisional) keep.add(i);
  });

  if (mode === "mine") {
    // Your runs, with the podium above them so a time has something to mean.
    rows.forEach((row, i) => {
      if (mine(row) || i < 3) keep.add(i);
    });
  } else {
    // top: the leaders, and your best if you are not already among them.
    rows.forEach((_, i) => {
      if (i < LEADERS.top) keep.add(i);
    });
    const best = rows.findIndex(mine);
    if (best !== -1) keep.add(best);
  }

  return rows.filter((_, i) => keep.has(i));
}

/** Whether a mode can show anything the user would recognise as theirs. */
export function modeIsUseful(mode, me) {
  return mode !== "mine" || Boolean(me);
}
