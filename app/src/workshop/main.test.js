// main.js mounts itself on import, as the page does: each test loads it afresh on a fresh #app and
// drives the whole home against a mocked API.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, CODE } = vi.hoisted(() => {
  const SPRINT = { id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null, metric: "time",
    length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
  const SWAG = { ...SPRINT, id: "swag-contest", title: "Swag Contest", category: "showcase", vote: { ballot_min: 2 }, metric: "votes" };
  const CODE = { fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 };
  const api = {
    getStatus: async () => ({ arena: "https://arena.test", gpu: false, challenges: [
      { event: SPRINT, folder: "sprint_2m", task: "S", recipe: {}, knobs: [], running: 1 },
      { event: SWAG, folder: "swag_contest", task: "W", recipe: {}, knobs: [], running: 0 },
    ] }),
    getHub: vi.fn(),
    startLogin: vi.fn(async () => ({ url: "https://huggingface.co/oauth/device?user_code=X", code: "X" })),
    getLogin: async () => ({ state: "waiting", output: "" }),
    getCode: vi.fn(),
    useFork: async () => ({ ...CODE, fork: "alice/microduck-challenges" }),
    getJobs: async () => [],
    getJob: async () => ({ id: "first", name: "first", where: "local", state: "done", progress: null, started: null, run_id: "r",
      dirty: false, job_url: null, checkpoints: [], best: null, published: null, log: [], next: 0, following: false, curve: [],
      commit: null, recipe: null, params: null, code_url: null }),
  };
  return { api, CODE };
});
vi.mock("./api.js", () => api);
vi.mock("../thumbnail.js", () => ({ renderThumbnails: async () => new Map() }));
vi.mock("../viewer.js", () => ({ createViewer: async () => ({ setLanes() {}, setBrightness() {}, dispose() {} }) }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async () => {
  for (let i = 0; i < 5; i += 1) await settle();
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  history.replaceState(null, "", "/");
  document.head.innerHTML = '<link rel="stylesheet" data-theme="club" /><link rel="stylesheet" data-theme="race" disabled />';
  document.body.innerHTML = '<div id="app"></div>';
  api.getCode.mockImplementation(async () => CODE);
  api.getHub.mockImplementation(async () => ({ user: null, reachable: true, can_pay: false }));
});

describe("the workshop's home", () => {
  it("draws the cover, Ready to train? and the challenges, then logs in with the browser", async () => {
    await import("./main.js");
    await settled();
    const app = document.querySelector("#app");
    expect(app.querySelector(".masthead .wordmark").textContent).toBe("MicroduckWorkshop");
    expect(app.querySelector(".todo__title").textContent).toBe("Ready to train?");
    expect(app.querySelector(".lede").textContent).toBe("Pick a challenge, then train, submit, compete, repeat.");
    const links = [...app.querySelectorAll(".challenge-link")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#/c/sprint-2m", "#/c/swag-contest"]);
    expect(app.querySelector(".flyer-leader")).toBeNull();
    expect(app.querySelector(".vote-button")).toBeNull();
    expect(app.querySelector(".ws-running").textContent).toBe("1 training now");
    const plate = app.querySelector(".masthead button.player-card-in");
    expect(plate.textContent).toContain("Log in");
    plate.click();
    await settle();
    expect(api.startLogin).toHaveBeenCalled();
    expect(app.querySelector(".masthead button.player-card-in").textContent).toContain("Waiting");
  });

  it("shows only the page asked for last, whose account still redraws, when an older one answers late", async () => {
    // The page opens, then its address changes before its code has answered; the older load's
    // answer comes last. (The newest call is the last one: a page loaded by an earlier test also
    // listens, on its own detached #app.)
    const answers = [];
    api.getCode.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const fork = (owner) => ({ ...CODE, fork: `${owner}/microduck-challenges` });
    await import("./main.js");
    await settle();
    window.dispatchEvent(new Event("hashchange"));
    await settle();
    answers.pop()(fork("newer"));
    await settled();
    answers.forEach((resolve) => resolve(fork("older")));
    await settled();
    const app = document.querySelector("#app");
    expect(app.querySelectorAll(".masthead")).toHaveLength(1);
    expect(app.querySelector(".todo").textContent).toContain("newer/microduck-challenges");
    app.querySelector(".masthead button.player-card-in").click();
    await settle();
    expect(app.querySelector(".masthead button.player-card-in").textContent).toContain("Waiting");
  });
});

describe("a challenge's page in the workshop", () => {
  it("is mounted from its address and wears the Arena's trackside sheet", async () => {
    history.replaceState(null, "", "/#/c/sprint-2m");
    await import("./main.js");
    await settled();
    const app = document.querySelector("#app");
    expect(app.querySelector(".racetitle").textContent).toBe("2 m Sprint");
    expect(app.querySelector(".signage .wordmark").textContent).toBe("MicroduckWorkshop");
    expect(document.querySelector("link[data-theme=race]").disabled).toBe(false);
    expect(document.querySelector("link[data-theme=club]").disabled).toBe(true);
  });

  it("shows the account that answered while it was being drawn", async () => {
    // Opened straight on a challenge (`workshop <id>`): the Hub answers after the page drew its chip,
    // before the page is on screen.
    let answerHub;
    api.getHub.mockImplementation(() => new Promise((resolve) => { answerHub = resolve; }));
    let openCode;
    const code = new Promise((resolve) => { openCode = resolve; });
    api.getCode.mockImplementation(async () => {
      await code;
      return CODE;
    });
    history.replaceState(null, "", "/#/c/sprint-2m");
    await import("./main.js");
    await settled();
    answerHub({ user: "alice", reachable: true, can_pay: true });
    await settled();
    openCode();
    await settled();
    expect(document.querySelector("#app .signage .profile-chip").textContent).toBe("alice");
  });
});

describe("a training's page in the workshop", () => {
  it("is mounted from its address and wears the Arena's trackside sheet", async () => {
    history.replaceState(null, "", "/#/c/sprint-2m/j/first");
    await import("./main.js");
    await settled();
    const app = document.querySelector("#app");
    expect(app.querySelector(".racetitle").textContent).toBe("first");
    expect(app.querySelector(".raceback").getAttribute("href")).toBe("#/c/sprint-2m");
    expect(document.querySelector("link[data-theme=race]").disabled).toBe(false);
    expect(document.querySelector("link[data-theme=club]").disabled).toBe(true);
  });
});
