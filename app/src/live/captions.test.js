import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptions, splitCaption } from "./captions.js";

const measure = (text) => text.length * 10;

describe("splitCaption", () => {
  it("keeps a short caption on one line", () => {
    expect(splitCaption("Twelve point four, Ray!", measure, 1000)).toEqual(["Twelve point four, Ray!"]);
  });

  it("splits a long one at the word boundary that balances the lines", () => {
    const text = "It is a number, Peter. A good one; I will grant you that much, and no more.";
    const lines = splitCaption(text, measure, 1000);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(text);
    expect(Math.abs(measure(lines[0]) - measure(lines[1]))).toBeLessThanOrEqual(60);
  });

  it("splits a caption of 43 characters even when it would fit, as Duck Jam did", () => {
    const text = "a".repeat(20) + " " + "b".repeat(22);
    expect(splitCaption(text, measure, 5000)).toHaveLength(2);
  });

  it("gives nothing back for a caption no split can fit", () => {
    expect(splitCaption("x".repeat(50) + " " + "y".repeat(50), measure, 400)).toBeNull();
  });
});

describe("createCaptions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the speaker's name and lines, and hides on demand", () => {
    const container = document.createElement("div");
    const captions = createCaptions(container);
    const panel = container.querySelector(".live-caption");
    expect(panel.hidden).toBe(true);
    captions.resize(1280);
    captions.show({ name: "Ray Quackson", text: "It is a number, Peter." });
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".live-caption-name").textContent).toBe("Ray Quackson");
    expect(panel.querySelector(".live-caption-text").textContent).toBe("It is a number, Peter.");
    captions.hide();
    expect(panel.hidden).toBe(true);
  });

  it("leaves the caption on screen untouched, and says nothing, when the next one cannot fit", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ measureText: (value) => ({ width: value.length * 10 }) });
    const container = document.createElement("div");
    const captions = createCaptions(container);
    const panel = container.querySelector(".live-caption");
    captions.resize(1280);
    captions.show({ name: "Ray Quackson", text: "It is a number, Peter." });
    const wide = { name: "Peter Duckry", text: "x".repeat(120) };
    // Every frame of that cue passes through here: a throw would cost the tick
    // what comes after it, sixty times a second.
    captions.show(wide);
    captions.show(wide);
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".live-caption-name").textContent).toBe("Ray Quackson");
    expect(panel.querySelector(".live-caption-text").textContent).toBe("It is a number, Peter.");
    // And the cue after it is shown as if nothing had happened.
    captions.show({ name: "Peter Duckry", text: "Twelve point four!" });
    expect(panel.querySelector(".live-caption-text").textContent).toBe("Twelve point four!");
  });
});
