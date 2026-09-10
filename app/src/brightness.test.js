import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT, MAX, MIN, clampBrightness, readBrightness, writeBrightness } from "./brightness.js";

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* nothing stored */
  }
});

describe("clampBrightness", () => {
  it("keeps a sensible value", () => {
    expect(clampBrightness(1.4)).toBe(1.4);
  });

  it("never returns a value that would put the stage back in the dark", () => {
    expect(clampBrightness(0)).toBe(MIN);
    expect(clampBrightness(-3)).toBe(MIN);
  });

  it("caps the top so the robots cannot be blown out entirely", () => {
    expect(clampBrightness(99)).toBe(MAX);
  });

  it("falls back to the default for anything that is not a number", () => {
    for (const bad of ["", "abc", null, undefined, NaN, {}]) {
      expect(clampBrightness(bad)).toBe(DEFAULT);
    }
  });
});

describe("remembering the choice", () => {
  it("starts at the default", () => {
    expect(readBrightness()).toBe(DEFAULT);
  });

  it("reads back what was written", () => {
    writeBrightness(1.8);
    expect(readBrightness()).toBe(1.8);
  });

  it("clamps on the way in, so a hand-edited value cannot darken the stage", () => {
    writeBrightness(0.01);
    expect(readBrightness()).toBe(MIN);
  });

  it("survives junk in storage", () => {
    localStorage.setItem("arena.brightness", "not a number");
    expect(readBrightness()).toBe(DEFAULT);
  });

  it("returns the value it applied even when it cannot store it", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(writeBrightness(1.6)).toBe(1.6);
    } finally {
      localStorage.setItem = original;
    }
  });
});
