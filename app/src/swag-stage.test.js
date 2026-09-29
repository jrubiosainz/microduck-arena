import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BoxGeometry, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildSwagStage, stageCameraPose, stageLayout, placeStagePerformer } from "./swag-stage.js";
import { applyFrame } from "./replay.js";
import { meshNames, buildRigTree, STAND, TRUNK_HEIGHT } from "./rig.js";

const subjects = [new Vector3(0.4, 0.14, 0.1)];

describe("swag broadcast camera", () => {
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
});

describe("theatre layout", () => {
  it("fits existing lane traces and future stationary performances without race markings", () => {
    for (const event of [{ id: "swag-contest", length_m: 2 }, { id: "swag-contest" }]) {
      const layout = stageLayout(event);
      expect(layout.width).toBeGreaterThan(3);
      expect(layout.depth / 2).toBeGreaterThan(0.85);
      expect(layout.juryZ).toBeLessThan(-layout.depth / 2);
      expect(layout.audienceZ).toBeLessThan(layout.juryZ - 0.5);
    }
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
    const stage = buildSwagStage({ id: "swag-contest" }, { kinematics, geometries }, reachy);
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
    expect(stage.group.getObjectByName("follow-pool").position.toArray()).toEqual([-0.3, 0.002, 0.4]);
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
