import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getHub: vi.fn(),
  startLogin: vi.fn(),
  getLogin: vi.fn(),
}));
vi.mock("./api.js", () => api);

import { POLL_MS, createAccount, fromHub } from "./account.js";

beforeEach(() => {
  vi.resetAllMocks(); // what one test queued (a Once) never answers the next
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("the account", () => {
  it("reads /hub", () => {
    expect(fromHub({ user: null, reachable: false, can_pay: false })).toEqual({ phase: "unreachable" });
    expect(fromHub({ user: null, reachable: true, can_pay: false })).toEqual({ phase: "out" });
    expect(fromHub({ user: "alice", reachable: true, can_pay: true })).toEqual({ phase: "in", user: "alice", canPay: true });
  });

  it("says checking, then what the Hub answered", async () => {
    api.getHub.mockResolvedValue({ user: "alice", reachable: true, can_pay: false });
    const seen = [];
    const account = createAccount((state) => seen.push(state.phase));
    await account.check();
    expect(seen).toEqual(["checking", "in"]);
    expect(account.get()).toEqual({ phase: "in", user: "alice", canPay: false });
  });

  it("logs in with the browser: waits, then asks the Hub again", async () => {
    api.startLogin.mockResolvedValue({ url: "https://huggingface.co/oauth/device?user_code=X", code: "X" });
    api.getLogin.mockResolvedValueOnce({ state: "waiting", output: "" }).mockResolvedValueOnce({ state: "done", output: "" });
    api.getHub.mockResolvedValue({ user: "alice", reachable: true, can_pay: true });
    const account = createAccount(() => {});
    await account.logIn();
    expect(account.get()).toEqual({ phase: "waiting", url: "https://huggingface.co/oauth/device?user_code=X" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get()).toEqual({ phase: "in", user: "alice", canPay: true });
  });

  it("stays waiting while a login is under way, whatever asks the Hub meanwhile", async () => {
    api.getHub.mockResolvedValue({ user: null, reachable: true, can_pay: false });
    api.startLogin.mockResolvedValue({ url: "u", code: "X" });
    api.getLogin.mockResolvedValueOnce({ state: "done", output: "" });
    const account = createAccount(() => {});
    await account.check();
    expect(account.get()).toEqual({ phase: "out" });
    await account.logIn();
    await account.check();
    expect(account.get()).toEqual({ phase: "waiting", url: "u" });
    api.getHub.mockResolvedValue({ user: "alice", reachable: true, can_pay: true });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get()).toEqual({ phase: "in", user: "alice", canPay: true });
  });

  it("says why a login failed", async () => {
    api.startLogin.mockResolvedValue({ url: "u", code: "X" });
    api.getLogin.mockResolvedValue({ state: "failed", output: "Authorization denied." });
    const account = createAccount(() => {});
    await account.logIn();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(account.get()).toEqual({ phase: "out", error: "Authorization denied." });
  });

  it("says why a login could not start", async () => {
    api.startLogin.mockRejectedValue(new Error("Could not start the Hugging Face login"));
    const account = createAccount(() => {});
    await account.logIn();
    expect(account.get()).toEqual({ phase: "out", error: "Could not start the Hugging Face login" });
  });
});
