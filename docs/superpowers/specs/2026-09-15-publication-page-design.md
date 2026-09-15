# The publication page — design

Date: 2026-09-15. Status: approved in brainstorm, awaiting written review.

## Goal

Every published run gets a page of its own, `#/r/<run_id>`: the 3D replay of
the policy, the time it set, where it stands on the event's board, and the
points it earned. The page is reached from the board (a click on a row), from
a player's profile (a `Publications` list, newest first) and, when the author
stays on the site, straight after a Publish completes.

The first time the **author** opens the page, the result is revealed with the
Duck Jam theatre: the race plays through, the duck is celebrated, the time
rolls up on a split-flap board, the run climbs the pegboard to its rank, and
the points fly to the player chip top-right. Until then a red dot on the chip
and on the profile card says a result is waiting. Everyone else, and every
later visit, sees the finished page with no theatre.

Speed of delivery matters more than completeness: this is a first page to
iterate on.

## What Duck Jam has, and what is new

Duck Jam's run page (`dome/web/features/results/`) has a split-flap
scoreboard, a status stamp on a CRT panel, a reveal sequence (stamp slam →
digit roll → rest) and a **Celebrate this run** button that plays
`microduck-victory.wav` and drops 48 confetti strips. All of that CSS is
already in `app/public/design/motion.css` and `components.css`; the
`.rank-climb` / `.rank-shuffle` pegboard beat is there too, built but never
triggered by any JS. Only the sound files are missing.

