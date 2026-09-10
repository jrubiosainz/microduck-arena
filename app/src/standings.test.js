import { describe, expect, it } from "vitest";
import { insertProvisional } from "./standings.js";

const published = (score, seeds = 5, name = `p${score}`) => ({
  rank: 0,
  user: "someone",
  policy_name: name,
  score,
  seeds_finished: seeds,
  seeds_total: 5,
  run_id: `run-${name}`,
});

const trial = (score, seeds = 5) => ({
  policy_name: "trial",
  score,
  command_vx: 0.55,
  seeds_finished: seeds,
  seeds_total: 5,
});

describe("insertProvisional", () => {
  it("leaves the board alone when there is no trial", () => {
    const rows = insertProvisional([published(18), published(22)], null);
    expect(rows.map((r) => r.provisional)).toEqual([false, false]);
  });

  it("puts a fast trial at the top", () => {
    const rows = insertProvisional([published(18), published(22)], trial(15));
    expect(rows.map((r) => r.policy_name)).toEqual(["trial", "p18", "p22"]);
    expect(rows[0].provisional).toBe(true);
  });

  it("slots a middling trial into place", () => {
    const rows = insertProvisional([published(18), published(22)], trial(20));
    expect(rows.map((r) => r.policy_name)).toEqual(["p18", "trial", "p22"]);
  });

  it("puts a slow trial at the bottom", () => {
    const rows = insertProvisional([published(18), published(22)], trial(30));
    expect(rows.map((r) => r.policy_name)).toEqual(["p18", "p22", "trial"]);
  });

  it("keeps a published row ahead of a trial that merely equals it", () => {
    // It is on the board; the trial is not.
    const rows = insertProvisional([published(18)], trial(18));
    expect(rows.map((r) => r.policy_name)).toEqual(["p18", "trial"]);
  });

  it("ranks a finishing trial above a published DNF", () => {
    const rows = insertProvisional([published(50, 0, "faller")], trial(25));
    expect(rows.map((r) => r.policy_name)).toEqual(["trial", "faller"]);
  });

  it("puts a trial that finished nothing last, whatever its score", () => {
    // A DNF is scored at the time limit, which can look better than a slow
    // finisher — it still belongs below one.
    const rows = insertProvisional([published(55)], trial(50, 0));
    expect(rows.map((r) => r.policy_name)).toEqual(["p55", "trial"]);
  });

  it("shows a trial on an empty board", () => {
    const rows = insertProvisional([], trial(19));
    expect(rows).toHaveLength(1);
    expect(rows[0].provisional).toBe(true);
    expect(rows[0].rank).toBe(1);
  });

  it("renumbers the ranks so the standing reads coherently", () => {
    const rows = insertProvisional([published(18), published(22)], trial(20));
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("never re-orders the published rows", () => {
    // The server's ordering is authoritative; this only finds a gap in it.
    const board = [published(18), published(22), published(30)];
    const rows = insertProvisional(board, trial(25));
    const stillPublished = rows.filter((r) => !r.provisional).map((r) => r.policy_name);
    expect(stillPublished).toEqual(board.map((r) => r.policy_name));
  });

  it("carries the trial's own commanded speed into its row", () => {
    // The sweep gives every policy a different best speed, so a trial row that
    // dropped it would show a blank in the one column that says how the time
    // was reached.
    const rows = insertProvisional([published(18)], trial(12));
    const provisional = rows.find((r) => r.provisional);
    expect(provisional.command_vx).toBe(0.55);
  });
});
