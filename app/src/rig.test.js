// three.js maths and Object3D work headless, so the rig's tree structure and
// pose maths are unit-testable without a browser or a canvas.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, BoxGeometry, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import {
  JOINT_NAMES,
  attachMeshes,
  buildRigTree,
  creaseGeometry,
  creasedGeometries,
  jawPivot,
  meshNames,
  rigGeometries,
  setJoint,
} from "./rig.js";
import { VARIANTS, meshMaterialsFor } from "./liveries.js";

const kinematics = JSON.parse(readFileSync("public/robot/kinematics.json", "utf8"));

const glb = readFileSync("public/robot/microduck.glb");

// Two things GLTFLoader.parse needs that are easy to get wrong under vitest's
// jsdom environment, verified against the real loader before writing this:
//  1. onLoad fires through an internal Promise chain (a microtask), even for a
//     self-contained GLB with no external URIs — never synchronously in this
//     call stack. So this waits on a Promise, not a variable set by the callback
//     moments later.
//  2. GLTFLoader checks `data instanceof ArrayBuffer` against jsdom's realm.
//     Node's fs.readFileSync gives back a Buffer backed by a *Node-realm*
//     ArrayBuffer, which fails that check under jsdom and silently falls through
//     to "treat data as already-parsed JSON" — surfacing as "Unsupported asset.
//     glTF versions >=2.0 are supported." with no hint that the bytes were fine.
//     Copying into a same-realm ArrayBuffer (one built with jsdom's global
//     constructor) fixes it without touching the real file or the real loader.
function loadedScene() {
  const buf = new ArrayBuffer(glb.byteLength);
  new Uint8Array(buf).set(glb);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buf, "", (gltf) => resolve(gltf.scene), reject);
  });
}


describe("the vendored kinematics", () => {
  it("declares the 14 actuated joints in the engine's order", () => {
    expect(kinematics.actuated_joints).toEqual(JOINT_NAMES);
  });
});