Duck Jam has **no 3D on its run page**, **no player chip** and **no
points-to-chip animation**, and **no "seen" state** (its first-view guard is
in-memory). Those parts are new work built on the same primitives.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **One rich `GET /api/runs/{id}`, and a `seen` flag stored server-side** | The route exists; it grows to carry everything the page shows. `seen/<run_id>.json` mirrors `withdrawn/` line for line, so "seen once, by the author" is true per account, on every device. One Hub commit per first view, which is once per run. Rules out composing the page client-side from the board (the client would rank runs, which the codebase refuses) and `localStorage` (per-browser: the dot and the reveal would come back on another device). |
| **The stored trace is unchanged** | One replay per run exists, the lower-median finishing seed, chosen to be representative rather than cherry-picked. The page replays it and says which seed it is. Rules out re-picking the best seed (a different number from the board's) and storing five traces (5× the storage and commit size). |
| **The scene races the author against the three ducks ranked just below** | The author must win the picture. Rivals are drawn at full opacity, not as ghosts: they are real entries, not context. The camera keeps its existing behaviour and follows the leader. |
| **The pegboard is a window of the event's board, and the run climbs it** | Two rows above the run, the run, up to five below: at most eight rows, each with its global rank on the event. In the reveal the author's row starts at the bottom of the window and climbs to its place with Duck Jam's `.rank-climb` beat, displaced rows shuffling down. It shows the progression in the ranking, not only the finish. |
| **The chip shows points everywhere** | `avatar · name · ✦ N` on every page. The reveal needs a target that can visibly count up, and points become visible site-wide, which is what the gamification layer is for. |
| **A completed Publish navigates to the run page** | One code path for the reveal, and the page becomes the natural landing after a publication. The race page keeps its board refresh for the case the author is not signed in to publish. |
| **`seen` is written at the end of the theatre, or on skip** | Written at the start, a reload mid-reveal would lose it for ever. Written at the end, a reload replays it, which is the lesser evil. Leaving mid-way keeps the red dot: the result has not been seen. |
| **Sound may be refused** | A deep link with no user gesture cannot play audio. The beats then run silently; nothing waits for a sound. |

## The page

Route `^/r/<id>/?$` → `{view: "run", runId}`, `runHref(runId)`. It wears the
`race` sheet because it has a stage. Top to bottom:

1. **Signage** with the chip, as every page.
2. **Head**: eyebrow `Publication`, `h2` the event title, a line
   `@user · policy name · date`.
3. **Stage**: the viewer with the run's trace in lane one and the traces of the
   three board rows just below it in the next lanes, all at full opacity, all in
   the livery they raced in. Under the stage a legend: lane colour, `@user`,
   time, for each lane.
4. **Scoreboard**: `.scoreboard` with `.flip-digit` tiles for the time
   (`8.412`, three decimals, matching `formatScore`), beside a `.crt-screen`
   carrying a `.stamp`: `FINISHED 5/5`, or `DNF`. A mono line under it:
   `0.85 m/s · replay: seed 3, median finisher`.
5. **Pegboard**: the window of the board described above. Columns: rank,
   `@user`, policy, time. The run's row is `.pegboard-row-you`. A row is a link
   to its own run page.
6. **Points**: one `.sticker` per receipt of this run: `+100 first entry on
   2 m Sprint`, `+10 run`, `+25 personal best`, `+250 podium · held`. Empty
   when the run earned nothing.
7. **Details**: the five seeds (seed, status, time), the `.onnx` link when the
   run offers a download, the training-environment link when there is one, a
   link back to the event.

Notes the page must carry when they apply: `withdrawn` (the run is off the
board), `not on the board` (an older runner version, or the author's own
better run outranks it).

### Two modes

`revealFor(run, me, reducedMotion)` is pure: reveal when `me.user === run.user`,
`!run.seen` and `reducedMotion` is false; plain otherwise. The page passes the
`prefers-reduced-motion` match.

**Plain.** Everything is shown at once. The replay loops, as on the race page.

**Reveal.** The section carries `data-act`, one value per beat, as Duck Jam
does; the scoreboard, pegboard and points are hidden until their beat. Every
beat sequences on `animationend`, never on a timer; the final number is in the
DOM before the theatre starts. Space skips to the end state.

| act | what happens |
| --- | --- |
| `race` | The replay plays once, not looping. It ends when the author's lane reaches its last frame. |
| `celebrate` | Finisher: `microduck-victory.wav` and confetti, Duck Jam's `confetti()` verbatim. DNF: neither; straight to the next act. |
| `verdict` | The scoreboard appears. The stamp slams onto the CRT panel, `stamp.wav` at contact. |
| `time` | The digits roll, `rollCounter()` verbatim, a `points.wav` tick per flap, driven off the rendered `--flip-at` as Duck Jam does. |
| `climb` | The pegboard appears with the author's row in the last slot. `.rank-climb` lifts it and slides it to its place; each displaced row gets `.rank-shuffle`. `rank-climb.wav`. Skipped when nothing is below. |
| `points` | Each receipt sticker appears in turn and flies to the chip; the chip gets `.jolt` and its counter rolls to the new total. In reveal mode the chip starts at `me.points` minus this run's receipts, since `/api/me` already counts them. |
| `rest` | `POST seen`. The replay resumes looping. |

`rollCounter`, `slam`, `confetti`, `ended` and `spread` are ported from
`dome/web/shared/animation.mjs` into `app/src/animation.js`; the climb and the
flight to the chip are new functions beside them, written the same way. The
sequencer is `app/src/reveal.js`; `app/src/run.js` is the page.

### Sound

`app/public/design/sound/`: `microduck-victory.wav`, `stamp.wav`,
`points.wav`, `rank-climb.wav`, `microduck-chirp.wav`, copied from Duck Jam
(about 200 KB). `app/src/sound.js` exports `cue(name)`: one `Audio` per file,
cloned per play, Duck Jam's volumes (`0.4`, the stamp at `0.6`), a refused play
swallowed.

### Viewer and player

`Player` gains `{loop = true, onEnd}`; with `loop: false` it holds the last
frame and calls `onEnd()` once. `viewer.setLanes(entries, event, playerOptions)`
passes them through. Nothing else in the viewer changes: the camera follows
the leader as it does today.

## The API

### `GET /api/runs/{run_id}`

Extended, not created. `frames` is dropped: it costs a full trace decode and
the page loads the trace anyway.

```json
{"run_id": "…", "event": {…event_summary…},
 "user": "alice", "policy_name": "walker-v3", "livery": "classic",
 "score": 8.412, "command_vx": 0.85, "seeds_finished": 5, "seeds_total": 5,
 "per_seed": [{"seed": 1, "status": "finish", "time_s": 8.1}],
 "trace_seed": 3, "submitted_at": "…",
 "offers_download": true, "policy_url": "…", "env_url": null,
 "withdrawn": false, "on_board": true, "rank": 7,
 "board": [{"rank": 5, "user": "bob", "policy_name": "…", "score": 7.9,
            "seeds_finished": 5, "run_id": "…", "livery": "sky", "you": false}],
 "receipts": [{"act": "first_event", "points": 100}, {"act": "run", "points": 10}],
 "seen": false}
```

- `rank`: the place this run would hold on the event's `by_user` board, the
  author's own row excluded: one plus the number of rows with a better
  `sort_key`. Equal to the board rank for the author's best run; defined too
  for a run beaten by the author's own better run, a withdrawn run, and an
  older runner version.
- `on_board`: whether this exact run is a row of the board.
- `board`: the window, in board order: up to two rows above, the run itself
  (`you: true`), up to five below. The scene takes the first three rows after
  `you`.
- `receipts`: `points.receipts(...)` filtered on this `run_id`, `act` and
  `points` only. Podium receipts are held, so this list can change between
  reads.
- `seen`: whether `seen/<run_id>.json` exists.

The fold is pure, in `arena/index.py`:

```python
def standing(records, run_id, *, withdrawn, above=2, below=5) -> Standing
# Standing(rank: int, on_board: bool, board: list[Row])
```

### `POST /api/runs/{run_id}/seen`

In `routes_submit.py`, beside `withdraw` and shaped like it: `_require_session`
→ 401, `_find_run` → 404, `record.user != session.username` → 403. Idempotent;
answers `{"seen": true}`.

### `GET /api/players/{user}`

`best` becomes `publications`: every run of the player, newest first.

```json
{"user": "alice", "points": 385, "rank": 1,
 "publications": [{"run_id": "…", "event_id": "sprint-2m",
   "event_title": "2 m Sprint", "policy_name": "walker-v3", "score": 8.412,
   "seeds_finished": 5, "seeds_total": 5, "rank": 7, "on_board": true,
   "withdrawn": false, "submitted_at": "…", "seen": false}]}
```

`rank` and `on_board` come from `standing`. 404 only when the player has no
run at all. `points` and `rank` are unchanged.

### `GET /api/me`

Signed in, two fields more: `points` (the player's standing total, `0` when
they have none) and `unseen` (the number of their runs with no `seen` file).

### Store

`Store` gains `mark_seen(run_id)` and `seen() -> frozenset[str]`. `LocalStore`
mirrors `withdraw` / `withdrawals`: `seen/<run_id>.json` holding
`{run_id, user, seen_at}`, an existing file left alone. `HubStore` mirrors its
own `withdraw`: `file_exists` then one commit, snapshot invalidated. Run files
are never rewritten.

## The ways in

- **Race page.** `onPublish` navigates to `runHref(published.run_id)` once the
  submit resolves. A board row of a published run navigates to its page on
  click; the lane checkbox, the icons and the links keep their own behaviour
  (a click on an interactive descendant does not navigate). Rows get
  `cursor: pointer`. Provisional rows do not navigate.
- **Profile.** `Best publications` becomes `Publications`: one card per
  publication, newest first, linking to the run page: event title,
  `#rank · time`, policy name, date. A withdrawn card is dimmed and says
  `withdrawn`. When the viewer is the profile's owner and `seen` is false, the
  card carries a red dot.
- **Chip.** `avatar · name · ✦ N` from `/api/me`; a red dot when `unseen > 0`.
  Signed out, unchanged.

## Files

New: `app/src/run.js`, `app/src/reveal.js`, `app/src/animation.js`,
`app/src/sound.js`, `app/public/design/sound/*.wav`.

Touched: `router.js`, `main.js`, `api.js`, `signage.js`, `player.js`,
`board.js`, `race.js`, `replay.js`, `viewer.js`, `race.css`;
`arena/store.py`, `arena/index.py`, `arena/web/routes_read.py`,
`arena/web/routes_submit.py`, `arena/web/routes_auth.py`.

The voting worktree touches `store.py`, `routes_read.py`, `router.js`,
`main.js` and `race.js` too. This design only adds; whichever lands second
rebases.

## Tests, kept to the minimum

Python: `standing` on fabricated records (rank with the own row excluded, the
window's shape, a withdrawn run); the `seen` route (owner 200 twice, other
user 403); the run detail's new fields present. JavaScript: `parseRoute` on
`#/r/…`; `revealFor`; the pegboard's row order before and after the climb as a
pure function. The theatre is checked in the browser, not in jsdom.

## Running it

```sh
cd app && npm run build && cd ..
uv run --frozen arena serve --store ~/arena-board --user nicolas
```

Publish a policy on an event and land on its page; the reveal plays once.
Open the same page as another dev user (`--user someone`) to see the plain
mode.
