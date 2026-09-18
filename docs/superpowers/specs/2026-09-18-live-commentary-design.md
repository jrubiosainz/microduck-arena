# The commentary, written on the air — design

## Goal

Peter and Ray stop reading a text written once, months ago, and start talking
about what is on the screen now. Every time a run comes round, they say
something new: they know what they have just said about the last few runs, and
the facts they are given are the ones true at the moment they are written, not
at the moment the run was published.

Nothing about the channel's promise changes. The grid is still a list of slots
at absolute wall-clock milliseconds, every screen still finds the slot that
contains now and plays it from the right offset, and two screens still agree
because they read the same grid. What changes is where a booth's dialogue comes
from, and when.

This spec amends the section "The commentary, written at publish time" of
`2026-09-17-live-channel-design.md`. That section's title is now wrong: writing
no longer happens at publish time, and a run no longer owns one dialogue.

## The decisions behind it

Four, taken by the owner before the design:

- **A dialogue per airing.** Each time a run reaches the screen it gets a fresh
  one. Not one per cycle, not one refreshed when the data moves — a new
  conversation every time, which is the only way the channel never repeats
  itself.
- **An empty reserve costs a booth, not the channel.** When no dialogue is
  ready for a run about to air, the grid lays its replay and no booth, exactly
  as it does today for a run whose commentary was refused. The channel never
  stops and never waits.
- **The history is what just went out.** The writer is given the last five
  dialogues *broadcast*, all runs together, in the order the spectator heard
  them — not the last five published, and not the run's own past.
- **The reserve gets its own browser.** A tab that shares a browser with
  another tab is backgrounded, and a backgrounded renderer stops committing
  frames; this was learned the hard way on the video render. The reserve runs
  one `Chrome` of its own with exactly one tab, which is therefore always the
  foreground one. It costs memory and buys stability.

## What stays exactly as it is

The clip pipeline, the grid's arithmetic, the shared clock, every segment on the
page, the booth's scene, the shutter, the home tile. The writer's prompt, its
audit, the bible and the character sheets. `prepare` remains the one thing that
turns a dialogue into a timed plan, and it remains in JavaScript, run by a
browser, so that the file the store keeps is exactly what the page plays.

## The broadcast

A dialogue is no longer a property of a run. It is a *broadcast*: one
conversation, written for one airing.

```json
{
  "id": "01M2K...",
  "run_id": "01M2JFJX7CF5HF7ZWTZAA1",
  "dialogue": { "run_id": "...", "turns": [...] },
  "plan": { "duration_ms": 41400, "captions": [...], "notes": [...], "gestures": [...] },
  "written_at": "2026-09-18T09:12:44Z",
  "aired_at": null
}
```

`id` is a ULID, so broadcasts sort by the moment they were written. `plan` is
what `prepare` returned and what the booth plays. `aired_at` is null until the
grid's slot for it has passed, and is what makes the history readable.

Broadcasts live under the store at `live/broadcasts/<id>.json`, beside the runs
rather than inside a run's clip folder: a broadcast belongs to the channel, not
to the clip. `commentary.json` stops being written and stops being read; it is
removed from `CLIP_MEDIA`, and a run's clip folder goes back to three files.

Retention: a broadcast is kept until it has aired and twenty newer broadcasts
have aired after it. That is four times the history the writer reads, enough to
debug a repetition after the fact, and bounded — the store does not grow with
uptime.

The `commentary.json` files already in a store are not imported. They were
written against facts that have since moved, and the reserve fills within
minutes of a start; carrying them over would buy one cycle of booths at the cost
of a migration path that exists forever. They are deleted with the field.

Three things that read commentaries are re-pointed at broadcasts rather than
rewritten: `recent_commentaries` becomes the last aired broadcasts, in air
order; `used_memories` reads the same list, so a memory's cooldown is now
counted in airings rather than publications; and the clip renderer stops
composing a dialogue after a render — a clip no longer owes one, its `commentary`
callable goes, and with it the branch that logs "not on air (its plan did not
prepare)". `arena commentary` on the command line keeps working and writes a
broadcast, which is how a dialogue is still inspected by hand with `--dry-run`.

## The reserve

`arena/commentary/stock.py` holds a `CommentaryStock`, a worker in the shape of
`ClipRenderer`: a thread, a queue, an `available` flag, and a `landed` callback
that tells the programme to rebuild its future.

It keeps **eight** unaired broadcasts ready. At one booth per forty-five seconds
of programme — twenty clips, a cycle of about a quarter of an hour — eight is
roughly ten minutes of stock, comfortably more than the grid's five-minute
horizon and far more than the seconds a generation takes.

Stock is counted per run, not in total, because a booth needs a broadcast for
*its* run: the reserve walks the next cycle's order — which `cycle(entries, k)`
already computes deterministically — and targets the first eight runs in that
order that have no unaired broadcast. Eight is therefore eight different runs,
the next eight to reach the screen.

