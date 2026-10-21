// A clip in a <video>, servoed to the shared clock. Two elements alternate so
// the next clip is buffering while this one plays; the servo is grid.js's
// `correction`: a nudge for a small error, a seek for a large one.

import { clipUrl, matchClipUrl } from "../api.js";
import { isMuted } from "../sound.js";
import { correction } from "./grid.js";

const ranges = (buffered) =>
  Array.from({ length: buffered.length }, (_, i) => [buffered.start(i), buffered.end(i)]);

export function createReplay(stage, { onRefused }) {
  const videos = [0, 1].map(() => {
    const video = document.createElement("video");
    video.className = "live-video";
    video.playsInline = true;
    video.preload = "auto";
    video.hidden = true;
    stage.append(video);
    return video;
  });
  let active = null; // { video, slot }
  let prepared = null;
  let aligned = false;
  let failed = false;
  let silent = isMuted(); // held here, so it outlives the clip it was set on

  function load(slot) {
    const video = videos.find((v) => v !== active?.video);
    video.src = (slot.media === "match" ? matchClipUrl : clipUrl)(slot.run_id, "landscape.mp4", slot.clip);
    video.load();
    prepared = { video, slot };
  }

  function servo(offsetMs, force) {
    if (!active) return;
    const { video } = active;
    const action = correction(video.currentTime, offsetMs / 1000, ranges(video.buffered), force);
    if (action.time !== undefined) video.currentTime = action.time;
    video.playbackRate = action.rate;
    // A forced alignment that found nothing buffered is not spent: keep
    // forcing until a seek lands.
    aligned = !force || action.time !== undefined;
  }

  /** Make `slot` the active video, loading it if nothing prepared it. */
  function activate(slot) {
    if (active?.slot.run_id === slot.run_id) return active.video;
    if (prepared?.slot.run_id !== slot.run_id) load(slot);
    if (active) active.video.hidden = true;
    active = prepared;
    prepared = null;
    aligned = false;
    const { video } = active;
    // Preloading may already have failed, before any handler was listening.
    failed = video.error !== null;
    video.muted = silent;
    video.hidden = false;
    // Buffering loses the clock even under a second of lag; a seek's own
    // waiting event must not start another alignment.
    video.onwaiting = () => {
      if (!video.seeking) aligned = false;
    };
    video.onerror = () => {
      failed = true;
    };
    return video;
  }

  return {
    get failed() {
      return failed;
    },
    prepare(slot) {
      if (prepared?.slot.run_id !== slot.run_id && active?.slot.run_id !== slot.run_id) load(slot);
    },
    show(slot) {
      const video = activate(slot);
      video.currentTime = 0;
    },
    async play(slot, offsetMs) {
      const video = activate(slot);
      servo(offsetMs, true);
      try {
        await video.play();
      } catch (error) {
        // A broken clip also rejects; that is `failed`, not a refusal. So does
        // a play cut short by a stop, which is the conductor's own doing.
        if (!failed && error.name !== "AbortError") onRefused();
      }
    },
    seek(offsetMs) {
      servo(offsetMs, !aligned);
    },
    stop() {
      if (!active) return;
      active.video.pause();
      active.video.hidden = true;
      active.video.onwaiting = active.video.onerror = null;
      active = null;
      aligned = false;
    },
    muted(flag) {
      silent = flag;
      for (const video of videos) video.muted = flag;
    },
    /** The clips' own sound, at `gain` of full. */
    volume(gain) {
      for (const video of videos) video.volume = gain;
    },
  };
}
