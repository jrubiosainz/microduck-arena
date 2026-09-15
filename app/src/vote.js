// The voting booth: a field of ducks, and one colour to pick.
//
// Every duck wears the same livery, so nothing but the ring under it — and the
// button that matches — tells one from another. That is deliberate: the ballot
// is anonymous, the draw hands out the colours, and the judgement is meant to
// land on how a duck WALKS and not on whose it is.

import { castVote, getBallot, getBallotTrace, getMe } from "./api.js";
import { LANE_COLORS, LANE_CSS } from "./course.js";
import { raceHref } from "./router.js";
import { signInHref } from "./session.js";
import { signage } from "./signage.js";
import { createViewer } from "./viewer.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
    const link = el("a", "entry__signin", "Sign in with Hugging Face");
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
      try {
        await onPick?.(lane);
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
  panel.append(
    el("p", "vote-lead", "Which one has the swag?"),
    picks,
    el("p", "vote-count", `${ballot.cast_today} / ${ballot.per_day} today`),
    status,
  );
  return panel;
}

export async function renderVote(root, { event, state }) {
  root.replaceChildren(signage(await getMe()));

  const hall = el("main", "hall");
  hall.innerHTML = `
    <div class="votehead">
      <h2 class="racetitle">${event.title}</h2>
      <a class="votehead__back" href="${raceHref(event.id)}">Back to the challenge</a>
    </div>
    <div class="stage"><canvas id="stage"></canvas></div>
    <div id="booth"></div>
  `;
  root.append(hall);

  const viewer = await createViewer(root.querySelector("#stage"), { rig: event.rig });
  state.viewer = viewer;
  const booth = root.querySelector("#booth");

  let busy = false;

  async function next(message) {
    const ballot = await getBallot(event.id);
    if (ballot.state !== "ballot") {
      viewer.setLanes([], event);
      booth.replaceChildren(votePanel(ballot));
      return;
    }
    const traces = await Promise.all(
      Array.from({ length: ballot.lanes }, (_, lane) => getBallotTrace(ballot.ballot, lane)),
    );
    viewer.setLanes(
      traces.map((trace, lane) => ({
        runId: null,
        trace,
        // Every duck the same: the ring is what identifies a lane, not paint.
        tier: "leader",
        livery: "classic",
        colour: LANE_COLORS[lane % LANE_COLORS.length],
      })),
      event,
    );
    booth.replaceChildren(
      votePanel(ballot, async (lane) => {
        // A second click while the first is in flight would spend two ballots
        // on one field, and the cheapest guard is not to send it.
        if (busy) return;
        busy = true;
        try {
          await castVote(event.id, ballot.ballot, lane);
          await next();
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
  }

  await next();
}
