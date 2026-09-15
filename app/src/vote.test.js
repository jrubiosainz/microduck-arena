import { describe, expect, it, vi } from "vitest";
import { DEAD_BALLOT_MESSAGE, votePanel } from "./vote.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the voting panel", () => {
  it("offers one button per lane, in the lane's own colour", () => {
    const picks = [];
    const panel = votePanel(
      { state: "ballot", ballot: "tok.mac", lanes: 3, cast_today: 4, per_day: 20 },
      (lane) => picks.push(lane),
    );
    const buttons = [...panel.querySelectorAll("button.vote-pick")];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.style.getPropertyValue("--pick"))).toEqual([
      "#ff7a2f",
      "#8fb8dc",
      "#c8ff2e",
    ]);
    buttons[1].click();
    expect(picks).toEqual([1]);
  });

  it("carries the lane's number on every button, not just its colour", () => {
    // The palette is colour-only otherwise — a deuteranope reading orange
    // beside hi-vis lime gets nothing from `aria-label` either, in a feature
    // whose whole premise is "pick a colour".
    const panel = votePanel({ state: "ballot", ballot: "t.m", lanes: 4, cast_today: 0, per_day: 20 });
    const buttons = [...panel.querySelectorAll("button.vote-pick")];
    expect(buttons.map((b) => b.querySelector(".vote-pick__num").textContent)).toEqual([
      "1", "2", "3", "4",
    ]);
  });

  it("counts down the day's votes", () => {
    const panel = votePanel({ state: "ballot", ballot: "t.m", lanes: 2, cast_today: 4, per_day: 20 });
    expect(panel.querySelector(".vote-count").textContent).toBe("4 / 20 today");
  });

  it("says how many ducks are missing", () => {
    const panel = votePanel({ state: "too-few", have: 1, need: 2 });
    expect(panel.querySelector(".vote-empty").textContent).toBe(
      "Voting needs 2 ducks, and there is 1 so far.",
    );
    expect(panel.querySelector("button.vote-pick")).toBeNull();
  });

  it("uses a plural when it should", () => {
    const panel = votePanel({ state: "too-few", have: 0, need: 4 });
    expect(panel.querySelector(".vote-empty").textContent).toBe(
      "Voting needs 4 ducks, and there are 0 so far.",
    );
  });

  it("closes the booth for the day", () => {
    const panel = votePanel({ state: "quota", cast_today: 20, per_day: 20 });
    expect(panel.querySelector(".vote-empty").textContent).toBe(
      "That is your 20 votes for today. Come back tomorrow.",
    );
  });

  it("shows the way in when signed out", () => {
    const panel = votePanel({ state: "signed-out" });
    expect(panel.querySelector("a.entry__signin").textContent.trim()).toBe(
      "Sign in with Hugging Face",
    );
  });

  it("never leaks a handle, a policy name or a run id, even if the ballot carried one", () => {
    // A real ballot never sends these — the server does not even serialise
    // them — but the guard should hold even if a future change forgot that
    // and started passing them along "to help the voter".
    const leaks = {
      user: "nicolasrabault",
      policy_name: "swagbot-v3",
      run_id: "01HZQKTVXBHJ8P0N5T8W3YFM2R",
    };
    const panel = votePanel({
      state: "ballot",
      ballot: "t.m",
      lanes: 4,
      cast_today: 0,
      per_day: 20,
      ...leaks,
    });
    // outerHTML, not textContent: a leak could just as well land in an
    // attribute (aria-label, title, data-*) as in visible text.
    for (const value of Object.values(leaks)) {
      expect(panel.outerHTML).not.toContain(value);
    }
  });

  it("shows the server's own message when a vote fails, and does not leave the buttons dead", async () => {
    const onPick = vi
      .fn()
      .mockRejectedValue(new Error("That ballot is not valid any more. Ask for a new one."));
    const panel = votePanel(
      { state: "ballot", ballot: "t.m", lanes: 2, cast_today: 0, per_day: 20 },
      onPick,
    );
    const button = panel.querySelector("button.vote-pick");
    button.click();

    // The rejection is handled asynchronously inside the click handler; give
    // its microtasks a turn before asserting on the result.
    await flush();

    expect(panel.querySelector(".vote-status").textContent).toBe(
      "That ballot is not valid any more. Ask for a new one.",
    );
    expect(button.disabled).toBe(false);
  });

  it("can carry a message into a freshly drawn field, not only show one earned by a click", () => {
    // This is what lets `renderVote`'s `next()` recover a dead ballot: it
    // draws a fresh field and relays the reason, rather than leaving the
    // visitor to click a booth that answers 400 forever.
    const panel = votePanel(
      { state: "ballot", ballot: "t.m", lanes: 2, cast_today: 0, per_day: 20 },
      undefined,
      DEAD_BALLOT_MESSAGE,
    );
    const status = panel.querySelector(".vote-status");
    expect(status.textContent).toBe(DEAD_BALLOT_MESSAGE);
    expect(status.className).toBe("vote-status bad");
    // And the field itself is live — the recovery is a real ballot, not a
    // dead end with an apology on it.
    expect(panel.querySelectorAll("button.vote-pick")).toHaveLength(2);
  });

  it("disables every pick while a vote is in flight, so a slow reload does not look dead", () => {
    const onPick = vi.fn(() => new Promise(() => {})); // never resolves
    const panel = votePanel(
      { state: "ballot", ballot: "t.m", lanes: 3, cast_today: 0, per_day: 20 },
      onPick,
    );
    const buttons = [...panel.querySelectorAll("button.vote-pick")];
    buttons[0].click();
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });
});
