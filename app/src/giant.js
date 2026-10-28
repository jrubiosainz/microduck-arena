// Sock Heist's giant: the racers' own microduck, assembled from the same kinematics and meshes at
// GIANT_SCALE, standing past the finish line with its back to the lanes. Only its head moves: it
// turns round over its shoulder to the lanes on red and back on green, as lights.js lightAt's
// `facing` says, a pure function of the replay's clock.

import { Group } from "three";
import { JOINT_NAMES, STAND, TRUNK_HEIGHT, attachMeshes, buildRigTree, setJoint } from "./rig.js";

export const GIANT_SCALE = 4.5;
// How far past the finish line the giant stands, on the lanes' centre line.
export const GIANT_BEHIND_M = 1.7;

/**
 * The giant over a `length` metre race, from the racers' rig `model` ({ kinematics, geometries }).
 * Drawn as its skin, sharing the racers' geometries: `dispose` frees only the materials it made.
 */
export function buildGiant({ kinematics, geometries }, length) {
  const rig = buildRigTree(kinematics);
  attachMeshes(rig, kinematics, geometries, { livery: "classic", skin: true });
  // Standing as a racer stands on its line, unrotated: facing +x, away from the lanes.
  rig.bodies.get("trunk_base").position.set(0, 0, TRUNK_HEIGHT);
  JOINT_NAMES.forEach((name, i) => setJoint(rig, name, STAND[i]));
  rig.placer.position.set(length + GIANT_BEHIND_M, 0, 0);
  rig.placer.scale.setScalar(GIANT_SCALE);
  rig.placer.traverse((node) => {
    if (node.isMesh) Object.assign(node, { castShadow: true, receiveShadow: true });
  });
  const group = new Group();
  group.name = "giant";
  group.add(rig.placer);
  // Round by +z, the chase camera's side, as far as the neck goes.
  const [round] = rig.joints.get("head_yaw").range;
  return {
    group,
    /** Turn the head `facing` of the way round, 0 away from the lanes and 1 facing them. */
    pose(facing) {
      setJoint(rig, "head_yaw", facing * round);
    },
    dispose() {
      group.removeFromParent();
      group.traverse((node) => {
        if (node.isMesh) node.material.dispose();
      });
    },
  };
}
