// Your code, then Publish. The policy goes to the user's Hugging Face account
// through `uv run publish`, and `uv run publish --enter` enters it on the Arena.

import { speedChoices } from "../format.js";
import { VARIANT_SWATCH_HEX } from "../liveries.js";
import { button, say } from "./ui.js";

export function codeMessage(code) {
  if (code.state === "not-shared") {
    return "Your code is not shared yet: people who open your entry will not see how it was trained.";
  }
  if (code.state === "changes") return `${code.changes + code.unpushed} changes not online yet on ${code.fork}.`;
  return `Shared at github.com/${code.fork} @ ${code.commit} ✔`;
}

export function renderCode(zone, code, { onFork, onPush }) {
  zone.innerHTML = '<p class="code__state"></p><div class="code__actions"></div><p class="code__output"></p>';
  zone.querySelector(".code__state").textContent = codeMessage(code);
  const actions = zone.querySelector(".code__actions");
  // git's or gh's own words when a step fails: a rejected push, a fork the org forbids.
  // Its buttons are held meanwhile: a fork and a push take seconds, and a second click is a second push.
  const attempt = (action) => async () => {
    const output = zone.querySelector(".code__output");
    const buttons = [...actions.querySelectorAll("button")];
    output.textContent = "";
    for (const b of buttons) b.disabled = true;
    try {
      await action();
    } catch (error) {
      output.textContent = error.message;
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  };
  if (code.state === "not-shared" && code.gh) {
    actions.append(button("code__fork", "Create my fork and push", attempt(() => onFork(null))));
  } else if (code.state === "not-shared") {
    const page = Object.assign(document.createElement("a"), {
      className: "code__forkpage", href: code.fork_page, target: "_blank", rel: "noopener", textContent: "Fork on GitHub",
    });
    const address = Object.assign(document.createElement("input"), {
      type: "url", name: "fork", placeholder: "https://github.com/you/microduck-challenges",
    });
    actions.append(page, address, button("code__use", "Use my fork", attempt(() => onFork(address.value.trim()))));
  } else if (code.state === "changes") {
    actions.append(button("code__push", "Commit and push", attempt(() => onPush())));
  }
}

export function defaultName(status, run) {
  return `${status.challenge.folder.replaceAll("_", "-")}-${run.name}`;
}

export function publishValues(form, selection) {
  const speed = form.elements.namedItem("speed").value;
  return {
    run: selection.run.id,
    checkpoint: selection.checkpoint,
    name: form.elements.namedItem("policy").value.trim(),
    description: form.elements.namedItem("description").value.trim(),
    livery: form.elements.namedItem("livery").value,
    // Empty is the sweep, the Arena's default: every speed of the event tried, the best kept.
    speed: speed === "" ? null : Number(speed),
    allow_dirty: Boolean(form.elements.namedItem("anyway")?.checked),
  };
}

/**
 * `draft`, when it names the same run, is what the user had typed the last
 * time this zone was rendered — a re-render (a test finishing, a fresh
 * status after signing in) must not throw that away under them. A draft for
 * a different run is stale and ignored: a new run starts from its own
 * default name and a blank description.
 */
export function renderPublish(zone, selection, status, { onPreview, onPublish, draft }) {
  if (!selection) {
    zone.innerHTML = '<p class="publish__empty">Choose a checkpoint in Test first.</p>';
    return;
  }
  const { run, checkpoint } = selection;
  const applied = draft && draft.runId === run.id ? draft : null;
  zone.innerHTML = `
    <form class="publish">
      <p class="mono-label publish__what"></p>
      <label class="field">Name <input name="policy" spellcheck="false" /></label>
      <label class="field">Description <input name="description" /></label>
      <fieldset class="livery">
        <legend class="mono-label">Colour on the Arena</legend>
        <div class="livery__swatches"></div>
        <input type="hidden" name="livery" />
      </fieldset>
      <label class="field publish__speed">Speed <select name="speed"></select></label>
      <p class="publish__dirty" hidden>This run started from uncommitted changes: the code it records is not
        what trained it. <label><input type="checkbox" name="anyway" /> Publish anyway</label></p>
      <div class="publish__actions"></div>
      <p class="publish__status"></p>
      <pre class="publish__card" hidden></pre>
    </form>`;
  const form = zone.querySelector("form");
  zone.querySelector(".publish__what").textContent =
    `${run.name}, checkpoint ${checkpoint}${run.trials?.[checkpoint] ? "" : " — not tested yet"}`;
  form.elements.namedItem("policy").value = applied ? applied.name : defaultName(status, run);
  form.elements.namedItem("description").value = applied ? applied.description : "";
  form.elements.namedItem("description").placeholder = status.event.title;
  if (applied?.anyway) form.elements.namedItem("anyway").checked = true;
  const livery = form.elements.namedItem("livery");
  livery.value = applied?.livery ?? "classic";
  const swatches = zone.querySelector(".livery__swatches");
  for (const [name, hex] of Object.entries(VARIANT_SWATCH_HEX)) {
    const swatch = Object.assign(document.createElement("button"), { type: "button", className: "swatch", title: name });
    swatch.dataset.livery = name;
    swatch.style.setProperty("--swatch", hex);
    swatch.setAttribute("aria-label", name);
    swatch.setAttribute("aria-pressed", String(name === livery.value));
    swatch.addEventListener("click", () => {
      livery.value = name;
      for (const other of swatches.children) other.setAttribute("aria-pressed", String(other.dataset.livery === name));
    });
    swatches.append(swatch);
  }
  const speed = form.elements.namedItem("speed");
  for (const choice of speedChoices(status.event)) speed.append(new Option(choice.label, choice.value));
  speed.value = applied?.speed ?? "";
  // An event timed at one speed has nothing to choose.
  zone.querySelector(".publish__speed").hidden = !(status.event.sweep_lo < status.event.sweep_hi);
  // Both buttons are held while either call is out: an export and an upload take a minute.
  let pending = false;
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
  const go = button("publish__go", "Publish and enter", held(async () => {
    const note = zone.querySelector(".publish__status");
    say(note, "Exporting, uploading and racing on the Arena (a minute or two)…");
    try {
      const done = await onPublish(publishValues(form, selection));
      say(note, `Published ${done.repo} @ ${done.revision.slice(0, 7)} and ${done.entered}. `);
      note.append(Object.assign(document.createElement("a"), {
        href: done.page_url, target: "_blank", rel: "noopener", textContent: "See it on the Arena",
      }), " (opened in your browser).");
    } catch (error) {
      say(note, error.message, true);
    }
  }), true);
  const preview = button("publish__preview", "Preview the Hub card", held(async () => {
    const card = zone.querySelector(".publish__card");
    try {
      const done = await onPreview(publishValues(form, selection));
      card.hidden = false;
      card.textContent = `${done.repo}\n\n${done.readme}`;
    } catch (error) {
      say(zone.querySelector(".publish__status"), error.message, true);
    }
  }));
  zone.querySelector(".publish__actions").append(preview, go);
  const dirty = zone.querySelector(".publish__dirty");
  const allowed = () => !run.dirty || form.elements.namedItem("anyway").checked;
  const signedIn = Boolean(status.preflight.user);
  function gate() {
    preview.disabled = pending;
    go.disabled = pending || !allowed() || !signedIn;
  }
  dirty.hidden = !run.dirty;
  gate();
  form.elements.namedItem("anyway").addEventListener("change", gate);
}
