import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BoxGeometry, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildTalentStage, stageCameraPose, stageLayout, placeStageDuck, placeStagePerformer, stageCameraTarget } from "./talent-stage.js";
import { applyFrame } from "./replay.js";
import { meshNames, buildRigTree, STAND, TRUNK_HEIGHT } from "./rig.js";

const STAGE = { id: "got-a-talent", course: "stage", size_m: [2.6, 3.8] };
const subjects = [new Vector3(0.4, 0.14, 0.1)];

describe("the MicroDuck Got a Talent broadcast camera", () => {
  it.each([16 / 9, 9 / 16])("keeps the solo performer in frame at aspect %s", aspect => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    for (let time = 0; time <= 20; time += 0.25) {
      const pose = stageCameraPose(time, subjects, aspect, 42);
      camera.position.set(...pose.position);
      camera.lookAt(new Vector3(...pose.target));
      camera.updateMatrixWorld();
      for (const subject of subjects) {
        for (const height of [-0.14, 0.23]) {
          const projected = subject.clone().add(new Vector3(0, height, 0)).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.9);
          expect(Math.abs(projected.y)).toBeLessThan(0.9);
        }
      }
    }
  });
  it("moves throughout the intro and cuts between deterministic television shots", () => {
    const at = t => stageCameraPose(t, subjects, 16 / 9, 42);
    for (let t = 0; t < 2.99; t += 0.04) {
      expect(new Vector3(...at(t).position).distanceTo(new Vector3(...at(t + 0.04).position))).toBeGreaterThan(0.0001);
    }
    const first = at(5);
    at(19);
    expect(at(5)).toEqual(first);
    expect(new Set([1, 4, 8, 12, 16, 20].map(t => at(t).shot)).size).toBe(6);
    for (const cut of [3, 7, 11, 14, 18]) {
      expect(at(cut - 0.001).shot).not.toBe(at(cut).shot);
      expect(new Vector3(...at(cut - 0.001).position).distanceTo(new Vector3(...at(cut).position))).toBeGreaterThan(0.2);
    }
  });
  it("holds its last shot past the cycle: a clip's outro ends on the crane, not back on the opening", () => {
    const subject = [new Vector3(0, 0.14, 0)];
    const end = stageCameraPose(24, subject, 16 / 9, 42);
    const after = stageCameraPose(25.5, subject, 16 / 9, 42);
    expect(after.shot).toBe("crane");
    expect(after.position).toEqual(end.position);
  });
  it("frames a lone performer exactly as it always has, a centred one in every shot at both aspects", () => {
    // Taken from the camera before troupes (0737cbd), for the performer above...
    const before = [
      [16 / 9, 4, [0.22570329630569386, 0.29702503451609114, -1.0532500891160745], [0.4, 0.18, 0.1]],
      [16 / 9, 8, [-0.42583949082768935, 0.35399089951391566, -0.7020673712856054], [0.4, 0.18, 0.1]],
      [16 / 9, 12, [3.7055501813912617, 1.161959192494971, 0.644469571681202], [0.4, 0.33, -0.15]],
      [16 / 9, 16, [0.7610272280823642, 0.24792066517393552, -0.9714635177655214], [0.4, 0.18, 0.1]],
      [9 / 16, 4, [-0.9158909874814564, 0.3787024028692959, -1.38], [0.4, 0.18, 0.1]],
      [9 / 16, 20, [-2.2931488880415913, 4.862977596065165, -11.231835275359844], [0.4, 0.83, 0.1]],
    ];
    // ...and for a duck at the stage's centre, every 1.5 s of the cycle and of a clip's held outro.
    const centred = [
      [16 / 9, 0, [2.195513320197183, 3.7973637553038615, -7.097497700214189], [0, 0.8300000000000001, 0]],
      [16 / 9, 1.5, [1.4268703599973978, 3.367409666221225, -6.6944449479794805], [0, 0.8300000000000001, 0]],
      [16 / 9, 3, [-0.21584914853287993, 0.3009696986009032, -1.1861829267316353], [0, 0.18000000000000002, 0]],
      [16 / 9, 4.5, [-0.1543332796760558, 0.29505270247368515, -1.1362560286514083], [0, 0.18000000000000002, 0]],
      [16 / 9, 6, [-0.09776240603813176, 0.289135706346467, -1.083314498824379], [0, 0.18000000000000002, 0]],
      [16 / 9, 7.5, [-0.8354228206990366, 0.3577115215832839, -0.7717428163661004], [0, 0.18000000000000002, 0]],
      [16 / 9, 9, [-0.803647286755018, 0.34614591951335627, -0.862656011813596], [0, 0.18000000000000002, 0]],
      [16 / 9, 10.5, [-0.7627225288340035, 0.3333692031699481, -0.9528970026054674], [0, 0.18000000000000002, 0]],
      [16 / 9, 12, [3.3055501813912618, 1.161959192494971, 0.544469571681202], [0, 0.33, -0.25]],
      [16 / 9, 13.5, [3.3501738311818254, 1.161959192494971, 0.3280823495727987], [0, 0.33, -0.25]],
      [16 / 9, 15, [0.4149302902557396, 0.25028999070325886, -1.0940530787414524], [0, 0.18000000000000002, 0]],
      [16 / 9, 16.5, [0.33492951002944404, 0.24673600240927385, -1.0592409501935804], [0, 0.18000000000000002, 0]],
      [16 / 9, 18, [-1.0946142984082035, 2.721329322632573, -6.015371387626082], [0, 0.8300000000000001, 0]],
      [16 / 9, 19.5, [-1.4062771336971576, 3.001299743827607, -6.288707501998697], [0, 0.8300000000000001, 0]],
      [16 / 9, 21, [-1.7387600792488929, 3.29886421367925, -6.536162703086906], [0, 0.8300000000000001, 0]],
      [16 / 9, 22.5, [-2.0898769159288384, 3.6136712210539614, -6.756003923129685], [0, 0.8300000000000001, 0]],
      [16 / 9, 24, [-2.457295620594802, 3.9453467384692043, -6.9466763946591685], [0, 0.8300000000000001, 0]],
      [16 / 9, 25.5, [-2.457295620594802, 3.9453467384692043, -6.9466763946591685], [0, 0.8300000000000001, 0]],
      [9 / 16, 0, [3.9031347914616585, 6.10531334276242, -12.617773689269669], [0, 0.8300000000000001, 0]],
      [9 / 16, 1.5, [2.5366584177731517, 5.340950517726623, -11.901235463074633], [0, 0.8300000000000001, 0]],
      [9 / 16, 3, [-1.5120938204898329, 0.3854002366738789, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 4.5, [-1.373492606723261, 0.3753534859670044, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 6, [-1.2274319334693995, 0.3653067352601299, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 7.5, [-1.418504361662189, 0.481744891613784, -1.3103790367861539], [0, 0.18000000000000002, 0]],
      [9 / 16, 9, [-1.4501991229421476, 0.4621071027301693, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 10.5, [-1.5461608212408793, 0.4404129049996356, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 12, [3.3055501813912618, 1.161959192494971, 0.544469571681202], [0, 0.33, -0.25]],
      [9 / 16, 13.5, [3.3501738311818254, 1.161959192494971, 0.3280823495727987], [0, 0.33, -0.25]],
      [9 / 16, 15, [1.42926820955728, 0.29934873685918495, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 16.5, [1.2859793181497112, 0.29331425016405765, -1.3800000000000001], [0, 0.18000000000000002, 0]],
      [9 / 16, 18, [-1.9459809749479169, 4.192363240235686, -10.693993578001923], [0, 0.8300000000000001, 0]],
      [9 / 16, 19.5, [-2.5000482376838353, 4.690088433471301, -11.179924447997683], [0, 0.8300000000000001, 0]],
      [9 / 16, 21, [-3.0911290297758094, 5.219091935429778, -11.619844805487832], [0, 0.8300000000000001, 0]],
      [9 / 16, 22.5, [-3.7153367394290466, 5.778748837429265, -12.010673641119443], [0, 0.8300000000000001, 0]],
      [9 / 16, 24, [-4.368525547724092, 6.36839420172303, -12.34964692383852], [0, 0.8300000000000001, 0]],
      [9 / 16, 25.5, [-4.368525547724092, 6.36839420172303, -12.34964692383852], [0, 0.8300000000000001, 0]],
    ];
    for (const [ducks, poses] of [[subjects, before], [[new Vector3(0, 0.14, 0)], centred]]) {
      for (const [aspect, time, position, target] of poses) {
        const pose = stageCameraPose(time, ducks, aspect, 42);
        pose.position.forEach((value, i) => expect(value).toBeCloseTo(position[i], 9));
        pose.target.forEach((value, i) => expect(value).toBeCloseTo(target[i], 9));
      }
    }
  });
});

describe("the broadcast camera on a troupe", () => {
  // Four ducks spread over the stage, the star first.
  const troupe = [new Vector3(0.2, 0.14, 0.1), new Vector3(-1.3, 0.14, -0.7), new Vector3(1.4, 0.14, 0.7), new Vector3(0.9, 0.14, -0.8)];
  const V = (x, z) => new Vector3(x, 0.14, z);
  // Lines along the back of the stage, where the backdrop keeps the jury's camera close beside them.
  const back = [
    [V(-1.7, 1.1), V(-0.6, 1.1), V(0.6, 1.1), V(1.7, 1.1)],
    [V(-1.6, 0.9), V(1.6, 0.9)],
    [V(-1.8, 0.9), V(1.8, 0.9)],
  ];
  // How near the frame's edge a pose puts the farthest-out duck, feet or crest: 1 is the edge itself.
  const edge = (pose, ducks, aspect) => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    camera.position.set(...pose.position);
    camera.lookAt(new Vector3(...pose.target));
    camera.updateMatrixWorld();
    return Math.max(...ducks.flatMap((duck) => [-0.14, 0.23].flatMap((height) => {
      const projected = duck.clone().add(new Vector3(0, height, 0)).project(camera);
      return [Math.abs(projected.x), Math.abs(projected.y)];
    })));
  };

  it.each([16 / 9, 9 / 16])("keeps every duck in frame at aspect %s, but in the star's close-up", aspect => {
    const camera = new PerspectiveCamera(42, aspect, 0.02, 100);
    for (let time = 0; time <= 24; time += 0.25) {
      const pose = stageCameraPose(time, troupe, aspect, 42, 2.6);
      if (pose.shot === "low-front") continue;
      camera.position.set(...pose.position);
      camera.lookAt(new Vector3(...pose.target));
      camera.updateMatrixWorld();
      for (const duck of troupe) {
        for (const height of [-0.14, 0.23]) {
          const projected = duck.clone().add(new Vector3(0, height, 0)).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.9);
          expect(Math.abs(projected.y)).toBeLessThan(0.9);
        }
      }
    }
  });
  it("keeps every camera but the opening's and the crane's inside the theatre, a low one on a lone duck's bearing", () => {
    // The wing walls stand at ±4.4 m and the backdrop beyond the stage's back edge; past either, a
    // camera looks through their backs. The opening and the crane look in from outside, as they
    // always have. A camera may stand on the limit itself, to the last bit of a float.
    const bearing = pose => Math.atan2(pose.position[0] - pose.target[0], pose.target[2] - pose.position[2]);
    for (const aspect of [16 / 9, 9 / 16]) {
      for (let time = 0; time <= 24; time += 0.5) {
        const pose = stageCameraPose(time, troupe, aspect, 42, 2.6);
        const inside = pose.shot !== "opening" && pose.shot !== "crane";
        if (inside) expect(Math.abs(pose.position[0])).toBeLessThan(4.1 + 1e-9);
        expect(pose.position[2]).toBeLessThan(1.3);
        if (aspect > 1 && inside) {
          const lone = stageCameraPose(time, troupe.slice(0, 1), aspect, 42, 2.6);
          expect(Math.abs(bearing(pose) - bearing(lone))).toBeLessThan(15 * Math.PI / 180);
        }
      }
    }
  });
  it.each([16 / 9, 9 / 16])("holds a line along the back within the lone duck's margin for the whole jury shot at aspect %s", aspect => {
    for (const ducks of back) {
      for (let frame = 11 * 30; frame < 14 * 30; frame++) {
        expect(edge(stageCameraPose(frame / 30, ducks, aspect, 42), ducks, aspect)).toBeLessThanOrEqual(0.86);
      }
    }
  });
  it.each([16 / 9, 9 / 16])("glides within every shot at aspect %s, however the troupe spreads", aspect => {
    // A lone duck's camera moves at most 0.039 m from one frame to the next at 30 fps, in the 9:16
    // opening's dolly. A troupe's is fitted once a shot: it rides the lone duck's path, or turns
    // steadily, raised by the same lift throughout, so it neither jumps nor slides along a bound.
    const troupes = [
      [V(0.64, -1.07), V(0.35, -0.06), V(0.92, -0.22)], // downstage: its front camera on the desk's line
      troupe,
      [V(-1.2, 0), V(1.2, 0)], // across the stage
      [V(-1.5, 1), V(0, 1), V(1.5, 1)], // along the back
      [V(0.3, -1), V(0.3, 0), V(0.3, 1)], // from front to back
      [V(-1.6, -1), V(1.6, -1), V(-1.6, 1), V(1.6, 1)], // in the four corners
      ...back,
    ];
    for (const ducks of troupes) {
      let previous = stageCameraPose(0, ducks, aspect, 42);
      for (let frame = 1; frame <= 24 * 30; frame++) {
        const pose = stageCameraPose(frame / 30, ducks, aspect, 42);
        if (pose.shot === previous.shot) {
          expect(new Vector3(...pose.position).distanceTo(new Vector3(...previous.position))).toBeLessThan(0.05);
        }
        previous = pose;
      }
    }
  });
  it("fits a shot once to a troupe that spreads during it, holding every duck at every frame", () => {
    // A pair walking apart through the front shot, from 0.4 m off the middle to 1 m, as fast as a duck walks.
    const placesAt = (seconds) => {
      const half = 0.4 + 0.15 * Math.min(4, Math.max(0, seconds - 3));
      return [V(-half, 0.2), V(half, 0.2)];
    };
    for (const aspect of [16 / 9, 9 / 16]) {
      let previous = null;
      for (let frame = 3 * 30; frame < 7 * 30; frame++) {
        const ducks = placesAt(frame / 30);
        const pose = stageCameraPose(frame / 30, ducks, aspect, 42, 2.6, 3.8, placesAt);
        expect(edge(pose, ducks, aspect)).toBeLessThanOrEqual(0.86);
        if (previous) expect(new Vector3(...pose.position).distanceTo(new Vector3(...previous.position))).toBeLessThan(0.05);
        previous = pose;
      }
    }
  });
  it("closes in on the star alone in the low front shot, as on a lone performer", () => {
    for (const time of [14, 16, 17.9]) {
      expect(stageCameraPose(time, troupe, 16 / 9, 42)).toEqual(stageCameraPose(time, troupe.slice(0, 1), 16 / 9, 42));
    }
  });
  it("frames ducks all on one spot as that one duck", () => {
    const stacked = [troupe[0], troupe[0].clone(), troupe[0].clone()];
    for (let time = 0; time <= 24; time += 0.5) {
      expect(stageCameraPose(time, stacked, 16 / 9, 42)).toEqual(stageCameraPose(time, troupe.slice(0, 1), 16 / 9, 42));
    }
  });
});

describe("theatre layout", () => {
  it("builds the theatre round the event's own floor, centred on the physics' origin", () => {
    const layout = stageLayout({ ...STAGE, size_m: [3, 5] });
    expect(layout).toMatchObject({ width: 5, depth: 3, centre: 0 });
    expect(layout.juryZ).toBeLessThan(-layout.depth / 2);
    expect(layout.audienceZ).toBeLessThan(layout.juryZ - 0.5);
  });
});

describe("the solo stage", () => {
  let reachy;
  beforeAll(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath() {}, roundRect() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, fillRect() {},
    });
    const bytes = readFileSync("public/robot/reachy-mini/reachy-mini.glb");
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    reachy = (await new GLTFLoader().parseAsync(buffer, "")).scene;
  });
  it("seats four official judges before the audience and follows a moving performer when seeking", () => {
    const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
    const geometries = new Map(meshNames(kinematics).map(name => [name, new BoxGeometry(0.01, 0.01, 0.01)]));
    const stage = buildTalentStage(STAGE, { kinematics, geometries }, reachy);
    const jury = stage.group.getObjectByName("judges");
    expect(jury.children.filter(child => child.name.startsWith("judge-"))).toHaveLength(4);
    expect(stage.group.getObjectByName("finish")).toBeUndefined();
    expect(stage.group.getObjectByName("walls")).toBeUndefined();
    stage.group.updateMatrixWorld(true);
    const centre = new Vector3(0, 0.14, 0);
    for (const aspect of [16 / 9, 9 / 16]) {
      const opening = stageCameraPose(0, [centre], aspect, 42);
      const eye = new Vector3(...opening.position);
      const ray = new Raycaster(eye, centre.clone().sub(eye).normalize(), 0, eye.distanceTo(centre));
      const walls = stage.group.children.filter(child => ["auditorium-back", "auditorium-wing"].includes(child.name));
      expect(ray.intersectObjects(walls)).toHaveLength(0);
    }
    for (const aspect of [16 / 9, 9 / 16]) {
      for (const z of [-1, 1]) {
        const performer = new Vector3(0, 0.14, z);
        for (const time of [4, 8, 12, 16]) {
          const pose = stageCameraPose(time, [performer], aspect, 42);
          const next = stageCameraPose(time + 0.001, [performer], aspect, 42);
          expect(new Vector3(...pose.position).distanceTo(new Vector3(...next.position))).toBeLessThan(0.01);
          const eye = new Vector3(...pose.position);
          const ray = new Raycaster(eye, performer.clone().sub(eye).normalize(), 0, eye.distanceTo(performer));
          const obstacles = stage.group.children.filter(child => ["judges", "jury-desk", "backdrop"].includes(child.name));
          expect(ray.intersectObjects(obstacles)).toHaveLength(0);
        }
      }
    }
    const target = new Vector3(0.8, 0.13, -0.2);
    stage.pose(8, [target]);
    const light = stage.group.getObjectByName("follow-spot");
    expect(light.isSpotLight).toBe(true);
    expect(light.target.position.toArray()).toEqual(target.toArray());
    stage.pose(1, [new Vector3(-0.3, 0.08, 0.4)]);
    expect(light.target.position.toArray()).toEqual([-0.3, 0.08, 0.4]);
    expect(light.castShadow).toBe(true);
    // The beam's open rim sinks just below the stage, so its edge never shows.
    const beam = stage.group.getObjectByName("follow-beam");
    stage.group.updateMatrixWorld(true);
    const positions = beam.geometry.attributes.position, vertex = new Vector3();
    let rimTop = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      if (vertex.z > 0.999) rimTop = Math.max(rimTop, vertex.applyMatrix4(beam.matrixWorld).y);
    }
    expect(rimTop).toBeLessThan(1e-6);
    expect(rimTop).toBeGreaterThan(-0.01);
    expect(stage.group.getObjectByName("follow-pool")).toBeUndefined();
    const shared = vi.spyOn(reachy.getObjectByProperty("isMesh", true).geometry, "dispose");
    stage.dispose();
    expect(shared).not.toHaveBeenCalled();
    geometries.forEach(geometry => geometry.dispose());
  });
});


