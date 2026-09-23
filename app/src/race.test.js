// The entry panel's three states, exercised as rendered DOM rather than read
// as code. `renderEntryPanel` replaces its container's innerHTML per state; if
// its element references were captured before that (or anywhere other than
// inside this function, after the innerHTML it belongs to), the buttons below
// would look right and do nothing. Clicking them and observing the result is
// what would have caught that.

import { describe, expect, it, vi } from "vitest";
import {
  arrangeLanes, exclusivePick, otherRounds, raceHall, renderEntryPanel, renderEventFacts, renderVoteButton,
} from "./race.js";

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

describe("the training-environment field", () => {
  const ready = () => {
    const container = document.createElement("div");
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: true },
      { event, onTry: vi.fn(), onPublish: vi.fn() },
    );
    return container;
  };

  it("is in the panel at all", () => {
    // It was not, for a whole commit: a string replace missed its target, the
    // reader used optional chaining, and every publish silently carried no link.
    expect(ready().querySelector("#policy-env")).not.toBeNull();
  });

  it("says which hosts are accepted, rather than waiting for a refusal", () => {
    const input = ready().querySelector("#policy-env");
    expect(input.placeholder).toContain("github.com");
    expect(input.placeholder).toContain("huggingface.co");
  });

  it("reaches onPublish with what was typed", async () => {
    const onPublish = vi.fn(async () => ({ policy_name: "w" }));
    const container = document.createElement("div");
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: true },
      { event, onTry: vi.fn(), onPublish },
    );
    chooseFile(container);
    container.querySelector("#policy-env").value = "https://github.com/me/env";
    container.querySelector("#publish").click();
    await flush();
    expect(onPublish.mock.calls[0][0].envUrl).toBe("https://github.com/me/env");
  });

  it("is not sent on a trial, which records nothing", async () => {
    const onTry = vi.fn(async () => {});
    const container = document.createElement("div");
    renderEntryPanel(
      container,
      { signed_in: true, oauth_enabled: true, can_publish_to_hub: true },
      { event, onTry, onPublish: vi.fn() },
    );
    chooseFile(container);
    container.querySelector("#policy-env").value = "https://github.com/me/env";
    container.querySelector("#try").click();
    await flush();
    expect(onTry.mock.calls[0][0].envUrl).toBeUndefined();
  });
});

describe("renderVoteButton: the way into the booth, above the entry form", () => {
  // A bare stand-in for the bit of renderRace's template this cares about --
  // no stage, no viewer, no leaderboard fetch, just the node the placement
  // is anchored on.
  function root() {
    const div = document.createElement("div");
    div.innerHTML =
      '<div class="racegrid"><div class="entry-col"><aside class="entry" id="entry"></aside></div></div>';
    return div;
  }

  it("sits directly above the entry form when the event takes votes", () => {
    const div = root();
    renderVoteButton(div, { id: "swag-contest", vote: { ballot_min: 2 } });
    const button = div.querySelector(".vote-button--panel");
    expect(button).not.toBeNull();
    expect(button.getAttribute("href")).toBe("#/v/swag-contest");
    // Detached from the title on purpose (the owner asked for it "plus
    // visible"): it is the sibling right before the form, not beside a
    // heading somewhere else on the page.
    expect(button.nextElementSibling).toBe(div.querySelector("#entry"));
  });

  it("adds nothing on a timed event", () => {
    const div = root();
    renderVoteButton(div, { id: "sprint-2m" });
    expect(div.querySelector(".vote-button")).toBeNull();
  });
});

