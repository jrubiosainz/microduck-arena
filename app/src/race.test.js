// The entry panel's three states, exercised as rendered DOM rather than read
// as code. `renderEntryPanel` replaces its container's innerHTML per state; if
// its element references were captured before that (or anywhere other than
// inside this function, after the innerHTML it belongs to), the buttons below
// would look right and do nothing. Clicking them and observing the result is
// what would have caught that.

import { describe, expect, it, vi } from "vitest";
import { renderEntryPanel, renderEventFacts } from "./race.js";

const event = {
  seeds: 5,
  sweep_count: 5,
  sweep_lo: 0.2,
  sweep_hi: 1.2,
  sweep_step: 0.05,
  length_m: 2,
  slope_deg: 0,
  rig: "legs",
};

function chooseFile(container, name = "policy.onnx") {
  const input = container.querySelector("#policy-file");
  const file = new File(["onnx-bytes"], name);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("renderEntryPanel: signed-out", () => {
  it("offers a sign-in link that navigates in place, and no racing controls", () => {
    const container = document.createElement("div");
    renderEntryPanel(container, { signed_in: false, oauth_enabled: true }, { event });

    const link = container.querySelector(".entry__signin");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/login");
    // NOT target="_blank", though Hugging Face's own docs suggest it for the
    // iframe/cookie reason — that advice assumes a PUBLIC Space. This one is
    // private, so the Hub gateway 404s any request to <space>.hf.space without
    // its auth, and a fresh top-level tab carries none: huggingface.co and
    // hf.space are separate domains sharing no cookies. Opening in a new tab
    // produced a Hugging Face 404 and nothing else. Navigating the iframe keeps
    // the auth it already has; the cookies are SameSite=None so they survive
    // that third-party context.
    expect(link.hasAttribute("target")).toBe(false);

    expect(container.querySelector("#dropzone")).toBeNull();
    expect(container.querySelector("#try")).toBeNull();
    expect(container.querySelector("#publish")).toBeNull();
  });

  it("is also what a null or empty /api/me renders", () => {
    const container = document.createElement("div");
    renderEntryPanel(container, null, { event });
    expect(container.querySelector(".entry__signin")).not.toBeNull();
  });
});

describe("renderEntryPanel: ready (signed in, can publish)", () => {
  function render() {
    const container = document.createElement("div");
    const onTry = vi.fn(async () => {});
    const onPublish = vi.fn(async () => ({ policy_name: "walker" }));
    const onLiveryChange = vi.fn();
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: true, user: "alice" },
      { event, onTry, onPublish, onLiveryChange },
    );
    return { container, onTry, onPublish, onLiveryChange };
  }

  it("names the signed-in user and renders every existing control live", () => {
    const { container } = render();
    expect(container.querySelector("#entry-user").textContent).toBe("alice");
    expect(container.querySelector("#dropzone")).not.toBeNull();
    expect(container.querySelector("#policy-name")).not.toBeNull();
    expect(container.querySelectorAll("#liveries .swatch")).toHaveLength(4);
    expect(container.querySelector("#speed")).not.toBeNull();
    expect(container.querySelector("#try").disabled).toBe(false);
    expect(container.querySelector("#publish").disabled).toBe(false);
    expect(container.querySelector("#entry-status")).not.toBeNull();
    expect(container.textContent).toMatch(/\.onnx/); // the consent paragraph
  });

  it("Test it reaches onTry once a file is chosen -- the button is wired to a live node", async () => {
    const { container, onTry } = render();
    chooseFile(container);
    container.querySelector("#try").click();
    await flush();
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onTry.mock.calls[0][0]).toMatchObject({ livery: "classic", commandVx: "" });
  });

  it("Publish reaches onPublish once a file is chosen", async () => {
    const { container, onPublish } = render();
    chooseFile(container);
    container.querySelector("#publish").click();
    await flush();
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("without a file, Test it reports it instead of silently doing nothing", () => {
    const { container, onTry } = render();
    container.querySelector("#try").click();
    expect(container.querySelector("#entry-status").textContent).toMatch(/choose/i);
    expect(onTry).not.toHaveBeenCalled();
  });

  it("picking a swatch reports the new livery, live", () => {
    const { container, onLiveryChange } = render();
    container.querySelector('[data-livery="charcoal"]').click();
    expect(onLiveryChange).toHaveBeenCalledWith("charcoal");
  });
});

