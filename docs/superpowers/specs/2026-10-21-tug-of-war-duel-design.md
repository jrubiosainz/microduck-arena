# Tug of War: two policies, one rope — design

Date: 2026-10-21. Status: a request for comments from a participant (@jrubiosainz), in a draft
pull request. It ships the rules, the simulation, a referee that plays from the shell, and a page
that replays a match in the Arena's own stadium. The decisions only the owner can take are listed
at the end.

## Why

Every challenge on the Arena ranks one policy by a number it earns alone: a time, a distance, a
score. The sprint's leaders and the hill's never meet. A duel puts two policies on the same physics:
a rope between their trunks, a pit between their decks, and the one still on its deck and on its
feet wins. It asks for what no current challenge does: **hold your ground under a load that pulls
you backwards, and pull back**. A walk that only knows clear ground does not win: the reference
walker, made to lean 5–10° further into the rope, pulls the reference itself into the pit in
3–8 s, every bout. A one-on-one result (won, drawn, lost) makes a board as simple as a league
table, and a duck falling into a pit reads at a glance in a clip.

## Goal, and what this PR is

A two-player challenge, declared as data like an event, that plays from the shell and can be
watched:

```
arena duel A.onnx B.onnx            # a match: every seed played from both decks
arena duel A.onnx B.onnx C.onnx     # a round robin, and its table
arena duel A.onnx B.onnx --watch    # a match, then its bouts in the stadium, on 127.0.0.1
```

This PR is the rules, the simulation, the referee and a way to watch them. It is not a challenge
on the site:

- `arena/duels/tug-of-war.toml`: the duel, validated as strictly as a manifest;
- `arena/duel.py`: the loader, the two-duck model, the bout, the match, the round robin and the
  table, and the bout and the match recorded for a replay;
- `arena duel` in `arena/cli.py`, and its `--watch`;
- `arena/duel_watch.py`: the server `--watch` starts on 127.0.0.1, for as long as the command
  runs;
- the page it serves: `app/duel.html`, `app/src/duel/` (`main.js`, `hall.js`, `bouts.js`) and
  `app/public/duel.css`, and the venue the viewer builds for it, `app/src/duel-venue.js`;
- in the app, a fifth page in `app/vite.config.js`, the duel's venue in `app/src/viewer.js`, and a
  dais for the jury in `app/src/judges.js`;
- `tests/test_duel.py`, and the app's tests of the venue, the page and the jury;
- this document.

There is no board, store, record, clip or Space workflow change. The page is built with the site,
as `workshop.html` is, but plays only what `arena duel --watch` serves: on the Space it says that
the duel's server did not answer. The rest depends on decisions listed under "Left to the owner".
This PR is what can be built, measured and watched before those decisions.

**Success.**

- A duel loads, compiles, plays and scores deterministically on one platform, through the engine's
  own opening (`arena.runner._start`) and stepping.
- The loser goes down: 328 of the 330 bouts measured between different policies ended before the
  bell, in the pit or by the fall rule every event already uses.
- It ranks: a walker that leans further into the rope beats one that leans less, and a duck that
  only holds a pose never beats a walker.
- A match can be watched as it was played: every bout, in the stadium every challenge is shown in.
- Nothing that exists behaves differently.

## Scope guard: nothing that exists behaves differently

- `arena/duels/` is not `arena/events/`. `all_events()` and `load_event()` never see a duel, so the
  programme, the boards, the store, the sweep and the pages are as they were.
- `arena/duel.py` builds on the engine's parts (`course._robot`, `_motorized`, `_compiled`,
  `runner._start`, `manifest._command`, `manifest.Termination`, …) and changes none of them.
  `run_once`, `run_stage`, the trace and its codec, the golden run and `RUNNER_VERSION` (4) are
  untouched.
