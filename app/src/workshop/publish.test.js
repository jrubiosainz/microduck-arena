import { describe, expect, it, vi } from "vitest";
import { PLACEHOLDER, defaultName, publishPanel } from "./publish.js";

const JOB = { id: "first", name: "first", dirty: false, code_url: null, checkpoints: [] };
const CODE = { fork: "alice/microduck-challenges", changes: [], identity: true, commit: "abc1234", unpushed: 2 };
const IN = { phase: "in", user: "alice", canPay: true };
const handlers = () => ({ onPublish: vi.fn(async () => ({ entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", page_url: "http://arena.test/#/r/x" })),
  onPreview: vi.fn(async () => ({ repo: "alice/microduck-sprint-2m-first", readme: "# card" })), onPush: vi.fn(async () => {}), onUseFork: vi.fn() });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const panel = (on = handlers()) => publishPanel({ event: { id: "sprint-2m", title: "2 m Sprint" }, folder: "sprint_2m" }, on);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};

describe("Publish & compete", () => {
  it("names the entry after the challenge and the run, and asks the commentators' question", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    expect(p.el.querySelector("input[name=policy]").value).toBe("sprint-2m-first");
    expect(defaultName("hill_climb_1m5", "run-0930-0940")).toBe("hill-climb-1m5-run-0930-0940");
    expect(p.el.querySelector("textarea").placeholder).toBe(PLACEHOLDER);
    expect(p.el.querySelector(".booth").textContent).toContain("Peter & Ray read it on air when your duck races.");
  });

  it("waits for a checkpoint, a name and a word for the commentators", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: IN, selected: null });
    const go = p.el.querySelector(".publish__go");
    expect(go.textContent).toBe("Pick a checkpoint");
    expect(go.disabled).toBe(true);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    expect(go.textContent).toBe("Publish and compete");
    expect(go.disabled).toBe(true);
    type(p.el.querySelector("textarea"), "It leans into every step.");
    expect(go.disabled).toBe(false);
  });

  it("asks for plain sentences Peter & Ray can read on air, 280 characters at most", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    expect(p.el.querySelector("textarea").maxLength).toBe(280);
    expect(p.el.querySelector(".publish__plain").textContent).toBe("Plain sentences: no links, no file names or paths.");
  });

  it("is shut while logged out, and says why", () => {
    const p = panel();
    p.update({ job: JOB, code: CODE, account: { phase: "out" }, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    expect(p.el.querySelector(".publish__go").disabled).toBe(true);
    const why = p.el.querySelector(".publish__why");
    expect(why.hidden).toBe(false);
    expect(why.textContent).toBe("Log in to Hugging Face first (top right).");
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    expect(why.hidden).toBe(true);
  });

  it("holds a dirty run until publish anyway is ticked", () => {
    const p = panel();
    p.update({ job: { ...JOB, dirty: true }, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    expect(p.el.querySelector(".publish__dirty").hidden).toBe(false);
    expect(p.el.querySelector(".publish__go").disabled).toBe(true);
    p.el.querySelector("input[name=anyway]").checked = true;
    p.el.querySelector("input[name=anyway]").dispatchEvent(new Event("change"));
    expect(p.el.querySelector(".publish__go").disabled).toBe(false);
  });

  it("ticks the fork and offers Push until the run's commit is on it", async () => {
    const on = handlers();
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    const [fork, pushed] = p.el.querySelectorAll(".checks > li");
    expect(fork.classList.contains("check--ticked")).toBe(true);
    expect(pushed.classList.contains("check--ticked")).toBe(false);
    expect(pushed.textContent).toContain("2 commits are only on this machine.");
    pushed.querySelector("button").click();
    await Promise.resolve();
    expect(on.onPush).toHaveBeenCalled();
    p.update({ job: { ...JOB, code_url: "https://github.com/alice/microduck-challenges/tree/abc1234" }, code: { ...CODE, unpushed: 0 }, account: IN, selected: 1000 });
    expect(p.el.querySelectorAll(".checks > li")[1].classList.contains("check--ticked")).toBe(true);
    expect(p.el.querySelector(".checks button")).toBeNull();
  });

  it("publishes what is typed, then shows the official time and the entry's page", async () => {
    const on = handlers();
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "It leans into every step.");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(on.onPublish).toHaveBeenCalledWith({ checkpoint: 1000, name: "sprint-2m-first", description: "It leans into every step.", allow_dirty: false }, expect.any(Function));
    const result = p.el.querySelector(".result");
    expect(result.hidden).toBe(false);
    expect(result.querySelector("b").textContent).toBe("4.89 s");
    expect(result.querySelector("a").href).toBe("http://arena.test/#/r/x");
  });

  it("shows the whole output of a failure, and the same button tries again", async () => {
    const on = handlers();
    on.onPublish.mockRejectedValueOnce(new Error("[publish] uploaded …, but the Arena did not enter it: 403"));
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(p.el.querySelector(".publish__status").textContent).toContain("did not enter it: 403");
    expect(p.el.querySelector(".publish__go").disabled).toBe(false);
  });

  it("says which duck of a troupe it is publishing, then shows the entry", async () => {
    const on = handlers();
    let finish;
    on.onPublish.mockImplementationOnce((values, onProgress) => new Promise((resolve) => {
      onProgress({ done: 1, of: 3 });
      finish = resolve;
    }));
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "It sits and sings.");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(p.el.querySelector(".publish__status").textContent).toBe("Publishing duck 2/3…");
    finish({ entered: "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s", page_url: "http://arena.test/#/r/x" });
    await flush();
    expect(p.el.querySelector(".result").hidden).toBe(false);
  });

  it("keeps what is typed, and a fork address being typed, across redraws", () => {
    const p = panel();
    p.update({ job: JOB, code: { ...CODE, fork: null }, account: IN, selected: 1000 });
    type(p.el.querySelector("input[name=policy]"), "my-walker");
    type(p.el.querySelector("textarea"), "It leans.");
    p.el.querySelector(".checks input[name=fork]").value = "https://github.com/alice/mi";
    p.update({ job: JOB, code: { ...CODE, fork: null }, account: IN, selected: 1000 });
    expect(p.el.querySelector("input[name=policy]").value).toBe("my-walker");
    expect(p.el.querySelector("textarea").value).toBe("It leans.");
    expect(p.el.querySelector(".checks input[name=fork]").value).toBe("https://github.com/alice/mi");
  });

  it("a voted event's entry gives no official time", async () => {
    const on = handlers();
    on.onPublish.mockResolvedValue({ entered: "entered on got-a-talent: a 20.00 s performance", page_url: "http://arena.test/#/r/x" });
    const p = publishPanel({ event: { id: "got-a-talent", title: "MicroDuck Got a Talent", metric: "votes" }, folder: "got_a_talent" }, on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "It sits and looks around.");
    p.el.querySelector(".publish__go").click();
    await flush();
    expect(p.el.querySelector(".result b")).toBeNull();
    expect(p.el.querySelector(".result").textContent).toContain("a 20.00 s performance");
  });

  it("previews the Hub card as text, never as markup", async () => {
    const on = handlers();
    on.onPreview.mockResolvedValueOnce({ repo: "alice/microduck-sprint-2m-first", readme: "<img src=x onerror=alert(1)>" });
    const p = panel(on);
    p.update({ job: JOB, code: CODE, account: IN, selected: 1000 });
    type(p.el.querySelector("textarea"), "x");
    p.el.querySelector(".publish__preview").click();
    await flush();
    expect(on.onPreview).toHaveBeenCalledWith({ checkpoint: 1000, name: "sprint-2m-first", description: "x", allow_dirty: false });
    const card = p.el.querySelector(".publish__card");
    expect(card.hidden).toBe(false);
    expect(card.textContent).toBe("alice/microduck-sprint-2m-first\n\n<img src=x onerror=alert(1)>");
    expect(card.querySelector("img")).toBeNull();
  });
});
