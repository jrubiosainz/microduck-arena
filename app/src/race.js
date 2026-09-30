// One race: the stage, the file column beside it, the standing beneath.

import {
  getEvents,
  getLeaderboard,
  getMe,
  getTrace,
  submitPolicy,
  tryPolicy,
  withdrawRun,
} from "./api.js";
import { boardsheetMarkup, podium, wireBoardsheet } from "./boardsheet.js";
import { flyer } from "./flyer.js";
import { createDropzone } from "./dropzone.js";
import { deckMarkup, followKeyFor, wireDeck } from "./deck.js";
import { VARIANT_SWATCH_HEX } from "./liveries.js";
import { colourLanes } from "./lanes.js";
import { MIN } from "./brightness.js";
import { formatEventFacts, speedChoices } from "./format.js";
import { dress, eventGuideHref, menuHref, runHref } from "./router.js";
import { renderThumbnails } from "./thumbnail.js";
import { panelState, signInHref } from "./session.js";
import { footer, settleIdentity, signage } from "./signage.js";
import { insertProvisional } from "./standings.js";
import { createViewer } from "./viewer.js";
import { voteButton } from "./votebutton.js";

// Colours belong to leaderboard entries; lane positions are shuffled afterwards.
export function arrangeLanes(board, lanes, random = Math.random) {
  colourLanes(board, lanes);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes;
}

/**
 * The entry column: a sign-in prompt, or the racing/publishing controls.
 *
 * Kept as its own function, and NOT wired into the stage or the board, so it
 * can be rendered and exercised in a test without a WebGL viewer or a leaderboard
 * fetch. All of its element references are captured here, after `innerHTML` is
 * set — never before, and never by the caller — so a re-render can never leave a
 * handler pointing at a detached node.
 *
 * `onTry` / `onPublish` do the actual work (the API call, updating the trial,
 * repainting the board); this function only owns the form and the button state.
 */
