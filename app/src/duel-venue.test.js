// @vitest-environment node
// The tug of war's venue, in the course's frame as the viewer lays every course
// out: +x from deck 0 over the pit to deck 1, +y up from the hall's floor, +z
// the camera's side and -z the jury's.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, Group, Vector3 } from "three";
import { ROPE_RADIUS, buildDuelVenue, duelCamera, duelDirection, duelLayout, isDuel, ropeSag } from "./duel-venue.js";
import { buildRigTree } from "./rig.js";
import { TRACE_WIDTH, applyFrame } from "./replay.js";

// arena/duels/tug-of-war.toml's course, as duel_watch.py duel_summary serves it.
const COURSE = {
  gap_m: 0.5,
  length_m: 2.0,
  width_m: 0.8,
  wall_height_m: 0.15,
  wall_thickness_m: 0.05,
  deck_thickness_m: 0.1,
  pit_depth_m: 0.6,
  start_x_m: 0.5,
  rope_length_m: 1.015,
  harness_height_m: 0.025,
  drop_m: 0.1,
  margin_m: 0.05,
};
const event = (more = {}) => ({ course: "duel", id: "tug-of-war", duel: COURSE, ...more });
const bounds = (object) => new Box3().setFromObject(object);
const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));

/** A trace frame: a duck standing at (x, y, z) in the duel's world, turned `yaw` about its up. */
function frameAt(x, y, z, yaw) {
  const frame = new Float32Array(TRACE_WIDTH);
  frame.set([x, y, z, Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)]);
  return frame;
}

/** Where a duck's harness is in the world: arena/duel.py's site on its trunk. */
function harness(rig) {
  const trunk = rig.bodies.get("trunk_base");
  trunk.updateWorldMatrix(true, false);
  return trunk.localToWorld(new Vector3(0, 0, COURSE.harness_height_m));
}

describe("duelLayout", () => {
  it("lays the decks out either side of the pit, as high as the pit is deep", () => {
    const layout = duelLayout(COURSE);
    expect(layout.length).toBeCloseTo(4.5);
    expect(layout.decks).toEqual([[0, 2], [2.5, 4.5]]);
    expect(layout.lift).toBeCloseTo(0.6);
    // The trace's world frame: the middle of the pit, at the decks' tops.
    expect(layout.origin).toEqual([2.25, 0.6, 0]);
  });
  it("sets the stadium out from beyond the walls, or from the decks without them", () => {
    expect(duelLayout(COURSE).edge).toBeCloseTo(0.4 + 0.05 + 0.25);
    expect(duelLayout({ ...COURSE, wall_height_m: 0 }).edge).toBeCloseTo(0.4 + 0.25);
  });
});

describe("isDuel", () => {
  it("knows a duel's event from a race's", () => {
    expect(isDuel(event())).toBe(true);
    expect(isDuel({ id: "sprint-2m", length_m: 2 })).toBe(false);
    expect(isDuel(null)).toBe(false);
  });
});

describe("ropeSag", () => {
  it("hangs a slack rope no deeper than it could fold, and a taut one not at all", () => {
    const length = COURSE.rope_length_m;
    expect(ropeSag(length, length)).toBe(0);
    expect(ropeSag(1.3, length)).toBe(0);
    for (let distance = 0.01; distance < length; distance += 0.01) {
      const sag = ropeSag(distance, length);
      expect(sag).toBeGreaterThan(0);
      expect(sag).toBeLessThanOrEqual(0.25);
      // The V the rope would make, folded at its middle.
      expect(sag).toBeLessThan(Math.sqrt(length ** 2 - distance ** 2) / 2);
    }
    // At the start, the harnesses a metre apart: 7.5 cm.
    expect(ropeSag(1.0, length)).toBeCloseTo(0.075, 3);
  });
});

