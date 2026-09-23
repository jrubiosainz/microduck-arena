// Which rows of the board to show.
//
// Filtering only — never re-ranking. A row's `rank` is the place it holds in
// the whole field, and a view that renumbered 1..n would quietly tell someone
// they were third when they were eleventh. Every mode here narrows the list and
// leaves every rank exactly as the server computed it.

/** The three keys the board's header offers. */
export const MODES = ["all", "mine", "top"];

/** How many of the leaders `top` keeps. */
export const TOP_ROWS = 3;

/**
 * The rows to render.
 *
 * Two independent narrowings rather than three exclusive modes:
 *
 * - `top`  — the three leaders
 * - `mine` — your runs
 * - both   — their UNION: the podium AND your runs, which is the view worth
 *            having when you are eleventh. An intersection would be empty in
 *            exactly the case someone turns both on for.
 * - neither — everything. "All" is not a third mode; it is the absence of the
 *            other two, which is why the header's All key turns both off.
 *
 * A provisional row (a trial you just ran, published nowhere) always survives:
 * it is the run you are looking at, and hiding it behind a filter would make
 * the Test button appear to do nothing.
 */
export function visibleRows(rows, { mine = false, top = false, me = null } = {}) {
  if (!mine && !top) return rows.slice();

  const isMine = (row) => Boolean(me) && row.user === me;
  const keep = new Set();
  rows.forEach((row, i) => {
    if (row.provisional) keep.add(i);
    if (top && i < TOP_ROWS) keep.add(i);
    if (mine && isMine(row)) keep.add(i);
  });
  return rows.filter((_, i) => keep.has(i));
}

/** Whether a mode can show anything the user would recognise as theirs. */
export function modeIsUseful(mode, me) {
  return mode !== "mine" || Boolean(me);
}
