# Gamified home page and player profiles — design

Date: 2026-09-15. Status: approved in brainstorm, awaiting written review.

## Goal

Add a gamification layer on top of the existing Microduck Arena: a player
profile tied to the Hugging Face account, points that measure contribution to
the platform, and one global ranking of players. The arenas themselves — the
event pages, their boards, podiums and 3D replays — are kept as they are.

The visual language of the new pages comes from the Duck Jam prototype
(`/Users/nicolasrabault/Projects/HuggingFace/duckJam`), whose home page has
the two sections we want, `Season standings` and `Pick your round`, and whose
design system is complete.

## Scope of this MVP

In:

- A rewritten home page `#/` with a header carrying the player chip top-right,
  a hero, `Season standings` (global ladder) and `Pick your round` (the arena's
  events, as flyers).
- A player page `#/p/<user>` showing avatar, name, total points, rank, and the
  player's best publication on every event they entered.
- A points module and two read-only API routes.
- Everything runs locally. **The live Space
  `pollen-robotics/microduck-arena` must not be touched**: no `git push`, no
  `scripts/deploy_space.py`. The clone's push URL is disabled on purpose.

Out, for later: the chip on event pages, visual harmonisation of event pages
with the new look, points history and breakdown, seasons, a full-ladder page,
live-programme and featured-results sections of the Duck Jam home.

## Decisions taken

1. **Points model C — contribution receipts plus a live podium bonus.**
   Duck Jam's schedule pays acts, never scores; its only rank-based line is
   "top three at close", and the arena never closes an event. So the closing
   bonus becomes "while you hold the place".
2. **Duck Jam's design system is imported** (tokens, components, effects,
   motion, fonts). Home and profile get the Duck Jam look; event pages keep
   their dark look for now.
3. **The profile is a route**, `#/p/<user>`, so ladder rows link to other
   players and the page is shareable.

## Points

### Module

`arena/points.py`, pure, no I/O. Input: the run records of every event and the
set of withdrawn run ids. It applies **exactly the board's filter** — current
`RUNNER_VERSION`, withdrawn runs excluded — so a run either counts everywhere
or nowhere. A run that passes the filter is a *counting run*.

### Receipts

| Act | Points | Rule |
|---|---|---|
| `first_event` | 100 | the player's earliest counting run on an event; once per (player, event) |
| `run` | 10 | every counting run, capped at 3 per player per UTC day, all events together; the first three of the day in (`submitted_at`, `run_id`) order pay |
| `own_best` | 25 | the first counting run that is strictly better than the player's previous best on that event, using `index.sort_key`; once per (player, event) |
| `podium` | 250 / 150 / 100 | ranks 1, 2, 3 of the event's leaderboard computed with `entrant=by_user`, only for rows with `seeds_finished > 0`; held, not earned — recomputed on every read |

A DNF row (`seeds_finished == 0`) scores the event's time limit, and any
finisher scores strictly less, so DNF rows always sort after every finisher:
skipping them never shifts a finisher's place.

A receipt is `(user, act, points, event_id, run_id, at)` where `at` is the
run's `submitted_at`. Receipts are never stored; the totals are re-derived
from the log on every request, like the board.

### Standings

Total per player is the sum of their receipts. Order: total descending, then
earliest counting run across all events, then username. One ladder, all
time; there is no season concept. The home section keeps the title
`Season standings`.

The podium always uses `by_user`, whatever `ARENA_RANK_BY` says, so a player
with several policies takes one podium place, not three.

### Why these numbers

They are Duck Jam's own for the acts that transfer (`first_round` 100,
`run` 10 capped 3/day, `own_best` 25, `close` 250/150/100). Duck Jam
calibrated them by simulation so a player who builds one duck finishes ahead
of a player who only shows up. Farming is bounded: 30 points a day plus a
one-off 25 per event.

## API

Both routes live in `arena/web/routes_read.py`, open to anyone like the
board, and shape `arena.points` output; no ranking logic in the web layer.

`GET /api/standings`

```json
{"rows": [{"rank": 1, "user": "alice", "points": 385}]}
```

All players with at least one counting run, in ladder order.

`GET /api/players/{user}`

```json
{"user": "alice", "points": 385, "rank": 1,
 "best": [{"event_id": "sprint-2m", "event_title": "Sprint 2 m", "rank": 1,
           "score": 12.34, "seeds_finished": 5, "seeds_total": 5,
           "policy_name": "walker-v3", "run_id": "…", "submitted_at": "…"}]}
```

`best` has one entry per event the player has a counting run on, in programme
order (`order`, `title`), holding the player's best run there and their rank
on that event's `by_user` leaderboard. 404 when the player has no counting
run.

