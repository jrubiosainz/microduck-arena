// Your code, then Publish. The policy goes to the user's Hugging Face account
// through `uv run publish`, and the Arena opens with the entry filled in.

export function codeMessage(code) {
  if (code.state === "not-shared") {
    return "Your code is not shared yet: people who open your entry will not see how it was trained.";
  }
  if (code.state === "changes") return `${code.changes + code.unpushed} changes not online yet on ${code.fork}.`;
  return `Shared at github.com/${code.fork} @ ${code.commit} ✔`;
}

function button(className, text, onClick, primary = false) {
  const b = Object.assign(document.createElement("button"), {
    type: "button", className: `${primary ? "button" : "button-secondary"} ${className}`, textContent: text,
  });
  b.addEventListener("click", onClick);
  return b;
}

export function renderCode(zone, code, { onFork, onPush }) {
  zone.innerHTML = '<p class="code__state"></p><div class="code__actions"></div><p class="code__output"></p>';
  zone.querySelector(".code__state").textContent = codeMessage(code);
  const actions = zone.querySelector(".code__actions");
  // git's or gh's own words when a step fails: a rejected push, a fork the org forbids.
  const attempt = (action) => async () => {
    const output = zone.querySelector(".code__output");
    output.textContent = "";
    try {
      await action();
    } catch (error) {
      output.textContent = error.message;
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
  return {
    run: selection.run.id,
    checkpoint: selection.checkpoint,
    name: form.elements.namedItem("policy").value.trim(),
    description: form.elements.namedItem("description").value.trim(),
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
  const go = button("publish__go", "Publish", async () => {
    const note = zone.querySelector(".publish__status");
    note.textContent = "Exporting and uploading…";
    try {
      const done = await onPublish(publishValues(form, selection));
      note.innerHTML = "";
      note.append(`Published ${done.repo} @ ${done.revision.slice(0, 7)}. The Arena opened in your browser: `,
        Object.assign(document.createElement("a"), { href: done.arena_url, target: "_blank", textContent: "enter it there" }), ".");
    } catch (error) {
      note.textContent = error.message;
    }
  }, true);
  const preview = button("publish__preview", "Preview the Hub card", async () => {
    const card = zone.querySelector(".publish__card");
    try {
      const done = await onPreview(publishValues(form, selection));
      card.hidden = false;
      card.textContent = `${done.repo}\n\n${done.readme}`;
    } catch (error) {
      zone.querySelector(".publish__status").textContent = error.message;
    }
  });
  zone.querySelector(".publish__actions").append(preview, go);
  const dirty = zone.querySelector(".publish__dirty");
  const allowed = () => !run.dirty || form.elements.namedItem("anyway").checked;
  const signedIn = Boolean(status.preflight.user);
  dirty.hidden = !run.dirty;
  go.disabled = !allowed() || !signedIn;
  form.elements.namedItem("anyway").addEventListener("change", () => { go.disabled = !allowed() || !signedIn; });
}
