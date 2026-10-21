import { PerspectiveCamera, Raycaster, Vector3 } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OVERRUN } from "./course.js";
import { PALETTE, colour } from "./palette.js";
import { buildGym } from "./gym.js";
import { TRACE_WIDTH } from "./replay.js";
import {
  BOUT_WORDS, RING_RISE, SIDES, buildString, buildTugCourse, cutPit, disposeTugCourse, entrySide, floorUnder, openRing, ratingLane, stringEnd,
  toThree, tugDistance, tugDucks, tugEnds, tugPose, tugSpan,
} from "./tug.js";

const TUG = {
  id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug", metric: "mean_ground_cm", rig: "legs", vote: null,
  length_m: 4, width_m: 0.8, string_m: 1, pit_m: 0.3, pit_depth_m: 0.3, string_offset: [0.026, 0.0145, 0.0324215],
  bout: { time_limit_s: 45, bouts_to_win: 2, max_bouts: 5 },
  walls: [{ name: "wall_left", pos: [0, 0.425, 0.075], half: [2, 0.025, 0.075] }, { name: "wall_right", pos: [0, -0.425, 0.075], half: [2, 0.025, 0.075] }],
};
const frame = (pos, quat) => Float32Array.from([...pos, ...quat, ...new Array(14).fill(0)]);
const A = frame([-0.5, 0.1, 0.13], [Math.cos(Math.PI / 12), 0, 0, Math.sin(Math.PI / 12)]);
const B = frame([0.6, 0.0145, 0.12], [0, 0, 0, 1]);

describe("the tug's arithmetic, as the server's", () => {
  it("a string end turns with the trunk", () => {
    [-0.4847333395016046, 0.12555736835487435, 0.1624215].forEach((v, i) => expect(stringEnd(A, TUG.string_offset)[i]).toBeCloseTo(v, 6));
    expect(toThree([1, 2, 3])).toEqual([1, 3, -2]);
  });
  it("puts the entry west on an odd seed and east on an even one, the reference on the other end", () => {
    expect([1, 2, 3].map(entrySide)).toEqual([0, 1, 0]);
    expect(ratingLane(["tw", "te"], ["sw", "se"], { traceSeed: 2, livery: "blue", name: "@ann" })).toEqual({ tug: "bout", ducks: [
      { trace: "tw", settle: "sw", livery: "charcoal", name: "Reference" }, { trace: "te", settle: "se", livery: "blue", name: "@ann" }] });
    expect(ratingLane(["tw", "te"], null, { traceSeed: 3, livery: "blue", name: "@ann" }).ducks).toEqual([
      { trace: "tw", livery: "blue", name: "@ann" }, { trace: "te", livery: "charcoal", name: "Reference" }]);
    expect(ratingLane(["tw", "te"], null, { traceSeed: 1, livery: "charcoal", name: "@nico" }).ducks[1]).toEqual(
      { trace: "te", livery: "classic", name: "Reference" });
    expect(BOUT_WORDS).toEqual({ won: "won the pull", lost: "lost the pull", draw: "draw", pit_won: "pulled it in", pit_lost: "dragged in" });
  });
  it("ties the string to both necks, and holds a bout from duck to duck", () => {
    tugEnds(TUG, [A, B])[1].forEach((v, i) => expect(v).toBeCloseTo([0.574, 0, 0.1524215][i], 6));
    [A[0] - 0.15, B[0] + 0.15].forEach((v, i) => expect(tugSpan([B, A])[i]).toBeCloseTo(v, 9));
  });
  it("a bout's lanes are its two ducks, west first, each settle led in", () => {
    const trace = new Float32Array(3 * TRACE_WIDTH), settle = new Float32Array(2 * TRACE_WIDTH);
    const [duck] = tugDucks({ tug: "bout", ducks: [{ trace, settle, livery: "gold", name: "@alice" }, { trace, livery: "b", name: "E" }] });
    expect([duck.lead, duck.trace.length, duck.livery, duck.name]).toEqual([2, 5 * TRACE_WIDTH, "gold", "@alice"]);
    const bout = tugDucks({ tug: "bout", ducks: [{ trace, livery: "a", name: "W" }, { trace, livery: "b", name: "E" }] });
    expect(bout.map((d) => [d.name, d.lead])).toEqual([["W", 0], ["E", 0]]);
  });
  it("a lane stopped before its first timed step, without its settle, has no duck to draw", () => {
    const empty = new Float32Array(0);
    expect(tugDucks({ tug: "bout", ducks: [{ trace: empty, livery: "a", name: "W" }, { trace: empty, livery: "b", name: "E" }] })).toEqual([]);
    const settle = new Float32Array(2 * TRACE_WIDTH);
    expect(tugDucks({ tug: "bout", ducks: [{ trace: empty, settle, livery: "a", name: "W" }, { trace: empty, livery: "b", name: "E" }] })[0].trace.length).toBe(2 * TRACE_WIDTH);
  });
});

