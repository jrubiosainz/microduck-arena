// The way from a policy on the Arena to a real microduck. The robot reads a policy's manifest.json
// only when it fetches the policy from the Hub (pollen-robotics/microduck, docs/policy-manifest.md):
// a downloaded .onnx loads there with none. So the server hands over the robot's own line, the repo
// at the commit that raced (RunRecord.robot_command), and this shows it in a popover, opened from
// the board's download glyph and from a run's byline.

import { isStage } from "./format.js";

// How far the panel sits from what opened it, and from the window's edge.
const GAP = 6;
const EDGE = 16;

/** Whether the entry raced on wheels: its own duck, duck 0, on its rig or else the event's. */
export const onWheels = (cast, event) => (cast?.[0]?.rig ?? event.rig) === "rollers";

/**
 * The line to paste on the duck, a button that copies it, and what else is worth knowing: a roller
 * policy wants the duck on wheels, a stage entry's choreography stays here, and a reset undoes it.
 * `download`, when given, heads the panel: the board's glyph opens this panel rather than the file.
 */
export function onDuckPanel({ command, wheels, event, download = null }) {
  const panel = document.createElement("div");
  panel.className = "onduck";
  panel.setAttribute("popover", "");
  panel.innerHTML = `
    <p class="onduck__step">On your microduck, over ssh:</p>
    <pre class="onduck__line"><code></code></pre>
    <button type="button" class="onduck__copy">Copy</button>`;
  const line = panel.querySelector("code");
  line.textContent = command;
  const copy = panel.querySelector(".onduck__copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the line and copy it";
    }
  });
  const note = (html) => {
    const p = document.createElement("p");
    p.className = "onduck__note";
    p.innerHTML = html;
    panel.append(p);
  };
  if (wheels) note("Raced on rollers: your duck needs its wheels, in roller mode.");
  if (isStage(event)) note("The choreography stays here: the robot does not play timelines yet.");
  note("<code>sudo robotctl policy reset walk</code> gives it back its usual walk.");
  if (download) {
    const grab = document.createElement("a");
    grab.className = "onduck__grab";
    grab.href = download;
    grab.setAttribute("download", "");
    grab.textContent = "Download .onnx";
    panel.prepend(grab);
  }
  return panel;
}

/**
 * Opens `panel` from `trigger`, under it or over it and from its left or right edge, whichever side
 * of the window has the room. A popover is fixed to the window, out of the board's own scroller, so
 * it is placed from where the trigger is as it opens, and a scroll closes it rather than leaving it
 * behind its row.
 */
export function popFrom(trigger, panel) {
  trigger.popoverTargetElement = panel;
  panel.addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") place(panel, trigger.getBoundingClientRect());
  });
  panel.addEventListener("toggle", (event) => {
    if (event.newState !== "open") return;
    const close = () => panel.matches(":popover-open") && panel.hidePopover();
    addEventListener("scroll", close, { capture: true, once: true, passive: true });
  });
}

function place(panel, at) {
  const below = innerHeight - at.bottom >= at.top;
  const fromLeft = at.left + at.width / 2 < innerWidth / 2;
  const side = Math.max(fromLeft ? at.left : innerWidth - at.right, EDGE);
  Object.assign(panel.style, {
    top: below ? `${at.bottom + GAP}px` : "auto",
    bottom: below ? "auto" : `${innerHeight - at.top + GAP}px`,
    left: fromLeft ? `${side}px` : "auto",
    right: fromLeft ? "auto" : `${side}px`,
    maxWidth: `${innerWidth - side - EDGE}px`,
  });
}
