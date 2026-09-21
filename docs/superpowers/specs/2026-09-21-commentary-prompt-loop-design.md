# The commentary's prompt, improved on the air — design

## Goal

The model that judges a dialogue leaves the channel. It was built as a gate and
it behaves like one: on the real router it refuses nine dialogues in ten, and a
gate that closes that often is hiding a prompt that is not good enough. The
prompt is the lever. The judge becomes what it should have been from the start,
a developer's instrument, and it is pointed at the dialogues the real channel
broadcasts.

The loop is the owner's: let the channel run, collect what it says, measure it,
improve the prompt, push, and start again.

This spec amends `2026-09-18-live-commentary-design.md`, which said the prompt
and its audit "stay exactly as they are" and sized the reserve on half its turns
producing nothing; those passages are corrected in place and point here. It also
amends, in `2026-09-17-live-channel-design.md`, the paragraph "Continuity" and
the one after it on `direction(run_id)`, the sentence "Then the audit call
returns…" and the default model under "Provider and configuration".

## What was found

- **The judge refuses almost everything.** Forty-five minutes of local channel
  on `deepseek-ai/DeepSeek-V3.1`: 118 attempts, 2 dialogues kept. 106 refusals
  were the judge's `grounded: false`, 12 were the local checks (9 on a name, 3
  on a number). The reserve hit its hourly cap and fell silent.
- **The writer reads the recent dialogues again.** The channel's own
  measurement, recorded in the 09-17 spec, is that a writer shown the recent
  turns writes the next dialogue in their shape: a fifth to a half of the
  sentences on air were repeats, against two or three in a hundred without
  them. The 09-18 spec nevertheless told the reserve to "give them to the writer
  as the recent wording", and since 89e2af6 every prompt carries the last five
  dialogues, whole, as citable facts beginning "Earlier on the channel". The
  prompt's own rule still speaks of facts beginning "Earlier this season", which
  no longer exist, so it binds nothing. Those five facts also carry other runs'
  numbers and handles, which the local number check accepts once cited.
- **A run draws one shape for ever.** `direction(run_id)` hashes the run, and a
  dialogue is now written per airing: every airing of a run draws the same
  opening, angle, joke, ending and length.
- **The prompt itself prescribes the sameness.** Both character sheets go out
  whole, every time, with the same props in them (the megaphone, the bigger
  bell, the fog machine, the notebook, the trophy shelf). `STYLE` and Ray's
  sheet both script one mechanic: Peter feels, Ray answers the feeling and puts
  a fact on the table. `select_memories` sorts by overlap and then by id, so the
  same kind of run is offered the same two memories.
- **The real channel has no booth at all.** On the Space, on 2026-09-21, every
  router call answered `403 Forbidden`: its `HF_TOKEN` secret may not call
  Inference Providers. The 120 attempts of the hour went in ten minutes and the
  grid held 23 replays and no booth. Behind that, the repository's default
  model, `deepseek-ai/DeepSeek-V3-0324`, is no longer served by the router
  (`400 model_not_supported`).

## The decisions behind it

Taken by the owner before the design:

- **The judge never gates production.** It is a development instrument. The
  local, deterministic checks are not "the audit": they stay, because they are
  what keeps a false number, an unestablished handle or an invented fall off the
  air, and what keeps a dialogue playable by the page.
- **The real site is the bench.** Dialogues are evaluated as the channel
  broadcast them, not as a simulation produced them.
- **The prompt is edited in a session, by a person or by Claude, and every edit
  is measured.** There is no automatic optimiser.
- **Claude drafts the new editorial material, the owner reviews each lot** as a
  diff of the bible before it is committed.
- **"Always the same" means three things:** the same phrases, the same props and
  gags, the same mechanic of the exchange. Not "the same run told the same way".

One principle follows from the channel's own measurements and governs the rest:
**variety comes from the code that assembles the prompt.** It is not asked of the
writer, and the writer is never shown what to avoid.

## The live path without the judge

`write()` ends at its local checks. `AUDIT`, `CHECK_LIMIT`, the second router
call and the verdict leave `arena/` altogether; `usage` is the writer's alone. A
generation costs one router call, not two.

`write()` no longer takes the recent wording and `gather()` no longer returns
it: the judge was its only reader.

**Callbacks.** The writer is given nothing about earlier dialogues unless its
direction draws a callback. Then `gather()` adds exactly one fact, "Earlier this
season: " followed by the result facts of the most recently aired broadcast
about another run — its event, participant, result, board and points, which is
what this fact carried before 89e2af6 — read from that broadcast's brief
(below), with the handles that text prints as its identities. A callback the book cannot serve is no callback,
and the direction says so. The prompt's rule — a callback quotes no number from
that fact — becomes a local check: the numbers and number words of a `recent`
fact are not citable. A figure from another run can therefore not reach the air
under this run's name.