it("turns the robot and its complete recorded trajectory toward the audience", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const rig = buildRigTree(kinematics);
  const frame = x => [x, 0, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND];
  const trace = Float32Array.from([...frame(0), ...frame(1), ...frame(2)]);
  const original = trace.slice();
  placeStagePerformer(rig, trace, 1);
  const forward = new Vector3(1, 0, 0).applyQuaternion(rig.placer.quaternion);
  expect(forward.x).toBeCloseTo(0);
  expect(forward.z).toBeCloseTo(-1);
  applyFrame(rig, trace.subarray(0, 21));
  const start = rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  applyFrame(rig, trace.subarray(42, 63));
  const end = rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  expect(start.x).toBeCloseTo(1);
  expect(end.x).toBeCloseTo(1);
  expect(start.z).toBeCloseTo(1);
  expect(end.z).toBeCloseTo(-1);
  expect(trace).toEqual(original);
});


describe("a troupe's places", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const frame = (x, y) => [x, y, TRUNK_HEIGHT, 1, 0, 0, 0, ...STAND];
  const trunkAt = (rig, trace) => {
    applyFrame(rig, trace.subarray(0, 21));
    return rig.bodies.get("trunk_base").getWorldPosition(new Vector3());
  };

  it("draws a placed duck where its trace says: x towards the audience at -Z, y to its right at -X", () => {
    const rig = buildRigTree(kinematics);
    const trace = Float32Array.from([...frame(0.4, -0.6), ...frame(0.5, -0.6)]);
    placeStageDuck(rig, { trace, start: { x: 0.4, y: -0.6, yaw: 90 } }, 0);
    const at = trunkAt(rig, trace);
    expect(at.x).toBeCloseTo(0.6);
    expect(at.z).toBeCloseTo(-0.4);
    const forward = new Vector3(1, 0, 0).applyQuaternion(rig.placer.quaternion);
    expect(forward.z).toBeCloseTo(-1);
  });

  it("centres a run recorded before troupes on its own path, as it always was", () => {
    const rig = buildRigTree(kinematics);
    const trace = Float32Array.from([...frame(1, 0.3), ...frame(2, 0.3)]);
    placeStageDuck(rig, { trace, start: null }, 0);
    const at = trunkAt(rig, trace);
    expect(at.x).toBeCloseTo(0);
    expect(at.z).toBeCloseTo(0.5);
  });
});

