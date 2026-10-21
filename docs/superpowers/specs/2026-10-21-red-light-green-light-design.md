# Red Light, Green Light: a race a caller can stop — design

Date: 2026-10-21. Status: proposed by a participant (@jrubiosainz) in a pull request; awaiting the
owner's review.

## Why

Every race on the Arena asks the same thing of a walk: get to the line as fast as possible and stay
up. The sprint's leaders now win by diving at the line. This proposal adds a challenge borrowed from
the playground game, which asks for what no current challenge does: **stop on a cue, stand still
while someone watches, and start again**. Stopping on command is something a real robot needs. The
game reads at a glance in a clip. It also reuses the lane, the sweep, the scoring, the board and the
pages almost as they are.

## Goal

A new perpetual race, `red-light-green-light-2m5`: 2.5 m on flat ground, on legs. A Reachy Mini
stands past the finish line. On green it counts with its back to the lanes. On red it turns round,
and a duck it sees moving is caught. The lowest mean finish time wins, as on every race.

**Success.**

- The event loads, scores, ranks, replays and clips like any race, through the same code paths.
- The reference walker (`arena/assets/policies/BEST_alpha_walking.onnx`, the golden run's policy)
  finishes most seeds at the speed it walks best, 0.30 m/s, on both platforms: five of five on a
  Mac, four of five on the Space's (and 28 of 32 over more seeds).
- Policies that win elsewhere by diving or charging do not finish it: it rewards another skill.
- Every other event is untouched: same steps, same traces, same golden run, same records.

## Scope guard: events with `[lights]` only

Only a manifest with a `[lights]` table behaves differently. For every other event:

- `run_once` takes exactly the steps it takes today: every new line is behind `lights is not None`;
- the trace format, the sweep, the golden run and `RUNNER_VERSION` (4) do not change;
- the API's event summary answers `"lights": null`, and the pages draw no caller.

A stage refuses `[lights]`. A test keeps every shipped event other than this one free of lights.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **The policy sees the light through its command** | On red the command's twist (forward, lateral, yaw) drops to zero, and head and body stay as declared. The 61-D observation is unchanged, so every published policy can enter as it is. A walk that obeys a zero command and starts again cleanly does well. Rules out a new observation, a new rig and retraining for the format. |
| **The timetable is declared in the event and the same on every seed** | One caller times every lane of a replay, and a page draws the light from the event alone: no new field in a record, a trace or a timeline. Six phases of unequal length (green 0.6–3.0 s, red 1.4–2.4 s, a 23.8 s cycle) keep the rhythm irregular. Rules out a random timetable per seed. |
| **The caller takes 0.4 s to turn round, and nothing counts while it turns** | A walking duck cannot stop dead: the turn is its stopping distance. Rules out a judgement no walk could meet. |
| **The mark is where the trunk stands when the caller faces the lanes, and 3 cm of drift is allowed** | Measured on the floor plane only (x, y), so bobbing does not count. Swaying in place and a settling shuffle stay inside 3 cm, and a step forward does not. |
| **Caught is a fourth status, scored like a fall** | `RunOutcome.status` gains `"caught"`. Its `time_s` is `None`, so the seed counts as the time limit, like a fall or a timeout. Scoring, ranking, the board and the records need no change. |
| **Caught is judged after the fall and before the finish** | Within one step: NaN, fall, caught, then progress. A duck seen moving does not get to cross the line on that step. A duck still coasting while the caller turns is not seen, and if it crosses then, it has finished. |
| **The duck settles standing and the clock starts on a green** | The settle uses the red (standing) command, so nobody gets a flying start. |
| **A short first green on a 2.5 m lane** | From a standing start, the dives that win the sprint are about 2 m out after a second. The caller first faces the lanes at 1.0 s (0.6 s of green plus the 0.4 s turn), so a dive is caught short of the line. The lane is 2.5 m rather than the sprint's 2 m for that reason. |
| **A 60 s limit, and the sprint's sweep (0.20 to 1.20 m/s)** | Green is 12.4 s of every 23.8 s, so the reference's 0.30 m/s takes about 39 s. 60 s leaves room for slower walks, and the sweep rewards a fast walk that can still stop. |
| **The page draws the caller, from the event** | `app/src/lights.js` does the same whole-step arithmetic as the runner, so the drawn light changes on the step the runner's does. Rules out recording the light in the trace. |

## What was measured

The event as shipped, scored with `evaluate()` (the full sweep, three finalists, five seeds).

**On a Mac (Darwin-arm64), MuJoCo 3.10.0:**

| Policy | Command | Seeds | Score |
| --- | --- | --- | --- |
| The reference walker (`BEST_alpha_walking.onnx`) | 0.30 m/s | 5/5 finished, 39.16–39.94 s | 39.448 s |
| A sprint-board policy (0.860 s on the sprint) | — | 0/5: caught after diving about 2 m, or fell | 60 |
| A hill-board policy (0.780 s on the hill) | — | 0/5: fell at about 0.5 m | 60 |

The reference's sweep shows how narrow the walk is. At 0.20 m/s it does not move. At 0.25 m/s it
runs out of time at 2.13 m. Only 0.30 m/s finishes, and from 0.35 to 1.20 m/s every command falls
or is caught. That is the challenge: the reference walks, but it was never trained to stop.

**On Linux-x86_64, MuJoCo 3.10.0** (the Space's platform, on a cloud VM):

| Policy | Command | Seeds | Score |
| --- | --- | --- | --- |
| The reference walker (`BEST_alpha_walking.onnx`) | 0.30 m/s | 4/5 finished, 39.08–40.18 s; seed 1 caught at 2.27 m | 43.596 s |

The sweep's finalists there were 0.45, 0.35 and 0.30 m/s. Over 32 more seeds (0 to 31), the
reference at 0.30 m/s finishes 28 (36.5–40.2 s), is caught on 3 and falls on 1. At 0.25 m/s it
finishes none: it runs out of time at 1.8–2.2 m. At 0.35 m/s it finishes 5, is caught on 13 and
falls on 14.

Physics on the two platforms diverge after 1–3 s, as `arena/golden.py` records for the sprint, so
the numbers above are per platform. The Space's are the ones that count.

## Design

### 1. The format: `[lights]` (`arena/manifest.py`, `arena/events/red-light-green-light-2m5.toml`)

- `Lights(green_s, red_s, turn_s, tolerance_m)`, frozen. `Manifest.lights` is `None` unless the
  event has the table, and `Lights.to_dict()` serialises it for the API.
- Phase k is green for `green_s[k]`, then red for `red_s[k]`. The phases repeat until the time
  limit.
- Validation, each refusal naming the file:
  - the table is a table, and has no unknown keys;
  - `green_s` and `red_s` are non-empty lists of positive seconds, of the same length, each a
    whole number of 0.02 s control steps, so the light changes on a step and nowhere in between;
  - `turn_s` is zero or more, a whole number of steps, and shorter than every red, or the caller
    never looks;
  - `tolerance_m` is a positive distance;
  - a stage refuses `[lights]`: it has no line to walk to.
- The event: `order = 40`, perpetual, legs, a 2.5 × 0.8 m lane, 60 s, `mean_finish_time`, seeds 1
  to 5, the sprint's start (STAND, settled 0.5 s, perturbed 0.01 rad and 2°) and sweep, and:

  ```toml
  [lights]
  green_s     = [0.6, 2.4, 1.6, 3.0, 2.0, 2.8]
  red_s       = [1.6, 2.0, 1.4, 2.4, 1.8, 2.2]
  turn_s      = 0.4
  tolerance_m = 0.03
  ```

### 2. The simulation (`arena/runner.py`)

- `_LightSteps.of(lights, steps)` lays the timetable over a run's timed control steps as three
  boolean arrays. `red` marks the steps when the duck is asked to stand. `mark` marks the step
  that ends as the caller finishes turning round, which is the last green step when there is no
  turn. `watch` marks the steps from then to the end of the red.
- `run_once`, only when the event has lights:
  - the duck settles with the standing command (the event's command, twist zeroed);
  - each step, it gets the standing command on red and the event's command otherwise;
  - after the fall check, a `mark` step records the trunk's x and y. On a `watch` step, a trunk
    more than `tolerance_m` from its mark ends the run as `"caught"`, with `time_s = None` and the
    progress where it stood.
- Unchanged: `evaluate()` (caught counts as the limit, like a fall), `run_stage`, the trace and its
  codec, the golden run.

### 3. The Arena (`arena/web/routes_read.py`, `arena/commentary/`)

- `event_summary` carries `lights`, or `null`.
- The commentary:
  - `nature()` describes the game ("walk on green, stand still on red", tag `lights`);
  - `_result` names the caught seeds next to the falls (tag `caught`);
  - three lore lines are tagged `lights` and `caught`.

### 4. The site (`app/src/`)

- `lights.js`: `lightAt(lights, seconds)` returns `{ red, facing, watching }` for a moment of the
  race. `facing` eases from 0 (back to the lanes) to 1 over `turn_s`. Before the start, the caller
  counts with its back turned.
- `caller.js`: `buildCaller(model, lights, length, edge)` builds a Reachy Mini (the judges' model)
  on a step 0.22 m past the line, a post with a red and a green lamp beside it, and a strip along
  the far edge of the lanes, from the start line to the post. The strip is there because the chase
  camera keeps the duck in frame, and the caller only comes into it near the line. `pose(seconds)`
  turns the caller and lights the lamps and the strip. Its antennas wiggle while it counts.
- `viewer.js` builds the caller on any race whose event has `lights`, and poses it on the replay's
  clock less the lanes' lead. `clip/main.js` gives each lane its settle as `lead`, so the light keeps
  the race's clock in a clip.
- `share.js`: a run that finished no seed says "it got caught moving on a red light" when that is
  what stopped it. `run.js` already shows each seed's status.
- `roundcard.js`: the card's accent (lime), call to action ("Green light!") and title, with art in
  `app/public/cards/red-light-green-light-2m5.webp`.

### 5. Docs (`docs/guides/challenges/red-light-green-light-2m5.md`)

The guide explains the light, the turn, the 3 cm, the timetable and the scoring. It points to the
sprint's workshop template for training, since this challenge has none yet. `guides.test.js` knows
the new guide.

## Testing

- **pytest** (`tests/test_lights.py`):
  - the event loads with its lights, they serialise, and no other shipped event has lights;
  - every malformed `[lights]` is refused, with its message, and a stage refuses lights;
  - `_LightSteps`: the timetable cycles its phases over the steps; with no turn the mark is the
    last green step and the whole red is watched; a red the run ends inside its turn is never
    watched;
  - `run_once`, with the reference walker on the event cut to 3 s: the policy's observed twist is
    the standing one through the settle and every red step, and the walk on every green step; at
    a tolerance nothing meets, the duck is caught on the first step the caller watches, and not
    one before;
  - the shipped event runs end to end with the reference walker. The test does not assert which
    end it meets, since the platforms' physics part ways within seconds.
- **pytest, updated:** the manifest and course tests list the new event; `routes_read` carries
  `lights` (and `null` elsewhere); the commentary names caught seeds and their tag.
- **vitest:**
  - `lights.test.js`: green before and at the start; red on exactly the steps the runner judges
    red; the turn, and watching only once it is done; the turn back on green; the cycle repeating;
    a caller that takes no time to turn;
  - `caller.test.js`: where the caller stands; which way it faces; the lamps and the strip
    following the light; the strip along the far edge from the start line to the post; the
    antennas; `dispose` leaving the shared model whole;
  - `share.test.js`, `roundcard.test.js`, `guides.test.js`.
- **Seen before it was called done.** In a local store, on `arena serve` and with `arena clip`
  (headless Edge as `$CHROME`):
  - the reference's run: the caller, the lamps and the strip in step with the replay;
  - a sprint policy's run, caught moving: the light red and the caller facing the lanes when the
    verdict comes.

## Left to the owner

- **The card art** is generated, and is easy to replace.
- **A workshop template** in microduck-challenges: a walker trained to stop on a zero command and
  start again, with the command switched at random during training. Until then the guide points to
  the sprint's template.
- **The clip's tape.** A clip shows the first `clip.tape_max_s` seconds of a race (12 by default).
  That covers three reds, but a 40 s race is cut before the finish. A longer tape costs render time
  per frame (`budget_for`).
- Whether the event is perpetual, as proposed, or a round.

## Out of scope

- New observations: a policy never sees the caller or a clock, only its command.
- A random timetable per seed.
- Several ducks on one floor, eliminated as they are caught.
- Rollers: the event is on legs.
- Real robots.
