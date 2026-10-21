// The booth as a segment, for a run's airing and for a desk segment of a cup's
// show alike: the slot's file fetched ahead, the scene prepared with it (the
// run's poster on the CRT, or the cup screen a desk segment carries on the
// back wall), drawn from the slot's offset on every tick, the captions
// following the plan, the voice and the room tone from the audio the page
// opened.

import { clipUrl, getBroadcast, getShow } from "../api.js";
import { isMuted } from "../sound.js";
import { createBooth } from "./booth.js";
import { createCaptions } from "./captions.js";

// What the booth sits for, by the slot's kind: the file it is fetched by and
// the poster its CRT shows.
const SOURCES = {
  booth: {
    key: (slot) => slot.broadcast,
    fetch: (slot) => getBroadcast(slot.broadcast),
    poster: (slot) => clipUrl(slot.run_id, "poster.png", slot.clip),
  },
  desk: {
    key: ({ show }) => `${show.event}/${show.number}/${show.segment}`,
    fetch: ({ show }) => getShow(show.event, show.number, show.segment),
    poster: () => null,
  },
};

export async function createInterlude(stage, { audio }) {
  const canvas = document.createElement("canvas");
  canvas.className = "live-booth";
  canvas.hidden = true;
  stage.append(canvas);
  const booth = await createBooth(canvas);
  const captions = createCaptions(stage);
  const files = new Map(); // a slot's key -> its fetch, ahead of its slot
  let current = null; // { key, file }
  let failed = false;

  const keyOf = (slot) => SOURCES[slot.kind].key(slot);
  const fileFor = (slot) => {
    const key = keyOf(slot);
    if (!files.has(key)) files.set(key, SOURCES[slot.kind].fetch(slot).catch(() => null));
    return files.get(key);
  };

  /** The booth set for the slot's file, or null when it has been swept away or is not served. */
  async function mount(slot) {
    const key = keyOf(slot);
    if (current?.key === key) return current.file;
    const file = await fileFor(slot);
    // A show at the shutter's midpoint and the play 800 ms later can both be
    // waiting on the same fetch; the second finds the booth already set.
    if (current?.key === key) return current.file;
    files.clear();
    failed = !file;
    if (!file) return null;
    booth.prepare(file, SOURCES[slot.kind].poster(slot));
    current = { key, file };
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
