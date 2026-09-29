# The workshop publishes and enters — design

Date: 2026-09-29. Status: approved in conversation, awaiting the owner's review of this document.

Amends `2026-09-24-challenge-workshop-design.md`: its decision 8, the Publish zone of
*The workshop*, and *Submission* under *The Space*. Everything else there stands.

## Goal

The novice's journey ends in the workshop. They fill in a name, a description, a colour
and a speed, press **Publish and enter**, and land on their result's page on the Arena.
Nobody fills in a form on the Arena any more. The shell user does the same with one command.

## Decisions

Made with the owner on 2026-09-29.

1. **`uv run publish --enter` enters the policy.** It is the same command in the shell and in
   the workshop: after the upload it submits the repo, at the revision it just created, to
   the Arena. The workshop makes no call to the Space itself. This replaces decision 8, which
   opened the Space's page pre-filled and left the last click to the user.
2. **The Space authenticates a submission with the user's Hugging Face token**, sent as
   `Authorization: Bearer`. It resolves the name with `whoami-v2`, and then forgets the
   token. Guard rails: a repo outside the user's own namespace and orgs is refused. Each
   user has at most one submission racing at a time. The same policy entered again answers
   the entry already on the board. `submit` no longer accepts the session cookie.
3. **The challenge page no longer enters anything.** The entry panel goes: Hub repo, name,
   environment link, colour, speed, Test it, Publish, and the `.onnx` drop zone. So do the
   `?repo=&revision=&env=` pre-fill, the board's "your test" lane and the Space's `try`
   route. The page is for watching, voting, and finding the one line. Signing in stays in the
   header chip, for votes, points and withdrawing one's own entries.
4. **Testing a `.onnx` leaves the site.** A `.onnx` already in hand is tested locally
   (`arena score`) or published and entered with `uv run publish --onnx … --enter --event <id>`.
5. **"Train my robot" becomes "Train my own robot"**. Its "You need git, uv and a Hugging Face
   account…" sentence goes: each need is met where it arises. The uv install line stays, as
   the answer to the error a novice without uv sees: under the one line, in small print,
   "`uv: command not found`? Install uv, open a new terminal, paste the line again." with
   Astral's command.

## Security

What changes, measured against today.

- **What the Space receives.** Today, an OAuth access token scoped `openid profile`: it reads an
  identity, is used once at sign-in and is dropped. From now on, the user's Hugging Face token,
  in practice a *write* token, since it is the one `publish` uploads with and HF Jobs bill.
  Anyone who controls the Space's code or logs while someone enters could act as that person on
  the Hub: publish, delete, launch billed jobs. This is the real increase in trust. Mitigation:
  the token is read from the header, sent once to `whoami-v2`, and never stored, logged or
  echoed in an error. Tests hold each of these.
- **Cross-site requests.** A page on another site cannot send an `Authorization` header without
  a CORS preflight, and the Space answers none. Nothing like the cookie's `SameSite=None`
  exposure applies.
- **Scripted entries.** Any Hugging Face account can script submissions with its token. That is
  already possible with a session cookie, only easier now. A submission costs about thirty
  seconds of the Space's CPU. One submission racing per user (409 otherwise) keeps a single
  account from queueing many.
- **Credit.** Until now anyone signed in could enter someone else's public repo under their own
  name. `whoami-v2` names the user's orgs, so a repo is accepted only when its namespace is the
  user's or one of those orgs (403 otherwise, compared case-insensitively).
- **Where the token goes.** `publish --enter` sends it only to an `https://` Arena, or to
  `http://127.0.0.1` / `http://localhost` for a local `arena serve`. A forged launcher could
  steal the token anyway, since it runs code on the user's machine, so `--arena` adds no risk
  of its own.
- **What stays OAuth.** Signing in on the site, `/api/me`, votes, withdraw and seen are
  unchanged. A local `arena serve` (no OAuth configured) keeps its permanent dev user, and
  `submit` accepts any request there, with or without a token, and skips the namespace check:
  there is no real identity to check against.

## Components

### `uv run publish --enter` (microduck_rl, additive)

