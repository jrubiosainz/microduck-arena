// The way from a challenge to training for it: one line to copy. The line runs the launcher
// this Arena serves (arena/web/routes_launcher.py), which clones microduck-challenges and opens
// the workshop on this challenge. What else it takes — git, a Hugging Face account, a GPU or
// Hugging Face Jobs — the launcher and the workshop ask for when it is needed. uv is needed to
// run the line at all, so the answer to its absence sits folded right under it.

const UV_INSTALL = "curl -LsSf https://astral.sh/uv/install.sh | sh";

export const oneLine = (event, origin = location.origin) => `uv run ${origin}/workshop.py ${event.id}`;

export function trainPanel(event, origin = location.origin) {
  const panel = document.createElement("details");
  panel.className = "train";
  // Open: with no entry form on this page, it is the page's one call to action.
  panel.open = true;
  panel.innerHTML = `
    <summary class="train__open">Train my own robot</summary>
    <p class="train__step">In a terminal:</p>
    <pre class="train__line"><code></code></pre>
    <button type="button" class="train__copy">Copy</button>
    <p class="train__note">It clones <code>microduck-challenges</code> into the folder you run it in
      (or reuses it) and opens the workshop in your browser.</p>
    <details class="train__uv">
      <summary><code>uv: command not found</code>?</summary>
      <p>Install uv, open a new terminal, and paste the line again:</p>
      <pre class="train__line"><code></code></pre>
    </details>`;
  const [line, install] = panel.querySelectorAll(".train__line code");
  line.textContent = oneLine(event, origin);
  install.textContent = UV_INSTALL;
  const copy = panel.querySelector(".train__copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(line.textContent);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the line and copy it";
    }
  });
  return panel;
}

/** In the entry column, above the guide link. */
export function renderTrainPanel(root, event, origin = location.origin) {
  root.querySelector(".entry-col .help-link").before(trainPanel(event, origin));
}
