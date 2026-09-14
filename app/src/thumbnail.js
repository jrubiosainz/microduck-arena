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
import { LANE_SPACING, buildCourse, laneOffsetZ } from "./course.js";
import { MODEL_DIR, attachMeshes, buildRigTree, loadKinematics, rigGeometries } from "./rig.js";

export const WIDTH = 480;
export const HEIGHT = 198;

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

function still(renderer, environment, { kinematics, geometries }, event, width, height) {
  const scene = new Scene();
  scene.environment = environment;
  scene.background = new Color(0x0c0c11);
  light(scene);
  scene.add(buildCourse(event, 2));

  PAIR.forEach((livery, lane) => {
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, geometries, { livery });
    rig.placer.position.z = laneOffsetZ(lane, 2, LANE_SPACING);
    // A little way down the lane, so the start line is visible behind them.
    rig.placer.position.x = (Number(event.length_m) || 1) * (0.22 + lane * 0.1);
    if (event.slope_deg) rig.placer.rotation.z = (event.slope_deg * Math.PI) / 180;
    scene.add(rig.placer);
  });

  const { position, target } = cameraFor(event.length_m);
  const camera = new PerspectiveCamera(38, width / height, 0.02, 60);
  camera.position.set(...position);
  camera.lookAt(...target);

  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/webp", 0.85);
}
