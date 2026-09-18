import { describe, expect, it } from "vitest";
import { loadTones, windGust } from "./voice.js";

describe("loadTones", () => {
  it("reads the two raw float32 files", async () => {
    const bytes = new Float32Array(28800).fill(0.5).buffer;
    const fetcher = async (url) => ({ ok: url.includes("commentator-"), arrayBuffer: async () => bytes });
    const tones = await loadTones(fetcher);
    expect(tones.peter).toHaveLength(28800);
    expect(tones.ray[0]).toBe(0.5);
    await expect(loadTones(async () => ({ ok: false }))).rejects.toThrow("No voice for peter");
  });
});

describe("windGust", () => {
  const seeded = (seed) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  it("is 0.36 s at -1 dBFS, silent at both ends, faded in over 0.1 s", () => {
    const gust = windGust(seeded(1040));
    expect(gust).toHaveLength(17280);
    expect(gust[0]).toBe(0);
    expect(gust.at(-1)).toBe(0);
    expect(Math.max(...gust.map(Math.abs))).toBeCloseTo(10 ** (-1 / 20), 3);
    const early = Math.max(...gust.subarray(0, 240).map(Math.abs));
    expect(early).toBeLessThan(0.3);
    expect(windGust(seeded(1040))).toEqual(gust);
  });
});
