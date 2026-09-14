import { describe, expect, it } from "vitest";
import { buildRows, DEFAULT_LANES, TIERS, renderBoard, tiersByRunId } from "./board.js";

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

  it("says why an empty board is empty, naming the event", () => {
    const container = render([]);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".empty").textContent).toContain("2 m Sprint");
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
  it("marks a tested run as the trial", () => {
    const rows = buildRows([{ ...row(), provisional: true }]);
    expect(rows[0].tier).toBe(TIERS.TRIAL);
  });

  it("marks the best published finisher as the leader", () => {
    const rows = buildRows([
      row({ rank: 1, run_id: "a", score: 18 }),
      row({ rank: 2, run_id: "b", score: 22 }),
    ]);
    expect(rows.map((r) => r.tier)).toEqual([TIERS.LEADER, TIERS.GHOST]);
  });

  it("keeps the leader the best PUBLISHED run even when a trial beats it", () => {
    // You still want to see what you are chasing, not lose it among the ghosts.
    const rows = buildRows([
      { ...row({ run_id: null, score: 15 }), provisional: true },
      row({ run_id: "a", score: 18 }),
      row({ run_id: "b", score: 22 }),
    ]);
    expect(rows.map((r) => r.tier)).toEqual([TIERS.TRIAL, TIERS.LEADER, TIERS.GHOST]);
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

  it("offers nothing for a trial, which is stored nowhere at all", () => {
    const [built] = buildRows([
      row({ provisional: true, offers_download: true, run_id: null }),
    ]);
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

  it("offers nothing for a trial, which is stored nowhere at all", () => {
    const [built] = buildRows([
      row({ provisional: true, offers_download: true, run_id: null }),
    ]);
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
