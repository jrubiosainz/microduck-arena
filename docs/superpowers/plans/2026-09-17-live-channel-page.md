# Live Channel, The Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#/live` plays the channel: every screen reads `GET /api/live`, finds the slot that contains now on the shared clock, and plays replays from the clips, the booth with Peter and Ray in three.js and WebAudio, and the shutter between them.

**Architecture:** Pure modules first (the plan's pose and voice, the camera schedule, the caption split, the shutter timing, the clock estimate, the grid position, the video servo), each unit-tested; then three segment modules with one interface (`prepare`, `play`, `seek`, `stop`); then the conductor that polls, prefetches and switches on the clock; then the page, the home tile and the kiosk checks. The booth scene is authored in Duck Jam's z-up metres under one root rotated like the rig's; only the camera is converted.

**Tech Stack:** JavaScript ES modules, three.js 0.169, WebAudio, vitest with jsdom; the arena's `rig.js`, `replay.js`, `sound.js` and `clip/stadium.js`.

**Spec:** `docs/superpowers/specs/2026-09-17-live-channel-design.md` (sections "The live page", "The booth"). The server side (`GET /api/live`, `commentary.json`, `prepare`) is `docs/superpowers/plans/2026-09-17-live-channel-server.md`, which must be executed first; `app/src/live/score.js` already exists from its Task 1.

## Global Constraints

- Every screen plays from `position = Date.now() + offset`; nothing is timed from when a segment happened to start. A replay is servoed to the clock (rate 0.97/1.03 under 250 ms of error, a seek beyond); the booth is drawn from the position.
- The stage is 16:9, filling the window, letterboxed otherwise; the only chrome is the "LIVE" bug. Clips carry their own bands; nothing is doubled.
- The booth is Duck Jam's: Peter left in the `classic` livery, Ray right in `blue`, in the STAND pose 0.12 m above the floor, only neck and head moving; the set boxes, colours and camera numbers are Duck Jam's.
- The mute preference in `app/src/sound.js` is respected; a hidden tab stops everything and rejoins on return; the page reloads at a shutter midpoint when `build` changes.
- Frontend tests: `cd app && npx vitest run`; build: `cd app && npm run build`. Under Node 25, `brightness.test.js` has 4 pre-existing failures.
- Commit after every task, in the repository's style, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push: a push to `main` deploys the Space.
- No dead code, no "just in case" branches; nothing a reader sees carries a technical name.

---

### Task 1: The plan plays — `poseAt`, `synthesize`, and the two tones

**Files:**
- Modify: `app/src/live/score.js`
- Modify: `app/src/live/score.test.js`
- Create: `app/public/sound/commentator-peter.f32`, `app/public/sound/commentator-ray.f32` (copied)
- Modify: `app/public/sound/PROVENANCE.md`

**Interfaces:**
- Consumes: `prepare` (server plan, Task 1).
- Produces: `poseAt(plan, speaker, ms) -> { energy, mouth, neck, pitch, roll, yaw }` (radians for the four joints, `mouth` in [0, 1]); `synthesize(plan, tones) -> Float32Array` interleaved stereo at 48 kHz, `plan.duration_ms * 96` samples, where `tones = { peter: Float32Array, ray: Float32Array }` are the mono tones at 48 kHz.

- [ ] **Step 1: Copy the tones and record their provenance**

```bash
cp /Users/nicolasrabault/Projects/HuggingFace/duckJam/design/sound/commentator-peter.f32 app/public/sound/
cp /Users/nicolasrabault/Projects/HuggingFace/duckJam/design/sound/commentator-ray.f32 app/public/sound/
ls -l app/public/sound/commentator-*.f32
```

Expected: two files of 115 200 bytes. In `app/public/sound/PROVENANCE.md`, add two rows to "The cues" table:

```
| `commentator-peter.f32` | 0.60 s | The booth: Peter Duckry's one note, sung once per syllable of his lines. | Apache-2.0 (see below) |
| `commentator-ray.f32` | 0.60 s | The booth: Ray Quackson's one note. | Apache-2.0 (see below) |
```

and extend "The microduck voice" section's first sentence to name them: `microduck-victory.wav`, `microduck-fall.wav`, `commentator-peter.f32` and `commentator-ray.f32` are not `build-kit.mjs` cues: Duck Jam renders them with the robot's own Rust synthesiser (the two tones with `design/sound/commentators.rs` and `commentator-voice.rs` at Duck Jam commit `2d35443b`, raw 48 kHz mono float32, no header). Also add, after the sentence about `sound.js` being the only player: `app/src/live/voice.js` plays the two tones.

- [ ] **Step 2: Write the failing tests**

Append to `app/src/live/score.test.js` (the `dialogue` fixture is already there):

```js
import { poseAt, synthesize } from "./score.js";

describe("poseAt", () => {
  it("is pure in time: the same instant gives the same pose, silence gives rest", () => {
    const plan = prepare(dialogue);
    const a = poseAt(plan, "peter", 5000);
    expect(poseAt(plan, "peter", 5000)).toEqual(a);
    // Between the beats' envelopes at t=0 everything is at rest and the mouth is shut.
    const rest = poseAt(plan, "ray", 0);
    expect(rest.mouth).toBe(0);
    expect(rest.energy).toBe(0);
  });

  it("opens the mouth only while a note of that speaker sings", () => {
    const plan = prepare(dialogue);
    const note = plan.notes.find((n) => n.speaker === "ray");
    const mid = (note.start_ms + note.end_ms) / 2;
    expect(poseAt(plan, "ray", mid).mouth).toBeGreaterThan(0);
    expect(poseAt(plan, "peter", mid).mouth).toBe(0);
  });

  it("turns Peter's head right and Ray's left during a glance", () => {
    const plan = prepare(dialogue);
    for (const speaker of ["peter", "ray"]) {
      const look = plan.gestures.find((g) => g.kind === "look" && g.speaker === speaker);
      const yaw = poseAt(plan, speaker, (look.start_ms + look.end_ms) / 2).yaw;
      expect(Math.sign(yaw)).toBe(speaker === "peter" ? 1 : -1);
    }
  });
});

describe("synthesize", () => {
  const tone = new Float32Array(28800).map((_, i) => Math.sin(i / 20));
  it("fills exactly the plan's duration in stereo at 48 kHz, silent outside the notes", () => {
    const plan = prepare(dialogue);
    const pcm = synthesize(plan, { peter: tone, ray: tone });
    expect(pcm.length).toBe(plan.duration_ms * 96);
    expect(pcm[0]).toBe(0);
    expect(pcm[pcm.length - 1]).toBe(0);
    const note = plan.notes[0];
    const at = Math.round(((note.start_ms + note.end_ms) / 2) * 48) * 2;
    expect(pcm[at]).not.toBe(0);
    expect(pcm[at]).toBe(pcm[at + 1]);
    expect(Math.max(...pcm.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it("refuses a missing or short tone", () => {
    const plan = prepare(dialogue);
    expect(() => synthesize(plan, { peter: tone })).toThrow("Missing native voice: ray");
    expect(() => synthesize(plan, { peter: tone, ray: new Float32Array(10) })).toThrow("too short");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/score.test.js`
Expected: FAIL, `poseAt is not a function`.

- [ ] **Step 4: Write the two halves**

Append to `app/src/live/score.js`:

```js
/** A pure pose at item time, so seeking and out-of-order drawing never drift. */
export function poseAt(plan, speaker, ms) {
  const note = plan.notes.find((n) => n.speaker === speaker && n.start_ms <= ms && ms < n.end_ms);
  const phase = note ? (ms - note.start_ms) / (note.end_ms - note.start_ms) : 0;
  const energy = note ? Math.sin(Math.PI * phase) * note.emphasis : 0;
  const pose = { energy, mouth: energy, neck: 0, pitch: 0, roll: 0, yaw: 0 };
  for (const gesture of plan.gestures) {
    if (gesture.speaker !== speaker || ms < gesture.start_ms || ms >= gesture.end_ms) continue;
    const t = (ms - gesture.start_ms) / (gesture.end_ms - gesture.start_ms);
    if (gesture.kind === "look") {
      const ramp = Math.min(1, (ms - gesture.start_ms) / 240, (gesture.end_ms - ms) / 240);
      pose.yaw += gesture.yaw * (0.5 - 0.5 * Math.cos(Math.PI * ramp));
    } else {
      const envelope = Math.sin(Math.PI * t) ** 2;
      for (const key of ["neck", "pitch", "roll"]) {
        const cycles = key === "pitch" ? Math.cos(2 * Math.PI * (gesture.cycles - 1) * t) : 1;
        pose[key] += gesture[key] * envelope * cycles;
      }
    }
  }
  return pose;
}

/** Sample-accurate stereo PCM; identical channels keep the two timbres apart in mono. */
export function synthesize(plan, tones) {
  const audio = new Float32Array((plan.duration_ms * SAMPLE_RATE) / 1000 * 2);
  for (const note of plan.notes) {
    const source = tones[note.speaker];
    if (!source?.length) throw new Error(`Missing native voice: ${note.speaker}`);
    const start = note.start_ms * 48;
    const length = (note.end_ms - note.start_ms) * 48;
    for (let i = 0; i < length; i++) {
      const at = i * note.rate;
      const low = Math.floor(at);
      const fraction = at - low;
      if (low + 1 >= source.length) throw new Error("Native source note is too short");
      const fade = Math.min(1, i / 96, (length - 1 - i) / 96);
      const sample = (source[low] * (1 - fraction) + source[low + 1] * fraction) * fade * note.emphasis;
      audio[(start + i) * 2] = sample;
      audio[(start + i) * 2 + 1] = sample;
    }
  }
  return audio;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/live/score.test.js`
Expected: all pass. If `pcm[at]` is 0 in the stereo test, the sampled instant fell on a fade edge; the test's midpoint is inside the note, so check `poseAt`'s and `synthesize`'s `start_ms * 48` arithmetic before touching the test.

- [ ] **Step 6: Commit**

```bash
git add app/src/live/score.js app/src/live/score.test.js app/public/sound/commentator-peter.f32 app/public/sound/commentator-ray.f32 app/public/sound/PROVENANCE.md
git commit -m "Live: the plan plays, a pose at any instant and the two microduck tones sung per syllable

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The camera schedule

**Files:**
- Create: `app/src/live/direction.js`
- Create: `app/src/live/direction.test.js`

**Interfaces:**
- Consumes: a plan (`captions` with `speaker`, `start_ms`, `end_ms`; `duration_ms`).
- Produces: `shotsFor(plan) -> [{ shot: "duo"|"peter"|"ray", start_ms, end_ms }]` covering `[0, duration_ms)`; `direct(plan) -> (ms, aspect = 16/9) => { shot, start_ms, end_ms, target: [x, y, z], position: [x, y, z] }` in Duck Jam's z-up metres, world frame (the booth's local x rotated by π/6). The booth (Task 7) converts to y-up.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/live/direction.test.js
import { describe, expect, it } from "vitest";
import { direct, shotsFor } from "./direction.js";

const cue = (speaker, start_ms, end_ms) => ({ speaker, start_ms, end_ms });
const plan = {
  duration_ms: 40000,
  captions: [
    cue("peter", 800, 4000), cue("ray", 4500, 12000), cue("ray", 12000, 15000),
    cue("peter", 15500, 24000), cue("ray", 24500, 30000), cue("peter", 30500, 33000),
  ],
};

describe("shotsFor", () => {
  it("covers the whole plan without gaps, in order", () => {
    const shots = shotsFor(plan);
    expect(shots[0].start_ms).toBe(0);
    expect(shots.at(-1).end_ms).toBe(plan.duration_ms);
    for (const [a, b] of shots.slice(1).map((s, i) => [shots[i], s])) expect(b.start_ms).toBe(a.end_ms);
  });

  it("holds every shot at least five seconds and gives the duo most of the programme", () => {
    const shots = shotsFor(plan);
    for (const s of shots) expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(5000);
    const duo = shots.filter((s) => s.shot === "duo").reduce((sum, s) => sum + s.end_ms - s.start_ms, 0);
    expect(duo).toBeGreaterThan(plan.duration_ms / 2);
  });

  it("never cuts to a close shot before ten seconds wide, never inside the partner's line", () => {
    const shots = shotsFor(plan);
    const close = shots.filter((s) => s.shot !== "duo");
    expect(close.length).toBeGreaterThan(0);
    expect(close[0].start_ms).toBeGreaterThanOrEqual(10000);
    for (const s of close) {
      for (const c of plan.captions) {
        if (c.start_ms < s.end_ms && c.end_ms > s.start_ms) expect(c.speaker).toBe(s.shot);
      }
    }
  });

  it("keeps a single-caption plan on the duo", () => {
    expect(shotsFor({ duration_ms: 6000, captions: [cue("peter", 800, 5000)] })).toEqual([
      { shot: "duo", start_ms: 0, end_ms: 6000 },
    ]);
  });
});

describe("direct", () => {
  it("frames the duo from the front and a close shot toward the speaker's side", () => {
    const cameraAt = direct(plan);
    const wide = cameraAt(0);
    expect(wide.shot).toBe("duo");
    expect(wide.target[2]).toBeCloseTo(0.12);
    expect(wide.position[1]).toBeLessThan(wide.target[1]); // in front, toward the auditorium
    const close = shotsFor(plan).find((s) => s.shot !== "duo");
    const framing = cameraAt(close.start_ms + 100);
    expect(framing.shot).toBe(close.shot);
    const dx = framing.target[0] - wide.target[0];
    expect(Math.sign(dx)).toBe(close.shot === "peter" ? -1 : 1);
  });

  it("backs off for a narrow aspect and eases within a shot", () => {
    const cameraAt = direct(plan);
    const wide = cameraAt(0, 16 / 9);
    const tall = cameraAt(0, 9 / 16);
    const distance = (f) => Math.hypot(...f.position.map((v, i) => v - f.target[i]));
    expect(distance(tall)).toBeGreaterThan(distance(wide));
    expect(distance(cameraAt(4000))).toBeLessThan(distance(wide));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/direction.test.js`
Expected: FAIL, cannot resolve `./direction.js`.

- [ ] **Step 3: Write the module**

```js
// app/src/live/direction.js
//
// Who the camera looks at, and from where. Ported from Duck Jam's
// dome/media/commentators/direction.mjs: the duo wide by default; after ten
// seconds wide, one close shot on a speaker, held five to seven seconds to the
// end of that reply, never within five seconds of the end and never while the
// partner speaks inside it; a speaker change never interrupts a shot.

const BOOTH_TURN = Math.PI / 6;

export function shotsFor(plan) {
  const turns = [];
  for (const cue of plan.captions) {
    const last = turns.at(-1);
    if (last?.shot === cue.speaker && last.end_ms === cue.start_ms) last.end_ms = cue.end_ms;
    else turns.push({ shot: cue.speaker, start_ms: cue.start_ms, end_ms: cue.end_ms });
  }
  const shots = [];
  let cursor = 0;
  for (const turn of turns) {
    if (turn.start_ms < cursor + 10000) continue;
    const end_ms = Math.max(turn.start_ms + 5000, Math.min(turn.end_ms, turn.start_ms + 7000));
    if (end_ms > plan.duration_ms - 5000) continue;
    if (plan.captions.some((cue) => cue.speaker !== turn.shot && cue.start_ms < end_ms && cue.end_ms > turn.start_ms)) {
      continue;
    }
    shots.push({ shot: "duo", start_ms: cursor, end_ms: turn.start_ms }, { ...turn, end_ms });
    cursor = end_ms;
  }
  shots.push({ shot: "duo", start_ms: cursor, end_ms: plan.duration_ms });
  return shots;
}

/** Item time is the only camera clock. Booth-local x follows the actors and
 * negative y faces the auditorium; the booth stands turned by π/6 in the world. */
export function direct(plan) {
  const shots = shotsFor(plan);
  const world = ([x, y, z]) => [
    x * Math.cos(BOOTH_TURN) - y * Math.sin(BOOTH_TURN),
    x * Math.sin(BOOTH_TURN) + y * Math.cos(BOOTH_TURN),
    z,
  ];
  return (ms, aspect = 16 / 9) => {
    const shot = shots.find((s) => s.start_ms <= ms && ms < s.end_ms) ?? shots.at(-1);
    const t = Math.max(0, Math.min(1, (ms - shot.start_ms) / Math.max(1, shot.end_ms - shot.start_ms)));
    const ease = t * t * (3 - 2 * t);
    const duo = shot.shot === "duo";
    const x = duo ? 0 : shot.shot === "peter" ? -0.16 : 0.16;
    const target = world([x, 0, duo ? 0.12 : 0.15]);
    const back = duo ? 1.1 - 0.02 * ease : 0.6 - 0.045 * ease;
    // Room for the heads at narrow aspects, portrait included.
    const fit = Math.max(1, 16 / 9 / aspect);
    const offset = world([duo ? 0.025 * ease : 0, -back, duo ? 0.34 : 0.2]);
    return { ...shot, target, position: target.map((v, i) => v + offset[i] * fit) };
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/live/direction.test.js`
Expected: 6 passed. The fixture's first close shot is Ray's turn at 4 500–15 000 ms, which starts before ten seconds and is skipped; Peter's at 15 500 qualifies (held to 22 500) and no Ray caption overlaps it.

- [ ] **Step 5: Commit**

```bash
git add app/src/live/direction.js app/src/live/direction.test.js
git commit -m "Live: the booth's camera schedule, wide by default and a close shot that never cuts a line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Captions and the shutter's timing

**Files:**
- Create: `app/src/live/captions.js`, `app/src/live/captions.test.js`
- Create: `app/src/live/shutter.js`, `app/src/live/shutter.test.js`

**Interfaces:**
- Produces: `splitCaption(text, measure, maxWidth) -> [line] | [line, line]` where `measure(text) -> number` is a width in any unit and `maxWidth` the panel's inner width in the same unit; throws `Error("Caption does not fit")` when no two-line split fits. `createCaptions(container) -> { show(cue), hide(), resize(width) }` builds the DOM panel: `container` gets a `div.live-caption` with `span.live-caption-name` and `p.live-caption-text`, hidden until `show`.
- Produces: `TRANSITION_MS = 1600`, `shutterAt(ms) -> { x, destination }` (x in [-1, 1] as a fraction of the stage width, `destination` true from 800 ms), `createShutter(container) -> { draw(ms, next), hide() }` building `div.live-shutter` with the wordmark and an UP NEXT card.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/live/captions.test.js
import { describe, expect, it } from "vitest";
import { createCaptions, splitCaption } from "./captions.js";

const measure = (text) => text.length * 10;

describe("splitCaption", () => {
  it("keeps a short caption on one line", () => {
    expect(splitCaption("Twelve point four, Ray!", measure, 1000)).toEqual(["Twelve point four, Ray!"]);
  });

  it("splits a long one at the word boundary that balances the lines", () => {
    const text = "It is a number, Peter. A good one; I will grant you that much, and no more.";
    const lines = splitCaption(text, measure, 1000);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(text);
    expect(Math.abs(measure(lines[0]) - measure(lines[1]))).toBeLessThanOrEqual(60);
  });

  it("splits a caption of 43 characters even when it would fit, as Duck Jam did", () => {
    const text = "a".repeat(20) + " " + "b".repeat(22);
    expect(splitCaption(text, measure, 5000)).toHaveLength(2);
  });

  it("refuses a caption no split can fit", () => {
    expect(() => splitCaption("x".repeat(50) + " " + "y".repeat(50), measure, 400)).toThrow("Caption does not fit");
  });
});

describe("createCaptions", () => {
  it("shows the speaker's name and lines, and hides on demand", () => {
    const container = document.createElement("div");
    const captions = createCaptions(container);
    const panel = container.querySelector(".live-caption");
    expect(panel.hidden).toBe(true);
    captions.resize(1280);
    captions.show({ name: "Ray Quackson", text: "It is a number, Peter." });
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".live-caption-name").textContent).toBe("Ray Quackson");
    expect(panel.querySelector(".live-caption-text").textContent).toBe("It is a number, Peter.");
    captions.hide();
    expect(panel.hidden).toBe(true);
  });
});
```

```js
// app/src/live/shutter.test.js
import { describe, expect, it } from "vitest";
import { TRANSITION_MS, createShutter, shutterAt } from "./shutter.js";

describe("shutterAt", () => {
  it("sweeps in over 400 ms, holds to 1200, sweeps out to the right by 1600", () => {
    expect(shutterAt(0)).toEqual({ x: -1, destination: false });
    expect(shutterAt(200).x).toBeCloseTo(-0.5);
    expect(shutterAt(400)).toEqual({ x: 0, destination: false });
    expect(shutterAt(799).destination).toBe(false);
    expect(shutterAt(800)).toEqual({ x: 0, destination: true });
    expect(shutterAt(1400).x).toBeCloseTo(0.5);
    expect(shutterAt(TRANSITION_MS)).toEqual({ x: 1, destination: true });
  });
});

describe("createShutter", () => {
  it("shows the card with the next replay only on the way out, and hides at the ends", () => {
    const container = document.createElement("div");
    const shutter = createShutter(container);
    const panel = container.querySelector(".live-shutter");
    const card = panel.querySelector(".live-upnext");
    shutter.draw(600, { event: "2 m Sprint", user: "carol" });
    expect(panel.hidden).toBe(false);
    expect(card.hidden).toBe(true);
    shutter.draw(900, { event: "2 m Sprint", user: "carol" });
    expect(card.hidden).toBe(false);
    expect(card.querySelector(".live-upnext-event").textContent).toBe("2 m Sprint");
    expect(card.querySelector(".live-upnext-user").textContent).toBe("@carol");
    shutter.draw(900, null);
    expect(card.hidden).toBe(true);
    expect(panel.style.getPropertyValue("--shutter-x")).toBe("0");
    shutter.draw(1600, null);
    expect(panel.hidden).toBe(true);
    shutter.hide();
    expect(panel.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/captions.test.js src/live/shutter.test.js`
Expected: FAIL, both modules unresolved.

- [ ] **Step 3: Write `captions.js`**

```js
// app/src/live/captions.js
//
// The caption panel under the booth: the charter's ink panel with a yellow
// name tile and up to two lines. The split is Duck Jam's: 42 characters or
// less stay on one line, longer ones break at the word boundary that
// balances the two lines' widths.

const ONE_LINE_CHARS = 42;

export function splitCaption(text, measure, maxWidth) {
  if (text.length <= ONE_LINE_CHARS && measure(text) <= maxWidth) return [text];
  const words = text.split(" ");
  const candidates = words
    .slice(1)
    .map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")])
    .map((lines) => ({ lines, widths: lines.map(measure) }))
    .filter(({ widths }) => widths.every((w) => w <= maxWidth))
    .sort((a, b) => Math.abs(a.widths[0] - a.widths[1]) - Math.abs(b.widths[0] - b.widths[1]));
  if (!candidates.length) throw new Error("Caption does not fit");
  return candidates[0].lines;
}

export function createCaptions(container) {
  const panel = document.createElement("div");
  panel.className = "live-caption";
  panel.hidden = true;
  const name = document.createElement("span");
  name.className = "live-caption-name";
  const text = document.createElement("p");
  text.className = "live-caption-text";
  panel.append(name, text);
  container.append(panel);
  // Measured in the panel's own font, on a canvas so no layout is forced per
  // frame. The stage's width scales the type: 50 px at 1280.
  const ctx = document.createElement("canvas").getContext("2d");
  let width = 1280;
  let shown = null;
  const measure = (value) => {
    ctx.font = `700 ${(50 * width) / 1280}px "DM Sans", sans-serif`;
    return ctx.measureText(value).width;
  };
  return {
    resize(stageWidth) {
      width = stageWidth;
    },
    show(cue) {
      if (shown === cue) return;
      shown = cue;
      name.textContent = cue.name;
      text.replaceChildren();
      const lines = ctx ? splitCaption(cue.text, measure, width - (96 * width) / 1280) : [cue.text];
      lines.forEach((line, i) => {
        if (i) text.append(document.createElement("br"));
        text.append(line);
      });
      panel.hidden = false;
    },
    hide() {
      shown = null;
      panel.hidden = true;
    },
  };
}
```

(jsdom's canvas `getContext` returns null, which is why `ctx` is guarded: in the browser the split runs; in the test the caption is one line.)

- [ ] **Step 4: Write `shutter.js`**

```js
// app/src/live/shutter.js
//
// The wipe between two segments, Duck Jam's motion.mjs: a 400 ms sweep in
// from the left, 800 ms fully covering, a 400 ms sweep out to the right. The
// slot underneath switches at 800 ms, while nothing shows through. On the way
// out to a replay the panel carries the UP NEXT card, which is how the next
// replay is announced.

import { wordmark } from "../wordmark.js";

export const TRANSITION_MS = 1600;
const smooth = (t) => t * t * (3 - 2 * t);

export function shutterAt(ms) {
  const x = ms < 400 ? smooth(Math.max(0, ms) / 400) - 1
    : ms <= 1200 ? 0
    : smooth(Math.min(1, (ms - 1200) / 400));
  return { x, destination: ms >= 800 };
}

export function createShutter(container) {
  const panel = document.createElement("div");
  panel.className = "live-shutter";
  panel.hidden = true;
  const mark = wordmark();
  const card = document.createElement("div");
  card.className = "live-upnext";
  card.hidden = true;
  const label = document.createElement("span");
  label.className = "eyebrow";
  label.textContent = "Up next";
  const event = document.createElement("span");
  event.className = "live-upnext-event";
  const user = document.createElement("span");
  user.className = "live-upnext-user mono-label";
  card.append(label, event, user);
  panel.append(mark, card);
  container.append(panel);
  return {
    draw(ms, next) {
      const { x, destination } = shutterAt(ms);
      if (Math.abs(x) >= 1) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      panel.style.setProperty("--shutter-x", String(x));
      panel.classList.toggle("live-shutter-out", destination);
      const announce = destination && next;
      card.hidden = !announce;
      if (announce) {
        event.textContent = next.event;
        user.textContent = `@${next.user}`;
      }
    },
    hide() {
      panel.hidden = true;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/live/captions.test.js src/live/shutter.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/live/captions.js app/src/live/captions.test.js app/src/live/shutter.js app/src/live/shutter.test.js
git commit -m "Live: the caption panel's balanced split and the shutter's sweep with its UP NEXT card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The clock, the grid and the video servo

**Files:**
- Create: `app/src/live/clock.js`, `app/src/live/clock.test.js`
- Create: `app/src/live/grid.js`, `app/src/live/grid.test.js`

**Interfaces:**
- Produces: `estimateClock(samples) -> { offset, uncertainty }` over `[{ before, after, server }]` (ms), the sample with the smallest round trip; `createClock(now = () => Date.now()) -> { sample(before, server, after), position(), ready }` keeping the five most recent samples, `position()` = `now() + offset`.
- Produces: `slotAt(slots, ms) -> slot | null`, `slotAfter(slots, slot) -> slot | null` (the slot that starts where `slot` ends), `correction(current, target, ranges, force = false) -> { rate, time? }` (seconds; Duck Jam's servo: within 0.25 s leave the rate at 1, under 1 s nudge 0.97/1.03, beyond 1 s or when forced seek if the target is buffered), `shouldReload(started, current) -> boolean` (`current !== started`).

- [ ] **Step 1: Write the failing tests**

```js
// app/src/live/clock.test.js
import { describe, expect, it } from "vitest";
import { createClock, estimateClock } from "./clock.js";

describe("estimateClock", () => {
  it("trusts the sample with the smallest round trip", () => {
    const { offset, uncertainty } = estimateClock([
      { before: 1000, after: 1400, server: 5200 },
      { before: 2000, after: 2040, server: 6030 },
      { before: 3000, after: 3200, server: 7100 },
    ]);
    expect(offset).toBe(6030 - 2020);
    expect(uncertainty).toBe(20);
  });
});

describe("createClock", () => {
  it("is not ready until a sample lands, then positions the programme from the local clock", () => {
    let local = 10_000;
    const clock = createClock(() => local);
    expect(clock.ready).toBe(false);
    clock.sample(10_000, 500_000, 10_100);
    expect(clock.ready).toBe(true);
    expect(clock.position()).toBe(10_000 + (500_000 - 10_050));
    local = 12_000;
    expect(clock.position()).toBe(12_000 + (500_000 - 10_050));
  });

  it("keeps the best of the last five samples", () => {
    let local = 0;
    const clock = createClock(() => local);
    clock.sample(0, 1000, 10); // offset 995, rtt 10
    for (let i = 1; i <= 5; i++) clock.sample(i * 100, 1000 + i * 100 + 50, i * 100 + 60);
    // The first sample has left the window; the offsets of the rest are 1020.
    expect(clock.position()).toBe(1020);
  });
});
```

```js
// app/src/live/grid.test.js
import { describe, expect, it } from "vitest";
import { correction, shouldReload, slotAfter, slotAt } from "./grid.js";

const slots = [
  { kind: "shutter", at_ms: 1000, duration_ms: 1600, next: { run_id: "A" } },
  { kind: "replay", at_ms: 2600, duration_ms: 8000, run_id: "A" },
  { kind: "shutter", at_ms: 10600, duration_ms: 1600, next: null },
  { kind: "booth", at_ms: 12200, duration_ms: 20000, run_id: "A" },
];

describe("slotAt / slotAfter", () => {
  it("finds the slot containing an instant, or nothing", () => {
    expect(slotAt(slots, 999)).toBeNull();
    expect(slotAt(slots, 1000).kind).toBe("shutter");
    expect(slotAt(slots, 2599).kind).toBe("shutter");
    expect(slotAt(slots, 2600).kind).toBe("replay");
    expect(slotAt(slots, 32199).kind).toBe("booth");
    expect(slotAt(slots, 32200)).toBeNull();
  });

  it("walks to the slot that starts where this one ends", () => {
    expect(slotAfter(slots, slots[0])).toBe(slots[1]);
    expect(slotAfter(slots, slots[3])).toBeNull();
    // A rebuilt grid may not contain the same object; the boundary is what matters.
    expect(slotAfter(slots, { ...slots[1] })).toBe(slots[2]);
  });
});

describe("correction", () => {
  const buffered = [[0, 30]];
  it("leaves a quarter second alone, nudges under a second, seeks beyond", () => {
    expect(correction(10, 10.2, buffered)).toEqual({ rate: 1 });
    expect(correction(10, 10.6, buffered)).toEqual({ rate: 1.03 });
    expect(correction(10, 9.4, buffered)).toEqual({ rate: 0.97 });
    expect(correction(10, 12, buffered)).toEqual({ rate: 1, time: 12 });
  });

  it("seeks when forced, and only into buffered media", () => {
    expect(correction(10, 10.2, buffered, true)).toEqual({ rate: 1, time: 10.2 });
    expect(correction(10, 40, buffered)).toEqual({ rate: 1 });
  });
});

describe("shouldReload", () => {
  it("reloads only when the build changed", () => {
    expect(shouldReload("abc", "abc")).toBe(false);
    expect(shouldReload("abc", "def")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/clock.test.js src/live/grid.test.js`
Expected: FAIL, both modules unresolved.

- [ ] **Step 3: Write `clock.js`**

```js
// app/src/live/clock.js
//
// The shared clock: the server's now_ms against a local before and after. The
// sample with the smallest round trip has the least room for error; every
// screen that samples the same server lands within its round trip of the same
// programme position. Duck Jam's estimateClock, kept over a short window.

const WINDOW = 5;

export function estimateClock(samples) {
  const best = samples.reduce((a, b) => (b.after - b.before < a.after - a.before ? b : a));
  return {
    offset: best.server - (best.before + best.after) / 2,
    uncertainty: (best.after - best.before) / 2,
  };
}

export function createClock(now = () => Date.now()) {
  const samples = [];
  let offset = 0;
  return {
    get ready() {
      return samples.length > 0;
    },
    sample(before, server, after) {
      samples.push({ before, server, after });
      if (samples.length > WINDOW) samples.shift();
      offset = estimateClock(samples).offset;
    },
    position() {
      return now() + offset;
    },
  };
}
```

- [ ] **Step 4: Write `grid.js`**

```js
// app/src/live/grid.js
//
// Where a position falls in the grid, and how a video is kept on it. Pure.

export function slotAt(slots, ms) {
  return slots.find((s) => s.at_ms <= ms && ms < s.at_ms + s.duration_ms) ?? null;
}

export function slotAfter(slots, slot) {
  const end = slot.at_ms + slot.duration_ms;
  return slots.find((s) => s.at_ms === end) ?? null;
}

/** Duck Jam's servo, in seconds of media: a small error is left alone, a
 * larger one is chased at 3 % speed, past a second (or when forced, on
 * joining) the video seeks — but only to media it has buffered. */
export function correction(current, target, ranges, force = false) {
  const error = target - current;
  if (force || Math.abs(error) > 1) {
    return ranges.some(([start, end]) => target >= start && target < end)
      ? { rate: 1, time: target }
      : { rate: 1 };
  }
  return { rate: Math.abs(error) < 0.25 ? 1 : error > 0 ? 1.03 : 0.97 };
}

/** A page that has run for days reloads after a deploy, at the next shutter. */
export function shouldReload(started, current) {
  return current !== started;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/live/clock.test.js src/live/grid.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/live/clock.js app/src/live/clock.test.js app/src/live/grid.js app/src/live/grid.test.js
git commit -m "Live: the shared clock estimate, the grid position and the video servo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: The page — route, sheet, stage, states

**Files:**
- Modify: `app/src/api.js` (append), `app/src/router.js`, `app/src/main.js`, `app/index.html`
- Create: `app/public/live.css`, `app/src/live.js`, `app/src/live.test.js`
- Modify: `app/src/router.test.js`

**Interfaces:**
- Consumes: `createClock` (Task 4), `slotAt` (Task 4).
- Produces: `getLive()`, `getCommentary(runId) -> plan file | null`, `clipUrl(runId, name)` in `api.js`; route `#/live` (`liveHref`), `themeFor("live") === "live"`; `buildStage(root) -> { page, stage, bug, card, join }` where `page` is `main.live[data-live-state]`, `stage` is `div.live-stage`; `renderLive(root, state, { api } = {})` which polls the grid every 10 s, samples the clock, and sets `data-live-state` to `off-air`, `reconnecting` or `live`; sets `state.teardown`. The segments and the conductor are Tasks 6 to 9; until then the page shows "OFF AIR" or the "LIVE" bug over an empty stage.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/router.test.js`, in the `parseRoute` describe:

```js
  it("opens the channel", () => {
    expect(parseRoute("#/live")).toEqual({ view: "live" });
    expect(parseRoute("#/live/")).toEqual({ view: "live" });
  });
```

and a new describe:

```js
describe("themeFor", () => {
  it("dresses the channel in its own sheet", () => {
    expect(themeFor("live")).toBe("live");
    expect(themeFor("run")).toBe("race");
    expect(themeFor("menu")).toBe("club");
  });
});
```

```js
// app/src/live.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStage, renderLive } from "./live.js";

describe("buildStage", () => {
  it("is one stage with a bug, a card and a join button, and nothing else", () => {
    const root = document.createElement("div");
    const { page, stage, bug, card, join } = buildStage(root);
    expect(root.children).toHaveLength(1);
    expect(page.matches("main.live")).toBe(true);
    expect(stage.matches(".live-stage")).toBe(true);
    expect(bug.textContent).toBe("LIVE");
    expect(card.hidden).toBe(true);
    expect(join.hidden).toBe(true);
    expect(join.textContent).toBe("JOIN THE LIVE");
  });
});

describe("renderLive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is off air on an empty grid and keeps polling", async () => {
    const root = document.createElement("div");
    const state = {};
    const api = { getLive: vi.fn(async () => ({ version: 1, now_ms: 5000, build: "b", slots: [] })) };
    await renderLive(root, state, { api });
    const page = root.querySelector("main.live");
    expect(page.dataset.liveState).toBe("off-air");
    expect(page.querySelector(".live-card").hidden).toBe(false);
    expect(page.querySelector(".live-card").textContent).toBe("OFF AIR");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.getLive).toHaveBeenCalledTimes(2);
    state.teardown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.getLive).toHaveBeenCalledTimes(2);
  });

  it("says reconnecting when the grid cannot be read", async () => {
    const root = document.createElement("div");
    const api = { getLive: vi.fn(async () => { throw new Error("down"); }) };
    await renderLive(root, {}, { api });
    expect(root.querySelector("main.live").dataset.liveState).toBe("reconnecting");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/router.test.js src/live.test.js`
Expected: FAIL: `#/live` parses as the menu, `themeFor("live")` is `club`, `./live.js` unresolved.

- [ ] **Step 3: The API client**

Append to `app/src/api.js`:

```js
/** The channel's grid and the server's clock. Never cached: the clock is in it. */
export const getLive = () => json("/api/live", { cache: "no-store" });

/** A run's commentary (dialogue and plan), or null when it has no booth. */
export async function getCommentary(runId) {
  const response = await fetch(`/api/runs/${runId}/clip/commentary.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await detailFrom(response));
  return response.json();
}

export const clipUrl = (runId, name) => `/api/runs/${runId}/clip/${name}`;
```

- [ ] **Step 4: The route and the sheet**

In `app/src/router.js`, add `const LIVE = /^\/live\/?$/;` beside the others, and in `parseRoute`, before `return { view: "menu" }`:

```js
  if (LIVE.test(path)) return { view: "live" };
```

Add `export const liveHref = "#/live";` beside the other hrefs, and change `themeFor`:

```js
/**
 * Which placement sheet a view wears. The club for the front and a player,
 * the trackside sheet for anything with a stage, and the channel's own for
 * the live page, which is nothing but a stage.
 */
export const themeFor = (view) =>
  view === "live" ? "live" : ["race", "vote", "run"].includes(view) ? "race" : "club";
```

Update the comment at the top of `router.js` from "Four views" to "Five views". In `app/index.html`, after the race sheet's link:

```html
    <link rel="stylesheet" href="/live.css" data-theme="live" disabled />
```

- [ ] **Step 5: The sheet**

```css
/* app/public/live.css
   The channel: one 16:9 stage that fills the window, letterboxed on deep ink,
   and nothing else. The clips carry their own bands and the booth its caption
   panel; the page adds only the LIVE bug, the shutter, an OFF AIR card and
   the one button a browser may demand before it plays sound. Every size is
   taken from the stage's width, set on the page in pixels by live.js, so a
   television and a phone draw the same picture scaled. */
* { box-sizing: border-box; border-radius: 0; }
html, body { margin: 0; height: 100%; background: var(--deep-ink); color: var(--paper); font-family: var(--body); overflow: hidden; }
#app { min-height: 100vh; display: grid; place-items: center; }

.live {
  --stage-px: 1280;
  --u: calc(var(--stage-px) * 1px / 1280);   /* one "design pixel" at 1280 wide */
  position: relative;
  width: min(100vw, calc(100vh * 16 / 9));
  height: min(100vh, calc(100vw * 9 / 16));
  background: var(--deep-ink);
  overflow: hidden;
}
.live-stage { position: absolute; inset: 0; }
.live-video, .live-booth {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  background: var(--deep-ink); object-fit: cover;
}

/* The bug: the club's hot colour on ink, in the corner, as a channel wears its logo. */
.live-bug {
  position: absolute; top: calc(24 * var(--u)); right: calc(32 * var(--u)); z-index: 6;
  margin: 0; padding: calc(4 * var(--u)) calc(14 * var(--u));
  background: var(--ink); color: var(--paper);
  font: 400 calc(26 * var(--u)) / 1.2 var(--display); letter-spacing: 0.06em; text-transform: uppercase;
}
.live-bug::before { content: "●"; color: var(--magenta); margin-right: calc(10 * var(--u)); }
.live[data-live-state="reconnecting"] .live-bug::after { content: " · RECONNECTING"; color: var(--sky); }
.live[data-live-state="off-air"] .live-bug { display: none; }

/* The card: the wordmark and a word, on deep ink, when there is nothing to play. */
.live-card {
  position: absolute; inset: 0; z-index: 5; display: grid; place-items: center;
  font: 400 calc(120 * var(--u)) / 1 var(--display); letter-spacing: 0.04em; color: var(--paper);
}

/* The one button: the whole stage, until the browser lets the page play sound. */
.live-join {
  position: absolute; inset: 0; z-index: 8; border: 0; cursor: pointer;
  background: var(--ink-70); color: var(--paper);
  font: 400 calc(72 * var(--u)) / 1 var(--display); letter-spacing: 0.06em;
}
.live-join:focus-visible { outline: calc(4 * var(--u)) solid var(--cyan); outline-offset: calc(-8 * var(--u)); }

/* The caption panel under the booth: ink on a magenta offset shadow, a sky
   keyline, the yellow name tile in the corner, two lines of DM Sans 700. */
.live-caption {
  position: absolute; left: calc(32 * var(--u)); right: calc(32 * var(--u)); bottom: calc(24 * var(--u)); z-index: 4;
  padding: calc(57 * var(--u)) calc(24 * var(--u)) calc(20 * var(--u));
  background: var(--ink); border: calc(2 * var(--u)) solid var(--sky);
  box-shadow: calc(6 * var(--u)) calc(6 * var(--u)) 0 var(--magenta);
}
.live-caption-name {
  position: absolute; left: calc(-2 * var(--u)); top: calc(-2 * var(--u));
  padding: calc(3 * var(--u)) calc(16 * var(--u)); background: var(--yellow); color: var(--ink);
  font: 700 calc(36 * var(--u)) / 1.2 var(--body);
}
.live-caption-text { margin: 0; font: 700 calc(50 * var(--u)) / 1.12 var(--body); color: var(--paper); }

/* The shutter: paper, ink checker stripes top and bottom, the wordmark large,
   a cyan edge coming in and a magenta one going out. --shutter-x is the
   panel's offset as a fraction of the stage, set per frame by shutter.js. */
.live-shutter {
  position: absolute; inset: 0; z-index: 7; background: var(--paper);
  transform: translateX(calc(var(--shutter-x, -1) * 100%));
  display: grid; place-items: center; align-content: center; gap: calc(40 * var(--u));
  border-left: calc(8 * var(--u)) solid var(--cyan); border-right: calc(8 * var(--u)) solid var(--cyan);
}
.live-shutter-out { border-color: var(--magenta); }
.live-shutter::before, .live-shutter::after {
  content: ""; position: absolute; left: 0; right: 0; height: calc(48 * var(--u));
  background: repeating-linear-gradient(90deg, var(--ink) 0 calc(48 * var(--u)), transparent calc(48 * var(--u)) calc(96 * var(--u)));
}
.live-shutter::before { top: 0; }
.live-shutter::after { bottom: 0; background-position: calc(48 * var(--u)) 0; }
.live-shutter .wordmark { font-size: calc(140 * var(--u)); line-height: 0.9; text-align: center; }
.live-upnext { display: grid; justify-items: center; gap: calc(8 * var(--u)); color: var(--ink); }
.live-upnext .eyebrow { font-size: calc(22 * var(--u)); }
.live-upnext-event { font: 400 calc(64 * var(--u)) / 1 var(--display); text-transform: uppercase; }
.live-upnext-user { font-size: calc(28 * var(--u)); color: var(--sky-inked); }

[hidden] { display: none !important; }
```

- [ ] **Step 6: The page, first form**

```js
// app/src/live.js
//
// The channel. One stage every screen composes itself from the grid and the
// shared clock: the clips in a <video>, the booth in three.js, the shutter
// between them. This file owns the DOM, the polling and the page's states;
// live/channel.js drives the segments from the clock.

import { getLive } from "./api.js";
import { createClock } from "./live/clock.js";

const POLL_MS = 10_000;
const RECONNECTING_AFTER_MS = 30_000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The stage and its chrome, and nothing else on the page. */
export function buildStage(root) {
  const page = el("main", "live");
  page.dataset.liveState = "joining";
  const stage = el("div", "live-stage");
  const bug = el("p", "live-bug", "LIVE");
  const card = el("div", "live-card", "OFF AIR");
  card.hidden = true;
  const join = el("button", "live-join", "JOIN THE LIVE");
  join.type = "button";
  join.hidden = true;
  page.append(stage, bug, card, join);
  root.replaceChildren(page);
  return { page, stage, bug, card, join };
}

/** Polls the grid, samples the clock, and reports the state. Returns the poller. */
export function follow({ api, clock, now = () => Date.now(), onGrid, onState }) {
  let timer = null;
  let lastGood = now();
  let stopped = false;
  async function poll() {
    if (stopped) return;
    const before = now();
    try {
      const grid = await api.getLive();
      if (stopped) return;
      clock.sample(before, grid.now_ms, now());
      lastGood = now();
      onGrid(grid);
      onState(grid.slots.length ? "live" : "off-air");
    } catch {
      if (!stopped && now() - lastGood >= RECONNECTING_AFTER_MS) onState("reconnecting");
      else if (!stopped && !clock.ready) onState("reconnecting");
    }
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }
  const started = poll();
  return {
    started,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export async function renderLive(root, state, { api = { getLive } } = {}) {
  const { page, card } = buildStage(root);
  const clock = createClock();
  const setState = (value) => {
    page.dataset.liveState = value;
    card.hidden = value !== "off-air";
  };
  const poller = follow({ api, clock, onGrid: () => {}, onState: setState });
  state.teardown = () => poller.stop();
  await poller.started;
}
```

- [ ] **Step 7: The view**

In `app/src/main.js`, import `renderLive` from `./live.js` and add, before the `player` branch:

```js
    } else if (route.view === "live") {
      await renderLive(root, state);
```

Update the file's first comment from "Four views" to "Five views".

- [ ] **Step 8: Run the tests, build, and look**

Run: `cd app && npx vitest run src/router.test.js src/live.test.js && npm run build`
Expected: pass, build ok. Then `uv run --frozen arena serve --store ~/arena-board --user nicolas` and open `http://127.0.0.1:8000/#/live`: a deep-ink page with a 16:9 stage; the "LIVE" bug top right when the store has ready clips, "OFF AIR" on an empty store (`--store /tmp/empty`). Resize the window: the stage keeps 16:9, letterboxed.

- [ ] **Step 9: Commit**

```bash
git add app/src/api.js app/src/router.js app/src/router.test.js app/src/main.js app/index.html app/public/live.css app/src/live.js app/src/live.test.js
git commit -m "Live: the channel's page, one stage that polls the grid and samples the clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The replay segment

**Files:**
- Create: `app/src/live/replay.js`, `app/src/live/replay.test.js`

**Interfaces:**
- Consumes: `correction` (Task 4), `clipUrl` (Task 5), `isMuted` from `app/src/sound.js`.
- Produces: `createReplay(stage, { onRefused }) -> segment` with the segment interface every kind shares: `prepare(slot)` (loads the next clip in the idle `<video>`), `show(slot)` (its first frame, visible and paused: what the shutter uncovers), `play(slot, offsetMs)` (shows it, seeks, plays; calls `onRefused()` if the browser refuses to play), `seek(offsetMs)` (the servo, called on every tick), `stop()`, `muted(flag)`, and `failed` (true when the current video errored, so the conductor can move on).

- [ ] **Step 1: Write the failing tests**

```js
// app/src/live/replay.test.js
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReplay } from "./replay.js";

// jsdom has no media pipeline: play, load and buffered are stubbed on every
// video the segment makes.
function stubMedia(stage, { refuse = false } = {}) {
  for (const video of stage.querySelectorAll("video")) {
    video.load = vi.fn();
    video.pause = vi.fn();
    video.play = vi.fn(() => (refuse ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve()));
    for (const [name, value] of [["buffered", { length: 1, start: () => 0, end: () => 30 }],
                                 ["currentTime", 0], ["playbackRate", 1]]) {
      if (!Object.getOwnPropertyDescriptor(video, name)) {
        Object.defineProperty(video, name, { value, writable: true, configurable: true });
      }
    }
  }
}

const A = { kind: "replay", at_ms: 0, duration_ms: 8000, run_id: "A" };
const B = { kind: "replay", at_ms: 8000, duration_ms: 8000, run_id: "B" };

describe("createReplay", () => {
  let stage, replay, refused;
  beforeEach(() => {
    stage = document.createElement("div");
    refused = vi.fn();
    replay = createReplay(stage, { onRefused: refused });
    stubMedia(stage);
  });

  it("owns two videos and alternates them so the next clip is already loading", async () => {
    const videos = stage.querySelectorAll("video.live-video");
    expect(videos).toHaveLength(2);
    expect([...videos].every((v) => v.hidden)).toBe(true);
    replay.prepare(A);
    const first = [...videos].find((v) => v.getAttribute("src")?.includes("/A/"));
    expect(first).toBeDefined();
    expect(first.getAttribute("src")).toBe("/api/runs/A/clip/landscape.mp4");
    await replay.play(A, 2500);
    expect(first.hidden).toBe(false);
    expect(first.currentTime).toBeCloseTo(2.5);
    expect(first.play).toHaveBeenCalled();
    replay.prepare(B);
    const second = [...videos].find((v) => v !== first);
    expect(second.getAttribute("src")).toBe("/api/runs/B/clip/landscape.mp4");
    await replay.play(B, 0);
    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(false);
  });

  it("plays a slot it was not prepared for by preparing it first", async () => {
    await replay.play(B, 100);
    const shown = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    expect(shown.getAttribute("src")).toBe("/api/runs/B/clip/landscape.mp4");
  });

  it("shows a first frame under the shutter, then plays the same video without reloading", async () => {
    replay.show(A);
    const shown = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    expect(shown.currentTime).toBe(0);
    expect(shown.play).not.toHaveBeenCalled();
    await replay.play(A, 0);
    expect(shown.load).toHaveBeenCalledTimes(1);
    expect(shown.play).toHaveBeenCalledTimes(1);
  });

  it("servoes the clock: a nudge for a small error, a seek for a large one", async () => {
    await replay.play(A, 0);
    const video = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    video.currentTime = 4;
    replay.seek(4600);
    expect(video.playbackRate).toBe(1.03);
    replay.seek(9000);
    expect(video.currentTime).toBe(9);
    expect(video.playbackRate).toBe(1);
  });

  it("reports a refused play, and stops cleanly", async () => {
    stubMedia(stage, { refuse: true });
    await replay.play(A, 0);
    expect(refused).toHaveBeenCalled();
    replay.stop();
    expect([...stage.querySelectorAll("video")].every((v) => v.hidden)).toBe(true);
  });

  it("mutes and unmutes the video that is playing", async () => {
    await replay.play(A, 0);
    const video = [...stage.querySelectorAll("video")].find((v) => !v.hidden);
    replay.muted(true);
    expect(video.muted).toBe(true);
    replay.muted(false);
    expect(video.muted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/replay.test.js`
Expected: FAIL, `./replay.js` unresolved.

- [ ] **Step 3: Write the segment**

```js
// app/src/live/replay.js
//
// A clip in a <video>, servoed to the shared clock. Two elements alternate so
// the next clip is buffering while this one plays; the servo is Duck Jam's
// (grid.js `correction`): a nudge for a small error, a seek for a large one.

import { clipUrl } from "../api.js";
import { isMuted } from "../sound.js";
import { correction } from "./grid.js";

const ranges = (buffered) =>
  Array.from({ length: buffered.length }, (_, i) => [buffered.start(i), buffered.end(i)]);

export function createReplay(stage, { onRefused }) {
  const videos = [0, 1].map(() => {
    const video = document.createElement("video");
    video.className = "live-video";
    video.playsInline = true;
    video.preload = "auto";
    video.hidden = true;
    stage.append(video);
    return video;
  });
  let active = null; // { video, slot }
  let prepared = null;
  let aligned = false;
  let failed = false;

  function load(slot) {
    const video = videos.find((v) => v !== active?.video);
    video.src = clipUrl(slot.run_id, "landscape.mp4");
    video.load();
    prepared = { video, slot };
  }

  function servo(offsetMs, force) {
    if (!active) return;
    const { video } = active;
    const action = correction(video.currentTime, offsetMs / 1000, ranges(video.buffered), force);
    if (action.time !== undefined) video.currentTime = action.time;
    video.playbackRate = action.rate;
    aligned = true;
  }

  /** Make `slot` the active video, loading it if nothing prepared it. */
  function activate(slot) {
    if (active?.slot.run_id === slot.run_id) return active.video;
    if (prepared?.slot.run_id !== slot.run_id) load(slot);
    if (active) active.video.hidden = true;
    active = prepared;
    prepared = null;
    failed = false;
    aligned = false;
    const { video } = active;
    video.muted = isMuted();
    video.hidden = false;
    // Buffering loses the clock even under a second of lag; a seek's own
    // waiting event must not start another alignment.
    video.onwaiting = () => {
      if (!video.seeking) aligned = false;
    };
    video.onerror = () => {
      failed = true;
    };
    return video;
  }

  return {
    get failed() {
      return failed;
    },
    prepare(slot) {
      if (prepared?.slot.run_id !== slot.run_id && active?.slot.run_id !== slot.run_id) load(slot);
    },
    show(slot) {
      const video = activate(slot);
      video.currentTime = 0;
    },
    async play(slot, offsetMs) {
      const video = activate(slot);
      servo(offsetMs, true);
      try {
        await video.play();
      } catch {
        onRefused();
      }
    },
    seek(offsetMs) {
      servo(offsetMs, !aligned);
    },
    stop() {
      if (!active) return;
      active.video.pause();
      active.video.hidden = true;
      active.video.onwaiting = active.video.onerror = null;
      active = null;
      aligned = false;
    },
    muted(flag) {
      for (const video of videos) video.muted = flag;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/live/replay.test.js`
Expected: 6 passed. The stub defines `currentTime`, `playbackRate` and `buffered` as plain writable properties, so nothing depends on how much of the media pipeline jsdom implements.

- [ ] **Step 5: Commit**

```bash
git add app/src/live/replay.js app/src/live/replay.test.js
git commit -m "Live: the replay segment, two videos alternating under the clock's servo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: The booth — the set, two ducks, a beak and a camera

**Files:**
- Create: `app/src/live/set.js`, `app/src/live/set.test.js`
- Create: `app/src/live/booth.js`
- Modify: `app/src/rig.js` (`attachMeshes`, the `new Mesh(...)` line near 316)
- Modify: `app/src/viewer.js` (`loadAssets`, line 208: export it)

**Interfaces:**
- Consumes: `buildRigTree`, `attachMeshes`, `setJoint` (`rig.js`), `applyFrame` (`replay.js`), `loadAssets(rig)` (`viewer.js`, exported here), `direct` (Task 2), `poseAt` (Task 1).
- Produces: `set.js`: `BOOTH_TURN`, `token(name) -> Color`, `booth() -> Group` (z up, metres, named boxes), `checkerboard() -> CanvasTexture`. `booth.js`: `STAND` (the fourteen STAND angles), `createBooth(canvas) -> { prepare(commentary, posterUrl), draw(ms) -> cue | null, resize(width, height), dispose() }` where `commentary` is the `commentary.json` body (its `plan` is what plays) and `cue` is the caption at `ms`.

- [ ] **Step 1: Name every mesh and export the assets**

In `app/src/rig.js`, `attachMeshes`, right after `const mesh = new Mesh(geometry, material);`:

```js
      // Named after its file, so the booth can find the jaw and hang it on a pivot.
      mesh.name = geom.mesh;
```

In `app/src/viewer.js`, change `function loadAssets(rig) {` to `export function loadAssets(rig) {` and extend its comment: "Exported for the booth, which builds its own scene from the same rig."

- [ ] **Step 2: Write the failing test for the set**

```js
// app/src/live/set.test.js
import { describe, expect, it } from "vitest";
import { BOOTH_TURN, booth } from "./set.js";

describe("booth", () => {
  it("is Duck Jam's set, turned by a sixth of a turn, with every piece named", () => {
    const set = booth();
    expect(set.rotation.z).toBeCloseTo(BOOTH_TURN);
    const names = set.children.map((mesh) => mesh.name);
    for (const piece of ["riser", "back wall", "pegboard", "desk top", "CRT cabinet", "CRT glass",
                         "equipment case", "fluorescent tube", "peg hole"]) {
      expect(names).toContain(piece);
    }
    expect(names.filter((n) => n === "peg hole").length).toBeGreaterThan(30);
    const glass = set.getObjectByName("CRT glass");
    expect(glass.geometry.parameters).toMatchObject({ width: 0.108, height: 0.003, depth: 0.076 });
    expect(glass.position.toArray()).toEqual([-0.48, 0.149, 0.19]);
    expect(set.children.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd app && npx vitest run src/live/set.test.js`
Expected: FAIL, `./set.js` unresolved.

- [ ] **Step 4: Write the set**

```js
// app/src/live/set.js
//
// The booth's set, Duck Jam's commentators/set.mjs box for box: a municipal
// gym's stage with a workshop's furniture, in metres, z up, the whole group
// turned by π/6 so the duo faces the auditorium at an angle. Colours are the
// design tokens, read from the page, so the set and the site share one paint.

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

export const BOOTH_TURN = Math.PI / 6;

/** A design token as a three.js colour. */
export function token(name) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());
}

export function booth() {
  const group = new Group();
  group.rotation.z = BOOTH_TURN;
  const materials = new Map();
  function box(name, size, position, paint) {
    if (!materials.has(paint)) materials.set(paint, new MeshLambertMaterial({ color: token(paint) }));
    const mesh = new Mesh(new BoxGeometry(...size), materials.get(paint));
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  box("court paint", [0.95, 0.012, 0.0002], [0, -0.28, 0.0004], "sky");
  // A solid riser, wall returns and ribs give the room readable parallax.
  box("riser", [1.35, 0.94, 0.035], [0, 0.08, -0.018], "ink");
  box("back wall", [1.35, 0.035, 0.58], [0, 0.44, 0.29], "warm-paper");
  box("wall skirting", [1.35, 0.015, 0.12], [0, 0.415, 0.06], "sky");
  for (const x of [-0.66, 0.66]) box("wall return", [0.025, 0.38, 0.58], [x, 0.26, 0.29], "warm-paper");
  for (const x of [-0.57, 0, 0.57]) box("wall rib", [0.018, 0.03, 0.56], [x, 0.408, 0.28], "cream");
  box("wall stripe", [1.3, 0.008, 0.018], [0, 0.392, 0.17], "magenta");
  // A pegboard with recessed-looking square holes, kept behind the actors.
  box("pegboard frame", [0.47, 0.027, 0.2], [0, 0.39, 0.31], "ink");
  box("pegboard", [0.445, 0.008, 0.177], [0, 0.372, 0.31], "yellow");
  for (let x = -0.19; x < 0.2; x += 0.038) {
    for (let z = 0.25; z < 0.39; z += 0.035) box("peg hole", [0.006, 0.002, 0.006], [x, 0.367, z], "ink");
  }
  // Low desk: knees may sit behind it, but heads and beaks stay clear.
  box("desk top", [0.61, 0.12, 0.018], [0, -0.115, 0.075], "cream");
  box("desk apron", [0.56, 0.012, 0.042], [0, -0.165, 0.043], "sky");
  for (const x of [-0.25, 0.25]) {
    for (const y of [-0.15, -0.08]) box("desk leg", [0.012, 0.012, 0.07], [x, y, 0.035], "ink");
  }
  // The replay CRT is a physical cabinet with a recessed screen and trolley wheels.
  box("trolley shelf", [0.18, 0.14, 0.012], [-0.47, 0.22, 0.115], "cream");
  for (const x of [-0.535, -0.405]) {
    box("trolley upright", [0.01, 0.1, 0.1], [x, 0.22, 0.06], "ink");
    for (const y of [0.18, 0.26]) box("caster", [0.023, 0.018, 0.025], [x, y, 0.0125], "ink");
  }
  box("CRT cabinet", [0.16, 0.12, 0.13], [-0.47, 0.22, 0.186], "ink");
  box("CRT bezel", [0.135, 0.009, 0.105], [-0.47, 0.155, 0.186], "cream");
  box("CRT glass", [0.108, 0.003, 0.076], [-0.48, 0.149, 0.19], "deep-ink");
  box("CRT standby key", [0.008, 0.003, 0.008], [-0.417, 0.149, 0.16], "yellow");
  // Workshop storage balances the trolley without crowding Ray.
  box("equipment case", [0.17, 0.14, 0.14], [0.48, 0.26, 0.07], "sky");
  box("case lid", [0.18, 0.15, 0.012], [0.48, 0.26, 0.146], "ink");
  box("case handle", [0.06, 0.012, 0.012], [0.48, 0.183, 0.1], "cream");
  // White practical tubes, no bloom or coloured light.
  for (const x of [-0.36, 0.36]) {
    box("light bracket", [0.3, 0.07, 0.02], [x, 0.24, 0.345], "ink");
    box("fluorescent tube", [0.27, 0.025, 0.015], [x, 0.225, 0.329], "paper");
  }
  return group;
}

/** The floor's paint: two-by-two tiles of paper and warm paper, repeated. */
export function checkerboard() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const style = getComputedStyle(document.documentElement);
  for (const [i, j] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
    ctx.fillStyle = style.getPropertyValue((i + j) % 2 ? "--warm-paper" : "--paper").trim();
    ctx.fillRect(i * 32, j * 32, 32, 32);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npx vitest run src/live/set.test.js`
Expected: 1 passed. jsdom has no stylesheet, so `token()` builds colours from empty strings and three.js logs a warning per colour; the test asserts geometry and names, not paint.

- [ ] **Step 6: Write the booth**

```js
// app/src/live/booth.js
//
// Peter and Ray in their booth: two of the viewer's rigs in the STAND pose,
// only neck and head moving, a beak on a pivot, on Duck Jam's set, lit like
// every race page. The set is authored z up under one root turned like the
// rig's own; the camera is the one thing converted from Duck Jam's frame.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { applyFrame } from "../replay.js";
import { attachMeshes, buildRigTree, setJoint } from "../rig.js";
import { loadAssets } from "../viewer.js";
import { direct } from "./direction.js";
import { poseAt } from "./score.js";
import { BOOTH_TURN, booth as buildSet, checkerboard, token } from "./set.js";

/** The STAND keyframe: arena/constants.py DEFAULT_POSE, in JOINT_NAMES order. */
export const STAND = [
  0, -0.08726646259971647, -0.457924, -0.00494, 0.452984,
  0.3490658503988659, 0.3490658503988659, 0, 0,
  0, 0.08726646259971647, 0.457924, 0.00494, -0.452984,
];
// The trunk's height in the keyframe: course.py's SPAWN_HEIGHT_M.
const TRUNK_HEIGHT = 0.12;
// Which joint holds which index of a trace frame's fourteen angles.
const HEAD = { neck: ["neck_pitch", 5], pitch: ["head_pitch", 6], yaw: ["head_yaw", 7], roll: ["head_roll", 8] };
// Where each duck stands along the desk, and which livery it wears.
const SEATS = { peter: { x: -0.16, livery: "classic" }, ray: { x: 0.16, livery: "blue" } };
// Facing the auditorium: the camera's own bearing from the desk.
const FACING = -Math.PI / 3;
// The lower beak, hung on a pivot in the jaw body's frame, as Duck Jam's articulateMouth.
const JAW_MESHES = new Set(["jaw.stl", "jaw_soft.stl"]);
const JAW_PIVOT = [-0.008, 0, -0.025];
const JAW_OPEN = 0.32;
// A glance's yaw is signed so Peter looks toward Ray and Ray toward Peter. The
// plan's sign was Duck Jam's; if the two glance away from each other here, this
// is the one line to flip.
const LOOK = 1;
const PIXEL_RATIO_CAP = 1.5;

/** A trace frame that stands at booth-local x, turned to face the camera. */
function standFrame(x) {
  const yaw = FACING;
  return Float32Array.from([
    x * Math.cos(BOOTH_TURN), x * Math.sin(BOOTH_TURN), TRUNK_HEIGHT,
    Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2),
    ...STAND,
  ]);
}

function jawPivot(rig) {
  const body = rig.bodies.get("jaw_soft");
  const pivot = new Group();
  pivot.name = "jaw pivot";
  pivot.position.set(...JAW_PIVOT);
  for (const mesh of body.children.filter((child) => JAW_MESHES.has(child.name))) {
    mesh.position.sub(pivot.position);
    pivot.add(mesh);
  }
  body.add(pivot);
  return pivot;
}

// Duck Jam's frame is z up; three.js is y up.
const toY = ([x, y, z]) => [x, z, -y];

export async function createBooth(canvas) {
  const { kinematics, geometries } = await loadAssets("legs");
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO_CAP));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const scene = new Scene();
  scene.environment = environment;
  scene.background = token("deep-ink");
  // The viewer's four lights; the key also throws the set's shadows.
  scene.add(new AmbientLight(0xffffff, 0.18));
  const key = new DirectionalLight(0xffffff, 1.7);
  key.position.set(1.4, 2.6, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 6 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.003;
  scene.add(key);
  const fill = new DirectionalLight(0xbfd2ff, 0.55);
  fill.position.set(-1.6, 1.1, -1.3);
  scene.add(fill);
  const rim = new DirectionalLight(0xffd9b0, 0.5);
  rim.position.set(-0.6, 0.9, 2.2);
  scene.add(rim);
  scene.add(new HemisphereLight(0xcfe0ff, 0x2b2b30, 0.12));

  // The set, z up under a root turned like the rig's duck_root.
  const root = new Group();
  root.rotation.x = -Math.PI / 2;
  scene.add(root);
  const set = buildSet();
  root.add(set);
  const floor = new Mesh(new PlaneGeometry(1.3, 0.9), new MeshLambertMaterial({ map: checkerboard() }));
  floor.rotation.z = BOOTH_TURN;
  floor.position.set(-0.04, 0.069, 0.0001);
  root.add(floor);
  // A transparent shadow receiver keeps the checkerboard's paint.
  const shade = new Mesh(floor.geometry, new ShadowMaterial({ opacity: 0.22 }));
  shade.rotation.copy(floor.rotation);
  shade.position.copy(floor.position);
  shade.position.z += 0.0001;
  shade.receiveShadow = true;
  root.add(shade);
  // The CRT's glass shows the poster of the run under discussion. A box's
  // faces are +x, -x, +y, -y, +z, -z; the screen is the -y face, toward the desk.
  const glass = set.getObjectByName("CRT glass");
  const screen = new MeshBasicMaterial({ color: token("deep-ink") });
  glass.material = [glass.material, glass.material, glass.material, screen, glass.material, glass.material];

  const actors = Object.fromEntries(
    Object.entries(SEATS).map(([speaker, seat]) => {
      const rig = buildRigTree(kinematics);
      attachMeshes(rig, kinematics, geometries, { livery: seat.livery });
      rig.placer.traverse((object) => {
        if (object.isMesh) object.castShadow = true;
      });
      const jaw = jawPivot(rig);
      scene.add(rig.placer);
      return [speaker, { rig, jaw, frame: standFrame(seat.x) }];
    }),
  );

  const camera = new PerspectiveCamera(32, 16 / 9, 0.05, 50);
  const loader = new TextureLoader();
  let plan = null;
  let cameraAt = null;
  let poster = null;

  return {
    prepare(commentary, posterUrl) {
      plan = commentary.plan;
      cameraAt = direct(plan);
      poster?.dispose();
      poster = null;
      screen.map = null;
      screen.color.copy(token("deep-ink"));
      screen.needsUpdate = true;
      loader.loadAsync(posterUrl).then((texture) => {
        if (plan !== commentary.plan) return;
        texture.colorSpace = SRGBColorSpace;
        poster = texture;
        screen.map = texture;
        screen.color.set(0xffffff);
        screen.needsUpdate = true;
      }).catch(() => {});
    },
    draw(ms) {
      if (!plan) return null;
      const framing = cameraAt(ms, camera.aspect);
      camera.position.set(...toY(framing.position));
      camera.lookAt(...toY(framing.target));
      for (const [speaker, actor] of Object.entries(actors)) {
        const pose = poseAt(plan, speaker, ms);
        applyFrame(actor.rig, actor.frame);
        for (const [key, [joint, index]] of Object.entries(HEAD)) {
          const turn = key === "yaw" ? pose.yaw * LOOK : pose[key];
          setJoint(actor.rig, joint, actor.frame[7 + index] + turn);
        }
        actor.jaw.rotation.y = pose.mouth * JAW_OPEN;
      }
      renderer.render(scene, camera);
      return plan.captions.find((c) => c.start_ms <= ms && ms < c.end_ms) ?? null;
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      poster?.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose();
        for (const material of [].concat(object.material ?? [])) {
          material.map?.dispose();
          material.dispose();
        }
      });
      environment.dispose();
      renderer.dispose();
    },
  };
}
```

- [ ] **Step 7: Look at it**

There is no WebGL under vitest; the booth is checked on screen. Start the app on the store that has a commentary from the server plan's Task 10 (`~/arena-board`, run `01M2JFJX7CF5HF7ZWTZAA1`), and the Vite dev server so the module can be imported as it is:

```bash
uv run --frozen arena serve --store ~/arena-board --user nicolas &
cd app && npm run dev &
```

Then this throwaway script (keep it in the session scratchpad, never in the repository), using the headless Chrome the machine already has:

```js
// scratchpad/booth-shot.cjs
const puppeteer = require("/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer");
(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto("http://127.0.0.1:5173/#/live", { waitUntil: "networkidle0" });
  for (const [ms, name] of [[100, "wide"], [16000, "close"], [5000, "mouth"]]) {
    await page.evaluate(async (ms) => {
      const { createBooth } = await import("/src/live/booth.js");
      window.shot ??= await (async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280; canvas.height = 720;
        Object.assign(canvas.style, { position: "fixed", inset: 0, zIndex: 99 });
        document.body.append(canvas);
        const booth = await createBooth(canvas);
        booth.resize(1280, 720);
        const commentary = await (await fetch("/api/runs/01M2JFJX7CF5HF7ZWTZAA1/clip/commentary.json")).json();
        booth.prepare(commentary, "/api/runs/01M2JFJX7CF5HF7ZWTZAA1/clip/poster.png");
        await new Promise((r) => setTimeout(r, 1500));
        return booth;
      })();
      window.shot.draw(ms);
    }, ms);
    await page.screenshot({ path: `booth-${name}.png` });
  }
  await browser.close();
})();
```

Run: `node scratchpad/booth-shot.cjs` and open the three PNGs. Expected: `wide` shows both ducks behind the cream desk, the yellow pegboard, the CRT with the run's poster on its glass to the left, the blue case to the right, shadows on the checkerboard; `close` frames one duck; `mouth` (an instant inside the first caption) shows the speaker's lower beak open. If a duck looks away from its partner during a glance (draw an instant inside a `look` gesture of the plan), flip `LOOK` to `-1`. If the poster hangs upside down on the CRT, set `texture.center.set(0.5, 0.5); texture.rotation = Math.PI;` in `prepare`'s `then`. Ducks floating or sunk: `TRUNK_HEIGHT`. Ducks facing away: `FACING`'s sign. Note what you changed in the commit message.

- [ ] **Step 8: Commit**

```bash
git add app/src/live/set.js app/src/live/set.test.js app/src/live/booth.js app/src/rig.js app/src/viewer.js
git commit -m "Live: the booth, Duck Jam's set with two of the viewer's ducks, a beak on a pivot and its camera

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Voice, wind and the room tone

**Files:**
- Create: `app/src/live/voice.js`, `app/src/live/voice.test.js`
- Create: `app/src/live/ambience.js`

**Interfaces:**
- Consumes: `synthesize` (Task 1), `StadiumAmbience`, `prepareStadium` (`clip/stadium.js`), `stadiumDirection` (`clip/direction.js`).
- Produces: `loadTones(fetcher = fetch) -> { peter, ray }`; `windGust(random = Math.random, rate = 48000) -> Float32Array` (0.36 s); `createVoice(context, tones) -> { start(plan, offsetMs), stop(), muted(flag), gust(atSeconds) }`; `createAmbience(context) -> Promise<{ start(), stop(), muted(flag) }>`.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/live/voice.test.js
import { describe, expect, it } from "vitest";
import { loadTones, windGust } from "./voice.js";

describe("loadTones", () => {
  it("reads the two raw float32 files", async () => {
    const bytes = new Float32Array(28800).fill(0.5).buffer;
    const fetcher = async (url) => ({ ok: url.includes("commentator-"), arrayBuffer: async () => bytes });
    const tones = await loadTones(fetcher);
    expect(tones.peter).toHaveLength(28800);
    expect(tones.ray[0]).toBe(0.5);
    await expect(loadTones(async () => ({ ok: false }))).rejects.toThrow("No voice for peter");
  });
});

describe("windGust", () => {
  const seeded = (seed) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  it("is 0.36 s at -1 dBFS, silent at both ends, faded in over 0.1 s", () => {
    const gust = windGust(seeded(1040));
    expect(gust).toHaveLength(17280);
    expect(gust[0]).toBe(0);
    expect(gust.at(-1)).toBe(0);
    expect(Math.max(...gust.map(Math.abs))).toBeCloseTo(10 ** (-1 / 20), 3);
    const early = Math.max(...gust.subarray(0, 240).map(Math.abs));
    expect(early).toBeLessThan(0.3);
    expect(windGust(seeded(1040))).toEqual(gust);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/voice.test.js`
Expected: FAIL, `./voice.js` unresolved.

- [ ] **Step 3: Write `voice.js`**

```js
// app/src/live/voice.js
//
// The booth's sound: the plan's notes sung from the two microduck tones into
// one buffer, started at the join offset so every screen sings the same
// sample at the same instant; and the shutter's wind, Duck Jam's
// build-wind.mjs made in the page.

import { synthesize } from "./score.js";

const RATE = 48000;
const BREATHS_S = [0, 1.16];

export async function loadTones(fetcher = fetch) {
  const [peter, ray] = await Promise.all(
    ["peter", "ray"].map(async (name) => {
      const response = await fetcher(`/sound/commentator-${name}.f32`);
      if (!response.ok) throw new Error(`No voice for ${name}`);
      return new Float32Array(await response.arrayBuffer());
    }),
  );
  return { peter, ray };
}

/** 0.36 s of pink noise between 180 and 4 200 Hz, faded in over 0.1 s and out
 * over the last 0.22 s, peaking at -1 dBFS. Pure, so it is testable. */
export function windGust(random = Math.random, rate = RATE) {
  const length = Math.round(0.36 * rate);
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, low = 0, high = 0, peak = 0;
  const lowK = (2 * Math.PI * 4200) / rate;
  const highK = (2 * Math.PI * 180) / rate;
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    // Pink, Kellet's three-pole approximation.
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = b0 + b1 + b2 + white * 0.1848;
    low += lowK * (pink - low);
    high += highK * (low - high);
    const t = i / rate;
    const fade = Math.min(t / 0.1, 1, Math.max(0, (0.36 - t) / 0.22));
    out[i] = (low - high) * fade;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const gain = 10 ** (-1 / 20) / (peak || 1);
  for (let i = 0; i < length; i++) out[i] *= gain;
  out[0] = out[length - 1] = 0;
  return out;
}

export function createVoice(context, tones) {
  const gain = context.createGain();
  gain.connect(context.destination);
  let source = null;
  const wind = context.createBuffer(1, Math.round(0.36 * RATE), RATE);
  wind.copyToChannel(windGust(), 0);
  return {
    start(plan, offsetMs) {
      this.stop();
      const pcm = synthesize(plan, tones);
      const buffer = context.createBuffer(2, pcm.length / 2, RATE);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) data[i] = pcm[i * 2 + channel];
      }
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0, Math.min(offsetMs, plan.duration_ms) / 1000);
    },
    stop() {
      source?.stop();
      source?.disconnect();
      source = null;
    },
    muted(flag) {
      gain.gain.value = flag ? 0 : 1;
    },
    /** Two breaths with the shutter's sweeps, from `atSeconds` on the context's clock. */
    gust(atSeconds) {
      for (const breath of BREATHS_S) {
        const burst = context.createBufferSource();
        burst.buffer = wind;
        burst.connect(gain);
        burst.start(atSeconds + breath);
      }
    },
  };
}
```

- [ ] **Step 4: Write `ambience.js`**

```js
// app/src/live/ambience.js
//
// The hall under the booth: the clip's stadium engine with a neutral
// direction, at half the clip's crowd, scheduled in real time the way the
// engine's own comment prescribes.

import { stadiumDirection } from "../clip/direction.js";
import { StadiumAmbience, prepareStadium } from "../clip/stadium.js";

const VOLUME = 25;
const HORIZON_S = 0.45;
const EVERY_MS = 40;

export async function createAmbience(context) {
  await prepareStadium(OfflineAudioContext);
  const gain = context.createGain();
  gain.connect(context.destination);
  let engine = null;
  let timer = null;
  return {
    start() {
      this.stop();
      engine = new StadiumAmbience(context, {
        direction: stadiumDirection(), volume: VOLUME, destination: gain,
      });
      timer = setInterval(() => engine.scheduleUntil(context.currentTime + HORIZON_S), EVERY_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      engine?.stop();
      engine?.dispose();
      engine = null;
    },
    muted(flag) {
      gain.gain.value = flag ? 0 : 1;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/live/voice.test.js && npm run build`
Expected: pass, build ok (the ambience has no unit test: it is the clip's engine in real time, heard in Task 9's check).

- [ ] **Step 6: Commit**

```bash
git add app/src/live/voice.js app/src/live/voice.test.js app/src/live/ambience.js
git commit -m "Live: the voice sung from the plan, the shutter's wind and the hall's room tone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: The conductor, and the page in its final form

**Files:**
- Create: `app/src/live/interlude.js`
- Create: `app/src/live/channel.js`, `app/src/live/channel.test.js`
- Modify: `app/src/live.js`, `app/src/live.test.js`

**Interfaces:**
- Consumes: everything above: `createReplay` (Task 6), `createBooth` (Task 7), `createCaptions`, `createShutter`, `shutterAt`, `TRANSITION_MS` (Task 3), `createVoice`, `loadTones`, `createAmbience` (Task 8), `createClock`, `slotAt`, `slotAfter`, `shouldReload` (Task 4), `getLive`, `getCommentary`, `clipUrl` (Task 5), `isMuted`.
- Produces: `createInterlude(stage, { audio }) -> segment` (the booth as a segment: `prepare`, `show`, `play`, `seek`, `stop`, `muted`, `failed`, plus `resize(width, height)`); `audio` is a function returning `{ voice, ambience } | null`, because the audio context may only exist after a click. `createChannel({ clock, segments, shutter, onState, onReload, gust }) -> { update(grid), tick(), rejoin(), halt(), resume(), reloadAtNextShutter(), stop() }` where `segments = { replay, booth }`; the page calls `tick()` on every animation frame.

- [ ] **Step 1: Write the failing tests for the conductor**

```js
// app/src/live/channel.test.js
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "./channel.js";

function segment() {
  return { prepare: vi.fn(), show: vi.fn(), play: vi.fn(), seek: vi.fn(), stop: vi.fn(), failed: false };
}

const slots = [
  { kind: "shutter", at_ms: 0, duration_ms: 1600, next: { run_id: "A", event: "2 m Sprint", user: "carol" } },
  { kind: "replay", at_ms: 1600, duration_ms: 8000, run_id: "A" },
  { kind: "shutter", at_ms: 9600, duration_ms: 1600, next: null },
  { kind: "booth", at_ms: 11200, duration_ms: 20000, run_id: "A" },
  { kind: "shutter", at_ms: 31200, duration_ms: 1600, next: { run_id: "B", event: "2 m Sprint", user: "dan" } },
  { kind: "replay", at_ms: 32800, duration_ms: 8000, run_id: "B" },
];

describe("createChannel", () => {
  let now, replay, booth, shutter, onState, onReload, gust, channel;
  beforeEach(() => {
    now = 0;
    replay = segment();
    booth = segment();
    shutter = { draw: vi.fn(), hide: vi.fn() };
    onState = vi.fn();
    onReload = vi.fn();
    gust = vi.fn();
    channel = createChannel({
      clock: { position: () => now }, segments: { replay, booth }, shutter, onState, onReload, gust,
    });
    channel.update({ slots });
  });

  it("enters the slot containing now at its offset, and keeps servoing it", () => {
    now = 4600;
    channel.tick();
    expect(replay.play).toHaveBeenCalledWith(slots[1], 3000);
    now = 4700;
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(1);
    expect(replay.seek).toHaveBeenLastCalledWith(3100);
    expect(onState).toHaveBeenLastCalledWith("live");
  });

  it("keeps the last picture under the sweep, uncovers the next at the midpoint, and plays it on time", () => {
    now = 9000;
    channel.tick();
    now = 9700; // inside the shutter after the replay
    channel.tick();
    expect(replay.stop).not.toHaveBeenCalled();
    expect(shutter.draw).toHaveBeenLastCalledWith(100, null);
    expect(booth.prepare).toHaveBeenCalledWith(slots[3]);
    now = 10500; // past the midpoint
    channel.tick();
    expect(replay.stop).toHaveBeenCalledTimes(1);
    expect(booth.show).toHaveBeenCalledWith(slots[3]);
    channel.tick();
    expect(booth.show).toHaveBeenCalledTimes(1);
    now = 11300;
    channel.tick();
    expect(booth.play).toHaveBeenCalledWith(slots[3], 100);
    expect(shutter.hide).toHaveBeenCalled();
  });

  it("breathes the wind only when a shutter starts under it", () => {
    now = 20;
    channel.tick();
    expect(gust).toHaveBeenCalledTimes(1);
    now = 9800;
    channel.tick();
    expect(gust).toHaveBeenCalledTimes(1);
  });

  it("prefetches the slot after the next shutter while a segment plays", () => {
    now = 2000;
    channel.tick();
    expect(booth.prepare).toHaveBeenCalledWith(slots[3]);
    now = 12000;
    channel.tick();
    expect(replay.prepare).toHaveBeenCalledWith(slots[5]);
  });

  it("covers a failed segment with the shutter until its slot ends", () => {
    now = 2000;
    channel.tick();
    replay.failed = true;
    channel.tick();
    expect(shutter.draw).toHaveBeenLastCalledWith(800, null);
    expect(replay.seek).toHaveBeenCalledTimes(1);
  });

  it("is off air with no slot, halts and resumes, and rejoins after a refusal", () => {
    channel.update({ slots: [] });
    channel.tick();
    expect(onState).toHaveBeenLastCalledWith("off-air");
    channel.update({ slots });
    now = 2000;
    channel.tick();
    channel.halt();
    expect(replay.stop).toHaveBeenCalledTimes(1);
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(1);
    channel.resume();
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(2);
    channel.rejoin();
    channel.tick();
    expect(replay.play).toHaveBeenCalledTimes(3);
  });

  it("reloads at a shutter's midpoint, never mid-segment", () => {
    now = 2000;
    channel.tick();
    channel.reloadAtNextShutter();
    channel.tick();
    expect(onReload).not.toHaveBeenCalled();
    now = 10500;
    channel.tick();
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/live/channel.test.js`
Expected: FAIL, `./channel.js` unresolved.

- [ ] **Step 3: Write the booth segment**

```js
// app/src/live/interlude.js
//
// The booth as a segment: the commentary file fetched ahead, the scene
// prepared with the run's poster, drawn from the slot's offset on every tick,
// the captions following the plan, the voice and the room tone from the
// audio the page opened.

import { clipUrl, getCommentary } from "../api.js";
import { isMuted } from "../sound.js";
import { createBooth } from "./booth.js";
import { createCaptions } from "./captions.js";

export async function createInterlude(stage, { audio }) {
  const canvas = document.createElement("canvas");
  canvas.className = "live-booth";
  canvas.hidden = true;
  stage.append(canvas);
  const booth = await createBooth(canvas);
  const captions = createCaptions(stage);
  const files = new Map();
  let current = null; // { slot, file }
  let failed = false;

  const fileFor = (slot) => {
    if (!files.has(slot.run_id)) files.set(slot.run_id, getCommentary(slot.run_id).catch(() => null));
    return files.get(slot.run_id);
  };

  async function mount(slot) {
    if (current?.slot.run_id === slot.run_id) return current.file;
    const file = await fileFor(slot);
    files.clear();
    failed = !file;
    if (!file) return null;
    booth.prepare(file, clipUrl(slot.run_id, "poster.png"));
    current = { slot, file };
    return file;
  }

  return {
    get failed() {
      return failed;
    },
    prepare(slot) {
      fileFor(slot);
    },
    async show(slot) {
      if (!(await mount(slot))) return;
      canvas.hidden = false;
      this.seek(0);
    },
    async play(slot, offsetMs) {
      const file = await mount(slot);
      if (!file) return;
      canvas.hidden = false;
      const sound = audio();
      sound?.voice.start(file.plan, offsetMs);
      sound?.ambience.start();
      this.muted(isMuted());
      this.seek(offsetMs);
    },
    seek(offsetMs) {
      if (!current) return;
      const cue = booth.draw(offsetMs);
      if (cue) captions.show(cue);
      else captions.hide();
    },
    stop() {
      canvas.hidden = true;
      captions.hide();
      const sound = audio();
      sound?.voice.stop();
      sound?.ambience.stop();
    },
    muted(flag) {
      const sound = audio();
      sound?.voice.muted(flag);
      sound?.ambience.muted(flag);
    },
    resize(width, height) {
      booth.resize(width, height);
      captions.resize(width);
    },
    dispose() {
      this.stop();
      booth.dispose();
    },
  };
}
```

- [ ] **Step 4: Write the conductor**

```js
// app/src/live/channel.js
//
// The conductor: on every frame, where the clock says we are in the grid,
// and what that means for the segments. It enters a slot at its offset,
// servos the one playing, keeps the last picture under a shutter's sweep,
// uncovers the next segment at the shutter's midpoint, prefetches one slot
// ahead, and is the one place a reload is allowed to happen.

import { slotAfter, slotAt } from "./grid.js";
import { shutterAt } from "./shutter.js";

const FRESH_MS = 40; // a shutter entered within its first frame gets its wind

export function createChannel({ clock, segments, shutter, onState, onReload, gust }) {
  let slots = [];
  let current = null; // the slot playing
  let previous = null; // the segment kept on screen under a shutter's sweep
  let uncovered = false;
  let halted = false;
  let reloading = false;

  const segmentFor = (slot) => (slot && slot.kind !== "shutter" ? segments[slot.kind] : null);

  function stopPrevious() {
    previous?.stop();
    previous = null;
  }

  function leave() {
    stopPrevious();
    segmentFor(current)?.stop();
    current = null;
  }

  function enter(slot, offset) {
    if (slot.kind === "shutter") {
      // The picture under the sweep is the segment that was playing.
      previous = segmentFor(current);
      current = slot;
      uncovered = false;
      if (offset < FRESH_MS) gust();
      return;
    }
    stopPrevious();
    segmentFor(current)?.stop();
    current = slot;
    segmentFor(slot).play(slot, offset);
  }

  return {
    update(grid) {
      slots = grid.slots;
    },
    tick() {
      if (halted) return;
      const ms = clock.position();
      const slot = slotAt(slots, ms);
      if (!slot) {
        leave();
        shutter.hide();
        onState(slots.length ? "live" : "off-air");
        return;
      }
      const offset = ms - slot.at_ms;
      if (!current || current.at_ms !== slot.at_ms || current.kind !== slot.kind) enter(slot, offset);
      if (slot.kind === "shutter") {
        const next = slotAfter(slots, slot);
        shutter.draw(offset, slot.next);
        if (shutterAt(offset).destination) {
          if (!uncovered) {
            uncovered = true;
            stopPrevious();
            if (reloading) {
              reloading = false;
              onReload();
              return;
            }
            if (next) segmentFor(next)?.show(next);
          }
        } else if (next) {
          segmentFor(next)?.prepare(next);
        }
      } else {
        const segment = segmentFor(slot);
        if (segment.failed) {
          shutter.draw(800, null);
        } else {
          shutter.hide();
          segment.seek(offset);
        }
        const next = slotAfter(slots, slot);
        const after = next && slotAfter(slots, next);
        if (after) segmentFor(after)?.prepare(after);
      }
      onState("live");
    },
    /** After a refused play: leave, so the next tick enters again with sound allowed. */
    rejoin() {
      leave();
    },
    halt() {
      halted = true;
      leave();
      shutter.hide();
    },
    resume() {
      halted = false;
    },
    reloadAtNextShutter() {
      reloading = true;
    },
    stop() {
      leave();
      shutter.hide();
    },
  };
}
```

- [ ] **Step 5: Run the conductor's tests**

Run: `cd app && npx vitest run src/live/channel.test.js`
Expected: 7 passed. In the second test, the first tick at 9 000 enters the replay (`play(slots[1], 7400)`), the tick at 9 700 enters the shutter keeping the replay as `previous`, and the tick at 11 300 enters the booth with `play(slots[3], 100)` after `show` was called once at 10 500.

- [ ] **Step 6: The page in its final form**

Replace `app/src/live.js` with:

```js
// app/src/live.js
//
// The channel. One stage every screen composes itself from the grid and the
// shared clock: the clips in a <video>, the booth in three.js, the shutter
// between them. This file owns the DOM, the polling, the audio the browser
// may refuse until a click, and the page's states; live/channel.js drives
// the segments from the clock.

import { getLive } from "./api.js";
import { createAmbience } from "./live/ambience.js";
import { createChannel } from "./live/channel.js";
import { createClock } from "./live/clock.js";
import { shouldReload } from "./live/grid.js";
import { createInterlude } from "./live/interlude.js";
import { createReplay } from "./live/replay.js";
import { createShutter } from "./live/shutter.js";
import { createVoice, loadTones } from "./live/voice.js";

const POLL_MS = 10_000;
const RECONNECTING_AFTER_MS = 30_000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The stage and its chrome, and nothing else on the page. */
export function buildStage(root) {
  const page = el("main", "live");
  page.dataset.liveState = "joining";
  const stage = el("div", "live-stage");
  const bug = el("p", "live-bug", "LIVE");
  const card = el("div", "live-card", "OFF AIR");
  card.hidden = true;
  const join = el("button", "live-join", "JOIN THE LIVE");
  join.type = "button";
  join.hidden = true;
  page.append(stage, bug, card, join);
  root.replaceChildren(page);
  return { page, stage, bug, card, join };
}

/** Polls the grid, samples the clock, and reports the state. */
export function follow({ api, clock, now = () => Date.now(), onGrid, onState }) {
  let timer = null;
  let lastGood = now();
  let stopped = false;
  async function poll() {
    if (stopped) return;
    clearTimeout(timer);
    const before = now();
    try {
      const grid = await api.getLive();
      if (stopped) return;
      clock.sample(before, grid.now_ms, now());
      lastGood = now();
      onGrid(grid);
      onState(grid.slots.length ? "live" : "off-air");
    } catch {
      if (!stopped && (!clock.ready || now() - lastGood >= RECONNECTING_AFTER_MS)) onState("reconnecting");
    }
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }
  const started = poll();
  return {
    started,
    poll,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** The audio the booth needs, or null while the browser refuses to start it. */
async function openAudio(tones) {
  const context = new AudioContext();
  await context.resume().catch(() => {});
  if (context.state !== "running") {
    context.close();
    return null;
  }
  return { context, voice: createVoice(context, await tones()), ambience: await createAmbience(context) };
}

export async function renderLive(root, state, { api = { getLive }, tones = loadTones, audio: open = openAudio } = {}) {
  const { page, stage, card, join } = buildStage(root);
  const clock = createClock();
  const controller = new AbortController();
  const { signal } = controller;
  let audio = null;
  let build = null;
  const setState = (value) => {
    page.dataset.liveState = value;
    card.hidden = value !== "off-air";
  };

  const shutter = createShutter(stage);
  const replay = createReplay(stage, { onRefused: () => { join.hidden = false; } });
  const interlude = await createInterlude(stage, { audio: () => audio });
  const channel = createChannel({
    clock, segments: { replay, booth: interlude }, shutter, onState: setState,
    onReload: () => location.reload(),
    gust: () => audio?.voice.gust(audio.context.currentTime),
  });
  const poller = follow({
    api, clock, onState: setState,
    onGrid: (grid) => {
      channel.update(grid);
      if (build === null) build = grid.build;
      else if (shouldReload(build, grid.build)) channel.reloadAtNextShutter();
    },
  });

  // Sound: try at once (a kiosk and OBS allow it); a refusal shows the one button.
  audio = await open(tones);
  if (!audio) join.hidden = false;
  join.addEventListener("click", async () => {
    join.hidden = true;
    audio = await open(tones);
    channel.rejoin();
  }, { signal });

  const watcher = new ResizeObserver(() => {
    const width = page.clientWidth;
    page.style.setProperty("--stage-px", String(width));
    interlude.resize(width, page.clientHeight);
  });
  watcher.observe(page);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) channel.halt();
    else {
      poller.poll();
      channel.resume();
    }
  }, { signal });

  let frame = requestAnimationFrame(function loop() {
    channel.tick();
    frame = requestAnimationFrame(loop);
  });

  state.teardown = () => {
    cancelAnimationFrame(frame);
    poller.stop();
    channel.stop();
    watcher.disconnect();
    controller.abort();
    interlude.dispose();
    audio?.context.close();
  };
  await poller.started;
}
```

- [ ] **Step 7: Keep the page's tests true**

`createInterlude` needs WebGL, which jsdom has not; the page tests inject it. Replace the two `renderLive` tests in `app/src/live.test.js` with:

```js
vi.mock("./live/interlude.js", () => ({
  createInterlude: async () => ({
    prepare() {}, show() {}, play() {}, seek() {}, stop() {}, muted() {}, resize() {}, dispose() {},
    failed: false,
  }),
}));

describe("renderLive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
  });
  afterEach(() => vi.useRealTimers());
  const options = (getLive) => ({ api: { getLive }, tones: async () => ({}), audio: async () => null });

  it("is off air on an empty grid, keeps polling, and offers the join button when sound is refused", async () => {
    const root = document.createElement("div");
    const state = {};
    const getLive = vi.fn(async () => ({ version: 1, now_ms: 5000, build: "b", slots: [] }));
    await renderLive(root, state, options(getLive));
    const page = root.querySelector("main.live");
    expect(page.dataset.liveState).toBe("off-air");
    expect(page.querySelector(".live-card").hidden).toBe(false);
    expect(page.querySelector(".live-join").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getLive).toHaveBeenCalledTimes(2);
    state.teardown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getLive).toHaveBeenCalledTimes(2);
  });

  it("says reconnecting when the grid cannot be read", async () => {
    const root = document.createElement("div");
    await renderLive(root, {}, options(vi.fn(async () => { throw new Error("down"); })));
    expect(root.querySelector("main.live").dataset.liveState).toBe("reconnecting");
  });
});
```

(`vi.mock` is hoisted; keep the import of `./live.js` at the top as it is.)

- [ ] **Step 8: Run everything, build, and watch two cycles**

Run: `cd app && npx vitest run && npm run build`
Expected: every test passes bar the 4 pre-existing ones.

Then `uv run --frozen arena serve --store ~/arena-board --user nicolas` and open `http://127.0.0.1:8000/#/live` in a browser. Expected, through two full cycles (with the two runs of `~/arena-board`, about two minutes): the "JOIN THE LIVE" button on a cold tab (the browser refuses sound); after the click, the replay of the current slot at the right offset, the shutter with the wordmark and the wind, the UP NEXT card on the way out, the booth with Peter and Ray talking about the sprint with captions, the room tone under them, and the CRT showing the run's poster. Open a second tab on the same URL: both show the same slot within a fraction of a second. Hide a tab: it goes silent; return: it rejoins where the clock says. Mute the site elsewhere (`localStorage.setItem("arena.muted", "1")` in the console, reload): captions without sound.

- [ ] **Step 9: Commit**

```bash
git add app/src/live/interlude.js app/src/live/channel.js app/src/live/channel.test.js app/src/live.js app/src/live.test.js
git commit -m "Live: the conductor plays the grid from the clock, and the page opens sound, rejoins and reloads at a shutter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The home page's ON AIR tile

**Files:**
- Modify: `app/src/home.js`, `app/src/home.test.js`

**Interfaces:**
- Consumes: `getLive` (Task 5), `liveHref` (Task 5), `slotAt` (Task 4).
- Produces: `liveTile(grid) -> HTMLElement | null`: an `a.live-tile[href="#/live"]` naming the event and author on air now (from the nearest shutter's `next`), or null when the grid is empty.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/home.test.js`:

```js
import { liveTile } from "./home.js";

describe("the ON AIR tile", () => {
  const grid = {
    now_ms: 5000,
    slots: [
      { kind: "shutter", at_ms: 0, duration_ms: 1600, next: { run_id: "A", event: "2 m Sprint", user: "carol" } },
      { kind: "replay", at_ms: 1600, duration_ms: 8000, run_id: "A" },
      { kind: "shutter", at_ms: 9600, duration_ms: 1600, next: null },
      { kind: "booth", at_ms: 11200, duration_ms: 20000, run_id: "A" },
      { kind: "shutter", at_ms: 31200, duration_ms: 1600, next: { run_id: "B", event: "1.5 m Hill Climb", user: "dan" } },
    ],
  };

  it("names what is on air now and links to the channel", () => {
    const tile = liveTile(grid);
    expect(tile.matches("a.live-tile")).toBe(true);
    expect(tile.getAttribute("href")).toBe("#/live");
    expect(tile.querySelector(".live-tile-bug").textContent).toBe("ON AIR");
    expect(tile.querySelector(".live-tile-what").textContent).toBe("2 m Sprint · @carol");
  });

  it("names the run the booth is talking about, and the next one when between runs", () => {
    expect(liveTile({ ...grid, now_ms: 20000 }).querySelector(".live-tile-what").textContent).toBe("2 m Sprint · @carol");
    expect(liveTile({ ...grid, now_ms: 31500 }).querySelector(".live-tile-what").textContent).toBe("1.5 m Hill Climb · @dan");
  });

  it("is nothing when the channel is off air", () => {
    expect(liveTile({ now_ms: 1, slots: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL, `liveTile` is not exported.

- [ ] **Step 3: Write the tile and hang it on the front**

In `app/src/home.js`, add to the imports `getLive` from `./api.js`, `liveHref` from `./router.js`, and:

```js
/** What the channel is showing now: the latest shutter card at or before now,
 * which names the run every following slot is about. */
export function liveTile(grid) {
  if (!grid.slots.length) return null;
  const cards = grid.slots.filter((s) => s.kind === "shutter" && s.next && s.at_ms <= grid.now_ms);
  const card = cards.at(-1) ?? grid.slots.find((s) => s.kind === "shutter" && s.next);
  if (!card) return null;
  const tile = el("a", "live-tile");
  tile.href = liveHref;
  tile.append(
    el("span", "live-tile-bug", "ON AIR"),
    el("span", "live-tile-what", `${card.next.event} · @${card.next.user}`),
  );
  return tile;
}
```

In `renderHome`, after `hall.append(door);`:

```js
  // A door to the channel, read once: it is a way in, not a monitor.
  const grid = await getLive().catch(() => null);
  const onAir = grid && liveTile(grid);
  if (onAir) door.append(onAir);
```

Add to `app/public/club.css`, at the end:

```css
/* The door to the channel: the club's hot colour on ink, the way a set-top
   box says a channel is on. */
.live-tile {
  display: inline-flex; align-items: center; gap: 12px; margin-top: 18px; padding: 8px 16px;
  background: var(--ink); color: var(--paper); text-decoration: none;
  border: 2px solid var(--ink); box-shadow: var(--shadow-sticker-max) var(--shadow-sticker-max) 0 var(--magenta);
}
.live-tile-bug { font: 400 0.9rem/1 var(--display); letter-spacing: 0.06em; color: var(--magenta); }
.live-tile-bug::before { content: "● "; }
.live-tile-what { font: 600 0.95rem/1 var(--body); }
.live-tile:hover { background: var(--deep-ink); }
.live-tile:focus-visible { outline: 3px solid var(--cyan); outline-offset: 3px; }
```

- [ ] **Step 4: Run the tests and look**

Run: `cd app && npx vitest run src/home.test.js && npm run build`
Then reload `http://127.0.0.1:8000/#/` on the running app: under the lede, an "ON AIR · 2 m Sprint · @…" tile that opens the channel; on an empty store, no tile.

- [ ] **Step 5: Commit**

```bash
git add app/src/home.js app/src/home.test.js app/public/club.css
git commit -m "Home: an ON AIR tile naming what the channel is showing, the door to it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: On screen — stills, a television, OBS

**Files:**
- None committed. Screenshots go in the session scratchpad; findings go in the commit message of the fix they cause, if any.

- [ ] **Step 1: Stills at two widths**

With the app and the Vite dev server running (Task 7, step 7), this throwaway script takes the page itself, not the module, at 1280 and 390 px, at instants inside a replay, a shutter and a booth:

```js
// scratchpad/live-shots.cjs
const puppeteer = require("/opt/homebrew/lib/node_modules/@modelcontextprotocol/server-puppeteer/node_modules/puppeteer");
(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  const grid = await (await fetch("http://127.0.0.1:8000/api/live")).json();
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.goto("http://127.0.0.1:5173/#/live", { waitUntil: "networkidle0" });
    for (const kind of ["replay", "shutter", "booth"]) {
      const slot = grid.slots.find((s) => s.kind === kind && s.at_ms > Date.now() + 3000);
      if (!slot) continue;
      await new Promise((r) => setTimeout(r, slot.at_ms + (kind === "shutter" ? 600 : 2000) - Date.now()));
      await page.screenshot({ path: `live-${kind}-${width}.png` });
      const state = await page.evaluate(() => document.querySelector("main.live").dataset.liveState);
      console.log(kind, width, state);
    }
  }
  await browser.close();
})();
```

Expected: six stills. At 1280: the replay full-bleed with the clip's own bands, the shutter's paper panel mid-sweep with the wordmark, the booth with both ducks and a caption whose two lines fit inside the panel. At 390: the same picture letterboxed in a 16:9 band across the phone, the caption still legible, nothing clipped, `data-live-state` reading `live` on every still. A caption running past its panel means `captions.js`'s measure and `live.css`'s `--u` disagree; both take the stage's width in pixels.

- [ ] **Step 2: Two screens, one second**

Open `#/live` in two browsers (or a browser and the puppeteer page) and read `document.querySelector("video:not([hidden])")?.currentTime` in both consoles at the same moment during a replay: within 0.3 s of each other. During a booth, the same caption on both.

- [ ] **Step 3: A television**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir=/tmp/arena-kiosk "http://127.0.0.1:8000/#/live"
```

Expected: full screen, sound from the first frame, no "JOIN THE LIVE" button. Leave it for fifteen minutes: the Activity Monitor's memory for the tab stays flat across cycles (the booth is one scene; nothing accumulates). Then rebuild with a one-character change to `app/src/live.js` (`npm run build`) while it runs: within a minute, at a shutter, the page reloads on its own and keeps playing. Quit with Cmd+Q.

- [ ] **Step 4: OBS**

In OBS, a Browser Source with the URL above, 1920×1080, "Control audio via OBS" on, and, while the Space is private, use "Interact" once to sign in. Expected: the channel with its audio in the mix, ready to stream. No code changes; note in the spec's "Kiosk, OBS, and the broadcaster" if anything needed a flag the spec does not mention.

- [ ] **Step 5: Record what was seen**

If any step above changed code, it was committed in its task's commit style. If none did, nothing to commit: write in the final report which stills were taken and what the memory reading was.

---

## Done when

- `cd app && npx vitest run` passes (bar the 4 pre-existing Node 25 failures) and `npm run build` succeeds.
- `#/live` on the local app plays two full cycles: replays, shutters with the UP NEXT card and the wind, booths with Peter and Ray, captions and the room tone, the CRT showing the poster; two tabs agree on the slot; hiding and returning rejoins; the page reloads at a shutter after a build.
- Chrome in kiosk mode plays with sound from the first frame; OBS's Browser Source carries the page with audio.
- The home page shows the ON AIR tile whenever the grid is not empty.
- Whatever the on-screen checks changed (`LOOK`, `FACING`, `TRUNK_HEIGHT`, the poster's orientation) is in a commit message, so the spec's "The booth" section can be corrected in the same commit.
