# A troupe on the Got a Talent stage: several ducks, several policies, one physics — design

Date: 2026-10-13. Status: approved in brainstorm, section by section; awaiting written review.

Builds on `docs/superpowers/specs/2026-10-13-talent-song-and-voice-design.md` (the song work,
commit 5b6e64d): that work lands first, and this one is written against the code it leaves —
`RunRecord.sound`, `sound_of(timeline)`, the `voice` and `song` keys of `timeline.json`. Its plan
(`docs/superpowers/plans/2026-10-13-talent-song-and-voice.md`, f6a61ed) runs in the worktree
`talent-song`. This work branches from that branch's final head, or from main once it is merged.

## Goal

An author can put **up to 4 ducks** on the MicroDuck Got a Talent stage in one entry, **16 being the
goal** once the cost is measured. Each duck runs its own policy (the author's own, or any public
policy on the Hub, credited), on legs or on rollers. Each duck also has its own place on the stage,
its own keyframes, its own tuned voice and its own song. They all share one physics, so they can
push each other. The workshop composes the troupe, places the ducks with the mouse, plays it, and
publishes every policy and the entry **in one click**.

**Success.**
- A troupe of 4 mixed-rig ducks performs on every page and in the clip as it did in the workshop:
  - each duck in its place;
  - each beak and voice on its own track;
  - the chorus in tune.
- Every performance already published keeps its score, its trace, its replay and its sound.
- Every policy already published can still enter alone, unchanged.
- Races are untouched.

## Scope guard: Got a Talent only

Troupes, `start` and placement exist only for an event whose `course.kind` is `"stage"`. Races
never read `timeline.json`. These do not change:

- `run_once`;
- the sweep;
- the lanes;
- the golden run;
- the per-event rig check in `hub_fetch.check_manifest`.

A test keeps a race refusing a timeline.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **One author, one entry, several policies** | The owner's choice over a troupe of copies of one policy, and over duos between participants. Rules out shared entries, split votes and consent flows. |
| **One shared physics: ducks touch** | The owner's choice over independent "ghost" simulations. The runner learns several robots in one model. Ducks can push each other over, and no policy was trained for that; the show takes it as it comes. |
| **Legs and rollers may mix** | The owner's choice. The rig is decided per duck, from its policy's manifest, on a stage. A race keeps the rig of its event. |
| **The entry stays the star's policy repo (approach A)** | `ducks[0]` is `"self"`: the entered repo's own `policy.onnx`, the star the followspot follows. Every field that reads "the entry's policy" keeps its meaning: board row, dedupe, download, card. Rules out a weights-less troupe repo (approach B) and a troupe with no policy of the author's own. |
| **Other ducks are Hub references pinned to a full commit** | `owner/repo@<40 hex>`, or `"self"` again. A branch name would make a run that cannot be reproduced. Any public policy may join, and its author is credited. |
| **Policies stay blind** | The 61-D observation is unchanged: a duck never sees another. That is why every published policy joins a troupe as it is, with no retraining. |
| **A v1 timeline is a troupe of one** | Every existing `timeline.json`, with or without `voice` and `song`, loads as duck 0 at the centre facing the audience. A test proves that a troupe of one plays bit-identically to today's `run_stage`, so one code path remains and `RUNNER_VERSION` stays 4. |
| **The cap is one number in the event** | `max_ducks = 4` in `got-a-talent.toml`. Going to 16 means changing that number after the step-2 measurements. |
| **Positions are absolute; old runs keep their centring** | An author's place is respected. A run recorded before troupes has no `start` and is drawn centred, as today. This is decided by the data, not by a flag. |
| **Voice and song are per duck** | Each duck has a tuned voice and a melody, which makes a chorus with parts. A top-level `voice` and `song` in a v1 file belong to duck 0. |
| **Two singing ducks make a chorus: `Stream::choral`** | This is the robot's rule: in a chord, vibrato, buzz, jitter and breath fight the tuning. A troupe where two or more ducks have a `song` sings every song through `Stream::choral`. A lone singer keeps `Stream::new`, as in the song spec. In a chorus, the `vibrato`, `buzz` and `breath` knobs are heard much less. |
| **One sound at a time, per duck** | This is the song spec's speaker rule, applied per robot, as on real robots. Ducks are mixed together behind a limiter. |
| **Votes and points go to the entrant only** | Borrowed policies are credited ("featuring @x · walker") but earn nothing, so nobody can farm points for someone who did nothing. |

