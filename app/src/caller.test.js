// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildCaller } from "./caller.js";

const LIGHTS = { green_s: [0.6, 2.4], red_s: [1.6, 2.0], turn_s: 0.4, tolerance_m: 0.03 };
const LENGTH = 2.5;
const EDGE = 0.4;

describe("red light, green light's caller", () => {
  let model;
  beforeAll(async () => {
    const bytes = readFileSync("public/robot/reachy-mini/reachy-mini.glb");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    model = (await new GLTFLoader().parseAsync(buffer, "")).scene;
  });

  const robotOf = (caller) => caller.group.getObjectByName("caller-robot");
  const forward = (caller) => new Vector3(1, 0, 0).applyQuaternion(robotOf(caller).quaternion);
  const lamps = (caller) => ["red-lamp", "green-lamp", "light-strip"]
    .map((name) => caller.group.getObjectByName(name).material.color.getHex());

  it("stands a full-scale Reachy Mini past the finish line, out of every lane's way", () => {
    const caller = buildCaller(model, LIGHTS, LENGTH, EDGE);
    const robot = robotOf(caller);
    expect(robot.scale.toArray()).toEqual([1, 1, 1]);
    for (const seconds of [0, 1.0, 1.4]) {
      caller.pose(seconds);
      caller.group.updateMatrixWorld(true);
      expect(new Box3().setFromObject(robot).min.x).toBeGreaterThan(LENGTH + 0.06);
    }
    caller.group.traverse((node) => {
      if (node.isMesh && !node.material.isMeshBasicMaterial) {
        expect(node.castShadow).toBe(true);
        expect(node.receiveShadow).toBe(true);
      }
    });
    caller.dispose();
  });

  it("turns its back on green and faces the lanes on red, round by the camera's side", () => {
    const caller = buildCaller(model, LIGHTS, LENGTH, EDGE);
    caller.pose(0.3);
    expect(forward(caller).x).toBeCloseTo(1);
    caller.pose(0.8);
    expect(forward(caller).z).toBeCloseTo(1);
    caller.pose(1.2);
    expect(forward(caller).x).toBeCloseTo(-1);
    caller.pose(2.6);
    expect(forward(caller).x).toBeCloseTo(1);
    caller.dispose();
  });

  it("lights green from the start, red while the light is red, and neither before", () => {
    const caller = buildCaller(model, LIGHTS, LENGTH, EDGE);
    const [redOff, greenOff, unlit] = lamps(caller);
    caller.pose(0.3);
    const [redOnGreen, greenOn, stripOnGreen] = lamps(caller);
    caller.pose(1.2);
    const [redOn, greenOnRed, stripOnRed] = lamps(caller);
    expect([redOnGreen, greenOnRed]).toEqual([redOff, greenOff]);
    expect(greenOn).not.toBe(greenOff);
    expect(redOn).not.toBe(redOff);
    // The strip along the lanes shows whichever lamp is lit.
    expect([stripOnGreen, stripOnRed]).toEqual([greenOn, redOn]);
    caller.pose(-0.5);
    expect(lamps(caller)).toEqual([redOff, greenOff, unlit]);
    caller.dispose();
  });

  it("runs its strip along the far edge of the lanes, from the start line to the post", () => {
    const caller = buildCaller(model, LIGHTS, LENGTH, EDGE);
    const bounds = new Box3().setFromObject(caller.group.getObjectByName("light-strip"));
    expect(bounds.min.x).toBeCloseTo(0);
    expect(bounds.max.x).toBeGreaterThan(LENGTH);
    expect(bounds.max.z).toBeLessThan(-EDGE);
    caller.dispose();
  });

  it("holds its antennas still while it watches, and only then", () => {
    const caller = buildCaller(model, LIGHTS, LENGTH, EDGE);
    const antenna = robotOf(caller).getObjectByName("antenna_right");
    const sway = (seconds) => { caller.pose(seconds); return antenna.rotation.x; };
    expect([1.1, 1.3, 1.5].map(sway)).toEqual([0, 0, 0]);
    expect([0.1, 0.25, 0.4].map(sway).some((x) => x !== 0)).toBe(true);
    caller.dispose();
  });

  it("frees what it built and leaves the shared official model whole", () => {
    const caller = buildCaller(model, LIGHTS, LENGTH, EDGE);
    const shared = [];
    model.traverse((node) => { if (node.isMesh) shared.push(vi.spyOn(node.geometry, "dispose")); });
    const own = caller.group.children.filter((node) => node.isMesh).map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
    caller.dispose();
    shared.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    own.forEach((dispose) => expect(dispose).toHaveBeenCalled());
  });
});
