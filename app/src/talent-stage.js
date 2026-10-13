import {
  AdditiveBlending, AmbientLight, Box3, BoxGeometry, CanvasTexture, CircleGeometry, Color,
  ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  ShaderMaterial, SphereGeometry, SpotLight, SRGBColorSpace, Vector3,
} from "three";
import { crowd } from "./stadium.js";
import { buildJudges } from "./judges.js";
import { frameAt, frameCount, CTRL_DT } from "./replay.js";

const mix = (a, b, t) => a + (b - a) * t;

/** The theatre round the event's own floor (arena/manifest.py Stage.size_m): its depth runs along
 * the physics' x, towards the audience at -Z, its width along y, across X. Its centre is the
 * physics' origin, which a troupe's places are measured from. */
export function stageLayout(event) {
  const [depth, width] = event.size_m;
  return { width, depth, centre: 0, juryZ: -depth / 2 - 0.5, audienceZ: -depth / 2 - 1.25 };
}

// Rotate the complete replay, including translation, so +X forward faces the
// audience at -Z. Centre its path on the stage without changing recorded frames.
export function placeStagePerformer(rig, trace, centre) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < frameCount(trace); i++) {
    const frame = frameAt(trace, i);
    minX = Math.min(minX, frame[0]); maxX = Math.max(maxX, frame[0]);
    minY = Math.min(minY, frame[1]); maxY = Math.max(maxY, frame[1]);
  }
  rig.placer.rotation.set(0, Math.PI / 2, 0);
  rig.placer.position.set(centre + (minY + maxY) / 2, 0, (minX + maxX) / 2);
}

// A duck of a troupe stands where its trace says: the trace is in the stage's frame, its origin
// the stage's centre, turned as placeStagePerformer turns a performer to face the audience. A run
// recorded before troupes has no place of its own and is centred on its own path, as it always was.
export function placeStageDuck(rig, duck, centre) {
  if (!duck.start) {
    placeStagePerformer(rig, duck.trace, centre);
    return;
  }
  rig.placer.rotation.set(0, Math.PI / 2, 0);
  rig.placer.position.set(centre, 0, 0);
}

// A symmetric 2.4 s Hann window removes gait sway without introducing lag.
// Read the recording, not the previous render: scrubbing and video exports agree.
export function stageCameraTarget(trace, seconds, placer) {
  let x = 0, y = 0, weight = 0;
  const count = frameCount(trace);
  const sample = seconds / CTRL_DT;
  const centre = Math.floor(sample), blend = sample - centre;
  for (let i = -30; i <= 30; i++) {
    const w = 0.5 + 0.5 * Math.cos(Math.PI * i / 30);
    const index = centre + i * 2;
    const frame = frameAt(trace, Math.max(0, Math.min(count - 1, index)));
    const next = frameAt(trace, Math.max(0, Math.min(count - 1, index + 1)));
    x += mix(frame[0], next[0], blend) * w;
    y += mix(frame[1], next[1], blend) * w;
    weight += w;
  }
  const target = new Vector3(x / weight, 0, -y / weight).applyMatrix4(placer.matrixWorld);
  target.y = 0.14;
  return target;
}

// A duck stands from its feet, 0.14 m below its trunk, to its crest, 0.23 m above.
const DUCK_HEIGHTS = [-0.14, 0.23];
// How far beyond the stage's sides the auditorium's wing walls stand. A camera inside the theatre
// keeps 0.3 m inside them: past them it would look through their backs.
const WINGS = 2.5;
// Behind the jury desk's line, a camera inside the theatre stands at least as high above its target
// as it stands behind the line: over the judges, who sit 0.3 m behind it with their heads about
// 0.3 m above a duck's middle, and a metre over the front row's seats.
const CLEARANCE = 1;
// A troupe's shot is planned at this many moments past its first, up to its last.
const MOMENTS = 12;
// How far past an edge of the stage a duck's middle stands once it has left it: its own half-width
// (half the 0.3 m the loader keeps between two ducks' middles), and a little more, so that a duck
// on the rim is still part of the performance and one that went past it is no longer.
const OFF_STAGE = 0.2;
// The cycle of shots: each one's name, and when it starts and ends on the broadcast clock, in seconds.
const CYCLE = [["opening", 0, 3], ["front", 3, 7], ["three-quarter", 7, 11], ["jury", 11, 14], ["low-front", 14, 18], ["crane", 18, 24]];
// The shot of the cycle that runs at `time`; past its end, the crane holds.
const shotOf = (time) => CYCLE.find(([, , end]) => time < end) ?? CYCLE[CYCLE.length - 1];

