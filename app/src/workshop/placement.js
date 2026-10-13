// The stage from above, over the performance's text. A marker for each duck where its `start` puts
// it: the star (ducks[0], "self") a ★ in orange, the others numbered as the text lists them. The
// audience is at the bottom, so the plan's right is the stage's y and its down the stage's x: the
// timeline's own frame (x towards the audience, y to the audience's right, yaw 0 facing the audience).
// Drag a marker to move its duck, its dot to turn it. A spot the Arena's loader would refuse — nearer
// the stage's edge, or another duck, than the event allows — turns magenta and is not taken. The text
// stays the one truth: a move rewrites that duck's `start` in it, an edit of it moves the markers,
// and while it is not JSON the plan is greyed out. "+ duck" puts another policy on a free spot.

import { el } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";
const CM = 100; // the plan is drawn in centimetres: SVG text wants sizes well above 1
const AUDIENCE_CM = 30; // the strip under the stage that says where the audience sits
const HANDLE_M = 0.25; // how far in front of its duck the dot that turns it stands
// The loader's own tolerance (arena/timeline.py _EPS_M): in floats 1.9 - 0.3 < 1.6, and a duck on the margin is taken.
const EPS_M = 1e-9;
const DOT_CM = 6;

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const listsObjects = (value) => Array.isArray(value) && value.some(isObject);
const finite = (value) => (Number.isFinite(value) ? value : 0);

