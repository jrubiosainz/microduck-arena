import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { parquet } from "./gym.js";
import { sponsorTexture } from "./gym-branding.js";
import { crowd } from "./stadium.js";

// The entrance on the camera side leaves room to watch at court level.
export function rollerSeats(length, span) {
  const placed = [];
  const rz = Math.max(2, span / 2 + 1.25);
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < 64; i++) {
      const angle = ((i + 0.5) / 64) * Math.PI * 2;
      if (angle > Math.PI * 0.24 && angle < Math.PI * 0.76) continue;
      const x = (3.35 + row * 0.25) * Math.cos(angle);
      const z =
        (rz + row * 0.25) * Math.sin(angle) * (Math.sin(angle) > 0 ? 1.8 : 1);
      placed.push({
        x: length / 2 + x,
        y: 0.38 + row * 0.14,
        z,
        yaw: Math.atan2(z, -x),
      });
    }
  }
  return placed;
}

export function buildRollerHall(length, span, branding, spectators) {
  const group = new Group();
  group.name = "roller-hall";
  const centre = length / 2;
  const rz = Math.max(2, span / 2 + 1.25);
  const roomZ = (rz + 1.65) * 1.8;
  const textures = new Set();
  const materials = new Set();
  const batches = new Map();
  const paint = (color, roughness = 0.7) => {
    const m = new MeshStandardMaterial({ color, roughness, side: DoubleSide });
    materials.add(m);
    return m;
  };
  const wood = paint(0xa46d36),
    dark = paint(0x252a30),
    seatPaint = paint(0x46505a);
  const plaster = paint(0xccc5b5),
    metal = paint(0x343e49),
    trim = paint(0xd6b472);
  const white = new MeshBasicMaterial({ color: 0xf5eedc });
  materials.add(white);
  function fixed(geometry, material, x, y, z, yaw = 0) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }
  const box = (w, h, d, x, y, z, m, yaw = 0) =>
    fixed(new BoxGeometry(w, h, d), m, x, y, z, yaw);
  const woodMap = parquet();
  textures.add(woodMap);
  function floorMaterial(w, d) {
    const map = woodMap.clone();
    map.repeat.set(w / 4, d / 4);
    map.offset.set((centre - w / 2) / 4, -d / 8);
    textures.add(map);
    const m = new MeshStandardMaterial({
      map,
      roughness: 0.58,
      envMapIntensity: 0.3,
    });
    materials.add(m);
    return m;
  }
  const floor = new Mesh(
    new PlaneGeometry(10.6, roomZ * 2),
    floorMaterial(10.6, roomZ * 2),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(centre, -0.014, 0);
  group.add(floor);
  // Faceted oval wall and upper balcony, under an acoustic dome.
  for (let i = 0; i < 80; i++) {
    const a = ((i + 0.5) / 80) * Math.PI * 2;
    const x = centre + 5.05 * Math.cos(a),
      z = roomZ * Math.sin(a);
    const yaw = Math.atan2(-roomZ * Math.cos(a), -5.05 * Math.sin(a));
    const width =
      (Math.hypot(5.05 * Math.sin(a), roomZ * Math.cos(a)) * Math.PI * 2) / 80 +
      0.025;
    box(width, 1.65, 0.09, x, 1.35, z, wood, yaw);
    box(width, 0.13, 0.12, x, 2.21, z, trim, yaw);
    box(width, 0.38, 0.05, x, 2.48, z, plaster, yaw);
    box(0.025, 0.27, 0.025, x, 2.48, z - 0.02, metal);
  }
  const dome = new Mesh(
    new SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    plaster,
  );
  dome.scale.set(5.08, 2.05, roomZ);
  dome.position.set(centre, 2.65, 0);
  group.add(dome);
  // Radial ceiling seams and luminous strips follow the dome's curvature.
  function beam(a, b, r, m) {
    const delta = new Vector3().subVectors(b, a);
    const geometry = new CylinderGeometry(r, r, delta.length(), 6);
    const mesh = new Mesh(geometry, m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);
    if (!batches.has(m)) batches.set(m, []);
    batches.get(m).push(geometry);
  }
  for (let rib = 0; rib < 20; rib++) {
    const a = (rib / 20) * Math.PI * 2;
    for (let j = 0; j < 12; j++) {
      const point = (t) =>
        new Vector3(
          centre + 5.02 * Math.sin(t) * Math.cos(a),
          2.65 + 2.01 * Math.cos(t),
          roomZ * 0.993 * Math.sin(t) * Math.sin(a),
        );
      beam(
        point(((j / 12) * Math.PI) / 2),
        point((((j + 1) / 12) * Math.PI) / 2),
        0.012,
        metal,
      );
      if (j > 3 && j < 10 && rib % 2 === 0)
        beam(
          point((((j + 0.2) / 12) * Math.PI) / 2),
          point((((j + 0.65) / 12) * Math.PI) / 2),
          0.022,
          white,
        );
    }
  }
  const placed = rollerSeats(length, span);
  for (const p of placed) {
    const angle = Math.atan2(p.z / (p.z > 0 ? 1.8 : 1), p.x - centre);
    const yaw = -angle + Math.PI / 2;
    box(0.34, 0.07, 0.26, p.x, p.y - 0.035, p.z, dark, yaw);
    // The low back sits behind the standing spectator without hiding its legs.
    box(
      0.25,
      0.17,
      0.035,
      p.x + 0.1 * Math.cos(angle),
      p.y + 0.065,
      p.z + 0.1 * Math.sin(angle),
      seatPaint,
      yaw,
    );
    box(0.27, 0.018, 0.23, p.x, p.y + 0.008, p.z, seatPaint, yaw);
  }
  // Timber risers bridge the seat modules into continuous curved terraces.
  for (let row = 0; row < 6; row++)
    for (let i = 0; i < 64; i++) {
      const a = ((i + 0.5) / 64) * Math.PI * 2;
      if (a > Math.PI * 0.24 && a < Math.PI * 0.76) continue;
      const x = centre + (3.35 + row * 0.25) * Math.cos(a),
        z = (rz + row * 0.25) * Math.sin(a) * (Math.sin(a) > 0 ? 1.8 : 1);
      box(0.46, 0.14, 0.29, x, 0.31 + row * 0.14, z, wood, Math.PI / 2 - a);
    }
  // Continuous court markings remain separate from the competition's own lines.
  for (const x of [centre - 2.8, centre, centre + 2.8])
    box(0.025, 0.002, span + 2, x, -0.01, 0, white);
  for (const z of [-span / 2 - 0.7, span / 2 + 0.7])
    box(5.6, 0.002, 0.025, centre, -0.01, z, white);
  const circle = new Mesh(new RingGeometry(0.67, 0.69, 64), white);
  circle.rotation.x = -Math.PI / 2;
  circle.position.set(centre, -0.01, 0);
  group.add(circle);
  const sponsorMaps = ["pollen", "arena", "huggingFace"].map((b) =>
    sponsorTexture(b, branding),
  );
  sponsorMaps.forEach((map, i) => {
    textures.add(map);
    const material = new MeshBasicMaterial({ map });
    materials.add(material);
    const panel = new Mesh(new PlaneGeometry(1.45, 0.36), material);
    panel.position.set(centre + (i - 1) * 1.65, 1.85, -rz - 1.5);
    group.add(panel);
  });
  const audience = crowd(spectators.kinematics, spectators.geometries, placed);
  group.add(audience.group, audience.bubbles);
  // Three independently rendered camera feeds; all screens are hidden during
  // capture, preventing recursive screens and framebuffer feedback.
  const screens = new Group();
  screens.name = "arena-screens";
  group.add(screens);
  const feeds = [];
  for (let i = 0; i < 3; i++) {
    const target = new WebGLRenderTarget(768, 432, { depthBuffer: true });
    const material = new MeshBasicMaterial({
      map: target.texture,
      toneMapped: false,
    });
    materials.add(material);
    const panel = new Group();
    panel.position.set(centre + (i - 1) * 1.54, 2.55, i === 1 ? -0.05 : -0.55);
    panel.rotation.y = (i - 1) * -0.6;
    const w = i === 1 ? 1.95 : 1.35,
      h = i === 1 ? 1.1 : 0.76;
    const back = new Mesh(new BoxGeometry(w + 0.1, h + 0.1, 0.1), dark);
    panel.add(back);
    const face = new Mesh(new PlaneGeometry(w, h), material);
    face.position.z = 0.056;
    panel.add(face);
    screens.add(panel);
    const camera = new PerspectiveCamera(48, 16 / 9, 0.02, 50);
    feeds.push({ target, camera });
    for (const dx of [-w / 2, w / 2])
      box(
        0.025,
        1,
        0.025,
        panel.position.x + dx,
        3.55,
        panel.position.z,
        metal,
      );
  }
  box(4.6, 0.09, 0.8, centre, 3.23, -0.45, dark);
  for (let x = -2.2; x < 2.3; x += 0.28) {
    beam(
      new Vector3(centre + x, 3.2, -0.85),
      new Vector3(centre + x + 0.28, 3.38, -0.85),
      0.014,
      metal,
    );
  }
  for (const [m, parts] of batches) {
    group.add(new Mesh(mergeGeometries(parts), m));
    parts.forEach((g) => g.dispose());
  }
  let lastScreenTime = -Infinity;
  function renderScreens(renderer, scene, seconds, lead) {
    if (seconds >= lastScreenTime && seconds - lastScreenTime < 0.1) return;
    lastScreenTime = seconds;
    const poses = [
      [
        [lead - 0.8, 0.48, 1.35],
        [lead, 0.13, 0],
      ],
      [
        [length + 0.8, 0.7, -0.6],
        [lead, 0.13, 0],
      ],
      [
        [centre, 3.8, 0.25],
        [centre, 0, 0],
      ],
    ];
    const previous = renderer.getRenderTarget();
    screens.visible = false;
    try {
      feeds.forEach(({ target, camera }, i) => {
        camera.position.set(...poses[i][0]);
        camera.lookAt(...poses[i][1]);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      });
    } finally {
      renderer.setRenderTarget(previous);
      screens.visible = true;
    }
  }
  return {
    group,
    floorMaterial,
    sponsorMaps,
    pose: audience.pose,
    renderScreens,
    camera: {
      kind: "fixed",
      position: [centre + 0.2, 1.75, Math.max(5.3, span / 2 + 3.5)],
      target: [centre, 1.35, -0.35],
    },
    dispose() {
      audience.dispose();
      audience.group.removeFromParent();
      const geometries = new Set();
      group.traverse((n) => {
        if (n.isMesh) geometries.add(n.geometry);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      feeds.forEach((f) => f.target.dispose());
      group.removeFromParent();
    },
  };
}
