# The arena's sound kit

Do not edit these by hand. Re-vendor by copying the named files from
`design/sound/` in the `duckJam` repository, at or after the commit below;
the air horn alone is not from there (see below).

| field | value |
| --- | --- |
| source | `duckJam`, `design/sound/` (synthesised by `design/sound/build-kit.mjs`; not a recording) |
| commit | `2d35443b` |
| vendored | 2026-09-16T17:15:13Z |
| licence | CC0-1.0 (see `duckJam`'s `design/sound/LICENSES.md`) |

## Why CC0-1.0 needs no attribution row

Every file below is computed sample by sample -- noise bursts, filters and pitch sweeps -- by
`build-kit.mjs` in that repository; no third-party recording or sample library enters it. The
kit's own `LICENSES.md` dedicates that original material to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): "this repository made them,
nothing here needs attribution, and all of it may be redistributed, modified and re-cut." The
CC0-1.0 rows below are unmodified copies of files `build-kit.mjs` computed, so that dedication
carries over unchanged for them; the air horn and the microduck voice files are the exceptions the
closing sections explain.

## The cues

| File | Duration | Used for | Licence |
| --- | --- | --- | --- |
| `press.wav` | 0.09 s | A post-it lifts off the row the instant a pick is clicked; a star is born (one pop per cluster). | CC0-1.0 |
| `stamp.wav` | 0.18 s | The envelope's flap seals shut once the server confirms the vote. | CC0-1.0 |
| `points.wav` | 0.04 s | A tick per flap while the player chip's counter rolls. | CC0-1.0 |
| `queue-tick.wav` | 0.14 s | A star lands on the player chip (one tick per cluster). | CC0-1.0 |
| `microduck-victory.wav` | 1.16 s | The author's duck crosses the line on the publication page. | Apache-2.0 (see below) |
| `microduck-victory-echo.mp3` | 4.59 s | The clip's outro on a pass: the victory with a stadium's echo. | Apache-2.0 (see below) |
| `rank-climb.wav` | 0.62 s | The author's row climbs the pegboard. | CC0-1.0 |
| `microduck-chirp.wav` | 0.16 s | With the climb: the duck's own note as it lands on its peg. | CC0-1.0 |
| `air-horn.mp3` | 2.10 s | The clip's start: the horn as the title leaves and the ducks set off, its stadium echo in the file. | CC0-1.0 (see below) |
| `microduck-fall.wav` | 0.58 s | The clip's outro after a DNF stamp: the duck's own falling note. | Apache-2.0 (see below) |
| `commentator-peter.f32` | 0.60 s | The booth: Peter Duckry's one note, sung once per syllable of his lines. | Apache-2.0 (see below) |
| `commentator-ray.f32` | 0.60 s | The booth: Ray Quackson's one note. | Apache-2.0 (see below) |

`app/src/sound.js` plays the cues; `app/src/live/voice.js` plays the two tones. The booth's
sound starts whenever the browser lets an audio context run: at once on a kiosk or in OBS,
late on a slow device, or on the viewer's click. The publication page's reveal may start from
a deep link with no gesture yet, and a play the browser refuses is silence, never an error.

## The air horn

`air-horn.mp3` is not a `build-kit.mjs` cue: Nicolas Rabault made it for the arena on
2026-09-17 (the Audacity project `HORNAir`), echo included, so the clip plays it dry. He
dedicates it to the public domain under the same
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) as the kit.

## The microduck voice

`microduck-victory.wav`, `microduck-fall.wav`, `commentator-peter.f32` and `commentator-ray.f32`
are not `build-kit.mjs` cues: Duck Jam renders them with the robot's own Rust synthesiser (the two
tones with `design/sound/commentators.rs` and `commentator-voice.rs` at Duck Jam commit `2d35443b`,
raw 48 kHz mono float32, no header) from
[pollen-robotics/microduck, sounds](https://github.com/pollen-robotics/microduck/tree/e597877c5a9460f4c3837dc3cdab088705212c5d/sounds),
revision `e597877c5a9460f4c3837dc3cdab088705212c5d`, then modifies the recipe (victory) or the
audio (fall); the two tones are that synthesiser's own output, unmodified. It is Apache-2.0 —
`MICRODUCK-LICENSE.txt` beside them is its licence — so these four files travel with it, not
with the CC0 dedication above.
`microduck-victory-echo.mp3` is Nicolas Rabault's echo of `microduck-victory.wav`, made for the
clip on 2026-09-17, and travels with it.
