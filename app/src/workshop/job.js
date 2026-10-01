// One training: its replay, a bar per checkpoint to choose the one replayed, its curve and its output,
// the chosen checkpoint's score and Publish & compete. Asked again every few seconds (the bars fill in
// as checkpoints are saved and evaluated), and only what changed is redrawn: what is typed and chosen,
// the focus and an open Output stay, and no button is rebuilt under the pointer.

import { MIN } from "../brightness.js";
import { deckMarkup, followKeyFor, wireDeck } from "../deck.js";
import { isStage } from "../format.js";
import { eventGuideHref } from "../router.js";
import { footer } from "../signage.js";
import { createViewer } from "../viewer.js";
import * as api from "./api.js";
import { renderCurve } from "./curve.js";
import { el } from "./dom.js";
import { accountChip, strip } from "./header.js";
import { performancePanel } from "./performance.js";
import { publishPanel } from "./publish.js";
import { challengeHref, homeHref } from "./routes.js";
import { bars, confirmStop, progress, seconds } from "./tickets.js";

export const POLL_MS = 3000;
const PLACE = { "hf-jobs": "Hugging Face Jobs · L4", local: "This machine" };
const STATE = { starting: "Starting", running: "Training", done: "Done", stopped: "Stopped", failed: "Failed" };

/** The checkpoints a running training will still save, from the spacing of those it saved. */
export function futureSlots(job) {
  const ns = job.checkpoints.map((c) => c.n);
  const total = job.progress?.total;
  if (!["starting", "running"].includes(job.state) || !total || ns.length < 2) return [];
  const step = ns[1] - ns[0];
  const slots = [];
  for (let n = ns.at(-1) + step; n < total - 1; n += step) slots.push(n);
  if (ns.at(-1) < total - 1) slots.push(total - 1);
  return slots;
}

function facts(job) {
  const pairs = [];
  if (job.started) pairs.push(["started", new Date(job.started).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })]);
  if (job.commit) pairs.push(["code", job.commit.slice(0, 7)]);
  if (job.recipe) pairs.push(["robots", String(job.recipe.num_envs)]);
  const rewards = Object.entries(job.params ?? {}).filter(([name]) => name.endsWith("_reward"));
  if (rewards.length) pairs.push(["rewards", rewards.map(([name, value]) => `${name.replace(/_reward$/, "")} ${value}`).join(" · ")]);
  const list = el("dl", "facts");
  for (const [label, value] of pairs) {
    const pair = el("div");
    pair.append(el("dt", "", label), el("dd", "", value));
    list.append(pair);
  }
  return list;
}

