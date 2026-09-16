# The front page, in the charter's own voice — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the front page the charter's rhythm, texture and vocabulary — a deep-ink masthead with the mark at cover size, a static flock band, slanted chapter rules, polaroid flyers whose shadow colour names a real category, and a scrollable ladder frame.

**Architecture:** One new declarative field, `category`, joins `status` and `order` in the event manifest and travels to the client through `event_summary`; nothing downstream of presentation reads it. Everything else is placement: `club.css` and `shell.css` connect tokens and effect classes that already exist, and `home.js` stops calling the shared strip and footer while `player.js` and `race.js` keep them.

**Tech Stack:** Python 3.13, FastAPI, pytest. Frontend: vanilla ES modules, Vite 5, vitest + jsdom. The charter's design system (`app/public/design/*.css`) is already loaded on every page.

**Spec:** `docs/superpowers/specs/2026-09-16-home-page-art-direction-design.md`

## Global Constraints

- **Add no colour, face or effect the charter does not already name.** Every value comes from `app/public/design/tokens.css` or a class in `app/public/design/effects.css`.
- **The charter's À ÉVITER panel is binding:** no rounded corner, no blurred shadow, no gradient, no rotation past 4°, no fifth shell tint, no accent outside the palette.
- **Rotations alternate in sign** from one sibling to the next.
- **`--fx-shadow-color` is how an offset shadow is coloured** — it is the documented knob on `.fx-shadow-card`; never write a literal `box-shadow`.
- **No animation in the flock band.** A scrolling marquee was removed from this page on request and must not return.
- **Every motion sits behind `@media (prefers-reduced-motion: no-preference)`.**
- **`category` must not reach** `evaluate`, `store`, `points` or the run record. It is a presentation fact.
- **Run the full suites before each commit:** `uv run python -m pytest -q` and `cd app && npm test`.

---

### Task 1: `category` in the event manifest

**Files:**
- Modify: `arena/manifest.py` (add `CATEGORIES` beside `STATUSES:17`; add the field to `Manifest`; validate in `load_manifest`)
- Modify: all eight of `arena/events/*.toml`
- Test: `tests/test_manifest.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `arena.manifest.CATEGORIES: set[str]` = `{"race", "challenge", "showcase"}`; `Manifest.category: str`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_manifest.py`, add `category="race"` to the `GOOD` fixture's root section so every existing test keeps loading a valid manifest:

```python
GOOD = {
    "root": 'id="probe"\ntitle="Probe"\nrig="legs"\ncategory="race"\n'
            'time_limit_s=10.0\nmetric="mean_finish_time"\nseeds=[1]\n',
    # ... the other sections are unchanged
}
```

Then append these three tests:

```python
# The programme as designed on 2026-09-16. Written out rather than derived, so
# that adding an event fails this test until someone chooses its category on
# purpose — which is the whole reason the field is required.
EXPECTED_CATEGORIES = {
    "sprint-2m": "race",
    "roller-sprint-2m": "race",
    "hill-climb-1m5": "race",
    "roller-slide": "race",
    "highest-jump": "challenge",
    "hold-your-ground": "challenge",
    "rough-ground": "challenge",
    "swag-contest": "showcase",
}


def test_the_programme_is_categorised_as_designed():
    assert {m.id: m.category for m in all_events()} == EXPECTED_CATEGORIES


def test_an_unknown_category_is_refused(tmp_path):
    path = write_manifest(tmp_path, root=GOOD["root"].replace('category="race"', 'category="sprint"'))
    with pytest.raises(ManifestError, match="unknown category"):
        load_manifest(path)


def test_a_missing_category_is_refused(tmp_path):
    """No default: `status` and `order` have a safe one, `category` does not.
    Defaulting to "race" is exactly the bug this field exists to fix."""
    path = write_manifest(tmp_path, root=GOOD["root"].replace('category="race"\n', ""))
    with pytest.raises(ManifestError, match="missing 'category'"):
        load_manifest(path)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run python -m pytest tests/test_manifest.py -q`
Expected: FAIL — `AttributeError: 'Manifest' object has no attribute 'category'` on the first, and `DID NOT RAISE` on the other two.

- [ ] **Step 3: Add the field and its validation**

In `arena/manifest.py`, beside `STATUSES` at line 17:

```python
# What KIND of event this is, which is not derivable from anything else the
# manifest holds: `highest-jump` and `rough-ground` both score on
# `mean_finish_time` today and are a challenge and a challenge only by
# intent. A race is timed over a course, a challenge measures something
# else, a showcase is judged by vote rather than measured at all.
CATEGORIES = {"race", "challenge", "showcase"}
```

In the `Manifest` dataclass, immediately after `status: str` and its comment block:

```python
    # "race", "challenge" or "showcase". Presentation only: the front page
    # labels and colours a flyer by it. Nothing that scores a run may read it.
    category: str
```

In `load_manifest`, immediately after the `status` validation:

```python
    category = _require(raw, "category", str(path))
    if category not in CATEGORIES:
        raise ManifestError(
            f"{path}: unknown category {category!r}, expected one of {CATEGORIES}"
        )
```

And in the `return Manifest(...)` call, after `status=status,`:

```python
        category=category,
```

- [ ] **Step 4: Declare a category in all eight manifests**

Add one line to each file, directly under its `title` line:

