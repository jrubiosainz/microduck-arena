#!/usr/bin/env bash
# Vendor the robot model, meshes and reference policy from the sandbox Space.
#
# Deliberately a manual step, not a runtime fetch: the MJCF defines the physics
# every recorded time was measured against. Re-running this is a decision to
# invalidate the leaderboard, so it records what it took and when.
set -euo pipefail

SRC="${1:-../microduck-simulator}"
DEST="arena/assets"

if [ ! -d "$SRC/app/public/robot/mjlab" ]; then
  echo "error: $SRC is not a microduck-simulator checkout" >&2
  exit 1
fi

SRC_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
MJLAB="$SRC/app/public/robot/mjlab"

mkdir -p "$DEST/robot/legs/assets" "$DEST/robot/rollers/assets" "$DEST/policies"

cp "$MJLAB/robot_allcollisions.xml"         "$DEST/robot/legs/"
cp "$MJLAB/robot_allcollisions_rollers.xml" "$DEST/robot/rollers/"
# meshdir="assets" in the MJCF, so the STLs must land in an assets/ subdir.
cp "$MJLAB"/meshes/*.stl "$DEST/robot/legs/assets/"
cp "$MJLAB"/meshes/*.stl "$DEST/robot/rollers/assets/"
cp "$SRC/app/public/policies/BEST_alpha_walking.onnx" "$DEST/policies/"

# Browser-side rig assets: the kinematic tree and one GLB holding every mesh,
# named exactly as kinematics.json's geom.mesh values.
mkdir -p app/public/robot
cp "$MJLAB/kinematics.json"          app/public/robot/
cp "$MJLAB/kinematics_rollers.json"  app/public/robot/
cp "$MJLAB/microduck.glb"            app/public/robot/
# The roller rig's own meshes are NOT in the shared GLB — the simulator loads
# these five from STL at runtime, and so does the viewer. Copying only the ones
# the roller kinematics actually adds keeps this from becoming a second copy of
# every mesh.
mkdir -p app/public/robot/meshes
for mesh in ankle_l_v1.stl ankle_r_v1.stl rim.stl roller_blade.stl tire.stl; do
  cp "$MJLAB/meshes/$mesh" app/public/robot/meshes/
done
# One sticker, used as the empty-state invitation on a race with no entries.
cp "$SRC/app/public/assets/stickers/star-yellow.webp" app/public/

cat > "$DEST/PROVENANCE.md" <<EOF
# Vendored assets

Do not edit these by hand. Re-vendor with \`scripts/vendor_assets.sh <simulator-checkout>\`.

| field | value |
| --- | --- |
| source | https://huggingface.co/spaces/pollen-robotics/microduck-simulator |
| commit | \`$SRC_COMMIT\` |
| vendored | $(date -u +%Y-%m-%dT%H:%M:%SZ) |

## Why this is pinned

The MJCF is the physics every recorded time was measured against. Re-vendoring can change
what a policy scores, which invalidates the leaderboard. When it happens, bump
\`RUNNER_VERSION\` in \`arena/constants.py\` in the same commit so old and new runs are never
compared.

Browser rig assets come from the same commit: \`kinematics.json\` and
\`kinematics_rollers.json\` (one per rig), \`microduck.glb\` holding every shared mesh, and
\`meshes/\` holding the five the roller rig adds and the GLB does not carry. Mesh names
match the kinematics' \`geom.mesh\` values.
EOF

echo "vendored from $SRC_COMMIT"