describe("buildRigTree", () => {
  it("reparents every body onto its declared parent", () => {
    const rig = buildRigTree(kinematics);
    for (const body of kinematics.bodies) {
      const group = rig.bodies.get(body.name);
      expect(group).toBeDefined();
      if (body.parent) expect(group.parent.name).toBe(body.parent);
    }
  });

  it("puts the root under a Z-up to Y-up correction", () => {
    const rig = buildRigTree(kinematics);
    // MJCF is Z-up, three.js is Y-up. Exactly one place compensates.
    expect(rig.root.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("converts MJCF (w,x,y,z) quaternions to three.js (x,y,z,w)", () => {
    const rig = buildRigTree(kinematics);
    const declared = kinematics.bodies.find((b) => b.quat.some((v) => v !== 0 && v !== 1));
    const group = rig.bodies.get(declared.name);
    expect(group.quaternion.w).toBeCloseTo(declared.quat[0], 12);
    expect(group.quaternion.x).toBeCloseTo(declared.quat[1], 12);
    expect(group.quaternion.y).toBeCloseTo(declared.quat[2], 12);
    expect(group.quaternion.z).toBeCloseTo(declared.quat[3], 12);
  });

  it("registers every actuated joint as pose-able", () => {
    const rig = buildRigTree(kinematics);
    for (const name of JOINT_NAMES) expect(rig.joints.has(name)).toBe(true);
  });
});

describe("setJoint", () => {
  it("rotates about the joint axis, on top of the body's rest orientation", () => {
    const rig = buildRigTree(kinematics);
    const joint = rig.joints.get("left_knee");
    const expected = joint.baseQuat
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(joint.axis, 0.3));

    setJoint(rig, "left_knee", 0.3);
    expect(joint.body.quaternion.angleTo(expected)).toBeCloseTo(0, 12);
  });

  it("leaves the body at its rest orientation for a zero angle", () => {
    const rig = buildRigTree(kinematics);
    const joint = rig.joints.get("left_knee");
    setJoint(rig, "left_knee", 0);
    expect(joint.body.quaternion.angleTo(joint.baseQuat)).toBeCloseTo(0, 12);
  });

  it("clamps to the MJCF range instead of bending through the shell", () => {
    const rig = buildRigTree(kinematics);
    const joint = rig.joints.get("left_knee");
    const [low, high] = joint.range;

    setJoint(rig, "left_knee", high + 5);
    const clampedHigh = joint.body.quaternion.clone();
    setJoint(rig, "left_knee", high);
    expect(clampedHigh.angleTo(joint.body.quaternion)).toBeCloseTo(0, 12);

    setJoint(rig, "left_knee", low - 5);
    const clampedLow = joint.body.quaternion.clone();
    setJoint(rig, "left_knee", low);
    expect(clampedLow.angleTo(joint.body.quaternion)).toBeCloseTo(0, 12);
  });

  it("ignores an unknown joint rather than throwing", () => {
    const rig = buildRigTree(kinematics);
    expect(() => setJoint(rig, "tail_wag", 1)).not.toThrow();
  });

  it("normalises the joint axis", () => {
    const rig = buildRigTree(kinematics);
    for (const name of JOINT_NAMES) {
      expect(rig.joints.get(name).axis.length()).toBeCloseTo(1, 12);
    }
  });
});

describe("attachMeshes against the real GLB", () => {
  it("hangs the lower beak on a pivot that opens it and leaves it in place at rest", async () => {
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, await loadedScene());
    const centre = () => {
      rig.root.updateMatrixWorld(true);
      return new Box3().setFromObject(rig.bodies.get("jaw_soft")).getCenter(new Vector3());
    };
    const rest = centre();
    const pivot = jawPivot(rig);
    expect(pivot.children.length).toBeGreaterThan(0);
    expect(centre().distanceTo(rest)).toBeLessThan(1e-6);
    pivot.rotation.y = 0.6;
    expect(centre().distanceTo(rest)).toBeGreaterThan(0.001);
  });
  // Nothing else in this file exercises attachMeshes, which is how a lookup that
  // resolved zero meshes shipped once already. These tests load the actual
  // vendored asset so the naming premise cannot drift unnoticed.
  it("resolves every mesh the kinematics reference", async () => {
    const scene = await loadedScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);

    const wanted = kinematics.bodies.flatMap((b) =>
      (b.geoms ?? []).filter((g) => !g.type || g.type === "mesh").map((g) => g.mesh),
    );
    let attached = 0;
    rig.root.traverse((n) => {
      if (n.isMesh) attached += 1;
    });
    expect(wanted.length).toBeGreaterThan(0);
    expect(attached).toBe(wanted.length);
  });

  it("names each attached mesh after its file, which is how the booth finds the beak", async () => {
    // The booth hangs the lower beak on a pivot by picking `jaw.stl` and
    // `jaw_soft.stl` out of the jaw body's children; drop the naming and the
    // beak stops opening with nothing else to show for it.
    const scene = await loadedScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);

    const names = [];
    rig.bodies.get("jaw_soft").children.forEach((child) => {
      if (child.isMesh) names.push(child.name);
    });
    expect(names).toContain("jaw.stl");
    expect(names).toContain("jaw_soft.stl");
  });

  it("gives every attached geometry the normals a lit material needs", async () => {
    // THE bug this guards. A MeshStandardMaterial with no `normal` attribute
    // has no surface direction to light against, so the key, the fill, the
    // ambient, the hemisphere AND the environment map all evaluate to zero and
    // the robot renders as a flat black silhouette — immune to every lighting
    // change, which is exactly how three failed fixes went.
    const scene = await loadedScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);

    const meshes = [];
    rig.placer.traverse((n) => {
      if (n.isMesh) meshes.push(n);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const normal = mesh.geometry.attributes.normal;
      expect(normal, `${mesh.geometry.name || "geometry"} has no normals`).toBeDefined();
      expect(normal.count).toBe(mesh.geometry.attributes.position.count);
    }
  });

  it("builds normals that are unit length, not zeroes standing in for them", async () => {
    // An all-zero normal buffer satisfies "the attribute exists" and still
    // renders black, so presence alone is not the property worth asserting.
    //
    // 4.2% of vertices DO come out zero-length: the source STLs carry
    // degenerate and coincident faces whose normals cancel, and toCreasedNormals
    // cannot invent a direction for a zero-area triangle. The reference runs
    // this identical code, so that tail is the asset's condition rather than
    // this port's, and it lands on specks of internal mech parts. The bound is
    // set just above the measured value so a real regression — a scale slip
    // that welds everything, say — still trips it.
    const scene = await loadedScene();
    const creased = creasedGeometries(scene);

    let total = 0;
    let degenerate = 0;
    for (const geometry of new Set(creased.values())) {
      const normal = geometry.attributes.normal;
      for (let i = 0; i < normal.count; i += 1) {
        total += 1;
        const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
        if (length < 0.5) degenerate += 1;
        else expect(length).toBeCloseTo(1, 3);
      }
    }
    expect(total).toBeGreaterThan(300_000);
    expect(degenerate / total).toBeLessThan(0.06);
  });

  it("leaves the robot's visible outer shell free of dead normals", async () => {
    // Where the 4.2% lands is what decides whether it matters. These are the
    // parts you actually see; a dead normal here would be a black patch on the
    // head or the trunk, which is the very symptom this whole fix is about.
    const scene = await loadedScene();
    const creased = creasedGeometries(scene);
    const SHELL = [
      "top_head_shell.stl",
      "bottom_head_shell.stl",
      "face_part.stl",
      "trunk_base.stl",
      "left_shell.stl",
      "right_shell.stl",
      "upper_leg_left.stl",
      "upper_leg_right.stl",
      "jaw.stl",
      "noenoeil.stl",
    ];
    for (const name of SHELL) {
      const geometry = creased.get(name);
      expect(geometry, `${name} missing from the GLB`).toBeDefined();
      const normal = geometry.attributes.normal;
      let dead = 0;
      for (let i = 0; i < normal.count; i += 1) {
        if (Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) < 0.5) dead += 1;
      }
      expect(dead / normal.count, `${name}`).toBeLessThan(0.01);
    }
  });

  it("creases rather than smooths, so mechanical edges stay edges", async () => {
    // toCreasedNormals at 36 deg: smooth across the head dome, hard across a
    // bracket's corner. Plain computeVertexNormals would smooth everything and
    // melt the mech parts; flat shading would facet the dome. The give-away is
    // that a creased mesh has MORE vertices than the welded original, because a
    // vertex on a hard edge is split once per face that meets there.
    const scene = await loadedScene();
    const original = new Map();
    scene.traverse((n) => {
      if (n.isMesh && n.userData?.meshFile) {
        original.set(n.userData.meshFile, n.geometry.attributes.position.count);
      }
    });

    const creased = creasedGeometries(scene);
    expect(creased.size).toBeGreaterThan(0);

    let split = 0;
    for (const [name, before] of original) {
      expect(creased.get(name)).toBeDefined();
      if (creased.get(name).attributes.position.count > before) split += 1;
    }
    // This robot is mostly mechanical parts, so most of them must split. An
    // earlier version of this test paired names to geometries by position in a
    // body's children and passed BEFORE the fix existed — hence counting here,
    // against the same key the lookup itself uses.
    expect(split).toBeGreaterThan(original.size / 2);
  });

  it("does not mutate the shared GLB geometry it was handed", async () => {
    // Three lanes attach from one loaded scene, and viewer.js memoises that
    // scene for the life of the page. Creasing the GLB's own geometry in place
    // would compound the rebuild on every lane and every replay.
    const scene = await loadedScene();
    const before = new Map();
    scene.traverse((n) => {
      if (n.isMesh && n.userData?.meshFile) {
        before.set(n.userData.meshFile, n.geometry.attributes.position.count);
      }
    });
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);
    attachMeshes(buildRigTree(kinematics), kinematics, scene);

    scene.traverse((n) => {
      if (n.isMesh && n.userData?.meshFile) {
        expect(n.geometry.attributes.position.count).toBe(before.get(n.userData.meshFile));
        expect(n.geometry.attributes.normal).toBeUndefined();
      }
    });
  });

  it("proves the asset premise these rebuilds depend on", async () => {
    // The GLB ships WITHOUT normals deliberately — the simulator's duck.js:49
    // says "STL facet normals are omitted on purpose: creased normals are
    // rebuilt here". If a future re-vendor starts including them, this test
    // changes and the rebuild can be revisited on purpose rather than by
    // rediscovering a black duck.
    const scene = await loadedScene();
    let total = 0;
    let withNormals = 0;
    scene.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      total += 1;
      if (n.geometry.attributes.normal) withNormals += 1;
    });
    expect(total).toBe(38);
    expect(withNormals).toBe(0);
  });

  it("proves the naming premise this lookup depends on", async () => {
    // GLTFLoader strips dots from node names, so the kinematics' "leg.stl" is
    // node.name "legstl". If a future exporter stops doing that, this test
    // changes and the fallback chain can be revisited — deliberately, not by
    // discovering a blank duck.
    const scene = await loadedScene();
    const names = [];
    scene.traverse((n) => {
      if (n.isMesh) names.push({ name: n.name, meshFile: n.userData?.meshFile });
    });
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.name.includes("."))).toBe(false);
    expect(names.every((n) => typeof n.meshFile === "string" && n.meshFile.endsWith(".stl"))).toBe(
      true,
    );
  });

  it("assembles to a duck-sized object in metres", async () => {
    const scene = await loadedScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);
    rig.placer.updateMatrixWorld(true);

    const size = new Box3().setFromObject(rig.placer).getSize(new Vector3());
    // A Microduck is roughly 12 cm tall. Anything near 100+ would mean the
    // meshes are in millimetres and everything downstream is 1000x off.
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.0);
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.05);
  });

  it("leaves the parts nobody sees out when asked for the skin alone", () => {
    // A spectator two metres off is what shows of it from outside — and on a
    // skeletal robot that is the motors and the battery as much as the shells.
    // Which parts show was measured, not guessed (see HIDDEN in rig.js): the
    // boards, bearings and mouth parts inside are under a thousandth of the
    // duck's pixels from any seat, and were ten layers of overdraw a pixel.
    const geometries = new Map(meshNames(kinematics).map((n) => [n, new BoxGeometry(0.01, 0.01, 0.01)]));
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, geometries, { skin: true });
    const attached = [];
    rig.root.traverse((n) => {
      if (n.isMesh) attached.push(n.name);
    });
    for (const shows of ["top_head_shell.stl", "xl330.stl", "np_f970.stl", "leg.stl", "neck.stl", "hip_l.stl"]) {
      expect(attached).toContain(shows);
    }
    for (const inside of [
      "pcb__raspberry_pi_zero_2_w.stl",
      "elec_rpi_robot_hat_pcb.stl",
      "seeed_bearing__configuration__22x16x4.stl",
      "seeed_bearing__configuration_default.stl",
      "speaker.stl",
      "jaw_soft.stl",
    ]) {
      expect(attached).not.toContain(inside);
    }
  });
});

