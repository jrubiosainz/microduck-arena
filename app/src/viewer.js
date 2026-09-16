// The 3D scene: a lane per entry, all playing the same clock.
//
// Axis mapping, measured and pinned by rig.test.js:
//   MJCF +x (forward) -> three.js +x   the duck advances along +x
//   MJCF +y (left)    -> three.js -z   lanes are separated along z
//   MJCF +z (up)      -> three.js +y
// An earlier version of this file assumed forward was -z. That put lanes on the
// forward axis, so a head-to-head raced in single file, and made the camera
// track an axis the duck never moved along.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  HemisphereLight,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  MODEL_DIR,
  attachMeshes,
  buildRigTree,
  loadKinematics,
  rigGeometries,
} from "./rig.js";
import { buildCourse, buildMarker, laneOffsetZ, laneSpacing } from "./course.js";
import { nameplate } from "./plate.js";
import { Player, applyFrame, frameAt } from "./replay.js";
import { readBrightness, writeBrightness } from "./brightness.js";

// ── Lighting ──────────────────────────────────────────────────────────
//
// These numbers were retuned DOWNWARD once the robot could be lit at all.
//
// Every value here was originally raised to rescue a robot that rendered as a
// flat black silhouette. That turned out to have nothing to do with lighting:
// the vendored GLB ships without vertex normals, so no lamp, no ambient and no
// environment map could touch it (see creasedGeometries in rig.js). Cranking
// these only lit the floor — a big flat plane facing straight up takes the full
// value of anything sky-like — until the robots were silhouettes against their
// own blown-out track, which is precisely what the screenshots showed.
//
// With normals rebuilt, the scene needs ordinary lighting. AMBIENT and HEMI are
// still the FLOOR's dials; KEY, FILL and RIM are the robot's. The environment
// stays, because the mech parts are genuinely metallic (metalness 0.3-0.35) and
// metal with nothing to reflect really does read black — that hazard is real,
// it just was not this bug.
const EXPOSURE = 1.0;
const ENV_INTENSITY = 1.0;
const AMBIENT = 0.18;
const KEY = 1.7;
const FILL = 0.55;
const RIM = 0.5;
const HEMI = 0.12;
const GHOST_OPACITY = 0.5;

/**
 * Put one lane's rig where its trace says it is.
 *
 * Lateral offset ONLY. It is tempting to also tilt the placer by the course's
 * slope so the duck "sits on the hill", and that line was here — but a trace
 * frame carries WORLD coordinates that already include the slope, so tilting
 * the placer applies it a SECOND time and the duck climbs away from the ramp it
 * is walking on. Measured on hill-climb-1m5: the physics puts the trunk 0.1182 m
 * above the ramp; the extra rotation drew it at 0.1515 m, the gap widening with
 * distance.
 *
 * The duck's lean was never the problem either: its orientation comes from the
 * trace's quaternion, not from the course.
 *
 * Extracted from createViewer so the rule has somewhere to be tested — the
 * viewer itself needs WebGL and has none in the suite.
 */
/**
 * How far to the side the camera must sit to frame this many lanes.
 *
 * A fixed 1.15 m framed three lanes when they were packed at 0.45 m apart. They
 * are now drawn at the course's true width, so three of them span 2.6 m rather
 * than 1.35 and the outer two fell out of frame. Pure, so the arithmetic is
 * testable without a renderer.
 */
export function cameraSideOffset(lanes, spacing) {
  const halfArena = (Math.max(1, lanes) * spacing) / 2;
  // 1.15 is the framing that has always worked for a single lane; a wider
  // arena is backed away from in proportion to how much wider it is.
  return Math.max(1.15, 0.75 + halfArena * 1.35);
}

/**
 * Build the course for one race and put it in the scene, honouring the wall
 * toggle.
 *
 * Exported for the same reason placeLane is: createViewer needs WebGL and
 * cannot run in the suite, and the thing worth pinning here is that a REBUILT
 * course remembers whether the walls were showing. setLanes rebuilds on every
 * re-race, and a fresh wall group starts hidden — so without this the walls
 * would silently vanish while the button still read "Hide walls".
 */
