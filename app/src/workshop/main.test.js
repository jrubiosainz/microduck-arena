// main.js mounts itself on import, as the page does: this drives the whole home against a mocked API.

import { describe, expect, it, vi } from "vitest";

const { api, SPRINT, SWAG } = vi.hoisted(() => {
  const SPRINT = { id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null, metric: "time",
    length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21 };
  const SWAG = { ...SPRINT, id: "swag-contest", title: "Swag Contest", category: "showcase", vote: { ballot_min: 2 }, metric: "votes" };
  const api = {
    getStatus: async () => ({ arena: "https://arena.test", gpu: false, challenges: [
      { event: SPRINT, folder: "sprint_2m", task: "S", recipe: {}, knobs: [], running: 1 },
      { event: SWAG, folder: "swag_contest", task: "W", recipe: {}, knobs: [], running: 0 },
    ] }),
    getHub: async () => ({ user: null, reachable: true, can_pay: false }),
    startLogin: vi.fn(async () => ({ url: "https://huggingface.co/oauth/device?user_code=X", code: "X" })),
    getLogin: async () => ({ state: "waiting", output: "" }),
    getCode: async () => ({ fork: null, changes: [], identity: true, commit: "abc1234", unpushed: 0 }),
    useFork: async () => ({ fork: "alice/microduck-challenges", changes: [], identity: true, commit: "abc1234", unpushed: 0 }),
  };
  return { api, SPRINT, SWAG };
});
vi.mock("./api.js", () => api);
vi.mock("../thumbnail.js", () => ({ renderThumbnails: async () => new Map() }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the workshop's home", () => {
  it("draws the cover, Ready to train? and the challenges, then logs in with the browser", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import("./main.js");
    for (let i = 0; i < 5; i += 1) await settle();
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
});
