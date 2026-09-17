# The live channel — design

Date: 2026-09-17. Status: approved in conversation, awaiting the owner's review of this document.

## Goal

A sports channel that never stops: the arena's clips, one after another, with
two commentators between them who react to what was just shown, in a booth of
their own. Peter Duckry and Ray Quackson, the set, the voices, the camera work
and the editorial line come from Duck Jam, re-set for the arena. Everyone who
opens the channel sees the same second of the same programme, whether they are
on the site, on a television at Pollen, on a booth screen at a show, or watching
a Twitch or YouTube stream that a machine somewhere is pushing.

The channel costs the Space nothing to broadcast. The Space publishes a
programme grid, the clips it already renders, and the commentators' lines,
written once when a run is published. Every screen composes the show itself.

This is project 1 of two. It delivers the grid and the shared clock, the live
page with its three segment kinds, the booth ported from Duck Jam, the
commentary written at publish time with a deep backstory, continuity and
notable facts, the "ON AIR" tile on the home page, and the backfill of the
clips that exist today. Project 2 (the recurring segments, the breaking-news
interruption, the player's statement, an unattended broadcaster, and the
pre-rendered booth as an mp4 if it is ever needed) gets its own brainstorm.

## What Duck Jam had, what is reused, what is new

Duck Jam's live (`dome/media/live`, `dome/media/commentators`,
`dome/media/commentary`, `dome/web/features/live`, about 3 400 lines) was a
Node producer driving a headless Chromium: clip A, a shutter wipe, a 30 s booth
interlude, a shutter, clip B, frames piped to ffmpeg as HLS at 720p25, a small
server publishing segments, and an hls.js player that pinned every visitor six
seconds behind the same live edge. The hosted producer never held: on an A10G
Space, `NVIDIA_DRIVER_CAPABILITIES` was `compute,utility`, Chromium came up with
`gl=none`, fell back to SwiftShader and was killed by the watchdog during the
booth render (`dome/media/live/GRAPHICS.md`). Rendering 25 frames a second,
forever, on a server, was the part that broke.

| Piece | Duck Jam | Here |
|---|---|---|
| Who composes the show | A server producer, streamed as HLS | Each screen, from a grid and files |
| Shared clock | `/time` samples, min round trip, six seconds behind | `now_ms` in the grid response, min round trip, no lag needed |
| Replays | Decoded in the producer's page | The clip's `landscape.mp4` in a `<video>` |
| The booth set | `commentators/set.mjs`: three.js boxes on design tokens, z up | Same boxes, same tokens, transposed to the viewer's y up; the CRT shows the run's poster |
| The ducks | Compiled MuJoCo scene, `mountCommentators` in `stage.mjs` | The viewer's rig (`rig.js`) with the `classic` and `blue` liveries |
| Beak | `articulateMouth` rotates the jaw geoms about a pivot | Same pivot, a sub-group under the jaw body |
| Camera | `direction.mjs`, pure | Ported as is |
| Voice, gestures | `score.mjs`: `prepare`, `synthesize`, `poseAt`; two native tones | Ported; `prepare` runs in the worker's page, the rest in the viewer's |
| Captions | Burned into the canvas | A DOM panel with the same charter |
| Transition | Shutter with logo and a wind gust, 40 frames | Same timing, the arena wordmark, an UP NEXT card on the way out |
| Dialogue | LLM at broadcast time, knowing the next item, two calls | LLM at publish time, one file per run, two calls, plus a backstory bible, recent dialogues and notable facts |
| Editorial guard rails | `generator.py` local checks and audit | Ported, with `fresh` added to the audit |
| Transport | HLS, epochs, watchdog, GPU | None |

## Decision: the channel is a page; broadcasters consume it

Three approaches were weighed.

**A. A page composed on the viewer's GPU, from a server grid.** Chosen. The Space
stays on cpu-basic and serves JSON and files. A television is Chrome in kiosk
mode on the page; Twitch is OBS with a Browser Source on the page; an unattended
broadcaster, later, is a container with a headless Chromium and ffmpeg pushing
RTMP from the same page. The site's live works with no broadcaster running at
all. The booth is a pure function of time, so joining late is exact and a slow
device drops frames instead of drifting.

**B. Duck Jam's producer ported to a GPU Space.** Rejected. Reuses the most code,
but it is the chain that never held, the site's live would depend on one
process, a GPU Space that never sleeps is billed by the hour around the clock,
and whether a Chromium gets hardware GL on a Hugging Face GPU Space is unproven.

