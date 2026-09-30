// One challenge: how to make its training yours, the form that launches one, and one ticket per
// training, asked again every few seconds (the tickets fill in as checkpoints are saved and
// evaluated). Only what changed is redrawn: what is typed in the form stays.

import { formatEventFacts } from "../format.js";
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

function yours(folder) {
  const box = el("div", "yours");
  const say = el("p");
  say.append(el("b", "", "Make it yours."), " Change a reward or write your own in these files, with your editor. "
    + "Each training starts from a commit, so every job remembers exactly what trained it.");
  const terminal = el("div", "terminal");
  terminal.append(el("div", "terminal-bar mono-label", `microduck-challenges / src / microduck_challenges / ${folder}`));
  const body = el("div", "terminal-body");
  for (const [file, what] of FILES) {
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
  box.append(facts, caveat, yours(challenge.folder));
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

  const form = trainForm({ challenge, gpu: status.gpu }, {
    onCommit: async (message) => {
      code = await api.commitCode(message);
      redrawForm();
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

  let drawn = null; // the tickets on the wall, as last answered: an unchanged answer redraws nothing
  async function refresh() {
    try {
      const [jobs, latest] = await Promise.all([api.getJobs(event), api.getCode()]);
      code = latest; // files edited meanwhile lock the form again
      redrawForm();
      const answer = JSON.stringify(jobs);
      if (answer === drawn) return;
      drawn = answer;
      const running = jobs.filter((t) => t.state === "starting" || t.state === "running").length;
      count.textContent = `${jobs.length} run${jobs.length === 1 ? "" : "s"}${running ? ` · ${running} training now` : ""}`;
      wall.replaceChildren(...(jobs.length
        ? jobs.map((ticket) => ticketCard(ticket, { event, voted, onStop }))
        : [el("p", "tickets__empty", "No training yet: the first one starts from the form.")]));
    } catch (error) {
      drawn = null; // the count now says the workshop is lost: the next answer redraws it
      count.textContent = `Lost touch with the workshop: ${error.message}`;
    }
  }
  await refresh();
  const timer = setInterval(refresh, POLL_MS);

  return {
    leave() {
      clearInterval(timer);
    },
    accountChanged() {
      drawAccount();
      redrawForm();
    },
  };
}
