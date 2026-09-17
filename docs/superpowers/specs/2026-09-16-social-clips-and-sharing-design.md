# Social clips and sharing — design

Date: 2026-09-16. Status: implemented on branch social-clips, awaiting the owner's browser check and the first Space render.

## Goal

Every **published** run gets two short videos made for social networks — a
landscape 1920×1080 and a vertical 1080×1920 — rendered on the server in the
background the moment the publish completes. Each clip is the arena's own
stage: the author's duck racing the three ducks ranked just under it, every
duck wearing its `@name`, a stadium crowd that follows the race and reacts to
the verdict, a title over the waiting ducks while the camera travels to the
start, an air horn for the off, a crowd that builds to the line, the `VICTORY` or
`DNF` stamp slamming down on the author's duck with the time, the place and the points.

On the publication page (`#/r/<run_id>`), under the points, a row of stickers
shares the result: X and LinkedIn open with the post pre-filled; Instagram and
TikTok copy the post to the clipboard and download the vertical clip, or hand
both to the phone's share sheet; two more stickers download the clips. A server
route `/r/<run_id>` carries Open Graph tags so a pasted link unfurls with the
poster and the video.

The clips are made to be reused later by a live programme (Duck Jam's HLS
producer, out of scope here): they keep its container contract.

## What Duck Jam has, and what is new

Duck Jam renders a clip per scored run in a Hugging Face Job: headless Chromium
photographs a three.js page frame by frame over the DevTools protocol, ffmpeg
encodes H.264 and mixes a crowd synthesised in the page with the sound kit's
cues (`dome/media/{record,clip,stage,audio}.mjs`, `design/sound/stadium*.mjs`).
Its results page has the share row (`dome/web/features/results/sharing.mjs`):
X and LinkedIn intents, Instagram and TikTok as copy-and-download buttons,
download stickers with `?download=true`, inline SVG logos, and the post text
composed from `design/strings.json`. Its gate serves `/r/<id>` with OG tags.

