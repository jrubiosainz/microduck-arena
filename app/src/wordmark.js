// The title, built the way the simulator builds its own: two stacked lines,
// the second hollow and smaller, in the accent colour with a mistracked-VHS
// offset behind it. Type as the graphic, not a label above the content.

export function wordmark({ compact = false } = {}) {
  const el = document.createElement("h1");
  el.className = compact ? "wordmark wordmark--compact" : "wordmark";
  const solid = document.createElement("span");
  solid.className = "wordmark__solid";
  solid.textContent = "Microduck";
  const hollow = document.createElement("span");
  hollow.className = "wordmark__hollow";
  hollow.textContent = "Arena";
  el.append(solid, hollow);
  return el;
}
