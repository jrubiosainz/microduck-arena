// The submit form.
//
// Client-side checks exist to save a pointless upload, not to be the gate: the
// server validates every file with the engine's own loader, and its message is
// what gets shown on failure.

import { submitPolicy } from "./api.js";
import { formatScore, formatSeeds, formatSpeed } from "./format.js";

const MAX_BYTES = 4 * 1024 * 1024; // mirrors arena.policy.MAX_MODEL_BYTES

export function validateFile(file) {
  if (!file) return "Choose a .onnx policy file first.";
  if (!file.name.toLowerCase().endsWith(".onnx")) return "That is not a .onnx file.";
  if (file.size > MAX_BYTES) {
    return `That file is larger than the ${MAX_BYTES} byte limit.`;
  }
  return null;
}

export function describeResult(result) {
  const score = formatScore(result.score, { finished: result.seeds_finished });
  const seeds = formatSeeds(result.seeds_finished, result.seeds_total);
  // The speed is part of the answer, not a footnote: the harness searched for
  // it, and knowing 0.40 rather than 0.25 is what tells you where to retrain.
  const speed = formatSpeed(result.command_vx, { finished: result.seeds_finished });
  const at = speed === "—" ? "" : ` at ${speed} m/s`;
  return `${result.policy_name}: ${score}${at} · ${seeds} finished`;
}

export function renderSubmit(container, { event, onSubmitted }) {
  container.innerHTML = `
    <form class="submit" id="submit-form">
      <label>policy <input type="file" id="policy-file" accept=".onnx" /></label>
      <label>name <input type="text" id="policy-name" placeholder="optional" /></label>
      <button type="submit" id="submit-go">Race it</button>
      <span class="submit-status" id="submit-status"></span>
    </form>
  `;

  const form = container.querySelector("#submit-form");
  const status = container.querySelector("#submit-status");
  const button = container.querySelector("#submit-go");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = container.querySelector("#policy-file").files[0] ?? null;
    const problem = validateFile(file);
    if (problem) {
      status.textContent = problem;
      status.className = "submit-status bad";
      return;
    }

    button.disabled = true;
    status.className = "submit-status";
    status.textContent = `sweeping ${event.sweep_count} speeds…`;
    try {
      const result = await submitPolicy(
        event.id,
        file,
        container.querySelector("#policy-name").value,
      );
      status.textContent = describeResult(result);
      onSubmitted?.(result);
    } catch (error) {
      // The server's wording — the same sentence the robot's daemon gives.
      status.textContent = error.message;
      status.className = "submit-status bad";
    } finally {
      button.disabled = false;
    }
  });
}
