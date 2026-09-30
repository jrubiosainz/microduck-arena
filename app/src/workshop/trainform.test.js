import { describe, expect, it, vi } from "vitest";
import { revisionMessage, runName, trainForm, unavailable } from "./trainform.js";

const CHALLENGE = {
  event: { id: "sprint-2m" }, folder: "sprint_2m",
  recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 },
  knobs: [
    { name: "forward_reward", label: "Follow the speed order", value: 2, min: 0.5, max: 5, group: "reward" },
    { name: "max_slope_deg", label: "Steepest training slope (°)", value: 10, min: 0, max: 15, group: "recipe" },
  ],
};
const CLEAN = { fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 };
const DIRTY = { ...CLEAN, changes: [{ status: "M", path: "src/microduck_challenges/sprint_2m/env.py" }, { status: "??", path: "src/microduck_challenges/sprint_2m/rewards.py" }] };
const IN = { phase: "in", user: "alice", canPay: true };
const at = new Date(2026, 8, 30, 9, 40);

describe("the training form", () => {
  it("names a run and a commit by the date", () => {
    expect(runName(at)).toBe("run-0930-0940");
    expect(revisionMessage("sprint-2m", at)).toBe("sprint-2m training revision 2026-09-30 09:40");
  });

  it("says why a place to train is not available", () => {
    expect(unavailable("local", { account: IN, gpu: false })).toContain("No NVIDIA GPU");
    expect(unavailable("local", { account: IN, gpu: true })).toBeNull();
    expect(unavailable("hf-jobs", { account: { phase: "out" }, gpu: false })).toContain("Log in");
    expect(unavailable("hf-jobs", { account: { ...IN, canPay: false }, gpu: false })).toContain("payment method");
    expect(unavailable("hf-jobs", { account: IN, gpu: false })).toBeNull();
  });

  it("is locked behind a commit while files changed, and the commit unlocks it", async () => {
    const onCommit = vi.fn(async () => {});
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit, onTrain: vi.fn() });
    form.update({ code: DIRTY, account: IN });
    expect(form.el.querySelector(".gate").hidden).toBe(false);
    expect([...form.el.querySelectorAll(".gate__files li")].map((li) => li.textContent)).toEqual([
      "Msrc/microduck_challenges/sprint_2m/env.py", "??src/microduck_challenges/sprint_2m/rewards.py"]);
    expect(form.el.querySelector("input[name=message]").value).toMatch(/^sprint-2m training revision \d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(form.el.querySelector("fieldset").disabled).toBe(true);
    form.el.querySelector(".gate__go").click();
    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledWith(expect.stringMatching(/^sprint-2m training revision/));
    form.update({ code: CLEAN, account: IN });
    expect(form.el.querySelector(".gate").hidden).toBe(true);
    expect(form.el.querySelector(".committed").textContent).toBe("✓ All committed · abc1234");
    expect(form.el.querySelector("fieldset").disabled).toBe(false);
  });

  it("asks for a name on commits instead of a Commit button when git has none", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    form.update({ code: { ...DIRTY, identity: false }, account: IN });
    expect(form.el.querySelector(".gate__go").hidden).toBe(true);
    expect(form.el.querySelector(".gate__identity pre").textContent).toContain("git config --global user.email");
  });

  it("trains on Hugging Face Jobs by default without a GPU, here with one", () => {
    const pressed = (form) => form.el.querySelector(".seg button[aria-pressed=true]").dataset.where;
    const without = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    without.update({ code: CLEAN, account: IN });
    expect(pressed(without)).toBe("hf-jobs");
    expect(without.el.querySelector(".seg button[data-where=local]").disabled).toBe(true);
    expect(without.el.querySelector(".where-hint").textContent).toBe("One L4 GPU, billed to alice.");
    const withGpu = trainForm({ challenge: CHALLENGE, gpu: true }, { onCommit: vi.fn(), onTrain: vi.fn() });
    withGpu.update({ code: CLEAN, account: IN });
    expect(pressed(withGpu)).toBe("local");
  });

  it("says under the stickers why the other place is not available", () => {
    const why = (form) => form.el.querySelector(".where-why");
    const onGpu = trainForm({ challenge: CHALLENGE, gpu: true }, { onCommit: vi.fn(), onTrain: vi.fn() });
    onGpu.update({ code: CLEAN, account: { phase: "out" } });
    expect(onGpu.el.querySelector(".where-hint").textContent).toBe("Trains on this machine's NVIDIA GPU.");
    expect(why(onGpu).hidden).toBe(false);
    expect(why(onGpu).textContent).toContain("Log in");
    expect(onGpu.el.querySelector(".train-go").disabled).toBe(false);
    onGpu.update({ code: CLEAN, account: { ...IN, canPay: false } });
    expect(why(onGpu).textContent).toContain("payment method");
    onGpu.update({ code: CLEAN, account: IN });
    expect(why(onGpu).hidden).toBe(true);
    const noGpu = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    noGpu.update({ code: CLEAN, account: IN });
    expect(why(noGpu).textContent).toContain("No NVIDIA GPU");
  });

  it("keeps Train shut while the chosen place is not available", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    form.update({ code: CLEAN, account: { phase: "out" } });
    expect(form.el.querySelector(".train-go").disabled).toBe(true);
    expect(form.el.querySelector(".where-hint").textContent).toContain("Log in");
  });

  it("folds the rewards and the recipe away, each in its own section", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    const settings = form.el.querySelector("details.settings");
    expect(settings.open).toBe(false);
    expect([...settings.querySelectorAll("h4")].map((h) => h.firstChild.textContent.trim())).toEqual(["Rewards", "Recipe"]);
    expect(settings.querySelector(".rewards [name=forward_reward]")).not.toBeNull();
    expect(settings.querySelector(".recipe [name=max_slope_deg]")).not.toBeNull();
    expect(settings.querySelector(".recipe [name=num_envs]").value).toBe("4096");
  });

  it("trains with what the form holds", async () => {
    const onTrain = vi.fn(async () => {});
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain });
    form.update({ code: CLEAN, account: IN });
    form.el.querySelector("input[name=run]").value = "first";
    form.el.querySelector(".train-go").click();
    await Promise.resolve();
    expect(onTrain).toHaveBeenCalledWith({
      name: "first", where: "hf-jobs",
      recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 },
      params: { forward_reward: 2, max_slope_deg: 10 },
    });
  });

  it("says so, and sends nothing, while a recipe number is empty", async () => {
    const onTrain = vi.fn(async () => {});
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain });
    form.update({ code: CLEAN, account: IN });
    form.el.querySelector("[name=num_envs]").value = "";
    form.el.querySelector(".train-go").click();
    await Promise.resolve();
    expect(onTrain).not.toHaveBeenCalled();
    expect(form.el.querySelector(".train-note").textContent).toBe("Robots in parallel needs a number.");
    expect(form.el.querySelector(".train-note").classList.contains("bad")).toBe(true);
  });

  it("takes challenge.toml's values again after a commit, keeping what the user changed", async () => {
    const onTrain = vi.fn(async () => {});
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain });
    const field = (name) => form.el.querySelector(`[name=${name}]`);
    form.update({ code: CLEAN, account: IN });
    field("seed").value = "7";
    form.el.querySelector("details.settings").open = true;
    // Edited by hand and committed: 10 iterations, a forward reward of 4 under a new maximum of 8.
    const edited = { ...CHALLENGE, recipe: { ...CHALLENGE.recipe, max_iterations: 10 },
      knobs: [{ ...CHALLENGE.knobs[0], value: 4, max: 8 }, CHALLENGE.knobs[1]] };
    form.reseed(edited);
    expect([field("max_iterations").value, field("forward_reward").value, field("seed").value]).toEqual(["10", "4", "7"]);
    expect(field("forward_reward").max).toBe("8");
    expect(form.el.querySelector(".rewards output").textContent).toBe("4.0");
    expect(form.el.querySelector("details.settings").open).toBe(true);
    form.el.querySelector(".train-go").click();
    await Promise.resolve();
    expect(onTrain).toHaveBeenCalledWith(expect.objectContaining({
      recipe: { num_envs: 4096, max_iterations: 10, seed: 7 }, params: { forward_reward: 4, max_slope_deg: 10 } }));
    // Once the file says what the user chose, the next edit of it shows as well.
    form.reseed({ ...edited, recipe: { ...edited.recipe, seed: 7 } });
    form.reseed({ ...edited, recipe: { ...edited.recipe, seed: 9 } });
    expect(field("seed").value).toBe("9");
  });

  it("keeps what is typed through every redraw, an emptied message included", () => {
    const form = trainForm({ challenge: CHALLENGE, gpu: false }, { onCommit: vi.fn(), onTrain: vi.fn() });
    const field = (name) => form.el.querySelector(`[name=${name}]`);
    form.update({ code: DIRTY, account: IN });
    field("message").value = "";
    field("run").value = "mine";
    field("forward_reward").value = "3.5";
    field("seed").value = "7";
    form.update({ code: DIRTY, account: IN });
    form.update({ code: DIRTY, account: { phase: "out" } });
    expect(field("message").value).toBe("");
    form.update({ code: CLEAN, account: IN });
    expect([field("run").value, field("forward_reward").value, field("seed").value]).toEqual(["mine", "3.5", "7"]);
  });
});