export function renderEntryPanel(container, me, { event, onTry, onPublish, onLiveryChange } = {}) {
  const state = panelState(me);
  const help = event?.id ? `<a class="help-link" href="${eventGuideHref(event.id)}">Training & rules ?</a>` : "";

  if (state === "signed-out") {
    // NO target="_blank", though Hugging Face's own docs suggest one for the
    // iframe/cookie reason. That advice assumes a PUBLIC Space. This one is
    // private, so the Hub gateway 404s any request to <space>.hf.space that
    // does not carry its auth — and a fresh top-level tab carries none of it,
    // because huggingface.co and hf.space are separate domains that share no
    // cookies. Opening the link in a new tab produced a Hugging Face 404 and
    // nothing else. Navigating the iframe itself keeps the auth it already
    // has; the cookies are set SameSite=None so they survive that third-party
    // context (see arena/web/routes_auth.py).
    container.innerHTML = `
      <span class="flyer-tape"></span>
      ${help}
      <p class="entry__lead">Sign in to race a policy.</p>
      <a class="entry__signin" href="${signInHref()}">
        Sign in with Hugging Face
      </a>
      <p class="entry__consent">
        Watching costs nothing — the board, the replays and the downloads are
        open. Signing in is only needed to test or publish.
      </p>
    `;
    return;
  }

  container.innerHTML = `
    <span class="flyer-tape"></span>
    <p class="entry__user">Racing as <strong id="entry-user"></strong></p>
    <div id="dropzone"></div>
    ${help}
    <label class="entry__name">Name
      <input type="text" id="policy-name" placeholder="optional" />
    </label>
    <label class="entry__name">Training environment
      <input type="url" id="policy-env"
             placeholder="optional — github.com, gitlab.com or huggingface.co" />
      <span class="entry__hint">A link to how this policy was trained. Shown on your row.</span>
    </label>
    <fieldset class="livery">
      <legend>Colour</legend>
      <div class="livery__swatches" id="liveries"></div>
    </fieldset>
    <label class="entry__speed">Speed
      <select id="speed"></select>
      <span class="entry__hint">Sweeping tries every speed and keeps your best.</span>
    </label>
    <div class="entry__actions">
      <button id="try" class="ghost">Test it</button>
      <button id="publish" ${state === "no-hub" ? "disabled" : ""}>Publish</button>
    </div>
    ${
      state === "no-hub"
        ? `<p class="entry__nohub">
             Publish is off: this session has no Hub write access, so an
             entry can't be uploaded. Testing still works.
           </p>`
        : ""
    }
    <p class="entry__consent">
      Publishing shares your <code>.onnx</code> so anyone can download it
      and race it. Testing shares nothing.
    </p>
    <p class="entry__status" id="entry-status"></p>
  `;
  container.querySelector("#entry-user").textContent = me.user;

  const status = container.querySelector("#entry-status");
  const tryButton = container.querySelector("#try");
  const publishButton = container.querySelector("#publish");
  const nameInput = container.querySelector("#policy-name");
  const envInput = container.querySelector("#policy-env");

  // The four colourways the real robot comes in. Picking one shows it on your
  // duck straight away, before you have raced anything.
  let livery = "classic";
  const swatches = container.querySelector("#liveries");
  for (const [name, hex] of Object.entries(VARIANT_SWATCH_HEX)) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.dataset.livery = name;
    swatch.style.setProperty("--swatch", hex);
    swatch.title = name;
    swatch.setAttribute("aria-label", name);
    swatch.setAttribute("aria-pressed", String(name === livery));
    swatch.addEventListener("click", () => {
      livery = name;
      for (const other of swatches.children) {
        other.setAttribute("aria-pressed", String(other.dataset.livery === livery));
      }
      onLiveryChange?.(livery);
    });
    swatches.append(swatch);
  }

  // The trial speed picker, built from the event's own sweep. Default is the
  // sweep itself: the trial should measure the same thing the board does unless
  // you deliberately ask for one speed.
  const speed = container.querySelector("#speed");
  for (const choice of speedChoices(event)) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    speed.append(option);
  }

  const dropzone = createDropzone(container.querySelector("#dropzone"), {
    onFile: () => {
      status.textContent = "";
      status.className = "entry__status";
    },
  });

  async function run(kind) {
    // Belt and braces: the button is already disabled and unwired in the
    // no-hub state, but a publish must never fire even if that ever drifts.
    if (kind === "publish" && state === "no-hub") return;
    const file = dropzone.file;
    if (!file) {
      status.textContent = "Choose a .onnx policy first.";
      status.className = "entry__status bad";
      return;
    }
    tryButton.disabled = true;
    publishButton.disabled = true;
    status.className = "entry__status";
    // Say what is actually taking the time: a sweep is dominated by the number
    // of speeds, a pinned run by the seeds. The picker now applies to BOTH
    // buttons: pinning cannot inflate a published score, because the sweep
    // already keeps the best time across every speed it tries.
    const pinned = speed.value;
    status.textContent = pinned
      ? `Racing ${event.seeds} seeds at ${pinned} m/s…`
      : `Sweeping ${event.sweep_count} speeds × ${event.seeds} seeds…`;
    try {
      if (kind === "try") {
        await onTry({ file, name: nameInput.value, livery, commandVx: pinned });
        status.textContent = "Tested. Nothing published yet.";
      } else {
        const published = await onPublish({
          file,
          // Only on publish: a trial records nothing, so a link would have
          // nowhere to live and no row to sit on.
          // NOT optional-chained. When the markup and this reader disagreed,
          // `envInput?.value ?? ""` silently published every policy with no
          // link and nothing anywhere said so.
          envUrl: envInput.value,
          name: nameInput.value,
          livery,
          commandVx: pinned,
        });
        status.textContent = `Published as ${published.policy_name}.`;
      }
    } catch (error) {
      // The server's own wording — the sentence the robot's daemon would give.
      status.textContent = error.message;
      status.className = "entry__status bad";
    } finally {
      tryButton.disabled = false;
      // A no-hub session never regains publish rights mid-page, so leave it off.
      publishButton.disabled = state === "no-hub";
    }
  }

  tryButton.addEventListener("click", () => run("try"));
  publishButton.addEventListener("click", () => run("publish"));
}

/**
 * The event facts, and the caveat that belongs right under them.
 *
 * Split out from `renderRace` so it can be exercised without a WebGL viewer
 * or an API round-trip: give it a container with a `#facts` node and an
 * event, and check what lands in the DOM.
 *
 * The caveat is earned, not decorative: a policy tuned on a different course,
 * friction or physics build can score worse here without being worse, and
 * saying so plainly is the difference between a board people trust and one
 * they think is broken.
 */
export function renderEventFacts(root, event) {
  const facts = root.querySelector("#facts");
  for (const fact of formatEventFacts(event)) {
    const pair = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = fact.label;
    const dd = document.createElement("dd");
    dd.textContent = fact.value;
    pair.append(dt, dd);
    facts.append(pair);
  }

  const caveat = document.createElement("p");
  caveat.className = "racecaveat";
  caveat.textContent =
    "Times are measured on this course, with this friction and this " +
    "physics build. A policy tuned elsewhere can do worse here without " +
    "being worse.";
  facts.after(caveat);
  return caveat;
}

