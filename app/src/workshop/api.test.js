import { afterEach, describe, expect, it, vi } from "vitest";
import { getCheckpoint } from "./api.js";

afterEach(() => {
  delete globalThis.fetch;
});

const encoded = (floats) => btoa(String.fromCharCode(...new Uint8Array(new Float32Array(floats).buffer)));

describe("a checkpoint's evaluation", () => {
  it("brings the timed string of a tug beside its traces", async () => {
    const frames = 3;
    const body = { checkpoint: 250, ducks: 2, trace_b64: encoded(new Array(2 * frames * 21).fill(0)), string_b64: encoded(new Array(frames * 51).fill(1)) };
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => body }));
    const evaluation = await getCheckpoint("tug-of-war", "first", 250);
    expect(evaluation.string).toBeInstanceOf(Float32Array);
    expect(evaluation.string.length).toBe(frames * 51);
    expect(evaluation.traces.map((t) => t.length)).toEqual([frames * 21, frames * 21]);
    expect("string_b64" in evaluation).toBe(false);
  });
});
