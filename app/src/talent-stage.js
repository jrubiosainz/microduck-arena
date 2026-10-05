import {
  AdditiveBlending, AmbientLight, BoxGeometry, CanvasTexture, CircleGeometry, Color,
  ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  ShaderMaterial, SphereGeometry, SpotLight, SRGBColorSpace, Vector3,
} from "three";
import { crowd } from "./stadium.js";
import { buildJudges } from "./judges.js";
import { frameAt, frameCount, CTRL_DT } from "./replay.js";

const mix = (a, b, t) => a + (b - a) * t;

export function stageLayout(event) {
  const width = Math.max(3.8, (event.length_m ?? 0) + 2);
  const depth = Math.max(2.6, (event.length_m ?? 0) + 0.8);
  return { width, depth, centre: (event.length_m ?? 0) / 2,
    juryZ: -depth / 2 - 0.5, audienceZ: -depth / 2 - 1.25 };
}

// Rotate the complete replay, including translation, so +X forward faces the
// audience at -Z. Centre its path on the stage without changing recorded frames.
export function placeStagePerformer(rig, trace, centre) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < frameCount(trace); i++) {
    const frame = frameAt(trace, i);
    minX = Math.min(minX, frame[0]); maxX = Math.max(maxX, frame[0]);
    minY = Math.min(minY, frame[1]); maxY = Math.max(maxY, frame[1]);
  }
  rig.placer.rotation.set(0, Math.PI / 2, 0);
  rig.placer.position.set(centre + (minY + maxY) / 2, 0, (minX + maxX) / 2);
}

// A symmetric 2.4 s Hann window removes gait sway without introducing lag.
// Read the recording, not the previous render: scrubbing and video exports agree.
export function stageCameraTarget(trace, seconds, placer) {
  let x = 0, y = 0, weight = 0;
  const count = frameCount(trace);
  const sample = seconds / CTRL_DT;
  const centre = Math.floor(sample), blend = sample - centre;
  for (let i = -30; i <= 30; i++) {
    const w = 0.5 + 0.5 * Math.cos(Math.PI * i / 30);
    const index = centre + i * 2;
    const frame = frameAt(trace, Math.max(0, Math.min(count - 1, index)));
    const next = frameAt(trace, Math.max(0, Math.min(count - 1, index + 1)));
    x += mix(frame[0], next[0], blend) * w;
    y += mix(frame[1], next[1], blend) * w;
    weight += w;
  }
  const target = new Vector3(x / weight, 0, -y / weight).applyMatrix4(placer.matrixWorld);
  target.y = 0.14;
  return target;
}

