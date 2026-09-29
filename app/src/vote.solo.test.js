import { expect, it, vi } from "vitest";
import { renderVote } from "./vote.js";
import { createViewer } from "./viewer.js";
import { getBallotTrace } from "./api.js";

vi.mock("./viewer.js", () => ({ createViewer: vi.fn() }));
vi.mock("./api.js", () => ({
  getMe: vi.fn(async () => ({ signed_in: false })),
  getBallot: vi.fn(async () => ({ state: "ballot", ballot: "test", lanes: 3, cast_today: 0, per_day: 20 })),
  getBallotTrace: vi.fn(async (_, lane) => new Float32Array([lane])),
  castVote: vi.fn(),
}));

it("plays swag ballot entries one at a time and lets the viewer watch each performance", async () => {
  const viewer = { setLanes: vi.fn() };
  createViewer.mockResolvedValue(viewer);
  const root = document.createElement("div");
  const event = { id: "swag-contest", title: "Swag Contest", rig: "legs" };
  await renderVote(root, { event, state: {} });
  expect(getBallotTrace).toHaveBeenCalledTimes(3);
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].trace[0]).toBe(0);
  const buttons = root.querySelectorAll('[aria-label="Watch performances individually"] button');
  expect(buttons).toHaveLength(3);
  buttons[2].click();
  expect(viewer.setLanes.mock.lastCall[0]).toHaveLength(1);
  expect(viewer.setLanes.mock.lastCall[0][0].trace[0]).toBe(2);
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelectorAll('.vote-pick')).toHaveLength(3);
});