**The model.** `DEFAULT_COMMENTARY_MODEL` becomes `deepseek-ai/DeepSeek-V3.1`,
the served model nearest the one the prompt was tuned on. The loop may change it;
the owner's position is that the prompt, not the model, is the problem.

**The reserve's size.** Measured: the channel consumes a booth about every
fifty seconds, 71 an hour. On a snapshot of the real log, the local checks alone
refuse about four attempts in ten — a number not in the cited facts first, then
a name spoken without the fact that establishes it — which is some 115 attempts
an hour for those 71 booths, a generation now costing one router call and about
2 100 prompt tokens. The cap stays at 120: it is the owner's bound on what the
channel may spend, it sits at the edge rather than half again above, and a booth
short now and then is a state the channel knows how to be in. Bringing the
landing rate up is the loop's first job, and the bench's LANDING block names
what to aim at.

**A refused run waits.** A refusal is the run's own — its facts, its direction —
so trying the same run again at once mostly buys the same refusal. Measured: one
run took 23 of a session's first 41 refusals and was never written, retried
every five seconds for as long as it was the only run with nothing waiting; on
the Space that is the whole hourly cap spent on one run. A refused run is
therefore left out of the reserve's walk for five minutes, the grid's horizon,
and the walk goes on with the others. A run that never lands then costs twelve
attempts an hour at most, and a run that lands two times in three still gets
several tries between two of its airings. A failure that is not the run's own —
a broken tab, a plan the book refuses, the router down — makes nothing wait: it
moves the walk's cursor, as it does today.

## The brief

A broadcast's `dialogue` gains one field beside `turns` and `lore_refs`, which
already records how it was written: `brief`, what the writer was handed.

```json
"brief": {
  "facts": [{ "ref": "run#/result", "kind": "result", "text": "The mean finish time is…" }],
  "direction": { "turns": 5, "opening": "Peter opens mid-thought…", "angle": "…",
                 "joke": "…", "ending": "…", "callback": "…", "player": "…" },
  "model": "deepseek/deepseek-v3.1"
}
```

`facts` is every fact offered, cited or not. `direction` is the draw as data —
each dimension's own sentence — and the prompt's direction paragraph is rendered
from it. `compose()` returns the brief in place of today's `facts` list, which
nothing reads; the reserve and `arena commentary` put it in the dialogue they
hand the book. The book, its file format and `GET /api/live/broadcast/<id>` do
not change: the route already serves the dialogue whole, and the page reads
`turns` and nothing else.

It earns its place three times: the judge reads the facts the writer actually
had, not a later reconstruction; the callback reads its result facts from it;
and the draw reads the recent directions from it to stay away from them.

Nothing is migrated. The book is per process and a Space restart empties it; a
developer's machine empties its broadcasts directory once.

The reserve also says when a dialogue lands — `commentary: <run> written` —
as it already says when one is refused, so that its log is a whole record of its
attempts.

## The instrument

Two scripts in `scripts/`, outside the `arena` package, so that nothing on the
live path can import them.

**`scripts/collect_broadcasts.py <site> <dir>`** polls `<site>/api/live` and, for
every booth slot that has started, by the server's own `now_ms`, fetches its
broadcast once and writes `<at_ms>-<id>.json` with the slot's `at_ms`, the
server's `build` and the broadcast. It sends the
developer's Hub token as a bearer, which is what a private Space requires. It
exists because the book keeps only twenty aired broadcasts, about seventeen
minutes of channel. Only started slots are collected because a future slot may
still be re-laid. It works unchanged against a local `arena serve`, which is how
a prompt edit is tried before it is pushed.

**`scripts/commentary_bench.py <dir>`** reads a collected session in air order
and prints one plain-text report:

- **Phrases.** A sentence of four words or more is a *repeat* when at least half
  of its word 4-grams occur in the twenty dialogues aired before it. A 4-gram a
  dialogue shares with its own brief's facts is the facts', not the writer's,
  and is never counted as heard. The report gives the share of repeated
  sentences and the fifteen 4-grams present in the most dialogues, with their
  counts: the tics, by name.
- **Props.** The writer's own vocabulary: the words of a dialogue that none of
  its brief's facts about the run contain — a memory is not one of those: a prop
  out of the bible is still a prop — a short list of English function words kept
  in the script set aside. The report gives, for the twenty most
  widespread, the share of dialogues they appear in. A bell in four dialogues
  out of five is a prop problem, whether or not the bible names it.