`/api/me` is unchanged; the chip reads its `user`.

## Frontend

### Routes

`router.js` gains `^/p/([A-Za-z0-9._-]+)/?$` → `{view: "player", user}` and a
`playerHref(user)` helper. `main.js` dispatches three views and picks a theme:
`race` for `#/e/`, `club` for `#/` and `#/p/`.

### Two stylesheets, one active

`--ink` and `--paper` exist in both `app/src/style.css` and Duck Jam's
`tokens.css` with opposite meanings, so the two cannot be loaded together.
`index.html` links both sets with a `data-theme` attribute; `main.js` sets
`link.disabled` on every stylesheet whose theme is not the current view's.
The Google Fonts link goes away: Anton is now self-hosted by the design
tokens.

### Design import

`design/tokens.css`, `components.css`, `effects.css`, `motion.css` and
`fonts/` (four `.woff2` and the two OFL notices) are copied verbatim from Duck
Jam into `app/public/design/` and linked as static files so the tokens'
relative font URLs resolve. Page-specific rules that Duck Jam keeps inline in
its `index.html` — signage grid, door, chapter, ladder, challenge flyers,
profile — are extracted, trimmed to what these two pages use, into
`app/src/club.css`.

### Home `#/`, `home.js`

Replaces `menu.js`.

1. `header.signage`: brand (the arena's duck head, `h1` "Microduck Arena",
   mono label), and `nav.site-nav` holding the player chip.
2. `section.door`: eyebrow, hero title, lede — the arena's existing blurb.
3. `section.chapter.season-note`: `h3.eyebrow` "Season standings", then the
   ladder component: one `a.ladder-row` per player, rank, shell dot, `@user`,
   points, linking to `#/p/<user>`. Top 10 of `/api/standings`. Empty state:
   "Nobody has published yet."
4. `section.chapter.challenge-list`: `h3.eyebrow` "Pick your round", then
   `div.cabinets` with one `article.challenge-note` per event from
   `/api/events`, in programme order. An open event is `a.challenge-link` to
   `#/e/<id>` with eyebrow "Race", `h4.flyer-title`, a `.challenge-art` frame,
   the course facts line, and the standing record (star, leader, time) or
   "be the first". A planned event is a `div` with a `--planned` modifier and
   "course not built yet". The frame receives the 3D course still that
   `thumbnail.js` already renders, after the grid has painted, as `menu.js`
   does today.

### Player chip, `chip.js`

Reads `/api/me`. Signed in: `a.profile-chip[href="#/p/<user>"]` with the
avatar and the username. Signed out: `a.sticker` "Sign in with Hugging Face"
pointing at `signInHref()`. When `/api/me` is unreachable the chip renders
empty rather than a dead sign-in link.

### Avatar, `avatar.js`

`https://huggingface.co/api/avatars/<user>` with `referrerpolicy=no-referrer`;
verified to redirect to the CDN image. On `error` the `img` is replaced by a
🦆 span, which is what a local dev user sees. Nothing is stored server-side.

### Player page `#/p/<user>`, `player.js`

Same signage header as home. Then `header.profile-header` with the avatar,
eyebrow "Player", `h2` username. `div.profile-summary` with two stickers:
"✦ N points" and "#R". Then `h3.eyebrow` "Best publications" and
`ul.profile-results`: one `li` per `best` entry linking to `#/e/<event_id>`,
showing the event title, `#rank · time`, and the policy name. A 404 renders
"No publication yet" with a link back home.

### Deletions

`menu.js` and `menu.test.js` are replaced by `home.js`. `submit.js` and its
test, already superseded by `race.js`'s entry panel, are removed.

## Tests

Python, `tests/test_points.py`, on fabricated records via
`tests.test_store.make_record`: first publication pays once per event; the
daily cap keeps three runs and drops the fourth; own-best pays on the first
improvement and never again; podium pays 250/150/100 by user with DNF rows
skipped; withdrawn and old-runner runs count nowhere; ladder order and
tie-breaks. `tests/test_routes_read.py` gains `/api/standings` and
`/api/players/{user}` including the 404.

JS, vitest with jsdom: `home.test.js` (ladder rows and links, open and
planned flyers, chip signed in and out), `player.test.js` (summary stickers,
best list, 404 state, avatar fallback), `router.test.js` (new route).

## Running it

```sh
uv sync --extra dev
cd app && npm install && npm run build && cd ..
uv run arena serve --store ~/arena-board --user $USER
```

Open <http://127.0.0.1:8000>. Locally OAuth is off and the dev user is
permanently signed in; the ladder has entries once policies have been scored
with `arena score … --user <name> --store ~/arena-board`.
