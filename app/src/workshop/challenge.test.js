import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCode: vi.fn(async () => ({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 })),
  commitCode: vi.fn(),
  train: vi.fn(async () => ({})),
  getJobs: vi.fn(async () => []),
  stopJob: vi.fn(),
}));
vi.mock("./api.js", () => api);

import { POLL_MS, mountChallenge } from "./challenge.js";

const SPRINT = { id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null, metric: "time",
  length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
const STATUS = { arena: "https://arena.test", gpu: false, challenges: [
  { event: SPRINT, folder: "sprint_2m", task: "S", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [], running: 0 }] };
const account = { get: () => ({ phase: "in", user: "alice", canPay: true }), logIn: vi.fn(), check: vi.fn() };
const TICKET = { id: "first", name: "first", where: "hf-jobs", state: "running", progress: null,
  started: "", run_id: null, dirty: false, checkpoints: [], best: null, published: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("a challenge's page", () => {
  it("heads with the challenge, says which files make it yours, and lists its trainings", async () => {
    api.getJobs.mockResolvedValue([TICKET]);
    const root = document.createElement("div");
    const page = await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "sprint-2m" } });
    expect(root.querySelector(".racetitle").textContent).toBe("2 m Sprint");
    expect(root.querySelector(".raceback").getAttribute("href")).toBe("#/");
    expect(root.querySelector(".yours .terminal-bar").textContent).toContain("sprint_2m");
    expect(root.querySelector(".yours").textContent).toContain("rewards.py");
    expect(root.querySelector(".racecaveat a").href).toBe("https://arena.test/#/e/sprint-2m");
    expect(root.querySelectorAll(".ticket")).toHaveLength(1);
    expect(root.querySelector(".trainings-head .mono-label").textContent).toBe("1 run · 1 training now");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getJobs).toHaveBeenCalledTimes(2);
    page.leave();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(api.getJobs).toHaveBeenCalledTimes(2);
  });

  it("keeps what is typed and the tickets that did not change through the poll", async () => {
    api.getJobs.mockResolvedValue([TICKET]);
    const root = document.createElement("div");
    const page = await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "sprint-2m" } });
    const ticket = root.querySelector(".ticket");
    root.querySelector("input[name=run]").value = "mine";
    await vi.advanceTimersByTimeAsync(POLL_MS);
    page.accountChanged();
    expect(root.querySelector("input[name=run]").value).toBe("mine");
    expect(root.querySelector(".ticket")).toBe(ticket);
    api.getJobs.mockResolvedValue([{ ...TICKET, state: "done" }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(root.querySelector(".ticket .sticker").textContent).toBe("Done");
    page.leave();
  });

  it("says so for a challenge that is not open here", async () => {
    const root = document.createElement("div");
    await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "moon-landing" } });
    expect(root.querySelector(".failed").textContent).toContain("moon-landing");
  });
});
