// Train: the challenge's recipe and knobs, editable. Launch writes them into
// challenge.toml, commits, and trains — on this machine's GPU, or on HF Jobs.

import { canTrain } from "./preflight.js";
import { say } from "./say.js";

const RECIPE = [
  ["num_envs", "Robots trained in parallel", 1],
  ["max_iterations", "Iterations", 1],
  ["seed", "Seed", 0],
];

export function runName(now = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  return `run-${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

export function formValues(form, challenge) {
  const field = (name) => form.elements.namedItem(name).value;
  return {
    name: field("run").trim(),
    recipe: Object.fromEntries(RECIPE.map(([key]) => [key, Number.parseInt(field(key), 10)])),
    params: Object.fromEntries(challenge.knobs.map((knob) => [knob.name, Number.parseFloat(field(knob.name))])),
  };
}

export function renderTrainForm(zone, status, { onLaunch }) {
  const { challenge, preflight } = status;
  zone.innerHTML = `
    <form class="train-form">
      <label class="field">Run name
        <input name="run" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="40" spellcheck="false" />
      </label>
      <fieldset class="knobs"><legend class="mono-label">Knobs</legend></fieldset>
      <fieldset class="recipe"><legend class="mono-label">Recipe</legend></fieldset>
      <p class="train-form__where"></p>
      <button class="button" type="submit">Launch</button>
      <p class="train-form__status"></p>
    </form>`;
  const form = zone.querySelector("form");
  form.elements.namedItem("run").value = runName();
  const knobs = form.querySelector(".knobs");
  for (const knob of challenge.knobs) {
    const label = document.createElement("label");
    label.className = "knob";
    label.textContent = knob.label;
    const input = Object.assign(document.createElement("input"), {
      // step "any": a stepped range would snap an exact value written in challenge.toml.
      type: "range", name: knob.name, min: knob.min, max: knob.max, step: "any", value: knob.value,
    });
    const shown = document.createElement("output");
    shown.textContent = knob.value;
    input.addEventListener("input", () => { shown.textContent = input.value; });
    label.append(input, shown);
    knobs.append(label);
  }
  const recipe = form.querySelector(".recipe");
  for (const [key, text, min] of RECIPE) {
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = text;
    label.append(Object.assign(document.createElement("input"), {
      type: "number", name: key, min, step: 1, value: challenge.recipe[key],
    }));
    recipe.append(label);
  }
  form.querySelector(".train-form__where").textContent = preflight.gpu
    ? "Trains on this machine's NVIDIA GPU."
    : `Trains on Hugging Face Jobs (one L4 GPU), billed to ${preflight.user ?? "your account"}; ` +
      "the checkpoints come back here as they are saved.";
  const button = form.querySelector("button[type=submit]");
  button.disabled = !canTrain(preflight);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector(".train-form__status");
    say(note, "Committing the recipe and starting…");
    button.disabled = true;
    try {
      await onLaunch(formValues(form, challenge));
      say(note, "");
    } catch (error) {
      say(note, error.message, true);
    } finally {
      button.disabled = !canTrain(preflight);
    }
  });
}

export function renderTraining(zone, training, { onStop, onPull }) {
  const where = training.mode === "hf-jobs" ? `Hugging Face Jobs → ${training.ckpt_repo}` : "this machine";
  const ended = training.state === "failed" ? `failed (exit ${training.returncode})` : training.state;
  zone.innerHTML = `
    <p class="training__head"><span class="mono-label"></span> <strong class="training__state"></strong></p>
    <div class="training__actions"></div>`;
  zone.querySelector(".mono-label").textContent = `${training.name} · ${where}`;
  zone.querySelector(".training__state").textContent = ended;
  const actions = zone.querySelector(".training__actions");
  if (training.state === "running") {
    const stop = Object.assign(document.createElement("button"), { className: "button button-secondary training__stop", textContent: "Stop" });
    stop.addEventListener("click", () => onStop());
    actions.append(stop);
    if (training.mode === "hf-jobs") {
      const pull = Object.assign(document.createElement("button"), { className: "button button-secondary training__pull", textContent: "Fetch checkpoints now" });
      pull.addEventListener("click", () => onPull());
      actions.append(pull);
    }
  }
}

/** Add new lines to the log, keeping it scrolled to the end if it was there. */
export function appendLog(pre, lines) {
  if (!lines.length) return;
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent += `${lines.join("\n")}\n`;
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
