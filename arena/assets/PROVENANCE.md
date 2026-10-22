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
It walks backwards upright, as the robot walks, and drags the other duck towards the pit. In ten
bouts on the Mac against the golden walker (`BEST_alpha_walking.onnx`) it stayed upright on its feet
alone the whole bout, stepped 3.7 to 6.6 times a second, slid 11 to 14 % of its foot travel, and
dragged the walker into the pit every time, in 6.7 to 11.1 s (median 8.8 s). A duck that pulls bowed
onto its head beats it: the reference it replaces dragged it into the pit in ten bouts out of ten,
in 6.8 to 8.5 s, this duck upright throughout.

| field | value |
| --- | --- |
| source | `Nico-robot/mjlab-tugofwar-microduck-t20`, checkpoint 500, exported to ONNX |
| recipe | microduck-challenges `tug-of-war` at `8391bf7`, with `--agent.actor.class-name microduck_challenges.tug_of_war.opponent:WalkerActor --env.actions.opponent.onnx walker.onnx` |
| sha256 | `245869c02049f29f453d48619969b2ef51d73d9751813ddac2b979be6a3b2e44` |
| vendored | 2026-10-22 |
| history | trained walking upright on the ring and the string (stay upright 1.0, Win ground 4.0), warm-started from BEST_alpha_walking and against it, frozen; replaces t15-250, which pulled bowed onto its head (owner, 2026-10-22): every rating changed |

It is frozen: replacing it changes every rating, so never without the owner's decision on the
board.
