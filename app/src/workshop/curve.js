// The mean reward per iteration, as the run's TensorBoard file recorded it.

export function curvePath(points, width, height) {
  if (points.length < 2) return "";
  const steps = points.map(([step]) => step);
  const values = points.map(([, value]) => value);
  const [s0, s1] = [Math.min(...steps), Math.max(...steps)];
  const [v0, v1] = [Math.min(...values), Math.max(...values)];
  const x = (s) => ((s - s0) / (s1 - s0 || 1)) * width;
  const y = (v) => height - ((v - v0) / (v1 - v0 || 1)) * height;
  return points.map(([s, v], i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

export function renderCurve(figure, points) {
  figure.innerHTML = `
    <svg viewBox="0 0 400 120" preserveAspectRatio="none" role="img" aria-label="Mean reward per iteration">
      <path fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></path>
    </svg>
    <figcaption class="mono-label"></figcaption>`;
  figure.querySelector("path").setAttribute("d", curvePath(points, 400, 120));
  const last = points.at(-1);
  figure.querySelector("figcaption").textContent = last
    ? `Mean reward ${last[1].toFixed(2)} at iteration ${last[0]}`
    : "No curve yet: it appears once the run's TensorBoard file is here.";
}