// The broadcast clock keeps moving during clip titles, even while replay time
// is held at zero. Each camera moves within its shot; cuts are instantaneous.
export function stageCameraPose(seconds, subjects, aspect, fov, depth = 2.6) {
  const target = subjects[0]?.clone() ?? new Vector3(0, 0.14, 0);
  target.y = Math.max(0.14, target.y) + 0.04;
  const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, aspect));
  const fit = 0.32 / Math.sin(halfFov) * 1.18;
  // One cycle of shots; a clip runs past it (titles and outro around a 20 s performance), and
  // there the last shot holds rather than cutting back to the opening.
  const time = Math.min(Math.max(0, seconds), 24);
  let shot, angle, distance, elevation;
  if (time < 3) {
    shot = "opening";
    const u = time / 3;
    angle = mix(0.3, 0.12, u);
    distance = mix(8, 6.6, u) / Math.min(1, aspect);
    elevation = mix(0.38, 0.33, u);
    target.y += 0.65;
  } else if (time < 7) {
    shot = "front";
    const u = (time - 3) / 4;
    angle = mix(-0.18, -0.06, u);
    distance = fit * mix(1.15, 1, u);
    elevation = 0.1;
  } else if (time < 11) {
    shot = "three-quarter";
    const u = (time - 7) / 4;
    angle = mix(-0.85, -0.65, u);
    distance = fit * mix(1.08, 1.18, u);
    elevation = mix(0.16, 0.12, u);
  } else if (time < 14) {
    shot = "jury";
    const u = (time - 11) / 3;
    angle = mix(1.85, 1.72, u);
    distance = Math.max(fit, 3.5);
    elevation = 0.24;
    target.y += 0.15;
    target.z -= 0.25;
  } else if (time < 18) {
    shot = "low-front";
    const u = (time - 14) / 4;
    angle = mix(0.4, 0.25, u);
    distance = fit * mix(1.15, 1, u);
    elevation = 0.06;
  } else {
    shot = "crane";
    const u = (time - 18) / 6;
    angle = mix(-0.18, -0.34, u);
    distance = mix(6.4, 8, u) / Math.min(1, aspect);
    elevation = mix(0.3, 0.4, u);
    target.y += 0.65;
  }
  const horizontal = distance * Math.cos(elevation);
  let dx = Math.sin(angle) * horizontal;
  let dz = -Math.cos(angle) * horizontal;
  if (shot !== "opening" && shot !== "crane") {
    // Keep low cameras between the desk and the LED wall. When a performer
    // approaches an edge, move sideways on the same radius to preserve framing.
    const z = Math.max(-depth / 2 - 0.08, Math.min(depth / 2 - 0.1, target.z + dz));
    if (z !== target.z + dz) {
      dz = z - target.z;
      dx = (dx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, horizontal * horizontal - dz * dz));
    }
  }
  return {
    shot,
    position: [target.x + dx, target.y + Math.sin(elevation) * distance, target.z + dz],
    target: target.toArray(),
  };
}

function titleMap() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#070b24"; ctx.fillRect(0, 0, 1536, 512);
  ctx.textAlign = "center";
  ctx.fillStyle = "#62dfff"; ctx.font = "700 64px sans-serif";
  ctx.fillText("MICRODUCK", 768, 112);
  ctx.shadowColor = "#747dff"; ctx.shadowBlur = 28;
  ctx.fillStyle = "#ffffff"; ctx.font = "900 136px sans-serif";
  ctx.fillText("GOT A TALENT", 768, 296);
  ctx.shadowBlur = 0; ctx.fillStyle = "#efb7ff"; ctx.font = "500 40px sans-serif";
  ctx.fillText("T H E   S T A G E   I S   Y O U R S", 768, 408);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A theatre in metres, with the performance floor still at physics y=0.
 * The jury and audience face +Z; the LED proscenium is upstage at +Z. */
