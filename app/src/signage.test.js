import { describe, expect, it } from "vitest";
import { avatar, chip, footer, signage } from "./signage.js";

describe("avatar", () => {
  it("asks the Hub for the user's picture", () => {
    const img = avatar("cdeplanne").querySelector("img");
    expect(img.getAttribute("src")).toBe("https://huggingface.co/api/avatars/cdeplanne");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to a duck when the Hub has no picture", () => {
    const el = avatar("local");
    el.querySelector("img").dispatchEvent(new Event("error"));
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("🦆");
  });

  it("escapes the handle in the URL", () => {
    expect(avatar("a b").querySelector("img").getAttribute("src")).toContain("a%20b");
  });
});

describe("chip", () => {
  it("links a signed-in player to their page, with picture and name", () => {
    const el = chip({ signed_in: true, user: "cdeplanne", oauth_enabled: true });
    expect(el.matches("a.profile-chip")).toBe(true);
    expect(el.getAttribute("href")).toBe("#/p/cdeplanne");
    expect(el.querySelector(".avatar img")).not.toBeNull();
    expect(el.textContent).toContain("cdeplanne");
  });

  it("offers sign-in when signed out", () => {
    const el = chip({ signed_in: false, user: null, oauth_enabled: true });
    expect(el.matches("a.sticker")).toBe(true);
    expect(el.textContent).toBe("Sign in with Hugging Face");
    expect(el.getAttribute("href")).toMatch(/^\/login/);
  });

  it("renders nothing when the server could not be reached", () => {
    const el = chip(null);
    expect(el.textContent).toBe("");
    expect(el.querySelector("a")).toBeNull();
  });
});

describe("signage", () => {
  it("carries the mark, links home from it, and seats the chip top-right", () => {
    const el = signage({ signed_in: true, user: "ann", oauth_enabled: false });
    expect(el.matches("header.signage")).toBe(true);
    expect(el.querySelector(".club-brand img.duckhead")).not.toBeNull();
    expect(el.querySelector("nav.site-nav .profile-chip")).not.toBeNull();
  });

  it("puts the link inside the heading, so the heading stays one", () => {
    // An <a> wrapped AROUND the <h1> is not announced as a heading.
    const el = signage({ signed_in: false, user: null, oauth_enabled: true });
    const home = el.querySelector("h1.wordmark > a");
    expect(home.getAttribute("href")).toBe("#/");
    expect(home.querySelector(".wordmark__solid").textContent).toBe("Microduck");
    expect(home.querySelector(".wordmark__arena").textContent).toBe("Arena");
  });
});

describe("footer", () => {
  it("is the strip on deep ink, with the flock and the store as stickers in a new tab", () => {
    const el = footer();
    expect(el.matches("footer.signage.signage-end")).toBe(true);
    const [flock, store] = el.querySelectorAll(".signage-stickers a.sticker");
    expect(flock.textContent).toBe("Join the flock");
    expect(flock.href).toContain("discord.com/invite/pollen-community");
    expect(store.textContent).toBe("Get your real microduck");
    expect(store.href).toBe("https://store.pollen-robotics.com/products/microduck");
    for (const link of el.querySelectorAll("a")) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener");
    }
  });
});
