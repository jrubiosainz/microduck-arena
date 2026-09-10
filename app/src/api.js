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

export async function getTrace(runId) {
  const response = await fetch(`/api/runs/${runId}/trace`);
  // Same contract as every other call: the server's own sentence, not a status.
  if (!response.ok) throw new Error(await detailFrom(response));
  // Raw little-endian float32 from the server, 21 values per frame.
  return new Float32Array(await response.arrayBuffer());
}

function policyForm(file, name, livery, commandVx) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  if (livery) form.append("livery", livery);
  // Empty means "sweep", which is the server's default too, so it is left off
  // the form entirely rather than sent as a blank the server has to interpret.
  if (commandVx) form.append("command_vx", commandVx);
  return form;
}

/** Race it and publish it to the board. */
export function submitPolicy(eventId, file, name, livery) {
  return json(`/api/events/${eventId}/submit`, {
    method: "POST",
    body: policyForm(file, name, livery),
  });
}

/**
 * Race it and keep nothing. The trace comes back inline.
 *
 * `commandVx` pins the commanded speed for this trial; omit it to sweep. There
 * is deliberately no such parameter on submitPolicy — a published time is
 * always the full sweep, or the board ranks whoever guessed their speed best.
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
