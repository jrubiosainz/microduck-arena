// The form that launches a training. It stays locked until the checkout is committed — a training
// starts from a commit, so its job records exactly the code that trained it — then asks where to
// train and under which name; the rewards and the recipe are folded away. Redrawing it never
// touches what is typed in it.

import { el } from "./dom.js";

const two = (n) => String(n).padStart(2, "0");
const RECIPE = [["num_envs", "Robots in parallel", 1], ["max_iterations", "Iterations", 1], ["seed", "Seed", 0]];
const IDENTITY = 'git config --global user.name "Your Name"\ngit config --global user.email you@example.com';

export function runName(now = new Date()) {
  return `run-${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

export function revisionMessage(event, now = new Date()) {
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `${event} training revision ${day} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

/** Why a place to train is not available, or null when it is: a sentence that reads alone under the stickers. */
export function unavailable(where, { account, gpu }) {
  if (where === "local") return gpu ? null : "No NVIDIA GPU here, so this machine cannot train.";
  if (account.phase === "checking") return "Checking your Hugging Face account…";
  if (account.phase === "unreachable") return "Hugging Face is unreachable: check your connection.";
  if (account.phase !== "in") return "Log in to Hugging Face (top right) to train on its Jobs.";
  if (!account.canPay) return "Hugging Face Jobs need a payment method: see Ready to train on the home page.";
  return null;
}

function knobField(knob) {
  const label = el("label", "knob", knob.label);
  const shown = el("output", "", Number(knob.value).toFixed(1));
  // step "any": a stepped range would snap an exact value written in challenge.toml.
  const input = Object.assign(el("input"), { type: "range", name: knob.name, min: knob.min, max: knob.max, step: "any", value: knob.value });
  input.addEventListener("input", () => { shown.textContent = Number(input.value).toFixed(1); });
  label.append(shown, input);
  return label;
}

function recipeField([key, text, min], value) {
  const label = el("label", "recipe-row", text);
  label.append(Object.assign(el("input"), { type: "number", name: key, min, step: 1, value }));
  return label;
}

export function trainForm({ challenge, gpu }, { onCommit, onTrain }) {
  const event = challenge.event.id;
  const card = el("div", "panel train-panel");
  card.innerHTML = `
    <h3 class="panel__title">New training</h3>
    <div class="gate" hidden>
      <p class="gate__say"><b></b> since your last commit. Commit them first: the job will record exactly this code.</p>
      <ul class="gate__files"></ul>
      <label class="field">Message <input name="message" spellcheck="false" /></label>
      <div class="gate__identity" hidden><p class="hint">Git needs your name on commits first. In a terminal:</p><pre></pre></div>
      <button class="button gate__go" type="button">Commit</button>
      <p class="note gate__note"></p>
    </div>
    <p class="committed" hidden></p>
    <fieldset class="form">
      <div class="field"><span class="field__name">Train on</span>
        <div class="seg"><button type="button" data-where="hf-jobs">Hugging Face Jobs</button><button type="button" data-where="local">This machine</button></div>
        <p class="hint where-hint"></p><p class="hint where-why" hidden></p></div>
      <label class="field">Run name <input name="run" spellcheck="false" maxlength="40" /></label>
      <details class="settings"><summary>Settings</summary>
        <h4>Rewards <small>how much each behaviour pays</small></h4><div class="rewards"></div>
        <h4>Recipe <small>how long and how wide</small></h4><div class="recipe"></div></details>
      <button class="button train-go" type="button">Train</button>
      <p class="note train-note"></p>
    </fieldset>`;
  const $ = (selector) => card.querySelector(selector);
  $(".gate__identity pre").textContent = IDENTITY;
  $("input[name=run]").value = runName();
  for (const knob of challenge.knobs.filter((k) => k.group === "reward")) $(".rewards").append(knobField(knob));
  for (const row of RECIPE) $(".recipe").append(recipeField(row, challenge.recipe[row[0]]));
  for (const knob of challenge.knobs.filter((k) => k.group !== "reward")) $(".recipe").append(knobField(knob));

  let where = gpu ? "local" : "hf-jobs";
  let latest = null; // { code, account }
  let pending = false;

  const values = () => {
    const field = (name) => $(`fieldset [name="${name}"]`).value;
    return {
      name: field("run").trim(), where,
      recipe: Object.fromEntries(RECIPE.map(([key]) => [key, Number.parseInt(field(key), 10)])),
      params: Object.fromEntries(challenge.knobs.map((k) => [k.name, Number.parseFloat(field(k.name))])),
    };
  };
  const say = (selector, text, bad = false) => {
    $(selector).textContent = text;
    $(selector).classList.toggle("bad", bad);
  };

  function draw() {
    const { code, account } = latest;
    const dirty = code.changes.length > 0;
    // The message is written for the user when the gate opens, never after: what they type, or
    // empty, stays through every redraw.
    if (dirty && $(".gate").hidden) $("input[name=message]").value = revisionMessage(event);
    $(".gate").hidden = !dirty;
    $(".committed").hidden = dirty;
    $(".committed").replaceChildren("✓ All committed · ", el("code", "", code.commit));
    $("fieldset").disabled = dirty;
    if (dirty) {
      const n = code.changes.length;
      $(".gate__say b").textContent = `${n} file${n === 1 ? "" : "s"} changed`;
      $(".gate__files").replaceChildren(...code.changes.map((c) => {
        const li = el("li");
        const path = el("span");
        // A long path wraps after a slash, not inside a name.
        path.append(...c.path.split(/(?<=\/)/).flatMap((part) => [part, el("wbr")]));
        li.append(el("span", "", c.status), path);
        return li;
      }));
      $(".gate__identity").hidden = code.identity;
      $(".gate__go").hidden = !code.identity;
      $(".gate__go").disabled = pending;
    }
    for (const button of card.querySelectorAll(".seg button")) {
      const reason = unavailable(button.dataset.where, { account, gpu });
      button.setAttribute("aria-pressed", String(button.dataset.where === where));
      button.disabled = Boolean(reason);
      button.title = reason ?? "";
    }
    const blocked = unavailable(where, { account, gpu });
    say(".where-hint", blocked ?? (where === "local" ? "Trains on this machine's NVIDIA GPU." : `One L4 GPU, billed to ${account.user}.`), Boolean(blocked));
    // The other place, when it cannot be chosen, says why under the stickers too, not only in a tooltip.
    const other = unavailable(where === "local" ? "hf-jobs" : "local", { account, gpu });
    $(".where-why").textContent = other ?? "";
    $(".where-why").hidden = !other;
    $(".train-go").disabled = dirty || pending || Boolean(blocked);
  }

  for (const button of card.querySelectorAll(".seg button")) {
    button.addEventListener("click", () => {
      where = button.dataset.where;
      draw();
    });
  }
  $(".gate__go").addEventListener("click", async () => {
    pending = true;
    draw();
    say(".gate__note", "");
    try {
      await onCommit($("input[name=message]").value.trim());
    } catch (error) {
      say(".gate__note", error.message, true);
    } finally {
      pending = false;
      draw();
    }
  });
  $(".train-go").addEventListener("click", async () => {
    pending = true;
    draw();
    say(".train-note", "Committing the settings and starting…");
    try {
      await onTrain(values());
      say(".train-note", "");
      $("input[name=run]").value = runName();
    } catch (error) {
      say(".train-note", error.message, true);
    } finally {
      pending = false;
      draw();
    }
  });

  return {
    el: card,
    update(next) {
      latest = next;
      draw();
    },
  };
}
