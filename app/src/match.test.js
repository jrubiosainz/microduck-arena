import { describe, expect, it, vi } from "vitest";
import { getBoutSettle, getBoutTrace } from "./api.js";
import { boutLine, matchHall, renderMatch } from "./match.js";

vi.mock("./api.js", () => ({
  getMatch: vi.fn(), getMe: vi.fn(), getBoutTrace: vi.fn(), getBoutSettle: vi.fn(),
  matchClipUrl: (id, name, version) => `/api/matches/${id}/clip/${name}?v=${version}`,
}));
const setLanes = vi.fn();
vi.mock("./viewer.js", () => ({ createViewer: async () => ({ setLanes, dispose() {}, follow() {}, sweep() {} }) }));
vi.mock("./signage.js", () => ({ signage: () => document.createElement("div"), footer: () => document.createElement("div") }));
vi.mock("./router.js", async (original) => ({ ...(await original()), dress() {} }));

const match = { match_id: "tug-of-war-0001-008", cup: 1, round: "final", group: null, title: "Final · Tank vs Lean",
  event: { id: "tug-of-war", title: "Tug of War", rig: "legs" }, a: { user: "ann", policy_name: "Tank", name: "Tank", livery: "blue" },
  b: { user: "bob", policy_name: "Lean", name: "Lean", livery: "classic" }, wins: [2, 1], winner: "a", decided_by: "bouts", clip: "v1",
  bouts: [
    { k: 0, a_side: "west", winner: "a", how: "pit", time_s: 8.42 }, { k: 1, a_side: "east", winner: "b", how: "marker", time_s: 45 },
    { k: 2, a_side: "west", winner: null, how: "draw", time_s: 45 }, { k: 3, a_side: "east", winner: "a", how: "pit", time_s: 3.1 }] };

describe("a match page", () => {
  it("names the cup, the round and both sides, gives the score, the bouts and the clip", () => {
    const page = matchHall(match);
    expect(page.querySelector("#title").getAttribute("href")).toBe("#/c/tug-of-war/1");
    expect(page.querySelector("#title").textContent).toBe("Tug of War Cup #1");
    expect(page.querySelector(".eyebrow").textContent).toBe("Final");
    expect(page.querySelector(".match-score").textContent).toBe("2–1");
    expect(page.querySelector(".stamp").textContent).toBe("Tank wins");
    expect([...page.querySelectorAll(".match-bout")].map((b) => b.textContent)).toEqual([
      "Bout 1 · Tank wins · Lean in the pit · 8.42\u00a0s", "Bout 2 · Lean wins · the marker on their side · 45.00\u00a0s",
      "Bout 3 · a draw · 45.00\u00a0s", "Bout 4 · Tank wins · Lean in the pit · 3.10\u00a0s"]);
    expect(page.querySelector(".match-clip video").getAttribute("src")).toBe("/api/matches/tug-of-war-0001-008/clip/landscape.mp4?v=v1");
  });

  it("links each side's player and names its policy in the byline", () => {
    const byline = matchHall(match).querySelector("#byline");
    expect(byline.textContent).toBe("@ann · Tank vs @bob · Lean");
    expect([...byline.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#/p/ann", "#/p/bob"]);
  });

  it("calls a group match by its group and has no clip until one is ready", () => {
    const page = matchHall({ ...match, round: "group", group: "A", clip: null });
    expect(page.querySelector(".eyebrow").textContent).toBe("Group A");
    expect(page.querySelector(".match-clip")).toBeNull();
  });

  it("keeps a bout's time with its unit, so a narrow column never strands the \"s\" on a line of its own", () => {
    expect(boutLine(match, match.bouts[1])).toMatch(/ 45\.00\u00a0s$/);
  });

  it("names the pit's victim whichever side won the bout", () => {
    expect(boutLine(match, match.bouts[1])).toBe("Bout 2 · Lean wins · the marker on their side · 45.00\u00a0s");
    expect(boutLine(match, { k: 4, winner: "b", how: "pit", time_s: 5 })).toBe("Bout 5 · Lean wins · Tank in the pit · 5.00\u00a0s");
  });
});

describe("playing a bout", () => {
  it("retries a bout whose fetch failed on the next click instead of remembering the failure", async () => {
    const { getMatch, getMe } = await import("./api.js");
    getMatch.mockResolvedValue(match);
    getMe.mockResolvedValue(null);
    const trace = [new Float32Array(0), new Float32Array(0)];
    getBoutTrace.mockImplementation(async (id, k) => {
      if (k === 1 && getBoutTrace.mock.calls.filter(([, j]) => j === 1).length === 1) throw new Error("down");
      return trace;
    });
    getBoutSettle.mockResolvedValue(trace);
    const root = document.createElement("div");
    document.body.append(root);
    await renderMatch(root, match.match_id, {});
    setLanes.mockClear();
    const rows = root.querySelectorAll(".match-bout");
    rows[1].click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(setLanes).not.toHaveBeenCalled();
    rows[1].click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(setLanes).toHaveBeenCalledTimes(1);
    expect(rows[1].hasAttribute("aria-current")).toBe(true);
  });
});