| file | line to add |
| --- | --- |
| `arena/events/sprint-2m.toml` | `category     = "race"` |
| `arena/events/roller-sprint-2m.toml` | `category     = "race"` |
| `arena/events/hill-climb-1m5.toml` | `category     = "race"` |
| `arena/events/roller-slide.toml` | `category     = "race"` |
| `arena/events/highest-jump.toml` | `category     = "challenge"` |
| `arena/events/hold-your-ground.toml` | `category     = "challenge"` |
| `arena/events/rough-ground.toml` | `category     = "challenge"` |
| `arena/events/swag-contest.toml` | `category     = "showcase"` |

- [ ] **Step 5: Run the whole Python suite**

Run: `uv run python -m pytest -q`
Expected: PASS, 492 tests. Any other failure means something outside presentation read the manifest positionally — fix it there, do not weaken the field.

- [ ] **Step 6: Commit**

```bash
git add arena/manifest.py arena/events tests/test_manifest.py
git commit -m "Events declare what kind of event they are"
```

---

### Task 2: `category` in the events payload

**Files:**
- Modify: `arena/web/routes_read.py:26-45` (`event_summary`)
- Test: `tests/test_routes_read.py`

**Interfaces:**
- Consumes: `Manifest.category` from Task 1.
- Produces: `GET /api/events` → each event object carries `"category": "race" | "challenge" | "showcase"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_routes_read.py`:

```python
def test_every_event_tells_the_page_what_kind_it_is(client):
    """The flyer used to label all eight "Race". Three are not, and one is not
    even timed — so the page has to be told, not left to guess from `metric`."""
    api, _ = client
    events = {e["id"]: e.get("category") for e in api.get("/api/events").json()["events"]}
    assert events["sprint-2m"] == "race"
    assert events["rough-ground"] == "challenge"
    assert events["swag-contest"] == "showcase"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run python -m pytest tests/test_routes_read.py::test_every_event_tells_the_page_what_kind_it_is -q`
Expected: FAIL — `assert None == 'race'`.

- [ ] **Step 3: Carry the field**

In `arena/web/routes_read.py`, inside `event_summary`, directly after the `"status": manifest.status,` line:

```python
        # What kind of event this is, for the flyer's label and its shadow
        # colour. The board and the race page do not read it.
        "category": manifest.category,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run python -m pytest tests/test_routes_read.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add arena/web/routes_read.py tests/test_routes_read.py
git commit -m "The events payload says what kind of event each one is"
```

---

### Task 3: The polaroid flyer

**Files:**
- Modify: `app/src/home.js` (`flyer`, `standingLine`)
- Modify: `app/public/club.css` (the `.challenge-note` block, lines ~78-131)
- Test: `app/src/home.test.js`

**Interfaces:**
- Consumes: `event.category` from Task 2.
- Produces: a flyer whose root `<article>` carries `challenge-note fx-shadow-card challenge-note--<category>`, and whose caption puts the leader's handle above the event title.

- [ ] **Step 1: Write the failing tests**

In `app/src/home.test.js`, extend the fixtures at the top so they carry a category:

```js
const open = {
  id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", rig: "legs",
  length_m: 2, slope_deg: 0,
  sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
};
const planned = { ...open, id: "best-jump", title: "Best Jump", status: "planned", category: "challenge" };
```

Then append:

```js
describe("the flyer's category", () => {
  it("labels the event with its own category, not 'Race'", () => {
    expect(flyer({ ...open, category: "showcase" }, []).querySelector(".eyebrow").textContent)
      .toBe("SHOWCASE");
  });

  it("colours the offset shadow by category", () => {
    const shadowOf = (category) => flyer({ ...open, category }, []).className;
    expect(shadowOf("race")).toContain("challenge-note--race");
    expect(shadowOf("challenge")).toContain("challenge-note--challenge");
    expect(shadowOf("showcase")).toContain("challenge-note--showcase");
  });

  it("uses the charter's shadow primitive rather than its own box-shadow", () => {
    expect(flyer(open, []).className).toContain("fx-shadow-card");
  });

  it("renders an unrecognised category without a label and without throwing", () => {
    // One malformed manifest must not take the whole wall down. The server is
    // where an unknown category is rejected; the page degrades.
    const note = flyer({ ...open, category: "parade" }, []);
    expect(note.className).not.toMatch(/challenge-note--/);
    expect(note.querySelector(".eyebrow")).toBeNull();
  });
});

describe("the polaroid caption", () => {
  it("puts the leader's handle above the event's title", () => {
    const note = flyer(open, [
      { user: "cdeplanne", policy_name: "Walk rough", score: 9.456, seeds_finished: 5 },
    ]);
    const order = [...note.querySelectorAll(".flyer-leader, .flyer-title")]
      .map((n) => n.className);
    expect(order).toEqual(["flyer-leader", "flyer-title"]);
    expect(note.querySelector(".flyer-leader").textContent).toContain("cdeplanne");
    expect(note.querySelector(".flyer-title").textContent).toBe("2 m Sprint");
  });

  it("shows the still above the caption, polaroid-fashion", () => {
    const note = flyer(open, []);
    const parts = [...note.querySelector(".challenge-link").children].map((n) => n.className);
    expect(parts.indexOf("challenge-art")).toBeLessThan(parts.indexOf("flyer-leader"));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL — the eyebrow reads `Race`, there is no `flyer-leader`, and the class list has no `fx-shadow-card`.

- [ ] **Step 3: Rewrite `flyer` and `standingLine`**

In `app/src/home.js`, replace the `standingLine` and `flyer` functions with:

```js
const CATEGORIES = new Set(["race", "challenge", "showcase"]);

