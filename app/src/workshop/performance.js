// A stage challenge's performance, timeline.json, edited on the training's page: the file as it is, in
// the Arena's terminal box, under a plan of the stage that places its ducks, and one button once it
// changed. Saving goes through the Arena's own loader first; the checkpoint on the stage then plays
// the new moves. A refusal says where the file is wrong, and the text stays as typed.

import { el } from "./dom.js";
import { placementPlan } from "./placement.js";

export function performancePanel({ guide, event }, { load, save, onSaved, performers }) {
  const box = el("section", "performance");
  box.innerHTML = `
    <div class="section-label"><p class="eyebrow">Your performance</p>
      <a class="hint" target="_blank" rel="noopener">What the numbers mean ↗</a></div>
    <div class="terminal">
      <div class="terminal-bar mono-label">timeline.json</div>
      <textarea class="terminal-body performance__text" spellcheck="false" rows="14" disabled></textarea>
    </div>
    <p class="note bad performance__why" hidden></p>
    <div class="actions"><button class="button performance__save" type="button" hidden>Save and play</button></div>`;
  const $ = (selector) => box.querySelector(selector);
  $("a").href = guide;
  const text = $(".performance__text");
  const why = $(".performance__why");
  const button = $(".performance__save");
  let saved = "";
  const changed = () => {
    button.hidden = text.value === saved;
    if (text.value === saved) why.hidden = true;
  };
  const refuse = (error) => {
    why.textContent = error.message;
    why.hidden = false;
  };
  // The plan reads the text and writes it as a hand would: the box stays the one truth.
  const plan = placementPlan(event, {
    read: () => text.value,
    write: (value) => {
      text.value = value;
      changed();
    },
    performers,
  });
  $(".terminal").before(plan.el);
  text.addEventListener("input", () => {
    changed();
    plan.refresh();
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      ({ text: saved } = await save(text.value));
      why.hidden = true;
      changed();
      onSaved();
    } catch (error) {
      refuse(error);
    } finally {
      button.disabled = false;
    }
  });
  load().then(({ text: current }) => {
    saved = current;
    text.value = current;
    text.disabled = false;
    changed();
    plan.refresh();
  }, refuse);
  return box;
}
