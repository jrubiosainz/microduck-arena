import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ballotTraceUrl,
  getBallot,
  getBallotTrace,
  getLeaderboard,
  getPlayer,
  getStandings,
  getSettle,
  getTrace,
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