// How far from `target` a camera on `bearing`, raised by `elevation`, stands for every duck, feet
// to crest, to keep within the lone performer's 1.18 margin of the frame's edges: what it spans
// across the view against the horizontal field, along and up the view against the vertical one,
// a duck nearer the camera than the target needing more.
function troupeReach(ducks, target, bearing, elevation, tanAcross, tanUp) {
  const sin = Math.sin(elevation), cos = Math.cos(elevation);
  let reach = 0;
  for (const duck of ducks) {
    const x = duck.x - target.x, z = duck.z - target.z;
    const across = Math.abs(x * Math.cos(bearing) + z * Math.sin(bearing));
    const along = z * Math.cos(bearing) - x * Math.sin(bearing);
    for (const height of DUCK_HEIGHTS) {
      const up = duck.y + height - target.y;
      const frame = Math.max(across / tanAcross, Math.abs(along * sin + up * cos) / tanUp) * 1.18;
      reach = Math.max(reach, frame - along * cos + up * sin);
    }
  }
  return reach;
}

// The farthest a camera on `bearing` round `target`, raised by `rise`, may stand inside the
// theatre: within the nearer wing, before the backdrop, and behind the desk's line, which runs
// `line` before the target, only over the slope: span·sin e ≥ CLEARANCE·(span·cos e·ahead − line).
function farthest(target, bearing, rise, depth, width) {
  const ahead = Math.cos(bearing), aside = Math.sin(bearing);
  const run = Math.min(
    (width / 2 + WINGS - 0.3 - Math.sign(aside) * target.x) / Math.abs(aside),
    ahead < 0 ? (depth / 2 - 0.1 - target.z) / -ahead : Infinity,
  );
  const line = target.z + depth / 2 + 0.08;
  const behind = CLEARANCE * Math.max(0, ahead) * Math.cos(rise) - Math.sin(rise);
  return Math.min(run / Math.cos(rise), behind > 0 ? CLEARANCE * line / behind : Infinity);
}

const middleOf = (ducks) =>
  ducks.length ? new Box3().setFromPoints(ducks).getCenter(new Vector3()) : new Vector3(0, 0.14, 0);

// The shot at `time` of the cycle as it frames a lone duck at `middle`: when it runs, what it
// looks at, and the camera's elevation, distance and offset over the floor.
function shotAt(time, middle, aspect, fov, depth) {
  const target = middle.clone();
  target.y = Math.max(0.14, target.y) + 0.04;
  const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, aspect));
  const fit = 0.32 / Math.sin(halfFov) * 1.18;
  const [shot, start, end] = shotOf(time);
  const u = (time - start) / (end - start);
  let angle, distance, elevation;
  if (shot === "opening") {
    angle = mix(0.3, 0.12, u);
    distance = mix(8, 6.6, u) / Math.min(1, aspect);
    elevation = mix(0.38, 0.33, u);
    target.y += 0.65;
  } else if (shot === "front") {
    angle = mix(-0.18, -0.06, u);
    distance = fit * mix(1.15, 1, u);
    elevation = 0.1;
  } else if (shot === "three-quarter") {
    angle = mix(-0.85, -0.65, u);
    distance = fit * mix(1.08, 1.18, u);
    elevation = mix(0.16, 0.12, u);
  } else if (shot === "jury") {
    angle = mix(1.85, 1.72, u);
    distance = Math.max(fit, 3.5);
    elevation = 0.24;
    target.y += 0.15;
    target.z -= 0.25;
  } else if (shot === "low-front") {
    angle = mix(0.4, 0.25, u);
    distance = fit * mix(1.15, 1, u);
    elevation = 0.06;
  } else {
    angle = mix(-0.18, -0.34, u);
    distance = mix(6.4, 8, u) / Math.min(1, aspect);
    elevation = mix(0.3, 0.4, u);
    target.y += 0.65;
  }
  const horizontal = distance * Math.cos(elevation);
  let dx = Math.sin(angle) * horizontal;
  let dz = -Math.cos(angle) * horizontal;
  // The opening and the crane look in from outside the theatre; every other camera stays inside.
  const inside = shot !== "opening" && shot !== "crane";
  if (inside) {
    // Keep low cameras between the desk and the LED wall. When a performer
    // approaches an edge, move sideways on the same radius to preserve framing.
    const z = Math.max(-depth / 2 - 0.08, Math.min(depth / 2 - 0.1, target.z + dz));
    if (z !== target.z + dz) {
      dz = z - target.z;
      dx = (dx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, horizontal * horizontal - dz * dz));
    }
  }
  return { shot, start, end, inside, target, distance, elevation, horizontal, dx, dz, bearing: Math.atan2(dx, -dz) };
}