One turn of the loop:

1. Take the first run in that list. If the list is empty — every run in the
   horizon is covered — sleep and look again.
2. `gather(store, record, lore)` — **now**, so the standings, the records and
   the memories are the ones true at this moment. This is where "data always up
   to date" comes from; it needs no new machinery, only a later call.
3. Read the last five aired broadcasts, newest last, and give them to the writer
   as the recent wording, and to the audit as what a rehash would be.
4. Call the router. A `Rejected` is not an error: log the reason, move to the
   next run, and let this one come round again. With refusals running near one
   in two, the reserve is sized on the assumption that half the turns produce
   nothing.
5. `prepare` the dialogue in the reserve's own tab, and write the broadcast.
6. Tell the programme something landed.

### Its browser

One `Chrome` from `arena/recorder.py`, launched once when the reserve starts and
kept for the life of the process. `arena.recorder.Chrome` already carries the
three anti-backgrounding switches and already documents why. One tab, opened on
a page that exists only for this purpose.

That page is the smallest thing that can do the job: it imports `prepare` from
`app/src/live/score.js` and exposes it, and nothing else. It loads no scene, no
assets and no run. `prepare(dialogue)` derives its seed from `dialogue.run_id`,
so one tab serves every run and never navigates. A clip page would have done,
but it would have loaded a whole three.js scene to call a pure function, and it
would have tied the reserve's tab to a run that may be withdrawn under it.

If Chrome cannot be found, the reserve is unavailable, exactly as the clip
renderer is unavailable on a machine without ffmpeg. The channel then plays
replays with no booths, which is a supported way to run.

### What bounds it

- `ARENA_COMMENTARY=0` turns writing off, as it does today, and the reserve
  never starts.
- At most **one hundred and twenty** generation attempts an hour, counted
  whether they succeed or are refused. Steady state is about eighty booths an
  hour; the cap is half again as much, so it never binds in normal running and
  a loop that has gone wrong cannot spend the night on the router.
- One generation at a time. There is no parallelism to win here: the reserve is
  ahead of the playhead by minutes.

## The programme

`pool()` no longer reads a commentary to learn a booth's length, because a run
no longer has one length. An entry carries its replay length and nothing else.

`slots_for` changes: laying a run's slots, it takes the oldest unaired broadcast
for that run that no future slot has already claimed. With one, it lays the
second shutter and a booth whose `duration_ms` is that broadcast's plan's, and
the slot carries `"broadcast": "<id>"` beside its `run_id`. With none, the run
contributes a shutter and a replay, and that is all.

`invalidate()` is unchanged and is what a landed broadcast calls. Because it
keeps every slot up to and including the one playing now and discards the
future, a broadcast claimed by a future slot simply becomes unclaimed again and
is re-offered to the next build. A broadcast claimed by a slot that has already
started stays claimed: what a screen is playing is never re-assigned.

A broadcast is marked aired when the programme observes that its slot's end has
passed. The server knows the grid and the clock; no screen reports anything.

## `GET /api/live`

One field is added to a booth slot:

```json
{ "kind": "booth", "at_ms": 1789730000000, "duration_ms": 41400,
  "run_id": "01M2JFJX7CF5HF7ZWTZAA1", "broadcast": "01M2K..." }
```

and one route is added, `GET /api/live/broadcast/<id>`, serving the broadcast's
`dialogue` and `plan` — the same body the booth reads today from
`commentary.json`, so the page's parsing does not change.

## The page

Two lines. `getCommentary(runId)` becomes `getBroadcast(id)` in
`app/src/api.js`, and the interlude prepares from `slot.broadcast` instead of
`slot.run_id`. Everything downstream — the booth, the voice, the captions, the
conductor — is untouched, because what they receive is the same shape it has
always been.

A booth slot whose broadcast has been swept away while a screen was playing it
is the one new failure: the fetch 404s, the segment reports `failed`, and the
channel covers it with the shutter and moves on at the scheduled time, which is
the behaviour a withdrawn clip already has. Retention makes it nearly
impossible; the page handles it anyway.

## Running for days

The reserve adds three things that must not grow: the broadcasts on disk,
bounded by retention; the queue, which holds at most one run at a time; and one
browser, launched once. The generation loop holds no history in memory — it
reads the last five aired broadcasts from the store each turn, so a process that
has run for a week starts each dialogue from the same five files a fresh process
would.

The router is the one dependency that can fail for hours. When it does, every
turn is refused or times out, the reserve drains, and the channel plays replays
with no booths until it recovers. Nothing needs restarting.

## What this is not

It is not live generation *during* a booth: the dialogue is complete, timed and
stored before its slot is ever laid. It is not a stream. It is not a
conversation that reacts to viewers. And it does not make the booth's length
predictable — a booth is still as long as what was written, which is why the
grid can only lay one once the writing is done.
