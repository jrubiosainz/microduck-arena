# Versus: the tug of war and the weekly cup — design (2026-10-19)

## Why

The owner, 2026-10-19: the Arena gets a new kind of challenge, the **versus**. Ducks from several
players, each driven by its own published policy, meet in the same physics at the same time. The
first versus is a **tug of war**: two microducks face each other, tied by a string at the base of
the neck, with a pit between them. The one that does not fall in the pit wins.

Two things make a versus hard, and they shape this whole design:

- **Who plays whom.** Ranking every policy against every other is N·(N−1)/2 matches: about 300
  for the ~25 players on the races today, ~5,000 for the ~100 policies. The physics is cheap
  enough; the clips (one HF Job each) and the time to watch are not.
- **Chaos.** A 1 µm change of a start turns one run into another (measured on the rollers,
  2026-10-14). Between two close policies, one bout is close to a coin flip, and a Mac never
  reproduces the Space's x86 numbers.

The owner's answer, refined in this session: a **rating** every policy gets on its own the moment
it is published (the pulling bench), and a **weekly cup** in which the entrants meet in groups
then a knockout, simulated ahead and premiered on the live channel, where Peter & Ray call every
match like a real sports broadcast.

## Words

- **Versus event**: an event whose entries meet each other. `tug-of-war` is the first.
- **Bout**: one tug of war between two ducks, up to the bout time limit.
- **Match**: first to win two bouts, sides swapped between bouts.
- **Pulling bench**: a solo test. One duck on the tug course, the string running across the pit
  to a winch instead of an opponent. It gives the policy its **rating**, in newtons.
