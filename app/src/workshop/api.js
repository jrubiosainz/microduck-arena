// Every call the workshop's pages make. Errors carry the server's own sentence — for a failed
// command, its whole output.

import { detailFrom } from "../api.js";

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

const post = (url, body = {}) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getStatus = () => json("/api/workshop/status");
export const getHub = () => json("/api/workshop/hub");
export const startLogin = () => post("/api/workshop/login");
export const getLogin = () => json("/api/workshop/login");
export const getCode = () => json("/api/workshop/code");
export const useFork = (url) => post("/api/workshop/code/fork", { url });

const challengeUrl = (event) => `/api/workshop/challenges/${encodeURIComponent(event)}`;
const jobUrl = (event, id) => `${challengeUrl(event)}/jobs/${encodeURIComponent(id)}`;

export const commitCode = (message) => post("/api/workshop/code/commit", { message });
export const train = (event, body) => post(`${challengeUrl(event)}/train`, body);
export const getJobs = (event) => json(`${challengeUrl(event)}/jobs`).then((body) => body.jobs);
export const stopJob = (event, id) => post(`${jobUrl(event, id)}/stop`);
export const getJob = (event, id, since = 0) => json(`${jobUrl(event, id)}?since=${since}`);
export const publishJob = (event, id, body) => post(`${jobUrl(event, id)}/publish`, body);
export const pushCode = () => post("/api/workshop/code/push");

/** A checkpoint's stored evaluation, its trace decoded as the viewer takes it; `{checkpoint, error}` when it failed. */
export async function getCheckpoint(event, id, n) {
  const body = await json(`${jobUrl(event, id)}/checkpoints/${n}`);
  if (body.error) return body;
  const { trace_b64: encoded, ...evaluation } = body;
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return { ...evaluation, trace: new Float32Array(bytes.buffer) };
}
