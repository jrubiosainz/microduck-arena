// The leaderboard table, and which runs are queued into replay lanes.
//
// buildRows is pure so the selection rules are testable: the podium is
// preselected, but a DNF never is, because a lane showing a duck that never
// finished reads as a bug rather than a result.

import { formatRate, formatScore, formatSeeds, formatSpeed, isStage, isTug } from "./format.js";
import { LANE_CSS } from "./course.js";
import { onDuckPanel, onWheels, popFrom } from "./onduck.js";
import { runHref } from "./router.js";

export const DEFAULT_LANES = 3;

// Inline, not an <img>: it inherits currentColor, so it picks up the row's hover
// and focus states for free and costs no extra request.
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M8 1.75v8.5m0 0L4.75 7M8 10.25 11.25 7M2.25 12.5v1.25' +
  'a.5.5 0 0 0 .5.5h10.5a.5.5 0 0 0 .5-.5V12.5"/></svg>';

// Two ways a duck can appear on the stage, so you can tell at a glance which
// one is the one to beat:
//   leader — the best PUBLISHED run
//   ghost  — every other run, translucent, the way the simulator draws its
//            multiplayer peers
export const TIERS = { LEADER: "leader", GHOST: "ghost" };

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

/**
 * `selected`, when given, is the set of run ids that are ON THE STAGE — kept
 * by the page rather than recomputed here, so that ticking a row and then
 * changing what the table lists does not silently re-pick the lanes. Without
 * it the board opens on its own first lanes, which is what a fresh page wants.
 */
export function buildRows(rows, { me = null, selected = null, metric } = {}) {
  let lanes = 0;
  // The leader is the best PUBLISHED finisher — not simply rank 1, because a
  // DNF ahead of it does not count.
  const leaderId = rows.find((row) => row.seeds_finished > 0)?.run_id;
  return rows.map((row) => {
    const dnf = row.seeds_finished === 0;
    // Published rows fill the lanes up to the cap.
    const racing = selected
      ? Boolean(row.run_id && selected.has(row.run_id))
      : !dnf && lanes < DEFAULT_LANES;
    if (racing) lanes += 1;
    return {
      rank: row.rank,
      user: row.user,
      policy: row.policy_name,
      score: formatScore(row.score, { finished: row.seeds_finished, metric }),
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
        row.offers_download && row.run_id
          ? row.policy_url || `/api/runs/${row.run_id}/policy`
          : null,
      // The robot's own line for a Hub policy (RunRecord.robot_command), and the cast that says
      // whether it raced on wheels.
      robotCommand: row.robot_command ?? null,
      cast: row.cast,
      // Shown only on your own published rows. The server refuses anyone
      // else's regardless, so this is about not offering a button that would
      // be rejected — not about security, which lives server-side.
      mine: Boolean(me && row.run_id && row.user === me),
      // Only meaningful on a voted board (event.metric === "votes"); ignored
      // by renderBoard otherwise. The server puts them on every row of one.
      rate: row.rate,
      votes: row.votes,
      shown: row.shown,
      // The server refuses anything but a few known hosts, so a link that
      // reaches here is one of those. Still opened with noopener/noreferrer.
      envUrl: row.env_url || null,
      runId: row.run_id,
      dnf,
      selected: racing,
      tier: row.run_id && row.run_id === leaderId ? TIERS.LEADER : TIERS.GHOST,
      // The colour of this row's ground stripe in the stage, so the two can be
      // matched by eye. Only a racing row has one.
      laneColor: racing ? LANE_CSS[(lanes - 1) % LANE_CSS.length] : null,
    };
  });
}

