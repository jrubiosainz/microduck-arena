import { PerspectiveCamera, Raycaster, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { OVERRUN } from "./course.js";
import { PALETTE, colour } from "./palette.js";
import { buildGym } from "./gym.js";
import { TRACE_WIDTH } from "./replay.js";
import {
  benchForce, buildString, buildTugCourse, buildWinch, cutPit, floorUnder, forceAt, stringEnd, toThree, tugDistance, tugDucks,
  tugEnds, tugPose, tugSpan,
} from "./tug.js";

const TUG = {
  id: "tug-of-war", title: "Tug of War", category: "versus", course: "tug", metric: "mean_hold_force", rig: "legs", vote: null,
  length_m: 4, width_m: 0.8, string_m: 1, pit_m: 0.3, pit_depth_m: 0.3, string_offset: [0.026, 0.0145, 0.0324215],
  winch: [0.5, 0, 0.1524215], bench: { ramp_n_per_s: 0.25, top_n: 7 },
  walls: [{ name: "wall_left", pos: [0, 0.425, 0.075], half: [2, 0.025, 0.075] }, { name: "wall_right", pos: [0, -0.425, 0.075], half: [2, 0.025, 0.075] }],
};
// arena.tug.bench_profile(bench, "tug-of-war", 1); the forces below are arena.tug.bench_force of it.
const PROFILE = { ramp_n_per_s: 0.25, top_n: 7, jerks: [[0.4, 0.7, 2.8020456591211773], [0.4, 1.9, 2.137798647724724]] };
const frame = (pos, quat) => Float32Array.from([...pos, ...quat, ...new Array(14).fill(0)]);
const A = frame([-0.5, 0.1, 0.13], [Math.cos(Math.PI / 12), 0, 0, Math.sin(Math.PI / 12)]);
const B = frame([0.6, 0.0145, 0.12], [0, 0, 0, 1]);

describe("the tug's arithmetic, as the server's", () => {
  it("benchForce equals arena.tug.bench_force", () => {
    for (const [t, n] of [[0, 0.47062992744195403], [0.3, 0], [1, 0.9667824432317804], [12, 2.979120498892693], [29.5, 7]]) {
      expect(benchForce(PROFILE, t)).toBeCloseTo(n, 9);
    }
  });
  it("the dial reads nothing during the settle, then the winch from the clock's start", () => {
    expect([forceAt(PROFILE, 10, 26), forceAt(PROFILE, 26, 26)]).toEqual([0, benchForce(PROFILE, 0)]);
    expect(forceAt(PROFILE, 76, 26)).toBeCloseTo(0.9667824432317804, 9);
  });
  it("a string end turns with the trunk, a bench's string ends at the winch", () => {
    [-0.4847333395016046, 0.12555736835487435, 0.1624215].forEach((v, i) => expect(stringEnd(A, TUG.string_offset)[i]).toBeCloseTo(v, 6));
    expect(toThree([1, 2, 3])).toEqual([1, 3, -2]);
    expect(tugEnds(TUG, [B])[1]).toEqual(TUG.winch);
    tugEnds(TUG, [A, B])[1].forEach((v, i) => expect(v).toBeCloseTo([0.574, 0, 0.1524215][i], 6));
  });
  it("a bench lane is one duck, its settle led in; a bout's are its two, west first", () => {
    const trace = new Float32Array(3 * TRACE_WIDTH), settle = new Float32Array(2 * TRACE_WIDTH);
    const [duck] = tugDucks({ tug: "bench", trace, settle, bench: PROFILE, livery: "gold", name: "@alice" });
    expect([duck.lead, duck.trace.length, duck.livery, duck.name]).toEqual([2, 5 * TRACE_WIDTH, "gold", "@alice"]);
    const bout = tugDucks({ tug: "bout", ducks: [{ trace, livery: "a", name: "W" }, { trace, livery: "b", name: "E" }] });
    expect(bout.map((d) => [d.name, d.lead])).toEqual([["W", 0], ["E", 0]]);
  });
  it("a lane stopped before its first timed step, without its settle, has no duck to draw", () => {
    const empty = new Float32Array(0);
    expect(tugDucks({ tug: "bench", trace: empty, bench: PROFILE, livery: "gold", name: "@alice" })).toEqual([]);
    expect(tugDucks({ tug: "bout", ducks: [{ trace: empty, livery: "a", name: "W" }, { trace: empty, livery: "b", name: "E" }] })).toEqual([]);
    const settle = new Float32Array(2 * TRACE_WIDTH);
    expect(tugDucks({ tug: "bench", trace: empty, settle, bench: PROFILE, livery: "gold", name: "@alice" })[0].trace.length).toBe(2 * TRACE_WIDTH);
  });
});

describe("the tug drawn", () => {
  it("cuts the lane at the pit and lays the pit's floor deep", () => {
    const course = buildTugCourse(TUG);
    const west = course.getObjectByName("platform_west"), box = west.geometry.parameters;
    expect(west.position.y + box.height / 2).toBeCloseTo(0, 9);
    expect(west.position.x + box.width / 2).toBeCloseTo(-0.15, 9);
    expect(west.position.x - box.width / 2).toBeCloseTo(-(2 + OVERRUN), 9);
    const ground = course.getObjectByName("ground");
    expect([ground.position.y, ground.geometry.parameters.width]).toEqual([-0.3, 4 + OVERRUN * 2]);
    expect(course.getObjectByName("wall_left").position.toArray()).toEqual(toThree([0, 0.425, 0.075]));
    expect(course.getObjectByName("centre_line").position.x).toBe(0);
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
  it("makes the string a 4 mm rope in ink, dark against the cyan rail and the stands behind it", () => {
    const rope = buildString().group.getObjectByName("string");
    expect(rope.geometry.parameters.radiusTop * 2).toBeCloseTo(0.004, 9);
    expect(rope.material.color.equals(colour(PALETTE.ink))).toBe(true);
  });
  it("reads the winch's pull on its dial", () => {
    const fillText = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillText, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, stroke() {}, fill() {} });
    const winch = buildWinch(TUG);
    expect(winch.group.position.toArray()).toEqual(toThree(TUG.winch));
    winch.setForce(3.2);
    expect(fillText.mock.calls.at(-1)[0]).toBe("3.20 N");
    const once = winch.group.getObjectByName("needle").rotation.z;
    winch.setForce(6.4);
    expect(winch.group.getObjectByName("needle").rotation.z).toBeCloseTo(2 * once, 9);
  });
  it("opens the hall's floor over the pit: nothing of the hall bridges it, its boards laid as before", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: (ctx, key) => ctx[key] ?? (() => {}) }));
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
  it("holds a bench from its duck to the dial's far edge, a bout from duck to duck, room kept round each duck", () => {
    [A[0] - 0.15, TUG.winch[0] + 0.146].forEach((v, i) => expect(tugSpan(TUG, [A])[i]).toBeCloseTo(v, 9));
    [A[0] - 0.15, B[0] + 0.15].forEach((v, i) => expect(tugSpan(TUG, [B, A])[i]).toBeCloseTo(v, 9));
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
