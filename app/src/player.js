// One player: their picture and name, what their publications earned, where
// they stand, and every run they published, newest first.

import { getMe, getPlayer } from "./api.js";
import { formatScore } from "./format.js";
import { menuHref, runHref } from "./router.js";
import { avatar, footer, signage } from "./signage.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function profile(player, me = null) {
  const box = el("div", "profile");

  const header = el("header", "profile-header");
  const duck = el("span", "profile-duck");
  duck.append(avatar(player.user));
  const words = el("div");
  words.append(el("p", "eyebrow", "Player"), el("h2", "marquee-title", player.user));
  header.append(duck, words);

  const summary = el("div", "profile-summary");
  summary.append(
    el("span", "sticker sticker-lime", `✦ ${player.points} points`),
    el("span", "sticker sticker-cyan", player.rank == null ? "#—" : `#${player.rank}`),
  );

  // Every run, newest first, each the way to its own page. The dot is the
  // owner's alone: it says a result of THEIRS waits to be opened.
  const list = el("ul", "profile-results");
  for (const pub of player.publications) {
    const item = el("li");
    const link = el("a", pub.withdrawn ? "withdrawn" : null);
    link.href = runHref(pub.run_id);
    if (me?.user === player.user && !pub.seen) link.classList.add("unread");
    // A voted event's rank is earned by votes, not by time — "#1 · 18.46s"
    // beside a Swag Contest entry would read as a finish time that placed it,
    // when the finish time never ranked anything there.
    const earned = pub.votes != null
      ? (pub.votes ? `${pub.votes} votes` : "no votes yet")
      : formatScore(pub.score, { finished: pub.seeds_finished });
    link.append(
      el("span", "eyebrow", pub.event_title),
      el("strong", null, `#${pub.rank ?? "—"} · ${earned}`),
      el("span", "mono-label", pub.withdrawn ? `${pub.policy_name} · withdrawn` : pub.policy_name),
      el("span", "profile-date", pub.submitted_at.slice(0, 10)),
    );
    item.append(link);
    list.append(item);
  }

  box.append(header, summary, el("h3", "eyebrow", "Publications"), list);
  return box;
}

export function noProfile(user) {
  const box = el("div", "profile profile-empty");
  box.append(el("p", "eyebrow", "Player"), el("h2", "marquee-title", user));
  const line = el("p", "lede", `No publication yet. `);
  const back = el("a", null, "Pick a round");
  back.href = menuHref;
  line.append(back, " to put a time up.");
  box.append(line);
  return box;
}

export async function renderPlayer(root, user) {
  const [player, me] = await Promise.all([getPlayer(user), getMe()]);
  root.replaceChildren(signage(me));
  const hall = el("main", "hall");
  hall.append(player ? profile(player, me) : noProfile(user));
  root.append(hall, footer());
}