## 1. The format: `timeline_version` 2

```json
{"timeline_version": 2, "duration_s": 20.0,
 "ducks": [
   {"policy": "self", "start": {"x": 0.0, "y": 0.0, "yaw": 0},
    "voice": {"pitch": 0.2},
    "song": [{"t": 2.0, "note": "C4", "for": 0.5}],
    "keyframes": [{"t": 0.0, "twist": [1, 0, 0], "triggers": [0, 0]}]},
   {"policy": "pollen-robotics/microduck-got-a-talent-reference@<40-hex commit>",
    "start": {"x": 0.4, "y": -0.6, "yaw": 90},
    "keyframes": [{"t": 0.0}]}
 ]}
```

**A duck** is an object with exactly these keys:

- **`policy`** (required): `"self"`, or `"owner/repo@<commit>"` where the commit is 40 lowercase
  hex characters. `ducks[0]` must be `"self"`. Any other duck may be `"self"` again, a reference,
  or the same reference as another duck.
- **`start`** (optional, default `{"x": 0, "y": 0, "yaw": 0}`) is a pose in the stage's frame,
  which is the simulation's world frame and the trace's.
  - The origin is the stage's centre.
  - `x` points to the audience.
  - `y` points to the audience's right, which is the duck's left when it faces the audience.
  - `yaw` is in degrees, and 0 faces the audience.
  - Each of the three is a finite number. `yaw` is within ±180.
- **`keyframes`** (required): a list under exactly the v1 rules (first `t` 0, increasing, before
  `duration_s`, ≤ 1000, groups within ±10, triggers within [0, 1]).
- **`voice`** and **`song`** (optional): exactly as the song spec defines them, per duck.

**Top-level keys:** `timeline_version` (2), `duration_s` (shared by the troupe, ≤ the event's
`time_limit_s`), and `ducks` (a list of 1 to `max_ducks` ducks).

**Placement rules.** Every start sits at least `EDGE_MARGIN_M` = 0.3 m inside the stage's
`size_m`. Every two starts are at least `MIN_SPACING_M` = 0.3 m apart, centre to centre. Both
constants are about the robot, so they live in `arena/timeline.py`. The stage's size is the
event's.

**v1 stays valid forever.** It loads as one duck, `"self"`, at the default start, carrying the
file's `keyframes`, `voice` and `song`.

**Refusals** name their place, in the loader's existing style:

- `ducks[0].policy: the first duck is the entry's own policy: "self", got 'a/b@…'`;
- `ducks[2].policy: 'a/b@main' must pin a full 40-character commit`;
- `ducks[1].start: x 1.2 is off the stage (|x| ≤ 1.0 m)`;
- `ducks[3].start: 0.21 m from ducks[1], closer than 0.3 m`;
- `ducks: 5 ducks, this event takes at most 4`;
- `ducks[1].policy: 'local:…' is a checkpoint on your machine: publish it first` (an entry).

**Identity.** The file's sha256 covers the references, so another duck makes another
performance. `_already_entered` stays correct unchanged.

## 2. The simulation

- **The event.** `[course]` of a stage gains `size_m = [2.6, 3.8]` (depth along `x`, width along
  `y`: today's drawn stage) and `max_ducks = 4`. A lane has neither.
- **The model.** For a stage, `compile_course` takes the cast:
  - It lays the floor, then grafts one robot per duck, prefixed `duck0/`, `duck1/`, …, each from
    its rig's MJCF (`RIG_XML`).
  - Each robot spawns at its start's `x`, `y`, at its rig's own spawn height (the roller's
    2 cm-deep spawn never moves), turned by its `yaw`.
  - One keyframe holds every robot's pose.
  - Robots collide with each other. Inside a robot, its MJCF's own contact exclusions stand.
  - The mechanism is `MjSpec.attach` with a prefix. If that changes body or contact order and
    breaks bit-identity for one duck, robots are duplicated at XML level with prefixed names instead.
- **The control step**, shared by the whole troupe:
  1. Every duck observes the same state.
  2. Every policy acts on its duck's command (its own keyframes at `k × CTRL_DT`).
  3. In each of the four substeps, every duck's servos are driven, then one `mj_step` runs.
  4. Every duck's servos are driven once more (training's fifth drive), then `mj_forward` runs.

  With one duck, this is exactly today's loop.
