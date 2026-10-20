import { describe, expect, it } from "vitest";
import { TRACE_WIDTH } from "./replay.js";
import { benchForce, forceAt, markerX, stringEnd, toThree, tugDucks, tugEnds } from "./tug.js";

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
  it("a string end turns with the trunk, the marker is the middle, a bench's string ends at the winch", () => {
    [-0.4847333395016046, 0.12555736835487435, 0.1624215].forEach((v, i) => expect(stringEnd(A, TUG.string_offset)[i]).toBeCloseTo(v, 6));
    expect(markerX(A, B, TUG.string_offset)).toBeCloseTo(0.04463333024919769, 6);
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
});
