// One training as a ticket on its challenge's wall: its state, where it runs, how far it is, a bar per
// checkpoint (the higher, the faster), its best, whether it is published — and Stop while it runs.
// The job page draws its checkpoints with the same bars.

import { el } from "./dom.js";
import { jobHref } from "./routes.js";

const STICKERS = {
  starting: ["Starting", "sticker-lime"], running: ["Training", "sticker-lime"],
  done: ["Done", "sticker-paper"], stopped: ["Stopped", "sticker-paper"], failed: ["Failed", "sticker-magenta"],
};
export const WHERE = { "hf-jobs": "HF Jobs · L4", local: "This machine" };

export const seconds = (s) => `${s.toFixed(2)} s`;

export function describe(c) {
  if (c.status === "queued") return `Checkpoint ${c.n}: not evaluated yet`;
  if (c.status === "failed") return `Checkpoint ${c.n}: could not be evaluated`;
  if (!c.seeds_finished) return `Checkpoint ${c.n}: no seed finishes`;
  return `Checkpoint ${c.n}: ${seconds(c.score)}, ${c.seeds_finished}/${c.seeds_total} seeds`;
}

/** A bar per checkpoint, as tall as its speed against the fastest; `future` adds the empty slots still to come. */
export function bars(checkpoints, best, { future = [], selected = null, onPick = null } = {}) {
  let fastest = Infinity;
  for (const c of checkpoints) if (c.status === "evaluated" && c.seeds_finished > 0 && c.score < fastest) fastest = c.score;
  const row = el("div", "bars");
  for (const c of checkpoints) {
    const bar = el("i");
    if (c.status === "queued") bar.className = "queued";
    else if (c.status === "failed") bar.className = "failed";
    else if (!c.seeds_finished) bar.className = "dnf";
    else {
      bar.style.height = `${Math.max(6, Math.round((fastest / c.score) * 100))}%`;
      if (c.n === best) bar.className = "best";
    }
    if (c.n === selected) bar.classList.add("sel");
    bar.title = describe(c);
    if (onPick && c.status !== "queued") {
      bar.tabIndex = 0;
      bar.setAttribute("role", "button");
      bar.addEventListener("click", () => onPick(c.n));
      bar.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(c.n);
        }
      });
    }
    row.append(bar);
  }
  for (const n of future) {
    const slot = el("span", "slot");
    slot.title = `Checkpoint ${n}: not saved yet`;
    row.append(slot);
  }
  return row;
}

/** The ticket's line about its checkpoints: its best, or what it is waiting for. */
export function summary(ticket, voted) {
  const line = el("p", "ticket__line");
  const rows = ticket.checkpoints;
  const best = rows.find((c) => c.n === ticket.best);
  if (!voted && best) {
    line.append(`Best: checkpoint ${best.n} · `, el("b", "", seconds(best.score)), ` · ${best.seeds_finished}/${best.seeds_total}`);
    return line;
  }
  line.classList.add("ticket__muted");
  const queued = rows.filter((c) => c.status === "queued").length;
  if (!rows.length) line.textContent = ticket.state === "failed" ? "Stopped with an error. Open it for the whole output." : "No checkpoint yet.";
  else if (queued) line.textContent = `Evaluating checkpoints: ${rows.length - queued} of ${rows.length} done.`;
  else line.textContent = voted ? `${rows.length} checkpoints evaluated: pick one to publish.` : "No checkpoint finishes yet.";
  return line;
}

/** "entered on sprint-2m: 4.892 s (5/5 seeds) at 0.55 m/s" → "4.89 s". */
export function officialTime(entered) {
  const found = /: ([\d.]+) s/.exec(entered ?? "");
  return found ? seconds(Number(found[1])) : entered;
}

export function progress({ done, total }) {
  const bar = el("div", "progress");
  const fill = el("i");
  fill.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
  bar.append(fill, el("span", "", `${done} / ${total}`));
  return bar;
}

/** Stop, on a running ticket: confirmed, and once pressed it waits for its answer (a second press asks nothing). */
function stopButton(current, onStop) {
  // A span, not a button: the whole card is a link, and a button may not sit inside one.
  const stop = el("span", "quiet ticket__stop", "Stop");
  stop.setAttribute("role", "button");
  stop.tabIndex = 0;
  const ask = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ticket = current();
    const lost = ticket.where === "hf-jobs" ? "A stopped Hugging Face job cannot be resumed." : "It cannot be resumed.";
    if (stop.getAttribute("aria-disabled") === "true" || !window.confirm(`Stop ${ticket.name}? ${lost}`)) return;
    stop.setAttribute("aria-disabled", "true");
    try {
      await onStop(ticket.id);
    } finally {
      stop.removeAttribute("aria-disabled");
    }
  };
  stop.addEventListener("click", ask);
  stop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") ask(e);
  });
  return stop;
}

/**
 * A ticket's card, updated in place as its training moves: the card and its Stop are never replaced
 * nor moved (either would drop the focus, or a press under way); only what is drawn beside the Stop is.
 */
export function ticketCard(first, { event, voted, onStop }) {
  const card = el("a", "ticket");
  card.href = jobHref(event, first.id);
  const content = el("div", "ticket__content");
  card.append(el("span", "flyer-tape"), content);
  let ticket = null;
  let shown = null; // the ticket as last drawn: the same answer draws nothing
  let stop = null;

  function update(next) {
    const answer = JSON.stringify(next);
    if (answer === shown) return;
    ticket = next;
    shown = answer;
    const running = ticket.state === "starting" || ticket.state === "running";
    card.classList.toggle("ticket--running", running);
    card.classList.toggle("ticket--failed", ticket.state === "failed");
    const [word, colour] = STICKERS[ticket.state];
    const top = el("div", "ticket__top");
    top.append(el("span", `sticker ${colour}`, word), el("span", "mono-label", WHERE[ticket.where] ?? "From a shell"));
    content.replaceChildren(top, el("h4", "ticket__name", ticket.name));
    if (running && ticket.progress) content.append(progress(ticket.progress));
    if (ticket.checkpoints.length) content.append(bars(ticket.checkpoints, voted ? null : ticket.best));
    content.append(summary(ticket, voted), ticket.published
      ? el("p", "ticket__pub ticket__pub--yes", `★ Published · ${officialTime(ticket.published.entered)} on the Arena`)
      : el("p", "ticket__pub", "Not published"));
    if (running && !stop) {
      stop = stopButton(() => ticket, onStop);
      card.append(stop);
    } else if (!running && stop) {
      stop.remove();
      stop = null;
    }
  }

  update(first);
  return { el: card, update };
}