/** Who holds this event, at the size a person scans the wall by. */
function leaderLine(event, planned, rows) {
  const line = el("p", "flyer-leader");
  if (planned) {
    line.append(el("span", "flyer-leader-name", "course not built yet"));
    return line;
  }
  const star = el("img", "challenge-star");
  star.src = "/star-yellow.webp";
  star.alt = "";
  const leader = rows.find((row) => row.seeds_finished > 0);
  if (!leader) {
    line.append(star, el("span", "flyer-leader-name", rows.length ? "no finisher yet" : "be the first"));
    return line;
  }
  // A voted event is held by whoever collected the most votes THIS WEEK, so
  // the line says votes. A time would be the wrong fact about it.
  const held = event.vote
    ? (leader.votes ? `${leader.votes} votes` : "no votes yet")
    : formatScore(leader.score, { finished: leader.seeds_finished });
  line.append(star, el("span", "flyer-leader-name", leader.user), el("span", "flyer-leader-score", held));
  return line;
}

/** One event on the wall: its still, who holds it, and what it is. */
export function flyer(event, rows) {
  const planned = event.status === "planned";
  const known = CATEGORIES.has(event.category);
  const classes = ["challenge-note", "fx-shadow-card"];
  // An unrecognised category keeps the neutral ink shadow the base rule sets,
  // rather than borrowing another category's colour.
  if (known) classes.push(`challenge-note--${event.category}`);
  if (planned) classes.push("challenge-note--planned");
  const note = el("article", classes.join(" "));
  note.append(el("span", "flyer-tape"));
  if (event.vote && !planned) {
    note.append(voteButton(event, { variant: "sticker" }));
  }
  const link = el(planned ? "div" : "a", "challenge-link");
  if (!planned) link.href = raceHref(event.id);
  const facts = formatEventFacts(event)
    .filter((fact) => fact.label !== "speed sweep")
    .map((fact) => fact.value)
    .join(" · ");
  link.append(el("div", "challenge-art"));
  if (known) link.append(el("span", "eyebrow", event.category.toUpperCase()));
  link.append(
    leaderLine(event, planned, rows),
    el("h4", "flyer-title", event.title),
    el("p", "challenge-facts", facts),
  );
  note.append(link);
  return note;
}
```

- [ ] **Step 4: Restyle the note as a polaroid**

In `app/public/club.css`, replace the `.challenge-note` rule and the three `:nth-child` grounds beneath it with:

```css
/* A polaroid: white ground, the still at the top, the caption on the border
   under it. The shadow is the charter's own primitive, coloured by category —
   one glance sorts the wall. No rounded corner and no blur: both are in the
   charter's À ÉVITER panel. */
.challenge-note {
  --fx-shadow-color: var(--ink);
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--space-card-padding-min);
  border: 2px solid var(--ink);
  background: var(--paper);
  rotate: calc(-1 * var(--rotate-1-0));
}
.challenge-note:nth-child(2n) { rotate: var(--rotate-1-0); }

.challenge-note--race { --fx-shadow-color: var(--cyan); }
.challenge-note--challenge { --fx-shadow-color: var(--magenta); }
/* The charter's shadow rule names the magenta/cyan pair, which covers two
   categories. The third takes yellow bec, which the charter already spends on
   stickers and bands. Recorded in the design doc as a deliberate extension. */
.challenge-note--showcase { --fx-shadow-color: var(--yellow); }

.challenge-note--planned { background: var(--warm-paper); color: var(--ink-70); }
```

Then replace the `.challenge-standing` / `.challenge-star` block with the caption's rules:

```css
/* The caption. The handle is what a person scans the wall by, so it takes the
   card-title step and the event's own title sits under it at body size. */
