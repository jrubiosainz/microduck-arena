// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, Group, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { creasedGeometries } from "./rig.js";
import { buildGiant } from "./giant.js";

const LENGTH = 6;
const duck = (giant) => giant.group.getObjectByName("duck_placer"); // the rig, not what C4 lays round it

/** Where the giant's eye is, seen from its head's own pivot. */
function lensFromPivot(giant) {
  giant.group.updateMatrixWorld(true);
  const lens = new Box3().setFromObject(giant.group.getObjectByName("lens.stl")).getCenter(new Vector3());
  return lens.sub(giant.group.getObjectByName("yaw_roll_motion").getWorldPosition(new Vector3()));
}

describe("the giant", () => {
  let model;
  beforeAll(async () => {
    const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
    const bytes = readFileSync("public/robot/microduck.glb");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const scene = (await new GLTFLoader().parseAsync(buffer, "")).scene;
    model = { kinematics, geometries: creasedGeometries(scene) };
  });
  afterEach(() => vi.restoreAllMocks());

  it("sits centred behind the line, its feet on the floor, 4.5 times a racer's height", () => {
    const giant = buildGiant(model, LENGTH);
    const box = new Box3().setFromObject(duck(giant));
    expect(box.min.x).toBeGreaterThan(LENGTH + 1);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 1);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y - box.min.y).toBeCloseTo(4.5 * 0.274, 2); // a racer's skin at STAND is 0.274 m tall
  });

  it("has its back to the lanes on green, and on red turns its head only, about half a turn over its shoulder by the camera's side", () => {
    const giant = buildGiant(model, LENGTH);
    const trunk = () => giant.group.getObjectByName("trunk_base").matrixWorld.clone();
    giant.pose(0);
    const away = lensFromPivot(giant);
    const body = trunk();
    giant.pose(1);
    const round = lensFromPivot(giant);
    expect(away.x).toBeGreaterThan(0);
    expect(round.x).toBeLessThan(0);
    expect(round.z).toBeGreaterThan(0);
    const angle = Math.acos(away.setY(0).normalize().dot(round.setY(0).normalize()));
    expect(angle).toBeGreaterThan(2.8); // head_yaw's own limit, 170°
    expect(trunk().equals(body)).toBe(true);
  });

  it("draws only the duck's skin, casting and catching shadows", () => {
    const giant = buildGiant(model, LENGTH);
    expect(duck(giant).getObjectByName("speaker.stl")).toBeUndefined();
    giant.group.traverse((node) => { if (node.isMesh) expect([node.castShadow, node.receiveShadow]).toEqual([true, true]); });
  });

  it("frees its own materials and leaves the racers' shared geometries whole", () => {
    const giant = buildGiant(model, LENGTH);
    const scene = new Group();
    scene.add(giant.group);
    const meshes = [];
    duck(giant).traverse((node) => { if (node.isMesh) meshes.push(node); });
    expect(meshes.length).toBeGreaterThan(0);
    const spies = meshes.map((mesh) => [vi.spyOn(mesh.geometry, "dispose"), vi.spyOn(mesh.material, "dispose")]);
    giant.dispose();
    expect(giant.group.parent).toBeNull();
    for (const [geometry, material] of spies) {
      expect(geometry).not.toHaveBeenCalled();
      expect(material).toHaveBeenCalledOnce();
    }
  });
});
