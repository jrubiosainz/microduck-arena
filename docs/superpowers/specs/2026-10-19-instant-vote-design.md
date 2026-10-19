# Instant vote — design (2026-10-19)

## Why

The owner, 2026-10-19: on the voting booth, a click on a ballot post-it "quite often takes several
tens of seconds" before the points animation plays, and as long again before the next field of
performances appears. He wants the click to play the animation at once and the next field to be
there right after it.

## What was measured

**On the Space itself** (its runtime log, 36 hours, 5,723 store refreshes, each a
`snapshot_download` that logs "Fetching N files"):

- The whole store (~1,800 files: everything but `*.mp4`/`*.png`) refreshed at an **unchanged**
  revision takes under a second (about 2,400 files/s).
- Refreshed at a **new** revision, after any commit to the dataset, it takes **10–25 s** on its
  own, and up to **57 s** when about twenty requests each start the same refresh at once: nothing
  stops concurrent readers from all refreshing.
- The votes window (~290 files) refreshes in at most 9 s, mostly under 5.

**From this Mac** (huggingface_hub 2.0.0, the version the Space runs): whole store cold 87 s, same
revision 0.4 s, next revision 24–28 s; votes window next revision 4.8 s.

**Why a new revision is slow.** `snapshot_download` lists the tree, then calls `hf_hub_download`
per file with the commit hash. A file already cached for an older commit has no pointer under the
new commit, so each regular (non-xet) file costs one HEAD request. Every commit makes a new
revision, and the dataset (`pollen-robotics/microduck-arena-runs`, 2,863 files, ~1,650 commits) is
committed to by votes, first visits (`seen/`), clip jobs and publications.

**What a vote waits for today.**

1. `POST /api/events/{id}/vote`, under `_vote_lock`: `_window()` refreshes the votes snapshot
   (stale after 10 s, and always after a cast), then `HubBallots.cast` does `file_exists` (a HEAD)
   and `create_commit`, then drops the votes snapshot.
2. Only then does the booth call `next()` (`app/src/vote.js`): `GET …/ballot` refreshes the votes
   snapshot again and reads `store.runs()` / `store.withdrawals()`. Their snapshot is older than its
   20 s TTL, and the vote just made a new revision, so this is the 10–57 s refresh.
3. Then one `GET …/trace` per lane, then the stage is rebuilt.
4. The ceremony's envelope seals and the stars fly only now: `runCeremony` waits on the promise
   `onPick` returns, and `onPick` awaits `next()` before returning the cast.

## Goals