**C. The booth pre-rendered as `booth.mp4` by the clip worker.** Deferred, not
rejected. The client would only chain videos and DOM. It costs another 30 s
render per publish on a cpu-basic whose clip render time is still unmeasured,
and freezes the booth at publish time. Nothing in this design prevents it: the
booth plays from a plan, so a worker could render that plan to a file with the
same page and the grid would not change. It goes to project 2 if the client
booth proves too heavy somewhere that matters.

Rendering the booth outside a browser on the Space was also considered and
dropped: it would be a second implementation of a web-native show (three.js,
WebAudio, DOM captions, CSS wipes), and EGL needs the same driver capability
Chromium does.

## Architecture

```
Space (cpu-basic)                              Every screen
──────────────────                             ────────────────────────────
clip worker ─┬─ landscape.mp4, vertical.mp4    #/live page
             ├─ clip.json, poster.png           ├─ clock: offset from now_ms
             └─ commentary.json  (new)          ├─ grid: which slot is now
programme    ── GET /api/live    (new)          ├─ replay: <video> of the mp4
                 now_ms, build, slots[]         ├─ booth: three.js + WebAudio + DOM
                                                └─ shutter: CSS/canvas wipe
                                               Chrome kiosk (TV) · OBS (Twitch)
```

## The programme and the shared clock

### The pool

Every run of an open event that has a ready clip and is not withdrawn. Each
entry carries the run id, the clip's length from `clip.json`
(`layouts.landscape.seconds`, a whole multiple of 40 ms), and the booth's length
from `commentary.json` (`plan.duration_ms`) when that file exists.

### A cycle

One pass over the pool, in a deterministic order:

- The three most recently published runs first, newest first: every cycle
  opens on the latest results.
- The rest shuffled with `random.Random(k)` where `k` is the cycle number.

The fixed head is also what keeps a run from playing twice in a row across a
cycle boundary whenever the pool has two or more runs.

A run contributes, in order: a shutter, its replay, and, when it has a
commentary, a shutter and its booth. The shutter before a replay carries the
replay's run as its `next`; the shutter before a booth carries none. Every
slot's length is a whole multiple of 40 ms; a shutter is 1 600 ms.

With today's 20 clips at 8 to 18 s and booths of 20 to 40 s, a cycle runs about
a quarter of an hour.

### The grid

`arena/live.py` holds one `Programme` per process. `origin_ms` is the wall-clock
millisecond the process built it. Slots are appended cycle by cycle, lazily, as
far as `now + 5 min` on each request; slots that ended more than two minutes ago
are dropped. The cycle counter never resets within a process.

`invalidate()` keeps every slot up to and including the one playing now,
discards the future, re-reads the pool and continues from the end of the current
slot with the next cycle number. It is called when a clip or a commentary lands
(the worker), when a run is withdrawn (the route), and it is what a restart is
too. It is the entry point project 2's breaking-news insertion will use.

An empty pool makes an empty grid: the channel is off air.

### `GET /api/live`

```json
{
  "version": 1,
  "now_ms": 1789999999000,
  "build": "3f9c…",
  "origin_ms": 1789990000000,
  "slots": [
    { "kind": "shutter", "at_ms": 1789999990000, "duration_ms": 1600,
      "next": { "run_id": "01M2…", "event": "2 m Sprint", "user": "carol" } },
    { "kind": "replay",  "at_ms": 1789999991600, "duration_ms": 13800, "run_id": "01M2…" },
    { "kind": "shutter", "at_ms": 1790000005400, "duration_ms": 1600, "next": null },
    { "kind": "booth",   "at_ms": 1790000007000, "duration_ms": 28320, "run_id": "01M2…" }
  ]
}
```

Slots overlapping `[now - 60 s, now + 5 min]`, in order. `build` is the SHA-256
of the served `index.html`, computed once at boot; it changes with every deploy.
`Cache-Control: no-store`. The response carries ids only: a client fetches
`/api/runs/{id}/clip/landscape.mp4`, `/api/runs/{id}/clip/poster.png` and
`/api/runs/{id}/clip/commentary.json` for the slot it is about to play.

### The clock

