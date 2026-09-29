import { describe, expect, it, vi } from "vitest";
import { appendLog, formValues, renderJobs, renderTrainForm, renderTraining, runName } from "./train.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const status = (preflight = {}) => ({
  preflight: { git: true, identity: true, uv: true, gpu: false, gh: true, user: "alice", ...preflight },
  challenge: {
    event: "sprint-2m",
    recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 },
    knobs: [{ name: "forward_reward", label: "Follow the speed order", value: 2, min: 0.5, max: 5 }],
  },
});

describe("the Train form", () => {
  it("starts from the challenge's recipe and knobs, with a fresh run name", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, status(), { onLaunch: vi.fn() });
    const form = zone.querySelector("form");
    expect(formValues(form, status().challenge)).toEqual({
      name: runName(), recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, params: { forward_reward: 2 },
    });
    expect(zone.textContent).toContain("Follow the speed order");
  });

  it("launches what was edited", async () => {
    const zone = document.createElement("div");
    const onLaunch = vi.fn(async () => {});
    renderTrainForm(zone, status(), { onLaunch });
    const form = zone.querySelector("form");
    form.elements.run.value = "first";
    form.elements.num_envs.value = "512";
    form.elements.forward_reward.value = "3.5";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onLaunch.mock.calls[0][0]).toEqual({
      name: "first", recipe: { num_envs: 512, max_iterations: 3000, seed: 1 }, params: { forward_reward: 3.5 },
    });
  });

  it("cannot launch before the preflight allows it, and says where it would run", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, status({ user: null }), { onLaunch: vi.fn() });
    expect(zone.querySelector("button[type=submit]").disabled).toBe(true);
    renderTrainForm(zone, status(), { onLaunch: vi.fn() });
    expect(zone.textContent).toMatch(/Hugging Face Jobs/);
    expect(zone.textContent).toContain("Closing the workshop does not stop a Hugging Face job: reopen it to fetch or stop it.");
    renderTrainForm(zone, status({ gpu: true }), { onLaunch: vi.fn() });
    expect(zone.textContent).not.toMatch(/Closing the workshop/);
  });

  it("says that Hugging Face Jobs need a payment method on the account", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, status(), { onLaunch: vi.fn() });
    expect(zone.querySelector(".train-form__where").textContent)
      .toContain("billed to alice, which needs a payment method (huggingface.co/settings/billing)");
  });

  it("says it is starting in ink, and why a launch failed in orange", async () => {
    const zone = document.createElement("div");
    let fail;
    renderTrainForm(zone, status(), { onLaunch: () => new Promise((_, reject) => { fail = reject; }) });
    zone.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    const note = zone.querySelector(".train-form__status");
    expect(note.textContent).toMatch(/starting/);
    expect(note.classList.contains("bad")).toBe(false);
    fail(new Error("A training is already running: stop it first."));
    await settle();
    expect(note.textContent).toMatch(/already running/);
    expect(note.classList.contains("bad")).toBe(true);
  });

  it("names a run after the minute it was started", () => {
    expect(runName(new Date(2026, 8, 28, 14, 2))).toBe("run-0928-1402");
  });

  it("agrees with the server's run-name rule", () => {
    const zone = document.createElement("div");
    renderTrainForm(zone, status(), { onLaunch: vi.fn() });
    const input = zone.querySelector("input[name=run]");
    const validity = (value) => {
      input.value = value;
      return input.checkValidity();
    };
    expect(validity("a--b")).toBe(false);
    expect(validity("run-")).toBe(false);
    expect(validity("run-0928-1402")).toBe(true);
  });
});

