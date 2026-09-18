// A dialogue becomes a plan: captions, one voice note per syllable, head beats
// and glances, at integral milliseconds so every screen that plays it computes
// the same pose and the same sample. Ported from Duck Jam's
// dome/media/commentators/score.mjs. `prepare` runs once, in the clip page the
// worker drives; the live page only ever plays a stored plan.

export const SAMPLE_RATE = 48000;
export const VOICES = Object.freeze({
  peter: Object.freeze({ name: "Peter Duckry", word_ms: 420 }),
  ray: Object.freeze({ name: "Ray Quackson", word_ms: 500 }),
});
const TURNS = { min: 2, max: 6 };
const CAPTION_CHARS = 84;
const WORD_CHARS = 42;
const FRAME_MS = 40;

/** FNV-1a over the string's code units: the seed of everything time-jittered. */
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function prepare(dialogue, seed = hash(dialogue?.run_id ?? "")) {
  if (
    typeof dialogue?.run_id !== "string" || !dialogue.run_id ||
    !Array.isArray(dialogue.turns) ||
    dialogue.turns.length < TURNS.min || dialogue.turns.length > TURNS.max ||
    !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff
  ) {
    throw new Error("Invalid commentary");
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const between = (a, b) => a + (b - a) * random();
  const captions = [], notes = [], gestures = [], turns = [];
  let burstIndex = 0;
  // Bursts at the microduck's own rate, every other one kept, so the notes
  // read as chatter rather than a buzz.
  const voiceSpan = (speaker, start, span, rate, emphasis) => {
    const count = Math.ceil(span / 173);
    let elapsed = 0;
    for (let i = 0; i < count; i++) {
      if (burstIndex++ % 2) continue;
      const length = Math.round((span * (i + 1)) / count) - Math.round((span * i) / count) - 8;
      notes.push({ speaker, start_ms: start + elapsed, end_ms: start + elapsed + length, rate, emphasis });
      elapsed += length + 8;
    }
    return elapsed;
  };
  let cursor = 800;
  for (const [index, turn] of dialogue.turns.entries()) {
    if (
      !Object.hasOwn(VOICES, turn.speaker) || typeof turn.text !== "string" || !turn.text.trim() ||
      turn.text.length > 500 || (index && dialogue.turns[index - 1].speaker === turn.speaker)
    ) {
      throw new Error("Invalid commentary turn");
    }
    burstIndex = 0;
    const turnStart = cursor;
    const voice = VOICES[turn.speaker];
    const words = turn.text.trim().split(/\s+/);
    if (words.some((w) => w.length > WORD_CHARS)) throw new Error("Caption word is too long");
    const chunks = [];
    for (const word of words) {
      if (!chunks.length || `${chunks.at(-1).join(" ")} ${word}`.length > CAPTION_CHARS) chunks.push([]);
      chunks.at(-1).push(word);
    }
    for (const chunk of chunks) {
      const start_ms = cursor;
      for (const word of chunk) {
        const wordSeed = hash(`${seed}:${index}:${cursor}:${word.toLowerCase()}`);
        const syllables = Math.min(3, Math.max(1, (word.match(/[aeiouy]+/gi) ?? []).length));
        const word_ms = Math.round((voice.word_ms - 45 + Math.min(120, word.length * 9) + (wordSeed % 91)) / 0.7);
        const weights = Array.from({ length: syllables }, (_, i) => 0.8 + ((wordSeed >>> (i * 5)) % 41) / 100);
        const total = weights.reduce((a, b) => a + b, 0);
        let offset = 0, emitted = 0;
        for (let syllable = 0; syllable < syllables; syllable++) {
          const allotted = (word_ms * weights[syllable]) / total;
          // Continuous, narrow register changes: no scale, no melody.
          const rate = 0.97 + ((wordSeed >>> (syllable * 3)) % 61) / 1000;
          emitted += voiceSpan(
            turn.speaker, cursor + emitted, Math.round(offset + allotted) - Math.round(offset), rate,
            word.endsWith("!") ? 0.95 : 0.65 + (wordSeed % 26) / 100,
          );
          offset += allotted;
        }
        cursor += emitted + (/[.!?]$/.test(word) ? 160 : /[,;:]$/.test(word) ? 85 : 0);
      }
      cursor = Math.max(cursor, start_ms + Math.max(1300, chunk.join(" ").length * 45));
      captions.push({ speaker: turn.speaker, name: voice.name, text: chunk.join(" "), start_ms, end_ms: cursor });
    }
    turns.push({ speaker: turn.speaker, start_ms: turnStart, end_ms: cursor });
    cursor += 500;
  }
  const duration_ms = Math.ceil(cursor / FRAME_MS) * FRAME_MS;
  for (const speaker of ["peter", "ray"]) {
    // Irregular head beats through listening and silence, not just syllables.
    for (let at = 0; at < duration_ms; ) {
      const length = Math.round(between(750, 1800));
      const beat = {
        kind: "beat", speaker, start_ms: at, end_ms: Math.min(duration_ms, at + length),
        neck: between(-0.2, 0.08), pitch: between(-0.16, 0.18), roll: between(-0.16, 0.16),
        cycles: random() < 0.3 ? 2 : 1,
      };
      gestures.push(beat);
      const gap = Math.round(between(80, 500));
      // The last beat closes the plan exactly, rather than leaving a gap
      // after it that nothing plays.
      if (at + length + gap >= duration_ms) {
        beat.end_ms = duration_ms;
        at = duration_ms;
      } else {
        at += length + gap;
      }
    }
    for (const turn of turns) {
      const listening = speaker !== turn.speaker;
      let at = turn.start_ms + Math.round(listening ? between(60, 160) : between(900, 1600));
      while (at < turn.end_ms - 450) {
        const length = Math.round(listening ? between(1900, 3200) : between(650, 1100));
        gestures.push({
          kind: "look", speaker, start_ms: at, end_ms: Math.min(turn.end_ms + 180, at + length),
          yaw: (speaker === "peter" ? 1 : -1) * between(0.85, 1.12),
        });
        at += length + Math.round(listening ? between(130, 350) : between(1400, 2300));
      }
    }
  }
  return {
    version: 1, run_id: dialogue.run_id, duration_ms, seed, sample_rate: SAMPLE_RATE, channels: 2,
    captions, notes, gestures,
  };
}

/** A pure pose at item time, so seeking and out-of-order drawing never drift. */
export function poseAt(plan, speaker, ms) {
  const note = plan.notes.find((n) => n.speaker === speaker && n.start_ms <= ms && ms < n.end_ms);
  const phase = note ? (ms - note.start_ms) / (note.end_ms - note.start_ms) : 0;
  const energy = note ? Math.sin(Math.PI * phase) * note.emphasis : 0;
  const pose = { energy, mouth: energy, neck: 0, pitch: 0, roll: 0, yaw: 0 };
  for (const gesture of plan.gestures) {
    if (gesture.speaker !== speaker || ms < gesture.start_ms || ms >= gesture.end_ms) continue;
    const t = (ms - gesture.start_ms) / (gesture.end_ms - gesture.start_ms);
    if (gesture.kind === "look") {
      const ramp = Math.min(1, (ms - gesture.start_ms) / 240, (gesture.end_ms - ms) / 240);
      pose.yaw += gesture.yaw * (0.5 - 0.5 * Math.cos(Math.PI * ramp));
    } else {
      const envelope = Math.sin(Math.PI * t) ** 2;
      for (const key of ["neck", "pitch", "roll"]) {
        const cycles = key === "pitch" ? Math.cos(2 * Math.PI * (gesture.cycles - 1) * t) : 1;
        pose[key] += gesture[key] * envelope * cycles;
      }
    }
  }
  return pose;
}

/** Sample-accurate stereo PCM; identical channels keep the two timbres apart in mono. */
export function synthesize(plan, tones) {
  const audio = new Float32Array((plan.duration_ms * SAMPLE_RATE) / 1000 * 2);
  for (const note of plan.notes) {
    const source = tones[note.speaker];
    if (!source?.length) throw new Error(`Missing native voice: ${note.speaker}`);
    const start = note.start_ms * 48;
    const length = (note.end_ms - note.start_ms) * 48;
    for (let i = 0; i < length; i++) {
      const at = i * note.rate;
      const low = Math.floor(at);
      const fraction = at - low;
      if (low + 1 >= source.length) throw new Error("Native source note is too short");
      const fade = Math.min(1, i / 96, (length - 1 - i) / 96);
      const sample = (source[low] * (1 - fraction) + source[low + 1] * fraction) * fade * note.emphasis;
      audio[(start + i) * 2] = sample;
      audio[(start + i) * 2 + 1] = sample;
    }
  }
  return audio;
}
