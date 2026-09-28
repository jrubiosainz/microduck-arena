// The way from a challenge to training for it: what you need, and one line to
// copy. The line runs the launcher this Arena serves (arena/web/routes_launcher.py),
// which clones microduck-challenges and opens the workshop on this challenge.

const UV_INSTALL = "curl -LsSf https://astral.sh/uv/install.sh | sh";

export const oneLine = (event, origin = location.origin) => `uv run ${origin}/workshop.py ${event.id}`;

export function trainPanel(event, origin = location.origin) {
  const panel = document.createElement("details");
  panel.className = "train";
  panel.innerHTML = `
    <summary class="train__open">Train my robot</summary>
    <p class="train__need">You need <code>git</code>, <code>uv</code> and a Hugging Face account.
      Training runs on your NVIDIA GPU, or on Hugging Face Jobs — billed to your account — when you have none.</p>
    <p class="train__step">No <code>uv</code> yet? Install it first:</p>
    <pre class="train__line"><code></code></pre>
    <p class="train__step">Then, in a terminal:</p>
    <pre class="train__line"><code></code></pre>
    <button type="button" class="train__copy">Copy</button>
    <p class="train__note">It clones <code>microduck-challenges</code> into the folder you run it in
      (or reuses it) and opens the workshop in your browser.</p>`;
  const [install, line] = panel.querySelectorAll(".train__line code");
  install.textContent = UV_INSTALL;
  line.textContent = oneLine(event, origin);
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

/** Above the entry form, for an event that can be trained for today. */
export function renderTrainPanel(root, event, origin = location.origin) {
  if (event.status !== "open") return;
  root.querySelector("#entry").before(trainPanel(event, origin));
}
