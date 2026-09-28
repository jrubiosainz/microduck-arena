import { afterEach, describe, expect, it, vi } from "vitest";
import { oneLine, renderTrainPanel, trainPanel } from "./trainpanel.js";

const sprint = { id: "sprint-2m", status: "open" };

afterEach(() => vi.restoreAllMocks());

describe("Train my robot", () => {
  it("gives the one line for this challenge, on this Arena", () => {
    expect(oneLine(sprint, "http://127.0.0.1:8000")).toBe("uv run http://127.0.0.1:8000/workshop.py sprint-2m");
    const panel = trainPanel(sprint, "https://arena.example");
    const lines = [...panel.querySelectorAll(".train__line code")].map((node) => node.textContent);
    expect(lines).toContain("uv run https://arena.example/workshop.py sprint-2m");
    expect(lines).toContain("curl -LsSf https://astral.sh/uv/install.sh | sh");
  });

  it("says what is needed, GPU or Hugging Face Jobs", () => {
    const text = trainPanel(sprint, "https://arena.example").textContent;
    expect(text).toMatch(/NVIDIA GPU/);
    expect(text).toMatch(/Hugging Face Jobs/);
  });

  it("copies the line", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const panel = trainPanel(sprint, "https://arena.example");
    panel.querySelector(".train__copy").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("uv run https://arena.example/workshop.py sprint-2m");
  });

  it("hangs above the entry form, and not for a planned event", () => {
    const root = document.createElement("div");
    root.innerHTML = '<aside id="entry"></aside>';
    renderTrainPanel(root, { id: "highest-jump", status: "planned" }, "https://a");
    expect(root.querySelector(".train")).toBeNull();
    renderTrainPanel(root, sprint, "https://a");
    expect(root.querySelector("#entry").previousElementSibling.classList.contains("train")).toBe(true);
  });
});
