// The voting booth: a field of ducks, and one colour to pick.
//
// Every duck wears the same livery, so nothing but the ring under it — and the
// button that matches — tells one from another. That is deliberate: the ballot
// is anonymous, the draw hands out the colours, and the judgement is meant to
// land on how a duck WALKS and not on whose it is.

import { castVote, getBallot, getBallotTrace, getMe } from "./api.js";
import { replayLane } from "./cast.js";
import { LANE_COLORS, LANE_CSS } from "./course.js";
import { isStage } from "./format.js";
import { dress, raceHref } from "./router.js";
import { signInHref } from "./session.js";
import { credit, shower } from "./points.js";
import { footer, settleIdentity, signage } from "./signage.js";
import { isMuted, play, toggleMuted } from "./sound.js";
import { createViewer } from "./viewer.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function prefersReducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // No `matchMedia` at all (jsdom has none) is treated the same as
    // "reduce": the ceremony is decoration, so skipping it is always safe,
    // never a lost vote.
    return true;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The speaker toggle for the three cues in sound.js, labelled for a screen reader. */
function muteToggle() {
  const button = el("button", "vote-mute");
  button.type = "button";
  const sync = () => {
    const muted = isMuted();
    button.setAttribute("aria-pressed", String(muted));
    button.setAttribute("aria-label", muted ? "Unmute vote sounds" : "Mute vote sounds");
    button.textContent = muted ? "🔇" : "🔊";
  };
  sync();
  button.addEventListener("click", () => {
    toggleMuted();
    sync();
  });
  return button;
}

// Timings from the spec, in ms, each measured from the step before it.
const FLIGHT_TO_ENVELOPE = 150; // press → the envelope starts sliding up
const ENVELOPE_TO_ARRIVE = 300; // → the post-it arrives inside (450ms from the click)
const STAMP_TO_STARS = 150; // seal confirmed → the stars are born
const ENVELOPE_OUT = 300; // → the envelope finishes leaving (550ms from confirmation)

/**
 * The one-second ballot ceremony around a click.
 *
 * It lives on `document.body`, not inside this panel: `settle` (`onPick`'s
 * own promise) can swap the whole booth out from under this button before
 * the envelope has finished its flight — a fast server, or a caller with no
 * delay at all — and the ceremony has to keep playing over whatever panel is
 * now underneath it, not vanish with the one it started on.
 *
 * Every step here is best-effort decoration around `settle`, which the
 * caller's own click handler already awaits to decide the vote's real
 * outcome. This function only watches the same promise to choose which tail
 * to play, and never lets a failure of its own reach the caller.
 */
async function runCeremony(lane, settle) {
  let overlay = null;
  try {
    overlay = el("div", "vote-ceremony");
    const postit = el("div", "vote-ceremony__postit");
    postit.style.setProperty("--pick", LANE_CSS[lane % LANE_CSS.length]);
    postit.append(el("span", "vote-ceremony__num", String(lane + 1)));
    const envelope = el("div", "vote-ceremony__envelope");
    envelope.append(el("div", "vote-ceremony__flap"));
    overlay.append(envelope, postit);
    document.body.append(overlay);

    play("press");
    postit.classList.add("vote-ceremony__postit--fly");
    await wait(FLIGHT_TO_ENVELOPE);
    envelope.classList.add("vote-ceremony__envelope--up");
    await wait(ENVELOPE_TO_ARRIVE);
    postit.classList.add("vote-ceremony__postit--in");

    // Wait here for the server, exactly as long as it takes: closing the
    // envelope and raining points before it answers would celebrate a vote
    // that has not happened, and votes really do fail. What it answers with
    // says how many points the ballot paid.
    const counted = await Promise.resolve(settle).then(
      (result) => result ?? {},
      () => null,
    );

    if (counted) {
      envelope.classList.add("vote-ceremony__envelope--sealed");
      play("stamp");
      await wait(STAMP_TO_STARS);
      // One star per point, born around the envelope, landing on the chip,
      // whose counter then rolls — the same shower a publication's points get.
      const chip = document.querySelector(".profile-chip");
      if (chip && counted.points) {
        await shower(envelope, chip, counted.points);
        await credit(chip, counted.points);
      }
    }
    envelope.classList.add("vote-ceremony__envelope--out");
    await wait(ENVELOPE_OUT);
  } catch {
    // Decoration only — nothing here may affect whether the vote counted.
  } finally {
    overlay?.remove();
  }
}

