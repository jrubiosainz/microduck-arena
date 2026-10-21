# Tug of War: two policies, one rope — design

Date: 2026-10-21. Status: a request for comments from a participant (@jrubiosainz), in a draft
pull request. It ships the rules, the simulation and a referee that plays from the shell. The
decisions only the owner can take are listed at the end.

## Why

Every challenge on the Arena ranks one policy by a number it earns alone: a time, a distance, a
score. The sprint's leaders and the hill's never meet. A duel puts two policies on the same physics:
a rope between their trunks, a pit between their decks, and the one still on its deck wins. It asks
for what no current challenge does: **hold your ground under a load that pulls you backwards, and
pull back**. A walk that only knows clear ground does not last: the reference walker is pulled into
the pit in under half a second by every leader it meets. A one-on-one result (won, drawn, lost) makes
a board as simple as a league table, and a duck falling into a pit reads at a glance in a clip.

## Goal, and what this PR is

A two-player challenge, declared as data like an event, that plays from the shell:

```
arena duel A.onnx B.onnx            # a match: every seed played from both decks
arena duel A.onnx B.onnx C.onnx     # a round robin, and its table
```

This PR is the rules, the simulation and the referee. It is not a challenge on the site:

- `arena/duels/tug-of-war.toml`: the duel, validated as strictly as a manifest;
- `arena/duel.py`: the loader, the two-duck model, the bout, the match, the round robin and the
  table;
- `arena duel` in `arena/cli.py`;
- `tests/test_duel.py`;
- this document.

There is no board, store, page, clip or Space change. Each of those depends on a decision listed
under "Left to the owner". This PR is what can be built and measured before those decisions.

**Success.**

- A duel loads, compiles, plays and scores deterministically on one platform, through the engine's
  own opening (`arena.runner._start`) and stepping.
- The loser falls: most decided bouts are decided by the pit, not on points.
- It ranks: the reference walker loses every bout to the leaders, and the leaders separate from each
  other by a few bouts.
- Nothing that exists changes.

## Scope guard: nothing that exists changes

- `arena/duels/` is not `arena/events/`. `all_events()` and `load_event()` never see a duel, so the
  programme, the boards, the store, the sweep and the pages are as they were.
- `arena/duel.py` builds on the engine's parts (`course._robot`, `_motorized`, `_compiled`,
  `runner._start`, `manifest._command`, …) and changes none of them. `run_once`, `run_stage`, the
  trace and its codec, the golden run and `RUNNER_VERSION` (4) are untouched.
- The only edit to an existing file is the `duel` subcommand in `arena/cli.py`: an import, a
  handler and a parser.

## Rules

- Two decks, 2.0 × 0.8 m, face each other across a pit 0.5 m wide and 0.6 m deep. Each deck has a
  0.15 m wall along both sides.
- Duck k stands on deck k, its trunk 0.25 m from the pit's edge, its back to the pit. A rope joins
  two harness sites, 2.5 cm above each trunk's origin and 1.0 m apart at the start. The rope has
  1.5 cm of slack. It is a cap, not a spring: the ducks can close in freely, but cannot get any
  further apart.
- Both ducks settle standing (0.5 s, untimed). Then both are asked the same command: 0.3 m/s
  straight on, away from the pit. Walking is pulling.
- After every control step (0.02 s) the referee looks. A trunk 0.10 m below the decks is in the
  pit, and its duck has lost; two at once is a draw. A simulation that MuJoCo had to reset is void,
  and a void bout is a draw.
- At the bell (20 s), a bout that nobody has lost goes to the duck that has pulled the rope's middle
  more than 5 cm its way. Otherwise it is a draw.
- A match plays every seed (1, 2, 3) twice, the policies swapping decks. A won bout is a point and
  a drawn bout half a point each, so a match is out of 6.
- A round robin plays every pair once. The table counts bouts: most points first, then most wins,
  then by name.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **One against one, and the loser falls** | A bout ends the moment a duck is in the pit, so most results are a fall anyone can see. A won, drawn or lost result fits a league table, a challenge-the-champion ladder or an Elo rating. Rules out teams for now. |
