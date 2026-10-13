import { describe, expect, it, vi } from "vitest";
import { formatTimeline, placementPlan } from "./placement.js";

const TALENT = { id: "got-a-talent", size_m: [2.6, 3.8], max_ducks: 4, edge_margin_m: 0.3, min_spacing_m: 0.3 };
const SOLO = '{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}, {"t": 2.0, "twist": [1, 0, 0]}], "voice": {"pitch": 0.3}}\n';
const TROUPE = JSON.stringify({ timeline_version: 2, duration_s: 20, ducks: [
  { policy: "self", keyframes: [{ t: 0 }] },
  { policy: `pollen-robotics/microduck-walker@${"c".repeat(40)}`, start: { x: 0.4, y: -0.6, yaw: 90 }, keyframes: [{ t: 0 }] },
] });
const FOUR = JSON.stringify({ timeline_version: 2, duration_s: 20,
  ducks: [0, 0.5, 1, 1.5].map((y) => ({ policy: "self", start: { x: 0, y, yaw: 0 }, keyframes: [{ t: 0 }] })) });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The stage point (x, y), as a pointer finds it on a plan drawn 1 px a centimetre (380 × 260, and the audience's 30 below). */
const at = (x, y) => ({ clientX: 190 + y * 100, clientY: 130 + x * 100 });
const press = (node, x, y) => node.dispatchEvent(new MouseEvent("pointerdown", { ...at(x, y), bubbles: true }));
const drag = (x, y) => window.dispatchEvent(new MouseEvent("pointermove", at(x, y)));
const release = () => window.dispatchEvent(new MouseEvent("pointerup"));

function open(text, performers = async () => []) {
  let current = text;
  const write = vi.fn((value) => { current = value; });
  const plan = placementPlan(TALENT, { read: () => current, write, performers });
  plan.el.querySelector("svg").getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 290 });
  const edit = (value) => {
    current = value;
    plan.refresh();
  };
  return { plan, write, edit, ducks: () => [...plan.el.querySelectorAll(".placement__duck")] };
}

