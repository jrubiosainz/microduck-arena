// One publication: the replay of the run against the ducks ranked just under
// it, the time it set, where it stands on the event's board, what it earned.
//
// Two modes. Plain shows all of it at once and loops the replay. Reveal — the
// author's first look — hides the result and plays it in beats (reveal.js).

import { getClip, getMe, getRun, getTrace, markSeen } from "./api.js";
import { flipTiles } from "./animation.js";
import { LANE_COLORS, LANE_CSS } from "./course.js";
import { formatScore, formatSpeed } from "./format.js";
import { lanesFor } from "./lanes.js";
import { CTRL_DT, frameCount } from "./replay.js";
import { climbPlan, reveal, revealFor, setRanks } from "./reveal.js";
import { playerHref, raceHref, runHref } from "./router.js";
import { shareStrip, wireShare } from "./share.js";
import { footer, signage } from "./signage.js";
import { load as loadSounds } from "./sound.js";
import { createViewer } from "./viewer.js";

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

/** Which seed the stored replay is, and why that one. */
function replayLine(run) {
  const finishers = run.per_seed.filter((s) => s.status === "finish").length;
  const which =
    finishers > 1 ? "median finisher" : finishers === 1 ? "the one finisher" : "first seed";
  return `${formatSpeed(run.command_vx, { finished: run.seeds_finished })} m/s · replay: seed ${run.trace_seed}, ${which}`;
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

function pegRow(row) {
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
  // Which beat the page is in. Read by nothing yet: it is the hook a screenshot
  // or a test waits on, as in Duck Jam.
  page.dataset.act = revealing ? "race" : "rest";
  // Four rows, and only the stage gives: the page is exactly one window tall,
  // so everything the reveal animates is on screen at once. race.css does the
  // arithmetic; this is the order.
  page.innerHTML = `
    <header class="run-head">
      <p class="eyebrow">Publication</p>
      <h2 class="racetitle"><a id="title"></a></h2>
      <p class="run-byline mono-label" id="byline"></p>
    </header>
    <div class="run-top">
      <div class="stage"><canvas id="stage"></canvas></div>
      <section class="run-score">
        <div class="scoreboard" id="scoreboard">
          <span class="mono-label">time</span>
          <div class="flip" id="flip"></div>
          <span class="stamp" id="stamp"></span>
        </div>
        <section class="run-receipts" id="points"></section>
      </section>
      <div class="run-caption">
        <ul class="key run-legend" id="legend"></ul>
        <p class="mono-label run-facts" id="facts"></p>
      </div>
    </div>
    <section class="run-board" id="board"><div class="pegboard" id="pegboard"></div></section>
    <details class="run-seedlist" id="seedlist">
      <summary class="eyebrow">Seeds</summary>
      <ol id="seeds"></ol>
    </details>
  `;
  root.append(page, footer());
  const $ = (id) => page.querySelector(`#${id}`);

  // The title is the way back to the event, which is why the page carries no
  // back link of its own.
  $("title").textContent = run.event.title;
  $("title").href = raceHref(run.event.id);
  const who = el("a", null, `@${run.user}`);
  who.href = playerHref(run.user);
  $("byline").append(who, ` · ${run.policy_name} · ${run.submitted_at.slice(0, 10)}`);
  if (run.withdrawn) $("byline").append(" · ", el("span", "sticker sticker-magenta", "withdrawn"));
  else if (!run.on_board) $("byline").append(" · ", el("span", "sticker", "not on the board"));
  // What you can take away sits with who made it: one line, no section of its own.
  if (run.offers_download) {
    const grab = el("a", null, "Download .onnx");
    grab.href = run.policy_url || `/api/runs/${run.run_id}/policy`;
    grab.setAttribute("download", "");
    $("byline").append(" · ", grab);
  }
  if (run.env_url) {
    const env = el("a", null, "Training environment");
    env.href = run.env_url;
    env.target = "_blank";
    env.rel = "noopener noreferrer";
    $("byline").append(" · ", env);
  }

  // `rollCounter` rolls each tile to the digit it already shows, so the number
  // is in the DOM before any theatre. A reveal starts on a constant 00.000
  // instead: a DNF's three tiles beside a time's six would give the verdict
  // away before the stamp, and the time beat swaps the real number in. The
  // tile count changes with it, but a width in this column costs no height.
  const score = dnf ? "DNF" : run.score.toFixed(3);
  $("flip").append(...flipTiles(revealing ? "00.000" : score));
  const stamp = $("stamp");
  stamp.textContent = dnf ? "DNF" : `FINISHED ${run.seeds_finished}/${run.seeds_total}`;
  stamp.classList.add(dnf ? "stamp-fail" : "stamp-pass");
  stamp.classList.toggle("veiled", revealing);
  // "median finisher" says the run finished, so the caption waits for the stamp.
  // Veiled, not hidden: on a page of fixed height a box that leaves the flow
  // hands its height to the stage, and the picture jumps mid-beat.
  $("facts").textContent = replayLine(run);
  $("facts").classList.toggle("veiled", revealing);

  // The pegboard, in its starting order when revealing: you at the bottom.
  const pegRows = new Map(plan.end.map((row) => [row.run_id, pegRow(row)]));
  const order = revealing ? plan.start : plan.end;
  setRanks(pegRows, order);
  $("pegboard").append(...order.map((row) => pegRows.get(row.run_id)));
  // The board stands there from the first frame, you at the bottom — but your
  // own time only goes up on it once the split-flap has rolled it.
  const yourScore = pegRows.get(run.run_id).querySelector(".pegboard-score");
  yourScore.classList.toggle("veiled", revealing);

  const stickers = run.receipts.map((r) =>
    el("span", `sticker ${TONES[r.act]}`, receiptLabel(r, run.event.title)),
  );
  for (const sticker of stickers) sticker.classList.toggle("veiled", revealing);
  $("points").append(...stickers);
  if (!stickers.length) $("points").append(el("p", "mono-label", "no points from this run"));

  // Sharing, under the points: the networks on one row, the clips on the
  // next, standing there from the first frame and veiled through a reveal like
  // everything else in this column; the clip stickers follow the render while
  // it is owed.
  const strip = shareStrip(run, { origin: location.origin });
  strip.root.classList.toggle("veiled", revealing);
  $("points").after(strip.root);
  wireShare(strip, run, { origin: location.origin });
  // Queued is the honest first state: nobody has answered for the clip yet, so
  // the row wears the face of a render nobody has started — present, disabled
  // and turning — not a live-looking link that goes stale a beat later.
  strip.setClip({ state: "queued", ahead: null });
  const leaving = new AbortController();
  let timer = null;
  async function followClip() {
    const clip = await getClip(run.run_id).catch(() => null);
    if (leaving.signal.aborted) return;
    if (clip) strip.setClip(clip);
    // A render moves frame by frame and is worth watching closely; a queue only
    // moves when something ahead of it finishes, which is minutes away. Ready,
    // failed and none are final — nothing to come back for.
    const again = clip ? { rendering: 2000, queued: 5000 }[clip.state] : 5000;
    if (again) timer = setTimeout(followClip, again);
  }
  followClip();

  // One line per seed: the time, or how it ended. Folded away by default —
  // it is a detail you go and look up, not a step of the show.
  for (const s of run.per_seed) {
    const row = el("li", s.seed === run.trace_seed ? "seed replayed" : "seed");
    row.append(
      el("span", "mono-label", `seed ${s.seed}`),
      el("strong", null, s.time_s == null ? s.status : `${s.time_s.toFixed(3)}s`),
    );
    $("seeds").append(row);
  }

  // The reveal's lifetime opens before the loads it must survive leaving
  // during: a first visit's GLB fetch and the trace downloads are both slow
  // enough that navigating away mid-load must not fall through to the
  // theatre and spend the one-shot reveal on a page nobody watched.
  let theatre, lifetime;
  if (revealing) {
    theatre = new AbortController();
    lifetime = new AbortController();
  }
  state.teardown = () => {
    leaving.abort();
    clearTimeout(timer);
    lifetime?.abort();
    theatre?.abort("leave");
  };

  // The stage: this run in lane one, the three under it beside, all solid.
  const viewer = await createViewer($("stage"), { rig: run.event.rig });
  if (revealing && theatre.signal.aborted) {
    viewer.dispose();
    return;
  }
  state.viewer = viewer;
  const traces = await Promise.all(lanes.map((lane) => getTrace(lane.run_id)));
  if (revealing && theatre.signal.aborted) {
    viewer.dispose();
    return;
  }
  // Who wears which stripe. The times are on the board below, not here.
  lanes.forEach((lane, i) => {
    const item = el("li");
    item.style.setProperty("--lane", LANE_CSS[i % LANE_CSS.length]);
    item.append(el("strong", null, `@${lane.user}`));
    $("legend").append(item);
  });
  let crossed;
  const raced = revealing
    ? new Promise((resolve) => {
        crossed = resolve;
      })
    : null;
  viewer.setLanes(
    lanes.map((lane, i) => ({
      runId: lane.run_id,
      trace: traces[i],
      livery: lane.livery,
      // The ring under each duck takes the lane's own colour, the one the key
      // above and the ground stripe already wear. A tier colour here would say
      // leader-and-ghosts, which is not what this stage shows: four real runs.
      colour: LANE_COLORS[i % LANE_COLORS.length],
      opacity: 1,
    })),
    run.event,
    revealing
      ? { loop: false, onTick: (t) => t >= (frameCount(traces[0]) - 1) * CTRL_DT && crossed() }
      : {},
  );
  if (!revealing) {
    // No theatre — but the author has still seen their result.
    if (me?.user === run.user && !run.seen) {
      markSeen(run.run_id).catch(() => {});
      if (me.unseen <= 1) root.querySelector(".profile-chip")?.classList.remove("unread");
    }
    return;
  }
  // The chip stays on screen so the stickers have somewhere to fly to.
  root.querySelector(".signage").classList.add("signage--pinned");
  const startPoints = me.points - earned;
  // Leaving mid-race must not park `reveal()` on `await raced` forever.
  theatre.signal.addEventListener("abort", () => crossed(), { once: true });

  // The reveal. The chip starts at the total BEFORE this run, since /api/me
  // already counts it; Space skips; leaving the page abandons without marking.
  loadSounds();
  const chip = root.querySelector(".profile-chip");
  const chipFlip = chip.querySelector(".flip");
  chipFlip.replaceChildren(...flipTiles(startPoints));
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
      facts: $("facts"),
      scoreboard: $("scoreboard"),
      stamp,
      flip: $("flip"),
      yourScore,
      pegboard: $("pegboard"),
      pegRows,
      stickers,
      share: strip.root,
    },
    {
      run,
      plan,
      receipts: run.receipts,
      raced,
      startPoints,
      score,
      onSeen: () => {
        markSeen(run.run_id).catch(() => {});
        if (me.unseen <= 1) chip.classList.remove("unread");
        viewer.player.loop = true;
        viewer.player.play();
      },
    },
    theatre.signal,
  );
  // The theatre is over: Space should scroll the page again, not skip it.
  lifetime.abort();
}