.flyer-leader {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin: var(--space-gutter-min) 0 0;
}
.flyer-leader-name {
  font-family: var(--type-card-title-family);
  font-weight: var(--type-card-title-weight);
  font-size: var(--type-card-title-size);
  line-height: var(--type-card-title-line);
  letter-spacing: var(--type-card-title-tracking);
  overflow-wrap: anywhere;
}
.flyer-leader-score {
  font-family: var(--type-mono-label-family);
  font-weight: var(--type-mono-label-weight);
  font-size: var(--type-mono-label-size);
  letter-spacing: var(--type-mono-label-tracking);
}
.flyer-title { margin: 4px 0 0; font-size: 1rem; font-weight: 600; text-transform: none; }
.challenge-star { width: 18px; height: 18px; align-self: center; }
.challenge-link .eyebrow { display: block; margin-top: var(--space-gutter-min); color: var(--orange-inked); }
.challenge-art { margin-top: 0; }
```

- [ ] **Step 5: Run the frontend suite**

Run: `cd app && npm test`
Expected: PASS, 305 + 6 tests. If `flyer-title` styling elsewhere breaks, grep for `.flyer-title` — `components.css` may own a rule that now fights this one; the placement sheet wins and the component rule should be left alone.

- [ ] **Step 6: Commit**

```bash
git add app/src/home.js app/src/home.test.js app/public/club.css
git commit -m "The flyers are polaroids, and each says what kind of event it is"
```

---

### Task 4: The masthead, and the strip it replaces

**Files:**
- Modify: `app/src/wordmark.js` (`wordmark` gains a variant)
- Modify: `app/src/signage.js` (pass the variant; export nothing new)
- Modify: `app/src/home.js` (`renderHome` stops calling `signage()` and `footer()`)
- Modify: `app/public/shell.css` (the `.wordmark` block) and `app/public/club.css` (the masthead's placement)
- Test: `app/src/signage.test.js`, `app/src/home.test.js`

**Interfaces:**
- Consumes: `chip(me)` from `signage.js`, already exported.
- Produces: `wordmark({ variant })` where `variant` is `"strip"` (default, today's behaviour) or `"cover"`; `masthead(me)` exported from `home.js`.

- [ ] **Step 1: Write the failing tests**

In `app/src/signage.test.js`:

```js
describe("the mark's two variants", () => {
  it("leaves the strip's mark flat", () => {
    // Two ghosts beside a handle and a picture read as a printing fault.
    expect(wordmark().className).toBe("wordmark");
  });

  it("gives the cover's mark the charter's aberration", () => {
    const mark = wordmark({ variant: "cover" });
    expect(mark.className).toContain("wordmark--cover");
    expect(mark.className).toContain("fx-aberration");
  });
});
```

In `app/src/home.test.js`:

```js
describe("the masthead", () => {
  it("carries the mark at cover size, the duck and the player chip", () => {
    const head = masthead({ signed_in: true, user: "cdeplanne" });
    expect(head.querySelector(".wordmark--cover")).not.toBeNull();
    expect(head.querySelector("img.duckhead")).not.toBeNull();
    expect(head.querySelector("a.profile-chip").getAttribute("href")).toBe("#/p/cdeplanne");
  });

  it("offers the way in when signed out", () => {
    expect(masthead({ signed_in: false }).querySelector("a.sticker").textContent)
      .toBe("Sign in with Hugging Face");
  });

  it("is the only element on the page wearing the aberration", () => {
    // The charter draws it on a cover. A second one is a printing fault.
    const head = masthead({ signed_in: false });
    expect(head.querySelectorAll(".fx-aberration")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npx vitest run src/signage.test.js src/home.test.js`
Expected: FAIL — `wordmark` takes no argument and `masthead` is not exported.

- [ ] **Step 3: Give the mark its variant**

Replace `wordmark` in `app/src/wordmark.js`:

```js
/**
 * The site's mark. Two variants, one component.
 *
 * `strip` is the small flat mark in the strip over the door, where the
 * chromatic offset would read as a printing fault beside a handle and a
 * picture. `cover` is the front page's, at the charter's hero step and with
 * the aberration the charter draws on its own cover — over deep ink, which is
 * the only ground the charter ever puts a yellow word on.
 */
export function wordmark({ variant = "strip" } = {}) {
  const el = document.createElement("h1");
  el.className = variant === "cover" ? "wordmark wordmark--cover fx-aberration" : "wordmark";
  const solid = document.createElement("span");
  solid.className = "wordmark__solid";
  solid.textContent = "Microduck";
  const arena = document.createElement("span");
  arena.className = "wordmark__arena";
  arena.textContent = "Arena";
  el.append(solid, arena);
  return el;
}
```

`signage()` already calls `wordmark()` with no argument, so the strip is unchanged.

- [ ] **Step 4: Build the masthead and drop the strip from the front page**

In `app/src/home.js`, import `chip` and `duckHead`/`wordmark` instead of `signage`:

```js
import { chip, footer } from "./signage.js";
import { duckHead, wordmark } from "./wordmark.js";
```

(`footer` is imported only so the diff is explicit about dropping it — remove the import once `renderHome` no longer calls it.)

Add:

```js
/**
 * The front's cover: the mark at hero size on deep ink, the duck beside it,
 * and who you are floating top right. No strip — the strip's job is to be the
 * way back to the front, and this IS the front.
 */
export function masthead(me) {
  const head = document.createElement("header");
  head.className = "masthead fx-ray-fan";
  const lockup = el("div", "masthead-lockup");
  lockup.append(wordmark({ variant: "cover" }), duckHead());
  const nav = document.createElement("nav");
  nav.className = "masthead-player";
  nav.setAttribute("aria-label", "Player");
  nav.append(chip(me));
  head.append(nav, lockup);
  return head;
}
```

In `renderHome`, replace the first two lines of the body:

```js
  root.replaceChildren(masthead(me));
  const hall = el("main", "hall");
  root.append(hall);
```

— dropping both `signage(me)` and `footer()`, and removing `footer` from the import.

- [ ] **Step 5: Place the masthead**

In `app/public/club.css`, add above the `.door` rule:

```css
/* ── Masthead: the charter's cover, whole ──────────────────────────────────── */

/* Deep ink, because that is the only ground the charter puts a yellow word on:
   #FFD23F on #FAF8F2 cannot be read at any size. The fan is this page's one —
   tilted by its own --ray-fan-from and never by a rotate(). */
.masthead {
  position: relative;
  background-color: var(--deep-ink);
  padding: var(--space-gutter-max) var(--space-gutter-min) var(--space-chapter-top-min);
}
.masthead-lockup {
  display: flex;
  align-items: center;
  gap: clamp(1rem, 4vw, 3rem);
  max-width: var(--space-content-column);
  margin-inline: auto;
}
.masthead-player {
  display: flex;
  justify-content: flex-end;
  max-width: var(--space-content-column);
  margin-inline: auto;
}
.masthead .duckhead { width: clamp(72px, 14vw, 148px); }

.wordmark--cover {
  font-size: var(--type-hero-title-size);
  line-height: var(--type-hero-title-line);
  letter-spacing: var(--type-hero-title-tracking);
}
```

In `app/public/shell.css`, the existing `.wordmark` shorthand `font:` would overwrite the cover's size, so split it. Replace the `.wordmark` rule with:

```css
.wordmark {
  margin: 0;
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(1.05rem, 2.6vw, 1.4rem);
  line-height: 0.9;
  text-transform: uppercase;
  letter-spacing: 0.005em;
}
```

- [ ] **Step 6: Run both suites**

Run: `cd app && npm test`
Expected: PASS. `signage.test.js` must still pass untouched — the strip's mark did not change.

- [ ] **Step 7: Commit**

```bash
git add app/src/wordmark.js app/src/home.js app/src/signage.test.js app/src/home.test.js app/public/club.css app/public/shell.css
git commit -m "The front page wears the charter's cover, not the strip"
```

---

### Task 5: The quack

**Files:**
- Modify: `app/src/wordmark.js` (`duckHead` gains the sticker it speaks with)
- Modify: `app/public/club.css`
- Test: `app/src/signage.test.js`

**Interfaces:**
- Consumes: `duckHead()` from Task 4.
- Produces: `duckHead({ quacks })` — `quacks: true` wraps the image in `<span class="duck">` with a `QUACK!` sticker sibling. Default `false` keeps today's bare `<img>`, which `signage()` relies on.

- [ ] **Step 1: Write the failing test**

In `app/src/signage.test.js`:

```js
describe("the duck", () => {
  it("is a bare image in the strip", () => {
    expect(duckHead().tagName).toBe("IMG");
  });

  it("carries a quack on the cover", () => {
    const duck = duckHead({ quacks: true });
    expect(duck.className).toBe("duck");
    expect(duck.querySelector("img.duckhead")).not.toBeNull();
    expect(duck.querySelector(".duck-quack").textContent).toBe("QUACK!");
    // Decorative twice over: the sticker repeats nothing a reader needs.
    expect(duck.querySelector(".duck-quack").getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/signage.test.js`
Expected: FAIL — `duckHead({quacks:true}).className` is `"duckhead"`.

- [ ] **Step 3: Give the duck a voice**

In `app/src/wordmark.js`, replace `duckHead`:

```js
/**
 * The duck head from the Pollen page.
 *
 * `quacks` wraps it with a sticker that appears on hover. There is only one
 * sprite — a beak that never opens — so the hover is a tilt and a shout rather
 * than two frames. Dropping an open-beak sprite in later swaps the tilt for a
 * real alternation without touching this markup.
 */
export function duckHead({ quacks = false } = {}) {
  const img = document.createElement("img");
  img.className = "duckhead";
  img.src = "/duck-head-mark.webp";
  // Decorative: the wordmark beside it already names the page, and announcing
  // "duck head" after "Microduck Arena" is noise in a screen reader.
  img.alt = "";
  if (!quacks) return img;

  const box = document.createElement("span");
  box.className = "duck";
  const shout = document.createElement("span");
  shout.className = "duck-quack sticker";
  shout.textContent = "QUACK!";
  shout.setAttribute("aria-hidden", "true");
  box.append(img, shout);
  return box;
}
```

In `app/src/home.js`, the masthead asks for the talking one:

```js
  lockup.append(wordmark({ variant: "cover" }), duckHead({ quacks: true }));
```

- [ ] **Step 4: Style the hover**

In `app/public/club.css`, under the masthead block:

```css
.duck { position: relative; display: inline-flex; flex: none; }
.duck-quack {
  position: absolute;
  top: -10px;
  left: 100%;
  margin-left: -8px;
  opacity: 0;
  rotate: var(--rotate-3-0);
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  .duck .duckhead { transition: rotate 140ms ease, translate 140ms ease; }
  .duck-quack { transition: opacity 120ms ease; }
  .duck:hover .duckhead { rotate: calc(-1 * var(--rotate-4-0)); translate: 0 -4px; }
  .duck:hover .duck-quack { opacity: 1; }
}
```

- [ ] **Step 5: Run the suite and look at it**

Run: `cd app && npm test`
Expected: PASS. Then with both servers up, hover the duck at <http://localhost:5173> — the head should tip back and `QUACK!` appear to its right, with no blur and no rounded corner on the sticker.

- [ ] **Step 6: Commit**

```bash
git add app/src/wordmark.js app/src/home.js app/src/signage.test.js app/public/club.css
git commit -m "The duck quacks when you point at it"
```

---

### Task 6: The flock band

**Files:**
- Create: `app/src/links.js`
- Modify: `app/src/signage.js` (import the URLs instead of holding them)
- Modify: `app/src/home.js` (`renderHome` appends the band under the masthead)
- Modify: `app/public/club.css`
- Test: `app/src/home.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `app/src/links.js` exporting `FLOCK`, `STORE`, `POLLEN`, `MICRODUCK`, `SOURCE`; `flockBand()` exported from `home.js`.

- [ ] **Step 1: Write the failing test**

In `app/src/home.test.js`:

```js
describe("the flock band", () => {
  it("carries the four ways out, each opening safely", () => {
    const band = flockBand();
    const hrefs = [...band.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(4);
    expect(hrefs.some((h) => h.includes("discord.com"))).toBe(true);
    expect(hrefs.some((h) => h.includes("github.com/pollen-robotics/microduck-arena"))).toBe(true);
    expect(hrefs.some((h) => h.includes("store.pollen-robotics.com"))).toBe(true);
    expect(hrefs.some((h) => h.includes("pollen-robotics.com/microduck"))).toBe(true);
    for (const a of band.querySelectorAll("a")) {
      expect(a.getAttribute("rel")).toBe("noopener");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("does not move", () => {
    // A scrolling marquee was taken off this page on purpose. The band says the
    // same things standing still.
    const band = flockBand();
    expect(band.className).not.toMatch(/marquee|scroll|ticker/);
    expect(band.querySelector("[class*=marquee]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL — `flockBand is not a function`.

- [ ] **Step 3: Give the addresses one home**

Create `app/src/links.js`:

```js
// Every address that leaves the arena, in one place. The strip under a race
// page and the band under the front page both point at these, and an address
// that lives in two files is an address that goes stale in one of them.

export const FLOCK = "https://discord.com/invite/pollen-community-519098054377340948";
export const STORE = "https://store.pollen-robotics.com/products/microduck";
export const POLLEN = "https://pollen-robotics.com/";
export const MICRODUCK = "https://pollen-robotics.com/microduck/";
export const SOURCE = "https://github.com/pollen-robotics/microduck-arena";
```

In `app/src/signage.js`, delete the three `const` declarations and import them:

```js
import { FLOCK, POLLEN, STORE } from "./links.js";
```

- [ ] **Step 4: Build the band**

In `app/src/home.js`, import what it needs:

```js
import { FLOCK, MICRODUCK, SOURCE, STORE } from "./links.js";
```

and add:

```js
const FLOCK_LINKS = [
  ["Join the flock", FLOCK],
  ["Source", SOURCE],
  ["Get your microduck", STORE],
  ["pollen-robotics.com/microduck", MICRODUCK],
];

/**
 * The yellow band under the cover, as the charter draws it: ink on yellow,
 * separated by stars. It stands still — the scrolling version of this was
 * taken off the page on purpose.
 */
export function flockBand() {
  const band = document.createElement("div");
  band.className = "flock-band";
  const row = el("div", "flock-band-row");
  FLOCK_LINKS.forEach(([text, href], i) => {
    if (i) row.append(el("span", "flock-star", "★"));
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = text;
    row.append(link);
  });
  band.append(row);
  return band;
}
```

and in `renderHome`, directly after the masthead:

```js
  root.replaceChildren(masthead(me), flockBand());
```

- [ ] **Step 5: Style the band**

In `app/public/club.css`:

```css
/* ── The flock band: the charter's yellow strip, standing still ────────────── */

.flock-band {
  background: var(--yellow);
  color: var(--ink);
  border-block: 3px solid var(--ink);
  padding: 10px var(--space-gutter-min);
}
.flock-band-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px 14px;
  max-width: var(--space-content-column);
  margin-inline: auto;
  font-family: var(--type-sticker-family);
  font-size: var(--type-sticker-size);
  letter-spacing: var(--type-sticker-tracking);
  text-transform: uppercase;
}
.flock-band-row a { color: inherit; text-decoration: none; }
.flock-band-row a:hover { text-decoration: underline; }
.flock-band-row a:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
.flock-star { color: var(--orange-inked); }
```

- [ ] **Step 6: Run the suite**

Run: `cd app && npm test`
Expected: PASS. `signage.test.js` must still pass — the footer's links are the same URLs, now imported.

- [ ] **Step 7: Commit**

```bash
git add app/src/links.js app/src/signage.js app/src/home.js app/src/home.test.js app/public/club.css
git commit -m "A band under the cover, and one home for every address"
```

---

### Task 7: The chapters — rhythm, slanted rules, texture

**Files:**
- Modify: `app/src/home.js` (`renderHome` builds chapters with a rule between them)
- Modify: `app/public/club.css`
- Test: `app/src/home.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `chapterRule(index)` exported from `home.js`, returning `<div class="chapter-rule chapter-rule--left|right">`.

- [ ] **Step 1: Write the failing test**

```js
describe("the chapter rules", () => {
  it("alternates the sense of the tilt from one rule to the next", () => {
    // The charter: "réunir le sens des rotations d'un élément au suivant".
    expect(chapterRule(0).className).toContain("chapter-rule--left");
    expect(chapterRule(1).className).toContain("chapter-rule--right");
    expect(chapterRule(2).className).toContain("chapter-rule--left");
  });

  it("is decorative, so a screen reader does not announce a line", () => {
    expect(chapterRule(0).getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL — `chapterRule is not a function`.

- [ ] **Step 3: Add the rule and use it**

In `app/src/home.js`:

```js
/** A slanted rule between chapters, tilting the other way each time. */
export function chapterRule(index) {
  const rule = el("div", `chapter-rule chapter-rule--${index % 2 ? "right" : "left"}`);
  rule.setAttribute("aria-hidden", "true");
  return rule;
}
```

In `renderHome`, put one before each chapter — before the `season` section and before the `rounds` section:

```js
  hall.append(chapterRule(0), season);
  // ... and later
  hall.append(chapterRule(1), rounds);
```

- [ ] **Step 4: Connect the rhythm, the rules and the texture**

In `app/public/club.css`, replace the `.chapter` rules with:

```css
/* The charter's own rhythm. These four tokens were defined and referenced
   nowhere: a chapter opened on a 28 px grid gutter, which is why the hero, the
   ladder and the wall read as one column. */
.chapter { margin-top: var(--space-chapter-top-min); }
.chapter:last-child { margin-bottom: var(--space-chapter-bottom-min); }
.chapter > .eyebrow { margin-bottom: var(--space-title-to-grid-min); display: block; }

/* A hand-torn divider: 3 px of ink, tilted within the charter's ceiling and
   alternating in sense. It overhangs the column on purpose; `overflow-x:
   hidden` on body already absorbs it. */
.chapter-rule {
  height: 3px;
  margin-top: var(--space-chapter-top-min);
  background: var(--ink);
}
.chapter-rule--left { rotate: calc(-1 * var(--rotate-1-0)); }
.chapter-rule--right { rotate: var(--rotate-1-0); }
/* The rule already carries the space above its chapter. */
.chapter-rule + .chapter { margin-top: var(--space-title-to-grid-max); }
```

And give the page its texture. In `app/public/club.css`, at the top:

```css
/* Grain and scanlines cover the page, as the charter asks of every render and
   photograph on it. Both are ::before/::after with `pointer-events: none`, and
   both set their own `position: relative` — `.hall` already has it, so the
   only thing to declare here is the lighter of the two grain opacities. */
.hall { --fx-grain-opacity: var(--grain-opacity-min); }
```

The overlays are `inset: 0` on `.hall`, which `shell.css` gives `flex: 1` — so
they cover the column and stop at the band, not at the window. That is what is
wanted: the masthead and the band carry their own grounds.

In `app/src/home.js`, the hall declares them:

```js
  const hall = el("main", "hall fx-grain fx-scanlines");
```

- [ ] **Step 5: Run the suite, then look**

Run: `cd app && npm test`
Expected: PASS.

Then at <http://localhost:5173>: the three chapters should be clearly separated, each rule tilted the opposite way from the last, and the page should carry a faint grain. Check that the rules do not add a horizontal scrollbar — if they do, `overflow-x: hidden` is not reaching them and the rule needs a clipping wrapper rather than a wider ceiling.

- [ ] **Step 6: Commit**

```bash
git add app/src/home.js app/src/home.test.js app/public/club.css
git commit -m "Chapters that breathe, divided by a slanted rule"
```

---

### Task 8: The ladder in a scrollable frame

**Files:**
- Modify: `app/src/home.js` (`ladder` takes the rows it is given; `demoRows` pads them)
- Modify: `app/public/club.css`
- Test: `app/src/home.test.js`

**Interfaces:**
- Consumes: `getStandings()` from `api.js`, unchanged.
- Produces: `demoRows(rows, search)` exported from `home.js` — pure, returns `rows` untouched unless `search` carries `demo`.

- [ ] **Step 1: Write the failing tests**

```js
describe("the demo padding", () => {
  it("leaves the real standings alone without ?demo", () => {
    const real = [{ rank: 1, user: "ann", points: 360 }];
    expect(demoRows(real, "")).toBe(real);
    expect(demoRows(real, "?foo=1")).toBe(real);
  });

  it("pads past the frame's ten rungs so the scroll can be exercised", () => {
    const padded = demoRows([{ rank: 1, user: "ann", points: 360 }], "?demo=1");
    expect(padded.length).toBeGreaterThan(10);
    expect(padded[0]).toEqual({ rank: 1, user: "ann", points: 360 });
  });

  it("makes its placeholders obviously fake and correctly ranked", () => {
    const padded = demoRows([], "?demo=1");
    expect(padded.every((r) => r.user.startsWith("demo-"))).toBe(true);
    expect(padded.map((r) => r.rank)).toEqual(padded.map((_, i) => i + 1));
    // Points must fall with rank, or the frame shows a board that ranks wrong.
    for (let i = 1; i < padded.length; i += 1) {
      expect(padded[i].points).toBeLessThan(padded[i - 1].points);
    }
  });
});

describe("the ladder frame", () => {
  it("scrolls its rungs inside a border that stays put", () => {
    const el = ladder([{ rank: 1, user: "ann", points: 360 }]);
    // The bordered box is the frame; the scroller is inside it, or the border
    // scrolls away with the rows.
    expect(el.className).toBe("ladders");
    expect(el.querySelector(".ladder-scroll .ladder-row")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL — `demoRows is not a function`, and there is no `.ladder-scroll`.

- [ ] **Step 3: Add the scroller and the padding**

In `app/src/home.js`, replace `ladder` and add `demoRows`:

```js
const DEMO_ROWS = 18;

/**
 * Padding for `?demo=1`, so the ladder's scroll can be judged against more
 * than three real people.
 *
 * Client-side and pure: no fabricated row reaches the store, the API or
 * another visitor's screen. The handles say `demo-` out loud, because a
 * placeholder that looks like a person is how a screenshot becomes a lie.
 */
export function demoRows(rows, search = location.search) {
  if (!new URLSearchParams(search).has("demo")) return rows;
  const padded = [...rows];
  while (padded.length < DEMO_ROWS) {
    const rank = padded.length + 1;
    padded.push({ rank, user: `demo-duck-${rank}`, points: 1000 - rank * 37 });
  }
  return padded.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function ladder(rows) {
  const box = el("div", "ladders");
  const list = el("div", "ladder ladder-scroll");
  if (!rows.length) list.append(el("p", "ladder-empty", "Nobody has published yet."));
  for (const row of rows) {
    const rung = el("a", "ladder-row");
    rung.href = playerHref(row.user);
    rung.append(
      el("span", "ladder-rank", String(row.rank)),
      el("span", `ladder-shell ladder-shell-${shellOf(row.user)}`),
      el("span", "ladder-name", `@${row.user}`),
      el("span", "ladder-points", `${row.points} PTS`),
    );
    list.append(rung);
  }
  box.append(list);
  return box;
}
```

In `renderHome`, the season chapter reads the padded rows and no longer truncates to ten — the frame does that now:

```js
  season.append(el("h3", "eyebrow", "Season standings"), ladder(demoRows(standings)));
```

Delete the now-unused `LADDER_ROWS` constant.

- [ ] **Step 4: Give the frame its scroll**

In `app/public/club.css`, replace the `.ladders` rule:

```css
/* The frame holds still; the rungs scroll inside it. Ten rungs is what the
   frame shows — the eleventh is the invitation to scroll, so the frame must
   cut a row rather than land between two. */
.ladders {
  --ladder-rung: 58px;
  max-width: 640px;
  background: var(--warm-paper);
  border: 3px solid var(--ink);
  box-shadow: var(--shadow-card-min) var(--shadow-card-min) var(--shadow-blur) var(--ink);
  color: var(--ink);
}
.ladder-scroll {
  max-height: calc(var(--ladder-rung) * 10.5);
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

- [ ] **Step 5: Run the suite, then exercise the scroll**

Run: `cd app && npm test`
Expected: PASS.

Then open <http://localhost:5173/?demo=1>: the frame should show about ten and a half rungs and scroll to eighteen, its border and shadow staying put. Open <http://localhost:5173/> and confirm **no** `demo-duck` handle appears.

- [ ] **Step 6: Commit**

```bash
git add app/src/home.js app/src/home.test.js app/public/club.css
git commit -m "The ladder scrolls inside a frame that stays put"
```

---

### Task 9: The whole page, end to end

**Files:**
- Create: `app/src/home.page.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`vi.spyOn` on a module namespace throws under strict ESM — the properties are
not configurable. Mock the module instead, at the top of the file:

```js
import { vi } from "vitest";
import { renderHome } from "./home.js";

vi.mock("./api.js", () => ({
  getEvents: async () => [{
    id: "sprint-2m", title: "2 m Sprint", status: "open", category: "race", rig: "legs",
    length_m: 2, slope_deg: 0,
    sweep_lo: 0.2, sweep_hi: 1.2, sweep_step: 0.05, sweep_count: 21,
  }],
  getStandings: async () => [{ rank: 1, user: "ann", points: 360 }],
  getMe: async () => ({ signed_in: false }),
  getLeaderboard: async () => ({ rows: [] }),
}));

describe("the whole front page", () => {
  it("is a cover, a band, two chapters and no footer", async () => {
    const root = document.createElement("div");
    await renderHome(root);

    expect(root.querySelector(".masthead .wordmark--cover")).not.toBeNull();
    expect(root.querySelector(".flock-band")).not.toBeNull();
    expect(root.querySelectorAll(".chapter-rule")).toHaveLength(2);
    expect(root.querySelector(".ladder-scroll")).not.toBeNull();
    expect(root.querySelector(".challenge-note--race")).not.toBeNull();
    // The strip and the footer belong to the pages you can come back FROM.
    expect(root.querySelector("header.signage")).toBeNull();
    expect(root.querySelector("footer")).toBeNull();
    // The charter allows one fan and one aberration per page.
    expect(root.querySelectorAll(".fx-ray-fan")).toHaveLength(1);
    expect(root.querySelectorAll(".fx-aberration")).toHaveLength(1);
  });
});
```

`vi.mock` is hoisted and applies to the whole file, so this test belongs in its
own file — `app/src/home.page.test.js` — rather than beside the unit tests that
import `flyer` and `ladder` directly.

Note: `renderHome` calls `renderThumbnails`, which needs WebGL. Under jsdom it returns an empty map and the frames stay dark — that is the documented fallback, so no mock is needed. If it throws instead, mock `./thumbnail.js` with `vi.mock("./thumbnail.js", () => ({ renderThumbnails: async () => new Map() }))` and say so in the test's comment.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/home.test.js`
Expected: FAIL if any task above is incomplete; PASS only once all eight have landed.

- [ ] **Step 3: Run everything**

```bash
uv run python -m pytest -q
cd app && npm test && npm run build
```

Expected: 492 Python tests, 320-odd JS tests, a clean Vite build.

- [ ] **Step 4: Look at the page**

With both servers up, check at <http://localhost:5173>: the deep-ink cover with the yellow/orange mark and its ghosts; the duck quacking on hover; the yellow band, standing still; two slanted rules tilting opposite ways; the ladder scrolling in its frame; polaroids on white with cyan, magenta and yellow shadows; no strip, no footer. Then <http://localhost:5173/#/p/cdeplanne> and a race page — both must still have their strip and footer.

- [ ] **Step 5: Commit**

```bash
git add app/src/home.page.test.js
git commit -m "Pin the whole front page: a cover, a band, two chapters, no footer"
```

---

## Self-review

**Spec coverage.** Taxonomy → Task 1 and 2. Masthead and deep-ink ground → Task 4. Quack → Task 5. Flock band → Task 6. Chapters, slanted rules, rhythm and texture → Task 7. Ladder frame and `?demo=1` → Task 8. Polaroids and the category shadow → Task 3. Footer removed from the front only → Task 4, pinned in Task 9. Unknown-category fallback → Task 3. One ray fan and one aberration → Tasks 4, 7, 9.

**Known gaps, deliberate.** The spec's "the scroll container is inside the bordered box" is realised by `.ladder-scroll` inside `.ladders` (Task 8). The spec's claim that the flyer degrades on an unknown category is tested in Task 3 but the server still rejects one (Task 1), so the fallback is defence in depth, not a supported state.

**Type consistency.** `wordmark({ variant })` and `duckHead({ quacks })` are both options objects with defaults that preserve today's call sites in `signage.js`. `chapterRule(index)`, `demoRows(rows, search)`, `flockBand()`, `masthead(me)` and `flyer(event, rows)` are the names used in every task that refers to them. `--fx-shadow-color` is the only knob used to colour a shadow.
