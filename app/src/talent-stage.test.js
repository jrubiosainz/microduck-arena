import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BoxGeometry, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildTalentStage, stageCameraPose, stageLayout, placeStageDuck, placeStagePerformer, stageCameraTarget } from "./talent-stage.js";
import { applyFrame } from "./replay.js";
import { meshNames, buildRigTree, STAND, TRUNK_HEIGHT } from "./rig.js";

const STAGE = { id: "got-a-talent", course: "stage", size_m: [2.6, 3.8] };
const subjects = [new Vector3(0.4, 0.14, 0.1)];

describe("the MicroDuck Got a Talent broadcast camera", () => {
  it.each([16 / 9, 9 / 16])("keeps the solo performer in frame at aspect %s", aspect => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    for (let time = 0; time <= 20; time += 0.25) {
      const pose = stageCameraPose(time, subjects, aspect, 42);
      camera.position.set(...pose.position);
      camera.lookAt(new Vector3(...pose.target));
      camera.updateMatrixWorld();
      for (const subject of subjects) {
        for (const height of [-0.14, 0.23]) {
          const projected = subject.clone().add(new Vector3(0, height, 0)).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.9);
          expect(Math.abs(projected.y)).toBeLessThan(0.9);
        }
      }
    }
  });
  it("moves throughout the intro and cuts between deterministic television shots", () => {
    const at = t => stageCameraPose(t, subjects, 16 / 9, 42);
    for (let t = 0; t < 2.99; t += 0.04) {
      expect(new Vector3(...at(t).position).distanceTo(new Vector3(...at(t + 0.04).position))).toBeGreaterThan(0.0001);
    }
    const first = at(5);
    at(19);
    expect(at(5)).toEqual(first);
    expect(new Set([1, 4, 8, 12, 16, 20].map(t => at(t).shot)).size).toBe(6);
    for (const cut of [3, 7, 11, 14, 18]) {
      expect(at(cut - 0.001).shot).not.toBe(at(cut).shot);
      expect(new Vector3(...at(cut - 0.001).position).distanceTo(new Vector3(...at(cut).position))).toBeGreaterThan(0.2);
    }
  });
  it("holds its last shot past the cycle: a clip's outro ends on the crane, not back on the opening", () => {
    const subject = [new Vector3(0, 0.14, 0)];
    const end = stageCameraPose(24, subject, 16 / 9, 42);
    const after = stageCameraPose(25.5, subject, 16 / 9, 42);
    expect(after.shot).toBe("crane");
    expect(after.position).toEqual(end.position);
  });
  it("frames a lone performer exactly as it always has", () => {
    // Taken from the camera before troupes, for the performer above.
    const before = [
      [16 / 9, 4, [0.22570329630569386, 0.29702503451609114, -1.0532500891160745], [0.4, 0.18, 0.1]],
      [16 / 9, 8, [-0.42583949082768935, 0.35399089951391566, -0.7020673712856054], [0.4, 0.18, 0.1]],
      [16 / 9, 12, [3.7055501813912617, 1.161959192494971, 0.644469571681202], [0.4, 0.33, -0.15]],
      [16 / 9, 16, [0.7610272280823642, 0.24792066517393552, -0.9714635177655214], [0.4, 0.18, 0.1]],
      [9 / 16, 4, [-0.9158909874814564, 0.3787024028692959, -1.38], [0.4, 0.18, 0.1]],
      [9 / 16, 20, [-2.2931488880415913, 4.862977596065165, -11.231835275359844], [0.4, 0.83, 0.1]],
    ];
    for (const [aspect, time, position, target] of before) {
      const pose = stageCameraPose(time, subjects, aspect, 42);
      pose.position.forEach((value, i) => expect(value).toBeCloseTo(position[i], 9));
      pose.target.forEach((value, i) => expect(value).toBeCloseTo(target[i], 9));
    }
  });
});