What is new here: the clip is rendered **inside the Space itself** by a
background worker rather than a Job; the recorder is **Python**, not Node; the
soundtrack is rendered **in one block** in the page rather than mixed by
ffmpeg; the stage is the **arena's viewer** with four named lanes rather than
Duck Jam's one-duck-and-ghost stage; the clip's framing, duration and sounds
are **configured per event** in its manifest; the post text is composed
**client-side** from the run detail rather than stored as `post.json`.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **Render in the Space, in a background worker** | One image, one deploy, no Jobs token or billing, and `arena serve` renders locally the same way. Rules out HF Jobs (a second image, a launcher token, a drain for lost jobs) and browser-side capture (H.264/AAC missing on Linux and Firefox, the author must stay on the page, and an uploaded file cannot be trusted by the live programme). Cost: Chromium and ffmpeg in the image (~600 MB), minutes of CPU per publish on cpu-basic, under `nice`. |
| **The recorder is Python** | The Chrome driver is 60 lines of DevTools JSON over a websocket and ffmpeg is a subprocess. One server language, no Node binary in the runtime image. Adds `websockets` to the dependencies. |
| **Both layouts render concurrently when cores allow** | One Chrome per run, one tab per layout, up to `ARENA_CLIP_PARALLEL` tabs at once (default `cpu_count // 2`): sequential on a 2-vCPU Space where SwiftShader already uses every core, both at once on a laptop. The soundtrack is rendered once per run and shared. |
| **The capture path is chosen by measurement, not guessed** | On Duck Jam a frame cost 0.5 s of which 8 ms was JavaScript; the split between SwiftShader rasterisation and PNG encoding is unknown. The plan's first task measures three paths on the arena's scene and applies a stated rule (see *Capture*). |
| **The soundtrack is one offline render** | Everything is known before the first frame — the trace, the tape end, the verdict — so the page computes the whole score and renders crowd and cues in a single `OfflineAudioContext` pass with a limiter. Rules out segment-by-segment crowd renders smoothed afterwards, and ffmpeg's `adelay`/`amix` graph: ffmpeg receives one PCM track and muxes it. |
| **The stage is the arena's viewer in a manual mode** | `viewer.js` gains `manual: true` (no animation loop, no controls) and `frame(seconds)`. The clip and the publication page share one drawing, so they cannot drift. Rules out a second stage module. |
| **Names are 3D nameplates over each duck** | Ported from Duck Jam's `plate.mjs`: a canvas-textured sprite in the lane's colour, hung above the trunk. Four ducks on one stage need names on the ducks, not in a corner. The publication page does not enable them yet. |
| **Per-event `[clip]` configuration** | Tape ceiling, camera and sounds live in the event manifest with defaults, so a jump or a hold can frame and score its clip differently without a code change. |
| **Clip state is three write-once files** | `pending.json`, then either `clip.json` with the media or `failed.json`. The store stays append-only: no file is rewritten. State is read by presence. |
| **Media files stay out of the Hub snapshot** | `HubStore` ignores `*.mp4` and `*.png` when it downloads the run log and fetches a clip file on demand, cached. Otherwise every boot would download the whole video library. |
| **Downloads stream through the Space** | The dataset is private, so there is no Hub URL to redirect to. Same-origin also means `<a download>` works without Duck Jam's `?download=true` trick; `?download=1` is still honoured so a link opened in a new tab saves rather than plays. |
| **The post is composed client-side** | The page already has the run detail; composing there means the place and the points are never stale. Rules out a stored `post.json` (Duck Jam's way, useful to a bot that does not exist here). |
| **`/r/<run_id>` unfurls** | Without OG tags a pasted link shows nothing. The route is server-side HTML with the tags and a redirect to `#/r/<id>`. It only helps once the Space is public — a deployment setting, not code. |
| **Historical runs are not rendered automatically** | Only runs marked `pending.json` at publish are drained at boot. `arena clip <run_id>` renders one by hand. Rules out a boot that renders 35 runs for hours. |
| **Tests stay at the minimum** | Store state, worker with a fake recorder, routes, post text, frame plan. The theatre is checked in a browser and the render in a player. |

## The flow

1. `POST /api/events/{id}/submit` evaluates and appends the run as today, then,
   if the renderer is available, writes `clips/<run_id>/pending.json` and
   enqueues the run.
2. The browser lands on `#/r/<run_id>` and the reveal plays. The share row is
   there from the first paint, veiled, and is unveiled with the rest at
   `settle`. The page asks `GET /api/runs/{id}/clip` and, while `pending`,
   asks again every 5 s.
3. The worker takes the run, launches Chrome, opens `clip.html` once per
   layout, renders the soundtrack once, captures the frames, encodes with
   ffmpeg, and writes `clip.json`, `landscape.mp4`, `vertical.mp4` and
   `poster.png` in one store write. On any failure it writes `failed.json`
   with the reason.
4. The clip stickers turn from `Clip · rendering…` into downloads. Instagram
   and TikTok now download the vertical clip along with copying the post.

## The rendering pipeline

### The worker — `arena/clips.py`

```python
class ClipRenderer:
    available: bool                 # Chrome found, ffmpeg on PATH, clip.html in the bundle
    def enqueue(self, run_id: str) -> None
    def drain(self) -> None         # enqueue store.pending_clips()
```

One daemon thread and a `queue.Queue`, started by `create_app` and drained at
startup the way `recover` is. A job renders every layout of one run (see
*Parallelism*), then `store.put_clip(run_id, files)`; an exception or a
15-minute timeout ends in `store.fail_clip(run_id, reason)` and a printed line.
Runs are processed one at a time; a redeploy that kills a job leaves its
`pending.json`, and the next boot drains it.

The renderer is constructed with the origin the page is served from
(`http://127.0.0.1:<port>`, from `arena serve`'s own arguments or
`ARENA_ORIGIN`), the frontend directory (for `clip.html` and `sound/`), and
`ARENA_CLIP_PARALLEL`.

Every subprocess — Chrome, ffmpeg — runs under `nice -n 10`, so a render never
starves an evaluation.

### The recorder — `arena/recorder.py`

One layout of one run, in the order Duck Jam's `record.mjs` does it:

1. Chrome is launched once per run with `--headless=new --hide-scrollbars
   --no-first-run --use-angle=swiftshader --enable-unsafe-swiftshader
   --no-sandbox --user-data-dir=<tmp> --remote-debugging-port=0`; the DevTools
   endpoint is read from its stderr; the client is `websockets.sync`. The
   binary is `$CHROME`, else the first of Chrome and Chromium at their usual
   macOS and Linux paths.
2. Per layout, a target is created, its viewport set to exactly the layout's
   size with `deviceScaleFactor: 1`, and it navigates to
   `<origin>/clip.html?run=<id>&layout=<landscape|vertical>&frame=0`.
3. The recorder waits for `window.clip.ready` (60 s cap) and
   `document.fonts.ready`, then reads `window.clip.plan` and
   `window.clip.error`. An error is a failed render, never a blank video.
4. The soundtrack is rendered in the page (`window.clip.soundtrack()`), once
   per run, and transferred as base64 in chunks of at most 4 MB.
5. Frames: for `i` in `0..plan.frames`, `window.clip.draw(i)` then one capture
   (see *Capture*), piped into ffmpeg. The poster frame is also kept as PNG.
6. ffmpeg: `-c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p`, the PCM as
   `-f f32le -ar 48000 -ac 2`, `-c:a aac -b:a 192k`, `-shortest`,
   `-metadata crowdMixed=true -movflags +faststart+use_metadata_tags`.
7. Chrome is closed with `Browser.close` raced against 2 s, then killed;
   Chrome outlives a SIGTERM.
8. A timing record is returned with the bytes: frames, seconds, draw and
   capture milliseconds per frame, total wall time, and the machine's cores
   and load. It goes into `clip.json` so the Space's real cost is on record.

### Capture

Three paths are measured on the arena's scene — four ducks, 1080p, SwiftShader,
antialias on and off — and the fastest that works in the Debian `chromium`
build is the one implemented. Only one path ships.

| Path | What changes | What it imposes |
| --- | --- | --- |
| `Page.captureScreenshot` PNG | Duck Jam as is | nothing |
| `Page.captureScreenshot` JPEG q92 | image encoding two to three times cheaper | nothing: the overlay stays HTML/CSS |
| WebCodecs in the page | no round trip per frame: `new VideoFrame(canvas)` → `VideoEncoder` VP9 → an IVF container written in the page → one transfer; ffmpeg transcodes to H.264 | the overlay must be drawn into the canvas with Canvas2D, reading fonts and colours from computed styles as the nameplate does |

The rule: if rasterisation dominates the frame cost, JPEG screenshots take the
gain and the overlay stays in the design system. If capture dominates,
WebCodecs with a Canvas2D overlay. The prediction is that rasterisation
dominates. The poster is a PNG in both cases.

### Parallelism

`ARENA_CLIP_PARALLEL` tabs render at once inside the one Chrome, each with its
own ffmpeg. With the default `max(1, cpu_count // 2)` the Space renders the
two layouts one after the other and a 10-core laptop renders both together.
The soundtrack is rendered by the first tab and reused.

### Availability

`ClipRenderer.available` is true when a Chrome binary is found, `ffmpeg` is on
the PATH and `<frontend_dir>/clip.html` exists. When false, a publish writes no
`pending.json`, `GET …/clip` answers `none`, and the page shows the network
stickers with no downloads. Nothing is logged as an error: a developer machine
without Chromium is a supported configuration.

### The CLI

`arena clip <run_id> --store DIR` starts the app on an ephemeral port in a
thread, renders the run, writes into the store, and exits. It is the test rig
and the way a historical run gets a clip.

### The image

```dockerfile
FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME=/usr/bin/chromium
RUN chromium --version && ffmpeg -version
RUN useradd -m -u 1000 user
USER user
```

The comment that refuses `libgl1` is rewritten: the renderer needs Mesa now.
`fonts-liberation` is the fallback family for glyphs Anton and DM Sans lack.
The build tripwire fails an image whose apt layer is broken before it can boot
and render nothing.

## The clip page — `app/clip.html`, `app/src/clip/`

A second Vite entry (`build.rollupOptions.input: { main, clip }`), served by
the static mount at `/clip.html`. It loads `/design/tokens.css`,
`/design/effects.css`, `/design/components.css` and a static `/clip.css` for
the frame's placement, exactly as Duck Jam's `clip.html` places its objects
without setting a colour or a face of its own.

### Reading the run

`?run=<id>` → `getRun`, then `getTrace` for the four lanes `lanesFor` picks —
the run's row and the three under it, as on the publication page. `run.event`
carries the `[clip]` configuration (see below).

### The viewer in manual mode

`createViewer(canvas, { rig, manual: true, camera })`:

- `manual` skips `requestAnimationFrame`, `OrbitControls` and the brightness
  preference. `tick` is split into `advance(now)` and `draw()`, and
  `frame(seconds)` is `player.seek(seconds)` then `draw()`.
- `camera` is a spec (below). Without one the viewer behaves exactly as today:
  the chase camera at `(lead − 0.35, 0.34, sideOffset)` looking at
  `(lead, 0.12, 0)`.
- Each `setLanes` entry may carry `name`; a nameplate sprite is hung above
  that lane's trunk and moved with it in `draw`. `app/src/plate.js` is the
  port of Duck Jam's `nameplate` only: the face read from `.mono-label`'s
  computed style, three texture pixels per CSS pixel, `SRGBColorSpace`,
  `depthWrite: false`, the lane's colour on deep ink. Height and lift are
  constants tuned in the browser.
- The vertical layout backs the camera off by a constant factor; the same
  spec serves both layouts.

### The plan

25 fps. The author's trace is 50 Hz, so one clip frame is two trace frames.

```
settle = the lanes' settle frames  # 26 for 0.5 s; 0 if none of them was stored with one
steps  = settle + min(frameCount(author), tape_max_s / CTRL_DT)
intro  = 75                       # 3 s
travel = 60                       # 2.4 s of it: the camera's travel to the chase
tape   = ceil(steps / 2)
outro  = 63                       # 2.5 s
frames = intro + tape + outro
poster = intro + floor(tape × 0.6)
```

Each lane plays `leadIn(settle, trace)`: its settle, then its trace, so the
tape starts where the simulation did — the ducks standing in the `STAND` pose
under the title, the settle from the horn — with a missing settle made up by
holding the trace's first frame, so older runs keep in step. The clock reads
`00:00.00` until the settle is over.

`draw(i)`: intro frames pose step 0 under the title, the camera
`travelPose(chase, min(1, i / travel))` of the way round from ahead of the line
to the chase, which it holds for the last 0.6 s; tape frames pose
step `(i − intro) × 2`; outro frames hold the last step under the stamp and
the figures. Rivals that finish first wait at the line; rivals still running
when the author's trace ends are cut with it, as the reveal does. A run longer
than `tape_max_s` — a timeout — is cut at the ceiling and stamped anyway: the
verdict is the record's, not the tape's.

`window.clip = { plan, score, layout, draw, soundtrack, chunk, ready, error }`.
The recorder reads and calls nothing else.

### The frame

| Act | Picture | Sound |
| --- | --- | --- |
| Title | The waiting ducks on the stage, the author's in the foreground; over the sky, eyebrow `Microduck Arena`, the event title, `@user · policy` on a shade of ink. No OSD yet, and the vertical top band keeps its words for the horn | the crowd waiting; the air horn at the intro's end, as the title leaves |
| Tape | The stage full frame, four named ducks. OSD: `● REC · @user · policy` top-left, the clock `00:00.00` bottom-right, the event title bottom-left (landscape). Vertical: a top band with eyebrow, title and `@user · policy`, and the figures band at the bottom throughout | the crowd |
| Outro | The last frame frozen. The stamp `VICTORY` (lime) or `DNF` (magenta), `fx-tilt-2-5`, centred on the author's duck where the viewer's `spot` says it stands. The figures band: the time (`formatScore`), the place (`#rank`, or `—` off the board or withdrawn), the points (`+N`, or `—` at zero); under it the weights' address without its scheme when `policy_url` is set | `stamp.wav` at the tape end; `microduck-victory-echo.mp3` or `microduck-fall.wav` 160 ms later; the crowd turns to the verdict |

Landscape shows the figures band only in the outro, over the frozen frame.

### The soundtrack in one block

Before any frame, the page builds the **score**:

- `crowdDirection = { start: intro / fps, end: (intro + tape) / fps, verdict,
  progress }` where `verdict` is `pass` when `seeds_finished > 0`, else
  `fail`, and `progress` samples the author's trunk `x / length_m`, clamped to
  `[0, 1]`, every 0.5 s of tape. `stadiumDirection` turns it into a pure
  function of time: play rises with the tape, encouragement follows progress,
  the start horn raises a surge that never settles back — it builds with the
  author's progress, joy creeping in with its square on a pass — and joy or
  sadness is full 0.2 s before the line, as a real crowd sees it coming, and
  holds over the outro.
- `cues`: `air-horn.mp3` at the tape start, `stamp.wav` at the tape end, the
  verdict voice at tape end + 0.16 s — each `{ at, file, gain, room }`, only
  from the sources the event lists. A cue in the `room` (the fall) is heard
  only as the stadium's reverb and echoes of it, never dry; the horn and the
  victory, whose echo Nicolas put in their files, and the stamp go to the mix
  dry.

`soundtrack()` renders **one** `OfflineAudioContext` of `frames / fps`
seconds at 48 kHz stereo: `renderStadium`'s voices driven by the direction,
every cue decoded with `decodeAudioData` and scheduled as a `BufferSource` at
its instant, a `DynamicsCompressor` set as a limiter at the output so no
sample reaches ±1 — the live programme refuses a clip that clips. The
interleaved float32 buffer is the whole soundtrack; it is rendered once per
run and given to both layouts' ffmpeg as `-f f32le`. Gains are measured on a
real render: the stadium at half its own volume so its protection compressor
leaves the crowd room to build, made up by ×3 after it; horn 2, stamp 0.6 and
victory 7 dry; fall 0.45 into the stadium's echo (it plays over a crowd gone
quiet). Chrome's limiter adds make-up gain, so the sprint's joy and victory
together peak at 0.95: pushing either higher clips.