export function attachCourse(scene, event, lanes, wallsVisible) {
  const course = buildCourse(event, lanes);
  const walls = course.getObjectByName("walls");
  if (walls) walls.visible = Boolean(wallsVisible);
  scene.add(course);
  return course;
}

export function placeLane(rig, laneZ) {
  rig.placer.position.z = laneZ;
  rig.placer.rotation.set(0, 0, 0);
}

// A nameplate's height in metres and how far above the trunk it floats. Tuned
// by eye on the clip page; the publication page hangs none.
const PLATE_HEIGHT = 0.05;
const PLATE_LIFT = 0.16;

/**
 * Where the camera stands and what it looks at, for one frame.
 *
 * `null` is the chase camera the publication and race pages always had:
 * behind the leader, trackside, the side offset widening with the arena. An
 * event's `[clip.camera]` spec overrides its constants or fixes the camera
 * outright; `distance` scales a chase's offsets, which is how the vertical
 * clip fits the same picture in a narrower frame. Pure, so it is testable.
 */
export function cameraPose(spec, lead, sideOffset) {
  if (spec?.kind === "fixed") return { position: [...spec.position], target: [...spec.target] };
  const back = spec?.back ?? 0.35;
  const height = spec?.height ?? 0.34;
  const side = spec?.side ?? sideOffset;
  const distance = spec?.distance ?? 1;
  return {
    position: [lead - back * distance, height * distance, side * distance],
    target: [lead, spec?.target_height ?? 0.12, 0],
  };
}

// The GLB is one 1.3 MB download shared by every rig, so it is memoised on its
// own and never re-fetched when you move between a walking race and a roller
// race.
let glbPromise = null;

function loadGlb() {
  if (!glbPromise) {
    glbPromise = new GLTFLoader()
      .loadAsync(`${MODEL_DIR}/microduck.glb`)
      .then((gltf) => gltf.scene);
  }
  return glbPromise;
}

// Per-rig assets, memoised per rig: the roller rig has its own kinematic tree
// and five STLs the GLB does not carry.
const rigAssets = new Map();

function loadAssets(rig) {
  if (!rigAssets.has(rig)) {
    rigAssets.set(
      rig,
      (async () => {
        const [kinematics, glbScene] = await Promise.all([loadKinematics(rig), loadGlb()]);
        return { kinematics, geometries: await rigGeometries(kinematics, glbScene) };
      })(),
    );
  }
  return rigAssets.get(rig);
}

