# Voting, and the Swag Contest — design

Date: 2026-09-15. Status: approved in brainstorm, awaiting written review.

## Goal

Add **voting** to the Arena as a reusable capability, and ship **Swag Contest** as
its first client.

The Swag Contest races on exactly the environment of `sprint-2m` — same course,
same physics, same command — but it is not ranked on time. It is ranked on how
many people voted for it, counted over a **sliding seven-day window**, so an old
entry is never protected by seniority.

Voting is the point of the exercise. Swag Contest is a prototype of it. Every
rule below therefore lives in the event manifest, never in code that names
`swag-contest`: a future challenge becomes votable by adding a `[vote]` section
to its TOML, the way an event is already created without touching code.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **Swag Contest is its own event with its own submissions** | It reuses the sprint's course and physics but keeps its own log. You can enter a policy that is beautiful and slow without putting it on the sprint's board, and withdrawing from one does not withdraw from the other. Rules out reading votes over the existing `sprint-2m` entries. |
| **A ballot shows 2 to 4 ducks and the voter picks a colour** | Four is the target; fewer is allowed down to two, so the contest works from the moment a second duck exists. Rules out pairwise duels as the only shape (duckJam's model), which needs far more ballots to rank the same field. |
| **The colour is the LANE's, not the duck's** | `course.js` already carries `LANE_COLORS` — Pollen orange, sky, hi-vis lime, lavender, beak yellow — and `viewer.js` already refuses to repaint the robot, because painting a duck one flat colour *"erased every seam between shell, legs and head and left an unreadable silhouette"*. Every duck in a ballot therefore wears the same livery; only the travelling ring under it differs. Rules out two competing colour axes, which would make "the purple one" ambiguous. |
| **The draw assigns colours, so a ballot is anonymous** | The same duck comes out orange on one ballot and lavender on the next. Judgement lands on the gait, not on the handle. Rules out showing names during voting. |
| **The client never sees a `run_id`** | Traces are served through ballot-scoped URLs and a vote names a lane index, not an entry. Without this, one look at devtools plus `/api/runs/<id>` de-anonymises the ballot, and the anonymity above would be decorative. |
| **The score is a raw vote count over 7 days** | Readable without explanation — "43 votes this week" — and it needs no fitted model. Its weakness, that a count measures exposure as much as merit, is closed by the draw rather than by the arithmetic (below). Rules out Bradley-Terry (duckJam's model): a fitted strength cannot be printed next to a handle. |
| **The draw equalises exposure** | The pool is sorted by how often each entry has been *shown* in the window, and the least-shown are drawn first. With exposure equal, a raw count measures merit again. This costs nothing to log, because a ballot records all its candidates, not only its winner. |
| **A ballot pays its voter 2 points, capped at 20 a day** | duckJam's own numbers (`ballot: 2`, twenty per round), transposed to an arena that never closes a round: the cap becomes daily, the shape `run`'s daily cap already has. 40 points a day from voting, against 100 for a first entry on an event. |
| **The 21st ballot of the day is refused, not unpaid** | Accepting it would keep feeding the contest's own ranking, which is exactly what the cap exists to bound. |
| **The cap is enforced at the gate AND in the points fold** | duckJam states the reason best: *"a cap only a gate holds is a cap that a row written another way walks around"*. |
| **The author earns nothing per vote** | *"A score never converts into points"* is the rule the points module is built on. Authors earn from the **podium** instead, which `boards_by_user` already pays on every event and which now moves as the votes move. |
| **One ballot is one immutable file** | `votes/<YYYY-MM-DD>/<ballot_id>.json`, one commit each, exactly the thesis of the run log. Rules out a stored vote counter, which would break "the leaderboard is derived, never stored" and could not answer a sliding window anyway. |
| **Ballots get their own Hub snapshot, limited to the window** | Voting must not invalidate the runs snapshot, and reading must not get slower as the contest ages. Rules out pruning: the repo grows, reads do not. |
| ~~**The ballot is signed, not remembered**~~ **SUPERSEDED — the ballot is remembered, and its token is opaque** | The original decision was to seal the run ids into a signed token, for the elegance of holding no server state. **It was wrong, and review caught it in implementation**: `sign()` is an HMAC, and an HMAC proves the server wrote a value — it does not hide it. The payload is plain base64, so one `atob()` in devtools plus `/api/runs/{id}` names every author and maps them to lanes, which is the exact failure the lane-index API exists to prevent. Signing cannot be patched into secrecy without a cipher this project does not depend on. So the run ids stay on the server, behind a random opaque token, in an in-memory table — the same shape, and the same documented trade, as the session table two files away (`session.py`: "The table is in memory on purpose. It costs a restart logging everyone out… not worth a database"). A restart now costs a ballot in flight, which is a 15-minute object, not an 8-hour one. |
| **`index.py` is not touched** | Its `sort_key` means "lower is better" and is correct for the five timed events already live. The voted board is a separate function, chosen by `manifest.metric`. Two simple functions rather than one parameterised one. |
| **The Swag Contest pins one speed (`lo == hi`)** | The sweep exists to find where a policy is fastest, and the score here is not a time. More importantly every duck must walk at the *same commanded speed*, or the judgement lands on speed rather than style. Side effect: 6 simulations per submission instead of 36. |

### Known and accepted

- **No per-ballot repeat rule.** An earlier draft forbade a voter seeing the same
  four ducks twice; it was dropped in favour of the daily cap. With a small pool
  a voter will see repeated combinations, and that is accepted.
- **A variable ballot size skews early counts.** Being one of two is a 50%
  baseline, one of four is 25%, so votes cast while the pool is sparse are worth
  more than later ones. It disappears once the pool passes four, and the
  seven-day window flushes it from the ranking within a week. Not corrected.
- **Republishing resets your votes.** The pool holds one entry per person, their
  most recent; older votes stay attached to the older run, which has left the
  pool. Coherent with a window whose whole intent is that nothing is protected by
  age, but it must be stated on screen.
- **The cap is reversible at zero cost.** Points are derived from the log on every
  request, never stored, so changing each manifest's `per_day` applies
  retroactively to the whole history.

## The ballot log

### Record

The record lives in `store.py`, beside `RunRecord` and `Withdrawal` — records
live with the log, folds live in `index.py` / `points.py` / `votes.py`. It has to
be that way round: `votes.py` imports `RunRecord` exactly as `points.py` does, so
`store.py` importing `votes.py` would be a cycle.

```python
@dataclass(frozen=True)
class Ballot:
    ballot_id: str
    event_id: str
    voter: str
    cast_at: str                   # ISO-8601 UTC
    candidates: tuple[str, ...]    # run ids, IN LANE ORDER
    choice: str                    # one of candidates
```

There is **no colour field**. Lane *i* wears `LANE_COLORS[i]`, and the draw
shuffles `candidates`, so the order *is* the colour assignment — one fewer thing
to keep consistent.

Everything the system needs derives from this one record:

| Derived | How |
| --- | --- |
| a duck's score | times it appears as `choice` in the window |
| a duck's exposure | times it appears in `candidates` in the window |
| a voter's daily quota | their ballots on this event whose `cast_at` falls on today's UTC date |
| the audit trail | who voted for what, against whom, in which colour |

### `ballot_id`

**The ballot's own opaque token** — the `secrets.token_urlsafe(32)` the server
minted for it. Its alphabet is `[A-Za-z0-9_-]`, so it is a safe filename with
nothing to sanitise.

An earlier draft made it the MAC of a signed ballot and leaned on the log's
refusal to overwrite as the double-click guard. That guard does not hold: the
file is keyed on `cast_at`'s DAY, so one ballot voted at `23:59:59Z` and again at
`00:00:01Z` writes two files and counts twice. **The guard is the table entry
being single-use** — spent when the vote is recorded, clock-independent. The log
still refuses to overwrite, and the route still catches it, but as belt and
braces rather than as the mechanism.

### Storage

`votes/<YYYY-MM-DD>/<ballot_id>.json`. The day shard is load-bearing, not
cosmetic: it is what lets a reader ask for only the window.

`LocalBallots` and `HubBallots` live in `store.py`, beside their twins, because
they are the same thesis — *"the log is a git repo"*. They satisfy:

```python
class Ballots(Protocol):
    def cast(self, ballot: Ballot) -> None: ...
    def since(self, first_day: date) -> list[Ballot]: ...
```

`HubBallots` holds **its own snapshot**, downloaded with
`allow_patterns=[f"votes/{day}/*" …]` over the window plus one day. Three
consequences, all wanted:

- it never invalidates the runs snapshot, so voting does not slow the board down;
- read cost does not grow with the contest's age — in a year it is still eight
  days of ballots;
- therefore **nothing is ever pruned**: the repo grows, reads do not, and the log
  stays append-only.

`new_run_id()` in `store.py` is renamed `new_id()`. It now names two species of
thing. Ten call sites, mechanical.

## The draw

### The pool

The board's own filter, plus three rules:

| Rule | Why |
| --- | --- |
| current `runner_version`, not withdrawn | the existing filter, unchanged |
| `seeds_finished > 0` | a duck that falls at the line makes a dead lane |
| one entry per person, their most recent by `submitted_at` | in a raw count, two entries are twice the exposure |
| never your own | you cannot be handed your own duck |

### Picking

1. Shuffle the pool.
2. Sort by exposure in the window, ascending.
3. Keep the first `min(ballot_max, len(pool))`, and refuse a ballot below
   `ballot_min`.
4. Shuffle those, which fixes lane order and therefore colours.

Deterministic under a fixed seed, so it is testable. When exposure is equal —
the normal case — it is a uniform draw.

## The API

```
GET  /api/events/{id}/ballot
     → {state: "ballot", ballot: "<signed>", lanes: 3, cast_today: 7, per_day: 20}
     → {state: "too-few", have: 1, need: 2}
     → {state: "quota", cast_today: 20, per_day: 20}

GET  /api/ballots/{ballot}/lanes/{i}/trace
     → the same bytes the existing run-trace route serves

POST /api/events/{id}/vote   {ballot, lane: 2}
     → {points: 2, cast_today: 8}
```

`lanes` is a **count**, not a list of colours. The palette already lives in
`course.js` as `LANE_CSS`, and lane *i* wears entry *i*; sending the hex codes
would be a second copy of a list the client already has.

`ballot` is an **opaque random token** — `secrets.token_urlsafe(32)`, carrying no
information at all. The server holds what it stands for in memory: the event, the
voter, the run ids in lane order, and the moment it was issued. The client hands
the token back verbatim, and can learn nothing from it however hard it looks.
That is the whole point, and it is why the token is not a signed payload: an HMAC
proves the server wrote a value, it does not hide it, so a signed ballot would
carry its own run ids in readable base64 and `/api/runs/{id}` would name every
author. See the superseded row in Decisions.

The table closes four things:

- a ballot of four copies of your own duck cannot be forged — the client never
  supplies candidates, only a token the server minted;
- you cannot vote as someone else: the entry records its voter, re-compared to
  the session on both routes;
- the ballot **expires after 15 minutes**, so one held back cannot vote for an
  entry withdrawn since;
- **a ballot is single-use.** The entry is marked spent when its vote is
  recorded, so a double-click gets the same idempotent answer whatever the clock
  reads — the earlier scheme leaned on the log refusing to overwrite, which a
  ballot cast either side of UTC midnight walked straight around, because the two
  writes land in different day shards.

Its cost, taken deliberately: a restart drops ballots in flight, and a voter is
asked to draw a new field. That is the same trade `session.py` already documents
for the session table, on an object that lives fifteen minutes rather than eight
hours.

**The quota's check and its write are one critical section.** Reading
`cast_today` and appending the ballot are two steps, and the seconds between them
are a real window — the read scans a week of shards, and that scan grows with the
contest. Under a lock, four concurrent votes against a cap of one record one
ballot; without it, review recorded all four landing.

Both the lock and the ballot table are **per process**, and both would be
defeated by a second worker — a ballot issued by one would be unknown to the
other. That is safe here for a structural reason, not a hopeful one:
`arena/cli.py` calls `uvicorn.run()` with an app *instance* rather than an import
string, which is precisely the form uvicorn cannot fork workers from. Serving
this app on more than one process is therefore a deliberate code change, and it
is the change that would have to move both of these to shared storage.

The lock is one global rather than one per voter. It is held across a Hub
round-trip on a deployed Space, so voters queue behind each other's commits — at
twenty ballots a day per person that costs nothing, and a per-voter lock table is
machinery this does not need yet.

### Refusals

`GET /ballot` answers **200 with a `state`** for "too few ducks" and "quota
reached". Neither is an error — they are states of a voting session, and the page
renders each as a panel. Only the two below are real failures, and only `POST`
rejects a malformed ballot.

| Condition | Response |
| --- | --- |
| not signed in | 401 on both routes |
| event has no `[vote]` | 404 on both routes |
| fewer than `ballot_min` eligible ducks | `GET` → 200 `{state: "too-few", have, need}`; `POST` → 409 |
| daily quota reached | `GET` → 200 `{state: "quota", …}`; `POST` → 429 |
| bad signature, expired ballot, lane out of range, voter mismatch | `POST` → 400 |

## Ranking and points

### The voted board

In `arena/votes.py`, pure:

```python
def window(ballots, now, days)  -> list[Ballot]
def tally(ballots)              -> Counter        # run_id -> votes received
def impressions(ballots)        -> Counter        # run_id -> times shown
def standings(pool, ballots, …) -> list[Row]      # votes desc, then published first
```

`routes_read` chooses between `index.leaderboard` and `votes.standings` on
`manifest.metric`. The voted board still shows the finish time — it is measured
anyway — as a secondary fact, never as the rank.

### Points

`points.py` gains one act: `SCHEDULE["ballot"] = 2`.

A ballot pays **2 points to its voter**, capped at the first 20 of the UTC day
**per votable event** — the cap lives in each manifest's `per_day`, so a second
votable challenge grants its own twenty rather than sharing one pool. Same shape
as the existing `run` cap. `receipts()` takes the ballot log as a new argument.

**Ballot points are windowed, and each event's ballots are windowed by that
event's own `window_days`.** Two consequences, and review found the code getting
both wrong by accident before they were decided:

- A ballot pays only while it is inside its event's window. So voting points
  behave like the podium — held while you keep earning them, not banked — and
  unlike `first_event`, `run` and `own_best`, which are permanent. That is a
  real departure from "a point is a receipt for an act, and an act does not
  un-happen", and it is taken deliberately: paying every ballot forever means
  reading every ballot ever cast on every request, which is exactly the growth
  the day-sharded `allow_patterns` read exists to avoid. **This is the one
  decision here most worth revisiting** if the ladder feels wrong in use.
- The window is per event. Reading them all against the WIDEST window any
  votable event declares — which is what the board's fetch returns — would let a
  one-day event pay for five-day-old ballots merely because some other event
  declares thirty, and would retroactively restore everyone's lapsed points the
  day such an event was added.

The author earns nothing per vote, but earns the **podium**: `boards_by_user`
already pays 250/150/100 for holding a place on any event, and that applies to
the Swag Contest with no extra line once its board is ranked by votes. Leading
the swag contest is worth what leading the sprint is worth, and it moves when the
votes move.

**A voted podium pays only rows that actually hold votes.** With no ballots cast,
`votes.standings` falls back to its tie-break and ranks by publication time, so
the first person to enter would hold 250 points for having entered — which
`first_event` already pays them for. The timed podium has the same guard in a
different currency: it pays only rows with `seeds_finished > 0`, because a place
you reach without finishing is not a place held.

One seam: `boards_by_user` ranks every event with the same function today. It
must be given the ballot log and the set of voted event ids so it can choose.
`points.py` stays pure — it is handed what it needs and fetches nothing.

## The manifest

`manifest.py` gains:

- `"votes"` in `METRICS`;
- an optional `[vote]` section parsed into a frozen `Vote` dataclass, `None` when
  absent. Validation is strict and loud like the rest: `ballot_min >= 2`,
  `ballot_max >= ballot_min`, `window_days >= 1`, `per_day >= 1`.

`event_summary` publishes `vote` (the section, or `null`), which is what lights
up the frontend.

`arena/events/swag-contest.toml` is `sprint-2m.toml` with four changes:

```toml
id     = "swag-contest"
order  = 15
title  = "Swag Contest"
metric = "votes"

[sweep]                     # lo == hi: one regime for everybody
lo = 0.25
hi = 0.25
step = 0.05
finalists = 1

[vote]
ballot_min  = 2
ballot_max  = 4
window_days = 7
per_day     = 20
```

`[course]`, `[command]`, `[start]`, `[termination]` and `seeds` are copied
verbatim — "exactly the environment of 2 M Sprint".

## The frontend

Three entry points, all driven by `event.vote`. The frontend never names
`swag-contest`; a future votable challenge lights all three with no JS change.

**1. The flyer badge** (`home.js`). A `VOTE` sticker on the challenge note, in
the idiom already there (`sticker`, `flyer-tape`) rather than a new icon. The
standing line changes nature: `★ nicolas — 43 votes` instead of a time.
`standingLine` gains a voted variant.

**2. The button on the challenge page** (`race.js`). The title becomes a
title-and-button pair, the `Vote` button right-aligned, rendered only when
`event.vote` exists. Stage, entry column and board are otherwise untouched.

**3. The voting page**, route `#/v/<eventId>`, a fourth view in the router,
wearing the `race` stylesheet because it has a stage.

```
GET ballot → 2–4 lanes → load traces → viewer.setLanes → it loops
   ↓
click a colour → POST vote → GET the next ballot → it starts again
```

Every duck in a ballot wears the same livery. Lane identity is the **travelling
ring** under each duck — which `course.js` already calls the signal that
identifies a lane in motion — plus large colour buttons under the stage in the
matching `LANE_CSS`. The only viewer change is that `buildMarker(tier)` accepts
an explicit colour. The floor stripes are not touched.

### States

| State | What is shown |
| --- | --- |
| signed out | the Hugging Face button, as the entry panel does |
| fewer than `ballot_min` ducks | "2 ducks are needed, there is 1" and a link to the challenge |
| a ballot in play | the stage, the colour buttons, `7 / 20 today` |
| quota reached | "20 / 20 — come back tomorrow" and a link to the standings |

### A noted knob

At 0.25 m/s the reference walker takes ~18 s over 2 m, which is long for a
gesture meant to be quick. Nothing blocks — the replay loops and the voter clicks
when ready — and if it drags in use it is **one line of TOML** (`lo = hi = 0.40`,
~11.7 s), not a redesign. The replay deliberately plays at 1×: a gait judged at
double speed is a different gait.

## Tests

**Python** — the draw (exposure equalisation, own-entries excluded, the 2–4
range, refusal below `ballot_min`); ballot signing (forged, expired, impersonated,
lane out of range); double-click idempotence through `FileExistsError`; the
sliding window at its edges; the cap enforced at both the gate and the fold; the
voted board's ranking and tie-break; `[vote]` manifest validation.

**JavaScript** — `parseRoute` on `#/v/…`; the four page states; the flyer badge
and standing line with `event.vote` present and absent.

These follow the existing files: `test_points.py`, `test_manifest.py`,
`test_routes_read.py`, `router.test.js`, `home.test.js`.