`app/src/clip/stadium.js` and `app/src/clip/direction.js` are Duck Jam's
`design/sound/stadium.mjs` and `stadium-direction.mjs`, ported with their
origin in a header comment; the direction's start surge, its build to the line
and its early verdict are this repository's.

### Sound sources

A source is a function `(run, traces, plan) → cues[]`, registered by name.
Three exist: `crowd` (which contributes the direction rather than cues),
`horn`, `verdict`. An event's `sounds` list says which contribute; adding a
source — a `duck` foley track computed from the trace, a simulator's own
audio — is one function and one name, and is out of scope until such a sound
exists.

### The horn

`air-horn.mp3`, made for the arena by Nicolas Rabault with its echo in the
file, the same for every event.

### The live contract

Kept verbatim for the programme that will consume these clips: 25 fps, so the
duration is a whole multiple of 40 ms; `crowdMixed=true` as a container tag
and in `clip.json`; `crowdDirection { start, end, verdict }` in `clip.json`;
1920×1080 and 1080×1920.

## Per-event configuration — `[clip]` in the manifest

Optional. `manifest.py` validates it into a frozen `ClipConfig` with these
defaults, and `event_summary` exposes it as `clip`:

```toml
[clip]
tape_max_s = 12.0                       # the tape's ceiling in the clip
sounds     = ["crowd", "horn", "verdict"]

[clip.camera]
kind          = "chase"                 # the default: today's chase camera
back          = 0.35                    # behind the leader, along the lane
height        = 0.34
side          = "auto"                  # or a number; auto = cameraSideOffset
target_height = 0.12
fov           = 42
```