/**
 * The way into the booth, when this event takes votes.
 *
 * Placed above the entry form, not beside the title -- "détaché et plus
 * visible" was the owner's ask, and a button sharing a line with a heading
 * reads as a menu item, not a call to action. Its own function so the
 * placement is testable without a WebGL viewer or a leaderboard fetch: give
 * it a root with an `#entry` node and an event, and check what lands before it.
 */
export function renderVoteButton(root, event) {
  if (!event.vote) return;
  root.querySelector("#entry").before(voteButton(event, { variant: "panel" }));
}

/**
 * The page's frame, as a detached element.
 *
 * Its own function for the reason `renderVoteButton` is: everything below
 * needs a WebGL viewer and a leaderboard fetch, so the layout could only be
 * read as code rather than exercised as DOM. The structure matters — the
 * entry panel sits level with the title because the title is INSIDE the
 * stage's column, and nothing but a test keeps it there.
 */
export function raceHall(event) {
  const hall = document.createElement("main");
  hall.className = "hall";
  hall.innerHTML = `
    <a class="raceback" href="${menuHref}">Back to the rounds</a>
    <div class="racegrid">
      <div>
        ${event.category ? `<p class="raceeyebrow">${event.category.toUpperCase()}</p>` : ""}
        <h2 class="racetitle">${event.title}</h2>
        <dl class="facts" id="facts"></dl>
        ${deckMarkup}
      </div>
      <div class="entry-col">
        <aside class="entry" id="entry"></aside>
      </div>
    </div>
    ${boardsheetMarkup}
  `;
  return hall;
}


/**
 * The way on, under the board: every other round, as the same sheets the
 * front page pins to its wall.
 *
 * All of them, wrapping onto a second row rather than a chosen four with a
 * button to the rest — with the whole programme already here, that button
 * would only send you to a page showing the same thing. The current event is
 * left out: a card back to the page you are already on is a dead end dressed
 * as a way forward.
 */
export function otherRounds(events, event, boards) {
  const others = events.filter((e) => e.id !== event.id);
  const strip = document.createElement("section");
  strip.className = "rounds-on";
  const head = document.createElement("div");
  head.className = "rounds-on__head";
  const titles = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Keep racing";
  const heading = document.createElement("h2");
  heading.className = "rounds-on__title";
  heading.textContent = "Watch the other rounds.";
  titles.append(eyebrow, heading);
  head.append(titles);
  const wall = document.createElement("div");
  wall.className = "rounds-on__wall";
  wall.append(...others.map((e) => flyer(e, boards.get(e.id) ?? [])));
  strip.append(head, wall);
  return strip;
}

/**
 * Fill and hang the strip of other rounds, once the race above it is up.
 *
 * Separate from otherRounds so that the shape is testable without a network:
 * this is the part that fetches, and it asks for a leaderboard per card and a
 * still per card.
 */
export async function keepRacing(root, event) {
  const events = await getEvents();
  const others = events.filter((e) => e.id !== event.id);
  const boards = new Map();
  await Promise.all(others.map(async (e) => {
    boards.set(e.id, (await getLeaderboard(e.id).catch(() => ({ rows: [] }))).rows);
  }));
  const strip = otherRounds(events, event, boards);
  const foot = root.querySelector("footer");
  if (foot) foot.before(strip); else root.append(strip);

  const stills = await renderThumbnails(others);
  others.forEach((e, i) => {
    const url = stills.get(e.id);
    if (!url) return; // no WebGL, or this rig failed — the frame stays dark
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    strip.querySelectorAll(".challenge-art")[i].replaceChildren(img);
  });
}

