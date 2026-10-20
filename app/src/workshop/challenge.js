// One challenge: how to make its training yours, the form that launches one, and one ticket per
// training, asked again every few seconds (the tickets fill in as checkpoints are saved and
// evaluated). Only what changed is redrawn: what is typed in the form, and a focused ticket, stay.

import { formatEventFacts, isStage } from "../format.js";
import { footer } from "../signage.js";
import * as api from "./api.js";
import { el } from "./dom.js";
import { accountChip, strip } from "./header.js";
import { homeHref } from "./routes.js";
import { ticketCard } from "./tickets.js";
import { trainForm } from "./trainform.js";

export const POLL_MS = 3000;

const FILES = [
  ["challenge.toml", "the reward weights and the recipe (the form's Settings edit them)"],
  ["env.py", "the whole training: rewards, commands, randomisation, terrain"],
  ["rewards.py", "your own reward terms: create it, then add them to cfg.rewards in env.py"],
];
const PERFORMANCE = ["timeline.json", "your performance: what the Arena commands, and when (a training's page edits it and plays it)"];

function yours(folder, stage) {
  const box = el("div", "yours");
  const say = el("p");
  say.append(el("b", "", "Make it yours."), " Change a reward or write your own in these files, with your editor. "
    + "Each training starts from a commit, so every job remembers exactly what trained it.");
  const terminal = el("div", "terminal");
  terminal.append(el("div", "terminal-bar mono-label", `microduck-challenges / src / microduck_challenges / ${folder}`));
  const body = el("div", "terminal-body");
  for (const [file, what] of stage ? [...FILES, PERFORMANCE] : FILES) {
    const line = el("div", "yours__line");
    line.append(el("b", "", file), el("span", "", what));
    body.append(line);
  }
  terminal.append(body);
  box.append(say, terminal);
  return box;
}

function head(challenge, arena) {
  const { event } = challenge;
  const box = el("div", "head");
  if (event.category) box.append(el("p", "raceeyebrow", event.category.toUpperCase()));
  box.append(el("h2", "racetitle", event.title));
  const facts = el("dl", "facts");
  for (const fact of formatEventFacts(event)) {
    const pair = el("div");
    pair.append(el("dt", "", fact.label), el("dd", "", fact.value));
    facts.append(pair);
  }
  const caveat = el("p", "racecaveat", event.metric === "votes" ? "" : "The Arena races your duck at every speed of the sweep and keeps its best. ");
  const board = el("a", "help-link", "See the board on the Arena ↗");
  Object.assign(board, { href: `${arena}/#/e/${event.id}`, target: "_blank", rel: "noopener" });
  caveat.append(board);
  box.append(facts, caveat, yours(challenge.folder, isStage(event)));
  return box;
}

export async function mountChallenge(root, { status, account, route }) {
  const slot = el("span");
  const drawAccount = () => slot.replaceChildren(accountChip(account.get(), { onLogIn: account.logIn, onRetry: account.check }));
  const hall = el("main", "hall");
  const back = el("a", "raceback", "Back to the challenges");
  back.href = homeHref;
  hall.append(back);
  root.replaceChildren(strip(slot), hall, footer());
  drawAccount();
  const challenge = status.challenges.find((c) => c.event.id === route.event);
  if (!challenge) {
    hall.append(el("p", "failed", `${route.event} is not a challenge open here.`));
    return { leave() {}, accountChanged: drawAccount };
  }
  const event = challenge.event.id;
  const voted = challenge.event.metric === "votes";
  let code = await api.getCode();

  const side = el("aside", "side");
  const count = el("span", "mono-label");
  const heading = el("div", "trainings-head");
  heading.append(el("h3", "", "Your trainings"), count);
  const wall = el("div", "tickets");
  const body = el("section", "body");
  body.append(heading, wall);
  const grid = el("div", "wsgrid");
  grid.append(head(challenge, status.arena), side, body);
  hall.append(grid);

  // Every write (a commit, a launch, a stop) is followed by a fresh look, which also drops any poll
  // still out: its answer predates the write.
  const form = trainForm({ challenge, gpu: status.gpu }, {
    onCommit: async (message) => {
      await api.commitCode(message);
      await refresh();
    },
    onTrain: async (values) => {
      await api.train(event, values);
      await refresh();
    },
  });
  side.append(form.el);
  function redrawForm() {
    form.update({ code, account: account.get() });
  }
  redrawForm();

  async function onStop(id) {
    try {
      await api.stopJob(event, id);
    } catch (error) {
      window.alert(error.message);
    }
    await refresh();
  }

  // One card per ticket, by id, updated in place; a card already in its place is never moved, so it
  // keeps its focus, its hover and a press under way.
  let cards = new Map(); // id -> ticketCard
  const empty = el("p", "tickets__empty", "No training yet: the first one starts from the form.");
  function drawWall(jobs) {
    const next = new Map();
    for (const ticket of jobs) {
      const card = cards.get(ticket.id) ?? ticketCard(ticket, { event, voted, metric: challenge.event.metric, onStop });
      card.update(ticket);
      next.set(ticket.id, card);
    }
    cards = next;
    const wanted = jobs.length ? [...cards.values()].map((card) => card.el) : [empty];
    // The cards that go leave first, so a kept one slides into place without being moved.
    const keep = new Set(wanted);
    for (const child of [...wall.children]) if (!keep.has(child)) child.remove();
    wanted.forEach((card, i) => {
      if (wall.children[i] !== card) wall.insertBefore(card, wall.children[i] ?? null);
    });
  }

  // Polls never overlap: the next is set once the latest answer is in. An answer older than the
  // latest question, or one landing after the page was left, draws nothing.
  let asked = 0;
  let timer = null;
  let left = false;
  const latest = (mine) => mine === asked && !left;
  async function refresh() {
    const mine = ++asked;
    clearTimeout(timer);
    try {
      const [jobs, now] = await Promise.all([api.getJobs(event), api.getCode()]);
      // A new commit may carry challenge.toml edited by hand: the Settings read it again.
      const fresh = now.commit === code.commit ? null : await api.getStatus();
      if (!latest(mine)) return;
      if (fresh) form.reseed(fresh.challenges.find((c) => c.event.id === event));
      code = now; // files edited meanwhile lock the form again
      redrawForm();
      const running = jobs.filter((t) => t.state === "starting" || t.state === "running").length;
      count.textContent = `${jobs.length} run${jobs.length === 1 ? "" : "s"}${running ? ` · ${running} training now` : ""}`;
      drawWall(jobs);
    } catch (error) {
      if (latest(mine)) count.textContent = `Lost touch with the workshop: ${error.message}`;
    } finally {
      if (latest(mine)) timer = setTimeout(refresh, POLL_MS);
    }
  }
  await refresh();

  return {
    leave() {
      left = true;
      clearTimeout(timer);
    },
    accountChanged() {
      drawAccount();
      redrawForm();
    },
  };
}
