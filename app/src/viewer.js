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
  Box3,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  HemisphereLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  PCFSoftShadowMap,
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
import { attachStadium } from "./stadium.js";
import { buildJudges } from "./judges.js";
import { loadGymBranding } from "./gym-branding.js";
import { stadiumDirection } from "./clip/direction.js";
import { buildGym } from "./gym.js";
import { buildRollerHall } from "./roller-hall.js";
import { nameplate } from "./plate.js";
import { Player, applyFrame, frameAt, frameCount, CTRL_DT } from "./replay.js";
import { readBrightness, writeBrightness } from "./brightness.js";

// Directional daylight supplies shape; the room supplies broad, soft reflections.
// Keep indirect light modest so pale shells and parquet retain their colours.
const EXPOSURE = 0.9;
const ENV_INTENSITY = 0.6;
const KEY = 2.2;
const FILL = 0.3;
const RIM = 0.65;
const HEMI = 0.25;
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
export function attachCourse(scene, event, lanes, wallsVisible, stripes) {
  const course = buildCourse(event, lanes, stripes);
  const walls = course.getObjectByName("walls");
  if (walls) walls.visible = Boolean(wallsVisible);
  scene.add(course);
  return course;
}

export function placeLane(rig, laneZ) {
  rig.placer.position.z = laneZ;
  rig.placer.rotation.set(0, 0, 0);
}

// Project the midpoint of the feet vertically onto the course. Parenting the
// ring to the course also aligns its plane with the ramp.
export function placeMarker(marker, ground, feet, slopeDeg) {
  if (marker.parent !== ground) ground.add(marker);
  const angle = slopeDeg * Math.PI / 180;
  marker.position.set((feet.x + 0.004 * Math.sin(angle)) / Math.cos(angle), 0.004, feet.z);
}

const leftFoot = new Vector3();
const rightFoot = new Vector3();

export function feetPosition(rig, target) {
  rig.joints.get("left_ankle").body.getWorldPosition(leftFoot);
  rig.joints.get("right_ankle").body.getWorldPosition(rightFoot);
  return target.copy(leftFoot).add(rightFoot).multiplyScalar(0.5);
}

// A nameplate's height in metres and how far above the trunk it floats. Tuned
// by eye on the clip page.
const PLATE_HEIGHT = 0.05;
const PLATE_LIFT = 0.16;

/**
 * Where the camera stands and what it looks at, for one frame.
 *
 * `null` is the close chase camera used on the race page:
 * behind the leader, trackside, the side offset widening with the arena. An
 * event's `[clip.camera]` spec overrides its constants or fixes the camera
 * outright; `distance` scales a chase's offsets, which is how the vertical
 * clip fits the same picture in a narrower frame. `rise` is the ramp's height
 * under the leader: a chase climbs a hill with its duck instead of watching it
 * walk out of the top of the frame. Pure, so it is testable.
 */
export function cameraPose(spec, lead, sideOffset, rise) {
  if (spec?.kind === "fixed") return { position: [...spec.position], target: [...spec.target] };
  const back = spec?.back ?? 0.35;
  const height = spec?.height ?? 0.34;
  const side = spec?.side ?? sideOffset;
  const distance = spec?.distance ?? 1;
  return {
    position: [lead - back * distance, height * distance + rise, side * distance],
    target: [lead, (spec?.target_height ?? 0.12) + rise, 0],
  };
}

// Where a clip's opening travel starts, relative to the chase it ends on: turned
// this far round towards the front of the line, this much farther out and higher.
const TRAVEL_TURN = (30 * Math.PI) / 180;
const TRAVEL_REACH = 1.3;
const TRAVEL_LIFT = 8;
// How far beyond the camera's farthest stand the near stand starts.
const STAND_CLEARANCE = 0.3;

/**
 * The camera `u` of the way through a clip's opening travel, 0 to 1: an orbit
 * round the chase's target, from ahead of the line where the waiting ducks face
 * it, to the chase itself. An orbit rather than a straight line, so it never
 * cuts through the lanes. Pure, so it is testable.
 */
export function travelPose(chase, u) {
  if (u >= 1) return chase;
  const left = 1 - u * u * (3 - 2 * u);
  const [x, y, z] = chase.target;
  const dx = chase.position[0] - x;
  const dz = chase.position[2] - z;
  const turn = TRAVEL_TURN * left;
  const out = 1 + (TRAVEL_REACH - 1) * left;
  return {
    position: [
      x + out * (dx * Math.cos(turn) + dz * Math.sin(turn)),
      y + (chase.position[1] - y) * (1 + (TRAVEL_LIFT - 1) * left),
      z + out * (dz * Math.cos(turn) - dx * Math.sin(turn)),
    ],
    target: chase.target,
  };
}