A fixed camera is `kind = "fixed"` with absolute `position = [x, y, z]`,
`target = [x, y, z]` and `fov`, for events where the picture is a jump or a
stand rather than a run. Unknown keys, unknown kinds and unknown source names
are `ManifestError`s, loudly, at load. Every existing event carries no
`[clip]` section and gets the defaults.

## Store and API

### Files

Under `clips/<run_id>/`, three write-once files and the media:

| File | Written by | Meaning |
| --- | --- | --- |
| `pending.json` `{run_id, user, event_id, queued_at}` | the submit route | a clip is owed |
| `clip.json` + `landscape.mp4` + `vertical.mp4` + `poster.png` | the worker, in one write | ready |
| `failed.json` `{run_id, failed_at, reason}` | the worker | given up |

State by presence: `ready` if `clip.json`, else `failed` if `failed.json`,
else `pending` if `pending.json`, else `none`.

```json
{
  "run_id": "01M2…", "version": 1, "rendered_at": "2026-09-16T18:00:00Z",
  "poster": "poster.png",
  "layouts": {
    "landscape": { "file": "landscape.mp4", "width": 1920, "height": 1080, "fps": 25,
                   "frames": 213, "seconds": 8.52, "crowdMixed": true,
                   "crowdDirection": { "start": 1.0, "end": 6.0, "verdict": "pass" },
                   "timing": { "draw_ms_per_frame": 8, "capture_ms_per_frame": 190,
                               "total_wall_ms": 48000, "cores": 2, "load": [1.8, 1.2, 0.9] } },
    "vertical":  { "…": "…" }
  }
}
```

