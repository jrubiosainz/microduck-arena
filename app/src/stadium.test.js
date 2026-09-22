// Duck Jam's runway stadium, in the course's own frame: +x down the track, +y
// up, +z the chase camera's side of the track and -z the far side.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BoxGeometry, Matrix4, Vector3 } from "three";
import { buildCourse } from "./course.js";
import { PALETTE, SHELLS, colour } from "./palette.js";
import { GAP, attachStadium, buildCones, buildRail, buildStand, crowd, seats } from "./stadium.js";
import { TRUNK_HEIGHT, attachMeshes, buildRigTree, meshNames } from "./rig.js";

const LENGTH = 2;
const SPAN = 0.85;
const INNER = SPAN / 2 + GAP;

const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
const boxes = () => new Map(meshNames(kinematics).map((n) => [n, new BoxGeometry(0.01, 0.01, 0.01)]));
/** A palette colour as the stadium's materials carry it. */
const rgb = (paint) => {
  const { r, g, b } = colour(paint);
  return [r, g, b];
};

describe("buildStand", () => {
  it.each([
    ["far", -1],
    ["near", 1],
  ])("stacks three tiers on the %s side from the inner face out, each taller", (_, side) => {
    const stand = buildStand(LENGTH, INNER, side);
    const tiers = stand.children;
    expect(tiers).toHaveLength(3);
    let lastEdge = INNER;
    let lastHeight = 0;
    for (const tier of tiers) {
      const { width, height, depth } = tier.geometry.parameters;
      // Beyond the tier before it, on its own side of the track.
      expect(side * tier.position.z - depth / 2).toBeCloseTo(lastEdge, 9);
      expect(height).toBeGreaterThan(lastHeight);
      // Standing on the ground, the length of it.
      expect(tier.position.y).toBeCloseTo(height / 2);
      expect(width).toBeGreaterThan(LENGTH);
      expect(tier.position.x).toBeCloseTo(LENGTH / 2);
      lastEdge = side * tier.position.z + depth / 2;
      lastHeight = height;
    }
  });
});

describe("seats", () => {
  it("puts eighteen seats on top of each tier, spread along the track", () => {
    const stand = buildStand(LENGTH, INNER, -1);
    const placed = seats(LENGTH, INNER, -1);
    expect(placed).toHaveLength(54);
    for (const tier of stand.children) {
      const { height, depth } = tier.geometry.parameters;
      const row = placed.filter((seat) => Math.abs(seat.z - tier.position.z) < depth / 2);
      expect(row).toHaveLength(18);
      for (const seat of row) expect(seat.y).toBeCloseTo(height);
      const xs = row.map((seat) => seat.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(LENGTH);
    }
  });

  it("turns every seat to face the track, whichever side it is on", () => {
    // The duck walks along its +x; a seat's yaw turns that towards the track.
    for (const side of [-1, 1]) {
      for (const seat of seats(LENGTH, INNER, side)) {
        const forward = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), seat.yaw);
        expect(Math.sign(forward.z)).toBe(-side);
        expect(Math.abs(forward.x)).toBeLessThan(1e-9);
      }
    }
  });
});

describe("buildRail", () => {
  it("runs a cyan rail on nine paper posts along the track's edge", () => {
    const rail = buildRail(LENGTH, SPAN / 2, -1);
    const [bar, ...posts] = rail.children;
    expect(posts).toHaveLength(9);
    expect(bar.position.z).toBeCloseTo(-SPAN / 2);
    expect(bar.geometry.parameters.width).toBeGreaterThan(LENGTH);
    expect([bar.material.color.r, bar.material.color.g, bar.material.color.b]).toEqual(rgb(PALETTE.rail));
    for (const post of posts) {
      expect(post.position.z).toBeCloseTo(-SPAN / 2);
      expect(post.position.y).toBeLessThan(bar.position.y);
      expect([post.material.color.r, post.material.color.g, post.material.color.b]).toEqual(rgb(PALETTE.post));
    }
    const xs = posts.map((post) => post.position.x);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(LENGTH);
  });
});

