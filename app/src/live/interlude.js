// The booth as a segment: the airing's broadcast fetched ahead, the scene
// prepared with the run's poster, drawn from the slot's offset on every tick,
// the captions following the plan, the voice and the room tone from the
// audio the page opened.

import { clipUrl, getBroadcast } from "../api.js";
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
  const files = new Map(); // broadcast id -> its fetch, ahead of its slot
  let current = null; // { slot, file }
  let failed = false;

  const fileFor = (slot) => {
    if (!files.has(slot.broadcast)) files.set(slot.broadcast, getBroadcast(slot.broadcast).catch(() => null));
    return files.get(slot.broadcast);
  };

  /** The booth set for the slot's broadcast, or null when it has been swept away. */
  async function mount(slot) {
    if (current?.slot.broadcast === slot.broadcast) return current.file;
    const file = await fileFor(slot);
    // A show at the shutter's midpoint and the play 800 ms later can both be
    // waiting on the same fetch; the second finds the booth already set.
    if (current?.slot.broadcast === slot.broadcast) return current.file;
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