// How an interior shot's camera films the troupe framed at each of its `moments`, the same at every
// frame so that the camera glides: null where the lone duck's camera already holds the troupe inside
// the theatre, a fiftieth of its distance to spare; else a bearing that turns steadily through the
// shot, from the lone duck's at its first frame to its last (the lone camera's slide along the desk's
// line, seen from farther, would sweep the troupe's), and the least lift above the shot's own
// elevation at which the camera, holding each moment's troupe, stays inside. Raising a camera turns
// a deep troupe's depth into height on screen, so the lift is found by stepping up until the troupe
// fits, then halving.
function shotFit(moments, aspect, fov, depth, width) {
  const tanUp = Math.tan(fov * Math.PI / 360);
  const turn = [moments[0].at.bearing, moments[MOMENTS].at.bearing];
  const fits = (lift, bearingAt) => moments.every(({ u, ducks, at }) => {
    const rise = at.elevation + lift, bearing = bearingAt(u, at);
    const span = Math.max(at.distance, troupeReach(ducks, at.target, bearing, rise, tanUp * aspect, tanUp) * 1.02);
    // A lone duck's own camera may stand exactly on a bound: a float's last bit is not past it.
    return span <= farthest(at.target, bearing, rise, depth, width) * (1 + 1e-12);
  });
  let fit = null;
  if (!fits(0, (u, at) => at.bearing)) {
    const bearingAt = (u) => mix(turn[0], turn[1], u);
    const top = Math.PI / 2 - Math.max(...moments.map(({ at }) => at.elevation));
    let low = 0, high = 0;
    if (!fits(0, bearingAt)) {
      do { low = high; high = Math.min(top, high + 0.02); } while (high < top && !fits(high, bearingAt));
      for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (fits(mid, bearingAt)) high = mid;
        else low = mid;
      }
    }
    fit = { turn, lift: high };
  }
  return fit;
}

// The shot last planned, which every frame of it asks for again: the same shot of the same troupe,
// whose `placesAt` says where it stands at any moment.
let planned = { placesAt: null, key: null };

// How the shot at `time` films the troupe, worked out once, at its first frame, from where the troupe
// stands at every moment of it, first frame to last, so that every frame of it films the same ducks
// the same way: which ducks it frames (`framed`, their indices) and how an interior shot's camera
// moves (`fit`, shotFit).
function shotPlan(time, placesAt, aspect, fov, depth, width) {
  const [shot, start, end] = shotOf(time);
  const key = JSON.stringify([shot, aspect, fov, depth, width]);
  if (planned.placesAt === placesAt && planned.key === key) return planned;
  // The shot's moments, its last just before it cuts away, and where the troupe stands at each.
  const times = Array.from({ length: MOMENTS + 1 }, (_, k) => Math.min(start + (end - start) * k / MOMENTS, end - 1e-6));
  const places = times.map(placesAt);
  // The star always, alone in its close-up. Any other duck as long as it stays on the stage: one that
  // walks or rolls off it during a shot is out of all of it, rather than jolting the camera as it goes.
  const onStage = (place) => Math.abs(place.z) <= depth / 2 + OFF_STAGE && Math.abs(place.x) <= width / 2 + OFF_STAGE;
  const framed = places[0].map((_, k) => k).filter((k) => k === 0
    || (shot !== "low-front" && places.every((troupe) => onStage(troupe[k]))));
  const moments = times.map((moment, k) => {
    const ducks = framed.map((i) => places[k][i]);
    return { u: k / MOMENTS, ducks, at: shotAt(moment, middleOf(ducks), aspect, fov, depth) };
  });
  planned = { placesAt, key, framed, fit: moments[0].at.inside ? shotFit(moments, aspect, fov, depth, width) : null };
  return planned;
}

