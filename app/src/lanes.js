// Which ducks a stage shows, and in what colour.

import { LANE_CSS } from "./course.js";
import { isStage, isTug } from "./format.js";

/** How many of the ducks ranked just under a publication race beside it. */
export const RIVALS = 3;

/**
 * The lanes a publication opens on: this run first, then the ducks ranked
 * just under it. Shared by the publication page and the clip page, so the
 * video races exactly the ducks the page does. A performance and a bench run
 * play alone: the stage is the troupe's, the bench one duck's against the winch.
 */
export function lanesFor(run) {
  const at = run.board.findIndex((row) => row.you);
  if (isStage(run.event) || isTug(run.event)) return [run.board[at]];
  return [run.board[at], ...run.board.slice(at + 1, at + 1 + RIVALS)];
}

/**
 * Colours belong to leaderboard entries: each lane takes its row's, in table
 * order, and the row's tab takes the same one. A lane whose row a filter has
 * hidden still gets the next colour; a row not on the stage gets no tab. The
 * lanes come back in the order they were given.
 */
export function colourLanes(board, lanes) {
  const byId = new Map(lanes.map((lane) => [lane.runId, lane]));
  let colourIndex = 0;
  for (const row of board.querySelectorAll("tbody tr")) {
    const id = row.querySelector("input[data-run-id]")?.dataset.runId;
    const lane = byId.get(id);
    const tab = row.querySelector(".tab");
    if (lane) {
      lane.colour = LANE_CSS[colourIndex++ % LANE_CSS.length];
      tab.style.setProperty("--lane", lane.colour);
    } else {
      tab.style.removeProperty("--lane");
    }
  }
  for (const lane of lanes) {
    lane.colour ??= LANE_CSS[colourIndex++ % LANE_CSS.length];
    lane.opacity = 1;
  }
  return lanes;
}
