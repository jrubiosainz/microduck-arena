// A rendered picture of each course, with two robots on it.
//
// The real scene, not a drawing: the same course builder and the same rig the
// replay uses, rendered once per event into a still image. A card then shows
// what the race actually looks like rather than a diagram of it.
//
// One renderer and one asset load for the whole programme. The GLB is 1.3 MB
// and the browser has usually cached it from a previous race; building seven
// small scenes costs far less than the page it sits on.
//
// Every failure falls back to the SVG diagram. A thumbnail is a nicety; a card
// that fails to render is not, and WebGL is not available everywhere.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildCourse, laneOffsetZ, laneSpacing } from "./course.js";
import {
  MODEL_DIR, attachMeshes, buildRigTree, loadKinematics, rigGeometries, setJoint,
} from "./rig.js";

export const WIDTH = 480;
export const HEIGHT = 198;

/** The lone duck's portrait. Square, so the band can size it by height. */
export const PORTRAIT = 440;

/**
 * Mid-stride, head turned out of the walk toward whoever is looking.
 *
 * Every value is clamped to the joint's own range by setJoint, so a sign that
 * turns out to be the other way round reads as a smaller step rather than as a
 * broken duck. The default pose is a machine standing to attention, which is
 * the one thing a picture on a front page should not be.
 */
export const LIVELY_POSE = {
  left_hip_pitch: 0.42,
  left_knee: -0.34,
  left_ankle: 0.14,
  right_hip_pitch: -0.34,
  right_knee: 0.28,
  right_ankle: -0.12,
  neck_pitch: -0.12,
  head_pitch: -0.14,
  head_yaw: 0.34,
  head_roll: 0.14,
};

// The two liveries that read most distinctly against the dark ground, so the
// pair looks like a race rather than a duplicate.
const PAIR = ["classic", "blue"];

/** Where the camera sits for a course of this length. Pure, so it is testable. */
export function cameraFor(lengthM) {
  const length = Math.max(0.5, Number(lengthM) || 1);
  return {
    position: [-0.55 - length * 0.12, 0.46 + length * 0.05, 1.25 + length * 0.16],
    target: [length * 0.42, 0.1, 0],
  };
}

function light(scene) {
  scene.add(new AmbientLight(0xffffff, 0.22));
  const key = new DirectionalLight(0xffffff, 1.9);
  key.position.set(1.4, 2.6, 1.8);
  scene.add(key);
  const fill = new DirectionalLight(0xbfd2ff, 0.6);
  fill.position.set(-1.6, 1.1, -1.3);
  scene.add(fill);
  scene.add(new HemisphereLight(0xcfe0ff, 0x2b2b30, 0.14));
}

/**
 * Render one still per event. Returns a Map of event id to data URL; an event
 * missing from it simply keeps its SVG diagram.
 */
export async function renderThumbnails(events, { width = WIDTH, height = HEIGHT } = {}) {
  const out = new Map();
  let renderer;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height, false);
    renderer.toneMapping = ACESFilmicToneMapping;

    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const gltf = await new GLTFLoader().loadAsync(`${MODEL_DIR}/microduck.glb`);
    // One kinematic tree per rig, not per event: seven events share three.
    const byRig = new Map();
    for (const event of events) {
      if (byRig.has(event.rig)) continue;
      const kinematics = await loadKinematics(event.rig);
      byRig.set(event.rig, {
        kinematics,
        geometries: await rigGeometries(kinematics, gltf.scene),
      });
    }

    for (const event of events) {
      const assets = byRig.get(event.rig);
      if (!assets) continue;
      out.set(event.id, still(renderer, environment, assets, event, width, height));
    }
  } catch {
    // WebGL unavailable, assets unreachable, a context lost mid-loop — the
    // cards keep their diagrams and the page is unharmed.
  } finally {
    renderer?.dispose();
  }
  return out;
}

/**
 * One microduck, standing, on transparent ground.
 *
 * The same rig the races use — not a photograph of the robot, which would be
 * an asset to fetch, to keep and to get wrong the day the model changes. Null
 * on any failure, exactly as renderThumbnails returns an empty map: a picture
 * of the duck is a nicety and must never take the page with it.
 */
export async function renderDuckPortrait({
  size = PORTRAIT,
  rig: rigName = "legs",
  livery = "purple",
  pose = LIVELY_POSE,
} = {}) {
  let renderer;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(size, size, false);
    // Transparent, so the duck stands on the band's own grained paper rather
    // than in a box of some other colour.
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = ACESFilmicToneMapping;

    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const gltf = await new GLTFLoader().loadAsync(`${MODEL_DIR}/microduck.glb`);
    const kinematics = await loadKinematics(rigName);
    const geometries = await rigGeometries(kinematics, gltf.scene);

    const scene = new Scene();
    scene.environment = environment;
    light(scene);

    const duck = buildRigTree(kinematics);
    attachMeshes(duck, kinematics, geometries, { livery });
    for (const [joint, angle] of Object.entries(pose)) setJoint(duck, joint, angle);
    duck.placer.position.set(0, 0, 0);
    scene.add(duck.placer);

    // Three-quarter view, a little above the beak: the pose the robot is
    // photographed in on the product page.
    const camera = new PerspectiveCamera(30, 1, 0.02, 60);
    camera.position.set(0.46, 0.27, 0.6);
    camera.lookAt(0, 0.15, 0);

    renderer.render(scene, camera);
    // PNG, not WebP: the alpha has to survive, and this is one small image.
    return renderer.domElement.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    renderer?.dispose();
  }
}

/**
 * Stand a still's duck ON the course, wherever the course is tilted to.
 *
 * Parented to the COURSE, not the scene, so the slope arrives once and for
 * free: local x is distance along the ramp, local y is height above its
 * surface, and the lean comes from the parent. Positioning it in world space
 * instead meant computing the ramp's height by hand — and the first version did
 * not, so on the hill climb the duck stood at height zero while the ramp under
 * it had already climbed, sinking it into the surface.
 *
 * This is the still's counterpart to viewer.js's placeLane, and the opposite
 * mistake: a replay's frames are already world coordinates, so the replay must
 * NOT inherit the tilt, while a still has no frames and must.
 */
export function standOnCourse(rig, course, alongM, laneZ) {
  rig.placer.position.set(alongM, 0, laneZ);
  rig.placer.rotation.set(0, 0, 0);
  course.add(rig.placer);
}

function still(renderer, environment, { kinematics, geometries }, event, width, height) {
  const scene = new Scene();
  scene.environment = environment;
  scene.background = new Color(0x0c0c11);
  light(scene);
  const course = buildCourse(event, 2);
  scene.add(course);

  PAIR.forEach((livery, lane) => {
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, geometries, { livery });
    // A little way down the lane, so the start line is visible behind them.
    const along = (Number(event.length_m) || 1) * (0.22 + lane * 0.1);
    standOnCourse(rig, course, along, laneOffsetZ(lane, 2, laneSpacing(event)));
  });

  const { position, target } = cameraFor(event.length_m);
  const camera = new PerspectiveCamera(38, width / height, 0.02, 60);
  camera.position.set(...position);
  camera.lookAt(...target);

  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/webp", 0.85);
}