describe("raceHall: the page's frame", () => {
  const hall = () => raceHall({ ...event, title: "2 m Sprint" });

  it("puts the title INSIDE the stage's column, so the entry panel starts level with it", () => {
    // The whole point of the arrangement. With the title above the grid the
    // entry panel began below the facts, a heading and a half down the page.
    const column = hall().querySelector(".racegrid > div:first-child");
    const parts = [...column.children].map((n) => n.className);
    expect(parts[0]).toBe("racetitle");
    expect(parts.indexOf("facts")).toBeLessThan(parts.findIndex((c) => c.startsWith("stage")));
  });

  it("offers a way back, to the front page rather than to history", () => {
    // A race page is pasted between people; on a fresh tab history.back()
    // has nowhere to go, and a link always does.
    const back = hall().querySelector("a.raceback");
    expect(back.getAttribute("href")).toBe("#/");
    expect(back.textContent).toBe("Back to the rounds");
  });

  it("frames the stage with the charter's shadow primitive", () => {
    expect(hall().querySelector(".stage").className).toContain("fx-shadow-card");
  });

  it("names the kind of event over its title, as the flyer did", () => {
    const hall = raceHall({ ...event, title: "2 m Sprint", category: "challenge" });
    expect(hall.querySelector(".raceeyebrow").textContent).toBe("CHALLENGE");
    // An event whose category the server did not send draws no empty line.
    expect(raceHall({ ...event, title: "x" }).querySelector(".raceeyebrow")).toBeNull();
  });

  it("offers a toggle for the names over the ducks, off to begin with", () => {
    const button = hall().querySelector("#names");
    expect(button.textContent).toBe("Show names");
    // aria-pressed rather than the label alone, so the state is readable
    // without reading the text — as the walls button already does.
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("hangs the key in the corner of the picture, not under it", () => {
    // A key belongs on the thing it explains; reading it should not mean
    // looking away from the race.
    const key = hall().querySelector(".stage .key");
    expect(key).not.toBeNull();
    expect([...key.children].map((li) => li.textContent)).toEqual([
      "Colours match the leaderboard",
    ]);
  });

  it("puts the stage picks left of the board, apart from the row filters", () => {
    // The two groups share the words all / mine / top and mean different
    // things: these decide what plays, those decide what the table lists.
    const top = hall().querySelector(".boardtop");
    expect([...top.children].map((n) => n.className)).toEqual(["picks", "modes"]);
    const picks = [...top.querySelectorAll(".picks input")];
    // Checkboxes, because they act on checkboxes — and unticked to begin
    // with, since the board picks its own opening lanes.
    expect(picks.map((b) => b.type)).toEqual(["checkbox", "checkbox", "checkbox"]);
    expect(picks.map((b) => b.dataset.pick)).toEqual(["all", "mine", "top"]);
    expect(picks.some((b) => b.checked)).toBe(false);
    expect(top.querySelector(".picks legend").textContent).toBe("Put on the stage");
  });

  it("carries no brightness slider", () => {
    // Pinned at the module's minimum instead. If the stage ever looks wrong,
    // brightness.js explains in its own comment why a control was there.
    expect(hall().querySelector("#brightness")).toBeNull();
    expect(hall().querySelector(".bright")).toBeNull();
  });
});

describe("exclusivePick: at most one stage pick", () => {
  const boxes = () => {
    const hall = raceHall({ ...event, title: "x" });
    return [...hall.querySelectorAll(".picks input")];
  };

  it("unticks the others when one is ticked", () => {
    const [all, mine, top] = boxes();
    all.checked = true;
    expect(exclusivePick([all, mine, top], all)).toBe("all");

    // The case asked for: All is on, Mine is clicked, All must go.
    mine.checked = true;
    expect(exclusivePick([all, mine, top], mine)).toBe("mine");
    expect([all.checked, mine.checked, top.checked]).toEqual([false, true, false]);
  });

  it("answers null when the live one is unticked, and leaves the rest alone", () => {
    // A radio group cannot do this, which is why these are checkboxes: the
    // stage has to be able to end up empty.
    const [all, mine, top] = boxes();
    mine.checked = false;
    expect(exclusivePick([all, mine, top], mine)).toBeNull();
    expect([all.checked, mine.checked, top.checked]).toEqual([false, false, false]);
  });
});

describe("otherRounds: the way on, under the board", () => {
  // `event` at the top of this file carries what formatEventFacts reads; the
  // programme is what GET /api/events hands the page, so it carries it too.
  const round = (id, title, status, category, rig = "legs", extra = {}) => ({
    ...event, id, title, status, category, rig, ...extra,
  });
  const programme = [
    round("sprint-2m", "2 m Sprint", "open", "race"),
    round("roller-sprint-2m", "2 m Roller Sprint", "open", "race", "rollers"),
    round("hill-climb-1m5", "1.5 m Hill Climb", "open", "race"),
    round("swag-contest", "Swag Contest", "open", "showcase", "legs", { vote: {} }),
    round("highest-jump", "Highest Jump", "planned", "challenge"),
    round("rough-ground", "Rough Ground", "planned", "challenge"),
  ];
  const here = programme[0];

  it("leaves out the round you are already on", () => {
    // A card back to this page is a dead end dressed as a way forward.
    const strip = otherRounds(programme, here, new Map());
    const links = [...strip.querySelectorAll("a.challenge-link")].map((a) => a.getAttribute("href"));
    expect(links).not.toContain("#/e/sprint-2m");
    expect(links[0]).toBe("#/e/roller-sprint-2m");
  });

  it("carries EVERY other round, wrapping rather than offering a way to the rest", () => {
    // With the whole programme already here, a "see all" would only send you
    // to a page showing the same thing.
    const strip = otherRounds(programme, here, new Map());
    expect(strip.querySelectorAll(".challenge-note")).toHaveLength(programme.length - 1);
    expect(strip.querySelector(".rounds-on__all")).toBeNull();
  });

  it("gives each card the holder its board names, and none to a board it has none for", () => {
    const boards = new Map([
      ["roller-sprint-2m", [{ user: "ann", score: 3.216, seeds_finished: 5 }]],
    ]);
    const strip = otherRounds(programme, here, boards);
    const cards = [...strip.querySelectorAll(".challenge-note")];
    expect(cards[0].querySelector(".flyer-leader-name").textContent).toBe("ann");
    expect(cards[1].querySelector(".flyer-leader-name").textContent).toBe("be the first");
    // A planned event says so rather than inviting an entry it cannot take.
    expect(cards[3].querySelector(".flyer-leader-name").textContent).toBe("course not built yet");
  });
});


describe("arrangeLanes", () => {
  it("shares leaderboard colours with opaque racers before shuffling their lanes", () => {
    const board = document.createElement("div");
    board.innerHTML = '<table><tbody>' + ["a", "b", "c"].map(id =>
      `<tr><td class="tab"><input data-run-id="${id}"></td></tr>`).join("") + '</tbody></table>';
    const lanes = [{runId:"a", tier:"leader"}, {runId:"b", tier:"ghost"}, {runId:"c", tier:"ghost"}];
    const shuffled = arrangeLanes(board, lanes, () => 0);
    expect(shuffled.map(lane => lane.runId)).toEqual(["b", "c", "a"]);
    for (const lane of shuffled) {
      expect(lane.opacity).toBe(1);
      expect(lane.colour).toBe(board.querySelector(`[data-run-id="${lane.runId}"]`).closest(".tab").style.getPropertyValue("--lane"));
    }
    expect(new Set(shuffled.map(lane => lane.colour)).size).toBe(3);
    const selected = arrangeLanes(board, [lanes.find(lane => lane.runId === "c")], () => 0);
    expect(board.querySelector('[data-run-id="a"]').closest('.tab').style.getPropertyValue('--lane')).toBe('');
    expect(selected[0].colour).toBe(board.querySelector('[data-run-id="c"]').closest('.tab').style.getPropertyValue('--lane'));
  });

  it("matches an unpublished trial to its row even when it ranks between published runs", () => {
    const board = document.createElement("div");
    board.innerHTML = '<table><tbody><tr><td class="tab"><input data-run-id="a"></td></tr><tr class="provisional"><td class="tab"></td></tr></tbody></table>';
    const lanes = arrangeLanes(board, [{runId:null}, {runId:"a"}], () => 0.99);
    expect(lanes[0].colour).toBe(board.querySelector('.provisional .tab').style.getPropertyValue('--lane'));
    expect(lanes[0].colour).not.toBe(lanes[1].colour);
  });
});