On every poll (every 10 s while the document is visible) the client records
`before`, `now_ms`, `after`, keeps the five most recent samples and takes the
one with the smallest round trip: `offset = now_ms - (before + after) / 2`, as
Duck Jam's `estimateClock`. The programme position is `Date.now() + offset`. The
slot playing now is the one whose `[at_ms, at_ms + duration_ms)` contains it;
the offset inside the slot is what every segment plays from.

Two screens agree to within their round-trip uncertainty, tens of milliseconds
on the same network. Nobody is put deliberately behind the live edge: there is
no edge, only a clock.

## The live page

### Route and layout

`#/live`, wearing the `race` sheet plus a small `live.css`. One 16:9 stage
fills the window, letterboxed on a portrait phone, centred on a wider screen.
The only chrome is a "LIVE" bug in a corner, in the charter's magenta on ink.
The clips already carry their own title band and result sheet; the booth carries
its caption panel; nothing is doubled.

On load the page fetches the grid, estimates the clock, and tries to play. If
`play()` or the `AudioContext` is refused for want of a gesture, one button,
"JOIN THE LIVE", covers the stage; the click starts everything at the current
position. Chrome in kiosk mode with `--autoplay-policy=no-user-gesture-required`
and OBS's Browser Source never show it.

### Segments

Each kind is a module with the same interface: `prepare(slot)` (fetch and
build, called for the next slot while the current one plays), `play(offsetMs)`
(start at a position inside the slot), `seek(offsetMs)` and `stop()`.

**Replay.** The clip's `landscape.mp4` in a `<video>`, with its own soundtrack
(crowd, horn, verdict). Two `<video>` elements alternate so the next clip is
already buffered. The current time is servoed to the clock as in Duck Jam's
`correction`: within 250 ms, the rate is nudged to 0.97 or 1.03 (1.0 under
250 ms of error is left alone); beyond 250 ms, a seek. A `waiting` event marks
the segment unaligned until the next tick realigns it.

**Booth.** The three.js scene of the section below, drawn on a canvas at the
stage's size (device pixel ratio capped at 1.5), the caption panel in DOM under
it, the voice as one `AudioBufferSourceNode` started at the slot's start with
`offset` set to the join position, and the clip's `StadiumAmbience` under it at
low gain with a neutral direction. Every frame calls `poseAt(plan, speaker, ms)`
and the camera from `direct(plan)(ms)` with `ms = position - at_ms`: there is
nothing to drift.

**Shutter.** 1 600 ms as Duck Jam's `motion.mjs`: a 400 ms sweep in, 800 ms
fully covering, a 400 ms sweep out to the right, with the checkerboard stripes,
the arena wordmark, a cyan edge going in and a magenta edge coming out, and the
wind gust synthesised in-page with WebAudio the way Duck Jam's `build-wind.mjs`
made its `wind.wav`: 0.36 s of pink noise band-passed between 180 and 4 200 Hz,
a 0.1 s fade in and a 0.22 s fade out, breathed once at 0 ms and once at
1 160 ms, silent through the 800 ms hold, peaking at -1 dBFS; no file is
copied. From 800 ms the slot underneath is
the next one, already prepared and posed at 0. On the way out to a replay the
panel carries the UP NEXT card: the event's title and the author's `@name` from
the slot's `next`. This card is how the next replay is announced, since a
dialogue written at publish time cannot know it.

### Sound, visibility, motion

The site's mute preference (`sound.js`) is respected: muted, the video is
muted and the voice and ambience are silent; captions stay. Hidden tab: every
segment stops, the polls pause; on return the grid is re-read and the page
rejoins at the current position. `prefers-reduced-motion` keeps the "JOIN THE
LIVE" button in front of autoplay and changes nothing else: this is a channel,
and its ducks move.

### Running for days

The booth disposes its geometries, materials and textures at `stop()`; the two
video elements are reused; the slot list is replaced, never appended. When
`build` in the grid differs from the one the page started with, the page
reloads itself at the midpoint of the next shutter, never mid-segment. A network
loss keeps playing the known grid; after 30 s without a successful poll the bug
reads "RECONNECTING", and the next successful poll clears it. A clip whose file
answers 404 (withdrawn between two grid reads) skips to the next slot at its
scheduled time, the shutter card holding until then. An empty grid shows an
"OFF AIR" card with the wordmark and keeps polling.

### The home tile

The home page reads `/api/live` once at load and, when the grid is not empty,
shows an "ON AIR" tile linking to `#/live` with the current slot's event title
and author. No polling: it is a door, not a monitor.

### Kiosk, OBS, and the broadcaster