describe("the placement plan", () => {
  it("draws each duck where its start puts it, the audience at the bottom, the star apart", () => {
    const { ducks } = open(TROUPE);
    const [star, other] = ducks();
    expect(star.classList.contains("placement__duck--star")).toBe(true);
    expect(star.textContent).toBe("★");
    expect(star.getAttribute("transform")).toBe("translate(0 0)");
    expect(other.textContent).toBe("1");
    // 0.4 m towards the audience (down the plan), 0.6 m to the audience's left (left on the plan).
    expect(other.getAttribute("transform")).toBe("translate(-60 40)");
  });

  it("moves a duck where it is dropped and writes its start into the text", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(-0.2, 0.5);
    release();
    const written = JSON.parse(write.mock.lastCall[0]);
    expect(written.ducks[1].start).toEqual({ x: -0.2, y: 0.5, yaw: 90 });
    expect(written.ducks[0]).toEqual(JSON.parse(TROUPE).ducks[0]);
    expect(ducks()[1].getAttribute("transform")).toBe("translate(50 -20)");
  });

  it("turns a spot the loader would refuse magenta and does not take it", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(0.1, -0.2); // 0.22 m from the star: closer than 0.3 m
    expect(ducks()[1].classList.contains("placement__duck--refused")).toBe(true);
    drag(1.1, -0.6); // |x| at most 2.6 / 2 - 0.3 m
    expect(ducks()[1].classList.contains("placement__duck--refused")).toBe(true);
    release();
    expect(write).not.toHaveBeenCalled();
    expect(ducks()[1].getAttribute("transform")).toBe("translate(-60 40)");
    expect(ducks()[1].classList.contains("placement__duck--refused")).toBe(false);
  });

  it("takes a duck on the margin, as the loader does", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(0.4, -1.6); // |y| = 3.8 / 2 - 0.3 m exactly, which floats put a hair past 1.9 - 0.3
    release();
    expect(JSON.parse(write.mock.lastCall[0]).ducks[1].start).toEqual({ x: 0.4, y: -1.6, yaw: 90 });
  });

  it("turns a duck with its dot", () => {
    const { ducks, write } = open(TROUPE);
    press(ducks()[1].querySelector(".placement__handle"), 0.4, -0.35);
    drag(0.4, -1.2); // straight to the audience's left of the duck
    release();
    expect(JSON.parse(write.mock.lastCall[0]).ducks[1].start).toEqual({ x: 0.4, y: -0.6, yaw: -90 });
  });

  it("makes a v1 text the troupe of one it is once its duck moves, and writes nothing for a click", () => {
    const { ducks, write } = open(SOLO);
    press(ducks()[0].querySelector(".placement__body"), 0, 0);
    release();
    expect(write).not.toHaveBeenCalled();
    press(ducks()[0].querySelector(".placement__body"), 0, 0);
    drag(0.5, 0.3);
    release();
    expect(write.mock.lastCall[0]).toBe(`{
  "timeline_version": 2,
  "duration_s": 20,
  "ducks": [
    {
      "policy": "self",
      "start": {"x": 0.5, "y": 0.3, "yaw": 0},
      "keyframes": [
        {"t": 0},
        {"t": 2, "twist": [1, 0, 0]}
      ],
      "voice": {"pitch": 0.3}
    }
  ]
}
`);
  });

  it("moves the markers when the text changes, and greys the plan out while it is not JSON", () => {
    const { plan, ducks, edit, write } = open(SOLO);
    edit(TROUPE);
    expect(ducks()).toHaveLength(2);
    expect(ducks()[1].getAttribute("transform")).toBe("translate(-60 40)");
    edit(TROUPE.slice(0, -2));
    expect(plan.el.classList.contains("placement--off")).toBe(true);
    expect(ducks()).toHaveLength(2); // the last plan, greyed
    expect(plan.el.querySelector(".placement__add").hidden).toBe(true);
    press(ducks()[1].querySelector(".placement__body"), 0.4, -0.6);
    drag(-0.5, 0.5);
    release();
    expect(write).not.toHaveBeenCalled();
    edit(TROUPE);
    expect(plan.el.classList.contains("placement--off")).toBe(false);
  });

  it("adds the duck chosen on the nearest free spot, a keyframe at 0, up to the event's cap", async () => {
    const local = "local:sprint_2m/2026-09-25_10-00-00_first@1500";
    const { plan, write, edit } = open(SOLO, async () => [
      { policy: local, label: "sprint_2m · 2026-09-25_10-00-00_first · 1500", rig: "legs" },
      { policy: `alice/microduck-roll@${"b".repeat(40)}`, label: "alice/microduck-roll@bbbbbbb", rig: "rollers" },
    ]);
    await flush();
    const add = plan.el.querySelector(".placement__add");
    expect([...add.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Your trainings", "Published"]);
    expect([...add.options].map((option) => option.textContent)).toEqual([
      "+ duck", "This checkpoint again", "sprint_2m · 2026-09-25_10-00-00_first · 1500 · legs", "alice/microduck-roll@bbbbbbb · rollers"]);
    add.value = local;
    add.dispatchEvent(new Event("change"));
    const written = JSON.parse(write.mock.lastCall[0]);
    expect(written.ducks.map((duck) => duck.policy)).toEqual(["self", local]);
    // Beside the star, touching distance: the nearest spot the loader takes.
    expect(written.ducks[1]).toEqual({ policy: local, start: { x: 0, y: -0.3, yaw: 0 }, keyframes: [{ t: 0 }] });
    expect(add.value).toBe("");
    edit(FOUR);
    expect(add.hidden).toBe(true);
  });

  it("still adds this checkpoint again when the list of other policies cannot be had", async () => {
    const { plan, write } = open(SOLO, async () => { throw new Error("the workshop did not answer"); });
    await flush();
    const add = plan.el.querySelector(".placement__add");
    expect([...add.options].map((option) => option.textContent)).toEqual(["+ duck", "This checkpoint again"]);
    add.value = "self";
    add.dispatchEvent(new Event("change"));
    expect(JSON.parse(write.mock.lastCall[0]).ducks.map((duck) => duck.policy)).toEqual(["self", "self"]);
  });

  it("writes a timeline as an author lays one out", () => {
    expect(formatTimeline({ timeline_version: 2, duration_s: 20, ducks: [{ policy: "self", start: { x: 0, y: 0, yaw: 0 },
      song: [{ t: 1, note: "C4", for: 0.5 }], keyframes: [{ t: 0, twist: [1, 0, 0] }] }] })).toBe(`{
  "timeline_version": 2,
  "duration_s": 20,
  "ducks": [
    {
      "policy": "self",
      "start": {"x": 0, "y": 0, "yaw": 0},
      "song": [
        {"t": 1, "note": "C4", "for": 0.5}
      ],
      "keyframes": [
        {"t": 0, "twist": [1, 0, 0]}
      ]
    }
  ]
}`);
  });
});