export function buildTalentStage(event, spectators, reachy) {
  const layout = stageLayout(event);
  const { width, depth, centre, juryZ, audienceZ } = layout;
  const group = new Group(); group.name = "talent-theatre";
  const geometries = new Set(), materials = new Set(), textures = new Set();
  function surface(color, metalness = 0, roughness = 0.6) {
    const material = new MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 0.12 });
    materials.add(material); return material;
  }
  function led(color) {
    const material = new MeshBasicMaterial({ color, toneMapped: false });
    materials.add(material); return material;
  }
  function mesh(geometry, material, position, name) {
    geometries.add(geometry);
    const object = new Mesh(geometry, material);
    object.position.set(...position); object.name = name ?? "";
    group.add(object); return object;
  }
  function box(size, position, material, name) { return mesh(new BoxGeometry(...size), material, position, name); }
  function bar(a, b, thickness, material) {
    const start = new Vector3(...a), end = new Vector3(...b);
    const object = mesh(new CylinderGeometry(thickness, thickness, start.distanceTo(end), 6),
      material, start.clone().add(end).multiplyScalar(0.5).toArray());
    object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize());
    return object;
  }
  const black = surface(0x090d1c, 0.05, 0.65), steel = surface(0x354259, 0.7, 0.3);
  const velvet = surface(0x160b29), seat = surface(0x35213e);
  const cyan = led(0x59dcff), violet = led(0x9959ff), white = led(0xdcefff), gold = led(0xffca70);
  box([width + 6, 0.08, depth + 8], [centre, -0.28, -1.5], black, "auditorium-floor");
  // Inward-facing walls keep the crane's exterior establishing view unobstructed.
  mesh(new PlaneGeometry(width + 5, 3.4), velvet, [centre, 1.45, audienceZ - 2.4], "auditorium-back");
  for (const side of [-1, 1]) {
    const x = centre + side * (width / 2 + 2.5);
    const wing = mesh(new PlaneGeometry(depth + 5, 3.4), velvet, [x, 1.45, -1.5], "auditorium-wing");
    wing.rotation.y = -side * Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      box([0.025, 1.5, 0.025], [x - side * 0.08, 1.4, 0.9 - i], i % 2 ? violet : cyan);
    }
  }
  box([width, 0.2, depth], [centre, -0.105, 0], black, "stage-plinth");
  const floor = surface(0x10172b, 0, 0.9);
  floor.envMapIntensity = 0;
  const ground = mesh(new PlaneGeometry(width, depth), floor, [centre, 0, 0], "ground");
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  for (const side of [-1, 1]) {
    box([width, 0.012, 0.025], [centre, 0.003, side * depth / 2], cyan);
    box([0.025, 0.012, depth], [centre + side * width / 2, 0.003, 0], violet);
    for (let step = 0; step < 3; step++) {
      box([0.65, 0.065, 0.18], [centre + side * (width / 2 + 0.32), -0.035 - step * 0.065, -depth / 2 - step * 0.17], black);
    }
  }
  const backZ = depth / 2 + 0.12;
  box([width + 2.4, 3.3, 0.16], [centre, 1.4, backZ + 0.3], velvet, "backdrop");
  // Nested chevrons and a field of LEDs give the wall depth without a video texture.
  for (let n = 0; n < 4; n++) {
    const extent = width / 2 + 0.65 - n * 0.24;
    for (const side of [-1, 1]) {
      const x = centre + side * extent;
      bar([x, 0.08, backZ], [x, 1.7, backZ], 0.013, n % 2 ? violet : cyan);
      bar([x, 1.7, backZ], [centre, 2.85 - n * 0.15, backZ], 0.013, n % 2 ? violet : cyan);
    }
  }
  for (let i = 0; i < 65; i++) {
    mesh(new SphereGeometry(0.008, 6, 4), i % 3 ? cyan : violet,
      [centre + ((i * 0.618034) % 1 - 0.5) * width, 0.35 + ((i * 0.414214) % 1) * 2.3, backZ + 0.04]);
  }
  const map = titleMap(); textures.add(map);
  const titleMaterial = new MeshBasicMaterial({ map, toneMapped: false }); materials.add(titleMaterial);
  const title = mesh(new PlaneGeometry(2.35, 0.78), titleMaterial, [centre, 1.68, backZ - 0.02], "talent-title");
  title.rotation.y = Math.PI;
  // Four luminous Xs above the proscenium, echoing the four seats at the desk.
  for (let i = 0; i < 4; i++) {
    const x = centre + (i - 1.5) * 0.58;
    for (const sign of [-1, 1]) bar([x - 0.11, 2.65 + sign * 0.11, backZ - 0.08],
      [x + 0.11, 2.65 - sign * 0.11, backZ - 0.08], 0.018, white);
  }
  for (const side of [-1, 1]) {
    const x = centre + side * (width / 2 + 0.4);
    for (const dx of [-0.07, 0.07]) bar([x + dx, -0.2, backZ], [x + dx, 2.95, backZ], 0.022, steel);
    for (let n = 0; n < 11; n++) bar([x - 0.07, n * 0.26, backZ], [x + 0.07, (n + 1) * 0.26, backZ], 0.012, steel);
    box([0.24, 0.66, 0.3], [x, 0.25, -depth / 2 + 0.2], black, "speaker");
  }
  for (const z of [backZ, -depth / 2]) bar([centre - width / 2 - 0.5, 2.95, z],
    [centre + width / 2 + 0.5, 2.95, z], 0.028, steel);

  const panel = buildJudges(reachy, centre * 2, -juryZ - 0.35, [], 4);
  for (const furniture of panel.group.children.filter(child => child.isMesh)) {
    if ([0x268a91, 0xd8a56a].includes(furniture.material.color.getHex())) furniture.material.color.set(0x191c32);
  }
  group.add(panel.group);
  // A black, illuminated broadcast desk wraps the existing articulated jury.
  box([1.94, 0.22, 0.035], [centre, 0.14, juryZ + 0.145], black, "jury-desk");
  box([1.98, 0.018, 0.32], [centre, 0.29, juryZ], white);
  box([1.94, 0.014, 0.04], [centre, 0.04, juryZ + 0.16], cyan);
  for (let i = 0; i < 4; i++) {
    const x = centre + (i - 1.5) * 0.45;
    for (const sign of [-1, 1]) bar([x - 0.055, 0.15 + sign * 0.055, juryZ + 0.17],
      [x + 0.055, 0.15 - sign * 0.055, juryZ + 0.17], 0.009, white);
    mesh(new CylinderGeometry(0.029, 0.033, 0.012, 16), gold, [x, 0.309, juryZ + 0.05], "judge-buzzer");
  }

  const seats = [];
  for (let row = 0; row < 6; row++) {
    const z = audienceZ - row * 0.32;
    const y = 0.3 + row * 0.12;
    box([width + 1.4, y + 0.24, 0.32], [centre, (y - 0.24) / 2, z], black);
    for (let i = 0; i < 20; i++) {
      const x = centre + (i - 9.5) * (width + 1) / 20 + (i < 10 ? -0.18 : 0.18);
      box([0.19, 0.025, 0.2], [x, y, z], seat);
      box([0.19, 0.16, 0.025], [x, y + 0.07, z - 0.11], seat);
      seats.push({ x, y: y + 0.016, z, yaw: -Math.PI / 2 });
    }
    for (const x of [centre - width / 2 - 0.55, centre + width / 2 + 0.55]) {
      box([0.04, 0.008, 0.22], [x, y + 0.015, z], gold);
    }
  }
  const audience = crowd(spectators.kinematics, spectators.geometries, seats);
  group.add(audience.group);

  group.add(new AmbientLight(0x758bbb, 0.15));
  const fill = new DirectionalLight(0xaacbff, 0.45); fill.position.set(centre, 1.5, -3); group.add(fill);
  const rim = new DirectionalLight(0xc986ff, 0.8); rim.position.set(centre, 2, backZ); group.add(rim);
  // A followspot hung at the end of the front truss: its operator keeps the
  // performer in a tight pool, and the beam shows in the haze.
  const FOLLOW_ANGLE = 0.07;
  const followSpot = new SpotLight(0xfff0da, 150, 0, FOLLOW_ANGLE, 0.3, 2);
  followSpot.name = "follow-spot";
  // Only the performer stands in its narrow cone: a shadow map cheap to redraw every frame.
  followSpot.castShadow = true;
  followSpot.shadow.mapSize.set(1024, 1024);
  followSpot.shadow.camera.far = 8;
  followSpot.shadow.bias = -0.0002;
  followSpot.position.set(centre + width / 2 + 0.45, 2.8, -depth / 2);
  group.add(followSpot, followSpot.target);
  const follow = new Object3D(); follow.position.copy(followSpot.position); group.add(follow);
  // A unit cone from its apex along +Z: scaled to the throw, it widens with the light.
  const shaftGeometry = new ConeGeometry(Math.tan(FOLLOW_ANGLE), 1, 32, 1, true)
    .translate(0, -0.5, 0).rotateX(-Math.PI / 2);
  const shaftMaterial = new ShaderMaterial({
    uniforms: { tint: { value: new Color(0xfff0da) } }, transparent: true, depthWrite: false,
    blending: AdditiveBlending, side: DoubleSide,
    vertexShader: "varying vec2 vUv; varying vec3 vNormal, vView; void main(){vUv=uv;vNormal=normalMatrix*normal;vec4 p=modelViewMatrix*vec4(position,1.0);vView=-p.xyz;gl_Position=projectionMatrix*p;}",
    // Faint at grazing angles so the cone reads as a volume, not a surface.
    fragmentShader: "varying vec2 vUv; varying vec3 vNormal, vView; uniform vec3 tint; void main(){float facing=abs(dot(normalize(vNormal),normalize(vView)));gl_FragColor=vec4(tint,0.16*pow(facing,2.0)*mix(0.45,1.0,vUv.y));}",
  });
  const headGeometry = new CylinderGeometry(0.09, 0.12, 0.5, 16).rotateX(Math.PI / 2).translate(0, 0, -0.22);
  const lensGeometry = new CircleGeometry(0.085, 20);
  [shaftGeometry, headGeometry, lensGeometry].forEach(geometry => geometries.add(geometry));
  materials.add(shaftMaterial);
  const shaft = new Mesh(shaftGeometry, shaftMaterial); shaft.name = "follow-beam";
  follow.add(shaft, new Mesh(headGeometry, black), new Mesh(lensGeometry, led(0xfff0da)));
  const _axis = new Vector3();
  // Soft additive shafts show the moving lights in the theatrical haze.
  const beamGeometry = new ConeGeometry(0.48, 2.8, 24, 1, true);
  beamGeometry.translate(0, -1.4, 0); geometries.add(beamGeometry);
  const beams = Array.from({ length: 6 }, (_, i) => {
    const color = new Color(i % 2 ? 0xb66bff : 0x47cfff);
    const material = new ShaderMaterial({
      uniforms: { tint: { value: color } }, transparent: true, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide,
      vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec2 vUv; uniform vec3 tint; void main(){gl_FragColor=vec4(tint,0.075*vUv.y*pow(sin(vUv.x*3.14159265),2.0));}",
    });
    materials.add(material);
    const pivot = new Object3D(); pivot.position.set(centre + (i - 2.5) * width / 6, 2.8, backZ - 0.2);
    const beam = new Mesh(beamGeometry, material); pivot.add(beam); group.add(pivot);
    mesh(new CylinderGeometry(0.065, 0.08, 0.16, 12), black, pivot.position.toArray(), "moving-head");
    mesh(new SphereGeometry(0.042, 8, 6), i % 2 ? violet : cyan, pivot.position.toArray());
    return pivot;
  });

  function pose(seconds, subjects, mood) {
    panel.pose(seconds, subjects); audience.pose(seconds, mood);
    followSpot.target.position.copy(subjects[0] ?? new Vector3(centre, 0.1, 0));
    // The shaft runs through the performer and sinks into the floor: long enough
    // that the highest point of its open rim is below the stage, so no rim shows.
    const source = followSpot.position;
    _axis.subVectors(followSpot.target.position, source).normalize();
    follow.lookAt(followSpot.target.position);
    shaft.scale.setScalar(source.y / (-_axis.y - Math.tan(FOLLOW_ANGLE) * Math.sqrt(1 - _axis.y ** 2)));
    beams.forEach((beam, i) => {
      beam.rotation.set(0.25 + 0.16 * Math.sin(seconds * 0.43 + i), 0,
        0.35 * Math.sin(seconds * 0.37 + i * 1.3));
    });
  }
  return {
    group, layout, pose, crowd: audience,
    dispose() {
      panel.dispose(); audience.dispose(); followSpot.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      group.removeFromParent();
    },
  };
}
