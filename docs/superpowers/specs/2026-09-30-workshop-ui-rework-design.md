# The workshop, redrawn as the Arena — design

Date: 2026-09-30. Status: agreed in conversation over mockups (2026-09-29/30), awaiting the
owner's review of this document.

Amends `2026-09-24-challenge-workshop-design.md` (*The workshop*) and the workshop parts of
`2026-09-29-workshop-publishes-and-enters-design.md`. The mechanics those describe stay unless
this document says otherwise.

## Goal

The workshop looks like the Microduck Arena's own pages and asks for one thing at a time. Today
it is one page of four stacked zones (Preflight, Train, Test, Publish), every control visible at
once, big yellow buttons everywhere. It becomes three pages built from the Arena's components: a
home, a page per challenge, a page per training job.

## Decisions (owner, 2026-09-29/30)

1. One workshop serves every open challenge of the checkout. `workshop` opens the home;
   `workshop <id>` (the one line) opens that challenge's page.
2. Header: the Arena's, with **Workshop** in place of **Arena**, and the account top right. The
   account card is also the way to log in: Hugging Face's browser login, no token to paste.
3. Home: the Arena's cover and yellow band; where the Arena has its pitch, channel and standings,
   a short pitch and a tilted post-it, **Ready to train?**, whose ticks are green; below, the
   open challenges as the Arena's flyers without results.
4. A challenge page: how to customise the training (which files), a training form that stays
   locked until the checkout is committed, and one ticket per training, LeLab-style.
5. Every checkpoint is evaluated automatically with the challenge's rules and kept, so a job
   page replays any checkpoint at once and a ticket shows its best.
6. A job page: the 3D replay with a checkpoint picker, the training curve, and **Publish &
   compete**. The colour and the speed choices go: every workshop entry races in `classic`,
   and a race is always swept.
7. The description is written for the commentators, Peter & Ray, and they read it: the Arena
   passes it to the commentary (its own section below).
8. Only the charter's three type faces (Anton, DM Sans, mono): the post-it reads as a to-do
   list through hand-drawn boxes and ticks, not through a handwriting font.

## The pages

The workshop's page stays one HTML page (`app/workshop.html`) with its own hash routes: `#/`
(home), `#/c/<event>` (challenge), `#/c/<event>/j/<job>` (job). It uses the Arena's stylesheets
as the Arena does: `club.css` on the home, `race.css` on the other two, switched the way
`router.js`'s `dress` switches them. `workshop.css` keeps only what the Arena has no component
for (the post-it, the ticket, the checkpoint bars, the checks). Mockups: local, not committed,
in `.superpowers/brainstorm/7640-1790750198/content/` (`home-v7.html`, `challenge.html`,
`job-v3.html`).

### Header

- **Home:** the Arena's `masthead` with the wordmark reading MICRODUCK / WORKSHOP, the account
  plate on the right, then the yellow band: *Back to the Arena · Join the flock · Create policies*.
- **Challenge and job pages:** the Arena's `signage` strip, same wordmark, the account chip on the
  right; the Arena's footer at the bottom of every page.
- **The account plate / chip**, in the Arena's `player-card` / `profile-chip` styles:
  - *checking…* while the Hub has not answered (the page never waits for it);
  - logged in: avatar and name;
  - logged out: **Log in to Hugging Face**. A click starts the browser login (below); the plate
    then reads *Waiting for huggingface.co…* until the login ends, and turns into the account;
  - Hub unreachable: *Hugging Face unreachable · Check again*.

### Home

- **Pitch:** eyebrow *Microduck workshop*, hero *Train your own duck.*, lede *Pick a challenge,
  then train, submit, compete, repeat.*