- The edits to existing files add to them, and leave what was there as it was:
  - `arena/cli.py`: the `duel` subcommand (imports, a handler with its `--watch`, and a parser);
  - `app/vite.config.js`: `duel.html`, a fifth page;
  - `app/src/viewer.js`: the duel's venue (`duel-venue.js`), built in place of a race's course
    when the event is a duel, and `PLATE_HEIGHT` and `PLATE_LIFT` exported. `spot(i, lift)` takes
    a height above the trunk, 0 by default. For every other event the venue is `null`, and the
    viewer builds and plays it as before;
  - `app/src/judges.js`: `buildJudges(…, lift)` raises the jury onto a dais, 0 by default.
- The page's server, `arena/duel_watch.py`, stands apart from `arena/web` as the workshop's does:
  no OAuth, no store, never deployed. It answers GETs of the match it played and nothing else.

## Rules

- Two decks, 2.0 × 0.8 m, face each other across a pit 0.5 m wide and 0.6 m deep. Each deck has a
  0.15 m wall along both sides.
- Duck k stands on deck k, its trunk 0.25 m from the pit's edge, its back to the pit. A rope joins
  two harness sites, 2.5 cm above each trunk's origin and 1.0 m apart at the start. The rope has
  1.5 cm of slack. It is a cap, not a spring: the ducks can close in freely, but cannot get any
  further apart.
- Both ducks settle for 0.5 s, untimed, asked to stand still, and each is held on its mark: its
  trunk held where the reset put it, its legs free and its policy running. At the horn both are let
  go, to drop onto their feet as every run's reset drops a duck, and asked the same command:
  0.3 m/s straight on, away from the pit. Walking is pulling.
