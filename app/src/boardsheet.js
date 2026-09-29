// The board as one sheet of paper: the picks and the filters on top, the
// table under them. The challenge page and a publication's both hang it under
// their stage, so ticking a row means the same thing on both — that run is on
// the stage — and the lanes are picked, kept and raced by one rule.

import { buildRows, renderBoard, setAllLanes, tiersByRunId } from "./board.js";
import { modeIsUseful, visibleRows } from "./views.js";

export const boardsheetMarkup = `
  <div class="boardsheet">
    <span class="flyer-tape"></span>
    <div class="boardtop">
      <label class="pickall" title="Put every row shown on the stage, or take them all off">
        <input type="checkbox" class="pickall-box">
        <span>Put on the stage</span>
      </label>
      <div class="modes" role="group" aria-label="Which runs the table lists">
        <button data-mode="all" aria-pressed="false">All</button>
        <button data-mode="mine" aria-pressed="false">Mine</button>
        <button data-mode="top" aria-pressed="true">Top 3</button>
      </div>
    </div>
    <div id="board"></div>
  </div>`;

/** The lanes a fresh board opens on: the first three finishers (board.js). */
export const podium = (rows) =>
  buildRows(rows).filter((row) => row.selected && row.runId).map((row) => row.runId);

/**
 * Wire the sheet.
 *
 * `rows()` gives the board's rows in the server's order;
 * `opening(rows)` names the runs on the stage before anyone
 * has ticked a box; `onRace(runIds, tiers)` puts them there. `filters` is
 * where the keys start — Top 3 unless a page says otherwise. Returns `paint`,
 * which re-reads the rows and redraws, and `setInert`, for a page that has to
 * hold the table still for a while.
 */
export function wireBoardsheet(
  root,
  { event, me, rows, opening, onRace, onWithdraw = null, filters = { mine: false, top: true } },
) {
  const sheet = root.querySelector(".boardsheet");
  const board = sheet.querySelector("#board");
  const solo = event.id === "swag-contest";
  sheet.querySelector(".pickall").hidden = solo;
  // Two narrowings rather than three modes: Mine and Top each turn on and off
  // on their own and compose, and All is the state where neither is on.
  const narrowing = { ...filters };
  // The run ids on the stage. Null until the first board says which lanes it
  // opens on, a Set from then on — and the page's from then on, not the
  // table's. The table is rebuilt from scratch on every filter and every
  // publish, and reading the lanes back off the boxes it just drew would
  // re-pick them each time: filter to your own runs, tick them, go back to the
  // whole board, and the board had quietly gone back to its own opening three.
  let selection = null;
  let tiers = new Map();

  // Nothing of yours to list when nobody is signed in, and a key that can only
  // empty the table is worse than no key. Taken out before the list is read,
  // so nothing below is holding a button that is no longer on the page.
  if (!modeIsUseful("mine", me)) sheet.querySelector('.modes button[data-mode="mine"]')?.remove();
  const modeButtons = [...sheet.querySelectorAll(".modes button")];
  const showFilters = () => {
    for (const button of modeButtons) {
      const on =
        button.dataset.mode === "all"
          ? !narrowing.mine && !narrowing.top
          : narrowing[button.dataset.mode];
      button.setAttribute("aria-pressed", String(on));
    }
  };
  showFilters();
  for (const button of modeButtons) {
    button.addEventListener("click", async () => {
      const key = button.dataset.mode;
      if (key === "all") {
        narrowing.mine = false;
        narrowing.top = false;
      } else {
        narrowing[key] = !narrowing[key];
      }
      showFilters();
      await paint();
    });
  }

  const shown = () =>
    [...board.querySelectorAll("input[type=checkbox]")].map((box) => box.dataset.runId);
  // One box, above the column of lane boxes it ticks: every row the table is
  // SHOWING goes on the stage, or comes off it. A checkbox and not a button
  // because it ticks checkboxes, and labelled, because what ticking a box on
  // this page MEANS — that run appears on the stage — is not something the
  // boxes can say for themselves. The rows it cannot see keep their lanes.
  const pickAll = sheet.querySelector(".pickall-box");
  pickAll.addEventListener("change", () => {
    const onScreen = setAllLanes(board, pickAll.checked);
    if (pickAll.checked) for (const runId of onScreen) selection.add(runId);
    else for (const runId of shown()) selection.delete(runId);
    onRace([...selection], tiers);
  });
  const showPickAll = () => {
    const boxes = [...board.querySelectorAll("input[type=checkbox]")];
    const ticked = boxes.filter((box) => box.checked).length;
    // Ticked only when everything shown is on the stage. No dash for "some":
    // an empty box is the honest answer to "is everything ticked", and the
    // rows below already say which ones are.
    pickAll.checked = boxes.length > 0 && ticked === boxes.length;
  };

  async function paint() {
    const merged = await rows();
    tiers = tiersByRunId(merged);
    if (selection === null) selection = new Set(solo ? opening(merged).slice(0, 1) : opening(merged));
    // A run that has been withdrawn since the last paint keeps no lane.
    const live = new Set(merged.map((row) => row.run_id).filter(Boolean));
    for (const runId of selection) if (!live.has(runId)) selection.delete(runId);

    renderBoard(
      board,
      // Filtered, never re-ranked: visibleRows narrows the list and leaves every
      // rank exactly as the server computed it.
      { event, rows: visibleRows(merged, { ...narrowing, me }) },
      {
        selected: selection,
        onSelectionChange: (runIds) => {
          if (solo) {
            const picked = runIds.find(id => !selection.has(id));
            selection = new Set(picked ? [picked] : runIds.slice(0, 1));
            for (const box of board.querySelectorAll("input[data-run-id]")) box.checked = selection.has(box.dataset.runId);
            return onRace([...selection], tiers);
          }
          // The rows on screen are the only ones this can speak for: the rest
          // of the selection is not in the DOM to be read.
          const onScreen = new Set(shown());
          for (const runId of selection) if (onScreen.has(runId)) selection.delete(runId);
          for (const runId of runIds) selection.add(runId);
          showPickAll();
          return onRace([...selection], tiers);
        },
        me,
        onWithdraw,
      },
    );
    showPickAll();
    await onRace([...selection], tiers);
  }

  return {
    paint,
    setInert(inert) {
      for (const control of sheet.querySelectorAll("input, .modes button")) {
        control.disabled = inert;
      }
    },
    get selection() {
      return selection;
    },
    get tiers() {
      return tiers;
    },
  };
}
