// Three cues for the voting ceremony (see public/sound/PROVENANCE.md): a
// press when a post-it lifts off the row, a stamp when the envelope seals a
// counted vote, and a chime when the "+1"s land on the player chip.
//
// Every cue fires from inside a click handler -- a user gesture -- so there
// is no autoplay policy to route around: the browser only refuses playback
// it did not ask for, and this is always playback the visitor just asked for.
// What it CANNOT assume is that playback will succeed: a browser can still
// block it, the file can fail to load, or the API can be missing entirely.
// None of that is a reason for a vote to fail, so `play` wraps everything and
// never throws.

const KEY = "arena.muted";

const FILES = {
  press: "/sound/press.wav",
  stamp: "/sound/stamp.wav",
  points: "/sound/points.wav",
};

// Built on first use, not at import: a page that never votes never fetches a
// single wav.
const cache = {};

function audioFor(cue) {
  if (!cache[cue]) cache[cue] = new Audio(FILES[cue]);
  return cache[cue];
}

/** Whether cues are silenced. Off by default -- see the file header. */
export function isMuted() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private windows and blocked site data both land here; unmuted is the
    // safer default when the choice cannot be remembered either way.
    return false;
  }
}

export function setMuted(muted) {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    // Not being able to remember the choice is not a reason to ignore it now
    // -- the caller's own UI still reflects it for the rest of this load.
  }
}

/** Flip the flag and report the new state, for a toggle button's own label. */
export function toggleMuted() {
  const next = !isMuted();
  setMuted(next);
  return next;
}

/**
 * Play a cue. Never throws, never awaited by the caller: a failed or blocked
 * cue must not hold up the vote it was decorating.
 */
export function play(cue) {
  if (isMuted()) return;
  try {
    const audio = audioFor(cue);
    audio.currentTime = 0;
    // `.play()` returns a promise a browser can reject (autoplay policy, a
    // missing file); swallow it the same way a synchronous throw is
    // swallowed below.
    audio.play()?.catch(() => {});
  } catch {
    // Missing/unsupported Audio, or a browser that throws instead of
    // rejecting: either way, a sound cue is not something a vote depends on.
  }
}