- **Cup**: one weekly tournament of the event, numbered (#1, #2…): draw, groups, knockout,
  premiere.
- **Premiere**: the scheduled moment the cup's results go public, as the live channel's show.

## Goals

1. Any player can train a tug-of-war policy with the challenge recipe, publish it with
   `uv run publish --enter`, and get within minutes a rating, a board place, points and a clip,
   exactly like a race today.
2. Every week, every player's latest entry is in a cup automatically, plays at least two matches,
   and every match has its clip.
3. The cup is a show: at a fixed time the live channel airs the whole cup, every match in full,
   Peter & Ray at the desk with the cup's state on a big screen behind them, calling each match as
   it plays, with commentary that knows the tournament.
4. The cup machinery (calendar, draw, groups, knockout, secrecy, premiere, cup page) is generic to
   versus events; what is specific to the tug of war (string, pit, judge, bench) is the event's.

## Non-goals

- Policies that perceive their opponent (sumo, football…). A tug policy is blind, as every Arena
  policy is today: proprioception and a fixed command. A future versus that needs perception will
  change the observation contract; not now.
- Self-play training. The recipe trains against a winch.
- Rollers. Pollen's roller reference can neither brake nor reverse; the event is `rig = "legs"`.
- A time limit on the show. The owner: "no limit; we'll set one later when it becomes a problem."
- A Pollen reference in the cups. There is none (owner's decision, below).
- Another versus challenge, or a recurring-automatic anything beyond the weekly cup.

## Anti-goals

- A cup whose results leak before the premiere (an API answer, a clip URL, a board change, a
  commentary line): the premiere is the event.
- A live show that stalls or improvises: nothing on air waits for an LLM or a render.
- A rating or a cup result computed anywhere but on x86 (the Space, or an x86 HF Job running the
  Space's image). Never re-score on the Mac: a Mac re-race diverges from the Space after 1–3 s.
- A training environment whose string, pit or winch differs from the Arena's. Every physics
  difference between training and the Arena has cost a retrain before (the BAM lesson, 2026-09-28).
- Changing any existing event's physics: the golden run and every published run stay as they are.

## Constraints

- The site, code, docs, clips and commentary are English only.
- Events are data (`arena/events/*.toml`, strict loud validation in `arena/manifest.py`).
- Clips render only on HF Jobs (t4-small, at most `ARENA_CLIP_JOBS` in flight, pending markers as
  the to-do list); the Space renders nothing.
- The run log is the private dataset `ARENA_DATASET`; a Space restart rebuilds everything from it.
- The physics is MuJoCo through the troupe machinery (`compile_stage`, `run_stage`, `cast_of`):
  several robots in one model, prefixed `duck{k}/`, colliding with each other. Lone-duck runs stay
  bit-identical.
- Booth commentary is never gated by a script filter; bad lines are fixed in the prompt
  (owner, 2026-10-12). Jokes must land for newcomers.
- No dead code, no just-in-case generality.

## 1. The tug of war (owner-decided scene, builder-tuned numbers)

**Course: the race lane, cut by a pit** (owner chose layout "A" over floating platforms and an
open ring). The lane is the races' 0.8 m lane with its 0.15 m walls, with a pit across its whole
width in the middle. The walls are there so that drift, which blind policies have, cannot decide a
bout: only pulling does.

**Ducks: face to face, like a real tug of war** (owner). Each pulls by walking backwards. The
existing walking policies cannot compete; every entrant trains a new policy.

**String**: from the base of one duck's neck to the base of the other's, taut at the start, with a
red marker at its middle. Initial values, the builder tunes them on the first trained policy:
string ≈ 1.0 m, pit 0.3 m wide and deep enough that a duck in it is unmistakably below the floor.
A MuJoCo spatial tendon with a maximum length behaves as a string (it pulls only when taut). The
string and the marker are drawn by the viewer from the trace.

**Command**: the Arena sends every duck the same fixed command, declared in the event's
`[command]` like any event; its value is the one the training recipe uses. There is no speed
sweep in a versus.

**Judge** (my call on the details):

- The first duck in the pit loses the bout: a duck is in when its trunk goes below the floor level
  over the pit. **Only the pit decides** (owner, 2026-10-20, evening): a duck knocked over, sitting
  or lying on the platform stays in play and can still be dragged in. An earlier rule ("a fall
  loses") was tried and removed the same day: the first trained policies then dived face-down just
  under the fall line and held by friction anyway; the owner's ruling is that going down to hold
  is a viable strategy, and the point of the game is to drag the opponent into the pit.
- At the bout time limit (20 s to start with), if nobody is in the pit, the duck the marker moved
  away from loses: as in a real tug of war, the winner pulls the marker to their side of the pit's
  centre line.
- Both in the pit on the same control step: the marker's side decides. A marker exactly back at the
  centre makes a drawn bout, which counts for nobody; the match goes on (at most five bouts), and a
  match still undecided after them goes to more bouts won, then the higher rating. (A rule that
  never needs a replay.)

**Match** (my call): first to two bouts, sides swapped after each bout. Each bout's seed derives
from the cup's secret (section 4), the match and the bout, so a whole cup replays identically on
x86.

## 2. The pulling bench: the rating (owner chose it over a sparring match)

The event's own board is a rating, like a race's time, so everything the races have works for it
unchanged: entry, five seeds, board, points, clip, live rotation, commentary.

- **Setting**: the tug course, one duck, the string crossing the pit to a **winch**: an anchor on
  a slide past the far edge, driven by a force that ramps up, with small seeded jerks so it pulls
  like an opponent rather than a machine.
- **Score per seed**: the string force the duck was holding when it entered the pit. A duck still
  out of the pit at the end of the ramp, standing or not, scores the ramp's top. The force never
  exceeds the top (the jerks are clamped), so being dragged in is never worth more than holding.
- **Rating**: the mean over five seeds, in newtons; higher is better (a new metric, the first one
  where higher wins — every sort that assumes "lower is better" must learn the direction).
- **Clip**: the duck against the winch, with a dial showing the newtons rising. Landscape and
  vertical, on the HF Job, like every run.
- **What it is not**: a winch is not an opponent; a policy strong against a steady pull may be
  fragile against another duck's jolts. The rating says who is strong; the cup says who wins.
- Ramp rate, top force, jerk size: the builder's, set on the first trained policy so that the
  ratings spread out instead of all landing at the top or at zero.

## 3. Training, and the first candidate

- A `tug_of_war` challenge in `microduck-challenges` (the usual folder: `env.py`,
  `challenge.toml`, `tasks.py`, `rewards.py` if it needs its own terms). The duck trains against
  **the bench's own winch**: the same string, the same attach point, the same pit and lane, the
  same force-profile family, randomised. The event's fixed command is the command it trains on.
- The workshop's Test step measures the bench locally (an indicative rating: a Mac is not the
  Space).
- **No Pollen reference** (owner). We train one policy with the recipe and the owner publishes it
  **under his own name (Nico-robot) as the first candidate**. It is an ordinary entry.

## 4. The weekly cup

**Calendar** (owner: weekly; the slot is my call, set in the event file): premiere every Friday at
18:00 Europe/Paris, entries close at 16:00. The two hours let the Space simulate the cup, the
HF Jobs render its clips and the writer write the show.

**Entrants**: owner-approved — publishing on the event is entering the cup. At close, each player's
latest non-withdrawn entry on the current runner version is their duck for that cup; a player who
publishes nothing new plays again with the same duck. One duck per player. Fewer than 4 entrants:
no cup that week, and the page says so.

**Withdrawals** (owner approved my recommendation): an entry withdrawn before close is not in the
cup. Once the cup is drawn it is frozen: a withdrawal between close and premiere, or after, changes
nothing in it — no recomputation, no forfeit, its matches stay on the page, the live and in the
points, like a sports result. The board and the live rotation outside the cup keep today's
withdrawal rules.

**The cup's secret** (my call): at close, the Space draws a random secret and stores it with the
cup in the private dataset. The draw and every bout seed derive from it. Before the premiere nobody
can compute the cup on their own x86 machine from the public code, policies and entrant list, and
no player can tune a checkpoint against known seeds before close. Once the final has aired, the
secret is published with the results, so anyone can re-race the cup on x86.

**Draw** (owner's idea, details mine): a random draw from the cup's secret, World-Cup style:
entrants sorted into pots by rating, one per pot in each group.

**Format** (my call): G groups, G the largest power of two that leaves at least three ducks per
group (4–5 entrants → 1 group, 6–11 → 2, 12–23 → 4, 24–47 → 8 …). Every group plays a full round
robin; the top two go through to a knockout of 2G (crossed: a group winner meets another group's
runner-up). Group ranking: matches won, then bouts difference, then head-to-head, then rating.
With 25 entrants: 8 groups of 3–4, ~27 group matches, a 15-match knockout, ~42 clips.

**Computation**: at close, the Space computes the whole cup at once (all group matches, then the
knockout they lead to), records it in the dataset, owes a clip per match, and has the show's
commentary written. A restart during the window resumes from the dataset without changing a
result (every seed and the draw derive from the stored secret).

**The running order** (my call): once everything is ready, the cup gets a running order: every
segment of the show in sequence with its start time, each match's reveal time being the moment its
clip has finished airing (its clip may be loaded from 30 s before it starts). In stage 2 the running order is just the match clips back to back from the
premiere; stage 3 inserts the desk segments into the same running order, it does not replace it.

**Revealed match by match, as it airs** (my call, from the owner's "like a real sports live"):
before the premiere, no API answer, board, profile, clip URL or live slot reveals a match result, a
trace or a clip. During the show, a match becomes public — on the cup page, its match page, the
players' profiles — at its reveal time, the moment its clip has finished airing, so a viewer who opens the cup page mid-show sees the cup as
far as it has aired, never the champion before the final. The cup's points land when the final
airs. The dataset is private; the Space serves the cup's state as of "now".

**If something is late** (my call): the premiere waits until every match clip and every line of
the show is ready; until then the page and the live say "starting soon". Cup clip jobs are
relaunched without the usual three-try limit. Cup N+1 never premieres before cup N has. Nothing
airs with a hole in it.

**Points** (my call): the rating board earns what a race board earns today (first event, runs,
own best, podium held). Each cup adds receipts on the podium scale: champion 250, finalist 150,
each semi-finalist 100.

## 5. The cup page

A page per cup, in the Arena's own look (few buttons, only what is needed when it is needed — the
owner's standing direction for new pages), in two states (wireframes shown and accepted in
session, kept locally under `.superpowers/brainstorm/`, `cup-page.html`):

- **Before the premiere**: cup number, close and premiere times, a countdown, the entrants ranked
  by rating, how to enter in one line. Between close and premiere it stays in this state.
- **After**: the champion, the groups with their standings, the knockout bracket; every match
  opens its own page with its clip and its bouts, like a run page today.

The event's card on the home wall shows the next cup's countdown. A player's profile lists their
cup results.

## 6. The show on the live channel

Owner: "during the event Peter & Ray watch each match and comment on it like a real sports live.
Behind the commentators you can see the state of the competition with the entrants and their
progress. They can comment on the tournament with the information they need to be interesting
and in context for the stage the tournament is at." Wireframe accepted in session
(`cup-live.html`, same place).

- **Programme**: from the premiere time, the channel airs the cup and nothing else: an opening
  (the field, the draw, the favourites), then every match in order, group recaps between rounds,
  the knockout, the final, the champion, a close. Every match in full; no time limit.
- **The desk**: during a cup, a big screen on the booth's back wall (in place of the pegboard)
  shows the cup's state as of that moment — groups, then the bracket — with the next match
  highlighted.
- **The match**: its clip full screen with the bouts' score bug; Peter & Ray call it **while it
  plays**, their lines timed to moments found in the bouts' traces (the marker moving, a lead
  changing hands, a slip, a duck at the edge, the drop into the pit), in their droid voices with captions as
  today. This play-by-play is new: today they only talk between clips. It belongs to the live
  page, not to the mp4 (my call: the match clip is a clean clip, like every clip).
- **What the writer knows**: the stage of the cup, the group standings and the bracket, ratings
  (favourite, underdog), every result earlier in this cup, earlier cups (defending champion,
  rematches, streaks), the players' profile facts. Never anything later than the match being
  called: no spoilers.
- **Written ahead**: every line of the show is written during the window between close and
  premiere and stored with the cup. The show plays from the store; it never waits on an LLM.
- **After the premiere**: the cup's match clips join the channel's ordinary rotation until the
  next cup; the bench clips are in the rotation all along, like race clips.

## Delivery: three stages, built in parallel, released together

The owner: the three stages are built in parallel and everything is pushed together at the end.
Stages 2 and 3 do not wait for a good policy: they are developed and tested locally with the
first training's intermediate checkpoints as stand-in entrants. Paid trainings on HF Jobs have no
budget limit (owner).

1. **The tug and the bench.** The course (lane + pit), the string, the winch, the bench event with
   its rating, board, clips and commentary; the `tug_of_war` challenge recipe; the first
   candidate trained and published by the owner. The match itself (two ducks, the judge) is built
   here too, since the cup needs it and the bench shares its course.
2. **The weekly cup.** Calendar, entrants, draw, groups and knockout, computation, secrecy, match
   clips, cup page and match pages, points, the home countdown. Without stage 3, the premiere is
   the moment the page flips and the matches join the live rotation.
3. **The show.** The cup programme on the live, the desk screen, the play-by-play, the writer's
   tournament context.

The release is one push of main (which deploys the Space), then the wheel and the challenges
relock as usual, then the owner publishes the first candidate.

## Decided by the owner (this session)

- The versus concept; the first versus is a tug of war over a pit, string at the base of the neck,
  several players' policies in one physics.
- A dated tournament, draw, groups, then winners against winners (his idea); weekly.
- A rating per model at publication, from the pulling bench, instead of a sparring match.
- Face to face, pulling backwards; every entrant trains a new policy.
- Course A: the race lane with walls, cut by a pit.
- Publishing on the event enters the cup.
- The show: Peter & Ray call every match like a live sport, the cup's state behind them,
  tournament-aware commentary; no time limit for now.
- No Pollen reference in the cups; we train a model and the owner publishes it under his name as
  the first candidate.
- No limit on paid trainings; the three stages are built in parallel (stand-in checkpoints) and
  pushed together at the end.
- Only the pit decides, on the bench and in a bout: a fall does not lose (2026-10-20, evening; it
  reverses the "a fall loses" decision of the same morning).
- The policies must really pull: the recipe is retrained so the ducks walk back and tighten the
  string, judged by bouts that end in the pit, not by the marker's drift (2026-10-20, evening).
- A drawn cup is frozen: withdrawals after close change nothing in it.

## My calls (the owner may object)

- String ≈ 1 m taut, pit 0.3 m, bout limit 20 s, the marker rule, tie-breaks.
- A match's result is revealed when its clip has finished airing (its clip may load 30 s before it
  starts); the knockout bracket keeps group-mates apart until the final; on air, ducks are named by
  their policy names (with the player's handle when two entrants of a cup share one).
- Matches first to two bouts, sides swapped; seeds from cup/match/bout.
- Legs only; a fixed command; no sweep.
- Friday 18:00 Europe/Paris premiere, 16:00 close; no cup under 4 entrants.
- The group-count rule, top two through, crossed knockout, group tie-breaks.
- Points per cup on the podium scale (250 / 150 / 100 per semi-finalist).
- A secret drawn at close seeds the draw and the bouts; published after the final.
- Results revealed match by match as the show airs, from a running order fixed before the
  premiere; points land with the final.
- The premiere waits for every clip and every line; cup clips retried without limit; cup N+1
  never premieres before cup N.
- The play-by-play lives in the page, not in the mp4.
- After the premiere the cup's matches join the rotation until the next cup.

## Left to the builder

- The string, pit, winch and judge numbers, tuned on the first trained policy; the attach body
  for "the base of the neck".
- How a cup, its matches and its show are laid out in the dataset and served by the API.
- The match clip's composition (bouts chained, score bug, intro/outro) within the clip contract.
- How moments are detected in a bout's trace for the play-by-play.
- The cup page's and the desk screen's visuals, within the Arena's look.
- Whether the Space or an x86 HF Job on the Space's image computes the cup, as long as it is x86
  and the result is the same.
