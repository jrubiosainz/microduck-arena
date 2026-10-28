// The booth's set: a municipal
// gym's stage with a workshop's furniture, in metres, z up, the whole group
// turned by π/6 so the duo faces the auditorium at an angle. Colours are the
// design tokens, read from the page, so the set and the site share one paint.

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { BOOTH_TURN } from "./direction.js";

/** A design token as a three.js colour. */
export function token(name) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());
}

// The back wall's centre holds the pegboard, or the cup screen in its place.
const PEGBOARD = ["pegboard frame", "pegboard", "peg hole"];
const CUP_SCREEN = ["cup screen frame", "cup screen"];

/** The set, the `screen` canvas's cup screen standing ready, hidden, at the pegboard's place. */
export function booth({ screen }) {
  const group = new Group();
  group.rotation.z = BOOTH_TURN;
  const materials = new Map();
  function box(name, size, position, paint) {
    if (!materials.has(paint)) materials.set(paint, new MeshLambertMaterial({ color: token(paint) }));
    const mesh = new Mesh(new BoxGeometry(...size), materials.get(paint));
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  box("court paint", [0.95, 0.012, 0.0002], [0, -0.28, 0.0004], "sky");
  // A solid riser, wall returns and ribs give the room readable parallax.
  box("riser", [1.35, 0.94, 0.035], [0, 0.08, -0.018], "ink");
  box("back wall", [1.35, 0.035, 0.58], [0, 0.44, 0.29], "warm-paper");
  box("wall skirting", [1.35, 0.015, 0.12], [0, 0.415, 0.06], "sky");
  for (const x of [-0.66, 0.66]) box("wall return", [0.025, 0.38, 0.58], [x, 0.26, 0.29], "warm-paper");
  for (const x of [-0.57, 0, 0.57]) box("wall rib", [0.018, 0.03, 0.56], [x, 0.408, 0.28], "cream");
  box("wall stripe", [1.3, 0.008, 0.018], [0, 0.392, 0.17], "magenta");
  // A pegboard with recessed-looking square holes, kept behind the actors.
  box("pegboard frame", [0.47, 0.027, 0.2], [0, 0.39, 0.31], "ink");
  box("pegboard", [0.445, 0.008, 0.177], [0, 0.372, 0.31], "yellow");
  for (let x = -0.19; x < 0.2; x += 0.038) {
    for (let z = 0.25; z < 0.39; z += 0.035) box("peg hole", [0.006, 0.002, 0.006], [x, 0.367, z], "ink");
  }
  // The cup screen's glass is the -y face (index 3) of its box, toward the desk.
  box("cup screen frame", [0.47, 0.027, 0.2], [0, 0.39, 0.31], "ink");
  const glass = box("cup screen", [0.445, 0.008, 0.177], [0, 0.372, 0.31], "ink");
  const map = new CanvasTexture(screen);
  map.colorSpace = SRGBColorSpace;
  const face = new MeshBasicMaterial({ map });
  glass.material = [glass.material, glass.material, glass.material, face, glass.material, glass.material];
  standScreen(group, false);
  // Low desk: knees may sit behind it, but heads and beaks stay clear.
  box("desk top", [0.61, 0.12, 0.018], [0, -0.115, 0.075], "cream");
  box("desk apron", [0.56, 0.012, 0.042], [0, -0.165, 0.043], "sky");
  for (const x of [-0.25, 0.25]) {
    for (const y of [-0.15, -0.08]) box("desk leg", [0.012, 0.012, 0.07], [x, y, 0.035], "ink");
  }
  // The replay CRT is a physical cabinet with a recessed screen and trolley wheels.
  box("trolley shelf", [0.18, 0.14, 0.012], [-0.47, 0.22, 0.115], "cream");
  for (const x of [-0.535, -0.405]) {
    box("trolley upright", [0.01, 0.1, 0.1], [x, 0.22, 0.06], "ink");
    for (const y of [0.18, 0.26]) box("caster", [0.023, 0.018, 0.025], [x, y, 0.0125], "ink");
  }
  box("CRT cabinet", [0.16, 0.12, 0.13], [-0.47, 0.22, 0.186], "ink");
  box("CRT bezel", [0.135, 0.009, 0.105], [-0.47, 0.155, 0.186], "cream");
  box("CRT glass", [0.108, 0.003, 0.076], [-0.48, 0.149, 0.19], "deep-ink");
  box("CRT standby key", [0.008, 0.003, 0.008], [-0.417, 0.149, 0.16], "yellow");
  // Workshop storage balances the trolley without crowding Ray.
  box("equipment case", [0.17, 0.14, 0.14], [0.48, 0.26, 0.07], "sky");
  box("case lid", [0.18, 0.15, 0.012], [0.48, 0.26, 0.146], "ink");
  box("case handle", [0.06, 0.012, 0.012], [0.48, 0.183, 0.1], "cream");
  // White practical tubes, no bloom or coloured light.
  for (const x of [-0.36, 0.36]) {
    box("light bracket", [0.3, 0.07, 0.02], [x, 0.24, 0.345], "ink");
    box("fluorescent tube", [0.27, 0.025, 0.015], [x, 0.225, 0.329], "paper");
  }
  return group;
}

/** Stands the cup screen on the back wall in place of the pegboard, or the pegboard back. */
export function standScreen(set, shown) {
  for (const mesh of set.children) {
    if (PEGBOARD.includes(mesh.name)) mesh.visible = !shown;
    if (CUP_SCREEN.includes(mesh.name)) mesh.visible = shown;
  }
}

/** The floor's paint: two-by-two tiles of paper and warm paper, repeated. */
export function checkerboard() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const style = getComputedStyle(document.documentElement);
  for (const [i, j] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
    ctx.fillStyle = style.getPropertyValue((i + j) % 2 ? "--warm-paper" : "--paper").trim();
    ctx.fillRect(i * 32, j * 32, 32, 32);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}
