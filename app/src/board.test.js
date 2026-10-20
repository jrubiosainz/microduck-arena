import { describe, expect, it } from "vitest";
import { DEFAULT_LANES, TIERS, buildRows, renderBoard, setAllLanes, tiersByRunId } from "./board.js";

const row = (over = {}) => ({
  rank: 1,
  user: "alice",
  policy_name: "walker",
  score: 11.724,
  command_vx: 0.4,
  seeds_finished: 5,
  seeds_total: 5,
  run_id: "01AAA",
  submitted_at: "2026-09-03T10:00:00Z",
  ...over,
});

describe("buildRows", () => {
  it("carries the display strings the table needs", () => {
    const [built] = buildRows([row()]);
    expect(built.rank).toBe(1);
    expect(built.user).toBe("alice");
    expect(built.policy).toBe("walker");
    expect(built.score).toBe("11.724s");
    expect(built.speed).toBe("0.40");
    expect(built.seeds).toBe("5/5");
    expect(built.runId).toBe("01AAA");
    expect(built.dnf).toBe(false);
  });

  it("marks a row that never finished", () => {
    const [built] = buildRows([row({ score: 50, seeds_finished: 0 })]);
    expect(built.score).toBe("DNF");
    expect(built.dnf).toBe(true);
  });

  it("preselects the podium and nothing beyond it", () => {
    const rows = buildRows(
      [1, 2, 3, 4, 5].map((n) => row({ rank: n, run_id: `run-${n}`, user: `u${n}` })),
    );
    expect(rows.filter((r) => r.selected).map((r) => r.runId)).toEqual([
      "run-1",
      "run-2",
      "run-3",
    ]);
    expect(DEFAULT_LANES).toBe(3);
  });

  it("preselects everyone when the board is smaller than the podium", () => {
    const rows = buildRows([row({ rank: 1, run_id: "a" }), row({ rank: 2, run_id: "b" })]);
    expect(rows.every((r) => r.selected)).toBe(true);
  });

  it("does not preselect a DNF into a racing lane", () => {
    // A lane showing a duck that never finished is a confusing default.
    const rows = buildRows([
      row({ rank: 1, run_id: "a" }),
      row({ rank: 2, run_id: "b", score: 50, seeds_finished: 0 }),
    ]);
    expect(rows.find((r) => r.runId === "b").selected).toBe(false);
  });

  it("returns an empty list for an empty board", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("renderBoard", () => {
  const event = { id: "sprint-2m", title: "2 m Sprint" };

  function render(rows) {
    const container = document.createElement("div");
    renderBoard(container, { event, rows }, {});
    return container;
  }

  it("draws one row per entry", () => {
    const container = render([row({ rank: 1, run_id: "a" }), row({ rank: 2, run_id: "b" })]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("ticks the lane box for a preselected row and not for a DNF", () => {
    const container = render([
      row({ rank: 1, run_id: "a" }),
      row({ rank: 2, run_id: "b", score: 50, seeds_finished: 0 }),
    ]);
    const boxes = [...container.querySelectorAll("input[type=checkbox]")];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(boxes.map((b) => b.dataset.runId)).toEqual(["a", "b"]);
  });

  it("marks a DNF row so it can be dimmed", () => {
    const container = render([row({ score: 50, seeds_finished: 0 })]);
    expect(container.querySelector("tbody tr").classList.contains("dnf")).toBe(true);
  });

  it("shows the time and seeds in the row", () => {
    const text = render([row()]).querySelector("tbody tr").textContent;
    expect(text).toContain("11.724s");
    expect(text).toContain("5/5");
    expect(text).toContain("alice");
  });

  it("heads a record column and puts one button in it, per published run", () => {
    const container = render([row()]);
    expect(container.querySelector("th.record").textContent).toBe("record");
    const watch = container.querySelector("td.record a.record-link");
    expect(watch.getAttribute("href")).toBe("#/r/01AAA");
    expect(watch.textContent).toBe("Watch");
    // Named for a screen reader as well as for the eye: "Watch" alone, read
    // out of eight identical rows, says nothing about which run it opens.
    expect(watch.getAttribute("aria-label")).toBe("Watch alice's run with walker");
  });

  it("stops making the whole row the way to the run", () => {
    // A row that navigates on any click sends you off the board when you reach
    // for the lane box or the download arrow and miss, and nothing on it says
    // it will. The button in the record column is the only way now.
    const container = render([row()]);
    const tr = container.querySelector("tbody tr");
    expect(tr.classList.contains("linked")).toBe(false);
    location.hash = "#/e/sprint-2m";
    tr.click();
    expect(location.hash).toBe("#/e/sprint-2m");
  });

  it("says why an empty board is empty, naming the event", () => {
    const container = render([]);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".empty").textContent).toBe(
      "No runs yet on 2 m Sprint. Train your own robot to open the board.",
    );
  });

  it("reports the ticked run ids when a lane box is toggled", () => {
    const container = document.createElement("div");
    const seen = [];
    renderBoard(
      container,
      { event, rows: [row({ rank: 1, run_id: "a" }), row({ rank: 2, run_id: "b" })] },
      { onSelectionChange: (ids) => seen.push(ids) },
    );
    const [, second] = container.querySelectorAll("input[type=checkbox]");
    second.checked = false;
    second.dispatchEvent(new Event("change"));
    expect(seen).toEqual([["a"]]);
  });
});

describe("lane colours tie a row to its stripe on the stage", () => {
  const event = { id: "sprint-2m", title: "2 m Sprint" };
  const render = (rows) => {
    const container = document.createElement("div");
    renderBoard(container, { event, rows }, {});
    return container;
  };

  it("gives each racing row the colour of its own lane, in order", () => {
    const rows = buildRows(
      [1, 2, 3].map((n) => row({ rank: n, run_id: `r${n}`, user: `u${n}` })),
    );
    const colours = rows.map((r) => r.laneColor);
    expect(colours.every(Boolean)).toBe(true);
    expect(new Set(colours).size).toBe(3);
  });

  it("gives a row that is not racing no colour at all", () => {
    const rows = buildRows([
      row({ rank: 1, run_id: "a" }),
      row({ rank: 2, run_id: "b", score: 50, seeds_finished: 0 }),
    ]);
    expect(rows[0].laneColor).toBeTruthy();
    expect(rows[1].laneColor).toBeNull();
  });

  it("skips a DNF when handing out colours, so lanes and stripes stay aligned", () => {
    // Lane 0's stripe belongs to the first RACING row, not the first row.
    const rows = buildRows([
      row({ rank: 1, run_id: "dnf", score: 50, seeds_finished: 0 }),
      row({ rank: 2, run_id: "runner" }),
    ]);
    const racing = rows.find((r) => r.runId === "runner");
    expect(racing.laneColor).toBe(rows.filter((r) => r.laneColor)[0].laneColor);
  });

  it("paints the tab cell for a racing row only", () => {
    const container = render([
      row({ rank: 1, run_id: "a" }),
      row({ rank: 2, run_id: "b", score: 50, seeds_finished: 0 }),
    ]);
    const tabs = [...container.querySelectorAll("td.tab")];
    expect(tabs[0].style.getPropertyValue("--lane")).not.toBe("");
    expect(tabs[1].style.getPropertyValue("--lane")).toBe("");
  });
});

describe("telling your run apart from the rest", () => {
  it("marks the best published finisher as the leader", () => {
    const rows = buildRows([
      row({ rank: 1, run_id: "a", score: 18 }),
      row({ rank: 2, run_id: "b", score: 22 }),
    ]);
    expect(rows.map((r) => r.tier)).toEqual([TIERS.LEADER, TIERS.GHOST]);
  });

  it("does not make a DNF the leader", () => {
    const rows = buildRows([
      row({ run_id: "dnf", score: 50, seeds_finished: 0 }),
      row({ run_id: "real", score: 30 }),
    ]);
    expect(rows.find((r) => r.runId === "real").tier).toBe(TIERS.LEADER);
    expect(rows.find((r) => r.runId === "dnf").tier).toBe(TIERS.GHOST);
  });

  it("puts the tier on the row so the stage and the table can agree", () => {
    const container = document.createElement("div");
    renderBoard(container, { event: { id: "e", title: "E" }, rows: [row({ run_id: "a" })] }, {});
    expect(container.querySelector("tbody tr").classList.contains("tier-leader")).toBe(true);
  });

  it("maps run ids to tiers for the stage", () => {
    const map = tiersByRunId([row({ run_id: "a", score: 18 }), row({ run_id: "b", score: 22 })]);
    expect(map.get("a")).toBe(TIERS.LEADER);
    expect(map.get("b")).toBe(TIERS.GHOST);
  });
});

describe("policy downloads", () => {
  it("offers a download for a published row that has its weights", () => {
    const [built] = buildRows([row({ offers_download: true, policy_url: null })]);
    expect(built.policyUrl).toBe("/api/runs/01AAA/policy");
  });

  it("offers nothing for a run recorded before policies were kept", () => {
    // The log is append-only, so those files are never coming back. A link
    // here would 404.
    const [built] = buildRows([row({ offers_download: false })]);
    expect(built.policyUrl).toBeNull();
  });

  it("renders the link as a real anchor the browser can download", () => {
    // A real href, not a fetch-and-blob: middle-click, "save link as" and the
    // server's Content-Disposition filename all come for free.
    const container = document.createElement("div");
    renderBoard(container, {
      event: { title: "2 m Sprint" },
      rows: [row({ offers_download: true, policy_url: null, user: "alice", policy_name: "walker" })],
    });
    const link = container.querySelector("td.grab a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/api/runs/01AAA/policy");
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.title).toContain("alice");
  });

  it("leaves the cell empty rather than rendering a dead link", () => {
    const container = document.createElement("div");
    renderBoard(container, {
      event: { title: "2 m Sprint" },
      rows: [row({ offers_download: false })],
    });
    expect(container.querySelector("td.grab")).not.toBeNull();
    expect(container.querySelector("td.grab a")).toBeNull();
  });
});

describe("policy downloads across both hosting paths", () => {
  it("links to the Hub when that is where the policy lives", () => {
    const [built] = buildRows([
      row({
        offers_download: true,
        policy_url: "https://huggingface.co/alice/microduck-walker/resolve/rev/policy.onnx",
      }),
    ]);
    expect(built.policyUrl).toBe(
      "https://huggingface.co/alice/microduck-walker/resolve/rev/policy.onnx",
    );
  });

  it("links to this server for a locally stored policy", () => {
    const [built] = buildRows([row({ offers_download: true, policy_url: null })]);
    expect(built.policyUrl).toBe("/api/runs/01AAA/policy");
  });

  it("offers nothing when the server says there is nothing", () => {
    // The rule lives in arena/store.py; the frontend must not re-derive it.
    const [built] = buildRows([row({ offers_download: false })]);
    expect(built.policyUrl).toBeNull();
  });
});

describe("the download control", () => {
  const rendered = (over) => {
    const container = document.createElement("div");
    renderBoard(container, { event: { title: "2 m Sprint" }, rows: [row(over)] });
    return container.querySelector("td.grab a");
  };

  it("is an icon, not the word .onnx", () => {
    const link = rendered({ offers_download: true });
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.textContent.trim()).toBe("");
  });

  it("keeps an accessible name, since the glyph carries none", () => {
    // An icon with no label is a button nobody can read. Both the hover title
    // and the screen-reader name must still say whose policy this is.
    const link = rendered({ offers_download: true, user: "alice", policy_name: "walker" });
    expect(link.getAttribute("aria-label")).toContain("alice");
    expect(link.getAttribute("aria-label")).toContain("walker");
    expect(link.title).toContain("alice");
  });

  it("hides the glyph itself from screen readers", () => {
    // Otherwise the assistive name is announced twice — once from aria-label,
    // once from the svg.
    const link = rendered({ offers_download: true });
    expect(link.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  });

  it("still downloads rather than navigating", () => {
    const link = rendered({ offers_download: true });
    expect(link.hasAttribute("download")).toBe(true);
  });
});

describe("taking your own entry off the board", () => {
  const rendered = (over, opts) => {
    const container = document.createElement("div");
    renderBoard(container, { event: { title: "2 m Sprint" }, rows: [row(over)] }, opts);
    return container;
  };

  it("offers the control on a row you published", () => {
    const c = rendered({ user: "alice" }, { me: "alice", onWithdraw: () => {} });
    const button = c.querySelector("button.withdraw");
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toContain("off the board");
  });

  it("does not offer it on someone else's row", () => {
    const c = rendered({ user: "bob" }, { me: "alice", onWithdraw: () => {} });
    expect(c.querySelector("button.withdraw")).toBeNull();
  });

  it("does not offer it when nobody is signed in", () => {
    const c = rendered({ user: "alice" }, { onWithdraw: () => {} });
    expect(c.querySelector("button.withdraw")).toBeNull();
  });

  it("hands the run id to the handler when clicked", () => {
    const calls = [];
    const c = rendered({ user: "alice" }, { me: "alice", onWithdraw: (id) => calls.push(id) });
    c.querySelector("button.withdraw").click();
    expect(calls).toEqual(["01AAA"]);
  });
});

describe("a voted board shows a rating, not a time", () => {
  const votedEvent = { id: "got-a-talent", title: "MicroDuck Got a Talent", metric: "votes" };

  function render(rows) {
    const container = document.createElement("div");
    renderBoard(container, { event: votedEvent, rows }, {});
    return container;
  }

  it("heads that column rating, not time", () => {
    const container = render([row({ votes: 5, shown: 20, rate: 0.25 })]);
    expect(container.querySelector("th.time")).toBeNull();
    expect(container.querySelector("th.rate").textContent).toBe("rating");
  });

  it("shows the rating as a percentage, and the votes behind it on hover", () => {
    const container = render([row({ votes: 7, shown: 11, rate: 0.387 })]);
    const rating = container.querySelector("td.rate");
    expect(rating.textContent).toBe("39%");
    expect(rating.title).toBe("7 votes in 11 ballots");
  });

  it("never shows a finish time on a voted board -- that is the owner's explicit choice", () => {
    const container = render([row({ votes: 12, shown: 40, rate: 0.3 })]);
    expect(container.querySelector("td.time")).toBeNull();
    expect(container.textContent).not.toContain("11.724s");
  });
});

describe("a stage's board has no speed and no seeds: a performance has neither", () => {
  it("drops the m/s and seeds columns and cells", () => {
    const container = document.createElement("div");
    renderBoard(container, {
      event: { id: "got-a-talent", title: "MicroDuck Got a Talent", metric: "votes", course: "stage" },
      rows: [{ rank: 1, user: "ann", policy_name: "p", score: 20, command_vx: 0, seeds_finished: 1, seeds_total: 1,
               run_id: "r1", submitted_at: "2026-10-01T10:00:00Z", votes: 3, shown: 9, rate: 0.28 }],
    });
    const heads = [...container.querySelectorAll("th")].map((th) => th.textContent);
    expect(heads).not.toContain("m/s");
    expect(heads).not.toContain("seeds");
    expect(container.querySelector("td.speed")).toBeNull();
    expect(container.querySelector("td.rate").textContent).toBe("28%");
  });
});

describe("a timed board is unaffected -- renders exactly as before", () => {
  it("still heads the column time and shows the score, with no rating column at all", () => {
    const container = document.createElement("div");
    renderBoard(
      container,
      { event: { id: "sprint-2m", title: "2 m Sprint" }, rows: [row()] },
      {},
    );
    expect(container.querySelector("th.time").textContent).toBe("time");
    expect(container.querySelector("td.time").textContent).toBe("11.724s");
    expect(container.querySelector("th.rate")).toBeNull();
    expect(container.querySelector("td.rate")).toBeNull();
  });
});

describe("the training-environment link", () => {
  const rendered = (over) => {
    const container = document.createElement("div");
    renderBoard(container, { event: { title: "2 m Sprint" }, rows: [row(over)] });
    return container.querySelector("td.env a");
  };

  it("appears only when its author shared one", () => {
    expect(rendered({ env_url: null })).toBeNull();
    expect(rendered({ env_url: "https://github.com/me/env" })).not.toBeNull();
  });

  it("opens in a new tab without leaking the referrer or the opener", () => {
    // The destination has no business knowing which board sent someone, and an
    // opener handle is a tabnabbing surface.
    const link = rendered({ env_url: "https://github.com/me/env" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("names the host, so a click is not blind", () => {
    const link = rendered({ env_url: "https://huggingface.co/datasets/me/env" });
    expect(link.title).toContain("huggingface.co");
    expect(link.getAttribute("aria-label")).toContain("huggingface.co");
  });

  it("points exactly where the server said", () => {
    const link = rendered({ env_url: "https://gitlab.com/me/env?tab=x" });
    expect(link.getAttribute("href")).toBe("https://gitlab.com/me/env?tab=x");
  });
});

describe("setAllLanes: ticking everything on screen, or nothing", () => {
  const rows = [
    { rank: 1, user: "ann", run_id: "r1", score: 9, seeds_finished: 5, per_seed_total: 5 },
    { rank: 2, user: "coralie", run_id: "r2", score: 10, seeds_finished: 5 },
    { rank: 3, user: "bob", run_id: "r3", score: 11, seeds_finished: 5 },
    { rank: 4, user: "coralie", run_id: "r4", score: 12, seeds_finished: 5 },
    { rank: 5, user: "cid", run_id: "r5", score: 13, seeds_finished: 5 },
    { rank: 6, user: "dee", run_id: "r6", score: 14, seeds_finished: 5 },
  ];
  const board = (shown = rows) => {
    const el = document.createElement("div");
    renderBoard(el, { event: { title: "2 m Sprint" }, rows: shown }, { me: "coralie" });
    return el;
  };

  it("ticks every lane the board is showing", () => {
    expect(setAllLanes(board(), true)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
  });

  it("clears the stage when unticked", () => {
    expect(setAllLanes(board(), false)).toEqual([]);
  });

  it("speaks only for the rows on screen, which is the point", () => {
    // Filtered to your own runs, "all" means all of what you are looking at —
    // so you can put your six on the stage and then go back to the whole
    // table with only those six racing.
    const mine = rows.filter((row) => row.user === "coralie");
    expect(setAllLanes(board(mine), true)).toEqual(["r2", "r4"]);
  });
});

describe("buildRows: who is on the stage", () => {
  const rows = [
    { rank: 1, user: "ann", run_id: "r1", score: 9, seeds_finished: 5 },
    { rank: 2, user: "bob", run_id: "r2", score: 10, seeds_finished: 5 },
    { rank: 3, user: "cid", run_id: "r3", score: 11, seeds_finished: 5 },
    { rank: 4, user: "dee", run_id: "r4", score: 12, seeds_finished: 5 },
  ];

  it("opens on its own first lanes when nobody has chosen yet", () => {
    expect(buildRows(rows).filter((row) => row.selected).map((row) => row.runId))
      .toEqual(["r1", "r2", "r3"]);
  });

  it("takes the page's set when there is one, whatever the order", () => {
    // The table is rebuilt on every filter and every publish. Re-deriving the
    // lanes here would undo a choice made two renders ago.
    const built = buildRows(rows, { selected: new Set(["r4", "r2"]) });
    expect(built.filter((row) => row.selected).map((row) => row.runId)).toEqual(["r2", "r4"]);
  });

  it("gives an empty set an empty stage rather than falling back", () => {
    // A Set of nothing is a choice — "clear the stage" — and not the absence
    // of one, which is the whole difference between null and empty here.
    expect(buildRows(rows, { selected: new Set() }).some((row) => row.selected)).toBe(false);
  });
});

describe("the tug's board rates in newtons: no speed, no seeds", () => {
  it("heads the column rating and reads the force", () => {
    const container = document.createElement("div");
    renderBoard(container, {
      event: { id: "tug-of-war", title: "Tug of War", course: "tug", metric: "mean_hold_force" },
      rows: [row({ score: 4.2134 })],
    });
    expect(container.querySelector("th.time").textContent).toBe("rating");
    expect(container.querySelector("td.time").textContent).toBe("4.21 N");
    expect(container.querySelector("th.speed")).toBeNull();
    expect(container.querySelector("th.seeds")).toBeNull();
  });
});