describe("renderEntryPanel: no-hub (signed in on a Space, no Hub token)", () => {
  function render() {
    const container = document.createElement("div");
    const onTry = vi.fn(async () => {});
    const onPublish = vi.fn(async () => ({ policy_name: "walker" }));
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: false, user: "bob" },
      { event, onTry, onPublish },
    );
    return { container, onTry, onPublish };
  }

  it("keeps every control, names the user, but disables Publish with a reason", () => {
    const { container } = render();
    expect(container.querySelector("#entry-user").textContent).toBe("bob");
    expect(container.querySelector("#dropzone")).not.toBeNull();
    expect(container.querySelector("#publish").disabled).toBe(true);
    expect(container.querySelector(".entry__nohub")).not.toBeNull();
  });

  it("Test it still works, and Publish does not re-enable itself afterwards", async () => {
    const { container, onTry } = render();
    chooseFile(container);
    container.querySelector("#try").click();
    await flush();
    expect(onTry).toHaveBeenCalledTimes(1);
    // A completed trial re-enables Test it, but must not undo the no-hub
    // block on Publish -- a real bug caught while writing this test.
    expect(container.querySelector("#try").disabled).toBe(false);
    expect(container.querySelector("#publish").disabled).toBe(true);
  });

  it("Publish never fires, even if something dispatches a click at the disabled button", async () => {
    const { container, onPublish } = render();
    chooseFile(container);
    // jsdom (correctly) never dispatches a click's handler on a disabled
    // button, so that alone would pass this test whether or not the code's
    // own "no-hub" guard exists -- it would only be proving jsdom's behaviour.
    // Re-enabling the button before dispatching forces the click through to
    // the handler, so what is actually under test is the `run()` guard
    // itself: `if (kind === "publish" && state === "no-hub") return;`.
    const publishButton = container.querySelector("#publish");
    publishButton.disabled = false;
    publishButton.click();
    await flush();
    expect(onPublish).not.toHaveBeenCalled();
  });
});

describe("renderEventFacts: the caveat under the facts", () => {
  function render() {
    const root = document.createElement("div");
    root.innerHTML = '<dl class="facts" id="facts"></dl>';
    renderEventFacts(root, event);
    return root;
  }

  it("renders a racecaveat paragraph, honestly worded, right after the facts", () => {
    const root = render();
    const facts = root.querySelector("#facts");
    const caveat = root.querySelector(".racecaveat");

    expect(caveat).not.toBeNull();
    expect(caveat.tagName).toBe("P");
    // Sits immediately under the facts it qualifies, not buried elsewhere on
    // the page -- the brief is explicit that placement is part of the point.
    expect(facts.nextElementSibling).toBe(caveat);
    // The actual claim, not just that some caveat exists: a policy tuned on
    // a different course or physics can score worse here without being a
    // worse policy. That is the sentence a trusted board depends on.
    expect(caveat.textContent).toMatch(/measured on this course/i);
    expect(caveat.textContent).toMatch(/do worse here without being worse/i);
  });

  it("still renders every fact alongside the caveat", () => {
    const root = render();
    const facts = root.querySelector("#facts");
    expect(facts.children.length).toBe(4);
    expect(facts.textContent).toMatch(/legs/);
  });
});


describe("the speed picker applies to publishing too", () => {
  it("passes the selected speed to onPublish, not only to onTry", async () => {
    // Reversed deliberately. This used to be forbidden, on the reasoning that
    // letting entrants choose a speed ranks whoever guessed best. The sweep
    // already keeps the BEST time across every speed, so pinning one can only
    // match or lose to it — self-penalising, not exploitable.
    const onPublish = vi.fn(async () => ({ policy_name: "walker" }));
    const container = document.createElement("div");
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: true },
      { event, onTry: vi.fn(async () => {}), onPublish },
    );

    chooseFile(container);
    container.querySelector("#speed").value = "0.35";
    container.querySelector("#publish").click();
    await flush();

    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish.mock.calls[0][0].commandVx).toBe("0.35");
  });

  it("still sweeps when no speed is chosen", () => {
    // The default must stay the comparable measurement.
    const container = document.createElement("div");
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: true },
      { event, onTry: vi.fn(), onPublish: vi.fn() },
    );
    expect(container.querySelector("#speed").value).toBe("");
  });
});
