// What the workshop needs before it can train or publish. Each missing item
// shows the command that fixes it; nothing launches while one is missing.

export const ITEMS = [
  { key: "git", label: "git", fix: "Install git: https://git-scm.com/downloads" },
  {
    key: "identity",
    label: "Your name on commits",
    fix: 'git config --global user.name "Your Name" && git config --global user.email you@example.com',
  },
  { key: "uv", label: "uv", fix: "curl -LsSf https://astral.sh/uv/install.sh | sh" },
  { key: "user", label: "Logged in to Hugging Face", fix: "hf auth login" },
];

/** git, a name on commits and uv — and, without an NVIDIA GPU, a Hugging Face login for HF Jobs. */
export function canTrain(preflight) {
  return Boolean(preflight.git && preflight.identity && preflight.uv && (preflight.gpu || preflight.user));
}

export function renderPreflight(zone, status, { onLogin }) {
  const p = status.preflight;
  zone.innerHTML = `
    <p class="eyebrow">1 · Preflight</p>
    <ul class="preflight"></ul>
    <p class="preflight__where"></p>
    <p class="preflight__gh"></p>
    <form class="preflight__login">
      <label>Or paste a Hugging Face token
        <input type="password" name="token" autocomplete="off" spellcheck="false" />
      </label>
      <button class="button-secondary" type="submit">Log in</button>
      <span class="preflight__note"></span>
    </form>`;
  const list = zone.querySelector(".preflight");
  for (const item of ITEMS) {
    const ok = Boolean(p[item.key]);
    const row = document.createElement("li");
    row.className = ok ? "preflight__ok" : "preflight__missing";
    const label = document.createElement("span");
    label.textContent = ok && item.key === "user" ? `${item.label} as ${p.user}` : item.label;
    row.append(label);
    if (!ok) {
      const fix = document.createElement("code");
      fix.textContent = item.fix;
      row.append(fix);
    }
    list.append(row);
  }
  zone.querySelector(".preflight__where").textContent = p.gpu
    ? "NVIDIA GPU found: training runs on this machine."
    : `No NVIDIA GPU: training runs on Hugging Face Jobs, billed to ${p.user ?? "your Hugging Face account"}.`;
  zone.querySelector(".preflight__gh").textContent = p.gh
    ? "GitHub CLI logged in: the workshop can fork the challenges for you."
    : "No GitHub CLI: to share your code you will fork on GitHub's page (optional).";
  const form = zone.querySelector(".preflight__login");
  form.hidden = Boolean(p.user);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector(".preflight__note");
    note.textContent = "";
    try {
      await onLogin(form.elements.token.value.trim());
    } catch (error) {
      note.textContent = error.message;
    }
  });
}
