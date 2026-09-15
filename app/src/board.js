// The leaderboard table, and which runs are queued into replay lanes.
//
// buildRows is pure so the selection rules are testable: the podium is
// preselected, but a DNF never is, because a lane showing a duck that never
// finished reads as a bug rather than a result.

import { formatScore, formatSeeds, formatSpeed } from "./format.js";
import { LANE_CSS } from "./course.js";

export const DEFAULT_LANES = 3;

// Inline, not an <img>: it inherits currentColor, so it picks up the row's hover
// and focus states for free and costs no extra request.
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M8 1.75v8.5m0 0L4.75 7M8 10.25 11.25 7M2.25 12.5v1.25' +
  'a.5.5 0 0 0 .5.5h10.5a.5.5 0 0 0 .5-.5V12.5"/></svg>';

// Three ways a duck can appear on the stage, so you can tell at a glance which
// one is yours:
//   trial  — the run you just tested, published nowhere
//   leader — the best PUBLISHED run, whatever the trial did
//   ghost  — every other run, translucent, the way the simulator draws its
//            multiplayer peers
export const TIERS = { TRIAL: "trial", LEADER: "leader", GHOST: "ghost" };

// A cross, not a bin: this takes the entry off the board, it does not delete
// the policy — which stays in its author's own Hub repo.
const WITHDRAW_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
  'd="M4 4l8 8M12 4l-8 8"/></svg>';

// An arrow leaving a box: "this goes somewhere else". Distinct from the
// download glyph beside it, which comes towards you.
const ENV_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.75v3a.75.75 0 0 1-.75.75h-8a.75.75 0 0 1-.75-.75v-8a.75.75 0 0 1 .75-.75h3"/></svg>';

export function buildRows(rows, { me = null } = {}) {
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
      // Whether a download exists is the SERVER's decision (see
      // RunRecord.offers_download): a Hub-published policy offers one while the
      // Space stores nothing. Re-deriving that here would give the two sides a
      // chance to disagree.
      policyUrl:
        !row.provisional && row.offers_download && row.run_id
          ? row.policy_url || `/api/runs/${row.run_id}/policy`
          : null,
      // Shown only on your own published rows. The server refuses anyone
      // else's regardless, so this is about not offering a button that would
      // be rejected — not about security, which lives server-side.
      mine: Boolean(me && row.run_id && !row.provisional && row.user === me),
      // Only meaningful on a voted board (event.metric === "votes"); ignored
      // by renderBoard otherwise. The server puts it on every row of one.
      votes: row.votes,
      // The server refuses anything but a few known hosts, so a link that
      // reaches here is one of those. Still opened with noopener/noreferrer.
      envUrl: row.env_url || null,
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

export function renderBoard(
  container,
  { event, rows },
  { onSelectionChange, onWithdraw, me = null } = {},
) {
  const built = buildRows(rows, { me });
  container.innerHTML = "";

  if (built.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `No runs yet on ${event.title}. Submit a policy to open the board.`;
    container.append(empty);
    return;
  }

  // A voted event is held by whoever collected the most votes, so that
  // column reads "votes" and shows the count -- a finish time would be the
  // wrong fact about it, and does not appear on this board at all.
  const voted = event.metric === "votes";

  const table = document.createElement("table");
  table.className = "board";
  table.innerHTML =
    "<thead><tr><th class='tab'></th><th class='rank'>place</th><th>who</th>" +
    "<th>policy</th>" +
    (voted ? "<th class='votes'>votes</th>" : "<th class='time'>time</th>") +
    "<th class='speed'>m/s</th>" +
    "<th class='seeds'>seeds</th><th class='env'></th><th class='grab'></th>" +
    "<th class='mine'></th></tr></thead>";
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
      // A glyph, not the word ".onnx": the column is narrow, and an arrow into
      // a tray reads as "download" without being read at all. The accessible
      // name lives on aria-label and title, so screen readers and hover both
      // get the full sentence the text used to carry.
      link.innerHTML = DOWNLOAD_ICON;
      link.setAttribute("aria-label", `Download ${row.user}'s ${row.policy} as .onnx`);
      link.title = `Download ${row.user}'s ${row.policy} and race it yourself`;
      link.setAttribute("download", "");
      grab.append(link);
    }

    const env = document.createElement("td");
    env.className = "env";
    if (row.envUrl) {
      const link = document.createElement("a");
      link.href = row.envUrl;
      link.target = "_blank";
      // noreferrer as well as noopener: the destination has no business knowing
      // which board sent someone, and this costs nothing.
      link.rel = "noopener noreferrer";
      link.innerHTML = ENV_ICON;
      link.title = `Training environment for ${row.policy} (${new URL(row.envUrl).hostname})`;
      link.setAttribute("aria-label", link.title);
      env.append(link);
    }

    const own = document.createElement("td");
    own.className = "mine";
    if (row.mine && onWithdraw) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "withdraw";
      button.innerHTML = WITHDRAW_ICON;
      button.title = `Take ${row.policy} off the board`;
      button.setAttribute("aria-label", `Take ${row.policy} off the board`);
      button.addEventListener("click", () => onWithdraw(row.runId, row.policy));
      own.append(button);
    }

    tr.append(
      laneCell,
      cell(row.rank, "rank"),
      cell(row.user),
      row.provisional ? policyCell(row.policy) : cell(row.policy),
      // A provisional (unpublished trial) row has no votes by definition, so
      // it reads as "—" rather than a misleading 0 alongside real counts.
      voted
        ? cell(row.provisional ? "—" : String(row.votes ?? 0), "votes")
        : cell(row.score, "time"),
      cell(row.speed, "speed"),
      cell(row.seeds, "seeds"),
      env,
      grab,
      own,
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
