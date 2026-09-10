import { afterEach, describe, expect, it, vi } from "vitest";
import { getLeaderboard, getTrace } from "./api.js";

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
});
