import { readFileSync } from "node:fs";
import { Box3, BoxGeometry, Matrix4, Raycaster, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { meshNames } from "./rig.js";
import { buildTugVenue } from "./tug-venue.js";

const TUG = { length_m: 4, width_m: 0.8, pit_m: 0.3, pit_depth_m: 0.3 };
const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
const spectators = () => ({ kinematics, geometries: new Map(meshNames(kinematics).map((name) => [name, new BoxGeometry(0.01, 0.01, 0.01)])) });
const image = { naturalWidth: 2, naturalHeight: 1 };
const branding = { arena: image, pollen: image, huggingFace: image };

describe("the tug's venue", () => {
  let reachy;
  beforeAll(async () => {
    // jsdom draws nothing: the prints paint into a context that takes it all.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: (ctx, key) => ctx[key] ?? (() => {}) }));
    const bytes = readFileSync("public/robot/reachy-mini/reachy-mini.glb");
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    reachy = (await new GLTFLoader().parseAsync(buffer, "")).scene;
  });
  const venue = (clearance = 0) => buildTugVenue(TUG, spectators(), reachy, branding, clearance);

  it("stands the ducks on the ring's canvas, cut open by the pit from rope to rope, its floor deep under it", () => {
    const { group } = venue();
    group.updateMatrixWorld(true);
    const floors = group.children.filter((node) => ["ring", "pit_floor"].includes(node.name));
    const down = (x, z) => {
      const [hit] = new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObjects(floors);
      return [hit.object.name, hit.point.y];
    };
    const at = (name, y) => [name, expect.closeTo(y, 6)];
    expect([down(-0.5, 0), down(1.9, 1.9), down(0, 2.05)]).toEqual([at("ring", 0), at("ring", 0), at("ring", 0)]);
    expect([down(0, 0), down(0.14, -1.95)]).toEqual([at("pit_floor", -0.3), at("pit_floor", -0.3)]);
  });

  it("squares the ring on the event's length: three white ropes a side, the top one at a duck's chest", () => {
    const ropes = new Box3().setFromObject(venue().group.getObjectByName("ropes"));
    [ropes.min.x, ropes.min.z].forEach((v) => expect(v).toBeCloseTo(-2, 1));
    [ropes.max.x, ropes.max.z].forEach((v) => expect(v).toBeCloseTo(2, 1));
    expect(ropes.max.y).toBeCloseTo(0.18, 1);
  });

  it("seats a crowd on all four sides, the near one beyond the camera's clearance, the others behind the barricade", () => {
    const crowd = venue(4).group.getObjectByName("crowd");
    const seats = crowd.children.flatMap((mesh) => Array.from({ length: mesh.count }, (_, k) => {
      const at = new Matrix4();
      mesh.getMatrixAt(k, at);
      return new Vector3().setFromMatrixPosition(at);
    }));
    const near = seats.filter((s) => s.z > Math.abs(s.x));
    const far = seats.filter((s) => s.z < -Math.abs(s.x));
    const east = seats.filter((s) => s.x > Math.abs(s.z));
    const west = seats.filter((s) => s.x < -Math.abs(s.z));
    [near, far, east, west].forEach((side) => expect(side.length).toBe(seats.length / 4));
    expect(Math.min(...near.map((s) => s.z))).toBeGreaterThan(4);
    expect(Math.max(...far.map((s) => s.z))).toBeGreaterThan(-3.5);
  });

  it("frees what it built and leaves the shared Reachy model alone", () => {
    const built = venue();
    const shared = new Set();
    reachy.traverse((node) => node.isMesh && shared.add(node.geometry));
    const prints = new Set();
    built.group.traverse((node) => node.isMesh && !node.isInstancedMesh && [node.material].flat().forEach((m) => m.map && prints.add(m.map)));
    const freed = new Set();
    [...shared, ...prints].forEach((one) => one.addEventListener("dispose", () => freed.add(one)));
    built.dispose();
    expect([...prints].filter((one) => !freed.has(one))).toEqual([]);
    expect([...shared].filter((one) => freed.has(one))).toEqual([]);
    expect(built.group.parent).toBe(null);
  });
});
