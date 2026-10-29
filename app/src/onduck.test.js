import { describe, expect, it, vi } from "vitest";
import { onDuckPanel, onWheels } from "./onduck.js";

const COMMAND = `sudo robotctl policy load walk alice/microduck-walker@${"c".repeat(40)}:policy.onnx`;
const SPRINT = { id: "sprint-2m", rig: "legs", course: "lane" };
const panel = (over = {}) => onDuckPanel({ command: COMMAND, wheels: false, event: SPRINT, ...over });
const notes = (node) => [...node.querySelectorAll(".onduck__note")].map((p) => p.textContent);

describe("the way to a real duck", () => {
  it("shows the robot's own line, verbatim, as a popover", () => {
    const node = panel();
    expect(node.hasAttribute("popover")).toBe(true);
    expect(node.querySelector(".onduck__line").textContent).toBe(COMMAND);
  });

  it("copies the line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const copy = panel().querySelector(".onduck__copy");
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith(COMMAND);
    vi.unstubAllGlobals();
  });

  it("says how to undo it, and nothing else on a legs race", () => {
    expect(notes(panel())).toEqual(["sudo robotctl policy reset walk gives it back its usual walk."]);
  });

  it("asks for wheels when it raced on them", () => {
    expect(notes(panel({ wheels: true }))[0]).toContain("roller mode");
  });

  it("warns a stage entry that its choreography does not come along", () => {
    expect(notes(panel({ event: { rig: "legs", course: "stage" } }))[0]).toContain("timelines");
  });

  it("heads the panel with the .onnx when it opens from the board", () => {
    const grab = panel({ download: "https://huggingface.co/alice/microduck-walker/resolve/c/policy.onnx" })
      .firstElementChild;
    expect(grab.textContent).toBe("Download .onnx");
    expect(grab.hasAttribute("download")).toBe(true);
    expect(panel().querySelector(".onduck__grab")).toBeNull();
  });
});

describe("whether it raced on wheels", () => {
  it("reads the entry's own duck, then the event's rig", () => {
    expect(onWheels([{ policy: "self", rig: null }], { rig: "rollers" })).toBe(true);
    expect(onWheels([{ policy: "self", rig: "rollers" }], { rig: "legs" })).toBe(true);
    expect(onWheels([{ policy: "self", rig: null }], SPRINT)).toBe(false);
    expect(onWheels(undefined, SPRINT)).toBe(false);
  });
});
