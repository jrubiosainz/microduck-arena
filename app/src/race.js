// One race: the stage, the file column beside it, the standing beneath.

import { getLeaderboard, getTrace, submitPolicy, tryPolicy } from "./api.js";
import { renderBoard, selectedRunIds, tiersByRunId } from "./board.js";
import { createDropzone } from "./dropzone.js";
import { VARIANT_SWATCH_HEX } from "./liveries.js";
import { MAX, MIN } from "./brightness.js";
import { formatEventFacts, speedChoices } from "./format.js";
import { insertProvisional } from "./standings.js";
import { menuHref } from "./router.js";
import { createViewer } from "./viewer.js";
import { wordmark } from "./wordmark.js";

export async function renderRace(root, { event, state }) {
  root.innerHTML = `
    <header class="racehead">
      <a class="back" href="${menuHref}">All races</a>
      <span id="racehead-mark"></span>
    </header>
    <h2 class="racetitle">${event.title}</h2>
    <dl class="facts" id="facts"></dl>
    <div class="racegrid">
      <div>
        <div class="stage"><canvas id="stage"></canvas></div>
        <div class="controls">
          <button id="playpause">Pause</button>
          <button id="follow" hidden>Follow the leader</button>
          <span class="hint" id="stage-hint"></span>
          <label class="bright" title="Stage brightness">
            Light
            <input type="range" id="brightness" min="${MIN}" max="${MAX}" step="0.05" />
          </label>
        </div>
        <ul class="key" id="key">
          <li class="key--trial">your test</li>
          <li class="key--leader">best published</li>
          <li class="key--ghost">the rest</li>
        </ul>
      </div>
      <aside class="entry">
        <div id="dropzone"></div>
        <label class="entry__name">Name
          <input type="text" id="policy-name" placeholder="optional" />
        </label>
        <fieldset class="livery">
          <legend>Colour</legend>
          <div class="livery__swatches" id="liveries"></div>
        </fieldset>
        <label class="entry__speed">Test speed
          <select id="speed"></select>
          <span class="entry__hint">Publishing always sweeps.</span>
        </label>
        <div class="entry__actions">
          <button id="try" class="ghost">Test it</button>
          <button id="publish">Publish</button>
        </div>
        <p class="entry__consent">
          Publishing shares your <code>.onnx</code> so anyone can download it
          and race it. Testing shares nothing.
        </p>
        <p class="entry__status" id="entry-status"></p>
      </aside>
    </div>
    <div id="board"></div>
  `;
  document.querySelector("#racehead-mark").replaceWith(wordmark({ compact: true }));

  const facts = root.querySelector("#facts");
  for (const fact of formatEventFacts(event)) {
    const pair = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = fact.label;
    const dd = document.createElement("dd");
    dd.textContent = fact.value;
    pair.append(dt, dd);
    facts.append(pair);
  }

  const board = root.querySelector("#board");
  const status = root.querySelector("#entry-status");
  const tryButton = root.querySelector("#try");
  const publishButton = root.querySelector("#publish");
  const nameInput = root.querySelector("#policy-name");
  // The four colourways the real robot comes in. Picking one shows it on your
  // duck straight away, before you have raced anything.
  let livery = "classic";
  const swatches = root.querySelector("#liveries");
  for (const [name, hex] of Object.entries(VARIANT_SWATCH_HEX)) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.dataset.livery = name;
    swatch.style.setProperty("--swatch", hex);
    swatch.title = name;
    swatch.setAttribute("aria-label", name);
    swatch.setAttribute("aria-pressed", String(name === livery));
    swatch.addEventListener("click", () => {
      livery = name;
      for (const other of swatches.children) {
        other.setAttribute("aria-pressed", String(other.dataset.livery === livery));
      }
      // Repaint whatever is on the stage now, so the choice is visible at once.
      race(selectedRunIds(board), lastTiers);
    });
    swatches.append(swatch);
  }

  // The trial speed picker, built from the event's own sweep. Default is the
  // sweep itself: the trial should measure the same thing the board does unless
  // you deliberately ask for one speed.
  const speed = root.querySelector("#speed");
  for (const choice of speedChoices(event)) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    speed.append(option);
  }

  const dropzone = createDropzone(root.querySelector("#dropzone"), {
    onFile: () => {
      status.textContent = "";
      status.className = "entry__status";
    },
  });

  const viewer = await createViewer(root.querySelector("#stage"), {
    // The event declares its rig, and the roller rig is a different kinematic
    // tree with its own blades, rims and tires — not a repaint of the walker.
    rig: event.rig,
    onChaseChange: (chasing) => {
      root.querySelector("#follow").hidden = chasing;
    },
  });
  state.viewer = viewer;

  const brightness = root.querySelector("#brightness");
  brightness.value = String(viewer.brightness);
  brightness.addEventListener("input", () => viewer.setBrightness(brightness.value));

  root.querySelector("#follow").addEventListener("click", () => viewer.follow());
  root.querySelector("#playpause").addEventListener("click", () => {
    viewer.player.toggle();
    root.querySelector("#playpause").textContent = viewer.player.playing
      ? "Pause"
      : "Play";
  });

  let trial = null; // the unpublished run, if one has been tested
  let lastTiers = new Map();
  const traces = new Map();
  const liveries = new Map(); // run id -> the colourway it raced in

  async function traceFor(runId) {
    if (!traces.has(runId)) traces.set(runId, await getTrace(runId));
    return traces.get(runId);
  }

  async function race(runIds, tiers = new Map()) {
    lastTiers = tiers;
    const published = await Promise.all(runIds.map(traceFor));
    const lanes = runIds.map((runId, i) => ({
      runId,
      trace: published[i],
      tier: tiers.get(runId) ?? "ghost",
      // A published run keeps the colourway it raced in.
      livery: liveries.get(runId) ?? "classic",
    }));
    // The trial wears whatever is selected right now, so changing the swatch
    // repaints it immediately.
    if (trial) lanes.unshift({ runId: null, trace: trial.trace, tier: "trial", livery });
    viewer.setLanes(lanes, event);
    root.querySelector("#playpause").textContent = "Pause";
    root.querySelector("#stage-hint").textContent = lanes.length
      ? ""
      : "Tick a lane below, or test a policy, to watch a replay.";
  }

  async function paint() {
    const { rows } = await getLeaderboard(event.id);
    for (const row of rows) liveries.set(row.run_id, row.livery ?? "classic");
    const merged = insertProvisional(rows, trial);
    const tiers = tiersByRunId(merged);
    renderBoard(
      board,
      { event, rows: merged },
      { onSelectionChange: (runIds) => race(runIds, tiers) },
    );
    await race(selectedRunIds(board), tiers);
  }

  async function run(kind) {
    const file = dropzone.file;
    if (!file) {
      status.textContent = "Choose a .onnx policy first.";
      status.className = "entry__status bad";
      return;
    }
    tryButton.disabled = true;
    publishButton.disabled = true;
    status.className = "entry__status";
    // The wait is dominated by the sweep, not the seed count, so say what is
    // actually taking the time.
    // Say what is actually taking the time: a sweep is dominated by the number
    // of speeds, a pinned trial by the seeds.
    const pinned = kind === "try" ? speed.value : "";
    status.textContent = pinned
      ? `Racing ${event.seeds} seeds at ${pinned} m/s…`
      : `Sweeping ${event.sweep_count} speeds × ${event.seeds} seeds…`;
    try {
      if (kind === "try") {
        trial = await tryPolicy(event.id, file, nameInput.value, livery, pinned);
        status.textContent = "Tested. Nothing published yet.";
      } else {
        const published = await submitPolicy(event.id, file, nameInput.value, livery);
        trial = null;
        status.textContent = `Published as ${published.policy_name}.`;
      }
      await paint();
    } catch (error) {
      // The server's own wording — the sentence the robot's daemon would give.
      status.textContent = error.message;
      status.className = "entry__status bad";
    } finally {
      tryButton.disabled = false;
      publishButton.disabled = false;
    }
  }

  tryButton.addEventListener("click", () => run("try"));
  publishButton.addEventListener("click", () => run("publish"));

  await paint();
}