A television runs `chromium --kiosk --autoplay-policy=no-user-gesture-required
<space>/#/live`. While the Space is private, each screen signs in to the Hub
once and keeps its cookie; OBS's Browser Source allows this through its
"Interact" window. Making the Space public for a stream is the owner's call
and changes nothing here.

OBS: a Browser Source at 1920×1080 on the same URL, audio routed into the mix.
No code.

An unattended broadcaster (a `broadcaster/` image with a headless Chromium and
ffmpeg pushing RTMP, deployable on a GPU Space or any box) is project 2. It
starts with a half-day spike: does a headless Chromium get hardware WebGL on a
Hugging Face GPU Space with `NVIDIA_DRIVER_CAPABILITIES=graphics`, and if not,
at how many frames per second does SwiftShader hold this page at 720p? The
answer chooses the hardware.

## The booth

`app/src/live/booth.js` builds a three.js scene separate from the race viewer,
with the viewer's building blocks: `loadKinematics`, `buildRigTree`,
`attachMeshes` and `setJoint` from `rig.js`, the viewer's key, fill, rim and
hemisphere lights, ACES tone mapping and the room environment, so Peter and Ray
are lit like the ducks of every race page.

**The set.** `booth()` from Duck Jam's `set.mjs`, box for box, in
`app/src/live/set.js`: the court paint, the riser, the warm-paper back wall
with its skirting, returns, three ribs and the magenta stripe, the yellow
pegboard with its recessed holes, the cream desk on its apron and legs, the
CRT cabinet on its trolley with casters, bezel, glass and standby key, the sky
equipment case with lid and handle, two fluorescent tubes on their brackets, a
checkerboard floor and a transparent shadow receiver. Colours are the design
tokens the arena already ships (`--ink`, `--deep-ink`, `--paper`,
`--warm-paper`, `--cream`, `--sky`, `--magenta`, `--yellow`). Duck Jam's set is
z up in metres; the viewer is y up, so the port maps `(x, y, z)` to
`(x, z, -y)` once at the group and keeps every measurement. One adaptation:
the CRT glass shows the poster of the run under discussion, as a monitor in a
control room would.

**The ducks.** Peter on the left (`classic` livery, cream shell), Ray on the
right (`blue`, sky shell), 0.16 m either side of the desk's centre, turned to
face the camera, standing in the STAND pose: the fourteen joint angles of
`DEFAULT_POSE` in `arena/constants.py`, copied into `booth.js` as `STAND` with a
comment naming its source, and the trunk 0.12 m above the floor, the
`SPAWN_HEIGHT_M` that `course.py` puts in the keyframe. Only the
neck and head move: `neck_pitch`, `head_pitch`, `head_roll`, `head_yaw`, all in
the rig, driven by `poseAt`.

**The beak.** The rig leaves the jaw pivot out on purpose. The booth adds it
without touching the replay: `attachMeshes` names every mesh after its
kinematics file (`mesh.name = geom.mesh`, one line), and the booth re-parents
`jaw.stl` and `jaw_soft.stl` under a pivot group placed at Duck Jam's
`(-0.008, 0, -0.025)` in the jaw body's frame, rotating about that body's y
axis by `mouth × 0.32` rad, where `mouth` is the energy of the note being sung.

**The camera.** `direction.js` is Duck Jam's `direction.mjs` unchanged in
substance: the wide duo shot by default; a close shot on a speaker allowed
after 10 s of wide, held 5 to 7 s to the end of that reply, never within 5 s of
the end, never while the partner speaks inside the window, never cut mid-line;
the same target, distance and slow push-in numbers, in the viewer's axes. Pure,
tested.

