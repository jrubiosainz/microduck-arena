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

/**
 * The controls under the stage, for whichever state the booth is in.
 *
 * Split out from `renderVote` so all four states are testable without WebGL,
 * a viewer or a fetch.
 */
export function votePanel(ballot, onPick) {
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
  for (let lane = 0; lane < ballot.lanes; lane += 1) {
    const button = el("button", "vote-pick");
    button.type = "button";
    button.style.setProperty("--pick", LANE_CSS[lane % LANE_CSS.length]);
    button.setAttribute("aria-label", `Vote for lane ${lane + 1}`);
    button.addEventListener("click", () => onPick?.(lane));
    picks.append(button);
  }
  panel.append(
    el("p", "vote-lead", "Which one has the swag?"),
    picks,
    el("p", "vote-count", `${ballot.cast_today} / ${ballot.per_day} today`),
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

  async function next() {
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
        } finally {
          busy = false;
        }
      }),
    );
  }

  await next();
}
