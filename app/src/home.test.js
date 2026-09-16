import { describe, expect, it } from "vitest";
import { flyer, ladder, shellOf } from "./home.js";

const open = {
  id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", rig: "legs",
  length_m: 2, slope_deg: 0,
  sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
};
const planned = { ...open, id: "best-jump", title: "Best Jump", status: "planned", category: "challenge" };
const held = [{ user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 }];

describe("the ladder", () => {
  it("hangs one rung per player, linking to their page", () => {
    const el = ladder([
      { rank: 1, user: "ann", points: 360 },
      { rank: 2, user: "bob", points: 260 },
    ]);
    const rows = [...el.querySelectorAll("a.ladder-row")];
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["#/p/ann", "#/p/bob"]);
    expect(rows[0].querySelector(".ladder-rank").textContent).toBe("1");
    expect(rows[0].querySelector(".ladder-name").textContent).toBe("@ann");
    expect(rows[0].querySelector(".ladder-points").textContent).toBe("360 PTS");
    expect(rows[0].querySelector(".ladder-shell").className).toMatch(/ladder-shell-(cream|graphite|lavender|sky)/);
  });

  it("says so when nobody has published", () => {
    const el = ladder([]);
    expect(el.querySelector("a.ladder-row")).toBeNull();
    expect(el.querySelector(".ladder-empty").textContent).toBe("Nobody has published yet.");
  });
});

describe("shellOf", () => {
  it("is stable per name and one of the four shells", () => {
    expect(shellOf("ann")).toBe(shellOf("ann"));
    for (const user of ["ann", "bob", "cid", "dee", "eve"]) {
      expect(["cream", "graphite", "lavender", "sky"]).toContain(shellOf(user));
    }
  });
});

describe("an open event's flyer", () => {
  it("links into the race and names it", () => {
    const el = flyer(open, held);
    expect(el.matches("article.challenge-note")).toBe(true);
    expect(el.querySelector("a.challenge-link").getAttribute("href")).toBe("#/e/sprint-2m");
    expect(el.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
    expect(el.querySelector(".eyebrow").textContent).toBe("RACE");
  });

  it("leaves the art frame empty until the still lands", () => {
    const frame = flyer(open, held).querySelector(".challenge-art");
    expect(frame).not.toBeNull();
    expect(frame.childElementCount).toBe(0);
  });

  it("states the course facts without the sweep", () => {
    expect(flyer(open, held).querySelector(".challenge-facts").textContent).toBe("2 m · flat · legs");
  });

  it("shows who holds it and in what time", () => {
    const standing = flyer(open, held).querySelector(".flyer-leader");
    expect(standing.querySelector(".challenge-star")).not.toBeNull();
    expect(standing.textContent).toContain("cdeplanne");
    expect(standing.textContent).toContain("9.456s");
  });

  it("invites an entry when nobody has finished", () => {
    expect(flyer(open, []).textContent).toContain("be the first");
    const dnf = [{ user: "a", policy_name: "p", score: 50, seeds_finished: 0 }];
    expect(flyer(open, dnf).textContent).toContain("no finisher yet");
  });
});

describe("a planned event's flyer", () => {
  it("is on the wall but is not a link", () => {
    const el = flyer(planned, []);
    expect(el.querySelector("a.challenge-link")).toBeNull();
    expect(el.querySelector("div.challenge-link")).not.toBeNull();
    expect(el.classList.contains("challenge-note--planned")).toBe(true);
  });

  it("says why it cannot be entered and never invites one", () => {
    const el = flyer(planned, []);
    expect(el.textContent).toContain("course not built yet");
    expect(el.textContent).not.toContain("be the first");
  });
});

const voted = {
  ...open,
  id: "swag-contest",
  title: "Swag Contest",
  metric: "votes",
  vote: { ballot_min: 2, ballot_max: 4, window_days: 7, per_day: 20 },
};

describe("a votable flyer", () => {
  it("wears a vote button and links to the booth", () => {
    const note = flyer(voted, []);
    expect(note.querySelector(".vote-button--sticker").textContent).toBe("VOTE HERE");
    expect(note.querySelector(".vote-button--sticker").getAttribute("href")).toBe("#/v/swag-contest");
  });

  it("counts the week's votes instead of a time", () => {
    const note = flyer(voted, [{ user: "cdeplanne", votes: 43, seeds_finished: 5 }]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("43 votes");
  });

  it("says so when nothing has been voted for yet", () => {
    const note = flyer(voted, [{ user: "cdeplanne", votes: 0, seeds_finished: 5 }]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("no votes yet");
  });

  it("hides the button on a planned round -- there is no booth to send anyone to yet", () => {
    const note = flyer({ ...voted, status: "planned" }, []);
    expect(note.querySelector(".vote-button")).toBeNull();
  });

  it("leaves a timed flyer alone", () => {
    const note = flyer(open, held);
    expect(note.querySelector(".vote-button")).toBeNull();
  });
});

describe("the flyer's category", () => {
  it("labels the event with its own category, not 'Race'", () => {
    expect(flyer({ ...open, category: "showcase" }, []).querySelector(".eyebrow").textContent)
      .toBe("SHOWCASE");
  });

  it("colours the offset shadow by category", () => {
    const shadowOf = (category) => flyer({ ...open, category }, []).className;
    expect(shadowOf("race")).toContain("challenge-note--race");
    expect(shadowOf("challenge")).toContain("challenge-note--challenge");
    expect(shadowOf("showcase")).toContain("challenge-note--showcase");
  });

  it("uses the charter's shadow primitive rather than its own box-shadow", () => {
    expect(flyer(open, []).className).toContain("fx-shadow-card");
  });

  it("renders an unrecognised category without a label and without throwing", () => {
    // One malformed manifest must not take the whole wall down. The server is
    // where an unknown category is rejected; the page degrades.
    const note = flyer({ ...open, category: "parade" }, []);
    expect(note.className).not.toMatch(/challenge-note--/);
    expect(note.querySelector(".eyebrow")).toBeNull();
  });
});

describe("the polaroid caption", () => {
  it("puts the leader's handle above the event's title", () => {
    const note = flyer(open, [
      { user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 },
    ]);
    const order = [...note.querySelectorAll(".flyer-leader, .flyer-title")]
      .map((n) => n.className);
    expect(order).toEqual(["flyer-leader", "flyer-title"]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("cdeplanne");
    expect(note.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
  });

  it("shows the still above the caption, polaroid-fashion", () => {
    const note = flyer(open, []);
    const parts = [...note.querySelector(".challenge-link").children].map((n) => n.className);
    expect(parts.indexOf("challenge-art")).toBeLessThan(parts.indexOf("flyer-leader"));
  });
});
