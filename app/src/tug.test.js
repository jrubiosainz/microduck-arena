import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PALETTE, colour } from "./palette.js";
import { TRACE_WIDTH } from "./replay.js";
import {
  BOUT_WORDS, SIDES, buildString, entrySide, floorUnder, ratingLane, stringEnd, toThree, tugDistance, tugDucks, tugEnds, tugPose, tugSpan,
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
  it("frees the string: its rope's and its ribbon's geometry and paint", () => {
    const string = buildString();
    const owned = [];
    string.group.traverse((node) => node.isMesh && owned.push(node.geometry, node.material));
    const freed = new Set();
    owned.forEach((one) => one.addEventListener("dispose", () => freed.add(one)));
    string.dispose();
    expect(owned.filter((one) => !freed.has(one))).toEqual([]);
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