- After every control step (0.02 s) the referee looks. A simulation that MuJoCo had to reset is
  void, and a void bout is a draw. A trunk 0.10 m below the decks is in the pit, and its duck has
  lost. A duck that is down has lost too, by every event's fall rule: its trunk tilted past 60°
  (projected gravity's z above −0.5) for 0.3 s in a row, counted from the horn. Two losers at once
  is a draw.
- At the bell (20 s), a bout that nobody has lost goes to the duck that has pulled the rope's middle
  more than 5 cm its way. Otherwise it is a draw.
- A match plays every seed (1, 2, 3) twice, the policies swapping decks. A won bout is a point and
  a drawn bout half a point each, so a match is out of 6.
- A round robin plays every pair once. The table counts bouts: most points first, then most wins,
  then by name.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **One against one, and the loser goes down** | A bout ends the moment a duck is in the pit or down, so nearly every result is a fall anyone can see: 328 of the 330 bouts measured between different policies ended before the bell. A won, drawn or lost result fits a league table, a challenge-the-champion ladder or an Elo rating. Rules out teams for now. |
| **Going down loses, by the Arena's own fall rule** | Every event ends a run when its trunk's projected gravity's z stays above `fall_gravity_z` for `fall_hold_s` (`[termination]`: −0.5 for 0.3 s in all four), and the duel declares the same table with the same numbers, counted as `arena.runner` counts them. A duck lying on its deck is beaten, whichever way it fell. Measured with only the pit counting: the same ranking but for the last two places, and 41 of 126 bouts went to the bell rather than 2. Rules out a fallen duck staying in the bout, to be dragged in or not. |
| **The duel reaches a policy only through its command and its body** | Both ducks are asked to walk straight on, and they feel the rope through their trunks. The 61-D observation is unchanged, so every published policy can enter as it is. Rules out observing the rope, the pit or the opponent, and retraining for the format. |
| **Held on its mark until the horn** | Asked to stand through the settle, a policy that does not listen walks off before the clock starts. Measured without the hold: the leaders' trunks walked 11–14 cm away from the pit in the 0.5 s settle, the rope taut, dragging their rival towards it, while the reference stayed on its mark. At the horn the leaders pulled the reference into the pit in 0.30–0.48 s; they ranked first and second of seven, and the reference sixth. Held, both ducks meet the clock on their marks, the rope as long as it started. What it costs the leaders: let go at the horn, they go down within 0.66 s, whoever they meet. Rules out a bout decided before its clock starts, by whoever ignores the command to stand. |
| **One command for both, fixed by the duel** | A faster pull wins, up to the pace a walk can hold. Measured: the reference asked 0.4 m/s beats itself asked 0.3 m/s 4–2, its four wins in the pit; asked 0.5 m/s it wins three in the pit and goes down in the other three. If each entry chose its pace, a duel would first be a contest of choices; fixed, it compares the policies. 0.3 m/s is the pace the reference holds: asked 0.4 or 0.5 m/s against itself, it goes down or into the pit in 4 and 6 bouts of 6. |
| **The rope is a limited tendon** | A spatial tendon between the two harness sites, limited to their distance at the start plus the slack. MuJoCo applies a force only at the limit, so slack costs nothing and a taut rope pulls along its own line. The limit's time constant (22 ms, `solref`) makes the rope firm without making it rigid. The limit's transition is widened from MuJoCo's 1 mm to 3 mm (`solimp`), so the last of the slack is taken up rather than snapped. The loader refuses a time constant under two physics steps (0.01 s), which MuJoCo would quietly raise to that. Measured with some give instead (5 cm of slack, then a spring of 5 N/m, the cap 0.6 m further on): the same ranking, but the statue, a duck that only holds a pose, won 3 of its 18 bouts against the walkers leaning into the rope. Rules out a rope of bodies and joints, which is heavier to simulate and adds contacts. |
| **The harness is on the trunk** | Every rig has a trunk, and every policy feels the trunk's motion in its observation. Rules out tying the rope to a leg or the head. |
| **Back to the pit, 0.25 m from its edge** | Walking straight on is pulling, so a walker needs no new command to play. From 0.25 m, a duck pulled off balance goes in: 32 of the 36 bouts measured between walkers ended in the pit. From 1.0 m, with the same 20 s bell, 26 of those 36 went to the bell. |
| **Walls along the decks' sides** | Without them, 7 of the 36 bouts between walkers ended with the loser dropping off the side of its deck rather than into the pit, at 4.4–18.0 s, all in matches of the walker that leans furthest. A bout is lost to the pull, not to a drift sideways. |
| **Each seed from both decks** | The decks are not alike: each duck draws its start perturbation and its servo delays from its own slot's random streams (`arena.runner._streams`). The reference against itself draws every seed at the bell, but puller-5 against itself wins every seed from deck 1, at the bell by 5.1–10.7 cm; puller-8 wins two seeds from deck 1 and draws the third, and puller-10 wins two from deck 0 and one from deck 1. Playing every seed twice, the policies swapping decks, leaves neither with the luckier slot: each of the four walkers scores 3–3 against itself. |
| **A void bout is a draw** | A simulation that MuJoCo had to reset leaves nothing to judge, and nobody can say whose fault it was. None of the 354 bouts measured was void. |
| **Points by the bout** | The table counts bouts (won, drawn, lost) rather than matches, so a 4–2 and a 6–0 are not worth the same. |
| **A 20 s bell and a 5 cm margin** | Between walkers, the last bout decided in the pit ended at 17.6 s, and the last decided by a duck going down at 18.4 s. Few bouts reach the bell: 2 of the 330 between different policies, won by 10.1 and 15.5 cm. Of the walkers against themselves, the bouts drawn at the bell ended within 4.6 cm of the middle, and those won at the bell 5.1 cm or more from it. |

## What was measured

The duel as shipped, on a Mac (Darwin-arm64) with MuJoCo 3.10.0 and onnxruntime 1.24.4: a round
robin of eleven entrants (55 matches, 330 bouts), and each walker against itself (4 matches, 24
bouts). It took 26 s of wall time for 1,133 s simulated, about 0.023 s a simulated second, so a
match whose six bouts all go to the bell takes under 3 s. The entrants:

- the reference walker (`BEST_alpha_walking.onnx`, the golden run's policy);
- *puller-5*, *puller-8* and *puller-10*: the reference walker shown its projected gravity tilted
  5°, 8° or 10° nose-up, so that it stands that much further forward, into the rope. Probes of
  what leaning does, built in memory for the measurement: they are not files, and not in this PR;
- *statue*, *lie-down* and *crouch*: ducks that never step, holding a fixed pose: the default one,
  or one of two folded poses that take them down onto the deck within a second;
- two policies from near the top of the sprint board (0.860 s, *sprint-a* and *sprint-b*) and two
  from near the top of the hill board (0.780 s, *hill-a* and *hill-b*).

| # | Entrant | Won | Drawn | Lost | Points |
| --- | --- | --- | --- | --- | --- |
| 1 | puller-10 | 58 | 0 | 2 | 58 |
| 2 | puller-8 | 56 | 0 | 4 | 56 |
| 3 | puller-5 | 48 | 0 | 12 | 48 |
| 4 | reference | 42 | 0 | 18 | 42 |
| 5 | statue | 36 | 0 | 24 | 36 |
| 6 | lie-down | 30 | 0 | 30 | 30 |
| 7 | crouch | 20 | 2 | 38 | 21 |
| 8 | sprint-b | 9 | 3 | 48 | 10.5 |
| 9 | hill-a | 8 | 4 | 48 | 10 |
| 10 | hill-b | 8 | 4 | 48 | 10 |
| 11 | sprint-a | 7 | 3 | 50 | 8.5 |

- Of the 330 bouts, 32 ended in the pit, 296 with a duck down and 2 at the bell. None was void.
- Walker against walker (36 bouts): 32 in the pit, at 3.3–17.6 s; 2 with a duck down, at 7.8 and
  18.4 s; 2 won at the bell. The walker that leans further won 34 of the 36. Every bout against
  the reference went to its rival, the reference into the pit at 3.3–8.3 s.
- Walker against pose (72 bouts): the walker won every one. The statue is pulled over at
  1.0–2.2 s; the folded poses go down by themselves sooner. Among the poses, the statue beats both
  folded ones 6–0, and lie-down beats crouch 6–0.
- The leaders go down 0.52–0.66 s after the horn, the fall rule's 0.3 s included, whoever they
  meet. They lose all 96 of their bouts against the walkers, and 68 of their 72 against the poses:
  they win 2 and draw 2 against crouch, which goes down as soon. Between leaders, a bout goes to
  whichever goes down later, or is drawn when both are called at once.
- Each walker against itself scores 3–3.

A match from the shell, between two of the published files, renamed:

```
$ arena duel sprint-a.onnx reference.onnx
Tug of War: seeds 1, 2, 3, each played from both decks; the bell at 20 s
seed 1  sprint-a | reference  reference won: sprint-a went down at 0.52 s
seed 1  reference | sprint-a  reference won: sprint-a went down at 0.54 s
seed 2  sprint-a | reference  reference won: sprint-a went down at 0.64 s
seed 2  reference | sprint-a  reference won: sprint-a went down at 0.66 s
seed 3  sprint-a | reference  reference won: sprint-a went down at 0.56 s
seed 3  reference | sprint-a  reference won: sprint-a went down at 0.52 s
sprint-a 0–6 reference
```

A round robin of the five published files:

```
$ arena duel reference.onnx sprint-a.onnx sprint-b.onnx hill-a.onnx hill-b.onnx
Tug of War: seeds 1, 2, 3, each played from both decks; the bell at 20 s
reference 6–0 sprint-a
reference 6–0 sprint-b
reference 6–0 hill-a
reference 6–0 hill-b
sprint-a 2–4 sprint-b
sprint-a 2.5–3.5 hill-a
sprint-a 2.5–3.5 hill-b
sprint-b 2.5–3.5 hill-a
sprint-b 2.5–3.5 hill-b
hill-a 3–3 hill-b

 #  policy     won  drawn  lost  points
 1  reference   24      0     0      24
 2  hill-a       8      4    12      10
 3  hill-b       8      4    12      10
 4  sprint-b     8      2    14       9
 5  sprint-a     6      2    16       7
```

**The levers**, each changed alone from the duel as shipped, on the same Mac, in a field of seven
(the reference, the three pullers, the statue, sprint-a and hill-a: 21 matches, 126 bouts), with
the reference and puller-10 each against itself. As shipped, that field ranks puller-10, puller-8,
puller-5, the reference, the statue, hill-a and sprint-a; its bouts end 32 in the pit, 92 with a
duck down and 2 at the bell, and those between walkers 32 in the pit, 2 down and 2 at the bell.

| Change | What happened |
| --- | --- |
| Only the pit loses (no fall rule) | The same ranking but for the last two, which swap. 85 bouts in the pit and 41 at the bell. The reference still beats the statue 6–0, five of the six at the bell. Between walkers: 33 in the pit, 3 at the bell. |
| No hold | sprint-a first and hill-a second, then puller-10, puller-8, puller-5, the reference and the statue. The leaders pull the reference into the pit at 0.30–0.48 s, and puller-10 in 11 bouts of 12 at 0.46–1.12 s; the statue, tipped over before the clock starts, is called down at 0.30–0.34 s. The reference against itself: six bouts drawn at the bell. |
| A rope with give: 5 cm of slack, then a spring of 5 N/m, the cap 0.6 m further on | The same ranking. Between walkers: 23 in the pit, 10 with a duck down and 3 at the bell, 3 of the 36 drawn. The statue beats puller-5 in 2 bouts and puller-8 in 1. The reference against itself: a duck down at 12.3 and at 17.6 s, and both down at 19.8 s. |
| Both asked 0.4 m/s | puller-8 first, a point ahead of puller-10. Between walkers: 29 in the pit, 6 with a duck down, 1 at the bell. The reference against itself: a duck down in 4 bouts, and 2 won at the bell. |
| Both asked 0.5 m/s | puller-8 first, two points ahead of puller-10. Between walkers: 26 in the pit and 10 with a duck down, the last at 13.2 s. The reference against itself: all six decided before the bell, 4 by a duck down and 2 in the pit. |
| The reference asked 0.4 m/s against itself asked 0.3 m/s | The faster won 4–2: four in the pit, at 10.7–14.1 s; in the other two it went down. |
| The reference asked 0.5 m/s against itself asked 0.3 m/s | 3–3: the faster won three in the pit, at 7.8–9.2 s, and went down in the other three. |
| No walls | puller-8 and puller-10 level on points. Between walkers: all 36 in the pit, the last at 18.0 s, and in 7 of them the loser dropped off the side of its deck. |
| Setback 1.0 m, the bell still at 20 s | The same ranking. Between walkers: 26 at the bell (4 drawn), 7 in the pit and 3 with a duck down. The reference against itself: 2 bouts won at the bell, and 4 with a duck down, at 15.4 and 19.8 s. |

**One platform.** These numbers are from a Mac. Physics on two platforms part ways within a few
seconds, as `arena/golden.py` records for the sprint, so a bout that lasts seconds can end
differently on Linux-x86_64, the Space's platform. This duel before the hold and the fall rule was
played on both: the falls that came within half a second were the same, the longer bouts between
leaders were not. This version has not been played on Linux-x86_64. A board would play all its
matches on one platform, the Space's.

## Design

### 1. The format: `arena/duels/<id>.toml` (`load_duel`, `load_duel_by_id`)

- Top level: `id`, `title`, `rig`, `kind`, `time_limit_s` (the bell) and `seeds`. Then
  `[command]` (as an event's), `[start]` (`keyframe`, `settle_s`, `setback_m` and
  `[start.perturbation]`), `[decks]`, `[rope]`, `[referee]` and `[termination]` (as an event's).
- Validation, each refusal a `ManifestError` naming the file:
  - every table is a table, and unknown keys are refused at every level;
  - `id` is a non-empty name, `rig` and `kind` are among a manifest's, and `seeds` is a non-empty
    list of distinct whole numbers;
  - `fall_gravity_z` is a number strictly between −1 and 1, a projected gravity's z, and
    `fall_hold_s` is at least one control step (0.02 s);
  - every other number is finite and positive. A wall height, the slack, the harness height, the
    margin, the settle and the perturbation may be zero. A boolean is not a number;
  - the setback is shorter than the decks, or a duck starts off its own deck;
  - the rope's time constant is at least two physics steps;
  - the pit is deeper than the referee's drop plus a standing duck (0.12 m), or a duck could stand
    in the pit unseen.
- A `Duel` carries a `manifest.Start`, read by `arena.runner._start` exactly as an event's is, and
  a `manifest.Termination`. `_start` reads nothing else of a manifest but its `id`, which names the
  random streams.

### 2. The model (`compile_duel`)

- Duck 0 is the rig's MJCF with its servos as motors, as a troupe's first duck is
  (`arena.course.compile_stage`). The model has the physics step, a floor 0.6 m down in the pit,
  and the decks and walls from `deck_boxes()`. That one function serves the physics and whatever
  draws the decks, as `arena.course.wall_boxes` does for a stage.
- Duck 1 is the same rig, attached under its prefix on deck 1. Duck 0 faces -x and duck 1 faces +x.
- A `harness` site on each trunk, and the tendon `rope` between them: range `[0, start distance +
  slack]`, `solref_limit = (timeconst_s, 1)`, `solimp_limit = ROPE_SOLIMP`.
- A `mark` for each duck, a mocap body with no geom (nothing to hit or see), and a weld `hold`
  from the duck's trunk to its mark, off until the opening switches it on.
- The keyframe stands both ducks on their decks in the default pose.

### 3. The bout (`play_bout`)

- The opening (`_opening`) is every run's: `arena.runner._start` with no settle, so training's
  reset and each slot's perturbation and servo delays. Each duck's mark is put where its trunk is
  and its `hold` switched on. The settle is then stepped as `_start` steps one, both ducks asked
  to stand (the command's twist zeroed), their policies running. At the horn the holds are
  switched off.
- Then (`_referee`), every control step: both ducks are asked the duel's command, and the referee
  checks for a void, then for a trunk in the pit, then the fall rule: projected gravity's z above
  `fall_gravity_z` for `round(fall_hold_s / 0.02)` control steps in a row, as `arena.runner`
  counts it, from the first timed step. A duck in the pit or down has lost, and two at once is a
  draw. At the bell, the rope's middle decides.
- `Bout(seed, winner, end, time_s, rope_mid_m)`: the winner is a deck (or `None`), and `end` is
  `"pit"`, `"fall"`, `"bell"` or `"void"`. A bout lost in the pit ends `"pit"`, and one lost by a
  duck down `"fall"`; a draw between two losers ends `"pit"` only if both are in the pit.

### 4. The match, the round robin and the table

- `play_match(duel, a, b)` plays every seed from both decks on one compiled model. `Played.winner`
  turns a deck into A or B, and `Match.points` counts a win as 1 and a draw as ½.
- `round_robin(duel, policies)` plays every pair once, on one model.
- `standings(names, matches)` counts won, drawn and lost bouts, and sorts by points, then wins,
  then name.

### 5. The shell (`arena duel`)

- Two policies: a line per bout (who stood on which deck, and how the bout ended: a duck off its
  deck, a duck down, at the bell, or void), then the score.
- Three or more: each match's score, then the table.
- Fewer than two is refused. `--duel` picks a duel from `arena/duels/` (default: `tug-of-war`).
  Two files with the same name are told apart by their position.

### 6. Watching a match (`arena duel A B --watch`)

- Two policies only, and the port (`--port`, 8766 by default) must be free before the match is
  played. The match is played and printed as without `--watch`, then served on 127.0.0.1 until
  Ctrl-C. A browser opens on it unless `--no-browser` is given.
- `record_match` is `play_match` with every bout recorded (`record_bout`). A recorded bout is
  `play_bout`'s: the same opening and the same referee, which appends each step it judges as a
  frame, as a run's trace keeps it (`TRACE_WIDTH` per duck). Reading the physics writes none of
  it, so the bout is the same recorded or not. `Recorded` holds the bout, its settle's frames and
  its trace. A bout lost in the pit or by a duck down runs on for `TAIL_S` (1.5 s), both ducks
  still asked to pull, so a replay shows the loser land and what becomes of the winner. The tail
  stops if the simulation diverges, and a void bout keeps nothing of MuJoCo's reset pose.
- `arena/duel_watch.py` (`create_duel_app`) answers from memory:
  - `/api/duel`: the duel, its course as built (the fall rule's hold among it), the two names, the
    points, and each bout (its seed, who stood on each deck, the winner, how and when it ended,
    the rope's middle, and how many frames it has);
  - `/api/duel/bouts/{k}/trace` and `/api/duel/bouts/{k}/settle`: the frames, as every trace is
    served (`routes_read.frames_response`);
  - `/`: `duel.html`, from the built site that `web.config.default_frontend` finds, so it works
    from a checkout once `npm run build` has run, and from a wheel. Without a build, `/` answers
    503 and says how to build it.
- The venue (`app/src/duel-venue.js`) is drawn from the course the server describes, where the
  physics has it: the decks' tops and inner edges, the walls' height and thickness, the harness on
  each trunk. The pit's floor is the hall's, so the decks stand on legs, over a mat in the pit.
  The legs are under the outer half of each deck only: a fallen duck the rope drags under its
  rival's deck passes through nothing. The rope is a tube 7 mm in radius, in pale hemp, between
  the two harnesses. It is straight when taut, hangs as a parabola no deeper than 25 cm when
  slack, and a pink ribbon marks its middle. The jury sits on a dais as high as the decks.
- The camera stands square to the pit, 2.1 m out and 0.5 m above the decks, while a bout's ducks
  keep to the middle of the course. A bout whose ducks go farther (`boutSpan` in `duel/bouts.js`:
  the farthest either trunk goes each way, settle and tail included) is framed from over the
  middle of that span, the camera moved back along its line of sight until the span, and 0.3 m
  beyond each end, fits the stage's narrowest picture: 1.2 wide for 1 high, through the viewer's
  42°. A drag lets it go, and "Back to ringside" brings it back. The crowd rises at the horn, then
  cheers a win or mourns a bout both ducks lost.
- The page (`app/duel.html`, `app/src/duel/`, `app/public/duel.css`) is the Arena's trackside
  frame. On the left is the stage, under the duel's name and facts, with the bout's clock. On the
  right are the match points in the scoreboard's flip tiles, the bouts (who stood on which deck,
  and how each ended), Pause and Replay bout, and the rule in a line: a duck that drops off its
  deck, or stays down 0.3 s, loses the bout. The bouts play in order, the next 2.5 s after the
  last has ended, until the visitor picks one or pauses.
- Once a bout is decided, the stage says so:
  - a "Wins" stamp in the winner's colour over its head, clear of its nameplate and of the clock;
  - or a "Draw" or "Void" stamp over the pit;
  - and the verdict in full, opposite the clock: who won and how (the loser fell into the pit or
    went down, or the bell), or that both fell in or both went down.

  On a phone, the clock and the verdict shrink, and the written verdict is hidden while a stamp
  shows. Screen readers still read it, and the bout's row says the same.

## Testing

**pytest** (`tests/test_duel.py`, 68 tests):

- the shipped duel loads with what it declares, and is not an event; its fall rule is every
  event's, the same numbers in all four;
- every malformed duel is refused, with its message: unknown keys at every level, a missing table,
  a value where a table belongs, a number that is zero, negative, not finite or a boolean, an empty
  or duplicated seed list, an unknown rig or kind, an empty keyframe, a command of the wrong length,
  a setback longer than the decks, a rope time constant under two physics steps, a pit too
  shallow, a missing `[termination]` or one with an unknown key, a fall line of −1, a boolean or
  not a number, and a fall hold of zero or under one control step;
- the model: two ducks, the decks where `deck_boxes` puts them, the walls (none when their height
  is 0), and the rope's limit;
- the start: each duck on its deck, its back to the pit, and the rope at its starting length, short
  of its limit by the slack;
- the hold: two walkers deaf to the command to stand, which unheld have the rope past its limit by
  the end of the settle, meet the clock on their marks with the rope at its starting length, and
  the holds are off for the bout;
- the bout: deterministic; a duck placed over the pit, let go at the horn, is called in the pit
  after a free fall's time; two in the pit is a draw; a duck that lies down on its deck loses once the fall rule has held, and two
  that do draw; a longer hold calls the same fall later by the difference, and a fall line the
  lying duck is not past never calls it; at the bell, both ducks placed 10 cm towards one deck
  give that deck the win, and centred they draw; a simulation MuJoCo resets is void; a bout takes
  exactly two policies;
- the match: every seed from both decks, the winner named as the match names them, and the points;
- the table: every bout counted, and ties broken on wins, then name;
- the shell: each way a bout ends, said as the shell says it; a match prints every bout and the
  score, three policies print a table, and fewer than two policies or an unknown duel are refused;
- the recording: a recorded match is the match played, a frame for every step judged; a bout lost
  in the pit or by a duck down runs on for the tail past the frame it was decided on, and a duck
  that fell in ends the tail deep in the pit; a void bout keeps no frame;
- watching: the server answers the summary, the fall rule's hold among the course, both kinds of
  frames for every bout (exactly as recorded) and the page, and 404 for a bout the match does not
  have; unbuilt, the page says how to build it; `--watch` plays the match, prints it and serves
  it; it refuses three policies and a busy port.

**vitest** (`app/`):

- the venue (`duel-venue.test.js`): the layout; the rope's sag; the decks, their legs and the
  jury's dais as built; the camera, at ringside and for a bout that crosses the decks; the rope
  tied between the harnesses, slack, taut and following a duck into the pit; the crowd's
  direction, a bout both ducks lost mourned; and everything built disposed of;
- the page (`duel/bouts.test.js`): each bout as the viewer's event and lanes, the span its ducks
  cover, its clock, and what the referee said of it, a duck down included; and
  (`duel/hall.test.js`) its frame as DOM: the strip, the duel's name and facts, the rule, the
  scoreboard, the bouts, the clock, stamp and verdict, the way back to ringside, and the transport;
- the jury on its dais (`judges.test.js`).

The app's whole suite passes: 866 tests in 80 files.

The rest of the suite runs as it did. No bout in these tests lasts much more than a second, and the
recorded ones run on for their 1.5 s tail: they use the reference walker,
that walker deaf to its command, or a policy that holds the default pose or lies down, on a duel
cut short or set up to end at once. None asserts how a full bout between real policies ends, since
the platforms' physics part ways.

## Left to the owner

- **The board's format.** Options:
  - a perpetual league, where each new entry plays every other: 6 bouts a match, under 3 s a match
    on a Mac, so about 5 minutes for a new entry against 100;
  - a ladder, where an entry challenges the champion or the entry above it;
  - an Elo rating from a sample of matches;
  - a gauntlet against fixed opponents;
  - a round of its own.

  A full round robin of n entries is n(n−1)/2 matches.
- **Whether each entry may choose its command.** Measured above: a faster pull wins, up to the pace
  its walk can hold.
- **The hold.** Today each duck is held on its mark through the settle, so the bout starts at the
  horn; the policies that do not stand when asked to then go down within 0.66 s of it. The
  alternatives: no hold, and the bout is decided before its clock by whoever walks off first; or no
  hold, and a duck that leaves its mark during the settle loses, as a false start.
- **The rope and the start.** A rope with some give (measured: a duck that only holds a pose then
  sometimes beats a walker), a lower or higher harness, a longer setback (more bouts decided on
  points), or a longer bell: the last bout between walkers ended at 18.4 s.
- **Tie-breaks.** By name today; head-to-head, the rope's middle or a play-off would be fairer.
- **Integration.** `compile_duel` beside `compile_stage` in `arena/course.py`, and the bout beside
  `run_stage` in `arena/runner.py`, with a two-duck trace (a stage's trace already records several
  ducks). Then records, a board, the duel's page played from those records rather than from
  `--watch`, a clip of both ducks and the rope, the commentary, and a worker that plays the
  matches as entries arrive.
- **One platform.** Physics differs between platforms, so a board must play all its bouts on one
  platform (the Space's), or a rematch could disagree with the result on the board.

## Out of scope

- Teams, with several ducks a side.
- New observations: a policy never sees the rope, the pit or its opponent.
- Rollers: the duel is declared, and was measured, on legs.
- The site: records, boards and clips. The duel's page plays only what `arena duel --watch` serves
  on 127.0.0.1.
- Real robots.
