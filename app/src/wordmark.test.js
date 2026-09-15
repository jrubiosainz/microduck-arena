import { describe, expect, it } from "vitest";
import { duckHead, wordmark } from "./wordmark.js";

describe("the wordmark", () => {
  it("splits the two words so each can take its own colour", () => {
    // MICRODUCK is the page's yellow, ARENA its orange. One element could not
    // carry two colours, so the split is what makes the treatment possible.
    const el = wordmark();
    expect(el.querySelector(".wordmark__solid").textContent).toBe("Microduck");
    expect(el.querySelector(".wordmark__arena").textContent).toBe("Arena");
  });

  it("is an h1, because it is the page's heading and not decoration", () => {
    expect(wordmark().tagName).toBe("H1");
  });
});

describe("the duck head", () => {
  it("points at the vendored mark", () => {
    expect(duckHead().getAttribute("src")).toBe("/duck-head-mark.webp");
  });

  it("is decorative, so it is not announced after the title", () => {
    // "Microduck Arena, duck head" is noise. The alt is empty on purpose.
    expect(duckHead().getAttribute("alt")).toBe("");
  });
});
