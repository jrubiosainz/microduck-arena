# The duck's mouth and voice on the Got a Talent stage — design

Date: 2026-10-12. Status: approved in brainstorm, section by section; awaiting written review.

## Goal

A MicroDuck Got a Talent performance can do what the real microduck does with its pad's two
triggers:

- **RT** opens the mouth and quacks (the voice bank's `chirp` tag);
- **LT** opens the mouth and goes "wheee" for as long as it is held.

The author writes both in the performance's `timeline.json`. The duck's beak opens and its
voice is heard everywhere a performance is replayed: the run page, the anonymous ballot, the
workshop's training page, the clip and therefore the live channel.

**Success:** a performance whose timeline holds RT and LT shows the duck's beak opening and
plays the quack and the wheee at the right instants, the same on every page and in the clip.

## What the real robot does (pollen-robotics/microduck @ e597877)

The rules below are copied, not invented:

- `padd/src/main.rs`: the mouth is `max(rt, lt)`, sent every tick as `robot.mouth { open }`;
  RT quacks (`robot.sound chirp`) on its rising edge across 0.3; LT ≥ 0.3 holds the wheee
  (`robot.sound wheee hold:true`), and dropping under 0.3 releases it (`hold:false`).
- `duck-control/src/model.rs`: `mouth_target(open)` maps 0..1 onto −5°..+30°. The mouth is in
  no policy: every network has 14 actions and skips `MOUTH_INDEX`.
- `robotd/src/sound.rs`: one sound at a time, and a new one cuts the one playing. The wheee
  is a ride, start segment then the loop repeated while held; a release cuts it at once (the
  end segment only plays when a hold goes stale, which a timeline never does). A one-shot that
  arrives during a ride is dropped, not queued.
- `sounds` crate: `chirp` has 12 variants, `wheee` 6 (each start/loop/end); the robot picks a
  variant per play.

## Decisions taken

| Decision | Why, and what it rules out |
| --- | --- |
| **Triggers are a 4th optional group in each keyframe, `"triggers": [rt, lt]`, values 0..1** | The pad's two analog triggers, as the timeline already writes twist, head and body. Piecewise constant and complete per keyframe like the other groups: a keyframe that leaves it out has both triggers released. Rules out a separate event list (`{"t": 3.2, "sound": "chirp"}`), which would be a second time axis with its own rules and could not say "half-open, silent". |
| **The pad's rules exactly** | Mouth `max(rt, lt)`; a quack on RT's rising edge across 0.3; wheee while LT ≥ 0.3; a quack during a wheee dropped; a new quack cuts the previous. The real robot can later replay the same file by sending the calls `padd` sends. |
| **Not a policy input, not simulated** | The 13 command numbers and the 61-D observation are untouched; the MJCF's jaw is welded (no joint), as in every training. The mouth and the voice are added to the replay. The runner, the golden run and `RUNNER_VERSION` do not change; races ignore timelines as before. |
| **`timeline_version` stays 1** | A file without triggers is unchanged. An Arena older than this one refuses a file with triggers with `keyframes[i]: unknown keys ['triggers']`, which names the problem. |
| **The track is stored with the run** | `hub_fetch` already reads and checks `timeline.json` at the pinned revision; the Space keeps the compact trigger track in the `RunRecord`. Rules out reading the file from the Hub at replay time: a deleted or private repo would silence a performance. |
| **One voice for every performer** | A fixed seed, like the `classic` livery on an anonymous ballot: the same duck in the workshop, on the ballot and in the clip, and no field in the file. Different from Peter's (142) and Ray's (92). Chosen by the owner by ear from 4–5 candidate seeds. Rules out a per-duck or per-run voice. |
| **The robot's synth, in the page** | The booth's wasm module (`app/voice`, the `sounds` crate at e597877) gains the `chirp` and `wheee` recipes. No audio file is added, and the voice is the real crate's. Rules out a pre-rendered WAV bank (~1.5 MB, one voice frozen into files). |
| **Deterministic variants** | The robot draws a variant at random; the Arena takes the sound's rank in the performance instead — the k-th quack plays variant k mod 12, the k-th wheee variant k mod 6 — so a performance always sounds the same, on every page and in its clip, and two quacks in a row never repeat a recording. |

## 1. The format

```json
{"t": 4.0, "twist": [1, 0, 0], "triggers": [1, 0]},
{"t": 4.3, "twist": [1, 0, 0]},
{"t": 6.0, "head": [0, 0.3, 0, 0], "triggers": [0, 1]},
{"t": 8.0}
```

Here the duck quacks at 4.0 s (beak wide open until 4.3 s), then goes "wheee" with its beak
open from 6.0 s to 8.0 s.

- `triggers` is exactly 2 finite numbers, each within [0, 1]; anything else is refused with
  its place (`keyframes[3].triggers[1]: 1.5 is outside [0, 1]`), the loader's existing style.
- Before the first keyframe there is nothing: an RT at 1 on the keyframe at t = 0 quacks at
  t = 0.
- To hold LT across keyframes, repeat it in each. To quack twice, press, release, press.
- A sound still playing when the performance ends (or when a cut-short trace stops) is cut.

## 2. The Arena (server)

- **`arena/timeline.py`.** The loader accepts the `triggers` group and checks it.
  `Timeline` gains `triggers: tuple[tuple[float, float], ...]`, parallel to `commands`;
  `command_at` is unchanged. `trigger_track(timeline)` returns the change points only,
  `[[t, rt, lt], ...]` starting at t = 0, or `None` when both triggers stay at zero
  throughout.
- **`arena/store.py`.** `RunRecord.triggers: list | None = None`, written by `to_dict`, read
  with `.get` like `timeline_sha256`: every run recorded before this stays silent with its
  beak closed.
- **`arena/web/routes_submit.py`.** An entry stores `trigger_track(fetched.timeline)`. A
  re-race through `recover` fetches the timeline again and stores it again.
- **What the site reads.**
  - `GET /api/runs/{id}`: `triggers`.
  - `GET /api/events/{id}/ballot`: `triggers`, one track per lane in lane order (or `null`).
    It carries the performance and no identity.
  - The workshop's checkpoint evaluation (`arena/workshop/evaluations.py`): `triggers` of the
    timeline it played, beside `trace_b64` and the `timeline` key. A trigger edit changes the
    file's sha256, so the checkpoint is played again (about 1.5 s), as any timeline edit.

## 3. The site

- **`app/src/duck-voice.js`, pure.** From a trigger track:
  - `mouthTrack(track, frames)` — the beak's opening at every 50 Hz frame, eased like a servo
    (time constant ~60 ms), computed once so scrubbing and the clip agree;
  - `voiceEvents(track, duration)` — every sound with its start, its end and its variant:
    quacks on RT's edges, wheee spans on LT, a quack dropped during a wheee, a quack cutting
    the previous one, everything cut at `duration`.

  The viewer and the clip both read this one list.
- **The beak.** `booth.js`'s `jawPivot` moves into `rig.js` and both use it (the comment in
  `rig.js` that says the jaw pivot is left out is updated). On the stage the performer's beak
  turns by `opening × 35°`, the real −5°..+30° travel; checked on a capture that the beak does
  not look broken at full travel. It follows the player's time, so it is right in a scrub, a
  clip frame and a ballot.