// The exact sentence `_open()` in routes_vote.py sends for an unknown or
// expired token, a lane out of range, or a voter mismatch. Unlike a lost
// quota race or a wrong-event ballot, no retry of THIS ballot ever succeeds —
// a booth left open past its TTL, or one that outlived a Space restart, looks
// alive but answers every click the same way forever. That is the one
// failure `renderVote`'s `next()` recovers from itself, by drawing a fresh
// field instead of leaving the visitor to click a dead one.
export const DEAD_BALLOT_MESSAGE = "That ballot is not valid any more. Ask for a new one.";

/**
 * The controls under the stage, for whichever state the booth is in.
 *
 * Split out from `renderVote` so all four states are testable without WebGL,
 * a viewer or a fetch. `initialStatus` seeds the status line for a panel
 * drawn to carry a message forward (a dead ballot recovered into a fresh
 * field) rather than one reached by a click of its own.
 */
export function votePanel(ballot, onPick, initialStatus) {
  const panel = el("div", "vote-panel");

  if (ballot.state === "signed-out") {
    const link = el("a", "signin-button", "Sign in with Hugging Face");
    link.href = signInHref();
    panel.append(link);
    return panel;
  }

  if (ballot.state === "too-few") {
    const verb = ballot.have === 1 ? "there is" : "there are";
    panel.append(
      el(
        "p",
        "vote-empty",
        `Voting needs ${ballot.need} ducks, and ${verb} ${ballot.have} so far.`,
      ),
    );
    return panel;
  }

  if (ballot.state === "quota") {
    panel.append(
      el(
        "p",
        "vote-empty",
        `That is your ${ballot.per_day} votes for today. Come back tomorrow.`,
      ),
    );
    return panel;
  }

  const picks = el("div", "vote-picks");
  const status = el("p", "vote-status");
  if (initialStatus) {
    status.textContent = initialStatus;
    status.className = "vote-status bad";
  }
  const buttons = [];
  for (let lane = 0; lane < ballot.lanes; lane += 1) {
    const button = el("button", "vote-pick");
    button.type = "button";
    button.style.setProperty("--pick", LANE_CSS[lane % LANE_CSS.length]);
    button.setAttribute("aria-label", `Vote for lane ${lane + 1}`);
    // The palette is colour-only otherwise — orange next to hi-vis lime helps
    // nobody who cannot tell them apart, in a feature whose whole premise is
    // "pick a colour". The number is the shape and label a swatch alone is not.
    button.append(el("span", "vote-pick__num", String(lane + 1)));
    button.addEventListener("click", async () => {
      // Disabled the instant the click lands, not after the await starts: a
      // second click on the same tick would otherwise slip through before
      // `busy` (in the caller) is even set.
      status.textContent = "";
      status.className = "vote-status";
      for (const b of buttons) b.disabled = true;

      const settle = onPick?.(lane);
      // Fire-and-forget: the ceremony watches `settle` on its own timers and
      // must never make the caller wait for it, or a slow browser turning
      // theatre into lag would be worse than no ceremony at all.
      if (!prefersReducedMotion()) runCeremony(lane, settle);

      try {
        await settle;
        // Success swaps this whole panel for the next one; leave the buttons
        // disabled rather than flash them back on right before that happens.
      } catch (error) {
        // The server writes this sentence for a person to read (an expired
        // ballot, a quota lost to another tab) — show it, and give the
        // buttons back so the click was not a dead end.
        status.textContent = error.message;
        status.className = "vote-status bad";
        for (const b of buttons) b.disabled = false;
      }
    });
    buttons.push(button);
    picks.append(button);
  }
  const headrow = el("div", "vote-headrow");
  headrow.append(el("p", "vote-lead", "Which performance gets your vote?"), muteToggle());
  panel.append(
    headrow,
    picks,
    el("p", "vote-count", `${ballot.cast_today} / ${ballot.per_day} today`),
    status,
  );
  return panel;
}

/**
 * A stage's running order: a ticket per performance, in the colour and number
 * of its post-it in the ballot below, so what is watched and what is voted for
 * are the same thing at a glance. The one on stage stands raised and marked,
 * and the ones watched to their end are ticked.
 *
 * `play(index)` puts a performance on stage. `follow(player)`, every frame,
 * fills the playing ticket's bar and, once its replay has ended, puts the next
 * one on — 1, 2, 3, 1 … — so a voter sees the whole field without a click.
 */
