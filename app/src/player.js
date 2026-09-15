// One player: their picture and name, what their publications earned, where
// they stand, and their best run on every event they entered.

import { getMe, getPlayer } from "./api.js";
import { formatScore } from "./format.js";
import { menuHref, raceHref } from "./router.js";
import { avatar, signage } from "./signage.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function profile(player) {
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
    el("span", "sticker sticker-cyan", `#${player.rank}`),
  );

  const list = el("ul", "profile-results");
  for (const best of player.best) {
    const item = el("li");
    const link = el("a");
    link.href = raceHref(best.event_id);
    link.append(
      el("span", "eyebrow", best.event_title),
      el("strong", null, `#${best.rank} · ${formatScore(best.score, { finished: best.seeds_finished })}`),
      el("span", "mono-label", best.policy_name),
    );
    item.append(link);
    list.append(item);
  }

  box.append(header, summary, el("h3", "eyebrow", "Best publications"), list);
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
  hall.append(player ? profile(player) : noProfile(user));
  root.append(hall);
}
