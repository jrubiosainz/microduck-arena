// Publish & compete: the checkpoint the page has chosen goes to the user's Hugging Face account and is
// entered on the Arena by `uv run publish --enter`. A name, and a word for the commentators, are both
// needed. The fork and the push are ticked above the button: a nudge, not a gate. What is typed stays
// through every redraw of the page, and no button is rebuilt under the pointer.

import { checkLine, forkGuide } from "./checks.js";
import { el } from "./dom.js";
import { officialTime } from "./tickets.js";

export const PLACEHOLDER = "What makes it behave like that? What did you change? Describe what it is doing.";
// Why Publish is off while no account is logged in, as the challenge's form says it.
const NOT_IN = { checking: "Checking your Hugging Face account…", unreachable: "Hugging Face is unreachable: check your connection." };

export function defaultName(folder, run) {
  return `${folder.replaceAll("_", "-")}-${run}`;
}

export function publishPanel({ event, folder }, { onPublish, onPreview, onPush, onUseFork }) {
  const card = el("div", "panel publish");
  card.innerHTML = `
    <h3 class="panel__title">Publish &amp; compete</h3>
    <label class="field">Name <input name="policy" spellcheck="false" /></label>
    <label class="field"><span class="booth"><span class="booth__heads"><img src="/duck-head-mark.webp" alt="" /><img src="/duck-head-mark.webp" alt="" /></span>
      <span class="booth__who"><b>For the commentators</b><span>Peter &amp; Ray read it on air when your duck races.</span></span></span>
      <textarea name="description" maxlength="280"></textarea></label>
    <p class="hint publish__plain">Plain sentences: no links, no file names or paths.</p>
    <ul class="checks"></ul>
    <p class="publish__dirty" hidden>This run started from uncommitted changes: the code it records is not what trained it.
      <label><input type="checkbox" name="anyway" /> Publish anyway</label></p>
    <p class="hint publish__why" hidden></p>
    <div class="actions"><button class="button publish__go" type="button"></button><button class="quiet publish__preview" type="button">Preview the Hub card</button></div>
    <p class="note publish__status"></p>
    <div class="result" hidden></div>
    <pre class="publish__card" hidden></pre>`;
  const $ = (selector) => card.querySelector(selector);
  $("textarea").placeholder = PLACEHOLDER;
  let latest = null; // { job, code, account, selected }
  let pending = false;
  let named = false;
  let checksDrawn = "";

  const values = () => ({
    checkpoint: latest.selected,
    name: $("input[name=policy]").value.trim(),
    description: $("textarea").value.trim(),
    allow_dirty: $("input[name=anyway]").checked,
  });
  const say = (text, bad = false) => {
    $(".publish__status").textContent = text;
    $(".publish__status").classList.toggle("bad", bad);
  };

  // The preview is a dry run of the same publish: the server refuses it for the same reasons.
  function gate() {
    const { job, account, selected } = latest;
    const v = values();
    $(".publish__go").textContent = selected === null ? "Pick a checkpoint" : "Publish and compete";
    const shut = pending || selected === null || !v.name || !v.description || (job.dirty && !v.allow_dirty) || account.phase !== "in";
    $(".publish__go").disabled = shut;
    $(".publish__preview").disabled = shut;
    $(".publish__why").hidden = account.phase === "in";
    $(".publish__why").textContent = NOT_IN[account.phase] ?? "Log in to Hugging Face first (top right).";
  }

  function drawChecks() {
    const { job, code } = latest;
    // Redrawn only when what they say changes: a fork address being typed in the guide stays.
    const key = JSON.stringify([code.fork, code.unpushed, job.code_url]);
    if (key === checksDrawn) return;
    checksDrawn = key;
    let push;
    if (code.fork && !job.code_url) {
      push = el("button", "quiet", "Push");
      push.type = "button";
      push.addEventListener("click", async () => {
        push.disabled = true;
        try {
          await onPush();
        } catch (error) {
          say(error.message, true);
        } finally {
          push.disabled = false;
        }
      });
    }
    const unpushed = code.unpushed === 1 ? "1 commit is only on this machine." : `${code.unpushed} commits are only on this machine.`;
    $(".checks").replaceChildren(
      checkLine({ ticked: Boolean(code.fork), label: "Working in your fork", note: code.fork ?? undefined,
        guide: forkGuide({ onUseFork }), group: "publish" }),
      checkLine({ ticked: Boolean(job.code_url), label: "Pushed to your fork", variant: 1, action: push,
        note: job.code_url ? "Your entry links the code that trained it." : code.unpushed ? unpushed : "Your fork does not hold this run's commit yet." }),
    );
  }

  const held = (call) => async () => {
    pending = true;
    gate();
    try {
      await call();
    } finally {
      pending = false;
      gate();
    }
  };

  $(".publish__go").addEventListener("click", held(async () => {
    say("Exporting, uploading and racing on the Arena (a minute or two)…");
    $(".result").hidden = true;
    try {
      const done = await onPublish(values());
      say("");
      const link = el("a", "", "See it on the Arena ↗");
      Object.assign(link, { href: done.page_url, target: "_blank", rel: "noopener" });
      $(".result").replaceChildren(el("span", "mono-label", `Entered on ${event.title}`), el("b", "", officialTime(done.entered)),
        el("span", "", done.entered), link);
      $(".result").hidden = false;
    } catch (error) {
      say(error.message, true);
    }
  }));
  $(".publish__preview").addEventListener("click", held(async () => {
    say("Writing the Hub card…");
    try {
      const done = await onPreview(values());
      say("");
      $(".publish__card").textContent = `${done.repo}\n\n${done.readme}`;
      $(".publish__card").hidden = false;
    } catch (error) {
      say(error.message, true);
    }
  }));
  for (const field of card.querySelectorAll("input[name=policy], textarea")) field.addEventListener("input", gate);
  $("input[name=anyway]").addEventListener("change", gate);

  return {
    el: card,
    update(next) {
      latest = next;
      if (!named) {
        $("input[name=policy]").value = defaultName(folder, next.job.name);
        named = true;
      }
      $(".publish__dirty").hidden = !next.job.dirty;
      drawChecks();
      gate();
    },
  };
}
