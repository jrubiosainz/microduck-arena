import { describe, expect, it, vi } from "vitest";
import { renderVote, runningOrder } from "./vote.js";
import { createViewer } from "./viewer.js";
import { getBallotTrace } from "./api.js";
import { LANE_CSS } from "./course.js";

vi.mock("./viewer.js", () => ({ createViewer: vi.fn() }));
vi.mock("./api.js", () => ({
  getMe: vi.fn(async () => ({ signed_in: false })),
  getBallot: vi.fn(async () => {
    const duck = { policy: "self", rig: null, start: null, sound: null };
    // The second performance is a troupe: the author's duck and a borrowed roller.
    const cast = [[duck], [duck, { ...duck, policy: "borrowed", rig: "rollers" }], [duck]];
    return { state: "ballot", ballot: "test", lanes: 3, cast, cast_today: 0, per_day: 20 };
  }),
  getBallotTrace: vi.fn(async (_, lane) => (lane === 1 ? [new Float32Array([1]), new Float32Array([10])] : [new Float32Array([lane])])),
  castVote: vi.fn(),
}));

it("plays MicroDuck Got a Talent ballot entries one at a time and lets the viewer watch each performance", async () => {
  const viewer = { setLanes: vi.fn(), player: { time: 0, duration: 20, playing: true } };
  createViewer.mockResolvedValue(viewer);
  const root = document.createElement("div");
  const event = { id: "got-a-talent", title: "MicroDuck Got a Talent", rig: "legs", course: "stage" };
  await renderVote(root, { event, state: {} });
  // Its three lanes first; the field loaded behind it fetches its own after.
  expect(getBallotTrace.mock.calls.slice(0, 3)).toEqual([["test", 0], ["test", 1], ["test", 2]]);
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => duck.trace[0])).toEqual([0]);
  // Played once, not looped, so the next performance can follow it.
  expect(viewer.setLanes.mock.lastCall[2]).toEqual({ loop: false });
  const buttons = root.querySelectorAll(".act");
  expect(buttons).toHaveLength(3);
  buttons[2].click();
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => duck.trace[0])).toEqual([2]);
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelector(".on-stage").textContent).toBe("On stage3");
  expect(root.querySelectorAll('.vote-pick')).toHaveLength(3);
  // A troupe takes the stage whole, every duck in the ballot's one livery, each on its own rig.
  buttons[1].click();
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => [duck.trace[0], duck.livery, duck.rig])).toEqual([
    [1, "classic", "legs"], [10, "classic", "rollers"],
  ]);
});

describe("runningOrder", () => {
  const pressed = (order) =>
    [...order.element.querySelectorAll(".act")].map((ticket) => ticket.getAttribute("aria-pressed"));

  it("hands out a ticket per performance in its ballot post-it's colour and number, the first on stage", () => {
    const play = vi.fn();
    const order = runningOrder(3, play);
    const tickets = [...order.element.querySelectorAll(".act")];
    expect(tickets.map((ticket) => ticket.querySelector(".act__num").textContent)).toEqual(["1", "2", "3"]);
    expect(tickets.map((ticket) => ticket.style.getPropertyValue("--pick"))).toEqual(LANE_CSS.slice(0, 3));
    expect(tickets[1].getAttribute("aria-label")).toBe("Watch performance 2");
    expect(pressed(order)).toEqual(["true", "false", "false"]);
    expect(play.mock.calls).toEqual([[0]]);
  });

  it("fills the bar of the performance on stage as its replay runs", () => {
    const order = runningOrder(3, () => {});
    order.follow({ time: 5, duration: 20, playing: true });
    expect(order.element.querySelector(".act").style.getPropertyValue("--progress")).toBe("0.25");
  });

  it("puts the next performance on when one ends, and the first again after the last", () => {
    const play = vi.fn();
    const order = runningOrder(3, play);
    const ended = { time: 20, duration: 20, playing: false };
    order.follow(ended);
    expect(pressed(order)).toEqual(["false", "true", "false"]);
    order.follow(ended);
    order.follow(ended);
    expect(pressed(order)).toEqual(["true", "false", "false"]);
    expect(play.mock.calls).toEqual([[0], [1], [2], [0]]);
  });

  it("ticks each performance watched to its end, not one merely skipped", () => {
    const order = runningOrder(3, () => {});
    const tickets = order.element.querySelectorAll(".act");
    tickets[2].click();
    order.follow({ time: 20, duration: 20, playing: false });
    expect([...tickets].map((ticket) => ticket.classList.contains("act--seen"))).toEqual([false, false, true]);
  });

  it("carries on from the performance a click puts on stage", () => {
    const play = vi.fn();
    const order = runningOrder(4, play);
    order.element.querySelectorAll(".act")[2].click();
    order.follow({ time: 20, duration: 20, playing: false });
    expect(pressed(order)).toEqual(["false", "false", "false", "true"]);
    expect(play.mock.calls).toEqual([[0], [2], [3]]);
  });
});