describe("the MJCF to three.js axis mapping", () => {
  // Measured, not assumed. A wrong assumption here put replay lanes on the
  // forward axis (so a head-to-head raced in single file) and made the camera
  // follow an axis the duck never moved along. Pinned so it cannot drift again.
  const worldOf = (mjcf) => {
    const rig = buildRigTree(kinematics);
    const trunk = rig.bodies.get("trunk_base");
    trunk.position.set(...mjcf);
    trunk.quaternion.set(0, 0, 0, 1);
    rig.placer.updateMatrixWorld(true);
    return trunk.getWorldPosition(new Vector3());
  };

  it("maps MJCF forward (+x) to three.js +x", () => {
    const w = worldOf([1, 0, 0]);
    expect(w.x).toBeCloseTo(1, 6);
    expect(w.y).toBeCloseTo(0, 6);
    expect(w.z).toBeCloseTo(0, 6);
  });

  it("maps MJCF left (+y) to three.js -z", () => {
    const w = worldOf([0, 1, 0]);
    expect(w.z).toBeCloseTo(-1, 6);
    expect(w.x).toBeCloseTo(0, 6);
    expect(w.y).toBeCloseTo(0, 6);
  });

  it("maps MJCF up (+z) to three.js +y", () => {
    const w = worldOf([0, 0, 1]);
    expect(w.y).toBeCloseTo(1, 6);
    expect(w.x).toBeCloseTo(0, 6);
    expect(w.z).toBeCloseTo(0, 6);
  });
});

