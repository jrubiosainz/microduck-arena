// The tug of war's venue (arena/duel.py): two decks facing each other across a
// pit, their walls, the rope between the two harnesses, and a dais that lifts
// the jury to the decks' height. The viewer builds the rest round it as it does
// round a race's course (viewer.js setLanes) — the hall, the stands and their
// crowd, the jury — so a duel is fought in the same stadium, before the same
// spectators and the same four Reachy Minis, as every challenge on the
// programme.
//
// Laid out along three.js +x as a race's course is, from x = 0: deck 0, the pit,
// deck 1, `length` in all. arena/duel.py puts the pit's floor pit_depth_m under
// the decks' tops; here that floor is the hall's, at y = 0, so the decks stand
// `lift` = pit_depth_m high, and a trace's world frame — its origin the middle
// of the pit at the decks' height — is placed at `origin`. Everything else the
// physics has is drawn where the physics has it: the decks' tops and inner
// edges, the walls' height and thickness, the harness on each trunk.

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
} from "three";
import { stadiumDirection } from "./clip/direction.js";
import { OVERRUN } from "./course.js";
import { PALETTE, flat } from "./palette.js";
import { TRUNK_HEIGHT } from "./rig.js";

/** Whether an event is a duel's (duel/main.js makes it), for which the viewer builds this venue. */
export const isDuel = (event) => event?.course === "duel";

// Floor either side of the walls, inside the stadium's rails: the stands and
// the jury are set out from its edge, as from a race's outermost lane.
const APRON = 0.25;
// The camera, square to the pit on the near side: how far out, how high above
// the decks, and how far above them it aims. Tuned by eye on the duel page, to
// keep the decks' tops, the pit's floor and the jury in one picture, with room
// either side for a winner that backs off a metre from the pit: the sprint
// leader measured did, 0.93 m out, in the half second its rival took to fall.
const CAMERA_BACK = 2.1;
const CAMERA_RISE = 0.5;
const CAMERA_AIM = 0.02;
// What a bout's camera frames its ducks for: the narrowest picture the duel's
// page gives its stage, 1.2 wide for 1 high (its desktop hall, the stage beside
// the bouts' column), seen through the viewer's 42° (viewer.js), and how far
// beyond a trunk it keeps in view — the duck as it leans, and its nameplate.
const FRAME_ASPECT = 1.2;
const FRAME_FOV_DEG = 42;
const FRAME_MARGIN = 0.3;
// The rope as drawn: 1.4 cm thick rather than the 4 mm arena/duel.py gives
// MuJoCo's renderer, which two metres off is a pixel; at 1 cm it was still
// lost from the duel's camera against the stands behind it.
export const ROPE_RADIUS = 0.007;
const ROPE_SEGMENTS = 32;
const ROPE_SIDES = 6;
// The deepest a slack rope is drawn to hang. A duck thrown back towards the
// pit hands the rope all of its length at once, and a parabola that deep is no
// longer the shape a rope makes.
const SAG_LIMIT = 0.25;
// The ribbon tied round the rope's middle, which shows which way it is going.
const FLAG_HANG = 0.05;
// The orange edge painted along each deck's lip over the pit.
const LIP = 0.04;
// The walls' cyan cap, part of their height: the glass under it hardly shows.
const CAP = 0.01;
// The legs stand under the outer half of each deck alone, as fractions of its
// length from its outer end. arena/duel.py's rope drags a duck that has fallen
// towards its rival, under the inner half of the rival's deck: in the replays
// measured it slid 6 cm under it, and a 1.5 s tail at walking pace could take
// it half a metre. Nothing solid is drawn where a duck may be.
const LEGS = [0.08, 0.48];
const LEG = 0.05;
// The pit's mat: under the gap and this far under either deck.
const MAT_REACH = 0.5;
const MAT_HEIGHT = 0.003;
// The jury's dais: from just behind the floor's edge to behind the judges'
// chairs (judges.js seats them from `edge`), and a little wider than their
// table. On the floor, the far deck hid every judge from the camera.
const DAIS_FRONT = 0.05;
const DAIS_BACK = 0.8;
const DAIS_WIDTH = 2.1;
const BOARDS = 0.02;

