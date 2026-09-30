import { describe, expect, it, vi } from "vitest";
import { billingGuide, box, checkLine, forkGuide } from "./checks.js";

describe("the checks", () => {
  it("draws a box, ticked or not", () => {
    expect(box(true).querySelector(".tick")).not.toBeNull();
    expect(box(false).querySelector(".tick")).toBeNull();
  });

  it("a ticked line only says, with its note", () => {
    const line = checkLine({ ticked: true, label: "Working in your fork", note: "alice/microduck-challenges", guide: document.createElement("p") });
    expect(line.querySelector("details")).toBeNull();
    expect(line.textContent).toContain("alice/microduck-challenges");
    expect(line.classList.contains("check--ticked")).toBe(true);
  });

  it("a line not ticked opens its guide with How?, one per list", () => {
    const guide = document.createElement("p");
    guide.textContent = "Fork it";
    const line = checkLine({ ticked: false, label: "Working in your fork", guide, group: "ready" });
    const details = line.querySelector("details");
    expect(details.getAttribute("name")).toBe("ready");
    expect(details.querySelector("summary .how").textContent).toBe("How?");
    expect(details.querySelector(".guide").textContent).toBe("Fork it");
  });

  it("a line can end with its own button", () => {
    const push = document.createElement("button");
    const line = checkLine({ ticked: false, label: "Pushed to your fork", action: push });
    expect(line.lastElementChild).toBe(push);
  });

  it("the fork's guide hands the address over and says what went wrong", async () => {
    const onUseFork = vi.fn().mockRejectedValue(new Error("https://gitlab.com/x is not a GitHub repository address"));
    const guide = forkGuide({ onUseFork });
    expect(guide.querySelector("a").href).toBe("https://github.com/pollen-robotics/microduck-challenges/fork");
    guide.querySelector("input").value = " https://gitlab.com/x ";
    guide.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUseFork).toHaveBeenCalledWith("https://gitlab.com/x");
    expect(guide.querySelector(".guide__error").hidden).toBe(false);
    expect(guide.querySelector(".guide__error").textContent).toContain("not a GitHub repository");
  });

  it("billing's guide links the billing page and checks again", () => {
    const onCheck = vi.fn();
    const guide = billingGuide({ onCheck });
    expect(guide.querySelector("a").href).toBe("https://huggingface.co/settings/billing");
    guide.querySelector("button").click();
    expect(onCheck).toHaveBeenCalled();
  });
});
