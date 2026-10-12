// kinematics.json -> a pose-able three.js tree.
//
// A reduced port of the sandbox's app/src/game/duck.js, keeping only what a
// replay needs: one Group per body, joints as local rotations, meshes from the
// shared GLB. Deliberately left out: colour specs, comic-ink
// outlines, and the STL fallback path — none of them matter for watching a
// recorded race, and each would be a thing to keep in sync.
//
// Three conversions have to be exactly right, because getting them wrong yields
// a duck that looks plausible and is subtly wrong:
//   1. MJCF quaternions are (w,x,y,z); three.js is (x,y,z,w).
//   2. MJCF is Z-up; three.js is Y-up. One root group compensates.
//   3. A joint rotates about its own axis on top of the body's rest orientation.

import {
  Color,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { VARIANTS, meshMaterialsFor } from "./liveries.js";

export const MODEL_DIR = "/robot";
export const MESH_DIR = `${MODEL_DIR}/meshes`;

// One kinematic tree per rig. The roller rig is not a variant of the walking
// one: it has 19 bodies rather than 15 (four passive wheels) and swaps the feet
// and soles for blades, rims and tires. It drives the SAME 14 actuated joints,
// which is why one policy contract covers both and the physics side needed no
// change — only the picture did.
export const RIG_KINEMATICS = {
  legs: `${MODEL_DIR}/kinematics.json`,
  rollers: `${MODEL_DIR}/kinematics_rollers.json`,
};

// Must match arena.constants.JOINT_NAMES, and therefore trace columns 7..21.
export const JOINT_NAMES = [
  "left_hip_yaw",
  "left_hip_roll",
  "left_hip_pitch",
  "left_knee",
  "left_ankle",
  "neck_pitch",
  "head_pitch",
  "head_yaw",
  "head_roll",
  "right_hip_yaw",
  "right_hip_roll",
  "right_hip_pitch",
  "right_knee",
  "right_ankle",
];

/** The STAND keyframe: arena/constants.py DEFAULT_POSE, in JOINT_NAMES order. */
export const STAND = [
  0, -0.08726646259971647, -0.457924, -0.00494, 0.452984,
  0.3490658503988659, 0.3490658503988659, 0, 0,
  0, 0.08726646259971647, 0.457924, 0.00494, -0.452984,
];
// The trunk's height in the keyframe: course.py's SPAWN_HEIGHT_M.
export const TRUNK_HEIGHT = 0.12;

/** MJCF (w,x,y,z) -> three.js (x,y,z,w). */
function setMjcfQuat(target, q) {
  target.set(q[1], q[2], q[3], q[0]);
}

export async function loadKinematics(rig = "legs") {
  // An unknown rig falls back to legs rather than throwing: a manifest can name
  // a rig the physics understands before the viewer has a tree for it, and a
  // wrong-looking replay beats a blank page.
  const url = RIG_KINEMATICS[rig] ?? RIG_KINEMATICS.legs;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`kinematics fetch ${response.status}`);
  return response.json();
}

/** Every mesh a kinematic tree references, deduplicated. */
export function meshNames(kinematics) {
  const names = new Set();
  for (const body of kinematics.bodies) {
    for (const geom of body.geoms ?? []) {
      if (geom.type && geom.type !== "mesh") continue;
      if (geom.mesh) names.add(geom.mesh);
    }
  }
  return [...names];
}

export function buildRigTree(kinematics) {
  // placer carries world placement (position along the lane); root carries the
  // Z-up -> Y-up correction, so lane placement never has to think about axes.
  const placer = new Group();
  placer.name = "duck_placer";
  const root = new Group();
  root.name = "duck_root";
  root.rotation.x = -Math.PI / 2;
  placer.add(root);

  const bodies = new Map();
  for (const body of kinematics.bodies) {
    const group = new Group();
    group.name = body.name;
    group.position.set(body.pos[0], body.pos[1], body.pos[2]);
    setMjcfQuat(group.quaternion, body.quat);
    bodies.set(body.name, group);
  }

  for (const body of kinematics.bodies) {
    const group = bodies.get(body.name);
    if (body.parent && bodies.has(body.parent)) bodies.get(body.parent).add(group);
    else root.add(group);
  }

  const joints = new Map();
  for (const body of kinematics.bodies) {
    const joint = body.joint;
    if (!joint || (joint.type && joint.type !== "hinge")) continue;
    joints.set(joint.name, {
      body: bodies.get(body.name),
      axis: new Vector3(...joint.axis).normalize(),
      // The rest orientation. A joint angle multiplies onto this rather than
      // replacing it, or every limb would snap to the axis frame.
      baseQuat: bodies.get(body.name).quaternion.clone(),
      range: joint.range ?? null,
    });
  }

  return { placer, root, bodies, joints };
}

const _rotation = new Quaternion();

export function setJoint(rig, name, angle) {
  const joint = rig.joints.get(name);
  if (!joint) return;
  let value = angle;
  if (joint.range) value = Math.min(joint.range[1], Math.max(joint.range[0], value));
  _rotation.setFromAxisAngle(joint.axis, value);
  joint.body.quaternion.copy(joint.baseQuat).multiply(_rotation);
}

