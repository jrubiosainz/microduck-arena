// The leaderboard table, and which runs are queued into replay lanes.
//
// buildRows is pure so the selection rules are testable: the podium is
// preselected, but a DNF never is, because a lane showing a duck that never
// finished reads as a bug rather than a result.

import { formatScore, formatSeeds, formatSpeed } from "./format.js";
import { LANE_CSS } from "./course.js";

export const DEFAULT_LANES = 3;

// Three ways a duck can appear on the stage, so you can tell at a glance which
// one is yours:
//   trial  — the run you just tested, published nowhere
//   leader — the best PUBLISHED run, whatever the trial did
//   ghost  — every other run, translucent, the way the simulator draws its
//            multiplayer peers
export const TIERS = { TRIAL: "trial", LEADER: "leader", GHOST: "ghost" };

export function buildRows(rows) {
  let lanes = 0;
  // The leader is the best PUBLISHED finisher — not simply rank 1, because a
  // trial can outrank it and you still want to see what you are chasing.
  const leaderId = rows.find((row) => !row.provisional && row.seeds_finished > 0)?.run_id;
  return rows.map((row) => {
    const dnf = row.seeds_finished === 0;
    // A trial always takes a lane: it is the run you just asked for. Published
    // rows fill the remaining lanes up to the cap.
    const selected = !dnf && (row.provisional || lanes < DEFAULT_LANES);
    if (selected) lanes += 1;
    return {
      rank: row.rank,
      user: row.user,
      policy: row.policy_name,
      score: formatScore(row.score, { finished: row.seeds_finished }),
      // The speed the harness found for THIS policy. Two rows with similar
      // times can have reached them very differently, and that is the most
      // interesting column on the board.
      speed: formatSpeed(row.command_vx, { finished: row.seeds_finished }),
      seeds: formatSeeds(row.seeds_finished, row.seeds_total),
      // Where this row's weights can be fetched, or null. A published run has
      // them; a trial never does, and nor does a run recorded before policies
      // were kept — so this is null rather than a link that 404s.
      policyUrl:
        !row.provisional && row.model_stored && row.run_id
          ? `/api/runs/${row.run_id}/policy`
          : null,
      runId: row.run_id,
      dnf,
      selected,
      provisional: Boolean(row.provisional),
      tier: row.provisional
        ? TIERS.TRIAL
        : row.run_id && row.run_id === leaderId
          ? TIERS.LEADER
          : TIERS.GHOST,
      // The colour of this row's ground stripe in the stage, so the two can be
      // matched by eye. Only a racing row has one.
      laneColor: selected ? LANE_CSS[(lanes - 1) % LANE_CSS.length] : null,
    };
  });
}

export function renderBoard(container, { event, rows }, { onSelectionChange } = {}) {
  const built = buildRows(rows);
  container.innerHTML = "";

  if (built.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `No runs yet on ${event.title}. Submit a policy to open the board.`;
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "board";
  table.innerHTML =
    "<thead><tr><th class='tab'></th><th class='rank'>place</th><th>who</th>" +
    "<th>policy</th><th class='time'>time</th><th class='speed'>m/s</th>" +
    "<th class='seeds'>seeds</th><th class='grab'></th></tr></thead>";
  const body = document.createElement("tbody");

  for (const row of built) {
    const tr = document.createElement("tr");
    if (row.dnf) tr.classList.add("dnf");
    if (row.provisional) tr.classList.add("provisional");
    tr.classList.add(`tier-${row.tier}`);

    // A trial has no run id to tick: it is on the stage and nowhere else.
    let lane = null;
    if (!row.provisional) {
      lane = document.createElement("input");
      lane.type = "checkbox";
      lane.checked = row.selected;
      lane.dataset.runId = row.runId;
      lane.addEventListener("change", () => onSelectionChange?.(selectedRunIds(container)));
    }

    const policyCell = (text) => {
      const td = document.createElement("td");
      td.textContent = text;
      const note = document.createElement("span");
      note.className = "unpublished";
      note.textContent = "not published";
      td.append(note);
      return td;
    };
    const cell = (text, className) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    };

    const laneCell = document.createElement("td");
    laneCell.className = "tab";
    // The tab is the stripe: filled in the lane's colour while it races,
    // hollow when it is not on the stage.
    if (row.laneColor) laneCell.style.setProperty("--lane", row.laneColor);
    if (lane) laneCell.append(lane);
    // A real <a href>, not a fetch-and-blob: the browser's own download
    // handles the filename the server sets and works with middle-click and
    // "save link as" for free.
    const grab = document.createElement("td");
    grab.className = "grab";
    if (row.policyUrl) {
      const link = document.createElement("a");
      link.href = row.policyUrl;
      link.textContent = ".onnx";
      link.title = `Download ${row.user}'s ${row.policy} and race it yourself`;
      link.setAttribute("download", "");
      grab.append(link);
    }

    tr.append(
      laneCell,
      cell(row.rank, "rank"),
      cell(row.user),
      row.provisional ? policyCell(row.policy) : cell(row.policy),
      cell(row.score, "time"),
      cell(row.speed, "speed"),
      cell(row.seeds, "seeds"),
      grab,
    );
    body.append(tr);
  }

  table.append(body);
  container.append(table);
}

export function selectedRunIds(container) {
  return [...container.querySelectorAll("input[type=checkbox]:checked")].map(
    (box) => box.dataset.runId,
  );
}

/** The tier of each row, keyed by run id, so the stage can match the table. */
export function tiersByRunId(rows) {
  const map = new Map();
  for (const row of buildRows(rows)) {
    if (row.runId) map.set(row.runId, row.tier);
  }
  return map;
}
