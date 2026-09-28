import { describe, expect, it } from "vitest";
import { entryFromLocation, forgetEntry } from "./entry.js";

function memory() {
  const kept = new Map();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
}

const query = "?repo=alice%2Fmicroduck-walker&revision=abc1234&env=https%3A%2F%2Fgithub.com%2Falice%2Fx%2Ftree%2Fabc";

describe("the entry the workshop sends back", () => {
  it("reads the repo, the revision and the code link from the query", () => {
    expect(entryFromLocation("sprint-2m", query, memory())).toEqual({
      repo: "alice/microduck-walker", revision: "abc1234", env: "https://github.com/alice/x/tree/abc",
    });
  });

  it("keeps it across the sign-in round trip, which drops the query", () => {
    const storage = memory();
    entryFromLocation("sprint-2m", query, storage);
    expect(entryFromLocation("sprint-2m", "", storage).repo).toBe("alice/microduck-walker");
  });

  it("only for the challenge it was sent to", () => {
    const storage = memory();
    entryFromLocation("sprint-2m", query, storage);
    expect(entryFromLocation("roller-sprint-2m", "", storage)).toEqual({ repo: "", revision: "", env: "" });
  });

  it("takes the query once, so it cannot follow the visitor to another challenge", () => {
    history.replaceState(null, "", `/${query}#/e/sprint-2m`);
    const storage = memory();
    expect(entryFromLocation("sprint-2m", location.search, storage).repo).toBe("alice/microduck-walker");
    expect(location.search).toBe("");
    expect(location.pathname + location.hash).toBe("/#/e/sprint-2m");
    // On to another challenge's page, then back: the kept copy stays with the one it was sent to.
    expect(entryFromLocation("roller-sprint-2m", location.search, storage).repo).toBe("");
    expect(entryFromLocation("sprint-2m", location.search, storage).repo).toBe("alice/microduck-walker");
  });

  it("forgets it once published", () => {
    const storage = memory();
    entryFromLocation("sprint-2m", query, storage);
    forgetEntry(storage);
    expect(entryFromLocation("sprint-2m", "", storage).repo).toBe("");
  });

  it("still reads the query when storage throws, as it can in a private window", () => {
    const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(entryFromLocation("sprint-2m", query, throwing).repo).toBe("alice/microduck-walker");
    expect(entryFromLocation("sprint-2m", "", throwing).repo).toBe("");
  });
});