`version` is `CLIP_VERSION`, a constant. Bumping it does not re-render: an
older clip is still served.

### The `Store` protocol grows

```python
def mark_clip_pending(self, run_id: str, user: str, event_id: str, queued_at: str) -> None
def put_clip(self, run_id: str, files: dict[str, bytes]) -> None   # clip.json and media, one write
def fail_clip(self, run_id: str, failed_at: str, reason: str) -> None
def clip_state(self, run_id: str) -> tuple[str, dict | None]        # ("ready", manifest) or (state, None)
def clip_file(self, run_id: str, name: str) -> Path
def pending_clips(self) -> list[str]                                # pending, with neither clip nor failed
```

`LocalStore` writes under its root. `HubStore` writes each as one
`create_commit`; its `snapshot()` passes `ignore_patterns=["*.mp4", "*.png"]`,
and `clip_file` is `hf_hub_download` of the one path, cached by the Hub cache.
`put_clip` and `fail_clip` drop the snapshot so the page sees the state at
once; `mark_clip_pending` is the extra commit a publish now pays.

### Routes

- `GET /api/runs/{run_id}/clip` — `Cache-Control: no-store`.
  `{"state": "ready", "poster": "/api/runs/<id>/clip/poster.png",
  "layouts": {"landscape": {"url": "/api/runs/<id>/clip/landscape.mp4",
  "width": 1920, "height": 1080, "seconds": 8.52}, "vertical": {…}}}`, or
  `{"state": "pending"}`, `{"state": "failed"}`, `{"state": "none"}`.
