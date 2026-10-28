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

/**
 * A troupe's trace or settle as the server sends it, every duck's frames one after the other,
 * cut into one per duck, in duck order: views, no copy. A lane's is its one duck.
 */
export function splitDucks(values, ducks) {
  const length = values.length / ducks;
  return Array.from({ length: ducks }, (_, k) => values.subarray(k * length, (k + 1) * length));
}

/** A view onto one frame — no copy, so this is cheap inside a render loop. */
export function frameAt(trace, index) {
  const start = index * TRACE_WIDTH;
  return trace.subarray(start, start + TRACE_WIDTH);
}

/** The first frames of a settle in which the trunk only rises. */
function rising(settle) {
  let f = 0;
  while (f + 1 < frameCount(settle) && frameAt(settle, f + 1)[2] > frameAt(settle, f)[2]) f++;
  return f;
}

/**
 * Every duck's settle (api.js getSettle) from where the ducks stand on the
 * floor. The roller rig spawns at the walking rig's height on its longer,
 * wheeled legs, so its reset pose has the wheels 2 cm deep and the solver lifts
 * the trunk out over the first steps; a walking duck drops onto the floor
 * instead, and keeps every frame. A troupe shares one physics, so every duck
 * loses the frames its slowest roller needs, and the ducks stay in step.
 */
export function standing(settles) {
  const cut = Math.max(...settles.map(rising));
  return settles.map((settle) => settle.subarray(cut * TRACE_WIDTH));
}

/**
 * A lane from where its simulation started: its settle, then its trace, with
 * `frames` frames of `width` floats before the trace (a duck's TRACE_WIDTH, a
 * tug's string its own). A shorter settle is made up by holding its first
 * frame — the trace's, for a run stored before settles were recorded — so
 * every lane still reaches its trace in step with the others.
 */
export function leadIn(settle, trace, frames, width) {
  const count = (values) => Math.floor(values.length / width);
  const lane = new Float32Array((frames + count(trace)) * width);
  const missing = frames - count(settle);
  const first = (count(settle) ? settle : trace).subarray(0, width);
  for (let f = 0; f < missing; f++) lane.set(first, f * width);
  lane.set(settle, missing * width);
  lane.set(trace, frames * width);
  return lane;
}

export function applyFrame(rig, frame) {
  const trunk = rig.bodies.get("trunk_base");
  trunk.position.set(frame[0], frame[1], frame[2]);
  // MJCF (w,x,y,z) at columns 3..7 -> three.js (x,y,z,w).
  trunk.quaternion.set(frame[4], frame[5], frame[6], frame[3]);
  for (let j = 0; j < JOINT_NAMES.length; j++) setJoint(rig, JOINT_NAMES[j], frame[7 + j]);
}

export class Player {
  constructor(traces, { loop = true } = {}) {
    this.traces = traces;
    this.counts = traces.map(frameCount);
    this.duration = this.counts.length ? Math.max(...this.counts) * CTRL_DT : 0;
    this.time = 0;
    this.playing = false;
    // Loop the race so it can be watched repeatedly; with `loop` off it holds
    // the last frame and stops — a clip ends on the ducks at the line.
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
  }

  play() {
    this.playing = true;
    this._last = null;
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
        return;
      }
      next = 0;
      this._last = nowMs;
    }
    this.time = next;
  }
}
