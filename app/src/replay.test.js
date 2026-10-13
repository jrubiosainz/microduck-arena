import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JOINT_NAMES, buildRigTree } from "./rig.js";
import { CTRL_DT, Player, TRACE_WIDTH, applyFrame, frameAt, frameCount, leadIn, splitDucks, standing } from "./replay.js";

const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));

function traceOf(frames) {
  const data = new Float32Array(frames * TRACE_WIDTH);
  for (let f = 0; f < frames; f++) {
    const at = f * TRACE_WIDTH;
    data[at + 0] = f * 0.1; // x
    data[at + 1] = 0;
    data[at + 2] = 0.12; // z, MJCF up
    data[at + 3] = 1; // quaternion w — upright
    data[at + 7] = 0.05 * f; // first joint angle
  }
  return data;
}

/** A settle whose trunk heights are `heights`, one frame each. */
function settleOf(heights) {
  const data = traceOf(heights.length);
  heights.forEach((z, f) => (data[f * TRACE_WIDTH + 2] = z));
  return data;
}

describe("trace geometry", () => {
  it("is 21 values per frame at 50 Hz", () => {
    expect(TRACE_WIDTH).toBe(21);
    expect(CTRL_DT).toBeCloseTo(0.02, 12);
  });

  it("counts frames from the buffer length", () => {
    expect(frameCount(traceOf(9))).toBe(9);
  });

  it("views a frame without copying", () => {
    const trace = traceOf(4);
    const frame = frameAt(trace, 2);
    expect(frame.length).toBe(TRACE_WIDTH);
    expect(frame[0]).toBeCloseTo(0.2, 6);
    expect(frame.buffer).toBe(trace.buffer);
  });
});

describe("splitDucks", () => {
  it("cuts a troupe's frames into one trace per duck, in duck order, without copying", () => {
    const values = Float32Array.from([...traceOf(2), ...traceOf(2).map((v) => v + 100)]);
    const [first, second] = splitDucks(values, 2);
    expect(frameCount(first)).toBe(2);
    expect(frameCount(second)).toBe(2);
    expect(first[0]).toBe(0);
    expect(second[0]).toBe(100);
    expect(second.buffer).toBe(values.buffer);
  });

  it("hands a lane its one duck whole", () => {
    const values = traceOf(3);
    expect(splitDucks(values, 1)).toEqual([values]);
  });
});

describe("leadIn", () => {
  it("plays the settle, then the trace", () => {
    const settle = traceOf(3).map((v) => v + 100);
    const lane = leadIn(settle, traceOf(4), 3);
    expect(frameCount(lane)).toBe(7);
    expect([...frameAt(lane, 0)]).toEqual([...frameAt(settle, 0)]);
    expect([...frameAt(lane, 3)]).toEqual([...frameAt(traceOf(4), 0)]);
  });

  it("holds the trace's first frame for a run stored without a settle, so it keeps in step", () => {
    const lane = leadIn(new Float32Array(0), traceOf(4), 3);
    expect(frameCount(lane)).toBe(7);
    for (const f of [0, 1, 2, 3]) expect([...frameAt(lane, f)]).toEqual([...frameAt(traceOf(4), 0)]);
    expect([...frameAt(lane, 4)]).toEqual([...frameAt(traceOf(4), 1)]);
  });

  it("holds a shorter settle's own first frame, so the lane never jumps into it", () => {
    const settle = traceOf(2).map((v) => v + 100);
    const lane = leadIn(settle, traceOf(4), 3);
    expect(frameCount(lane)).toBe(7);
    for (const f of [0, 1]) expect([...frameAt(lane, f)]).toEqual([...frameAt(settle, 0)]);
    expect([...frameAt(lane, 2)]).toEqual([...frameAt(settle, 1)]);
    expect([...frameAt(lane, 3)]).toEqual([...frameAt(traceOf(4), 0)]);
  });
});

