// Who is logged in to Hugging Face, asked apart from everything else: the Hub may take seconds to
// answer, or never answer, and no page waits for it. Logging in is Hugging Face's own browser flow,
// started by the server (which opens the page); once it has ended the Hub is asked again.

import * as api from "./api.js";

export const POLL_MS = 2000;

export function fromHub(hub) {
  if (!hub.reachable) return { phase: "unreachable" };
  return hub.user ? { phase: "in", user: hub.user, canPay: Boolean(hub.can_pay) } : { phase: "out" };
}

export function createAccount(onChange) {
  let state = { phase: "checking" };
  const set = (next) => {
    state = next;
    onChange(state);
  };

  async function check() {
    set({ phase: "checking" });
    try {
      set(fromHub(await api.getHub()));
    } catch {
      set({ phase: "unreachable" });
    }
  }

  async function wait() {
    let login;
    try {
      login = await api.getLogin();
    } catch (error) {
      set({ phase: "out", error: error.message });
      return;
    }
    if (login.state === "waiting") setTimeout(wait, POLL_MS);
    else if (login.state === "failed") set({ phase: "out", error: login.output || "The login did not finish." });
    else await check();
  }

  async function logIn() {
    set({ phase: "waiting" });
    try {
      const { url } = await api.startLogin();
      set({ phase: "waiting", url });
    } catch (error) {
      set({ phase: "out", error: error.message });
      return;
    }
    setTimeout(wait, POLL_MS);
  }

  return { get: () => state, check, logIn };
}
