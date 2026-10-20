import { afterEach, describe, expect, it, vi } from "vitest";
import { bars, officialTime, summary, ticketCard } from "./tickets.js";

const row = (n, score, finished = 5, status = "evaluated") => ({ n, status, score, seeds_finished: finished, seeds_total: 5, command_vx: 0.55 });
const TICKET = {
  id: "first", name: "first", where: "hf-jobs", state: "running", progress: { done: 1250, total: 3000 },
  started: "2026-09-30T09:15:00+00:00", run_id: "2026-09-30_09-15-00_first", dirty: false,
  checkpoints: [row(0, 50, 0), row(250, 8.1), row(500, 5.62), { n: 750, status: "queued" }], best: 500, published: null,
};

afterEach(() => vi.restoreAllMocks());
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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

  it("a tug's bars and best go to the strongest, in newtons", () => {
    const rows = [row(0, 2), row(1, 5.5), row(2, 4)];
    const drawn = [...bars(rows, 1, { metric: "mean_hold_force" }).children];
    expect(drawn.map((b) => b.style.height)).toEqual(["36%", "100%", "73%"]);
    expect(drawn[1].className).toBe("best");
    expect(summary({ ...TICKET, checkpoints: rows, best: 1 }, false, "mean_hold_force").textContent).toBe("Best: checkpoint 1 · 5.50 N · 5/5");
  });

  it("reads the official time from the entry's line", () => {
    expect(officialTime("entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s")).toBe("4.89 s");
    expect(officialTime("entered on tug-of-war: a 4.21 N rating")).toBe("4.21 N");
  });

  it("leads to its job page, says where it runs and how far it is, and stops after a confirm", () => {
    const onStop = vi.fn();
    const card = ticketCard(TICKET, { event: "sprint-2m", voted: false, onStop }).el;
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
      { event: "sprint-2m", voted: false, onStop: vi.fn() }).el;
    expect(card.querySelector(".ticket__stop")).toBeNull();
    expect(card.querySelector(".progress")).toBeNull();
    expect(card.querySelector(".ticket__pub").textContent).toBe("★ Published · 4.89 s on the Arena");
  });

  it("a voted ticket's published line has no entered sentence: a performance has no time", () => {
    const card = ticketCard({ ...TICKET, state: "done", progress: null,
      published: { entered: "entered on got-a-talent: a 20.00 s performance" } },
      { event: "got-a-talent", voted: true, onStop: vi.fn() }).el;
    expect(card.querySelector(".ticket__pub").textContent).toBe("★ Published");
  });

  it("a run from a shell says so", () => {
    const card = ticketCard({ ...TICKET, where: null, state: "done" }, { event: "sprint-2m", voted: false, onStop: vi.fn() }).el;
    expect(card.querySelector(".ticket__top .mono-label").textContent).toBe("From a shell");
  });

  it("stops once, after a confirm, without following the card's link", async () => {
    let finish;
    const onStop = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const card = ticketCard(TICKET, { event: "sprint-2m", voted: false, onStop }).el;
    document.body.append(card);
    const before = location.hash;
    const stop = card.querySelector(".ticket__stop");
    expect(stop.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
    expect(location.hash).toBe(before);
    expect(confirm).toHaveBeenCalledWith("Stop first? A stopped Hugging Face job cannot be resumed.");
    expect(stop.getAttribute("aria-disabled")).toBe("true");
    stop.click();
    stop.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    expect(stop.hasAttribute("aria-disabled")).toBe(false);
    card.remove();
  });

  it("stops from the keyboard, and a local training says it cannot be resumed", async () => {
    const onStop = vi.fn(async () => {});
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const stop = ticketCard({ ...TICKET, where: "local" }, { event: "sprint-2m", voted: false, onStop }).el.querySelector(".ticket__stop");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    stop.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Stop first? It cannot be resumed.");
    await flush();
    stop.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("keeps its card and its Stop, focus included, while its progress moves; its Stop goes when it ends", () => {
    const ticket = ticketCard(TICKET, { event: "sprint-2m", voted: false, onStop: vi.fn() });
    document.body.append(ticket.el);
    const stop = ticket.el.querySelector(".ticket__stop");
    stop.focus();
    ticket.update({ ...TICKET, progress: { done: 1500, total: 3000 } });
    expect(ticket.el.querySelector(".progress span").textContent).toBe("1500 / 3000");
    expect(ticket.el.querySelector(".ticket__stop")).toBe(stop);
    expect(document.activeElement).toBe(stop);
    ticket.update({ ...TICKET, state: "done", progress: null });
    expect(ticket.el.querySelector(".ticket__stop")).toBeNull();
    expect(ticket.el.classList.contains("ticket--running")).toBe(false);
    expect(ticket.el.querySelector(".sticker").textContent).toBe("Done");
    ticket.el.remove();
  });
});