export function renderBoard(
  container,
  { event, rows },
  { onSelectionChange, onWithdraw, me = null, selected = null } = {},
) {
  const built = buildRows(rows, { me, selected, metric: event.metric });
  container.innerHTML = "";

  if (built.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `No runs yet on ${event.title}. Train your own robot to open the board.`;
    container.append(empty);
    return;
  }

  // A voted event is held by whoever wins its ballots most often, so that
  // column reads "rating" and shows the rate -- a finish time would be the
  // wrong fact about it, and does not appear on this board at all.
  const voted = event.metric === "votes";
  // A performance has no speed and is played once, and a tug is rated by its bouts against the reference: on either,
  // neither column means anything.
  const stage = isStage(event) || isTug(event);
  const rated = isTug(event);

  const table = document.createElement("table");
  table.className = "board";
  table.innerHTML =
    "<thead><tr><th class='tab'></th><th class='rank'>place</th><th>who</th>" +
    "<th>policy</th>" +
    (voted ? "<th class='rate'>rating</th>" : `<th class='time'>${rated ? "rating" : "time"}</th>`) +
    (stage ? "" : "<th class='speed'>m/s</th><th class='seeds'>seeds</th>") +
    "<th class='record'>record</th>" +
    "<th class='env'></th><th class='grab'></th>" +
    "<th class='mine'></th></tr></thead>";
  const body = document.createElement("tbody");

  for (const row of built) {
    const tr = document.createElement("tr");
    if (row.dnf) tr.classList.add("dnf");
    tr.classList.add(`tier-${row.tier}`);

    // The way to the run's page is the button in the record column, and only
    // that button. The whole row used to be clickable, which meant reaching for
    // the lane box or the download arrow and missing by a few pixels took you
    // off the board — and nothing on the row said it would.
    const lane = document.createElement("input");
    lane.type = "checkbox";
    lane.checked = row.selected;
    lane.dataset.runId = row.runId;
    // What a pick reads to know whose row this is. On the box itself rather
    // than looked up from the rows: the table is what is on screen, and a filter
    // may have left some of those rows out of it entirely.
    lane.dataset.rank = String(row.rank);
    if (row.mine) lane.dataset.mine = "";
    lane.addEventListener("change", () => onSelectionChange?.(selectedRunIds(container)));

    const cell = (text, className) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    };

    const rating = () => {
      const td = cell(formatRate(row.rate), "rate");
      td.title = `${row.votes} votes in ${row.shown} ballots`;
      return td;
    };

    const laneCell = document.createElement("td");
    laneCell.className = "tab";
    // The tab is the stripe: filled in the lane's colour while it races,
    // hollow when it is not on the stage.
    if (row.laneColor) laneCell.style.setProperty("--lane", row.laneColor);
    laneCell.append(lane);
    // A real <a href>, not a fetch-and-blob: the browser's own download
    // handles the filename the server sets and works with middle-click and
    // "save link as" for free.
    const grab = document.createElement("td");
    grab.className = "grab";
    if (row.robotCommand) {
      // The same glyph opens a panel rather than the file: the .onnx is in it, beside the line
      // that runs the policy on a real duck, which the file alone cannot (onduck.js).
      const open = document.createElement("button");
      open.type = "button";
      open.innerHTML = DOWNLOAD_ICON;
      open.title = `Download ${row.user}'s ${row.policy}, or run it on your microduck`;
      open.setAttribute("aria-label", open.title);
      const panel = onDuckPanel({
        command: row.robotCommand,
        wheels: onWheels(row.cast, event),
        event,
        download: row.policyUrl,
      });
      popFrom(open, panel);
      grab.append(open, panel);
    } else if (row.policyUrl) {
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

    // The run's page is where the video is. A named button rather than a glyph
    // beside the two that already are: this one leaves the board, and the two
    // others fetch a file and open a repo.
    const record = document.createElement("td");
    record.className = "record";
    const watch = document.createElement("a");
    watch.className = "record-link";
    watch.href = runHref(row.runId);
    watch.textContent = "Watch";
    watch.title = `Watch ${row.user}'s run with ${row.policy}`;
    watch.setAttribute("aria-label", watch.title);
    record.append(watch);

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
      cell(row.policy),
      voted ? rating() : cell(row.score, "time"),
      ...(stage ? [] : [cell(row.speed, "speed"), cell(row.seeds, "seeds")]),
      record,
      env,
      grab,
      own,
    );
    body.append(tr);
  }

  table.append(body);
  container.append(table);
}

/**
 * Tick, or untick, every lane the board is SHOWING, and say what ended up
 * ticked.
 *
 * Showing is the whole point: a board filtered to your own runs has no other
 * rows in the DOM, so "all" there means all of what you are looking at and not
 * all of what the server holds — which is how you put your own six runs on the
 * stage and then go back to the full table with only those six racing.
 */
export function setAllLanes(container, on) {
  for (const box of container.querySelectorAll("input[type=checkbox]")) {
    box.checked = on;
  }
  return selectedRunIds(container);
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
