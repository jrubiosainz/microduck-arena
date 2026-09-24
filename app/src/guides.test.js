import { afterEach, describe, expect, it } from "vitest";
import { renderGuides } from "./guides.js";
import { renderEntryPanel } from "./race.js";
import { flyer } from "./flyer.js";

afterEach(() => document.body.replaceChildren());

function show(guideId = "index", section = null, event = null) {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  renderGuides(root, event ? { eventId: event.id, event, section } : { guideId, section });
  return root;
}

describe("public guides", () => {
  it("opens a readable guide and focuses its heading without fetching an identity", () => {
    const root = show("train-a-policy");
    expect(document.activeElement).toBe(root.querySelector("article h1"));
    expect(document.title).toBe("Train your first policy · Microduck Arena");
    expect([...root.querySelectorAll("pre code")].map(node => node.textContent).join("\n")).toContain("uv run train");
    expect(root.querySelector('a[href*="roller-sprint"]')).toBeNull();
  });

  it("keeps challenge guidance out of general help and points", () => {
    for (const id of ["index", "train-a-policy", "points"]) {
      const root = show(id);
      expect(root.querySelector('a[href^="#/e/"]')).toBeNull();
      expect(root.querySelector('a[href="#/guides/sprint-2m"]')).toBeNull();
      if (id !== "points") expect(root.querySelector('a[href="#/guides/points"]')).toBeNull();
    }
  });

  it("keeps each challenge's help within its own context", () => {
    for (const id of ["sprint-2m", "roller-sprint-2m", "hill-climb-1m5", "swag-contest",
      "highest-jump", "roller-slide", "rough-ground", "hold-your-ground"]) {
      const planned = ["highest-jump", "roller-slide", "rough-ground", "hold-your-ground"].includes(id);
      const root = show(null, null, { id, status: planned ? "planned" : "open" });
      expect(root.querySelector("article h1").textContent).not.toBe("Guide not found");
      if (!planned) expect(root.querySelector(`a[href="#/e/${id}"]`)).not.toBeNull();
      else expect(root.querySelector('a[href^="#/e/"]')).toBeNull();
      const links = [...root.querySelectorAll("article a")].map(a => a.getAttribute("href"));
      expect(links.filter(href => href.startsWith("#/"))).toEqual(["#/guides/train-a-policy"]);
    }
  });

  it("recovers from an unknown guide or stale section with a usable heading and navigation", () => {
    for (const id of ["missing", "constructor", "__proto__"]) {
      const unknown = show(id);
      expect(unknown.querySelector('a[href="#/guides"]')).not.toBeNull();
      expect(document.activeElement).toBe(unknown.querySelector("article h1"));
    }
    const stale = show("points", "missing-section");
    expect(document.activeElement).toBe(stale.querySelector("article h1"));
  });

  it("makes wide tables and commands keyboard-scrollable", () => {
    const training = show("train-a-policy");
    expect(training.querySelector("pre").tabIndex).toBe(0);
    const root = show("points");
    expect(root.querySelector("table").parentElement.tabIndex).toBe(0);
    expect(root.querySelector("table").parentElement.getAttribute("role")).toBe("region");
  });

  it("lets signed-out entrants learn before signing in", () => {
    const root = document.createElement("div");
    renderEntryPanel(root, { signed_in: false }, { event: { id: "sprint-2m" } });
    expect(root.querySelector('a[href="#/e/sprint-2m/guide"]')).not.toBeNull();
    expect(root.querySelector("#publish")).toBeNull();
  });

  it("gives planned cards a preview link without a race entry link", () => {
    const card = flyer({
      id: "highest-jump", title: "Highest Jump", status: "planned", category: "challenge",
      rig: "legs", length_m: 2, slope_deg: 0, seeds: 5, time_limit_s: 50,
      sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
    }, []);
    expect(card.querySelector('a[href="#/e/highest-jump/guide"]')).not.toBeNull();
    expect(card.querySelector('a[href="#/e/highest-jump"]')).toBeNull();
  });
});
