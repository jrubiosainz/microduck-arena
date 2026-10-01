import { describe, expect, it, vi } from "vitest";
import { performancePanel } from "./performance.js";

const TEXT = '{"timeline_version": 1, "duration_s": 20.0, "keyframes": [{"t": 0.0}]}\n';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const edit = (box, value) => {
  const text = box.querySelector("textarea");
  text.value = value;
  text.dispatchEvent(new Event("input"));
};

describe("the performance panel", () => {
  it("shows the file, and Save and play only once it is changed", async () => {
    const box = performancePanel({ guide: "https://arena.test/#/e/got-a-talent/guide" },
      { load: async () => ({ text: TEXT }), save: vi.fn(), onSaved: vi.fn() });
    await flush();
    expect(box.querySelector("textarea").value).toBe(TEXT);
    expect(box.querySelector(".performance__save").hidden).toBe(true);
    expect(box.querySelector("a").href).toBe("https://arena.test/#/e/got-a-talent/guide");
    edit(box, TEXT.replace("20.0", "12.0"));
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });

  it("saves, then plays: the button goes until the next change", async () => {
    const save = vi.fn(async (text) => ({ text }));
    const onSaved = vi.fn();
    const box = performancePanel({ guide: "#" }, { load: async () => ({ text: TEXT }), save, onSaved });
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
    const box = performancePanel({ guide: "#" }, { load: async () => ({ text: TEXT }), save, onSaved: vi.fn() });
    await flush();
    edit(box, TEXT.replace("20.0", "25.0"));
    box.querySelector(".performance__save").click();
    await flush();
    expect(box.querySelector(".performance__why").hidden).toBe(false);
    expect(box.querySelector(".performance__why").textContent).toContain("longer than this event's 20 s");
    expect(box.querySelector("textarea").value).toContain("25.0");
    expect(box.querySelector(".performance__save").hidden).toBe(false);
  });
});
