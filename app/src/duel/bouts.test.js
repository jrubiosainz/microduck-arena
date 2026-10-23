import { describe, expect, it } from "vitest";
import { LANE_COLORS, LANE_CSS } from "../course.js";
import { TRACE_WIDTH, frameCount } from "../replay.js";
import {
  LETTERS, boutClock, boutEvent, boutLanes, boutLine, boutSpan, boutTimes, points, policyColour, policyOn, verdict,
} from "./bouts.js";

const course = { gap_m: 0.3, pit_depth_m: 0.6, margin_m: 0.05 };

// A match as arena/duel_watch.py duel_summary answers it: A on deck 0 in bout
// 0, the decks swapped in bout 1, as arena/duel.py plays them.
function match(bouts) {
  return { id: "tug-of-war", title: "Tug of war", rig: "legs", names: ["alpha", "beta"], ctrl_dt: 0.02, course, bouts };
}

const bout = (fields) => ({ seed: 0, on_deck: ["alpha", "beta"], winner: null, end: "bell", time_s: 20, settle_frames: 51, ...fields });

const frames = (count, value) => new Float32Array(count * TRACE_WIDTH).fill(value);

describe("policyOn and policyColour: who stood where, in whose colour", () => {
  it("finds a deck's policy by its name, whichever way round the decks are", () => {
    const summary = match([bout({ on_deck: ["beta", "alpha"] })]);
    expect(policyOn(summary, summary.bouts[0], 0)).toBe(1);
    expect(policyOn(summary, summary.bouts[0], 1)).toBe(0);
  });

  it("gives A and B the Arena's first two lane colours, by letter", () => {
    expect(LETTERS).toEqual(["A", "B"]);
    expect(policyColour(0)).toBe(LANE_CSS[0]);
    expect(policyColour(1)).toBe(LANE_CSS[1]);
  });
});

describe("boutTimes: the horn and the decision in the replay's seconds", () => {
  it("opens the bout on the settle's last frame, and decides it time_s later", () => {
    const { horn_s, decided_s } = boutTimes(match([]), bout({ settle_frames: 51, time_s: 0.42 }));
    expect(horn_s).toBeCloseTo(1.0, 10);
    expect(decided_s).toBeCloseTo(1.42, 10);
  });

  it("never puts either before the replay's start", () => {
    expect(boutTimes(match([]), bout({ settle_frames: 0, time_s: 0 }))).toEqual({ horn_s: 0, decided_s: 0 });
  });
});

describe("boutEvent: a bout as the viewer's event", () => {
  it("builds the duel's venue from the match's course, with the bout's horn, decision and result", () => {
    const summary = match([bout({}), bout({ on_deck: ["beta", "alpha"], winner: 1, end: "pit", time_s: 0.5 })]);
    const event = boutEvent(summary, 1);
    expect(event).toMatchObject({ course: "duel", id: "tug-of-war", title: "Tug of war", rig: "legs", winner: 1, end: "pit" });
    expect(event.duel).toBe(course);
    expect(event.horn_s).toBeCloseTo(1.0, 10);
    expect(event.decided_s).toBeCloseTo(1.5, 10);
    expect(event.span).toBeNull();
  });

  it("spans the stretch of the course its lanes' ducks cover, for the camera to keep in the picture", () => {
    const summary = match([bout({ settle_frames: 3 })]);
    const lanes = boutLanes(summary, 0, [frames(3, -0.5), frames(3, 0.5)], [frames(4, -1.25), frames(4, 0.25)]);
    expect(boutEvent(summary, 0, lanes).span).toEqual([-1.25, 0.5]);
  });
});

describe("boutSpan: how far along x a bout's ducks go", () => {
  it("takes the farthest either trunk goes either way, and nothing else in a frame", () => {
    const left = frames(5, -0.5);
    left[2 * TRACE_WIDTH] = -1.25;
    left[3 * TRACE_WIDTH + 1] = -9;
    const right = frames(5, 0.5);
    right[4 * TRACE_WIDTH] = 0.75;
    right[TRACE_WIDTH + 2] = 9;
    expect(boutSpan([{ trace: left }, { trace: right }])).toEqual([-1.25, 0.75]);
  });

  it("has nothing to go by without frames", () => {
    expect(boutSpan([{ trace: new Float32Array(0) }])).toBeNull();
    expect(boutSpan([])).toBeNull();
  });
});

