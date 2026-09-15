# The voting booth's sound kit

Do not edit these by hand. Re-vendor by copying the named files from
`design/sound/` in the `duckJam` repository, at or after the commit below.

| field | value |
| --- | --- |
| source | `duckJam`, `design/sound/` (synthesised by `design/sound/build-kit.mjs`; not a recording) |
| commit | `e46ee014389375e24f5eb5bd6c5d034298f6bcd2` |
| vendored | 2026-09-15T20:47:10Z |
| licence | CC0-1.0 (see `duckJam`'s `design/sound/LICENSES.md`) |

## Why CC0-1.0 needs no attribution row

Every file below is computed sample by sample -- noise bursts, filters and pitch sweeps -- by
`build-kit.mjs` in that repository; no third-party recording or sample library enters it. The
kit's own `LICENSES.md` dedicates that original material to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): "this repository made them,
nothing here needs attribution, and all of it may be redistributed, modified and re-cut." These
three files are unmodified copies, so that dedication carries over unchanged.

## The three cues

| File | Duration | Used for | Licence |
| --- | --- | --- | --- |
| `press.wav` | 0.09 s | A post-it lifts off the row the instant a pick is clicked. | CC0-1.0 |
| `stamp.wav` | 0.18 s | The envelope's flap seals shut once the server confirms the vote. | CC0-1.0 |
| `points.wav` | 0.04 s | The two "+1" tokens land on the player chip. | CC0-1.0 |

`app/src/sound.js` is the only code that plays them, and only ever from a click.