// The lower beak, hung on a pivot in the jaw body's frame: what the booth's talkers and the
// stage's performer open.
const JAW_MESHES = new Set(["jaw.stl", "jaw_soft.stl"]);
const JAW_PIVOT = [-0.008, 0, -0.025];

/** Hang the lower beak on a pivot and return it: a positive `rotation.y` opens the beak. */
export function jawPivot(rig) {
  const body = rig.bodies.get("jaw_soft");
  const pivot = new Group();
  pivot.name = "jaw pivot";
  pivot.position.set(...JAW_PIVOT);
  for (const mesh of body.children.filter((child) => JAW_MESHES.has(child.name))) {
    mesh.position.sub(pivot.position);
    pivot.add(mesh);
  }
  body.add(pivot);
  return pivot;
}

// 36 degrees. Below it, neighbouring faces share a normal and the surface reads
// smooth; above it, the vertex is split and the edge stays an edge. The head
// dome comes out smooth and a motor bracket keeps its corners.
const CREASE = Math.PI / 5;

// One Map per loaded scene, because viewer.js memoises the scene for the life
// of the page and three lanes attach from it. Keyed weakly so nothing here
// keeps a disposed scene alive.
const _geometryCache = new WeakMap();

/**
 * The GLB's geometries, keyed by mesh filename, with normals rebuilt.
 *
 * **The GLB ships with no normals at all, on purpose.** The simulator's
 * duck.js:49 puts it plainly: "STL facet normals are omitted on purpose:
 * creased normals are rebuilt here." Skip this step and every geometry reaches
 * the renderer with a `position` attribute and nothing else — and a
 * MeshStandardMaterial with no normals has no surface direction to light
 * against, so the key, the fill, the ambient, the hemisphere and the
 * environment map ALL evaluate to zero. The robot renders as a flat black
 * silhouette that no lighting change can touch. That is not a hypothesis: it
 * cost three failed lighting fixes to find.
 */
/**
 * Crease one raw geometry, ready to render. Handles both sources — the GLB's
 * pre-welded meshes and a raw STL triangle soup — because toCreasedNormals
 * hashes vertices by POSITION and so welds internally either way.
 *
 * **There is deliberately no mergeVertices step here**, and that is worth
 * spelling out because the reference has one. Measured on the roller meshes:
 * pre-welding at 1e-4 m changes the output vertex count not at all (proving
 * toCreasedNormals already did the welding) and turns 0% dead normals into
 * 9.6% on the blade and ~5% on the ankle brackets — it collapses vertices that
 * were genuinely distinct, leaving degenerate faces whose normals cancel. Dead
 * normals render black, which is the exact bug this whole path exists to fix.
 *
 * The reference welds because it needs the WELDED geometry for a second purpose
 * this viewer does not have: rebuilding binary STL to feed MuJoCo's WASM
 * compiler (duck.js geometryToBinaryStl). Copying the weld along with the
 * crease was copying a step whose purpose did not come with it.
 */
export function creaseGeometry(raw) {
  // Stripped, not kept: STL carries per-face normals, and leaving them in place
  // makes toCreasedNormals' own hashing see every vertex as unique.
  const stripped = raw.clone();
  stripped.deleteAttribute("normal");
  stripped.deleteAttribute("uv");

  // The scale dance is not superstition. toCreasedNormals hashes vertices on a
  // fixed 0.01-unit grid; these meshes are in metres, so at native scale
  // everything within a centimetre welds into one vertex and the normals come
  // out garbage. Scaled to millimetres the grid is 10 um. Same trick, same
  // reason, as the reference.
  stripped.scale(1000, 1000, 1000);
  const creased = toCreasedNormals(stripped, CREASE);
  creased.scale(1e-3, 1e-3, 1e-3);
  return creased;
}

/**
 * Load the meshes a kinematic tree needs that the GLB does not carry.
 *
 * The roller rig's five — blades, rims, tires and its own ankle brackets — are
 * not in the shared GLB, exactly as in the simulator, which loads them from STL
 * at runtime. Fetching only what is missing keeps the walking rig at one
 * request and stops this from becoming a second copy of every mesh.
 */
export async function loadExtraGeometries(kinematics, have, { load = loadStl } = {}) {
  const missing = meshNames(kinematics).filter((name) => !have.has(name));
  const loaded = await Promise.all(
    missing.map(async (name) => {
      const raw = await load(name);
      return [name, creaseGeometry(raw)];
    }),
  );
  return new Map(loaded);
}

/** The default loader. Injectable above so the selection logic is testable. */
function loadStl(name) {
  return new STLLoader().loadAsync(`${MESH_DIR}/${name}`);
}

/** Every geometry a rig needs, GLB and STL alike, keyed by mesh filename. */
export async function rigGeometries(kinematics, glbScene, options) {
  const fromGlb = creasedGeometries(glbScene);
  const extra = await loadExtraGeometries(kinematics, fromGlb, options);
  // A fresh Map: the GLB's cache is memoised per scene and shared between rigs,
  // so merging the roller's STLs into it would hand them to the walking rig too.
  return new Map([...fromGlb, ...extra]);
}