- **Per duck:** its `_Addresses` (prefixed names), `Servos` (its own dof ids), last action and
  one-step-old joint velocity.
- **Streams.** Duck 0 keeps today's: perturbation `[crc(event), seed]`, servo delays
  `[crc(event), seed, 1]`. Duck `k ≥ 1` uses `[crc(event), seed, 2, k]` and
  `[crc(event), seed, 3, k]`. The start perturbation (joint noise, yaw ±2°) is added to the
  author's pose.
- **Policies.** One ONNX session per distinct policy file: three copies of `"self"` share one.
- **The end.** Nothing changes: no fall stops the show. A MuJoCo reset (`BADQPOS`, `BADQVEL`,
  `BADQACC`) cuts the performance for the whole troupe, since the physics is shared.
- **The trace** is `(N, frames, 21)`, and the settle is `(N, steps + 1, 21)`. Each duck's 21
  numbers are today's: free joint, then the 14 servos.
- **`arena/stage.py`** summarises each duck (`fell_at`, `seated_s`, `standing_s`).
  `arena score --timeline` prints one line per duck.
- **Compatibility, proven.** A test plays the published Got a Talent reference with its v1
  timeline through today's `run_stage` and through the troupe path, and the two traces are equal
  bit for bit. Only then is the old path deleted. The sprint golden run stays unchanged.

## 3. The Arena (server)

- **`/api/events`** serves a stage's `size_m` and `max_ducks`, so the server's validation, the
  workshop's placement plan and the drawn stage read the same numbers. This is how `wall_boxes`
  works for lanes. `stageLayout` (talent-stage.js) takes the stage size from the event rather than
  from its own constants.
- **`hub_fetch`.**
  - The entered repo is read as today: ONNX, manifest, then timeline, all before the weights.
  - On a v2 timeline, each distinct reference is read at its commit under the same rules: ONNX
    choice, 64 MiB cap from the declared size, `check_manifest` for the observation length, the
    action length and the kind.
  - On a stage, the rig is checked per duck (legs or rollers, from the manifest; the event's rig
    when the manifest has none).
  - A referenced repo's own `timeline.json` is ignored.
  - A refusal names the duck: `ducks[2]: pollen-robotics/…: <reason>`.
- **`RunRecord`.**
  - Today's fields keep their meaning and describe the star: `source`, `model_sha256`,
    `policy_name`, `livery`, `description`.
  - A new `cast` lists every duck as `{"policy": "self" | {repo_id, filename, revision, url,
    model_sha256, user, policy_name}, "rig", "start", "sound"}`.
  - `sound` (the song spec's object) moves into the cast, so `RunRecord.sound` is gone.
  - `from_dict` turns a record without `cast` into a cast of one: `"self"`, the event's rig,
    `start: null`, and the old top-level `sound` (or the older `triggers`) as its sound. This is
    the one read path, with no data migration. `start: null` is what tells the site to centre an
    old run as today.
- **Traces.** `trace.encode` takes the 3-D arrays, and `decode` reads a 2-D blob as one duck.
  `/runs/{id}/trace` and `/settle` send float32 duck-major with `X-Frame-Count` and a new
  `X-Duck-Count`. A troupe weighs about 42 KB per duck: about 670 KB at 16 ducks, about 2.7 MB for a
  4-performance ballot.
- **Payloads.** Board rows, ballots and workshop evaluations carry `cast` where the song spec
  carries `sound`.
- **`recover`.** The candidate is still the star's repo, and its v2 timeline gives the
  references. A referenced repo that is gone makes that run impossible to re-race. The stored trace
  is the authority, since recovery only re-races what the store lost.
- **Votes and points** go to the entrant. The run page credits each borrowed duck's author and
  policy. The download button stays the star's, with links to the other repos.
- **Commentary.** The facts name the troupe, e.g. "The performance has 3 ducks: @x's sitter (the
  star), @y's walker and @x's sitter again." The star's description is quoted as today.