**Voice and gestures.** `score.js` is Duck Jam's `score.mjs` in two halves.
`prepare(dialogue, seed)` turns a dialogue into a plan: captions in chunks of at
most 84 characters, one note per syllable at Peter's 420 ms and Ray's 500 ms per
word with the seeded jitter, 160 ms after a full stop, 500 ms between turns,
head beats through listening and silence, glances toward the partner, and the
plan's `duration_ms`. `poseAt(plan, speaker, ms)` and `synthesize(plan, tones)`
play it. The two tones, `commentator-peter.f32` and `commentator-ray.f32`
(115 200 bytes each: 0.6 s of one microduck note at 48 kHz mono, rendered from
Pollen's `sounds` crate in the microduck repository at revision `e597877`), go
to `app/public/sound/` with a line in its `PROVENANCE.md`. `synthesize` runs
in the viewer's page in a few milliseconds and fills one `AudioBuffer`.

**Captions.** A DOM panel across the bottom of the stage, the charter's ink
panel with an offset magenta shadow and a sky keyline, a yellow name tile in the
top-left corner reading `Peter Duckry` or `Ray Quackson`, and up to two lines of
DM Sans 700 at 50/1280 of the stage's width. A caption of 42 characters or less
stays on one line; longer ones split at the word boundary that balances the two
lines' widths, Duck Jam's rule.

**Ambience.** The clip's `StadiumAmbience` (`app/src/clip/stadium.js`) with a
neutral direction and the master gain halved, under the voice, so the booth
sits in the same hall as the races.

## The commentary, written at publish time

### Where it happens

The clip worker (`arena/clips.py`) does one more thing per run, inside the same
`render_one` and the same write-once `put_clip`:

1. Project the facts and write the dialogue (`arena/commentary/`), before any
   rendering: nothing in the text depends on the pictures.
2. Render the clips as today.
3. Before `record_run` closes its Chromium, evaluate
   `window.clip.commentary(dialogue)` in the landscape tab: `clip/main.js`
   imports `prepare` from `live/score.js` and returns the plan.
4. `put_clip` with `commentary.json` beside `clip.json`, the poster and the two
   videos.

`record_run` grows an optional `dialogue` argument and `RenderedRun` an
optional `commentary` field. A dialogue that fails to prepare (a caption word
over 42 characters, say) is logged and dropped: the clip is still published.

### `commentary.json`

```json
{
  "version": 1,
  "run_id": "01M2…",
  "written_at": "2026-09-17T14:02:11Z",
  "model": "Qwen/Qwen3.8-27B:cerebras",
  "usage": { "prompt_tokens": 2310, "completion_tokens": 388 },
  "facts": [
    { "ref": "run#/score", "kind": "result", "text": "…" },
    { "ref": "player:carol#/notable/first-under-12s", "kind": "notable", "text": "…" },
    { "ref": "lore:makeshift-trophy", "kind": "lore", "text": "…" },
    { "ref": "recent:01M2…", "kind": "recent", "text": "…" }
  ],
  "dialogue": {
    "turns": [
      { "speaker": "peter", "text": "…", "fact_refs": ["run#/score"] },
      { "speaker": "ray", "text": "…", "fact_refs": ["run#/score", "player:carol#/notable/first-under-12s"] }
    ],
    "lore_refs": ["makeshift-trophy"]
  },
  "plan": { "version": 1, "item_id": "01M2…", "language": "en", "duration_ms": 28320,
            "seed": 0, "sample_rate": 48000, "channels": 2,
            "captions": [], "notes": [], "gestures": [] }
}
```

It is served by the existing `GET /api/runs/{id}/clip/{name}` route with
`commentary.json` added to `CLIP_MEDIA`, cached hard like the media. The Hub
store's snapshot already carries every JSON under `clips/`, so the programme
reads plan lengths from it without a download per run.

It is the one rewritable file in a clip folder. `store.put_commentary(run_id,
bytes)` overwrites (a new commit on the Hub) and requires a ready clip;
`store.commentary(run_id)` returns the parsed file or `None`. A missing file
means no booth for that run.

### The facts

All public, all allowlisted, projected in `arena/commentary/context.py` from the
run record, its event manifest, the board and the points fold at the moment of
writing. Each fact is `Fact(ref, text, kind, tags, identity=None, outcome=None)`.

Result facts: the event's title and nature (a sprint, a hill climb, a roller
race, a jump, a hold), `@user` and the policy's name, the mean finish time or
DNF, seeds finished out of five, falls, the rank on the board, the gap to the
leader, the points earned and the receipts behind them (`first_event`,
`own_best`, `podium`, `run`), the previous personal best when `own_best` fired.

No player statement: the publish form has none. Adding one is project 2.

### Notable facts

`arena/commentary/notable.py`: pure detectors over the author's history, the
board and the profile, each returning zero or more `Fact`s with a notability
score in `[0, 1]` and tags. The first set:

- a first publication ever, or a first on this event;
- the n-th publication today, from the third;
- a first time under a round threshold on this event (12 s, 10 s…);
- a personal best beaten, with the margin;
- a climb on the board, from rank a to rank b, and who was passed;
- a first DNF after n clean runs, or the n-th DNF in a row;
- leading two or more events at once;
- entered on every open event;
- the only entrant on a rig (rollers) in an event;
- two players who have swapped the lead n times on an event;
- for each of the three opponents drawn in the clip (the ducks ranked just under
  the author): how long they held the place they just lost, or that they keep
  it by a margin.