describe("the tug drawn", () => {
  // jsdom draws nothing: the skirt's print and the hall's signs paint into a context that takes it all.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: (ctx, key) => ctx[key] ?? (() => {}) }));
  });
  const down = (course, x, z) => {
    course.updateMatrixWorld(true);
    return new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0), 0, 2).intersectObjects(course.children.filter((node) => node.isMesh));
  };

  it("stands the ducks on the ring's canvas, open over the pit between the walls, the pit's floor deep under it", () => {
    const course = buildTugCourse(TUG);
    const floor = (x, z) => down(course, x, z).filter((hit) => ["ring", "ground"].includes(hit.object.name))[0];
    const at = (name, y) => [name, expect.closeTo(y, 6)];
    expect([floor(-0.5, 0), floor(1.9, 0.39), floor(0, 0.45)].map((hit) => [hit.object.name, hit.point.y])).toEqual([at("ring", 0), at("ring", 0), at("ring", 0)]);
    expect([floor(0, 0), floor(0.14, -0.39)].map((hit) => [hit.object.name, hit.point.y])).toEqual([at("ground", -0.3), at("ground", -0.3)]);
    const ground = course.getObjectByName("ground");
    expect(ground.geometry.parameters.width).toBe(4 + OVERRUN * 2);
    expect(course.getObjectByName("centre_line").position.x).toBe(0);
    const skirt = course.getObjectByName("skirt");
    expect(skirt.position.y + skirt.geometry.parameters.height / 2).toBeCloseTo(0, 9);
    expect(skirt.geometry.parameters.height).toBe(RING_RISE);
  });
  it("draws the walls as three ropes each, at their places, the top one at their height", () => {
    const sides = buildTugCourse(TUG).children.filter((node) => node.name === "ropes");
    expect(sides.map((side) => side.position.z)).toEqual([-0.425, 0.425]);
    for (const side of sides) {
      expect(side.children.map((rope) => rope.position.y)).toEqual([0.05, 0.1, 0.15].map((y) => expect.closeTo(y, 9)));
      expect(side.children.every((rope) => rope.geometry.parameters.height === 4)).toBe(true);
    }
  });
  it("leaves out the ropes between a low camera and the ducks, and only those", () => {
    const course = buildTugCourse(TUG);
    const sides = () => course.children.filter((node) => node.name === "ropes").map((side) => side.visible);
    const camera = new PerspectiveCamera();
    camera.position.set(-0.4, 0.4, 1.6); // the chase: the near ropes would cross the ducks' legs
    openRing(course, camera);
    expect(sides()).toEqual([true, false]);
    camera.position.set(-0.4, 1.6, 2.4); // high and wide: they run under the ducks' feet
    openRing(course, camera);
    expect(sides()).toEqual([true, true]);
  });
  it("the floor under the feet is the pit's own over the pit, the platforms' either side of it", () => {
    expect([-0.5, -0.149, 0, 0.149, 0.151].map((x) => floorUnder(TUG, x))).toEqual([0, -0.3, -0.3, -0.3, 0]);
  });
  it("stretches the string between its ends and hangs the marker in the middle", () => {
    const string = buildString();
    string.update([-0.5, 0, 0.15], [0.5, 0, 0.15]);
    const rope = string.group.getObjectByName("string");
    expect(rope.scale.y).toBeCloseTo(1, 9);
    [0, 0.15, 0].forEach((v, i) => expect(rope.position.toArray()[i]).toBeCloseTo(v, 9));
    expect(new Vector3(0, 1, 0).applyQuaternion(rope.quaternion).x).toBeCloseTo(1, 9);
    expect(string.group.getObjectByName("marker").position.toArray()).toEqual(rope.position.toArray());
  });
  it("makes the string a 4 mm rope in ink, dark against the ring's canvas and the stands behind it", () => {
    const rope = buildString().group.getObjectByName("string");
    expect(rope.geometry.parameters.radiusTop * 2).toBeCloseTo(0.004, 9);
    expect(rope.material.color.equals(colour(PALETTE.ink))).toBe(true);
  });
  it("frees a tug's course with the string on it: every geometry, material and the skirt's print", () => {
    const course = buildTugCourse(TUG);
    course.add(buildString().group);
    const owned = new Set();
    course.traverse((node) => {
      if (!node.isMesh) return;
      owned.add(node.geometry);
      for (const material of [node.material].flat()) [material, material.map].filter(Boolean).forEach((one) => owned.add(one));
    });
    const freed = new Set();
    owned.forEach((one) => one.addEventListener("dispose", () => freed.add(one)));
    disposeTugCourse(course);
    expect([...owned].filter((one) => !freed.has(one))).toEqual([]);
  });
  it("opens the hall's floor over the pit: nothing of the hall bridges it, its boards laid as before", () => {
    const image = { naturalWidth: 1, naturalHeight: 1 };
    const gym = buildGym(4, -3, 3.8, { arena: image, pollen: image, huggingFace: image }, TUG.width_m);
    gym.group.position.x = -2; // built from 0 to the length, centred on the pit as the viewer moves it
    gym.group.updateMatrixWorld(true);
    const down = (x, z) => new Raycaster(new Vector3(x, 0.5, z), new Vector3(0, -1, 0), 0, 0.8).intersectObject(gym.group);
    const boards = down(1, 1).map((hit) => hit.uv);
    expect(boards).toHaveLength(1);
    cutPit(gym.group.getObjectByName("parquet"), TUG);
    expect([down(0, 0), down(0.14, -0.39), down(-0.14, 0.39)]).toEqual([[], [], []]);
    const [after] = down(1, 1);
    [after.uv.x, after.uv.y].forEach((v, i) => expect(v).toBeCloseTo(boards[0].toArray()[i], 6)); // float32 coordinates
    expect(down(0.2, 0)).toHaveLength(1);
    expect(down(0, 1.2)).toHaveLength(2); // the court's centre line still runs beside the track
  });
});

