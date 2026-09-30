import { afterEach, describe, expect, it, vi } from "vitest";
import { oneLine, renderTrainPanel, trainPanel } from "./trainpanel.js";

const sprint = { id: "sprint-2m" };

afterEach(() => vi.restoreAllMocks());

describe("Train my own robot", () => {
  it("gives the one line for this challenge, on this Arena, and uv's install as the answer to its absence", () => {
    expect(oneLine(sprint, "http://127.0.0.1:8000")).toBe("uv run http://127.0.0.1:8000/workshop.py sprint-2m");
    const panel = trainPanel(sprint, "https://arena.example");
    expect(panel.querySelector(".train__open").textContent).toBe("Train my own robot");
    const [line, install] = [...panel.querySelectorAll(".train__line code")].map((node) => node.textContent);
    expect(line).toBe("uv run https://arena.example/workshop.py sprint-2m");
    expect(install).toBe("curl -LsSf https://astral.sh/uv/install.sh | sh");
    expect(panel.querySelector(".train__uv").textContent).toBe(
      "uv: command not found? Install uv, open a new terminal, and paste the line again:");
  });

  it("leaves what else it takes to the launcher and the workshop, when each is needed", () => {
    const text = trainPanel(sprint, "https://arena.example").textContent;
    expect(text).not.toMatch(/You need/);
    expect(text).not.toMatch(/NVIDIA GPU/);
  });

  it("is open: it is the page's call to action", () => {
    expect(trainPanel(sprint, "https://arena.example").open).toBe(true);
  });

  it("copies the line", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const panel = trainPanel(sprint, "https://arena.example");
    panel.querySelector(".train__copy").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("uv run https://arena.example/workshop.py sprint-2m");
  });

  it("sits in the entry column above the guide link", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="entry-col"><a class="help-link"></a></div>';
    renderTrainPanel(root, sprint, "https://a");
    expect(root.querySelector(".help-link").previousElementSibling.classList.contains("train")).toBe(true);
  });
});
