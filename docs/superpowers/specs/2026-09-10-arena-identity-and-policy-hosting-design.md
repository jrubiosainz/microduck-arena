# Identity, and where policies live

**Date:** 2026-09-10
**Status:** design, approved in chat, not yet implemented
**Supersedes:** the *Hugging Face OAuth to submit* and *Entries accept a repo id or an upload*
rows of `2026-09-03-microduck-arena-design.md`, which specified both but deferred them to
"a later plan". This is that plan's design.

## The problem, in two halves

**Nobody has a name.** The Space runs with no OAuth, so every entry is recorded as `guest`
and the board ranks by policy name. It cannot say who published what, which is most of the
point of a shared leaderboard.

**The Space is the wrong place to keep weights.** Uploads are held in the container
filesystem — ephemeral unless the dataset repo is configured — behind a 4 MiB cap that
rejects real community policies. And a policy parked on someone else's Space is not a
policy you can put on a duck.

## What already exists, and is load-bearing

Measured on 2026-09-10, not assumed. **There is already a live ecosystem publishing
Microduck policies to the Hub**, and it has a convention this design should join rather
than replace:

- **14 model repos tagged `microduck-policy`**, from ~9 distinct users (HannesVonEssen,
  RemiFabre, q2p, juicenv, joanfox, Teethyfish, tfrere, Nupr-Haokun, Histochemichael).
  32 repos carry the broader `microduck` tag.
- **13 of the 14 ship a `.onnx`**, and 11 of those call it `policy.onnx` at the repo root.
- Most carry a **`manifest.json`** that already declares exactly the contract the harness
  needs: `obs_len: 61`, `action_len: 14`, `action_scale: 1.0`, `entry_pose: "standing"`,
  `model_api: 1`, `robot.control_hz: 50`, and `robot.model` — which distinguishes
  `"microduck"` from `"microduck passive rollers"`, i.e. the event's `rig`.
- Several declare their **trained command range** in prose, and the roller one declares an
  `official_speed_probe: [0.8, 0.0, "line_hold"]`.

**Third-party policies do run here.** `RemiFabre/microduck-rough-walk-e`, downloaded from
the Hub and scored on `sprint-2m`, returned **27.180 s, 5/5 seeds**. That is the proof the
whole design rests on, and it was obtained before any of this was designed.

Three problems the same probe exposed:

| Finding | Consequence |
| --- | --- |
| `juicenv/duckwing-v80-roller-skating` is **8.4 MB** | The 4 MiB cap rejects real policies. |
| `HannesVonEssen/microduck-running` declares training "through 2.2" m/s; `sprint-2m` sweeps 0.20–1.20 | The sweep range is guessed and can exclude a policy's whole operating point. |
| That same policy **falls at every speed from 1.0 to 3.0** on our course | A policy can fail here without being bad. Its own eval files enumerate `high-grip-plain`, `nominal-backlash`, `stress-backlash` — it is tuned against friction and backlash conditions that are not ours. |

The third one is not fixable and must not be hidden: **the board measures who is fastest on
the Arena's course, not who has the best policy.** The page has to say so, or people will
reasonably conclude the harness is broken.

## Decisions

