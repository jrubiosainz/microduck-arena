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