describe("the rig is posed in metres", () => {
  it("keeps the trunk within a duck-sized box of its own origin", () => {
    const rig = buildRigTree(kinematics);
    // Catches a millimetre/metre mix-up in the vendored kinematics: a duck is
    // about 12 cm tall, so anything past half a metre means wrong units.
    expect(rig.bodies.get("trunk_base").position.length()).toBeLessThan(0.5);
  });
});

describe("dimming a ghost", () => {
  it("makes every material transparent at less than full opacity", async () => {
    const scene = await (async () => {
      const glb = readFileSync("public/robot/microduck.glb");
      const buf = new ArrayBuffer(glb.byteLength);
      new Uint8Array(buf).set(glb);
      return new Promise((resolve, reject) => {
        new GLTFLoader().parse(buf, "", (gltf) => resolve(gltf.scene), reject);
      });
    })();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene, { opacity: 0.42 });

    const materials = [];
    rig.root.traverse((n) => {
      if (n.isMesh) materials.push(n.material);
    });
    expect(materials.length).toBeGreaterThan(0);
    expect(materials.every((m) => m.transparent && m.opacity === 0.42)).toBe(true);
  });

  it("leaves a full-opacity duck opaque, so it is not needlessly sorted", async () => {
    const glb = readFileSync("public/robot/microduck.glb");
    const buf = new ArrayBuffer(glb.byteLength);
    new Uint8Array(buf).set(glb);
    const scene = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(buf, "", (gltf) => resolve(gltf.scene), reject);
    });
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene);
    const materials = [];
    rig.root.traverse((n) => {
      if (n.isMesh) materials.push(n.material);
    });
    expect(materials.every((m) => m.transparent === false)).toBe(true);
  });

  it("keeps each part's own colour when dimming", async () => {
    // The lesson from repainting: dimming must not flatten the machine's colours.
    const glb = readFileSync("public/robot/microduck.glb");
    const buf = new ArrayBuffer(glb.byteLength);
    new Uint8Array(buf).set(glb);
    const scene = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(buf, "", (gltf) => resolve(gltf.scene), reject);
    });
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene, { opacity: 0.42 });
    const colours = new Set();
    rig.root.traverse((n) => {
      if (n.isMesh) colours.add(n.material.color.getHex());
    });
    expect(colours.size).toBeGreaterThan(1);
  });
});