- `GET /api/runs/{run_id}/clip/{name}` — `name` is one of `landscape.mp4`,
  `vertical.mp4`, `poster.png`; anything else, or a clip not ready, is 404.
  A `FileResponse` with the right media type and
  `Cache-Control: public, max-age=31536000, immutable` — the bytes behind a
  ready clip never change. `?download=1` adds
  `Content-Disposition: attachment; filename="microduck-arena-<user>-<policy>-<layout>.mp4"`,
  the stem sanitised by the rule `policy_filename` already applies.
- `POST /api/events/{id}/submit` — after `store.append`, when the renderer is
  available: `mark_clip_pending` then `enqueue`. The response is unchanged.
- `GET /r/{run_id}` — see *Unfurl*.

## The publication page

### The share row

Under `#points`, a third child of `.run-score`:

```html
<nav class="run-share" id="share" aria-label="Share this run">
  <a class="sticker sticker-mark fx-tilt-2-5" href="<x intent>" target="_blank" rel="noopener" aria-label="X">…</a>
  <a class="sticker sticker-mark fx-tilt-1-5" href="<linkedin intent>" …>…</a>
  <button class="sticker sticker-mark fx-tilt-3-0" type="button" data-upload="instagram" aria-label="Instagram">…</button>
  <button class="sticker sticker-mark fx-tilt-1-0" type="button" data-upload="tiktok" aria-label="TikTok">…</button>
  <a class="sticker sticker-cyan fx-tilt-2-5" href="/api/runs/<id>/clip/landscape.mp4?download=1" download>Clip · landscape</a>
  <a class="sticker sticker-cyan fx-tilt-1-5" href="/api/runs/<id>/clip/vertical.mp4?download=1" download>Clip · vertical</a>
</nav>
<p class="mono-label run-share-said" hidden></p>
```