The top four by score, no two with the same tag, enter the prompt beside the
result facts. Every detector is a function of public data and a fixed clock and
is unit-tested with fixtures.

### The bible

`arena/commentary/lore.json`, edited by hand:

```json
{
  "characters": {
    "peter": { "name": "Peter Duckry", "sheet": "…several paragraphs…" },
    "ray":   { "name": "Ray Quackson", "sheet": "…" }
  },
  "memories": [
    { "id": "makeshift-trophy",
      "tags": ["podium", "first-podium", "trophy"],
      "memory": "The season they built the trophy out of a coffee tin and a bicycle bell, and Ray still has the bell." }
  ]
}
```

Dozens of memories, each tagged with the situations it resonates with (a fall
on the last metre, a first run, a record by a hair, a DNF streak, a comeback, a
hill, a roller race, a jump, a hold, a crowded board, a lonely event…). The
prompt never sees the whole bible. `select_memories(facts, recent)` keeps the
memories whose tags meet the facts' tags, removes any used in the last ten
commentaries (by `lore_refs` in the recent `commentary.json` files), and returns
at most two, with the instruction that they are optional and that most of the
time none fits. Every memory used is recorded in `dialogue.lore_refs`.

### Continuity

The five most recent `commentary.json` files by `written_at` (excluding the run
being written) go into the prompt as "your recent broadcasts": each one's
result facts in one line and its turns. Two rules come with them: never reuse a
phrasing or a memory from them, and callbacks may refer to those runs as
"earlier this season", never as a moment ago or as the previous item, because
the channel plays its cycles in a shuffled order. Every callback cites the
recent fact's ref (`recent:<run_id>`) so the audit can check it.

### The prompt and the contract

`arena/commentary/generator.py` is Duck Jam's `generator.py` ported. The system
prompt carries the booth context, both character sheets, the grounding rules,
the identity indices for every name, the recent broadcasts, the selected
memories, and the output shape. The user message is the JSON list of facts.

Output: a JSON array of 3 to 6 turns, alternating `peter` then `ray`, each
`{speaker, text, fact_refs}`, text in English of 1 to 240 printable characters,
no markup, no speaker prefix, no self-introduction, `fact_refs` a non-empty set
of supplied refs. The writing instructions keep Duck Jam's: Peter reacts to the
outcome; Ray answers Peter's actual emotion first, with affectionate
understatement; personality through reactions, not descriptions of the show;
pick the most interesting sporting angle rather than reciting every field;
scores and anecdotes optional; a memory only when it truly fits. The transition
to the next item is gone from the prompt.

Local checks before the audit, as Duck Jam: speaker alternation, length and
printability, no `<>`, no technical text (paths, ids, filenames, hashes), no
speaker label or self-introduction, no gendered or kinship words, every name
component cited by its identity ref, fall vocabulary only with a `fell`
outcome in the cited facts, every number and number word present in the cited
facts, at least one result fact covered, no participant placed in the booth.
Then the audit call returns `{grounded, english, personalities, fresh}`, all of
which must be `true`; `fresh` is new: the dialogue is not a rehash of the recent
broadcasts.

### Provider and configuration

The Hugging Face router (`https://router.huggingface.co/v1/chat/completions`)
with the Space's `HF_TOKEN`, or locally the token of the developer's Hub
session (`huggingface_hub.get_token()`), model from `ARENA_COMMENTARY_MODEL` (default
`Qwen/Qwen3.8-27B:cerebras`, the one Duck Jam ran), `temperature` 0.3, no
provider failover, 15 s per call and one retry on a network error: the worker
is not real-time. `ARENA_COMMENTARY=0`, or no token, disables writing with one
line at boot, like `clips off`. The input budget stays 8 KiB; the writer's
`max_tokens` rises to 900 for six turns; the audit's stays 96.

### Failure, regeneration, backfill

A failed or rejected dialogue writes nothing: the replay plays and the shutter
goes to the next slot. The reason is logged.