describe("the broadcast camera on a troupe", () => {
  // Four ducks spread over the stage, the star first.
  const troupe = [new Vector3(0.2, 0.14, 0.1), new Vector3(-1.3, 0.14, -0.7), new Vector3(1.4, 0.14, 0.7), new Vector3(0.9, 0.14, -0.8)];

  it.each([16 / 9, 9 / 16])("keeps every duck in frame at aspect %s, but in the star's close-up", aspect => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    for (let time = 0; time <= 24; time += 0.25) {
      const pose = stageCameraPose(time, troupe, aspect, 42, 2.6);
      if (pose.shot === "low-front") continue;
      camera.position.set(...pose.position);
      camera.lookAt(new Vector3(...pose.target));
      camera.updateMatrixWorld();
      for (const duck of troupe) {
        for (const height of [-0.14, 0.23]) {
          const projected = duck.clone().add(new Vector3(0, height, 0)).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.9);
          expect(Math.abs(projected.y)).toBeLessThan(0.9);
        }
      }
    }
  });
  it("closes in on the star alone in the low front shot, as on a lone performer", () => {
    for (const time of [14, 16, 17.9]) {
      expect(stageCameraPose(time, troupe, 16 / 9, 42)).toEqual(stageCameraPose(time, troupe.slice(0, 1), 16 / 9, 42));
    }
  });
  it("frames ducks all on one spot as that one duck", () => {
    const stacked = [troupe[0], troupe[0].clone(), troupe[0].clone()];
    for (let time = 0; time <= 24; time += 0.5) {
      expect(stageCameraPose(time, stacked, 16 / 9, 42)).toEqual(stageCameraPose(time, troupe.slice(0, 1), 16 / 9, 42));
    }
  });
});

describe("theatre layout", () => {
  it("builds the theatre round the event's own floor, centred on the physics' origin", () => {
    const layout = stageLayout({ ...STAGE, size_m: [3, 5] });
    expect(layout).toMatchObject({ width: 5, depth: 3, centre: 0 });
    expect(layout.juryZ).toBeLessThan(-layout.depth / 2);
    expect(layout.audienceZ).toBeLessThan(layout.juryZ - 0.5);
  });
});

describe("the solo stage", () => {
  let reachy;
  beforeAll(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath() {}, roundRect() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, fillRect() {},
    });
    const bytes = readFileSync("public/robot/reachy-mini/reachy-mini.glb");
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    reachy = (await new GLTFLoader().parseAsync(buffer, "")).scene;
  });
  it("seats four official judges before the audience and follows a moving performer when seeking", () => {
    const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
    const geometries = new Map(meshNames(kinematics).map(name => [name, new BoxGeometry(0.01, 0.01, 0.01)]));
    const stage = buildTalentStage(STAGE, { kinematics, geometries }, reachy);
    const jury = stage.group.getObjectByName("judges");
    expect(jury.children.filter(child => child.name.startsWith("judge-"))).toHaveLength(4);
    expect(stage.group.getObjectByName("finish")).toBeUndefined();
    expect(stage.group.getObjectByName("walls")).toBeUndefined();
    stage.group.updateMatrixWorld(true);
    const centre = new Vector3(0, 0.14, 0);
    for (const aspect of [16 / 9, 9 / 16]) {
      const opening = stageCameraPose(0, [centre], aspect, 42);
      const eye = new Vector3(...opening.position);
      const ray = new Raycaster(eye, centre.clone().sub(eye).normalize(), 0, eye.distanceTo(centre));
      const walls = stage.group.children.filter(child => ["auditorium-back", "auditorium-wing"].includes(child.name));
      expect(ray.intersectObjects(walls)).toHaveLength(0);
    }
    for (const aspect of [16 / 9, 9 / 16]) {
      for (const z of [-1, 1]) {
        const performer = new Vector3(0, 0.14, z);
        for (const time of [4, 8, 12, 16]) {
          const pose = stageCameraPose(time, [performer], aspect, 42);
          const next = stageCameraPose(time + 0.001, [performer], aspect, 42);
          expect(new Vector3(...pose.position).distanceTo(new Vector3(...next.position))).toBeLessThan(0.01);
          const eye = new Vector3(...pose.position);
          const ray = new Raycaster(eye, performer.clone().sub(eye).normalize(), 0, eye.distanceTo(performer));
          const obstacles = stage.group.children.filter(child => ["judges", "jury-desk", "backdrop"].includes(child.name));
          expect(ray.intersectObjects(obstacles)).toHaveLength(0);
        }
      }
    }
    const target = new Vector3(0.8, 0.13, -0.2);
    stage.pose(8, [target]);
    const light = stage.group.getObjectByName("follow-spot");
    expect(light.isSpotLight).toBe(true);
    expect(light.target.position.toArray()).toEqual(target.toArray());
    stage.pose(1, [new Vector3(-0.3, 0.08, 0.4)]);
    expect(light.target.position.toArray()).toEqual([-0.3, 0.08, 0.4]);
    expect(light.castShadow).toBe(true);
    // The beam's open rim sinks just below the stage, so its edge never shows.
    const beam = stage.group.getObjectByName("follow-beam");
    stage.group.updateMatrixWorld(true);
    const positions = beam.geometry.attributes.position, vertex = new Vector3();
    let rimTop = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      if (vertex.z > 0.999) rimTop = Math.max(rimTop, vertex.applyMatrix4(beam.matrixWorld).y);
    }
    expect(rimTop).toBeLessThan(1e-6);
    expect(rimTop).toBeGreaterThan(-0.01);
    expect(stage.group.getObjectByName("follow-pool")).toBeUndefined();
    const shared = vi.spyOn(reachy.getObjectByProperty("isMesh", true).geometry, "dispose");
    stage.dispose();
    expect(shared).not.toHaveBeenCalled();
    geometries.forEach(geometry => geometry.dispose());
  });
});


