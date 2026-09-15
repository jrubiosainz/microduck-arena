// Every call the page makes. Errors surface the server's own message, which for
// a rejected policy is the same sentence the robot's daemon would give.

async function detailFrom(response) {
  try {
    const body = await response.json();
    if (body.detail) {
      // FastAPI's own validation errors put an ARRAY here, not a string;
      // stringify rather than letting it become "[object Object]".
      return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    // Not a JSON body; the status line is the best we have.
  }
  return `${response.status} ${response.statusText}`;
}

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

export const getEvents = () => json("/api/events").then((b) => b.events);
export const getLeaderboard = (eventId) => json(`/api/events/${eventId}/leaderboard`);
export const getRun = (runId) => json(`/api/runs/${runId}`);

export const getStandings = () => json("/api/standings").then((b) => b.rows);

/** One player's page, or null when nobody by that name has published. */
export async function getPlayer(user) {
  const response = await fetch(`/api/players/${encodeURIComponent(user)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

/** Who the server thinks you are. Never throws: a failure means signed out. */
export async function getMe() {
  try {
    return await json("/api/me");
  } catch {
    return null;
  }
}

export async function getTrace(runId) {
  const response = await fetch(`/api/runs/${runId}/trace`);
  // Same contract as every other call: the server's own sentence, not a status.
  if (!response.ok) throw new Error(await detailFrom(response));
  // Raw little-endian float32 from the server, 21 values per frame.
  return new Float32Array(await response.arrayBuffer());
}

function policyForm(file, name, livery, commandVx, envUrl) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  if (livery) form.append("livery", livery);
  // Empty means "sweep", which is the server's default too, so it is left off
  // the form entirely rather than sent as a blank the server has to interpret.
  if (commandVx) form.append("command_vx", commandVx);
  // Left off entirely when blank: the field is optional, and the server reads
  // an absent value and an empty one the same way.
  if (envUrl) form.append("env_url", envUrl);
  return form;
}

/** Race it and publish it to the board. */
export function submitPolicy(eventId, file, name, livery, commandVx, envUrl) {
  return json(`/api/events/${eventId}/submit`, {
    method: "POST",
    body: policyForm(file, name, livery, commandVx, envUrl),
  });
}

/**
 * Race it and keep nothing. The trace comes back inline.
 *
 * `commandVx` pins the commanded speed; omit it to sweep. Both paths accept it:
 * the sweep already keeps the best time across the whole range, so pinning can
 * only match or lose to it.
 */
export async function tryPolicy(eventId, file, name, livery, commandVx) {
  const body = await json(`/api/events/${eventId}/try`, {
    method: "POST",
    body: policyForm(file, name, livery, commandVx),
  });
  // The server sends base64 because a trial is stored nowhere to fetch from.
  const bytes = Uint8Array.from(atob(body.trace_b64), (c) => c.charCodeAt(0));
  return { ...body, trace: new Float32Array(bytes.buffer) };
}

/** Take one of your own entries off the board. Not a delete — see the server. */
export const withdrawRun = (runId) =>
  json(`/api/runs/${runId}/withdraw`, { method: "POST" });

/**
 * A field to judge, or the reason there is none.
 *
 * Every answer is a STATE, never a thrown error: "you are signed out", "there
 * are not enough ducks yet" and "that is your votes for today" are all things
 * the page draws as a panel, not failures.
 */
export async function getBallot(eventId) {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/ballot`);
  if (response.status === 401) return { state: "signed-out" };
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

/** One lane's replay. Addressed through the ballot, so no run id is exposed. */
export const ballotTraceUrl = (ballot, lane) => `/api/ballots/${ballot}/lanes/${lane}/trace`;

export async function getBallotTrace(ballot, lane) {
  const response = await fetch(ballotTraceUrl(ballot, lane));
  if (!response.ok) throw new Error(await detailFrom(response));
  return new Float32Array(await response.arrayBuffer());
}

export const castVote = (eventId, ballot, lane) =>
  json(`/api/events/${encodeURIComponent(eventId)}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ballot, lane }),
  });