describe("standing", () => {
  // A roller-sprint-2m settle's first frames, from the run log.
  const roller = settleOf([0.12, 0.1268, 0.1327, 0.1357, 0.1359, 0.1337, 0.1294]);
  const walker = settleOf([0.12, 0.1174, 0.115, 0.1151, 0.1151, 0.1151, 0.1151]);

  it("drops the frames the solver spends lifting the roller rig's wheels out of the floor", () => {
    expect(standing([roller]).map((settle) => [...settle])).toEqual([[...roller.subarray(4 * TRACE_WIDTH)]]);
  });

  it("keeps every frame of a walking duck dropping onto the floor", () => {
    expect(standing([walker])).toEqual([walker]);
  });

  it("keeps a troupe in step: every duck loses the frames its roller needs", () => {
    const [legs, wheels] = standing([walker, roller]);
    expect([...legs]).toEqual([...walker.subarray(4 * TRACE_WIDTH)]);
    expect([...wheels]).toEqual([...roller.subarray(4 * TRACE_WIDTH)]);
  });

  it("keeps a run stored without a settle empty", () => {
    expect(standing([new Float32Array(0)]).map(frameCount)).toEqual([0]);
  });
});

describe("applyFrame", () => {
  it("places the trunk from the first three values", () => {
    const rig = buildRigTree(kinematics);
    applyFrame(rig, frameAt(traceOf(3), 1));
    const trunk = rig.bodies.get("trunk_base");
    expect(trunk.position.x).toBeCloseTo(0.1, 6);
    expect(trunk.position.z).toBeCloseTo(0.12, 6);
  });

  it("reads the trunk quaternion in MJCF order", () => {
    const rig = buildRigTree(kinematics);
    const frame = frameAt(traceOf(1), 0);
    // A quarter turn about MJCF z: (w, x, y, z) = (cos45, 0, 0, sin45).
    frame[3] = Math.SQRT1_2;
    frame[4] = 0;
    frame[5] = 0;
    frame[6] = Math.SQRT1_2;
    applyFrame(rig, frame);

    // Component-wise, NOT via angleTo. The trace is float32, so each component
    // carries ~1.2e-8 of truncation, and angleTo's acos has infinite slope at 1
    // — it turns that into a ~3.7e-4 rad angle, which no tight tolerance can
    // survive. Comparing components is both achievable and stricter about the
    // thing under test: a permuted order moves SQRT1_2 to the wrong axis.
    const trunk = rig.bodies.get("trunk_base");
    expect(trunk.quaternion.x).toBeCloseTo(0, 6);
    expect(trunk.quaternion.y).toBeCloseTo(0, 6);
    expect(trunk.quaternion.z).toBeCloseTo(Math.SQRT1_2, 6);
    expect(trunk.quaternion.w).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("drives all 14 joints from columns 7 onward", () => {
    const rig = buildRigTree(kinematics);
    const frame = frameAt(traceOf(1), 0);
    JOINT_NAMES.forEach((_, i) => {
      frame[7 + i] = 0.1;
    });
    applyFrame(rig, frame);

    for (const name of JOINT_NAMES) {
      const joint = rig.joints.get(name);
      // 0.1 rad is inside every joint's range, so nothing is clamped away.
      expect(joint.body.quaternion.angleTo(joint.baseQuat)).toBeGreaterThan(1e-6);
    }
  });
});

describe("Player", () => {
  it("runs as long as its longest trace", () => {
    const player = new Player([traceOf(50), traceOf(120)]);
    expect(player.duration).toBeCloseTo(120 * CTRL_DT, 9);
  });

  it("reports a frame index per lane for a given time", () => {
    const player = new Player([traceOf(50), traceOf(120)]);
    expect(player.frameIndices(0)).toEqual([0, 0]);
    // 0.5 s is inside both lanes, so neither is clamped: floor(0.5 / 0.02) = 25.
    expect(player.frameIndices(0.5)).toEqual([25, 25]);
  });

  it("holds a finished lane on its last frame instead of looping it", () => {
    // The fast duck should stay at the line while the slow one comes in —
    // that is what makes a head-to-head replay readable.
    const player = new Player([traceOf(50), traceOf(120)]);
    expect(player.frameIndices(2.0)).toEqual([49, 100]);
  });

  it("clamps a seek to the timeline", () => {
    const player = new Player([traceOf(50)]);
    player.seek(-5);
    expect(player.time).toBe(0);
    player.seek(999);
    expect(player.time).toBeCloseTo(player.duration, 9);
  });

  it("has a zero duration and no frames for no lanes", () => {
    const player = new Player([]);
    expect(player.duration).toBe(0);
    expect(player.frameIndices(0)).toEqual([]);
  });
});
