import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "./channel.js";

function segment() {
  return { prepare: vi.fn(), show: vi.fn(), play: vi.fn(), seek: vi.fn(), stop: vi.fn(), failed: false };
}

const slots = [
  { kind: "shutter", at_ms: 0, duration_ms: 1600, next: { run_id: "A", event: "2 m Sprint", user: "carol" } },
  { kind: "replay", at_ms: 1600, duration_ms: 8000, run_id: "A" },
  { kind: "shutter", at_ms: 9600, duration_ms: 1600, next: null },
  { kind: "booth", at_ms: 11200, duration_ms: 20000, run_id: "A" },
  { kind: "shutter", at_ms: 31200, duration_ms: 1600, next: { run_id: "B", event: "2 m Sprint", user: "dan" } },
  { kind: "replay", at_ms: 32800, duration_ms: 8000, run_id: "B" },
];

describe("createChannel", () => {
  let now, replay, booth, shutter, onState, onReload, gust, channel;
  beforeEach(() => {
    now = 0;
    replay = segment();
    booth = segment();
    shutter = { draw: vi.fn(), hide: vi.fn() };
    onState = vi.fn();
    onReload = vi.fn();
    gust = vi.fn();
    channel = createChannel({
      clock: { position: () => now }, segments: { replay, booth }, shutter, onState, onReload, gust,
    });
    channel.update({ slots });
  });

  it("enters the slot containing now at its offset, and keeps servoing it", () => {
    now = 4600;
    channel.tick();
    expect(replay.play).toHaveBeenCalledWith(slots[1], 3000);
    now = 4700;
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(1);
    expect(replay.seek).toHaveBeenLastCalledWith(3100);
    expect(onState).toHaveBeenLastCalledWith("live");
  });

  it("keeps the last picture under the sweep, uncovers the next at the midpoint, and plays it on time", () => {
    now = 9000;
    channel.tick();
    now = 9700; // inside the shutter after the replay
    channel.tick();
    expect(replay.stop).not.toHaveBeenCalled();
    expect(shutter.draw).toHaveBeenLastCalledWith(100, null);
    expect(booth.prepare).toHaveBeenCalledWith(slots[3]);
    now = 10500; // past the midpoint
    channel.tick();
    expect(replay.stop).toHaveBeenCalledTimes(1);
    expect(booth.show).toHaveBeenCalledWith(slots[3]);
    channel.tick();
    expect(booth.show).toHaveBeenCalledTimes(1);
    now = 11300;
    channel.tick();
    expect(booth.play).toHaveBeenCalledWith(slots[3], 100);
    expect(shutter.hide).toHaveBeenCalled();
  });

  it("breathes the wind only when a shutter starts under it", () => {
    now = 20;
    channel.tick();
    expect(gust).toHaveBeenCalledTimes(1);
    now = 9800;
    channel.tick();
    expect(gust).toHaveBeenCalledTimes(1);
  });

  it("prefetches the slot after the next shutter while a segment plays", () => {
    now = 2000;
    channel.tick();
    expect(booth.prepare).toHaveBeenCalledWith(slots[3]);
    now = 12000;
    channel.tick();
    expect(replay.prepare).toHaveBeenCalledWith(slots[5]);
  });

  it("covers a failed segment with the shutter until its slot ends", () => {
    now = 2000;
    channel.tick();
    replay.failed = true;
    channel.tick();
    expect(shutter.draw).toHaveBeenLastCalledWith(800, null);
    expect(replay.seek).toHaveBeenCalledTimes(1);
  });

  it("is off air with no slot, halts and resumes, and rejoins after a refusal", () => {
    channel.update({ slots: [] });
    channel.tick();
    expect(onState).toHaveBeenLastCalledWith("off-air");
    channel.update({ slots });
    now = 2000;
    channel.tick();
    channel.halt();
    expect(replay.stop).toHaveBeenCalledTimes(1);
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(1);
    channel.resume();
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(2);
    channel.rejoin();
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(3);
  });

  it("reloads at a shutter's midpoint, never mid-segment", () => {
    now = 2000;
    channel.tick();
    channel.reloadAtNextShutter();
    channel.tick();
    expect(onReload).not.toHaveBeenCalled();
    now = 10500;
    channel.tick();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("says nothing before the first grid, then says a state once until it changes", () => {
    const fresh = createChannel({
      clock: { position: () => now }, segments: { replay, booth }, shutter, onState, onReload, gust,
    });
    fresh.tick();
    expect(onState).not.toHaveBeenCalled();
    expect(shutter.hide).not.toHaveBeenCalled();
    fresh.update({ slots });
    now = 2000;
    fresh.tick();
    now = 2100;
    fresh.tick();
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith("live");
    fresh.update({ slots: [] });
    fresh.tick();
    expect(onState).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith("off-air");
  });
});