- **Ready to train?** A yellow post-it, tilted, cyan tape, title in Anton, one line per thing
  the machine is connected to. A line is ticked (green, `--lime-inked`) when it is in place;
  an unticked line carries a small **How?** that opens its guide inside the post-it, one guide
  open at a time:
  - **Hugging Face Jobs, billing set up.** Ticked when `whoami-v2` says `canPay`. Guide: Jobs
    rent a GPU by the minute; *Add a payment method* (huggingface.co/settings/billing, which
    asks to log in if needed), then **Check again**.
  - **Working in your fork.** Ticked when `origin` is a GitHub repository not owned by
    `pollen-robotics`. Guide: *Fork microduck-challenges* on GitHub, then paste the fork's
    address and **Use it**: the workshop renames `origin` to `upstream` and adds the fork as
    `origin` (no push).
  - **NVIDIA GPU on this machine.** Shown only when `nvidia-smi` is on the PATH, and then
    ticked: nothing to set up from here.
- **Pick your challenge:** the Arena's chequer and flyer wall, one flyer per open challenge
  (still, category, title, facts), no leader line, linking to `#/c/<event>`. A flyer carries a
  lime sticker *N training now* where the Arena puts *VOTE HERE*, while jobs of that challenge
  run.

### Challenge page

The race page's grid: the left column holds the head and the tickets, the right column (the
Arena's entry column) holds the form. At 420 px the form comes between the head and the tickets.

- **Head:** *Back to the challenges*, the category eyebrow, the title, the event's facts, one
  line *The Arena races your duck at every speed of the sweep and keeps its best* (races only)
  with *See the board on the Arena ↗*.
- **Make it yours:** one sentence, then the charter's `terminal` listing the challenge folder's
  files: `challenge.toml` (the reward weights and the recipe; Settings edits them), `env.py`
  (the whole training: rewards, commands, randomisation, terrain), `rewards.py` (your own reward
  terms: create it, then add them to `cfg.rewards` in `env.py`).