## 4. The site: seen and heard

- **A stage lane holds N rigs.** Every place that cuts a stage down to one duck goes:
  - `viewer.setLanes`'s `slice(0, 1)` and its `lanes[0]` voice and camera;
  - `race.js`, `run.js`, `vote.js` and `clip/main.js` slicing the stage.

  The viewer loads the kinematics of every rig present, not one per viewer.
- **Placement on screen.** A duck with a `start` is drawn where the trace says, since the trace is
  already in stage coordinates. A run whose cast has `start: null` is centred on its own path, as
  `placeStagePerformer` does today.
- **Camera.** The shots frame the troupe: the Hann-smoothed centre of every duck, with the
  distance fitted to their spread. The cycle's close shot stays on the star. One duck frames as
  today.
- **Light.** The followspot follows the star, and every duck has its shadow. The shadows are the
  first cost to measure at 16.
- **Voice.**
  - Each duck has its own beak (`mouthTrack(sound)`) and its own calls under the song spec's
    one-speaker rule.
  - The ducks are mixed together through a limiter (a `DynamicsCompressorNode`, in the stage voice
    and in the clip's offline mix), so a chorus of 16 does not clip.
  - When two or more ducks have a `song`, the wasm's `song(…)` takes a `choral` flag and renders
    through `Stream::choral`.
- **Ballot.** It already shows one performance at a time ("Watch performance N"), so at most 16
  ducks are on screen. All four performances' traces are loaded.
- **Clip.**
  - It fetches the N tracks and puts N songs and N call tracks into the soundtrack.
  - Its caption credits the troupe: "@user · name · 3 ducks, featuring …".
  - The home page and the live channel play the MP4, so they do not change.
- **Share text.** "robot ducks" when N > 1.

## 5. The workshop: compose, place, play, publish in one click

Everything happens on the Got a Talent training page, under the owner's UI direction: few buttons,
and each one only when it is needed.

- **The troupe.**
  - Duck 0 is the checkpoint on screen, the star, as today.
  - A "+ duck" adds a duck from: a checkpoint of **any of your trainings** (any challenge; the rig is
    its challenge's event's), one of your published policies (from every run's `published.json`), or
    a Hub repo pasted by hand.
  - A checkpoint not yet published is written in the timeline as
    `"policy": "local:<challenge folder>/<run name>@<checkpoint>"`. The loader accepts that form only
    when the workshop asks it to (saving and playing). An entry refuses it.
- **Placement.** Above the timeline's text box sits a top view of the stage, drawn from the event's
  `size_m`.
  - Each duck has a numbered marker, and the star stands out.
  - Dragging a marker moves the duck, and a handle turns it (`yaw`).
  - A spot the loader would refuse (off the stage, closer than 0.3 m to another duck) turns red and
    is not taken.
  - Moving a marker rewrites that duck's `start` in the text, and editing the text moves the marker.
    While the text is not valid JSON, the plan is greyed out.
  - It works with a single duck.
- **Play.** "Save and play" (already there) plays the whole troupe locally with the Arena's own
  simulation.
  - Local checkpoints are exported, cached as today.
  - Hub references are downloaded at their commit.
  - The summary (fell, seated, standing) is shown per duck.
- **Publish in one click.** The existing publish button:
  1. publishes each distinct `local:` checkpoint to its own repo (`user/microduck-<name>`) with
     `publish --run --checkpoint`, **without** `--enter`. A checkpoint already published at that
     checkpoint is reused from `published.json` rather than published again;
  2. writes a copy of the timeline in which each `local:` becomes `owner/repo@<commit>`. The
     challenge's own file keeps its local forms, so the author keeps iterating;
  3. publishes the star with that resolved timeline and `--enter`, which is today's command.

  The page shows "Publishing duck 2/3…" along the way. If step 3 fails, the policies already
  published stay on the Hub, harmless, and the next click reuses them.
- **microduck_rl:** nothing new; `publish` already publishes without entering and uploads the
  timeline as given.
- **CLI:** `arena score --timeline` plays a v2 file, with `"self"` the ONNX given as argument and the
  Hub references fetched. The `local:` form is the workshop's only.

## 6. Docs, tests, verification, cost, release

- **Docs (English).** `docs/guides/challenges/got-a-talent.md` gains "Troupe" (the format, the
  references, the chorus rule, the credits) and "Placement" (the frame, the rules, the workshop's
  plan). In microduck-challenges, `README.md` and `got_a_talent/AGENTS.md` point to them.
- **Tests that guard compatibility.**
  - A troupe of one is bit-identical to today's `run_stage` on the reference, before the old path
    goes.
  - The sprint golden run is unchanged.
  - A race refuses a timeline, and a race keeps the per-event rig check.
  - An old record (with `sound`, with `triggers`, with neither) reads as a cast of one with
    `start: null`.
  - An old 2-D `.npz` decodes as one duck.
  - Old runs are drawn centred.
- **Tests of the new behaviour.**
  - **pytest:**
    - every v2 refusal above, plus v1 read as a troupe of one;
    - a 4-duck mixed-rig troupe played twice gives the same trace;
    - two ducks walked into each other register contacts between their geoms;
    - a MuJoCo reset cuts the whole troupe;
    - `hub_fetch` with references, using a fake Hub;
    - the payloads carry `cast`;
    - the workshop's one-click order, with a fake `publish`: `local:` ones without `--enter`, reuse
      through `published.json`, the star last with `--enter` and the resolved timeline.
  - **vitest:**
    - a stage lane with several rigs;
    - the troupe framing;
    - the limiter in the mix;
    - the choral flag passed when two ducks sing;
    - the placement plan: dragging rewrites `start`, a refused spot is not taken, text edits move
      markers.
- **Seen and heard before it is called done.** A real troupe of 4 (the reference sitter twice, a
  walker, a roller), placed with the plan and singing:
  - played in the local stage preview;
  - captured headless;
  - its clip soundtrack rendered to a WAV the owner listens to.
- **Step 1 (cap 4) ships as one release**, because pushing main deploys the Space: if the server
  took v2 before the pages could draw it, the pages would break. The work is done in a worktree.
  Version **0.5.0** (a new timeline version), after the song work's 0.4.5. Release steps, each on
  the owner's yes, come after the finishing session (section 7):
  1. the wheel on pollen-robotics/microduck-arena-wheels with tag v0.5.0;
  2. push main;
  3. microduck-challenges relocked onto 0.5.0 and pushed straight after.
- **Step 2 (raise to 16).** Measure:
  - simulation time at 16 ducks with contacts (today 20 s of stage costs 1.5 s on this Mac for one
    duck);
  - a 16-duck clip on the HF Job (t4-small, EGL);
  - the ballot's frame rate;
  - trace weight;
  - the worst-case download of 16 distinct policies (decide on a total cap).

  Fix what is slow (shadows, level of detail), then change `max_ducks`.

## 7. The finishing session (after both pieces of work)

**Deliverable:** a **local** version, nothing pushed. Arena 0.5.0 plus the workshop on
microduck-challenges, with a **Got a Talent training** whose performance is a troupe of 4 ducks
that **sing and dance**:

- **The number:** "Are You Sleeping, Brother John?" (public domain) sung as a four-part round.
  - Each duck comes in two bars after the one before.
  - Each duck has a differently tuned voice.
  - The ducks sing through the chorus rule.
- **The dance:** sit and stand, head moves, quacks and wheees.
- **The cast:**
  - the trained checkpoint as the star, and a copy of itself;
  - the reference walker crossing the stage;
  - a roller duck.
- **Placement:** set with the workshop's plan.
- **Training:** decided on the day: a fresh run from the workshop (about 2 h 20 min on HF Jobs for
  3000 iterations), or the existing reference run.

The session ends with the owner watching and listening locally, on the training page and in a clip
rendered locally. Release (section 6) follows on the owner's yes.

## Left to the plan

- The livery of borrowed ducks: the default livery, or the star's.
- Whether the star's Hub README lists the troupe.

## Out of scope

- Policies that perceive other ducks (the observation is unchanged).
- A troupe with no policy of the author's own (approach B).
- Positions, troupes or timelines in races.
- Votes or points for the authors of borrowed policies.
- A visual song editor (as in the song spec).
- Real robots performing a troupe.
