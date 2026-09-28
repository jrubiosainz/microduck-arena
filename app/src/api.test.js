import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ballotTraceUrl,
  clipUrl,
  getBallot,
  getBallotTrace,
  getBroadcast,
  getLeaderboard,
  getLive,
  getPlayer,
  getStandings,
  getSettle,
  getTrace,
  submitPolicy,
  tryPolicy,
} from "./api.js";

function respondWith({ ok = true, status = 200, statusText = "OK", body, bytes }) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    statusText,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
    arrayBuffer: async () => bytes,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("the error contract", () => {
  it("surfaces the server's sentence, not the status code", async () => {
    respondWith({ ok: false, status: 400, body: { detail: "not a loadable ONNX model: nope" } });
    await expect(getLeaderboard("sprint-2m")).rejects.toThrow("not a loadable ONNX model: nope");
  });

  it("applies the same contract to a trace fetch", async () => {
    // This is the one that used to throw "trace 404" and lose the reason.
    respondWith({ ok: false, status: 404, body: { detail: "no such run: '01NOPE'" } });
    await expect(getTrace("01NOPE")).rejects.toThrow("no such run: '01NOPE'");
  });

  it("stringifies a non-string detail instead of [object Object]", async () => {
    // FastAPI's validation errors put an array here.
    respondWith({ ok: false, status: 422, body: { detail: [{ type: "missing" }] } });
    await expect(getTrace("x")).rejects.toThrow(/"type":"missing"/);
  });

  it("falls back to the status line when the body is not JSON", async () => {
    respondWith({ ok: false, status: 502, statusText: "Bad Gateway" });
    await expect(getTrace("x")).rejects.toThrow("502 Bad Gateway");
  });

  it("returns a Float32Array on success", async () => {
    const source = new Float32Array([1.5, 2.5, 3.5]);
    respondWith({ bytes: source.buffer });
    const trace = await getTrace("01OK");
    expect(trace).toBeInstanceOf(Float32Array);
    expect([...trace]).toEqual([1.5, 2.5, 3.5]);
  });

  it("fetches a run's settle the way it fetches its trace", async () => {
    respondWith({ bytes: new Float32Array([0.5]).buffer });
    const settle = await getSettle("01OK");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/01OK/settle");
    expect([...settle]).toEqual([0.5]);
  });
});

describe("standings and players", () => {
  it("returns the ladder rows", async () => {
    respondWith({ body: { rows: [{ rank: 1, user: "ann", points: 360 }] } });
    expect(await getStandings()).toEqual([{ rank: 1, user: "ann", points: 360 }]);
    expect(fetch.mock.calls[0][0]).toBe("/api/standings");
  });

  it("returns a player", async () => {
    respondWith({ body: { user: "ann", points: 360, rank: 1, best: [] } });
    expect(await getPlayer("ann")).toEqual({ user: "ann", points: 360, rank: 1, best: [] });
    expect(fetch.mock.calls[0][0]).toBe("/api/players/ann");
  });

  it("returns null when nobody by that name has published", async () => {
    respondWith({ ok: false, status: 404, body: { detail: "'nobody' has not published yet" } });
    expect(await getPlayer("nobody")).toBeNull();
  });

  it("still surfaces any other failure as the server's sentence", async () => {
    respondWith({ ok: false, status: 500, body: { detail: "store unreadable" } });
    await expect(getPlayer("ann")).rejects.toThrow("store unreadable");
  });
});