// The broadcast clock keeps moving during clip titles, even while replay time
// is held at zero. Each camera moves within its shot; cuts are instantaneous.
// `subjects` are the ducks' places, the star first: every shot frames the troupe
// on the stage from its middle, and the star wherever it is, but the low front
// shot, the star's close-up. `placesAt` gives their places at any moment of the
// broadcast clock, so that a shot is planned once to all its troupe will do: the
// same function for as long as the troupe is the same. A troupe that holds still needs none.
export function stageCameraPose(seconds, subjects, aspect, fov, depth = 2.6, width = 3.8, placesAt = () => subjects) {
  // One cycle of shots; a clip runs past it (titles and outro around a 20 s performance), and
  // there the last shot holds rather than cutting back to the opening.
  const time = Math.min(Math.max(0, seconds), 24);
  const { framed, fit } = shotPlan(time, placesAt, aspect, fov, depth, width);
  const ducks = framed.map((k) => subjects[k]);
  const view = shotAt(time, middleOf(ducks), aspect, fov, depth);
  const { target } = view;
  const tanUp = Math.tan(fov * Math.PI / 360);
  // The opening and the crane look in from outside the theatre, and every camera inside it that
  // already holds the troupe rides the lone duck's path; both stand as far as holding every duck of
  // this frame takes. A lone duck's stands exactly where it always has: its offsets are scaled, by 1.
  if (!fit) {
    const span = Math.max(view.distance, troupeReach(ducks, target, view.bearing, view.elevation, tanUp * aspect, tanUp));
    const scale = span * Math.cos(view.elevation) / view.horizontal;
    return {
      shot: view.shot,
      position: [target.x + view.dx * scale, target.y + Math.sin(view.elevation) * span, target.z + view.dz * scale],
      target: target.toArray(),
    };
  }
  // Else the shot's own camera, turned and raised as fitted, and never past the theatre's bounds.
  const bearing = mix(fit.turn[0], fit.turn[1], (time - view.start) / (view.end - view.start));
  const rise = view.elevation + fit.lift;
  const span = Math.min(
    Math.max(view.distance, troupeReach(ducks, target, bearing, rise, tanUp * aspect, tanUp)),
    farthest(target, bearing, rise, depth, width),
  );
  const run = span * Math.cos(rise);
  return {
    shot: view.shot,
    position: [target.x + Math.sin(bearing) * run, target.y + Math.sin(rise) * span, target.z - Math.cos(bearing) * run],
    target: target.toArray(),
  };
}

function titleMap() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#070b24"; ctx.fillRect(0, 0, 1536, 512);
  ctx.textAlign = "center";
  ctx.fillStyle = "#62dfff"; ctx.font = "700 64px sans-serif";
  ctx.fillText("MICRODUCK", 768, 112);
  ctx.shadowColor = "#747dff"; ctx.shadowBlur = 28;
  ctx.fillStyle = "#ffffff"; ctx.font = "900 136px sans-serif";
  ctx.fillText("GOT A TALENT", 768, 296);
  ctx.shadowBlur = 0; ctx.fillStyle = "#efb7ff"; ctx.font = "500 40px sans-serif";
  ctx.fillText("T H E   S T A G E   I S   Y O U R S", 768, 408);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A theatre in metres, with the performance floor still at physics y=0.
 * The jury and audience face +Z; the LED proscenium is upstage at +Z. */
