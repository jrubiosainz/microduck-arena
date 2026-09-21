// The lanes a publication's stage shows: this run first, then the ducks
// ranked just under it. Shared by the publication page and the clip page, so
// the video races exactly the ducks the page does.

/** How many of the ducks ranked just under this run race beside it. */
export const RIVALS = 3;

export function lanesFor(run) {
  const at = run.board.findIndex((row) => row.you);
  return [run.board[at], ...run.board.slice(at + 1, at + 1 + RIVALS)];
}
