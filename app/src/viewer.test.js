import { Object3D, Spherical, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CTRL_DT, TRACE_WIDTH } from "./replay.js";
import { cameraPose, dragPose, stageCamera, stageLanes, travelPose } from "./viewer.js";

describe("cameraPose", () => {
  it("chases the leader from behind and trackside by default, at the original close distance", () => {
    expect(cameraPose(null, 1.2, 1.15, 0)).toEqual({
      position: [1.2 - 0.35, 0.34, 1.15],
      target: [1.2, 0.12, 0],
    });
  });

  it("takes an event's chase constants and a pinned side", () => {
    const spec = { kind: "chase", back: 0.5, height: 0.6, side: 2, target_height: 0.2, fov: 40 };
    expect(cameraPose(spec, 0, 1.15, 0)).toEqual({ position: [-0.5, 0.6, 2], target: [0, 0.2, 0] });
  });

  it("backs a chase off by a distance factor for a narrower frame", () => {
    expect(cameraPose({ kind: "chase", distance: 2 }, 1, 1.15, 0).position).toEqual([1 - 0.7, 0.68, 2.3]);
  });

  it("climbs with the ramp under the leader, the chase and what it looks at alike", () => {
    expect(cameraPose(null, 1.2, 1.15, 0.17)).toEqual({ position: [1.2 - 0.35, 0.34 + 0.17, 1.15], target: [1.2, 0.12 + 0.17, 0] });
  });

  it("holds a fixed camera where the event put it", () => {
    const spec = { kind: "fixed", position: [1, 0.6, 2.2], target: [1, 0.1, 0], fov: 40 };
    expect(cameraPose(spec, 5, 1.15, 0.3)).toEqual({ position: [1, 0.6, 2.2], target: [1, 0.1, 0] });
  });
});

describe("travelPose", () => {
  const chase = cameraPose({ kind: "chase", distance: 0.7 }, 0, 3.1, 0);
  const reach = (pose) => Math.hypot(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]);

  it("ends on the chase itself", () => {
    expect(travelPose(chase, 1)).toBe(chase);
  });

  it("starts ahead of the line, farther out, looking at the same spot", () => {
    const start = travelPose(chase, 0);
    expect(start.position[0]).toBeGreaterThan(chase.target[0]);
    expect(reach(start)).toBeGreaterThan(reach(chase));
    expect(start.target).toEqual(chase.target);
  });

  it("never comes closer to the ducks than the chase does", () => {
    for (let u = 0; u < 1; u += 0.1) expect(reach(travelPose(chase, u))).toBeGreaterThanOrEqual(reach(chase) - 1e-9);
  });
});

describe("dragPose", () => {
  const pose = cameraPose(null, 1.2, 1.15, 0.1);

  it("leaves the camera alone when nothing drags it", () => {
    expect(dragPose(pose, 0)).toBe(pose);
  });

  it("turns the camera round what it looks at, the way dragging right does", () => {
    const target = new Vector3(...pose.target);
    const orbit = new Spherical().setFromVector3(new Vector3(...pose.position).sub(target));
    orbit.theta -= 0.3; // OrbitControls' rotateLeft for a drag to the right
    const expected = new Vector3().setFromSpherical(orbit).add(target).toArray();
    const turned = dragPose(pose, 0.3);
    turned.position.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
    expect(turned.target).toBe(pose.target);
  });
});

describe("stageLanes", () => {
  const trace = new Float32Array(21);
  const duck = { trace, lead: 0, sound: null, rig: "legs", livery: "purple", start: { x: 0, y: 0, yaw: 0 }, star: false };

  it("puts every duck of the performance on the stage in duck order, each on its own rig, the star alone named", () => {
    const ducks = [{ ...duck, star: true }, { ...duck, rig: "rollers", livery: "classic", start: { x: 0.4, y: -0.6, yaw: 90 } }, duck];
    const lanes = stageLanes([{ runId: "r1", name: "alice", livery: "purple", tier: "ghost", colour: "#ff7a2f", ducks }]);
    expect(lanes.map((lane) => [lane.rig, lane.livery, lane.start, lane.name, lane.opacity])).toEqual([
      ["legs", "purple", duck.start, "alice", 1],
      ["rollers", "classic", { x: 0.4, y: -0.6, yaw: 90 }, undefined, 1],
      ["legs", "purple", duck.start, undefined, 1],
    ]);
  });
});

describe("stageCamera", () => {
  // A duck wandering about the stage as the runner traces it, every 20 ms after a 0.5 s settle: its
  // trunk upright at x, y, which sway with its gait, kept on the stage.
  const wander = ([x, y, ax, ay, wx, wy, px, py]) => {
    const frames = Math.round((0.5 + 20) / CTRL_DT), trace = new Float32Array(frames * TRACE_WIDTH);
    for (let i = 0; i < frames; i++) {
      const t = Math.max(0, i * CTRL_DT - 0.5);
      trace[i * TRACE_WIDTH] = x + ax * Math.sin(wx * t + px) + 0.02 * Math.sin(4 * Math.PI * t);
      trace[i * TRACE_WIDTH + 1] = Math.min(1.8, y + ay * Math.sin(wy * t + py)) + 0.03 * Math.sin(2 * Math.PI * t);
      trace[i * TRACE_WIDTH + 3] = 1;
    }
    return trace;
  };
  // Placed as a duck with a start is (talent-stage.js placeStageDuck).
  const placer = new Object3D();
  placer.rotation.set(0, Math.PI / 2, 0);
  placer.updateMatrixWorld();
  // A pair found among sixty random troupes: fitted to where it stands at each frame alone, the jury
  // shot's camera jumped 2.6 m at 11.1 s.
  const lanes = [[-0.73, 1.46, 0.18, 0.65, 0.31, 0.19, 0.64, 1.12], [-0.46, -0.97, 0.24, 0.7, 0.18, 0.33, 5.92, 1.06]]
    .map((path) => ({ trace: wander(path), rig: { placer } }));
  const layout = { depth: 2.6, width: 3.8 };

  it.each([16 / 9, 9 / 16])("glides within every shot of a troupe on the move, at aspect %s", (aspect) => {
    const shoot = stageCamera(lanes, layout, () => 0);
    let previous = shoot(0, 0, aspect, 42);
    for (let frame = 1; frame <= 24 * 30; frame++) {
      const pose = shoot(frame / 30, frame / 30, aspect, 42);
      if (pose.shot === previous.shot) {
        expect(new Vector3(...pose.position).distanceTo(new Vector3(...previous.position))).toBeLessThan(0.05);
      }
      previous = pose;
    }
  });

  it("reads where the troupe stands only as a shot begins: each shot is planned once", () => {
    let asked = 0;
    const shoot = stageCamera(lanes, layout, () => {
      asked += 1;
      return 0;
    });
    let shot = null;
    for (let frame = 0; frame <= 24 * 30; frame++) {
      const before = asked;
      const pose = shoot(frame / 30, frame / 30, 16 / 9, 42);
      if (pose.shot === shot) expect(asked).toBe(before);
      shot = pose.shot;
    }
    expect(asked).toBeGreaterThan(0);
  });
});