export async function renderRace(root, { event, state }) {
  // Started, not awaited. /api/me folds the whole run log for two numbers on
  // a chip; the stage, the entry column and the board's own fetch do not need
  // it, and waiting here meant the page drew nothing until it answered.
  const identity = getMe();
  // The sheet goes on with the first element, not on the way in: until
  // here the previous page is still on screen and keeps its own.
  dress("race");
  root.replaceChildren(signage(undefined));

  const hall = raceHall(event);
  root.append(hall, footer());

  // Only now, where the board needs to know whose rows are someone's own.
  const me = await identity;
  settleIdentity(root, me);

  // The strip of other rounds, after the page is up. It costs a leaderboard
  // per card and a WebGL still each; the race above is what the visitor came
  // for, and none of this may hold it up. Every failure leaves the strip off
  // rather than taking the page with it.
  keepRacing(root, event).catch((error) => {
    // Named, not swallowed. This was `catch(() => {})` and it hid a missing
    // import: the strip simply never appeared and nothing said why. A failure
    // here still must not take the page down, but it must be findable.
    console.error("The other-rounds strip did not load:", error);
  });
  renderVoteButton(root, event);

  renderEventFacts(root, event);

  const board = root.querySelector("#board");
  const entry = root.querySelector("#entry");

  const viewer = await createViewer(root.querySelector("#stage"), {
    // The event declares its rig, and the roller rig is a different kinematic
    // tree with its own blades, rims and tires — not a repaint of the walker.
    rig: event.rig,
    onChaseChange: followKeyFor(root),
  });
  state.viewer = viewer;
  const deck = wireDeck(root, viewer);

  // No slider any more: the stage is pinned at the dimmest the module allows.
  // Worth knowing if this ever looks wrong — brightness.js says in its own
  // comment that the control exists because guessing the exposure from
  // outside cost three rounds. MIN is 0.5 against a 1.25 default.
  viewer.setBrightness(MIN);

  let trial = null; // the unpublished run, if one has been tested
  let currentLivery = "classic"; // mirrors the entry panel's swatch pick
  const traces = new Map();
  const liveries = new Map(); // run id -> the colourway it raced in
  const names = new Map(); // run id -> whose run it is, for the plate over its duck

  async function traceFor(runId) {
    if (!traces.has(runId)) traces.set(runId, await getTrace(runId));
    return traces.get(runId);
  }

  async function race(runIds, tiers = new Map()) {
    const published = await Promise.all(runIds.map(traceFor));
    const lanes = runIds.map((runId, i) => ({
      runId,
      trace: published[i],
      tier: tiers.get(runId) ?? "ghost",
      // A published run keeps the colourway it raced in.
      livery: liveries.get(runId) ?? "classic",
      // The viewer builds a plate only for a lane that has a name; the button
      // below decides whether it is shown.
      name: names.get(runId),
    }));
    // The trial wears whatever is selected right now, so changing the swatch
    // repaints it immediately.
    if (trial) {
      lanes.unshift({
        runId: null, trace: trial.trace, tier: "trial", livery: currentLivery, name: "your test",
      });
    }
    viewer.setLanes(arrangeLanes(board, event.id === "swag-contest" ? lanes.slice(0, 1) : lanes), event);
    deck.reset();
    root.querySelector("#stage-hint").textContent = lanes.length
      ? ""
      : "Tick a lane below, or test a policy, to watch a replay.";
  }

  // The sheet keeps the lanes and the filters; the page says what the rows
  // are — the server's, a trial in its place — and races what is ticked.
  const sheet = wireBoardsheet(hall, {
    event,
    me: me?.user ?? null,
    rows: async () => {
      const { rows } = await getLeaderboard(event.id);
      for (const row of rows) {
        liveries.set(row.run_id, row.livery ?? "classic");
        names.set(row.run_id, row.user);
      }
      return insertProvisional(rows, trial);
    },
    opening: podium,
    onRace: race,
    onWithdraw: async (runId, policy) => {
      // Asked before doing, because it is someone's standing and the button
      // sits on every row they own. `confirm` rather than a bespoke dialog:
      // this is a rare, deliberate action, not a flow worth building UI for.
      if (!window.confirm(`Take "${policy}" off the board? The policy stays in your Hub repo.`)) {
        return;
      }
      try {
        await withdrawRun(runId);
        await sheet.paint();
      } catch (error) {
        const status = entry.querySelector("#entry-status");
        status.textContent = error.message;
        status.className = "entry__status bad";
      }
    },
  });

  renderEntryPanel(entry, me, {
    event,
    onLiveryChange: (livery) => {
      currentLivery = livery;
      race([...sheet.selection], sheet.tiers);
    },
    onTry: async ({ file, name, livery, commandVx }) => {
      trial = await tryPolicy(event.id, file, name, livery, commandVx);
      await sheet.paint();
    },
    onPublish: async ({ file, name, livery, commandVx, envUrl }) => {
      const published = await submitPolicy(event.id, file, name, livery, commandVx, envUrl);
      // The result has its own page now, and the reveal plays there.
      location.hash = runHref(published.run_id);
      return published;
    },
  });

  await sheet.paint();
}