- **New training** (a cream card, the entry column's):
  - **Commit gate.** While `git status --porcelain` lists anything, the card shows those files,
    a message field pre-filled with `<event> training revision <YYYY-MM-DD HH:MM>`, and
    **Commit**; the form below is disabled. Without a git identity the gate shows the two
    `git config --global` commands instead of the button. Once committed: *✓ All committed ·
    <short sha>* and the form unlocks.
  - **Train on:** two stickers, *Hugging Face Jobs* and *This machine*. The default is this
    machine with an NVIDIA GPU, Hugging Face Jobs without. *This machine* is disabled without a
    GPU; *Hugging Face Jobs* is disabled while logged out or without billing, the reason said
    under it. Hugging Face Jobs: *One L4 GPU, billed to <user>*.
  - **Run name**, editable, `run-MMDD-HHMM` by default, validated as today.
  - **Settings**, closed by default, two named sections: **Rewards** (the knobs whose name
    ends in `_reward`) and **Recipe** (robots in parallel, iterations, seed, and any other knob,
    e.g. the hill's steepest training slope).
  - **Train**, the card's one orange button. Train writes the settings into `challenge.toml`,
    commits them when they changed (`<event>: run <name>`, as today), and launches.
- **Your trainings:** one ticket per training, newest first, a paper card with tape and a
  slight tilt, the whole card a link to its job page:
  - a status sticker (*Starting*, *Training*, *Done*, *Stopped*, *Failed*) and where it runs
    (*HF Jobs · L4*, *This machine*);
  - the run name;
  - while it runs, a progress bar *done / total iterations*;
  - one bar per checkpoint: the higher, the faster; magenta stub, no finisher; hatched,
    not evaluated yet; the best in orange with a star (races only);
  - *Best: checkpoint N · T s · f/5*, or why there is none;
  - *★ Published · T s on the Arena*, or *Not published*;
  - a running job has a small **Stop** (confirmed with `window.confirm`: a stopped HF job
    cannot be resumed).

### Job page

- **Head:** *Back to <challenge>*, eyebrow *Training · Hugging Face Jobs · L4* (or *This
  machine*), the run name as title, facts (started, code commit, robots, rewards), and while
  it runs a progress bar with the time left when known.
- **The deck:** the Arena's stage and transport, replaying the chosen checkpoint's best seed.
- **Checkpoints:** a bar per checkpoint slot of the run (saved ones evaluated, queued or failed;
  future ones dotted), the iteration under each. A click replays that checkpoint at once, from
  the stored evaluation. A race opens on its best checkpoint; a voted event opens on none.
- **Training:** the mean reward curve, from the run's TensorBoard files, always shown.
- **Output**, closed: the whole training log when this workshop is following the job; after a
  restart, a link to the job's page on Hugging Face.
- **Right column:**
  - the chosen checkpoint's score, the charter's `figure`: *Checkpoint N · ★ best*, *T s*,
    *f/5 seeds*, and *Indicative: only the Arena times an entry.*;
  - **Publish & compete** (cream card):
    - **Name**, required, `<folder>-<run>` by default;
    - **For the commentators**, required, with a small badge of the two commentators (Peter's
      and Ray's duck heads, Ray's in his blue) and *Peter & Ray read it on air when your duck
      races*; placeholder *What makes it behave like that? What did you change? Describe what
      it is doing.*;
    - two checks above the button: **Working in your fork** (ticked, or its home guide) and
      **Pushed to your fork** (*N commits are only on this machine* and **Push**). A nudge:
      Publish stays possible with either unticked;
    - a run whose provenance is `dirty` (trained from a shell with uncommitted changes) keeps
      today's rule: Publish is disabled until *publish anyway* is ticked;
    - **Publish and compete** (the orange button; *Pick a checkpoint* and disabled while none
      is chosen), then **Preview the Hub card** as a small sticker button;
    - while publishing: *Exporting, uploading and racing on the Arena (a minute or two)…*; on
      success a lime box: *Entered on <event>*, the official time, seeds and speed, *See it on
      the Arena ↗*, and the page opens as today; on failure the whole output, and the same
      button tries again. What is typed survives every redraw of the page.
  - **Stop this training** while it runs (confirmed).

## Mechanics

### One workshop, every open challenge

`Workshop` holds the checkout's open challenges by event id instead of one. `workshop [id]` opens
`http://127.0.0.1:<port>/#/c/<id>`, or `/` without an id; an unknown id is an error, as today.
The terminal list of challenges goes: the home is the chooser. `/status` answers the open
challenges (each with its event summary, its settings and how many of its trainings run), the
Arena's address, whether there is an NVIDIA GPU, and the fork state; nothing in it asks the network.

### Logging in

**Log in to Hugging Face** runs `uv run --no-sync hf auth login --force` as a subprocess. Without
a terminal, huggingface_hub 2.0 always takes the browser flow (OAuth device code): it prints the
URL, with the code filled in, and the code, then waits and saves the token itself. The workshop
reads the URL from the output and opens it in the browser. The page polls `/hub` until the
account appears; the subprocess is ended when the workshop closes (Ctrl-C stays under a second).

The launcher exports `HF_TOKEN` (uv needs it for the Arena wheel while that sits on a private
repo). huggingface_hub reads `HF_TOKEN` before the saved login, and only a saved login is
refreshed when it expires. So the workshop removes `HF_TOKEN` from its own environment at start
when it equals the saved token, and after a login in the page: every Hub call and subprocess then
reads the saved, refreshed login.

`/hub` answers `{user, reachable, can_pay}` (`canPay` from the same `whoami-v2` call, still
limited to 5 s in all).

### Committing

`GET /code` adds the list of changed files (`git status --porcelain`: status and path) and
whether git has an identity. `POST /code/commit {message}` commits everything (`git add -A`) with
the user's message, refused when the message is empty. Train refuses to launch while anything is
uncommitted (409), checked before it writes its own settings: a job always starts from a commit.

### Training

- `POST /challenges/{event}/train {name, where, recipe, params}`, `where` is `local` or `hf-jobs`.
  `local` is refused without an NVIDIA GPU, `hf-jobs` without a Hugging Face login.
- Several trainings at once: any number of HF jobs, at most one local training (one GPU; 409
  otherwise). The workshop keeps its trainings by name.
- Every training launched by the workshop is written down in `logs/workshop-jobs.json`, local
  ones too, with its challenge's task, where it runs, its recipe and start time.
- `POST /challenges/{event}/jobs/{id}/stop` stops a running training: an HF job is cancelled on
  the Hub first (a recorded one too, after a restart), then the local process ends. A local
  training whose workshop was closed has no process left and reads as stopped.

### Tickets

`GET /challenges/{event}/jobs` answers the challenge's tickets, newest first; `GET
/challenges/{event}/jobs/{id}?since=N` one ticket with its log lines from `N`, its curve and its
checkpoints. A ticket is:

- `id`: the job's name for a training launched by the workshop; the run directory's name for a
  run found on disk only (trained from a shell);
- `where`, `state`, `progress {done, total}`, `started`, `run_id` (null until the run's directory
  exists), `job_url` (an HF job's page), `dirty`;
- `checkpoints`: `[{n, status: evaluated | queued | failed, score, finished, total}]`, and `best`
  (null for a voted event or when nothing finishes);
- `published`: the latest publish of this run (checkpoint, repo, the `entered` line, page URL),
  or null.

**State.** A training this workshop follows: as today (running, finished, failed, stopped). A
recorded HF job it no longer follows: asked of the Hub (`inspect_job`, at most once a minute per
job): `SCHEDULING` is starting, `RUNNING` running, `COMPLETED` done, `CANCELED` stopped, `ERROR`
and `DELETED` failed. A run on disk with no live process: done when its last checkpoint reaches
the recipe's iterations, stopped otherwise.

**Checkpoints of HF jobs.** For every recorded HF job the Hub calls running, the workshop pulls
its checkpoint repo every 2 minutes, and once more when it ends, after a restart as well. The
*Fetch checkpoints* buttons go.

**Progress.** From the followed log (`Learning iteration X/Y`); otherwise the newest step in the
run's TensorBoard files or its newest checkpoint, over the recipe's iterations (the recorded
recipe, else `--agent.max-iterations` in `provenance.json`'s command).

### Evaluating every checkpoint

One background worker evaluates, one at a time, every checkpoint of the open challenges' runs
that has no stored result for the current `RUNNER_VERSION`: the newest ticket first, its
checkpoints in order. The evaluation is today's Test (`publish --run … --dry-run` export, then
`arena.evaluate` with the event's rules), stored as today next to the checkpoint, trace included.
Measured on this Mac: 26 s for one checkpoint of a walking policy (reference, checkpoint 1000);
a finished 3000-iteration run holds 13. A checkpoint file written less than 30 s ago waits (a
local training may still be writing it). A failed export is stored as a failure with the
checkpoint file's modification time, and tried again only when the file changes.

`GET /challenges/{event}/jobs/{id}/checkpoints/{n}` answers a stored evaluation with its trace
(404 while it is not evaluated). The page's *Test this checkpoint* button and `POST
/runs/{id}/trial` go.

**Best:** for a race, the checkpoint with the lowest score among those with at least one
finisher; the earlier one on a tie. A voted event has none.

### Publishing

`POST /challenges/{event}/jobs/{id}/publish {checkpoint, name, description, allow_dirty,
dry_run}`, both name and description required. It runs `publish` as today, without `--livery`
(the default is `classic`) and without `--speed` (the sweep). After a successful entry the
workshop writes it in the run's `workshop/published.json` (a list, newest last) for the ticket.

### Fork and push

- `POST /code/fork {url}` makes the pasted fork `origin` (Pollen's repository becomes
  `upstream`; a retry replaces `origin`), and pushes nothing. The `gh repo fork` path and the
  GitHub CLI check go.
- `POST /code/push` runs `git push -u origin HEAD` and nothing else: the commits already exist.

## Peter & Ray read the description

The published `manifest.json` already carries `description` (microduck_rl `publish`), and the
Space already reads the manifest at the pinned revision. So microduck_rl does not change.

- **Arena `submit`.** It keeps the manifest's `description` when it is a string, trimmed, of 1 to
  500 characters, and neither the training task's id nor the policy's name (the defaults
  `publish` falls back to). `RunRecord` gains `description: str | None = None`; older records
  read as None.
- **Commentary.** When a run has one, the context adds a fact quoting it as its author's words:
  `@<user> says about <policy>: "<description>"`. Only when it passes the same checks as any
  submitter text (printable, no markup, nothing machine-shaped, `label`), with a 280-character
  limit for this fact; otherwise no fact. The writer may use it, never as a result.
- The commentary's tone is not re-measured on the bench here (it costs LLM calls): the owner
  decides when.

## What goes

- Front end: `preflight.js`, `train.js`, `trial.js` and their tests; the four-zone `main.js`;
  the livery swatches and the speed menu in `publish.js`; everything in `workshop.css` the new
  pages do not use.
- Server: the token login (`POST /login {token}`, `Hub.login`); `GET /train`, `/train/stop`,
  `/train/pull`; `/jobs/{name}/pull`; `/runs`, `/runs/{id}/curve`, `/runs/{id}/trial`; the
  `gh` fork path and `gh_ready` where nothing else uses it; `git`, `uv`, `identity`, `gh` and
  `mode` in `/status`.
- The CLI's printed list of challenges.

## Behaviours kept, and where

| Kept | Where now |
|---|---|
| The page draws without waiting for the network | `/status` is local; the Hub is asked apart |
| The account asked apart: *checking…*, then *unreachable* with a retry | The account plate |
| Help to create an account when logged out | The browser login: huggingface.co offers sign-up |
| The HF Jobs billing note | The checklist line and the form's *Train on* hint |
| Test gives an indicative time with the replay | Every checkpoint, automatically; the job page |
| Publish and enter: official time, opens the entry, whole output on failure, same button retries | Publish & compete |
| A dirty run blocked until *publish anyway* | The job page |
| What is typed survives a redraw | The job page's form, across polls |
| Fork and push optional, a nudge | The checklist line and the two checks |
| HF jobs found after a restart | Tickets, now with their state and progress |
| Ctrl-C closes everything in under a second | Worker and watcher threads are daemons; the login subprocess is ended |

## Testing

- **Server** (`tests/workshop`), with the fake `uv` and an injected Hub (`whoami`, `can_pay`,
  `inspect_job`, `cancel_job`): several challenges; the commit gate and `/code/commit`; `where`
  and the one-local-training rule; tickets merged from live trainings, recorded jobs and runs on
  disk, with their state and progress; the evaluation worker's order, its 30 s wait, its stored
  failures; best; the login subprocess (a fake `hf` printing a URL and a code); the `HF_TOKEN`
  removal; publish without livery and speed, and `published.json`; fork without push, push alone.
- **Arena lot:** `submit` keeps or drops a manifest description by the rules above;
  `RunRecord` round-trips it and reads older records; the commentary fact appears only when the
  text passes.
- **Front end** (vitest): each page's states (checking, logged out, logged in, unreachable;
  checklist lines and guides; commit gate; *Train on*; ticket kinds; checkpoint bars; the job
  page's checks, dirty rule, voted event, draft kept).
- **Seen:** every page captured with headless Chrome at 1280 and 420 px and compared with the
  mockups and the Arena's race page, with the drivers that abort any write (Train, fork, push,
  publish). Nothing real is launched, forked, pushed or published without the owner's yes.

## Out of scope

- The swag's timeline in Publish: it comes with the swag stage's phase B.
- Deleting a ticket.
- An evaluation that jumps the queue for the checkpoint a user is looking at.
- The one line's 404 while the Space is private, and the order of release (unchanged).