// The racers' model, 1.3 MB, and the crowd's: the same GLB decimated to a
// tenth of its triangles, 154 KB, made with
//   npx @gltf-transform/cli@4 simplify --ratio 0.05 --error 0.02 microduck.glb microduck-crowd.glb
// Measured on a 1080p clip frame under SwiftShader, the Space's renderer:
// 300 ms alone, 1050 ms with the far stand's fifty-four spectators at full
// detail, 350 ms with the whole stadium in this model and the skin filter in
// rig.js. Two metres off they look the same.
const MODEL = "microduck.glb";
const CROWD_MODEL = "microduck-crowd.glb";

// Each GLB is memoised on its own and never re-fetched when you move between
// a walking race and a roller race.
const glbs = new Map();

function loadGlb(model) {
  if (!glbs.has(model)) {
    glbs.set(
      model,
      new GLTFLoader().loadAsync(`${MODEL_DIR}/${model}`).then((gltf) => gltf.scene),
    );
  }
  return glbs.get(model);
}

// Per-rig assets, memoised per rig and model: the roller rig has its own
// kinematic tree and five STLs the GLB does not carry. Exported for the booth,
// which builds its own scene from the same rig.
const rigAssets = new Map();

export function loadAssets(rig, model = MODEL) {
  const key = `${rig}:${model}`;
  if (!rigAssets.has(key)) {
    rigAssets.set(
      key,
      (async () => {
        const [kinematics, glbScene] = await Promise.all([loadKinematics(rig), loadGlb(model)]);
        return { kinematics, geometries: await rigGeometries(kinematics, glbScene) };
      })(),
    );
  }
  return rigAssets.get(key);
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
  // race page shows one event, and an event declares one rig. The crowd is
  // always on foot, in its own lighter model.
  const [{ kinematics, geometries }, spectators, reachy, branding] = await Promise.all([
    loadAssets(rigName),
    loadAssets("legs", CROWD_MODEL),
    loadGlb("reachy-mini/reachy-mini.glb"),
    loadGymBranding(),
  ]);

  // Under SwiftShader MSAA cost 2.7× per frame (401 → 151 ms at 1080p), and a
  // clip is encoded by x264 anyway, which softens edges; the interactive pages keep it.
  const renderer = new WebGLRenderer({ canvas, antialias: !manual });
  // A clip is exactly its layout's pixels: the recorder wants the drawing
  // buffer to match the frame it is composing, not a device's own ratio.
  renderer.setPixelRatio(manual ? 1 : Math.min(devicePixelRatio, 2));
  // The liveries' colours are linear and deliberately oversaturated because the
  // simulator tone-maps with ACES; without this every robot reads too hot.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  let brightness = readBrightness();

  // A procedural room, generated once — no asset, no network. This is what
  // gives the metallic parts something to reflect; without it they are black.
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.02);
  room.dispose();
  pmrem.dispose();

  // A shared contact shadow grounds racers without another scene render.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext("2d");
  const gradient = shadowContext.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.3)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.16)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  shadowContext.fillStyle = gradient;
  shadowContext.fillRect(0, 0, 64, 64);
  const shadowMap = new CanvasTexture(shadowCanvas);
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowMap, transparent: true, depthWrite: false, toneMapped: false,
  });
  const shadowGeometry = new PlaneGeometry(0.26, 0.18);

  const scene = new Scene();
  scene.environment = environment.texture;

  // Keep reflected light fixed: scaling it with exposure washes out pale surfaces.
  function setBrightness(value) {
    brightness = writeBrightness(value);
    renderer.toneMappingExposure = EXPOSURE * brightness;
    scene.environmentIntensity = ENV_INTENSITY;
    return brightness;
  }
  scene.background = new Color(0xb8dce7);

  // A warm window key, a quiet fill and a cool back light. Static scenery
  // shadows are refreshed only when the course is rebuilt.
  const key = new DirectionalLight(0xfff1dc, KEY);
  key.position.set(-1.5, 2.8, 1.5);
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.003;
  key.shadow.bias = -0.0001;
  scene.add(key, key.target);
  const fill = new DirectionalLight(0xbfd2ff, FILL);
  fill.position.set(1.8, 1.0, 1.0);
  scene.add(fill);
  const rim = new DirectionalLight(0xdceaff, RIM);
  rim.position.set(0.8, 1.8, -2.2);
  scene.add(rim);
  // Sky above, ground bounce below.
  scene.add(new HemisphereLight(0xcfe0ff, 0x70604c, HEMI));

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
  let gym = null;
  let judges = null;
  // The stadium's crowd, rebuilt with the course: posed in draw, disposed
  // with the course in clearScene.
  let audience = null;
  let wallsVisible = false;
  let namesVisible = false;
  let sideOffset = 1.15;
  let slopeDeg = 0;
  let courseLength = 2;
  let player = new Player([]);
  let crowdDirection = stadiumDirection();

  function clearScene() {
    judges?.dispose();
    judges = null;
    gym?.dispose();
    gym = null;
    for (const lane of lanes) {
      scene.remove(lane.rig.placer);
      lane.marker?.removeFromParent();
      lane.plate?.dispose();
      if (lane.plate) scene.remove(lane.plate.sprite);
    }
    lanes = [];
    if (course) {
      audience?.dispose();
      audience = null;
      scene.remove(course);
      course = null;
    }
  }

  function setLanes(entries, event, playerOptions = {}) {
    clearScene();
    const spacing = laneSpacing(event || {});
    sideOffset = cameraSideOffset(entries.length, spacing);
    slopeDeg = event?.slope_deg ?? 0;
    courseLength = event?.length_m ?? 2;
    if (event) {
      course = attachCourse(
        scene,
        event,
        Math.max(1, entries.length),
        wallsVisible,
        entries.map((entry) => entry.colour),
      );
      // The near stand starts a stride beyond where the chase camera stands,
      // clip travel included, so the lens is never inside it.
      const chase = cameraPose(spec, 0, sideOffset, 0).position[2];
      const clearance = chase * TRAVEL_REACH + STAND_CLEARANCE;
      const ground = course.getObjectByName("ground");
      const { width, height } = ground.geometry.parameters;
      const roller = event.id === "roller-sprint-2m";
      if (roller) {
        gym = buildRollerHall(courseLength, height, branding, spectators);
      } else {
        audience = attachStadium(course, spectators, clearance);
        course.updateMatrixWorld(true);
        const stadiumBounds = new Box3().setFromObject(course);
        gym = buildGym(courseLength, stadiumBounds.min.z, stadiumBounds.max.z, branding, height);
      }
      scene.add(gym.group);
      judges = buildJudges(reachy, courseLength, Math.max(1, entries.length) * spacing / 2, gym.sponsorMaps, roller ? 3 : 4);
      scene.add(judges.group);
      if (!slopeDeg) {
        ground.material.dispose();
        ground.material = gym.floorMaterial(width, height);
      }
    }
    key.castShadow = Boolean(gym);
    if (gym) {
      // Cast only fixed scenery: animated spectators and judges must not leave
      // frozen silhouettes in the cached map. Room walls/roof stay out too.
      audience?.group.traverse(node => {
        if (node.isMesh && !node.isInstancedMesh) node.castShadow = true;
      });
      for (const root of [course, gym.group]) root.traverse(node => {
        if (node.isMesh) node.receiveShadow = true;
      });
      const bounds = new Box3().setFromObject(course);
      bounds.union(new Box3().setFromObject(judges.group));
      const centre = bounds.getCenter(new Vector3());
      const radius = bounds.getSize(new Vector3()).length() / 2 + 0.5;
      key.target.position.copy(centre);
      key.position.set(-1.5, 2.8, 1.5).normalize().multiplyScalar(radius * 2).add(centre);
      Object.assign(key.shadow.camera, {
        left: -radius, right: radius, top: radius, bottom: -radius,
        near: 0.1, far: radius * 4,
      });
      key.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
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
      rig.placer.traverse(node => { if (node.isMesh) node.receiveShadow = true; });
      placeLane(rig, z);
      scene.add(rig.placer);

      // The follow-spot, on the course so it climbs a slope with it (placeMarker).
      const marker = buildMarker(tier, entry.colour ?? null);
      const shadow = new Mesh(shadowGeometry, shadowMaterial);
      shadow.position.z = -0.001; // Below the ring, above the course, including slopes.
      marker.add(shadow);

      // The duck's name, hung over its head in its lane's colour: the clip
      // has four ducks and no legend, so the name rides the duck.
      let plate = null;
      if (entry.name) {
        plate = nameplate(entry.name, `#${marker.material.color.getHexString()}`, "#08080c");
        plate.sprite.scale.set(PLATE_HEIGHT * plate.ratio, PLATE_HEIGHT, 1);
        // Remembered on the viewer, like the walls: setLanes rebuilds every
        // lane on each replay, so a plate built after the toggle was pressed
        // would come back showing whatever the default was.
        plate.sprite.visible = namesVisible;
        scene.add(plate.sprite);
      }
      return { ...entry, rig, marker, plate, tier, gazeTarget: new Vector3() };
    });
    player = new Player(lanes.map((lane) => lane.trace), playerOptions);
    const progress = [];
    if (event?.length_m && lanes.length) {
      for (let second = 0; second < player.duration; second += .1) {
        const value = Math.max(...lanes.map(lane => {
          const index = Math.min(frameCount(lane.trace) - 1, Math.floor(second / CTRL_DT));
          return Math.max(0, Math.min(1, frameAt(lane.trace, index)[0] / courseLength));
        }));
        progress.push({ second, value });
      }
      progress.push({ second: player.duration, value: Math.max(...lanes.map(lane =>
        Math.max(0, Math.min(1, frameAt(lane.trace, frameCount(lane.trace) - 1)[0] / courseLength)),
      )) });
    }
    crowdDirection = stadiumDirection({ end: player.duration, progress,
      verdict: progress.some(sample => sample.value === 1) ? "pass" : null });
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
  /**
   * Show or hide the name over each duck.
   *
   * Kept on the viewer rather than on the sprites alone, for the same reason
   * the walls are: setLanes discards and rebuilds every lane, so state held
   * only on the meshes is lost on the next replay.
   */
  function setNamesVisible(visible) {
    namesVisible = Boolean(visible);
    for (const lane of lanes) {
      if (lane.plate) lane.plate.sprite.visible = namesVisible;
    }
    return namesVisible;
  }

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
  const _feet = new Vector3();
  let raf = null;
  let crowdStart = null;

  function draw(travel = 1, seconds = player.time, mood = time => crowdDirection(player.time + time - seconds)) {
    const indices = player.frameIndices();
    lanes.forEach((lane, i) => {
      const frame = frameAt(lane.trace, indices[i]);
      applyFrame(lane.rig, frame);
      // Follow both feet, including sideways drift and the lane offset.
      if (lane.marker) placeMarker(lane.marker, course ?? scene, feetPosition(lane.rig, _feet), slopeDeg);
      if (lane.plate) {
        lane.rig.bodies.get("trunk_base").getWorldPosition(_trunk);
        lane.plate.sprite.position.set(_trunk.x, _trunk.y + PLATE_LIFT, _trunk.z);
      }
    });
    audience?.pose(seconds, mood);
    gym?.pose?.(seconds, mood);
    judges?.pose(seconds, lanes.map((lane) =>
      lane.rig.bodies.get("trunk_base").getWorldPosition(lane.gazeTarget),
    ));

    if (chase && course) {
      // Follow the leader along +x, the direction of travel, from behind and
      // slightly to one side so the gait is visible rather than end-on.
      const lead = lanes.length
        ? Math.max(...lanes.map((lane, i) => frameAt(lane.trace, indices[i])[0]))
        : courseLength / 2;
      const rise = lead * Math.tan((slopeDeg * Math.PI) / 180);
      const pose = travelPose(cameraPose(spec ?? gym?.camera, lead, sideOffset, rise), travel);
      camera.position.set(...pose.position);
      _target.set(...pose.target);
      if (controls) controls.target.copy(_target);
      else camera.lookAt(_target);
    }
    controls?.update();
    const lead = lanes.length ? Math.max(...lanes.map((lane, i) => frameAt(lane.trace, indices[i])[0])) : courseLength / 2;
    gym?.renderScreens?.(renderer, scene, seconds, lead);
    renderer.render(scene, camera);
  }

  function tick(now) {
    player.advance(now);
    // The crowd on the wall clock: it fidgets before a lane is ticked and after
    // a publication's race has run out, when the replay's clock stands still.
    crowdStart ??= now;
    const crowdSeconds = (now - crowdStart) / 1000;
    draw(1, crowdSeconds);
    raf = requestAnimationFrame(tick);
  }

  /** Manual mode: pose every lane — and the crowd, so a clip's frames come out
   * the same every render — at `seconds`, and render once, the camera `travel`
   * of the way through its opening travel (travelPose). */
  function frame(seconds, travel = 1, crowdSeconds = seconds, mood) {
    player.seek(seconds);
    draw(travel, crowdSeconds, mood);
  }

  /** Where lane `i`'s duck stood in the last frame drawn, as fractions of the
   * canvas from its top left: what a clip hangs its stamp on. */
  function spot(i) {
    lanes[i].rig.bodies.get("trunk_base").getWorldPosition(_trunk).project(camera);
    return { x: (_trunk.x + 1) / 2, y: (1 - _trunk.y) / 2 };
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
    setNamesVisible,
    setBrightness,
    frame,
    spot,
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
      key.shadow.dispose();
      shadowMap.dispose();
      shadowMaterial.dispose();
      shadowGeometry.dispose();
      renderer.dispose();
    },
  };
}
