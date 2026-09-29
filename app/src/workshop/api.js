// Every call the workshop page makes. Errors carry the server's own sentence —
// for a failed command, its whole output.

import { detailFrom } from "../api.js";

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

const post = (url, body = {}) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const runUrl = (id) => `/api/workshop/runs/${encodeURIComponent(id)}`;
const jobUrl = (name) => `/api/workshop/jobs/${encodeURIComponent(name)}`;

export const getStatus = () => json("/api/workshop/status");
export const getHub = () => json("/api/workshop/hub");
export const login = (token) => post("/api/workshop/login", { token });
export const launch = (body) => post("/api/workshop/train", body);
export const getTraining = (since) => json(`/api/workshop/train?since=${since}`);
export const stopTraining = () => post("/api/workshop/train/stop");
export const pullCheckpoints = () => post("/api/workshop/train/pull");
export const getJobs = () => json("/api/workshop/jobs").then((body) => body.jobs);
export const pullJob = (name) => post(`${jobUrl(name)}/pull`);
export const stopJob = (name) => post(`${jobUrl(name)}/stop`);
export const getRuns = () => json("/api/workshop/runs").then((body) => body.runs);
export const getCurve = (id) => json(`${runUrl(id)}/curve`).then((body) => body.points);

/** Export and race one checkpoint; the trace comes back inline, as a trial's does on the Arena. */
export async function testCheckpoint(id, checkpoint) {
  const body = await post(`${runUrl(id)}/trial`, { checkpoint });
  const bytes = Uint8Array.from(atob(body.trace_b64), (c) => c.charCodeAt(0));
  return { ...body, trace: new Float32Array(bytes.buffer) };
}

export const getCode = () => json("/api/workshop/code");
export const forkCode = (url) => post("/api/workshop/code/fork", url ? { url } : {});
export const pushCode = () => post("/api/workshop/code/push");
export const publishRun = (body) => post("/api/workshop/publish", body);
