import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReplay } from "./replay.js";

// jsdom has no media pipeline: play, load and buffered are stubbed on every
// video the segment makes.
function stubMedia(stage, { refuse = false } = {}) {
  for (const video of stage.querySelectorAll("video")) {
    video.load = vi.fn();
    video.pause = vi.fn();
    video.play = vi.fn(() => (refuse ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve()));
    for (const [name, value] of [["buffered", { length: 1, start: () => 0, end: () => 30 }],
                                 ["currentTime", 0], ["playbackRate", 1], ["error", null]]) {
      if (!Object.getOwnPropertyDescriptor(video, name)) {
        Object.defineProperty(video, name, { value, writable: true, configurable: true });
      }
    }
  }
}

const A = { kind: "replay", at_ms: 0, duration_ms: 8000, run_id: "A" };
const B = { kind: "replay", at_ms: 8000, duration_ms: 8000, run_id: "B" };

describe("createReplay", () => {
  let stage, replay, refused;
  beforeEach(() => {
    stage = document.createElement("div");
    refused = vi.fn();
    replay = createReplay(stage, { onRefused: refused });
    stubMedia(stage);
  });

  it("owns two videos and alternates them so the next clip is already loading", async () => {
    const videos = stage.querySelectorAll("video.live-video");
    expect(videos).toHaveLength(2);
    expect([...videos].every((v) => v.hidden)).toBe(true);
    replay.prepare(A);
    const first = [...videos].find((v) => v.getAttribute("src")?.includes("/A/"));
    expect(first).toBeDefined();
    expect(first.getAttribute("src")).toBe("/api/runs/A/clip/landscape.mp4");
    await replay.play(A, 2500);
    expect(first.hidden).toBe(false);
    expect(first.currentTime).toBeCloseTo(2.5);
    expect(first.play).toHaveBeenCalled();
    replay.prepare(B);
    const second = [...videos].find((v) => v !== first);
    expect(second.getAttribute("src")).toBe("/api/runs/B/clip/landscape.mp4");
    await replay.play(B, 0);
    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(false);
  });

  it("plays a slot it was not prepared for by preparing it first", async () => {
    await replay.play(B, 100);
    const shown = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    expect(shown.getAttribute("src")).toBe("/api/runs/B/clip/landscape.mp4");
  });

  it("shows a first frame under the shutter, then plays the same video without reloading", async () => {
    replay.show(A);
    const shown = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    expect(shown.currentTime).toBe(0);
    expect(shown.play).not.toHaveBeenCalled();
    await replay.play(A, 0);
    expect(shown.load).toHaveBeenCalledTimes(1);
    expect(shown.play).toHaveBeenCalledTimes(1);
  });

  it("servoes the clock: a nudge for a small error, a seek for a large one", async () => {
    await replay.play(A, 0);
    const video = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    video.currentTime = 4;
    replay.seek(4600);
    expect(video.playbackRate).toBe(1.03);
    replay.seek(9000);
    expect(video.currentTime).toBe(9);
    expect(video.playbackRate).toBe(1);
  });

  it("reports a refused play, and stops cleanly", async () => {
    stubMedia(stage, { refuse: true });
    await replay.play(A, 0);
    expect(refused).toHaveBeenCalled();
    replay.stop();
    expect([...stage.querySelectorAll("video")].every((v) => v.hidden)).toBe(true);
  });

  it("reports a clip that failed while loading as failed, not as a refused play", async () => {
    stubMedia(stage, { refuse: true });
    replay.prepare(A);
    const video = [...stage.querySelectorAll("video")].find((v) => v.getAttribute("src")?.includes("/A/"));
    video.error = { code: 4 }; // MEDIA_ERR_SRC_NOT_SUPPORTED
    await replay.play(A, 0);
    expect(replay.failed).toBe(true);
    expect(refused).not.toHaveBeenCalled();
  });

  it("keeps forcing the alignment until a seek lands on buffered media", async () => {
    replay.prepare(A);
    const video = [...stage.querySelectorAll("video")].find((v) => v.getAttribute("src")?.includes("/A/"));
    video.buffered = { length: 0 };
    await replay.play(A, 500);
    expect(video.currentTime).toBe(0);
    video.buffered = { length: 1, start: () => 0, end: () => 30 };
    replay.seek(600);
    expect(video.currentTime).toBe(0.6);
    expect(video.playbackRate).toBe(1);
  });

  it("mutes and unmutes the video that is playing", async () => {
    await replay.play(A, 0);
    const video = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    replay.muted(true);
    expect(video.muted).toBe(true);
    replay.muted(false);
    expect(video.muted).toBe(false);
  });
});
