// One publication: the replay of the run against the ducks ranked just under
// it, the time it set, where it stands on the event's board, what it earned.
//
// Two modes. Plain shows all of it at once and loops the replay. Reveal — the
// author's first look — hides the result and plays it in beats (reveal.js).

import { getMe, getRun, getTrace, markSeen } from "./api.js";
import { flipTiles } from "./animation.js";
import { LANE_CSS } from "./course.js";
import { formatScore } from "./format.js";
import { CTRL_DT, frameCount } from "./replay.js";
import { climbPlan, reveal, revealFor } from "./reveal.js";
import { playerHref, raceHref, runHref } from "./router.js";
import { signage } from "./signage.js";
import { load as loadSounds } from "./sound.js";
import { createViewer } from "./viewer.js";

// How many of the ducks ranked just under this run race beside it.
const RIVALS = 3;

const TONES = {
  first_event: "sticker-lime",
  run: "sticker-cyan",
  own_best: "sticker-lavender",
  podium: "sticker-magenta",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The lanes on the stage: this run first, then the rows ranked just under it. */
export function lanesFor(run) {
  const at = run.board.findIndex((row) => row.you);
  return [run.board[at], ...run.board.slice(at + 1, at + 1 + RIVALS)];
}

/** Which seed the stored replay is, and why that one. */
function replayLine(run) {
  const finishers = run.per_seed.filter((s) => s.status === "finish").length;
  const which =
    finishers > 1 ? "median finisher" : finishers === 1 ? "the one finisher" : "furthest attempt";
  return `${run.command_vx.toFixed(2)} m/s · replay: seed ${run.trace_seed}, ${which}`;
}

function receiptLabel(receipt, eventTitle) {
  const what = {
    first_event: `first entry on ${eventTitle}`,
    run: "run",
    own_best: "personal best",
    podium: "podium · held",
  }[receipt.act];
  return `+${receipt.points} ${what}`;
}

export function pegRow(row) {
  const link = el("a", row.you ? "pegboard-row pegboard-row-you" : "pegboard-row");
  link.href = runHref(row.run_id);
  const name = el("span", "pegboard-name", `@${row.user}`);
  name.append(el("span", "pegboard-repo", row.policy_name));
  link.append(
    el("span", "pegboard-rank", String(row.rank)),
    name,
    el("span", "pegboard-score", formatScore(row.score, { finished: row.seeds_finished })),
  );
  return link;
}

export async function renderRun(root, runId, state) {
  const [run, me] = await Promise.all([getRun(runId), getMe()]);
  root.replaceChildren(signage(me));
  const revealing = revealFor(run, me, matchMedia("(prefers-reduced-motion: reduce)").matches);
  const earned = run.receipts.reduce((sum, r) => sum + r.points, 0);
  const plan = climbPlan(run.board);
  const lanes = lanesFor(run);
  const dnf = run.seeds_finished === 0;

  const page = el("main", "hall run");
  page.dataset.act = revealing ? "race" : "rest";
  page.innerHTML = `
    <p class="eyebrow">Publication</p>
    <h2 class="racetitle" id="title"></h2>
    <p class="run-byline mono-label" id="byline"></p>
    <div class="stage"><canvas id="stage"></canvas></div>
    <ul class="key run-legend" id="legend"></ul>
    <section class="run-score" id="score">
      <div class="scoreboard"><span class="mono-label">time</span><div class="flip" id="flip"></div></div>
      <div class="crt-screen" id="crt"><span class="stamp" id="stamp"></span></div>
      <p class="mono-label run-facts" id="facts"></p>
    </section>
    <section class="run-board" id="board"><div class="pegboard" id="pegboard"></div></section>
    <section class="run-receipts" id="points"></section>
    <section class="run-details">
      <h3 class="eyebrow">Seeds</h3>
      <table class="run-seeds"><tbody id="seeds"></tbody></table>
      <p class="run-links" id="links"></p>
    </section>
  `;
  root.append(page);
  const $ = (id) => page.querySelector(`#${id}`);

  $("title").textContent = run.event.title;
  const who = el("a", null, `@${run.user}`);
  who.href = playerHref(run.user);
  $("byline").append(who, ` · ${run.policy_name} · ${run.submitted_at.slice(0, 10)}`);
  if (run.withdrawn) $("byline").append(" · ", el("span", "sticker sticker-magenta", "withdrawn"));
  else if (!run.on_board) $("byline").append(" · ", el("span", "sticker", "not on the board"));

  // The score is in the DOM before any theatre: the roll is drawn over it.
  $("flip").append(...flipTiles(dnf ? "DNF" : run.score.toFixed(3)));
  const stamp = $("stamp");
  stamp.textContent = dnf ? "DNF" : `FINISHED ${run.seeds_finished}/${run.seeds_total}`;
  stamp.classList.add(dnf ? "stamp-fail" : "stamp-pass");
  stamp.hidden = revealing;
  $("facts").textContent = replayLine(run);

  // The pegboard, in its starting order when revealing: you at the bottom.
  const pegRows = new Map(plan.end.map((row) => [row.run_id, pegRow(row)]));
  const order = revealing ? plan.start : plan.end;
  for (const row of order) {
    pegRows.get(row.run_id).querySelector(".pegboard-rank").textContent = String(row.rank);
  }
  $("pegboard").append(...order.map((row) => pegRows.get(row.run_id)));

  const stickers = run.receipts.map((r) =>
    el("span", `sticker ${TONES[r.act]}`, receiptLabel(r, run.event.title)),
  );
  for (const sticker of stickers) sticker.hidden = revealing;
  $("points").append(...stickers);
  if (!stickers.length) $("points").append(el("p", "mono-label", "no points from this run"));

  for (const s of run.per_seed) {
    const tr = el("tr", s.seed === run.trace_seed ? "replayed" : null);
    tr.append(
      el("td", null, `seed ${s.seed}`),
      el("td", null, s.status),
      el("td", null, s.time_s == null ? "—" : `${s.time_s.toFixed(3)}s`),
    );
    $("seeds").append(tr);
  }
  const back = el("a", null, `Back to ${run.event.title}`);
  back.href = raceHref(run.event.id);
  $("links").append(back);
  if (run.offers_download) {
    const grab = el("a", null, "Download .onnx");
    grab.href = run.policy_url || `/api/runs/${run.run_id}/policy`;
    grab.setAttribute("download", "");
    $("links").append(grab);
  }
  if (run.env_url) {
    const env = el("a", null, "Training environment");
    env.href = run.env_url;
    env.target = "_blank";
    env.rel = "noopener noreferrer";
    $("links").append(env);
  }

  for (const box of [$("score"), $("board"), $("points")]) box.hidden = revealing;

  // The stage: this run in lane one, the three under it beside, all solid.
  const viewer = await createViewer($("stage"), { rig: run.event.rig });
  state.viewer = viewer;
  const traces = await Promise.all(lanes.map((lane) => getTrace(lane.run_id)));
  lanes.forEach((lane, i) => {
    const item = el("li");
    item.style.setProperty("--lane", LANE_CSS[i % LANE_CSS.length]);
    item.append(
      el("strong", null, `@${lane.user}`),
      ` ${formatScore(lane.score, { finished: lane.seeds_finished })}`,
    );
    $("legend").append(item);
  });
  let crossed;
  const raced = new Promise((resolve) => {
    crossed = resolve;
  });
  const line = (frameCount(traces[0]) - 1) * CTRL_DT;
  viewer.setLanes(
    lanes.map((lane, i) => ({
      runId: lane.run_id,
      trace: traces[i],
      livery: lane.livery,
      tier: i === 0 ? "leader" : "ghost",
      opacity: 1,
    })),
    run.event,
    revealing ? { loop: false, onTick: (t) => t >= line && crossed() } : {},
  );
  if (!revealing) return;

  // The reveal. The chip starts at the total BEFORE this run, since /api/me
  // already counts it; Space skips; leaving the page abandons without marking.
  loadSounds();
  const chip = root.querySelector(".profile-chip");
  const chipFlip = chip.querySelector(".flip");
  chipFlip.replaceChildren(...flipTiles(me.points - earned));
  const theatre = new AbortController();
  const lifetime = new AbortController();
  state.teardown = () => {
    lifetime.abort();
    theatre.abort("leave");
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "Space" || event.target.closest("button, a, input, select, textarea")) {
        return;
      }
      event.preventDefault();
      theatre.abort("skip");
    },
    { signal: lifetime.signal },
  );
  await reveal(
    {
      page,
      chip,
      chipFlip,
      score: $("score"),
      stamp,
      crt: $("crt"),
      flip: $("flip"),
      boardBox: $("board"),
      pegboard: $("pegboard"),
      pegRows,
      pointsBox: $("points"),
      stickers,
    },
    {
      run,
      plan,
      receipts: run.receipts,
      raced,
      startPoints: me.points - earned,
      onSeen: () => {
        markSeen(run.run_id).catch(() => {});
        if (me.unseen <= 1) chip.classList.remove("unread");
        viewer.player.loop = true;
        viewer.player.play();
      },
    },
    theatre.signal,
  );
}