export async function createViewer(
  canvas,
  { onChaseChange, rig: rigName = "legs", manual = false, camera: spec = null } = {},
) {
  // `rigName` and not `rig`, because setLanes below names each lane's built
  // tree `rig` — the two would shadow, and it would work by accident today
  // only because nothing reads the parameter after this line.
  //
  // The rig is fixed for the life of this viewer, which matches the page: one
  // race page shows one event, and an event declares one rig.
  const { kinematics, geometries } = await loadAssets(rigName);

  // Under SwiftShader MSAA cost 2.7× per frame (401 → 151 ms at 1080p), and a
  // clip is encoded by x264 anyway, which softens edges; the interactive pages keep it.
  const renderer = new WebGLRenderer({ canvas, antialias: !manual });
  // A clip is exactly its layout's pixels: the recorder wants the drawing
  // buffer to match the frame it is composing, not a device's own ratio.
  renderer.setPixelRatio(manual ? 1 : Math.min(devicePixelRatio, 2));
  // The liveries' colours are linear and deliberately oversaturated because the
  // simulator tone-maps with ACES; without this every robot reads too hot.
  renderer.toneMapping = ACESFilmicToneMapping;
  let brightness = readBrightness();

  // A procedural room, generated once — no asset, no network. This is what
  // gives the metallic parts something to reflect; without it they are black.
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const scene = new Scene();
  scene.environment = environment;

  // One control drives both, because they are the two things that decide
  // whether the robot reads at all and they should not be tuned apart.
  function setBrightness(value) {
    brightness = writeBrightness(value);
    renderer.toneMappingExposure = EXPOSURE * brightness;
    scene.environmentIntensity = ENV_INTENSITY * brightness;
    return brightness;
  }
  // --deep-ink: the stage is a screen, and the club draws every screen — the
  // CRT, the stills on the flyers — on deep ink.
  scene.background = new Color(0x08080c);
  scene.fog = new Fog(0x08080c, 4.5, 16);

  // Four lights, because ACES tone mapping pulls mid-tones DOWN and the first
  // attempt at this left the robots as dark blobs. Ambient sets the floor, the
  // key gives form, the fill opens the shadow side, and the hemisphere lifts
  // undersides — a duck is mostly overhangs, and without bounce its legs and
  // the underside of its shell go to black.
  scene.add(new AmbientLight(0xffffff, AMBIENT));
  const key = new DirectionalLight(0xffffff, KEY);
  key.position.set(1.4, 2.6, 1.8);
  scene.add(key);
  const fill = new DirectionalLight(0xbfd2ff, FILL);
  fill.position.set(-1.6, 1.1, -1.3);
  scene.add(fill);
  const rim = new DirectionalLight(0xffd9b0, RIM);
  rim.position.set(-0.6, 0.9, 2.2);
  scene.add(rim);
  // Sky above, ground bounce below.
  scene.add(new HemisphereLight(0xcfe0ff, 0x2b2b30, HEMI));

  const grid = new GridHelper(24, 48, 0x23232b, 0x17171d);
  grid.position.y = -0.001; // just under the course so it reads as backdrop
  scene.add(grid);

  const camera = new PerspectiveCamera(spec?.fov ?? 42, 1, 0.02, 100);
  camera.position.set(-0.35, 0.34, 1.15);

  // Chase camera on by default; the first drag hands control to the user, the
  // same bargain the original sandbox makes.
  let chase = true;

  // A clip drives the camera from cameraPose alone: no controls to fight, no
  // "start" drag to hand chase away.
  const controls = manual ? null : new OrbitControls(camera, canvas);
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.25;
    controls.maxDistance = 8;
    controls.target.set(0, 0.12, 0);
    controls.addEventListener("start", () => {
      if (!chase) return;
      chase = false;
      onChaseChange?.(false);
    });
  }

  let lanes = [];
  let course = null;
  let wallsVisible = false;
  let sideOffset = 1.15;
  let player = new Player([]);

  function clearScene() {
    for (const lane of lanes) {
      scene.remove(lane.rig.placer);
      if (lane.marker) scene.remove(lane.marker);
      lane.plate?.dispose();
      if (lane.plate) scene.remove(lane.plate.sprite);
    }
    lanes = [];
    if (course) {
      scene.remove(course);
      course = null;
    }
  }

  function setLanes(entries, event, playerOptions = {}) {
    clearScene();
    const spacing = laneSpacing(event || {});
    sideOffset = cameraSideOffset(entries.length, spacing);
    if (event) {
      course = attachCourse(scene, event, Math.max(1, entries.length), wallsVisible);
    }
    lanes = entries.map((entry, i) => {
      const tier = entry.tier ?? "ghost";
      const rig = buildRigTree(kinematics);
      // No colour override: each geom keeps its own colour from the kinematics.
      // Painting the whole duck one lane colour erased every seam between shell,
      // legs and head and left an unreadable silhouette. A ghost is DIMMED
      // instead — the treatment the simulator gives its multiplayer peers.
      attachMeshes(rig, kinematics, geometries, {
        livery: entry.livery ?? "classic",
        // A rival on a publication page is a real entry, drawn solid: an
        // explicit `opacity` overrides what the tier would give it.
        opacity: entry.opacity ?? (tier === "ghost" ? GHOST_OPACITY : 1),
      });
      // The same spacing buildCourse used: the ducks must stand between their
      // own walls, not between someone else's.
      const z = laneOffsetZ(i, entries.length, spacing);
      placeLane(rig, z);
      scene.add(rig.placer);

      // The follow-spot, parented to the course so it climbs a slope with it.
      const marker = buildMarker(tier, entry.colour ?? null);
      marker.position.z = z;
      scene.add(marker);

      // The duck's name, hung over its head in its lane's colour: the clip
      // has four ducks and no legend, so the name rides the duck.
      let plate = null;
      if (entry.name) {
        plate = nameplate(entry.name, entry.nameColour ?? "#faf8f2", "#08080c");
        plate.sprite.scale.set(PLATE_HEIGHT * plate.ratio, PLATE_HEIGHT, 1);
        scene.add(plate.sprite);
      }
      return { ...entry, rig, marker, plate, tier };
    });
    player = new Player(lanes.map((lane) => lane.trace), playerOptions);
    player.play();
  }

  /**
   * Show or hide the lane walls.
   *
   * They are in the physics whether or not they are drawn — a robot that
   * drifts hits them either way. The toggle exists because a roller policy was
   * grazing something invisible, and being unable to see it made that
   * impossible to diagnose from the page.
   */
  function setWallsVisible(visible) {
    // Remembered on the viewer, not only on the mesh: setLanes rebuilds the
    // course on every re-race, and a fresh group starts hidden. Without this
    // the walls would silently vanish while the button still said "Hide walls".
    wallsVisible = Boolean(visible);
    applyWallVisibility();
    return wallsVisible;
  }

  function applyWallVisibility() {
    const group = course?.getObjectByName("walls");
    if (group) group.visible = wallsVisible;
  }


  function follow() {
    chase = true;
    onChaseChange?.(true);
  }

  function resize() {
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 450;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const _target = new Vector3();
  const _trunk = new Vector3();
  let raf = null;

  function draw() {
    const indices = player.frameIndices();
    lanes.forEach((lane, i) => {
      const frame = frameAt(lane.trace, indices[i]);
      applyFrame(lane.rig, frame);
      // Keep the marker under its duck. frame[0] is MJCF +x, which is three +x.
      if (lane.marker) lane.marker.position.x = frame[0];
      if (lane.plate) {
        lane.rig.bodies.get("trunk_base").getWorldPosition(_trunk);
        lane.plate.sprite.position.set(_trunk.x, _trunk.y + PLATE_LIFT, _trunk.z);
      }
    });

    if (chase && lanes.length) {
      // Follow the leader along +x, the direction of travel, from behind and
      // slightly to one side so the gait is visible rather than end-on.
      const lead = Math.max(...lanes.map((lane, i) => frameAt(lane.trace, indices[i])[0]));
      const pose = cameraPose(spec, lead, sideOffset);
      camera.position.set(...pose.position);
      _target.set(...pose.target);
      if (controls) controls.target.copy(_target);
      else camera.lookAt(_target);
    }
    controls?.update();
    renderer.render(scene, camera);
  }

  function tick(now) {
    player.advance(now);
    draw();
    raf = requestAnimationFrame(tick);
  }

  /** Manual mode: pose every lane at `seconds` and render once. */
  function frame(seconds) {
    player.seek(seconds);
    draw();
  }

  resize();
  // The canvas, not the window: on the publication page the stage is a grid
  // row that gives its height to the sections appearing under it, so the box
  // changes size while the window never does. Watching the window alone left
  // the drawing buffer 36% taller than the box it was painted into.
  const watcher = new ResizeObserver(resize);
  watcher.observe(canvas);
  if (!manual) raf = requestAnimationFrame(tick);

  setBrightness(brightness);

  return {
    setLanes,
    follow,
    setWallsVisible,
    setBrightness,
    frame,
    get brightness() {
      return brightness;
    },
    get chasing() {
      return chase;
    },
    get player() {
      return player;
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      watcher.disconnect();
      controls?.dispose();
      clearScene();
      environment.dispose();
      renderer.dispose();
    },
  };
}
