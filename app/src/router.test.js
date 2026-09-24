import { describe, expect, it } from "vitest";
import { dress, liveHref, menuHref, parseRoute, playerHref, raceHref, runHref, themeFor, voteHref } from "./router.js";

describe("parseRoute", () => {
  it("opens guides and shareable sections without confusing them with the home page", () => {
    expect(parseRoute("#/guides")).toEqual({ view: "guides", guideId: "index", section: null });
    expect(parseRoute("#/e/sprint-2m/guide")).toEqual({ view: "guides", eventId: "sprint-2m", section: null });
    expect(parseRoute("#/guides/points?section=how-race-scores-work")).toEqual({
      view: "guides", guideId: "points", section: "how-race-scores-work",
    });
  });
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

  it("opens one publication", () => {
    expect(parseRoute("#/r/01ABC")).toEqual({ view: "run", runId: "01ABC" });
    expect(parseRoute(runHref("01ABC"))).toEqual({ view: "run", runId: "01ABC" });
  });

  it("opens the channel", () => {
    expect(parseRoute("#/live")).toEqual({ view: "live" });
    expect(parseRoute("#/live/")).toEqual({ view: "live" });
    expect(parseRoute(liveHref)).toEqual({ view: "live" });
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
    expect(themeFor("run")).toBe("race");
    expect(themeFor("menu")).toBe("club");
    expect(themeFor("player")).toBe("club");
    expect(themeFor("vote")).toBe("race");
  });

  it("dresses the channel in its own sheet", () => {
    expect(themeFor("live")).toBe("live");
    expect(themeFor("run")).toBe("race");
    expect(themeFor("menu")).toBe("club");
  });
});

describe("dress: wearing one placement sheet", () => {
  const sheets = () => {
    document.head.querySelectorAll("link[data-theme]").forEach((l) => l.remove());
    return ["club", "race", "live"].map((theme) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.theme = theme;
      document.head.append(link);
      return link;
    });
  };

  it("enables exactly the one the view wears", () => {
    const [club, race, live] = sheets();
    dress("menu");
    expect([club.disabled, race.disabled, live.disabled]).toEqual([false, true, true]);
    dress("race");
    expect([club.disabled, race.disabled, live.disabled]).toEqual([true, false, true]);
    dress("live");
    expect([club.disabled, race.disabled, live.disabled]).toEqual([true, true, false]);
  });

  it("puts a player on the club's sheet and a booth on the trackside one", () => {
    const [club, race] = sheets();
    dress("player");
    expect([club.disabled, race.disabled]).toEqual([false, true]);
    // A booth and a run page both have a stage, so both wear the race sheet.
    dress("vote");
    expect(race.disabled).toBe(false);
    dress("run");
    expect(race.disabled).toBe(false);
  });
});
