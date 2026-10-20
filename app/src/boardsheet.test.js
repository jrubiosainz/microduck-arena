import { describe, expect, it, vi } from "vitest";
import { boardsheetMarkup, wireBoardsheet } from "./boardsheet.js";

const event = { id: "sprint-2m", title: "2 m Sprint", metric: "mean_finish_time" };
const rows = [1, 2, 3, 4, 5].map((n) => ({
  rank: n, user: `u${n}`, policy_name: `p${n}`, score: 10 + n, command_vx: 0.4,
  seeds_finished: 5, seeds_total: 5, run_id: `r${n}`, submitted_at: "2026-09-03T10:00:00Z",
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// jsdom's click() does not fire change on a checkbox; a hand does both.
const tick = (box) => {
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change"));
};
const ticked = (board) =>
  [...board.querySelectorAll("input[type=checkbox]:checked")].map((box) => box.dataset.runId);
const listed = (board) => board.querySelectorAll("tbody tr").length;

async function sheet(options = {}) {
  const root = document.createElement("div");
  root.innerHTML = boardsheetMarkup;
  const onRace = vi.fn(async () => {});
  const wired = wireBoardsheet(root, {
    event, me: "u2", rows: async () => rows, opening: () => ["r2", "r3"], onRace, ...options,
  });
  await wired.paint();
  return { root, board: root.querySelector("#board"), onRace, wired };
}

describe("the board sheet", () => {
  it("replaces the MicroDuck Got a Talent solo performer when another row is selected", async () => {
    const { root, board, wired, onRace } = await sheet({ event: { ...event, id: "got-a-talent", course: "stage" } });
    expect(root.querySelector(".pickall").hidden).toBe(true);
    expect(ticked(board)).toEqual(["r2"]);
    tick(board.querySelector('input[data-run-id="r3"]'));
    expect(ticked(board)).toEqual(["r3"]);
    expect([...wired.selection]).toEqual(["r3"]);
    expect(onRace).toHaveBeenLastCalledWith(["r3"], expect.any(Map));
  });
  it("puts one bench run on the stage at a time, with no box to put them all", async () => {
    const TUG = { id: "tug-of-war", title: "Tug of War", course: "tug", metric: "mean_hold_force" };
    const { root, board } = await sheet({ event: TUG });
    expect(root.querySelector(".pickall").hidden).toBe(true);
    expect(ticked(board)).toEqual(["r2"]);
  });
  it("is one piece of paper: the picks and the filters, then the table", () => {
    const root = document.createElement("div");
    root.innerHTML = boardsheetMarkup;
    const top = root.querySelector(".boardsheet > .boardtop");
    expect([...top.children].map((n) => n.className)).toEqual(["pickall", "modes"]);
    expect(root.querySelector(".boardsheet > #board")).not.toBeNull();
  });

  it("opens on the lanes the page names, and races them", async () => {
    const { board, onRace } = await sheet();
    expect(ticked(board)).toEqual(["r2", "r3"]);
    expect(onRace).toHaveBeenCalledWith(["r2", "r3"], expect.any(Map));
  });

  it("lists the top three until All is pressed", async () => {
    const { root, board } = await sheet();
    expect(listed(board)).toBe(3);
    root.querySelector('[data-mode="all"]').click();
    await settle();
    expect(listed(board)).toBe(5);
  });

  it("can open on everything instead, and says so on the keys", async () => {
    const { root, board } = await sheet({ filters: { mine: false, top: false } });
    expect(listed(board)).toBe(5);
    expect([...root.querySelectorAll(".modes button")].map((b) => b.getAttribute("aria-pressed")))
      .toEqual(["true", "false", "false"]);
  });

  it("ticks one run on or off and keeps the others, through a filter change", async () => {
    const { root, board, onRace } = await sheet({ filters: { mine: false, top: false } });
    tick(board.querySelector('input[data-run-id="r5"]'));
    await settle();
    expect(onRace).toHaveBeenLastCalledWith(["r2", "r3", "r5"], expect.any(Map));
    tick(board.querySelector('input[data-run-id="r2"]'));
    await settle();
    expect(onRace).toHaveBeenLastCalledWith(["r3", "r5"], expect.any(Map));
    root.querySelector('[data-mode="top"]').click();
    await settle();
    expect(listed(board)).toBe(3);
    root.querySelector('[data-mode="all"]').click();
    await settle();
    expect(ticked(board)).toEqual(["r3", "r5"]);
  });

  it("puts every row shown on the stage from the one box above them", async () => {
    const { root, board, onRace } = await sheet();
    const all = root.querySelector(".pickall-box");
    tick(all);
    await settle();
    expect(ticked(board)).toEqual(["r1", "r2", "r3"]);
    expect(onRace).toHaveBeenLastCalledWith(["r2", "r3", "r1"], expect.any(Map));
    tick(all);
    await settle();
    expect(ticked(board)).toEqual([]);
  });

  it("drops the Mine key when nobody is signed in", async () => {
    const { root } = await sheet({ me: null });
    expect(root.querySelector('[data-mode="mine"]')).toBeNull();
  });

  it("can be made inert and live again, for a reveal", async () => {
    const { root, board, wired } = await sheet();
    wired.setInert(true);
    expect(board.querySelector("input").disabled).toBe(true);
    expect(root.querySelector('[data-mode="all"]').disabled).toBe(true);
    wired.setInert(false);
    expect(board.querySelector("input").disabled).toBe(false);
  });
});