export function creasedGeometries(glbScene) {
  const cached = _geometryCache.get(glbScene);
  if (cached) return cached;

  const byName = new Map();
  glbScene.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    // Key by userData.meshFile FIRST. The GLB stores the true filename there as
    // a glTF extra, because GLTFLoader strips dots when it builds node names:
    // "leg.stl" in the file becomes node.name "legstl" in the scene. The
    // kinematics keep the dot, so matching on node.name alone resolves NOTHING
    // — and a geom whose mesh is not found is skipped silently, so the failure
    // is an invisible duck with a clean console rather than an error.
    //
    // The reference implementation (microduck-simulator app/src/game/duck.js:62)
    // has this exact fallback chain for this exact reason. Do not "simplify" it.
    const names = [node.userData?.meshFile, node.name, node.geometry.name].filter(
      (n) => n && !byName.has(n),
    );
    if (names.length === 0) return;

    // creaseGeometry clones, so the GLB's own geometry is never touched: the
    // scene is shared across lanes and replays, and creasing in place would
    // compound. The GLB's positions are already welded, so no weld here.
    const creased = creaseGeometry(node.geometry);
    for (const name of names) byName.set(name, creased);
  });

  _geometryCache.set(glbScene, byName);
  return byName;
}

// The parts of the standing duck nobody sees from outside, measured rather
// than guessed: the whole rig drawn with a colour per part from thirty-six
// seats round it (twelve bearings, three heights), and every part under a
// fifth of a percent of its pixels from all of them. The boards, speaker and
// mouth parts are inside the head; the bearings sit inside every joint. NOT
// the motors or the battery, which on a skeletal robot are a seventh of what
// shows — the slot-based guess that dropped them left the crowd half bodied.
const HIDDEN = new Set([
  "pcb__raspberry_pi_zero_2_w.stl",
  "elec_rpi_robot_hat_pcb.stl",
  "banana_pcb_locker.stl",
  "speaker.stl",
  "motor_support.stl",
  "m12_lens_holder.stl",
  "jaw_soft.stl",
  "soft_mouth_top.stl",
  "yaw_roll_motion.stl",
  "seeed_bearing__configuration_default.stl",
  "seeed_bearing__configuration__22x16x4.stl",
]);

/**
 * Hang geometry off the rig.
 *
 * `source` is either a loaded GLTF scene — the common case, and what every
 * walking-rig caller passes — or a prepared `Map` of mesh filename to geometry,
 * which is what `rigGeometries` builds when a rig needs meshes the GLB does not
 * carry. Mesh names are the same strings as kinematics `geom.mesh`.
 */
export function attachMeshes(
  rig,
  kinematics,
  source,
  { livery = "classic", opacity = 1, skin = false } = {},
) {
  // Which part of the machine takes which material, from the simulator's own
  // mapping. Its colours are LINEAR and authored for ACES tone mapping — see
  // liveries.js — so the viewer must tone-map or every livery reads too hot.
  const slots = meshMaterialsFor(VARIANTS[livery] ?? VARIANTS.classic);
  const geometryByName = source instanceof Map ? source : creasedGeometries(source);

  for (const body of kinematics.bodies) {
    const group = rig.bodies.get(body.name);
    for (const geom of body.geoms ?? []) {
      if (geom.type && geom.type !== "mesh") continue;
      const geometry = geometryByName.get(geom.mesh);
      if (!geometry) continue;
      // The livery wins; the kinematics' own colour is the fallback for a mesh
      // the mapping does not name.
      const spec = slots[geom.mesh];
      // The skin is what a spectator across the track is: what shows. The
      // hidden parts are most of the triangles and, measured under SwiftShader,
      // ten layers of overdraw that were most of what a crowd cost a clip frame.
      if (skin && HIDDEN.has(geom.mesh)) continue;
      const material = new MeshStandardMaterial({
        color: spec
          ? new Color().setRGB(...spec.color, LinearSRGBColorSpace)
          : geom.color
            ? rgbToHex(geom.color)
            : 0xdddddd,
        roughness: spec?.roughness ?? 0.65,
        // The livery's own value, 0.3-0.35 on the mech parts. An earlier pass
        // forced this to 0 on the theory that metal with nothing to reflect
        // renders black — true in general, and not what was happening here:
        // the robot had no vertex normals, so nothing lit it by any path at
        // all. With normals rebuilt there is a real environment to reflect,
        // and the reference's values are the ones the colours were authored
        // against.
        metalness: spec?.metalness ?? 0,
        // A ghost is dimmed, never recoloured: the robot's own colours are the
        // shape of the machine, and flattening them to one tint is what made an
        // earlier version an unreadable silhouette.
        transparent: opacity < 1,
        opacity,
      });
      const mesh = new Mesh(geometry, material);
      // Named after its file, so the booth can find the jaw and hang it on a pivot.
      mesh.name = geom.mesh;
      mesh.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
      if (geom.quat) setMjcfQuat(mesh.quaternion, geom.quat);
      group.add(mesh);
    }
  }
}

function rgbToHex([r, g, b]) {
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
