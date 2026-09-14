import { describe, expect, it } from "vitest";
import { panelState } from "./session.js";

describe("panelState", () => {
  it("asks for a sign-in when OAuth is on and nobody is signed in", () => {
    expect(panelState({ signed_in: false, oauth_enabled: true })).toBe("signed-out");
  });

  it("is ready when signed in with a Hub token", () => {
    expect(
      panelState({ signed_in: true, oauth_enabled: true, can_publish_to_hub: true }),
    ).toBe("ready");
  });

  it("is ready locally, where there is no OAuth and no token", () => {
    // The local run: ARENA_DEV_USER is signed in and publishes to the local
    // store. A sign-in button here would be a dead end.
    expect(
      panelState({
        signed_in: true,
        oauth_enabled: false,
        can_publish_to_hub: false,
        user: "coralie",
      }),
    ).toBe("ready");
  });

  it("distinguishes signed-in-without-a-token on a Space", () => {
    // Publishing needs the token. Racing does not, so this is its own state
    // rather than being lumped in with signed-out.
    expect(
      panelState({ signed_in: true, oauth_enabled: true, can_publish_to_hub: false }),
    ).toBe("no-hub");
  });

  it("treats a missing or failed /api/me as signed out rather than crashing", () => {
    expect(panelState(null)).toBe("signed-out");
    expect(panelState(undefined)).toBe("signed-out");
    expect(panelState({})).toBe("signed-out");
  });
});
