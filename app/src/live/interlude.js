// The booth as a segment: the commentary file fetched ahead, the scene
// prepared with the run's poster, drawn from the slot's offset on every tick,
// the captions following the plan, the voice and the room tone from the
// audio the page opened.

import { clipUrl, getCommentary } from "../api.js";
import { isMuted } from "../sound.js";
import { createBooth } from "./booth.js";
import { createCaptions } from "./captions.js";

export async function createInterlude(stage, { audio }) {
  const canvas = document.createElement("canvas");
  canvas.className = "live-booth";
  canvas.hidden = true;
  stage.append(canvas);
  const booth = await createBooth(canvas);
  const captions = createCaptions(stage);
  const files = new Map(); // run_id -> the commentary's fetch, ahead of its slot
  let current = null; // { slot, file }
  let failed = false;

  const fileFor = (slot) => {
    if (!files.has(slot.run_id)) files.set(slot.run_id, getCommentary(slot.run_id).catch(() => null));
    return files.get(slot.run_id);
  };

  /** The booth set for the slot's run, or null when the run has no commentary. */
  async function mount(slot) {
    if (current?.slot.run_id === slot.run_id) return current.file;
    const file = await fileFor(slot);
    // A show at the shutter's midpoint and the play 800 ms later can both be
    // waiting on the same fetch; the second finds the booth already set.
    if (current?.slot.run_id === slot.run_id) return current.file;
    files.clear();
    failed = !file;
    if (!file) return null;
    booth.prepare(file, clipUrl(slot.run_id, "poster.png"));
    current = { slot, file };
    return file;
  }

  function seek(offsetMs) {
    if (!current) return;
    const cue = booth.draw(offsetMs);
    if (cue) captions.show(cue);
    else captions.hide();
  }

  function stop() {
    canvas.hidden = true;
    captions.hide();
    const sound = audio();
    sound?.voice.stop();
    sound?.ambience.stop();
  }

  function muted(flag) {
    const sound = audio();
    sound?.voice.muted(flag);
    sound?.ambience.muted(flag);
  }

  return {
    get failed() {
      return failed;
    },
    prepare(slot) {
      fileFor(slot);
    },
    async show(slot) {
      if (!(await mount(slot))) return;
      canvas.hidden = false;
      seek(0);
    },
    async play(slot, offsetMs) {
      const file = await mount(slot);
      if (!file) return;
      canvas.hidden = false;
      const sound = audio();
      sound?.voice.start(file.plan, offsetMs);
      sound?.ambience.start();
      muted(isMuted());
      seek(offsetMs);
    },
    seek,
    stop,
    muted,
    resize(width, height) {
      booth.resize(width, height);
      captions.resize(width);
    },
    dispose() {
      stop();
      booth.dispose();
    },
  };
}
