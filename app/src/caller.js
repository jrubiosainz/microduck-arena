// Red light, green light's caller: a Reachy Mini on a step past the finish line, its back to the
// lanes on green and turned round to them on red, beside a post that shows the light. A strip
// along the far edge of the lanes, from the start line to the post, shows it too: the chase camera
// keeps the duck in frame, and on a short lane the caller only comes into it near the line. When the light
// changes and how far round the caller is are lights.js's; this only poses them.

import { BoxGeometry, CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { lightAt } from "./lights.js";

const RED = { on: 0xff2b2b, off: 0x3b1515 };
const GREEN = { on: 0xc8ff2e, off: 0x26331b };
const UNLIT = 0x2b2d33;
const STEP = 0.06;
// The light faces down the lanes, the way the ducks come and the chase camera looks.
const FACING_LANES = -Math.PI / 2;

/**
 * How many times life size the caller of a race `length` metres long stands: life size on a short
 * lane, and over a long one taller, as the show's doll stands over its field, so that the ducks
 * see it from the start line. From 15 m it stands two and a half times life size, a metre tall,
 * over ducks of 0.37 m: the doll's own measure against its players.
 */
export function callerSize(length) {
  return Math.min(2.5, Math.max(1, length / 6));
}

/**
 * The caller of a race `length` metres long whose lanes reach `edge` metres either side of the
 * centre line, timed by the event's `lights`. Shares the official model's geometry and materials
 * with every other clone: `dispose` frees only what it built.
 */
export function buildCaller(model, lights, length, edge) {
  const group = new Group();
  group.name = "caller";
  const geometries = [];
  const materials = [];
  function part(geometry, material, x, y, z) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    if (!materials.includes(material)) materials.push(material);
    return mesh;
  }
  const size = callerSize(length);
  const x = length + 0.22 * size;
  const ink = new MeshStandardMaterial({ color: 0x243c44, roughness: 0.7 });
  part(new BoxGeometry(0.26 * size, STEP * size, 0.26 * size),
    new MeshStandardMaterial({ color: 0xfaf6e9, roughness: 0.8 }), x, (STEP * size) / 2, 0);

  // On the far side of the lanes from the chase camera, so it never stands in front of the caller.
  const post = -(edge + 0.06);
  part(new BoxGeometry(0.025, 0.42, 0.025), ink, x, 0.21, post);
  part(new BoxGeometry(0.05, 0.13, 0.075), ink, x, 0.47, post);
  const lamp = (y, colour) => {
    const mesh = part(new CircleGeometry(0.024, 24), new MeshBasicMaterial({ color: colour.off }), x - 0.026, y, post);
    mesh.rotation.y = FACING_LANES;
    mesh.castShadow = false;
    return mesh;
  };
  const red = lamp(0.497, RED);
  red.name = "red-lamp";
  const green = lamp(0.443, GREEN);
  green.name = "green-lamp";
  const strip = part(new BoxGeometry(x, 0.02, 0.012), new MeshBasicMaterial({ color: UNLIT }), x / 2, 0.01, post + 0.03);
  strip.name = "light-strip";
  strip.castShadow = false;

  const robot = model.clone(true);
  robot.name = "caller-robot";
  robot.traverse((node) => { if (node.isMesh) node.castShadow = node.receiveShadow = true; });
  robot.position.set(x, STEP * size, 0);
  robot.scale.setScalar(size);
  group.add(robot);
  const right = robot.getObjectByName("antenna_right");
  const left = robot.getObjectByName("antenna_left");

  /** Pose for `seconds` on the race clock: both lamps dark before the start. */
  function pose(seconds) {
    const light = lightAt(lights, seconds);
    const started = seconds >= 0;
    // Reachy faces +X in the official model: away from the lanes, until the light goes red. It
    // turns by +Z, towards the chase camera, so its face shows as it comes round.
    robot.rotation.y = -Math.PI * light.facing;
    red.material.color.setHex(light.red ? RED.on : RED.off);
    green.material.color.setHex(started && !light.red ? GREEN.on : GREEN.off);
    strip.material.color.setHex(light.red ? RED.on : started ? GREEN.on : UNLIT);
    // It sways its antennas while it counts and holds them still while it watches.
    const sway = light.watching || !started ? 0 : 0.14 * Math.sin(seconds * 7);
    right.rotation.x = sway;
    left.rotation.x = -sway;
  }
  pose(-1);
  return {
    group,
    pose,
    dispose() {
      group.removeFromParent();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
