// The clip: the page the recorder photographs one frame at a time. It draws
// nothing on a clock of its own — the recorder asks for frame i, gets it, and
// asks for the soundtrack once. ?run=<id>&layout=landscape|vertical&frame=N.

import { getRun, getSettle, getTrace } from "../api.js";
import { LANE_COLORS } from "../course.js";
import { formatScore, isStage } from "../format.js";
import { lanesFor } from "../lanes.js";
import { CTRL_DT, frameCount, leadIn, standing } from "../replay.js";
import { createViewer } from "../viewer.js";
import { actAt, clipPlan, stepAt, travelAt } from "./plan.js";
import { stadiumDirection } from "./direction.js";
import { clipScore } from "./score.js";
import { renderSoundtrack } from "./soundtrack.js";

/** How far the chase camera stands per layout, as a factor on the viewer's
 * offsets. Measured on a three-lane sprint: 1.0 left the ducks small in a
 * 1080p frame, 0.55 crushed the far lane behind the near one; the portrait
 * frame wants a little more room than the landscape. */
const DISTANCE = { landscape: 0.7, vertical: 0.8 };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const layout = params.get("layout") === "vertical" ? "vertical" : "landscape";
document.documentElement.dataset.layout = layout;

function clock(step) {
  const seconds = step * CTRL_DT;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  const cc = String(Math.floor((seconds % 1) * 100)).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}

/** The words on the frame, from the run and nothing else. */
function letter(run) {
  const stage = isStage(run.event);
  const who = `@${run.user} · ${run.policy_name}`;
  const earned = run.receipts.reduce((sum, r) => sum + r.points, 0);
  const dnf = run.seeds_finished === 0;
  for (const id of ["top-title", "intro-title"]) $(id).textContent = run.event.title;
  $("top-participant").textContent = who;
  $("intro-line").textContent = who;
  $("osd-rec").textContent = `REC · ${who}`;
  $("osd-event").textContent = run.event.title.toUpperCase();
  $("fig-time").textContent = formatScore(run.score, { finished: run.seeds_finished });
  // A performance's number is its length, and votes rank it: no place to give at publication.
  if (stage) {
    $("fig-time").nextElementSibling.textContent = "length";
    $("fig-place").parentElement.hidden = true;
  } else {
    $("fig-place").textContent = run.on_board && !run.withdrawn ? `#${run.rank}` : "—";
  }
  $("fig-points").textContent = earned > 0 ? `+${earned}` : "—";
  const stamp = $("stamp");
  stamp.textContent = dnf ? (stage ? "CUT SHORT" : "DNF") : stage ? "WELL DONE" : "VICTORY";
  stamp.classList.add(dnf ? "stamp-fail" : "stamp-pass");
}

function base64(bytes) {
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result.split(",")[1]);
    reader.readAsDataURL(new Blob([bytes]));
  });
}

async function main() {
  const run = await getRun(params.get("run"));
  const lanes = lanesFor(run);
  const [traces, settles] = await Promise.all([
    Promise.all(lanes.map((lane) => getTrace(lane.run_id))),
    Promise.all(lanes.map((lane) => getSettle(lane.run_id).then(standing))),
  ]);
  // Every lane from where its duck stands, all in step.
  const settle = Math.max(...settles.map(frameCount));
  const replays = lanes.map((_, i) => leadIn(settles[i], traces[i], settle));
  const config = run.event.clip;
  const camera = { ...config.camera, distance: DISTANCE[layout] };
  const viewer = await createViewer($("stage"), { rig: run.event.rig, manual: true, camera });
  viewer.setLanes(
    lanes
      .map((lane, i) => ({
        runId: lane.run_id,
        trace: replays[i],
        livery: lane.livery,
        colour: LANE_COLORS[i % LANE_COLORS.length],
        opacity: 1,
        name: `@${lane.user}`,
        // The beak only: the clip's soundtrack plays the voice. Its lane starts with the settle.
        triggers: lane.triggers,
        lead: settle,
      }))
      // The camera stands beyond the last lane: reversed, the author's duck is
      // the one in the foreground, still in the colour its page gives it.
      .reverse(),
    run.event,
    { loop: false },
  );
  const plan = clipPlan(frameCount(traces[0]), config.tape_max_s, settle);
  const score = clipScore({ run, plan, trace: replays[0] });
  const crowdDirection = stadiumDirection(score.crowd ?? {});
  letter(run);

  /** Frame `i` of the plan. Returns the trace step it drew. */
  function draw(i) {
    const act = actAt(plan, i);
    const step = stepAt(plan, i);
    viewer.frame(step * CTRL_DT, travelAt(plan, i), i / plan.fps, crowdDirection);
    // The clock starts where the record's does, after the settle, and stops on
    // the author's last step while the rivals race on.
    $("osd-clock").textContent = clock(Math.max(0, Math.min(step, plan.steps - 1) - plan.settle));
    document.documentElement.dataset.act = act;
    $("intro").hidden = act !== "intro";
    $("stamp").hidden = act !== "outro";
    if (act === "outro") {
      // Reversed for the viewer, the author's lane is its last.
      const { x, y } = viewer.spot(lanes.length - 1);
      Object.assign($("stamp").style, { left: `${100 * x}%`, top: `${100 * y}%` });
    }
    $("sheet").hidden = !(act === "outro" || layout === "vertical");
    return step;
  }

  let pcm = null;
  window.clip = {
    plan,
    score,
    layout,
    draw,
    ready: true,
    error: null,
    /** Renders the whole soundtrack; resolves to its byte length. */
    async soundtrack() {
      pcm = new Uint8Array((await renderSoundtrack(score, plan.seconds)).buffer);
      return pcm.byteLength;
    },
    /** One slice of it, base64, for a transfer in bounded pieces. */
    chunk(offset, size) {
      return base64(pcm.subarray(offset, Math.min(offset + size, pcm.byteLength)));
    },
  };
  draw(Number(params.get("frame") ?? plan.poster));
}

main().catch((jammed) => {
  $("jam").hidden = false;
  $("jam-why").textContent = jammed.message;
  window.clip = { error: jammed.message, ready: true };
  throw jammed;
});
