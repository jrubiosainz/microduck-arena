import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEAD_BALLOT_MESSAGE, renderVote } from "./vote.js";
import { createViewer } from "./viewer.js";
import { castVote, getBallot } from "./api.js";

vi.mock("./viewer.js", () => ({ createViewer: vi.fn() }));
vi.mock("./sound.js", () => ({ play: vi.fn(), isMuted: () => false, toggleMuted: vi.fn() }));
vi.mock("./api.js", () => ({
  getMe: vi.fn(async () => ({ signed_in: false })),
  getBallot: vi.fn(),
  // Each ballot's replays carry its token's first letter, so the stage says which field it plays.
  getBallotTrace: vi.fn(async (token, lane) => [new Float32Array([token.charCodeAt(0) * 10 + lane])]),
  castVote: vi.fn(),
}));

const STAGE = { id: "got-a-talent", title: "MicroDuck Got a Talent", rig: "legs", course: "stage" };
const duck = { policy: "self", rig: null, start: null, sound: null };
const ballot = (token, castToday = 0) => ({
  state: "ballot", ballot: token, lanes: 2, cast: [[duck], [duck]], cast_today: castToday, per_day: 20,
});
const played = (token) => token.charCodeAt(0) * 10;

let viewer;
beforeEach(() => {
  viewer = { setLanes: vi.fn(), player: { time: 0, duration: 20, playing: true } };
  createViewer.mockResolvedValue(viewer);
  getBallot.mockReset();
  castVote.mockReset();
  // A field nobody queued never arrives: the prefetches after a test's last one stay in flight.
  getBallot.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function open() {
  const root = document.createElement("div");
  await renderVote(root, { event: STAGE, state: {} });
  return root;
}

const onStage = () => viewer.setLanes.mock.lastCall[0][0].ducks[0].trace[0];

it("seals the envelope as soon as the vote is counted, while the next field is still loading", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  getBallot.mockResolvedValueOnce(ballot("A"));
  castVote.mockResolvedValueOnce({ points: 1, cast_today: 1 });
  const root = await open();
  vi.useFakeTimers();
  root.querySelector(".vote-pick").click();
  await vi.advanceTimersByTimeAsync(600);
  expect(document.querySelector(".vote-ceremony__envelope--sealed")).not.toBeNull();
});

it("puts the next field on stage once the ceremony is over, not while it plays", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  getBallot.mockResolvedValueOnce(ballot("A")).mockResolvedValueOnce(ballot("B"));
  castVote.mockResolvedValueOnce({ points: 1, cast_today: 1 });
  const root = await open();
  vi.useFakeTimers();
  root.querySelector(".vote-pick").click();
  await vi.advanceTimersByTimeAsync(600);
  expect(document.querySelector(".vote-ceremony__envelope--sealed")).not.toBeNull();
  expect(onStage()).toBe(played("A"));
  await vi.advanceTimersByTimeAsync(5000);
  expect(document.querySelector(".vote-ceremony")).toBeNull();
  expect(onStage()).toBe(played("B"));
});

it("puts the field it loaded during the last one on stage after the vote, its count from the cast", async () => {
  getBallot
    .mockResolvedValueOnce(ballot("A"))
    .mockResolvedValueOnce(ballot("B"))
    .mockResolvedValueOnce(ballot("C"));
  castVote.mockResolvedValueOnce({ points: 1, cast_today: 1 });
  const root = await open();
  root.querySelector(".vote-pick").click();
  await vi.waitFor(() => expect(onStage()).toBe(played("B")));
  expect(root.querySelector(".vote-count").textContent).toBe("1 / 20 today");
});

it("shows the quota panel after the day's last vote, not the field it loaded", async () => {
  getBallot.mockResolvedValueOnce(ballot("A", 19)).mockResolvedValueOnce(ballot("B", 19));
  castVote.mockResolvedValueOnce({ points: 1, cast_today: 20 });
  const root = await open();
  root.querySelector(".vote-pick").click();
  await vi.waitFor(() => expect(root.querySelector(".vote-empty")?.textContent)
    .toBe("That is your 20 votes for today. Come back tomorrow."));
});

it("loads a fresh field rather than the one it already has when the ballot is dead", async () => {
  getBallot
    .mockResolvedValueOnce(ballot("A"))
    .mockResolvedValueOnce(ballot("B"))
    .mockResolvedValueOnce(ballot("C"));
  castVote.mockRejectedValueOnce(new Error(DEAD_BALLOT_MESSAGE));
  const root = await open();
  root.querySelector(".vote-pick").click();
  await vi.waitFor(() => expect(onStage()).toBe(played("C")));
  expect(root.querySelector(".vote-status.bad").textContent).toBe(DEAD_BALLOT_MESSAGE);
});

it("loads the next field again after the vote when loading it ahead failed", async () => {
  getBallot
    .mockResolvedValueOnce(ballot("A"))
    .mockRejectedValueOnce(new Error("The Space is restarting"))
    .mockResolvedValueOnce(ballot("C"));
  castVote.mockResolvedValueOnce({ points: 1, cast_today: 1 });
  const root = await open();
  root.querySelector(".vote-pick").click();
  await vi.waitFor(() => expect(onStage()).toBe(played("C")));
});
