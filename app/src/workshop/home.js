// The workshop's front: what this machine is connected to, and the challenges to train for.

import { roundCard } from "../roundcard.js";
import { chequer, footer } from "../signage.js";
import * as api from "./api.js";
import { billingGuide, checkLine, forkGuide } from "./checks.js";
import { el } from "./dom.js";
import { accountCard, band, masthead } from "./header.js";
import { challengeHref } from "./routes.js";

/** "Ready to train?": what this machine is connected to, each line ticked or with its guide. */
export function readyList({ account, code, gpu }, { onCheck, onUseFork }) {
  const list = el("ul");
  list.append(
    checkLine({
      ticked: account.phase === "in" && account.canPay, label: "Hugging Face Jobs, billing set up",
      note: "Trains on an L4 GPU, billed to your account.", guide: billingGuide({ onCheck }), group: "ready",
    }),
    checkLine({
      ticked: Boolean(code?.fork), label: "Working in your fork",
      note: code?.fork ?? "Your code on GitHub: people who open your entry see what trained it.",
      guide: forkGuide({ onUseFork }), group: "ready", variant: 1,
    }),
  );
  // Nothing to set up from here: shown only where there is one.
  if (gpu) list.append(checkLine({ ticked: true, label: "NVIDIA GPU on this machine", variant: 2 }));
  return list;
}

/** Where the Arena pins VOTE HERE, the workshop says a challenge has trainings running. */
export function runningSticker(count) {
  return count ? el("span", "sticker sticker-lime ws-running", `${count} training${count === 1 ? "" : "s"} now`) : null;
}

export async function mountHome(root, { status, account }) {
  let code = await api.getCode().catch(() => null);
  const slot = el("span");
  const post = el("div", "todo");
  post.append(el("span", "flyer-tape"), el("h3", "todo__title", "Ready to train?"));
  const pitch = el("div", "door-pitch");
  pitch.append(el("p", "eyebrow", "Microduck workshop"), el("h2", "hero", "Train your own duck."),
    el("p", "lede", "Pick a challenge, then train, submit, compete, repeat."));
  const door = el("section", "door door--ws fx-grain");
  door.append(pitch, post);
  const wall = el("div", "round-cards");
  wall.append(...status.challenges.map((c, i) => roundCard(c.event, null, {
    number: i + 1, href: challengeHref(c.event.id), cta: "Train", corner: runningSticker(c.running),
  })));
  const rounds = el("section", "chapter chapter--wall fx-scanlines");
  rounds.append(el("h3", "eyebrow", "Pick your challenge"), wall);
  const hall = el("main", "hall");
  hall.append(door, chequer("chapter-checker"), rounds);
  const texture = el("div", "page-fx fx-grain");
  texture.setAttribute("aria-hidden", "true");
  root.replaceChildren(texture, masthead(slot), band(status.arena), hall, footer());

  function draw() {
    const state = account.get();
    slot.replaceChildren(accountCard(state, { onLogIn: account.logIn, onRetry: account.check }));
    post.querySelector("ul")?.remove();
    post.append(readyList({ account: state, code, gpu: status.gpu }, {
      onCheck: account.check,
      onUseFork: async (url) => {
        code = await api.useFork(url);
        draw();
      },
    }));
  }
  draw();

  return { leave() {}, accountChanged: draw };
}
