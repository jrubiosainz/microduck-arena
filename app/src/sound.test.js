import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMuted, play, setMuted, toggleMuted } from "./sound.js";

// Node 25's own experimental `localStorage` global is missing a working
// `setItem` under jsdom (see brightness.test.js) -- a real assignment throws
// through its proxy. Stubbing the whole global, rather than poking at the
// broken one, sidesteps that entirely and gives every test a working,
// disposable store.
function fakeStorage(overrides = {}) {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    ...overrides,
  };
}

// A stand-in for the DOM's `Audio`: records what would have played instead of
// touching a real element, and lets a test make `.play()` fail either way a
// browser can fail it -- synchronously, or via a rejected promise.
function fakeAudioClass({ throwsSync = false, rejects = false } = {}) {
  const calls = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
    }
    play() {
      calls.push(this.src);
      if (throwsSync) throw new Error("blocked");
      if (rejects) return Promise.reject(new Error("blocked"));
      return Promise.resolve();
    }
  }
  FakeAudio.calls = calls;
  return FakeAudio;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("Audio", fakeAudioClass());
});

afterEach(() => {
  vi.unstubAllGlobals();
  setMuted(false);
});

describe("the mute flag", () => {
  it("is off by default -- sound only ever fires from a click, so there is no autoplay to guard against", () => {
    expect(isMuted()).toBe(false);
  });

  it("remembers being turned on", () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
  });

  it("toggles and reports the new state", () => {
    expect(toggleMuted()).toBe(true);
    expect(isMuted()).toBe(true);
    expect(toggleMuted()).toBe(false);
    expect(isMuted()).toBe(false);
  });

  it("keeps working, unmuted, when storage is blocked", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      }),
    );
    expect(() => setMuted(true)).not.toThrow();
    expect(isMuted()).toBe(false);
  });
});

describe("play()", () => {
  it("plays the file for the cue", () => {
    play("press");
    expect(Audio.calls).toEqual(["/sound/press.wav"]);
  });

  it("does nothing while muted", () => {
    setMuted(true);
    play("press");
    expect(Audio.calls).toEqual([]);
  });

  it("never throws when the browser refuses playback synchronously", () => {
    vi.stubGlobal("Audio", fakeAudioClass({ throwsSync: true }));
    expect(() => play("press")).not.toThrow();
  });

  it("never throws when playback rejects asynchronously", async () => {
    vi.stubGlobal("Audio", fakeAudioClass({ rejects: true }));
    expect(() => play("press")).not.toThrow();
    // Give the rejected promise's `.catch` a turn, so an unhandled rejection
    // would surface here rather than in some unrelated later test.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("builds the Audio object on first use, not at import", async () => {
    const Fresh = fakeAudioClass();
    vi.stubGlobal("Audio", Fresh);
    vi.resetModules();
    const fresh = await import("./sound.js");
    expect(Fresh.calls).toEqual([]);
    fresh.play("press");
    expect(Fresh.calls).toEqual(["/sound/press.wav"]);
  });
});