The row wears `.fx-tilt-alternate` so signs alternate. Logos are Duck Jam's
inline SVG paths, 22×22, `fill: currentColor`; the network's name is the
`aria-label` and `title`, never drawn. `.run-score` becomes
`grid-template-rows: auto auto auto`. The row is present from the first paint
and `veiled` during a reveal; `settle` unveils it — a beat unveils, it never
inserts. `.run-share`, `.sticker-mark`, `.sticker-logo` and `.run-share-said`
are added to `race.css`'s run section.

Clip stickers by state: `pending` → `Clip · rendering…`, no `href`,
`aria-disabled`, polled every 5 s; `ready` → the two downloads; `failed` or
`none` → the two stickers are absent.

### Behaviour — `app/src/share.js`

Ported from `sharing.mjs`, with the page's own words:

- **X, LinkedIn**: plain links to `https://x.com/intent/post?text=` and
  `https://www.linkedin.com/feed/?shareActive=true&text=`, the text
  URL-encoded. These are the only two addresses that pre-fill a post;
  `linkedin.com/sharing/share-offsite` takes a URL and no text.
- **Instagram, TikTok**: on a coarse-pointer device with `navigator.share`,
  `share({ text })` — `text` only; a `url` beside it makes some targets drop
  the text. Otherwise the post is copied to the clipboard, the vertical clip's
  download URL is opened when the clip is ready, and the line says
  `Text copied. Use the clip download to attach your video and publish in your app.`
  or, while pending, `Text copied. The clip is still rendering — come back for the download.`
  A refused clipboard says `Could not copy. Select the text and copy it yourself.`
- The functions take their browser hooks (`share`, `handheld`, `open`,
  `clipboard`) as parameters so the tests need no browser.

### The post — `postText(run, { origin, network })`, pure

```
I coded a robot duck to walk. On 2 m Sprint it finished 5/5 seeds in 2.314 s, #3 on the board (+135 pts).
Beat it: https://<origin>/r/<run_id>
Weights: huggingface.co/<user>/microduck-<policy>
#MicroduckArena @pollenrobotics @huggingface
```

- A DNF reads `it finished 0/5 seeds on its feet — it ate the floor` when a
  seed fell, `it ran out of time` otherwise.
- `#rank on the board` is omitted off the board or when withdrawn; `(+N pts)`
  is omitted at zero; the `Weights:` line is omitted without `policy_url`.
- The mentions `@pollenrobotics @huggingface` appear on X only; the hashtag
  on every network.
- The link is the unfurl route, so a pasted post shows the poster.
- Every variant fits X's 280 with the link counted as 23.

## Unfurl — `GET /r/{run_id}`

A router without the `/api` prefix, included before the static mount. It finds
the run (404 otherwise) and answers HTML:

