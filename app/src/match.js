// One match of a cup: the stadium with its two ducks, any of its bouts replayed from the list, the clip
// the show aired and the score.

import { getBoutSettle, getBoutTrace, getMatch, getMe, matchClipUrl } from "./api.js";
import { boutLane, winLine } from "./bouts.js";
import { capitalised } from "./format.js";
import { deckMarkup, followKeyFor, offerOrbit, wireDeck } from "./deck.js";
import { cupHref, dress, playerHref } from "./router.js";
import { footer, signage } from "./signage.js";
import { createViewer } from "./viewer.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** What a bout's line says it was decided by: the duck dragged into the pit, or the marker's side. */
const HOW = {
  pit: (loser) => `${loser} in the pit`,
  marker: () => "the marker on their side",
};

/** One bout in a line: who won it, how, and when. */
export function boutLine(match, bout) {
  const loser = match[bout.winner === "a" ? "b" : "a"].name;
  const verdict = bout.winner ? `${match[bout.winner].name} wins · ${HOW[bout.how](loser)}` : "a draw";
  return `Bout ${bout.k + 1} · ${verdict} · ${bout.time_s.toFixed(2)} s`;
}

/** The page's frame for `match`, as a detached element, as runHall is the run page's. */
export function matchHall(match) {
  const page = el("main", "hall run match");
  page.innerHTML = `
    <header class="run-head">
      <p class="eyebrow"></p>
      <h2 class="racetitle"><a id="title"></a></h2>
      <p class="run-byline mono-label" id="byline"></p>
    </header>
    <div class="run-top">
      ${deckMarkup}
      <section class="run-score">
        <div class="scoreboard">
          <span class="mono-label">bouts won</span>
          <span class="match-score"></span>
          <span class="stamp stamp-pass"></span>
        </div>
        <ol class="match-bouts"></ol>
        <div class="match-clip"></div>
      </section>
    </div>
  `;
  page.querySelector(".eyebrow").textContent =
    match.round === "group" ? `Group ${match.group}` : capitalised(match.round);
  const title = page.querySelector("#title");
  title.textContent = `${match.event.title} Cup #${match.cup}`;
  title.href = cupHref(match.event.id, match.cup);
  const byline = page.querySelector("#byline");
  [match.a, match.b].forEach((side, i) => {
    const who = el("a", null, `@${side.user}`);
    who.href = playerHref(side.user);
    byline.append(i ? " vs " : "", who, ` · ${side.policy_name}`);
  });
  page.querySelector(".match-score").textContent = `${match.wins[0]}–${match.wins[1]}`;
  page.querySelector(".stamp").textContent = winLine(match);
  page.querySelector(".match-bouts").append(...match.bouts.map((bout) => {
    const row = el("li");
    row.append(el("button", "match-bout", boutLine(match, bout)));
    return row;
  }));
  if (match.clip) {
    const video = el("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = matchClipUrl(match.match_id, "landscape.mp4", match.clip);
    page.querySelector(".match-clip").append(video);
  } else {
    page.querySelector(".match-clip").remove();
  }
  return page;
}

export async function renderMatch(root, matchId, state) {
  const [match, me] = await Promise.all([getMatch(matchId), getMe()]);
  if (!match) {
    location.hash = "#/";
    return;
  }
  dress("match");
  root.replaceChildren(signage(me));
  const page = matchHall(match);
  root.append(page, footer());
  document.title = `${match.title} · Microduck Arena`;

  const leaving = new AbortController();
  state.teardown = () => leaving.abort();

  const bouts = new Map();
  const loaded = (k) => {
    if (!bouts.has(k)) {
      const fetched = Promise.all([getBoutTrace(matchId, k), getBoutSettle(matchId, k)]);
      bouts.set(k, fetched);
      // A failed fetch is not remembered: the next click asks again.
      fetched.catch(() => bouts.delete(k));
    }
    return bouts.get(k);
  };
  const created = await createViewer(page.querySelector("#stage"), {
    rig: match.event.rig,
    onChaseChange: followKeyFor(page),
  });
  if (leaving.signal.aborted) {
    created.dispose();
    return;
  }
  state.viewer = created;
  wireDeck(page, created);

  const rows = [...page.querySelectorAll(".match-bout")];
  async function play(k) {
    rows.forEach((row, i) => row.toggleAttribute("aria-current", i === k));
    const [traces, settles] = await loaded(k).catch(() => []);
    if (!traces) return;
    if (leaving.signal.aborted || !rows[k].hasAttribute("aria-current")) return;
    created.setLanes([boutLane(match, k, traces, settles)], match.event);
  }
  rows.forEach((row, k) => row.addEventListener("click", () => play(k)));
  await play(0);
  if (!leaving.signal.aborted) offerOrbit(page, created);
}
