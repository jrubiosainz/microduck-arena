// Peter and Ray in their booth: two of the viewer's rigs in the STAND pose,
// only neck and head moving, a beak on a pivot, on Duck Jam's set, lit like
// every race page. The set is authored z up under one root turned like the
// rig's own; the camera is the one thing converted from Duck Jam's frame.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { applyFrame } from "../replay.js";
import { attachMeshes, buildRigTree, setJoint } from "../rig.js";
import { loadAssets } from "../viewer.js";
import { direct } from "./direction.js";
import { poseAt } from "./score.js";
import { BOOTH_TURN, booth as buildSet, checkerboard, token } from "./set.js";

/** The STAND keyframe: arena/constants.py DEFAULT_POSE, in JOINT_NAMES order. */
export const STAND = [
  0, -0.08726646259971647, -0.457924, -0.00494, 0.452984,
  0.3490658503988659, 0.3490658503988659, 0, 0,
  0, 0.08726646259971647, 0.457924, 0.00494, -0.452984,
];
// The trunk's height in the keyframe: course.py's SPAWN_HEIGHT_M.
const TRUNK_HEIGHT = 0.12;
// Which joint holds which index of a trace frame's fourteen angles.
const HEAD = { neck: ["neck_pitch", 5], pitch: ["head_pitch", 6], yaw: ["head_yaw", 7], roll: ["head_roll", 8] };
// Where each duck stands along the desk, and which livery it wears.
const SEATS = { peter: { x: -0.16, livery: "classic" }, ray: { x: 0.16, livery: "blue" } };
// Facing the auditorium: the camera's own bearing from the desk.
const FACING = -Math.PI / 3;
// The lower beak, hung on a pivot in the jaw body's frame, as Duck Jam's articulateMouth.
const JAW_MESHES = new Set(["jaw.stl", "jaw_soft.stl"]);
const JAW_PIVOT = [-0.008, 0, -0.025];
const JAW_OPEN = 0.32;
// A glance's yaw is signed so Peter looks toward Ray and Ray toward Peter. The
// plan's sign was Duck Jam's; if the two glance away from each other here, this
// is the one line to flip.
const LOOK = 1;
const PIXEL_RATIO_CAP = 1.5;

/** A trace frame that stands at booth-local x, turned to face the camera. */
function standFrame(x) {
  const yaw = FACING;
  return Float32Array.from([
    x * Math.cos(BOOTH_TURN), x * Math.sin(BOOTH_TURN), TRUNK_HEIGHT,
    Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2),
    ...STAND,
  ]);
}

function jawPivot(rig) {
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

// Duck Jam's frame is z up; three.js is y up.
const toY = ([x, y, z]) => [x, z, -y];

export async function createBooth(canvas) {
  const { kinematics, geometries } = await loadAssets("legs");
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO_CAP));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const scene = new Scene();
  scene.environment = environment;
  scene.background = token("deep-ink");
  // The viewer's four lights; the key also throws the set's shadows.
  scene.add(new AmbientLight(0xffffff, 0.18));
  const key = new DirectionalLight(0xffffff, 1.7);
  key.position.set(1.4, 2.6, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 6 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.003;
  scene.add(key);
  const fill = new DirectionalLight(0xbfd2ff, 0.55);
  fill.position.set(-1.6, 1.1, -1.3);
  scene.add(fill);
  const rim = new DirectionalLight(0xffd9b0, 0.5);
  rim.position.set(-0.6, 0.9, 2.2);
  scene.add(rim);
  scene.add(new HemisphereLight(0xcfe0ff, 0x2b2b30, 0.12));

  // The set, z up under a root turned like the rig's duck_root.
  const root = new Group();
  root.rotation.x = -Math.PI / 2;
  scene.add(root);
  const set = buildSet();
  root.add(set);
  const floor = new Mesh(new PlaneGeometry(1.3, 0.9), new MeshLambertMaterial({ map: checkerboard() }));
  floor.rotation.z = BOOTH_TURN;
  floor.position.set(-0.04, 0.069, 0.0001);
  root.add(floor);
  // A transparent shadow receiver keeps the checkerboard's paint.
  const shade = new Mesh(floor.geometry, new ShadowMaterial({ opacity: 0.22 }));
  shade.rotation.copy(floor.rotation);
  shade.position.copy(floor.position);
  shade.position.z += 0.0001;
  shade.receiveShadow = true;
  root.add(shade);
  // The CRT's glass shows the poster of the run under discussion. A box's
  // faces are +x, -x, +y, -y, +z, -z; the screen is the -y face, toward the desk.
  const glass = set.getObjectByName("CRT glass");
  const screen = new MeshBasicMaterial({ color: token("deep-ink") });
  glass.material = [glass.material, glass.material, glass.material, screen, glass.material, glass.material];

  const actors = Object.fromEntries(
    Object.entries(SEATS).map(([speaker, seat]) => {
      const rig = buildRigTree(kinematics);
      attachMeshes(rig, kinematics, geometries, { livery: seat.livery });
      rig.placer.traverse((object) => {
        if (object.isMesh) object.castShadow = true;
      });
      const jaw = jawPivot(rig);
      scene.add(rig.placer);
      return [speaker, { rig, jaw, frame: standFrame(seat.x) }];
    }),
  );

  const camera = new PerspectiveCamera(32, 16 / 9, 0.05, 50);
  const loader = new TextureLoader();
  let plan = null;
  let cameraAt = null;
  let poster = null;

  return {
    prepare(commentary, posterUrl) {
      plan = commentary.plan;
      cameraAt = direct(plan);
      poster?.dispose();
      poster = null;
      screen.map = null;
      screen.color.copy(token("deep-ink"));
      screen.needsUpdate = true;
      loader.loadAsync(posterUrl).then((texture) => {
        if (plan !== commentary.plan) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        poster = texture;
        screen.map = texture;
        screen.color.set(0xffffff);
        screen.needsUpdate = true;
      }).catch(() => {});
    },
    draw(ms) {
      if (!plan) return null;
      const framing = cameraAt(ms, camera.aspect);
      camera.position.set(...toY(framing.position));
      camera.lookAt(...toY(framing.target));
      for (const [speaker, actor] of Object.entries(actors)) {
        const pose = poseAt(plan, speaker, ms);
        applyFrame(actor.rig, actor.frame);
        for (const [key, [joint, index]] of Object.entries(HEAD)) {
          const turn = key === "yaw" ? pose.yaw * LOOK : pose[key];
          setJoint(actor.rig, joint, actor.frame[7 + index] + turn);
        }
        actor.jaw.rotation.y = pose.mouth * JAW_OPEN;
      }
      renderer.render(scene, camera);
      return plan.captions.find((c) => c.start_ms <= ms && ms < c.end_ms) ?? null;
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      poster?.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose();
        for (const material of [].concat(object.material ?? [])) {
          material.map?.dispose();
          material.dispose();
        }
      });
      key.shadow.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
