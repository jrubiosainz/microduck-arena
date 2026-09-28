import { describe, expect, it, vi } from "vitest";
import { codeMessage, defaultName, publishValues, renderCode, renderPublish } from "./publish.js";

const code = (state, extra = {}) => ({
  state, fork: state === "not-shared" ? null : "alice/microduck-challenges", changes: 0, unpushed: 0,
  commit: "abc123456", gh: true, fork_page: "https://github.com/pollen-robotics/microduck-challenges/fork", ...extra,
});
const status = { challenge: { folder: "sprint_2m" }, event: { title: "2 m Sprint" }, preflight: { user: "alice" } };
const run = { id: "2026-09-28_10-00-00_first", name: "first", dirty: false, checkpoints: [1000], trials: {} };

describe("your code", () => {
  it("says where it stands", () => {
    expect(codeMessage(code("not-shared"))).toMatch(/not shared yet/);
    expect(codeMessage(code("changes", { changes: 2, unpushed: 1 }))).toMatch(/3 changes not online yet/);
    expect(codeMessage(code("shared"))).toMatch(/github\.com\/alice\/microduck-challenges @ abc123456/);
  });

  it("forks with gh in one click", () => {
    const zone = document.createElement("div");
    const onFork = vi.fn();
    renderCode(zone, code("not-shared"), { onFork, onPush: vi.fn() });
    zone.querySelector(".code__fork").click();
    expect(onFork).toHaveBeenCalledWith(null);
    expect(zone.querySelector(".code__fork").classList.contains("button")).toBe(true);
  });

  it("without gh, links GitHub's fork page and takes the fork's address", () => {
    const zone = document.createElement("div");
    const onFork = vi.fn();
    renderCode(zone, code("not-shared", { gh: false }), { onFork, onPush: vi.fn() });
    expect(zone.querySelector("a.code__forkpage").href).toBe("https://github.com/pollen-robotics/microduck-challenges/fork");
    zone.querySelector("input[name=fork]").value = "https://github.com/alice/microduck-challenges";
    zone.querySelector(".code__use").click();
    expect(onFork).toHaveBeenCalledWith("https://github.com/alice/microduck-challenges");
  });

  it("commits and pushes changes, and offers nothing once shared", () => {
    const zone = document.createElement("div");
    const onPush = vi.fn();
    renderCode(zone, code("changes", { changes: 1 }), { onFork: vi.fn(), onPush });
    zone.querySelector(".code__push").click();
    expect(onPush).toHaveBeenCalled();
    renderCode(zone, code("shared"), { onFork: vi.fn(), onPush });
    expect(zone.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows why a fork or a push failed, in git's words", async () => {
    const zone = document.createElement("div");
    const onPush = vi.fn(async () => { throw new Error("! [rejected] main -> main (non-fast-forward)"); });
    renderCode(zone, code("changes", { changes: 1 }), { onFork: vi.fn(), onPush });
    zone.querySelector(".code__push").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(zone.querySelector(".code__output").textContent).toContain("non-fast-forward");
  });
});

describe("publishing", () => {
  it("asks for a checkpoint first", () => {
    const zone = document.createElement("div");
    renderPublish(zone, null, status, { onPreview: vi.fn(), onPublish: vi.fn() });
    expect(zone.textContent).toMatch(/Choose a checkpoint/);
  });

  it("names the policy after the challenge and the run, and sends what was chosen", () => {
    expect(defaultName(status, run)).toBe("sprint-2m-first");
    const zone = document.createElement("div");
    const onPublish = vi.fn();
    renderPublish(zone, { run, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish });
    zone.querySelector(".publish__go").click();
    expect(onPublish.mock.calls[0][0]).toEqual({
      run: run.id, checkpoint: 1000, name: "sprint-2m-first", description: "", allow_dirty: false,
    });
  });

  it("holds back a dirty run until 'publish anyway' is ticked", () => {
    const zone = document.createElement("div");
    renderPublish(zone, { run: { ...run, dirty: true }, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish: vi.fn() });
    const go = zone.querySelector(".publish__go");
    expect(zone.textContent).toMatch(/uncommitted/);
    expect(go.disabled).toBe(true);
    const anyway = zone.querySelector("input[name=anyway]");
    anyway.checked = true;
    anyway.dispatchEvent(new Event("change"));
    expect(go.disabled).toBe(false);
    expect(publishValues(zone.querySelector("form"), { run, checkpoint: 1000 }).allow_dirty).toBe(true);
  });

  it("keeps what was typed across a re-render for the same run", () => {
    const zone = document.createElement("div");
    renderPublish(zone, { run, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish: vi.fn() });
    const form = zone.querySelector("form");
    form.elements.namedItem("policy").value = "my-policy";
    form.elements.namedItem("description").value = "trained overnight";
    const draft = { runId: run.id, name: "my-policy", description: "trained overnight", anyway: false };
    renderPublish(zone, { run, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish: vi.fn(), draft });
    expect(zone.querySelector("input[name=policy]").value).toBe("my-policy");
    expect(zone.querySelector("input[name=description]").value).toBe("trained overnight");
  });

  it("starts fresh for a different run, even with a draft on hand", () => {
    const zone = document.createElement("div");
    const other = { ...run, id: "2026-09-28_11-00-00_second", name: "second" };
    const draft = { runId: run.id, name: "my-policy", description: "trained overnight", anyway: false };
    renderPublish(zone, { run: other, checkpoint: 1000 }, status, { onPreview: vi.fn(), onPublish: vi.fn(), draft });
    expect(zone.querySelector("input[name=policy]").value).toBe(defaultName(status, other));
    expect(zone.querySelector("input[name=description]").value).toBe("");
  });
});
