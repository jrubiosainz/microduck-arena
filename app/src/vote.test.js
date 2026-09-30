import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMuted, setMuted } from "./sound.js";
import { DEAD_BALLOT_MESSAGE, votePanel } from "./vote.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const ballot = (lanes) => ({ state: "ballot", ballot: "t.m", lanes, cast_today: 0, per_day: 20 });

// Node 25's own experimental `localStorage` global has no working `setItem`
// under jsdom (see brightness.test.js) -- sound.js already survives that by
// design, but a test that wants to see a mute choice actually stick needs a
// store that works, not the broken one.
function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

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
    const link = panel.querySelector("a");
    expect(link.textContent.trim()).toBe("Sign in with Hugging Face");
    expect(link.classList.contains("signin-button")).toBe(true);
  });

  it("never leaks a handle, a policy name or a run id, even if the ballot carried one", () => {
    // A real ballot never sends these — the server does not even serialise
    // them — but the guard should hold even if a future change forgot that
    // and started passing them along "to help the voter".
    const leaks = {
      user: "nicolasrabault",
      policy_name: "talentbot-v3",
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

describe("the speaker toggle", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterEach(() => {
    setMuted(false);
    vi.unstubAllGlobals();
  });

  it("is labelled for a screen reader and flips the mute flag", () => {
    const panel = votePanel(ballot(2));
    const toggle = panel.querySelector(".vote-mute");
    expect(toggle.getAttribute("aria-label")).toBe("Mute vote sounds");
    toggle.click();
    expect(isMuted()).toBe(true);
    expect(toggle.getAttribute("aria-label")).toBe("Unmute vote sounds");
  });
});

describe("the ballot ceremony", () => {
  // jsdom has no `matchMedia` at all, which vote.js's own fallback already
  // reads as "reduced motion" -- see runCeremony's guard. These tests are
  // about the animated path, so they say so explicitly rather than lean on
  // that fallback; the "still votes under reduced motion" test below is the
  // one that exercises the fallback's actual meaning.
  const realMatchMedia = window.matchMedia;
  let audioCalls;

  beforeEach(() => {
    audioCalls = [];
    class FakeAudio {
      constructor(src) {
        this.src = src;
      }
      play() {
        audioCalls.push(this.src);
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("localStorage", fakeStorage());
    vi.useFakeTimers();
    window.matchMedia = () => ({ matches: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.matchMedia = realMatchMedia;
    setMuted(false);
    document.body.replaceChildren();
  });

  it("still draws each pick as a numbered post-it", () => {
    const panel = votePanel(ballot(4));
    const picks = [...panel.querySelectorAll("button.vote-pick")];
    expect(picks).toHaveLength(4);
    expect(picks.map((p) => p.querySelector(".vote-pick__num").textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("plays press, then stamp, in that order, once the server confirms the vote", async () => {
    // The stars and the counter that follow the stamp sequence on CSS animation
    // events, which jsdom never fires; they are checked in the browser.
    const onPick = vi.fn().mockResolvedValue({ points: 2, cast_today: 1 });
    const panel = votePanel(ballot(2), onPick);
    panel.querySelector("button.vote-pick").click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(audioCalls).toEqual(["/sound/press.wav", "/sound/stamp.wav"]);
  });

  it("plays press, and never stamp or points, when the vote fails", async () => {
    const onPick = vi.fn().mockRejectedValue(new Error("nope"));
    const panel = votePanel(ballot(2), onPick);
    panel.querySelector("button.vote-pick").click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(audioCalls).toEqual(["/sound/press.wav"]);
  });

  it("mutes every cue, on success, when sound is off", async () => {
    setMuted(true);
    const onPick = vi.fn().mockResolvedValue(undefined);
    const panel = votePanel(ballot(2), onPick);
    panel.querySelector("button.vote-pick").click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(audioCalls).toEqual([]);
  });

  it("still votes under reduced motion, skipping the ceremony entirely", async () => {
    window.matchMedia = () => ({ matches: true });
    const onPick = vi.fn().mockResolvedValue(undefined);
    const panel = votePanel(ballot(2), onPick);
    panel.querySelector("button.vote-pick").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onPick).toHaveBeenCalledWith(0);
    expect(audioCalls).toEqual([]);
    expect(document.querySelector(".vote-ceremony")).toBeNull();
  });
});
