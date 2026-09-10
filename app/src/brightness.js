// Stage brightness, as a control rather than a constant.
//
// The right exposure depends on the screen it is seen on, and three rounds of
// guessing it from the outside cost more than a slider does. This remembers
// the choice per browser and never lets a stored value put the stage back into
// the dark it came from.

const KEY = "arena.brightness";
export const MIN = 0.5;
export const MAX = 2.6;
export const DEFAULT = 1.25;

export function clampBrightness(value) {
  // Absent is not the same as dark. Number("") and Number(null) are both 0,
  // which is finite, so without this an empty stored value would clamp to the
  // minimum and hand back the dimmest stage instead of the default one.
  if (value === null || value === undefined || value === "") return DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT;
  return Math.min(MAX, Math.max(MIN, n));
}

export function readBrightness() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? DEFAULT : clampBrightness(stored);
  } catch {
    // Private windows and blocked site data both land here.
    return DEFAULT;
  }
}

export function writeBrightness(value) {
  const clamped = clampBrightness(value);
  try {
    localStorage.setItem(KEY, String(clamped));
  } catch {
    // Not being able to remember it is not a reason to refuse to apply it.
  }
  return clamped;
}