describe("buildCones", () => {
  it("stands five orange cones between the rail and the stand", () => {
    const cones = buildCones(LENGTH, SPAN / 2, 1).children;
    expect(cones).toHaveLength(5);
    for (const cone of cones) {
      expect(cone.position.z).toBeGreaterThan(SPAN / 2);
      expect(cone.position.z).toBeLessThan(INNER);
      expect(cone.position.y).toBeCloseTo(cone.geometry.parameters.height / 2);
      expect([cone.material.color.r, cone.material.color.g, cone.material.color.b]).toEqual(rgb(PALETTE.cone));
    }
  });
});

describe("crowd", () => {
  const placed = [...seats(LENGTH, INNER, -1), ...seats(LENGTH, INNER, 1)];
  const SCALE = 0.8;
  // One instanced mesh per shell colour per side of the track. Seat i wears
  // shell i mod 5; which flock and instance it landed in is found by position.
  const flockOf = (audience, shell) => audience.group.children.find((mesh) => mesh.userData.shell === shell);
  const instance = (mesh, k) => {
    const matrix = new Matrix4();
    mesh.getMatrixAt(k, matrix);
    return matrix;
  };
  /** Every instance of every flock, with the seat it stands on. */
  const instances = (audience) =>
    audience.group.children.flatMap((mesh) =>
      Array.from({ length: mesh.count }, (_, k) => {
        const matrix = instance(mesh, k);
        const at = new Vector3().setFromMatrixPosition(matrix);
        const seat = placed.find((s) => Math.abs(s.x - at.x) < 1e-6 && Math.abs(s.z - at.z) < 1e-6);
        return { mesh, k, matrix, at, seat };
      }),
    );
  /** Whether some vertex of a flock wears `hex`, to a Float32's rounding. */
  const wears = (mesh, hex) => {
    const want = rgb(hex);
    const { array, count } = mesh.geometry.attributes.color;
    for (let i = 0; i < count; i += 1) {
      if (want.every((c, j) => Math.abs(c - array[3 * i + j]) < 1e-6)) return true;
    }
    return false;
  };

  it("draws each shell colour on each side as one instanced mesh, one instance per seat", () => {
    const audience = crowd(kinematics, boxes(), placed);
    expect(audience.group.children).toHaveLength(SHELLS.length * 2);
    expect(audience.group.children.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(placed.length);
    for (const mesh of audience.group.children) expect(mesh.isInstancedMesh).toBe(true);
    const all = instances(audience);
    expect(all.every(({ seat }) => seat)).toBe(true);
    expect(new Set(all.map(({ seat }) => placed.indexOf(seat))).size).toBe(placed.length);
    for (const { mesh, seat } of all) expect(mesh.userData.shell).toBe(SHELLS[placed.indexOf(seat) % SHELLS.length]);
  });

  it("keeps each side in flocks of its own, bounded, so the one behind the lens is culled", () => {
    // The near stand backs off behind the chase camera and is only seen when
    // orbiting; mixed into the far stand's flocks it would still cost its
    // vertices every frame. Split, with a sphere round its seats, three drops
    // it with the rest of what is out of frame.
    const audience = crowd(kinematics, boxes(), placed);
    for (const mesh of audience.group.children) {
      expect(mesh.frustumCulled).toBe(true);
      const mine = instances(audience).filter((one) => one.mesh === mesh);
      const sides = new Set(mine.map(({ seat }) => Math.sign(seat.z)));
      expect(sides.size).toBe(1);
      const sphere = mesh.boundingSphere;
      expect(sphere).not.toBeNull();
      for (const { at } of mine) expect(sphere.containsPoint(at)).toBe(true);
    }
  });

  it("paints Duck Jam's duck: the shell its colour, the face orange, the feet yellow, the rest paper", () => {
    const audience = crowd(kinematics, boxes(), placed);
    for (const shell of SHELLS) {
      const mesh = flockOf(audience, shell);
      expect(mesh.material.vertexColors).toBe(true);
      expect(wears(mesh, shell)).toBe(true);
      expect(wears(mesh, PALETTE.face)).toBe(true);
      expect(wears(mesh, PALETTE.feet)).toBe(true);
      expect(wears(mesh, PALETTE.frame)).toBe(true);
      // No other flock's shell — jaune bec excepted, since every duck's feet wear it.
      for (const other of SHELLS) {
        if (other !== shell && other !== PALETTE.feet) expect(wears(mesh, other)).toBe(false);
      }
    }
  });

  it("is lit flat and left out of the tone mapping, so the colours come out as printed", () => {
    const audience = crowd(kinematics, boxes(), placed);
    for (const mesh of audience.group.children) {
      expect(mesh.material.isMeshLambertMaterial).toBe(true);
      expect(mesh.material.toneMapped).toBe(false);
    }
  });

  it("stands each duck on its own seat, at four fifths of its size, facing its seat's way", () => {
    const audience = crowd(kinematics, boxes(), placed);
    for (const { matrix, at, seat } of instances(audience)) {
      expect(at.y).toBeGreaterThanOrEqual(seat.y);
      expect(at.y).toBeLessThanOrEqual(seat.y + 0.05 + 1e-6);
      const scale = new Vector3().setFromMatrixScale(matrix);
      // Instance matrices are Float32: six places is what they hold.
      expect(scale.x).toBeCloseTo(SCALE, 6);
      expect(scale.y).toBeCloseTo(SCALE, 6);
      expect(scale.z).toBeCloseTo(SCALE, 6);
      // Towards the track, give or take the sway.
      const forward = new Vector3(1, 0, 0).transformDirection(matrix);
      expect(Math.sign(forward.z)).toBe(Math.sign(-seat.z));
      expect(Math.abs(forward.z)).toBeGreaterThan(Math.cos(0.21));
    }
  });

  it("fuses the duck upright in the seat's frame, feet at the origin", () => {
    // The fused geometry is the whole rig at rest — Y up, trunk at
    // TRUNK_HEIGHT, feet on the ground — so the seat matrix has only to put
    // its origin on the tier. Bake the parts' matrices short of the root's
    // Z-up correction and the whole crowd lies on its back.
    const audience = crowd(kinematics, boxes(), placed);
    const { geometry } = audience.group.children[0];
    geometry.computeBoundingBox();
    expect(geometry.boundingBox.max.y).toBeGreaterThan(TRUNK_HEIGHT * 1.5);
    expect(geometry.boundingBox.min.y).toBeLessThan(0.05);
    expect(geometry.boundingBox.min.y).toBeGreaterThan(-0.02);
  });

  it("poses on the clock it is given, the same second the same crowd", () => {
    const audience = crowd(kinematics, boxes(), placed);
    const mesh = audience.group.children[0];
    audience.pose(1.3);
    const first = Float32Array.from(mesh.instanceMatrix.array);
    audience.pose(2.0);
    expect(Float32Array.from(mesh.instanceMatrix.array)).not.toEqual(first);
    audience.pose(1.3);
    expect(Float32Array.from(mesh.instanceMatrix.array)).toEqual(first);
  });

  it("bounces five centimetres, twelve radians a second", () => {
    // Duck Jam's 7 rad/s and 3.6 cm read from its high seat, over the near
    // stand; from the arena's low chase the crowd is smaller and further, and
    // that fidget did not read as moving at all.
    const audience = crowd(kinematics, boxes(), placed);
    const mesh = audience.group.children[0];
    const step = 0.005;
    const heights = [];
    for (let t = 0; t < 2; t += step) {
      audience.pose(t);
      heights.push(new Vector3().setFromMatrixPosition(instance(mesh, 0)).y);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(0.05, 3);
    // A full bounce every 2π/12 s: that far from one peak to the next.
    const peaks = heights.flatMap((y, i) => (i > 0 && i < heights.length - 1 && y > heights[i - 1] && y >= heights[i + 1] ? [i * step] : []));
    expect(peaks.length).toBeGreaterThan(2);
    for (let k = 1; k < peaks.length; k += 1) expect(peaks[k] - peaks[k - 1]).toBeCloseTo((2 * Math.PI) / 12, 2);
  });

  it("sways a fifth of a radian either way", () => {
    const audience = crowd(kinematics, boxes(), placed);
    const mesh = audience.group.children[0];
    const yaws = [];
    for (let t = 0; t < 3; t += 0.005) {
      audience.pose(t);
      const forward = new Vector3(1, 0, 0).transformDirection(instance(mesh, 0));
      yaws.push(Math.atan2(forward.x, forward.z));
    }
    expect(Math.max(...yaws)).toBeCloseTo(0.2, 2);
    expect(Math.min(...yaws)).toBeCloseTo(-0.2, 2);
  });

  it("is built from the skin, not the whole machine", () => {
    // Each stand-in box is 24 vertices, so the fused count says how many parts
    // went in: exactly what attachMeshes attaches as skin (rig.test.js pins
    // which), and fewer than the machine has.
    const audience = crowd(kinematics, boxes(), placed);
    const skin = buildRigTree(kinematics);
    attachMeshes(skin, kinematics, boxes(), { skin: true });
    let attached = 0;
    skin.root.traverse((n) => {
      if (n.isMesh) attached += 1;
    });
    const parts = kinematics.bodies.flatMap((b) => (b.geoms ?? []).map((g) => g.mesh));
    expect(attached).toBeLessThan(parts.length);
    expect(audience.group.children[0].geometry.attributes.position.count).toBe(24 * attached);
  });

  it("disposes its meshes, materials and fused geometries, never the geometries the lanes share", () => {
    const geometries = boxes();
    for (const geometry of geometries.values()) vi.spyOn(geometry, "dispose");
    const audience = crowd(kinematics, geometries, placed);
    const spies = audience.group.children.flatMap((mesh) => [
      vi.spyOn(mesh.material, "dispose"),
      vi.spyOn(mesh.geometry, "dispose"),
      vi.spyOn(mesh, "dispose"),
    ]);
    audience.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    for (const geometry of geometries.values()) expect(geometry.dispose).not.toHaveBeenCalled();
  });
});

describe("attachStadium", () => {
  const spectators = () => ({ kinematics, geometries: boxes() });
  const inner = (stand) => {
    const first = stand.children[0];
    return Math.abs(first.position.z) - first.geometry.parameters.depth / 2;
  };

  it("hangs both stands, rails, cones and the crowd on the course, sized from the ground it drew", () => {
    // Three lanes widen the ground; the stadium reads that width off the
    // course rather than recomputing it, so the two can never disagree.
    const course = buildCourse({ length_m: LENGTH }, 3);
    const span = course.getObjectByName("ground").geometry.parameters.height;
    expect(span).toBeGreaterThan(2);
    const audience = attachStadium(course, spectators(), 0);
    const stands = course.children.filter((child) => child.name === "stand");
    expect(stands).toHaveLength(2);
    for (const stand of stands) expect(inner(stand)).toBeCloseTo(span / 2 + GAP, 9);
    expect(course.children.filter((child) => child.name === "rail")).toHaveLength(2);
    expect(course.children.filter((child) => child.name === "cones")).toHaveLength(2);
    expect(audience.group.parent).toBe(course);
    expect(audience.group.children.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(108);
  });

  it("backs the whole near side off behind the camera, Duck Jam's layout kept between its pieces", () => {
    // The chase camera lives on the +z side at 1.3 m and more, exactly where
    // Duck Jam's near rail and stand go, and a rail between the lens and the
    // racers hides their feet. The viewer says how far out the camera stands;
    // the near stand starts beyond that, and its rail and cones move with it.
    // The far side is not moved.
    const course = buildCourse({ length_m: LENGTH }, 1);
    attachStadium(course, spectators(), 2.0);
    const side = (name, sign) =>
      course.children.find((child) => child.name === name && Math.sign(child.children[0].position.z) === sign);
    expect(inner(side("stand", -1))).toBeCloseTo(SPAN / 2 + GAP, 9);
    expect(side("rail", -1).children[0].position.z).toBeCloseTo(-SPAN / 2, 9);
    expect(inner(side("stand", 1))).toBeCloseTo(2.0, 9);
    expect(side("rail", 1).children[0].position.z).toBeCloseTo(2.0 - GAP, 9);
    for (const cone of side("cones", 1).children) {
      expect(cone.position.z).toBeGreaterThan(2.0 - GAP);
      expect(cone.position.z).toBeLessThan(2.0);
    }
  });

  it("rides with the course, so it tilts with a slope and leaves with a re-race", () => {
    const course = buildCourse({ length_m: LENGTH, slope_deg: 8 }, 1);
    attachStadium(course, spectators(), 0);
    course.updateMatrixWorld(true);
    const stand = course.children.find((child) => child.name === "stand");
    const far = new Vector3(LENGTH, 0, 0).applyMatrix4(stand.matrixWorld);
    expect(far.y).toBeCloseTo(LENGTH * Math.sin((8 * Math.PI) / 180), 6);
  });
});