`arena commentary <run_id> [--store DIR]` writes a fresh dialogue for a run
whose clip is ready, prepares its plan in a headless Chromium, and overwrites
`commentary.json` through `put_commentary`. With `--dry-run` it prints the
facts, the selected memories and the dialogue, and touches neither a browser
nor the store. It is how a bad text is fixed and how the tone is judged
locally.

The worker's `drain` gains a second job kind: with `ARENA_CLIP_BACKFILL=1`,
every ready clip without a `commentary.json` is queued at backfill priority,
behind fresh publishes, and gets the same generate-prepare-put path (opening a
Chromium for the preparation alone). That covers the 20 clips on the Space
today.

## Routes, files, store

New: `GET /api/live`. Changed: `GET /api/runs/{id}/clip/{name}` serves
`commentary.json`; `POST /api/runs/{id}/withdraw` invalidates the programme.

Store (`arena/store.py`, both backends): `put_commentary`, `commentary`, and
`clips_ready()` listing run ids with a ready clip for the pool.

Server files: `arena/live.py` (pool, cycle, `Programme`), `arena/web/routes_live.py`,
`arena/commentary/{__init__,context,notable,lore,generator}.py`,
`arena/commentary/lore.json`, `arena/clips.py`, `arena/recorder.py`,
`arena/store.py`, `arena/cli.py`, `arena/web/config.py`, `arena/web/app.py`.

Client files: `app/src/live.js` (the page), `app/src/live/{clock,grid,replay,booth,set,direction,score,voice,captions,shutter}.js`
and their tests, `app/src/clip/main.js` (`window.clip.commentary`),
`app/src/rig.js` (mesh names), `app/src/router.js`, `app/src/main.js`,
`app/src/home.js` (the tile), `app/public/live.css`,
`app/public/sound/commentator-{peter,ray}.f32`, `app/public/sound/PROVENANCE.md`.

## Testing

Pure modules under vitest: the grid position for a clock (`grid.js`), the clock
offset estimate over samples with unequal round trips (`clock.js`), the shot
schedule's invariants (`direction.js`: every shot at least 5 s, the duo owns
most of the programme, a speaking duck is always in its shot), `prepare`'s
determinism and `poseAt`'s exact restoration at a repeated instant
(`score.js`), the caption split (`captions.js`), the reload-on-build rule.

Under pytest: each notable detector on fixtures, memory selection with cooldown,
the generator's local checks with a fake provider (the accepted case, a speaker
prefix, an invented number, a fall without a fall fact, a name without its
identity ref, a memory not among the selected ones), the audit's gates (a fake
verdict with `fresh` or `grounded` false rejects the dialogue), the
cycle order (newest three first, no repeat across the boundary), `invalidate`
keeping the current slot, `commentary.json` in `put_clip` and `put_commentary`
on both backends, the route.

By hand, before deploying: `arena commentary --dry-run` on real runs of
`~/arena-board` to judge the tone; `arena serve --store ~/arena-board` and
`#/live` in a browser through two full cycles; the local headless Chrome for
stills of the booth at 1280 and 390 px and of every caption; OBS's Browser
Source on the local page once. After deploying: the first fresh publish
measures the cpu-basic render with the commentary step, in `clip.json`'s
`timing`; two browsers on the Space show the same slot at the same offset.

## Out of scope: project 2

Recurring segments (season standings, an event's podium, a player spotlight,
the next event), the breaking-news insertion at publish, the player's statement
at publish, the unattended broadcaster and its GPU spike, the booth pre-rendered
to an mp4, and a phone-portrait cut of the channel. Also untouched: scoring,
points, the race pages, the publication page and its clips.

## Risks and open points

- **Render time on cpu-basic** is still unmeasured; every clip on the Space was
  rendered on a Mac. The commentary step adds two LLM calls and one `prepare`,
  seconds, not minutes.
- **The model id.** `Qwen/Qwen3.8-27B:cerebras` is what Duck Jam's reviews
  ran on the router in September 2026; if the router drops it, `ARENA_COMMENTARY_MODEL`
  is the switch and the `--dry-run` is the check.
- **Callbacks and shuffled order.** A callback that sounds like "a minute ago"
  would be wrong on air; the rule and the audit guard it, and the recent
  broadcasts are the only source of callbacks.
- **A private Space on a television** needs one sign-in per screen; a public
  stream of a private Space's content is the owner's decision.
- **Two ducks on a weak GPU.** The booth is two rigs and thirty boxes; the race
  page already draws up to four rigs. If a screen ever struggles, the pixel
  ratio cap and approach C are the levers, in that order.
