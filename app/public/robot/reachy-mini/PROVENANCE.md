# Reachy Mini judges

Official simulation model: https://github.com/pollen-robotics/reachy_mini

Source revision: `9d364df0d8b6c92fbda7a9252fc378e23d4ab47c`
Source directory: `src/reachy_mini/descriptions/reachy_mini/mjcf/`.
Copyright Pollen Robotics; Apache-2.0, included in LICENSE.

Modified for microduck-arena: visual meshes exported from the neutral MuJoCo
pose, hidden electronics and collision meshes omitted, converted from Z-up to
Y-up, grouped into base/head/antennas, normals reconstructed and simplified.
Original metre scale retained. Gaze is a visual animation, not Stewart-platform
inverse kinematics or a change to the competition's physics.

Rebuild from the repository root:

```sh
uv run scripts/vendor_reachy.py
npx @gltf-transform/cli@4 simplify app/public/robot/reachy-mini/reachy-mini.glb /tmp/reachy-mini.glb --ratio 0.15 --error 0.001
cp /tmp/reachy-mini.glb app/public/robot/reachy-mini/reachy-mini.glb
```
