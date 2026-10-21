import { readFileSync } from "node:fs";
import { Box3, BoxGeometry, Matrix4, Raycaster, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { meshNames } from "./rig.js";
import { APRON, buildTugVenue } from "./tug-venue.js";

// The served ring (Task 2): twelve rope capsules, three a side, and four posts, in world metres, z up.
const widerRing = (event, ring) => {
  const h = ring / 2;
  const sides = {
    west: [[-h, -h], [-h, h]], east: [[h, -h], [h, h]], north: [[-h, h], [h, h]], south: [[-h, -h], [h, -h]],
  };
  const ropes = Object.entries(sides).flatMap(([side, [[x0, y0], [x1, y1]]]) =>
    [0.06, 0.12, 0.18].map((z, i) => ({ name: `rope_${side}_${i}`, from: [x0, y0, z], to: [x1, y1, z], radius: 0.006 })));
  const posts = [["nw", -h, h], ["ne", h, h], ["sw", -h, -h], ["se", h, -h]]
    .map(([corner, x, y]) => ({ name: `post_${corner}`, from: [x, y, 0], to: [x, y, 0.23], radius: 0.022 }));
  return { ...event, ring_m: ring, ropes, posts };
};
const TUG = widerRing({ pit_m: 0.3, pit_depth_m: 0.3 }, 3);
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
    expect([down(-0.5, 0), down(1.4, 1.4), down(0, 1.55)]).toEqual([at("ring", 0), at("ring", 0), at("ring", 0)]);
    expect([down(0, 0), down(0.14, -1.45)]).toEqual([at("pit_floor", -0.3), at("pit_floor", -0.3)]);
  });

  it("draws the ring's ropes and posts where the physics has them", () => {
    const built = venue();
    const box = (name) => new Box3().setFromObject(built.group.getObjectByName(name));
    expect(box("ropes").max.y).toBeCloseTo(0.18 + 0.006, 6);
    expect(box("ropes").min.y).toBeCloseTo(0.06 - 0.006, 6);
    expect(box("ropes").max.x).toBeCloseTo(1.5 + 0.006, 3);
    expect(box("posts").max.y).toBeCloseTo(0.23, 6);
    expect(box("ring").max.x).toBeCloseTo(1.5 + APRON, 6);
    built.dispose();
  });

  it("follows a ring of another size", () => {
    const built = buildTugVenue(widerRing(TUG, 3.6), spectators(), reachy, branding, 2.5);
    expect(new Box3().setFromObject(built.group.getObjectByName("ropes")).max.x).toBeCloseTo(1.8 + 0.006, 3);
    built.dispose();
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
    expect(Math.max(...far.map((s) => s.z))).toBeGreaterThan(-3);
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