- **Mechanic**, with `--judge <model>`: one router call per dialogue. The judge's
  prompt lives in this script. It returns, for `grounded`, `english` and
  `personalities`, a verdict with the turn at fault and one sentence of why; one
  `scene` label from a closed list kept in the script, naming the mechanic of
  the exchange; and, per dimension of the brief's direction, whether the
  dialogue followed it. The report gives each rate with its reasons listed, the
  distribution of scenes, and the adherence per dimension. Freshness is no
  longer the judge's: the two measures above count it.
- **Landing**, with `--log <file>`: the reserve's own lines — `refused (…)`,
  `not written (…)` — tallied by reason, from the Space's run log or a local
  server's output. This is the measure that sizes the reserve and shows what
  each local check costs, quirks included ("robot" as a name word, "miss" as a
  gendered one, a policy name with an underscore as technical text).

The functions that compute these are pure and unit-tested; the router and the
network are not.

**Reading a session.** At least thirty dialogues, and two sessions before any
conclusion: at twenty samples a rate moves by three on its own. The first
session after the judge leaves is the baseline. A change to the prompt is kept
when it moves the measure it aimed at beyond that noise in both sessions, and
reverted when it does not. The bar for phrases is the channel's own earlier
measurement: two or three repeated sentences in a hundred.

An iteration is a push, a rebuild, and about twenty-five minutes of channel.
Because the book is per process, every deploy starts an empty chain: before and
after separate by themselves, and no version needs stamping on a broadcast.

## The draw, per airing

`direction()` stops hashing the run. Each dialogue draws its own, from a
`random.Random` the caller supplies, and each dimension avoids what the most
recent written broadcasts drew — as many of them as half the dimension's
distinct options, so that a draw stays a draw and never becomes a rotation —
read from their briefs, the way `used_memories` already keeps the bible from
repeating itself. The callback is a coin, one dialogue in four, and avoids
nothing: its odds are its meaning. Written, not aired: the reserve is minutes
ahead of the playhead, and what it is about to say counts.

This goes out after the baseline, as its own push, so that its effect is
measured rather than assumed.

## The deepening, lot by lot

Each lot is one push, measured against the one before. The first three, in
order, aim at what the owner hears:

1. **Scenes**, for the mechanic. The bible gains `scenes`: the kinds of exchange
   these two can have — who leads, what sort of conversation it is. One is drawn
   per airing, like the rest of the direction. The sentences in `STYLE` and in
   Ray's sheet that script a single mechanic come out.
2. **Facets**, for the props. Each character's sheet splits into a `core` —
   voice, the relationship, the rules that never move — and `facets`: habits,
   objects, plans, histories. Two facets a character are drawn per airing, with
   the same cooldown. New facets are written so the pool is wider than today's
   handful of props.
3. **Memories.** Among the memories whose tags meet the facts, the draw is
   random rather than by overlap and then id.

What the loop does not do, because each was measured to backfire: give the
writer example jokes (copied verbatim), grant explicit permissions (they become
tics), list what to avoid (it primes it), or raise the temperature (0.7 increased
the copying and the number words).

Editorial fiction still lives in the bible and only there.

## What stays exactly as it is

The grid and its arithmetic, the book's retention, the reserve's browser, the
plan page, the booth, every local check but the one on a recent fact's numbers,
and the rule that a refusal costs a booth and never the channel.

## What the owner must do

Give the Space's `HF_TOKEN` secret a token allowed to call Inference Providers.
Until then the real channel writes nothing, whatever the code does.

The cost is worth knowing before that token goes in: without the judge the
reserve still makes up to 120 attempts an hour, day and night, some 2 900 router
calls a day at about 2 100 prompt tokens each (the recent dialogues were two
thirds of the old prompt). If a measuring campaign needs the
quota, the levers are `PER_HOUR` in `arena/commentary/stock.py` and
`ARENA_COMMENTARY=0` on the Space. The bench's judge costs one call per dialogue
evaluated, and only when it is run.

## Order of work

Commits land on the local `main`; the owner pushes.

1. The live path without the judge, the callback fact, the model, the brief, the
   two scripts, and the refused run that waits. The direction becomes data but is still drawn from the run's
   id. Push; two sessions give the baseline.
2. The draw per airing. Push; measure against the baseline.
3. The lots above, one push each.

The implementation plan covers steps 1 and 2. Each lot is an iteration of the
loop, designed from the measurements that precede it.
