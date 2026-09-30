// A to-do list's hand-drawn boxes, and the lines they tick: the home's "Ready to train?" and the two
// checks over Publish. A line not ticked can open its own guide, one open at a time in its list.

import { el } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";
// Three hand-drawn squares, so a column of boxes does not read as one stamp repeated.
const FRAMES = [
  "M4.5 5.2C9 4.2 17 4.6 23.4 4.1 23.9 10 23.6 17 24 23.6 17 24.2 10 23.8 4.2 24.1 4.6 17 4.1 10 4.5 5.2Z",
  "M4.2 4.6C10 4.9 16.5 4.1 23.8 4.8 23.5 11 24.2 17.5 23.5 23.9 16.8 23.4 10.4 24.3 4.5 23.7 4.1 17 4.8 11.3 4.2 4.6Z",
  "M4.8 4.3C11 4.8 17 4.2 23.6 4.6 24.1 10.5 23.4 17.2 23.9 23.8 17.5 23.5 10.8 24.1 4.3 23.8 4.7 17.6 4.2 10.9 4.8 4.3Z",
];
// The tick overshoots the box, as a pen does.
const TICK = "M7 14.5 12 20 25.5 3.5";
const FORK_PAGE = "https://github.com/pollen-robotics/microduck-challenges/fork";
const BILLING = "https://huggingface.co/settings/billing";

function path(className, d) {
  const line = document.createElementNS(SVG, "path");
  line.setAttribute("class", className);
  line.setAttribute("d", d);
  return line;
}

export function box(ticked, variant = 0) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "box");
  svg.setAttribute("viewBox", "0 0 28 28");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path("frame", FRAMES[variant % FRAMES.length]));
  if (ticked) svg.append(path("tick", TICK));
  return svg;
}

/**
 * One line of a list. Ticked, or with no `guide`, it only says, with an optional `action` (a button)
 * at its end. Not ticked, with a `guide` (a node), a "How?" opens it; `group` names the list, so
 * opening one guide closes the others.
 */
export function checkLine({ ticked, label, note, guide, group, action, variant = 0 }) {
  const li = el("li", ticked ? "check check--ticked" : "check");
  const words = el("span", "check__words");
  words.append(el("span", "check__label", label));
  if (note) words.append(el("small", "check__note", note));
  if (ticked || !guide) {
    li.classList.add("check--plain");
    li.append(box(ticked, variant), words);
    if (action) li.append(action);
    return li;
  }
  const details = el("details");
  if (group) details.setAttribute("name", group);
  const summary = el("summary", "check__row");
  summary.append(box(false, variant), words, el("span", "how", "How?"));
  const inside = el("div", "guide");
  inside.append(guide);
  details.append(summary, inside);
  li.append(details);
  return li;
}

/** The fork's guide: GitHub's fork page, then the fork's address, which the workshop makes `origin`. */
export function forkGuide({ onUseFork }) {
  const guide = el("div");
  guide.innerHTML = `
    <ol>
      <li><a target="_blank" rel="noopener">Fork microduck-challenges</a> on GitHub (free account).</li>
      <li>Paste your fork's address:
        <span class="guide__field"><input type="url" name="fork" placeholder="https://github.com/you/microduck-challenges" spellcheck="false" /><button class="quiet" type="button">Use it</button></span></li>
    </ol>
    <p>This folder then sends your commits to your fork; Pollen's repository stays as <code>upstream</code>.</p>
    <p class="guide__error" hidden></p>`;
  guide.querySelector("a").href = FORK_PAGE;
  const error = guide.querySelector(".guide__error");
  const button = guide.querySelector("button");
  button.addEventListener("click", async () => {
    error.hidden = true;
    button.disabled = true;
    try {
      await onUseFork(guide.querySelector("input").value.trim());
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  return guide;
}

/** Billing's guide: Hugging Face's billing page (it asks to log in first when needed), then a new look. */
export function billingGuide({ onCheck }) {
  const guide = el("div");
  guide.innerHTML = `
    <p>Hugging Face Jobs rent you a GPU by the minute: your account needs a payment method.</p>
    <p><a target="_blank" rel="noopener">Add a payment method</a>, then <button class="quiet" type="button">Check again</button></p>`;
  guide.querySelector("a").href = BILLING;
  guide.querySelector("button").addEventListener("click", onCheck);
  return guide;
}
