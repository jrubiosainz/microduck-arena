import { describe, expect, it, vi } from "vitest";
import { readyList, runningSticker } from "./home.js";

const on = { onCheck: vi.fn(), onUseFork: vi.fn() };
const lines = (list) => [...list.children].map((li) => [li.querySelector(".check__label").textContent, li.classList.contains("check--ticked")]);

describe("Ready to train?", () => {
  it("ticks billing only for an account that can pay", () => {
    const code = { fork: null };
    expect(lines(readyList({ account: { phase: "in", user: "a", canPay: true }, code, gpu: false }, on))[0]).toEqual(["Hugging Face Jobs, billing set up", true]);
    expect(lines(readyList({ account: { phase: "in", user: "a", canPay: false }, code, gpu: false }, on))[0][1]).toBe(false);
    expect(lines(readyList({ account: { phase: "out" }, code, gpu: false }, on))[0][1]).toBe(false);
  });

  it("ticks the fork and names it", () => {
    const list = readyList({ account: { phase: "out" }, code: { fork: "alice/microduck-challenges" }, gpu: false }, on);
    expect(lines(list)[1]).toEqual(["Working in your fork", true]);
    expect(list.children[1].textContent).toContain("alice/microduck-challenges");
  });

  it("shows the GPU only where there is one, ticked", () => {
    expect(lines(readyList({ account: { phase: "out" }, code: null, gpu: false }, on))).toHaveLength(2);
    expect(lines(readyList({ account: { phase: "out" }, code: null, gpu: true }, on))[2]).toEqual(["NVIDIA GPU on this machine", true]);
  });
});

describe("the running sticker", () => {
  it("counts the trainings running", () => {
    expect(runningSticker(0)).toBeNull();
    expect(runningSticker(1).textContent).toBe("1 training now");
    expect(runningSticker(2).textContent).toBe("2 trainings now");
  });
});