describe("buildDuelVenue", () => {
  it("puts the decks' tops at their height and their ends where the physics has them", () => {
    const venue = buildDuelVenue(event());
    const decks = [0, 1].map((d) => bounds(venue.group.getObjectByName(`deck-${d}`)));
    decks.forEach((deck) => expect(deck.max.y).toBeCloseTo(0.6));
    expect([decks[0].min.x, decks[0].max.x, decks[1].min.x, decks[1].max.x]).toEqual([0, 2, 2.5, 4.5].map((x) => expect.closeTo(x)));
    expect(venue.length).toBeCloseTo(4.5);
    venue.dispose();
  });

  it("gives the stadium a ground the length of the course and its overrun, the floor's span wide", () => {
    const venue = buildDuelVenue(event());
    const ground = venue.group.getObjectByName("ground");
    expect(ground.geometry.parameters.width).toBeCloseTo(4.5 + 0.8);
    expect(ground.geometry.parameters.height).toBeCloseTo(2 * venue.edge);
    expect(ground.position.x).toBeCloseTo(2.25);
    venue.dispose();
  });

  it("stands nothing under the decks' inner halves, where the rope drags a fallen duck", () => {
    const venue = buildDuelVenue(event());
    venue.group.updateMatrixWorld(true);
    const under = (deck) => deck.max.y > 0.01 && deck.min.y < 0.6 - 0.1 - 1e-6;
    let checked = 0;
    venue.group.traverse((node) => {
      if (!node.isMesh || ["rope", "ribbon"].includes(node.name)) return;
      const box = bounds(node);
      // The dais stands behind the decks, the jury's side of the floor.
      if (!under(box) || box.max.z < -0.45 || box.min.z > 0.45) return;
      checked++;
      expect(box.max.x < 1 || box.min.x > 3.5).toBe(true);
    });
    // The legs, two pairs a deck.
    expect(checked).toBe(8);
    venue.dispose();
  });

  it("lifts the jury's dais to the decks' height, behind the floor and deep enough for its chairs", () => {
    const venue = buildDuelVenue(event());
    venue.group.updateMatrixWorld(true);
    const dais = bounds(venue.group.getObjectByName("dais"));
    expect(dais.max.y).toBeCloseTo(0.6);
    expect(dais.max.z).toBeLessThan(-venue.edge);
    // judges.js seats the jury edge + 0.59 back, on chairs 0.22 deep with a back behind them.
    expect(dais.min.z).toBeLessThan(-(venue.edge + 0.59 + 0.13));
    expect(venue.lift).toBeCloseTo(0.6);
    venue.dispose();
  });

  it("watches from a fixed camera on the near side, square to the pit", () => {
    const venue = buildDuelVenue(event());
    expect(venue.camera).toEqual(duelCamera(duelLayout(COURSE)));
    expect(venue.camera.kind).toBe("fixed");
    expect(venue.camera.position[0]).toBeCloseTo(2.25);
    expect(venue.camera.target[0]).toBeCloseTo(2.25);
    expect(venue.camera.position[2]).toBeGreaterThan(venue.edge);
    // Above the decks, looking down into the pit's mouth.
    expect(venue.camera.position[1]).toBeGreaterThan(venue.camera.target[1]);
    expect(venue.camera.target[1]).toBeGreaterThan(0.6);
    venue.dispose();
  });

  it("ties the rope to both ducks' harnesses, hangs it while slack and draws it taut", () => {
    const venue = buildDuelVenue(event());
    const rigs = [buildRigTree(kinematics), buildRigTree(kinematics)];
    rigs.forEach((rig) => venue.place(rig));
    // arena/duel.py's start: back to back across the pit, 0.12 m up.
    applyFrame(rigs[0], frameAt(-0.5, 0, 0.12, Math.PI));
    applyFrame(rigs[1], frameAt(0.5, 0, 0.12, 0));
    venue.pose(rigs);
    const rope = venue.group.getObjectByName("rope");
    const ends = rigs.map(harness);
    expect(ends[0].toArray()).toEqual([1.75, 0.745, 0].map((v) => expect.closeTo(v, 4)));
    rope.geometry.computeBoundingBox();
    let box = rope.geometry.boundingBox;
    expect(box.min.x).toBeCloseTo(ends[0].x, 1);
    expect(box.max.x).toBeCloseTo(ends[1].x, 1);
    expect(box.max.y).toBeLessThan(ends[0].y + ROPE_RADIUS + 0.001);
    // Slack, it hangs ropeSag below its ends.
    expect(box.min.y).toBeCloseTo(ends[0].y - ropeSag(1.0, COURSE.rope_length_m) - ROPE_RADIUS, 2);
    const ribbon = venue.group.getObjectByName("ribbon");
    expect(ribbon.position.x).toBeCloseTo(2.25);
    expect(ribbon.position.y).toBeLessThan(box.min.y + 0.01);
    // Pulled apart, the rope runs straight from harness to harness.
    applyFrame(rigs[1], frameAt(0.8, 0, 0.12, 0));
    venue.pose(rigs);
    box = rope.geometry.boundingBox;
    expect(box.min.y).toBeGreaterThan(ends[0].y - ROPE_RADIUS - 0.001);
    expect(box.max.x).toBeCloseTo(harness(rigs[1]).x, 1);
    expect(rope.visible).toBe(true);
    venue.dispose();
  });

  it("follows a duck into the pit", () => {
    const venue = buildDuelVenue(event());
    const rigs = [buildRigTree(kinematics), buildRigTree(kinematics)];
    rigs.forEach((rig) => venue.place(rig));
    applyFrame(rigs[0], frameAt(-0.4, 0, -0.5, Math.PI));
    applyFrame(rigs[1], frameAt(0.6, 0, 0.12, 0));
    venue.pose(rigs);
    const box = venue.group.getObjectByName("rope").geometry.boundingBox;
    expect(box.min.y).toBeLessThan(harness(rigs[0]).y + 0.006);
    expect(box.min.y).toBeLessThan(0.3);
    venue.dispose();
  });

  it("hides the rope with no pair of ducks to tie it to", () => {
    const venue = buildDuelVenue(event());
    venue.pose([buildRigTree(kinematics)]);
    expect(venue.group.getObjectByName("rope").visible).toBe(false);
    expect(venue.group.getObjectByName("ribbon").visible).toBe(false);
    venue.dispose();
  });

  it("disposes of everything it made, and leaves the scene", () => {
    const venue = buildDuelVenue(event());
    const scene = new Group();
    scene.add(venue.group);
    const disposals = [];
    venue.group.traverse((node) => {
      if (!node.isMesh) return;
      disposals.push(vi.spyOn(node.geometry, "dispose"));
      disposals.push(vi.spyOn(node.material.length ? node.material[0] : node.material, "dispose"));
    });
    venue.dispose();
    expect(venue.group.parent).toBe(null);
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalled());
  });
});

