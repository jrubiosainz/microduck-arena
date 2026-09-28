// vi.mock is hoisted, and main.js calls start() as a side effect of being
// imported — there is no exported render function to call directly here, the
// way race.js/home.js expose one for their own page tests. So this exercises
// the whole page end to end against a fixture shaped like workshop.html's
// body, the way home.page.test.js does for the front page.

import { describe, expect, it, vi } from "vitest";

let signedIn = false;
const run = { id: "2026-09-28_10-00-00_first", name: "first", dirty: false, checkpoints: [1000], trials: {} };

vi.mock("./api.js", () => ({
  getStatus: async () => ({
    event: { id: "sprint-2m", title: "2 m Sprint", rig: "legs" },
    arena: "https://pollen-robotics-microduck-arena.hf.space",
    challenge: { folder: "sprint_2m", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [] },
    preflight: { git: true, identity: true, uv: true, gpu: false, gh: true, user: signedIn ? "alice" : null },
  }),
  login: async () => { signedIn = true; },
  getRuns: async () => [run],
  getTraining: async () => ({ state: null }),
  getCode: async () => ({
    state: "not-shared", origin: null, fork: null, changes: 0, unpushed: 0, commit: null,
    gh: true, fork_page: "https://github.com/pollen-robotics/microduck-challenges/fork", output: "",
  }),
}));

const fixture = () => {
  document.body.innerHTML = `
    <main>
      <h1 id="title"></h1>
      <a id="arena-link"></a>
      <section id="preflight"></section>
      <div id="train-form"></div>
      <div id="training"></div>
      <p id="follow-status"></p>
      <figure id="curve"></figure>
      <pre id="train-log"></pre>
      <div id="runs"></div>
      <p id="trial-status"></p>
      <div id="result"></div>
      <div id="replay"></div>
      <div id="code"></div>
      <div id="publish-form"></div>
    </main>`;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("signing in after a checkpoint is already chosen", () => {
  it("re-renders Publish so the gate reflects the fresh login, not the stale one", async () => {
    signedIn = false;
    fixture();
    vi.resetModules();
    await import("./main.js");
    await settle();

    document.querySelector("#runs .checkpoint").click(); // choose the one checkpoint on offer
    const go = () => document.querySelector("#publish-form .publish__go");
    expect(go().disabled).toBe(true); // signed out: locked even though a checkpoint is picked

    document.querySelector("#preflight input[name=token]").value = "hf_x";
    document.querySelector("#preflight form").dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();

    expect(go().disabled).toBe(false); // signed in now: the same selection is publishable
  });
});
