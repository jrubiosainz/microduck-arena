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
It stays on its feet, walks backwards and drags the other duck towards the pit.

| field | value |
| --- | --- |
| source | `Nico-robot/mjlab-tugofwar-microduck-t15`, checkpoint 250, exported to ONNX |
| recipe | microduck-challenges `tug-of-war` at `b98694b` |
| sha256 | `37459c463deec792712dcc7eaf960798bf0fc84d794019f04ba1abee7aeddbfa` |
| vendored | 2026-10-22 |
| history | trained upright on the ring and the string, warm-started from t7-250 and against it; replaces t7-250, owner 2026-10-21: every rating changed |

It is frozen: replacing it changes every rating, so never without the owner's decision on the
board.
