import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getCode: vi.fn(async () => ({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 })),
  commitCode: vi.fn(),
  train: vi.fn(async () => ({})),
  getJobs: vi.fn(async () => []),
  stopJob: vi.fn(),
}));
vi.mock("./api.js", () => api);

import { POLL_MS, mountChallenge } from "./challenge.js";

const SPRINT = { id: "sprint-2m", title: "2 m Sprint", category: "race", vote: null, metric: "time",
  length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
const STATUS = { arena: "https://arena.test", gpu: false, challenges: [
  { event: SPRINT, folder: "sprint_2m", task: "S", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [], running: 0 }] };
const TALENT_CHALLENGE = { event: { id: "got-a-talent", title: "MicroDuck Got a Talent", category: "showcase", course: "stage",
  metric: "votes", rig: "legs", time_limit_s: 20, vote: { ballot_min: 2 } }, folder: "got_a_talent", task: "T",
  recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [], running: 0 };
const TUG_CHALLENGE = { event: { id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug",
  metric: "mean_hold_force", rig: "legs", length_m: 4, pit_m: 0.3, bench: { top_n: 7 }, vote: null }, folder: "tug_of_war",
  task: "W", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [], running: 0 };
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

  it("keeps each ticket's card, and a running one's Stop and its focus, while its answer changes", async () => {
    const a = { ...TICKET, id: "a", name: "a", progress: { done: 10, total: 3000 } };
    const b = { ...TICKET, id: "b", name: "b", state: "done" };
    const c = { ...TICKET, id: "c", name: "c" };
    const names = () => [...root.querySelectorAll(".ticket__name")].map((h) => h.textContent);
    api.getJobs.mockResolvedValue([a, b]);
    const root = document.createElement("div");
    document.body.append(root);
    const page = await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "sprint-2m" } });
    const [cardA, cardB] = root.querySelectorAll(".ticket");
    const stop = cardA.querySelector(".ticket__stop");
    stop.focus();
    api.getJobs.mockResolvedValue([c, { ...a, progress: { done: 20, total: 3000 } },
      { ...b, published: { entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s" } }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(names()).toEqual(["c", "a", "b"]);
    const [, nowA, nowB] = root.querySelectorAll(".ticket");
    expect(nowA).toBe(cardA);
    expect(nowA.querySelector(".progress span").textContent).toBe("20 / 3000");
    expect(nowA.querySelector(".ticket__stop")).toBe(stop);
    expect(document.activeElement).toBe(stop);
    expect(nowB).toBe(cardB);
    expect(nowB.querySelector(".ticket__pub").textContent).toBe("★ Published · 4.89 s on the Arena");
    api.getJobs.mockResolvedValue([{ ...a, progress: { done: 30, total: 3000 } }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(names()).toEqual(["a"]);
    expect(root.querySelector(".ticket")).toBe(cardA);
    expect(document.activeElement).toBe(stop);
    api.getJobs.mockResolvedValue([{ ...a, state: "done", progress: null }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(root.querySelector(".ticket")).toBe(cardA);
    expect(cardA.querySelector(".ticket__stop")).toBeNull();
    page.leave();
    root.remove();
  });

  it("asks again only once the last answer is in, and a left page draws nothing more", async () => {
    api.getJobs.mockResolvedValue([TICKET]);
    const root = document.createElement("div");
    const page = await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "sprint-2m" } });
    let answer;
    api.getJobs.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getJobs).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.getJobs).toHaveBeenCalledTimes(2);
    answer([TICKET]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getJobs).toHaveBeenCalledTimes(3);
    page.leave();
    answer([{ ...TICKET, state: "done" }]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.getJobs).toHaveBeenCalledTimes(3);
    expect(root.querySelector(".ticket .sticker").textContent).toBe("Training");
  });

  it("never lets an older answer bring a stopped training back", async () => {
    api.getJobs.mockResolvedValue([TICKET]);
    const root = document.createElement("div");
    const page = await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "sprint-2m" } });
    const answers = [];
    api.getJobs.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    await vi.advanceTimersByTimeAsync(POLL_MS); // a poll is out when Stop is pressed
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    api.stopJob.mockResolvedValue({});
    root.querySelector(".ticket__stop").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.stopJob).toHaveBeenCalledWith("sprint-2m", "first");
    expect(answers).toHaveLength(2);
    answers[1]([{ ...TICKET, state: "stopped" }]);
    await vi.advanceTimersByTimeAsync(0);
    answers[0]([TICKET]); // the poll sent before Stop answers last
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector(".ticket .sticker").textContent).toBe("Stopped");
    page.leave();
    confirm.mockRestore();
  });

  it("takes the Settings from challenge.toml again when a new commit lands", async () => {
    const withKnob = { ...STATUS, challenges: [{ ...STATUS.challenges[0],
      knobs: [{ name: "forward_reward", label: "Follow the speed order", value: 2, min: 0.5, max: 5, group: "reward" }] }] };
    api.getJobs.mockResolvedValue([]);
    const root = document.createElement("div");
    const page = await mountChallenge(root, { status: withKnob, account, route: { view: "challenge", event: "sprint-2m" } });
    const field = (name) => root.querySelector(`[name=${name}]`);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getStatus).not.toHaveBeenCalled(); // the same commit: nothing to read again
    field("seed").value = "7";
    const edited = { ...withKnob.challenges[0], recipe: { num_envs: 4096, max_iterations: 10, seed: 1 },
      knobs: [{ ...withKnob.challenges[0].knobs[0], value: 4 }] };
    api.getStatus.mockResolvedValue({ ...withKnob, challenges: [edited] });
    api.getCode.mockResolvedValue({ fork: null, changes: [], identity: true, commit: "def5678", unpushed: 0 });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect([field("max_iterations").value, field("forward_reward").value, field("seed").value]).toEqual(["10", "4", "7"]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    page.leave();
    api.getCode.mockResolvedValue({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 });
  });

  it("a stage lists its performance among the files that make it yours", async () => {
    const root = document.createElement("div");
    await mountChallenge(root, { status: { ...STATUS, challenges: [TALENT_CHALLENGE] }, account,
      route: { view: "challenge", event: "got-a-talent" } });
    expect(root.querySelector(".yours").textContent).toContain("timeline.json");
    expect(root.querySelector(".facts").textContent).toContain("open floor");
  });

  it("says how the Arena scores a race, and how it rates a tug on the bench", async () => {
    const caveat = async (challenge) => {
      const root = document.createElement("div");
      await mountChallenge(root, { status: { ...STATUS, challenges: [challenge] }, account,
        route: { view: "challenge", event: challenge.event.id } });
      return root.querySelector(".racecaveat").firstChild.textContent;
    };
    expect(await caveat(STATUS.challenges[0])).toBe("The Arena races your duck at every speed of the sweep and keeps its best. ");
    expect(await caveat(TUG_CHALLENGE)).toBe(
      "The Arena rates your duck on the bench: five pulls against the winch, the mean force held, in newtons. ");
  });

  it("says so for a challenge that is not open here", async () => {
    const root = document.createElement("div");
    await mountChallenge(root, { status: STATUS, account, route: { view: "challenge", event: "moon-landing" } });
    expect(root.querySelector(".failed").textContent).toContain("moon-landing");
  });
});
