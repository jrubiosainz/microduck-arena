// A match on the live page, called: the replay segment plays the clip, and
// when the slot says the match is called, Peter and Ray's lines are voiced
// and captioned over it from the offset the screen joins at. The clip's own
// sound dips under each line and comes back between them. Any other replay
// plays as the replay alone.

import { getCall } from "../api.js";
import { createCaptions } from "./captions.js";

export const DUCKED = 10 ** (-10 / 20); // -10 dB

const cueAt = (plan, offsetMs) => plan.captions.find((c) => c.start_ms <= offsetMs && offsetMs < c.end_ms) ?? null;

/** The clip's own volume at an offset: DUCKED while a line of the call is voiced, else full. */
export function clipGain(plan, offsetMs) {
  return cueAt(plan, offsetMs) ? DUCKED : 1;
}

export function createCall(stage, { replay, audio }) {
  const captions = createCaptions(stage);
  const calls = new Map(); // match id -> its call's fetch, ahead of its slot
  let current = null; // the match playing, as { call } once its call is in

  const callFor = (slot) => {
    if (!calls.has(slot.run_id)) calls.set(slot.run_id, getCall(slot.run_id).catch(() => null));
    return calls.get(slot.run_id);
  };

  /** The line voiced at the offset on screen, and the clip's sound under it. */
  function follow(offsetMs) {
    const plan = current?.call?.plan;
    if (!plan) return;
    const cue = cueAt(plan, offsetMs);
    if (cue) captions.show(cue);
    else captions.hide();
    replay.volume(clipGain(plan, offsetMs));
  }

  return {
    get failed() {
      return replay.failed;
    },
    prepare(slot) {
      replay.prepare(slot);
      if (slot.call) callFor(slot);
    },
    show(slot) {
      replay.show(slot);
    },
    async play(slot, offsetMs) {
      const began = performance.now();
      const playing = (current = { call: null });
      replay.play(slot, offsetMs);
      if (!slot.call) return;
      // A call that was not there when it was prepared (not served yet, a
      // network blip) is asked for again now that it is due, not kept missing
      // for the rest of the session.
      const kept = calls.get(slot.run_id);
      if (kept && (await kept) === null) calls.delete(slot.run_id);
      const call = await callFor(slot);
      // A stop while the call was on its way leaves it unvoiced, and so does a
      // clip that failed to load: the shutter's panel holds over its slot.
      if (current !== playing || !call || replay.failed) return;
      playing.call = call;
      // A call fetched as the screen joined lands a round trip later: it starts
      // where the match has got to by then.
      const at = offsetMs + performance.now() - began;
      audio()?.voice.start(call.plan, at);
      follow(at);
    },
    seek(offsetMs) {
      replay.seek(offsetMs);
      follow(offsetMs);
    },
    stop() {
      current = null;
      captions.hide();
      audio()?.voice.stop();
      replay.stop();
      replay.volume(1);
    },
    muted(flag) {
      replay.muted(flag);
      audio()?.voice.muted(flag);
    },
    resize(width) {
      captions.resize(width);
    },
  };
}