export async function mountJob(root, { status, account, route }) {
  const slot = el("span");
  const drawAccount = () => slot.replaceChildren(accountChip(account.get(), { onLogIn: account.logIn, onRetry: account.check }));
  const hall = el("main", "hall");
  root.replaceChildren(strip(slot), hall, footer());
  drawAccount();
  const challenge = status.challenges.find((c) => c.event.id === route.event);
  const back = el("a", "raceback", challenge ? `Back to ${challenge.event.title}` : "Back to the challenges");
  back.href = challenge ? challengeHref(route.event) : homeHref;
  hall.append(back);
  const nothing = (why) => {
    hall.append(el("p", "failed", why));
    return { leave() {}, accountChanged: drawAccount };
  };
  if (!challenge) return nothing(`${route.event} is not a challenge open here.`);
  let job;
  try {
    job = await api.getJob(route.event, route.job);
  } catch (error) {
    return nothing(error.message);
  }
  const { event } = challenge;
  const voted = event.metric === "votes";
  const stage = isStage(event);
  let code = await api.getCode();
  let since = job.next;
  let selected = voted ? null : job.best; // the checkpoint chosen: scored, published
  let playing = null; // the checkpoint on the stage
  let unplayable = ""; // why the checkpoint picked last cannot play
  const evaluations = new Map(); // checkpoint -> its stored evaluation, once asked
  let left = false;

  const grid = el("div", "racegrid jobgrid");
  grid.innerHTML = `
    <div>
      <p class="raceeyebrow"></p>
      <h2 class="racetitle"></h2>
      <div class="job-facts"></div>
      <div class="job-progress"></div>
      ${deckMarkup}
      <div class="ckpts">
        <div class="section-label"><p class="eyebrow">Checkpoints</p><span class="hint"></span></div>
        <div class="ckpts__bars"></div>
        <div class="ticks"></div>
      </div>
      <div class="section-label"><p class="eyebrow">Training</p><span class="hint">Mean reward per iteration</span></div>
      <figure class="curve"></figure>
      <details class="output"><summary>Output</summary><div class="output__body"></div></details>
      <p class="note job-note"></p>
    </div>
    <div class="entry-col">
      <div class="figure score"><span class="mono-label score__label"></span><span class="figure-value score__value"></span>
        <span class="mono-label score__seeds"></span><p class="score__caveat"></p></div>
      <button class="quiet job-stop" type="button" hidden>Stop this training</button>
    </div>`;
  hall.append(grid);
  const $ = (selector) => grid.querySelector(selector);
  $(".racetitle").textContent = job.name;
  $(".ckpts .hint").textContent = stage ? "Click one to watch it perform."
    : voted ? "Click one to watch it." : "The higher, the faster. Click one to watch it.";
  $(".score__caveat").textContent = stage
    ? "Indicative: the Arena plays your entry again, on its own computer."
    : "Indicative: only the Arena times an entry.";
  const log = el("pre", "terminal-body");
  // Opened, the output shows its latest lines.
  $(".output").addEventListener("toggle", () => {
    log.scrollTop = log.scrollHeight;
  });

  // A write (a push, a fork, a stop) is followed by a fresh look, which also drops any poll still out.
  const panel = publishPanel({ event, folder: challenge.folder }, {
    onPublish: (values) => api.publishJob(event.id, job.id, values),
    onPreview: (values) => api.publishJob(event.id, job.id, { ...values, dry_run: true }),
    onPush: async () => {
      await api.pushCode();
      await refresh();
    },
    onUseFork: async (url) => {
      await api.useFork(url);
      await refresh();
    },
  });
  $(".score").after(panel.el);
  if (stage) {
    $(".ckpts").after(performancePanel({ guide: `${status.arena}/${eventGuideHref(event.id)}` }, {
      load: () => api.getTimeline(event.id),
      save: (text) => api.saveTimeline(event.id, text),
      // The new moves on the stage at once: the checkpoint chosen is played again with them.
      onSaved: () => {
        evaluations.clear();
        if (selected !== null) pick(selected);
      },
    }));
  }

  // Each part of the page is redrawn only when what it shows changed.
  const painted = new Map(); // node -> what it was last drawn from
  function paint(node, from, build) {
    const key = JSON.stringify(from);
    if (painted.get(node) === key) return;
    painted.set(node, key);
    build(node);
  }

  function appendLog(lines) {
    if (!lines.length) return;
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.append(`${lines.join("\n")}\n`);
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  function drawOutput(body) {
    if (job.following) {
      const terminal = el("div", "terminal");
      terminal.append(log);
      body.replaceChildren(terminal);
      return;
    }
    const note = el("p", "hint");
    if (job.job_url) {
      const link = el("a", "", "See its whole log on Hugging Face ↗");
      Object.assign(link, { href: job.job_url, target: "_blank", rel: "noopener" });
      note.append("This workshop does not follow this job now. ", link);
    } else {
      note.textContent = "No output here: this workshop did not start this training, or was closed since.";
    }
    body.replaceChildren(note);
  }

  function drawCheckpoints() {
    const future = futureSlots(job);
    const best = voted ? null : job.best;
    const slots = [...job.checkpoints.map((c) => c.n), ...future];
    paint($(".ckpts__bars"), [job.checkpoints, best, future], (node) => node.replaceChildren(bars(job.checkpoints, best, { future, onPick: pick })));
    paint($(".ticks"), slots, (node) => node.replaceChildren(...slots.map((n) => el("span", "", String(n)))));
    // The choice is marked on the bars as drawn: a bar just picked keeps its focus.
    const [row, ticks] = [$(".ckpts__bars .bars").children, $(".ticks").children];
    slots.forEach((n, i) => {
      row[i].classList.toggle("sel", n === selected);
      ticks[i].classList.toggle("sel", n === selected);
    });
    $(".ckpts").hidden = !job.checkpoints.length;
  }

  function drawScore() {
    const [label, value, seeds] = [$(".score__label"), $(".score__value"), $(".score__seeds")];
    if (selected === null) {
      label.textContent = "No checkpoint chosen";
      value.textContent = "—";
      seeds.textContent = "Pick one in the checkpoints.";
      return;
    }
    const row = job.checkpoints.find((c) => c.n === selected);
    label.textContent = `Checkpoint ${selected}${!voted && selected === job.best ? " · ★ best" : ""}`;
    // A performance just fetched (Save and play) counts as evaluated even while the row still says queued.
    const done = stage ? evaluations.get(selected)?.stage ?? row?.stage : null;
    if (stage && done) {
      const at = (s) => `${s.toFixed(2)} s`;
      value.textContent = done.fell_at == null ? "No fall" : `Fell at ${at(done.fell_at)}`;
      seeds.textContent = `seated ${at(done.seated_s)} · standing ${at(done.standing_s)}`;
    } else if (!row || row.status === "queued") {
      value.textContent = "…";
      seeds.textContent = "Not evaluated yet.";
    } else if (row.status === "failed") {
      value.textContent = "Failed";
      seeds.textContent = "It could not be evaluated.";
    } else {
      value.textContent = row.seeds_finished ? seconds(row.score) : "No finish";
      seeds.textContent = `${row.seeds_finished}/${row.seeds_total} seeds${row.seeds_finished ? ` · at ${row.command_vx.toFixed(2)} m/s` : ""}`;
    }
  }

  function drawHint() {
    grid.querySelector("#stage-hint").textContent = unplayable || (playing !== null
      ? (stage ? `Checkpoint ${playing}` : `Checkpoint ${playing} · its best seed`)
      : job.checkpoints.length ? "Pick a checkpoint below to watch it." : "No checkpoint yet.");
  }

  function draw() {
    const running = job.state === "starting" || job.state === "running";
    $(".raceeyebrow").textContent = `${STATE[job.state]} · ${PLACE[job.where] ?? "From a shell"}`;
    paint($(".job-facts"), [job.started, job.commit, job.recipe, job.params], (node) => node.replaceChildren(facts(job)));
    paint($(".job-progress"), running && job.progress, (node) => node.replaceChildren(...(running && job.progress ? [progress(job.progress)] : [])));
    drawCheckpoints();
    // A curve only grows: its length and its last point say whether it changed.
    paint($(".curve"), [job.curve.length, job.curve.at(-1)], (node) => renderCurve(node, job.curve));
    paint($(".output__body"), [job.following, job.job_url], drawOutput);
    drawScore();
    drawHint();
    $(".job-stop").hidden = !running;
    panel.update({ job, code, account: account.get(), selected });
  }

  // The stadium, made once, a replay waiting for it; until one plays, it is empty.
  let viewer = null;
  let deck = null;
  const stadium = createViewer(grid.querySelector("#stage"), { rig: event.rig, onChaseChange: followKeyFor(grid) }).then((made) => {
    if (left) {
      made.dispose();
      return null;
    }
    viewer = made;
    viewer.setBrightness(MIN); // as the Arena's race page
    deck = wireDeck(grid, viewer);
    viewer.setLanes([], event);
    return viewer;
  });

  async function play(body) {
    if (!(await stadium) || left || selected !== body.checkpoint) return;
    viewer.setLanes([{ trace: body.trace, tier: "trial", livery: "classic", name: `checkpoint ${body.checkpoint}` }], event);
    deck.reset();
    playing = body.checkpoint;
    drawHint();
  }

  async function pick(n) {
    selected = n;
    unplayable = "";
    draw();
    let body = evaluations.get(n);
    if (!body) {
      try {
        body = await api.getCheckpoint(event.id, job.id, n);
      } catch (error) {
        if (selected === n) { // a checkpoint picked since owns the stage's hint
          unplayable = error.message;
          drawHint();
        }
        return;
      }
      if (body.error) return;
      evaluations.set(n, body);
      drawScore(); // the ticket row may still say queued; the fetch just answered for it
    }
    await play(body);
  }

  // Polls never overlap: the next is set once the latest answer is in. An answer older than the
  // latest question, or one landing after the page was left, draws nothing.
  let asked = 0;
  let timer = null;
  const latest = (mine) => mine === asked && !left;
  async function refresh() {
    const mine = ++asked;
    clearTimeout(timer);
    try {
      const [next, now] = await Promise.all([api.getJob(event.id, job.id, since), api.getCode()]);
      if (!latest(mine)) return;
      appendLog(next.log);
      since = next.next;
      const bestAppeared = !voted && selected === null && next.best !== null;
      job = next;
      code = now;
      $(".job-note").textContent = "";
      draw();
      if (bestAppeared) pick(job.best);
    } catch (error) {
      if (latest(mine)) $(".job-note").textContent = `Lost touch with the workshop: ${error.message}`;
    } finally {
      if (latest(mine)) timer = setTimeout(refresh, POLL_MS);
    }
  }

  // Confirmed, and once pressed it waits for its answer: a second press asks nothing.
  const stop = $(".job-stop");
  stop.addEventListener("click", async () => {
    if (!confirmStop(job)) return;
    stop.disabled = true;
    try {
      await api.stopJob(event.id, job.id);
    } catch (error) {
      window.alert(error.message);
    }
    await refresh();
    stop.disabled = false;
  });

  appendLog(job.log);
  draw();
  if (selected !== null) pick(selected);
  timer = setTimeout(refresh, POLL_MS);

  return {
    leave() {
      left = true;
      clearTimeout(timer);
      viewer?.dispose();
    },
    accountChanged() {
      drawAccount();
      draw();
    },
  };
}
