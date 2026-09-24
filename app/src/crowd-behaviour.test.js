import { describe, it, expect } from "vitest";
import { olaAt, standAmount, bubbleAt, crowdStanding } from "./crowd-behaviour.js";
describe("audience timing", () => {
  it("rests seated, propagates a wave, then sits back down", () => {
    const wave = olaAt(0),
      first = wave.reverse ? 1 : 0,
      last = 1 - first;
    expect(standAmount(0, first)).toBe(0);
    expect(standAmount(wave.start + 0.8, first)).toBe(1);
    expect(standAmount(wave.start + 0.8, last)).toBe(0);
    expect(standAmount(wave.start + 4.4, last)).toBe(1);
    expect(standAmount(wave.start + 6, last)).toBe(0);
  });
  it("is reproducible after seeking and leaves long rests between waves", () => {
    const a = olaAt(80);
    olaAt(1000);
    expect(olaAt(80)).toEqual(a);
    expect(olaAt(28).start - olaAt(0).start).toBeGreaterThan(20);
  });
  it("bounds bubbles to real spectators and fades them out", () => {
    for (let t = 0; t < 120; t += 0.1)
      for (let i = 0; i < 3; i++) {
        const b = bubbleAt(t, i, 216);
        if (!b) continue;
        expect(b.seat).toBeGreaterThanOrEqual(0);
        expect(b.seat).toBeLessThan(216);
        expect(b.opacity).toBeGreaterThanOrEqual(0);
        expect(b.opacity).toBeLessThanOrEqual(1);
        expect(["GO!", "QUACK!"]).toContain(b.word);
      }
    expect(bubbleAt(3, 0, 0)).toBeNull();
  });
});

describe("crowd reactions", () => {
  const positions = Array.from({ length: 216 }, (_, i) => i / 215);
  it("spreads even a sudden victory over multiple frames and reaches 100 percent", () => {
    const mood = t => ({ joy: t >= 15 ? 1 : 0 });
    let previous = crowdStanding(14.99, positions, mood);
    for (let t = 15; t < 15.8; t += .02) {
      const next = crowdStanding(t, positions, mood);
      expect(Math.max(...next.map((v, i) => Math.abs(v - previous[i])))).toBeLessThan(.16);
      previous = next;
    }
    expect(crowdStanding(15.8, positions, mood).every(v => v === 1)).toBe(true);
    expect(crowdStanding(15.3, positions, mood).some(v => v > .2 && v < .9)).toBe(true);
  });
  it("keeps every speaker standing throughout their bubble", () => {
    for (let t = 0; t < 90; t += .05) {
      const amounts = crowdStanding(t, positions);
      for (let slot = 0; slot < 3; slot++) {
        const cue = bubbleAt(t, slot, positions.length);
        if (cue) expect(amounts[cue.seat]).toBe(1);
      }
    }
  });
  it("increases standing fans with excitement, up to everyone at peak joy", () => {
    const quiet = crowdStanding(15, positions);
    const building = crowdStanding(15, positions, { encouragement: 1, joy: .4 });
    const peak = crowdStanding(15, positions, { encouragement: 1, joy: 1 });
    expect(quiet.filter(x => x === 1).length).toBeGreaterThan(0);
    expect(building.filter(x => x === 1).length).toBeGreaterThan(quiet.filter(x => x === 1).length);
    expect(peak.every(x => x === 1)).toBe(true);
    expect(crowdStanding(15, positions, { encouragement: 1, joy: .4 })).toEqual(building);
  });
});
