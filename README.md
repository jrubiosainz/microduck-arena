---
title: Microduck Arena
emoji: 🦆
colorFrom: gray
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: Race Microduck policies on a clock you can trust
hf_oauth: true
hf_oauth_scopes:
  - contribute-repos
---

# microduck-arena

Race a Microduck policy against every other policy, on a clock you can trust.

Submitted policies are evaluated **server-side** on a fixed course over five
perturbed seeds, at every commanded speed in the event's declared sweep, and the
best result is recorded. A time reported by a browser is a number in devtools;
this one is reproducible, and you can download any published policy and check it
yourself.

It runs two ways, and both are first-class:

- **Locally**, with no Hugging Face account, no OAuth and no network. The run log
  is a directory on your disk.
- **As a private Space** (this repo is one). Same code path, same numbers.

## Deploying to the Space

`git push` does not work here: the Hub rejects binary files pushed through plain
git and asks for Xet instead, and this repo vendors a GLB, forty-odd STLs and an
ONNX policy. So deploys go through the Hub API, which speaks Xet natively:

```bash
uv run python scripts/deploy_space.py            # publishes the working tree
uv run python scripts/deploy_space.py --dry-run  # shows what would go
```

The Space rebuilds itself on each upload. Its own Docker build re-measures the
golden run and fails if the physics does not reproduce, so a broken build is
better than a silently wrong leaderboard.

## Running as a Space

The container filesystem is ephemeral, so a Space needs somewhere durable to
keep the run log. Set two things in **Settings → Variables and secrets**:

| name | kind | value |
| --- | --- | --- |
| `ARENA_DATASET` | variable | the dataset repo that holds the log, e.g. `pollen-robotics/microduck-arena-runs` |
| `HF_TOKEN` | **secret** | a token with write access to that dataset |

Without both, the Space still boots and the board still works — but every
recorded run is lost the next time it restarts or wakes from sleep. A
published policy's `.onnx` is not at risk from this: it lives in the
publishing author's own Hub repo, not on the Space. `GET /api/health` reports
`"durable": true` once it is configured, and the startup log says `EPHEMERAL`
in capitals when it is not.

The Space signs users in with Hugging Face OAuth, scoped to `contribute-repos`
— just enough to create and write to a repo it did not previously own, nothing
wider. Publishing a policy creates (or reuses) `<your-user>/microduck-<slug>`
under the signer's own account, public, and the board's `.onnx` link resolves
straight to the Hub. A signed-in user whose token lacks Hub write access can
still race and watch replays; only Publish is disabled for them.

## Recovering the board

The run log can be lost — without `ARENA_DATASET` and `HF_TOKEN` it lives on a
container filesystem that every redeploy wipes. The **policies** are not lost
with it: publishing writes each one into its author's own public repo, tagged
`microduck-policy` and carrying a `manifest.json`. So the board is re-derivable.

```bash
uv run arena recover --store ~/arena-board                    # every event
uv run arena recover --store ~/arena-board --event sprint-2m
uv run arena recover --store ~/arena-board --all-tagged       # the whole ecosystem
```

With `ARENA_RECOVER=1` the same reconciliation runs at every startup, in a
background thread so it never blocks the Space coming up. It re-races only what
is **missing**, keyed on the Hub revision, so on a durable store it costs one
listing and finds nothing to do — measured: a second pass over a full store
restores 0 runs in 6 s. It is off by default because the local path must keep
working with no account and no network.

Two limits worth knowing. It restores only what reached the Hub — a `Test` run,
or anything published before policies went to the Hub, left nothing to recover.
And times are **re-measured**, never read back: a ranking you cannot re-verify
is not one worth restoring.

One thing this deployment does NOT have yet:

- **Submissions are synchronous and CPU-bound.** One entry is 33 simulated runs
  — about 3 s on a developer laptop, and proportionally longer on a shared
  2-vCPU Space. It works; it is not instant, and there is no queue.

## Run it

```bash
uv sync
cd app && npm install && npm run build && cd ..
uv run arena serve --store ~/arena-board --user $USER
```

Open <http://127.0.0.1:8000>.

The home page is the club: `Season standings` ranks players by the points
their publications earned (first publication on an event 100, each published
run 10 capped at three a day, beating your own best 25 once per event, and
250/150/100 while you hold a podium place), and `Pick your round` lists the
events. The chip top-right opens your page, `#/p/<user>`; the standings link
to everyone else's. Points are folded from the run log on every request, like
the board — `GET /api/standings` and `GET /api/players/<user>`.

## From the command line

```bash
uv run arena events

# The repo vendors one reference policy, so this works with no setup:
REF=arena/assets/policies/BEST_alpha_walking.onnx
uv run arena score $REF --event sprint-2m
uv run arena score $REF --event sprint-2m --user me --name reference --store ~/arena-board
uv run arena board --event sprint-2m --store ~/arena-board
```

## What a policy has to be

One ONNX file with a **61-D observation input** and a **14-D action output** — the
same contract `robotd` enforces on the real robot, so a policy the Arena accepts
will load there too. A wrong shape is rejected with the reason:

```
observation width is 51, expected 61
```

## The events

| Event | Rig | Course | Command |
| --- | --- | --- | --- |
| `sprint-2m` | legs | 2 m flat | 0.25 m/s forward |
| `roller-sprint-2m` | rollers | 2 m flat | 0.6 m/s forward |
| `hill-climb-1m5` | legs | 1.5 m at 8° | 0.25 m/s forward |

Locally the board shows **one row per policy**, so your own `v1` and `v2` race each other;
resubmitting the same name only improves that row. A deployed multi-user Space sets
`ARENA_RANK_BY=user` to show one row per person instead, and `arena board --rank-by user`
does the same from the command line.

An entry is scored as the **mean finish time over five perturbed starts**, with
any failure to finish counted at the event's time limit — so a policy that is
quick four times and falls once ranks below a steady one. The replay you watch is
the median finishing run, not the best.

Two things about the shipped reference policy are worth knowing before reading
too much into a time: it tracks about 44% of its commanded velocity, and below
roughly 0.2 m/s commanded it does not walk at all. Both are measured; see the
design doc's calibration table.

## Developing

```bash
uv run --extra dev pytest        # engine + API
cd app && npm test               # frontend units
cd app && npm run dev            # UI on :5173, proxying /api to :8000
```

`app/src/rig.js` and the vendored `app/public/robot/` assets come from
[the Microduck sandbox Space](https://huggingface.co/spaces/pollen-robotics/microduck-simulator)
at a pinned commit — see `arena/assets/PROVENANCE.md`. Re-vendoring can change
what a policy scores, so `RUNNER_VERSION` in `arena/constants.py` must be bumped
in the same commit.

## Design

- `docs/superpowers/specs/2026-09-03-microduck-arena-design.md` — the design and every decision behind it
- `docs/probe-results.md` — measured cost of an evaluation