export function runningOrder(count, play) {
  const row = el("div", "acts");
  row.setAttribute("aria-label", "The performances on this ballot");
  let current = 0;
  const tickets = Array.from({ length: count }, (_, index) => {
    const ticket = el("button", "act");
    ticket.type = "button";
    ticket.style.setProperty("--pick", LANE_CSS[index % LANE_CSS.length]);
    ticket.setAttribute("aria-label", `Watch performance ${index + 1}`);
    const bar = el("span", "act__bar");
    bar.append(el("span"));
    ticket.append(
      el("span", "act__tag", "On stage"),
      el("span", "act__label", "Performance"),
      el("span", "act__num", String(index + 1)),
      bar,
      el("span", "act__seen", "✓"),
    );
    ticket.addEventListener("click", () => show(index));
    row.append(ticket);
    return ticket;
  });

  function show(index) {
    current = index;
    tickets.forEach((ticket, i) => ticket.setAttribute("aria-pressed", String(i === index)));
    play(index);
  }

  show(0);
  return {
    element: row,
    follow({ time, duration, playing }) {
      tickets[current].style.setProperty("--progress", String(duration ? time / duration : 0));
      if (playing) return;
      tickets[current].classList.add("act--seen");
      show((current + 1) % count);
    },
  };
}

export async function renderVote(root, { event, state }) {
  // Started, not awaited: the booth does not read it, and /api/me folds the
  // whole run log for two numbers on a chip.
  const identity = getMe();
  // The sheet goes on with the first element, not on the way in: until
  // here the previous page is still on screen and keeps its own.
  dress("vote");
  root.replaceChildren(signage(undefined));
  identity.then((me) => settleIdentity(root, me));

  // A stage shows its performances one at a time, and says in the picture's
  // corner which one is on, with the ticket's own colour and number.
  const solo = isStage(event);
  const hall = el("main", "hall");
  hall.innerHTML = `
    <div class="votehead">
      <h2 class="racetitle">${event.title}</h2>
      <a class="votehead__back" href="${raceHref(event.id)}">Back to the challenge</a>
    </div>
    <div class="stage"><canvas id="stage"></canvas>${solo ? '<p class="on-stage" aria-hidden="true"></p>' : ""}</div>
    <div id="booth"></div>
  `;
  root.append(hall, footer());

  const viewer = await createViewer(root.querySelector("#stage"), { rig: event.rig });
  state.viewer = viewer;
  const booth = root.querySelector("#booth");
  const onStage = root.querySelector(".on-stage");

  let busy = false;

  async function next(message) {
    const ballot = await getBallot(event.id);
    if (ballot.state !== "ballot") {
      viewer.setLanes([], event);
      onStage?.replaceChildren();
      booth.replaceChildren(votePanel(ballot));
      return;
    }
    const traces = await Promise.all(
      Array.from({ length: ballot.lanes }, (_, lane) => getBallotTrace(ballot.ballot, lane)),
    );
    const entries = traces.map((duckTraces, lane) => replayLane(event, ballot.cast[lane], duckTraces, {
      runId: null,
      // Every performer wears the same livery on an anonymous ballot, every duck of a troupe too.
      tier: "leader",
      livery: "classic",
      colour: LANE_COLORS[lane % LANE_COLORS.length],
    }));
    if (!solo) viewer.setLanes(entries, event);
    booth.replaceChildren(
      votePanel(ballot, async (lane) => {
        // A second click while the first is in flight would spend two ballots
        // on one field, and the cheapest guard is not to send it.
        if (busy) return;
        busy = true;
        try {
          const cast = await castVote(event.id, ballot.ballot, lane);
          await next();
          // The ceremony reads the points off this once the field has moved on.
          return cast;
        } catch (error) {
          if (error.message === DEAD_BALLOT_MESSAGE) {
            // This ballot cannot be retried into working — draw a fresh
            // field so the booth recovers itself, and carry the message
            // into it so the visitor still learns why.
            await next(error.message);
            return;
          }
          throw error;
        } finally {
          busy = false;
        }
      }, message),
    );
    if (solo) {
      const order = runningOrder(entries.length, (index) => {
        // Once, not looped: its end is the cue for the next.
        viewer.setLanes([entries[index]], event, { loop: false });
        onStage.style.setProperty("--pick", LANE_CSS[index % LANE_CSS.length]);
        onStage.replaceChildren(el("span", "on-stage__label", "On stage"), el("span", "on-stage__num", String(index + 1)));
      });
      booth.prepend(order.element);
      // Until a vote draws the next field and this row leaves the page.
      (function follow() {
        if (!order.element.isConnected) return;
        order.follow(viewer.player);
        requestAnimationFrame(follow);
      })();
      booth.querySelectorAll(".vote-pick").forEach((button, index) => {
        button.setAttribute("aria-label", `Vote for performance ${index + 1}`);
      });
    }
  }

  await next();
}
