// A stored trace, played back through a rig.
//
// The trace is exactly what the server simulated: 21 float32 per frame at
// 50 Hz — trunk position(3), trunk quaternion(4, MJCF w,x,y,z), joint angles(14
// in JOINT_NAMES order). No physics runs here; this is a recording.

import { JOINT_NAMES, setJoint } from "./rig.js";

export const TRACE_WIDTH = 21;
export const CTRL_DT = 0.02; // matches arena.constants.CTRL_DT

export function frameCount(trace) {
  return Math.floor(trace.length / TRACE_WIDTH);
}

/** A view onto one frame — no copy, so this is cheap inside a render loop. */
export function frameAt(trace, index) {
  const start = index * TRACE_WIDTH;
  return trace.subarray(start, start + TRACE_WIDTH);
}

export function applyFrame(rig, frame) {
  const trunk = rig.bodies.get("trunk_base");
  trunk.position.set(frame[0], frame[1], frame[2]);
  // MJCF (w,x,y,z) at columns 3..7 -> three.js (x,y,z,w).
  trunk.quaternion.set(frame[4], frame[5], frame[6], frame[3]);
  for (let j = 0; j < JOINT_NAMES.length; j++) setJoint(rig, JOINT_NAMES[j], frame[7 + j]);
}

export class Player {
  constructor(traces, { onTick, loop = true } = {}) {
    this.traces = traces;
    this.counts = traces.map(frameCount);
    this.duration = this.counts.length ? Math.max(...this.counts) * CTRL_DT : 0;
    this.time = 0;
    this.playing = false;
    this.onTick = onTick;
    // Loop the race so it can be watched repeatedly; with `loop` off it holds
    // the last frame and stops — the reveal wants the ducks at the line.
    this.loop = loop;
    this._last = null;
  }

  /**
   * The frame each lane should show at `t`.
   *
   * A lane that has run out holds its final frame rather than looping: in a
   * head-to-head the winner should wait at the line while the others finish,
   * which is what makes the result legible.
   */
  frameIndices(t = this.time) {
    return this.counts.map((count) =>
      count === 0 ? 0 : Math.min(count - 1, Math.floor(t / CTRL_DT)),
    );
  }

  seek(t) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.onTick?.(this.time);
  }

  play() {
    this.playing = true;
    this._last = null;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  /** Advance by wall-clock milliseconds; call once per animation frame. */
  advance(nowMs) {
    if (!this.playing) {
      this._last = nowMs;
      return;
    }
    if (this._last === null) {
      this._last = nowMs;
      return;
    }
    const dt = (nowMs - this._last) / 1000;
    this._last = nowMs;
    let next = this.time + dt;
    if (next >= this.duration) {
      if (!this.loop) {
        this.time = this.duration;
        this.playing = false;
        this.onTick?.(this.time);
        return;
      }
      next = 0;
      this._last = nowMs;
    }
    this.time = next;
    this.onTick?.(this.time);
  }
}