export function buildTalentStage(event, spectators, reachy) {
  const layout = stageLayout(event);
  const { width, depth, centre, juryZ, audienceZ } = layout;
  const group = new Group(); group.name = "talent-theatre";
  const geometries = new Set(), materials = new Set(), textures = new Set();
  function surface(color, metalness = 0, roughness = 0.6) {
    const material = new MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 0.12 });
    materials.add(material); return material;
  }
  function led(color) {
    const material = new MeshBasicMaterial({ color, toneMapped: false });
    materials.add(material); return material;
  }
  function mesh(geometry, material, position, name) {
    geometries.add(geometry);
    const object = new Mesh(geometry, material);
    object.position.set(...position); object.name = name ?? "";
    group.add(object); return object;
  }
  function box(size, position, material, name) { return mesh(new BoxGeometry(...size), material, position, name); }
  function bar(a, b, thickness, material) {
    const start = new Vector3(...a), end = new Vector3(...b);
    const object = mesh(new CylinderGeometry(thickness, thickness, start.distanceTo(end), 6),
      material, start.clone().add(end).multiplyScalar(0.5).toArray());
    object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize());
    return object;
  }
  const black = surface(0x090d1c, 0.05, 0.65), steel = surface(0x354259, 0.7, 0.3);
  const velvet = surface(0x160b29), seat = surface(0x35213e);
  const cyan = led(0x59dcff), violet = led(0x9959ff), white = led(0xdcefff), gold = led(0xffca70);
  box([width + 6, 0.08, depth + 8], [centre, -0.28, -1.5], black, "auditorium-floor");
  // Inward-facing walls keep the crane's exterior establishing view unobstructed.
  mesh(new PlaneGeometry(width + 5, 3.4), velvet, [centre, 1.45, audienceZ - 2.4], "auditorium-back");
  for (const side of [-1, 1]) {
    const x = centre + side * (width / 2 + WINGS);
    const wing = mesh(new PlaneGeometry(depth + 5, 3.4), velvet, [x, 1.45, -1.5], "auditorium-wing");
    wing.rotation.y = -side * Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      box([0.025, 1.5, 0.025], [x - side * 0.08, 1.4, 0.9 - i], i % 2 ? violet : cyan);
    }
  }
  box([width, 0.2, depth], [centre, -0.105, 0], black, "stage-plinth");
  const floor = surface(0x10172b, 0, 0.9);
  floor.envMapIntensity = 0;
  const ground = mesh(new PlaneGeometry(width, depth), floor, [centre, 0, 0], "ground");
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  for (const side of [-1, 1]) {
    box([width, 0.012, 0.025], [centre, 0.003, side * depth / 2], cyan);
    box([0.025, 0.012, depth], [centre + side * width / 2, 0.003, 0], violet);
    for (let step = 0; step < 3; step++) {
      box([0.65, 0.065, 0.18], [centre + side * (width / 2 + 0.32), -0.035 - step * 0.065, -depth / 2 - step * 0.17], black);
    }
  }
  const backZ = depth / 2 + 0.12;
  box([width + 2.4, 3.3, 0.16], [centre, 1.4, backZ + 0.3], velvet, "backdrop");
  // Nested chevrons and a field of LEDs give the wall depth without a video texture.
  for (let n = 0; n < 4; n++) {
    const extent = width / 2 + 0.65 - n * 0.24;
    for (const side of [-1, 1]) {
      const x = centre + side * extent;
      bar([x, 0.08, backZ], [x, 1.7, backZ], 0.013, n % 2 ? violet : cyan);
      bar([x, 1.7, backZ], [centre, 2.85 - n * 0.15, backZ], 0.013, n % 2 ? violet : cyan);
    }
  }
  for (let i = 0; i < 65; i++) {
    mesh(new SphereGeometry(0.008, 6, 4), i % 3 ? cyan : violet,
      [centre + ((i * 0.618034) % 1 - 0.5) * width, 0.35 + ((i * 0.414214) % 1) * 2.3, backZ + 0.04]);
  }
  const map = titleMap(); textures.add(map);
  const titleMaterial = new MeshBasicMaterial({ map, toneMapped: false }); materials.add(titleMaterial);
  const title = mesh(new PlaneGeometry(2.35, 0.78), titleMaterial, [centre, 1.68, backZ - 0.02], "talent-title");
  title.rotation.y = Math.PI;
  // Four luminous Xs above the proscenium, echoing the four seats at the desk.
  for (let i = 0; i < 4; i++) {
    const x = centre + (i - 1.5) * 0.58;
    for (const sign of [-1, 1]) bar([x - 0.11, 2.65 + sign * 0.11, backZ - 0.08],
      [x + 0.11, 2.65 - sign * 0.11, backZ - 0.08], 0.018, white);
  }
  for (const side of [-1, 1]) {
    const x = centre + side * (width / 2 + 0.4);
    for (const dx of [-0.07, 0.07]) bar([x + dx, -0.2, backZ], [x + dx, 2.95, backZ], 0.022, steel);
    for (let n = 0; n < 11; n++) bar([x - 0.07, n * 0.26, backZ], [x + 0.07, (n + 1) * 0.26, backZ], 0.012, steel);
    box([0.24, 0.66, 0.3], [x, 0.25, -depth / 2 + 0.2], black, "speaker");
  }
  for (const z of [backZ, -depth / 2]) bar([centre - width / 2 - 0.5, 2.95, z],
    [centre + width / 2 + 0.5, 2.95, z], 0.028, steel);

  const panel = buildJudges(reachy, centre * 2, -juryZ - 0.35, [], 4);
  for (const furniture of panel.group.children.filter(child => child.isMesh)) {
    if ([0x268a91, 0xd8a56a].includes(furniture.material.color.getHex())) furniture.material.color.set(0x191c32);
  }
  group.add(panel.group);
  // A black, illuminated broadcast desk wraps the existing articulated jury.
  box([1.94, 0.22, 0.035], [centre, 0.14, juryZ + 0.145], black, "jury-desk");
  box([1.98, 0.018, 0.32], [centre, 0.29, juryZ], white);
  box([1.94, 0.014, 0.04], [centre, 0.04, juryZ + 0.16], cyan);
  for (let i = 0; i < 4; i++) {
    const x = centre + (i - 1.5) * 0.45;
    for (const sign of [-1, 1]) bar([x - 0.055, 0.15 + sign * 0.055, juryZ + 0.17],
      [x + 0.055, 0.15 - sign * 0.055, juryZ + 0.17], 0.009, white);
    mesh(new CylinderGeometry(0.029, 0.033, 0.012, 16), gold, [x, 0.309, juryZ + 0.05], "judge-buzzer");
  }

  const seats = [];
  for (let row = 0; row < 6; row++) {
    const z = audienceZ - row * 0.32;
    const y = 0.3 + row * 0.12;
    box([width + 1.4, y + 0.24, 0.32], [centre, (y - 0.24) / 2, z], black);
    for (let i = 0; i < 20; i++) {
      const x = centre + (i - 9.5) * (width + 1) / 20 + (i < 10 ? -0.18 : 0.18);
      box([0.19, 0.025, 0.2], [x, y, z], seat);
      box([0.19, 0.16, 0.025], [x, y + 0.07, z - 0.11], seat);
      seats.push({ x, y: y + 0.016, z, yaw: -Math.PI / 2 });
    }
    for (const x of [centre - width / 2 - 0.55, centre + width / 2 + 0.55]) {
      box([0.04, 0.008, 0.22], [x, y + 0.015, z], gold);
    }
  }
  const audience = crowd(spectators.kinematics, spectators.geometries, seats);
  group.add(audience.group);

  group.add(new AmbientLight(0x758bbb, 0.15));
  const fill = new DirectionalLight(0xaacbff, 0.45); fill.position.set(centre, 1.5, -3); group.add(fill);
  const rim = new DirectionalLight(0xc986ff, 0.8); rim.position.set(centre, 2, backZ); group.add(rim);
  // A followspot hung at the end of the front truss: its operator keeps the
  // performer in a tight pool, and the beam shows in the haze.
  const FOLLOW_ANGLE = 0.07;
  const followSpot = new SpotLight(0xfff0da, 150, 0, FOLLOW_ANGLE, 0.3, 2);
  followSpot.name = "follow-spot";
  // Only the performer stands in its narrow cone: a shadow map cheap to redraw every frame.
  followSpot.castShadow = true;
  followSpot.shadow.mapSize.set(1024, 1024);
  followSpot.shadow.camera.far = 8;
  followSpot.shadow.bias = -0.0002;
  followSpot.position.set(centre + width / 2 + 0.45, 2.8, -depth / 2);
  group.add(followSpot, followSpot.target);
  const follow = new Object3D(); follow.position.copy(followSpot.position); group.add(follow);
  // A unit cone from its apex along +Z: scaled to the throw, it widens with the light.
  const shaftGeometry = new ConeGeometry(Math.tan(FOLLOW_ANGLE), 1, 32, 1, true)
    .translate(0, -0.5, 0).rotateX(-Math.PI / 2);
  const shaftMaterial = new ShaderMaterial({
    uniforms: { tint: { value: new Color(0xfff0da) } }, transparent: true, depthWrite: false,
    blending: AdditiveBlending, side: DoubleSide,
    vertexShader: "varying vec2 vUv; varying vec3 vNormal, vView; void main(){vUv=uv;vNormal=normalMatrix*normal;vec4 p=modelViewMatrix*vec4(position,1.0);vView=-p.xyz;gl_Position=projectionMatrix*p;}",
    // Faint at grazing angles so the cone reads as a volume, not a surface.
    fragmentShader: "varying vec2 vUv; varying vec3 vNormal, vView; uniform vec3 tint; void main(){float facing=abs(dot(normalize(vNormal),normalize(vView)));gl_FragColor=vec4(tint,0.16*pow(facing,2.0)*mix(0.45,1.0,vUv.y));}",
  });
  const headGeometry = new CylinderGeometry(0.09, 0.12, 0.5, 16).rotateX(Math.PI / 2).translate(0, 0, -0.22);
  const lensGeometry = new CircleGeometry(0.085, 20);
  [shaftGeometry, headGeometry, lensGeometry].forEach(geometry => geometries.add(geometry));
  materials.add(shaftMaterial);
  const shaft = new Mesh(shaftGeometry, shaftMaterial); shaft.name = "follow-beam";
  follow.add(shaft, new Mesh(headGeometry, black), new Mesh(lensGeometry, led(0xfff0da)));
  const _axis = new Vector3();
  // Soft additive shafts show the moving lights in the theatrical haze.
  const beamGeometry = new ConeGeometry(0.48, 2.8, 24, 1, true);
  beamGeometry.translate(0, -1.4, 0); geometries.add(beamGeometry);
  const beams = Array.from({ length: 6 }, (_, i) => {
    const color = new Color(i % 2 ? 0xb66bff : 0x47cfff);
    const material = new ShaderMaterial({
      uniforms: { tint: { value: color } }, transparent: true, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide,
      vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec2 vUv; uniform vec3 tint; void main(){gl_FragColor=vec4(tint,0.075*vUv.y*pow(sin(vUv.x*3.14159265),2.0));}",
    });
    materials.add(material);
    const pivot = new Object3D(); pivot.position.set(centre + (i - 2.5) * width / 6, 2.8, backZ - 0.2);
    const beam = new Mesh(beamGeometry, material); pivot.add(beam); group.add(pivot);
    mesh(new CylinderGeometry(0.065, 0.08, 0.16, 12), black, pivot.position.toArray(), "moving-head");
    mesh(new SphereGeometry(0.042, 8, 6), i % 2 ? violet : cyan, pivot.position.toArray());
    return pivot;
  });

  function pose(seconds, subjects, mood) {
    panel.pose(seconds, subjects); audience.pose(seconds, mood);
    followSpot.target.position.copy(subjects[0] ?? new Vector3(centre, 0.1, 0));
    // The shaft runs through the performer and sinks into the floor: long enough
    // that the highest point of its open rim is below the stage, so no rim shows.
    const source = followSpot.position;
    _axis.subVectors(followSpot.target.position, source).normalize();
    follow.lookAt(followSpot.target.position);
    shaft.scale.setScalar(source.y / (-_axis.y - Math.tan(FOLLOW_ANGLE) * Math.sqrt(1 - _axis.y ** 2)));
    beams.forEach((beam, i) => {
      beam.rotation.set(0.25 + 0.16 * Math.sin(seconds * 0.43 + i), 0,
        0.35 * Math.sin(seconds * 0.37 + i * 1.3));
    });
  }
  return {
    group, layout, pose, crowd: audience,
    dispose() {
      panel.dispose(); audience.dispose(); followSpot.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      group.removeFromParent();
    },
  };
}
