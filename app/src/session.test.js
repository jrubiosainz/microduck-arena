import { describe, expect, it } from "vitest";
import { signInHref } from "./session.js";

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
