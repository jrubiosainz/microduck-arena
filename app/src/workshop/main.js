// The workshop page: four zones over one challenge, fed by /api/workshop/*.

import { MIN } from "../brightness.js";
import { deckMarkup, wireDeck } from "../deck.js";
import { createViewer } from "../viewer.js";
import * as api from "./api.js";
import { renderCurve } from "./curve.js";
import { renderPreflight } from "./preflight.js";
import { renderCode, renderPublish } from "./publish.js";
import { appendLog, renderTrainForm, renderTraining } from "./train.js";
import { renderResult, renderRuns } from "./trial.js";

const $ = (selector) => document.querySelector(selector);
const page = { status: null, since: 0, runs: [], selection: null, viewer: null, deck: null };
const FOLLOW_EVERY_MS = 3000;
// The last training state a poll actually saw, so a poll that throws (a
// dropped connection, a bad response) still knows whether to reschedule
// itself rather than freezing the log and buttons silently.
let lastTrainingState = null;

function setFollowStatus(message) {
  const status = $("#follow-status");
  if (status) status.textContent = message;
}

async function refreshStatus() {
  page.status = await api.getStatus();
  const { event, arena } = page.status;
  document.title = `${event.title} · Microduck workshop`;
  $("#title").textContent = event.title;
  $("#arena-link").href = `${arena}/#/e/${event.id}`;
  renderPreflight($("#preflight"), page.status, {
    onLogin: async (token) => {
      await api.login(token);
      await refreshStatus();
    },
  });
  renderTrainForm($("#train-form"), page.status, { onLaunch });
}

async function refreshRuns() {
  page.runs = await api.getRuns();
  // A selection keeps pointing at the same run object as the list refreshes.
  if (page.selection) {
    const run = page.runs.find((r) => r.id === page.selection.run.id);
    page.selection = run ? { run, checkpoint: page.selection.checkpoint } : null;
  }
  renderRuns($("#runs"), page.runs, page.selection, { onSelect, onTest });
}

function onSelect(selection) {
  page.selection = selection;
  renderRuns($("#runs"), page.runs, page.selection, { onSelect, onTest });
  renderPublishForm();
}

async function onTest() {
  const { run, checkpoint } = page.selection;
  const note = $("#trial-status");
  note.textContent = `Exporting checkpoint ${checkpoint} and racing it (a minute or so)…`;
  try {
    const result = await api.testCheckpoint(run.id, checkpoint);
    note.textContent = "";
    renderResult($("#result"), result);
    await replay(result);
    await refreshRuns();
    renderPublishForm();
  } catch (error) {
    note.textContent = error.message;
  }
}

async function replay(result) {
  if (!page.viewer) {
    $("#replay").innerHTML = deckMarkup;
    page.viewer = await createViewer($("#stage"), { rig: page.status.event.rig });
    page.viewer.setBrightness(MIN);
    page.deck = wireDeck($("#replay"), page.viewer);
  }
  page.viewer.setLanes(
    [{ runId: null, trace: result.trace, tier: "trial", livery: "classic", name: `checkpoint ${result.checkpoint}` }],
    page.status.event,
  );
  page.deck.reset();
}

async function refreshCode() {
  const code = await api.getCode();
  renderCode($("#code"), code, {
    onFork: async (url) => { await api.forkCode(url); await refreshCode(); },
    onPush: async () => { await api.pushCode(); await refreshCode(); },
  });
}

function renderPublishForm() {
  renderPublish($("#publish-form"), page.selection, page.status, {
    onPreview: (values) => api.publishRun({ ...values, dry_run: true }),
    onPublish: (values) => api.publishRun(values),
  });
}

async function onLaunch(body) {
  await api.launch(body);
  page.since = 0;
  $("#train-log").textContent = "";
  await follow();
}

/**
 * One poll. Any failure here — the network, a bad response, a rendering bug
 * on an unusually large curve — is caught rather than left to escape: an
 * uncaught throw would skip the reschedule below and stop the polling for
 * good, with the log frozen and Stop/Pull stuck on a run that is still
 * going. `lastTrainingState` remembers what the last successful poll saw, so
 * a poll that fails mid-way still reschedules itself while training was
 * last known to be running.
 */
async function follow() {
  try {
    const training = await api.getTraining(page.since);
    lastTrainingState = training.state;
    if (training.state === null) return;
    page.since = training.next;
    renderTraining($("#training"), training, {
      onStop: async () => { await api.stopTraining(); },
      onPull: async () => { await api.pullCheckpoints(); },
    });
    appendLog($("#train-log"), training.log);
    setFollowStatus("");
    await refreshRuns();
    const run = page.runs.find((r) => r.name === training.name);
    renderCurve($("#curve"), run ? await api.getCurve(run.id) : []);
  } catch (error) {
    setFollowStatus(`Lost touch with the training: ${error.message}`);
  } finally {
    if (lastTrainingState === "running") setTimeout(follow, FOLLOW_EVERY_MS);
  }
}

async function start() {
  try {
    await refreshStatus();
    await refreshRuns();
    await refreshCode();
    renderPublishForm();
    await follow(); // a training launched before a reload is picked up again
  } catch (error) {
    $("main").insertAdjacentHTML("afterbegin", '<p class="failed"></p>');
    $(".failed").textContent = `The workshop's server did not answer: ${error.message}`;
  }
}

start();