| **The duel reaches a policy only through its command and its body** | Both ducks are asked to walk straight on, and they feel the rope through their trunks. The 61-D observation is unchanged, so every published policy can enter as it is. Rules out observing the rope, the pit or the opponent, and retraining for the format. |
| **One command for both, fixed by the duel** | Measured: the reference asked 0.4 m/s beats itself asked 0.3 m/s four bouts to one (one drawn), and at 0.5 m/s five to none (one drawn). If each entry chose its pace, a duel would first be a contest of choices; fixed, it compares the policies. 0.3 m/s is the pace the reference holds: asked 0.4 or 0.5 m/s against itself, it falls into the pit in 4 and 6 bouts of 6. |
| **The rope is a limited tendon** | A spatial tendon between the two harness sites, limited to their distance at the start plus the slack. MuJoCo applies a force only at the limit, so slack costs nothing and a taut rope pulls along its own line. The limit's time constant (22 ms, `solref`) makes the rope firm without making it rigid. The limit's transition is widened from MuJoCo's 1 mm to 3 mm (`solimp`), so the last of the slack is taken up rather than snapped. The loader refuses a time constant under two physics steps (0.01 s), which MuJoCo would quietly raise to that. Rules out a rope of bodies and joints, which is heavier to simulate and adds contacts. |
| **The harness is on the trunk** | Every rig has a trunk, and every policy feels the trunk's motion in its observation. Rules out tying the rope to a leg or the head. |
| **Back to the pit, 0.25 m from its edge** | Walking straight on is pulling, so a walker needs no new command to play. From 0.25 m, a duck pulled off balance goes in: 38 of the 60 bouts measured end in the pit. From 1.0 m (with a 30 s bell), 28 of 30 bouts went to the bell. |
| **Walls along the decks' sides** | Without them, 3 of 18 bouts measured between leaders ended with a duck off the side of its deck, at 1.7–12.6 s. With the walls, the same three ended as a fall into the pit, a win at the bell and a draw at the bell. A bout is then lost to the pull rather than to a drift sideways. |
| **Each seed from both decks** | The decks are not alike: each duck draws its start perturbation and its servo delays from its own slot's random streams (`arena.runner._streams`). The reference against itself ends seed 2 with the rope's middle 4 cm towards deck 0. Playing every seed twice, the policies swapping decks, leaves neither with the luckier slot. |
| **A void bout is a draw** | A simulation that MuJoCo had to reset leaves nothing to judge, and nobody can say whose fault it was. None of the 60 bouts measured was void. |
| **Points by the bout** | The table counts bouts (won, drawn, lost) rather than matches, so a 4–2 and a 6–0 are not worth the same. |
| **A 20 s bell and a 5 cm margin** | The last of the leaders' falls came at 14.9 s. At the bell, the reference against itself ends within 4 cm of the middle. Between leaders, the bouts drawn at the bell ended within 3.8 cm of the middle, and the bouts won at the bell 5.3 cm or more from it. |

## What was measured