describe("boutLanes: a bout's two ducks, deck 0's first", () => {
  it("dresses each policy in its own livery and colour, wherever it stands", () => {
    const summary = match([bout({}), bout({ on_deck: ["beta", "alpha"] })]);
    const settles = [frames(51, 0), frames(51, 1)];
    const traces = [frames(10, 2), frames(10, 3)];
    const [left, right] = boutLanes(summary, 1, settles, traces);
    expect(left).toMatchObject({ name: "beta", livery: "blue", colour: LANE_COLORS[1], opacity: 1 });
    expect(right).toMatchObject({ name: "alpha", livery: "classic", colour: LANE_COLORS[0], opacity: 1 });
  });

  it("leads each lane in on its own deck's settle, so the trace starts at the horn", () => {
    const summary = match([bout({ settle_frames: 51 })]);
    const [left, right] = boutLanes(summary, 0, [frames(51, 0), frames(51, 1)], [frames(10, 2), frames(10, 3)]);
    expect(frameCount(left.trace)).toBe(61);
    expect(left.trace[50 * TRACE_WIDTH]).toBe(0);
    expect(left.trace[51 * TRACE_WIDTH]).toBe(2);
    expect(right.trace[50 * TRACE_WIDTH]).toBe(1);
    expect(right.trace[51 * TRACE_WIDTH]).toBe(3);
  });
});

describe("boutLine and verdict: what the referee said", () => {
  const summary = match([]);

  it("calls a fall into the pit for the duck left standing, by letter and by name", () => {
    const fell = bout({ on_deck: ["beta", "alpha"], winner: 1, end: "pit", time_s: 0.42 });
    expect(boutLine(summary, fell)).toBe("A won: B into the pit at 0.42 s");
    expect(verdict(summary, fell)).toEqual({
      stamp: "Wins", colour: LANE_CSS[0], deck: 1, line: "alpha wins: beta fell into the pit",
    });
  });

  it("calls both ducks in the pit a draw", () => {
    const both = bout({ end: "pit", time_s: 1.5 });
    expect(boutLine(summary, both)).toBe("Both into the pit at 1.50 s: a draw");
    expect(verdict(summary, both)).toEqual({ stamp: "Draw", colour: null, deck: null, line: "Both fell into the pit: a draw" });
  });

  it("calls a duck down on its deck for the one left on its feet, or a draw if both went down", () => {
    const down = bout({ winner: 0, end: "fall", time_s: 0.32 });
    expect(boutLine(summary, down)).toBe("A won: B down at 0.32 s");
    expect(verdict(summary, down)).toEqual({ stamp: "Wins", colour: LANE_CSS[0], deck: 0, line: "alpha wins: beta went down" });
    const both = bout({ end: "fall", time_s: 12.4 });
    expect(boutLine(summary, both)).toBe("Both down at 12.40 s: a draw");
    expect(verdict(summary, both)).toEqual({ stamp: "Draw", colour: null, deck: null, line: "Both went down: a draw" });
  });

  it("calls the bell for whoever pulled the rope their way, or a draw", () => {
    const won = bout({ winner: 0 });
    expect(boutLine(summary, won)).toBe("A won at the bell");
    expect(verdict(summary, won)).toEqual({ stamp: "Wins", colour: LANE_CSS[0], deck: 0, line: "alpha wins at the bell" });
    expect(boutLine(summary, bout({}))).toBe("A draw at the bell");
    expect(verdict(summary, bout({}))).toEqual({ stamp: "Draw", colour: null, deck: null, line: "A draw at the bell" });
  });

  it("calls a diverged simulation void, with nobody's colour", () => {
    const void_ = bout({ end: "void", time_s: 3.2 });
    expect(boutLine(summary, void_)).toBe("Void at 3.20 s: the simulation diverged");
    expect(verdict(summary, void_)).toMatchObject({ stamp: "Void", colour: null, deck: null });
  });
});

describe("boutClock: the seconds since the horn", () => {
  const summary = match([]);
  const fell = bout({ settle_frames: 51, end: "pit", winner: 0, time_s: 0.5 });

  it("shows nothing before the horn", () => {
    expect(boutClock(summary, fell, 0.4)).toBe(0);
  });

  it("counts from the horn, and stops where the referee decided", () => {
    expect(boutClock(summary, fell, 1.25)).toBeCloseTo(0.25, 10);
    expect(boutClock(summary, fell, 2.9)).toBe(0.5);
  });
});

describe("points: a total as the scoreboard shows it", () => {
  it("keeps whole points whole and shows a half", () => {
    expect(points(3)).toBe("3");
    expect(points(0)).toBe("0");
    expect(points(2.5)).toBe("2.5");
  });
});
