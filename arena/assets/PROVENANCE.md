# Vendored assets

Do not edit these by hand. Re-vendor with `scripts/vendor_assets.sh <simulator-checkout>`.

| field | value |
| --- | --- |
| source | https://huggingface.co/spaces/pollen-robotics/microduck-simulator |
| commit | `10c600e54ea52f239887308387cb8fc458ecb3e4` |
| vendored | 2026-09-09T14:37:11Z |

## Why this is pinned

The MJCF is the physics every recorded time was measured against. Re-vendoring can change
what a policy scores, which invalidates the leaderboard. When it happens, bump
`RUNNER_VERSION` in `arena/constants.py` in the same commit so old and new runs are never
compared.

Browser rig assets come from the same commit: `kinematics.json` and
`kinematics_rollers.json` (one per rig), `microduck.glb` holding every shared mesh, and
`meshes/` holding the five the roller rig adds and the GLB does not carry. Mesh names
match the kinematics' `geom.mesh` values.

## The tug's reference duck

Every tug rating is five bouts against this duck (`[rating]` in `arena/events/tug-of-war.toml`).
It walks back and pulls the string taut.

| field | value |
| --- | --- |
| source | `Nico-robot/mjlab-tugofwar-microduck-t7`, checkpoint 250, exported to ONNX |
| recipe | microduck-challenges `tug-of-war` at `370239a` |
| sha256 | `0c4e8b0abc9223c51bc4a32bc78591a4dc72c92ff873b6de7cd894bfad4bc1a2` |
| vendored | 2026-10-20 |

It is frozen: replacing it changes every rating, so never without the owner's decision on the
board.
