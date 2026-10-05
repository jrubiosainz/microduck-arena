import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";

const clamp = (x, limit) => Math.max(-limit, Math.min(limit, x));
const smooth = (x) => x * x * (3 - 2 * x);

// Reachy faces +X in the official model. The table faces +Z, towards the lanes.
// Blend between competitors instead of snapping at each change of attention.
export function judgeGaze(seconds, index, position, racers) {
  const clock = seconds / (4.2 + index * 0.43) + index * 0.71;
  const beat = Math.floor(clock);
  const blend = smooth(Math.min(1, (clock - beat) * 4));
  const at = (i) => racers[((i % racers.length) + racers.length) % racers.length];
  const a = racers.length ? at(beat + index) : { x: position.x, y: 0.18, z: 0 };
  const b = racers.length ? at(beat + index + 1) : a;
  const dx = a.x + (b.x - a.x) * blend - position.x;
  const dz = a.z + (b.z - a.z) * blend - position.z;
  const dy = a.y + (b.y - a.y) * blend - position.y;
  const phase = seconds * 1.3 + index * 2.4;
  return {
    yaw: clamp(Math.atan2(dx, dz) + 0.025 * Math.sin(phase * 0.7), 1.05),
    pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz)) + 0.035 * Math.sin(phase), 0.32),
    roll: 0.035 * Math.sin(phase * 0.63),
    right: 0.13 * Math.sin(phase * 1.7) + 0.06 * Math.sin(phase * 3.1),
    left: 0.12 * Math.sin(phase * 1.4 + 1.8),
  };
}

export function buildJudges(model, length, edge, sponsorMaps, count = 4) {
  const group = new Group();
  group.name = "judges";
  const furniture = [];
  const materials = [0xd8a56a, 0x243c44, 0x268a91, 0xff7935, 0xfaf6e9].map(
    (color) => new MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  function box(w, h, d, x, y, z, material) {
    const mesh = new Mesh(new BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, -z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    furniture.push(mesh.geometry);
    return mesh;
  }
  const centre = length / 2;
  const z = edge + 0.35;
  // Desktop robots sit on low chairs behind a table, all dimensions in metres.
  box(1.86, 0.035, 0.27, centre, 0.27, z, 0);
  box(1.84, 0.13, 0.025, centre, 0.185, z - 0.12, 2);
  box(1.84, 0.022, 0.028, centre, 0.255, z - 0.12, 3);
  sponsorMaps.forEach((map, i) => {
    const material = new MeshBasicMaterial({ map });
    const panel = new Mesh(new PlaneGeometry(0.44, 0.11), material);
    panel.position.set(centre + (i - 1) * 0.59, 0.185, -z + 0.134);
    group.add(panel);
    furniture.push(panel.geometry);
    materials.push(material);
    // Logo textures are shared with the wall signs and owned by the gym.
  });
  for (const x of [centre - 0.82, centre + 0.82]) {
    for (const dz of [-0.09, 0.09]) box(0.035, 0.25, 0.035, x, 0.125, z + dz, 1);
  }
  const judges = Array.from({ length: count }, (_, i) => {
    const x = centre + (i - (count - 1) / 2) * 0.45;
    const seatZ = z + 0.24;
    box(0.22, 0.028, 0.22, x, 0.18, seatZ, 2);
    box(0.22, 0.16, 0.025, x, 0.26, seatZ + 0.115, 2);
    for (const dx of [-0.085, 0.085]) {
      for (const dz of [-0.085, 0.085]) box(0.018, 0.17, 0.018, x + dx, 0.085, seatZ + dz, 1);
    }
    // Score sheet, pencil and a small numbered desk card.
    box(0.13, 0.002, 0.10, x, 0.289, z, 4);
    box(0.085, 0.005, 0.005, x, 0.293, z + 0.03, 3);
    box(0.105, 0.045, 0.018, x, 0.31, z - 0.085, 4);
    for (let n = 0; n <= i; n++) box(0.006, 0.023, 0.002, x + (n - i / 2) * 0.014, 0.31, z - 0.095, 1);
    const robot = model.clone(true);
    robot.name = `judge-${i + 1}`;
    robot.traverse(node => { if (node.isMesh) node.castShadow = node.receiveShadow = true; });
    robot.position.set(x, 0.194, -seatZ);
    robot.rotation.y = -Math.PI / 2;
    group.add(robot);
    const head = robot.getObjectByName("reachy_head");
    head.position.y += 0.02;
    return {
      robot,
      head,
      right: robot.getObjectByName("antenna_right"),
      left: robot.getObjectByName("antenna_left"),
      eye: new Vector3(x, 0.42, -seatZ),
    };
  });
  function pose(seconds, racers) {
    judges.forEach(({ head, left, right, eye }, i) => {
      const gaze = judgeGaze(seconds, i, eye, racers);
      head.rotation.set(gaze.roll, gaze.yaw, gaze.pitch, "YXZ");
      right.rotation.x = gaze.right;
      left.rotation.x = gaze.left;
    });
  }
  pose(0, []);
  return {
    group, pose,
    dispose() {
      group.removeFromParent();
      furniture.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      // Clones share the cached official model's geometry and materials.
    },
  };
}
