import { describe, expect, it, vi } from "vitest";
import { appendLog, formValues, renderTrainForm, renderTraining, runName } from "./train.js";

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