describe("a training in progress", () => {
  const hf = { name: "first", mode: "hf-jobs", state: "running", ckpt_repo: "alice/x-first", job_id: "j1", log: [], next: 0 };

  it("offers Stop while it runs, and fetching checkpoints for an HF job", () => {
    const zone = document.createElement("div");
    const onStop = vi.fn();
    const onPull = vi.fn();
    renderTraining(zone, hf, { onStop, onPull });
    zone.querySelector(".training__stop").click();
    zone.querySelector(".training__pull").click();
    expect(onStop).toHaveBeenCalled();
    expect(onPull).toHaveBeenCalled();
    expect(zone.textContent).toContain("alice/x-first");
    expect(zone.querySelector(".training__stop").classList.contains("button")).toBe(true);
    expect(zone.querySelector(".training__pull").classList.contains("button")).toBe(true);
  });

  it("says why a Stop or a fetch failed, still after the next poll redraws the zone", async () => {
    const zone = document.createElement("div");
    const onStop = vi.fn(async () => { throw new Error("Could not cancel the Hugging Face job: Hub is down"); });
    const onPull = vi.fn(async () => { throw new Error("could not fetch alice/x-first"); });
    renderTraining(zone, hf, { onStop, onPull });
    zone.querySelector(".training__stop").click();
    await settle();
    expect(zone.querySelector(".training__note").textContent).toMatch(/Hub is down/);
    renderTraining(zone, hf, { onStop, onPull }); // the next poll
    expect(zone.querySelector(".training__note").textContent).toMatch(/Hub is down/);
    zone.querySelector(".training__pull").click();
    await settle();
    expect(zone.querySelector(".training__note").textContent).toBe("could not fetch alice/x-first");
    renderTraining(zone, { ...hf, state: "finished", returncode: 0 }, { onStop, onPull });
    expect(zone.querySelector(".training__note").textContent).toBe("");
  });

  it("offers neither once it is over, and says how it ended", () => {
    const zone = document.createElement("div");
    renderTraining(zone, { ...hf, mode: "local", state: "failed", returncode: 3 }, { onStop: vi.fn(), onPull: vi.fn() });
    expect(zone.querySelector(".training__stop")).toBeNull();
    expect(zone.querySelector(".training__pull")).toBeNull();
    expect(zone.textContent).toMatch(/failed.*3/);
  });

  it("appends new log lines to what is shown", () => {
    const pre = document.createElement("pre");
    appendLog(pre, ["$ uv run --no-sync train …", "Learning iteration 1/2"]);
    appendLog(pre, ["Learning iteration 2/2"]);
    expect(pre.textContent.split("\n").filter(Boolean)).toHaveLength(3);
  });
});

describe("Hugging Face jobs launched before", () => {
  const job = (name) => ({ name, ckpt_repo: `alice/x-${name}`, namespace: "alice", job_id: `job-${name}`, started: "2026-09-28T10:00:00+00:00" });
  const jobs = [job("second"), job("first")];

  it("lists each one but the training followed above, with Fetch and Stop", () => {
    const zone = document.createElement("div");
    const onPull = vi.fn(async () => {});
    const onStop = vi.fn(async () => {});
    renderJobs(zone, jobs, "second", { onPull, onStop });
    expect(zone.querySelectorAll(".job")).toHaveLength(1);
    expect(zone.textContent).toContain("alice/x-first");
    zone.querySelector(".job__pull").click();
    zone.querySelector(".job__stop").click();
    expect(onPull).toHaveBeenCalledWith("first");
    expect(onStop).toHaveBeenCalledWith("first");
    expect(zone.querySelector(".job__stop").classList.contains("button")).toBe(true);
    renderJobs(zone, jobs, null, { onPull, onStop });
    expect(zone.querySelectorAll(".job")).toHaveLength(2);
  });

  it("says what a fetch did in ink, and why a Stop failed in orange", async () => {
    const zone = document.createElement("div");
    const onStop = vi.fn(async () => { throw new Error("Could not cancel the Hugging Face job: 404"); });
    renderJobs(zone, [job("first")], null, { onPull: vi.fn(async () => {}), onStop });
    const note = zone.querySelector(".job__note");
    zone.querySelector(".job__pull").click();
    await settle();
    expect(note.textContent).toMatch(/Fetched alice\/x-first/);
    expect(note.classList.contains("bad")).toBe(false);
    zone.querySelector(".job__stop").click();
    await settle();
    expect(note.textContent).toMatch(/Could not cancel/);
    expect(note.classList.contains("bad")).toBe(true);
  });
});