it("turns the robot and its complete recorded trajectory toward the audience", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const rig = buildRigTree(kinematics);
  const frame = x => [x, 0, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND];
  const trace = Float32Array.from([...frame(0), ...frame(1), ...frame(2)]);
  const original = trace.slice();
  placeStagePerformer(rig, trace, 1);
  const forward = new Vector3(1, 0, 0).applyQuaternion(rig.placer.quaternion);
  expect(forward.x).toBeCloseTo(0);
  expect(forward.z).toBeCloseTo(-1);
  applyFrame(rig, trace.subarray(0, 21));
  const start = rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  applyFrame(rig, trace.subarray(42, 63));
  const end = rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  expect(start.x).toBeCloseTo(1);
  expect(end.x).toBeCloseTo(1);
  expect(start.z).toBeCloseTo(1);
  expect(end.z).toBeCloseTo(-1);
  expect(trace).toEqual(original);
});


describe("a troupe's places", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const frame = (x, y) => [x, y, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND];
  const trunkAt = (rig, trace) => {
    applyFrame(rig, trace.subarray(0, 21));
    return rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  };

  it("draws a placed duck where its trace says: x towards the audience at -Z, y to its right at -X", () => {
    const rig = buildRigTree(kinematics);
    const trace = Float32Array.from([...frame(0.4, -0.6), ...frame(0.5, -0.6)]);
    placeStageDuck(rig, { trace, start: { x: 0.4, y: -0.6, yaw: 90 } }, 0);
    const at = trunkAt(rig, trace);
    expect(at.x).toBeCloseTo(0.6);
    expect(at.z).toBeCloseTo(-0.4);
    const forward = new Vector3(1, 0, 0).applyQuaternion(rig.placer.quaternion);
    expect(forward.z).toBeCloseTo(-1);
  });

  it("centres a run recorded before troupes on its own path, as it always was", () => {
    const rig = buildRigTree(kinematics);
    const trace = Float32Array.from([...frame(1, 0.3), ...frame(2, 0.3)]);
    placeStageDuck(rig, { trace, start: null }, 0);
    const at = trunkAt(rig, trace);
    expect(at.x).toBeCloseTo(0);
    expect(at.z).toBeCloseTo(0.5);
  });
});

it("rejects gait sway and vertical bounce while following deliberate travel, even when seeking", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const rig = buildRigTree(kinematics);
  const makeTrace = noisy => {
    const trace = new Float32Array(500 * 21);
    for (let i = 0; i < 500; i++) {
      const t = i * 0.02;
      trace.set([0.1 * t + (noisy ? 0.04 * Math.sin(t * Math.PI * 8) : 0),
        noisy ? 0.04 * Math.cos(t * Math.PI * 8) : 0,
        noisy ? 0.12 + 0.07 * Math.sin(t * Math.PI * 8) : 0.12,
        1, 0, 0, 0, ...STAND], i * 21);
    }
    return trace;
  };
  const quiet = makeTrace(false), moving = makeTrace(true);
  rig.placer.rotation.y = Math.PI / 2;
  rig.placer.updateMatrixWorld(true);
  const at = t => stageCameraTarget(moving, t, rig.placer);
  for (const t of [2, 2.07, 3, 4.11, 5]) {
    expect(at(t).distanceTo(stageCameraTarget(quiet, t, rig.placer))).toBeLessThan(0.002);
    expect(at(t).y).toBe(0.14);
  }
  expect(at(5).z - at(2).z).toBeCloseTo(-0.3, 2);
  const first = at(3);
  at(8);
  expect(at(3)).toEqual(first);
});