```html
<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>@alice · walker · 2 m Sprint · Microduck Arena</title>
<meta property="og:type" content="video.other">
<meta property="og:title" content="@alice · walker · 2 m Sprint">
<meta property="og:description" content="@alice's duck finished 5/5 seeds in 2.314 s on 2 m Sprint, #3 on the board.">
<meta property="og:url" content="https://<host>/r/<id>">
<meta property="og:image" content="https://<host>/api/runs/<id>/clip/poster.png">
<meta property="og:image:width" content="1920"><meta property="og:image:height" content="1080">
<meta property="og:video" content="https://<host>/api/runs/<id>/clip/landscape.mp4">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="1920"><meta property="og:video:height" content="1080">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=/#/r/<id>">
</head><body><script>location.replace("/#/r/<id>")</script>
<a href="/#/r/<id>">Open this run</a></body></html>
```

Image and video tags appear only when the clip is `ready`. Every value is
HTML-escaped. The public origin is `https://$SPACE_HOST` when set, else the
request's base URL; `ArenaConfig.public_origin` holds it. `Cache-Control:
public, max-age=60`, so a crawler's re-fetch after the clip lands is soon.

## Vendored assets and licences

Into `app/public/sound/`, with `PROVENANCE.md` extended one row each:
`microduck-fall.wav` (Apache-2.0, pollen-robotics/microduck's synthesiser,
"modified audio" per Duck Jam's `LICENSES.md`), with `MICRODUCK-LICENSE.txt`
beside them. Duck Jam's `LICENSES.md` also lists `microduck-victory.wav` as
Apache-2.0, "modified recipe"; the arena's `PROVENANCE.md` currently calls it
CC0-1.0, and that row is corrected in the same change.

Into `app/src/`: `plate.js` (nameplate only), `clip/stadium.js`,
`clip/direction.js`, each with a header naming the Duck Jam file and commit it
came from.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHROME` | first found of the usual paths | the browser binary |
| `ARENA_CLIP_PARALLEL` | `max(1, cpu_count // 2)` | layouts rendered at once |
| `ARENA_ORIGIN` | `http://127.0.0.1:<port>` | where the recorder's Chrome loads `clip.html` |
| `SPACE_HOST` | unset | the public host for OG URLs; set by Spaces |

`websockets>=13` joins the dependencies. `uv.lock` is updated for it.

## Testing

Python, `tests/test_clips.py`:

- store: the three files, state by presence, `pending_clips` excludes runs
  with a `clip.json` or `failed.json`, `put_clip` writes the media and the
  manifest together;
- worker: with a fake `render` that returns bytes, a publish enqueues and the
  files land; a raising fake writes `failed.json`; `drain` enqueues exactly
  the pending runs;
- routes: `/clip` in each state, the media route's 404s, media type,
  `Content-Disposition` with `?download=1` and the sanitised name;
- unfurl: tags present when ready and absent when not, escaping, the redirect,
  404 for an unknown run.

Python, `tests/test_manifest.py`: `[clip]` defaults, a fixed camera, an
unknown source refused.

JavaScript: `share.test.js` — `postText` variants and the 280 rule, the two
intent URLs, the Instagram click on a laptop copies and opens the vertical
clip; `clip/plan.test.js` — the frame plan and the ceiling.

The render is checked by eye: `arena clip` on the developer's Mac, both mp4s
opened in a player, the crowd heard turning at the verdict; then on the Space
after deploy, the timing in `clip.json` read back for the real per-frame
cost. The share row is checked in the browser, as the theatre is.

## Out of scope

The live programme and anything that consumes the clips; a bot that posts;
nameplates on the publication page; rendering historical runs other than by
hand; a `duck` or simulator sound source; attaching media to X or LinkedIn
intents (no intent accepts a file); OG tags for pages other than a run.

## Risks

- **Render time on cpu-basic** is unmeasured until the plan's first task runs;
  the expectation is one to three minutes per run after the capture choice.
  The worker is background and serialised, so a slow render delays a clip,
  never a publish.
- **Debian's `chromium`** may lack WebCodecs' VP9 encoder or behave
  differently from Chrome; the spike runs against it in the image, not only
  on the Mac.
- **The Space is private today.** No link unfurls and no outsider can open
  one until it is made public; the code is ready either way.
- **Every push to `main` redeploys** and kills a render in flight; the drain
  at boot is what makes that harmless.
