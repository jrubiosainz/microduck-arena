import { describe, expect, it, vi } from "vitest";
import { accountCard, accountChip, band, masthead, strip } from "./header.js";

const handlers = () => ({ onLogIn: vi.fn(), onRetry: vi.fn() });

describe("the header", () => {
  it("reads Microduck Workshop, on the cover and on the strip", () => {
    const slot = document.createElement("span");
    expect(masthead(slot).querySelector(".wordmark").textContent).toBe("MicroduckWorkshop");
    expect(strip(slot).querySelector(".wordmark").textContent).toBe("MicroduckWorkshop");
    expect(strip(slot).querySelector(".wordmark a").getAttribute("href")).toBe("#/");
  });

  it("the band leads back to the Arena", () => {
    const links = [...band("https://arena.test").querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links[0]).toEqual(["Back to the Arena", "https://arena.test/"]);
  });

  it("the card holds a duck while the Hub is asked", () => {
    expect(accountCard({ phase: "checking" }, handlers()).className).toContain("player-card--waiting");
  });

  it("the card is the way in, logged out", () => {
    const on = handlers();
    const card = accountCard({ phase: "out" }, on);
    const button = card.querySelector("button.player-card-in");
    expect(button.textContent).toContain("Log in");
    button.click();
    expect(on.onLogIn).toHaveBeenCalled();
  });

  it("the card waits for huggingface.co, with the page's address in case no tab opened", () => {
    const card = accountCard({ phase: "waiting", url: "https://huggingface.co/oauth/device?user_code=X" }, handlers());
    expect(card.querySelector("button").disabled).toBe(true);
    expect(card.querySelector("a.account-note").href).toBe("https://huggingface.co/oauth/device?user_code=X");
  });

  it("the card asks again when the Hub was unreachable", () => {
    const on = handlers();
    accountCard({ phase: "unreachable" }, on).querySelector("button").click();
    expect(on.onRetry).toHaveBeenCalled();
  });

  it("the card names the account once logged in", () => {
    const card = accountCard({ phase: "in", user: "alice", canPay: true }, handlers());
    expect(card.textContent).toContain("alice");
    expect(card.querySelector("a").href).toBe("https://huggingface.co/alice");
  });

  it("the chip is the strip's plate, in the same phases", () => {
    const on = handlers();
    const out = accountChip({ phase: "out" }, on);
    expect(out.className).toContain("sticker-orange");
    out.click();
    expect(on.onLogIn).toHaveBeenCalled();
    expect(accountChip({ phase: "in", user: "alice" }, on).textContent).toContain("alice");
    expect(accountChip({ phase: "waiting" }, on).disabled).toBe(true);
  });
});
