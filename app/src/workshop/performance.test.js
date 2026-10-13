import { describe, expect, it, vi } from "vitest";
import { performancePanel } from "./performance.js";

const TEXT = '{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}]}\n';
const TALENT = { id: "got-a-talent", size_m: [2.6, 3.8], max_ducks: 4, edge_margin_m: 0.3, min_spacing_m: 0.3 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const edit = (box, value) => {
  const text = box.querySelector("textarea");
  text.value = value;
  text.dispatchEvent(new Event("input"));
};
const panel = (on, guide = "#") => performancePanel({ guide, event: TALENT },
  { load: async () => ({ text: TEXT }), save: vi.fn(), onSaved: vi.fn(), performers: async () => [], ...on });

describe("the performance panel", () => {
  it("shows the file, and Save and play only once it is changed", async () => {
    const box = panel({}, "https://arena.test/#/e/got-a-talent/guide");
    await flush();
    expect(box.querySelector("textarea").value).toBe(TEXT);
    expect(box.querySelector(".performance__save").hidden).toBe(true);
    expect(box.querySelector(".performance a").href).toBe("https://arena.test/#/e/got-a-talent/guide");
    edit(box, TEXT.replace("20.0", "12.0"));
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });

  it("is disabled until the file has loaded, so a save can never overwrite what the author never saw", async () => {
    let settle;
    const box = panel({ load: () => new Promise((resolve) => { settle = resolve; }) });
    expect(box.querySelector("textarea").disabled).toBe(true);
    expect(box.querySelector(".placement").classList.contains("placement--off")).toBe(true);
    settle({ text: TEXT });
    await flush();
    expect(box.querySelector("textarea").disabled).toBe(false);
    expect(box.querySelector(".placement").classList.contains("placement--off")).toBe(false);
  });

  it("stays disabled when the load fails, and shows the error", async () => {
    const box = panel({ load: async () => { throw new Error("timeline.json: could not be read"); } });
    await flush();
    expect(box.querySelector("textarea").disabled).toBe(true);
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    expect(box.querySelector(".performance__why").textContent).toContain("could not be read");
  });

  it("saves, then plays: the button goes until the next change", async () => {
    const save = vi.fn(async (text) => ({ text }));
    const onSaved = vi.fn();
    const box = panel({ save, onSaved });
    await flush();
    edit(box, TEXT.replace("20.0", "12.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(save).toHaveBeenCalledWith(TEXT.replace("20.0", "12.0"));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(box.querySelector(".performance__save").hidden).toBe(true);
  });

  it("says where a refused timeline is wrong, and keeps the text and the button", async () => {
    const save = vi.fn(async () => { throw new Error("duration_s: 25 s is longer than this event's 20 s"); });
    const box = panel({ save });
    await flush();
    edit(box, TEXT.replace("20.0", "25.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    expect(box.querySelector(".performance__why").textContent).toContain("longer than this event's 20 s");
    expect(box.querySelector("textarea").value).toContain("25.0");
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });

  it("hides the refusal once the text is edited back to the saved file", async () => {
    const save = vi.fn(async () => { throw new Error("duration_s: 25 s is longer than this event's 20 s"); });
    const box = panel({ save });
    await flush();
    edit(box, TEXT.replace("20.0", "25.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    edit(box, TEXT);
    expect(box.querySelector(".performance__why").hidden).toBe(true);
  });

  it("places the ducks above the text: a drag rewrites the text, an edit of it moves the plan", async () => {
    const box = panel({});
    await flush();
    const plan = box.querySelector(".placement");
    expect(plan.nextElementSibling.classList.contains("terminal")).toBe(true);
    box.querySelector(".placement svg").getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 290 });
    box.querySelector(".placement__body").dispatchEvent(new MouseEvent("pointerdown", { clientX: 190, clientY: 130, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 240, clientY: 130 }));
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(JSON.parse(box.querySelector("textarea").value).ducks[0].start).toEqual({ x: 0, y: 0.5, yaw: 0 });
    expect(box.querySelector(".performance__save").hidden).toBe(false);
    edit(box, "{");
    expect(plan.classList.contains("placement--off")).toBe(true);
  });
});
