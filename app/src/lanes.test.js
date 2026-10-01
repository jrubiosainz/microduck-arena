import { describe, expect, it } from "vitest";
import { LANE_CSS } from "./course.js";
import { colourLanes, lanesFor } from "./lanes.js";

describe("lanesFor", () => {
  it("shows only the published solo performance for MicroDuck Got a Talent clips and replays", () => {
    const board = [1, 2, 3].map(rank => ({ run_id: `R${rank}`, you: rank === 2 }));
    expect(lanesFor({ board, event: { id: "got-a-talent", course: "stage" } })).toEqual([board[1]]);
  });
  it("opens on this run, then up to three ranked under it", () => {
    const board = [1, 2, 3, 4, 5, 6].map((rank) => ({ rank, run_id: `R${rank}`, you: rank === 2 }));
    expect(lanesFor({ board }).map((row) => row.run_id)).toEqual(["R2", "R3", "R4", "R5"]);
    expect(lanesFor({ board: board.slice(0, 2) }).map((row) => row.run_id)).toEqual(["R2"]);
  });
});

describe("colourLanes", () => {
  function table(ids) {
    const board = document.createElement("div");
    board.innerHTML = "<table><tbody>" + ids.map((id) =>
      `<tr><td class="tab"><input data-run-id="${id}"></td></tr>`).join("") + "</tbody></table>";
    return board;
  }

  it("gives each lane its row's colour in table order, and keeps the lanes' own order", () => {
    const board = table(["a", "b", "c"]);
    const lanes = colourLanes(board, [{ runId: "c" }, { runId: "a" }]);
    expect(lanes.map((lane) => lane.runId)).toEqual(["c", "a"]);
    expect(lanes.map((lane) => lane.colour)).toEqual([LANE_CSS[1], LANE_CSS[0]]);
    expect(board.querySelector('[data-run-id="a"]').closest(".tab").style.getPropertyValue("--lane")).toBe(LANE_CSS[0]);
    expect(board.querySelector('[data-run-id="b"]').closest(".tab").style.getPropertyValue("--lane")).toBe("");
    for (const lane of lanes) expect(lane.opacity).toBe(1);
  });

  it("still colours a lane whose row a filter has hidden", () => {
    const lanes = colourLanes(table(["a"]), [{ runId: "a" }, { runId: "hidden" }]);
    expect(lanes.map((lane) => lane.colour)).toEqual([LANE_CSS[0], LANE_CSS[1]]);
  });
});