- From the click, the envelope seals and the stars fly as soon as the post-it has landed (the
  ceremony's own 450 ms). The server's answer is never what the voter waits for.
- The next field is on stage right after the ceremony.
- Any store read after a commit costs about the tree listing (1–2 s), not 10–57 s. That benefits
  every page, not just the booth.

## Non-goals

- The draw, the quota, the points, the ceremony's look, the running order of a stage's ballot
  (shipped on this branch just before: `6b282a1`).
- Making a refresh's cost independent of the repo's size: the tree listing still grows with the
  file count.

## Anti-goals

- Celebrating a vote the server refused. A quota reached, a spent ballot or a dead ballot still
  answers before the envelope seals; only the answer becomes fast.
- A store read that sees a half-built snapshot.

## Accepted risk (the owner, 2026-10-19)

A vote is acknowledged before it reaches the Hub. If the Space dies between the answer and the
commit, that vote is lost although its voter saw the points. Three things keep that window to the
seconds the owner accepted:

- the commit is retried on any Hub error;
- the app's shutdown waits for the votes still owed;
- the Hub failing for longer does not keep acknowledging votes. The design's call: once a ballot
  has waited more than 30 s for its commit (an expired token, an outage), `cast` refuses new votes
  and the booth shows the refusal, as a Hub error does today. Otherwise a long outage followed by
  the restart that fixes it would lose every vote taken in between.

Also accepted, as the design's call: the Space is the only writer of `votes/`, but during a deploy
the old container may commit its last votes after the new one has loaded the log. Those votes are
missing from the new process's quota, board and points until its next restart. They are on the
Hub, so nothing is lost.

## Design

### 1. The booth plays the next field it already has (`app/src/vote.js`)

- A **field** is what `GET …/ballot` answers, plus, for a ballot, its lanes' traces made into
  entries. Loading one is today's first half of `next()`.
- **While a field is on screen, the next one is loaded** in the background. A ballot token lives
  15 minutes, so issuing the next one early costs nothing. Its draw does not yet count the vote
  about to be cast, which is negligible.
- **On a click**: `castVote`, then the cast is handed to the ceremony at once (seal, stars,
  counter), and the booth shows the next field as soon as it is loaded. That is usually already
  the case, otherwise as soon as it lands. It then starts loading the one after.
- The "N / 20 today" count shown after a vote comes from the cast's answer (`cast_today`). The
  prefetched ballot's own count was taken before this vote and is one short. When the cast's
  `cast_today` reaches `per_day`, the booth shows the quota panel and drops the prefetched field.
- A prefetched answer that is not a ballot (quota, too few ducks, signed out) is shown as today.
- **A dead ballot** (`DEAD_BALLOT_MESSAGE`) loads a fresh field rather than the prefetched one.
  Both were issued at about the same time, so both may have expired. It carries the message into
  the fresh field, as today.
- Any other error on the cast: unchanged. The message is shown and the buttons come back.

### 2. The vote log lives in memory (`arena/store.py` `HubBallots`, `arena/web/routes_vote.py`)

The Space is the only writer of `votes/`, so the log can be read from the Hub once and kept in
memory from then on.

- **`since(first_day)`**: the first call loads `votes/{day}/*` from `first_day` to today, as
  today's code does, into memory keyed by ballot id. A later call with an earlier `first_day`
  loads only the missing earlier days. A call never touches the network otherwise: votes cast
  after the load come from `cast`, in this process.
- **`cast(ballot)`**: refuses a ballot id it already holds (`FileExistsError`, as today), adds the
  ballot to memory, queues its commit and returns. No `file_exists`, no commit inside the request.
- **The writer**: one daemon thread drains the queue, one commit per ballot
  (`votes/{day}/{id}.json`, the same file and message as today). On any exception it logs and
  retries the same ballot after a backoff that doubles from 1 s up to 60 s, without limit: an
  acknowledged vote must land.
- **`flush(timeout)`** returns once the queue is empty or the timeout has passed. An app shutdown
  hook calls it, so a restart commits what the process acknowledged.
- **A stuck writer refuses votes**: `cast` raises when the oldest queued ballot has been waiting
  for more than 30 s. `cast_vote` answers it with a 503 and a sentence for the voter, for example
  "Votes cannot be saved right now. Try again in a minute.", which the booth already shows as it
  shows any refusal.
- `routes_vote.py`: `cast_vote` no longer makes Hub round trips under `_vote_lock`. The comment
  that names those three round trips is rewritten to say so.
- `LocalBallots` is unchanged.

### 3. The store refreshes by difference, one refresh at a time (`arena/store.py` `HubStore`)

Unchanged: the 20 s TTL, `refresh()`, and every write dropping the snapshot so its writer reads
it back at once.

- **Single flight**: the refresh runs under a lock and re-checks staleness once inside it.
  Concurrent readers wait for the one refresh instead of each running their own.
- **A refresh**:
  1. reads the head commit (`repo_info`) and the tree at that commit (`list_repo_tree`,
     recursive). It keeps the files that are neither `*.mp4`/`*.png` (as today) nor under
     `votes/`: the store never reads votes, and otherwise every vote would be a download;
  2. if the head commit is the one the current snapshot was built from, it only restarts the TTL;
  3. otherwise it builds a new folder for that commit, one absolute symlink per file. A file
     whose blob id is unchanged links to where the previous folder's link points. A new or changed
     file links to the file `hf_hub_download` fetches into the Hub cache at that commit, through a
     small thread pool (a cold start fetches every file, like today's `snapshot_download`). A file
     gone from the tree is simply not linked;
  4. points the snapshot at the new folder, then deletes the folders older than the previous one.
     A reader still holding the previous folder keeps working, and deleting a folder of symlinks
     never touches the Hub cache.
- All network calls go through `self.api` (`HfApi` has `repo_info`, `list_repo_tree`,
  `hf_hub_download`), so tests can pass a fake.

## Testing

- **Front** (vitest, `api.js` mocked as `vote.solo.test.js` does): the promise `onPick` returns
  settles when `castVote` does, while the next field is still loading. After the vote the
  prefetched field takes the stage and the count reads the cast's `cast_today`. The day's last
  vote shows the quota panel. A dead ballot loads a fresh field with the message.
- **Ballots** (pytest, fake `api`): `since` loads once and then never calls the network. An
  earlier `first_day` loads only the missing days. `cast` is in `since` at once and committed by
  the writer. A failing commit is retried until it lands (the backoff is injectable so the test
  does not sleep). `flush` waits for the queue. A duplicate id is refused. A ballot waiting more
  than 30 s makes the next `cast` raise, and `cast_vote` answers 503 with the sentence.
- **Store** (pytest, fake `api`, `tmp_path`): an unchanged head builds nothing. A new head fetches
  only new or changed files and links the rest. A removed file disappears. `votes/` and media are
  never fetched. The previous folder survives one refresh. Concurrent readers cause one refresh.
- **On the Space after deploy**: the runtime log's "Fetching N files" lines stop after the boot.
  Time a vote by hand, from the click to the stars and to the next field.

## Left to the builder

How the booth's code is split, the backoff's exact injection point, the thread pool's size, where
the snapshot folders live (a per-process temporary directory is fine), and the log lines.