// Rubber on the decks' tops, the club's teal on their sides and on the dais's
// skirt, the jury table's wood on the dais, and a rope of pale hemp: from the
// duel's camera the rope crosses in front of the dais's edge, and a rope the
// colour of its wood vanished into it.
const RUBBER = 0x2a2c31;
const TEAL = 0x268a91;
const STEEL = 0x244950;
const GLASS = 0xbfe6ef;
const MAT = 0x3a6ea5;
const WOOD = 0xd8a56a;
const ROPE = 0xf3e6c4;
const RIBBON = 0xff2fa8;

/**
 * Where everything stands, from a duel's course as `arena duel --watch` serves
 * it (duel_watch.py duel_summary): the decks, as [from, to] along x; the floor
 * `span` wide across them, walls and aprons included, whose `edge` the stadium
 * and the jury are set out from; and `origin`, where a trace's world frame
 * lands. Pure, so it is testable.
 */
export function duelLayout(course) {
  const { gap_m: gap, length_m: deck, width_m: width, pit_depth_m: lift } = course;
  const length = 2 * deck + gap;
  const walls = course.wall_height_m > 0 ? course.wall_thickness_m : 0;
  const span = width + 2 * walls + 2 * APRON;
  return {
    length,
    lift,
    span,
    edge: span / 2,
    walls,
    origin: [length / 2, lift, 0],
    decks: [[0, deck], [deck + gap, length]],
  };
}

/**
 * How far below the straight line between its ends a rope `length` long hangs
 * at its middle when the ends are `distance` apart: a shallow parabola's sag,
 * whose arc is distance + 8 sag² / (3 distance) long. Nothing once the ends
 * have drawn it taut, which is how arena/duel.py's tendon spends a bout, and
 * never deeper than SAG_LIMIT. The parabola's sag is always shallower than the
 * V the rope would make folded at its middle, so it never asks for more rope
 * than there is. Pure, so it is testable.
 */
export function ropeSag(distance, length) {
  if (!(distance < length) || !(distance > 0)) return 0;
  return Math.min(SAG_LIMIT, Math.sqrt((3 * distance * (length - distance)) / 8));
}

/** The rope from `a` to `b`, `length` long, as a curve whose middle hangs ropeSag below theirs. */
export function ropeCurve(a, b, length) {
  const control = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  // A quadratic Bézier's middle is halfway between its chord's and its control point.
  control.y -= 2 * ropeSag(a.distanceTo(b), length);
  return new QuadraticBezierCurve3(a.clone(), control, b.clone());
}

/**
 * Where the camera watches a duel from (viewer.js cameraPose): fixed for a
 * bout, square to the pit from the near side. It stands over the pit while the
 * bout's ducks keep to the middle of the course. A puller that walks its rival
 * back across its own deck takes them farther, so for a bout whose `span` —
 * the farthest either trunk goes to -x and to +x, in the trace's world frame
 * (duel/bouts.js boutSpan) — will not fit that picture, the camera moves over
 * the middle of the span, and back along its line of sight until the span fits
 * a FRAME_ASPECT picture. A drag lets it go, and the follow key brings it back.
 * Pure, so it is testable.
 */
export function duelCamera({ length, lift }, span = null) {
  const target = [length / 2, lift + CAMERA_AIM, 0];
  const ringside = { kind: "fixed", position: [length / 2, lift + CAMERA_RISE, CAMERA_BACK], target };
  if (!span) return ringside;
  // Half the picture's width, a metre down the line of sight; and that line's length at ringside.
  const reach = FRAME_ASPECT * Math.tan((FRAME_FOV_DEG * Math.PI) / 360);
  const sight = Math.hypot(CAMERA_BACK, CAMERA_RISE - CAMERA_AIM);
  const [low, high] = [span[0] - FRAME_MARGIN, span[1] + FRAME_MARGIN];
  if (-low <= sight * reach && high <= sight * reach) return ringside;
  const middle = length / 2 + (low + high) / 2;
  const back = Math.max(1, (high - low) / 2 / reach / sight);
  return {
    kind: "fixed",
    position: [middle, target[1] + back * (CAMERA_RISE - CAMERA_AIM), back * CAMERA_BACK],
    target: [middle, target[1], 0],
  };
}