function inline(value) {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (isObject(value)) return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(", ")}}`;
  return JSON.stringify(value);
}

/**
 * A timeline as the plan writes it back: the file, each duck, and each list of keyframes or notes one
 * entry a line, as an author lays one out; anything smaller on the line of its key.
 */
export function formatTimeline(value, indent = "") {
  const inner = `${indent}  `;
  if (listsObjects(value)) return `[\n${value.map((item) => inner + formatTimeline(item, inner)).join(",\n")}\n${indent}]`;
  if (!isObject(value) || !Object.values(value).some(listsObjects)) return inline(value);
  const lines = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatTimeline(item, inner)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The JSON object the text holds, or null while it holds none. */
function parse(text) {
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** Where each duck starts, as the loader reads it: a v1 file's one duck, and a start left out, at the centre facing the audience. */
function startsOf(raw) {
  if (!Array.isArray(raw.ducks)) return [{ x: 0, y: 0, yaw: 0 }];
  return raw.ducks.map((duck) => ({ x: finite(duck?.start?.x), y: finite(duck?.start?.y), yaw: finite(duck?.start?.yaw) }));
}

/** The text as a troupe: a v1 file becomes the v2 troupe of one the loader reads it as, its keyframes, voice and song the star's. */
function asTroupe(raw) {
  if (Array.isArray(raw.ducks)) return raw;
  const star = { policy: "self", ...raw };
  delete star.timeline_version;
  delete star.duration_s;
  return { timeline_version: 2, duration_s: raw.duration_s, ducks: [star] };
}

/** `duck` with its new start, written right after its policy, where an author reads it first. */
const placed = (duck, start) => Object.assign({ policy: duck.policy, start: null }, duck, { start });

function shape(tag, className, attributes, text) {
  const node = document.createElementNS(SVG, tag);
  if (className) node.setAttribute("class", className);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function placementPlan(event, { read, write, performers }) {
  const [depth, width] = event.size_m;
  // Where a duck's centre may stand, and how near another: the loader's own numbers (arena/timeline.py).
  const room = { x: depth / 2 - event.edge_margin_m, y: width / 2 - event.edge_margin_m };
  const spacing = event.min_spacing_m;
  const view = { left: (-width * CM) / 2, top: (-depth * CM) / 2, width: width * CM, height: depth * CM + AUDIENCE_CM };

  const box = el("div", "placement");
  const svg = shape("svg", "placement__stage", { viewBox: `${view.left} ${view.top} ${view.width} ${view.height}` });
  svg.append(
    shape("rect", "placement__floor", { x: view.left, y: view.top, width: view.width, height: depth * CM }),
    shape("rect", "placement__room", { x: round(-room.y * CM, 1), y: round(-room.x * CM, 1),
      width: round(2 * room.y * CM, 1), height: round(2 * room.x * CM, 1) }),
    shape("text", "placement__audience", { x: 0, y: (depth * CM) / 2 + AUDIENCE_CM * 0.7 }, "AUDIENCE"),
  );
  const add = el("select", "quiet placement__add");
  add.append(new Option("+ duck", ""), new Option("This checkpoint again", "self"));
  const bar = el("div", "placement__bar");
  bar.append(el("p", "hint", "Drag a duck to move it, its dot to turn it."), add);
  box.append(svg, bar);

  let troupe = null; // the text's JSON object; null while the text holds none
  let starts = []; // where each duck starts, as last read: a greyed plan keeps them
  let moving = null; // { index, turn, spot } while a marker is dragged

  const refused = (spot, index) => Math.abs(spot.x) > room.x + EPS_M || Math.abs(spot.y) > room.y + EPS_M
    || starts.some((other, j) => j !== index && Math.hypot(other.x - spot.x, other.y - spot.y) < spacing - EPS_M);

  function marker(spot, index) {
    const star = index === 0;
    const node = shape("g", `placement__duck${star ? " placement__duck--star" : ""}${refused(spot, index) ? " placement__duck--refused" : ""}`, {
      "data-duck": index,
      transform: `translate(${round(spot.y * CM, 1)} ${round(spot.x * CM, 1)})`,
    });
    // Facing yaw is (cos, sin) on the stage's (x, y): (sin, cos) on the plan's (right, down).
    const yaw = (spot.yaw * Math.PI) / 180;
    const dot = { cx: round(Math.sin(yaw) * HANDLE_M * CM, 1), cy: round(Math.cos(yaw) * HANDLE_M * CM, 1) };
    node.append(
      shape("line", "placement__heading", { x1: 0, y1: 0, x2: dot.cx, y2: dot.cy }),
      // Half the spacing across: two ducks' circles may touch, never overlap.
      shape("circle", "placement__body", { r: (spacing * CM) / 2 }),
      shape("text", "", { x: 0, y: 0 }, star ? "★" : String(index)),
      shape("circle", "placement__handle", { ...dot, r: DOT_CM }),
    );
    return node;
  }

  function draw() {
    box.classList.toggle("placement--off", !troupe);
    add.hidden = !troupe || starts.length >= event.max_ducks;
    svg.querySelectorAll(".placement__duck").forEach((node) => node.remove());
    starts.forEach((spot, index) => svg.append(marker(moving?.index === index ? moving.spot : spot, index)));
  }

  function refresh() {
    troupe = parse(read());
    if (troupe) starts = startsOf(troupe);
    draw();
  }

  function rewrite(raw) {
    write(`${formatTimeline(raw)}\n`);
    refresh();
  }

  /** The stage point under the pointer: the plan keeps its viewBox's proportions, so its box maps straight onto it. */
  function pointAt(pointer) {
    const frame = svg.getBoundingClientRect();
    return {
      x: (view.top + ((pointer.clientY - frame.top) / frame.height) * view.height) / CM,
      y: (view.left + ((pointer.clientX - frame.left) / frame.width) * view.width) / CM,
    };
  }

  function move(pointer) {
    const target = pointAt(pointer);
    const from = starts[moving.index];
    moving.spot = moving.turn
      ? { ...from, yaw: Math.round((Math.atan2(target.y - from.y, target.x - from.x) * 180) / Math.PI) }
      : { ...from, x: round(target.x, 2), y: round(target.y, 2) };
    draw();
  }

  function drop() {
    window.removeEventListener("pointermove", move);
    const { index, spot } = moving;
    const from = starts[index];
    moving = null;
    if (refused(spot, index) || (spot.x === from.x && spot.y === from.y && spot.yaw === from.yaw)) {
      draw();
      return;
    }
    const raw = asTroupe(troupe);
    raw.ducks[index] = placed(raw.ducks[index], spot);
    rewrite(raw);
  }

  svg.addEventListener("pointerdown", (pointer) => {
    const duck = troupe && pointer.target.closest(".placement__duck");
    if (!duck) return;
    pointer.preventDefault();
    const index = Number(duck.getAttribute("data-duck"));
    moving = { index, turn: pointer.target.classList.contains("placement__handle"), spot: starts[index] };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop, { once: true });
  });

  /** The free spot nearest the centre, on a grid of the spacing: beside the others rather than before or behind them. */
  function freeSpot() {
    const [rows, columns] = [Math.floor(room.x / spacing), Math.floor(room.y / spacing)];
    const spots = [];
    for (let i = -rows; i <= rows; i += 1) {
      for (let j = -columns; j <= columns; j += 1) spots.push({ x: round(i * spacing, 2), y: round(j * spacing, 2), yaw: 0 });
    }
    spots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || Math.abs(a.x) - Math.abs(b.x));
    return spots.find((spot) => !refused(spot, -1));
  }

  add.addEventListener("change", () => {
    const raw = asTroupe(troupe);
    raw.ducks.push({ policy: add.value, start: freeSpot(), keyframes: [{ t: 0 }] });
    add.value = "";
    rewrite(raw);
  });

  performers().then((found) => {
    for (const [label, mine] of [["Your trainings", true], ["Published", false]]) {
      const group = el("optgroup");
      group.label = label;
      group.append(...found.filter((p) => p.policy.startsWith("local:") === mine).map((p) => new Option(`${p.label} · ${p.rig}`, p.policy)));
      if (group.children.length) add.append(group);
    }
  });

  refresh();
  return { el: box, refresh };
}
