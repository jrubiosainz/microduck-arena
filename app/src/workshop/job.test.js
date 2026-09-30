import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getJob: vi.fn(),
  getCheckpoint: vi.fn(async (event, id, n) => ({ checkpoint: n, score: 5.62, trace: new Float32Array(8) })),
  getCode: vi.fn(),
  publishJob: vi.fn(),
  pushCode: vi.fn(),
  useFork: vi.fn(),
  stopJob: vi.fn(),
}));
vi.mock("./api.js", () => api);
const viewer = vi.hoisted(() => ({ setLanes: vi.fn(), setBrightness: vi.fn(), dispose: vi.fn(), player: { toggle() {}, playing: true },
  follow() {}, setWallsVisible: () => false, setNamesVisible: () => false }));
vi.mock("../viewer.js", () => ({ createViewer: vi.fn(async () => viewer) }));

import { POLL_MS, futureSlots, mountJob } from "./job.js";

const row = (n, score, finished = 5) => ({ n, status: "evaluated", score, seeds_finished: finished, seeds_total: 5, command_vx: 0.55 });
const JOB = {
  id: "first", name: "first", where: "hf-jobs", state: "running", progress: { done: 1250, total: 3000 },
  started: "2026-09-30T09:15:00+00:00", run_id: "r", dirty: false, job_url: "https://huggingface.co/jobs/alice/j1",
  checkpoints: [row(0, 50, 0), row(250, 8.1), row(500, 5.62), { n: 750, status: "queued" }], best: 500, published: null,
  log: ["$ uv run --no-sync train …"], next: 1, following: true, curve: [[1, 0.1], [2, 0.3]], commit: "abc1234",
  recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, params: { forward_reward: 2 }, code_url: null,
};
const CODE = { fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 };
const SPRINT = { id: "sprint-2m", title: "2 m Sprint", category: "race", vote: null, metric: "time", rig: "legs",
  length_m: 2, slope_deg: 0, sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
const SWAG = { ...SPRINT, id: "swag-contest", title: "MicroDuck Got a Talent", metric: "votes", vote: { ballot_min: 2 } };
const status = (event) => ({ arena: "https://arena.test", gpu: false, challenges: [{ event, folder: "sprint_2m", task: "S", recipe: {}, knobs: [], running: 1 }] });
const account = { get: () => ({ phase: "in", user: "alice", canPay: true }), logIn: vi.fn(), check: vi.fn() };
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
const open = (root, event = SPRINT, job = "first") =>
  mountJob(root, { status: status(event), account, route: { view: "job", event: event.id, job } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.getJob.mockReset();
  api.getCode.mockResolvedValue(CODE);
});
afterEach(() => vi.useRealTimers());

describe("a training's page", () => {
  it("counts the checkpoints still to come from the spacing of those saved", () => {
    expect(futureSlots(JOB)).toEqual([1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 2999]);
    expect(futureSlots({ ...JOB, state: "done" })).toEqual([]);
  });

  it("opens a race on its best checkpoint and replays it", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    expect(root.querySelector(".racetitle").textContent).toBe("first");
    expect(root.querySelector(".raceeyebrow").textContent).toBe("Training · Hugging Face Jobs · L4");
    expect(root.querySelector(".score__label").textContent).toBe("Checkpoint 500 · ★ best");
    expect(root.querySelector(".score__value").textContent).toBe("5.62 s");
    expect(api.getCheckpoint).toHaveBeenCalledWith("sprint-2m", "first", 500);
    expect(viewer.setLanes).toHaveBeenLastCalledWith([expect.objectContaining({ name: "checkpoint 500", tier: "trial" })], SPRINT);
    expect(root.querySelector("#stage-hint").textContent).toBe("Checkpoint 500 · its best seed");
    expect(root.querySelector(".output pre").textContent).toContain("uv run --no-sync train");
  });

  it("a click on a bar replays that checkpoint", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    root.querySelectorAll(".ckpts .bars i")[1].click();
    await settle();
    expect(root.querySelector(".score__value").textContent).toBe("8.10 s");
    expect(api.getCheckpoint).toHaveBeenLastCalledWith("sprint-2m", "first", 250);
  });

  it("a voted event opens on no checkpoint", async () => {
    api.getJob.mockResolvedValue({ ...JOB, best: null });
    const root = document.createElement("div");
    await mountJob(root, { status: status(SWAG), account, route: { view: "job", event: "swag-contest", job: "first" } });
    await settle();
    expect(root.querySelector(".score__label").textContent).toBe("No checkpoint chosen");
    expect(root.querySelector(".publish__go").textContent).toBe("Pick a checkpoint");
  });

  it("keeps what is typed while the page redraws every few seconds", async () => {
    // Review focus: the job page polls; the name and the words for the commentators must stay.
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    const page = await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    root.querySelector("input[name=policy]").value = "my-walker";
    root.querySelector("textarea").value = "It leans into every step.";
    api.getJob.mockResolvedValue({ ...JOB, log: ["Learning iteration 1300/3000"], next: 2 });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(root.querySelector("input[name=policy]").value).toBe("my-walker");
    expect(root.querySelector("textarea").value).toBe("It leans into every step.");
    expect(root.querySelector(".output pre").textContent).toContain("Learning iteration 1300/3000");
    page.leave();
    expect(viewer.dispose).toHaveBeenCalled();
  });

  it("keeps its bars through a poll, and a bar picked from the keyboard keeps the focus", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    document.body.append(root);
    const page = await open(root);
    await settle();
    const bar = root.querySelectorAll(".ckpts .bars i")[1];
    bar.focus();
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    expect(root.querySelectorAll(".ckpts .bars i")[1]).toBe(bar);
    expect(bar.classList.contains("sel")).toBe(true);
    expect(document.activeElement).toBe(bar);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(root.querySelectorAll(".ckpts .bars i")[1]).toBe(bar);
    expect(root.querySelector(".ticks .sel").textContent).toBe("250");
    page.leave();
    root.remove();
  });

  it("says on the stage why a checkpoint cannot play, until another is picked", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    const page = await open(root);
    await settle();
    api.getCheckpoint.mockRejectedValueOnce(new Error("Checkpoint 250 is not evaluated yet."));
    root.querySelectorAll(".ckpts .bars i")[1].click();
    await settle();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(root.querySelector("#stage-hint").textContent).toBe("Checkpoint 250 is not evaluated yet.");
    root.querySelectorAll(".ckpts .bars i")[2].click();
    await settle();
    expect(root.querySelector("#stage-hint").textContent).toBe("Checkpoint 500 · its best seed");
    page.leave();
  });

  it("a checkpoint that fails to load late never paints over the one picked since", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    const page = await open(root);
    await settle();
    let fail;
    api.getCheckpoint.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = reject; }));
    root.querySelectorAll(".ckpts .bars i")[1].click(); // 250, still loading
    root.querySelectorAll(".ckpts .bars i")[2].click(); // 500, loaded already
    await settle();
    fail(new Error("Checkpoint 250 is not evaluated yet."));
    await settle();
    expect(root.querySelector("#stage-hint").textContent).toBe("Checkpoint 500 · its best seed");
    page.leave();
  });

  it("stops a training once confirmed, saying what is lost, and asks once while it stops", async () => {
    api.getJob.mockResolvedValue(JOB);
    let stopped;
    api.stopJob.mockImplementation(() => new Promise((resolve) => { stopped = resolve; }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const root = document.createElement("div");
    const page = await open(root);
    await settle();
    const stop = root.querySelector(".job-stop");
    expect(stop.hidden).toBe(false);
    stop.click();
    stop.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Stop first? A stopped Hugging Face job cannot be resumed.");
    expect(api.stopJob).toHaveBeenCalledTimes(1);
    api.getJob.mockResolvedValue({ ...JOB, state: "stopped" });
    stopped({});
    await settle();
    expect(stop.hidden).toBe(true);
    expect(root.querySelector(".raceeyebrow").textContent).toBe("Stopped · Hugging Face Jobs · L4");
    confirm.mockRestore();
    page.leave();
  });

  it("drops a poll's answer that a newer look overtook", async () => {
    api.getCode.mockResolvedValue({ ...CODE, fork: "alice/microduck-challenges", unpushed: 2 });
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    const page = await open(root);
    await settle();
    let late;
    api.getJob.mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    api.pushCode.mockResolvedValue({});
    api.getJob.mockResolvedValue({ ...JOB, log: ["looked again after the push"], next: 2 });
    root.querySelector(".checks button").click();
    await settle();
    late({ ...JOB, log: ["a stale line"], next: 2 });
    await settle();
    const output = root.querySelector(".output pre").textContent;
    expect(api.pushCode).toHaveBeenCalled();
    expect(output).toContain("looked again after the push");
    expect(output).not.toContain("a stale line");
    page.leave();
  });

  it("once left, asks nothing more and draws no answer still out", async () => {
    api.getJob.mockResolvedValue(JOB);
    const root = document.createElement("div");
    const page = await open(root);
    await settle();
    let late;
    api.getJob.mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    page.leave();
    late({ ...JOB, log: ["after leaving"], next: 2 });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(root.querySelector(".output pre").textContent).not.toContain("after leaving");
    expect(api.getJob).toHaveBeenCalledTimes(2);
  });

  it("after a restart it links the job's whole log on Hugging Face", async () => {
    api.getJob.mockResolvedValue({ ...JOB, following: false, log: [] });
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "first" } });
    await settle();
    expect(root.querySelector(".output a").href).toBe("https://huggingface.co/jobs/alice/j1");
  });

  it("says so for a training that is not there", async () => {
    api.getJob.mockRejectedValue(new Error("No training nope for sprint-2m."));
    const root = document.createElement("div");
    await mountJob(root, { status: status(SPRINT), account, route: { view: "job", event: "sprint-2m", job: "nope" } });
    expect(root.querySelector(".failed").textContent).toContain("nope");
  });
});