describe("the ballot", () => {
  it("reads a field to judge", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ state: "ballot", ballot: "tok.mac", lanes: 3, cast_today: 1, per_day: 20 }),
    });
    expect(await getBallot("swag-contest")).toEqual({
      state: "ballot", ballot: "tok.mac", lanes: 3, cast_today: 1, per_day: 20,
    });
  });

  it("reads being signed out as a state, not a failure", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    expect(await getBallot("swag-contest")).toEqual({ state: "signed-out" });
  });

  it("addresses a lane's replay through the ballot and never a run", () => {
    expect(ballotTraceUrl("tok.mac", 2)).toBe("/api/ballots/tok.mac/lanes/2/trace");
  });

  it("applies the same error contract to a lane's replay", async () => {
    respondWith({ ok: false, status: 404, body: { detail: "no such ballot: 'tok.mac'" } });
    await expect(getBallotTrace("tok.mac", 2)).rejects.toThrow("no such ballot: 'tok.mac'");
  });

  it("stringifies a non-string detail instead of [object Object]", async () => {
    // FastAPI's validation errors put an array here.
    respondWith({ ok: false, status: 422, body: { detail: [{ type: "missing" }] } });
    await expect(getBallotTrace("tok.mac", 2)).rejects.toThrow(/"type":"missing"/);
  });

  it("falls back to the status line when the body is not JSON", async () => {
    respondWith({ ok: false, status: 502, statusText: "Bad Gateway" });
    await expect(getBallotTrace("tok.mac", 2)).rejects.toThrow("502 Bad Gateway");
  });

  it("returns a Float32Array fetched over the ballot-scoped url", async () => {
    const source = new Float32Array([1.5, 2.5, 3.5]);
    respondWith({ bytes: source.buffer });
    const trace = await getBallotTrace("tok.mac", 2);
    expect(trace).toBeInstanceOf(Float32Array);
    expect([...trace]).toEqual([1.5, 2.5, 3.5]);
    expect(fetch.mock.calls[0][0]).toBe("/api/ballots/tok.mac/lanes/2/trace");
  });
});

describe("the channel", () => {
  it("reads the grid uncached, since the clock is in it", async () => {
    respondWith({ body: { version: 1, now_ms: 5000, build: "b", slots: [] } });
    expect(await getLive()).toEqual({ version: 1, now_ms: 5000, build: "b", slots: [] });
    expect(fetch.mock.calls[0]).toEqual(["/api/live", { cache: "no-store" }]);
  });

  it("fetches a broadcast by its id", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push([url, init]);
      return { ok: true, json: async () => ({ dialogue: { turns: [] }, plan: { duration_ms: 4000 } }) };
    };
    const body = await getBroadcast("01M2K");
    expect(calls[0][0]).toBe("/api/live/broadcast/01M2K");
    expect(body.plan.duration_ms).toBe(4000);
  });

  it("gives nothing for a broadcast that is gone", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await getBroadcast("gone")).toBe(null);
  });

  it("addresses a clip's files under the run, versioned by the render they belong to", () => {
    // The files are cached for a year as immutable, so a clip rendered again
    // on a new stage has to be a new URL or the old one plays for ever.
    expect(clipUrl("01ABC", "clip.mp4", "20260922T151828Z")).toBe(
      "/api/runs/01ABC/clip/clip.mp4?v=20260922T151828Z",
    );
  });
});

describe("entering a policy", () => {
  function sentForm() {
    return Object.fromEntries(globalThis.fetch.mock.calls[0][1].body.entries());
  }

  it("publishes a Hub repo at a revision, with its code link", async () => {
    respondWith({ body: { run_id: "r1" } });
    await submitPolicy("sprint-2m", {
      repoId: "alice/microduck-walker", revision: "abc1234", envUrl: "https://github.com/a/b", name: "", livery: "classic", commandVx: "",
    });
    expect(globalThis.fetch.mock.calls[0][0]).toBe("/api/events/sprint-2m/submit");
    expect(sentForm()).toEqual({
      repo_id: "alice/microduck-walker", revision: "abc1234", env_url: "https://github.com/a/b", livery: "classic",
    });
  });

  it("tests a file when given one", async () => {
    respondWith({ body: { trace_b64: "" } });
    await tryPolicy("sprint-2m", { file: new File(["x"], "p.onnx"), livery: "classic" });
    expect(Object.keys(sentForm())).toEqual(["file", "livery"]);
  });
});