describe("the robots' liveries", () => {
  async function glbScene() {
    const glb = readFileSync("public/robot/microduck.glb");
    const buf = new ArrayBuffer(glb.byteLength);
    new Uint8Array(buf).set(glb);
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buf, "", (gltf) => resolve(gltf.scene), reject);
    });
  }

  const coloursOf = (rig) => {
    const seen = [];
    rig.root.traverse((n) => {
      if (n.isMesh) seen.push(n.material.color.getHexString());
    });
    return seen;
  };

  it("ships the four the real robots come in", () => {
    expect(Object.keys(VARIANTS)).toEqual(["classic", "charcoal", "purple", "blue"]);
  });

  it("paints each part its own material rather than one flat tint", async () => {
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, await glbScene(), { livery: "classic" });
    // A shell, a motor and a lens must not come out the same colour.
    expect(new Set(coloursOf(rig)).size).toBeGreaterThan(3);
  });

  it("actually differs between liveries", async () => {
    const scene = await glbScene();
    const fingerprint = (livery) => {
      const rig = buildRigTree(kinematics);
      attachMeshes(rig, kinematics, scene, { livery });
      return coloursOf(rig).join("|");
    };
    const prints = ["classic", "charcoal", "purple", "blue"].map(fingerprint);
    expect(new Set(prints).size).toBe(4);
  });

  it("falls back to classic for a livery it does not know", async () => {
    const scene = await glbScene();
    const of = (livery) => {
      const rig = buildRigTree(kinematics);
      attachMeshes(rig, kinematics, scene, { livery });
      return coloursOf(rig).join("|");
    };
    expect(of("chartreuse")).toBe(of("classic"));
  });

  it("keeps a livery's colours when the duck is dimmed to a ghost", async () => {
    const scene = await glbScene();
    const rig = buildRigTree(kinematics);
    attachMeshes(rig, kinematics, scene, { livery: "purple", opacity: 0.42 });
    const rigOpaque = buildRigTree(kinematics);
    attachMeshes(rigOpaque, kinematics, scene, { livery: "purple" });
    // Dimming is opacity only — the colours are the shape of the machine.
    expect(coloursOf(rig)).toEqual(coloursOf(rigOpaque));
  });
});

