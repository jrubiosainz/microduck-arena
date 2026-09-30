import { describe, expect, it } from "vitest";
import { challengeHref, jobHref, parseRoute } from "./routes.js";

describe("the workshop's routes", () => {
  it("reads the home, a challenge and a job", () => {
    expect(parseRoute("")).toEqual({ view: "home" });
    expect(parseRoute("#/")).toEqual({ view: "home" });
    expect(parseRoute("#/c/sprint-2m")).toEqual({ view: "challenge", event: "sprint-2m" });
    expect(parseRoute("#/c/sprint-2m/j/2026-09-28_10-00-00_first")).toEqual(
      { view: "job", event: "sprint-2m", job: "2026-09-28_10-00-00_first" });
  });

  it("writes what it reads", () => {
    expect(parseRoute(challengeHref("hill-climb-1m5"))).toEqual({ view: "challenge", event: "hill-climb-1m5" });
    expect(parseRoute(jobHref("sprint-2m", "first"))).toEqual({ view: "job", event: "sprint-2m", job: "first" });
  });
});
