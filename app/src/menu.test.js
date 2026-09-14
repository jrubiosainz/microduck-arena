import { describe, expect, it } from "vitest";
import { card } from "./menu.js";

const open = {
  id: "sprint-2m",
  title: "2 m Sprint",
  status: "open",
  rig: "legs",
  length_m: 2,
  slope_deg: 0,
  sweep_lo: 0.2,
  sweep_hi: 1.2,
  sweep_step: 0.05,
  sweep_count: 21,
};
const planned = { ...open, id: "best-jump", title: "Best Jump", status: "planned" };
const held = [{ user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 }];

describe("a programme card", () => {
  it("links into the race and carries its course drawing", () => {
    const el = card(open, held);
    const box = el.querySelector("a.card");
    expect(box.getAttribute("href")).toBe("#/e/sprint-2m");
    expect(box.querySelector("svg.card__art")).not.toBeNull();
  });

  it("shows who holds it and in what time", () => {
    const el = card(open, held);
    expect(el.querySelector(".card__who").textContent).toBe("cdeplanne");
    expect(el.querySelector(".card__time").textContent).toBe("9.456s");
    expect(el.querySelector(".card__star")).not.toBeNull();
  });

  it("invites an entry when no one has finished", () => {
    const el = card(open, []);
    expect(el.textContent).toContain("be the first");
    expect(el.querySelector(".card__time")).toBeNull();
  });

  it("distinguishes an empty race from one where nobody finished", () => {
    const dnf = [{ user: "a", policy_name: "p", score: 50, seeds_finished: 0 }];
    expect(card(open, dnf).textContent).toContain("no finisher yet");
  });
});

describe("a planned event's card", () => {
  it("is on the grid but is not a link", () => {
    const el = card(planned, []);
    expect(el.querySelector("a.card")).toBeNull();
    expect(el.querySelector(".card--planned")).not.toBeNull();
  });

  it("says why it cannot be entered, on the card itself", () => {
    // Not only in a tooltip: the reason is that its course does not exist.
    expect(card(planned, []).textContent).toContain("course not built yet");
  });

  it("never invites an entry it would refuse", () => {
    const el = card(planned, []);
    expect(el.textContent).not.toContain("be the first");
  });

  it("still draws its course, so the programme reads as one grid", () => {
    expect(card(planned, []).querySelector("svg.card__art")).not.toBeNull();
  });
});