describe("the roller rig", () => {
  // The roller event was drawing the WALKING robot: the viewer had one
  // kinematic tree and one GLB, and the roller rig is neither a variant nor a
  // repaint of the walker.
  const rollers = JSON.parse(readFileSync("public/robot/kinematics_rollers.json", "utf8"));

  // The real STL files, parsed off disk. STLLoader.loadAsync would need a
  // server under jsdom, so the tests inject a loader that reads the same bytes
  // the browser would fetch — the parsing and creasing are the real thing.
  const stlLoader = new STLLoader();
  const fromDisk = (name) => {
    const buf = readFileSync(`public/robot/meshes/${name}`);
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return Promise.resolve(stlLoader.parse(copy));
  };

  it("is a different tree from the walking rig, driving the same joints", () => {
    // Same 14 actuated joints is why ONE policy contract covers both rigs and
    // the physics side needed no change for this — only the picture did.
    expect(rollers.actuated_joints).toEqual(JOINT_NAMES);
    expect(rollers.bodies.length).toBe(19);
    expect(kinematics.bodies.length).toBe(15);
  });

  it("needs meshes the shared GLB does not carry", async () => {
    // The premise for loading STLs at all. If a future re-vendor folds these
    // into the GLB, this test changes and the STL path can go.
    const scene = await loadedScene();
    const inGlb = creasedGeometries(scene);
    const missing = meshNames(rollers).filter((name) => !inGlb.has(name));
    expect(missing.sort()).toEqual([
      "ankle_l_v1.stl",
      "ankle_r_v1.stl",
      "rim.stl",
      "roller_blade.stl",
      "tire.stl",
    ]);
  });

  it("resolves every mesh it references, once the STLs are loaded", async () => {
    // The roller equivalent of the invisible-duck test. A geom whose mesh is
    // not found is skipped silently, so the failure would be a robot missing
    // its wheels with a clean console.
    const scene = await loadedScene();
    const geometries = await rigGeometries(rollers, scene, { load: fromDisk });
    for (const name of meshNames(rollers)) {
      expect(geometries.get(name), `${name} unresolved`).toBeDefined();
    }
  });

  it("loads only the meshes that are missing, not a second copy of everything", async () => {
    const scene = await loadedScene();
    const asked = [];
    await rigGeometries(rollers, scene, {
      load: (name) => {
        asked.push(name);
        return fromDisk(name);
      },
    });
    expect(asked.sort()).toEqual([
      "ankle_l_v1.stl",
      "ankle_r_v1.stl",
      "rim.stl",
      "roller_blade.stl",
      "tire.stl",
    ]);
  });

  it("asks for nothing at all for the walking rig", async () => {
    // One request for the GLB and no more. A regression here would be five
    // pointless 404s on every walking race.
    const scene = await loadedScene();
    const asked = [];
    await rigGeometries(kinematics, scene, {
      load: (name) => {
        asked.push(name);
        return fromDisk(name);
      },
    });
    expect(asked).toEqual([]);
  });

  it("gives the STL geometries live normals, every single one", async () => {
    // Same bug, same fix, different source: an STL-derived tire with no normals
    // would be a black wheel on a lit robot.
    //
    // ZERO dead normals, not "under 1%" — the GLB meshes carry a 4.2% tail of
    // degenerate faces, and these five do not. Asserting zero is what stops a
    // mergeVertices step being reintroduced here: welding at 1e-4 m produces
    // 9.6% dead normals on the blade for no benefit whatsoever. See
    // creaseGeometry.
    const scene = await loadedScene();
    const geometries = await rigGeometries(rollers, scene, { load: fromDisk });
    for (const name of ["tire.stl", "rim.stl", "roller_blade.stl", "ankle_l_v1.stl"]) {
      const normal = geometries.get(name).attributes.normal;
      expect(normal, `${name} has no normals`).toBeDefined();
      let dead = 0;
      for (let i = 0; i < normal.count; i += 1) {
        if (Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) < 0.5) dead += 1;
      }
      expect(dead, `${name}: ${dead} dead normals`).toBe(0);
    }
  });

  it("creases a raw STL soup as smoothly as a pre-welded GLB mesh", async () => {
    // The property that lets one creaseGeometry serve both sources:
    // toCreasedNormals hashes by POSITION, so it welds a triangle soup itself
    // and no mergeVertices step is needed (nor wanted — see creaseGeometry).
    //
    // What discriminates smooth from flat is whether a triangle's three
    // vertices carry DIFFERENT normals. Flat shading gives all three the face
    // normal; smoothing gives each vertex the average of the faces around it.
    // Counting distinct normal directions does NOT discriminate — measured, the
    // tire has 1954 of them against 1764 triangles, because creases split
    // vertices back apart — which is how an invented threshold gets this wrong.
    const raw = await fromDisk("tire.stl");
    const normal = creaseGeometry(raw).attributes.normal;
    const triangles = normal.count / 3;
    const key = (i) =>
      `${normal.getX(i).toFixed(4)},${normal.getY(i).toFixed(4)},${normal.getZ(i).toFixed(4)}`;

    let smooth = 0;
    for (let t = 0; t < triangles; t += 1) {
      if (key(t * 3) !== key(t * 3 + 1) || key(t * 3 + 1) !== key(t * 3 + 2)) smooth += 1;
    }
    // Measured at 96.7%. A tire is nearly all curved surface, so almost every
    // triangle must be smooth-shaded; unwelded it would be 0%.
    expect(smooth / triangles).toBeGreaterThan(0.9);
  });

  it("dresses the wheels from the livery, not from a fallback grey", async () => {
    // liveries.js maps the roller meshes: blades and brackets take the shoe
    // slot, rims the sole accent, tires rubber-dark. Without those the wheels
    // would fall through to the kinematics' own colour.
    const scene = await loadedScene();
    const geometries = await rigGeometries(rollers, scene, { load: fromDisk });
    const rig = buildRigTree(rollers);
    attachMeshes(rig, rollers, geometries, { livery: "classic" });

    let meshes = 0;
    rig.placer.traverse((n) => {
      if (n.isMesh) meshes += 1;
    });
    expect(meshes).toBe(
      rollers.bodies.reduce(
        (n, b) => n + (b.geoms ?? []).filter((g) => !g.type || g.type === "mesh").length,
        0,
      ),
    );

    const slots = meshMaterialsFor(VARIANTS.classic);
    // The tire is rubber-dark and the rim takes the bright sole colour: if the
    // slot map ever loses these, the two come out the same shade.
    const tire = slots["tire.stl"];
    const rim = slots["rim.stl"];
    expect(tire).toBeDefined();
    expect(rim).toBeDefined();
    const lum = (s) => 0.2126 * s.color[0] + 0.7152 * s.color[1] + 0.0722 * s.color[2];
    expect(lum(tire)).toBeLessThan(0.05);
    expect(lum(rim)).toBeGreaterThan(0.3);
  });
});
