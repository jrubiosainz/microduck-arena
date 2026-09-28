// Test: pick a run and a checkpoint; the workshop exports it and races it with
// the Arena's own evaluator on this machine. Checkpoints differ — on the roller
// sprint, neighbours can score 3 s and fall — so each tested one keeps its score.

export const INDICATIVE = "Indicative — only the Arena times an entry.";

export function formatTrial(t) {
  return `${t.score.toFixed(2)} s · ${t.seeds_finished}/${t.seeds_total} finished · best at ${t.command_vx.toFixed(2)} m/s`;
}

export function renderRuns(zone, runs, selection, { onSelect, onTest }) {
  if (!runs.length) {
    zone.innerHTML = '<p class="runs__empty"></p>';
    zone.firstElementChild.textContent =
      "No run yet. Launch a training above; a Hugging Face Jobs run appears here once its first checkpoints are fetched.";
    return;
  }
  zone.innerHTML = '<div class="runs"></div><button class="button trial__go" type="button">Test this checkpoint</button>';
  const list = zone.querySelector(".runs");
  for (const run of runs) {
    const row = document.createElement("div");
    row.className = "run";
    const title = document.createElement("p");
    title.className = "mono-label";
    title.textContent = `${run.name}${run.dirty ? " · started from uncommitted changes" : ""}`;
    row.append(title);
    for (const checkpoint of run.checkpoints) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "checkpoint";
      const tried = run.trials?.[checkpoint];
      chip.textContent = tried ? `${checkpoint} · ${tried.score.toFixed(2)} s ${tried.seeds_finished}/${tried.seeds_total}` : `${checkpoint}`;
      const chosen = selection?.run.id === run.id && selection.checkpoint === checkpoint;
      chip.setAttribute("aria-pressed", String(chosen));
      chip.addEventListener("click", () => onSelect({ run, checkpoint }));
      row.append(chip);
    }
    list.append(row);
  }
  const go = zone.querySelector(".trial__go");
  go.disabled = !selection;
  go.addEventListener("click", () => onTest());
}

export function renderResult(zone, result) {
  zone.innerHTML = '<p class="trial__score"></p><p class="trial__seeds mono-label"></p><p class="trial__caveat"></p>';
  zone.querySelector(".trial__score").textContent = `checkpoint ${result.checkpoint}: ${formatTrial(result)}`;
  zone.querySelector(".trial__seeds").textContent = result.per_seed
    .map((s) => `seed ${s.seed} ${s.status}${s.time_s == null ? "" : ` ${s.time_s.toFixed(2)} s`}`)
    .join(" · ");
  zone.querySelector(".trial__caveat").textContent = INDICATIVE;
}
