import { describe, expect, it } from "vitest";
import { flyer } from "./flyer.js";

const SPRINT = {
  id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", vote: null,
  length_m: 2, slope_deg: 0, rig: "legs", sweep_lo: 0.2, sweep_hi: 1.2, sweep_count: 21,
};
const SWAG = { ...SPRINT, id: "swag-contest", title: "Swag Contest", category: "showcase", vote: { ballot_min: 2 } };

describe("flyer", () => {
  it("leads to the race page and says who holds it, by default", () => {
    const note = flyer(SPRINT, []);
    expect(note.querySelector(".challenge-link").getAttribute("href")).toBe("#/e/sprint-2m");
    expect(note.querySelector(".flyer-leader").textContent).toContain("be the first");
  });

  it("pins VOTE HERE on a voted event, by default", () => {
    expect(flyer(SWAG, []).querySelector(".vote-button")).not.toBeNull();
  });

  it("can lead elsewhere, with no leader line and its own corner", () => {
    const corner = document.createElement("span");
    corner.className = "mine";
    const note = flyer(SWAG, null, { href: "#/c/swag-contest", corner });
    expect(note.querySelector(".challenge-link").getAttribute("href")).toBe("#/c/swag-contest");
    expect(note.querySelector(".flyer-leader")).toBeNull();
    expect(note.querySelector(".vote-button")).toBeNull();
    expect(note.querySelector(".mine")).not.toBeNull();
  });

  it("can have no corner at all", () => {
    expect(flyer(SWAG, null, { corner: null }).querySelector(".vote-button")).toBeNull();
  });
});
