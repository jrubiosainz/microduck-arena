// The workshop page: four zones over one challenge, fed by /api/workshop/*.

import * as api from "./api.js";
import { renderCurve } from "./curve.js";
import { renderPreflight } from "./preflight.js";
import { appendLog, renderTrainForm, renderTraining } from "./train.js";

const $ = (selector) => document.querySelector(selector);
const page = { status: null, since: 0, runs: [], selection: null, viewer: null, deck: null };
const FOLLOW_EVERY_MS = 3000;

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
}

async function onLaunch(body) {
  await api.launch(body);
  page.since = 0;
  $("#train-log").textContent = "";
  await follow();
}

async function follow() {
  const training = await api.getTraining(page.since);
  if (training.state === null) return;
  page.since = training.next;
  renderTraining($("#training"), training, {
    onStop: async () => { await api.stopTraining(); },
    onPull: async () => { await api.pullCheckpoints(); },
  });
  appendLog($("#train-log"), training.log);
  await refreshRuns();
  const run = page.runs.find((r) => r.name === training.name);
  renderCurve($("#curve"), run ? await api.getCurve(run.id) : []);
  if (training.state === "running") setTimeout(follow, FOLLOW_EVERY_MS);
}

async function start() {
  try {
    await refreshStatus();
    await refreshRuns();
    await follow(); // a training launched before a reload is picked up again
  } catch (error) {
    $("main").insertAdjacentHTML("afterbegin", '<p class="failed"></p>');
    $(".failed").textContent = `The workshop's server did not answer: ${error.message}`;
  }
}

start();
