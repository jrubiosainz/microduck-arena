import { describe, expect, it } from "vitest";
import { voteButton } from "./votebutton.js";

const event = { id: "got-a-talent" };

describe("voteButton", () => {
  it("points at the event's voting booth", () => {
    const link = voteButton(event, { variant: "panel" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("#/v/got-a-talent");
  });

  it("reads VOTE HERE, not just VOTE -- the owner's complaint was that it did not read as a button", () => {
    const link = voteButton(event, { variant: "panel" });
    expect(link.textContent).toBe("VOTE HERE");
  });

  it("carries a ballot icon that is out of the accessible name, since the label already says it", () => {
    const svg = voteButton(event, { variant: "sticker" }).querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("draws the icon with paths on currentColor, so it inherits the link's own ink", () => {
    const svg = voteButton(event, { variant: "panel" }).querySelector("svg");
    const paths = [...svg.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.length).toBeLessThanOrEqual(3);
    for (const path of paths) {
      expect(path.getAttribute("fill") === "currentColor" || path.getAttribute("stroke") === "currentColor").toBe(true);
    }
  });

  it("wears a distinct class per variant, since the two placements are styled differently", () => {
    expect(voteButton(event, { variant: "sticker" }).className).toContain("vote-button--sticker");
    expect(voteButton(event, { variant: "panel" }).className).toContain("vote-button--panel");
  });

  it("draws the panel's icon bigger than the sticker's", () => {
    const size = (variant) =>
      Number(voteButton(event, { variant }).querySelector("svg").getAttribute("width"));
    expect(size("panel")).toBeGreaterThan(size("sticker"));
  });
});
