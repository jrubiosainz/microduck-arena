import { describe, expect, it } from "vitest";
import { menuHref, parseRoute, playerHref, raceHref, themeFor, voteHref } from "./router.js";

describe("parseRoute", () => {
  it("shows the home page by default", () => {
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

  it("opens one player", () => {
    expect(parseRoute("#/p/cdeplanne")).toEqual({ view: "player", user: "cdeplanne" });
    expect(parseRoute("#/p/a.b-c_d/")).toEqual({ view: "player", user: "a.b-c_d" });
  });

  it("opens one voting booth", () => {
    expect(parseRoute("#/v/swag-contest")).toEqual({ view: "vote", eventId: "swag-contest" });
    expect(parseRoute("#/v/swag-contest/")).toEqual({ view: "vote", eventId: "swag-contest" });
  });

  it("falls back to the home page for anything it does not recognise", () => {
    for (const hash of [
      "#/nonsense",
      "#/e/",
      "#/e/bad id",
      "#/e/a/b",
      "#/p/",
      "#/p/a/b",
      "#/v/",
      "#/v/a/b",
      "#/v/bad id",
    ]) {
      expect(parseRoute(hash)).toEqual({ view: "menu" });
    }
  });

  it("builds the links it parses", () => {
    expect(parseRoute(raceHref("sprint-2m"))).toEqual({ view: "race", eventId: "sprint-2m" });
    expect(parseRoute(playerHref("cdeplanne"))).toEqual({ view: "player", user: "cdeplanne" });
    expect(parseRoute(voteHref("swag-contest"))).toEqual({
      view: "vote",
      eventId: "swag-contest",
    });
    expect(parseRoute(menuHref)).toEqual({ view: "menu" });
  });
});

describe("themeFor", () => {
  it("dresses races in the trackside theme and everything else as the club", () => {
    expect(themeFor("race")).toBe("race");
    expect(themeFor("menu")).toBe("club");
    expect(themeFor("player")).toBe("club");
    expect(themeFor("vote")).toBe("race");
  });
});
