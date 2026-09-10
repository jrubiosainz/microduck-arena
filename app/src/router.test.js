import { describe, expect, it } from "vitest";
import { menuHref, parseRoute, raceHref } from "./router.js";

describe("parseRoute", () => {
  it("shows the race programme by default", () => {
    for (const hash of ["", "#", "#/", undefined, null]) {
      expect(parseRoute(hash)).toEqual({ view: "menu" });
    }
  });

  it("opens one race", () => {
    expect(parseRoute("#/e/sprint-2m")).toEqual({ view: "race", eventId: "sprint-2m" });
    expect(parseRoute("#/e/hill-climb-1m5/")).toEqual({
      view: "race",
      eventId: "hill-climb-1m5",
    });
  });

  it("falls back to the programme for anything it does not recognise", () => {
    // A stale or hand-typed link lands somewhere useful rather than blank.
    for (const hash of ["#/nonsense", "#/e/", "#/e/bad id", "#/e/a/b"]) {
      expect(parseRoute(hash)).toEqual({ view: "menu" });
    }
  });

  it("builds the links it parses", () => {
    expect(parseRoute(raceHref("sprint-2m"))).toEqual({
      view: "race",
      eventId: "sprint-2m",
    });
    expect(parseRoute(menuHref)).toEqual({ view: "menu" });
  });
});
