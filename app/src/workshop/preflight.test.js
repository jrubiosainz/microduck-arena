import { describe, expect, it, vi } from "vitest";
import { canTrain, renderPreflight } from "./preflight.js";

const ready = { git: true, identity: true, uv: true, gpu: false, gh: true, user: "alice" };
const status = (preflight) => ({ preflight });

describe("preflight", () => {
  it("shows each missing item with the command that fixes it", () => {
    const zone = document.createElement("section");
    renderPreflight(zone, status({ ...ready, identity: false, user: null }), { onLogin: vi.fn() });
    const missing = [...zone.querySelectorAll(".preflight__missing")].map((li) => li.textContent);
    expect(missing).toHaveLength(2);
    expect(missing.join(" ")).toContain("git config --global user.email");
    expect(missing.join(" ")).toContain("hf auth login");
    expect(zone.querySelector(".preflight__login").hidden).toBe(false);
    // .button-secondary only recolours: without .button it is a bare browser button.
    expect(zone.querySelector(".preflight__login button").className).toBe("button button-secondary");
  });

  it("names the Hugging Face account and hides the token field once logged in", () => {
    const zone = document.createElement("section");
    renderPreflight(zone, status(ready), { onLogin: vi.fn() });
    expect(zone.textContent).toContain("as alice");
    expect(zone.querySelector(".preflight__login").hidden).toBe(true);
  });

  it("says where training runs, and who pays for Hugging Face Jobs", () => {
    const zone = document.createElement("section");
    renderPreflight(zone, status(ready), { onLogin: vi.fn() });
    expect(zone.querySelector(".preflight__where").textContent).toMatch(/Hugging Face Jobs, billed to alice/);
    renderPreflight(zone, status({ ...ready, gpu: true }), { onLogin: vi.fn() });
    expect(zone.querySelector(".preflight__where").textContent).toMatch(/this machine/);
  });

  it("logs in with the pasted token", async () => {
    const zone = document.createElement("section");
    const onLogin = vi.fn(async () => {});
    renderPreflight(zone, status({ ...ready, user: null }), { onLogin });
    zone.querySelector("input[name=token]").value = " hf_x ";
    zone.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onLogin).toHaveBeenCalledWith("hf_x");
  });

  it("can train with a GPU, or without one once logged in, never without git", () => {
    expect(canTrain(ready)).toBe(true);
    expect(canTrain({ ...ready, user: null })).toBe(false);
    expect(canTrain({ ...ready, user: null, gpu: true })).toBe(true);
    expect(canTrain({ ...ready, git: false })).toBe(false);
  });
});
