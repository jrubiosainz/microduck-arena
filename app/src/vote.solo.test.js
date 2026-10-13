import { expect, it, vi } from "vitest";
import { renderVote } from "./vote.js";
import { createViewer } from "./viewer.js";
import { getBallotTrace } from "./api.js";

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
  const viewer = { setLanes: vi.fn() };
  createViewer.mockResolvedValue(viewer);
  const root = document.createElement("div");
  const event = { id: "got-a-talent", title: "MicroDuck Got a Talent", rig: "legs", course: "stage" };
  await renderVote(root, { event, state: {} });
  expect(getBallotTrace).toHaveBeenCalledTimes(3);
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => duck.trace[0])).toEqual([0]);
  const buttons = root.querySelectorAll('[aria-label="Watch performances individually"] button');
  expect(buttons).toHaveLength(3);
  buttons[2].click();
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => duck.trace[0])).toEqual([2]);
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelectorAll('.vote-pick')).toHaveLength(3);
  // A troupe takes the stage whole, every duck in the ballot's one livery, each on its own rig.
  buttons[1].click();
  expect(viewer.setLanes.mock.lastCall[0][0].ducks.map((duck) => [duck.trace[0], duck.livery, duck.rig])).toEqual([
    [1, "classic", "legs"], [10, "classic", "rollers"],
  ]);
});