New options on `PublishConfig`, all inert without `--enter`:

| Option | Meaning |
|---|---|
| `--enter` | After the upload, enter the policy on the Arena |
| `--arena URL` | The Arena; default `https://pollen-robotics-microduck-arena.hf.space` |
| `--event ID` | The event, for a source that is not a challenge's (`--onnx`, a plain task); also written as the manifest's `arena.event`. Refused when the task belongs to a challenge, whose event is its own |
| `--livery NAME` | The colour on the board; default `classic` |
| `--speed M_S` | A pinned forward speed; omitted, the Arena sweeps |
| `--code-url URL` | The training environment's link (`env_url`), shown on the row |

Order of work in `run()`:

1. Before anything is uploaded, refuse when:
   - no event is known (neither the challenge's nor `--event`);
   - the Arena URL is neither `https://` nor loopback `http://`;
   - no token is found;
   - after `create_repo`, the repo is private ("the Arena reads public repos only: pass
     `--no-private`, or make the repo public").
2. Upload, as today.
3. `POST {arena}/api/events/{event}/submit`, multipart form, with the fields `repo_id`,
   `revision` (the commit's oid), `name` (the manifest's), `livery`, `command_vx` (the speed,
   or absent) and `env_url` (the code URL, or absent). Header `Authorization: Bearer <token>`.
   The timeout is generous: the Space races a whole sweep.
4. Print
   `[publish] entered on <event>: <score> s (<finished>/<total> seeds) at <vx> m/s → <page_url>`,
   where `page_url` is the one the Space answers with (below).
   On a refusal, print
   `[publish] uploaded <url>, but the Arena did not enter it: <the Space's detail>` and exit 3.

A retry is the same command again. A repeat upload of identical files may or may not make a
new commit; either way, the Space's idempotence (below) keeps the board free of doubles.

### The Space: `submit`

- **Identity.** With OAuth configured, `submit` reads `Authorization: Bearer <token>`. It calls
  `https://huggingface.co/api/whoami-v2` with it, off the event loop, with a 10 s limit:
  - no header: 401 "Enter from the workshop or `uv run publish --enter`";
  - refused (401 from the Hub): 401 "Hugging Face refused this token";
  - no answer: 503;
  - an answer whose `type` is not `user`: 403 (an entry is credited to a person).

  The cookie is not consulted. Without OAuth, the dev user, as today.
- **Namespace.** 403 unless `repo_id`'s namespace, case-folded, is the user's name or one of
  their orgs. Skipped without OAuth.
- **One at a time.** An in-memory set of users with a submission racing; 409 "Your previous
  entry is still racing." The user leaves the set when the request ends, whatever the outcome.
- **Idempotence.** After the policy is fetched and loaded (its sha256 known) and before it is
  raced: if a current-runner, not-withdrawn entry of this user on this event has the same
  `model_sha256`, the response is that entry's, with `"already_entered": true`. Nothing is
  raced or recorded. The speed is not part of the key: a record keeps the speed it scored at,
  not whether it was swept, and a pinned speed can only match or lose to the sweep, which
  already keeps the best one.
- **Only a repo.** The `file` field goes from `submit`: `repo_id` is required.
- **Where to look.** The answer carries `page_url`, the entry's result page as a browser can
  open it. On Hugging Face (the config reads `SPACE_ID`), that is
  `https://huggingface.co/spaces/<SPACE_ID>#/r/<run_id>`. That page opens a private Space
  with the visitor's huggingface.co login, and it hands the `#` to the Space's iframe
  (probed 2026-09-29 on the public Policy Playground: the iframe's src is
  `…hf.space/?__theme=system#/r/abc`). Elsewhere (a local `arena serve`) it is the
  request's own origin with `/#/r/<run_id>`.
- **`try` goes**, with its route, tests and the front end's `tryPolicy`.

### The workshop's Publish zone

- **Fields:**
  - **Name**: the repo `microduck-<slug>`, the manifest's name and the board's name, as
    today;
  - **Description**;
  - **Colour**: the four swatches of `liveries.js`'s `VARIANT_SWATCH_HEX`;
  - **Speed**: `format.js`'s `speedChoices(event)`, "Sweep" first and by default; hidden
    for an event without a sweep;
  - **Code**: the *Your code* zone, unchanged; the entry carries the code's link once
    it is shared.
- **Buttons:**
  - "Preview the Hub card", unchanged;
  - **"Publish and enter"**, the primary button, enabled once a checkpoint is chosen and a
    Hugging Face account is known.
- **Flow.** `POST /api/workshop/publish` gains `livery` and `speed`. It runs
  `uv run publish --run … --no-private --force --enter --arena <the workshop's arena>
  --livery … [--speed …] [--code-url …]`. It reads the `entered` line for the score and the
  `page_url`, and opens that page in the browser. The zone shows "Exporting,
  uploading and racing on the Arena (a minute or two)…", then the official time with the
  link.
- **Failure.** Exit 3 means published but not entered. The zone shows the whole output, and
  the same button tries again.
- **Removed:** `arena_link`, the `?repo=&revision=&env=` link, "enter it there".

### The challenge page

- The *Train my own robot* panel: the one line, Copy, the clone note, then the uv answer
  (decision 5). With the entry panel gone it is the page's call to action, and it opens by
  default.
- Removed:
  - `renderEntryPanel` and its CSS;
  - `dropzone.js`;
  - `entry.js`;
  - `insertProvisional` and the trial lane;
  - `tryPolicy`, `submitPolicy` and `policyForm`;
  - the entry column's "Sign in to race a policy".
- A failed withdrawal, said in the entry panel's status until now, is said in the board
  sheet.
- Text: `routes_submit.PUBLISH_A_REPO` and the guides (`train-a-policy.md`, each
  challenge's) say to enter with the workshop or `uv run publish … --enter`, and to test a
  `.onnx` with `arena score`.

### Guidance where each need arises (workshop)

- **Logged out of Hugging Face.** The Preflight line says "No account? Create one at
  huggingface.co/join, then create a token with write access
  (huggingface.co/settings/tokens/new?tokenType=write) and paste it here." It replaces
  `hf auth login`, which is not on a novice's PATH.
- **No GPU.** The Train zone adds that Hugging Face Jobs need a payment method on the account,
  with a link to huggingface.co/settings/billing.
- **git and uv.** Unchanged: the launcher says git is needed, and the page answers a missing uv.

## Testing

- **Space.** `whoami-v2` is replaced by an injected function, as `_username` is for OAuth.
  Cases:
  - the 401/403/409/503 answers above;
  - namespace and orgs;
  - the dev user without OAuth;
  - idempotence: the same sha, a withdrawn entry, an entry from before the current runner;
  - the token string absent from logs (`caplog`) and from every error body.
- **publish.** A local HTTP server stands in for the Arena. Checked: the header and form
  fields; the refusals before upload (no event, http to a non-loopback host, a private repo);
  the `entered` line; exit 3 with the Space's detail.
- **Workshop.** The fake `uv` prints the `entered` line. Checked: the flags passed, the run
  page opened, exit 3 shown, the form's colour and speed.
- **Pages.** The race page has no entry panel and shows the renamed panel with the uv answer;
  the workshop's Publish zone.
- **Rehearsal** on this Mac, with `arena serve` standing in for the Space: everything but a
  real upload. A real publish and entry needs the owner's yes, as before.

## Open points, probed first

- **Does hf.space pass `Authorization` through to the container?** Probe it on the private
  Space as it is now, and again once it is public. If it strips the header, the token goes in a
  `hf_token` form field instead, with the same guarantees.
- **Order of release.** microduck_rl's `publish --enter` first (PR #57's branch), then the
  Space (merge into main deploys it), then a new Arena wheel and the challenges relock, whose
  `mjlab-microduck` pin must carry `--enter`.

## Out of scope

- Racing a policy on the Space without entering it: `try` goes, and the workshop's Test stays
  local and indicative.
- An `arena enter` command, curl recipes: `publish --enter` is the one way.
- The one line's 404 while the Space is private: an open decision of plan 4, unchanged here.
