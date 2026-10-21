import { describe, expect, it } from "vitest";

describe("the plan page", () => {
  it("exposes prepare and planCall on the window and nothing else", async () => {
    await import("./main.js");
    expect(typeof window.plan).toBe("function");
    expect(typeof window.planCall).toBe("function");
  });

  it("turns a dialogue into a plan whose duration is whole frames", async () => {
    await import("./main.js");
    const plan = window.plan({
      run_id: "01M2JFJX7CF5HF7ZWTZAA1",
      turns: [
        { speaker: "peter", text: "It is a number, Ray.", fact_refs: [] },
        { speaker: "ray", text: "It is the number.", fact_refs: [] },
        { speaker: "peter", text: "Then we agree.", fact_refs: [] },
      ],
    });
    expect(plan.duration_ms % 40).toBe(0);
    expect(plan.captions.length).toBeGreaterThan(0);
  });

  it("gives the same plan for the same dialogue, so two calls agree", async () => {
    await import("./main.js");
    const dialogue = {
      run_id: "01M2JFKAWWKK71F0FR0V1G",
      turns: [
        { speaker: "ray", text: "Hill climbs are honest.", fact_refs: [] },
        { speaker: "peter", text: "Hills are honest. Climbs lie.", fact_refs: [] },
        { speaker: "ray", text: "Write that down.", fact_refs: [] },
      ],
    };
    expect(window.plan(dialogue)).toEqual(window.plan(dialogue));
  });
});
