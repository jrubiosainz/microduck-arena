// What the workshop needs before it can train or publish. Each missing item
// shows the command that fixes it; nothing launches while one is missing.
// Who is logged in to Hugging Face comes later than the rest (the Hub may be
// slow, or unreachable): `user` is undefined until the Hub has answered.

import { button } from "./ui.js";

export const ITEMS = [
  { key: "git", label: "git", fix: "Install git: https://git-scm.com/downloads" },
  {
    key: "identity",
    label: "Your name on commits",
    fix: 'git config --global user.name "Your Name" && git config --global user.email you@example.com',
  },
  { key: "uv", label: "uv", fix: "curl -LsSf https://astral.sh/uv/install.sh | sh" },
  { key: "user", label: "Logged in to Hugging Face" },
];

/** git, a name on commits and uv — and, without an NVIDIA GPU, a Hugging Face login for HF Jobs. */
export function canTrain(preflight) {
  return Boolean(preflight.git && preflight.identity && preflight.uv && (preflight.gpu || preflight.user));
}

const link = (href, text) => Object.assign(document.createElement("a"), { href, target: "_blank", rel: "noopener", textContent: text });

/** No login yet: where to get an account and the token the field below takes. */
function hubHelp() {
  const help = document.createElement("p");
  help.className = "preflight__help";
  help.append("No account yet? ", link("https://huggingface.co/join", "Create one"), ", then ",
    link("https://huggingface.co/settings/tokens/new?tokenType=write", "create a token with write access"),
    " and paste it below.");
  return help;
}

/** The Hugging Face line before the Hub has named anyone: still asking, or no answer at all. */
function hubPending(p, onRetry) {
  const row = document.createElement("li");
  const label = document.createElement("span");
  row.append(label);
  if (p.user === undefined) {
    row.className = "preflight__checking";
    label.textContent = "Hugging Face: checking…";
  } else {
    row.className = "preflight__missing";
    label.textContent = "Hugging Face unreachable: huggingface.co did not answer. Check your connection.";
    row.append(button("preflight__retry", "Check again", onRetry));
  }
  return row;
}

export function renderPreflight(zone, status, { onLogin, onRetry }) {
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
      <button class="button button-secondary" type="submit">Log in</button>
      <span class="preflight__note"></span>
    </form>`;
  const list = zone.querySelector(".preflight");
  for (const item of ITEMS) {
    if (item.key === "user" && (p.user === undefined || p.reachable === false)) {
      list.append(hubPending(p, onRetry));
      continue;
    }
    const ok = Boolean(p[item.key]);
    const row = document.createElement("li");
    row.className = ok ? "preflight__ok" : "preflight__missing";
    const label = document.createElement("span");
    label.textContent = ok && item.key === "user" ? `${item.label} as ${p.user}` : item.label;
    row.append(label);
    if (!ok) {
      if (item.fix) {
        const fix = document.createElement("code");
        fix.textContent = item.fix;
        row.append(fix);
      } else {
        row.append(hubHelp());
      }
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
  form.hidden = p.user !== null || p.reachable === false;
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
