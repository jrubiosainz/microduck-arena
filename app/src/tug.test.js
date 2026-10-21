import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { TRACE_WIDTH } from "./replay.js";
import {
  BOUT_WORDS, SIDES, buildString, entrySide, ratingLane, stringAt, toThree, tugDistance, tugDucks, tugPose, tugSpan, tugString,
} from "./tug.js";

const frame = (pos, quat) => Float32Array.from([...pos, ...quat, ...new Array(14).fill(0)]);
const A = frame([-0.5, 0.1, 0.13], [Math.cos(Math.PI / 12), 0, 0, Math.sin(Math.PI / 12)]);
const B = frame([0.6, 0.0145, 0.12], [0, 0, 0, 1]);

describe("the tug's arithmetic, as the server's", () => {
  it("carries an MJCF point into the scene", () => {
    expect(toThree([1, 2, 3])).toEqual([1, 3, -2]);
  });
  it("puts the entry west on an odd seed and east on an even one, the reference on the other end", () => {
    expect([1, 2, 3].map(entrySide)).toEqual([0, 1, 0]);
    expect(ratingLane(["tw", "te"], ["sw", "se"], { trace: "st", settle: "ss" }, { traceSeed: 2, livery: "blue", name: "@ann" })).toEqual({
      tug: "bout", ducks: [{ trace: "tw", settle: "sw", livery: "charcoal", name: "Reference" }, { trace: "te", settle: "se", livery: "blue", name: "@ann" }],
      string: { trace: "st", settle: "ss" } });
    const lane = ratingLane(["tw", "te"], null, { trace: "st" }, { traceSeed: 3, livery: "blue", name: "@ann" });
    expect(lane.ducks).toEqual([{ trace: "tw", livery: "blue", name: "@ann" }, { trace: "te", livery: "charcoal", name: "Reference" }]);
    expect(lane.string).toEqual({ trace: "st" });
    expect(ratingLane(["tw", "te"], null, { trace: "st" }, { traceSeed: 1, livery: "charcoal", name: "@nico" }).ducks[1]).toEqual(
      { trace: "te", livery: "classic", name: "Reference" });
    expect(BOUT_WORDS).toEqual({ won: "won the pull", lost: "lost the pull", draw: "draw", pit_won: "pulled it in", pit_lost: "dragged in" });
  });
  it("holds a bout from duck to duck", () => {
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
  it("tugString keeps its settle's last frames, so a string led in with cut duck settles stays in step", () => {
    const f = (v) => new Float32Array(51).fill(v);
    const cat = (...a) => Float32Array.from(a.flatMap((x) => [...x]));
    expect([...tugString({ string: { settle: cat(f(1), f(2), f(3)), trace: cat(f(9)) } }, 2)]).toEqual([...cat(f(2), f(3), f(9))]);
    expect([...tugString({ string: { trace: cat(f(9)) } }, 2)]).toEqual([...cat(f(9), f(9), f(9))]);
    expect([...stringAt(cat(f(1), f(2)), 1)]).toEqual([...f(2)]);
  });
});

describe("the tug drawn", () => {
  it("draws the string through its points, the ribbon on point 8", () => {
    const s = buildString();
    const points = new Float32Array(51).map((_, i) => (i % 3 === 0 ? -0.5 + (i / 3) / 16 : i % 3 === 2 ? 0.1 : 0));
    s.update(points);
    const rope = s.group.getObjectByName("string"), ribbon = s.group.getObjectByName("marker");
    expect(ribbon.position.toArray()).toEqual(toThree([0, 0, Math.fround(0.1)]));
    rope.geometry.computeBoundingBox();
    expect(rope.geometry.boundingBox.min.x).toBeCloseTo(-0.5, 3);   // a tube has no end caps
    expect(rope.geometry.boundingBox.max.x).toBeCloseTo(0.5, 3);
    expect(rope.geometry.boundingBox.max.z).toBeCloseTo(0.004, 6);  // the 4 mm radius: an 8 mm rope
    s.dispose();   // geometry and material freed, the group off its parent
  });
  it("frees the string: every tube it drew, its ribbon's geometry, and their paint", () => {
    const string = buildString();
    const owned = new Set(), freed = new Set();
    const watch = () => string.group.traverse((node) => node.isMesh && [node.geometry, node.material].forEach((one) => {
      owned.add(one);
      one.addEventListener("dispose", () => freed.add(one));
    }));
    const points = new Float32Array(51).map((_, i) => (i % 3 === 0 ? i / 48 : 0));
    watch();
    string.update(points);
    watch();
    string.update(points);
    watch();
    string.dispose();
    expect([...owned].filter((one) => !freed.has(one))).toEqual([]);
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
