# The arena's sound kit

Do not edit these by hand. Re-vendor by copying the named files from
`design/sound/` in the `duckJam` repository, at or after the commit below;
the foghorn alone is made here, by its script (see below).

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
carries over unchanged for them; the foghorn and the microduck voice files are the exceptions the
closing sections explain.

## The cues

| File | Duration | Used for | Licence |
| --- | --- | --- | --- |
| `press.wav` | 0.09 s | A post-it lifts off the row the instant a pick is clicked; a star is born (one pop per cluster). | CC0-1.0 |
| `stamp.wav` | 0.18 s | The envelope's flap seals shut once the server confirms the vote. | CC0-1.0 |
| `points.wav` | 0.04 s | A tick per flap while the player chip's counter rolls. | CC0-1.0 |
| `queue-tick.wav` | 0.14 s | A star lands on the player chip (one tick per cluster). | CC0-1.0 |
| `microduck-victory.wav` | 1.16 s | The author's duck crosses the line on the publication page. | Apache-2.0 (see below) |
| `rank-climb.wav` | 0.62 s | The author's row climbs the pegboard. | CC0-1.0 |
| `microduck-chirp.wav` | 0.16 s | With the climb: the duck's own note as it lands on its peg. | CC0-1.0 |
| `foghorn.wav` | 1.78 s | The clip's start: the horn as the title leaves and the ducks set off. | CC0-1.0 (see below) |
| `microduck-fall.wav` | 0.58 s | The clip's outro after a DNF stamp: the duck's own falling note. | Apache-2.0 (see below) |

`app/src/sound.js` is the only code that plays them. The booth plays from a click; the
publication page's reveal may start from a deep link with no gesture yet, and a play the
browser refuses is silence, never an error.

## The foghorn

`foghorn.wav` is not vendored: `scripts/synth_foghorn.py` in this repository computes it sample by
sample — two detuned harmonic stacks a fifth apart, an envelope and a soft clip, no recording —
and re-running it writes the same bytes. It is dedicated to the public domain under the same
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) as the kit. Change the sound by
changing the script, never the file.

## The microduck voice

`microduck-victory.wav` and `microduck-fall.wav` are not `build-kit.mjs` cues: Duck Jam
renders them with the robot's own Rust synthesiser from
[pollen-robotics/microduck, sounds](https://github.com/pollen-robotics/microduck/tree/e597877c5a9460f4c3837dc3cdab088705212c5d/sounds),
revision `e597877c5a9460f4c3837dc3cdab088705212c5d`, then modifies the recipe (victory) or the
audio (fall). That synthesiser is Apache-2.0 — `MICRODUCK-LICENSE.txt` beside them is its
licence — so these two files travel with it, not with the CC0 dedication above.
