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
    getHub: async () => ({ user: null, reachable: true, can_pay: false }),
    startLogin: vi.fn(async () => ({ url: "https://huggingface.co/oauth/device?user_code=X", code: "X" })),
    getLogin: async () => ({ state: "waiting", output: "" }),
    getCode: vi.fn(),
    useFork: async () => ({ ...CODE, fork: "alice/microduck-challenges" }),
  };
  return { api, CODE };
});
vi.mock("./api.js", () => api);
vi.mock("../thumbnail.js", () => ({ renderThumbnails: async () => new Map() }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async () => {
  for (let i = 0; i < 5; i += 1) await settle();
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
  api.getCode.mockImplementation(async () => CODE);
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
