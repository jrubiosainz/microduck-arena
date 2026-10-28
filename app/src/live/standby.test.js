import { describe, expect, it } from "vitest";
import { createStandby } from "./standby.js";

describe("createStandby", () => {
  it("shows the cup and the time left from the slot's offset", () => {
    const stage = document.createElement("div"), standby = createStandby(stage);
    standby.play({ kind: "standby", at_ms: 0, duration_ms: 65_000, cup: { title: "Tug of War · Cup #1" } }, 0);
    const card = stage.querySelector(".live-standby");
    expect(card.hidden).toBe(false);
    expect(card.querySelector(".live-standby-title").textContent).toBe("Tug of War · Cup #1");
    expect(card.querySelector(".live-standby-time").textContent).toBe("1:05");
    standby.seek(60_500);
    expect(card.querySelector(".live-standby-time").textContent).toBe("0:05");
    standby.stop();
    expect(card.hidden).toBe(true);
  });

  it("gives no time for a cup late on its premiere: it has no start until its running order lands", () => {
    const stage = document.createElement("div"), standby = createStandby(stage);
    standby.play({ kind: "standby", at_ms: 0, duration_ms: 60_000, cup: { title: "Tug of War · Cup #1" }, late: true }, 0);
    expect(stage.querySelector(".live-standby-time").textContent).toBe("");
    standby.seek(30_000);
    expect(stage.querySelector(".live-standby-time").textContent).toBe("");
  });
});