- **The time origin** is the trace's first frame. The clip's lead-in settle holds the first
  keyframe's opening and makes no sound, as the settle plays the first keyframe.
- **The synth.** `app/voice/src/lib.rs` gains `chirp(seed, variant)` and
  `wheee(seed, variant, segment)` (0 start, 1 loop, 2 end) writing into the existing samples
  buffer; `app/public/sound/microduck-voice.wasm` is rebuilt with the command in
  `app/voice/Cargo.toml`; `voice.js`'s `loadSynth` exposes them.
- **The viewer** (run page, ballot, workshop). A lane entry may carry `triggers`; on a stage
  the viewer starts each sound when the player's time crosses its start. After a jump — the
  loop wrapping, a scrub, new lanes — it stops everything and resumes a wheee it lands inside
  (from its loop segment). It honours the existing `arena.muted` setting and adds no button.
  A browser that refuses audio before any gesture leaves the replay playing in silence;
  nothing waits on a sound (`sound.js`'s rule).
- **The clip.** `clip/score.js` adds the duck's sounds to the cues, offset by the tape's
  start; `clip/soundtrack.js` accepts a cue made of synthesized samples beside a file. A
  wheee is built as on the robot: start segment, loop repeated, cut at its end.

## 4. Docs, tests, verification, release

- **Docs (English).** `docs/guides/challenges/got-a-talent.md` — the workshop's "What the
  numbers mean" link — gains a "Mouth and voice" section with the rules and the example
  above. microduck-challenges' README points to it.
- **Tests.**
  - pytest: the loader (accepted shapes, each refusal named), `trigger_track`, the
    `RunRecord` round trip (an old record stays silent), an entry storing its track, the run,
    ballot and workshop-evaluation payloads.
  - vitest: `duck-voice` (threshold, edges, a quack dropped during a wheee, cuts,
    determinism), `mouthTrack`, the viewer resuming after a jump, the clip's cues.
  - The wasm rebuilt; a Node test checks `chirp` and `wheee` return samples.
- **Seen and heard before it is called done.** A local stage preview with a timeline that
  quacks and wheees: a headless capture with the beak open, and the clip's soundtrack
  rendered to a WAV the owner can listen to. The candidate seeds come first.
- **Release, each step on the owner's yes.** Version 0.4.4; the wheel on
  pollen-robotics/microduck-arena-wheels and tag v0.4.4; push main (the Space deploys);
  microduck-challenges relocked onto 0.4.4 and pushed straight after, so a workshop accepts
  triggers.

## Out of scope

- The real robot replaying `timeline.json` (its daemon does not read it yet; the format is
  ready for it).
- A voice per duck; a mute button.
- Optional, decided later: quacks and a wheee in the reference choreography
  (`got_a_talent/timeline.json`) and republishing the reference, which would be a new entry.
