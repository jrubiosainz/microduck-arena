import { describe, expect, it, vi } from "vitest";
import { votePanel } from "./vote.js";

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

  it("never names a duck, a policy or a person", () => {
    const panel = votePanel({ state: "ballot", ballot: "t.m", lanes: 4, cast_today: 0, per_day: 20 });
    expect(panel.textContent).not.toMatch(/@|policy|run_/i);
  });
});