/**
 * The crowd's direction over a bout (clip/direction.js stadiumDirection), in
 * the replay's seconds: up at the horn and held through the pull, then the
 * verdict as the referee gives it — a win cheered, a bout both ducks lost (into
 * the pit or down) mourned. A draw at the bell and a void bout leave it no
 * result to feel.
 */
export function duelDirection({ horn_s = 0, decided_s = 0, winner = null, end = null } = {}) {
  const start = Math.max(0, horn_s);
  const bothLost = end === "pit" || end === "fall";
  const verdict = winner === 0 || winner === 1 ? "pass" : bothLost ? "fail" : null;
  return stadiumDirection({ start, end: Math.max(start, decided_s), verdict });
}

/**
 * The venue for a duel's event (duel/main.js): `event.duel` is the course as
 * the server describes it, and the event's horn, decision, winner and end set
 * the crowd's direction. `place` stands a duck's rig where its trace's world
 * frame is; `pose` hangs the rope between the first two rigs' harnesses, once
 * a frame, after the rigs have been posed.
 */
export function buildDuelVenue(event) {
  const course = event.duel;
  const layout = duelLayout(course);
  const { length, lift, span, walls } = layout;
  const { width_m: width, deck_thickness_m: thickness, wall_height_m: wallHeight } = course;
  const group = new Group();
  group.name = "course";
  const geometries = [];
  const materials = [];
  const own = (list, thing) => {
    list.push(thing);
    return thing;
  };
  const paint = (color, options = {}) => own(materials, new MeshStandardMaterial({ color, roughness: 0.8, ...options }));
  function box(w, h, d, [x, y, z], material, shadow = true) {
    const mesh = new Mesh(own(geometries, new BoxGeometry(w, h, d)), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    group.add(mesh);
    return mesh;
  }

  // The hall's floor under the venue, which is also the pit's: the viewer lays
  // the gym's parquet on it, and the stadium reads its size (stadium.js).
  const ground = new Mesh(
    own(geometries, new PlaneGeometry(length + 2 * OVERRUN, span)),
    paint(RUBBER, { roughness: 1 }),
  );
  ground.name = "ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(length / 2, 0, 0);
  group.add(ground);

  const rubber = paint(RUBBER, { roughness: 0.95 });
  const teal = paint(TEAL, { roughness: 0.7 });
  // A box's faces, in BoxGeometry's order: +x, -x, +y, -y, +z, -z.
  const slab = [teal, teal, rubber, teal, teal, teal];
  const lip = own(materials, flat(PALETTE.cone));
  const glass = paint(GLASS, { roughness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
  const cap = own(materials, flat(PALETTE.rail));
  const steel = paint(STEEL, { roughness: 0.5, metalness: 0.4 });
  layout.decks.forEach(([from, to], d) => {
    const middle = (from + to) / 2;
    // From the lip into the deck, and from the outer end into it.
    const inward = d === 0 ? -1 : 1;
    const lipX = d === 0 ? to : from;
    const outer = d === 0 ? from : to;
    // The slab runs under the walls too: nothing stands there, and walls on
    // nothing would float.
    box(to - from, thickness, width + 2 * walls, [middle, lift - thickness / 2, 0], slab).name = `deck-${d}`;
    box(LIP, 0.002, width, [lipX + (inward * LIP) / 2, lift, 0], lip, false);
    if (walls) {
      for (const side of [-1, 1]) {
        const z = side * (width / 2 + walls / 2);
        box(to - from, wallHeight - CAP, walls, [middle, lift + (wallHeight - CAP) / 2, z], glass, false);
        box(to - from, CAP, walls, [middle, lift + wallHeight - CAP / 2, z], cap);
      }
    }
    for (const along of LEGS) {
      for (const side of [-1, 1]) {
        const x = outer - inward * along * (to - from);
        box(LEG, lift - thickness, LEG, [x, (lift - thickness) / 2, side * (width / 2 - 0.06)], steel);
      }
    }
  });

  // The pit's mat, and the line across its middle.
  const gap = course.gap_m;
  box(gap + 2 * MAT_REACH, MAT_HEIGHT, width + 2 * walls, [length / 2, MAT_HEIGHT / 2, 0], paint(MAT, { roughness: 0.9 }), false);
  box(0.02, 0.001, width + 2 * walls, [length / 2, MAT_HEIGHT + 0.0005, 0], own(materials, flat(PALETTE.paper)), false);

  // The jury's dais: the teal skirt, and boards on top at the decks' height.
  const depth = DAIS_BACK - DAIS_FRONT;
  const daisZ = -(layout.edge + (DAIS_FRONT + DAIS_BACK) / 2);
  box(DAIS_WIDTH, lift - BOARDS, depth, [length / 2, (lift - BOARDS) / 2, daisZ], teal);
  box(DAIS_WIDTH, BOARDS, depth, [length / 2, lift - BOARDS / 2, daisZ], paint(WOOD, { roughness: 0.6 })).name = "dais";

  // The rope, first where the harnesses are at the start; pose moves it.
  const harness = lift + TRUNK_HEIGHT + course.harness_height_m;
  const ends = [
    new Vector3(length / 2 - course.start_x_m, harness, 0),
    new Vector3(length / 2 + course.start_x_m, harness, 0),
  ];
  const rope = new Mesh(
    own(geometries, new TubeGeometry(ropeCurve(ends[0], ends[1], course.rope_length_m), ROPE_SEGMENTS, ROPE_RADIUS, ROPE_SIDES)),
    paint(ROPE, { roughness: 0.9 }),
  );
  rope.name = "rope";
  rope.castShadow = true;
  group.add(rope);
  const ribbon = box(0.008, FLAG_HANG, 0.03, [0, 0, 0], own(materials, flat(RIBBON)));
  ribbon.name = "ribbon";

  function hang(curve) {
    const drawn = new TubeGeometry(curve, ROPE_SEGMENTS, ROPE_RADIUS, ROPE_SIDES);
    for (const name of ["position", "normal"]) {
      const attribute = rope.geometry.getAttribute(name);
      attribute.array.set(drawn.getAttribute(name).array);
      attribute.needsUpdate = true;
    }
    drawn.dispose();
    rope.geometry.computeBoundingSphere();
    rope.geometry.computeBoundingBox();
    ribbon.position.copy(curve.getPoint(0.5));
    ribbon.position.y -= FLAG_HANG / 2;
  }
  hang(ropeCurve(ends[0], ends[1], course.rope_length_m));

  return {
    group,
    length,
    edge: layout.edge,
    lift,
    camera: duelCamera(layout, event.span),
    /** Stand a duck's rig where its trace's world frame is. */
    place(rig) {
      rig.placer.position.set(...layout.origin);
      rig.placer.rotation.set(0, 0, 0);
    },
    /** The rope between the first two rigs' harnesses, as they stand; no rope without two. */
    pose(rigs) {
      const tied = rigs.length >= 2;
      rope.visible = ribbon.visible = tied;
      if (!tied) return;
      group.updateWorldMatrix(true, false);
      for (let k = 0; k < 2; k++) {
        const trunk = rigs[k].bodies.get("trunk_base");
        trunk.updateWorldMatrix(true, false);
        group.worldToLocal(trunk.localToWorld(ends[k].set(0, 0, course.harness_height_m)));
      }
      hang(ropeCurve(ends[0], ends[1], course.rope_length_m));
    },
    direction: () => duelDirection(event),
    dispose() {
      group.removeFromParent();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
