// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildJudges, judgeGaze } from "./judges.js";

const eye = { x: 0, y: 0.4, z: -1 };
const racers = [{ x: -0.8, y: 0.15, z: 0 }, { x: 0.8, y: 0.15, z: -0.8 }];

describe("judges' attention", () => {
  it("turns toward a competitor on either side of the table", () => {
    expect(judgeGaze(0, 0, eye, [racers[0]]).yaw).toBeLessThan(0);
    expect(judgeGaze(0, 0, eye, [racers[1]]).yaw).toBeGreaterThan(0);
    expect(judgeGaze(0, 0, eye, racers).pitch).toBeLessThan(0);
  });
  it("changes attention continuously and gives each judge an independent rhythm", () => {
    const before = judgeGaze(4.2 - 0.00001, 0, eye, racers);
    const after = judgeGaze(4.2 + 0.00001, 0, eye, racers);
    expect(Math.abs(after.yaw - before.yaw)).toBeLessThan(0.001);
    const poses = [0, 1, 2, 3].map((i) => judgeGaze(2, i, eye, racers));
    expect(new Set(poses.map((p) => p.yaw)).size).toBe(4);
    expect(new Set(poses.map((p) => p.right)).size).toBe(4);
  });
  it("is deterministic for video seeking, bounded, and works before a race", () => {
    const first = judgeGaze(3, 2, eye, racers);
    judgeGaze(90, 2, eye, racers);
    expect(judgeGaze(3, 2, eye, racers)).toEqual(first);
    for (const targets of [[], racers, [{ x: 100, y: -100, z: 1 }]]) {
      for (let t = 0; t < 30; t += 0.1) {
        const pose = judgeGaze(t, 1, eye, targets);
        expect(Math.abs(pose.yaw)).toBeLessThanOrEqual(1.05);
        expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(0.32);
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe("official Reachy Mini asset", () => {
  let model;
  beforeAll(async () => {
    const bytes = readFileSync("public/robot/reachy-mini/reachy-mini.glb");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    model = (await new GLTFLoader().parseAsync(buffer, "")).scene;
  });
  it("retains metre scale and independently articulated head and antennas", () => {
    const size = new Box3().setFromObject(model).getSize(new Vector3());
    // The official wireless antennas extend above the ~23 cm shell.
    expect(size.y).toBeGreaterThan(0.38);
    expect(size.y).toBeLessThan(0.40);
    expect(size.z).toBeGreaterThan(0.13);
    expect(size.z).toBeLessThan(0.22);
    const head = model.getObjectByName("reachy_head");
    expect(head.getObjectByName("antenna_right")).toBeTruthy();
    expect(head.getObjectByName("antenna_left")).toBeTruthy();
  });
  it("casts and receives shadows, furniture and judges alike", () => {
    const panel = buildJudges(model, 2, 0.425, []);
    const furniture = panel.group.children.filter(node => node.isMesh);
    expect(furniture.length).toBeGreaterThan(0);
    expect(furniture.every(node => node.castShadow && node.receiveShadow)).toBe(true);
    for (const robot of panel.group.children.filter(node => node.name.startsWith("judge-"))) {
      robot.traverse(node => {
        if (!node.isMesh) return;
        expect(node.castShadow).toBe(true);
        expect(node.receiveShadow).toBe(true);
      });
    }
    panel.dispose();
  });
  it("seats three full-scale judges symmetrically for the roller arena", () => {
    const panel = buildJudges(model, 2, 0.425, [], 3);
    const robots = panel.group.children.filter(child => child.name.startsWith("judge-"));
    expect(robots).toHaveLength(3);
    expect(robots.map(robot => robot.position.x)).toEqual([0.55, 1, 1.45]);
    robots.forEach(robot => expect(robot.scale.toArray()).toEqual([1, 1, 1]));
    panel.dispose();
  });
  it("seats four independent rigs outside the lanes and preserves shared assets on teardown", () => {
    const panel = buildJudges(model, 2, 1.275, [new Texture(), new Texture(), new Texture()]);
    const robots = panel.group.children.filter((child) => child.name.startsWith("judge-"));
    expect(robots).toHaveLength(4);
    for (const robot of robots) {
      const bounds = new Box3().setFromObject(robot);
      expect(bounds.min.y).toBeGreaterThanOrEqual(0.19);
      expect(bounds.max.z).toBeLessThan(-1.275);
      expect(robot.scale.toArray()).toEqual([1, 1, 1]);
      expect(robot.getObjectByName("reachy_head").position.y).toBeCloseTo(
        model.getObjectByName("reachy_head").position.y + 0.02,
      );
      const forward = new Vector3(1, 0, 0).applyQuaternion(robot.quaternion);
      expect(forward.z).toBeCloseTo(1);
    }
    panel.pose(3, racers);
    expect(robots[0].getObjectByName("reachy_head").quaternion.equals(
      robots[1].getObjectByName("reachy_head").quaternion,
    )).toBe(false);
    const disposals = [];
    model.traverse((node) => { if (node.isMesh) disposals.push(vi.spyOn(node.geometry, "dispose")); });
    panel.dispose();
    disposals.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
  });
});
