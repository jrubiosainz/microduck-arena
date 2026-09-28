// Train: the challenge's recipe and knobs, editable. Launch writes them into
// challenge.toml, commits, and trains — on this machine's GPU, or on HF Jobs.

import { canTrain } from "./preflight.js";
import { button, say } from "./ui.js";

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
      "the checkpoints come back here as they are saved. " +
      "Closing the workshop does not stop a Hugging Face job: reopen it to fetch or stop it.";
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
  const running = training.state === "running";
  // A Stop or a fetch that failed (the job not cancelled, still billed) stays
  // said while the training runs, across the polls that redraw this zone.
  const said = running ? zone.querySelector(".training__note")?.textContent ?? "" : "";
  zone.innerHTML = `
    <p class="training__head"><span class="mono-label"></span> <strong class="training__state"></strong></p>
    <div class="training__actions"></div>
    <p class="training__note"></p>`;
  zone.querySelector(".mono-label").textContent = `${training.name} · ${where}`;
  zone.querySelector(".training__state").textContent = ended;
  zone.querySelector(".training__note").textContent = said;
  // The note is looked up when the answer comes: a poll may have redrawn the zone meanwhile.
  const attempt = (action) => async () => {
    zone.querySelector(".training__note").textContent = "";
    try {
      await action();
    } catch (error) {
      zone.querySelector(".training__note").textContent = error.message;
    }
  };
  const actions = zone.querySelector(".training__actions");
  if (running) {
    actions.append(button("training__stop", "Stop", attempt(onStop)));
    if (training.mode === "hf-jobs") actions.append(button("training__pull", "Fetch checkpoints now", attempt(onPull)));
  }
}

/**
 * The Hugging Face jobs launched from this checkout, but the one `followed`
 * above. A job outlives the workshop, so a reopened one can still fetch its
 * checkpoints or stop it. Nothing asks the Hub how a job is doing: each one
 * keeps both buttons.
 */
export function renderJobs(zone, jobs, followed, { onPull, onStop }) {
  zone.replaceChildren();
  for (const job of jobs.filter((j) => j.name !== followed)) {
    const row = Object.assign(document.createElement("div"), { className: "job" });
    const label = Object.assign(document.createElement("p"), {
      className: "mono-label", textContent: `${job.name} · Hugging Face Jobs → ${job.ckpt_repo}`,
    });
    const note = Object.assign(document.createElement("p"), { className: "job__note" });
    const attempt = (action, done) => async () => {
      say(note, "");
      try {
        await action(job.name);
        say(note, done);
      } catch (error) {
        say(note, error.message, true);
      }
    };
    row.append(
      label,
      button("job__pull", "Fetch checkpoints", attempt(onPull, `Fetched ${job.ckpt_repo}: its checkpoints are in Test.`)),
      button("job__stop", "Stop the job", attempt(onStop, `Asked Hugging Face to cancel job ${job.job_id}.`)),
      note,
    );
    zone.append(row);
  }
}

/** Add new lines to the log, keeping it scrolled to the end if it was there. */
export function appendLog(pre, lines) {
  if (!lines.length) return;
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent += `${lines.join("\n")}\n`;
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
