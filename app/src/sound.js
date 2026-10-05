// The arena's cues (see public/sound/PROVENANCE.md): the voting ceremony's
// press, stamp and points, and the reveal's victory, climb and chirp.
//
// A fresh <audio> per play, so two cues can overlap — a tick per flap while a
// counter rolls. What a cue CANNOT assume is that playback will succeed: a
// browser can refuse it (a page opened cold, with no gesture yet), the file
// can fail to load, or the API can be missing entirely. None of that is a
// reason for a vote or a reveal to fail, so `play` wraps everything, never
// throws, and nothing waits on a sound.

const KEY = "arena.muted";

const FILES = {
  press: ["/sound/press.wav", 0.4],
  stamp: ["/sound/stamp.wav", 0.6],
  points: ["/sound/points.wav", 0.4],
  tick: ["/sound/queue-tick.wav", 0.4],
  win: ["/sound/microduck-victory.wav", 0.4],
  climb: ["/sound/rank-climb.wav", 0.4],
  chirp: ["/sound/microduck-chirp.wav", 0.4],
};

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
 * Fetch the kit now, so the first cue of a reveal is not late. A page that
 * plays sound calls it once; every other page never fetches a wav.
 */
export function load() {
  try {
    for (const [file] of Object.values(FILES)) new Audio(file).load();
  } catch {
    // No Audio at all: nothing to warm, and nothing to fail over.
  }
}

/**
 * Play a cue. Never throws, never awaited by the caller: a failed or blocked
 * cue must not hold up the vote or the reveal it was decorating.
 */
export function play(cue) {
  if (isMuted()) return;
  try {
    const [file, volume] = FILES[cue];
    const audio = new Audio(file);
    audio.volume = volume;
    // `.play()` returns a promise a browser can reject (autoplay policy, a
    // missing file); swallow it the same way a synchronous throw is
    // swallowed below.
    audio.play()?.catch(() => {});
  } catch {
    // Missing/unsupported Audio, or a browser that throws instead of
    // rejecting: either way, a sound cue is not something a page depends on.
  }
}

/**
 * A tick per flap while a split-flap tile rolls, read off the tile's rendered
 * faces rather than a timer, so dropped frames never queue a burst of missed
 * clicks. Returns the function that stops following.
 */
export function followCounter(tile) {
  const faces = () =>
    ["::before", "::after"]
      .map((face) => getComputedStyle(tile, face).getPropertyValue("--flip-at"))
      .join("/");
  let previous = faces();
  let frame = requestAnimationFrame(sample);
  function sample() {
    if (!tile.isConnected || !tile.classList.contains("flip-roll")) return;
    const current = faces();
    if (current !== previous) play("points");
    previous = current;
    frame = requestAnimationFrame(sample);
  }
  return () => cancelAnimationFrame(frame);
}