it("rejects gait sway and vertical bounce while following deliberate travel, even when seeking", () => {
  const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));
  const rig = buildRigTree(kinematics);
  const makeTrace = noisy => {
    const trace = new Float32Array(500 * 21);
    for (let i = 0; i < 500; i++) {
      const t = i * 0.02;
      trace.set([0.1 * t + (noisy ? 0.04 * Math.sin(t * Math.PI * 8) : 0),
        noisy ? 0.04 * Math.cos(t * Math.PI * 8) : 0,
        noisy ? 0.12 + 0.07 * Math.sin(t * Math.PI * 8) : 0.12,
        1, 0, 0, 0, ...STAND], i * 21);
    }
    return trace;
  };
  const quiet = makeTrace(false), moving = makeTrace(true);
  rig.placer.rotation.y = Math.PI / 2;
  rig.placer.updateMatrixWorld(true);
  const at = t => stageCameraTarget(moving, t, rig.placer);
  for (const t of [2, 2.07, 3, 4.11, 5]) {
    expect(at(t).distanceTo(stageCameraTarget(quiet, t, rig.placer))).toBeLessThan(0.002);
    expect(at(t).y).toBe(0.14);
  }
  expect(at(5).z - at(2).z).toBeCloseTo(-0.3, 2);
  const first = at(3);
  at(8);
  expect(at(3)).toEqual(first);
});
