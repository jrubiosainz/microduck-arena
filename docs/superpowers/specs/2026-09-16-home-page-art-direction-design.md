# The front page, in the charter's own voice

**Date:** 2026-09-16
**Status:** design, approved in chat, not yet implemented
**Charter:** `charte-microduck.svg` — Pollen Robotics, V1 · 2026, already generated into
`app/public/design/tokens.css`. This design changes how the front page *uses* that
charter; it adds no colour, face or effect the charter does not already name.

## The problem

The front page wears the charter's colours and faces and almost nothing else. Three
measurements, taken on 2026-09-16 rather than assumed:

| Measured | Consequence |
| --- | --- |
| `--space-chapter-top-*`, `--space-chapter-bottom-*` and `--space-title-to-grid-*` are defined in `tokens.css` and referenced **nowhere**. `club.css` opens a chapter with `margin-top: var(--space-gutter-max)` — 28 px where the charter says 104–128 px. | The hero, the ladder and the flyer wall read as one undifferentiated column instead of three chapters. |
| `effects.css` ships 16 classes. The front page uses **zero** (`signage.js` uses two tilts, and that is the strip). | No grain, no scanlines, no ray fan, no aberration. The charter's signature is absent from the page that should carry it most. |
| `home.js` writes `el("span", "eyebrow", "Race")` on **every** flyer. | Highest Jump, Hold Your Ground, Rough Ground and the Swag Contest are all labelled races. Three of them are not, and one is not even timed. |

Orange is the charter's carrying accent — "bouton principal, surtitres, halos". The front
page does not use it at all: the flyers cycle yellow, sky and cream as flat grounds.

## Decisions

| Decision | Why, and what it rules out |
| --- | --- |
| **`category` is a required manifest field** | `status` and `order` have safe defaults; `category` has none. Defaulting to `race` would let a new event become a race silently, which is the bug this fixes. A manifest that omits it fails at load, loudly, the way a missing `title` already does. |
| **Three categories: `race`, `challenge`, `showcase`** | The user's own split, and it cuts where the events actually differ: a race is timed over a course, a challenge measures something else, a showcase is judged by vote rather than measured at all. Rules out inferring the category from `metric` — `highest-jump` and `rough-ground` both carry `mean_finish_time` today and land in different categories. |
| **The category colours the polaroid's shadow** | One glance sorts the wall. The charter's shadow rule names the magenta/cyan pair, which covers two categories; the third takes **yellow bec**, which the charter already spends on stickers and bands. This is a deliberate, single-point extension of the shadow rule and is recorded here so it is a decision rather than a drift. |
| **The front page drops the strip and the footer; player and race pages keep both** | The strip's job is to be the way back to the front. The front page does not need a way back to itself. Rules out deleting `signage()`/`footer()`, which two other views still wear. |
| **The big mark gets `fx-aberration`; the strip's small mark does not** | `shell.css` already reasons that the chromatic offset "belongs on a cover" and reads as a printing fault beside a handle and a picture. The front page's title is the cover. Same component, two variants — not two components. |
| **The flock band does not scroll** | A scrolling marquee was removed from this page on request. The band takes the charter's static yellow strip with ★ separators instead, so the information arrives without the motion that was rejected. |
| **Ladder placeholders live behind `?demo=1`, client-side only** | The scroll frame cannot be judged against three real rows. Padding the list in the browser, from a URL the page reads itself, means no fabricated row reaches the store, the API or another visitor's screen. Rules out seeding the run log with fake users. |

## The taxonomy

`category` joins `status` and `order` at the top of each manifest, validated against a
frozen set the way `status` is validated against `STATUSES`:

```python
CATEGORIES = {"race", "challenge", "showcase"}
```

| category | events | shadow |
| --- | --- | --- |
| `race` | `sprint-2m`, `roller-sprint-2m`, `hill-climb-1m5`, `roller-slide` | `--cyan` |
| `challenge` | `highest-jump`, `hold-your-ground`, `rough-ground` | `--magenta` |
| `showcase` | `swag-contest` | `--yellow` |

`load_manifest` reads it with the existing `_require` helper, so a missing key raises
`ManifestError` naming the file — the same failure a missing `title` produces today.
`event_summary` carries it to the client beside `status` and `vote`. The flyer's eyebrow
becomes the category, uppercased, replacing the hard-coded `"Race"`.