describe("the tug filmed", () => {
  // The chase's own direction, from what it looks at to the camera: behind, above and trackside (cameraPose).
  const TOWARD = new Vector3(-0.35, 0.22, 1.324).normalize().toArray();
  // Where a point `x` along the lane from what the camera looks at lands across the frame, -1 to 1.
  const across = (distance, aspect, x) => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    camera.position.set(...TOWARD.map((v) => v * distance));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return new Vector3(x, 0, 0).project(camera).x;
  };
  it("stands back until the span fills nine tenths of the frame's width, its nearer end at the edge", () => {
    for (const aspect of [16 / 9, 1080 / 1233, 1.1]) {
      const distance = tugDistance(1.3, aspect, 42, TOWARD);
      expect(across(distance, aspect, -0.65)).toBeCloseTo(-0.9, 9);
      expect(Math.abs(across(distance, aspect, 0.65))).toBeLessThan(0.9);
    }
    expect(tugDistance(1.3, 1080 / 1233, 42, TOWARD)).toBeGreaterThan(tugDistance(1.3, 16 / 9, 42, TOWARD));
  });
  it("moves a chase out along its own direction to that distance, looking where it looked", () => {
    const pose = { position: [-0.35, 0.34, 1.324], target: [0, 0.12, 0] };
    const fitted = tugPose(pose, 1.3, 16 / 9, 42);
    expect(fitted.target).toEqual(pose.target);
    const away = new Vector3(...fitted.position).sub(new Vector3(...pose.target));
    expect(away.length()).toBeCloseTo(tugDistance(1.3, 16 / 9, 42, TOWARD), 9);
    away.normalize().toArray().forEach((v, i) => expect(v).toBeCloseTo(TOWARD[i], 9));
  });
});

describe("SIDES", () => {
  it("names the entry's two ends of the string, as arena/tug.py does", () => {
    expect(SIDES).toEqual(["west", "east"]);
  });
});
