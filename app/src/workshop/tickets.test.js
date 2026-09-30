import { describe, expect, it, vi } from "vitest";
import { bars, officialTime, summary, ticketCard } from "./tickets.js";

const row = (n, score, finished = 5, status = "evaluated") => ({ n, status, score, seeds_finished: finished, seeds_total: 5, command_vx: 0.55 });
const TICKET = {
  id: "first", name: "first", where: "hf-jobs", state: "running", progress: { done: 1250, total: 3000 },
  started: "2026-09-30T09:15:00+00:00", run_id: "2026-09-30_09-15-00_first", dirty: false,
  checkpoints: [row(0, 50, 0), row(250, 8.1), row(500, 5.62), { n: 750, status: "queued" }], best: 500, published: null,
};

describe("a ticket", () => {
  it("draws a bar per checkpoint: the higher, the faster; the best starred", () => {
    const drawn = [...bars(TICKET.checkpoints, 500).children];
    expect(drawn.map((b) => b.className)).toEqual(["dnf", "", "best", "queued"]);
    expect(drawn[2].style.height).toBe("100%");
    expect(drawn[1].style.height).toBe("69%");
  });

  it("says its best, or what it is waiting for", () => {
    expect(summary(TICKET, false).textContent).toBe("Best: checkpoint 500 · 5.62 s · 5/5");
    expect(summary({ ...TICKET, best: null }, true).textContent).toBe("Evaluating checkpoints: 3 of 4 done.");
    expect(summary({ ...TICKET, checkpoints: [], state: "failed" }, false).textContent).toContain("Stopped with an error");
    expect(summary({ ...TICKET, checkpoints: [row(0, 50, 0)], best: null }, false).textContent).toBe("No checkpoint finishes yet.");
  });

  it("reads the official time from the entry's line", () => {
    expect(officialTime("entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s")).toBe("4.89 s");
  });

  it("leads to its job page, says where it runs and how far it is, and stops after a confirm", () => {
    const onStop = vi.fn();
    const card = ticketCard(TICKET, { event: "sprint-2m", voted: false, onStop });
    expect(card.getAttribute("href")).toBe("#/c/sprint-2m/j/first");
    expect(card.querySelector(".sticker").textContent).toBe("Training");
    expect(card.querySelector(".ticket__top .mono-label").textContent).toBe("HF Jobs · L4");
    expect(card.querySelector(".progress span").textContent).toBe("1250 / 3000");
    expect(card.querySelector(".ticket__pub").textContent).toBe("Not published");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    card.querySelector(".ticket__stop").click();
    expect(onStop).toHaveBeenCalledWith("first");
  });

  it("a finished ticket has no Stop and says it is published", () => {
    const card = ticketCard({ ...TICKET, state: "done", progress: null, published: { entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s" } },
      { event: "sprint-2m", voted: false, onStop: vi.fn() });
    expect(card.querySelector(".ticket__stop")).toBeNull();
    expect(card.querySelector(".progress")).toBeNull();
    expect(card.querySelector(".ticket__pub").textContent).toBe("★ Published · 4.89 s on the Arena");
  });

  it("a run from a shell says so", () => {
    const card = ticketCard({ ...TICKET, where: null, state: "done" }, { event: "sprint-2m", voted: false, onStop: vi.fn() });
    expect(card.querySelector(".ticket__top .mono-label").textContent).toBe("From a shell");
  });
});