Nothing else reads `category`. It is a presentation fact: it must not reach `evaluate`,
the store, the points fold or the run record, because it says what an event *is* and not
how it is scored.

## The page, top to bottom

**The masthead.** `wordmark()` gains a variant parameter. The strip keeps today's small
flat mark; the front page renders it at `--type-hero-title-size` with `fx-aberration`, the
duck head large to its right. `chip(me)` — already a separate export — floats top right
over the masthead, with no strip behind it.

**The quack.** Only `duck-head-mark.webp` exists, so the hover is CSS: the head tilts
within the charter's 4° ceiling and a yellow `QUACK!` sticker appears beside it, hard
shadow, no blur. It is built so that dropping in an open-beak sprite later swaps the
tilt for a two-frame alternation without touching the markup. The whole effect sits
behind `@media (prefers-reduced-motion: no-preference)`.

**The flock band.** A full-bleed yellow strip on ink text with ★ separators: `JOIN THE
FLOCK` → Discord, `github.com/pollen-robotics/microduck-arena`, the store, and
`pollen-robotics.com/microduck`. The three URLs `signage.js` already holds move to one
module both it and the band import, so the addresses have a single home.

**The texture.** The charter asks that grain and scanlines cover the page, and that one
ray fan — and only one — sit behind a page's main section. All three exist as classes and
none is used here: `fx-grain` and `fx-scanlines` go on the page's ground, `fx-ray-fan`
behind the masthead. The fan is tilted by its own `--ray-fan-from` angle and never by a
`rotate()`, which its own definition warns against. This is the cheapest of the changes
and the one that makes the page read as printed rather than rendered.

**The chapters.** Between them, a 3 px ink rule rotated by the charter's rotation tokens,
alternating in sign from one rule to the next and never past 4°, per the charter's "réunir
le sens des rotations d'un élément au suivant". `overflow-x: hidden` on `body` already
absorbs the overhang a rotated full-width rule creates. The four unused rhythm tokens are
connected at the same time.

**The ladder.** The existing paper frame — 3 px ink border, hard offset shadow — gains a
`max-height` sized to ten rungs and `overflow-y: auto`. The frame's border must not
scroll with its contents, so the scroll container is inside the bordered box, not the box
itself. With `?demo=1` in the URL the rendered list is padded with obviously-fake handles
so the scroll can be exercised; the padding happens where the rows are built for display
and never in `getStandings`.

**The flyers.** Paper-white ground, the still in its frame at the top, then the leader's
handle at card-title size, the event's title small beneath it, the facts in mono. The
category's colour is the offset shadow. Tilts alternate. No rounded corner, no blurred
shadow, no gradient — all three are in the charter's À ÉVITER panel.

**The foot.** Nothing. `footer()` stays exactly as it is for `#/p/` and `#/e/`.

## Error handling

The page already tolerates a leaderboard that fails to load (`catch(() => ({rows: []}))`)
and a still that never arrives (the frame stays dark). Neither changes.

One new failure matters: an event whose `category` the client does not recognise. The
flyer renders with no category eyebrow and the neutral ink shadow rather than throwing,
because one malformed manifest must not take the whole wall down. The server is where an
unknown category is rejected.

## Testing

**Manifest.** A category outside the set is refused, naming the file and the set. A
manifest with no `category` is refused. Every event shipped in `arena/events/` declares
one — a test that walks the directory, so a new event cannot be added without choosing.

**API.** `event_summary` carries `category`.

**Page.** The eyebrow shows the event's own category and not `Race`. A flyer's shadow
follows its category, and an unknown category falls back rather than throwing. Exactly
one element on the page carries `fx-aberration`. The flock band contains no animation.
The ladder frame scrolls its rows while its border stays put. `?demo=1` pads the rendered
list and leaves `getStandings`'s result untouched; without it, no placeholder appears.
Exactly one `fx-ray-fan` exists on the page — the charter allows one and the test is what
keeps a second from arriving later.

## What this does not solve

- **The quack is one sprite.** Until an open-beak asset exists it is a tilt and a sticker,
  not a beak opening. Named here so it reads as a known limit rather than a miss.
- **The player and race pages are untouched.** The user asked to improve the whole site
  starting with the front page; the other two keep today's rhythm and will diverge from it
  until their own pass. The shared `shell.css` keeps the strip and footer consistent
  meanwhile.
- **The third shadow colour extends the charter.** Recorded above. If the charter is later
  read strictly, the resolution is two categories, not a fourth colour.
