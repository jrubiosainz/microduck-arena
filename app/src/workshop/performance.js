// A stage challenge's performance, timeline.json, edited on the training's page: the file as it is, in
// the Arena's terminal box, and one button once it changed. Saving goes through the Arena's own
// loader first; the checkpoint on the stage then plays the new moves. A refusal says where the file
// is wrong, and the text stays as typed.

import { el } from "./dom.js";

export function performancePanel({ guide }, { load, save, onSaved }) {
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
  text.addEventListener("input", changed);
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
  }, refuse);
  return box;
}