describe("duelDirection", () => {
  const horn = 0.5;
  const decided = 2.5;
  it("is silent before the horn and up once it has gone", () => {
    const mood = duelDirection({ horn_s: horn, decided_s: decided, winner: 0, end: "pit" });
    expect(mood(0.2).action).toBe(0);
    expect(mood(horn + 0.5).action).toBeGreaterThan(0.7);
  });
  it("cheers a win and mourns a pit both ducks went into", () => {
    for (const end of ["pit", "bell"]) {
      const won = duelDirection({ horn_s: horn, decided_s: decided, winner: 1, end })(decided + 0.2);
      expect(won.joy).toBeGreaterThan(0.9);
      expect(won.sadness).toBe(0);
    }
    const both = duelDirection({ horn_s: horn, decided_s: decided, winner: null, end: "pit" })(decided + 0.2);
    expect(both.sadness).toBeGreaterThan(0.9);
    expect(both.joy).toBe(0);
  });
  it("feels nothing about a draw at the bell or a void bout", () => {
    for (const end of ["bell", "void"]) {
      const mood = duelDirection({ horn_s: horn, decided_s: decided, winner: null, end });
      for (const second of [decided - 0.5, decided, decided + 1]) {
        expect(mood(second).joy).toBe(0);
        expect(mood(second).sadness).toBe(0);
      }
    }
  });
  it("never asks the stadium for a decision before the horn", () => {
    expect(() => duelDirection({ horn_s: 1, decided_s: 0.5, winner: 0, end: "pit" })(1)).not.toThrow();
    expect(() => duelDirection()(0)).not.toThrow();
  });
});