| Decision | Why, and what it rules out |
| --- | --- |
| **Sign-in gates entering, never watching** | The board, the replay and the downloads stay open to anyone who can open the Space. Signing in is required only to `Test` or `Publish`. Watching a race should cost nothing. |
| **`contribute-repos`, and nothing wider** | HF offers `write-repos` (read and write *all* the user's personal repos) and `manage-repos` (full management, including deletion). `contribute-repos` is documented as "Create repositories and access those created by this app. **Cannot access any other repositories**". It is exactly enough to create the policy repo and write to it, and it cannot touch anything else the person owns. Asking for more to do the same job would be indefensible. |
| **Publish writes the `.onnx` to the AUTHOR's repo** | The Space keeps no weights at all: it records a link. Attribution, versioning and "downloadable onto a real duck" all come free, the size cap stops being the Space's problem, and models survive Space restarts without the dataset repo being involved. Rules out entering a policy you are unwilling to host yourself — deliberately; `Test` is the path that publishes nothing. |
| **Those repos are PUBLIC** | A private repo cannot be downloaded by anyone else, including this Space once the session token expires, which would leave the board's download button 404ing for everyone but the author. Publishing therefore makes your weights public, and **the button must say so before it is clicked**. |
| **One repo per policy name** | `<user>/microduck-<slug>`, matching the convention already in the wild (`microduck-basketball`, `microduck-running`). Republishing the same name is a new commit on the same repo, so version history is free and the board's link can pin a revision. |
| **An existing repo id is also valid intake** | Nearly free once the download path exists, and it makes all 13 already-published policies raceable without their authors doing anything. |
| **The cap rises to 64 MiB; it is not removed** | An unbounded upload to a shared 2-vCPU Space is a denial-of-service vector, not a feature. 64 MiB is eight times the largest real policy found. |
| **Event sweeps widen; manifest prose is NOT parsed** | The `microduck-running` finding demands that a policy's operating point not fall outside the sweep. The tempting fix — read the trained range from `manifest.json` — does not survive contact with the actual files: the ranges are **prose**, e.g. `"vx: forward velocity command, m/s, trained range -0.4 .. 0.4"` and `"curriculum trained through 2.2; evaluated at 2.2"`. Parsing that would be a regex against free text that every author writes differently, and a misparse silently mis-scores an entry. So instead the events' own sweeps widen (the sprint's ceiling to ~2.5), which costs little because failures terminate early, and the structured `official_speed_probe` field — which some manifests do carry — is sampled as an extra point when present. |

## Identity

`hf_oauth: true` in the README front matter, with:

```yaml
hf_oauth: true
hf_oauth_scopes:
  - contribute-repos
```

HF injects `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_SCOPES` and
`OPENID_PROVIDER_URL`; `SPACE_HOST` is already available. The redirect URI is
`https://{SPACE_HOST}/login/callback`. Default session duration is 8 hours, which is far
longer than any race (~11 s on `cpu-basic`), so token expiry mid-race is not a case worth
designing for.

**Two identity paths, as the original spec requires.** A signed-in session supplies the
username and the OAuth token. With no OAuth configured — every local run — `ARENA_DEV_USER`
stands in and there is no token, so the Hub-publish path is unavailable and `Publish`
records to the local store exactly as it does today. The submit path must therefore never
assume a session exists.

**`ARENA_RANK_BY` flips to `user` on the Space.** It is `policy` there only because
everyone was `guest`; with real usernames, one row per person is the public semantics
`arena/index.py` was written for.

## The entry panel, three states

| State | What the panel shows |
| --- | --- |
| Signed out | One button — *Sign in with Hugging Face* — and one sentence saying it is needed to race a policy, plus the line that publishing shares your weights publicly. |
| Signed in | Your HF username, then the existing controls: dropzone, name, colour, test speed, `Test it`, `Publish`. |
| Session expired | Back to signed out, with the reason said plainly rather than a failed request. |

The stage, the board and the download links are unaffected in all three.

Per HF's own warning, the sign-in button uses `target="_blank"` unless the Space is running
outside its iframe, or cookies misbehave in some browsers.

## Publishing, and the order it happens in

1. **Validate and race.** The upload goes through the same `load_policy` the CLI uses, and
   is evaluated over the full sweep. This is first on purpose: nothing is written to
   someone's Hub namespace until the harness has confirmed the file is a working policy.
2. **Write to the author's repo.** Create `<user>/microduck-<slug>` if absent (public,
   tagged `microduck-policy` and `microduck`), then commit `policy.onnx` plus a
   `manifest.json` declaring the contract the way the community already does. Capture the
   resulting revision.
3. **Record the run.** `source = {"kind": "hub", "repo_id", "filename", "revision",
   "sha256"}`. No weights are stored by the Space.

If step 2 fails, the request fails and **nothing is recorded** — a board row pointing at a
repo that does not exist is worse than an error message. If step 1 fails, nothing has been
written anywhere.

`GET /api/runs/{run_id}/policy` becomes a redirect to the Hub for `kind: "hub"` records, and
keeps serving from the store for the `kind: "upload"` records already on disk and for local
CLI use.

`model_stored` needs its meaning stated, because it stops matching its name: it records
whether the SPACE holds the bytes, and a Hub-published run offers a download while storing
nothing. The rule the board renders from is therefore "this row offers a download" —
`model_stored or source.kind == "hub"` — and it belongs in one place (`arena/index.py` or
the row builder), not spelled out twice in the frontend and the API.

## What this does not solve

- **OAuth on a private Space is unverified.** The docs do not say. It must be tested on the
  real Space before this is called done; if it does not work, the Space's visibility becomes
  a decision rather than a given.
- **No rate limiting.** A signed-in user can queue races at ~11 s of CPU each on shared
  hardware. Acceptable for a private org Space, and named here so it is a known gap rather
  than a surprise. The obvious first mitigation is one race at a time per session.
- **`hf_oauth_authorized_org`** could restrict sign-in to `pollen-robotics` members. Not
  used: the Space's own privacy already gates who can reach it, and hard-coding the org
  would have to be undone the day it opens up.
- **The board still measures our course.** See the `microduck-running` finding above. The
  page must carry that caveat.

## Testing

- OAuth: the callback with a forged `state` is rejected; a request to `Test`/`Publish` with
  no session is a 401 and not a `guest` entry; the local `ARENA_DEV_USER` path still works
  with no OAuth configured at all.
- Publish ordering: a Hub write that fails records nothing; a policy that fails validation
  reaches the Hub not at all. Both asserted against a faked Hub client, so the tests do not
  need the network.
- Intake by repo id: `RemiFabre/microduck-rough-walk-e` scores 27.180 s. A real,
  network-touching test, marked so it can be skipped offline — it is the one that proves
  the premise.
- The manifest-widened sweep: an entry declaring a range beyond the event's ceiling is
  swept to its own range; one declaring nothing is swept to the event's.
- The 64 MiB cap: a 65 MiB upload is refused with the engine's own wording.

## Staging

This is more than one sitting, and the pieces are separable. Implementation order, each
useful on its own:

1. **OAuth and the three-state panel.** Real usernames on the board, `rank_by` back to
   `user`, everything else unchanged: `Publish` still records to the store as it does
   today. This alone is what was asked for first.
2. **Publish to the author's repo**, the `kind: "hub"` record, and the download redirect.
   This is the piece that removes weights from the Space.
3. **Repo-id intake**, which makes the 13 existing policies raceable.
4. **Wider sweeps and `official_speed_probe`.** Independent of all of the above and the
   least urgent, since it changes numbers rather than capability — and it wants its own
   `RUNNER_VERSION` bump, because widening a sweep changes what a recorded time means.

Stage 4 must not be folded into the others: it invalidates the board, and that should be a
deliberate commit of its own.