The duel as shipped, with `arena duel`: a round robin of five policies, 60 bouts. On a Mac
(Darwin-arm64) with MuJoCo 3.10.0 and onnxruntime 1.24.4 it took 46 s of wall time, about 0.8 s a
bout. The policies are the reference walker (`BEST_alpha_walking.onnx`, the golden run's policy),
two policies from near the top of the sprint board (0.860 s, *sprint-a* and *sprint-b*) and two from
near the top of the hill board (0.780 s, *hill-a* and *hill-b*).

| Match | Score |
| --- | --- |
| reference – sprint-a, sprint-b, hill-a, hill-b | 0–6 each |
| sprint-a – sprint-b | 3.5–2.5 |
| sprint-a – hill-a | 3.5–2.5 |
| sprint-a – hill-b | 2.5–3.5 |
| sprint-b – hill-a | 2.5–3.5 |
| sprint-b – hill-b | 2.5–3.5 |
| hill-a – hill-b | 2–4 |

| # | Policy | Won | Drawn | Lost | Points |
| --- | --- | --- | --- | --- | --- |
| 1 | hill-b | 16 | 2 | 6 | 17 |
| 2 | sprint-a | 11 | 9 | 4 | 15.5 |
| 3 | hill-a | 12 | 4 | 8 | 14 |
| 4 | sprint-b | 10 | 7 | 7 | 13.5 |
| 5 | reference | 0 | 0 | 24 | 0 |

- Of the 60 bouts, 38 ended in the pit, 11 were won at the bell and 11 drawn at the bell. None was
  void.
- The reference lost all 24 of its bouts in the pit, at 0.30–0.48 s. It does not lean into the
  load: as soon as the rope is taut, it is pulled over backwards.
- Between leaders (36 bouts): 14 ended in the pit, at 1.8–14.9 s, 11 were won at the bell and 11
  drawn at the bell. No match was more one-sided than 4–2.
- The reference against itself draws all six bouts at the bell.

A match from the shell (sprint-a against hill-b):

```
Tug of War: seeds 1, 2, 3, each played from both decks; the bell at 20 s
seed 1  sprint-a | hill-b  sprint-a won: hill-b fell off its deck at 14.88 s
seed 1  hill-b | sprint-a  hill-b won at the bell, the rope's middle 0.068 m its way
seed 2  sprint-a | hill-b  a draw at the bell, the rope's middle at +0.033 m
seed 2  hill-b | sprint-a  hill-b won at the bell, the rope's middle 0.053 m its way
seed 3  sprint-a | hill-b  hill-b won at the bell, the rope's middle 0.109 m its way
seed 3  hill-b | sprint-a  sprint-a won: hill-b fell off its deck at 10.58 s
sprint-a 2.5–3.5 hill-b
```

**The levers**, each changed alone from the duel as shipped, on the same Mac:

| Change | What happened |
| --- | --- |
| Setback 1.0 m, bell at 30 s | 28 of 30 bouts went to the bell. The reference still lost 0–6 to sprint-a (all at the bell) and 0–6 to hill-a (2 in the pit, at 4.5 and 5.0 s). sprint-a – hill-b and hill-a – hill-b were both 2–4, all at the bell. The reference against itself: six bouts at the bell. |
| No walls | Of 18 bouts between leaders (sprint-a – hill-b, hill-a – hill-b and sprint-a – sprint-b), 3 ended with a duck off the side of its deck, at 1.7–12.6 s. The other 15 ended the same way as with the walls. The reference against itself: six bouts at the bell. |
| Both asked 0.4 m/s | The reference against itself: 4 of 6 bouts in the pit, at 10.4 and 18.3 s. |
| Both asked 0.5 m/s | The reference against itself: 6 of 6 in the pit, at 12.5–19.3 s. |
| The reference asked 0.3 m/s against itself asked 0.4 m/s | The faster won 4, the slower 1, and 1 was drawn. |
| The reference asked 0.3 m/s against itself asked 0.5 m/s | The faster won 5, and 1 was drawn. |

Physics on two platforms part ways within a few seconds, as `arena/golden.py` records for the
sprint. So these numbers are per platform. A board would play all its matches on one platform, the
Space's.

## Design

### 1. The format: `arena/duels/<id>.toml` (`load_duel`, `load_duel_by_id`)

- Top level: `id`, `title`, `rig`, `kind`, `time_limit_s` (the bell) and `seeds`. Then
  `[command]` (as an event's), `[start]` (`keyframe`, `settle_s`, `setback_m` and
  `[start.perturbation]`), `[decks]`, `[rope]` and `[referee]`.
- Validation, each refusal a `ManifestError` naming the file:
  - every table is a table, and unknown keys are refused at every level;
  - `id` is a non-empty name, `rig` and `kind` are among a manifest's, and `seeds` is a non-empty
    list of distinct whole numbers;
  - every number is finite and positive. A wall height, the slack, the harness height, the margin,
    the settle and the perturbation may be zero. A boolean is not a number;
  - the setback is shorter than the decks, or a duck starts off its own deck;
  - the rope's time constant is at least two physics steps;
  - the pit is deeper than the referee's drop plus a standing duck (0.12 m), or a duck could stand
    in the pit unseen.
- A `Duel` carries a `manifest.Start`, read by `arena.runner._start` exactly as an event's is.
  `_start` reads nothing else of a manifest but its `id`, which names the random streams.

### 2. The model (`compile_duel`)

- Duck 0 is the rig's MJCF with its servos as motors, as a troupe's first duck is
  (`arena.course.compile_stage`). The model has the physics step, a floor 0.6 m down in the pit,
  and the decks and walls from `deck_boxes()`. That one function serves the physics and whatever
  draws the decks, as `arena.course.wall_boxes` does for a stage.
- Duck 1 is the same rig, attached under its prefix on deck 1. Duck 0 faces -x and duck 1 faces +x.
- A `harness` site on each trunk, and the tendon `rope` between them: range `[0, start distance +
  slack]`, `solref_limit = (timeconst_s, 1)`, `solimp_limit = ROPE_SOLIMP`.
- The keyframe stands both ducks on their decks in the default pose.

### 3. The bout (`play_bout`)

- The opening is every run's (`arena.runner._start`): training's reset, each slot's perturbation
  and servo delays, and the untimed settle, with both ducks asked to stand (the command's twist
  zeroed).
- Then, every control step: both ducks are asked the duel's command, and the referee checks for a
  void, then the pit. At the bell, the rope's middle decides.
- `Bout(seed, winner, end, time_s, rope_mid_m)`: the winner is a deck (or `None`), and `end` is
  `"pit"`, `"bell"` or `"void"`.

### 4. The match, the round robin and the table

- `play_match(duel, a, b)` plays every seed from both decks on one compiled model. `Played.winner`
  turns a deck into A or B, and `Match.points` counts a win as 1 and a draw as ½.
- `round_robin(duel, policies)` plays every pair once, on one model.
- `standings(names, matches)` counts won, drawn and lost bouts, and sorts by points, then wins,
  then name.

### 5. The shell (`arena duel`)

- Two policies: a line per bout (who stood on which deck, and how the bout ended), then the score.
- Three or more: each match's score, then the table.
- Fewer than two is refused. `--duel` picks a duel from `arena/duels/` (default: `tug-of-war`).
  Two files with the same name are told apart by their position.

## Testing

**pytest** (`tests/test_duel.py`, 44 tests):

- the shipped duel loads with what it declares, and is not an event;
- every malformed duel is refused, with its message: unknown keys at every level, a missing table,
  a value where a table belongs, a number that is zero, negative, not finite or a boolean, an empty
  or duplicated seed list, an unknown rig or kind, an empty keyframe, a command of the wrong length,
  a setback longer than the decks, a rope time constant under two physics steps, and a pit too
  shallow;
- the model: two ducks, the decks where `deck_boxes` puts them, the walls (none when their height
  is 0), and the rope's limit;
- the start: each duck on its deck, its back to the pit, and the rope at its starting length, short
  of its limit by the slack;
- the bout: deterministic; a duck placed over the pit falls in and loses on the first step; two in
  the pit is a draw; at the bell, both ducks placed 10 cm towards one deck give that deck the win,
  and centred they draw; a simulation MuJoCo resets is void; a bout takes exactly two policies;
- the match: every seed from both decks, the winner named as the match names them, and the points;
- the table: every bout counted, and ties broken on wins, then name;
- the shell: a match prints every bout and the score, three policies print a table, and fewer than
  two policies or an unknown duel are refused.

The rest of the suite runs as it did. No bout in these tests lasts more than a second: they use the
reference walker or a policy that holds the default pose, on a duel cut short or set up to end at
once. None asserts how a full bout between real policies ends, since the platforms' physics part
ways.

## Left to the owner

- **The board's format.** Options:
  - a perpetual league, where each new entry plays every other: 6 bouts a match, about 5 s a match
    on a Mac, so about 8 minutes for a new entry against 100;
  - a ladder, where an entry challenges the champion or the entry above it;
  - an Elo rating from a sample of matches;
  - a gauntlet against fixed opponents;
  - a round of its own.

  A full round robin of n entries is n(n−1)/2 matches.
- **Whether each entry may choose its command.** Measured above: a faster pull wins, up to the pace
  its walk can hold.
- **Whether falling over on your own deck loses.** Today only the pit counts: a duck lying on its
  deck is still in the bout, to be dragged in or not.
- **The rope and the start.** A softer rope (a longer time constant) or one with some give, a lower
  or higher harness, a longer setback (more bouts decided on points), or a longer bell.
- **Tie-breaks.** By name today; head-to-head, the rope's middle or a play-off would be fairer.
- **Integration.** `compile_duel` beside `compile_stage` in `arena/course.py`, and the bout beside
  `run_stage` in `arena/runner.py`, with a two-duck trace (a stage's trace already records several
  ducks). Then records, a board, pages, a clip of both ducks and the rope, the commentary, and a
  worker that plays the matches as entries arrive.
- **One platform.** Physics differs between platforms, so a board must play all its bouts on one
  platform (the Space's), or a rematch could disagree with the result on the board.

## Out of scope

- Teams, with several ducks a side.
- New observations: a policy never sees the rope, the pit or its opponent.
- Rollers: the duel is declared, and was measured, on legs.
- The site: records, boards, pages and clips.
- Real robots.
