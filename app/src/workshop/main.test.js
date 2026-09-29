// vi.mock is hoisted, and main.js calls start() as a side effect of being
// imported — there is no exported render function to call directly here, the
// way race.js/home.js expose one for their own page tests. So this exercises
// the whole page end to end against a fixture shaped like workshop.html's
// body, the way home.page.test.js does for the front page.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

let signedIn = false;
const answersAtOnce = () => Promise.resolve({ user: signedIn ? "alice" : null, reachable: true });
let hubAnswer = answersAtOnce;
const run = { id: "2026-09-28_10-00-00_first", name: "first", dirty: false, checkpoints: [1000], trials: {} };

vi.mock("./api.js", () => ({
  getStatus: async () => ({
    event: { id: "sprint-2m", title: "2 m Sprint", rig: "legs" },
    arena: "https://pollen-robotics-microduck-arena.hf.space",
    challenge: { folder: "sprint_2m", recipe: { num_envs: 4096, max_iterations: 3000, seed: 1 }, knobs: [] },
    preflight: { git: true, identity: true, uv: true, gpu: false, gh: true },
  }),
  getHub: () => hubAnswer(),
  login: async () => { signedIn = true; return { user: "alice" }; },
  getRuns: async () => [run],
  getTraining: async () => ({ state: null }),
  getJobs: async () => [
    { name: "overnight", ckpt_repo: "alice/x-overnight", namespace: "alice", job_id: "j1", started: "2026-09-28T10:00:00+00:00" },
  ],
  pullJob: async () => ({}),
  stopJob: async () => ({}),
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
      <div id="jobs"></div>
      <div id="runs"></div>
      <p id="trial-status"></p>
      <div id="result"></div>
      <div id="replay"></div>
      <div id="code"></div>
      <div id="publish-form"></div>
    </main>`;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("opening the workshop while Hugging Face takes its time", () => {
  it("draws every zone at once, then names the account when the Hub answers", async () => {
    signedIn = true;
    let answer;
    hubAnswer = () => new Promise((resolve) => { answer = resolve; });
    fixture();
    vi.resetModules();
    await import("./main.js");
    await settle();

    expect(document.querySelector("#preflight").textContent).toMatch(/Hugging Face: checking/);
    expect(document.querySelector("#train-form form")).not.toBeNull();
    expect(document.querySelector("#runs .checkpoint")).not.toBeNull();
    expect(document.querySelector("#code").textContent).not.toBe("");
    expect(document.querySelector("#publish-form").textContent).not.toBe("");
    expect(document.querySelector("#jobs .job")).not.toBeNull();
    const launch = document.querySelector("#train-form button[type=submit]");
    expect(launch.disabled).toBe(true); // no Hugging Face account known yet to bill the job to
    document.querySelector("#train-form input[name=run]").value = "my-own-name";

    answer({ user: "alice", reachable: true });
    await settle();
    expect(document.querySelector("#preflight").textContent).toContain("as alice");
    expect(launch.disabled).toBe(false);
    expect(document.querySelector("#train-form input[name=run]").value).toBe("my-own-name"); // not redrawn
    expect(document.querySelector("#train-form").textContent).toContain("billed to alice");
  });

  it("says when Hugging Face is unreachable, and asks again on Retry", async () => {
    signedIn = true;
    hubAnswer = () => Promise.resolve({ user: null, reachable: false });
    fixture();
    vi.resetModules();
    await import("./main.js");
    await settle();
    expect(document.querySelector("#preflight").textContent).toMatch(/Hugging Face unreachable/);

    hubAnswer = answersAtOnce;
    document.querySelector("#preflight .preflight__retry").click();
    await settle();
    expect(document.querySelector("#preflight").textContent).toContain("as alice");
  });
});

describe("signing in after a checkpoint is already chosen", () => {
  it("re-renders Publish so the gate reflects the fresh login, not the stale one", async () => {
    signedIn = false;
    hubAnswer = answersAtOnce;
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

describe("reopening the workshop while a Hugging Face job still runs", () => {
  it("lists the job in the Train zone, to fetch or stop", async () => {
    hubAnswer = answersAtOnce;
    fixture();
    vi.resetModules();
    await import("./main.js");
    await settle();
    expect(document.querySelector("#jobs .job").textContent).toContain("alice/x-overnight");
    expect(document.querySelector("#jobs .job__stop")).not.toBeNull();
  });
});

describe("the page's sheet", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../public/workshop.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  // The declarations of every rule whose selector list holds exactly `selector`.
  const rule = (selector) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, list]) => list.split(",").map((s) => s.trim()).includes(selector))
      .map(([, , body]) => body)
      .join("");

  it("says what a step is doing in ink, and only what went wrong in orange", () => {
    for (const note of [".train-form__status", ".trial__status", ".publish__status", ".job__note"]) {
      expect(rule(note), note).toMatch(/color:\s*var\(--ink-70\)/);
    }
    expect(rule(".workshop .bad")).toMatch(/color:\s*var\(--orange-inked\)/);
  });

  it("writes in its inputs at the size of the labels around them", () => {
    expect(rule(".workshop input")).toMatch(/font:\s*inherit/);
  });
});
