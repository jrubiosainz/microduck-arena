import { describe, expect, it } from "vitest";
import { panelState, signInHref } from "./session.js";

describe("panelState", () => {
  it("asks for a sign-in when OAuth is on and nobody is signed in", () => {
    expect(panelState({ signed_in: false, oauth_enabled: true })).toBe("signed-out");
  });

  it("is ready when signed in", () => {
    expect(panelState({ signed_in: true, oauth_enabled: true })).toBe("ready");
  });

  it("is ready locally, where there is no OAuth at all", () => {
    // The local run: ARENA_DEV_USER is signed in and publishes to the local
    // store. A sign-in button here would be a dead end.
    expect(
      panelState({ signed_in: true, oauth_enabled: false, user: "coralie" }),
    ).toBe("ready");
  });

  it("treats a missing or failed /api/me as signed out rather than crashing", () => {
    expect(panelState(null)).toBe("signed-out");
    expect(panelState(undefined)).toBe("signed-out");
    expect(panelState({})).toBe("signed-out");
  });
});

describe("signInHref", () => {
  it("carries the race route so signing in comes back to it", () => {
    expect(signInHref("#/e/sprint-2m")).toBe("/login?next=%2Fe%2Fsprint-2m");
  });

  it("sends nothing extra from the menu", () => {
    expect(signInHref("")).toBe("/login");
    expect(signInHref("#/")).toBe("/login?next=%2F");
  });

  it("encodes the route rather than splicing it raw into the query", () => {
    // A raw "&" or "#" in the value would silently truncate the parameter.
    expect(signInHref("#/e/a&b=c")).toBe("/login?next=%2Fe%2Fa%26b%3Dc");
  });

  it("does not throw where there is no location", () => {
    expect(signInHref(undefined)).toBe("/login");
  });
});
